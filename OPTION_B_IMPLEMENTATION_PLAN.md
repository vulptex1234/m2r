# Option B: バックエンドレート判定の実装計画

## 🎯 目標

ESP32からのデータ送信時に、サーバー側でリアルタイムにレート判定を実行し、即座に最適な送信間隔を返す。

**達成基準**:
- ✅ ダッシュボードを閉じていてもレート判定が動作
- ✅ ESP32送信直後にcontrol_statesが更新される
- ✅ タイミング遅延がゼロ（即座に新interval取得）
- ✅ 既存のフロントエンド処理も動作し続ける

---

## 📊 全体アーキテクチャ

### Before（現在）

```
ESP32 → POST /api/measurements → device_measurements保存 → 終了
                                          ↓
                                    (レート判定なし)
                                          ↓
                              calculateNextInterval()
                                   ↓
                        control_states参照（空 or 古い）
                                   ↓
                          DEFAULT (300s) を返す


[別プロセス]
Frontend → 5秒ポーリング → raw_measurements取得 → レート判定
                                                    ↓
                                            control_states更新
```

### After（目標）

```
ESP32 → POST /api/measurements
          ↓
        device_measurements保存
          ↓
        天気予報取得（キャッシュ優先）
          ↓
        レート判定（サーバー側）
          ├─ 誤差分析
          ├─ Error Score計算
          └─ targetRate決定
          ↓
        processed_measurements保存
          ↓
        control_states更新
          ↓
        calculateNextInterval()
          ↓
        最新のtargetRateから間隔計算
          ↓
        ← nextIntervalSeconds返却


[共存]
Frontend → raw_measurements処理も継続（テストデータ用）
```

---

## 🗓️ 実装スケジュール

### 全体スケジュール（7フェーズ）

| Phase | タスク | 期間 | 成果物 |
|-------|--------|------|--------|
| **Phase 1** | 共有分析モジュール作成 | 1日 | `shared/analytics-service.js` |
| **Phase 2** | バックエンドレート判定実装 | 1日 | レート判定関数群 |
| **Phase 3** | 天気予報キャッシュ最適化 | 0.5日 | 効率的なキャッシュ戦略 |
| **Phase 4** | POST /api/measurementsに統合 | 1日 | 完全統合 |
| **Phase 5** | エラーハンドリング強化 | 0.5日 | 堅牢なエラー処理 |
| **Phase 6** | テストと検証 | 1日 | テストスイート |
| **Phase 7** | デプロイと監視 | 1日 | 本番稼働 |

**合計**: 約6日間

---

## 📋 Phase 1: 共有分析モジュール作成

### 目的

フロントエンドの `analytics-engine.js` のロジックをNode.jsで再実装し、サーバー側で使用可能にする。

### タスク

#### 1.1 新ファイル作成

**`shared/analytics-service.js`** を作成：

