# システム構成図作成計画

## 概要

ESP32 IoT温度制御システムの包括的なドキュメンテーションとして、draw.ioで以下の図を作成します：

1. 動作フロー図 (Operation Flow Diagram)
2. 全体のシステム構成図 (Overall System Architecture)
3. 個別のシステム構成図 (Individual System Architecture)
   - バックエンド (Render Web Service)
   - フロントエンド (Render Static Site)
   - データベース (Render PostgreSQL)
   - ESP32 (IoT Device)
4. データベーススキーマ図 (Database Schema Diagram)

---

## 1. 動作フロー図 (Operation Flow Diagram)

### 目的
ESP32からのデータ送信開始から、レート判定、データベース保存、フロントエンド表示までの完全な処理フローを可視化

### 含める要素

#### ESP32 → Backend (POST /api/measurements)
```
[ESP32] センサー読み取り (BMP280, INA219)
   ↓
[ESP32] WiFi経由でPOST /api/measurements
   ↓ データ: { deviceId, temperature, humidity, voltage, current, power }
   ↓
[Backend] リクエスト受信
   ↓
[Backend] device_measurements テーブルに保存
   ↓
[Backend] processMeasurementWithRating() 実行
```

#### Backend レート判定処理
```
[measurement-processor.js]
   ↓
1. getForecastForTimestamp(recordedAt)
   ↓ ① getForecastSnapshotForMeasurementTime()
   ↓    → forecast_snapshots テーブルから履歴検索
   ↓ ② linearInterpolate() で精密な予測気温計算
   ↓
2. getControlState(deviceId)
   ↓ → control_states テーブルから前回状態取得
   ↓
3. IoTProcessingEngine.processMeasurement()
   ↓ [analytics-service.js]
   ↓ ① DiscrepancyAnalyzer.analyzeDiscrepancy()
   ↓    - absError = |forecast - observed|
   ↓    - samples更新 (最大48件)
   ↓    - sigmaDay = sqrt(variance(samples))
   ↓    - mEwma = α×error + (1-α)×mEwma_prev
   ↓    - r = mEwma / sigmaDay
   ↓    - sErr = exp(-r)  (0=bad, 1=good)
   ↓
   ↓ ② RateController.decideRate(sErr, previousRate)
   ↓    - sErr < 0.45  → HIGH (予測不正確、監視強化)
   ↓    - sErr < 0.70  → MEDIUM (通常運転)
   ↓    - sErr >= 0.70 → LOW (予測正確、監視削減)
   ↓    - ヒステリシス適用 (振動防止)
   ↓
4. saveProcessedMeasurementBatch()
   ↓ → processed_measurements テーブルに保存
   ↓ → control_states テーブルを更新
   ↓ → score_logs テーブルに計算履歴保存
   ↓
[Backend] targetRate → intervalSeconds 変換
   - HIGH   → 60s  (1分ごと)
   - MEDIUM → 300s (5分ごと)
   - LOW    → 600s (10分ごと)
   ↓
[Backend] レスポンス返却
   ↓ { success: true, nextIntervalSeconds: 300 }
   ↓
[ESP32] nextIntervalSeconds を受信
   ↓
[ESP32] sleep(nextIntervalSeconds)
   ↓
[ESP32] ループ継続 ──┐
                    │
         ←──────────┘
```

#### Cron Job (Forecast Snapshot 保存)
```
[Render Cron Job] 毎時0分実行 ("0 * * * *")
   ↓
[fetch-forecast-snapshot.js] OpenWeatherMap API呼び出し
   ↓ lat=35.656, lon=139.324
   ↓ 5日間予測 (3時間間隔)
   ↓
[cron-job] forecast_snapshots テーブルに保存
   ↓ snapshot: { forecastC, forecastTime, fullForecast[] }
   ↓
[cron-job] cleanupOldForecastSnapshots() (7日以上古いデータ削除)
```

#### Frontend データ取得・表示
```
[Frontend] ページロード
   ↓
[dashboard.js] loadInitialData()
   ↓
1. GET /api/processed-measurements?limit=100
   ↓ → processed_measurements テーブルから取得
   ↓ → 実測値(ESP32)とレート判定結果
   ↓
2. GET /api/historical?date=2025-01-10
   ↓ → weather_history テーブルから取得
   ↓ → OpenWeatherMap過去天気データ
   ↓
3. GET /api/forecast-snapshots?hours=24&limit=100
   ↓ → forecast_snapshots テーブルから取得
   ↓ → 予測履歴データ
   ↓
[dashboard.js] Chart.js でグラフ描画
   - 実測温度グラフ (processed_measurements)
   - 過去天気グラフ (weather_history)
   - 予測履歴グラフ (forecast_snapshots)
   ↓
[dashboard.js] 30秒ごとに自動更新
```

---

## 2. 全体のシステム構成図 (Overall System Architecture)

### レイヤー構成

