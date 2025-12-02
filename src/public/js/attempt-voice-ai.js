(function () {
  if (typeof interviewId === "undefined" || typeof questions === "undefined")
    return;

  const SILENCE_TIMEOUT_MS =
    typeof silenceTimeout !== "undefined" ? silenceTimeout : 5000;

  let current = currentIndex || 0;
  let transcript = initialTranscript || [];
  let answersLocal = answers || [];

  let isListening = false;
  let recog = null;
  let silenceTimer = null;
  let lastUtterance = ""; // 🔥 NEW FIX – store only final STT result

  // DOM elements
  const qNumber = document.getElementById("qNumber");
  const qText = document.getElementById("qText");
  const transcriptBox = document.getElementById("transcriptBox");
  const answerText = document.getElementById("answerText");
  const startBtn = document.getElementById("startListen");
  const stopBtn = document.getElementById("stopListen");
  const askDoubtBtn = document.getElementById("askDoubt");
  const reAnswer = document.getElementById("reAnswer");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const finishBtn = document.getElementById("finishBtn");
  const camBox = document.getElementById("camBox");
  const doubtBox = document.getElementById("doubtBox");

  // -----------------------------
  // UI Rendering
  // -----------------------------
  function renderUI() {
    qNumber.textContent = `Question ${current + 1} of ${questions.length}`;
    qText.textContent = questions[current];
    answerText.textContent = answersLocal[current] || "No answer yet";

    transcriptBox.innerHTML = transcript
      .map(
        (t) =>
          `<div class="text-sm"><strong>${t.who}:</strong> ${t.text}</div>`
      )
      .join("");

    finishBtn.classList.toggle("hidden", current !== questions.length - 1);
  }

  renderUI();

  // -----------------------------
  // Camera
  // -----------------------------
  async function startCam() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      const v = document.createElement("video");
      v.autoplay = true;
      v.playsInline = true;
      v.muted = true;
      v.srcObject = s;
      v.style.width = "100%";
      v.style.height = "100%";

      camBox.innerHTML = "";
      camBox.appendChild(v);
    } catch (e) {
      camBox.textContent = "Camera unavailable";
    }
  }
  startCam();

  // -----------------------------
  // Text-to-Speech
  // -----------------------------
  function speak(text, onend) {
    if (!("speechSynthesis" in window)) {
      onend && onend();
      return;
    }

    const u = new SpeechSynthesisUtterance(text);
    u.onend = onend;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // -----------------------------
  // SEND to server (Gemini)
  // -----------------------------
  async function sendToServerAndHandle(utterance) {
    try {
      const payload = {
        interviewId,
        questionIndex: current,
        userUtterance: utterance,
        transcript,
      };

      const res = await fetch("/interview/voice-respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error("voice-respond failed");
        return;
      }

      const j = await res.json();

      // Store AI reply in transcript
      transcript.push({
        who: "ai",
        text: j.aiReply,
        ts: new Date().toISOString(),
      });

      renderUI();

      // Speak AI reply → then next question → then auto listen
      speak(j.aiReply, () => {
        if (j.endInterview) {
          window.location.href = "/dashboard/" + interviewId;
          return;
        }

        if (j.nextQuestion) {
          if (!questions[current + 1]) questions[current + 1] = j.nextQuestion;
        }

        if (current < questions.length - 1) {
          current++;
          renderUI();

          speak(questions[current], () => {
            startContinuousListen();
          });
        } else {
          window.location.href = "/dashboard/" + interviewId;
        }
      });
    } catch (e) {
      console.error("sendToServerAndHandle error", e);
    }
  }

  // -----------------------------
  // Continuous STT Listening
  // -----------------------------
  function startContinuousListen() {
    if (isListening) return;

    isListening = true;
    lastUtterance = ""; // RESET for new answer
    startBtn.disabled = true;
    stopBtn.disabled = false;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Use Chrome for best experience");
      return;
    }

    recog = new SR();
    recog.lang = "en-US";
    recog.interimResults = true; // 🔥 Allow interim, but we only use FINAL
    recog.maxAlternatives = 1;

    // -----------------------------
    // FIXED onresult
    // -----------------------------
    recog.onresult = (e) => {
      const result = e.results[e.results.length - 1];

      // Ignore partial responses
      if (!result.isFinal) return;

      const text = result[0].transcript;

      lastUtterance = text;

      answersLocal[current] = text;
      answerText.textContent = text;

      transcript.push({
        who: "user",
        text,
        ts: new Date().toISOString(),
      });

      renderUI();

      if (silenceTimer) clearTimeout(silenceTimer);

      silenceTimer = setTimeout(() => {
        stopContinuousListen();
        sendToServerAndHandle(lastUtterance);
        lastUtterance = "";
      }, SILENCE_TIMEOUT_MS);
    };

    // Auto restart on end
    recog.onend = () => {
      if (isListening) {
        try {
          recog.start();
        } catch (err) {
          console.error("restart failed", err);
        }
      }
    };

    recog.onerror = (e) => {
      console.warn("rec error", e);
    };

    try {
      recog.start();
    } catch (e) {
      console.error("rec start failed", e);
    }
  }

  // -----------------------------
  function stopContinuousListen() {
    isListening = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;

    try {
      recog && recog.stop();
    } catch (e) {}

    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  // -----------------------------
  // UI Button Handlers
  // -----------------------------
  startBtn.addEventListener("click", () => {
    speak(questions[current], () => {
      startContinuousListen();
    });
  });

  stopBtn.addEventListener("click", stopContinuousListen);

  reAnswer.addEventListener("click", () => {
    answersLocal[current] = "";
    answerText.textContent = "No answer yet";
  });

  prevBtn.addEventListener("click", () => {
    if (current > 0) {
      current--;
      renderUI();
    }
  });

  nextBtn.addEventListener("click", () => {
    if (current < questions.length - 1) {
      current++;
      renderUI();
    }
  });

  // -----------------------------
  askDoubtBtn.addEventListener("click", async () => {
    askDoubtBtn.disabled = true;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Use Chrome");
      askDoubtBtn.disabled = false;
      return;
    }

    const r = new SR();
    r.lang = "en-US";
    r.interimResults = false;
    r.maxAlternatives = 1;

    r.onresult = async (e) => {
      const text = e.results[0][0].transcript;

      try {
        const res = await fetch("/interview/doubt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: questions[current],
            doubt: text,
          }),
        });

        const data = await res.json();
        doubtBox.textContent = data.answer || "No answer";
        speak(data.answer || "No answer");
      } catch (err) {
        doubtBox.textContent = "Doubt failed";
      }

      askDoubtBtn.disabled = false;
    };

    r.onerror = () => {
      askDoubtBtn.disabled = false;
    };

    r.start();
  });

  // -----------------------------
  finishBtn.addEventListener("click", async () => {
    stopContinuousListen();

    try {
      await fetch("/interview/save-answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId, answers: answersLocal }),
      });
    } catch (e) {}

    window.location.href = "/dashboard/" + interviewId;
  });
})();
