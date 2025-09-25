const path = require('path');

function loadAxios() {
  const candidates = [
    () => require('axios'),
    () => require(path.resolve(__dirname, '../web-service/node_modules/axios')),
    () => require(path.resolve(__dirname, '../cron-job/node_modules/axios'))
  ];

  let lastError;
  for (const loader of candidates) {
    try {
      const mod = loader();
      return mod?.default ?? mod;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('axios module not found');
}

const axios = loadAxios();

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildUrl({lat, lon, dt, apiKey, units = 'metric', lang = 'ja'}) {
  const base = 'https://api.openweathermap.org/data/3.0/onecall/timemachine';
  return `${base}?lat=${lat}&lon=${lon}&dt=${dt}&appid=${apiKey}&units=${units}&lang=${lang}`;
}

function normalizeWeatherEntry(entry, dt) {
  if (!entry) {
    return null;
  }

  const timestamp = (entry.dt || dt) * 1000;
  const details = Array.isArray(entry.weather) ? entry.weather[0] : null;

  return {
    timestamp,
    dateTime: new Date(timestamp),
    temp: typeof entry.temp === 'number' ? entry.temp : entry.main?.temp ?? null,
    feels_like: typeof entry.feels_like === 'number' ? entry.feels_like : entry.main?.feels_like ?? null,
    humidity: entry.humidity ?? entry.main?.humidity ?? null,
    pressure: entry.pressure ?? entry.main?.pressure ?? null,
    wind_speed: entry.wind_speed ?? entry.windSpeed ?? entry.wind?.speed ?? null,
    weather: details || null,
    clouds: entry.clouds ?? null,
    visibility: entry.visibility ?? null,
    dew_point: entry.dew_point ?? null,
    uvi: entry.uvi ?? null,
    raw: entry
  };
}

async function fetchSinglePoint({apiKey, lat, lon, dateTime, units, lang}) {
  const dt = Math.floor(dateTime.getTime() / 1000);
  const url = buildUrl({lat, lon, dt, apiKey, units, lang});
  const response = await axios.get(url);
  const payload = response.data;

  const entry = payload?.data?.[0] || payload?.current || payload?.hourly?.[0];
  const normalized = normalizeWeatherEntry(entry, dt);

  const sunrise = payload?.data?.[0]?.sunrise || payload?.current?.sunrise;
  const sunset = payload?.data?.[0]?.sunset || payload?.current?.sunset;

  return {
    point: normalized,
    sun:
      sunrise && sunset
        ? {
            sunrise,
            sunset,
            sunrise_time: new Date(sunrise * 1000),
            sunset_time: new Date(sunset * 1000)
          }
        : null,
  };
}

function convertToJapaneseTime(timestamp) {
  return new Date(timestamp * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

function calculateDailyStats(hourly) {
  if (!Array.isArray(hourly) || hourly.length === 0) {
    return {};
  }

  const pickNumbers = (key) => hourly.map(item => item?.[key]).filter(value => typeof value === 'number');

  const calc = (values) => {
    if (!values.length) {
      return {
        max: null,
        min: null,
        avg: null
      };
    }

    const sum = values.reduce((acc, value) => acc + value, 0);
    return {
      max: Math.max(...values),
      min: Math.min(...values),
      avg: sum / values.length
    };
  };

  return {
    temperature: calc(pickNumbers('temp')),
    humidity: calc(pickNumbers('humidity')),
    pressure: calc(pickNumbers('pressure')),
    wind_speed: calc(pickNumbers('wind_speed'))
  };
}

async function fetchHistoricalByDate({
  apiKey,
  lat,
  lon,
  dateString,
  units = 'metric',
  lang = 'ja',
  delayMs = 1100
}) {
  if (!apiKey) {
    throw new Error('OPENWEATHER_API_KEY is not set');
  }

  const startDate = new Date(dateString);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error(`Invalid date string: ${dateString}`);
  }
  startDate.setHours(0, 0, 0, 0);

  const hourlyData = [];
  const errors = [];
  let sunInfo = null;

  for (let hour = 0; hour < 24; hour++) {
    const target = new Date(startDate);
    target.setHours(hour, 0, 0, 0);

    try {
      const { point, sun } = await fetchSinglePoint({ apiKey, lat, lon, dateTime: target, units, lang });
      if (point) {
        hourlyData.push({
          ...point,
          hour,
          time: convertToJapaneseTime(point.timestamp / 1000),
          unix_timestamp: Math.floor(point.timestamp / 1000)
        });
        if (!sunInfo && sun) {
          sunInfo = {
            sunrise: sun.sunrise,
            sunrise_time: convertToJapaneseTime(sun.sunrise),
            sunset: sun.sunset,
            sunset_time: convertToJapaneseTime(sun.sunset)
          };
        }
      }
    } catch (error) {
      errors.push({ hour, error: error.message });
    }

    if (hour < 23) {
      await delay(delayMs);
    }
  }

  hourlyData.sort((a, b) => a.timestamp - b.timestamp);

  return {
    requested_date: dateString,
    data_points: hourlyData.length,
    hourly_data: hourlyData,
    sun_info: sunInfo,
    errors,
    daily_statistics: calculateDailyStats(hourlyData)
  };
}

async function fetchHistoricalByHours({
  apiKey,
  lat,
  lon,
  hours = 3,
  units = 'metric',
  lang = 'ja',
  delayMs = 1100
}) {
  if (!apiKey) {
    throw new Error('OPENWEATHER_API_KEY is not set');
  }

  const now = new Date();
  const results = [];

  for (let offset = hours; offset >= 1; offset--) {
    const target = new Date(now.getTime() - offset * 60 * 60 * 1000);

    try {
      const { point } = await fetchSinglePoint({ apiKey, lat, lon, dateTime: target, units, lang });
      if (point) {
        results.push(point);
      }
    } catch (error) {
      results.push({ error: error.message, timestamp: target.getTime() });
    }

    if (offset > 1) {
      await delay(delayMs);
    }
  }

  results.sort((a, b) => a.timestamp - b.timestamp);
  return results;
}

module.exports = {
  fetchHistoricalByDate,
  fetchHistoricalByHours,
  calculateDailyStats
};
