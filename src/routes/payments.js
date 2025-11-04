const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const Ride = require('../models/Ride');
const auth = require('../middleware/auth');

// Create a PaymentIntent for a ride. Expects { rideId, amount, currency }
router.post('/create-intent', auth, async (req, res) => {
  try {
  const { rideId, currency = 'nok' } = req.body;
  if (!rideId) return res.status(400).json({ error: 'rideId is required' });

    const ride = await Ride.findById(rideId);
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    
    // Use the ride's calculated amount (already in øre from ride creation)
    const amount = ride.amount || 1000; // fallback to 1000 if not set
    if (!amount) return res.status(400).json({ error: 'Ride amount not set' });

    // If this ride already has a PaymentIntent, return its client secret (idempotent)
    if (ride.stripePaymentIntentId) {
      try {
        const existing = await stripe.paymentIntents.retrieve(ride.stripePaymentIntentId);
        // Optionally update amount/currency if you want server-side enforcement
        // We'll prefer returning the existing client_secret to avoid duplicate intents
        return res.json({ clientSecret: existing.client_secret, paymentIntentId: existing.id, reused: true });
      } catch (e) {
        console.warn('Could not retrieve existing PaymentIntent, creating a new one', e.message);
        // fallthrough to create a new one
      }
    }

    // Create a new PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount, // smallest currency unit
      currency: currency,
      metadata: { rideId: rideId }
    });

    // Persist the intent id and mark as pending
    ride.stripePaymentIntentId = paymentIntent.id;
    ride.amount = amount;
    ride.currency = currency;
    ride.paymentStatus = 'pending';
    await ride.save();

    res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id, reused: false });
  } catch (err) {
    console.error('create-intent error', err);
    res.status(500).json({ error: 'internal_error', detail: err.message });
  }
});

module.exports = router;

// Confirm payment endpoint (useful for testing without webhooks)
// Client should call this after PaymentSheet reports completion.
// Body: { paymentIntentId, rideId }
router.post('/confirm', auth, async (req, res) => {
  try {
    const { paymentIntentId, rideId } = req.body;
    if (!paymentIntentId && !rideId) return res.status(400).json({ error: 'paymentIntentId or rideId required' });

    // If rideId provided and ride has stored intentId, prefer that
    let ride = null;
    if (rideId) ride = await Ride.findById(rideId);

    let intentId = paymentIntentId;
    if (!intentId && ride && ride.stripePaymentIntentId) intentId = ride.stripePaymentIntentId;
    if (!intentId) return res.status(400).json({ error: 'Could not determine paymentIntentId' });

    const pi = await stripe.paymentIntents.retrieve(intentId);
    if (!pi) return res.status(404).json({ error: 'PaymentIntent not found' });

    if (pi.status === 'succeeded') {
      // mark ride as paid
      const resolvedRideId = rideId || (pi.metadata && pi.metadata.rideId);
      if (resolvedRideId) {
        const rideToUpdate = ride || await Ride.findById(resolvedRideId);
        if (rideToUpdate) {
          rideToUpdate.paymentStatus = 'paid';
          rideToUpdate.transactionId = pi.id;
          rideToUpdate.stripePaymentIntentId = pi.id;
          await rideToUpdate.save();
        }
      }
      return res.json({ ok: true, status: pi.status, paymentIntentId: pi.id });
    }

    // Not succeeded yet; return current status so client can handle
    res.json({ ok: false, status: pi.status });
  } catch (err) {
    console.error('confirm payment error', err);
    res.status(500).json({ error: 'internal_error', detail: err.message });
  }
});
