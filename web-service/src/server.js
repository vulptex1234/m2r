const express = require('express');
const cors = require('cors');
require('dotenv').config();

const {
  fetchHistoricalByDate,
  fetchHistoricalByHours,
  calculateDailyStats
} = require('../../shared/historical-weather');
const { initSchema, getPool } = require('../../shared/db');
const {
  upsertHistoricalDay,
  insertDeviceMeasurement,
  getRecentDeviceMeasurements,
  saveProcessedMeasurementBatch,
  getRecentProcessedMeasurements,
  getRecentScoreLogs,
  getControlState,
  insertRawMeasurement,
  getRawMeasurements,
  deleteRawMeasurementById,
  saveForecastSnapshot,
  getLatestForecastSnapshot,
  cleanupOldProcessedMeasurements,
  getSystemHealthSnapshot,
  deleteAllMeasurements,
  deleteAllHistoricalWeather,
  deleteAllData
} = require('../../shared/persistence');
const {
  generateDeviceMeasurementsCSV,
  generateProcessedMeasurementsCSV,
  generateControlStatesCSV,
  generateWeatherHistoryCSV,
  generateExportFilename
} = require('../../shared/export-service');
const {
  processMeasurementWithRating,
  canProcessMeasurement
} = require('../../shared/measurement-processor');

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

      // Check if auto-fetch should be prevented (used after data deletion)
      const preventAutoFetch = req.query.preventAutoFetch === 'true';

      if ((records.length === 0 && !preventAutoFetch) || req.query.refresh === 'true') {
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

    // Check if auto-fetch should be prevented (used after data deletion)
    const preventAutoFetch = req.query.preventAutoFetch === 'true';

    if ((records.length === 0 && !preventAutoFetch) || req.query.refresh === 'true') {
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

app.get('/api/measurements', async (req, res) => {
  try {
    await startup;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 20));
    const measurements = await getRecentDeviceMeasurements(limit);
    res.set('Cache-Control', 'no-cache');
    return res.json({ data: measurements });
  } catch (error) {
    console.error('[measurements:list] failed', error);
    return res.status(500).json({
      error: 'Failed to fetch measurements',
      message: error.message
    });
  }
});

app.post('/api/measurements', async (req, res) => {
  try {
    await startup;
    const { deviceId, temperature, humidity, recordedAt, payload } = req.body || {};

    // 1. Validation
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const tempValue = temperature !== undefined ? Number(temperature) : null;
    if (tempValue !== null && Number.isNaN(tempValue)) {
      return res.status(400).json({ error: 'temperature must be a number' });
    }

    const humidityValue = humidity !== undefined ? Number(humidity) : null;
    if (humidityValue !== null && Number.isNaN(humidityValue)) {
      return res.status(400).json({ error: 'humidity must be a number' });
    }

    if (recordedAt && Number.isNaN(new Date(recordedAt).getTime())) {
      return res.status(400).json({ error: 'recordedAt must be a valid ISO date string' });
    }

    // 2. Save to device_measurements table
    await insertDeviceMeasurement({
      deviceId,
      temperature: tempValue,
      humidity: humidityValue,
      recordedAt,
      payload: payload ?? req.body
    });

    console.log(`📥 [measurements] Received from ${deviceId}: temp=${tempValue}°C, humidity=${humidityValue}%`);

    // 3. Execute backend rate decision (NEW!)
    const measurementData = {
      deviceId,
      temperature: tempValue,
      humidity: humidityValue,
      voltage: payload?.voltage_v,
      current: payload?.current_ma,
      power: payload?.power_mw,
      recordedAt
    };

    if (canProcessMeasurement(measurementData)) {
      try {
        const processingResult = await processMeasurementWithRating(measurementData);

        if (processingResult) {
          console.log(`✅ [measurements] Rate decision completed for ${deviceId}: ${processingResult.targetRate}`);
        } else {
          console.log(`⚠️ [measurements] Rate decision skipped for ${deviceId} (forecast unavailable or first measurement)`);
        }
      } catch (processingError) {
        // Rate decision errors are non-fatal - log and continue
        console.error(`❌ [measurements] Rate decision failed for ${deviceId} (non-fatal):`, processingError.message);
      }
    } else {
      console.warn(`⚠️ [measurements] Cannot process measurement from ${deviceId} (invalid data)`);
    }

    // 4. Calculate next interval (uses updated control_states)
    const nextInterval = await calculateNextInterval(deviceId);

    console.log(`📤 [measurements] Responding to ${deviceId}: nextInterval=${nextInterval}s`);

    return res.status(201).json({
      status: 'ok',
      nextIntervalSeconds: nextInterval,
      message: 'Measurement recorded successfully'
    });
  } catch (error) {
    console.error('[measurements] failed', error);
    return res.status(500).json({
      error: 'Failed to record measurement',
      message: error.message
    });
  }
});

