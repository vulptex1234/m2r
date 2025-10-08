// Statistical Analysis Engine - JavaScript port of Functions logic
import { appConfig } from './app-config.js';

export const RateLevel = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH"
};

const rateOrder = [RateLevel.LOW, RateLevel.MEDIUM, RateLevel.HIGH];

// Port of discrepancy.ts functions
export class DiscrepancyAnalyzer {
  /**
   * Update exponentially weighted moving average
   * @param {number|undefined} prev - Previous EWMA value
   * @param {number} absError - Current absolute error
   * @param {number} alpha - Alpha parameter (default from config)
   * @returns {number} Updated EWMA
   */
  static updateEwma(prev, absError, alpha = appConfig.control.alpha) {
    if (!Number.isFinite(prev)) {
      return absError;
    }
    return alpha * absError + (1 - alpha) * prev;
  }

  /**
   * Update sample array with new value, maintaining size limit
   * @param {number[]|undefined} samples - Previous samples
   * @param {number} newValue - New measurement value
   * @param {number} limit - Maximum sample count
   * @returns {number[]} Updated samples array
   */
  static updateSamples(samples, newValue, limit = appConfig.control.sampleLimit) {
    const next = Array.isArray(samples) ? [...samples, newValue] : [newValue];
    if (next.length > limit) {
      next.splice(0, next.length - limit);
    }
    return next;
  }

  /**
   * Compute standard deviation from samples
   * @param {number[]} samples - Sample measurements
   * @returns {number} Standard deviation (sigma)
   */
  static computeSigmaDay(samples) {
    if (samples.length === 0) {
      return 0.1;
    }
    const mean = samples.reduce((acc, value) => acc + value, 0) / samples.length;
    const variance = samples.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) / samples.length;
    const sigma = Math.sqrt(variance);
    return Number.isFinite(sigma) && sigma > 0 ? sigma : 0.1;
  }

  /**
   * Ensure value is finite, fallback if not
   * @param {number} value - Value to check
   * @param {number} fallback - Fallback value
   * @returns {number} Finite value or fallback
   */
  static ensureFinite(value, fallback) {
    return Number.isFinite(value) && !Number.isNaN(value) ? value : fallback;
  }

  /**
   * Calculate complete measurement analysis
   * @param {number} forecastC - Forecast temperature
   * @param {number} observedC - Observed temperature
   * @param {Object} previousState - Previous node state
   * @returns {Object} Complete analysis result
   */
  static analyzeDiscrepancy(forecastC, observedC, previousState = {}) {
    const absError = Math.abs(forecastC - observedC);
    const prevSamples = Array.isArray(previousState.samples) ? previousState.samples : [];
    const updatedSamples = this.updateSamples(prevSamples, observedC);
    const sigmaDay = this.computeSigmaDay(updatedSamples);
    const mEwma = this.updateEwma(previousState.mEwma, absError);
    const r = mEwma / Math.max(sigmaDay, 0.1);
    const sErr = Math.exp(-r);

    return {
      absError,
      updatedSamples,
      sigmaDay,
      mEwma,
      r,
      sErr
    };
  }
}

// Port of rateController.ts functions
export class RateController {
  /**
   * Convert rate level to numeric index
   * @param {string} rate - Rate level string
   * @returns {number} Index in rate order
   */
  static rateToIndex(rate) {
    return rateOrder.indexOf(rate);
  }

  /**
   * Clamp rate to safety floor minimum
   * @param {string} rate - Target rate
   * @param {string} safetyFloor - Minimum allowed rate
   * @returns {string} Clamped rate
   */
  static clampToSafetyFloor(rate, safetyFloor) {
    const targetIndex = this.rateToIndex(rate);
    const floorIndex = this.rateToIndex(safetyFloor);
    return rateOrder[Math.max(targetIndex, floorIndex)] ?? safetyFloor;
  }

  /**
   * Decide optimal rate based on system error
   * @param {number} sErr - System error score
   * @param {string} previousRate - Previous rate level
   * @param {string} safetyFloor - Safety floor rate
   * @returns {Object} Rate decision with reasoning
   */
  static decideRate(sErr, previousRate, safetyFloor = appConfig.control.safetyFloor) {
    const { thresholds } = appConfig.control;

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
      previousRate,
      reason
    };
  }
}

// Main processing engine that combines both analyzers
export class IoTProcessingEngine {
  /**
   * Process complete measurement cycle
   * @param {Object} measurementData - Raw measurement data
   * @param {Object} previousState - Previous node state
   * @param {number} forecastC - Current forecast temperature
   * @returns {Object} Complete processing result
   */
  static processMeasurement(measurementData, previousState = {}, forecastC) {
    const { nodeId, observedC, batteryV, timestamp } = measurementData;

    // Validate inputs
    if (!nodeId || !Number.isFinite(observedC)) {
      throw new Error('Invalid measurement data: nodeId and observedC required');
    }

    if (!Number.isFinite(forecastC)) {
      // Fallback mode
      const fallbackRate = previousState.targetRate || RateLevel.MEDIUM;
      return {
        nodeId,
        mode: "FALLBACK",
        targetRate: fallbackRate,
        previousRate: previousState.targetRate || RateLevel.LOW,
        reason: "forecast-missing",
        timestamp: timestamp || new Date().toISOString(),
        batteryV
      };
    }

    // Run statistical analysis
    const analysis = DiscrepancyAnalyzer.analyzeDiscrepancy(
      forecastC,
      observedC,
      previousState
    );

    // Make rate decision
    const decision = RateController.decideRate(
      analysis.sErr,
      previousState.targetRate || RateLevel.LOW,
      appConfig.control.safetyFloor
    );

    // Prepare complete result
    return {
      nodeId,
      measuredAt: timestamp || new Date().toISOString(),
      forecastC,
      observedC,
      batteryV,
      ...analysis,
      ...decision,
      safetyFloor: appConfig.control.safetyFloor,
      mode: "ACTIVE"
    };
  }

  /**
   * Validate rate level string
   * @param {any} value - Value to validate
   * @returns {boolean} True if valid rate level
   */
  static isValidRateLevel(value) {
    return typeof value === 'string' && rateOrder.includes(value);
  }
}

// Export all classes and constants
export { appConfig };

// Debug logging utility
export const AnalyticsLogger = {
  log: (message, data = {}) => {
    if (appConfig.ui.enableDebugLogs) {
      console.log(`📊 [Analytics] ${message}`, data);
    }
  },

  error: (message, error = {}) => {
    console.error(`❌ [Analytics] ${message}`, error);
  },

  performance: (label, startTime) => {
    if (appConfig.ui.enableDebugLogs) {
      const duration = performance.now() - startTime;
      console.log(`⚡ [Performance] ${label}: ${duration.toFixed(2)}ms`);
    }
  }
};