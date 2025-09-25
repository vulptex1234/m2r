const express = require('express');
const cors = require('cors');
require('dotenv').config();

const {
  fetchHistoricalByDate,
  fetchHistoricalByHours,
  calculateDailyStats
} = require('../../shared/historical-weather');
const { initSchema, getPool } = require('../../shared/db');
const { upsertHistoricalDay } = require('../../shared/persistence');

const app = express();
const PORT = process.env.PORT || process.env.APP_PORT || 3000;
const startup = initSchema().catch((error) => {
  console.error('Failed to initialise database schema', error);
  process.exit(1);
});

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

function ensureApiKey() {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) {
    throw new Error('Environment variable OPENWEATHER_API_KEY is required.');
  }
  return key;
}

function resolveLocation(query) {
  const lat = query.lat ?? process.env.OPENWEATHER_LAT ?? '35.656';
  const lon = query.lon ?? process.env.OPENWEATHER_LON ?? '139.324';
  return { lat, lon };
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/historical', async (req, res) => {
  try {
    await startup;
    const apiKey = ensureApiKey();
    const { lat, lon } = resolveLocation(req.query);
    const units = req.query.units || process.env.OPENWEATHER_UNITS || 'metric';
    const lang = req.query.lang || process.env.OPENWEATHER_LANG || 'ja';
    const delayMs = Number(req.query.delayMs || process.env.OPENWEATHER_DELAY_MS || 1100);
    const pool = getPool();

    if (req.query.date) {
      const dateString = req.query.date;
      const summary = await getDailySummary(pool, dateString);
      let records = await getHourlyFromDb(pool, dateString);
      let source = 'database';

      if (records.length === 0 || req.query.refresh === 'true') {
        const apiData = await fetchHistoricalByDate({
          apiKey,
          lat,
          lon,
          dateString,
          units,
          lang,
          delayMs
        });

        const stats = apiData.daily_statistics || calculateDailyStats(apiData.hourly_data);
        await upsertHistoricalDay({
          dateString,
          hourly: apiData.hourly_data,
          stats,
          lat,
          lon,
          units
        });

        records = apiData.hourly_data;
        source = 'api';

        res.set('Cache-Control', 'no-cache');
        return res.json({
          mode: 'date',
          source,
          lat,
          lon,
          units,
          stats,
          data: records
        });
      }

      res.set('Cache-Control', 'public, max-age=300');
      return res.json({
        mode: 'date',
        source,
        lat,
        lon,
        units,
        stats: summary?.summary?.stats || summary?.summary || null,
        data: records
      });
    }

    const hours = Math.max(1, Number(req.query.hours || 3));
    let records = await getRecentHours(pool, hours);
    let source = 'database';

    if (records.length === 0 || req.query.refresh === 'true') {
      const apiData = await fetchHistoricalByHours({
        apiKey,
        lat,
        lon,
        hours,
        units,
        lang,
        delayMs
      });

      await persistGrouped(apiData, { lat, lon, units });
      records = apiData;
      source = 'api';
      res.set('Cache-Control', 'no-cache');
    } else {
      res.set('Cache-Control', 'public, max-age=180');
    }

    return res.json({
      mode: 'hours',
      hours,
      source,
      lat,
      lon,
      units,
      data: records
    });
  } catch (error) {
    console.error('[historical] failed', error);
    return res.status(500).json({
      error: 'Failed to fetch historical weather data',
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Historical weather API listening on port ${PORT}`);
});

async function getHourlyFromDb(pool, dateString) {
  const { rows } = await pool.query(
    'SELECT payload FROM weather_history WHERE date = $1 ORDER BY hour ASC',
    [dateString]
  );
  return rows.map((row) => row.payload);
}

async function getDailySummary(pool, dateString) {
  const { rows } = await pool.query(
    'SELECT summary FROM weather_daily_summary WHERE date = $1',
    [dateString]
  );
  return rows[0] || null;
}

async function getRecentHours(pool, hours) {
  const { rows } = await pool.query(
    `SELECT date, hour, payload
       FROM weather_history
      ORDER BY date DESC, hour DESC
      LIMIT $1`,
    [hours]
  );

  return rows
    .map((row) => ({
      ...row.payload,
      date: row.date,
      hour: row.hour
    }))
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

async function persistGrouped(entries, meta) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return;
  }

  const grouped = new Map();
  for (const entry of entries) {
    if (!entry || !entry.timestamp) continue;
    const date = new Date(entry.timestamp).toISOString().split('T')[0];
    if (!grouped.has(date)) {
      grouped.set(date, []);
    }
    grouped.get(date).push(entry);
  }

  for (const [dateString, hourly] of grouped.entries()) {
    const stats = calculateDailyStats(hourly);
    await upsertHistoricalDay({
      dateString,
      hourly,
      stats,
      lat: meta.lat,
      lon: meta.lon,
      units: meta.units
    });
  }
}
