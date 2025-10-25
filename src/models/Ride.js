const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const rideSchema = new Schema({
  rider: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  pickupAddress: { type: String },
  pickupLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [lng, lat]
  },
  destinationAddress: { type: String },
  destinationLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  phone: { type: String },
  status: { type: String, enum: ['open', 'accepted', 'completed', 'cancelled'], default: 'open' },
  assignedDriver: { type: Schema.Types.ObjectId, ref: 'User' }
  ,declinedDrivers: [{ type: Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

rideSchema.index({ pickupLocation: '2dsphere' });

module.exports = mongoose.model('Ride', rideSchema);
