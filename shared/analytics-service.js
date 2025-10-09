/**
 * Shared Analytics Service
 *
 * Server-side implementation of rate decision logic.
 * Mirrors the logic in public/js/analytics-engine.js for consistency.
 *
 * This module provides:
 * - DiscrepancyAnalyzer: Statistical analysis of forecast vs. observed data
 * - RateController: Rate decision algorithm (LOW/MEDIUM/HIGH)
 * - IoTProcessingEngine: Complete measurement processing pipeline
 */

/**
 * Rate levels in ascending order
 */
const RateLevel = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH'
};

const rateOrder = [RateLevel.LOW, RateLevel.MEDIUM, RateLevel.HIGH];

/**
 * Default configuration
 * Must be synchronized with frontend app-config.js
 */
const DEFAULT_CONFIG = {
  alpha: 0.3,              // EWMA coefficient
  sampleLimit: 48,         // Sample window size (2 days @ 1 hour intervals)
  safetyFloor: 'LOW',      // Minimum allowed rate
  thresholds: {
    escalateHigh: 0.45,    // Escalate to HIGH if sErr < 0.45
    escalateMedium: 0.70,  // Escalate to MEDIUM if sErr < 0.70
    demoteFromHigh: 0.55,  // Demote from HIGH if sErr > 0.55
    demoteFromMedium: 0.80 // Demote from MEDIUM if sErr >= 0.80
  }
};

/**
 * Discrepancy Analyzer
 *
 * Analyzes the difference between forecast and observed temperatures
 * using EWMA (Exponentially Weighted Moving Average) and standard deviation.
 */
class DiscrepancyAnalyzer {
  /**
   * Update sample array with new observation
   *
   * Maintains a sliding window of recent observations for statistical analysis.
   *
   * @param {Array<number>} previousSamples - Previous sample array
   * @param {number} newObservedC - New observed temperature
   * @param {number} limit - Maximum samples to keep
   * @returns {Array<number>} Updated sample array
   */
  static updateSamples(previousSamples, newObservedC, limit = DEFAULT_CONFIG.sampleLimit) {
    const samples = Array.isArray(previousSamples) ? [...previousSamples] : [];
    samples.push(newObservedC);

    // Keep only the most recent samples
    if (samples.length > limit) {
      return samples.slice(-limit);
    }

    return samples;
  }

  /**
   * Compute daily standard deviation from samples
   *
   * Standard deviation represents the natural variability in temperature
   * observations, used to normalize the error metric.
   *
   * @param {Array<number>} samples - Temperature samples
   * @returns {number} Standard deviation (sigma)
   */
  static computeSigmaDay(samples) {
    if (!Array.isArray(samples) || samples.length === 0) {
      return 1.0; // Default value to avoid division by zero
    }

    const n = samples.length;
    const mean = samples.reduce((sum, val) => sum + val, 0) / n;
    const variance = samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const sigma = Math.sqrt(variance);

    return sigma > 0 ? sigma : 1.0; // Ensure non-zero
  }

  /**
   * Update EWMA (Exponentially Weighted Moving Average)
   *
   * EWMA smooths error values over time, giving more weight to recent errors.
   * Formula: EWMA_new = alpha * error + (1 - alpha) * EWMA_old
   *
   * @param {number} previousEwma - Previous EWMA value
   * @param {number} newError - New error value
   * @param {number} alpha - EWMA coefficient (0 < alpha < 1)
   * @returns {number} Updated EWMA
   */
  static updateEwma(previousEwma, newError, alpha = DEFAULT_CONFIG.alpha) {
    if (previousEwma === null || previousEwma === undefined || isNaN(previousEwma)) {
      return newError; // First observation
    }

    return alpha * newError + (1 - alpha) * previousEwma;
  }

  /**
   * Analyze discrepancy between forecast and observed temperature
   *
   * Calculates an error score (sErr) that indicates how well the forecast
   * matches observations. Score ranges from 0 (bad) to 1 (good).
   *
   * @param {number} forecastC - Forecast temperature (Celsius)
   * @param {number} observedC - Observed temperature (Celsius)
   * @param {Object} previousState - Previous analysis state
   * @param {Array<number>} previousState.samples - Previous samples
   * @param {number} previousState.mEwma - Previous EWMA value
   * @returns {Object} Analysis result with error metrics
   */
  static analyzeDiscrepancy(forecastC, observedC, previousState = {}) {
    // Calculate absolute error
    const absError = Math.abs(forecastC - observedC);

    // Update sample window
    const updatedSamples = this.updateSamples(
      previousState.samples || [],
      observedC
    );

    // Calculate daily standard deviation
    const sigmaDay = this.computeSigmaDay(updatedSamples);

    // Update EWMA of errors
    const mEwma = this.updateEwma(previousState.mEwma, absError);

    // Calculate normalized error ratio
    const r = mEwma / Math.max(sigmaDay, 0.1);

    // Calculate error score: exp(-r)
    // sErr = 1 when mEwma = 0 (perfect prediction)
    // sErr → 0 as r → ∞ (large errors)
    const sErr = Math.exp(-r);

    return {
      absError: parseFloat(absError.toFixed(4)),
      updatedSamples,
      sigmaDay: parseFloat(sigmaDay.toFixed(4)),
      mEwma: parseFloat(mEwma.toFixed(4)),
      r: parseFloat(r.toFixed(4)),
      sErr: parseFloat(sErr.toFixed(4))
    };
  }
}

