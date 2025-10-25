// Simulate multiple drivers sending periodic location updates to the Socket.IO server
// This version queries MongoDB for driver users and uses their _id as driverId
// Usage: node scripts/simulateDrivers.js

const io = require('socket.io-client');
const mongoose = require('mongoose');
require('dotenv').config({ path: '../.env' });
const User = require('../src/models/User');

const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:4000';

async function buildDriversFromDb() {
  await mongoose.connect(process.env.MONGO_URI);
  const driverUsers = await User.find({ role: 'driver' }).lean();
  await mongoose.disconnect();

  if (!driverUsers || driverUsers.length === 0) {
    console.error('No driver users found in DB. Create test drivers first.');
    process.exit(1);
  }

  // Base coordinates (default Oslo) used if user has no stored location.
  // You can override by setting environment variables CENTER_LAT and CENTER_LON
  const baseLat = parseFloat(process.env.CENTER_LAT) || 59.9139;
  const baseLon = parseFloat(process.env.CENTER_LON) || 10.7522;

  return driverUsers.map((u, idx) => {
    // If user has a stored location with coordinates [lng, lat], use that
  // spread drivers slightly around the center so they don't overlap exactly
  const spread = 0.002;
  let lat = baseLat + (idx * spread);
  let lon = baseLon + (idx * spread);
    if (u.location && Array.isArray(u.location.coordinates) && u.location.coordinates.length === 2) {
      // user.location.coordinates = [lng, lat]
      lon = u.location.coordinates[0] || lon;
      lat = u.location.coordinates[1] || lat;
    }
    return { driverId: String(u._id), lat, lon };
  });
}

async function run() {
  const drivers = await buildDriversFromDb();
  const socket = io(SOCKET_URL);

  socket.on('connect', () => {
    console.log('connected to socket server', socket.id);
    setInterval(() => {
      drivers.forEach((d, idx) => {
        // simple oscillation for demo
        const lat = d.lat + Math.sin(Date.now() / 5000 + idx) * 0.001;
        const lon = d.lon + Math.cos(Date.now() / 5000 + idx) * 0.001;
        socket.emit('driverLocationUpdate', { driverId: d.driverId, latitude: lat, longitude: lon });
      });
    }, 2000);
  });

  socket.on('connect_error', (err) => {
    console.error('connect_error', err.message);
  });
}

run().catch(err => {
  console.error('simulateDrivers error:', err);
  process.exit(1);
});
