const axios = require('axios');
const fs = require('fs');

const API_KEY = 'f7be1420d2ab6102535b464beee86321';
const URL = `https://api.openweathermap.org/data/3.0/onecall?lat=35.656&lon=139.324&appid=${API_KEY}&lang=ja&units=metric&exclude=minutely,daily,alerts`;

// UNIXタイムスタンプを日本時間の文字列に変換する関数
function convertToJapaneseTime(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

async function fetchHourlyWeatherData() {
  try {
    const response = await axios.get(URL);
    const data = response.data;

    // 現在の天気と1時間ごとの予報を抽出
    const currentWeather = data.current;
    const hourlyForecast = data.hourly.slice(0, 24); // 24時間先までの予報を取得

    const weatherInfo = {
      current: {
        dt: currentWeather.dt,
        japanese_time: convertToJapaneseTime(currentWeather.dt),
        temp: currentWeather.temp, // 気温（℃）
        feels_like: currentWeather.feels_like, // 体感温度（℃）
        pressure: currentWeather.pressure, // 気圧（hPa）
        humidity: currentWeather.humidity, // 湿度（%）
        dew_point: currentWeather.dew_point, // 露点温度（℃）
        uvi: currentWeather.uvi, // UV指数
        clouds: currentWeather.clouds, // 雲量（%）
        visibility: currentWeather.visibility, // 視程（m）
        wind_speed: currentWeather.wind_speed, // 風速（m/s）
        wind_deg: currentWeather.wind_deg, // 風向（度）
        wind_gust: currentWeather.wind_gust, // 突風（m/s）
        weather: currentWeather.weather[0], // 天気状態
        rain: currentWeather.rain, // 降水量（mm）
        snow: currentWeather.snow, // 降雪量（mm）
      },
      hourly: hourlyForecast.map((forecast) => ({
        dt: forecast.dt,
        japanese_time: convertToJapaneseTime(forecast.dt),
        temp: forecast.temp, // 気温（℃）
        feels_like: forecast.feels_like, // 体感温度（℃）
        pressure: forecast.pressure, // 気圧（hPa）
        humidity: forecast.humidity, // 湿度（%）
        dew_point: forecast.dew_point, // 露点温度（℃）
        uvi: forecast.uvi, // UV指数
        clouds: forecast.clouds, // 雲量（%）
        visibility: forecast.visibility, // 視程（m）
        wind_speed: forecast.wind_speed, // 風速（m/s）
        wind_deg: forecast.wind_deg, // 風向（度）
        wind_gust: forecast.wind_gust, // 突風（m/s）
        weather: forecast.weather[0], // 天気状態
        pop: forecast.pop, // 降水確率（0-1）
        rain: forecast.rain, // 降水量（mm）
        snow: forecast.snow, // 降雪量（mm）
      })),
    };

    // 結果をJSONファイルに保存
    fs.writeFileSync(
      'hourly_weather_data.json',
      JSON.stringify(weatherInfo, null, 2)
    );
    console.log(
      '1時間ごとの天気データを hourly_weather_data.json に保存しました。'
    );
  } catch (error) {
    console.error('エラーが発生しました:', error.message);
    if (error.response) {
      console.error('レスポンスデータ:', error.response.data);
    }
  }
}

fetchHourlyWeatherData();
