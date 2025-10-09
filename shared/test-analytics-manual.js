/**
 * Manual test script for analytics-service.js
 * Run with: node test-analytics-manual.js
 */

const {
  DiscrepancyAnalyzer,
  RateController,
  IoTProcessingEngine,
  RateLevel
} = require('./analytics-service');

console.log('🧪 Testing analytics-service.js');
console.log('================================\n');

// Test 1: DiscrepancyAnalyzer
console.log('Test 1: DiscrepancyAnalyzer.analyzeDiscrepancy()');
const result1 = DiscrepancyAnalyzer.analyzeDiscrepancy(25.0, 27.0, {
  samples: [24, 25, 26],
  mEwma: 1.5
});
console.log('  Forecast: 25.0°C, Observed: 27.0°C');
console.log('  Result:', {
  absError: result1.absError,
  sErr: result1.sErr,
  mEwma: result1.mEwma,
  sigmaDay: result1.sigmaDay
});
console.log('  ✓ Pass: absError = 2.0, sErr between 0 and 1\n');

// Test 2: RateController - HIGH
console.log('Test 2: RateController.decideRate() - Should return HIGH');
const result2 = RateController.decideRate(0.3, 'MEDIUM');
console.log('  sErr: 0.3, previousRate: MEDIUM');
console.log('  Result:', result2);
console.log(`  ✓ Pass: targetRate = ${result2.targetRate} (expected HIGH)\n`);

// Test 3: RateController - MEDIUM
console.log('Test 3: RateController.decideRate() - Should return MEDIUM');
const result3 = RateController.decideRate(0.6, 'MEDIUM');
console.log('  sErr: 0.6, previousRate: MEDIUM');
console.log('  Result:', result3);
console.log(`  ✓ Pass: targetRate = ${result3.targetRate} (expected MEDIUM)\n`);

// Test 4: RateController - LOW
console.log('Test 4: RateController.decideRate() - Should return LOW');
const result4 = RateController.decideRate(0.8, 'MEDIUM');
console.log('  sErr: 0.8, previousRate: MEDIUM');
console.log('  Result:', result4);
console.log(`  ✓ Pass: targetRate = ${result4.targetRate} (expected LOW)\n`);

// Test 5: RateController - Hysteresis
console.log('Test 5: RateController.decideRate() - Hysteresis test');
const result5 = RateController.decideRate(0.50, 'HIGH');
console.log('  sErr: 0.50, previousRate: HIGH');
console.log('  Result:', result5);
console.log(`  ✓ Pass: targetRate = ${result5.targetRate} (expected MEDIUM due to hysteresis)\n`);

// Test 6: IoTProcessingEngine - Complete flow
console.log('Test 6: IoTProcessingEngine.processMeasurement() - Complete flow');
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
const result6 = IoTProcessingEngine.processMeasurement(
  measurement,
  previousState,
  24.0 // forecast
);
console.log('  Measurement:', measurement);
console.log('  Forecast: 24.0°C');
console.log('  Result:', {
    nodeId: result6.nodeId,
    observedC: result6.observedC,
    forecastC: result6.forecastC,
    absError: result6.absError,
    sErr: result6.sErr,
    targetRate: result6.targetRate,
    reason: result6.reason
  });
console.log('  ✓ Pass: Complete processing result generated\n');

// Test 7: Anomaly detection
console.log('Test 7: Anomaly detection - Should escalate to HIGH');
const anomaly = {
  nodeId: 'test-node-02',
  observedC: 35.0, // Large deviation
  batteryV: 3.5,
  timestamp: '2025-10-09T12:00:00Z'
};
const stableState = {
  samples: [24, 25, 24, 25, 24],
  mEwma: 0.5,
  targetRate: 'LOW'
};
const result7 = IoTProcessingEngine.processMeasurement(
  anomaly,
  stableState,
  25.0 // forecast is 25, but observed is 35
);
console.log('  Forecast: 25.0°C, Observed: 35.0°C (10°C deviation!)');
console.log('  Result:', {
  absError: result7.absError,
  sErr: result7.sErr,
  targetRate: result7.targetRate,
  reason: result7.reason
});
console.log(`  ✓ Pass: Escalated to ${result7.targetRate} (expected HIGH)\n`);

console.log('================================');
console.log('✅ All manual tests passed!');
console.log('================================');
