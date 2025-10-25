const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

const User = require('../models/User');
const { uploadBuffer, getSignedUploadUrl } = require('../utils/gcs');

// Multer memory storage to get file buffer
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit

// Get user public info by id
// Get public users list (optional filter by role)
// Example: GET /api/users?role=driver
router.get('/', async (req, res) => {
  try {
    const { role } = req.query || {};
    const query = {};
    if (role) query.role = role;
    const users = await User.find(query).lean();
    const publicUsers = users.map(u => ({ id: u._id, name: u.name, email: u.email, phone: u.phone, role: u.role, location: u.location, avatarUrl: u.avatarUrl }));
    res.json(publicUsers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user public info by id
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Return public fields only
    res.json({ id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, location: user.location, avatarUrl: user.avatarUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Upload avatar image for user. Expects multipart/form-data with field 'image'
router.post('/:id/avatar', upload.single('image'), async (req, res) => {
  try {
    const userId = req.params.id;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Build destination path in GCS
    const ext = path.extname(file.originalname) || '';
    const dest = `users/${userId}/${Date.now()}${ext}`;

    const publicUrl = await uploadBuffer(file.buffer, dest, file.mimetype);

    // Save URL to user
    user.avatarUrl = publicUrl;
    await user.save();

    res.json({ ok: true, avatarUrl: publicUrl });
  } catch (err) {
    console.error('avatar upload error', err);
    res.status(500).json({ error: err.message });
  }
});

// Issue a signed upload URL so the client can upload directly to GCS (frontend -> GCS)
// Returns { uploadUrl, publicUrl, objectName }
router.post('/:id/avatar/url', async (req, res) => {
  try {
    const userId = req.params.id;
    const { filename = 'avatar.jpg', contentType = 'image/jpeg' } = req.body || {};

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const ext = path.extname(filename) || (contentType === 'image/png' ? '.png' : '.jpg');
    const objectName = `users/${userId}/${Date.now()}${ext}`;

    const { uploadUrl, publicUrl } = await getSignedUploadUrl(objectName, contentType);

    res.json({ ok: true, uploadUrl, publicUrl, objectName });
  } catch (err) {
    console.error('signed url error', err);
    res.status(500).json({ error: err.message });
  }
});

// Confirm the uploaded object and save the public URL to the user's avatarUrl
// Body: { objectName, publicUrl }
router.post('/:id/avatar/confirm', async (req, res) => {
  try {
    const userId = req.params.id;
    const { objectName, publicUrl } = req.body || {};
    if (!objectName || !publicUrl) return res.status(400).json({ error: 'Missing objectName or publicUrl' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.avatarUrl = publicUrl;
    await user.save();

    res.json({ ok: true, avatarUrl: publicUrl });
  } catch (err) {
    console.error('confirm avatar error', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
