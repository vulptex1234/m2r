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

/**
 * Get forecast data closest to measurement timestamp
 *
 * Searches through fullForecast array to find the forecast entry
 * with the closest timestamp to the measurement time.
 * This ensures accurate comparison between observed and predicted temperatures.
 *
 * @param {string} measurementTimestamp - ISO timestamp of measurement
 * @returns {Promise<Object|null>} Forecast data with matched timestamp
 * @returns {number} return.forecastC - Forecast temperature in Celsius
 * @returns {string} return.forecastTime - ISO timestamp of matched forecast
 * @returns {number} return.timeDiffMinutes - Time difference in minutes (absolute value)
 * @returns {string} return.matchQuality - Quality of match: 'exact', 'good', 'acceptable', 'poor'
 */
async function getForecastForTimestamp(measurementTimestamp) {
  try {
    const forecast = await getLatestForecastSnapshot();

    if (!forecast) {
      console.warn('⚠️ [weather] No forecast snapshot available');
      return null;
    }

    // If no fullForecast array, fall back to forecastC
    if (!forecast.fullForecast || !Array.isArray(forecast.fullForecast) || forecast.fullForecast.length === 0) {
      console.warn('⚠️ [weather] No fullForecast array, using forecastC fallback');
      return {
        forecastC: forecast.forecastC,
        forecastTime: forecast.forecastTime || null,
        timeDiffMinutes: null,
        matchQuality: 'fallback'
      };
    }

    const measurementTime = new Date(measurementTimestamp).getTime();

    // Find closest forecast entry
    let closestEntry = null;
    let minDiff = Infinity;

    for (const entry of forecast.fullForecast) {
      if (!entry.dateTime || entry.temperature === null || entry.temperature === undefined) {
        continue;
      }

      const forecastTime = new Date(entry.dateTime).getTime();
      const diff = Math.abs(forecastTime - measurementTime);

      if (diff < minDiff) {
        minDiff = diff;
        closestEntry = entry;
      }
    }

    if (closestEntry) {
      const timeDiffMinutes = Math.floor(minDiff / 60000);

      // Evaluate match quality
      let matchQuality;
      if (timeDiffMinutes <= 30) {
        matchQuality = 'exact';      // Within 30 minutes
      } else if (timeDiffMinutes <= 90) {
        matchQuality = 'good';       // Within 1.5 hours (3h forecast / 2)
      } else if (timeDiffMinutes <= 180) {
        matchQuality = 'acceptable'; // Within 3 hours (one forecast interval)
      } else {
        matchQuality = 'poor';       // Over 3 hours
      }

      console.log(`📊 [weather] Timestamp match:`, {
        measured: measurementTimestamp,
        forecast: closestEntry.dateTime,
        diff: `${timeDiffMinutes}min`,
        quality: matchQuality,
        temp: closestEntry.temperature + '°C'
      });

      return {
        forecastC: closestEntry.temperature,
        forecastTime: closestEntry.dateTime,
        timeDiffMinutes,
        matchQuality
      };
    }

    // No valid entry found, fall back to forecastC
    console.warn('⚠️ [weather] No valid forecast entry found, using forecastC fallback');
    return {
      forecastC: forecast.forecastC,
      forecastTime: forecast.forecastTime || null,
      timeDiffMinutes: null,
      matchQuality: 'fallback'
    };

  } catch (error) {
    console.error('❌ [weather] Failed to get forecast for timestamp:', error.message);
    return null;
  }
}

module.exports = {
  getCachedForecast,
  isForecastAvailable,
  getForecastTemperature,
  getForecastForTimestamp,
  evaluateCacheFreshness
};