app.get('/api/processed-measurements', async (req, res) => {
  try {
    await startup;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const nodeId = req.query.nodeId || null;
    const data = await getRecentProcessedMeasurements({ limit, nodeId });
    res.set('Cache-Control', 'no-cache');
    return res.json({ data });
  } catch (error) {
    console.error('[processed-measurements:list] failed', error);
    return res.status(500).json({
      error: 'Failed to fetch processed measurements',
      message: error.message
    });
  }
});

app.post('/api/processed-measurements', async (req, res) => {
  try {
    await startup;
    const result = req.body || {};
    if (!result.nodeId) {
      return res.status(400).json({ error: 'nodeId is required' });
    }

    await saveProcessedMeasurementBatch(result);
    return res.status(201).json({ status: 'ok' });
  } catch (error) {
    console.error('[processed-measurements] failed', error);
    return res.status(500).json({
      error: 'Failed to store processed measurement',
      message: error.message
    });
  }
});

app.post('/api/processed-measurements/cleanup', async (req, res) => {
  try {
    await startup;
    const days = Number(req.body?.days || 30);
    const deleted = await cleanupOldProcessedMeasurements(days);
    return res.json({ deleted });
  } catch (error) {
    console.error('[processed-measurements:cleanup] failed', error);
    return res.status(500).json({
      error: 'Failed to cleanup measurements',
      message: error.message
    });
  }
});

app.get('/api/score-logs', async (req, res) => {
  try {
    await startup;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const nodeId = req.query.nodeId || null;
    const data = await getRecentScoreLogs({ limit, nodeId });
    res.set('Cache-Control', 'no-cache');
    return res.json({ data });
  } catch (error) {
    console.error('[score-logs:list] failed', error);
    return res.status(500).json({
      error: 'Failed to fetch score logs',
      message: error.message
    });
  }
});

app.get('/api/control-states/:nodeId', async (req, res) => {
  try {
    await startup;
    const state = await getControlState(req.params.nodeId);
    if (!state) {
      return res.status(404).json({ error: 'not_found' });
    }
    return res.json(state);
  } catch (error) {
    console.error('[control-states:get] failed', error);
    return res.status(500).json({
      error: 'Failed to fetch control state',
      message: error.message
    });
  }
});

app.post('/api/raw-measurements', async (req, res) => {
  try {
    await startup;
    await insertRawMeasurement(req.body || {});
    return res.status(201).json({ status: 'ok' });
  } catch (error) {
    console.error('[raw-measurements:insert] failed', error);
    return res.status(500).json({
      error: 'Failed to store raw measurement',
      message: error.message
    });
  }
});

app.get('/api/raw-measurements', async (req, res) => {
  try {
    await startup;
    const { since, limit } = req.query;
    const data = await getRawMeasurements({ since, limit });
    res.set('Cache-Control', 'no-cache');
    return res.json({ data });
  } catch (error) {
    console.error('[raw-measurements:list] failed', error);
    return res.status(500).json({
      error: 'Failed to fetch raw measurements',
      message: error.message
    });
  }
});

app.delete('/api/raw-measurements/:id', async (req, res) => {
  try {
    await startup;
    const deleted = await deleteRawMeasurementById(req.params.id);
    return res.json({ deleted });
  } catch (error) {
    console.error('[raw-measurements:delete] failed', error);
    return res.status(500).json({
      error: 'Failed to delete raw measurement',
      message: error.message
    });
  }
});

app.get('/api/system-health', async (_req, res) => {
  try {
    await startup;
    const snapshot = await getSystemHealthSnapshot();
    return res.json(snapshot);
  } catch (error) {
    console.error('[system-health] failed', error);
    return res.status(500).json({
      error: 'Failed to fetch system health',
      message: error.message
    });
  }
});

app.post('/api/forecast/snapshot', async (req, res) => {
  try {
    await startup;
    const snapshot = req.body;
    if (!snapshot) {
      return res.status(400).json({ error: 'snapshot payload is required' });
    }

    await saveForecastSnapshot({ ...snapshot, fetchedAt: snapshot.fetchedAt || new Date().toISOString() });
    return res.status(201).json({ status: 'ok' });
  } catch (error) {
    console.error('[forecast:snapshot/save] failed', error);
    return res.status(500).json({
      error: 'Failed to store forecast snapshot',
      message: error.message
    });
  }
});

app.get('/api/forecast/snapshot', async (_req, res) => {
  try {
    await startup;
    const snapshot = await getLatestForecastSnapshot();
    if (!snapshot) {
      return res.json({ forecastC: null });
    }
    return res.json(snapshot);
  } catch (error) {
    console.error('[forecast:snapshot] failed', error);
    return res.status(500).json({
      error: 'Failed to fetch forecast snapshot',
      message: error.message
    });
  }
});

// DELETE endpoints for data cleanup
app.delete('/api/measurements', async (req, res) => {
  try {
    await startup;
    const deletedCount = await deleteAllMeasurements();

    return res.json({
      success: true,
      message: `Deleted ${deletedCount} device measurements`,
      deletedCount
    });
  } catch (error) {
    console.error('[measurements:delete] failed', error);
    return res.status(500).json({
      error: 'Failed to delete measurements',
      message: error.message
    });
  }
});

