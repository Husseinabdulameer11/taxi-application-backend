require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

const authRoutes = require('./src/routes/auth');
const rideRoutes = require('./src/routes/rides');
const userRoutes = require('./src/routes/users');
const paymentRoutes = require('./src/routes/payments');

const app = express();
app.use(cors());
app.use(bodyParser.json());
// Stripe for webhook verification in the /webhook endpoint
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const PORT = process.env.PORT || 4000;

// Create HTTP server and attach Socket.IO
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });

// Expose io and driver socket map to routes via app locals
app.set('io', io);
// driverSocketMap and onlineDrivers are defined below; we'll also expose them after they exist

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/users', userRoutes);
app.use('/api/payment', paymentRoutes);

app.get('/', (req, res) => res.send({ ok: true }));

// Optional REST endpoint to get nearby drivers (useful for quick testing)
app.get('/api/drivers/nearby', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const radiusKm = parseFloat(req.query.radiusKm) || 5;
  if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: 'lat and lon required' });
  const nearby = {};
  for (const [driverId, loc] of Object.entries(driverLocations)) {
    const dist = getDistanceKm(lat, lon, loc.latitude, loc.longitude);
    if (dist <= radiusKm) nearby[driverId] = { latitude: loc.latitude, longitude: loc.longitude, distanceKm: dist };
  }
  res.json(nearby);
});


// In-memory stores (for demo/testing). For production, use a DB or Redis.
const driverLocations = {}; // { driverId: { latitude, longitude, updatedAt } }
const activeRides = {}; // { rideId: { driverId, riderId, status } }
const onlineDrivers = new Set(); // Track currently logged-in (connected) drivers
const driverSocketMap = {}; // Map driverId -> socket.id

