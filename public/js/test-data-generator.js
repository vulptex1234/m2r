// Test Data Generator for IoT Temperature Control System
import { backendService } from './backend-service.js';
import { appConfig } from './app-config.js';

export class TestDataGenerator {
  constructor() {
    this.isGenerating = false;
    this.intervalId = null;
    this.nodeIds = ['test-node-001', 'test-node-002', 'test-node-003'];
    this.baseTemperatures = [20.0, 22.5, 18.7]; // Base temperatures for each node
    this.generationCount = 0;
  }

  /**
   * Generate realistic temperature data with variations
   * @param {number} baseTemp - Base temperature for the node
   * @param {number} time - Current time for seasonal/daily variations
   * @returns {number} Generated temperature
   */
  generateRealisticTemperature(baseTemp, time) {
    const hour = new Date(time).getHours();

    // Daily temperature variation (warmer during day)
    const dailyVariation = Math.sin((hour - 6) * Math.PI / 12) * 3;

    // Random noise
    const noise = (Math.random() - 0.5) * 2;

    // Seasonal base (simplified)
    const seasonalBase = Math.sin(Date.now() / (1000 * 60 * 60 * 24 * 365) * 2 * Math.PI) * 5;

    return baseTemp + dailyVariation + noise + seasonalBase;
  }

  /**
   * Generate realistic battery voltage
   * @param {number} startVoltage - Starting voltage
   * @param {number} count - Number of measurements taken
   * @returns {number} Battery voltage
   */
  generateBatteryVoltage(startVoltage = 3.7, count = 0) {
    // Slowly decreasing battery with some noise
    const degradation = count * 0.001;
    const noise = (Math.random() - 0.5) * 0.02;
    return Math.max(3.0, startVoltage - degradation + noise);
  }