```
┌─────────────────────────────────────────────────────────┐
│                    User (Web Browser)                   │
│                   https://m2r.onrender.com              │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS
                         ↓
┌─────────────────────────────────────────────────────────┐
│              Render Platform (PaaS)                     │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Frontend (Static Site)                           │  │
│  │  - HTML/CSS/JavaScript (Tailwind, Chart.js)       │  │
│  │  - public/index.html                              │  │
│  │  - public/js/*.js                                 │  │
│  └───────────────────────────────────────────────────┘  │
│                         │                                │
│                         │ REST API (HTTPS)               │
│                         ↓                                │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Backend (Web Service)                            │  │
│  │  - Node.js + Express.js                           │  │
│  │  - web-service/src/server.js                      │  │
│  │  - shared/*.js (analytics, weather, persistence)  │  │
│  │                                                    │  │
│  │  API Endpoints:                                   │  │
│  │  - POST /api/measurements (ESP32データ受信)        │  │
│  │  - GET  /api/processed-measurements               │  │
│  │  - GET  /api/historical                           │  │
│  │  - GET  /api/forecast-snapshots                   │  │
│  │  - GET  /api/score-logs                           │  │
│  └───────────────────────────────────────────────────┘  │
│         │                              │                 │
│         │                              │                 │
│         ↓ PostgreSQL                   ↓ HTTP API        │
│  ┌─────────────────┐         ┌─────────────────────┐    │
│  │  Database       │         │  Cron Jobs          │    │
│  │  (PostgreSQL)   │         │  - 毎時0分実行       │    │
│  │                 │         │  - fetch-forecast-  │    │
│  │  8 Tables:      │         │    snapshot.js      │    │
│  │  - device_      │         │  - fetch-historical-│    │
│  │    measurements │         │    weather.js       │    │
│  │  - processed_   │         └─────────────────────┘    │
│  │    measurements │                   │                 │
│  │  - control_     │                   │                 │
│  │    states       │                   ↓                 │
│  │  - score_logs   │         ┌─────────────────────┐    │
│  │  - forecast_    │         │  External API       │    │
│  │    snapshots    │←────────│  OpenWeatherMap     │    │
│  │  - weather_     │         │  api.openweathermap │    │
│  │    history      │         │  .org/data/2.5/     │    │
│  │  - weather_     │         │  - forecast         │    │
│  │    daily_       │         │  - onecall/timemach │    │
│  │    summary      │         └─────────────────────┘    │
│  │  - raw_         │                                     │
│  │    measurements │                                     │
│  └─────────────────┘                                     │
└─────────────────────────────────────────────────────────┘
                         ↑
                         │ HTTP POST (WiFi)
                         │ /api/measurements
┌─────────────────────────────────────────────────────────┐
│              ESP32 (IoT Device)                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  MicroPython Application (boot.py)                │  │
│  │  - WiFi client (HOME/LAB mode)                    │  │
│  │  - HTTP POST to Render API                        │  │
│  │  - Dynamic sleep interval control                 │  │
│  └───────────────────────────────────────────────────┘  │
│         │                              │                 │
│         ↓ I2C (SCL=22, SDA=21)         ↓ Local storage  │
│  ┌──────────────┐           ┌────────────────────────┐  │
│  │  Sensors     │           │  CSV Files             │  │
│  │  - BMP280    │           │  - temp.csv            │  │
│  │    (temp,    │           │  - elect.csv           │  │
│  │     humidity)│           │  - debug.log           │  │
│  │  - INA219    │           └────────────────────────┘  │
│  │    (voltage, │                                        │
│  │     current) │                                        │
│  └──────────────┘                                        │
└─────────────────────────────────────────────────────────┘
```

### データフロー

1. **ESP32 → Backend**: センサーデータ送信、レート判定実行
2. **Backend → Database**: 測定データ、処理結果、レート判定保存
3. **Cron Job → OpenWeatherMap API**: 予測データ取得
4. **Cron Job → Database**: forecast_snapshots保存
5. **Frontend → Backend API**: データ取得リクエスト
6. **Backend → Frontend**: JSON形式でデータ返却
7. **Frontend**: Chart.jsでグラフ描画

---

## 3. 個別のシステム構成図

### 3.1 バックエンド (Render Web Service)