// also expose driverSocketMap and onlineDrivers so routes can access them
app.set('driverSocketMap', driverSocketMap);
app.set('onlineDrivers', onlineDrivers);

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);


  // Driver must identify themselves as online
  socket.on('driverOnline', (payload) => {
    // payload: { driverId }
    const { driverId } = payload || {};
    if (!driverId) return;
    onlineDrivers.add(driverId);
    driverSocketMap[driverId] = socket.id;
    console.log(`Driver online: ${driverId}`);
  });

  // Driver sends periodic location updates
  socket.on('driverLocationUpdate', (payload) => {
    // payload: { driverId, latitude, longitude }
    const { driverId, latitude, longitude } = payload || {};
    if (!driverId || !latitude || !longitude) return;
    if (!onlineDrivers.has(driverId)) return; // Only allow if driver is online
    driverLocations[driverId] = { latitude, longitude, updatedAt: Date.now() };
    console.log(`driverLocationUpdate: ${driverId} -> ${latitude},${longitude}`);

    // If the driver has an active ride, notify the rider room
    for (const rideId in activeRides) {
      const ride = activeRides[rideId];
      if (ride.driverId === driverId && ride.status === 'in_progress') {
        // send to the rider's socket room for this ride
        io.to(`ride_${rideId}`).emit('carLocationUpdate', { driverId, latitude, longitude });
      }
    }
  });

  // Rider requests nearby drivers within radiusKm
  socket.on('requestNearbyDrivers', (payload) => {
    // payload: { latitude, longitude, radiusKm }
    const { latitude, longitude, radiusKm = 5 } = payload || {};
    if (!latitude || !longitude) return;
    const nearby = {};
    for (const [driverId, loc] of Object.entries(driverLocations)) {
      if (!onlineDrivers.has(driverId)) continue; // Only show online drivers
      const dist = getDistanceKm(latitude, longitude, loc.latitude, loc.longitude);
      if (dist <= radiusKm) nearby[driverId] = { latitude: loc.latitude, longitude: loc.longitude, distanceKm: dist };
    }
    // Send only to the requesting socket
    socket.emit('driversUpdate', nearby);
  });

  // Rider joins ride room to receive car location updates for a specific ride
  socket.on('joinRide', (payload) => {
    // payload: { rideId }
    const { rideId } = payload || {};
    if (!rideId) return;
    socket.join(`ride_${rideId}`);
    // Optionally send current driver location
    const ride = activeRides[rideId];
    if (ride && driverLocations[ride.driverId]) {
      socket.emit('carLocationUpdate', { driverId: ride.driverId, ...driverLocations[ride.driverId] });
    }
  });

  // Start a ride (booking completed)
  socket.on('startRide', (payload) => {
    // payload: { rideId, driverId, riderId }
    const { rideId, driverId, riderId } = payload || {};
    if (!rideId || !driverId || !riderId) return;
    activeRides[rideId] = { driverId, riderId, status: 'in_progress' };
    // Optionally notify the rider and driver
    io.to(`ride_${rideId}`).emit('rideStarted', { rideId, driverId, riderId });
  });

  socket.on('endRide', (payload) => {
    const { rideId } = payload || {};
    if (!rideId) return;
    if (activeRides[rideId]) activeRides[rideId].status = 'completed';
    io.to(`ride_${rideId}`).emit('rideEnded', { rideId });
  });

  socket.on('disconnect', () => {
    // Remove driver from onlineDrivers and driverLocations if present
    for (const [driverId, sockId] of Object.entries(driverSocketMap)) {
      if (sockId === socket.id) {
        onlineDrivers.delete(driverId);
        delete driverLocations[driverId];
        delete driverSocketMap[driverId];
        console.log(`Driver offline: ${driverId}`);
      }
    }
  });

  // Driver accepts a pending ride request
  socket.on('acceptRide', async (payload) => {
    try {
      const { rideId } = payload || {};
      if (!rideId) return;
      // find driverId from socket map by reverse lookup
      let driverId = null;
      for (const [dId, sId] of Object.entries(driverSocketMap)) {
        if (sId === socket.id) { driverId = dId; break; }
      }
      if (!driverId) return;
      const RideModel = require('./src/models/Ride');
      const ride = await RideModel.findById(rideId);
      if (!ride) return;
      // Only accept if pending and assigned to this driver
      if (ride.status !== 'pending' || ride.assignedDriver?.toString() !== driverId.toString()) return;
      ride.status = 'accepted';
      await ride.save();
      // notify the rider (if connected to ride room)
      io.to(`ride_${rideId}`).emit('rideAccepted', { rideId, driverId });
      console.log(`Driver ${driverId} accepted ride ${rideId}`);
    } catch (err) {
      console.error('acceptRide handler error', err);
    }
  });

  // Driver declines a pending ride request
  socket.on('declineRide', async (payload) => {
    try {
      const { rideId } = payload || {};
      if (!rideId) return;
      let driverId = null;
      for (const [dId, sId] of Object.entries(driverSocketMap)) {
        if (sId === socket.id) { driverId = dId; break; }
      }
      if (!driverId) return;
      const RideModel = require('./src/models/Ride');
      const ride = await RideModel.findById(rideId);
      if (!ride) return;
      if (ride.status !== 'pending') return;
      // mark as open and add to declinedDrivers
      ride.status = 'open';
      if (!ride.declinedDrivers) ride.declinedDrivers = [];
      if (!ride.declinedDrivers.find(d => d.toString() === driverId.toString())) {
        ride.declinedDrivers.push(driverId);
      }
      ride.assignedDriver = null;
      await ride.save();
      // notify rider and driver
      io.to(`ride_${rideId}`).emit('rideDeclined', { rideId, driverId });
      io.to(socket.id).emit('rideDeclineAck', { rideId });
      console.log(`Driver ${driverId} declined ride ${rideId}`);
    } catch (err) {
      console.error('declineRide handler error', err);
    }
  });
});

// Debug endpoint to inspect in-memory driver locations
app.get('/api/debug/driverLocations', (req, res) => {
  res.json(driverLocations);
});

// Stripe webhook endpoint (use raw body parser for signature verification)
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event types you care about
  switch (event.type) {
    case 'payment_intent.succeeded':
      // You should lookup the ride by event.data.object.metadata.rideId and mark paid
      (async () => {
        try {
          const pi = event.data.object;
          const rideId = pi.metadata && pi.metadata.rideId;
          if (rideId) {
            const Ride = require('./src/models/Ride');
            const ride = await Ride.findById(rideId);
            if (ride) {
              ride.paymentStatus = 'paid';
              ride.transactionId = pi.id;
              await ride.save();
              console.log(`Ride ${rideId} marked as paid (pi ${pi.id})`);
            }
          }
        } catch (e) {
          console.error('Error handling payment_intent.succeeded webhook', e);
        }
      })();
      break;
    case 'payment_intent.payment_failed':
      // handle failed payments if desired
      break;
    default:
      // Unexpected event type
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a response to acknowledge receipt of the event
  res.json({ received: true });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
