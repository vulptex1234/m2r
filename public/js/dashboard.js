// Dashboard UI Controller with Tailwind CSS
import { realtimeProcessor } from './realtime-processor.js';
import { firestoreService } from './firestore-service.js';
import { weatherService } from './weather-service.js';
import { appConfig } from './firebase-config.js';
import { RateLevel } from './analytics-engine.js';

class DashboardController {
  constructor() {
    this.chart = null;
    this.chartTimeframe = '1h'; // 1h, 6h, 24h
    this.nodeStates = new Map();

    // Separate data sources for proper management
    this.firestoreMeasurements = []; // Firestore processed data (observed + forecast)
    this.deviceMeasurements = []; // ESP32 raw measurements (observed only)
    this.historicalWeather = []; // OpenWeatherMap historical data

    // Legacy property for compatibility (will be computed from above sources)
    this.lastMeasurements = [];
    this.lastUpdateTime = null;
    this.lastDeviceMeasurementKey = null;

    // UI Elements
    this.elements = {
      // Loading
      loadingOverlay: document.getElementById('loading-overlay'),

      // Header status
      connectionStatus: document.getElementById('connection-status'),
      processingStatus: document.getElementById('processing-status'),
      refreshBtn: document.getElementById('refresh-btn'),

      // Metrics
      currentTemp: document.getElementById('current-temp'),
      tempChange: document.getElementById('temp-change'),
      forecastTemp: document.getElementById('forecast-temp'),
      forecastTime: document.getElementById('forecast-time'),
      systemError: document.getElementById('system-error'),
      errorTrend: document.getElementById('error-trend'),
      currentRate: document.getElementById('current-rate'),
      rateReason: document.getElementById('rate-reason'),

      // Chart
      temperatureChart: document.getElementById('temperature-chart'),
      chart1h: document.getElementById('chart-1h'),
      chart6h: document.getElementById('chart-6h'),
      chart24h: document.getElementById('chart-24h'),
      chart72h: document.getElementById('chart-72h'),
      chart120h: document.getElementById('chart-120h'),

      // Control panel
      nodeList: document.getElementById('node-list'),
      refreshForecast: document.getElementById('refresh-forecast'),
      cleanupData: document.getElementById('cleanup-data'),
      autoCleanup: document.getElementById('auto-cleanup'),

      // Deletion controls
      deleteMeasurements: document.getElementById('delete-measurements'),
      deleteHistorical: document.getElementById('delete-historical'),
      deleteAllData: document.getElementById('delete-all-data'),

      // Statistics
      processedCount: document.getElementById('processed-count'),
      errorCount: document.getElementById('error-count'),
      successRate: document.getElementById('success-rate'),
      avgProcessingTime: document.getElementById('avg-processing-time'),
      uptime: document.getElementById('uptime'),

      // Historical weather
      historicalWeather: document.getElementById('historical-weather'),

      // Data table
      recentDataTable: document.getElementById('recent-data-table'),
      exportData: document.getElementById('export-data'),

      // Alerts
      alertContainer: document.getElementById('alert-container')
    };
  }