```
┌─────────────────────────────────────────────────────────┐
│           Backend (Node.js + Express.js)                │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  web-service/src/server.js (817行)                      │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Express.js App                                    │ │
│  │  - CORS設定                                         │ │
│  │  - JSON parser                                     │ │
│  │  - Static file serving (public/)                  │ │
│  │                                                    │ │
│  │  API Endpoints (25個):                            │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  Health Check                                │ │ │
│  │  │  - GET /health                               │ │ │
│  │  ├──────────────────────────────────────────────┤ │ │
│  │  │  ESP32 Data Reception                        │ │ │
│  │  │  - POST /api/measurements                    │ │ │
│  │  │    → processMeasurementWithRating()          │ │ │
│  │  │    → Returns nextIntervalSeconds             │ │ │
│  │  ├──────────────────────────────────────────────┤ │ │
│  │  │  Historical Weather                          │ │ │
│  │  │  - GET /api/historical                       │ │ │
│  │  │    ?date=YYYY-MM-DD                          │ │ │
│  │  │    → Auto-refresh if stale (>30min)          │ │ │
│  │  ├──────────────────────────────────────────────┤ │ │
│  │  │  Measurements (Frontend polling)             │ │ │
│  │  │  - GET /api/measurements?limit=N             │ │ │
│  │  │  - GET /api/processed-measurements?limit=N   │ │ │
│  │  │  - POST /api/raw-measurements                │ │ │
│  │  ├──────────────────────────────────────────────┤ │ │
│  │  │  Forecast Snapshots                          │ │ │
│  │  │  - POST /api/forecast/snapshot (disabled)    │ │ │
│  │  │  - GET /api/forecast/snapshot (latest)       │ │ │
│  │  │  - GET /api/forecast-snapshots               │ │ │
│  │  │    ?hours=24&limit=100                       │ │ │
│  │  ├──────────────────────────────────────────────┤ │ │
│  │  │  Rate Decision Logs                          │ │ │
│  │  │  - GET /api/score-logs?limit=N               │ │ │
│  │  │  - GET /api/control-states/:nodeId           │ │ │
│  │  ├──────────────────────────────────────────────┤ │ │
│  │  │  Data Export (CSV)                           │ │ │
│  │  │  - GET /api/export/device-measurements       │ │ │
│  │  │  - GET /api/export/processed-measurements    │ │ │
│  │  │  - GET /api/export/control-states            │ │ │
│  │  │  - GET /api/export/weather-history           │ │ │
│  │  ├──────────────────────────────────────────────┤ │ │
│  │  │  Data Cleanup                                │ │ │
│  │  │  - DELETE /api/measurements                  │ │ │
│  │  │  - DELETE /api/historical                    │ │ │
│  │  │  - DELETE /api/all-data                      │ │ │
│  │  │  - POST /api/processed-measurements/cleanup  │ │ │
│  │  ├──────────────────────────────────────────────┤ │ │
│  │  │  System Health                               │ │ │
│  │  │  - GET /api/system-health                    │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  shared/ モジュール                                      │
│  ┌────────────────────────────────────────────────────┐ │
│  │  analytics-service.js (311行)                      │ │
│  │  - DiscrepancyAnalyzer (誤差分析)                   │ │
│  │  - RateController (レート判定)                      │ │
│  │  - IoTProcessingEngine (処理統合)                  │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  measurement-processor.js (227行)                  │ │
│  │  - processMeasurementWithRating() (メイン処理)     │ │
│  │  - canProcessMeasurement() (バリデーション)        │ │
│  │  - processMeasurementBatch() (バッチ処理)          │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  weather-service.js (345行)                        │ │
│  │  - getForecastForTimestamp() (予測取得+補間)       │ │
│  │  - linearInterpolate() (線形補間)                  │ │
│  │  - getCachedForecast() (キャッシュ取得)            │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  persistence.js                                    │ │
│  │  - getDeviceMeasurements()                         │ │
│  │  - saveDeviceMeasurement()                         │ │
│  │  - getProcessedMeasurements()                      │ │
│  │  - saveProcessedMeasurementBatch()                 │ │
│  │  - getControlState()                               │ │
│  │  - getRecentScoreLogs()                            │ │
│  │  - getForecastSnapshotForMeasurementTime()         │ │
│  │  - getRecentForecastSnapshots()                    │ │
│  │  - cleanupOldForecastSnapshots()                   │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  historical-weather.js                             │ │
│  │  - fetchHistoricalByDate() (API呼び出し)           │ │
│  │  - calculateDailyStats() (日次統計計算)            │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  db.js (157行)                                     │ │
│  │  - getPool() (PostgreSQL接続プール)                │ │
│  │  - initSchema() (テーブル作成)                     │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  環境変数:                                               │
│  - DATABASE_URL (PostgreSQL接続文字列)                   │
│  - PGSSLMODE=require                                     │
│  - OPENWEATHER_API_KEY                                   │
│  - PORT=3000 (デフォルト)                                │
└─────────────────────────────────────────────────────────┘
```

### 3.2 フロントエンド (Render Static Site)

