import express from 'express';
import bcrypt from 'bcrypt';
import User from '../models/User.js';
const router = express.Router();

router.get('/signup', (req,res) => res.render('signup'));
router.post('/signup', async (req,res) => {
  const { name, email, password } = req.body;
  try {
    const exists = await User.findOne({ email });
    if (exists) return res.render('signup', { error: 'Email already registered', name, email });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash: hash });
    req.session.user = { id: user._id, name: user.name, email: user.email };
    res.redirect('/dashboard');
  } catch (e) {
    console.error(e);
    res.render('signup', { error: 'Signup failed' });
  }
});

router.get('/login', (req,res) => res.render('login'));
router.post('/login', async (req,res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.render('login', { error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.render('login', { error: 'Invalid credentials' });
    req.session.user = { id: user._id, name: user.name, email: user.email };
    res.redirect('/dashboard');
  } catch (e) {
    console.error(e);
    res.render('login', { error: 'Login error' });
  }
});

router.post('/logout', (req,res) => {
  req.session.destroy(()=> res.redirect('/'));
});

export default router;
