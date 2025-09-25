// Weather Service - OpenWeatherMap API Integration
import { appConfig } from './firebase-config.js';
import { firestoreService } from './firestore-service.js';

export class WeatherService {
  constructor() {
    this.apiKey = appConfig.weather.apiKey;
    this.baseUrl = 'https://api.openweathermap.org/data/2.5';
    this.proxyUrl = 'https://api.allorigins.win/raw?url='; // CORS proxy
    this.cache = new Map();
    this.cacheDuration = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Get current weather data
   * @returns {Promise<Object>} Current weather data
   */
  async getCurrentWeather() {
    const cacheKey = 'current-weather';

    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheDuration) {
        console.log('🌤️ Using cached current weather data');
        return cached.data;
      }
    }

    try {
      const url = `${this.baseUrl}/weather?lat=${appConfig.weather.lat}&lon=${appConfig.weather.lon}&appid=${this.apiKey}&units=${appConfig.weather.units}`;
      const proxiedUrl = `${this.proxyUrl}${encodeURIComponent(url)}`;

      console.log('🌤️ Fetching current weather from OpenWeatherMap...');

      const response = await fetch(proxiedUrl);
      if (!response.ok) {
        throw new Error(`Weather API request failed: ${response.status}`);
      }

      const data = await response.json();

      let history = [];
      try {
        history = await this.getHistoricalWeather();
      } catch (historyError) {
        console.warn('⚠️ Historical weather unavailable:', historyError.message || historyError);
      }

      const weatherData = {
        temperature: data.main.temp,
        humidity: data.main.humidity,
        pressure: data.main.pressure,
        description: data.weather[0].description,
        icon: data.weather[0].icon,
        windSpeed: data.wind?.speed || 0,
        timestamp: Date.now(),
        location: data.name,
        history
      };

      // Cache the result
      this.cache.set(cacheKey, {
        data: weatherData,
        timestamp: Date.now()
      });

      console.log('✅ Current weather data fetched:', weatherData);
      return weatherData;

    } catch (error) {
      console.error('❌ Failed to fetch current weather:', error);
      throw error;
    }
  }

  /**
   * Get historical weather data using backend API (default: past 3 hours)
   * @param {number} hours - Total hours to look back
   * @returns {Promise<Array>} Array of historical weather entries
   */
  async getHistoricalWeather(hours = 3) {
    const cacheKey = `historical-weather-${hours}`;

    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheDuration) {
        console.log('🌤️ Using cached historical weather data');
        return cached.data;
      }
    }

    try {
      // Use backend API endpoint for historical data
      const apiUrl = `${appConfig.api.baseUrl}${appConfig.api.endpoints.historical}?hours=${hours}`;

      console.log('🕰️ Fetching historical weather from backend API', { hours, apiUrl });

      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`Backend API request failed: ${response.status} ${response.statusText}`);
      }

      const payload = await response.json();

      if (!payload.data || !Array.isArray(payload.data)) {
        throw new Error('Invalid response format from backend API');
      }

      // Transform backend data to match expected format
      const historicalData = payload.data.map(item => {
        // Handle both database format and API format
        const temp = item.temp ?? item.temperature ?? null;
        const weather = item.weather ?? (item.raw?.weather?.[0]) ?? null;

        return {
          timestamp: item.timestamp,
          dateTime: new Date(item.timestamp),
          temperature: temp,
          feelsLike: item.feels_like ?? item.feelsLike ?? null,
          humidity: item.humidity ?? null,
          pressure: item.pressure ?? null,
          description: weather?.description || item.description || '',
          icon: weather?.icon || item.icon || '',
          windSpeed: item.wind_speed ?? item.windSpeed ?? null,
          provider: 'backend-api'
        };
      }).filter(item => item.timestamp && item.temperature !== null);

      // Sort by timestamp
      historicalData.sort((a, b) => a.timestamp - b.timestamp);

      // Cache the result
      this.cache.set(cacheKey, {
        data: historicalData,
        timestamp: Date.now()
      });

      console.log('✅ Historical weather data fetched from backend:', {
        source: payload.source,
        points: historicalData.length,
        range: historicalData.length > 0
          ? `${historicalData[0].dateTime.toISOString()} - ${historicalData[historicalData.length - 1].dateTime.toISOString()}`
          : 'No data'
      });

      return historicalData;

    } catch (error) {
      console.error('❌ Failed to fetch historical weather from backend:', error);

      // Return empty array instead of throwing to prevent dashboard crash
      console.log('⚠️ Returning empty historical weather data due to backend error');
      return [];
    }
  }

  /**
   * Get 5-day weather forecast (3-hour intervals)
   * @returns {Promise<Array>} Array of forecast data points
   */
  async getForecast() {
    const cacheKey = 'forecast-data';

    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheDuration) {
        console.log('🌤️ Using cached forecast data');
        return cached.data;
      }
    }

    try {
      const url = `${this.baseUrl}/forecast?lat=${appConfig.weather.lat}&lon=${appConfig.weather.lon}&appid=${this.apiKey}&units=${appConfig.weather.units}`;
      const proxiedUrl = `${this.proxyUrl}${encodeURIComponent(url)}`;

      console.log('🌤️ Fetching 5-day forecast from OpenWeatherMap...');

      const response = await fetch(proxiedUrl);
      if (!response.ok) {
        throw new Error(`Forecast API request failed: ${response.status}`);
      }

      const data = await response.json();

      // Process forecast data
      const forecastData = data.list.map(item => ({
        timestamp: item.dt * 1000, // Convert to milliseconds
        dateTime: new Date(item.dt * 1000),
        temperature: item.main.temp,
        humidity: item.main.humidity,
        pressure: item.main.pressure,
        description: item.weather[0].description,
        icon: item.weather[0].icon,
        windSpeed: item.wind?.speed || 0,
        cloudiness: item.clouds?.all || 0
      }));

      // Cache the result
      this.cache.set(cacheKey, {
        data: forecastData,
        timestamp: Date.now()
      });

      console.log('✅ Forecast data fetched:', {
        totalPoints: forecastData.length,
        timeRange: `${forecastData[0].dateTime.toISOString()} - ${forecastData[forecastData.length - 1].dateTime.toISOString()}`
      });

      return forecastData;

    } catch (error) {
      console.error('❌ Failed to fetch forecast:', error);
      throw error;
    }
  }

  /**
   * Get forecast data for specific timeframe
   * @param {string} timeframe - '1h', '6h', '24h'
   * @returns {Promise<Array>} Filtered forecast data
   */
  async getForecastForTimeframe(timeframe = '24h') {
    const allForecast = await this.getForecast();
    const now = Date.now();

    const timeframes = {
      '1h': 1 * 60 * 60 * 1000,      // 1 hour
      '6h': 6 * 60 * 60 * 1000,      // 6 hours
      '24h': 24 * 60 * 60 * 1000,    // 24 hours
      '72h': 72 * 60 * 60 * 1000     // 3 days
    };

    const cutoff = now + (timeframes[timeframe] || timeframes['24h']);

    return allForecast.filter(item =>
      item.timestamp >= now && item.timestamp <= cutoff
    );
  }

  /**
   * Cache forecast data to Firestore for system use
   * @param {Array} forecastData - Forecast data array
   * @returns {Promise<void>}
   */
  async cacheForecastToFirestore(forecastData = null) {
    try {
      if (!forecastData) {
        forecastData = await this.getForecast();
      }

      // Save to Firestore with timestamp
      await firestoreService.saveForecastCache({
        forecastC: forecastData[0]?.temperature || null,
        forecastTime: forecastData[0]?.dateTime || new Date(),
        provider: 'openweathermap',
        fullForecast: forecastData.slice(0, 24), // First 24 points (3 days)
        fetchedAt: new Date()
      });

      console.log('💾 Forecast cached to Firestore:', {
        currentTemp: forecastData[0]?.temperature,
        totalPoints: forecastData.length
      });

    } catch (error) {
      console.error('❌ Failed to cache forecast to Firestore:', error);
      throw error;
    }
  }

  /**
   * Get cached forecast from Firestore with fallback to API
   * @returns {Promise<Object>} Forecast data with full timeline
   */
  async getFullForecastData() {
    try {
      // Try to get from Firestore first
      const cachedForecast = await firestoreService.getLatestForecast();

      if (cachedForecast.fullForecast && cachedForecast.fetchedAt) {
        const cacheAge = Date.now() - cachedForecast.fetchedAt.toDate().getTime();

        // Use cached data if less than 30 minutes old
        if (cacheAge < this.cacheDuration) {
          console.log('📊 Using cached forecast from Firestore');
          return {
            current: cachedForecast.forecastC,
            timeline: cachedForecast.fullForecast,
            fetchedAt: cachedForecast.fetchedAt.toDate()
          };
        }
      }

      // Fetch fresh data from API
      console.log('🔄 Fetching fresh forecast data...');
      const forecastData = await this.getForecast();

      // Cache to Firestore
      await this.cacheForecastToFirestore(forecastData);

      return {
        current: forecastData[0]?.temperature || null,
        timeline: forecastData,
        fetchedAt: new Date()
      };

    } catch (error) {
      console.error('❌ Failed to get full forecast data:', error);

      // Fallback to cached data even if old
      try {
        const cachedForecast = await firestoreService.getLatestForecast();
        if (cachedForecast.fullForecast) {
          console.log('⚠️ Using stale cached forecast as fallback');
          return {
            current: cachedForecast.forecastC,
            timeline: cachedForecast.fullForecast,
            fetchedAt: cachedForecast.fetchedAt?.toDate() || new Date()
          };
        }
      } catch (fallbackError) {
        console.error('❌ Fallback forecast retrieval failed:', fallbackError);
      }

      throw error;
    }
  }

  /**
   * Generate synthetic forecast data for testing
   * @param {number} baseTemp - Base temperature
   * @param {string} timeframe - Timeframe for generation
   * @returns {Array} Synthetic forecast data
   */
  generateSyntheticForecast(baseTemp = 25, timeframe = '24h') {
    const timeframes = {
      '1h': { hours: 1, interval: 10 },     // 6 points, 10 min intervals
      '6h': { hours: 6, interval: 30 },     // 12 points, 30 min intervals
      '24h': { hours: 24, interval: 180 }   // 8 points, 3 hour intervals
    };

    const config = timeframes[timeframe] || timeframes['24h'];
    const now = Date.now();
    const intervalMs = config.interval * 60 * 1000;
    const points = Math.ceil((config.hours * 60) / config.interval);

    const forecast = [];
    for (let i = 0; i <= points; i++) {
      const timestamp = now + (i * intervalMs);
      const tempVariation = Math.sin((i / points) * Math.PI * 2) * 3; // ±3°C variation
      const randomNoise = (Math.random() - 0.5) * 2; // ±1°C random noise

      forecast.push({
        timestamp,
        dateTime: new Date(timestamp),
        temperature: baseTemp + tempVariation + randomNoise,
        description: i % 3 === 0 ? 'Clear sky' : 'Few clouds',
        icon: '01d'
      });
    }

    console.log('🧪 Generated synthetic forecast:', {
      points: forecast.length,
      timeframe,
      baseTemp,
      range: `${forecast[0].dateTime.toISOString()} - ${forecast[forecast.length - 1].dateTime.toISOString()}`
    });

    return forecast;
  }

  /**
   * Clear all cached data
   */
  clearCache() {
    this.cache.clear();
    console.log('🗑️ Weather service cache cleared');
  }
}

// Export singleton instance
export const weatherService = new WeatherService();

// Auto-refresh forecast data every 30 minutes
setInterval(async () => {
  try {
    console.log('🔄 Auto-refreshing weather forecast...');
    await weatherService.cacheForecastToFirestore();
  } catch (error) {
    console.warn('⚠️ Auto-refresh failed:', error);
  }
}, 30 * 60 * 1000); // 30 minutes