  /**
   * Start generating test data
   * @param {number} intervalMs - Interval between measurements in milliseconds
   */
  async startGeneration(intervalMs = 10000) {
    if (this.isGenerating) {
      console.warn('⚠️ Test data generation already running');
      return;
    }

    console.log('🧪 Starting test data generation...');
    this.isGenerating = true;
    this.generationCount = 0;

    // First, add a forecast if none exists
    try {
      const forecast = await backendService.getLatestForecast();
      if (forecast.forecastC === null) {
        await this.generateForecastData();
      }
    } catch (error) {
      console.warn('⚠️ Could not check/generate forecast data:', error);
    }

    // Start periodic data generation
    this.intervalId = setInterval(async () => {
      try {
        await this.generateMeasurement();
        this.generationCount++;

        // Occasionally update forecast (every 10 measurements)
        if (this.generationCount % 10 === 0) {
          await this.generateForecastData();
        }

      } catch (error) {
        console.error('❌ Error generating test data:', error);
      }
    }, intervalMs);

    console.log(`✅ Test data generation started (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop generating test data
   */
  stopGeneration() {
    if (!this.isGenerating) {
      console.warn('⚠️ Test data generation not running');
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isGenerating = false;
    console.log(`🛑 Test data generation stopped (generated ${this.generationCount} measurements)`);
  }

  /**
   * Generate a single measurement for random node
   */
  async generateMeasurement() {
    const nodeIndex = Math.floor(Math.random() * this.nodeIds.length);
    const nodeId = this.nodeIds[nodeIndex];
    const baseTemp = this.baseTemperatures[nodeIndex];

    const now = Date.now();
    const temperature = this.generateRealisticTemperature(baseTemp, now);
    const batteryV = this.generateBatteryVoltage(3.7, this.generationCount);

    const measurementData = {
      nodeId,
      observedC: parseFloat(temperature.toFixed(2)),
      batteryV: parseFloat(batteryV.toFixed(2)),
      timestamp: new Date().toISOString(),
      deviceInfo: {
        firmware: 'TEST_v1.0.0',
        rssi: Math.floor(Math.random() * 40) - 80, // -80 to -40 dBm
        uptime: Math.floor(Math.random() * 86400), // Random uptime in seconds
        testGenerated: true
      }
    };

    console.log(`📡 Generating test measurement: ${nodeId} = ${temperature.toFixed(1)}°C`);

    // Send to backend raw measurements endpoint (triggers processing)
    await backendService.addRawMeasurement(measurementData);

    return measurementData;
  }

  /**
   * Generate forecast data
   */
  async generateForecastData() {
    // Generate forecast based on current average + some variation
    const avgTemp = this.baseTemperatures.reduce((a, b) => a + b, 0) / this.baseTemperatures.length;
    const variation = (Math.random() - 0.5) * 5;
    const forecastTemp = avgTemp + variation;

    const forecastData = {
      forecastC: parseFloat(forecastTemp.toFixed(1)),
      forecastTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      provider: 'test-generator',
      raw: {
        source: 'test-data-generator',
        generated_at: new Date().toISOString(),
        base_temp: avgTemp,
        variation: variation
      }
    };

    console.log(`🌤️ Generating test forecast: ${forecastTemp.toFixed(1)}°C`);

    await backendService.saveForecastCache(forecastData);
    return forecastData;
  }

  /**
   * Generate batch of historical data
   * @param {number} count - Number of measurements to generate
   * @param {number} intervalMinutes - Interval between measurements in minutes
   */
  async generateHistoricalData(count = 50, intervalMinutes = 5) {
    console.log(`📊 Generating ${count} historical measurements...`);

    const measurements = [];
    const startTime = Date.now() - (count * intervalMinutes * 60 * 1000);

    for (let i = 0; i < count; i++) {
      const nodeIndex = i % this.nodeIds.length;
      const nodeId = this.nodeIds[nodeIndex];
      const baseTemp = this.baseTemperatures[nodeIndex];

      const measurementTime = startTime + (i * intervalMinutes * 60 * 1000);
      const temperature = this.generateRealisticTemperature(baseTemp, measurementTime);
      const batteryV = this.generateBatteryVoltage(3.8, i);

      const measurement = {
        nodeId,
        observedC: parseFloat(temperature.toFixed(2)),
        batteryV: parseFloat(batteryV.toFixed(2)),
        timestamp: new Date(measurementTime).toISOString(),
        deviceInfo: {
          firmware: 'TEST_v1.0.0',
          rssi: Math.floor(Math.random() * 40) - 80,
          uptime: i * intervalMinutes * 60,
          testGenerated: true,
          historical: true
        }
      };

      measurements.push(measurement);

      // Add small delay to avoid overwhelming backend
      if (i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Add measurements in small batches
    const batchSize = 5;
    for (let i = 0; i < measurements.length; i += batchSize) {
      const batch = measurements.slice(i, i + batchSize);

      const promises = batch.map(measurement =>
        backendService.addRawMeasurement(measurement)
      );

      await Promise.all(promises);
      console.log(`📊 Added batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(measurements.length / batchSize)}`);

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`✅ Generated ${count} historical measurements`);
    return measurements;
  }

  /**
   * Generate anomaly data for testing error handling
   */
  async generateAnomalyData() {
    console.log('⚠️ Generating anomaly test data...');

    const anomalies = [
      // Temperature spike
      {
        nodeId: 'test-node-001',
        observedC: 45.7,
        anomalyType: 'temperature_spike'
      },
      // Temperature drop
      {
        nodeId: 'test-node-002',
        observedC: -5.2,
        anomalyType: 'temperature_drop'
      },
      // Low battery
      {
        nodeId: 'test-node-003',
        observedC: 22.1,
        batteryV: 2.8,
        anomalyType: 'low_battery'
      },
      // Sensor error (NaN simulation)
      {
        nodeId: 'test-node-001',
        observedC: NaN,
        anomalyType: 'sensor_error'
      }
    ];

    for (const anomaly of anomalies) {
      try {
        const measurementData = {
          nodeId: anomaly.nodeId,
          observedC: Number.isNaN(anomaly.observedC) ? -999 : anomaly.observedC,
          batteryV: anomaly.batteryV || 3.5,
          timestamp: new Date().toISOString(),
          deviceInfo: {
            firmware: 'TEST_v1.0.0',
            anomalyType: anomaly.anomalyType,
            testGenerated: true
          }
        };

        console.log(`⚠️ Generating anomaly: ${anomaly.anomalyType} for ${anomaly.nodeId}`);
        await backendService.addRawMeasurement(measurementData);

        // Delay between anomalies
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`❌ Error generating anomaly ${anomaly.anomalyType}:`, error);
      }
    }

    console.log('✅ Anomaly data generation complete');
  }

  /**
   * Clean up test data
   */
  async cleanupTestData() {
    console.log('🧹 Cleaning up test data...');

    try {
      // Note: This would require admin privileges or Cloud Functions
      // For now, we'll just log the intention
      console.log('⚠️ Test data cleanup requires admin privileges');
      console.log('💡 Use backend API or dashboard cleanup to remove test data');

      // In a real implementation, you might call a Cloud Function
      // or use the Firebase Admin SDK to clean up test data

    } catch (error) {
      console.error('❌ Error cleaning up test data:', error);
    }
  }

  /**
   * Get generation status
   */
  getStatus() {
    return {
      isGenerating: this.isGenerating,
      generationCount: this.generationCount,
      nodeIds: this.nodeIds,
      baseTemperatures: this.baseTemperatures
    };
  }
}

// Create global instance for testing
export const testDataGenerator = new TestDataGenerator();

// Console commands for easy testing
if (typeof window !== 'undefined') {
  window.testDataGenerator = testDataGenerator;

  // Add keyboard shortcuts for testing
  document.addEventListener('keydown', (event) => {
    // Ctrl+Shift+T: Toggle test data generation
    if (event.ctrlKey && event.shiftKey && event.key === 'T') {
      if (testDataGenerator.isGenerating) {
        testDataGenerator.stopGeneration();
      } else {
        testDataGenerator.startGeneration(5000); // 5 second interval
      }
      event.preventDefault();
    }

    // Ctrl+Shift+H: Generate historical data
    if (event.ctrlKey && event.shiftKey && event.key === 'H') {
      testDataGenerator.generateHistoricalData(30, 2); // 30 measurements, 2 min apart
      event.preventDefault();
    }

    // Ctrl+Shift+A: Generate anomaly data
    if (event.ctrlKey && event.shiftKey && event.key === 'A') {
      testDataGenerator.generateAnomalyData();
      event.preventDefault();
    }
  });

  console.log(`
🧪 Test Data Generator Loaded!

Keyboard shortcuts:
  Ctrl+Shift+T: Toggle test data generation
  Ctrl+Shift+H: Generate historical data
  Ctrl+Shift+A: Generate anomaly data

JavaScript commands:
  testDataGenerator.startGeneration(5000)    // Start generating every 5 seconds
  testDataGenerator.stopGeneration()         // Stop generation
  testDataGenerator.generateMeasurement()    // Generate single measurement
  testDataGenerator.generateHistoricalData() // Generate historical data
  testDataGenerator.generateAnomalyData()    // Generate anomaly data
  testDataGenerator.getStatus()              // Get current status
  `);
}
