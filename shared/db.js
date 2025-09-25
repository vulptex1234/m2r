const { Pool } = require('pg');

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
}

module.exports = {
  getPool,
  initSchema
};