/**
 * Rate Controller
 *
 * Decides optimal sampling rate (LOW/MEDIUM/HIGH) based on error score.
 * Implements hysteresis to prevent oscillation between rates.
 */
class RateController {
  /**
   * Convert rate level to numeric index
   *
   * @param {string} rate - Rate level
   * @returns {number} Index in rate order
   */
  static rateToIndex(rate) {
    return rateOrder.indexOf(rate);
  }

  /**
   * Clamp rate to safety floor minimum
   *
   * Ensures rate never falls below the configured safety floor.
   *
   * @param {string} rate - Target rate
   * @param {string} safetyFloor - Minimum allowed rate
   * @returns {string} Clamped rate
   */
  static clampToSafetyFloor(rate, safetyFloor) {
    const targetIndex = this.rateToIndex(rate);
    const floorIndex = this.rateToIndex(safetyFloor);
    return rateOrder[Math.max(targetIndex, floorIndex)] || safetyFloor;
  }

  /**
   * Decide optimal rate based on error score
   *
   * Decision logic:
   * - sErr < 0.45: HIGH (forecast unreliable, increase monitoring)
   * - sErr < 0.70: MEDIUM (normal operation)
   * - sErr >= 0.70: LOW (forecast accurate, reduce monitoring)
   *
   * Hysteresis prevents rapid oscillation:
   * - When demoting from HIGH, require sErr > 0.55
   * - When demoting from MEDIUM, require sErr >= 0.80
   *
   * @param {number} sErr - Error score (0 = bad, 1 = good)
   * @param {string} previousRate - Previous rate level
   * @param {string} safetyFloor - Minimum allowed rate
   * @param {Object} config - Configuration object
   * @returns {Object} Rate decision with reasoning
   */
  static decideRate(sErr, previousRate, safetyFloor = DEFAULT_CONFIG.safetyFloor, config = DEFAULT_CONFIG) {
    const { thresholds } = config;

    // Initial candidate based on thresholds
    let candidate;
    if (sErr < thresholds.escalateHigh) {
      candidate = RateLevel.HIGH;
    } else if (sErr < thresholds.escalateMedium) {
      candidate = RateLevel.MEDIUM;
    } else {
      candidate = RateLevel.LOW;
    }

    // Apply hysteresis for downgrades (prevent oscillation)
    if (previousRate === RateLevel.HIGH && sErr > thresholds.demoteFromHigh) {
      candidate = RateLevel.MEDIUM;
    }
    if (previousRate === RateLevel.MEDIUM && sErr >= thresholds.demoteFromMedium) {
      candidate = RateLevel.LOW;
    }

    // Apply safety floor
    const targetRate = this.clampToSafetyFloor(candidate, safetyFloor);

    // Determine reasoning
    let reason = "baseline-threshold";
    if (targetRate !== candidate) {
      reason = "safety-floor";
    } else if (targetRate !== previousRate) {
      reason = targetRate === RateLevel.HIGH ? "escalate" : "de-escalate";
    } else {
      reason = "hold";
    }

    return {
      targetRate,
      previousRate: previousRate || RateLevel.LOW,
      reason
    };
  }
}

/**
 * IoT Processing Engine
 *
 * Complete measurement processing pipeline that combines
 * discrepancy analysis and rate decision.
 */
class IoTProcessingEngine {
  /**
   * Process measurement data and determine optimal rate
   *
   * This is the main entry point for measurement processing.
   * It orchestrates the entire analysis and decision pipeline.
   *
   * @param {Object} measurementData - Measurement data
   * @param {string} measurementData.nodeId - Device/node identifier
   * @param {number} measurementData.observedC - Observed temperature
   * @param {number} measurementData.batteryV - Battery voltage
   * @param {string} measurementData.timestamp - Measurement timestamp
   * @param {Object} previousState - Previous analysis state
   * @param {number} forecastC - Forecast temperature
   * @returns {Object} Complete processing result
   */
  static processMeasurement(measurementData, previousState, forecastC) {
    const { nodeId, observedC, batteryV, timestamp } = measurementData;

    // Perform discrepancy analysis
    const { absError, updatedSamples, sigmaDay, mEwma, r, sErr } =
      DiscrepancyAnalyzer.analyzeDiscrepancy(forecastC, observedC, previousState);

    // Decide optimal rate
    const { targetRate, previousRate, reason } =
      RateController.decideRate(sErr, previousState.targetRate || RateLevel.LOW);

    // Return complete result
    return {
      nodeId,
      observedC: parseFloat(observedC.toFixed(2)),
      forecastC: parseFloat(forecastC.toFixed(2)),
      absError,
      batteryV: batteryV ? parseFloat(batteryV.toFixed(3)) : null,
      sErr,
      targetRate,
      previousRate,
      reason,
      mEwma,
      sigmaDay,
      updatedSamples,
      samples: updatedSamples, // Alias for persistence.js compatibility
      measuredAt: timestamp || new Date().toISOString(),
      mode: 'ACTIVE'
    };
  }
}

module.exports = {
  RateLevel,
  DiscrepancyAnalyzer,
  RateController,
  IoTProcessingEngine,
  DEFAULT_CONFIG
};
