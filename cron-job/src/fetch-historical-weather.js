const fs = require('fs');
const path = require('path');
require('dotenv').config();

const {
  fetchHistoricalByDate,
  calculateDailyStats
} = require('../../shared/historical-weather');
const { upsertHistoricalDay } = require('../../shared/persistence');

function ensureEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node fetch-historical-weather.js "YYYY-MM-DD"');
    process.exit(1);
  }

  const dateString = args[0];

  const apiKey = ensureEnv('OPENWEATHER_API_KEY');
  const lat = process.env.OPENWEATHER_LAT || process.env.LAT || '35.656';
  const lon = process.env.OPENWEATHER_LON || process.env.LON || '139.324';
  const units = process.env.OPENWEATHER_UNITS || 'metric';
  const lang = process.env.OPENWEATHER_LANG || 'ja';
  const delayMs = Number(process.env.OPENWEATHER_DELAY_MS || 1100);

  console.log(`⛅ Fetching historical weather for ${dateString} (lat: ${lat}, lon: ${lon})`);

  const result = await fetchHistoricalByDate({
    apiKey,
    lat,
    lon,
    dateString,
    units,
    lang,
    delayMs
  });

  // In case downstream tooling expects a stats object
  const stats = result.daily_statistics || calculateDailyStats(result.hourly_data);

  const outputDir = path.join(process.cwd(), 'outputs', dateString);
  fs.mkdirSync(outputDir, { recursive: true });

  const payload = {
    ...result,
    generated_at: new Date().toISOString(),
    location: { lat, lon },
    units,
    stats
  };

  const outputPath = path.join(outputDir, `daily_weather_${dateString}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

  console.log(`✅ Saved historical weather to ${outputPath}`);
  if (result.errors?.length) {
    console.log(`⚠️ Completed with ${result.errors.length} partial errors`);
  }

  if (process.env.DATABASE_URL) {
    await persistHistoricalData({ dateString, hourly: result.hourly_data, stats, lat, lon, units });
  } else {
    console.log('ℹ️ DATABASE_URL not set; skipping database persistence');
  }
}

async function persistHistoricalData({ dateString, hourly, stats, lat, lon, units }) {
  try {
    await upsertHistoricalDay({ dateString, hourly, stats, lat, lon, units });
    console.log('💾 Persisted historical data to Postgres');
  } catch (error) {
    console.error('❌ Database persistence failed', error.message);
    throw error;
  }
}

main().catch(error => {
  console.error('❌ Historical fetch failed:', error.message);
  process.exit(1);
});
