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
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const PORT = process.env.PORT || 4000;

const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/users', userRoutes);
app.use('/api/payment', paymentRoutes);

app.get('/', (req, res) => res.send({ ok: true }));

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



const driverLocations = {}; 
const activeRides = {}; 
const onlineDrivers = new Set(); 
const driverSocketMap = {};

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);


  
  socket.on('driverOnline', (payload) => {
    const { driverId } = payload || {};
    if (!driverId) return;
    onlineDrivers.add(driverId);
    driverSocketMap[driverId] = socket.id;
    console.log(`Driver online: ${driverId}`);
  });


  socket.on('driverLocationUpdate', (payload) => {
    
    const { driverId, latitude, longitude } = payload || {};
    if (!driverId || !latitude || !longitude) return;
    if (!onlineDrivers.has(driverId)) return; // Only allow if driver is online
    driverLocations[driverId] = { latitude, longitude, updatedAt: Date.now() };
    console.log(`driverLocationUpdate: ${driverId} -> ${latitude},${longitude}`);

   
    for (const rideId in activeRides) {
      const ride = activeRides[rideId];
      if (ride.driverId === driverId && ride.status === 'in_progress') {
     
        io.to(`ride_${rideId}`).emit('carLocationUpdate', { driverId, latitude, longitude });
      }
    }
  });


  socket.on('requestNearbyDrivers', (payload) => {
    
    const { latitude, longitude, radiusKm = 5 } = payload || {};
    if (!latitude || !longitude) return;
    const nearby = {};
    for (const [driverId, loc] of Object.entries(driverLocations)) {
      if (!onlineDrivers.has(driverId)) continue; 
      const dist = getDistanceKm(latitude, longitude, loc.latitude, loc.longitude);
      if (dist <= radiusKm) nearby[driverId] = { latitude: loc.latitude, longitude: loc.longitude, distanceKm: dist };
    }
   
    socket.emit('driversUpdate', nearby);
  });

  
  socket.on('joinRide', (payload) => {
    
    const { rideId } = payload || {};
    if (!rideId) return;
    socket.join(`ride_${rideId}`);
    
    const ride = activeRides[rideId];
    if (ride && driverLocations[ride.driverId]) {
      socket.emit('carLocationUpdate', { driverId: ride.driverId, ...driverLocations[ride.driverId] });
    }
  });

  
  socket.on('startRide', (payload) => {
    
    const { rideId, driverId, riderId } = payload || {};
    if (!rideId || !driverId || !riderId) return;
    activeRides[rideId] = { driverId, riderId, status: 'in_progress' };
    
    io.to(`ride_${rideId}`).emit('rideStarted', { rideId, driverId, riderId });
  });

  socket.on('endRide', (payload) => {
    const { rideId } = payload || {};
    if (!rideId) return;
    if (activeRides[rideId]) activeRides[rideId].status = 'completed';
    io.to(`ride_${rideId}`).emit('rideEnded', { rideId });
  });

  socket.on('disconnect', () => {
    
    for (const [driverId, sockId] of Object.entries(driverSocketMap)) {
      if (sockId === socket.id) {
        onlineDrivers.delete(driverId);
        delete driverLocations[driverId];
        delete driverSocketMap[driverId];
        console.log(`Driver offline: ${driverId}`);
      }
    }
  });
});


app.get('/api/debug/driverLocations', (req, res) => {
  res.json(driverLocations);
});


app.post('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  
  switch (event.type) {
    case 'payment_intent.succeeded':
      
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
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
