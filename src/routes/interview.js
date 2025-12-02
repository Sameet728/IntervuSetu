import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Interview from "../models/Interview.js";
const router = express.Router();

function ensureAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/auth/login");
  next();
}

router.get("/start", ensureAuth, (req, res) => res.render("interview"));

// generate questions, save to DB, return interviewId and questions
// generate questions, save to DB, return interviewId and questions
router.post("/generate", ensureAuth, async (req, res) => {
  try {
    const { 
      title, 
      type, 
      skills = [], 
      experienceLevel, 
      duration 
    } = req.body;

    if (!title || !type || !skills.length || !experienceLevel || !duration) {
      return res.status(400).json({ 
        error: "Missing required fields: title, type, skills[], experienceLevel, duration" 
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const gen = new GoogleGenerativeAI(apiKey);
    const model = gen.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    });

    const prompt = `
You are an expert REAL technical interviewer.

Generate EXACTLY 7 interview questions for:
- Job Title: ${title}
- Interview Type: ${type}
- Required Skills: ${skills.join(", ")}
- Experience Level: ${experienceLevel}
- Interview Duration: ${duration} minutes

STRICT RULES:
- Questions MUST be practical, technical, and used in REAL interviews.
- Difficulty MUST match experience level.
- Cover a mix of: conceptual, coding/logic, debugging, scenario, system-thinking.
- NO jokes. NO story questions. NO creative nonsense.
- Return ONLY a JSON array of strings. No markdown.

Example output:
[
  "Explain how a HashMap works internally.",
  "Design a URL shortener system."
]
`;

    const result = await model.generateContent(prompt);
    const text = await result.response.text();

    let questions = [];
    try {
      questions = JSON.parse(text);
    } catch (e) {
      // Gemini cleanup fallback
      let cleaned = text
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      try {
        questions = JSON.parse(cleaned);
      } catch (e2) {
        questions = cleaned
          .split("\n")
          .map((x) => x.trim().replace(/^[\-\*\d\.]+\s*/, ""))
          .filter((x) => x.length > 5)
          .slice(0, 7);
      }
    }

    // ALWAYS ensure exactly 7 questions
    questions = questions.slice(0, 7);

    const interview = await Interview.create({
      userId: req.session.user.id,

      // NEW fields for new schema
      title,
      type,
      skills,
      experienceLevel,
      duration,

      // compatibility
      role: title,
      difficulty: experienceLevel,

      questions,
      status: "generated",
    });

    return res.json({ 
      interviewId: interview._id, 
      questions 
    });

  } catch (err) {
    console.error("Generation error", err);
    return res.status(500).json({ error: "AI generation failed" });
  }
});


// mark attempt started
router.post("/start-attempt", ensureAuth, async (req, res) => {
  const { interviewId } = req.body;
  try {
    const it = await Interview.findById(interviewId);
    if (!it) return res.status(404).json({ error: "Not found" });
    it.status = "in_progress";
    it.currentIndex = 0;
    it.transcript = [];
    it.answers = [];
    await it.save();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed" });
  }
});

// voice-respond: accept user utterance & transcript, call Gemini and return aiReply + nextQuestion
router.post("/voice-respond", ensureAuth, async (req, res) => {
  try {
    const { interviewId, questionIndex, userUtterance, transcript } = req.body;
    const it = await Interview.findById(interviewId);
    if (!it) return res.status(404).json({ error: "Not found" });

    // append user utterance to DB transcript and answers
    const now = new Date();
    const userMsg = {
      who: "user",
      text: userUtterance || "",
      ts: now.toISOString(),
    };
    it.transcript = (it.transcript || []).concat([userMsg]);
    it.answers = it.answers || [];
    it.answers[questionIndex] = userUtterance || "";
    await it.save();

    // Build prompt for Gemini - strict JSON output
    const systemPrompt = `
You are an expert interview interviewer and coach.
Context: This is a spoken mock interview. You will:
1) Give a short spoken-style feedback to the candidate's latest answer (1-3 sentences).
2) Then produce the next interview question (concise) OR set nextQuestion to null if interview is finished.
3) If this was the last question, set endInterview true and give a brief closing comment.
Return ONLY a JSON object with keys: {"aiReply":"...", "nextQuestion": "..." or null, "endInterview": true/false}.
Do not include extra commentary outside the JSON.
`.trim();

    const transcriptText = (it.transcript || [])
      .map((m) => `${m.who.toUpperCase()}: ${m.text}`)
      .join("\n");

    const prompt = `${systemPrompt}\n\nTranscript:\n${transcriptText}\n\nLatest question index: ${questionIndex}\nLatest user utterance: ${
      userUtterance || ""
    }\n\nReturn the JSON now.`;

    const apiKey = process.env.GEMINI_API_KEY;
    const gen = new GoogleGenerativeAI(apiKey);
    const model = gen.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    });

    const result = await model.generateContent(prompt);
    const text = await result.response.text();

    // Parse JSON from model output (robust)
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) payload = JSON.parse(m[0]);
      else {
        // fallback: simple aiReply + nextQuestion from script
        payload = {
          aiReply: text,
          nextQuestion: it.questions[questionIndex + 1] || null,
          endInterview: !it.questions[questionIndex + 1],
        };
      }
    }

    // append AI reply to transcript
    const aiMsg = {
      who: "ai",
      text: payload.aiReply || "",
      ts: new Date().toISOString(),
    };
    it.transcript = it.transcript.concat([aiMsg]);

    // update currentIndex and status
    if (payload.endInterview) {
      it.status = "completed";
    } else {
      it.currentIndex = Math.min(
        (it.currentIndex || 0) + 1,
        it.questions.length - 1
      );
    }

    await it.save();

    res.json({
      aiReply: payload.aiReply || "",
      nextQuestion: payload.nextQuestion || null,
      endInterview: !!payload.endInterview,
    });
  } catch (err) {
    console.error("voice-respond error", err);
    res.status(500).json({ error: "voice-respond failed" });
  }
});