```
┌─────────────────────────────────────────────────────────┐
│         Frontend (HTML/CSS/JavaScript)                  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  public/index.html                                       │
│  ┌────────────────────────────────────────────────────┐ │
│  │  UI Components (Tailwind CSS)                      │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  Header                                      │ │ │
│  │  │  - Connection status indicator              │ │ │
│  │  │  - Processing status                        │ │ │
│  │  │  - Refresh button                           │ │ │
│  │  ├──────────────────────────────────────────────┤ │ │
│  │  │  Metrics Cards                              │ │ │
│  │  │  - Current temperature (実測値)              │ │ │
│  │  │  - Forecast temperature (予測値)            │ │ │
│  │  │  - System error (sErr)                      │ │ │
│  │  │  - Current rate (LOW/MEDIUM/HIGH)           │ │ │
│  │  ├──────────────────────────────────────────────┤ │ │
│  │  │  Charts Section                             │ │ │
│  │  │  - 実測温度グラフ (Chart.js)                 │ │ │
│  │  │    Timeframe: 1h/6h/24h/72h/120h            │ │ │
│  │  │  - 過去天気グラフ (Chart.js)                 │ │ │
│  │  │  - 予測履歴グラフ (Chart.js)                 │ │ │
│  │  │    Display count: 5/10/20/all snapshots     │ │ │
│  │  │    Timeframe: 24h/48h/72h                   │ │ │
│  │  ├──────────────────────────────────────────────┤ │ │
│  │  │  Data Table                                  │ │ │
│  │  │  - Recent measurements (最新50件)            │ │ │
│  │  │  - Export CSV button                        │ │ │
│  │  ├──────────────────────────────────────────────┤ │ │
│  │  │  Control Panel                              │ │ │
│  │  │  - Refresh forecast                         │ │ │
│  │  │  - Data cleanup controls                    │ │ │
│  │  │  - Delete buttons (確認ダイアログ付き)        │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  public/js/ モジュール                                   │
│  ┌────────────────────────────────────────────────────┐ │
│  │  app-config.js                                     │ │
│  │  - API endpoints configuration                     │ │
│  │  - Weather API config (lat, lon, apiKey)           │ │
│  │  - Control config (alpha, thresholds)              │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  dashboard.js (メインコントローラ)                  │ │
│  │  - initialize() (初期化)                           │ │
│  │  - loadInitialData() (データ読み込み)              │ │
│  │  - updateMeasurementsChart() (グラフ更新)          │ │
│  │  - updateHistoricalChart() (過去天気グラフ)        │ │
│  │  - updateForecastHistoryChart() (予測履歴グラフ)   │ │
│  │  - startPeriodicUpdates() (30秒ごと自動更新)       │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  backend-service.js (API通信)                      │ │
│  │  - getProcessedMeasurements()                      │ │
│  │  - getHistoricalWeather()                          │ │
│  │  - getForecastSnapshots()                          │ │
│  │  - getScoreLogs()                                  │ │
│  │  - deleteAllData()                                 │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  weather-service.js                                │ │
│  │  - getForecastFromAPI() (OpenWeatherMap API)       │ │
│  │  - cacheForecastSnapshot() (無効化済み)            │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  analytics-engine.js (フロントエンド用分析)        │ │
│  │  - RateDecisionEngine (テストデータ生成用)         │ │
│  │  - DiscrepancyAnalyzer (バックエンドと同一ロジック) │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  realtime-processor.js                             │ │
│  │  - processRawMeasurement() (テストデータ処理)      │ │
│  │  - saveForecastSnapshot() (無効化済み)             │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  export-manager.js                                 │ │
│  │  - exportToCSV() (CSV出力)                         │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ライブラリ:                                             │
│  - Chart.js 4.x (グラフ描画)                             │
│  - Tailwind CSS (スタイリング)                           │
│  - date-fns (日時処理)                                   │
└─────────────────────────────────────────────────────────┘
```

### 3.3 データベース (Render PostgreSQL)

