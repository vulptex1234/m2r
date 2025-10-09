const { initSchema, getPool } = require('./db');

async function upsertHistoricalDay({ dateString, hourly, stats, lat, lon, units }) {
  if (!Array.isArray(hourly)) {
    throw new Error('hourly data must be an array');
  }

  await initSchema();
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const historySql = `
      INSERT INTO weather_history (date, hour, payload)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (date, hour)
      DO UPDATE SET payload = EXCLUDED.payload, created_at = NOW();
    `;

    for (const entry of hourly) {
      const hour = entry.hour ?? new Date(entry.timestamp).getHours();
      await client.query(historySql, [dateString, hour, JSON.stringify(entry)]);
    }

    const summarySql = `
      INSERT INTO weather_daily_summary (date, summary, generated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (date)
      DO UPDATE SET summary = EXCLUDED.summary, generated_at = EXCLUDED.generated_at;
    `;

    const summaryPayload = {
      stats,
      location: { lat, lon },
      units,
      generated_at: new Date().toISOString(),
      data_points: hourly.length
    };

    await client.query(summarySql, [dateString, JSON.stringify(summaryPayload)]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function insertDeviceMeasurement({ deviceId, temperature, humidity, recordedAt, payload }) {
  if (!deviceId) {
    throw new Error('deviceId is required');
  }

  await initSchema();
  const pool = getPool();
  await pool.query(
    `INSERT INTO device_measurements (device_id, temperature, humidity, recorded_at, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      deviceId,
      temperature != null ? Number(temperature) : null,
      humidity != null ? Number(humidity) : null,
      recordedAt ? new Date(recordedAt) : null,
      payload ? JSON.stringify(payload) : null
    ]
  );
}

async function getRecentDeviceMeasurements(limit = 20) {
  await initSchema();
  const pool = getPool();
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 20));
  const { rows } = await pool.query(
    `SELECT device_id, temperature, humidity, recorded_at, payload, created_at
       FROM device_measurements
      ORDER BY COALESCE(recorded_at, created_at) DESC
      LIMIT $1`,
    [safeLimit]
  );

  return rows.map((row) => ({
    deviceId: row.device_id,
    temperature: row.temperature != null ? Number(row.temperature) : null,
    humidity: row.humidity != null ? Number(row.humidity) : null,
    recordedAt: row.recorded_at ? row.recorded_at.toISOString() : null,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    payload: row.payload || null
  }));
}

async function saveProcessedMeasurementBatch(result) {
  await initSchema();
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const recordedAt = result.measuredAt ? new Date(result.measuredAt) : new Date();

    await client.query(
      `INSERT INTO processed_measurements (node_id, observed_c, forecast_c, abs_error, battery_v, s_err, target_rate, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        result.nodeId,
        result.observedC != null ? Number(result.observedC) : null,
        result.forecastC != null ? Number(result.forecastC) : null,
        result.absError != null ? Number(result.absError) : null,
        result.batteryV != null ? Number(result.batteryV) : null,
        result.sErr != null ? Number(result.sErr) : null,
        result.targetRate,
        recordedAt
      ]
    );

    await client.query(
      `INSERT INTO control_states (node_id, target_rate, previous_rate, m_ewma, sigma_day, samples, s_err, last_observed_c, last_forecast_c, last_updated_at, reason, mode, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (node_id)
       DO UPDATE SET
         target_rate = EXCLUDED.target_rate,
         previous_rate = EXCLUDED.previous_rate,
         m_ewma = EXCLUDED.m_ewma,
         sigma_day = EXCLUDED.sigma_day,
         samples = EXCLUDED.samples,
         s_err = EXCLUDED.s_err,
         last_observed_c = EXCLUDED.last_observed_c,
         last_forecast_c = EXCLUDED.last_forecast_c,
         last_updated_at = EXCLUDED.last_updated_at,
         reason = EXCLUDED.reason,
         mode = EXCLUDED.mode,
         updated_at = NOW();
      `,
      [
        result.nodeId,
        result.targetRate,
        result.previousRate,
        result.mEwma,
        result.sigmaDay,
        JSON.stringify(result.updatedSamples ?? result.samples ?? {}),
        result.sErr,
        result.observedC,
        result.forecastC,
        recordedAt,
        result.reason,
        result.mode || 'ACTIVE'
      ]
    );

    if (result.mode === 'ACTIVE') {
      await client.query(
        `INSERT INTO score_logs (node_id, m_ewma, sigma_day, s_err, target_rate)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          result.nodeId,
          result.mEwma,
          result.sigmaDay,
          result.sErr,
          result.targetRate
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getRecentProcessedMeasurements({ limit = 50, nodeId = null } = {}) {
  await initSchema();
  const pool = getPool();
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 50));

  let query = `SELECT * FROM processed_measurements`;
  const params = [];
  if (nodeId) {
    params.push(nodeId);
    query += ` WHERE node_id = $${params.length}`;
  }
  params.push(safeLimit);
  query += ` ORDER BY COALESCE(recorded_at, created_at) DESC LIMIT $${params.length}`;

  const { rows } = await pool.query(query, params);
  return rows.map(row => ({
    id: row.id,
    nodeId: row.node_id,
    observedC: row.observed_c != null ? Number(row.observed_c) : null,
    forecastC: row.forecast_c != null ? Number(row.forecast_c) : null,
    absError: row.abs_error != null ? Number(row.abs_error) : null,
    batteryV: row.battery_v != null ? Number(row.battery_v) : null,
    sErr: row.s_err != null ? Number(row.s_err) : null,
    targetRate: row.target_rate,
    recordedAt: row.recorded_at ? row.recorded_at.toISOString() : null,
    createdAt: row.created_at ? row.created_at.toISOString() : null
  }));
}

async function getControlState(nodeId) {
  await initSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM control_states WHERE node_id = $1`,
    [nodeId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    nodeId: row.node_id,
    targetRate: row.target_rate,
    previousRate: row.previous_rate,
    mEwma: row.m_ewma,
    sigmaDay: row.sigma_day,
    samples: row.samples || {},
    sErr: row.s_err,
    lastObservedC: row.last_observed_c,
    lastForecastC: row.last_forecast_c,
    lastUpdatedAt: row.last_updated_at ? row.last_updated_at.toISOString() : null,
    reason: row.reason,
    mode: row.mode || 'ACTIVE'
  };
}

async function insertRawMeasurement(rawData) {
  await initSchema();
  const pool = getPool();
  const payload = { ...rawData };
  const deviceId = rawData.deviceId || rawData.nodeId || 'device';
  await pool.query(
    `INSERT INTO raw_measurements (device_id, payload, received_at)
     VALUES ($1, $2::jsonb, $3)`,
    [deviceId, JSON.stringify(payload), rawData.receivedAt ? new Date(rawData.receivedAt) : new Date()]
  );
}

async function getRawMeasurements({ since, limit = 20 } = {}) {
  await initSchema();
  const pool = getPool();
  const params = [];
  let query = `SELECT id, device_id, payload, received_at FROM raw_measurements`;

  if (since) {
    const sinceDate = new Date(since);
    if (!Number.isNaN(sinceDate.getTime())) {
      params.push(sinceDate);
      query += ` WHERE received_at > $${params.length}`;
    }
  }

  params.push(Math.min(200, Math.max(1, Number(limit) || 20)));
  query += ` ORDER BY received_at ASC LIMIT $${params.length}`;

  const { rows } = await pool.query(query, params);
  return rows.map(row => ({
    id: row.id,
    deviceId: row.device_id,
    payload: row.payload,
    receivedAt: row.received_at ? row.received_at.toISOString() : null
  }));
}

async function deleteRawMeasurementById(id) {
  if (!id) return 0;
  await initSchema();
  const pool = getPool();
  const result = await pool.query('DELETE FROM raw_measurements WHERE id = $1', [id]);
  return result.rowCount;
}

async function saveForecastSnapshot(snapshot) {
  await initSchema();
  const pool = getPool();
  await pool.query(
    `INSERT INTO forecast_snapshots (snapshot, fetched_at)
     VALUES ($1::jsonb, $2)`,
    [JSON.stringify(snapshot), snapshot.fetchedAt ? new Date(snapshot.fetchedAt) : new Date()]
  );
}

async function getLatestForecastSnapshot() {
  await initSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT snapshot, fetched_at
       FROM forecast_snapshots
      ORDER BY fetched_at DESC
      LIMIT 1`
  );
  if (!rows.length) return null;
  return {
    ...rows[0].snapshot,
    fetchedAt: rows[0].fetched_at ? rows[0].fetched_at.toISOString() : null
  };
}

/**
 * Get forecast snapshot best suited for measurement time
 *
 * Searches historical forecast snapshots to find one that:
 * 1. Was fetched before the measurement time
 * 2. Has fullForecast data covering the measurement time
 * 3. Is closest to the measurement time (most recent)
 *
 * This enables interpolation even when current snapshot doesn't have
 * forecasts before the measurement time.
 *
 * @param {string} measurementTimestamp - ISO timestamp of measurement
 * @returns {Promise<Object|null>} Best matching forecast snapshot
 */
async function getForecastSnapshotForMeasurementTime(measurementTimestamp) {
  await initSchema();
  const pool = getPool();

  const measurementTime = new Date(measurementTimestamp);

  // Get forecast snapshots fetched before measurement time, ordered by fetched_at DESC
  const { rows } = await pool.query(
    `SELECT snapshot, fetched_at
       FROM forecast_snapshots
      WHERE fetched_at <= $1
      ORDER BY fetched_at DESC
      LIMIT 10`,  // Get last 10 snapshots for analysis
    [measurementTime]
  );

  if (!rows.length) {
    console.warn(`⚠️ [persistence] No forecast snapshots found before ${measurementTimestamp}`);
    return null;
  }

  // Find the best snapshot that covers the measurement time
  const measurementMs = measurementTime.getTime();

  for (const row of rows) {
    const snapshot = row.snapshot;

    if (!snapshot || !snapshot.fullForecast || !Array.isArray(snapshot.fullForecast)) {
      continue;
    }

    // Check if this snapshot's fullForecast covers the measurement time
    // We need at least one forecast entry before and one after the measurement time
    let hasEntryBefore = false;
    let hasEntryAfter = false;

    for (const entry of snapshot.fullForecast) {
      if (!entry.dateTime) continue;

      const entryTime = new Date(entry.dateTime).getTime();

      if (entryTime <= measurementMs) {
        hasEntryBefore = true;
      }
      if (entryTime >= measurementMs) {
        hasEntryAfter = true;
      }

      if (hasEntryBefore && hasEntryAfter) {
        break;
      }
    }

    // If this snapshot covers the measurement time, use it
    if (hasEntryBefore && hasEntryAfter) {
      console.log(`✅ [persistence] Found historical forecast covering ${measurementTimestamp}`, {
        fetchedAt: row.fetched_at.toISOString(),
        forecastCount: snapshot.fullForecast.length
      });

      return {
        ...snapshot,
        fetchedAt: row.fetched_at ? row.fetched_at.toISOString() : null
      };
    }
  }

  // No snapshot covers the measurement time perfectly
  // Fall back to the most recent snapshot before measurement
  console.warn(`⚠️ [persistence] No forecast snapshot covers ${measurementTimestamp}, using most recent`);

  return {
    ...rows[0].snapshot,
    fetchedAt: rows[0].fetched_at ? rows[0].fetched_at.toISOString() : null
  };
}

async function cleanupOldProcessedMeasurements(days = 30) {
  await initSchema();
  const pool = getPool();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const result = await pool.query(
    `DELETE FROM processed_measurements WHERE created_at < $1`,
    [cutoff]
  );
  return result.rowCount;
}

/**
 * Cleanup old forecast snapshots
 *
 * Removes forecast snapshots older than specified days.
 * Keeps at least one snapshot for safety.
 *
 * @param {number} days - Number of days to retain (default: 7)
 * @returns {Promise<number>} Number of rows deleted
 */
async function cleanupOldForecastSnapshots(days = 7) {
  await initSchema();
  const pool = getPool();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Always keep at least one snapshot (the most recent)
  const result = await pool.query(
    `DELETE FROM forecast_snapshots
     WHERE fetched_at < $1
     AND id NOT IN (
       SELECT id FROM forecast_snapshots
       ORDER BY fetched_at DESC
       LIMIT 1
     )`,
    [cutoff]
  );

  console.log(`🧹 [cleanup] Deleted ${result.rowCount} old forecast snapshots (older than ${days} days)`);
  return result.rowCount;
}

async function getSystemHealthSnapshot() {
  await initSchema();
  const pool = getPool();

  const latestMeasurement = await pool.query(
    `SELECT created_at FROM processed_measurements ORDER BY created_at DESC LIMIT 1`
  );

  const measurementCount = await pool.query(
    `SELECT COUNT(*) AS count FROM processed_measurements`
  );

  const forecast = await pool.query(
    `SELECT snapshot, fetched_at FROM forecast_snapshots ORDER BY fetched_at DESC LIMIT 1`
  );

  return {
    status: 'healthy',
    lastMeasurement: latestMeasurement.rows[0]?.created_at?.toISOString() || null,
    minutesSinceLastMeasurement: latestMeasurement.rows[0]
      ? Math.floor((Date.now() - new Date(latestMeasurement.rows[0].created_at).getTime()) / 60000)
      : null,
    forecastAvailable: forecast.rows.length > 0,
    lastForecast: forecast.rows[0]?.fetched_at?.toISOString() || null,
    forecastTemp: forecast.rows[0]?.snapshot?.forecastC ?? null,
    measurementCount: Number(measurementCount.rows[0]?.count || 0),
    timestamp: new Date().toISOString()
  };
}

async function deleteAllMeasurements() {
  await initSchema();
  const pool = getPool();

  try {
    const result = await pool.query('DELETE FROM device_measurements');
    console.log(`🗑️ Deleted ${result.rowCount} device measurements`);
    return result.rowCount;
  } catch (error) {
    console.error('❌ Failed to delete device measurements:', error);
    throw error;
  }
}

async function deleteAllHistoricalWeather() {
  await initSchema();
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const historyResult = await client.query('DELETE FROM weather_history');
    const summaryResult = await client.query('DELETE FROM weather_daily_summary');

    await client.query('COMMIT');

    const totalDeleted = historyResult.rowCount + summaryResult.rowCount;
    console.log(`🗑️ Deleted ${historyResult.rowCount} weather history records and ${summaryResult.rowCount} daily summaries`);
    return totalDeleted;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to delete historical weather data:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function deleteAllData() {
  await initSchema();
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const deviceResult = await client.query('DELETE FROM device_measurements');
    const processedResult = await client.query('DELETE FROM processed_measurements');
    const controlResult = await client.query('DELETE FROM control_states');
    const scoreResult = await client.query('DELETE FROM score_logs');
    const rawResult = await client.query('DELETE FROM raw_measurements');
    const forecastResult = await client.query('DELETE FROM forecast_snapshots');
    const historyResult = await client.query('DELETE FROM weather_history');
    const summaryResult = await client.query('DELETE FROM weather_daily_summary');

    await client.query('COMMIT');

    const totalDeleted = deviceResult.rowCount + processedResult.rowCount + controlResult.rowCount +
      scoreResult.rowCount + rawResult.rowCount + forecastResult.rowCount + historyResult.rowCount + summaryResult.rowCount;
    console.log('🗑️ Deleted all data from Postgres', {
      device_measurements: deviceResult.rowCount,
      processed_measurements: processedResult.rowCount,
      control_states: controlResult.rowCount,
      score_logs: scoreResult.rowCount,
      raw_measurements: rawResult.rowCount,
      forecast_snapshots: forecastResult.rowCount,
      weather_history: historyResult.rowCount,
      weather_daily_summary: summaryResult.rowCount
    });
    return {
      device_measurements: deviceResult.rowCount,
      processed_measurements: processedResult.rowCount,
      control_states: controlResult.rowCount,
      score_logs: scoreResult.rowCount,
      raw_measurements: rawResult.rowCount,
      forecast_snapshots: forecastResult.rowCount,
      weather_history: historyResult.rowCount,
      daily_summaries: summaryResult.rowCount,
      total: totalDeleted
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to delete all data:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get recent score logs with optional filtering by node ID
 *
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of records to return (default: 50, max: 500)
 * @param {string} options.nodeId - Optional node ID filter
 * @returns {Promise<Array>} Array of score log entries
 */
async function getRecentScoreLogs({ limit = 50, nodeId = null } = {}) {
  await initSchema();
  const pool = getPool();
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 50));

  let query = `SELECT * FROM score_logs`;
  const params = [];
  if (nodeId) {
    params.push(nodeId);
    query += ` WHERE node_id = $${params.length}`;
  }
  params.push(safeLimit);
  query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

  const { rows } = await pool.query(query, params);
  return rows.map(row => ({
    id: row.id,
    nodeId: row.node_id,
    mEwma: row.m_ewma != null ? Number(row.m_ewma) : null,
    sigmaDay: row.sigma_day != null ? Number(row.sigma_day) : null,
    sErr: row.s_err != null ? Number(row.s_err) : null,
    targetRate: row.target_rate,
    createdAt: row.created_at ? row.created_at.toISOString() : null
  }));
}

module.exports = {
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
  getForecastSnapshotForMeasurementTime,
  cleanupOldProcessedMeasurements,
  cleanupOldForecastSnapshots,
  getSystemHealthSnapshot,
  deleteAllMeasurements,
  deleteAllHistoricalWeather,
  deleteAllData
};