app.delete('/api/historical', async (req, res) => {
  try {
    await startup;
    const deletedCount = await deleteAllHistoricalWeather();

    return res.json({
      success: true,
      message: `Deleted ${deletedCount} historical weather records`,
      deletedCount
    });
  } catch (error) {
    console.error('[historical:delete] failed', error);
    return res.status(500).json({
      error: 'Failed to delete historical weather data',
      message: error.message
    });
  }
});

app.delete('/api/all-data', async (req, res) => {
  try {
    await startup;
    const result = await deleteAllData();

    return res.json({
      success: true,
      message: `Deleted all data: ${result.total} total records`,
      result
    });
  } catch (error) {
    console.error('[all-data:delete] failed', error);
    return res.status(500).json({
      error: 'Failed to delete all data',
      message: error.message
    });
  }
});

// CSV Export endpoints
app.get('/api/export/device-measurements', async (req, res) => {
  try {
    await startup;
    const { startDate, endDate, deviceId, limit } = req.query;

    const csv = await generateDeviceMeasurementsCSV({
      startDate,
      endDate,
      deviceId,
      limit: limit ? Number(limit) : undefined
    });

    const filename = generateExportFilename('device_measurements', startDate, endDate);

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.set('Cache-Control', 'no-cache');

    return res.send(csv);
  } catch (error) {
    console.error('[export:device-measurements] failed', error);
    return res.status(500).json({
      error: 'Failed to export device measurements',
      message: error.message
    });
  }
});

app.get('/api/export/processed-measurements', async (req, res) => {
  try {
    await startup;
    const { startDate, endDate, nodeId, limit } = req.query;

    const csv = await generateProcessedMeasurementsCSV({
      startDate,
      endDate,
      nodeId,
      limit: limit ? Number(limit) : undefined
    });

    const filename = generateExportFilename('processed_measurements', startDate, endDate);

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.set('Cache-Control', 'no-cache');

    return res.send(csv);
  } catch (error) {
    console.error('[export:processed-measurements] failed', error);
    return res.status(500).json({
      error: 'Failed to export processed measurements',
      message: error.message
    });
  }
});

app.get('/api/export/control-states', async (req, res) => {
  try {
    await startup;
    const { nodeId } = req.query;

    const csv = await generateControlStatesCSV({ nodeId });

    const filename = generateExportFilename('control_states');

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.set('Cache-Control', 'no-cache');

    return res.send(csv);
  } catch (error) {
    console.error('[export:control-states] failed', error);
    return res.status(500).json({
      error: 'Failed to export control states',
      message: error.message
    });
  }
});

app.get('/api/export/weather-history', async (req, res) => {
  try {
    await startup;
    const { startDate, endDate, limit } = req.query;

    const csv = await generateWeatherHistoryCSV({
      startDate,
      endDate,
      limit: limit ? Number(limit) : undefined
    });

    const filename = generateExportFilename('weather_history', startDate, endDate);

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.set('Cache-Control', 'no-cache');

    return res.send(csv);
  } catch (error) {
    console.error('[export:weather-history] failed', error);
    return res.status(500).json({
      error: 'Failed to export weather history',
      message: error.message
    });
  }
});

/**
 * Rate-to-interval mapping configuration
 *
 * Defines how frequently ESP32 should send measurements based on
 * the control system's target rate level.
 */
const RATE_INTERVAL_MAP = {
  HIGH: 60,       // 1 minute  - High frequency monitoring (anomaly detection)
  MEDIUM: 300,    // 5 minutes - Normal operation
  LOW: 900,       // 15 minutes - Power saving mode
  DEFAULT: 300    // 5 minutes - Unknown/initial state
};

/**
 * Calculates recommended measurement interval for ESP32 device
 *
 * Queries the control_states table to determine the current target rate
 * for the device and returns the corresponding sampling interval in seconds.
 *
 * @param {string} deviceId - Device identifier (e.g., "esp32-node-01")
 * @returns {Promise<number>} Recommended interval in seconds
 */
async function calculateNextInterval(deviceId) {
  try {
    await startup;

    // Query control state for this device (deviceId maps to nodeId)
    const controlState = await getControlState(deviceId);

    if (!controlState || !controlState.targetRate) {
      console.log(`📊 [interval-control] No control state for device ${deviceId}, using DEFAULT interval: ${RATE_INTERVAL_MAP.DEFAULT}s`);
      return RATE_INTERVAL_MAP.DEFAULT;
    }

    const targetRate = controlState.targetRate;
    const interval = RATE_INTERVAL_MAP[targetRate] || RATE_INTERVAL_MAP.DEFAULT;

    console.log(`📊 [interval-control] Device ${deviceId}: targetRate=${targetRate}, nextInterval=${interval}s`);

    return interval;
  } catch (error) {
    console.error(`❌ [interval-control] Failed to calculate interval for ${deviceId}:`, error);
    return RATE_INTERVAL_MAP.DEFAULT; // Fallback to default on error
  }
}

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
