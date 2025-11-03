const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const carSchema = new Schema({
  driver: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  model: { type: String, required: true }, // e.g., "Tesla Model 3", "Toyota Camry"
  description: { type: String }, // Additional details
  carType: { 
    type: String, 
    enum: ['standard', 'comfort', 'xl', 'premium'], 
    required: true,
    default: 'standard'
  },
  seats: { type: Number, required: true, min: 2, max: 8, default: 4 },
  color: { type: String },
  licensePlate: { type: String },
  year: { type: Number },
  imageUrl: { type: String }, // URL to car image in Google Cloud Storage
  isActive: { type: Boolean, default: false }, // Only one car can be active at a time
  verified: { type: Boolean, default: false } // For admin verification if needed
}, { timestamps: true });

// Index to find active car for a driver quickly
carSchema.index({ driver: 1, isActive: 1 });

module.exports = mongoose.model('Car', carSchema);
