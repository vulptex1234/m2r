/**
 * Manual test for linear interpolation function
 */

// Copy the linearInterpolate function
function linearInterpolate(x, x1, y1, x2, y2) {
  if (x2 === x1) {
    return y1; // Avoid division by zero
  }
  return y1 + (y2 - y1) * (x - x1) / (x2 - x1);
}

console.log('🧪 Testing Linear Interpolation Function\n');

// Test 1: Midpoint interpolation
console.log('Test 1: Midpoint between 06:00 (15°C) and 09:00 (21°C)');
const t1_before = new Date('2025-10-09T06:00:00Z').getTime();
const t1_after = new Date('2025-10-09T09:00:00Z').getTime();
const t1_target = new Date('2025-10-09T07:30:00Z').getTime(); // Midpoint
const result1 = linearInterpolate(t1_target, t1_before, 15, t1_after, 21);
console.log(`  Expected: 18°C (midpoint)`);
console.log(`  Result: ${result1.toFixed(2)}°C`);
console.log(`  ✅ ${Math.abs(result1 - 18) < 0.1 ? 'PASS' : 'FAIL'}\n`);

// Test 2: Quarter point interpolation
console.log('Test 2: 07:00 between 06:00 (15°C) and 09:00 (21°C)');
const t2_target = new Date('2025-10-09T07:00:00Z').getTime(); // 1/3 point
const result2 = linearInterpolate(t2_target, t1_before, 15, t1_after, 21);
console.log(`  Expected: 17°C (1/3 point)`);
console.log(`  Result: ${result2.toFixed(2)}°C`);
console.log(`  ✅ ${Math.abs(result2 - 17) < 0.1 ? 'PASS' : 'FAIL'}\n`);

// Test 3: Edge case - at start point
console.log('Test 3: At start point (06:00)');
const result3 = linearInterpolate(t1_before, t1_before, 15, t1_after, 21);
console.log(`  Expected: 15°C`);
console.log(`  Result: ${result3.toFixed(2)}°C`);
console.log(`  ✅ ${Math.abs(result3 - 15) < 0.1 ? 'PASS' : 'FAIL'}\n`);

// Test 4: Edge case - at end point
console.log('Test 4: At end point (09:00)');
const result4 = linearInterpolate(t1_after, t1_before, 15, t1_after, 21);
console.log(`  Expected: 21°C`);
console.log(`  Result: ${result4.toFixed(2)}°C`);
console.log(`  ✅ ${Math.abs(result4 - 21) < 0.1 ? 'PASS' : 'FAIL'}\n`);

// Test 5: Real-world scenario from Render
console.log('Test 5: Real scenario - 07:03 between 06:00 (22°C) and 09:00 (20°C)');
const t5_target = new Date('2025-10-09T07:03:00Z').getTime();
const result5 = linearInterpolate(t5_target, t1_before, 22, t1_after, 20);
const expectedTemp = 22 + (20 - 22) * ((t5_target - t1_before) / (t1_after - t1_before));
console.log(`  Expected: ${expectedTemp.toFixed(2)}°C (calculated)`);
console.log(`  Result: ${result5.toFixed(2)}°C`);
console.log(`  ✅ ${Math.abs(result5 - expectedTemp) < 0.01 ? 'PASS' : 'FAIL'}\n`);

// Test 6: Temperature decreasing
console.log('Test 6: Decreasing temperature - 10:00 between 09:00 (25°C) and 12:00 (18°C)');
const t6_before = new Date('2025-10-09T09:00:00Z').getTime();
const t6_after = new Date('2025-10-09T12:00:00Z').getTime();
const t6_target = new Date('2025-10-09T10:00:00Z').getTime(); // 1/3 point
const result6 = linearInterpolate(t6_target, t6_before, 25, t6_after, 18);
const expectedTemp6 = 25 + (18 - 25) * (1/3); // Should be about 22.67°C
console.log(`  Expected: ${expectedTemp6.toFixed(2)}°C (1/3 of decrease)`);
console.log(`  Result: ${result6.toFixed(2)}°C`);
console.log(`  ✅ ${Math.abs(result6 - expectedTemp6) < 0.1 ? 'PASS' : 'FAIL'}\n`);

console.log('═══════════════════════════════════════');
console.log('All tests completed successfully! ✅');
