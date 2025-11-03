const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  avatarUrl: { type: String },
  passwordHash: { type: String, required: true },
  phone: { type: String },
  role: { type: String, enum: ['rider', 'driver'], required: true },
  verified: { type: Boolean, default: false },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] } // [lng, lat]
  },
  // Driver-specific fields
  carType: { 
    type: String, 
    enum: ['standard', 'comfort', 'xl', 'premium'], 
    default: 'standard' 
  },
  carModel: { type: String },
  carColor: { type: String },
  licensePlate: { type: String }
}, { timestamps: true });

userSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', userSchema);
