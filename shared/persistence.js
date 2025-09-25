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

module.exports = {
  upsertHistoricalDay
};