```javascript
/**
 * Shared Analytics Service
 *
 * フロントエンド（analytics-engine.js）と同じロジックを
 * Node.jsで実装。サーバー側のレート判定に使用。
 */

/**
 * Rate levels (LOW < MEDIUM < HIGH)
 */
const RateLevel = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH'
};

const rateOrder = [RateLevel.LOW, RateLevel.MEDIUM, RateLevel.HIGH];

/**
 * Default configuration
 * フロントエンドの app-config.js と同期を保つ
 */
const DEFAULT_CONFIG = {
  alpha: 0.3,              // EWMA係数
  sampleLimit: 48,         // サンプル数上限（2日分）
  safetyFloor: 'LOW',      // 最小レート
  thresholds: {
    escalateHigh: 0.45,    // HIGH昇格閾値
    escalateMedium: 0.70,  // MEDIUM昇格閾値
    demoteFromHigh: 0.55,  // HIGH降格閾値
    demoteFromMedium: 0.80 // MEDIUM降格閾値
  }
};

/**
 * Discrepancy Analyzer
 * 予測値と観測値の誤差を分析
 */
class DiscrepancyAnalyzer {
  /**
   * サンプル配列を更新（最新値を追加、古い値を削除）
   */
  static updateSamples(previousSamples, newObservedC, limit = DEFAULT_CONFIG.sampleLimit) {
    const samples = Array.isArray(previousSamples) ? [...previousSamples] : [];
    samples.push(newObservedC);

    if (samples.length > limit) {
      return samples.slice(-limit);
    }
    return samples;
  }

  /**
   * 日次標準偏差を計算
   */
  static computeSigmaDay(samples) {
    if (!Array.isArray(samples) || samples.length === 0) {
      return 1.0; // デフォルト値
    }

    const n = samples.length;
    const mean = samples.reduce((sum, val) => sum + val, 0) / n;
    const variance = samples.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const sigma = Math.sqrt(variance);

    return sigma > 0 ? sigma : 1.0;
  }

  /**
   * EWMA（指数加重移動平均）を更新
   */
  static updateEwma(previousEwma, newError, alpha = DEFAULT_CONFIG.alpha) {
    if (previousEwma === null || previousEwma === undefined || isNaN(previousEwma)) {
      return newError; // 初回
    }
    return alpha * newError + (1 - alpha) * previousEwma;
  }

  /**
   * 誤差分析を実行
   *
   * @param {number} forecastC - 予測温度
   * @param {number} observedC - 観測温度
   * @param {Object} previousState - 前回の状態
   * @returns {Object} 分析結果
   */
  static analyzeDiscrepancy(forecastC, observedC, previousState = {}) {
    const absError = Math.abs(forecastC - observedC);

    const updatedSamples = this.updateSamples(
      previousState.samples || [],
      observedC
    );

    const sigmaDay = this.computeSigmaDay(updatedSamples);
    const mEwma = this.updateEwma(previousState.mEwma, absError);

    const r = mEwma / Math.max(sigmaDay, 0.1);
    const sErr = Math.exp(-r); // Error score: 0=bad, 1=good

    return {
      absError: parseFloat(absError.toFixed(4)),
      updatedSamples,
      sigmaDay: parseFloat(sigmaDay.toFixed(4)),
      mEwma: parseFloat(mEwma.toFixed(4)),
      r: parseFloat(r.toFixed(4)),
      sErr: parseFloat(sErr.toFixed(4))
    };
  }
}

/**
 * Rate Controller
 * Error Scoreに基づいてレートを決定
 */
class RateController {
  static rateToIndex(rate) {
    return rateOrder.indexOf(rate);
  }

  static clampToSafetyFloor(rate, safetyFloor) {
    const targetIndex = this.rateToIndex(rate);
    const floorIndex = this.rateToIndex(safetyFloor);
    return rateOrder[Math.max(targetIndex, floorIndex)] || safetyFloor;
  }

  /**
   * レートを決定
   *
   * @param {number} sErr - Error Score
   * @param {string} previousRate - 前回のレート
   * @param {string} safetyFloor - 最小レート
   * @param {Object} config - 設定（省略可）
   * @returns {Object} レート決定結果
   */
  static decideRate(sErr, previousRate, safetyFloor = DEFAULT_CONFIG.safetyFloor, config = DEFAULT_CONFIG) {
    const { thresholds } = config;

    // 閾値ベースの判定
    let candidate;
    if (sErr < thresholds.escalateHigh) {
      candidate = RateLevel.HIGH;
    } else if (sErr < thresholds.escalateMedium) {
      candidate = RateLevel.MEDIUM;
    } else {
      candidate = RateLevel.LOW;
    }

    // ヒステリシス（振動防止）
    if (previousRate === RateLevel.HIGH && sErr > thresholds.demoteFromHigh) {
      candidate = RateLevel.MEDIUM;
    }
    if (previousRate === RateLevel.MEDIUM && sErr >= thresholds.demoteFromMedium) {
      candidate = RateLevel.LOW;
    }

    const targetRate = this.clampToSafetyFloor(candidate, safetyFloor);

    // 理由を判定
    let reason = "baseline-threshold";
    if (targetRate !== candidate) {
      reason = "safety-floor";
    } else if (targetRate !== previousRate) {
      reason = targetRate === RateLevel.HIGH ? "escalate" : "de-escalate";
    } else {
      reason = "hold";
    }

    return {
      targetRate,
      previousRate: previousRate || RateLevel.LOW,
      reason
    };
  }
}

/**
 * IoT Processing Engine
 * 測定データを処理し、レート判定を実行
 */
class IoTProcessingEngine {
  /**
   * 測定データを処理
   *
   * @param {Object} measurementData - 測定データ
   * @param {Object} previousState - 前回の状態
   * @param {number} forecastC - 予測温度
   * @returns {Object} 処理結果
   */
  static processMeasurement(measurementData, previousState, forecastC) {
    const { nodeId, observedC, batteryV, timestamp } = measurementData;

    // 誤差分析
    const { absError, updatedSamples, sigmaDay, mEwma, r, sErr } =
      DiscrepancyAnalyzer.analyzeDiscrepancy(forecastC, observedC, previousState);

    // レート判定
    const { targetRate, previousRate, reason } =
      RateController.decideRate(sErr, previousState.targetRate || RateLevel.LOW);

    return {
      nodeId,
      observedC: parseFloat(observedC.toFixed(2)),
      forecastC: parseFloat(forecastC.toFixed(2)),
      absError,
      batteryV: batteryV ? parseFloat(batteryV.toFixed(3)) : null,
      sErr,
      targetRate,
      previousRate,
      reason,
      mEwma,
      sigmaDay,
      updatedSamples,
      samples: updatedSamples, // エイリアス（persistence.jsとの互換性）
      measuredAt: timestamp || new Date().toISOString(),
      mode: 'ACTIVE'
    };
  }
}

module.exports = {
  RateLevel,
  DiscrepancyAnalyzer,
  RateController,
  IoTProcessingEngine,
  DEFAULT_CONFIG
};
```

