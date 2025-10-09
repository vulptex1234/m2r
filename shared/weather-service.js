/**
 * Weather Service
 *
 * Manages weather forecast data retrieval with intelligent caching.
 * Optimized to minimize OpenWeatherMap API calls from the backend.
 *
 * Strategy:
 * - Frontend updates forecast cache every hour via OpenWeatherMap API
 * - Backend ONLY reads from cache (no API calls)
 * - This prevents API cost increase when processing ESP32 measurements
 */

const { getLatestForecastSnapshot } = require('./persistence');

/**
 * Evaluate cache freshness
 *
 * Categorizes forecast data age to determine reliability.
 *
 * @param {Object} forecast - Forecast data
 * @param {string} forecast.fetchedAt - Timestamp when forecast was fetched
 * @returns {Object} Freshness evaluation
 */
function evaluateCacheFreshness(forecast) {
  if (!forecast || !forecast.fetchedAt) {
    return { fresh: false, ageMinutes: Infinity, status: 'missing' };
  }

  const fetchedAt = new Date(forecast.fetchedAt);
  const ageMinutes = (Date.now() - fetchedAt.getTime()) / 60000;

  let status;
  if (ageMinutes <= 60) {
    status = 'fresh';       // Within 1 hour - ideal
  } else if (ageMinutes <= 120) {
    status = 'acceptable';  // Within 2 hours - usable
  } else if (ageMinutes <= 360) {
    status = 'stale';       // Within 6 hours - accuracy reduced
  } else {
    status = 'expired';     // Over 6 hours - unreliable
  }

  return {
    fresh: status === 'fresh',
    ageMinutes: Math.floor(ageMinutes),
    status
  };
}

/**
 * Get cached forecast data
 *
 * Retrieves the most recent forecast from database cache.
 * Does NOT call OpenWeatherMap API (frontend handles that).
 *
 * @returns {Promise<Object|null>} Forecast data or null if unavailable
 */
async function getCachedForecast() {
  try {
    const forecast = await getLatestForecastSnapshot();

    if (!forecast || forecast.forecastC === null || forecast.forecastC === undefined) {
      console.warn('⚠️ [weather] No forecast data available in cache');
      return null;
    }

    // Evaluate cache freshness
    const { fresh, ageMinutes, status } = evaluateCacheFreshness(forecast);

    // Log status based on freshness
    switch (status) {
      case 'fresh':
        console.log(`✅ [weather] Fresh forecast: ${forecast.forecastC}°C (${ageMinutes}min old)`);
        break;
      case 'acceptable':
        console.log(`⚠️ [weather] Slightly old forecast: ${forecast.forecastC}°C (${ageMinutes}min old)`);
        break;
      case 'stale':
        console.warn(`⚠️ [weather] Stale forecast: ${forecast.forecastC}°C (${ageMinutes}min old) - accuracy may be reduced`);
        break;
      case 'expired':
        console.error(`❌ [weather] Expired forecast: ${forecast.forecastC}°C (${ageMinutes}min old) - consider refreshing frontend`);
        // Still return it - better than nothing
        break;
      case 'missing':
        console.error('❌ [weather] No forecast timestamp available');
        break;
    }

    return forecast;

  } catch (error) {
    console.error('❌ [weather] Failed to get cached forecast:', error.message);
    return null;
  }
}

/**
 * Check if forecast data is available
 *
 * @returns {Promise<boolean>} True if forecast is available
 */
async function isForecastAvailable() {
  const forecast = await getCachedForecast();
  return forecast !== null && forecast.forecastC !== null;
}

/**
 * Get forecast temperature
 *
 * Convenience method to get just the temperature value.
 *
 * @returns {Promise<number|null>} Forecast temperature in Celsius, or null
 */
async function getForecastTemperature() {
  const forecast = await getCachedForecast();
  return forecast ? forecast.forecastC : null;
}

module.exports = {
  getCachedForecast,
  isForecastAvailable,
  getForecastTemperature,
  evaluateCacheFreshness
};
