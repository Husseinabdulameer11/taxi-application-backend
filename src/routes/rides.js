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
    const {
      pickupAddress,
      pickupLocation,
      destinationAddress,
      destinationLocation,
      phone,
      passengerCount,
      needsBabySeat,
      needsHandicapSupport,
      needsBlindSupport
    } = req.body;
    const ride = new Ride({
      rider: req.user._id,
      pickupAddress,
      pickupLocation,
      destinationAddress,
      destinationLocation,
      phone,
      passengerCount,
      needsBabySeat,
      needsHandicapSupport,
      needsBlindSupport
    });
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

// Rider books a specific driver directly. Creates a ride and assigns the driver.
router.post('/book-driver', auth, async (req, res) => {
  try {
    if (req.user.role !== 'rider') return res.status(403).json({ error: 'Only riders can book drivers' });
    const {
      driverId,
      pickupAddress,
      pickupLocation,
      destinationAddress,
      destinationLocation,
      phone,
      passengerCount,
      needsBabySeat,
      needsHandicapSupport,
      needsBlindSupport
    } = req.body;

    if (!driverId) return res.status(400).json({ error: 'driverId is required' });

    const ride = new Ride({
      rider: req.user._id,
      pickupAddress,
      pickupLocation,
      destinationAddress,
      destinationLocation,
      phone,
      passengerCount,
      needsBabySeat,
      needsHandicapSupport,
      needsBlindSupport,
      assignedDriver: driverId,
      status: 'pending' // pending until driver accepts/declines
    });
    await ride.save();

    // Notify the rider via email about booking request (we'll update once driver accepts)
    try {
      const rider = await User.findById(ride.rider);
      if (rider && rider.email) {
        const driver = await User.findById(driverId);
        const driverInfo = `${driver?.name || 'Driver'} - ${driver?.phone || 'No phone'}`;
        const rideUrl = `${process.env.FRONTEND_URL}/ride/${ride._id}`;
        await sendMail({
          to: rider.email,
          subject: 'Your driver has been booked',
          html: `<p>Your ride has been booked with ${driverInfo}.</p><p>View details: <a href="${rideUrl}">Open ride</a></p>`
        });
      }
    } catch (mailErr) {
      console.error('Failed to send booking email:', mailErr);
    }

    // Emit a rideRequest socket event to the driver if they're online
    try {
      const io = req.app.get('io');
      const driverSocketMap = req.app.get('driverSocketMap');
      const driverSock = driverSocketMap && driverSocketMap[driverId];
      const riderPublic = await User.findById(ride.rider).select('name email avatarUrl');
      const payload = {
        rideId: ride._id,
        rider: { id: riderPublic?._id, name: riderPublic?.name, email: riderPublic?.email, avatarUrl: riderPublic?.avatarUrl },
        pickupAddress: ride.pickupAddress,
        pickupLocation: ride.pickupLocation,
        passengerCount: ride.passengerCount,
        needsBabySeat: ride.needsBabySeat,
        needsHandicapSupport: ride.needsHandicapSupport,
        needsBlindSupport: ride.needsBlindSupport
      };
      if (io && driverSock) {
        io.to(driverSock).emit('rideRequest', payload);
      }

      // Start a 30s timer; if driver doesn't accept/decline, mark as open and remove assigned driver
      setTimeout(async () => {
        try {
          const fresh = await Ride.findById(ride._id);
          if (fresh && fresh.status === 'pending') {
            // mark as open again and add driver to declinedDrivers
            fresh.status = 'open';
            if (!fresh.declinedDrivers) fresh.declinedDrivers = [];
            if (!fresh.declinedDrivers.find(d => d.toString() === driverId.toString())) {
              fresh.declinedDrivers.push(driverId);
            }
            fresh.assignedDriver = null;
            await fresh.save();
            // notify rider and driver about timeout/decline
            if (io && driverSock) {
              io.to(driverSock).emit('rideRequestTimeout', { rideId: fresh._id });
            }
            // Notify rider via socket room if connected
            io.to(`ride_${fresh._id}`).emit('rideDeclined', { rideId: fresh._id, driverId: driverId });
          }
        } catch (timeoutErr) {
          console.error('Error handling ride request timeout', timeoutErr);
        }
      }, 30000);
    } catch (emitErr) {
      console.error('Error emitting rideRequest', emitErr);
    }

    res.json({ ride });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