```
┌─────────────────────────────────────────────────────────┐
│          PostgreSQL Database (Render)                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  接続設定:                                               │
│  - DATABASE_URL: postgres://user:pass@host:5432/db      │
│  - PGSSLMODE: require                                    │
│  - Connection Pool: pg.Pool                              │
│                                                          │
│  テーブル一覧 (8個):                                     │
│  ┌────────────────────────────────────────────────────┐ │
│  │  1. device_measurements                            │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  ESP32からの生データ                          │ │ │
│  │  │  - id (SERIAL PRIMARY KEY)                   │ │ │
│  │  │  - device_id (TEXT NOT NULL)                 │ │ │
│  │  │  - temperature (NUMERIC)                     │ │ │
│  │  │  - humidity (NUMERIC)                        │ │ │
│  │  │  - recorded_at (TIMESTAMPTZ)                 │ │ │
│  │  │  - payload (JSONB) {voltage, current, power} │ │ │
│  │  │  - created_at (TIMESTAMPTZ DEFAULT NOW())    │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  2. processed_measurements                         │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  レート判定後の処理結果                       │ │ │
│  │  │  - id (SERIAL PRIMARY KEY)                   │ │ │
│  │  │  - node_id (TEXT NOT NULL)                   │ │ │
│  │  │  - observed_c (NUMERIC) 実測温度              │ │ │
│  │  │  - forecast_c (NUMERIC) 予測温度              │ │ │
│  │  │  - abs_error (NUMERIC) |forecast - observed| │ │ │
│  │  │  - battery_v (NUMERIC) バッテリー電圧         │ │ │
│  │  │  - s_err (NUMERIC) 誤差スコア                 │ │ │
│  │  │  - target_rate (TEXT) レート判定結果          │ │ │
│  │  │  - recorded_at (TIMESTAMPTZ)                 │ │ │
│  │  │  - created_at (TIMESTAMPTZ DEFAULT NOW())    │ │ │
│  │  │                                              │ │ │
│  │  │  INDEX: idx_processed_measurements_          │ │ │
│  │  │         recorded_at DESC                     │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  3. control_states                                 │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  デバイスごとの現在状態 (UPSERT)              │ │ │
│  │  │  - node_id (TEXT PRIMARY KEY)                │ │ │
│  │  │  - target_rate (TEXT) LOW/MEDIUM/HIGH        │ │ │
│  │  │  - previous_rate (TEXT)                      │ │ │
│  │  │  - m_ewma (NUMERIC) EWMA値                   │ │ │
│  │  │  - sigma_day (NUMERIC) 標準偏差              │ │ │
│  │  │  - samples (JSONB) サンプル配列 (最大48件)    │ │ │
│  │  │  - s_err (NUMERIC) 現在の誤差スコア           │ │ │
│  │  │  - last_observed_c (NUMERIC)                 │ │ │
│  │  │  - last_forecast_c (NUMERIC)                 │ │ │
│  │  │  - last_updated_at (TIMESTAMPTZ)             │ │ │
│  │  │  - reason (TEXT) レート変更理由               │ │ │
│  │  │  - mode (TEXT) ACTIVE/FALLBACK/ERROR_FALLBACK│ │ │
│  │  │  - updated_at (TIMESTAMPTZ DEFAULT NOW())    │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  4. score_logs                                     │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  スコア計算履歴                               │ │ │
│  │  │  - id (SERIAL PRIMARY KEY)                   │ │ │
│  │  │  - node_id (TEXT)                            │ │ │
│  │  │  - m_ewma (NUMERIC)                          │ │ │
│  │  │  - sigma_day (NUMERIC)                       │ │ │
│  │  │  - s_err (NUMERIC)                           │ │ │
│  │  │  - target_rate (TEXT)                        │ │ │
│  │  │  - created_at (TIMESTAMPTZ DEFAULT NOW())    │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  5. forecast_snapshots                             │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  予測データスナップショット (毎時保存)        │ │ │
│  │  │  - id (SERIAL PRIMARY KEY)                   │ │ │
│  │  │  - snapshot (JSONB) {                        │ │ │
│  │  │      forecastC: number,                      │ │ │
│  │  │      forecastTime: string,                   │ │ │
│  │  │      fullForecast: [{                        │ │ │
│  │  │        dateTime: string,                     │ │ │
│  │  │        temperature: number,                  │ │ │
│  │  │        humidity: number,                     │ │ │
│  │  │        description: string                   │ │ │
│  │  │      }]                                      │ │ │
│  │  │    }                                         │ │ │
│  │  │  - fetched_at (TIMESTAMPTZ DEFAULT NOW())    │ │ │
│  │  │                                              │ │ │
│  │  │  用途: 過去予測保持、線形補間、予測履歴グラフ  │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  6. weather_history                                │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  過去の天気データ (OpenWeatherMap API)        │ │ │
│  │  │  - date (DATE NOT NULL)                      │ │ │
│  │  │  - hour (SMALLINT NOT NULL) 0-23             │ │ │
│  │  │  - payload (JSONB) {                         │ │ │
│  │  │      temperature: number,                    │ │ │
│  │  │      humidity: number,                       │ │ │
│  │  │      pressure: number,                       │ │ │
│  │  │      clouds: number,                         │ │ │
│  │  │      wind_speed: number,                     │ │ │
│  │  │      weather_description: string             │ │ │
│  │  │    }                                         │ │ │
│  │  │  - created_at (TIMESTAMPTZ DEFAULT NOW())    │ │ │
│  │  │                                              │ │ │
│  │  │  PRIMARY KEY: (date, hour)                   │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  7. weather_daily_summary                          │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  日次天気サマリー                             │ │ │
│  │  │  - date (DATE PRIMARY KEY)                   │ │ │
│  │  │  - summary (JSONB) {                         │ │ │
│  │  │      min_temp: number,                       │ │ │
│  │  │      max_temp: number,                       │ │ │
│  │  │      avg_temp: number,                       │ │ │
│  │  │      total_precipitation: number             │ │ │
│  │  │    }                                         │ │ │
│  │  │  - generated_at (TIMESTAMPTZ DEFAULT NOW())  │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  8. raw_measurements                               │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  フロントエンドからのテストデータ              │ │ │
│  │  │  - id (SERIAL PRIMARY KEY)                   │ │ │
│  │  │  - device_id (TEXT)                          │ │ │
│  │  │  - payload (JSONB)                           │ │ │
│  │  │  - received_at (TIMESTAMPTZ DEFAULT NOW())   │ │ │
│  │  │                                              │ │ │
│  │  │  INDEX: idx_raw_measurements_received_at DESC│ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 3.4 ESP32 (IoT Device)

```
┌─────────────────────────────────────────────────────────┐
│              ESP32 (MicroPython)                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Hardware:                                               │
│  - ESP32 DevKit C                                        │
│  - BMP280: Temperature & Humidity sensor (I2C 0x76/0x77)│
│  - INA219: Voltage/Current sensor (I2C 0x40-0x45)       │
│  - Blue LED: Status indicator (Pin 2)                    │
│                                                          │
│  I2C Bus:                                                │
│  - SCL: GPIO 22                                          │
│  - SDA: GPIO 21                                          │
│  - Frequency: 100kHz (安定性のため低速設定)              │
│                                                          │
│  esp32/boot.py (517行) - Main Application                │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Initialization                                    │ │
│  │  1. Load WiFi credentials (passwords.py)           │ │
│  │     - HOME_WIFI_SSID / HOME_WIFI_PASS              │ │
│  │     - LAB_WIFI_SSID / LAB_WIFI_PASS                │ │
│  │     - WIFI_MODE: 'HOME' or 'LAB'                   │ │
│  │                                                    │ │
│  │  2. Initialize CSV files                           │ │
│  │     - temp.csv (timestamp, temp, pressure, humid)  │ │
│  │     - elect.csv (timestamp, voltage, current, pwr) │ │
│  │     - debug.log (timestamped log entries)          │ │
│  │                                                    │ │
│  │  3. Connect to WiFi                                │ │
│  │     - Retry logic (max 20秒)                       │ │
│  │     - Log IP address, RSSI                         │ │
│  │                                                    │ │
│  │  4. Initialize I2C sensors                         │ │
│  │     - I2C bus scan (diagnostic)                    │ │
│  │     - BMP280 initialization                        │ │
│  │     - INA219 initialization (retry logic)          │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  Main Loop (while True)                            │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │  1. Read BMP280                              │ │ │
│  │  │     - temperature (°C)                       │ │ │
│  │  │     - pressure (Pa)                          │ │ │
│  │  │     - humidity (%)                           │ │ │
│  │  │     - Save to temp.csv                       │ │ │
│  │  │                                              │ │ │
│  │  │  2. Read INA219                              │ │ │
│  │  │     - voltage (V)                            │ │ │
│  │  │     - current (mA)                           │ │ │
│  │  │     - power (mW)                             │ │ │
│  │  │     - Save to elect.csv                      │ │ │
│  │  │                                              │ │ │
│  │  │  3. Send to Render API                       │ │ │
│  │  │     POST https://m2r.onrender.com/           │ │ │
│  │  │          api/measurements                    │ │ │
│  │  │                                              │ │ │
│  │  │     Payload: {                               │ │ │
│  │  │       "deviceId": "ESP32-001",               │ │ │
│  │  │       "temperature": 23.5,                   │ │ │
│  │  │       "humidity": 45.2,                      │ │ │
│  │  │       "recordedAt": null,                    │ │ │
│  │  │       "payload": {                           │ │ │
│  │  │         "voltage_v": 3.3,                    │ │ │
│  │  │         "current_ma": 120.5,                 │ │ │
│  │  │         "power_mw": 397.65,                  │ │ │
│  │  │         "device_info": {                     │ │ │
│  │  │           "platform": "ESP32",               │ │ │
│  │  │           "framework": "MicroPython"         │ │ │
│  │  │         }                                    │ │ │
│  │  │       }                                      │ │ │
│  │  │     }                                        │ │ │
│  │  │                                              │ │ │
│  │  │     Response: {                              │ │ │
│  │  │       "success": true,                       │ │ │
│  │  │       "nextIntervalSeconds": 300             │ │ │
│  │  │     }                                        │ │ │
│  │  │                                              │ │ │
│  │  │  4. Dynamic Sleep                            │ │ │
│  │  │     - HIGH rate   → 60s  (1分ごと)           │ │ │
│  │  │     - MEDIUM rate → 300s (5分ごと)           │ │ │
│  │  │     - LOW rate    → 600s (10分ごと)          │ │ │
│  │  │     - Default     → 300s (エラー時)          │ │ │
│  │  │                                              │ │ │
│  │  │  5. LED Status Indicator                     │ │ │
│  │  │     - ON: Measurement in progress            │ │ │
│  │  │     - Rapid blink: Transmitting              │ │ │
│  │  │     - Slow blink: Success                    │ │ │
│  │  │     - OFF: Sleeping                          │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  Error Handling                                    │ │
│  │  - WiFi connection retry (3回)                     │ │
│  │  - Exponential backoff (2s, 4s, 6s)                │ │
│  │  - Sensor read failure → Save "ERROR" to CSV       │ │
│  │  - API send failure → Use default interval (300s)  │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  Supporting Modules:                                     │
│  ┌────────────────────────────────────────────────────┐ │
│  │  esp32/bmp280.py                                   │ │
│  │  - BME280 class                                    │ │
│  │  - I2C communication with BMP280 sensor            │ │
│  │  - Read temperature, pressure, humidity            │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  esp32/ina219.py                                   │ │
│  │  - INA219 class                                    │ │
│  │  - I2C communication with INA219 sensor            │ │
│  │  - Read voltage, current, power                    │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  esp32/passwords.py (not in repo)                  │ │
│  │  - HOME_WIFI_SSID / HOME_WIFI_PASS                 │ │
│  │  - LAB_WIFI_SSID / LAB_WIFI_PASS                   │ │
│  │  - WIFI_MODE: 'HOME' or 'LAB'                      │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  Dependencies:                                           │
│  - urequests (installed via: mpremote mip install       │
│                urequests)                                │
│  - ujson (built-in)                                      │
│  - network (built-in)                                    │
│  - machine (built-in)                                    │
└─────────────────────────────────────────────────────────┘
```

---

## 4. データベーススキーマ図

### ER図 (Entity-Relationship Diagram)

```
┌─────────────────────────────────────────────────────────────┐
│                  Database Schema (PostgreSQL)               │
└─────────────────────────────────────────────────────────────┘

