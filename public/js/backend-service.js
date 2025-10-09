// Backend Data Service (Render PostgreSQL API)

import { appConfig } from './app-config.js';

class BackendDataService {
  constructor() {
    this.baseUrl = appConfig.api.baseUrl.replace(/\/$/, '');
    this.endpoints = appConfig.api.endpoints;
    this.listeners = new Map();
    this.retryAttempts = 3;
    this.retryDelay = 1000;
  }

  async retryOperation(operation, attempt = 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= this.retryAttempts) {
        throw error;
      }
      const delayMs = this.retryDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return this.retryOperation(operation, attempt + 1);
    }
  }

  buildUrl(endpoint, params = {}) {
    const url = new URL(endpoint, this.baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  }

  async request(endpoint, { method = 'GET', body = undefined } = {}) {
    const response = await fetch(endpoint, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    });

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`HTTP ${response.status}: ${message || response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  async getControlState(nodeId) {
    if (!nodeId) return null;
    const url = this.buildUrl(`${this.endpoints.controlStates}/${encodeURIComponent(nodeId)}`);
    return this.retryOperation(async () => {
      try {
        return await this.request(url);
      } catch (error) {
        if (error.message.includes('HTTP 404')) {
          return null;
        }
        throw error;
      }
    });
  }

  async getLatestForecast() {
    const url = this.buildUrl(this.endpoints.forecastSnapshot);
    return this.retryOperation(async () => {
      const snapshot = await this.request(url);
      if (!snapshot || snapshot.forecastC === null) {
        return { forecastC: null };
      }
      return snapshot;
    });
  }

  /**
   * Get recent forecast snapshots for historical visualization
   *
   * @param {Object} options - Query options
   * @param {number} options.hours - Time window in hours (default: 24)
   * @param {number} options.limit - Maximum records to return (default: 100)
   * @returns {Promise<Array>} Array of forecast snapshots
   */
  async getForecastSnapshots({ hours = 24, limit = 100 } = {}) {
    const url = this.buildUrl(this.endpoints.forecastSnapshots, { hours, limit });
    return this.retryOperation(async () => {
      const payload = await this.request(url);
      return Array.isArray(payload?.data) ? payload.data : [];
    });
  }

  async saveMeasurementBatch(processingResult) {
    const url = this.buildUrl(this.endpoints.processedMeasurements);
    return this.retryOperation(async () => {
      await this.request(url, { method: 'POST', body: processingResult });
    });
  }

  async saveForecastCache(forecastData) {
    const url = this.buildUrl(this.endpoints.forecastSnapshot);
    return this.retryOperation(async () => {
      await this.request(url, { method: 'POST', body: forecastData });
    });
  }

  async addRawMeasurement(rawData) {
    const url = this.buildUrl(this.endpoints.rawMeasurements);
    return this.retryOperation(async () => {
      await this.request(url, { method: 'POST', body: rawData });
    });
  }

  async deleteRawMeasurement(id) {
    if (!id) return;
    const url = this.buildUrl(`${this.endpoints.rawMeasurements}/${encodeURIComponent(id)}`);
    return this.retryOperation(async () => {
      await this.request(url, { method: 'DELETE' });
    });
  }

  async getRecentMeasurements(nodeId = null, limitCount = 50) {
    const url = this.buildUrl(this.endpoints.processedMeasurements, {
      limit: limitCount,
      nodeId
    });
    return this.retryOperation(async () => {
      const payload = await this.request(url);
      return Array.isArray(payload?.data) ? payload.data : [];
    });
  }

  setupRawMeasurementListener(callback, intervalMs = 5000) {
    const listenerKey = 'rawMeasurements';

    if (this.listeners.has(listenerKey)) {
      const { stop } = this.listeners.get(listenerKey);
      stop();
    }

    let lastTimestamp = null;
    let isFetching = false;

    const poll = async () => {
      if (isFetching) return;
      isFetching = true;
      try {
        const url = this.buildUrl(this.endpoints.rawMeasurements, {
          since: lastTimestamp
        });
        const payload = await this.request(url);
        const measurements = Array.isArray(payload?.data) ? payload.data : [];
        measurements.forEach((item) => {
          lastTimestamp = item.receivedAt || lastTimestamp;
          const data = item.payload || {};
          callback({
            id: item.id,
            ...data,
            receivedAt: item.receivedAt
          });
        });
      } catch (error) {
        console.warn('Raw measurement polling failed', error);
      } finally {
        isFetching = false;
      }
    };

    const timer = setInterval(poll, intervalMs);
    poll();

    const stop = () => {
      clearInterval(timer);
      this.listeners.delete(listenerKey);
    };

    this.listeners.set(listenerKey, { stop });
    return stop;
  }

  setupControlStateListener(nodeId, callback, intervalMs = 5000) {
    const listenerKey = `controlState_${nodeId}`;
    if (this.listeners.has(listenerKey)) {
      const { stop } = this.listeners.get(listenerKey);
      stop();
    }

    let lastUpdated = null;
    const poll = async () => {
      try {
        const state = await this.getControlState(nodeId);
        if (!state) return;
        if (state.lastUpdatedAt && state.lastUpdatedAt !== lastUpdated) {
          lastUpdated = state.lastUpdatedAt;
          callback(state);
        }
      } catch (error) {
        console.warn('Control state polling failed', error);
      }
    };

    const timer = setInterval(poll, intervalMs);
    poll();

    const stop = () => {
      clearInterval(timer);
      this.listeners.delete(listenerKey);
    };

    this.listeners.set(listenerKey, { stop });
    return stop;
  }

  async cleanupOldMeasurements(daysToKeep = 30) {
    const url = this.buildUrl(`${this.endpoints.processedMeasurements}/cleanup`);
    return this.retryOperation(async () => {
      const result = await this.request(url, {
        method: 'POST',
        body: { days: daysToKeep }
      });
      return result?.deleted ?? 0;
    });
  }

  async getSystemHealth() {
    const url = this.buildUrl(this.endpoints.systemHealth);
    return this.retryOperation(async () => {
      return this.request(url);
    });
  }

  cleanup() {
    this.listeners.forEach(({ stop }) => stop());
    this.listeners.clear();
  }
}

export const backendService = new BackendDataService();

window.addEventListener('beforeunload', () => {
  backendService.cleanup();
});
