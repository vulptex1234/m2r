// Firebase Configuration and Initialization
// Using global Firebase compat SDK

// Wait for Firebase to be loaded
const waitForFirebase = () => {
  return new Promise((resolve) => {
    const checkFirebase = () => {
      if (window.firebase && window.firestoreDb) {
        resolve();
      } else {
        setTimeout(checkFirebase, 50);
      }
    };
    checkFirebase();
  });
};

// Initialize and export Firebase instances
await waitForFirebase();

export const app = window.firebaseApp;
export const db = window.firestoreDb;

// Only enable analytics in production or custom domain
export const analytics = (location.hostname === 'localhost' || location.hostname.includes('.web.app'))
  ? null
  : window.firebaseAnalytics;

// Global configuration derived from functions config
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
    lat: 35.656, // Tokyo coordinates
    lon: 139.324,
    units: 'metric',
  },
  ui: {
    refreshInterval: 30000, // 30 seconds
    chartMaxPoints: 100,
    enableDebugLogs: location.hostname === 'localhost',
  },
};

console.log('🔥 Firebase initialized:', {
  projectId: app.options.projectId,
  region: 'asia-northeast1',
  environment: location.hostname === 'localhost' ? 'development' : 'production'
});