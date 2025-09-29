// Firestore Client Service Layer
// Using Firebase compat SDK for simplified imports

import { db } from './firebase-config.js';

export class FirestoreService {
  constructor() {
    this.listeners = new Map(); // Track active listeners for cleanup
    this.retryAttempts = 3;
    this.retryDelay = 1000; // Base delay for exponential backoff
  }

  /**
   * Firestore Collections Reference
   */
  static get Collections() {
    return {
      CONTROL_STATES: 'controlStates',
      MEASUREMENTS: 'measurements',
      SCORE_LOGS: 'scoreLogs',
      FORECAST_SNAPSHOTS: 'forecastSnapshots',
      RAW_MEASUREMENTS: 'rawMeasurements' // For IoT device direct writes
    };
  }

  /**
   * Retry failed operations with exponential backoff
   * @param {Function} operation - Operation to retry
   * @param {number} attempt - Current attempt number
   * @returns {Promise} Operation result
   */
  async retryOperation(operation, attempt = 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= this.retryAttempts) {
        console.error(`❌ Operation failed after ${this.retryAttempts} attempts:`, error);
        throw error;
      }

      const delay = this.retryDelay * Math.pow(2, attempt - 1);
      console.warn(`⚠️ Operation failed, retrying in ${delay}ms (attempt ${attempt}/${this.retryAttempts})`);