#### 1.2 ユニットテスト作成

**`shared/analytics-service.test.js`** を作成：

```javascript
const {
  DiscrepancyAnalyzer,
  RateController,
  IoTProcessingEngine,
  RateLevel
} = require('./analytics-service');

describe('DiscrepancyAnalyzer', () => {
  test('should calculate correct error score', () => {
    const result = DiscrepancyAnalyzer.analyzeDiscrepancy(25.0, 27.0, {
      samples: [24, 25, 26],
      mEwma: 1.5
    });

    expect(result.absError).toBe(2.0);
    expect(result.sErr).toBeGreaterThan(0);
    expect(result.sErr).toBeLessThan(1);
  });

  test('should handle first measurement', () => {
    const result = DiscrepancyAnalyzer.analyzeDiscrepancy(25.0, 25.5, {});

    expect(result.mEwma).toBe(0.5);
    expect(result.updatedSamples).toEqual([25.5]);
  });
});

describe('RateController', () => {
  test('should return HIGH for low error score', () => {
    const result = RateController.decideRate(0.3, 'MEDIUM');
    expect(result.targetRate).toBe(RateLevel.HIGH);
  });

  test('should return MEDIUM for mid error score', () => {
    const result = RateController.decideRate(0.6, 'MEDIUM');
    expect(result.targetRate).toBe(RateLevel.MEDIUM);
  });

  test('should return LOW for high error score', () => {
    const result = RateController.decideRate(0.8, 'MEDIUM');
    expect(result.targetRate).toBe(RateLevel.LOW);
  });

  test('should apply hysteresis', () => {
    const result = RateController.decideRate(0.5, 'HIGH');
    expect(result.targetRate).toBe(RateLevel.MEDIUM); // 降格
  });
});

describe('IoTProcessingEngine', () => {
  test('should process measurement correctly', () => {
    const measurement = {
      nodeId: 'test-node-01',
      observedC: 25.5,
      batteryV: 3.7,
      timestamp: '2025-10-09T12:00:00Z'
    };

    const previousState = {
      samples: [24, 25, 26],
      mEwma: 1.0,
      targetRate: 'MEDIUM'
    };

    const result = IoTProcessingEngine.processMeasurement(
      measurement,
      previousState,
      24.0 // forecast
    );

    expect(result.nodeId).toBe('test-node-01');
    expect(result.observedC).toBe(25.5);
    expect(result.forecastC).toBe(24.0);
    expect(result).toHaveProperty('targetRate');
    expect(result).toHaveProperty('sErr');
  });
});
```

#### 1.3 検証

```bash
# テスト実行
cd shared
npm test analytics-service.test.js

# 期待される出力:
# ✓ DiscrepancyAnalyzer: should calculate correct error score
# ✓ DiscrepancyAnalyzer: should handle first measurement
# ✓ RateController: should return HIGH for low error score
# ✓ RateController: should return MEDIUM for mid error score
# ✓ RateController: should return LOW for high error score
# ✓ RateController: should apply hysteresis
# ✓ IoTProcessingEngine: should process measurement correctly
#
# Test Suites: 1 passed, 1 total
# Tests:       7 passed, 7 total
```

### 成果物

- [x] `shared/analytics-service.js` - 分析ロジック
- [x] `shared/analytics-service.test.js` - ユニットテスト
- [x] テスト全件パス

---

## 📋 Phase 2: バックエンドレート判定実装

### 目的

POST /api/measurements エンドポイントにレート判定ロジックを統合する準備。

### タスク

#### 2.1 天気予報取得関数の作成

**`shared/weather-service.js`** を作成：

```javascript
const { getLatestForecastSnapshot } = require('./persistence');

/**
 * 天気予報を取得（キャッシュ優先）
 *
 * @returns {Promise<Object|null>} 予報データ
 */
async function getCachedForecast() {
  try {
    const forecast = await getLatestForecastSnapshot();

    if (!forecast || !forecast.forecastC) {
      console.warn('⚠️ [weather] No forecast data available');
      return null;
    }

    // キャッシュの新鮮度チェック（1時間以内か？）
    const fetchedAt = new Date(forecast.fetchedAt);
    const ageMinutes = (Date.now() - fetchedAt.getTime()) / 60000;

    if (ageMinutes > 60) {
      console.warn(`⚠️ [weather] Forecast data is ${ageMinutes.toFixed(0)} minutes old`);
    }

    console.log(`📊 [weather] Using cached forecast: ${forecast.forecastC}°C (age: ${ageMinutes.toFixed(0)}min)`);
    return forecast;

  } catch (error) {
    console.error('❌ [weather] Failed to get forecast:', error.message);
    return null;
  }
}

/**
 * 天気予報が利用可能かチェック
 *
 * @returns {Promise<boolean>}
 */
async function isForecastAvailable() {
  const forecast = await getCachedForecast();
  return forecast !== null && forecast.forecastC !== null;
}

module.exports = {
  getCachedForecast,
  isForecastAvailable
};
```

