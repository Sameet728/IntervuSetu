import mongoose from "mongoose";

// Per-question feedback schema
const PerQuestionSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    answer: { type: String, default: "" },
    score: { type: Number, default: 0 },     // 0-100
    explanation: { type: String, default: "" }
  },
  { _id: false }
);

// Full feedback schema
const FeedbackSchema = new mongoose.Schema(
  {
    perQuestion: { type: [PerQuestionSchema], default: [] },
    overallScore: { type: Number, default: 0 },
    detailedReport: { type: String, default: "" }
  },
  { _id: false }
);

const InterviewSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

  // NEW FIELDS for structured interview generation
  title: { type: String, default: "" },           // ex: "SDE"
  type: { type: String, default: "" },            // ex: "Technical"
  skills: { type: [String], default: [] },        // ex: ["Java", "DSA"]
  experienceLevel: { type: String, default: "" }, // ex: "Mid"
  duration: { type: Number, default: 0 },         // minutes

  // OLD fields (still kept for compatibility)
  role: { type: String, default: "" },
  difficulty: { type: String, default: "" },

  questions: { type: [String], default: [] },
  answers: { type: [String], default: [] },

  transcript: { type: Array, default: [] },
  currentIndex: { type: Number, default: 0 },

  status: {
    type: String,
    enum: ["generated", "in_progress", "completed"],
    default: "generated",
  },

  // FIXED + CLEAN FEEDBACK STRUCTURE
  feedback: { type: FeedbackSchema, default: () => ({}) },

  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Interview", InterviewSchema);
