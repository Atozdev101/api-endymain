/**
 * Currency Helper Utility
 * Handles currency detection based on user country and amount conversion
 */

// Default USD to INR conversion rate (can be overridden via env variable)
const USD_TO_INR_RATE = parseFloat(process.env.USD_TO_INR_RATE) || 85;

/**
 * Determines the currency based on user's country
 * @param {string} country - User's country
 * @returns {string} - Currency code ('inr' for India, 'usd' for others)
 */
const getCurrencyByCountry = (country) => {
  if (!country) return 'usd';
  
  const normalizedCountry = country.toLowerCase().trim();
  
  // Check if user is from India
  if (normalizedCountry === 'india' || normalizedCountry === 'in') {
    return 'inr';
  }
  
  return 'usd';
};

/**
 * Converts USD amount to INR
 * @param {number} amountInUsd - Amount in USD
 * @returns {number} - Amount in INR (rounded to 2 decimal places)
 */
const convertUsdToInr = (amountInUsd) => {
  return Math.round(amountInUsd * USD_TO_INR_RATE * 100) / 100;
};

/**
 * Gets the appropriate amount based on currency
 * @param {number} amountInUsd - Amount in USD
 * @param {string} currency - Currency code ('usd' or 'inr')
 * @returns {number} - Amount in the specified currency
 */
const getAmountByCurrency = (amountInUsd, currency) => {
  if (currency === 'inr') {
    return convertUsdToInr(amountInUsd);
  }
  return amountInUsd;
};

/**
 * Gets the amount in cents/paise (smallest currency unit) for Stripe
 * @param {number} amount - Amount in the currency's main unit (dollars/rupees)
 * @param {string} currency - Currency code ('usd' or 'inr')
 * @returns {number} - Amount in cents/paise
 */
const getAmountInSmallestUnit = (amount, currency) => {
  // Both USD and INR use 100 subunits (cents and paise)
  return Math.round(amount * 100);
};

/**
 * Formats amount for display based on currency
 * @param {number} amount - Amount in the currency's main unit
 * @param {string} currency - Currency code
 * @returns {string} - Formatted amount string
 */
const formatAmountForDisplay = (amount, currency) => {
  if (currency === 'inr') {
    return `₹${amount.toFixed(2)}`;
  }
  return `$${amount.toFixed(2)}`;
};

/**
 * Gets the current conversion rate
 * @returns {number} - Current USD to INR rate
 */
const getConversionRate = () => {
  return USD_TO_INR_RATE;
};

module.exports = {
  getCurrencyByCountry,
  convertUsdToInr,
  getAmountByCurrency,
  getAmountInSmallestUnit,
  formatAmountForDisplay,
  getConversionRate,
  USD_TO_INR_RATE
};