// save answers and generate final feedback (optional endpoint)
router.post("/save-answers", ensureAuth, async (req, res) => {
  const { interviewId, answers } = req.body;

  try {
    const interview = await Interview.findById(interviewId);
    if (!interview)
      return res.status(404).json({ error: "Interview not found" });

    interview.answers = answers;

    // Build Q/A list for scoring
    let qaList = interview.questions
      .map((q, i) => `{"question":"${q}","answer":"${(answers[i] || "").trim()}"}`)
      .join(",");

    const scoringPrompt = `
You are an expert technical interviewer.
Evaluate ALL answers at once.

Return ONLY JSON:
{
  "results":[{"score":0-100,"explanation":"..."}],
  "overallScore":0-100
}

No markdown. No text.

Here is the list:
[${qaList}]
`;

    // Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    const gen = new GoogleGenerativeAI(apiKey);
    const model = gen.getGenerativeModel({ model: "gemini-2.0-flash" });

    const result = await model.generateContent(scoringPrompt);
    let raw = result.response.text();

    let cleaned = raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .replace(/^Here.*?:/i, "")
      .replace(/[\u0000-\u001F]+/g, "")
      .trim();

    let feedbackAI;
    try {
      feedbackAI = JSON.parse(cleaned);
    } catch (err) {
      console.error("PARSE FAILED:", cleaned);
      return res.status(500).json({ error: "Invalid AI format" });
    }

    const perQuestion = interview.questions.map((q, i) => ({
      question: q,
      answer: answers[i] || "",
      score: feedbackAI.results?.[i]?.score ?? 0,
      explanation: feedbackAI.results?.[i]?.explanation || "No explanation"
    }));

    const overallScore = feedbackAI.overallScore ?? 0;

    // 🌟 DETAILED REPORT PROMPT
    const detailedPrompt = `
You are an expert technical hiring manager.

Using the following interview data:
Questions & Answers:
${JSON.stringify(perQuestion, null, 2)}

Overall Score: ${overallScore}

Generate a PROFESSIONAL final interview report in plain text ONLY.

Include these sections clearly:

1. **Overall Summary**  
2. **Strengths**  
3. **Weaknesses**  
4. **Areas of Improvement**  
5. **Technical Skill Evaluation**  
6. **Communication & Explanation Quality**  
7. **Final Recommendation (Hire / Good Fit / Needs Improvement / Not a Fit)**

Do NOT return JSON.  
Do NOT add markdown formatting (no **, no ##).  
Return ONLY clean readable paragraphs.
`;

    // Generate detailed report
    const reportRes = await model.generateContent(detailedPrompt);
    let detailedReport = reportRes.response.text().trim();

    // Remove markdown if any slipped in
    detailedReport = detailedReport
      .replace(/[*#_`]/g, "")
      .trim();
      console.log("DETAILED REPORT:", detailedReport);
    // Save everything
    interview.feedback = {
      perQuestion,
      overallScore,
      detailedReport
    };

    interview.status = "completed";

    interview.markModified("feedback");
    interview.markModified("answers");

    await interview.save();

    return res.json({ feedback: interview.feedback });

  } catch (err) {
    console.error("Save-answers error:", err);
    return res.status(500).json({ error: "Save failed" });
  }
});




export default router;