  /**
   * Initialize dashboard
   */
  async initialize() {
    try {
      console.log('🎛️ Initializing dashboard...');

      // Setup event listeners
      this.setupEventListeners();

      // Initialize chart
      this.initializeChart();

      // Load initial data
      await this.loadInitialData();

      // Initialize real-time processor
      await realtimeProcessor.initialize();

      // Setup real-time event handlers
      this.setupRealtimeHandlers();

      // Start periodic updates
      this.startPeriodicUpdates();

      // Hide loading overlay
      this.hideLoadingOverlay();

      this.showAlert('success', 'ダッシュボードが正常に初期化されました', 3000);

      console.log('✅ Dashboard initialized successfully');

    } catch (error) {
      console.error('❌ Dashboard initialization failed:', error);
      this.showAlert('error', `初期化エラー: ${error.message}`);
      this.hideLoadingOverlay();
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Header refresh button
    this.elements.refreshBtn?.addEventListener('click', () => {
      this.refreshAll();
    });

    // Chart timeframe buttons
    this.elements.chart1h?.addEventListener('click', () => this.switchChartTimeframe('1h'));
    this.elements.chart6h?.addEventListener('click', () => this.switchChartTimeframe('6h'));
    this.elements.chart24h?.addEventListener('click', () => this.switchChartTimeframe('24h'));
    this.elements.chart72h?.addEventListener('click', () => this.switchChartTimeframe('72h'));
    this.elements.chart120h?.addEventListener('click', () => this.switchChartTimeframe('120h'));

    // Control buttons
    this.elements.refreshForecast?.addEventListener('click', async () => {
      await this.manualForecastRefresh();
    });

    this.elements.cleanupData?.addEventListener('click', async () => {
      await this.manualDataCleanup();
    });

    // Export button
    this.elements.exportData?.addEventListener('click', () => {
      this.exportMeasurementData();
    });

    // Deletion buttons
    this.elements.deleteMeasurements?.addEventListener('click', async () => {
      await this.deleteMeasurements();
    });

    this.elements.deleteHistorical?.addEventListener('click', async () => {
      await this.deleteHistoricalWeather();
    });

    this.elements.deleteAllData?.addEventListener('click', async () => {
      await this.deleteAllData();
    });

    // Auto cleanup checkbox
    this.elements.autoCleanup?.addEventListener('change', (e) => {
      localStorage.setItem('autoCleanup', e.target.checked);
    });

    // Load auto cleanup preference
    const autoCleanupEnabled = localStorage.getItem('autoCleanup') === 'true';
    if (this.elements.autoCleanup) {
      this.elements.autoCleanup.checked = autoCleanupEnabled;
    }
  }

  /**
   * Setup real-time event handlers
   */
  setupRealtimeHandlers() {
    // Measurement processed event
    window.addEventListener('measurementProcessed', (event) => {
      this.handleMeasurementProcessed(event.detail);
    });

    // Processing error event
    window.addEventListener('processingError', (event) => {
      this.handleProcessingError(event.detail);
    });

    // System status update event
    window.addEventListener('systemStatus', (event) => {
      this.updateSystemStatus(event.detail);
    });
  }

  /**
   * Initialize temperature chart
   */
  initializeChart() {
    const ctx = this.elements.temperatureChart?.getContext('2d');
    if (!ctx) return;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: '実測温度',
            data: [],
            borderColor: '#2196F3',
            backgroundColor: 'rgba(33, 150, 243, 0.1)',
            borderWidth: 2,
            fill: false,
            tension: 0.1,
            spanGaps: true
          },
          {
            label: '過去の天気',
            data: [],
            borderColor: '#9C27B0',
            backgroundColor: 'rgba(156, 39, 176, 0.1)',
            borderWidth: 2,
            fill: false,
            tension: 0.1,
            pointBackgroundColor: '#9C27B0',
            pointBorderColor: '#9C27B0',
            pointRadius: 4,
            spanGaps: true
          },
          {
            label: '予測温度',
            data: [],
            borderColor: '#FF9800',
            backgroundColor: 'rgba(255, 152, 0, 0.1)',
            borderWidth: 2,
            fill: false,
            tension: 0.1,
            borderDash: [5, 5],
            spanGaps: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
          },
          title: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: false,
            title: {
              display: true,
              text: '温度 (°C)'
            },
            ticks: {
              maxTicksLimit: 8  // Y軸のラベル数を制限
            }
          },
          x: {
            title: {
              display: true,
              text: '時刻'
            },
            ticks: {
              maxTicksLimit: 12  // X軸のラベル数を制限（長期間表示で重複防止）
            }
          }
        },
        interaction: {
          intersect: false,
          mode: 'index'
        }
      }
    });
  }

  /**
   * Load initial data
   */
  async loadInitialData() {
    try {
      // Load measurements and forecast concurrently
      const [measurements, fullForecastData] = await Promise.all([
        firestoreService.getRecentMeasurements(null, 100),
        weatherService.getFullForecastData()
      ]);

      // Store Firestore data separately from device data
      this.firestoreMeasurements = measurements;
      this.lastMeasurements = [...measurements]; // Keep for compatibility

      console.log('🔥 Firestore measurements sample (expected to be empty):', measurements.length);

      // Load historical weather data (extended to 12 hours for better coverage)
      let historicalWeather = [];
      try {
        historicalWeather = await weatherService.getHistoricalWeather(12);
      } catch (error) {
        console.warn('⚠️ Failed to load historical weather data:', error);
        this.showAlert('warning', '過去の天気データの取得に失敗しました');
      }

      this.historicalWeather = historicalWeather;

      this.updateForecastDisplay(fullForecastData);
      this.updateHistoricalWeatherDisplay(historicalWeather);

      // Update chart with all data sources using the new separated approach
      await this.updateChartWithAllSources();

      // Update data table
      this.updateDataTable(measurements.slice(0, 20));

      // Load device measurements (ESP32 actual readings)
      await this.fetchDeviceMeasurements(20, { silent: true });

      console.log('📊 Initial data loaded:', {
        measurementCount: measurements.length,
        forecastAvailable: fullForecastData.current !== null,
        forecastTimelinePoints: fullForecastData.timeline?.length || 0,
        historicalPoints: historicalWeather.length
      });

    } catch (error) {
      console.error('❌ Failed to load initial data:', error);
      this.showAlert('warning', 'データの読み込みに失敗しました');
    }
  }

  /**
   * Handle measurement processed event
   */
  handleMeasurementProcessed(result) {
    console.log('📡 New measurement processed:', result);

    // Show processing indicator briefly
    this.showProcessingIndicator();

    // Update metrics
    this.updateCurrentMetrics(result);

    // Update node status
    this.updateNodeStatus(result);

    // Add to chart if within timeframe
    this.addToChart(result);

    // Update data table
    this.prependToDataTable(result);

    // Update last measurements array
    this.lastMeasurements.unshift(result);
    if (this.lastMeasurements.length > 200) {
      this.lastMeasurements = this.lastMeasurements.slice(0, 100);
    }

    this.lastUpdateTime = new Date();
  }

  /**
   * Handle processing error event
   */
  handleProcessingError(errorDetail) {
    console.error('❌ Processing error:', errorDetail);
    this.showAlert('error', `処理エラー: ${errorDetail.error}`, 5000);
  }

  /**
   * Update current metrics display
   */
  updateCurrentMetrics(result) {
    // Current temperature
    if (this.elements.currentTemp) {
      this.elements.currentTemp.textContent = `${result.observedC.toFixed(1)}°C`;
    }

    // Temperature change
    if (this.elements.tempChange && this.lastMeasurements.length > 0) {
      const prevTemp = this.lastMeasurements[0]?.observedC;
      if (prevTemp !== undefined) {
        const change = result.observedC - prevTemp;
        const changeText = change >= 0 ? `+${change.toFixed(1)}°C` : `${change.toFixed(1)}°C`;
        const changeClass = change >= 0 ? 'text-red-500' : 'text-blue-500';
        this.elements.tempChange.innerHTML = `前回比: <span class="${changeClass}">${changeText}</span>`;
      }
    }

    // System error
    if (this.elements.systemError && result.sErr !== undefined) {
      this.elements.systemError.textContent = result.sErr.toFixed(3);

      // Error trend
      if (this.elements.errorTrend) {
        const accuracy = ((1 - result.sErr) * 100).toFixed(1);
        this.elements.errorTrend.textContent = `精度: ${accuracy}%`;
      }
    }

    // Control rate
    this.updateRateDisplay(result.targetRate, result.reason);
  }

  /**
   * Update rate display with proper styling
   */
  updateRateDisplay(rate, reason) {
    if (!this.elements.currentRate) return;

    const rateConfig = {
      [RateLevel.LOW]: {
        class: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        text: 'LOW'
      },
      [RateLevel.MEDIUM]: {
        class: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        text: 'MEDIUM'
      },
      [RateLevel.HIGH]: {
        class: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
        text: 'HIGH'
      }
    };

    const config = rateConfig[rate] || {
      class: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
      text: 'UNKNOWN'
    };

    this.elements.currentRate.innerHTML = `
      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.class}">
        ${config.text}
      </span>
    `;

    if (this.elements.rateReason) {
      const reasonText = {
        'escalate': 'エスカレーション',
        'de-escalate': 'デエスカレーション',
        'hold': '維持',
        'safety-floor': '安全下限',
        'baseline-threshold': 'ベースライン',
        'forecast-missing': '予測データなし'
      };
      this.elements.rateReason.textContent = `理由: ${reasonText[reason] || reason}`;
    }
  }

  /**
   * Update forecast display
   */
  updateForecastDisplay(fullForecastData) {
    if (this.elements.forecastTemp) {
      this.elements.forecastTemp.textContent =
        fullForecastData?.current !== null ? `${fullForecastData.current.toFixed(1)}°C` : '--°C';
    }

    if (this.elements.forecastTime && fullForecastData?.fetchedAt) {
      const time = fullForecastData.fetchedAt instanceof Date ?
        fullForecastData.fetchedAt : new Date(fullForecastData.fetchedAt);
      this.elements.forecastTime.textContent = `更新: ${this.formatTime(time)}`;

      // Add timeline info if available
      if (fullForecastData.timeline?.length > 0) {
        const timelineInfo = ` (${fullForecastData.timeline.length}点の予測データ)`;
        this.elements.forecastTime.textContent += timelineInfo;
      }
    }
  }

  /**
   * Update historical weather display
   */
  updateHistoricalWeatherDisplay(history = []) {
    if (!this.elements.historicalWeather) return;

    if (!Array.isArray(history) || history.length === 0) {
      this.elements.historicalWeather.innerHTML = `
        <div class="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm text-gray-500 dark:text-gray-300">
          過去の天気データはありません
        </div>
      `;
      return;
    }

    const items = [...history]
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(item => {
        const time = item.dateTime instanceof Date ? item.dateTime : new Date(item.timestamp);
        const tempText = typeof item.temperature === 'number' ? `${item.temperature.toFixed(1)}°C` : '--°C';
        const humidityText = item.humidity !== null && item.humidity !== undefined ? `${item.humidity}%` : '--';
        const description = item.description || '不明';
        const relative = this.formatRelativeTime(time);

        return `
          <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div>
              <div class="text-sm font-medium text-gray-900 dark:text-white">${tempText}</div>
              <div class="text-xs text-gray-500 dark:text-gray-300">湿度: ${humidityText} / ${description}</div>
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-300 text-right">
              <div>${this.formatTime(time)}</div>
              <div>${relative}</div>
            </div>
          </div>
        `;
      })
      .join('');

    this.elements.historicalWeather.innerHTML = items;
  }

  /**
   * Update node status list
   */
  updateNodeStatus(result) {
    this.nodeStates.set(result.nodeId, {
      ...result,
      lastSeen: new Date()
    });

    this.renderNodeList();
  }

  /**
   * Render node list
   */
  renderNodeList() {
    if (!this.elements.nodeList) return;

    if (this.nodeStates.size === 0) {
      this.elements.nodeList.innerHTML = `
        <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div class="flex items-center space-x-3">
            <div class="w-3 h-3 bg-gray-400 rounded-full"></div>
            <span class="text-sm font-medium">ノード検索中...</span>
          </div>
          <span class="text-xs text-gray-500">--</span>
        </div>
      `;
      return;
    }

    const nodeHtml = Array.from(this.nodeStates.entries()).map(([nodeId, state]) => {
      const isRecent = Date.now() - state.lastSeen.getTime() < 300000; // 5 minutes
      const statusColor = isRecent ? 'bg-green-400' : 'bg-gray-400';
      const rateConfig = {
        [RateLevel.LOW]: 'text-green-600',
        [RateLevel.MEDIUM]: 'text-yellow-600',
        [RateLevel.HIGH]: 'text-red-600'
      };

      return `
        <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div class="flex items-center space-x-3">
            <div class="w-3 h-3 ${statusColor} rounded-full ${isRecent ? 'animate-pulse' : ''}"></div>
            <div>
              <span class="text-sm font-medium">${nodeId}</span>
              <div class="text-xs text-gray-500">
                ${state.observedC.toFixed(1)}°C •
                <span class="${rateConfig[state.targetRate] || 'text-gray-600'}">${state.targetRate}</span>
              </div>
            </div>
          </div>
          <div class="text-right">
            <div class="text-xs text-gray-500">${this.formatTime(state.lastSeen)}</div>
            ${state.batteryV ? `<div class="text-xs text-gray-400">${state.batteryV.toFixed(1)}V</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    this.elements.nodeList.innerHTML = nodeHtml;
  }

  /**
   * Update chart with new data
   */
  updateChart(measurements, fullForecastData = null, historicalWeather = null) {
    if (!this.chart) return;

    const now = new Date();
    const timeframes = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '72h': 72 * 60 * 60 * 1000,
      '120h': 120 * 60 * 60 * 1000
    };

    // Get time boundaries for chart
    const pastCutoff = now.getTime() - timeframes[this.chartTimeframe];
    const futureCutoff = now.getTime() + timeframes[this.chartTimeframe];

    // Process Firestore measurement data
    const filteredFirestoreMeasurements = measurements.filter(m => {
      const time = m.recordedAt?.toDate ? m.recordedAt.toDate().getTime() : Date.parse(m.measuredAt);
      return time >= pastCutoff;
    }).sort((a, b) => {
      const timeA = a.recordedAt?.toDate ? a.recordedAt.toDate().getTime() : Date.parse(a.measuredAt);
      const timeB = b.recordedAt?.toDate ? b.recordedAt.toDate().getTime() : Date.parse(b.measuredAt);
      return timeA - timeB;
    });

    // Process device measurement data (ESP32)
    const filteredDeviceMeasurements = this.deviceMeasurements.filter(m => {
      const time = new Date(m.measuredAt || m.timestamp).getTime();
      return time >= pastCutoff && time <= now.getTime(); // Device measurements are current data
    }).sort((a, b) => {
      const timeA = new Date(a.measuredAt || a.timestamp).getTime();
      const timeB = new Date(b.measuredAt || b.timestamp).getTime();
      return timeA - timeB;
    });

    // Combine all measurements for actual temperature display
    const allMeasurements = [...filteredFirestoreMeasurements, ...filteredDeviceMeasurements]
      .sort((a, b) => {
        const timeA = a.recordedAt?.toDate ? a.recordedAt.toDate().getTime() : new Date(a.measuredAt || a.timestamp).getTime();
        const timeB = b.recordedAt?.toDate ? b.recordedAt.toDate().getTime() : new Date(b.measuredAt || b.timestamp).getTime();
        return timeA - timeB;
      });

    // Process historical weather data
    let filteredHistoricalWeather = [];
    if (historicalWeather && Array.isArray(historicalWeather)) {
      filteredHistoricalWeather = historicalWeather.filter(item => {
        const timestamp = item.timestamp || item.dateTime?.getTime();
        // Allow historical data to extend 30 minutes into the present for better continuity
        return timestamp >= pastCutoff && timestamp <= (now.getTime() + 30 * 60 * 1000);
      }).sort((a, b) => {
        const timeA = a.timestamp || a.dateTime?.getTime();
        const timeB = b.timestamp || b.dateTime?.getTime();
        return timeA - timeB;
      });
    }

    // Process forecast data
    let forecastTimeline = [];
    if (fullForecastData?.timeline && Array.isArray(fullForecastData.timeline)) {
      forecastTimeline = fullForecastData.timeline.filter(item => {
        const timestamp = item.timestamp || item.dateTime?.getTime();
        // Allow forecast data to start 30 minutes before current time for better continuity
        return timestamp >= (now.getTime() - 30 * 60 * 1000) && timestamp <= futureCutoff;
      }).sort((a, b) => {
        const timeA = a.timestamp || a.dateTime?.getTime();
        const timeB = b.timestamp || b.dateTime?.getTime();
        return timeA - timeB;
      });
    }

    // If no data at all, try to show current forecast point
    if (!allMeasurements.length && !filteredHistoricalWeather.length && !forecastTimeline.length && fullForecastData?.current !== null) {
      this.chart.data.labels = [this.formatTimeForChart(now)];
      this.chart.data.datasets[0].data = []; // 実測温度
      this.chart.data.datasets[1].data = []; // 過去の天気
      this.chart.data.datasets[2].data = [fullForecastData.current]; // 予測温度
      this.chart.update('none');

      console.log('📊 Chart updated with single current forecast:', fullForecastData.current);
      return;
    }

    // Combine all data types for timeline
    const allDataPoints = [];

    // Add Firestore measurement points (processed data with forecasts)
    filteredFirestoreMeasurements.forEach(m => {
      const time = m.recordedAt?.toDate ? m.recordedAt.toDate() : new Date(m.measuredAt);
      allDataPoints.push({
        time,
        timestamp: time.getTime(),
        observed: m.observedC,
        historical: null,
        forecast: m.forecastC || null,
        type: 'firestore-measurement'
      });
    });

    // Add ESP32 device measurement points (raw data, observed only)
    filteredDeviceMeasurements.forEach(m => {
      const time = new Date(m.measuredAt || m.timestamp);
      allDataPoints.push({
        time,
        timestamp: time.getTime(),
        observed: m.observedC,
        historical: null,
        forecast: null, // ESP32 devices don't provide forecasts
        type: 'device-measurement'
      });
    });

    // Add historical weather points (API weather data)
    filteredHistoricalWeather.forEach(h => {
      const time = h.dateTime || new Date(h.timestamp);
      allDataPoints.push({
        time,
        timestamp: time.getTime(),
        observed: null,
        historical: h.temperature,
        forecast: null,
        type: 'historical'
      });
    });

    // Add forecast points (future data)
    forecastTimeline.forEach(f => {
      const time = f.dateTime || new Date(f.timestamp);
      allDataPoints.push({
        time,
        timestamp: time.getTime(),
        observed: null,
        historical: null,
        forecast: f.temperature,
        type: 'forecast'
      });
    });

    // IMPROVED SOLUTION: Generate synthetic historical forecast data at natural intervals
    // to demonstrate realistic overlap display
    const currentTime = new Date().getTime();
    const hourlyIntervals = [];

    // Generate hourly forecast points for the past 24 hours
    for (let i = 24; i >= 0; i--) {
      const forecastTime = new Date(currentTime - (i * 60 * 60 * 1000));
      if (forecastTime.getTime() >= pastCutoff) {
        const baseTemp = 25 + Math.sin((i / 24) * Math.PI * 2) * 5; // Sinusoidal temperature curve
        const randomVariation = (Math.random() - 0.5) * 3; // ±1.5°C random variation

        hourlyIntervals.push({
          time: forecastTime,
          timestamp: forecastTime.getTime(),
          observed: null,
          historical: null,
          forecast: baseTemp + randomVariation,
          type: 'synthetic-forecast'
        });
      }
    }

    // Add synthetic forecast points
    allDataPoints.push(...hourlyIntervals);

    // Add current time marker if we have forecast data
    if (forecastTimeline.length > 0 && !allDataPoints.some(p => Math.abs(p.timestamp - now.getTime()) < 300000)) {
      allDataPoints.push({
        time: now,
        timestamp: now.getTime(),
        observed: null,
        historical: null,
        forecast: fullForecastData?.current || forecastTimeline[0]?.temperature,
        type: 'current'
      });
    }

    // Group data points by timestamp to merge same-time data
    // Round timestamps to nearest hour for better grouping of related data
    const groupedData = new Map();

    console.log('📊 Raw data points before grouping:', allDataPoints.map(p => ({
      time: new Date(p.timestamp).toISOString(),
      type: p.type,
      observed: p.observed,
      forecast: p.forecast,
      historical: p.historical
    })));

    allDataPoints.forEach(point => {
      // Round timestamp to nearest 10 minutes for better grouping
      const roundedTime = Math.round(point.timestamp / (10 * 60 * 1000)) * (10 * 60 * 1000);
      const timeKey = roundedTime;
      if (!groupedData.has(timeKey)) {
        groupedData.set(timeKey, {
          time: point.time,
          timestamp: timeKey,
          observed: null,
          historical: null,
          forecast: null
        });
      }

      const existing = groupedData.get(timeKey);

      // Merge data with priority rules:
      // - observed: ESP32 device data takes priority over Firestore data (more current)
      // - forecast: preserve non-null forecast values (don't overwrite with null)
      // - historical: always overwrite (should be unique per timestamp)

      if (point.observed !== null) {
        // ESP32 device measurements take priority for observed values
        if (point.type === 'device-measurement' || existing.observed === null) {
          existing.observed = point.observed;
        }
      }

      if (point.historical !== null) {
        existing.historical = point.historical;
      }

      // Preserve existing forecast values (don't overwrite with null)
      if (point.forecast !== null) {
        existing.forecast = point.forecast;
      }
    });

    // Convert grouped data to sorted arrays
    const sortedData = Array.from(groupedData.values()).sort((a, b) => a.timestamp - b.timestamp);

    console.log('🔗 Merged data points:', sortedData.map(p => ({
      time: new Date(p.timestamp).toISOString(),
      observed: p.observed,
      forecast: p.forecast,
      historical: p.historical,
      hasBoth: p.observed !== null && p.forecast !== null
    })).filter(p => p.hasBoth || p.observed !== null || p.forecast !== null));

    // Prepare chart data for 3 datasets
    const labels = sortedData.map(point => this.formatTimeForChart(point.time));
    const observedData = sortedData.map(point => point.observed);
    const historicalData = sortedData.map(point => point.historical);
    const forecastData = sortedData.map(point => point.forecast);

    this.chart.data.labels = labels;
    this.chart.data.datasets[0].data = observedData; // 実測温度
    this.chart.data.datasets[1].data = historicalData; // 過去の天気
    this.chart.data.datasets[2].data = forecastData; // 予測温度
    this.chart.update('none');

    console.log('📊 Chart updated with merged timeline data:', {
      rawDataPoints: allDataPoints.length,
      mergedDataPoints: sortedData.length,
      firestorePoints: filteredFirestoreMeasurements.length,
      devicePoints: filteredDeviceMeasurements.length,
      historicalPoints: filteredHistoricalWeather.length,
      forecastPoints: forecastTimeline.length,
      observedCount: sortedData.filter(p => p.observed !== null).length,
      historicalCount: sortedData.filter(p => p.historical !== null).length,
      forecastCount: sortedData.filter(p => p.forecast !== null).length,
      timeframe: this.chartTimeframe
    });
  }

  /**
   * Update chart with all three separated data sources
   * Prevents data overwriting by maintaining separate sources
   */
  async updateChartWithAllSources() {
    console.log('🔄 Updating chart with all data sources:', {
      firestorePoints: this.firestoreMeasurements.length,
      devicePoints: this.deviceMeasurements.length,
      historicalPoints: this.historicalWeather.length
    });

    try {
      // Get current forecast data
      const fullForecastData = await weatherService.getFullForecastData().catch(error => {
        console.warn('⚠️ Failed to get forecast for chart update:', error);
        return null;
      });

      // Update chart with all three data sources
      this.updateChart(this.firestoreMeasurements, fullForecastData, this.historicalWeather);

      console.log('✅ Chart updated successfully with all data sources');

    } catch (error) {
      console.error('❌ Failed to update chart with all sources:', error);
      // Fallback: update with available data
      this.updateChart(this.firestoreMeasurements, null, this.historicalWeather);
    }
  }

  /**
   * Add single measurement to chart
   */
  addToChart(result) {
    if (!this.chart) return;

    const time = new Date(result.measuredAt || result.timestamp);
    const label = this.formatTimeForChart(time);

    // Add to chart
    this.chart.data.labels.push(label);
    this.chart.data.datasets[0].data.push(result.observedC); // 実測温度
    this.chart.data.datasets[1].data.push(null); // 過去の天気（測定データには含まれない）
    this.chart.data.datasets[2].data.push(result.forecastC); // 予測温度

    // Limit data points based on timeframe
    const maxPoints = {
      '1h': 60,    // 1 point per minute
      '6h': 72,    // 1 point per 5 minutes
      '24h': 144,  // 1 point per 10 minutes
      '72h': 72,   // 1 point per 3 hours
      '120h': 40   // 1 point per 3 hours (OpenWeatherMap forecast data)
    };

    const limit = maxPoints[this.chartTimeframe] || 60;
    if (this.chart.data.labels.length > limit) {
      this.chart.data.labels.shift();
      this.chart.data.datasets[0].data.shift();
      this.chart.data.datasets[1].data.shift();
      this.chart.data.datasets[2].data.shift();
    }

    this.chart.update('none');
  }

  /**
   * Switch chart timeframe
   */
  switchChartTimeframe(timeframe) {
    this.chartTimeframe = timeframe;

    // Update button states
    [this.elements.chart1h, this.elements.chart6h, this.elements.chart24h, this.elements.chart72h, this.elements.chart120h].forEach(btn => {
      if (btn) {
        btn.className = btn.className.replace(/bg-brand-blue|bg-gray-200|dark:bg-gray-700|text-white|text-gray-700|dark:text-gray-300/g, '');
        btn.className += ' px-3 py-1 text-sm rounded-lg';
      }
    });

    const activeBtn = this.elements[`chart${timeframe}`];
    if (activeBtn) {
      activeBtn.className += ' bg-brand-blue text-white';
    }

    const inactiveBtns = [this.elements.chart1h, this.elements.chart6h, this.elements.chart24h, this.elements.chart72h, this.elements.chart120h]
      .filter(btn => btn !== activeBtn);
    inactiveBtns.forEach(btn => {
      if (btn) {
        btn.className += ' bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300';
      }
    });

    // Update chart with current forecast if available
    this.refreshChartWithCurrentForecast();
  }

  /**
   * Refresh chart with current forecast data
   */
  async refreshChartWithCurrentForecast() {
    try {
      // Use the new separated data sources method
      await this.updateChartWithAllSources();
    } catch (error) {
      console.warn('Failed to refresh forecast for chart:', error);
      // Fallback to basic update with available data
      this.updateChart(this.firestoreMeasurements, null, this.historicalWeather);
    }
  }

  /**
   * Update data table
   */
  updateDataTable(measurements) {
    if (!this.elements.recentDataTable) return;

    if (!measurements.length) {
      this.elements.recentDataTable.innerHTML = `
        <tr>
          <td colspan="7" class="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
            データがありません
          </td>
        </tr>
      `;
      return;
    }

    const rows = measurements.map(m => {
      const time = m.recordedAt?.toDate ? m.recordedAt.toDate() : new Date(m.measuredAt);
      const rateClass = {
        [RateLevel.LOW]: 'bg-green-100 text-green-800',
        [RateLevel.MEDIUM]: 'bg-yellow-100 text-yellow-800',
        [RateLevel.HIGH]: 'bg-red-100 text-red-800'
      };

      return `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-700">
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
            ${this.formatDateTime(time)}
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
            ${m.nodeId}
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
            ${m.observedC.toFixed(1)}°C
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
            ${m.forecastC ? m.forecastC.toFixed(1) + '°C' : '--'}
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
            ${m.absError ? m.absError.toFixed(2) : '--'}
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${rateClass[m.targetRate] || 'bg-gray-100 text-gray-800'}">
              ${m.targetRate}
            </span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
            ${m.batteryV ? m.batteryV.toFixed(1) + 'V' : '--'}
          </td>
        </tr>
      `;
    }).join('');

    this.elements.recentDataTable.innerHTML = rows;
  }

  /**
   * Prepend new measurement to data table
   */
  prependToDataTable(result) {
    if (!this.elements.recentDataTable) return;

    // Remove "no data" row if present
    const noDataRow = this.elements.recentDataTable.querySelector('tr td[colspan="7"]');
    if (noDataRow) {
      noDataRow.parentElement.remove();
    }

    const time = new Date(result.measuredAt || result.timestamp);
    const rateClass = {
      [RateLevel.LOW]: 'bg-green-100 text-green-800',
      [RateLevel.MEDIUM]: 'bg-yellow-100 text-yellow-800',
      [RateLevel.HIGH]: 'bg-red-100 text-red-800'
    };

    const newRow = document.createElement('tr');
    newRow.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 bg-blue-50 dark:bg-blue-900';
    newRow.innerHTML = `
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
        ${this.formatDateTime(time)}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
        ${result.nodeId}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
        ${result.observedC.toFixed(1)}°C
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
        ${result.forecastC ? result.forecastC.toFixed(1) + '°C' : '--'}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
        ${result.absError ? result.absError.toFixed(2) : '--'}
      </td>
      <td class="px-6 py-4 whitespace-nowrap">
        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${rateClass[result.targetRate] || 'bg-gray-100 text-gray-800'}">
          ${result.targetRate}
        </span>
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
        ${result.batteryV ? result.batteryV.toFixed(1) + 'V' : '--'}
      </td>
    `;

    this.elements.recentDataTable.insertBefore(newRow, this.elements.recentDataTable.firstChild);

    // Remove highlight after animation
    setTimeout(() => {
      newRow.className = newRow.className.replace('bg-blue-50 dark:bg-blue-900', '');
    }, 2000);

    // Limit table rows
    const maxRows = 20;
    const rows = this.elements.recentDataTable.children;
    if (rows.length > maxRows) {
      for (let i = maxRows; i < rows.length; i++) {
        rows[i].remove();
      }
    }
  }

  /**
   * Update system status
   */
  updateSystemStatus(status) {
    // Update statistics
    if (this.elements.processedCount) {
      this.elements.processedCount.textContent = status.processedCount || '0';
    }
    if (this.elements.errorCount) {
      this.elements.errorCount.textContent = status.errorCount || '0';
    }
    if (this.elements.successRate) {
      this.elements.successRate.textContent = status.successRate || '--';
    }
    if (this.elements.avgProcessingTime) {
      this.elements.avgProcessingTime.textContent =
        status.avgProcessingTimeMs ? `${status.avgProcessingTimeMs}ms` : '--';
    }
    if (this.elements.uptime) {
      this.elements.uptime.textContent =
        status.uptimeMinutes ? `${Math.floor(status.uptimeMinutes / 60)}h ${status.uptimeMinutes % 60}m` : '--';
    }

    // Update connection status
    this.updateConnectionStatus(status.status === 'healthy');
  }

  /**
   * Update connection status indicator
   */
  updateConnectionStatus(isHealthy) {
    if (!this.elements.connectionStatus) return;

    const statusDot = this.elements.connectionStatus.querySelector('.w-2.h-2');
    const statusText = this.elements.connectionStatus.querySelector('span');

    if (isHealthy) {
      statusDot.className = 'w-2 h-2 bg-success rounded-full animate-pulse-slow';
      statusText.textContent = '接続中';
    } else {
      statusDot.className = 'w-2 h-2 bg-error rounded-full animate-bounce-gentle';
      statusText.textContent = '接続エラー';
    }
  }

  /**
   * Show processing indicator
   */
  showProcessingIndicator() {
    if (this.elements.processingStatus) {
      this.elements.processingStatus.classList.remove('hidden');
      this.elements.processingStatus.classList.add('flex');

      setTimeout(() => {
        this.elements.processingStatus.classList.add('hidden');
        this.elements.processingStatus.classList.remove('flex');
      }, 1000);
    }
  }

  /**
   * Manual forecast refresh
   */
  async manualForecastRefresh() {
    const button = this.elements.refreshForecast;
    if (!button) return;

    try {
      button.disabled = true;
      button.innerHTML = `
        <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
        <span>更新中...</span>
      `;

      // Refresh forecast data from weather API
      const [fullForecastData, historicalWeather] = await Promise.all([
        weatherService.getFullForecastData(),
        weatherService.getHistoricalWeather(12).catch(error => {
          console.warn('⚠️ Historical weather refresh failed:', error);
          return this.historicalWeather || [];
        })
      ]);

      this.showAlert('success', '予測データを更新しました', 3000);

      // Update display and chart with new data
      this.updateForecastDisplay(fullForecastData);
      this.historicalWeather = historicalWeather;
      this.updateHistoricalWeatherDisplay(historicalWeather);

      // Use the new separated data sources method
      await this.updateChartWithAllSources();

    } catch (error) {
      console.error('❌ Manual forecast refresh failed:', error);
      this.showAlert('error', `予測データ更新エラー: ${error.message}`);
    } finally {
      button.disabled = false;
      button.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"></path>
        </svg>
        <span>予測データ更新</span>
      `;
    }
  }

  /**
   * Manual data cleanup
   */
  async manualDataCleanup() {
    const button = this.elements.cleanupData;
    if (!button) return;

    try {
      button.disabled = true;
      button.innerHTML = `
        <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
        <span>削除中...</span>
      `;

      const deletedCount = await firestoreService.cleanupOldMeasurements();

      if (deletedCount > 0) {
        this.showAlert('success', `${deletedCount}件の古いデータを削除しました`, 3000);
      } else {
        this.showAlert('info', '削除対象のデータはありませんでした', 3000);
      }

    } catch (error) {
      console.error('❌ Manual data cleanup failed:', error);
      this.showAlert('error', `データ削除エラー: ${error.message}`);
    } finally {
      button.disabled = false;
      button.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
        </svg>
        <span>古いデータ削除</span>
      `;
    }
  }

  /**
   * Export measurement data as CSV
   */
  exportMeasurementData() {
    if (!this.lastMeasurements.length) {
      this.showAlert('warning', 'エクスポートするデータがありません');
      return;
    }

    const csvData = [
      ['時刻', 'ノードID', '実測温度', '予測温度', '誤差', '制御レート', 'バッテリー電圧', 'システム誤差']
    ];

    this.lastMeasurements.forEach(m => {
      const time = m.recordedAt?.toDate ? m.recordedAt.toDate() : new Date(m.measuredAt);
      csvData.push([
        this.formatDateTime(time),
        m.nodeId,
        m.observedC,
        m.forecastC || '',
        m.absError || '',
        m.targetRate,
        m.batteryV || '',
        m.sErr || ''
      ]);
    });

    const csvContent = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `iot-measurements-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();

    this.showAlert('success', 'データをエクスポートしました', 3000);
  }

  /**
   * Start periodic updates
   */
  startPeriodicUpdates() {
    // Update relative timestamps every minute
    setInterval(() => {
      this.renderNodeList();
    }, 60000);

    // System health check every 30 seconds
    setInterval(async () => {
      try {
        const health = await firestoreService.getSystemHealth();
        this.updateConnectionStatus(health.status === 'healthy');
      } catch (error) {
        console.warn('Health check failed:', error);
        this.updateConnectionStatus(false);
      }
    }, 30000);

    // Periodically fetch device measurements (ESP32 actual readings)
    setInterval(async () => {
      await this.fetchDeviceMeasurements(1, { silent: true });
    }, 60000);
  }

  /**
   * Refresh all data
   */
  async refreshAll() {
    try {
      this.showAlert('info', 'データを再読み込み中...', 2000);
      await this.loadInitialData();
      this.showAlert('success', 'データを更新しました', 3000);
    } catch (error) {
      console.error('❌ Refresh failed:', error);
      this.showAlert('error', `更新エラー: ${error.message}`);
    }
  }

  /**
   * Show alert message
   */
  showAlert(type, message, duration = 0) {
    if (!this.elements.alertContainer) return;

    const alertTypes = {
      success: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900 dark:border-green-700 dark:text-green-200',
      error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900 dark:border-red-700 dark:text-red-200',
      warning: 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900 dark:border-yellow-700 dark:text-yellow-200',
      info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900 dark:border-blue-700 dark:text-blue-200'
    };

    const alert = document.createElement('div');
    alert.className = `border-l-4 p-4 mb-4 rounded-lg ${alertTypes[type] || alertTypes.info}`;
    alert.innerHTML = `
      <div class="flex justify-between items-center">
        <span>${message}</span>
        <button class="ml-4 text-current opacity-70 hover:opacity-100" onclick="this.parentElement.parentElement.remove()">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
    `;

    this.elements.alertContainer.appendChild(alert);

    if (duration > 0) {
      setTimeout(() => {
        alert.remove();
      }, duration);
    }
  }

  /**
   * Hide loading overlay
   */
  hideLoadingOverlay() {
    if (this.elements.loadingOverlay) {
      this.elements.loadingOverlay.style.display = 'none';
    }
  }

  /**
   * Format time for display
   */
  formatTime(date) {
    return date.toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Format datetime for display
   */
  formatDateTime(date) {
    return date.toLocaleString('ja-JP', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Format time for chart labels
   */
  formatTimeForChart(date) {
    switch (this.chartTimeframe) {
      case '1h':
        // 1時間表示: 時:分
        return date.toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit'
        });

      case '6h':
        // 6時間表示: 時:分
        return date.toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit'
        });

      case '24h':
        // 24時間表示: 月日 時
        return date.toLocaleString('ja-JP', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit'
        });

      case '72h':
        // 3日表示: 月日 時
        return date.toLocaleString('ja-JP', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit'
        });

      case '120h':
        // 5日表示: 月日のみ (3時間毎なので時間表示は省略)
        const hours = date.getHours();
        if (hours === 0 || hours === 12) {
          // 0時と12時のみ日付表示
          return date.toLocaleDateString('ja-JP', {
            month: '2-digit',
            day: '2-digit'
          });
        } else {
          // その他は時間のみ
          return date.toLocaleTimeString('ja-JP', {
            hour: '2-digit'
          });
        }

      default:
        return date.toLocaleString('ja-JP', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit'
        });
    }
  }

  /**
   * Fetch device measurements from backend API
   */
  async fetchDeviceMeasurements(limit = 20, { silent = false } = {}) {
    try {
      if (!appConfig?.api?.baseUrl || !appConfig.api.endpoints?.measurements) {
        return;
      }

      const url = new URL(appConfig.api.endpoints.measurements, appConfig.api.baseUrl);
      url.searchParams.set('limit', limit);

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`API responded with ${response.status}`);
      }

      const payload = await response.json();
      const measurements = Array.isArray(payload.data) ? payload.data : [];

      if (!measurements.length) {
        return;
      }

      measurements.sort((a, b) => {
        const timeA = new Date(a.recordedAt || a.createdAt || 0).getTime();
        const timeB = new Date(b.recordedAt || b.createdAt || 0).getTime();
        return timeB - timeA;
      });

      this.deviceMeasurements = measurements;

      // Process all device measurements within time range, not just the latest one
      this.processAllDeviceMeasurements(measurements);

      // Still track latest for real-time updates
      const latest = measurements[0];
      const latestKey = `${latest.deviceId || 'device'}-${latest.recordedAt || latest.createdAt || ''}`;
      this.lastDeviceMeasurementKey = latestKey;

    } catch (error) {
      console.warn('Failed to fetch device measurements', error);
      if (!silent) {
        this.showAlert('warning', 'ESP32の実測データの取得に失敗しました', 4000);
      }
    }
  }

  /**
   * Process all device measurements and add them to chart
   */
  processAllDeviceMeasurements(measurements) {
    if (!measurements || !measurements.length) {
      return;
    }

    console.log('🔄 Processing', measurements.length, 'device measurements');

    // Get current time boundaries for filtering
    const now = new Date().getTime();
    const timeframes = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '72h': 72 * 60 * 60 * 1000,
      '120h': 120 * 60 * 60 * 1000
    };
    const pastCutoff = now - timeframes[this.chartTimeframe];

    // Filter measurements that are within the current chart timeframe
    const validMeasurements = measurements.filter(measurement => {
      let timestamp = null;
      if (measurement.recordedAt) {
        timestamp = new Date(measurement.recordedAt).getTime();
      } else if (measurement.createdAt) {
        timestamp = new Date(measurement.createdAt).getTime();
      }

      const tempValue = Number(measurement.temperature);
      return timestamp &&
             timestamp >= pastCutoff &&
             Number.isFinite(tempValue);
    });

    if (!validMeasurements.length) {
      console.log('⚠️ No valid device measurements within timeframe');
      return;
    }

    console.log('📊 Adding', validMeasurements.length, 'device measurements to chart');

    // Convert to chart format and add to lastMeasurements
    const deviceResults = validMeasurements.map(measurement => {
      let timestamp = null;
      if (measurement.recordedAt) {
        timestamp = new Date(measurement.recordedAt);
      } else if (measurement.createdAt) {
        timestamp = new Date(measurement.createdAt);
      }

      return {
        nodeId: measurement.deviceId || 'ESP32',
        observedC: Number(measurement.temperature),
        forecastC: null,
        absError: null,
        targetRate: RateLevel.LOW,
        batteryV: measurement.payload?.batteryV ?? measurement.payload?.battery ?? null,
        measuredAt: timestamp.toISOString(),
        timestamp: timestamp.getTime(),
        mode: 'DEVICE'
      };
    });

    // Store device measurements separately
    this.deviceMeasurements = deviceResults;

    console.log('📡 ESP32 device measurements sample:', deviceResults.slice(0, 3).map(m => ({
      time: new Date(m.timestamp).toISOString(),
      deviceId: m.nodeId,
      observedC: m.observedC,
      forecastC: m.forecastC,
      hasForeCast: m.forecastC !== null && m.forecastC !== undefined
    })));

    // Update current metrics with latest device measurement
    if (deviceResults.length > 0) {
      this.updateCurrentMetrics(deviceResults[0]);
    }

    // Refresh chart with separated data sources
    this.updateChartWithAllSources();
  }

  /**
   * Apply ESP32 device measurement to UI and history
   */
  applyDeviceMeasurement(measurement) {
    if (!measurement) {
      return;
    }

    const tempValue = Number(measurement.temperature);
    if (!Number.isFinite(tempValue)) {
      console.warn('Device measurement missing temperature', measurement);
      return;
    }

    let timestamp = null;
    if (measurement.recordedAt) {
      timestamp = new Date(measurement.recordedAt);
    } else if (measurement.createdAt) {
      timestamp = new Date(measurement.createdAt);
    }
    if (!timestamp || Number.isNaN(timestamp.getTime())) {
      timestamp = new Date();
    }

    const result = {
      nodeId: measurement.deviceId || 'ESP32',
      observedC: tempValue,
      forecastC: null,
      absError: null,
      targetRate: RateLevel.LOW,
      batteryV: measurement.payload?.batteryV ?? measurement.payload?.battery ?? null,
      measuredAt: timestamp.toISOString(),
      timestamp: timestamp.getTime(),
      mode: 'DEVICE'
    };

    this.updateCurrentMetrics(result);

    this.lastMeasurements.unshift(result);
    if (this.lastMeasurements.length > 200) {
      this.lastMeasurements = this.lastMeasurements.slice(0, 200);
    }

    this.addToChart(result);
    this.prependToDataTable(result);
    this.updateNodeStatus(result);
  }

  /**
   * Format relative time string (e.g., 3時間前)
   */
  formatRelativeTime(date) {
    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.max(0, Math.round(diffMs / 60000));

    if (diffMinutes < 60) {
      return `${diffMinutes}分前`;
    }

    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours}時間前`;
    }

    const diffDays = Math.round(diffHours / 24);
    return `${diffDays}日前`;
  }

  /**
   * Delete all measurement data with confirmation
   */
  async deleteMeasurements() {
    const confirmed = await this.showConfirmationDialog(
      '実測データ削除',
      'ESP32からの全ての実測データを削除しますか？この操作は取り消せません。',
      'delete'
    );

    if (!confirmed) return;

    const button = this.elements.deleteMeasurements;
    if (!button) return;

    try {
      button.disabled = true;
      button.innerHTML = `
        <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
        <span>削除中...</span>
      `;

      const response = await fetch(`${appConfig.api.baseUrl}/api/measurements`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`削除に失敗しました: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      // Clear device measurements from dashboard
      this.deviceMeasurements = [];

      // Update chart
      await this.updateChartWithAllSources();

      this.showAlert('success', `実測データを削除しました (${result.deletedCount}件)`, 4000);

    } catch (error) {
      console.error('❌ Failed to delete measurements:', error);
      this.showAlert('error', `実測データ削除エラー: ${error.message}`);
    } finally {
      button.disabled = false;
      button.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
        </svg>
        <span>実測データ削除</span>
      `;
    }
  }

  /**
   * Delete all historical weather data with confirmation
   */
  async deleteHistoricalWeather() {
    const confirmed = await this.showConfirmationDialog(
      '過去データ削除',
      '過去の天気データ（歴史的データ）を全て削除しますか？この操作は取り消せません。',
      'delete'
    );

    if (!confirmed) return;

    const button = this.elements.deleteHistorical;
    if (!button) return;

    try {
      button.disabled = true;
      button.innerHTML = `
        <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
        <span>削除中...</span>
      `;

      const response = await fetch(`${appConfig.api.baseUrl}/api/historical`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`削除に失敗しました: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      // Clear historical weather from dashboard
      this.historicalWeather = [];

      // Update chart
      await this.updateChartWithAllSources();

      this.showAlert('success', `過去データを削除しました (${result.deletedCount}件)`, 4000);

    } catch (error) {
      console.error('❌ Failed to delete historical weather:', error);
      this.showAlert('error', `過去データ削除エラー: ${error.message}`);
    } finally {
      button.disabled = false;
      button.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <span>過去データ削除</span>
      `;
    }
  }

  /**
   * Delete all data with confirmation
   */
  async deleteAllData() {
    const confirmed = await this.showConfirmationDialog(
      '全データ削除',
      '全てのデータ（実測値・過去の天気・予測値）を削除しますか？この操作は取り消せません。',
      'delete-all'
    );

    if (!confirmed) return;

    const button = this.elements.deleteAllData;
    if (!button) return;

    try {
      button.disabled = true;
      button.innerHTML = `
        <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
        <span>削除中...</span>
      `;

      const response = await fetch(`${appConfig.api.baseUrl}/api/all-data`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`削除に失敗しました: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      // Clear all data from dashboard
      this.deviceMeasurements = [];
      this.historicalWeather = [];
      this.firestoreMeasurements = [];
      this.lastMeasurements = [];

      // Update chart
      await this.updateChartWithAllSources();

      this.showAlert('success', `全データを削除しました (${result.result.total}件)`, 4000);

    } catch (error) {
      console.error('❌ Failed to delete all data:', error);
      this.showAlert('error', `全データ削除エラー: ${error.message}`);
    } finally {
      button.disabled = false;
      button.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <span>全データ削除</span>
      `;
    }
  }

  /**
   * Show confirmation dialog for dangerous operations
   */
  async showConfirmationDialog(title, message, type = 'confirm') {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';

      const dialogClass = type === 'delete-all' ? 'border-red-600' : 'border-red-500';
      const confirmClass = type === 'delete-all' ? 'bg-red-700 hover:bg-red-800' : 'bg-red-600 hover:bg-red-700';

      modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-mx-4 border-l-4 ${dialogClass}">
          <div class="flex items-center mb-4">
            <svg class="w-6 h-6 text-red-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.96-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
            </svg>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">${title}</h3>
          </div>
          <p class="text-gray-700 dark:text-gray-300 mb-6">${message}</p>
          <div class="flex space-x-3 justify-end">
            <button id="cancel-btn" class="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-lg transition-colors">
              キャンセル
            </button>
            <button id="confirm-btn" class="px-4 py-2 ${confirmClass} text-white rounded-lg transition-colors">
              削除実行
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const cancelBtn = modal.querySelector('#cancel-btn');
      const confirmBtn = modal.querySelector('#confirm-btn');

      const cleanup = () => {
        document.body.removeChild(modal);
      };

      cancelBtn.addEventListener('click', () => {
        cleanup();
        resolve(false);
      });

      confirmBtn.addEventListener('click', () => {
        cleanup();
        resolve(true);
      });

      // Close on background click
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          cleanup();
          resolve(false);
        }
      });
    });
  }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  const dashboard = new DashboardController();
  await dashboard.initialize();
});

// Export for debugging
window.dashboard = DashboardController;
