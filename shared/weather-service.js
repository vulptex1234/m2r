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
 * Linear interpolation between two values
 *
 * @param {number} x - Target position
 * @param {number} x1 - Start position
 * @param {number} y1 - Start value
 * @param {number} x2 - End position
 * @param {number} y2 - End value
 * @returns {number} Interpolated value at position x
 */
function linearInterpolate(x, x1, y1, x2, y2) {
  if (x2 === x1) {
    return y1; // Avoid division by zero
  }
  return y1 + (y2 - y1) * (x - x1) / (x2 - x1);
}

/**
 * Get forecast data for measurement timestamp with linear interpolation
 *
 * Searches through fullForecast array to find forecasts surrounding the measurement time.
 * Uses linear interpolation to calculate predicted temperature at exact measurement time.
 * Falls back to closest forecast if interpolation is not possible.
 *
 * @param {string} measurementTimestamp - ISO timestamp of measurement
 * @returns {Promise<Object|null>} Forecast data with interpolated or matched timestamp
 * @returns {number} return.forecastC - Forecast temperature in Celsius (interpolated or exact)
 * @returns {string} return.forecastTime - ISO timestamp of forecast (or measurement time if interpolated)
 * @returns {number} return.timeDiffMinutes - Time difference in minutes (0 if interpolated)
 * @returns {string} return.matchQuality - Quality: 'interpolated', 'exact', 'good', 'acceptable', 'poor', 'fallback'
 * @returns {Object} return.interpolation - Interpolation details (if used)
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

    // Sort forecast entries by time (ascending)
    const sortedForecasts = forecast.fullForecast
      .filter(entry =>
        entry.dateTime &&
        entry.temperature !== null &&
        entry.temperature !== undefined
      )
      .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

    if (sortedForecasts.length === 0) {
      console.warn('⚠️ [weather] No valid forecast entries');
      return null;
    }

    // Find forecast entries before and after measurement time
    let beforeEntry = null;
    let afterEntry = null;

    for (let i = 0; i < sortedForecasts.length; i++) {
      const entryTime = new Date(sortedForecasts[i].dateTime).getTime();

      if (entryTime <= measurementTime) {
        beforeEntry = sortedForecasts[i];
      }

      if (entryTime >= measurementTime && !afterEntry) {
        afterEntry = sortedForecasts[i];
        break;
      }
    }

    // Case 1: Exact match (within 1 minute tolerance)
    if (beforeEntry) {
      const beforeTime = new Date(beforeEntry.dateTime).getTime();
      const diffMinutes = Math.abs((measurementTime - beforeTime) / 60000);

      if (diffMinutes <= 1) {
        console.log(`📊 [weather] Exact match found:`, {
          measured: measurementTimestamp,
          forecast: beforeEntry.dateTime,
          diff: `${Math.floor(diffMinutes)}min`,
          quality: 'exact',
          temp: beforeEntry.temperature + '°C'
        });

        return {
          forecastC: beforeEntry.temperature,
          forecastTime: beforeEntry.dateTime,
          timeDiffMinutes: Math.floor(diffMinutes),
          matchQuality: 'exact'
        };
      }
    }

    // Case 2: Interpolation between two forecasts
    if (beforeEntry && afterEntry) {
      const beforeTime = new Date(beforeEntry.dateTime).getTime();
      const afterTime = new Date(afterEntry.dateTime).getTime();

      // Only interpolate if measurement time is strictly between the two forecasts
      if (measurementTime > beforeTime && measurementTime < afterTime) {
        const interpolatedTemp = linearInterpolate(
          measurementTime,
          beforeTime,
          beforeEntry.temperature,
          afterTime,
          afterEntry.temperature
        );

        const intervalMinutes = Math.floor((afterTime - beforeTime) / 60000);

        console.log(`📊 [weather] Linear interpolation used:`, {
          measured: measurementTimestamp,
          before: { time: beforeEntry.dateTime, temp: beforeEntry.temperature },
          after: { time: afterEntry.dateTime, temp: afterEntry.temperature },
          interpolated: parseFloat(interpolatedTemp.toFixed(2)) + '°C',
          interval: `${intervalMinutes}min`,
          quality: 'interpolated'
        });

        return {
          forecastC: parseFloat(interpolatedTemp.toFixed(2)),
          forecastTime: measurementTimestamp, // Use measurement time as "forecast" time
          timeDiffMinutes: 0, // Perfect match via interpolation
          matchQuality: 'interpolated',
          interpolation: {
            beforeTime: beforeEntry.dateTime,
            beforeTemp: beforeEntry.temperature,
            afterTime: afterEntry.dateTime,
            afterTemp: afterEntry.temperature,
            intervalMinutes
          }
        };
      }
    }

    // Case 3: Use closest forecast (before or after)
    let closestEntry = null;
    let minDiff = Infinity;

    if (beforeEntry) {
      const diff = Math.abs(new Date(beforeEntry.dateTime).getTime() - measurementTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestEntry = beforeEntry;
      }
    }

    if (afterEntry) {
      const diff = Math.abs(new Date(afterEntry.dateTime).getTime() - measurementTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestEntry = afterEntry;
      }
    }

    if (closestEntry) {
      const timeDiffMinutes = Math.floor(minDiff / 60000);

      // Evaluate match quality
      let matchQuality;
      if (timeDiffMinutes <= 30) {
        matchQuality = 'exact';
      } else if (timeDiffMinutes <= 90) {
        matchQuality = 'good';
      } else if (timeDiffMinutes <= 180) {
        matchQuality = 'acceptable';
      } else {
        matchQuality = 'poor';
      }

      console.log(`📊 [weather] Closest match (no interpolation):`, {
        measured: measurementTimestamp,
        forecast: closestEntry.dateTime,
        diff: `${timeDiffMinutes}min`,
        quality: matchQuality,
        temp: closestEntry.temperature + '°C',
        reason: !beforeEntry ? 'before_range' : !afterEntry ? 'after_range' : 'edge_case'
      });

      return {
        forecastC: closestEntry.temperature,
        forecastTime: closestEntry.dateTime,
        timeDiffMinutes,
        matchQuality
      };
    }

    // No valid entry found
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