┌──────────────────────────┐
│  device_measurements     │
├──────────────────────────┤
│ PK  id (SERIAL)          │
│     device_id (TEXT)     │────┐
│     temperature (NUMERIC)│    │
│     humidity (NUMERIC)   │    │ 論理的関連
│     recorded_at (TSTZ)   │    │ (device_id)
│     payload (JSONB)      │    │
│     created_at (TSTZ)    │    │
└──────────────────────────┘    │
         ↓ ESP32から受信         │
         ↓ POST /api/measurements│
         ↓                       │
┌──────────────────────────┐    │
│  processed_measurements  │    │
├──────────────────────────┤    │
│ PK  id (SERIAL)          │    │
│     node_id (TEXT)       │────┤
│     observed_c (NUMERIC) │    │
│     forecast_c (NUMERIC) │    │ 論理的関連
│     abs_error (NUMERIC)  │    │ (node_id = device_id)
│     battery_v (NUMERIC)  │    │
│     s_err (NUMERIC)      │    │
│     target_rate (TEXT)   │────┐│
│     recorded_at (TSTZ)   │    ││
│     created_at (TSTZ)    │    ││
│                          │    ││
│ INDEX: idx_processed_    │    ││
│        measurements_     │    ││
│        recorded_at DESC  │    ││
└──────────────────────────┘    ││
         ↑ レート判定結果         ││
         ↑ processMeasurement    ││
         ↑ WithRating()          ││
                                 ││
