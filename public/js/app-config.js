// Application configuration for Render PostgreSQL backend

export const app = null; // Legacy placeholder (not used)
export const db = null;  // Legacy placeholder (not used)
export const analytics = null;

export const appConfig = {
  control: {
    alpha: 0.3,
    sampleLimit: 48,
    safetyFloor: 'LOW',
    thresholds: {
      escalateHigh: 0.45,
      escalateMedium: 0.7,
      demoteFromHigh: 0.55,
      demoteFromMedium: 0.8,
    },
  },
  weather: {
    apiKey: 'f7be1420d2ab6102535b464beee86321',
    lat: 35.656,
    lon: 139.324,
    units: 'metric',
  },
  api: {
    baseUrl: 'https://m2r.onrender.com',
    endpoints: {
      historical: '/api/historical',
      measurements: '/api/measurements',            // ESP32 actual readings
      processedMeasurements: '/api/processed-measurements',
      controlStates: '/api/control-states',
      rawMeasurements: '/api/raw-measurements',
      systemHealth: '/api/system-health',
      forecastSnapshot: '/api/forecast/snapshot',
      forecastSnapshots: '/api/forecast-snapshots'  // Historical forecast snapshots
    }
  },
  ui: {
    refreshInterval: 30000,
    chartMaxPoints: 100,
    enableDebugLogs: location.hostname === 'localhost',
  },
};

console.log('✅ App configuration loaded:', {
  apiBase: appConfig.api.baseUrl,
  environment: location.hostname === 'localhost' ? 'development' : 'production'
});