#### 2.2 レート判定統合関数の作成

**`shared/measurement-processor.js`** を作成：

```javascript
const { IoTProcessingEngine } = require('./analytics-service');
const { getCachedForecast } = require('./weather-service');
const { getControlState, saveProcessedMeasurementBatch } = require('./persistence');

/**
 * 測定データを処理してレート判定を実行
 *
 * @param {Object} measurementData - 測定データ
 * @returns {Promise<Object|null>} 処理結果（失敗時はnull）
 */
async function processMeasurementWithRating(measurementData) {
  const { deviceId, temperature, humidity, voltage, current, power, recordedAt } = measurementData;

  try {
    // 1. 天気予報を取得
    const forecast = await getCachedForecast();

    if (!forecast || forecast.forecastC === null) {
      console.warn(`⚠️ [processor] No forecast available, skipping rate decision for ${deviceId}`);
      return null;
    }

    // 2. 前回の状態を取得
    const previousState = await getControlState(deviceId) || {};

    // 3. レート判定を実行
    const processingResult = IoTProcessingEngine.processMeasurement(
      {
        nodeId: deviceId,
        observedC: temperature,
        batteryV: voltage,
        timestamp: recordedAt || new Date().toISOString()
      },
      previousState,
      forecast.forecastC
    );

    console.log(`📊 [processor] Rate decision for ${deviceId}:`, {
      observedC: processingResult.observedC,
      forecastC: processingResult.forecastC,
      absError: processingResult.absError,
      sErr: processingResult.sErr,
      targetRate: processingResult.targetRate,
      previousRate: processingResult.previousRate,
      reason: processingResult.reason
    });

    // 4. 処理結果を保存（processed_measurements + control_states更新）
    await saveProcessedMeasurementBatch(processingResult);

    console.log(`✅ [processor] Successfully processed and saved for ${deviceId}`);

    return processingResult;

  } catch (error) {
    console.error(`❌ [processor] Failed to process measurement for ${deviceId}:`, error);
    return null;
  }
}

/**
 * レート判定が可能かチェック
 *
 * @param {Object} measurementData - 測定データ
 * @returns {boolean}
 */
function canProcessMeasurement(measurementData) {
  return (
    measurementData &&
    measurementData.deviceId &&
    measurementData.temperature !== null &&
    measurementData.temperature !== undefined &&
    !isNaN(measurementData.temperature)
  );
}

module.exports = {
  processMeasurementWithRating,
  canProcessMeasurement
};
```

### 成果物

- [x] `shared/weather-service.js` - 天気予報取得
- [x] `shared/measurement-processor.js` - レート判定統合

---

## 📋 Phase 3: 天気予報キャッシュ最適化

### 目的

OpenWeatherMap APIの呼び出し回数を削減し、コストを抑える。

### 現状の問題

- フロントエンドが1時間ごとにAPI呼び出し
- バックエンドでも追加で呼び出すとコスト増

### 解決策

**forecast_snapshots テーブルを効率的に活用**：

1. フロントエンドが1時間ごとに更新を継続
2. バックエンドはキャッシュのみ参照（API呼び出しなし）
3. キャッシュが古い場合は警告のみ（処理は継続）

#### 3.1 キャッシュ戦略の実装

**`shared/weather-service.js`** に追加：

```javascript
/**
 * キャッシュの新鮮度を評価
 *
 * @param {Object} forecast - 予報データ
 * @returns {Object} 評価結果
 */
function evaluateCacheFreshness(forecast) {
  if (!forecast || !forecast.fetchedAt) {
    return { fresh: false, ageMinutes: Infinity, status: 'missing' };
  }

  const fetchedAt = new Date(forecast.fetchedAt);
  const ageMinutes = (Date.now() - fetchedAt.getTime()) / 60000;

  let status;
  if (ageMinutes <= 60) {
    status = 'fresh';       // 1時間以内
  } else if (ageMinutes <= 120) {
    status = 'acceptable';  // 2時間以内
  } else if (ageMinutes <= 360) {
    status = 'stale';       // 6時間以内
  } else {
    status = 'expired';     // 6時間超
  }

  return {
    fresh: status === 'fresh',
    ageMinutes: Math.floor(ageMinutes),
    status
  };
}
```

#### 3.2 フォールバック戦略

