/**
 * Unit tests for analytics-service.js
 *
 * Tests the core rate decision logic to ensure correctness
 * before integration into the backend.
 */

const {
  DiscrepancyAnalyzer,
  RateController,
  IoTProcessingEngine,
  RateLevel
} = require('./analytics-service');

describe('DiscrepancyAnalyzer', () => {
  describe('updateSamples', () => {
    test('should add new sample to empty array', () => {
      const result = DiscrepancyAnalyzer.updateSamples([], 25.5);
      expect(result).toEqual([25.5]);
    });

    test('should add new sample to existing array', () => {
      const result = DiscrepancyAnalyzer.updateSamples([24, 25], 26);
      expect(result).toEqual([24, 25, 26]);
    });

    test('should limit array size to specified limit', () => {
      const samples = Array.from({ length: 50 }, (_, i) => i);
      const result = DiscrepancyAnalyzer.updateSamples(samples, 99, 48);
      expect(result.length).toBe(48);
      expect(result[0]).toBe(3); // First element should be index 3 (50-48+1)
      expect(result[47]).toBe(99); // Last element should be the new value
    });
  });

  describe('computeSigmaDay', () => {
    test('should return default value for empty samples', () => {
      const result = DiscrepancyAnalyzer.computeSigmaDay([]);
      expect(result).toBe(1.0);
    });

    test('should calculate correct standard deviation', () => {
      const samples = [20, 22, 24, 26, 28]; // Mean = 24, Variance = 8, StdDev = 2.828...
      const result = DiscrepancyAnalyzer.computeSigmaDay(samples);
      expect(result).toBeCloseTo(2.828, 2);
    });

    test('should return non-zero for constant values', () => {
      const samples = [25, 25, 25, 25];
      const result = DiscrepancyAnalyzer.computeSigmaDay(samples);
      expect(result).toBe(1.0); // Should return default 1.0 for zero variance
    });
  });

  describe('updateEwma', () => {
    test('should return new error for first observation', () => {
      const result = DiscrepancyAnalyzer.updateEwma(null, 2.5, 0.3);
      expect(result).toBe(2.5);
    });

    test('should calculate correct EWMA', () => {
      // EWMA = 0.3 * 3.0 + 0.7 * 2.0 = 0.9 + 1.4 = 2.3
      const result = DiscrepancyAnalyzer.updateEwma(2.0, 3.0, 0.3);
      expect(result).toBeCloseTo(2.3, 2);
    });
  });

  describe('analyzeDiscrepancy', () => {
    test('should handle first measurement correctly', () => {
      const result = DiscrepancyAnalyzer.analyzeDiscrepancy(25.0, 25.5, {});

      expect(result.absError).toBe(0.5);
      expect(result.mEwma).toBe(0.5); // First observation
      expect(result.updatedSamples).toEqual([25.5]);
      expect(result.sigmaDay).toBe(1.0); // Single sample returns default
      expect(result.sErr).toBeGreaterThan(0);
      expect(result.sErr).toBeLessThan(1);
    });

    test('should calculate correct error score with history', () => {
      const previousState = {
        samples: [24, 25, 26],
        mEwma: 1.5
      };

      const result = DiscrepancyAnalyzer.analyzeDiscrepancy(25.0, 27.0, previousState);

      expect(result.absError).toBe(2.0);
      expect(result.updatedSamples).toEqual([24, 25, 26, 27]);
      expect(result.mEwma).toBeGreaterThan(1.5); // EWMA should increase
      expect(result.sErr).toBeGreaterThan(0);
      expect(result.sErr).toBeLessThan(1);
    });
  });
});

