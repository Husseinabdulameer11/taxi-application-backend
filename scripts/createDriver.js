// Usage: node scripts/createDriver.js "Driver Name" driver@example.com password123 
const mongoose = require('mongoose');
require('dotenv').config({ path: __dirname + '/../.env' });
const bcrypt = require('bcrypt');
const User = require('../src/models/User');

async function main() {
  const [,, name, email, password, phone] = process.argv;
  if (!name || !email || !password) {
    console.log('Usage: node scripts/createDriver.js "Driver Name" driver@example.com password123 [phone]');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const existing = await User.findOne({ email });
  if (existing) {
    console.log('User already exists');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = new User({ name, email, passwordHash, phone, role: 'driver', verified: true });
  await user.save();
  console.log('Driver created:', user._id.toString());
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