```javascript
/**
 * 天気予報を取得（フォールバック戦略付き）
 *
 * @returns {Promise<Object|null>}
 */
async function getCachedForecastWithFallback() {
  const forecast = await getCachedForecast();

  if (!forecast) {
    return null;
  }

  const { fresh, ageMinutes, status } = evaluateCacheFreshness(forecast);

  // ステータスに応じたログ
  switch (status) {
    case 'fresh':
      console.log(`✅ [weather] Fresh forecast available (${ageMinutes}min old)`);
      break;
    case 'acceptable':
      console.log(`⚠️ [weather] Forecast slightly old (${ageMinutes}min), but usable`);
      break;
    case 'stale':
      console.warn(`⚠️ [weather] Forecast is stale (${ageMinutes}min), accuracy may be reduced`);
      break;
    case 'expired':
      console.error(`❌ [weather] Forecast expired (${ageMinutes}min), consider refreshing`);
      // それでも使用は継続（nullを返すよりマシ）
      break;
  }

  return forecast;
}
```

### 成果物

- [x] キャッシュ新鮮度評価
- [x] フォールバック戦略
- [x] OpenWeatherMap API呼び出し回数: 0（バックエンドから）

---

## 📋 Phase 4: POST /api/measurements に統合

### 目的

すべてのコンポーネントをPOST /api/measurementsエンドポイントに統合。

### タスク

#### 4.1 server.js の更新

**`web-service/src/server.js`** を編集：

```javascript
// 新しいモジュールをインポート
const { processMeasurementWithRating, canProcessMeasurement } = require('../../shared/measurement-processor');

// POST /api/measurements エンドポイントを更新
app.post('/api/measurements', async (req, res) => {
  try {
    await startup;
    const { deviceId, temperature, humidity, recordedAt, payload } = req.body || {};

    // 1. バリデーション
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const tempValue = temperature !== undefined ? Number(temperature) : null;
    if (tempValue !== null && Number.isNaN(tempValue)) {
      return res.status(400).json({ error: 'temperature must be a number' });
    }

    const humidityValue = humidity !== undefined ? Number(humidity) : null;
    if (humidityValue !== null && Number.isNaN(humidityValue)) {
      return res.status(400).json({ error: 'humidity must be a number' });
    }

    if (recordedAt && Number.isNaN(new Date(recordedAt).getTime())) {
      return res.status(400).json({ error: 'recordedAt must be a valid ISO date string' });
    }

    // 2. device_measurements に保存
    await insertDeviceMeasurement({
      deviceId,
      temperature: tempValue,
      humidity: humidityValue,
      recordedAt,
      payload: payload ?? req.body
    });

    console.log(`📥 [measurements] Received from ${deviceId}: temp=${tempValue}°C, humidity=${humidityValue}%`);

    // 3. レート判定を実行（非同期、失敗しても継続）
    const measurementData = {
      deviceId,
      temperature: tempValue,
      humidity: humidityValue,
      voltage: payload?.voltage_v,
      current: payload?.current_ma,
      power: payload?.power_mw,
      recordedAt
    };

    if (canProcessMeasurement(measurementData)) {
      try {
        const processingResult = await processMeasurementWithRating(measurementData);

        if (processingResult) {
          console.log(`✅ [measurements] Rate decision completed: ${processingResult.targetRate}`);
        } else {
          console.log(`⚠️ [measurements] Rate decision skipped (forecast unavailable)`);
        }
      } catch (processingError) {
        // レート判定エラーは致命的ではない（ログのみ）
        console.error(`❌ [measurements] Rate decision failed (non-fatal):`, processingError);
      }
    }

    // 4. 次回送信間隔を計算
    const nextInterval = await calculateNextInterval(deviceId);

    console.log(`📤 [measurements] Responding to ${deviceId}: nextInterval=${nextInterval}s`);

    return res.status(201).json({
      status: 'ok',
      nextIntervalSeconds: nextInterval,
      message: 'Measurement recorded successfully'
    });

  } catch (error) {
    console.error('[measurements] failed', error);
    return res.status(500).json({
      error: 'Failed to record measurement',
      message: error.message
    });
  }
});
```

#### 4.2 動作フロー

```
ESP32 → POST /api/measurements
  ↓
1. バリデーション
  ↓
2. device_measurements 保存 ✅
  ↓
3. レート判定実行
  ├─ 天気予報取得（キャッシュ）
  ├─ control_states参照
  ├─ IoTProcessingEngine.processMeasurement()
  ├─ processed_measurements保存
  └─ control_states更新 ✅
  ↓
4. calculateNextInterval()
  └─ 最新のtargetRateを参照 ✅
  ↓
5. レスポンス返却
  ← { status: "ok", nextIntervalSeconds: 60 }
```

### 成果物

- [x] POST /api/measurements 統合完了
- [x] エラーハンドリング実装
- [x] ログ出力強化

---

## 📋 Phase 5: エラーハンドリング強化

