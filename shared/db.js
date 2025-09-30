const path = require('path');

function loadPg() {
  const candidates = [
    () => require('pg'),
    () => require(path.resolve(__dirname, '../web-service/node_modules/pg')),
    () => require(path.resolve(__dirname, '../cron-job/node_modules/pg'))
  ];

  let lastError;
  for (const loader of candidates) {
    try {
      return loader();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('pg module not found');
}

const { Pool } = loadPg();

let pool;

function ensureDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required for database access');
  }
  return url;
}

function getPool() {
  if (!pool) {
    const connectionString = ensureDatabaseUrl();
    const sslMode = process.env.PGSSLMODE || process.env.PG_SSL_MODE || process.env.PG_SSL || '';
    const needsSsl = ['require', 'true', '1'].includes(sslMode.toLowerCase?.() || sslMode);

    pool = new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}

async function initSchema() {
  const pg = getPool();
  await pg.query(`
    CREATE TABLE IF NOT EXISTS weather_history (
      date DATE NOT NULL,
      hour SMALLINT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (date, hour)
    );
  `);

  await pg.query(`
    CREATE TABLE IF NOT EXISTS weather_daily_summary (
      date DATE PRIMARY KEY,
      summary JSONB NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pg.query(`
    CREATE TABLE IF NOT EXISTS device_measurements (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL,
      temperature NUMERIC,
      humidity NUMERIC,
      recorded_at TIMESTAMPTZ,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pg.query(`
    CREATE TABLE IF NOT EXISTS control_states (
      node_id TEXT PRIMARY KEY,
      target_rate TEXT,
      previous_rate TEXT,
      m_ewma NUMERIC,
      sigma_day NUMERIC,
      samples JSONB,
      s_err NUMERIC,
      last_observed_c NUMERIC,
      last_forecast_c NUMERIC,
      last_updated_at TIMESTAMPTZ,
      reason TEXT,
      mode TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pg.query(`
    CREATE TABLE IF NOT EXISTS processed_measurements (
      id SERIAL PRIMARY KEY,
      node_id TEXT NOT NULL,
      observed_c NUMERIC,
      forecast_c NUMERIC,
      abs_error NUMERIC,
      battery_v NUMERIC,
      s_err NUMERIC,
      target_rate TEXT,
      recorded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_processed_measurements_recorded_at
      ON processed_measurements (recorded_at DESC);
  `);

  await pg.query(`
    CREATE TABLE IF NOT EXISTS score_logs (
      id SERIAL PRIMARY KEY,
      node_id TEXT,
      m_ewma NUMERIC,
      sigma_day NUMERIC,
      s_err NUMERIC,
      target_rate TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pg.query(`
    CREATE TABLE IF NOT EXISTS raw_measurements (
      id SERIAL PRIMARY KEY,
      device_id TEXT,
      payload JSONB,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_raw_measurements_received_at
      ON raw_measurements (received_at DESC);
  `);

  await pg.query(`
    CREATE TABLE IF NOT EXISTS forecast_snapshots (
      id SERIAL PRIMARY KEY,
      snapshot JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

module.exports = {
  getPool,
  initSchema
};
