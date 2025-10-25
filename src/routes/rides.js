const express = require('express');
const router = express.Router();
const Ride = require('../models/Ride');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { sendMail } = require('../utils/email');

// Create a ride (rider creates)
router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'rider') return res.status(403).json({ error: 'Only riders can create rides' });
    const { pickupAddress, pickupLocation, destinationAddress, destinationLocation, phone } = req.body;
    const ride = new Ride({ rider: req.user._id, pickupAddress, pickupLocation, destinationAddress, destinationLocation, phone });
    await ride.save();
    res.json({ ride });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List available rides for drivers with optional distance filter
router.get('/available', auth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can view available rides' });
    const { lng, lat, maxDistanceMeters } = req.query;
  // Exclude rides that this driver has already declined
  let query = { status: 'open', $or: [ { declinedDrivers: { $exists: false } }, { declinedDrivers: { $nin: [req.user._id] } } ] };
    if (lng && lat) {
      query['pickupLocation'] = {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: maxDistanceMeters ? parseInt(maxDistanceMeters) : 50000
        }
      };
    }
  const rides = await Ride.find(query).populate('rider', 'name phone location');
    res.json({ rides });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get ride details
router.get('/:id', auth, async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id).populate('rider', 'name phone location email');
    if (!ride) return res.status(404).json({ error: 'Not found' });
    res.json({ ride });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Driver accepts a ride
router.post('/:id/accept', auth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can accept rides' });
    const ride = await Ride.findById(req.params.id);
    if (!ride || ride.status !== 'open') return res.status(400).json({ error: 'Ride not available' });
    ride.status = 'accepted';
    ride.assignedDriver = req.user._id;
    await ride.save();

    // Notify the rider via email
    try {
      const rider = await User.findById(ride.rider);
      if (rider && rider.email) {
        const driverInfo = `${req.user.name || 'Driver'} - ${req.user.phone || 'No phone'}`;
        const rideUrl = `${process.env.FRONTEND_URL}/ride/${ride._id}`;
        await sendMail({
          to: rider.email,
          subject: 'Your ride was accepted',
          html: `<p>Your ride has been accepted by ${driverInfo}.</p><p>View details: <a href="${rideUrl}">Open ride</a></p>`
        });
      }
    } catch (mailErr) {
      console.error('Failed to send acceptance email:', mailErr);
    }
    res.json({ ride });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Driver declines a ride (it stays open for others)
router.post('/:id/decline', auth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can decline rides' });
    const ride = await Ride.findById(req.params.id);
    if (!ride || ride.status !== 'open') return res.status(400).json({ error: 'Ride not available' });
    // Add driver to declinedDrivers if not already present
    if (!ride.declinedDrivers) ride.declinedDrivers = [];
    if (!ride.declinedDrivers.find(d => d.toString() === req.user._id.toString())) {
      ride.declinedDrivers.push(req.user._id);
      await ride.save();
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;