┌──────────────────────────┐    ││
│  control_states          │    ││
├──────────────────────────┤    ││
│ PK  node_id (TEXT)       │◄───┘│ 論理的関連
│     target_rate (TEXT)   │     │ (node_id)
│     previous_rate (TEXT) │     │
│     m_ewma (NUMERIC)     │     │
│     sigma_day (NUMERIC)  │     │
│     samples (JSONB)      │     │ 配列 [temp1, temp2, ...]
│     s_err (NUMERIC)      │     │ (最大48件)
│     last_observed_c (NUM)│     │
│     last_forecast_c (NUM)│     │
│     last_updated_at(TSTZ)│     │
│     reason (TEXT)        │     │
│     mode (TEXT)          │     │
│     updated_at (TSTZ)    │     │
└──────────────────────────┘     │
         ↑ UPSERT                │
         ↑ 現在状態管理            │
                                 │
┌──────────────────────────┐     │
│  score_logs              │     │
├──────────────────────────┤     │
│ PK  id (SERIAL)          │     │
│     node_id (TEXT)       │─────┘ 論理的関連
│     m_ewma (NUMERIC)     │       (node_id)
│     sigma_day (NUMERIC)  │
│     s_err (NUMERIC)      │
│     target_rate (TEXT)   │
│     created_at (TSTZ)    │
└──────────────────────────┘
         ↑ 計算履歴
         ↑ 各処理実行時に記録


┌──────────────────────────┐
│  forecast_snapshots      │
├──────────────────────────┤
│ PK  id (SERIAL)          │
│     snapshot (JSONB)     │ {
│                          │   forecastC: 23.5,
│                          │   forecastTime: "2025-01-10T12:00:00Z",
│                          │   fullForecast: [
│                          │     {
│                          │       dateTime: "2025-01-10T12:00:00Z",
│                          │       temperature: 23.5,
│                          │       humidity: 45,
│                          │       description: "晴れ"
│                          │     },
│                          │     ... (40個: 5日間×3時間間隔)
│                          │   ]
│                          │ }
│     fetched_at (TSTZ)    │
└──────────────────────────┘
         ↑ 毎時0分に保存
         ↑ Cron Job: fetch-forecast-snapshot.js
         ↑ 線形補間用の過去予測保持


