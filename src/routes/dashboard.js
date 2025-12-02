import express from 'express';
import Interview from '../models/Interview.js';
const router = express.Router();

function ensureAuth(req,res,next){ if(!req.session.user) return res.redirect('/auth/login'); next(); }

router.get('/', ensureAuth, async (req,res) => {
  const list = await Interview.find({ userId: req.session.user.id }).sort({ createdAt: -1 });
  res.render('dashboard', { interviews: list });
});

// if interview not completed -> render attempt page, else render result
router.get('/:id', ensureAuth, async (req,res) => {
  const it = await Interview.findById(req.params.id);
  if (!it) return res.redirect('/dashboard');
  if (it.status !== 'completed') {
    return res.render('attempt', { interviewId: it._id, questions: it.questions, answers: it.answers || [], initialTranscript: it.transcript || [], currentIndex: it.currentIndex || 0, silenceTimeout: parseInt(process.env.SILENCE_TIMEOUT_MS || '5000') });
  }
  return res.render('result', { questions: it.questions, answers: it.answers || [], feedback: it.feedback || null, detailedReport: it.detailedReport || '' });
});

export default router;