### 目的

様々なエラーケースに対応し、システムの堅牢性を確保。

### エラーシナリオ

| シナリオ | 対応 | 動作 |
|---------|------|------|
| 天気予報なし | 警告ログ | レート判定スキップ、DEFAULT間隔返却 |
| control_states空 | 初期値使用 | 新規エントリ作成 |
| 温度データ不正 | バリデーション | 400エラー返却 |
| DB接続エラー | エラーログ | 500エラー返却 |
| レート判定失敗 | 非致命的エラー | 処理継続、DEFAULT間隔返却 |

### 実装

#### 5.1 エラーハンドラーの追加

**`shared/measurement-processor.js`** を更新：

```javascript
async function processMeasurementWithRating(measurementData) {
  const { deviceId, temperature } = measurementData;

  try {
    // 天気予報チェック
    const forecast = await getCachedForecast();
    if (!forecast || forecast.forecastC === null) {
      console.warn(`⚠️ [processor] No forecast for ${deviceId}, using fallback strategy`);

      // フォールバック: 前回のレートを維持
      const previousState = await getControlState(deviceId);
      if (previousState && previousState.targetRate) {
        console.log(`📊 [processor] Using previous rate: ${previousState.targetRate}`);
        return {
          nodeId: deviceId,
          targetRate: previousState.targetRate,
          reason: 'forecast-unavailable-fallback',
          mode: 'FALLBACK'
        };
      }

      return null; // 初回で予報なし
    }

    // 通常処理
    const previousState = await getControlState(deviceId) || {};
    const processingResult = IoTProcessingEngine.processMeasurement(
      {
        nodeId: deviceId,
        observedC: temperature,
        batteryV: measurementData.voltage,
        timestamp: measurementData.recordedAt || new Date().toISOString()
      },
      previousState,
      forecast.forecastC
    );

    await saveProcessedMeasurementBatch(processingResult);
    return processingResult;

  } catch (error) {
    console.error(`❌ [processor] Critical error for ${deviceId}:`, error);

    // エラー時のフォールバック
    try {
      const previousState = await getControlState(deviceId);
      if (previousState) {
        return {
          nodeId: deviceId,
          targetRate: previousState.targetRate || 'MEDIUM',
          reason: 'error-fallback',
          mode: 'ERROR_FALLBACK'
        };
      }
    } catch (fallbackError) {
      console.error(`❌ [processor] Fallback also failed for ${deviceId}:`, fallbackError);
    }

    return null;
  }
}
```

#### 5.2 グレースフルデグラデーション

```javascript
// calculateNextInterval() の更新
async function calculateNextInterval(deviceId) {
  try {
    await startup;
    const controlState = await getControlState(deviceId);

    if (!controlState || !controlState.targetRate) {
      console.log(`📊 [interval-control] No control state for ${deviceId}, using DEFAULT`);
      return RATE_INTERVAL_MAP.DEFAULT;
    }

    const targetRate = controlState.targetRate;
    const interval = RATE_INTERVAL_MAP[targetRate] || RATE_INTERVAL_MAP.DEFAULT;

    console.log(`📊 [interval-control] ${deviceId}: ${targetRate} → ${interval}s`);
    return interval;

  } catch (error) {
    console.error(`❌ [interval-control] Failed for ${deviceId}, using DEFAULT:`, error);
    return RATE_INTERVAL_MAP.DEFAULT; // 最終フォールバック
  }
}
```

### 成果物

- [x] エラーハンドリング実装
- [x] フォールバック戦略
- [x] グレースフルデグラデーション

---

## 📋 Phase 6: テストと検証

### 目的

実装した機能が正しく動作することを確認。

### テストケース

#### 6.1 ユニットテスト

```bash
# shared/analytics-service.test.js
npm test analytics-service.test.js

# 期待される結果:
# ✓ すべてのテストがパス
```

#### 6.2 統合テスト（ローカル）

**テストスクリプト `web-service/test-backend-rating.sh`**:

