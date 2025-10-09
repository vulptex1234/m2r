/**
 * Measurement Processor
 *
 * Orchestrates the complete measurement processing pipeline:
 * 1. Retrieve weather forecast from cache
 * 2. Get previous control state
 * 3. Execute rate decision analysis
 * 4. Save processing results to database
 *
 * This module integrates all components needed for backend rate decision.
 */

const { IoTProcessingEngine } = require('./analytics-service');
const { getCachedForecast } = require('./weather-service');
const { getControlState, saveProcessedMeasurementBatch } = require('./persistence');

/**
 * Process measurement data with rate decision
 *
 * Main entry point for backend rate decision system.
 * Handles complete pipeline from measurement to rate decision.
 *
 * @param {Object} measurementData - Measurement data from ESP32
 * @param {string} measurementData.deviceId - Device identifier
 * @param {number} measurementData.temperature - Observed temperature
 * @param {number} measurementData.humidity - Humidity percentage
 * @param {number} measurementData.voltage - Battery voltage
 * @param {number} measurementData.current - Current draw
 * @param {number} measurementData.power - Power consumption
 * @param {string} measurementData.recordedAt - Measurement timestamp
 * @returns {Promise<Object|null>} Processing result, or null if failed
 */
async function processMeasurementWithRating(measurementData) {
  const { deviceId, temperature, humidity, voltage, current, power, recordedAt } = measurementData;

  try {
    // Step 1: Get weather forecast from cache
    const forecast = await getCachedForecast();

    if (!forecast || forecast.forecastC === null || forecast.forecastC === undefined) {
      console.warn(`⚠️ [processor] No forecast available for ${deviceId}, trying fallback strategy`);

      // Fallback strategy: Use previous rate without analysis
      const previousState = await getControlState(deviceId);

      if (previousState && previousState.targetRate) {
        console.log(`📊 [processor] Using previous rate for ${deviceId}: ${previousState.targetRate}`);

        // Return minimal result to maintain previous rate
        return {
          nodeId: deviceId,
          targetRate: previousState.targetRate,
          previousRate: previousState.targetRate,
          reason: 'forecast-unavailable-fallback',
          mode: 'FALLBACK',
          observedC: temperature,
          forecastC: null,
          measuredAt: recordedAt || new Date().toISOString()
        };
      }

      console.warn(`⚠️ [processor] No previous state for ${deviceId}, skipping rate decision`);
      return null; // First measurement without forecast
    }

    // Step 2: Get previous control state
    const previousState = await getControlState(deviceId) || {};

    console.log(`📊 [processor] Processing ${deviceId}:`, {
      temperature,
      forecastC: forecast.forecastC,
      previousRate: previousState.targetRate || 'N/A'
    });

    // Step 3: Execute rate decision analysis
    const processingResult = IoTProcessingEngine.processMeasurement(
      {
        nodeId: deviceId,
        observedC: temperature,
        batteryV: voltage,
        timestamp: recordedAt || new Date().toISOString()
      },
      previousState,
      forecast.forecastC
    );

    console.log(`📊 [processor] Rate decision for ${deviceId}:`, {
      observedC: processingResult.observedC,
      forecastC: processingResult.forecastC,
      absError: processingResult.absError,
      sErr: processingResult.sErr,
      targetRate: processingResult.targetRate,
      previousRate: processingResult.previousRate,
      reason: processingResult.reason
    });

    // Step 4: Save processing results to database
    // This updates both processed_measurements and control_states tables
    await saveProcessedMeasurementBatch(processingResult);

    console.log(`✅ [processor] Successfully processed and saved for ${deviceId}`);

    return processingResult;

  } catch (error) {
    console.error(`❌ [processor] Critical error processing ${deviceId}:`, error);

    // Error fallback: Try to use previous state
    try {
      const previousState = await getControlState(deviceId);

      if (previousState && previousState.targetRate) {
        console.warn(`⚠️ [processor] Using previous rate as error fallback for ${deviceId}: ${previousState.targetRate}`);

        return {
          nodeId: deviceId,
          targetRate: previousState.targetRate,
          previousRate: previousState.targetRate,
          reason: 'error-fallback',
          mode: 'ERROR_FALLBACK',
          observedC: temperature,
          measuredAt: recordedAt || new Date().toISOString()
        };
      }
    } catch (fallbackError) {
      console.error(`❌ [processor] Fallback also failed for ${deviceId}:`, fallbackError.message);
    }

    return null;
  }
}

/**
 * Check if measurement data can be processed
 *
 * Validates that measurement contains required fields for processing.
 *
 * @param {Object} measurementData - Measurement data
 * @returns {boolean} True if measurement can be processed
 */
function canProcessMeasurement(measurementData) {
  if (!measurementData) {
    return false;
  }

  if (!measurementData.deviceId) {
    console.warn('⚠️ [processor] Missing deviceId in measurement');
    return false;
  }

  if (measurementData.temperature === null ||
      measurementData.temperature === undefined ||
      isNaN(measurementData.temperature)) {
    console.warn(`⚠️ [processor] Invalid temperature for ${measurementData.deviceId}`);
    return false;
  }

  return true;
}

/**
 * Process multiple measurements in batch
 *
 * Useful for processing accumulated measurements.
 *
 * @param {Array<Object>} measurements - Array of measurement data
 * @returns {Promise<Array<Object>>} Array of processing results
 */
async function processMeasurementBatch(measurements) {
  if (!Array.isArray(measurements)) {
    throw new Error('measurements must be an array');
  }

  const results = [];

  for (const measurement of measurements) {
    if (!canProcessMeasurement(measurement)) {
      console.warn('⚠️ [processor] Skipping invalid measurement');
      continue;
    }

    try {
      const result = await processMeasurementWithRating(measurement);
      if (result) {
        results.push(result);
      }
    } catch (error) {
      console.error('❌ [processor] Batch processing error:', error.message);
      // Continue with next measurement
    }
  }

  console.log(`📊 [processor] Batch processed ${results.length}/${measurements.length} measurements`);
  return results;
}

module.exports = {
  processMeasurementWithRating,
  canProcessMeasurement,
  processMeasurementBatch
};
