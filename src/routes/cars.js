const express = require('express');
const router = express.Router();
const Car = require('../models/Car');
const User = require('../models/User');
const auth = require('../middleware/auth');
const multer = require('multer');
const { uploadBuffer } = require('../utils/gcs');

// Multer memory storage for car image uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit

// Upload car image
router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (req.user.role !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can upload car images' });
    }
    
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    
    // Generate unique filename for the car image
    const timestamp = Date.now();
    const ext = file.mimetype.split('/')[1] || 'jpg';
    const dest = `cars/${req.user._id}_${timestamp}.${ext}`;
    
    // Upload to Google Cloud Storage
    const publicUrl = await uploadBuffer(file.buffer, dest, file.mimetype);
    
    console.log(`Driver ${req.user._id} uploaded car image: ${publicUrl}`);
    res.json({ url: publicUrl });
  } catch (err) {
    console.error('car image upload error', err);
    res.status(500).json({ error: err.message });
  }
});


// Get all cars for the authenticated driver
router.get('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can manage cars' });
    }
    const cars = await Car.find({ driver: req.user._id }).sort({ createdAt: -1 });
    res.json({ cars });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a specific car
router.get('/:id', auth, async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).json({ error: 'Car not found' });
    
    // Drivers can only see their own cars, riders can see any car
    if (req.user.role === 'driver' && car.driver.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json({ car });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get active car for a driver (public endpoint for riders to see)
router.get('/driver/:driverId/active', auth, async (req, res) => {
  try {
    const car = await Car.findOne({ driver: req.params.driverId, isActive: true });
    res.json({ car });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new car
router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can add cars' });
    }
    
    const { model, description, carType, seats, color, licensePlate, year, imageUrl } = req.body;
    
    if (!model || !carType || !seats) {
      return res.status(400).json({ error: 'Model, carType, and seats are required' });
    }
    
    const car = new Car({
      driver: req.user._id,
      model,
      description,
      carType,
      seats,
      color,
      licensePlate,
      year,
      imageUrl,
      isActive: false // New cars start as inactive
    });
    
    await car.save();
    
    // Update user's carType to match if they don't have one set
    if (!req.user.carType) {
      await User.findByIdAndUpdate(req.user._id, { carType: carType });
    }
    
    console.log(`Driver ${req.user._id} added new car: ${model} (${carType})`);
    res.json({ car });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a car
router.put('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can update cars' });
    }
    
    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).json({ error: 'Car not found' });
    
    if (car.driver.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { model, description, carType, seats, color, licensePlate, year, imageUrl } = req.body;
    
    if (model) car.model = model;
    if (description !== undefined) car.description = description;
    if (carType) car.carType = carType;
    if (seats) car.seats = seats;
    if (color) car.color = color;
    if (licensePlate) car.licensePlate = licensePlate;
    if (year) car.year = year;
    if (imageUrl) car.imageUrl = imageUrl;
    
    await car.save();
    res.json({ car });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set a car as active (and deactivate others)
router.post('/:id/activate', auth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can activate cars' });
    }
    
    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).json({ error: 'Car not found' });
    
    if (car.driver.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Deactivate all other cars for this driver
    await Car.updateMany(
      { driver: req.user._id, _id: { $ne: car._id } },
      { isActive: false }
    );
    
    // Activate this car
    car.isActive = true;
    await car.save();
    
    // Update user's carType to match the active car
    await User.findByIdAndUpdate(req.user._id, { 
      carType: car.carType,
      carModel: car.model,
      carColor: car.color,
      licensePlate: car.licensePlate
    });
    
    console.log(`Driver ${req.user._id} activated car: ${car.model}`);
    res.json({ car });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a car
router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can delete cars' });
    }
    
    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).json({ error: 'Car not found' });
    
    if (car.driver.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Can't delete active car
    if (car.isActive) {
      return res.status(400).json({ error: 'Cannot delete active car. Please activate another car first.' });
    }
    
    await car.deleteOne();
    res.json({ ok: true, message: 'Car deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
