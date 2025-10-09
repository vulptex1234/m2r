// Real-time IoT Data Processing System
import { IoTProcessingEngine, AnalyticsLogger } from './analytics-engine.js';
import { backendService } from './backend-service.js';
import { appConfig } from './app-config.js';

// Weather API Service with CORS proxy
class WeatherService {
  constructor() {
    this.lastFetchTime = 0;
    this.cacheDuration = 3600000; // 1 hour
    this.corsProxy = 'https://api.allorigins.win/get?url=';
  }

  /**
   * Fetch weather forecast from OpenWeatherMap via CORS proxy
   * @returns {Promise<Object>} Forecast data
   */
  async fetchForecast() {
    const now = Date.now();
    if (now - this.lastFetchTime < this.cacheDuration) {
      AnalyticsLogger.log('Weather fetch skipped - within cache duration');
      return null; // Use cached data
    }

    try {
      const { apiKey, lat, lon, units } = appConfig.weather;

      if (!apiKey || apiKey === 'REPLACE_WITH_YOUR_OPENWEATHER_API_KEY') {
        throw new Error('Weather API key not configured');
      }

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error('Invalid coordinates for weather API');
      }

      const weatherUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${units}&cnt=2&appid=${apiKey}`;
      const proxyUrl = this.corsProxy + encodeURIComponent(weatherUrl);

      AnalyticsLogger.log('Fetching weather forecast...', { lat, lon });

      const response = await fetch(proxyUrl);
      if (!response.ok) {
        throw new Error(`Weather API responded with ${response.status}: ${response.statusText}`);
      }

      const proxyData = await response.json();
      const weatherData = JSON.parse(proxyData.contents);

      const firstEntry = weatherData?.list?.[0];
      if (!firstEntry) {
        throw new Error('Weather API returned no forecast entries');
      }

      const forecastData = {
        forecastC: firstEntry.main?.temp,
        forecastTime: new Date(firstEntry.dt * 1000).toISOString(),
        provider: 'openweathermap',
        raw: firstEntry
      };

      // Note: Forecast snapshots are saved by cron job, not here
      // await backendService.saveForecastCache(forecastData);
      this.lastFetchTime = now;

      AnalyticsLogger.log('Weather forecast updated', {
        temp: forecastData.forecastC,
        time: forecastData.forecastTime
      });

      return forecastData;

    } catch (error) {
      AnalyticsLogger.error('Weather forecast fetch failed', error);
      console.warn('⚠️ Weather forecast unavailable, will use cached data');
      return null;
    }
  }

  /**
   * Get forecast with intelligent caching
   * @returns {Promise<number|null>} Forecast temperature in Celsius
   */
  async getCurrentForecast() {
    // Try to fetch new data
    await this.fetchForecast();

    // Always return cached data (latest available)
    const cached = await backendService.getLatestForecast();
    return cached.forecastC;
  }
}

// Real-time Processing Orchestrator
export class RealtimeProcessor {
  constructor() {
    this.weatherService = new WeatherService();
    this.isProcessing = false;
    this.processedCount = 0;
    this.errorCount = 0;
    this.startTime = Date.now();

    // Periodic tasks
    this.weatherUpdateInterval = null;
    this.cleanupInterval = null;

    // Performance monitoring
    this.processingTimes = [];
  }

  /**
   * Initialize the real-time processing system
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      AnalyticsLogger.log('🚀 Initializing real-time processor...');

      // Initial weather forecast fetch
      await this.weatherService.fetchForecast();

      // Setup listeners
      this.setupMeasurementListener();
      this.startPeriodicTasks();

      // Monitor system health
      this.startHealthMonitoring();

      AnalyticsLogger.log('✅ Real-time processor initialized successfully');

    } catch (error) {
      AnalyticsLogger.error('❌ Failed to initialize real-time processor', error);
      throw error;
    }
  }

  /**
   * Setup listener for new IoT measurements
   */
  setupMeasurementListener() {
    backendService.setupRawMeasurementListener(async (rawMeasurement) => {
      if (this.isProcessing) {
        AnalyticsLogger.log('⏳ Skipping measurement - processor busy');
        return;
      }

      await this.processMeasurement(rawMeasurement);
    });

    AnalyticsLogger.log('👂 Raw measurement listener active');
  }

  /**
   * Process individual IoT measurement
   * @param {Object} rawMeasurement - Raw measurement data
   * @returns {Promise<void>}
   */
  async processMeasurement(rawMeasurement) {
    const startTime = performance.now();
    this.isProcessing = true;

    try {
      AnalyticsLogger.log('📡 Processing measurement', {
        nodeId: rawMeasurement.nodeId,
        observedC: rawMeasurement.observedC
      });

      // Get current forecast
      const forecastC = await this.weatherService.getCurrentForecast();

      // Get previous node state
      const previousState = await backendService.getControlState(rawMeasurement.nodeId) || {};

      // Process with analytics engine
      const processingResult = IoTProcessingEngine.processMeasurement(
        {
          nodeId: rawMeasurement.nodeId,
          observedC: rawMeasurement.observedC,
          batteryV: rawMeasurement.batteryV,
          timestamp: rawMeasurement.timestamp || rawMeasurement.receivedAt?.toDate()?.toISOString()
        },
        previousState,
        forecastC
      );

      // Save results in batch via backend API
      await backendService.saveMeasurementBatch(processingResult);

      // Update metrics
      this.processedCount++;
      const duration = performance.now() - startTime;
      this.processingTimes.push(duration);

      // Keep only recent performance data
      if (this.processingTimes.length > 100) {
        this.processingTimes = this.processingTimes.slice(-50);
      }

      AnalyticsLogger.performance('Measurement processing', startTime);

      // Emit processing result for UI updates
      this.emitProcessingResult(processingResult);

      if (rawMeasurement.id) {
        try {
          await backendService.deleteRawMeasurement(rawMeasurement.id);
        } catch (cleanupError) {
          AnalyticsLogger.error('Failed to delete raw measurement', cleanupError);
        }
      }

    } catch (error) {
      this.errorCount++;
      AnalyticsLogger.error('❌ Measurement processing failed', {
        error: error.message,
        nodeId: rawMeasurement.nodeId,
        data: rawMeasurement
      });

      // Optionally emit error for UI notification
      this.emitError(error, rawMeasurement);

    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Start periodic background tasks
   */
  startPeriodicTasks() {
    // Weather update every 30 minutes
    this.weatherUpdateInterval = setInterval(async () => {
      if (!document.hidden) { // Only when tab is active
        await this.weatherService.fetchForecast();
      }
    }, 30 * 60 * 1000);

    // Data cleanup every 6 hours
    this.cleanupInterval = setInterval(async () => {
      if (!document.hidden) {
        try {
          const deletedCount = await backendService.cleanupOldMeasurements();
          if (deletedCount > 0) {
            AnalyticsLogger.log(`🗑️ Cleaned up ${deletedCount} old records`);
          }
        } catch (error) {
          AnalyticsLogger.error('Cleanup failed', error);
        }
      }
    }, 6 * 60 * 60 * 1000);

    AnalyticsLogger.log('⏰ Periodic tasks started');
  }

  /**
   * Start system health monitoring
   */
  startHealthMonitoring() {
    setInterval(async () => {
      try {
        const health = await backendService.getSystemHealth();
        const avgProcessingTime = this.processingTimes.length > 0 ?
          this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length : 0;

        const systemStatus = {
          ...health,
          processedCount: this.processedCount,
          errorCount: this.errorCount,
          avgProcessingTimeMs: avgProcessingTime.toFixed(2),
          uptimeMinutes: Math.floor((Date.now() - this.startTime) / 60000)
        };

        this.emitSystemStatus(systemStatus);

        // Log warnings for potential issues
        if (health.minutesSinceLastMeasurement > 10) {
          console.warn('⚠️ No measurements received in last 10 minutes');
        }

        if (this.errorCount > this.processedCount * 0.1) {
          console.warn('⚠️ High error rate detected:', {
            errorRate: (this.errorCount / (this.processedCount + this.errorCount) * 100).toFixed(1) + '%'
          });
        }

      } catch (error) {
        AnalyticsLogger.error('Health check failed', error);
      }
    }, appConfig.ui.refreshInterval);
  }

  /**
   * Emit processing result for UI updates
   * @param {Object} result - Processing result
   */
  emitProcessingResult(result) {
    // Custom event for dashboard updates
    const event = new CustomEvent('measurementProcessed', {
      detail: result
    });
    window.dispatchEvent(event);
  }

  /**
   * Emit processing error for UI notifications
   * @param {Error} error - Processing error
   * @param {Object} rawData - Original measurement data
   */
  emitError(error, rawData) {
    const event = new CustomEvent('processingError', {
      detail: { error: error.message, data: rawData }
    });
    window.dispatchEvent(event);
  }

  /**
   * Emit system status for monitoring
   * @param {Object} status - System status data
   */
  emitSystemStatus(status) {
    const event = new CustomEvent('systemStatus', {
      detail: status
    });
    window.dispatchEvent(event);
  }

  /**
   * Manual forecast refresh (for UI button)
   * @returns {Promise<boolean>} Success status
   */
  async refreshForecast() {
    try {
      AnalyticsLogger.log('🔄 Manual forecast refresh triggered');
      const result = await this.weatherService.fetchForecast();
      return result !== null;
    } catch (error) {
      AnalyticsLogger.error('Manual forecast refresh failed', error);
      return false;
    }
  }

  /**
   * Get current processing statistics
   * @returns {Object} Processing statistics
   */
  getStatistics() {
    const uptimeMs = Date.now() - this.startTime;
    const avgProcessingTime = this.processingTimes.length > 0 ?
      this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length : 0;

    return {
      uptimeMs,
      uptimeMinutes: Math.floor(uptimeMs / 60000),
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      successRate: this.processedCount > 0 ?
        ((this.processedCount / (this.processedCount + this.errorCount)) * 100).toFixed(1) + '%' : 'N/A',
      avgProcessingTimeMs: avgProcessingTime.toFixed(2),
      isProcessing: this.isProcessing
    };
  }

  /**
   * Shutdown and cleanup
   */
  shutdown() {
    AnalyticsLogger.log('🛑 Shutting down real-time processor...');

    // Clear intervals
    if (this.weatherUpdateInterval) {
      clearInterval(this.weatherUpdateInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Cleanup backend polling listeners
    backendService.cleanup();

    AnalyticsLogger.log('✅ Real-time processor shutdown complete');
  }
}

// Export singleton instance
export const realtimeProcessor = new RealtimeProcessor();

// Auto-cleanup on page unload
window.addEventListener('beforeunload', () => {
  realtimeProcessor.shutdown();
});