```bash
#!/bin/bash

echo "🧪 Testing Backend Rate Decision System"
echo "========================================"

# 1. サーバー起動確認
echo ""
echo "Step 1: Check server health"
curl -s http://localhost:3000/health | jq .
echo ""

# 2. 天気予報があることを確認
echo "Step 2: Check forecast availability"
curl -s http://localhost:3000/api/forecast/snapshot | jq '.forecastC'
echo ""

# 3. 初回測定送信（control_states作成）
echo "Step 3: Send first measurement (should create control_state)"
curl -X POST http://localhost:3000/api/measurements \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-backend-01",
    "temperature": 25.0,
    "humidity": 60.0
  }' | jq .
echo ""

# 4. control_statesを確認
echo "Step 4: Check control_states"
curl -s "http://localhost:3000/api/control-states/test-backend-01" | jq '{targetRate, sErr, mEwma}'
echo ""

# 5. 異常データ送信（HIGHにエスカレート）
echo "Step 5: Send anomalous data (should escalate to HIGH)"
curl -X POST http://localhost:3000/api/measurements \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-backend-01",
    "temperature": 35.0,
    "humidity": 60.0
  }' | jq .
echo ""

# 6. control_statesを再確認（HIGHになっているはず）
echo "Step 6: Verify rate changed to HIGH"
curl -s "http://localhost:3000/api/control-states/test-backend-01" | jq '{targetRate, sErr, nextInterval: .targetRate}'
echo ""

# 7. 次回送信でintervalが60sになることを確認
echo "Step 7: Send another measurement (should get 60s interval)"
curl -X POST http://localhost:3000/api/measurements \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-backend-01",
    "temperature": 26.0,
    "humidity": 60.0
  }' | jq '{status, nextIntervalSeconds}'
echo ""

echo "✅ Test completed!"
echo ""
echo "Expected results:"
echo "  - Step 3: nextIntervalSeconds should be 300 (MEDIUM or DEFAULT)"
echo "  - Step 5: After anomaly, target should escalate"
echo "  - Step 7: nextIntervalSeconds should be 60 (HIGH)"
```

#### 6.3 実行

```bash
# サーバー起動
cd web-service
npm run dev

# 別ターミナルでテスト実行
chmod +x test-backend-rating.sh
./test-backend-rating.sh
```

#### 6.4 ESP32実機テスト

```bash
# ESP32からデータ送信
# boot.py を実行

# 期待されるログ:
# ✓ Data sent successfully to Render!
#   Server recommended interval: 300s (5min)
# Loop completed, sleeping for 300s (5min)

# サーバー側ログ:
# 📥 [measurements] Received from esp32-node-01: temp=25.5°C
# 📊 [processor] Rate decision for esp32-node-01: targetRate=MEDIUM
# ✅ [processor] Successfully processed and saved
# 📤 [measurements] Responding: nextInterval=300s
```

### 成果物

- [x] ユニットテスト全件パス
- [x] 統合テストスクリプト
- [x] ESP32実機テスト成功

---

## 📋 Phase 7: デプロイと監視

### 目的

本番環境にデプロイし、動作を監視。

### デプロイ手順

#### 7.1 コミットとプッシュ

```bash
git add shared/analytics-service.js \
        shared/weather-service.js \
        shared/measurement-processor.js \
        web-service/src/server.js

git commit -m "feat(backend): implement server-side rate decision system

- Add analytics-service.js: shared rate decision logic
- Add weather-service.js: forecast caching strategy
- Add measurement-processor.js: measurement processing orchestrator
- Integrate backend rate decision into POST /api/measurements
- Add comprehensive error handling and fallback strategies
- Add unit tests for analytics service

Benefits:
- ESP32 autonomy: works without frontend
- Zero latency: rate decision on data arrival
- Improved reliability: graceful degradation
- Better battery life: optimal interval immediately

Breaking changes: None
- Frontend processing continues to work
- Backward compatible with existing ESP32 code"

git push origin main
```

#### 7.2 Renderでの確認

```bash
# Renderログを監視
# https://dashboard.render.com/web/srv-XXXXX/logs

# 期待されるログ:
# 📥 [measurements] Received from esp32-node-01
# 📊 [weather] Using cached forecast: 24.5°C (age: 15min)
# 📊 [processor] Rate decision: targetRate=MEDIUM, sErr=0.6543
# ✅ [processor] Successfully processed and saved
# 📊 [interval-control] esp32-node-01: MEDIUM → 300s
# 📤 [measurements] Responding: nextInterval=300s
```

#### 7.3 監視ダッシュボード

**監視項目**:

| 項目 | 確認方法 | 正常値 |
|------|---------|--------|
| API応答時間 | Renderダッシュボード | < 1秒 |
| エラー率 | ログ検索 "❌" | < 1% |
| 天気予報キャッシュヒット率 | ログ検索 "cached forecast" | > 95% |
| レート判定成功率 | ログ検索 "Successfully processed" | > 95% |
| control_states更新頻度 | PostgreSQL監視 | ESP32送信ごと |

#### 7.4 ヘルスチェック

**新しいエンドポイント追加**:

```javascript
// web-service/src/server.js
app.get('/api/system/health-detailed', async (req, res) => {
  try {
    await startup;

    // 天気予報状態
    const forecast = await getLatestForecastSnapshot();
    const forecastAge = forecast ? (Date.now() - new Date(forecast.fetchedAt).getTime()) / 60000 : null;

    // control_states数
    const pool = getPool();
    const { rows: stateCount } = await pool.query('SELECT COUNT(*) FROM control_states');

    // 処理済み測定数（直近1時間）
    const { rows: recentProcessed } = await pool.query(`
      SELECT COUNT(*) FROM processed_measurements
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `);

    return res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      forecast: {
        available: forecast !== null,
        ageMinutes: forecastAge ? Math.floor(forecastAge) : null,
        temp: forecast?.forecastC || null
      },
      controlStates: {
        count: Number(stateCount[0].count)
      },
      processedLastHour: {
        count: Number(recentProcessed[0].count)
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});
```

