const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const User = require('../models/User');
const { sendMail } = require('../utils/email');

// Register (public)
// NOTE: historically this endpoint only created riders. We now accept a `role` in the
// request body so the client can create drivers as well when desired. Validate the
// role to avoid invalid values.
router.post('/register', async (req, res) => {
  const { name, email, password, phone } = req.body;
  let { role } = req.body;
  if (!role) role = 'rider';
  // normalize and validate
  role = String(role).toLowerCase();
  if (!['rider', 'driver'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already exists' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = new User({ name, email, passwordHash, phone, role });
    await user.save();

    // generate verification token (simple token stored in jwt for demo)
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  // Email verification disabled for now
  // const verifyUrl = `${process.env.FRONTEND_URL}/verify?token=${token}`;
  // await sendMail({ to: email, subject: 'Verify your account', html: `<p>Please verify your account by clicking <a href="${verifyUrl}">here</a></p>` });

  // Return created user's info so frontend can navigate to the image upload step
  res.json({ ok: true, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Password reset request
router.post('/reset-request', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  try {
    const user = await User.findOne({ email });
    if (!user) return res.json({ ok: true }); // don't reveal
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const resetUrl = `${process.env.FRONTEND_URL}/reset?token=${token}`;
    await sendMail({ to: email, subject: 'Reset password', html: `<p>Reset your password by clicking <a href="${resetUrl}">here</a></p>` });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Password reset
router.post('/reset', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(400).json({ error: 'Invalid token' });
    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;