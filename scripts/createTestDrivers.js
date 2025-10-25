// Usage: node scripts/createTestDrivers.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: '../.env' });

const User = require('../src/models/User');

const drivers = [
  {
    name: 'Driver One',
    email: 'driver1@example.com',
    password: 'password123',
    phone: '+19999999991',
  },
  {
    name: 'Driver Two',
    email: 'driver2@example.com',
    password: 'password123',
    phone: '+19999999992',
  },
  {
    name: 'Driver Three',
    email: 'driver3@example.com',
    password: 'password123',
    phone: '+19999999993',
  },
  {
    name: 'Driver Four',
    email: 'driver4@example.com',
    password: 'password123',
    phone: '+19999999994',
  },
];

async function createDrivers() {
  await mongoose.connect(process.env.MONGO_URI);
  for (const d of drivers) {
    const passwordHash = await bcrypt.hash(d.password, 10);
    await User.create({
      name: d.name,
      email: d.email,
      passwordHash,
      phone: d.phone,
      role: 'driver',
      verified: true,
    });
    console.log(`Created driver: ${d.email}`);
  }
  await mongoose.disconnect();
  console.log('All test drivers created.');
}

createDrivers().catch(console.error);
