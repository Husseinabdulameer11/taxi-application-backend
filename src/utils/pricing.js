// Pricing configuration for taxi rides
// All prices in Norwegian Øre (1 NOK = 100 øre)

const PRICING = {
  baseFare: 5000, // 50 NOK base fare
  pricePerKm: 1500, // 15 NOK per km (base rate)
  waitingTimePerMinute: 300, // 3 NOK per minute waiting time
  
  // Car type multipliers
  carTypeMultipliers: {
    standard: 1.0,    // Standard cars (base rate)
    comfort: 1.3,     // Comfort cars (30% more)
    xl: 1.5,          // XL/large cars (50% more)
    premium: 2.0      // Premium/luxury cars (100% more)
  },
  
  // Minimum fare
  minimumFare: 8000, // 80 NOK minimum
  
  // Time-based surcharges (optional for future)
  surcharges: {
    nightTime: 1.2,   // 20% surcharge 23:00-06:00
    weekend: 1.1,     // 10% surcharge on weekends
    rush: 1.15        // 15% surcharge during rush hours
  }
};

/**
 * Calculate ride price based on distance and car type
 * @param {number} distanceKm - Distance in kilometers (pickup to destination)
 * @param {string} carType - Type of car (standard, comfort, xl, premium)
 * @param {object} options - Additional pricing options
 * @param {number} options.driverToPickupKm - Distance from driver to pickup location
 * @param {number} options.waitingMinutes - Waiting time in minutes
 * @returns {object} Pricing breakdown
 */
function calculateRidePrice(distanceKm, carType = 'standard', options = {}) {
  const multiplier = PRICING.carTypeMultipliers[carType] || 1.0;
  
  // Calculate pickup to destination price
  let tripDistancePrice = distanceKm * PRICING.pricePerKm * multiplier;
  
  // Add driver to pickup distance (charged at base rate, no multiplier)
  let driverToPickupPrice = 0;
  if (options.driverToPickupKm) {
    driverToPickupPrice = options.driverToPickupKm * PRICING.pricePerKm;
  }
  
  // Add waiting time charge
  let waitingTimePrice = 0;
  if (options.waitingMinutes) {
    waitingTimePrice = options.waitingMinutes * PRICING.waitingTimePerMinute * multiplier;
  }
  
  let totalPrice = PRICING.baseFare + tripDistancePrice + driverToPickupPrice + waitingTimePrice;
  
  // Apply surcharges if specified
  if (options.applyNightSurcharge) {
    totalPrice *= PRICING.surcharges.nightTime;
  }
  if (options.applyWeekendSurcharge) {
    totalPrice *= PRICING.surcharges.weekend;
  }
  if (options.applyRushSurcharge) {
    totalPrice *= PRICING.surcharges.rush;
  }
  
  // Ensure minimum fare
  totalPrice = Math.max(totalPrice, PRICING.minimumFare);
  
  // Round to nearest 100 øre (1 NOK)
  totalPrice = Math.round(totalPrice / 100) * 100;
  
  return {
    baseFare: PRICING.baseFare,
    tripDistancePrice: Math.round(tripDistancePrice),
    tripDistanceKm: Math.round(distanceKm * 100) / 100,
    driverToPickupPrice: Math.round(driverToPickupPrice),
    driverToPickupKm: options.driverToPickupKm ? Math.round(options.driverToPickupKm * 100) / 100 : 0,
    waitingTimePrice: Math.round(waitingTimePrice),
    waitingMinutes: options.waitingMinutes || 0,
    carType,
    carTypeMultiplier: multiplier,
    totalPrice,
    totalPriceNOK: totalPrice / 100,
    currency: 'nok'
  };
}

/**
 * Get estimated price range for a distance
 * @param {number} distanceKm - Distance in kilometers
 * @returns {object} Price range across all car types
 */
function getPriceRange(distanceKm) {
  const standard = calculateRidePrice(distanceKm, 'standard');
  const premium = calculateRidePrice(distanceKm, 'premium');
  
  return {
    minimum: standard.totalPrice,
    maximum: premium.totalPrice,
    minimumNOK: standard.totalPriceNOK,
    maximumNOK: premium.totalPriceNOK,
    distanceKm: Math.round(distanceKm * 100) / 100,
    currency: 'nok'
  };
}

/**
 * Get car type display information
 * @param {string} carType
 * @returns {object} Car type details
 */
function getCarTypeInfo(carType) {
  const info = {
    standard: {
      name: 'Standard',
      description: 'Comfortable and affordable',
      capacity: '1-4 passengers',
      icon: '🚗'
    },
    comfort: {
      name: 'Comfort',
      description: 'Extra space and comfort',
      capacity: '1-4 passengers',
      icon: '🚙'
    },
    xl: {
      name: 'XL',
      description: 'Large vehicle for groups',
      capacity: '1-6 passengers',
      icon: '🚐'
    },
    premium: {
      name: 'Premium',
      description: 'Luxury vehicles',
      capacity: '1-4 passengers',
      icon: '🚘'
    }
  };
  
  return info[carType] || info.standard;
}

module.exports = {
  calculateRidePrice,
  getPriceRange,
  getCarTypeInfo,
  PRICING
};