      await new Promise(resolve => setTimeout(resolve, delay));
      return this.retryOperation(operation, attempt + 1);
    }
  }

  /**
   * Get current node control state
   * @param {string} nodeId - Node identifier
   * @returns {Promise<Object|null>} Control state or null
   */
  async getControlState(nodeId) {
    return this.retryOperation(async () => {
      const docRef = db.collection(FirestoreService.Collections.CONTROL_STATES).doc(nodeId);
      const docSnap = await docRef.get();
      return docSnap.exists ? { id: docSnap.id, ...docSnap.data() } : null;
    });
  }

  /**
   * Get latest forecast data
   * @returns {Promise<Object|null>} Latest forecast or null
   */
  async getLatestForecast() {
    return this.retryOperation(async () => {
      const docRef = db.collection(FirestoreService.Collections.FORECAST_SNAPSHOTS).doc('latest');
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return { forecastC: null };
      }

      const data = docSnap.data();
      return {
        forecastC: data.forecastC ?? null,
        forecastTime: data.forecastTime,
        fetchedAt: data.fetchedAt,
        provider: data.provider || 'openweathermap',
        fullForecast: data.fullForecast || []
      };
    });
  }

  /**
   * Batch write measurement results (optimized for cost reduction)
   * @param {Object} processingResult - Complete processing result
   * @returns {Promise<void>}
   */
  async saveMeasurementBatch(processingResult) {
    return this.retryOperation(async () => {
      const batch = db.batch();
      const timestamp = firebase.firestore.FieldValue.serverTimestamp();

      // 1. Update control state
      const controlRef = db.collection(FirestoreService.Collections.CONTROL_STATES).doc(processingResult.nodeId);
      batch.set(controlRef, {
        nodeId: processingResult.nodeId,
        targetRate: processingResult.targetRate,
        previousRate: processingResult.previousRate,
        mEwma: processingResult.mEwma,
        sigmaDay: processingResult.sigmaDay,
        samples: processingResult.updatedSamples,
        sErr: processingResult.sErr,
        lastObservedC: processingResult.observedC,
        lastForecastC: processingResult.forecastC,
        lastUpdatedAt: timestamp,
        reason: processingResult.reason,
        mode: processingResult.mode || 'ACTIVE'
      }, { merge: true });

      // 2. Add measurement record
      const measurementRef = db.collection(FirestoreService.Collections.MEASUREMENTS).doc();
      batch.set(measurementRef, {
        nodeId: processingResult.nodeId,
        observedC: processingResult.observedC,
        forecastC: processingResult.forecastC,
        absError: processingResult.absError,
        batteryV: processingResult.batteryV,
        sErr: processingResult.sErr,
        targetRate: processingResult.targetRate,
        recordedAt: processingResult.measuredAt ?
          firebase.firestore.Timestamp.fromDate(new Date(processingResult.measuredAt)) : timestamp,
        createdAt: timestamp
      });

      // 3. Add score log (only in ACTIVE mode)
      if (processingResult.mode === 'ACTIVE') {
        const scoreLogRef = db.collection(FirestoreService.Collections.SCORE_LOGS).doc();
        batch.set(scoreLogRef, {
          nodeId: processingResult.nodeId,
          mEwma: processingResult.mEwma,
          sigmaDay: processingResult.sigmaDay,
          sErr: processingResult.sErr,
          targetRate: processingResult.targetRate,
          createdAt: timestamp
        });
      }

      // Execute all writes in single batch (1 Firestore write operation instead of 3)
      await batch.commit();

      console.log(`✅ Batch saved for node ${processingResult.nodeId}:`, {
        targetRate: processingResult.targetRate,
        sErr: processingResult.sErr?.toFixed(4),
        reason: processingResult.reason
      });
    });
  }

  /**
   * Save forecast data to cache
   * @param {Object} forecastData - Forecast data from weather API
   * @returns {Promise<void>}
   */
  async saveForecastCache(forecastData) {
    return this.retryOperation(async () => {
      const docRef = db.collection(FirestoreService.Collections.FORECAST_SNAPSHOTS).doc('latest');

      const dataToSave = {
        forecastC: forecastData.forecastC,
        forecastTime: forecastData.forecastTime ?
          firebase.firestore.Timestamp.fromDate(new Date(forecastData.forecastTime)) : firebase.firestore.FieldValue.serverTimestamp(),
        fetchedAt: firebase.firestore.FieldValue.serverTimestamp(),
        provider: forecastData.provider || 'openweathermap',
        raw: forecastData.raw || null
      };

      // Add full forecast timeline if provided
      if (forecastData.fullForecast && Array.isArray(forecastData.fullForecast)) {
        const existingSnapshot = await docRef.get();

        const parseTimelineItem = (item) => {
          const rawTimestamp = item.timestamp?.toDate ? item.timestamp.toDate() :
            (item.timestamp instanceof Date ? item.timestamp : null);
          const fromDateTime = !rawTimestamp && item.dateTime instanceof Date ? item.dateTime : null;
          const fromValue = !rawTimestamp && !fromDateTime && item.timestamp ? new Date(item.timestamp) : null;
          const timestampDate = rawTimestamp || fromDateTime || fromValue || new Date(item.dateTime || Date.now());

          return {
            timestamp: timestampDate.getTime(),
            temperature: item.temperature,
            description: item.description || '',
            icon: item.icon || '',
            humidity: item.humidity ?? null,
            pressure: item.pressure ?? null,
            windSpeed: item.windSpeed ?? null
          };
        };

        // Preserve ALL existing historical data (no deletion)
        let existingHistory = [];
        if (existingSnapshot.exists) {
          const existingData = existingSnapshot.data();
          if (Array.isArray(existingData.fullForecast)) {
            existingHistory = existingData.fullForecast
              .map(parseTimelineItem)
              .sort((a, b) => a.timestamp - b.timestamp);
          }
        }

        const newTimeline = forecastData.fullForecast
          .map(parseTimelineItem)
          .sort((a, b) => a.timestamp - b.timestamp);

        // Smart merge: preserve all existing data, overwrite overlapping timestamps, add new ones
        const mergedByTimestamp = new Map();

        // First, add all existing data (preserve historical predictions)
        existingHistory.forEach(item => {
          mergedByTimestamp.set(item.timestamp, item);
        });

        // Then, overwrite with new data (update overlapping timestamps, add new ones)
        newTimeline.forEach(item => {
          mergedByTimestamp.set(item.timestamp, item);
        });

        const mergedTimeline = Array.from(mergedByTimestamp.values())
          .sort((a, b) => a.timestamp - b.timestamp);

        dataToSave.fullForecast = mergedTimeline.map(item => ({
          timestamp: firebase.firestore.Timestamp.fromDate(new Date(item.timestamp)),
          temperature: item.temperature,
          description: item.description,
          icon: item.icon,
          humidity: item.humidity,
          pressure: item.pressure,
          windSpeed: item.windSpeed
        }));
      }

      await docRef.set(dataToSave, { merge: true });

      const timelineCount = dataToSave.fullForecast ? ` (${dataToSave.fullForecast.length} timeline points)` : '';
      const existingCount = existingHistory.length;
      const newCount = newTimeline.length;
      const preservedCount = existingCount - newTimeline.filter(item =>
        existingHistory.some(existing => existing.timestamp === item.timestamp)
      ).length;

      console.log(`🌤️ Forecast cached: ${forecastData.forecastC}°C${timelineCount}`, {
        preserved: preservedCount,
        updated: newTimeline.filter(item =>
          existingHistory.some(existing => existing.timestamp === item.timestamp)
        ).length,
        new: newCount - newTimeline.filter(item =>
          existingHistory.some(existing => existing.timestamp === item.timestamp)
        ).length,
        total: dataToSave.fullForecast?.length || 0
      });
    });
  }

  /**
   * Add raw measurement from IoT device (for direct device integration)
   * @param {Object} rawData - Raw measurement data from IoT device
   * @returns {Promise<string>} Document ID
   */
  async addRawMeasurement(rawData) {
    return this.retryOperation(async () => {
      const docRef = await db.collection(FirestoreService.Collections.RAW_MEASUREMENTS).add({
        ...rawData,
        receivedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return docRef.id;
    });
  }

  /**
   * Get recent measurements for analysis/visualization
   * @param {string} nodeId - Node ID (optional)
   * @param {number} limitCount - Number of records to fetch
   * @returns {Promise<Array>} Array of measurement records
   */
  async getRecentMeasurements(nodeId = null, limitCount = 50) {
    return this.retryOperation(async () => {
      let query = db.collection(FirestoreService.Collections.MEASUREMENTS)
        .orderBy('createdAt', 'desc')
        .limit(limitCount);

      if (nodeId) {
        query = db.collection(FirestoreService.Collections.MEASUREMENTS)
          .where('nodeId', '==', nodeId)
          .orderBy('createdAt', 'desc')
          .limit(limitCount);
      }

      const snapshot = await query.get();
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    });
  }

  /**
   * Setup real-time listener for raw measurements (IoT device input)
   * @param {Function} callback - Callback function for new measurements
   * @returns {Function} Unsubscribe function
   */
  setupRawMeasurementListener(callback) {
    const listenerKey = 'rawMeasurements';

    // Clean up existing listener
    if (this.listeners.has(listenerKey)) {
      this.listeners.get(listenerKey)();
    }

    const query = db.collection(FirestoreService.Collections.RAW_MEASUREMENTS)
      .orderBy('receivedAt', 'desc');

    const unsubscribe = query.onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = { id: change.doc.id, ...change.doc.data() };
          console.log('📡 New raw measurement received:', data);
          callback(data);
        }
      });
    }, (error) => {
      console.error('❌ Raw measurement listener error:', error);
    });

    this.listeners.set(listenerKey, unsubscribe);
    return unsubscribe;
  }

  /**
   * Setup real-time listener for control state changes
   * @param {string} nodeId - Node ID to monitor
   * @param {Function} callback - Callback for state changes
   * @returns {Function} Unsubscribe function
   */
  setupControlStateListener(nodeId, callback) {
    const listenerKey = `controlState_${nodeId}`;

    if (this.listeners.has(listenerKey)) {
      this.listeners.get(listenerKey)();
    }

    const docRef = db.collection(FirestoreService.Collections.CONTROL_STATES).doc(nodeId);
    const unsubscribe = docRef.onSnapshot((docSnap) => {
      if (docSnap.exists) {
        const data = { id: docSnap.id, ...docSnap.data() };
        console.log(`🎛️ Control state updated for ${nodeId}:`, data);
        callback(data);
      }
    }, (error) => {
      console.error(`❌ Control state listener error for ${nodeId}:`, error);
    });

    this.listeners.set(listenerKey, unsubscribe);
    return unsubscribe;
  }

  /**
   * Cleanup old measurement data (cost optimization)
   * @param {number} daysToKeep - Number of days to retain
   * @returns {Promise<number>} Number of deleted documents
   */
  async cleanupOldMeasurements(daysToKeep = 30) {
    return this.retryOperation(async () => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const query = db.collection(FirestoreService.Collections.MEASUREMENTS)
        .where('createdAt', '<', firebase.firestore.Timestamp.fromDate(cutoffDate))
        .limit(500); // Process in batches to avoid timeout

      const snapshot = await query.get();

      if (snapshot.empty) {
        console.log('🗑️ No old measurements to cleanup');
        return 0;
      }

      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      console.log(`🗑️ Cleaned up ${snapshot.docs.length} old measurement records`);
      return snapshot.docs.length;
    });
  }

  /**
   * Get system health status
   * @returns {Promise<Object>} Health status information
   */
  async getSystemHealth() {
    try {
      const [forecast, recentMeasurements] = await Promise.all([
        this.getLatestForecast(),
        this.getRecentMeasurements(null, 5)
      ]);

      const lastMeasurementTime = recentMeasurements.length > 0 ?
        recentMeasurements[0].createdAt?.toDate() : null;

      const minutesSinceLastMeasurement = lastMeasurementTime ?
        Math.floor((Date.now() - lastMeasurementTime.getTime()) / 60000) : null;

      return {
        status: 'healthy',
        forecastAvailable: forecast.forecastC !== null,
        forecastTemp: forecast.forecastC,
        lastMeasurement: lastMeasurementTime?.toISOString(),
        minutesSinceLastMeasurement,
        measurementCount: recentMeasurements.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Cleanup all listeners (call on page unload)
   */
  cleanup() {
    console.log(`🧹 Cleaning up ${this.listeners.size} Firestore listeners`);
    this.listeners.forEach((unsubscribe, key) => {
      unsubscribe();
      console.log(`✅ Unsubscribed from ${key}`);
    });
    this.listeners.clear();
  }
}

// Export singleton instance
export const firestoreService = new FirestoreService();

// Cleanup listeners on page unload
window.addEventListener('beforeunload', () => {
  firestoreService.cleanup();
});
