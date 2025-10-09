/**
 * Forecast Snapshot Fetcher (Render Cron Job)
 *
 * Periodically fetches weather forecast from OpenWeatherMap and saves snapshot to database.
 * Designed to run as a Render Cron Job (e.g., every hour).
 *
 * Usage:
 *   node src/fetch-forecast-snapshot.js
 *
 * Environment variables:
 *   OPENWEATHER_API_KEY - OpenWeather API key (required)
 *   OPENWEATHER_LAT - Latitude (default: 35.656)
 *   OPENWEATHER_LON - Longitude (default: 139.324)
 *   OPENWEATHER_UNITS - Units (default: metric)
 *   OPENWEATHER_LANG - Language (default: ja)
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   PGSSLMODE - SSL mode (default: require)
 */

const https = require('https');
require('dotenv').config();

const { saveForecastSnapshot } = require('../../shared/persistence');

/**
 * Ensure environment variable exists
 *
 * @param {string} name - Environment variable name
 * @returns {string} Environment variable value
 * @throws {Error} If variable is not set
 */
function ensureEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

/**
 * Fetch forecast data from OpenWeatherMap API
 *
 * @param {Object} config - Configuration
 * @param {string} config.apiKey - API key
 * @param {number} config.lat - Latitude
 * @param {number} config.lon - Longitude
 * @param {string} config.units - Units (metric/imperial)
 * @param {string} config.lang - Language code
 * @returns {Promise<Object>} Forecast data
 */
function fetchForecastFromAPI({ apiKey, lat, lon, units, lang }) {
  return new Promise((resolve, reject) => {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${units}&lang=${lang}&appid=${apiKey}`;

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`OpenWeather API returned status ${res.statusCode}: ${data}`));
          return;
        }

        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (error) {
          reject(new Error(`Failed to parse API response: ${error.message}`));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`HTTP request failed: ${error.message}`));
    });
  });
}

/**
 * Process forecast API response into snapshot format
 *
 * @param {Object} apiResponse - OpenWeatherMap API response
 * @returns {Object} Forecast snapshot
 */
function processForecastData(apiResponse) {
  if (!apiResponse || !apiResponse.list || !Array.isArray(apiResponse.list)) {
    throw new Error('Invalid API response: missing forecast list');
  }

  // Extract first forecast entry (closest to current time)
  const firstEntry = apiResponse.list[0];
  if (!firstEntry) {
    throw new Error('No forecast entries in API response');
  }

  // Convert API response to our snapshot format
  const fullForecast = apiResponse.list.slice(0, 24).map(entry => ({
    dateTime: new Date(entry.dt * 1000).toISOString(),
    timestamp: entry.dt * 1000,
    temperature: entry.main?.temp || null,
    humidity: entry.main?.humidity || null,
    pressure: entry.main?.pressure || null,
    windSpeed: entry.wind?.speed || null,
    cloudiness: entry.clouds?.all || null,
    description: entry.weather?.[0]?.description || '',
    icon: entry.weather?.[0]?.icon || ''
  }));

  return {
    provider: 'openweathermap',
    fetchedAt: new Date().toISOString(),
    forecastC: firstEntry.main?.temp || null,
    forecastTime: new Date(firstEntry.dt * 1000).toISOString(),
    fullForecast
  };
}

/**
 * Main execution function
 */
async function main() {
  console.log('⏰ [cron] Starting forecast snapshot fetch...');

  // Load configuration
  const apiKey = ensureEnv('OPENWEATHER_API_KEY');
  const lat = process.env.OPENWEATHER_LAT || process.env.LAT || '35.656';
  const lon = process.env.OPENWEATHER_LON || process.env.LON || '139.324';
  const units = process.env.OPENWEATHER_UNITS || 'metric';
  const lang = process.env.OPENWEATHER_LANG || 'ja';

  console.log(`📍 [cron] Location: lat=${lat}, lon=${lon}, units=${units}, lang=${lang}`);

  // Fetch forecast from OpenWeatherMap
  console.log('🌤️  [cron] Fetching forecast from OpenWeatherMap API...');
  const apiResponse = await fetchForecastFromAPI({ apiKey, lat, lon, units, lang });

  console.log(`📥 [cron] Received ${apiResponse.list?.length || 0} forecast entries`);

  // Process API response into snapshot format
  const snapshot = processForecastData(apiResponse);

  console.log(`📊 [cron] Processed snapshot:`, {
    forecastC: snapshot.forecastC,
    forecastTime: snapshot.forecastTime,
    fullForecastCount: snapshot.fullForecast.length,
    fetchedAt: snapshot.fetchedAt
  });

  // Verify database connection
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // Save to database
  console.log('💾 [cron] Saving forecast snapshot to database...');
  await saveForecastSnapshot(snapshot);

  console.log('✅ [cron] Forecast snapshot saved successfully');
  console.log(`📈 [cron] Next forecast: ${snapshot.forecastC}°C at ${snapshot.forecastTime}`);
}

// Execute main function
main()
  .then(() => {
    console.log('🎉 [cron] Forecast snapshot fetch completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ [cron] Forecast snapshot fetch failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
