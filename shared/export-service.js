const { getPool, initSchema } = require('./db');

/**
 * Adds UTF-8 BOM (Byte Order Mark) to CSV string for proper Excel compatibility
 *
 * The BOM ensures that Excel correctly interprets the file as UTF-8 encoded,
 * preventing character encoding issues with Japanese and other non-ASCII characters.
 *
 * @param {string} csvString - The CSV content string
 * @returns {string} CSV string with UTF-8 BOM prefix
 */
function addBOM(csvString) {
  return '\uFEFF' + csvString;
}

/**
 * Escapes CSV field values to handle special characters
 *
 * Wraps fields containing commas, quotes, or newlines in double quotes
 * and escapes any existing quotes by doubling them.
 *
 * @param {*} value - The field value to escape
 * @returns {string} Properly escaped CSV field value
 */
function escapeCSVField(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Converts array of objects to CSV format
 *
 * @param {Array<Object>} rows - Array of data objects
 * @param {Array<string>} headers - Column headers
 * @param {Function} rowMapper - Function to map each row object to array of values
 * @returns {string} CSV formatted string
 */
function arrayToCSV(rows, headers, rowMapper) {
  const csvLines = [];

  // Add header row
  csvLines.push(headers.map(escapeCSVField).join(','));

  // Add data rows
  for (const row of rows) {
    const values = rowMapper(row);
    csvLines.push(values.map(escapeCSVField).join(','));
  }

  return csvLines.join('\n');
}

/**
 * Generates CSV export for device_measurements table
 *
 * Exports raw sensor data received from ESP32 devices including temperature,
 * humidity, voltage, current, and power measurements.
 *
 * @param {Object} options - Export options
 * @param {string} options.startDate - Start date (ISO format, optional)
 * @param {string} options.endDate - End date (ISO format, optional)
 * @param {string} options.deviceId - Filter by device ID (optional)
 * @param {number} options.limit - Maximum number of records (default: 10000)
 * @returns {Promise<string>} CSV formatted string with UTF-8 BOM
 */
async function generateDeviceMeasurementsCSV(options = {}) {
  await initSchema();
  const pool = getPool();

  const { startDate, endDate, deviceId, limit = 10000 } = options;
  const params = [];
  const conditions = [];

  let query = `
    SELECT
      id,
      device_id,
      temperature,
      humidity,
      recorded_at,
      payload,
      created_at
    FROM device_measurements
  `;

  // Apply filters
  if (deviceId) {
    params.push(deviceId);
    conditions.push(`device_id = $${params.length}`);
  }

  if (startDate) {
    params.push(new Date(startDate));
    conditions.push(`COALESCE(recorded_at, created_at) >= $${params.length}`);
  }

  if (endDate) {
    params.push(new Date(endDate));
    conditions.push(`COALESCE(recorded_at, created_at) <= $${params.length}`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ` ORDER BY COALESCE(recorded_at, created_at) ASC`;

  params.push(Math.min(50000, Math.max(1, Number(limit))));
  query += ` LIMIT $${params.length}`;

  const { rows } = await pool.query(query, params);

  const headers = [
    'ID',
    'Device ID',
    'Temperature (°C)',
    'Humidity (%)',
    'Recorded At',
    'Voltage (V)',
    'Current (mA)',
    'Power (mW)',
    'Created At'
  ];

  const csv = arrayToCSV(rows, headers, (row) => [
    row.id,
    row.device_id,
    row.temperature != null ? Number(row.temperature).toFixed(2) : '',
    row.humidity != null ? Number(row.humidity).toFixed(2) : '',
    row.recorded_at ? row.recorded_at.toISOString() : '',
    row.payload?.voltage_v != null ? Number(row.payload.voltage_v).toFixed(3) : '',
    row.payload?.current_ma != null ? Number(row.payload.current_ma).toFixed(2) : '',
    row.payload?.power_mw != null ? Number(row.payload.power_mw).toFixed(2) : '',
    row.created_at ? row.created_at.toISOString() : ''
  ]);

  return addBOM(csv);
}

/**
 * Generates CSV export for processed_measurements table
 *
 * Exports processed sensor data including forecast comparison, error analysis,
 * and rate control decisions.
 *
 * @param {Object} options - Export options
 * @param {string} options.startDate - Start date (ISO format, optional)
 * @param {string} options.endDate - End date (ISO format, optional)
 * @param {string} options.nodeId - Filter by node ID (optional)
 * @param {number} options.limit - Maximum number of records (default: 10000)
 * @returns {Promise<string>} CSV formatted string with UTF-8 BOM
 */
async function generateProcessedMeasurementsCSV(options = {}) {
  await initSchema();
  const pool = getPool();

  const { startDate, endDate, nodeId, limit = 10000 } = options;
  const params = [];
  const conditions = [];

  let query = `
    SELECT
      id,
      node_id,
      observed_c,
      forecast_c,
      abs_error,
      battery_v,
      s_err,
      target_rate,
      recorded_at,
      created_at
    FROM processed_measurements
  `;

  // Apply filters
  if (nodeId) {
    params.push(nodeId);
    conditions.push(`node_id = $${params.length}`);
  }

  if (startDate) {
    params.push(new Date(startDate));
    conditions.push(`COALESCE(recorded_at, created_at) >= $${params.length}`);
  }

  if (endDate) {
    params.push(new Date(endDate));
    conditions.push(`COALESCE(recorded_at, created_at) <= $${params.length}`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ` ORDER BY COALESCE(recorded_at, created_at) ASC`;

  params.push(Math.min(50000, Math.max(1, Number(limit))));
  query += ` LIMIT $${params.length}`;

  const { rows } = await pool.query(query, params);

  const headers = [
    'ID',
    'Node ID',
    'Observed (°C)',
    'Forecast (°C)',
    'Abs Error (°C)',
    'Battery (V)',
    'Error Score',
    'Target Rate',
    'Recorded At',
    'Created At'
  ];

  const csv = arrayToCSV(rows, headers, (row) => [
    row.id,
    row.node_id,
    row.observed_c != null ? Number(row.observed_c).toFixed(2) : '',
    row.forecast_c != null ? Number(row.forecast_c).toFixed(2) : '',
    row.abs_error != null ? Number(row.abs_error).toFixed(2) : '',
    row.battery_v != null ? Number(row.battery_v).toFixed(3) : '',
    row.s_err != null ? Number(row.s_err).toFixed(4) : '',
    row.target_rate || '',
    row.recorded_at ? row.recorded_at.toISOString() : '',
    row.created_at ? row.created_at.toISOString() : ''
  ]);

  return addBOM(csv);
}

/**
 * Generates CSV export for control_states table
 *
 * Exports current control state for all nodes including rate decisions,
 * statistical parameters, and sample history.
 *
 * @param {Object} options - Export options
 * @param {string} options.nodeId - Filter by node ID (optional)
 * @returns {Promise<string>} CSV formatted string with UTF-8 BOM
 */
async function generateControlStatesCSV(options = {}) {
  await initSchema();
  const pool = getPool();

  const { nodeId } = options;
  const params = [];

  let query = `
    SELECT
      node_id,
      target_rate,
      previous_rate,
      m_ewma,
      sigma_day,
      samples,
      s_err,
      last_observed_c,
      last_forecast_c,
      last_updated_at,
      reason,
      mode,
      updated_at
    FROM control_states
  `;

  if (nodeId) {
    params.push(nodeId);
    query += ` WHERE node_id = $${params.length}`;
  }

  query += ` ORDER BY node_id ASC`;

  const { rows } = await pool.query(query, params);

  const headers = [
    'Node ID',
    'Target Rate',
    'Previous Rate',
    'M EWMA',
    'Sigma Day',
    'Sample Count',
    'Error Score',
    'Last Observed (°C)',
    'Last Forecast (°C)',
    'Last Updated At',
    'Reason',
    'Mode',
    'Updated At'
  ];

  const csv = arrayToCSV(rows, headers, (row) => [
    row.node_id,
    row.target_rate || '',
    row.previous_rate || '',
    row.m_ewma != null ? Number(row.m_ewma).toFixed(4) : '',
    row.sigma_day != null ? Number(row.sigma_day).toFixed(4) : '',
    row.samples ? (Array.isArray(row.samples) ? row.samples.length : JSON.stringify(row.samples).length) : '0',
    row.s_err != null ? Number(row.s_err).toFixed(4) : '',
    row.last_observed_c != null ? Number(row.last_observed_c).toFixed(2) : '',
    row.last_forecast_c != null ? Number(row.last_forecast_c).toFixed(2) : '',
    row.last_updated_at ? row.last_updated_at.toISOString() : '',
    row.reason || '',
    row.mode || '',
    row.updated_at ? row.updated_at.toISOString() : ''
  ]);

  return addBOM(csv);
}

/**
 * Generates CSV export for weather_history table
 *
 * Exports historical weather data with hourly granularity.
 *
 * @param {Object} options - Export options
 * @param {string} options.startDate - Start date (YYYY-MM-DD format, optional)
 * @param {string} options.endDate - End date (YYYY-MM-DD format, optional)
 * @param {number} options.limit - Maximum number of records (default: 10000)
 * @returns {Promise<string>} CSV formatted string with UTF-8 BOM
 */
async function generateWeatherHistoryCSV(options = {}) {
  await initSchema();
  const pool = getPool();

  const { startDate, endDate, limit = 10000 } = options;
  const params = [];
  const conditions = [];

  let query = `
    SELECT
      date,
      hour,
      payload,
      created_at
    FROM weather_history
  `;

  // Apply filters
  if (startDate) {
    params.push(startDate);
    conditions.push(`date >= $${params.length}`);
  }

  if (endDate) {
    params.push(endDate);
    conditions.push(`date <= $${params.length}`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ` ORDER BY date ASC, hour ASC`;

  params.push(Math.min(50000, Math.max(1, Number(limit))));
  query += ` LIMIT $${params.length}`;

  const { rows } = await pool.query(query, params);

  const headers = [
    'Date',
    'Hour',
    'Temperature (°C)',
    'Humidity (%)',
    'Pressure (hPa)',
    'Weather',
    'Timestamp',
    'Created At'
  ];

  const csv = arrayToCSV(rows, headers, (row) => {
    const payload = row.payload || {};
    return [
      row.date instanceof Date ? row.date.toISOString().split('T')[0] : row.date,
      row.hour,
      payload.temp != null ? Number(payload.temp).toFixed(2) : '',
      payload.humidity != null ? Number(payload.humidity).toFixed(1) : '',
      payload.pressure != null ? Number(payload.pressure).toFixed(1) : '',
      payload.weather || '',
      payload.timestamp || '',
      row.created_at ? row.created_at.toISOString() : ''
    ];
  });

  return addBOM(csv);
}

/**
 * Generates filename for CSV export with date range
 *
 * @param {string} dataType - Type of data being exported
 * @param {string} startDate - Start date (optional)
 * @param {string} endDate - End date (optional)
 * @returns {string} Formatted filename
 */
function generateExportFilename(dataType, startDate = null, endDate = null) {
  const timestamp = new Date().toISOString().split('T')[0];

  if (startDate && endDate) {
    const start = startDate.split('T')[0];
    const end = endDate.split('T')[0];
    return `${dataType}_${start}_to_${end}.csv`;
  }

  if (startDate) {
    const start = startDate.split('T')[0];
    return `${dataType}_from_${start}.csv`;
  }

  return `${dataType}_export_${timestamp}.csv`;
}

module.exports = {
  generateDeviceMeasurementsCSV,
  generateProcessedMeasurementsCSV,
  generateControlStatesCSV,
  generateWeatherHistoryCSV,
  generateExportFilename
};
