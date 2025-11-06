const express = require('express');
const router = express.Router();
const Ride = require('../models/Ride');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { sendMail } = require('../utils/email');
const { calculateRidePrice } = require('../utils/pricing');

// Helper function to calculate distance between two coordinates
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

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

// Get price estimate for a ride
router.post('/estimate-price', auth, async (req, res) => {
  try {
    const {
      driverId,
      pickupLocation,
      destinationLocation,
      waitingMinutes
    } = req.body;

    if (!driverId) return res.status(400).json({ error: 'driverId is required' });
    if (!pickupLocation || !pickupLocation.coordinates || pickupLocation.coordinates.length !== 2) {
      return res.status(400).json({ error: 'Valid pickupLocation is required' });
    }

    // Fetch driver to get car type and location
    const driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver') {
      return res.status(400).json({ error: 'Invalid driver' });
    }

    const pickupCoords = pickupLocation.coordinates; // [lng, lat]
    
    // Get driver's real-time location from in-memory socket data (not database)
    const driverLocations = req.app.get('driverLocations') || {};
    const driverLiveLocation = driverLocations[driverId];
    
    // Calculate driver to pickup distance
    let driverToPickupKm = 0;
    if (driverLiveLocation && driverLiveLocation.latitude != null && driverLiveLocation.longitude != null) {
      // Use real-time socket location
      const { latitude, longitude } = driverLiveLocation;
      driverToPickupKm = getDistanceKm(latitude, longitude, pickupCoords[1], pickupCoords[0]);
      console.log(`[estimate-price] Driver ${driverId} real-time location: [${longitude}, ${latitude}]`);
      console.log(`[estimate-price] Pickup location: [${pickupCoords[0]}, ${pickupCoords[1]}]`);
      console.log(`[estimate-price] Driver to pickup distance: ${driverToPickupKm.toFixed(2)} km`);
    } else {
      console.log(`[estimate-price] ⚠️ Driver ${driverId} has no real-time location data! They may be offline.`);
      return res.status(400).json({ error: 'Driver location not available. Driver may be offline.' });
    }
    
    // Calculate pickup to destination distance
    let tripDistanceKm = 5; // Default estimate
    if (destinationLocation && destinationLocation.coordinates && destinationLocation.coordinates.length === 2) {
      const destCoords = destinationLocation.coordinates;
      tripDistanceKm = getDistanceKm(pickupCoords[1], pickupCoords[0], destCoords[1], destCoords[0]);
    }
    
    // Calculate price
    const pricing = calculateRidePrice(tripDistanceKm, driver.carType || 'standard', {
      driverToPickupKm,
      waitingMinutes: waitingMinutes || 0
    });
    
    res.json({ 
      estimate: pricing,
      breakdown: {
        baseFare: `${pricing.baseFare / 100} NOK`,
        tripDistance: `${pricing.tripDistanceKm} km (${pricing.tripDistancePrice / 100} NOK)`,
        driverToPickup: `${pricing.driverToPickupKm} km (${pricing.driverToPickupPrice / 100} NOK)`,
        waitingTime: pricing.waitingMinutes > 0 ? `${pricing.waitingMinutes} min (${pricing.waitingTimePrice / 100} NOK)` : 'None',
        total: `${pricing.totalPriceNOK} NOK`
      }
    });
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

// Driver ends/completes a ride
router.post('/:id/end', auth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') return res.status(403).json({ error: 'Only drivers can end rides' });
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    if (ride.assignedDriver.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'You are not assigned to this ride' });
    }
    if (ride.status !== 'in_progress' && ride.status !== 'accepted') {
      return res.status(400).json({ error: 'Ride is not in progress' });
    }
    
    ride.status = 'completed';
    await ride.save();

    // Emit socket event to notify the rider
    const io = req.app.get('io');
    if (io) {
      io.to(`rider_${ride.rider.toString()}`).emit('rideEnded', { rideId: ride._id });
    }

    res.json({ ride });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rider cancels a pending ride
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    if (req.user.role !== 'rider') return res.status(403).json({ error: 'Only riders can cancel rides' });
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    if (ride.rider.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'You can only cancel your own rides' });
    }
    if (ride.status !== 'pending') {
      return res.status(400).json({ error: 'Ride cannot be cancelled at this stage' });
    }
    
    ride.status = 'cancelled';
    await ride.save();

    // Emit socket event to notify the driver (if assigned)
    const io = req.app.get('io');
    if (io && ride.assignedDriver) {
      io.to(`driver_${ride.assignedDriver.toString()}`).emit('rideCancelled', { rideId: ride._id });
    }

    res.json({ ride });
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

    // Fetch driver to get car type
    const driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver') {
      return res.status(400).json({ error: 'Invalid driver' });
    }

    // Calculate distance and price
    let distanceKm = 0;
    let driverToPickupKm = 0;
    let pricing = null;
    
    if (pickupLocation && pickupLocation.coordinates && pickupLocation.coordinates.length === 2) {
      const pickupCoords = pickupLocation.coordinates; // [lng, lat]
      
      // Calculate driver to pickup distance if driver has location
      if (driver.location && driver.location.coordinates && driver.location.coordinates.length === 2) {
        const driverCoords = driver.location.coordinates; // [lng, lat]
        driverToPickupKm = getDistanceKm(driverCoords[1], driverCoords[0], pickupCoords[1], pickupCoords[0]);
      }
      
      // If destination is provided, calculate pickup to destination distance
      if (destinationLocation && destinationLocation.coordinates && destinationLocation.coordinates.length === 2) {
        const destCoords = destinationLocation.coordinates; // [lng, lat]
        distanceKm = getDistanceKm(pickupCoords[1], pickupCoords[0], destCoords[1], destCoords[0]);
      } else {
        // No destination - estimate average trip of 5km
        distanceKm = 5;
      }
      
      // Calculate price based on distances and driver's car type
      pricing = calculateRidePrice(distanceKm, driver.carType || 'standard', {
        driverToPickupKm: driverToPickupKm
      });
    } else {
      // No location data - use minimum fare
      pricing = calculateRidePrice(0, driver.carType || 'standard');
    }

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
      status: 'pending', // pending until driver accepts/declines
      amount: pricing.totalPrice, // Store in øre
      currency: 'nok',
      estimatedDistance: distanceKm
    });
    await ride.save();

    console.log(`Created ride ${ride._id}: ${distanceKm.toFixed(2)}km, ${driver.carType} car, ${pricing.totalPriceNOK} NOK`);

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
        needsBlindSupport: ride.needsBlindSupport,
        estimatedPrice: pricing.totalPriceNOK,
        estimatedDistance: distanceKm.toFixed(2),
        currency: 'NOK'
      };
      
      console.log(`[book-driver] Attempting to emit rideRequest to driver ${driverId}`);
      console.log(`[book-driver] driverSocketMap has driver? ${!!driverSock}, socketId: ${driverSock}`);
      console.log(`[book-driver] Payload:`, JSON.stringify(payload, null, 2));
      
      if (io && driverSock) {
        io.to(driverSock).emit('rideRequest', payload);
        console.log(`[book-driver] ✅ Emitted rideRequest to socket ${driverSock}`);
      } else {
        console.log(`[book-driver] ❌ Cannot emit: io=${!!io}, driverSock=${driverSock}`);
      }

      // Start a 60s timer; if driver doesn't accept/decline, mark as open and remove assigned driver
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
      }, 60000);
    } catch (emitErr) {
      console.error('Error emitting rideRequest', emitErr);
    }

    res.json({ ride });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