### 成果物

- [x] Renderにデプロイ
- [x] ログ監視設定
- [x] ヘルスチェックエンドポイント
- [x] 動作確認完了

---

## 🚀 ロールアウト戦略

### 段階的展開

#### Stage 1: 検証環境（1日）

- Renderにデプロイ
- テストデバイスで動作確認
- ログを監視

#### Stage 2: 限定展開（2日）

- 1〜2台のESP32で本番運用
- 動作を観察
- 問題があれば即座にロールバック

#### Stage 3: 全展開（1週間）

- 全ESP32デバイスに展開
- パフォーマンス監視
- コスト監視（OpenWeatherMap API呼び出し）

---

## 📊 成功指標

### KPI

| 指標 | 目標 | 測定方法 |
|------|------|---------|
| **レート判定成功率** | > 95% | ログ解析 |
| **API応答時間** | < 1秒 | Renderダッシュボード |
| **control_states更新頻度** | ESP32送信ごと | PostgreSQL監視 |
| **天気予報API呼び出し** | 0回/送信 | ログ確認 |
| **ESP32間隔変更成功率** | 100% | 実機ログ確認 |
| **バッテリー寿命改善** | HIGHで12日→LOWで181日 | 長期観測 |

---

## ⚠️ リスクと軽減策

### リスク1: 天気予報キャッシュ切れ

**リスク**: フロントエンドを長時間開かない → キャッシュが古くなる

**軽減策**:
- バックエンドから定期的に天気予報を更新するCron Job（オプション）
- 古いキャッシュでも処理継続（警告のみ）

### リスク2: サーバー負荷増加

**リスク**: ESP32送信ごとにレート判定 → CPU使用率上昇

**軽減策**:
- 処理の非同期化
- エラー時の早期リターン
- キャッシュの活用

### リスク3: データベースロック競合

**リスク**: control_states更新時の競合

**軽減策**:
- PostgreSQLのUPSERT（ON CONFLICT）を活用（既に実装済み）
- トランザクション管理の徹底

### リスク4: フロントエンドとの不整合

**リスク**: バックエンドとフロントエンドで異なるレート判定結果

**軽減策**:
- 同じロジックを共有（analytics-service.js）
- フロントエンドも引き続き動作（二重チェック）
- 不整合時はログで検知

---

## 🔄 ロールバック計画

### 問題発生時の対応

#### シナリオ1: API応答が遅い

```bash
# calculateNextInterval() のみ残して、レート判定を無効化
# server.js の processMeasurementWithRating() 呼び出しをコメントアウト
git revert <commit-hash>
git push origin main
```

#### シナリオ2: レート判定が不正確

```bash
# フロントエンド処理のみに戻す
# バックエンド処理を無効化
```

#### シナリオ3: 致命的エラー

```bash
# 完全ロールバック
git revert <commit-hash>
git push origin main
```

---

## ✅ 完了チェックリスト

### Phase 1
- [ ] `shared/analytics-service.js` 作成
- [ ] `shared/analytics-service.test.js` 作成
- [ ] ユニットテスト全件パス

### Phase 2
- [ ] `shared/weather-service.js` 作成
- [ ] `shared/measurement-processor.js` 作成

### Phase 3
- [ ] キャッシュ新鮮度評価実装
- [ ] フォールバック戦略実装

### Phase 4
- [ ] `server.js` に統合
- [ ] ログ出力強化

### Phase 5
- [ ] エラーハンドリング実装
- [ ] グレースフルデグラデーション実装

### Phase 6
- [ ] ユニットテスト実行
- [ ] 統合テスト実行
- [ ] ESP32実機テスト

### Phase 7
- [ ] Renderにデプロイ
- [ ] ログ監視
- [ ] ヘルスチェック確認
- [ ] 本番動作確認

---

## 📚 関連ドキュメント

- [TARGET_RATE_ANALYSIS.md](TARGET_RATE_ANALYSIS.md) - 現状分析と問題点
- [ESP32_INTERVAL_CONTROL.md](ESP32_INTERVAL_CONTROL.md) - 間隔制御アーキテクチャ
- [RATE_CONTROL_ARCHITECTURE.md](RATE_CONTROL_ARCHITECTURE.md) - レート制御の詳細

---

**作成日**: 2025-10-09
**予想実装期間**: 6日間
**難易度**: ⭐⭐⭐⭐⭐ 高
**優先度**: 🔴 HIGH