describe('RateController', () => {
  describe('rateToIndex', () => {
    test('should return correct index for each rate', () => {
      expect(RateController.rateToIndex('LOW')).toBe(0);
      expect(RateController.rateToIndex('MEDIUM')).toBe(1);
      expect(RateController.rateToIndex('HIGH')).toBe(2);
    });
  });

  describe('clampToSafetyFloor', () => {
    test('should not change rate above safety floor', () => {
      const result = RateController.clampToSafetyFloor('HIGH', 'LOW');
      expect(result).toBe('HIGH');
    });

    test('should clamp rate to safety floor', () => {
      const result = RateController.clampToSafetyFloor('LOW', 'MEDIUM');
      expect(result).toBe('MEDIUM');
    });
  });

  describe('decideRate', () => {
    test('should return HIGH for low error score', () => {
      const result = RateController.decideRate(0.3, 'MEDIUM');
      expect(result.targetRate).toBe(RateLevel.HIGH);
      expect(result.reason).toBe('escalate');
    });

    test('should return MEDIUM for mid error score', () => {
      const result = RateController.decideRate(0.6, 'MEDIUM');
      expect(result.targetRate).toBe(RateLevel.MEDIUM);
      expect(result.reason).toBe('hold');
    });

    test('should return LOW for high error score', () => {
      const result = RateController.decideRate(0.8, 'MEDIUM');
      expect(result.targetRate).toBe(RateLevel.LOW);
      expect(result.reason).toBe('de-escalate');
    });

    test('should apply hysteresis when demoting from HIGH', () => {
      // sErr = 0.50 would normally be MEDIUM, but with hysteresis from HIGH -> MEDIUM
      const result = RateController.decideRate(0.50, 'HIGH');
      expect(result.targetRate).toBe(RateLevel.MEDIUM);
      expect(result.previousRate).toBe('HIGH');
    });

    test('should apply hysteresis when demoting from MEDIUM', () => {
      // sErr = 0.75 would normally be LOW, but still below demote threshold (0.80)
      const result = RateController.decideRate(0.75, 'MEDIUM');
      expect(result.targetRate).toBe(RateLevel.MEDIUM);
      expect(result.reason).toBe('hold');
    });

    test('should respect safety floor', () => {
      const result = RateController.decideRate(0.9, 'LOW', 'MEDIUM');
      expect(result.targetRate).toBe('MEDIUM');
      expect(result.reason).toBe('safety-floor');
    });
  });
});

describe('IoTProcessingEngine', () => {
  describe('processMeasurement', () => {
    test('should process measurement with complete data', () => {
      const measurement = {
        nodeId: 'test-node-01',
        observedC: 25.5,
        batteryV: 3.7,
        timestamp: '2025-10-09T12:00:00Z'
      };

      const previousState = {
        samples: [24, 25, 26],
        mEwma: 1.0,
        targetRate: 'MEDIUM'
      };

      const result = IoTProcessingEngine.processMeasurement(
        measurement,
        previousState,
        24.0 // forecast
      );

      expect(result.nodeId).toBe('test-node-01');
      expect(result.observedC).toBe(25.5);
      expect(result.forecastC).toBe(24.0);
      expect(result.absError).toBe(1.5);
      expect(result.batteryV).toBe(3.7);
      expect(result).toHaveProperty('targetRate');
      expect(result).toHaveProperty('sErr');
      expect(result).toHaveProperty('mEwma');
      expect(result).toHaveProperty('sigmaDay');
      expect(result.mode).toBe('ACTIVE');
    });

    test('should handle first measurement correctly', () => {
      const measurement = {
        nodeId: 'test-node-02',
        observedC: 22.0,
        batteryV: 3.6,
        timestamp: '2025-10-09T12:00:00Z'
      };

      const result = IoTProcessingEngine.processMeasurement(
        measurement,
        {}, // No previous state
        22.5 // forecast
      );

      expect(result.nodeId).toBe('test-node-02');
      expect(result.absError).toBe(0.5);
      expect(result.previousRate).toBe('LOW'); // Default
      expect(result.updatedSamples).toEqual([22.0]);
    });

    test('should handle missing battery voltage', () => {
      const measurement = {
        nodeId: 'test-node-03',
        observedC: 20.0,
        batteryV: null,
        timestamp: '2025-10-09T12:00:00Z'
      };

      const result = IoTProcessingEngine.processMeasurement(
        measurement,
        {},
        20.0
      );

      expect(result.batteryV).toBeNull();
      expect(result.targetRate).toBeDefined();
    });

    test('should detect anomaly and escalate to HIGH', () => {
      const measurement = {
        nodeId: 'test-node-04',
        observedC: 35.0, // Large deviation
        batteryV: 3.5,
        timestamp: '2025-10-09T12:00:00Z'
      };

      const previousState = {
        samples: [24, 25, 24, 25, 24], // Stable around 24-25
        mEwma: 0.5,
        targetRate: 'LOW'
      };

      const result = IoTProcessingEngine.processMeasurement(
        measurement,
        previousState,
        25.0 // forecast is 25, but observed is 35
      );

      expect(result.absError).toBe(10.0);
      expect(result.sErr).toBeLessThan(0.45); // Should trigger HIGH
      expect(result.targetRate).toBe('HIGH');
      expect(result.reason).toBe('escalate');
    });
  });
});
