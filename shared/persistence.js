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

module.exports = {
  upsertHistoricalDay,
  insertDeviceMeasurement,
  getRecentDeviceMeasurements
};