┌──────────────────────────┐
│  weather_history         │
├──────────────────────────┤
│ PK  date (DATE)          │ COMPOSITE KEY
│ PK  hour (SMALLINT)      │ (date, hour)
│     payload (JSONB)      │ {
│                          │   temperature: 23.5,
│                          │   humidity: 45,
│                          │   pressure: 1013,
│                          │   clouds: 20,
│                          │   wind_speed: 2.5,
│                          │   weather_description: "晴れ"
│                          │ }
│     created_at (TSTZ)    │
└──────────────────────────┘
         ↑ 日次実行
         ↑ Cron Job: fetch-historical-weather.js
         ↑ OpenWeatherMap API (Timemachine)


┌──────────────────────────┐
│  weather_daily_summary   │
├──────────────────────────┤
│ PK  date (DATE)          │
│     summary (JSONB)      │ {
│                          │   min_temp: 18.5,
│                          │   max_temp: 25.3,
│                          │   avg_temp: 21.9,
│                          │   total_precipitation: 0
│                          │ }
│     generated_at (TSTZ)  │
└──────────────────────────┘
         ↑ 日次サマリー
         ↑ weather_history から計算


┌──────────────────────────┐
│  raw_measurements        │
├──────────────────────────┤
│ PK  id (SERIAL)          │
│     device_id (TEXT)     │
│     payload (JSONB)      │
│     received_at (TSTZ)   │
│                          │
│ INDEX: idx_raw_          │
│        measurements_     │
│        received_at DESC  │
└──────────────────────────┘
         ↑ フロントエンドから
         ↑ テストデータ生成用
         ↑ POST /api/raw-measurements
```

### テーブル間の関係

#### データフロー関係 (ESP32 → Backend)
```
device_measurements
   ↓ processMeasurementWithRating()
   ├─→ processed_measurements (結果保存)
   ├─→ control_states (UPSERT: 現在状態更新)
   └─→ score_logs (計算履歴記録)
```

#### 予測データ関係 (Cron Job → Database)
```
[OpenWeatherMap API]
   ↓ Cron Job (毎時実行)
forecast_snapshots
   ↓ getForecastSnapshotForMeasurementTime()
   ↓ linearInterpolate()
   └─→ 精密な予測気温計算
```

#### 過去天気データ関係 (Cron Job → Database)
```
[OpenWeatherMap API]
   ↓ Cron Job (日次実行)
weather_history
   ↓ calculateDailyStats()
weather_daily_summary
```

---

## 実装計画

### フェーズ1: システム理解完了 ✅
- [x] コードベース分析
- [x] API エンドポイント一覧作成
- [x] データフロー理解
- [x] データベーススキーマ理解

### フェーズ2: ドキュメント作成 (現在)
- [ ] 動作フロー図 (draw.io)
- [ ] 全体システム構成図 (draw.io)
- [ ] 個別システム構成図 (4つ: Backend, Frontend, Database, ESP32)
- [ ] データベーススキーマ図 (draw.io)

### フェーズ3: レビューと調整
- [ ] ユーザーレビュー
- [ ] フィードバック反映
- [ ] 最終版確定

---

## 必要なツール

- **draw.io Desktop** または **diagrams.net (Web版)**
  - URL: https://app.diagrams.net/
  - ファイル形式: `.drawio` (XML形式、Git管理可能)
  - Export形式: PNG, SVG, PDF

---

## 成果物

以下のファイルを作成します：

1. `diagrams/operation-flow.drawio` - 動作フロー図
2. `diagrams/overall-architecture.drawio` - 全体システム構成図
3. `diagrams/backend-architecture.drawio` - バックエンド詳細図
4. `diagrams/frontend-architecture.drawio` - フロントエンド詳細図
5. `diagrams/database-architecture.drawio` - データベース詳細図
6. `diagrams/esp32-architecture.drawio` - ESP32詳細図
7. `diagrams/database-schema.drawio` - データベーススキーマ図

各図のPNG/SVG exportも作成し、`diagrams/exports/` に保存します。

---

## まとめ

このプランに基づいてdraw.ioで図を作成することで、システム全体の構造と動作を完全に可視化できます。

特に重要なポイント:
- **ESP32からのデータ送信 → レート判定 → 動的間隔制御** の完全なフロー
- **線形補間による精密な予測気温計算**のロジック
- **Cron Jobによる予測スナップショット保存**の仕組み
- **8つのデータベーステーブル**の役割と関係性

この図があれば、新規開発者も30分でシステム全体を理解できます。
