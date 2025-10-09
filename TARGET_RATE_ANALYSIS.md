# targetRate決定プロセスの詳細分析

## 🚨 重大な問題発見

ESP32からの実データが**レート判定されていない**可能性が高い。

---

## 📊 現在の実装分析

### データフロー（想定されていた設計）

```
┌─────────────┐
│   ESP32     │
│  (センサー)   │
└──────┬──────┘
       │ POST /api/measurements
       ▼
┌─────────────────────┐
│  Render Backend     │
│  device_measurements│  ❌ レート判定なし
│  テーブルに保存のみ   │
└─────────────────────┘


┌──────────────────────┐
│  Test Data Generator │
└──────┬───────────────┘
       │ POST /api/raw-measurements
       ▼
┌─────────────────────┐
│  Render Backend     │
│  raw_measurements   │
└──────┬──────────────┘
       │
       │ ✅ ポーリングされる
       ▼
┌──────────────────────┐
│  Frontend (Browser)  │
│  5秒ごとにポーリング   │
├──────────────────────┤
│ 1. GET /api/raw-     │
│    measurements      │
│ 2. processMeasure    │
│    ment()実行        │
│ 3. レート判定        │
│ 4. control_states    │
│    更新              │
└──────────────────────┘
```

### 実際のデータフロー詳細

#### 1. テストデータ（動作する）

```javascript
// public/js/test-data-generator.js (line 137)
await backendService.addRawMeasurement(measurementData);
  ↓
// POST /api/raw-measurements
  ↓
// raw_measurements テーブルに保存
  ↓
// フロントエンドが5秒ごとにポーリング
backendService.setupRawMeasurementListener(callback, 5000)
  ↓
// GET /api/raw-measurements?since=...
  ↓
// 新データ発見 → processMeasurement() 実行
  ↓
// IoTProcessingEngine.processMeasurement()
  ├─ DiscrepancyAnalyzer.analyzeDiscrepancy()
  │   └─ sErr (error score) 計算
  ├─ RateController.decideRate(sErr, previousRate)
  │   └─ targetRate 決定 (HIGH/MEDIUM/LOW)
  └─ 結果を返す
  ↓
// POST /api/processed-measurements
  ↓
// control_states テーブル更新 ✅
```

#### 2. ESP32データ（動作しない可能性）

```python
# ESP32: esp32/boot.py
urequests.post(
    "https://m2r.onrender.com/api/measurements",
    data=json_data
)
  ↓
# POST /api/measurements
  ↓
# device_measurements テーブルに保存
  ↓
# ❌ raw_measurements には保存されない
  ↓
# ❌ フロントエンドのポーリングが検知しない
  ↓
# ❌ processMeasurement() が呼ばれない
  ↓
# ❌ レート判定が行われない
  ↓
# ❌ control_states が更新されない
  ↓
# ❌ 次回ESP32送信時、古い（または存在しない）targetRateが返される
```

---

## 🔍 コード分析

### フロントエンド: リスナー登録

**public/js/dashboard.js (line 102)**
```javascript
await realtimeProcessor.initialize();
```

**public/js/realtime-processor.js (line 139-150)**
```javascript
setupMeasurementListener() {
  backendService.setupRawMeasurementListener(async (rawMeasurement) => {
    if (this.isProcessing) {
      AnalyticsLogger.log('⏳ Skipping measurement - processor busy');
      return;
    }
    await this.processMeasurement(rawMeasurement);
  });
  AnalyticsLogger.log('👂 Raw measurement listener active');
}
```

**public/js/backend-service.js (line 127-173)**
```javascript
setupRawMeasurementListener(callback, intervalMs = 5000) {
  const poll = async () => {
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
  };
  const timer = setInterval(poll, intervalMs); // 5秒ごと
  poll();
}
```

**重要**: このリスナーは **`/api/raw-measurements`** のみを監視！

### バックエンド: 2つの異なるエンドポイント

**web-service/src/server.js**

#### エンドポイント1: device_measurements（ESP32用）

```javascript
// line 192-238
app.post('/api/measurements', async (req, res) => {
  const { deviceId, temperature, humidity, recordedAt, payload } = req.body || {};

  await insertDeviceMeasurement({
    deviceId,
    temperature: tempValue,
    humidity: humidityValue,
    recordedAt,
    payload: payload ?? req.body
  });

  // 間隔計算（追加した新機能）
  const nextInterval = await calculateNextInterval(deviceId);

  return res.status(201).json({
    status: 'ok',
    nextIntervalSeconds: nextInterval,
    message: 'Measurement recorded successfully'
  });
});
```

**保存先**: `device_measurements` テーブル
**レート判定**: ❌ なし
**フロントエンド監視**: ❌ されない

#### エンドポイント2: raw_measurements（テストデータ用）

```javascript
// line 294-306
app.post('/api/raw-measurements', async (req, res) => {
  await insertRawMeasurement(req.body || {});
  return res.status(201).json({ status: 'ok' });
});
```

**保存先**: `raw_measurements` テーブル
**レート判定**: ✅ フロントエンドが処理
**フロントエンド監視**: ✅ 5秒ごとにポーリング

### targetRate決定ロジック

**public/js/analytics-engine.js (line 125-163)**

```javascript
static decideRate(sErr, previousRate, safetyFloor = 'LOW') {
  const { thresholds } = appConfig.control;

  // 閾値ベースの判定
  let candidate;
  if (sErr < thresholds.escalateHigh) {        // < 0.45
    candidate = RateLevel.HIGH;
  } else if (sErr < thresholds.escalateMedium) { // < 0.70
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

  return { targetRate, previousRate, reason };
}
```

**Error Score計算**:
```javascript
static analyzeDiscrepancy(forecastC, observedC, previousState = {}) {
  const absError = Math.abs(forecastC - observedC);
  const updatedSamples = this.updateSamples(previousState.samples, observedC);
  const sigmaDay = this.computeSigmaDay(updatedSamples);
  const mEwma = this.updateEwma(previousState.mEwma, absError);
  const r = mEwma / Math.max(sigmaDay, 0.1);
  const sErr = Math.exp(-r);  // 0=bad, 1=good

  return { absError, updatedSamples, sigmaDay, mEwma, r, sErr };
}
```

**処理統合**:
```javascript
// public/js/analytics-engine.js (line 174-224)
static processMeasurement(measurementData, previousState, forecastC) {
  const { nodeId, observedC, batteryV, timestamp } = measurementData;

  // 誤差分析
  const { absError, updatedSamples, sigmaDay, mEwma, r, sErr } =
    DiscrepancyAnalyzer.analyzeDiscrepancy(forecastC, observedC, previousState);

  // レート判定
  const { targetRate, previousRate, reason } =
    RateController.decideRate(sErr, previousState.targetRate, previousState.mode);

  return {
    nodeId,
    observedC,
    forecastC,
    absError,
    batteryV,
    sErr,
    targetRate,
    previousRate,
    reason,
    mEwma,
    sigmaDay,
    updatedSamples,
    measuredAt: timestamp,
    mode: 'ACTIVE'
  };
}
```

---

## 🚨 問題点まとめ

### 問題1: データ分離によるレート判定の欠落

| データソース | エンドポイント | 保存先 | フロントエンド監視 | レート判定 |
|------------|--------------|--------|------------------|-----------|
| **ESP32（実データ）** | POST /api/measurements | device_measurements | ❌ No | ❌ No |
| **TestDataGenerator** | POST /api/raw-measurements | raw_measurements | ✅ Yes (5秒ごと) | ✅ Yes |

**結果**: ESP32からの実データは間隔制御の恩恵を受けられない

### 問題2: フロントエンド依存

- ダッシュボードが開いていない → レート判定が行われない
- ブラウザを閉じる → ESP32が送信しても control_states が更新されない
- 初回起動 → control_states にデータがない → DEFAULT (300s) のまま

### 問題3: タイミングの遅延

仮にESP32データがレート判定されたとしても：

```
T=0秒:   ESP32送信 → control_states参照 → interval取得（例: 300s）
T=30秒:  フロントエンド処理 → レート判定 → control_states更新（HIGH → 60s）
T=300秒: ESP32次回送信 → 初めて新しいinterval (60s) を取得

遅延: 270秒（4.5分）
```

### 問題4: 間隔制御の無意味化

`calculateNextInterval()` 関数を追加したが：
- control_states が更新されない
- 常に DEFAULT (300s) が返される
- ESP32の送信間隔が変わらない

**追加した機能が機能していない**

---

## 💡 解決策の選択肢

### Option A: ESP32データも raw_measurements に保存（簡単）

#### 実装方法

**web-service/src/server.js の変更**:
```javascript
app.post('/api/measurements', async (req, res) => {
  const { deviceId, temperature, humidity, recordedAt, payload } = req.body || {};

  // 1. device_measurements に保存（既存）
  await insertDeviceMeasurement({
    deviceId,
    temperature: tempValue,
    humidity: humidityValue,
    recordedAt,
    payload: payload ?? req.body
  });

  // 2. raw_measurements にも保存（追加）
  await insertRawMeasurement({
    deviceId: deviceId,
    nodeId: deviceId, // nodeId と deviceId を統一
    observedC: tempValue,
    batteryV: payload?.voltage_v || null,
    timestamp: recordedAt || new Date().toISOString(),
    payload: payload ?? req.body,
    receivedAt: new Date().toISOString()
  });

  // 3. 間隔計算
  const nextInterval = await calculateNextInterval(deviceId);

  return res.status(201).json({
    status: 'ok',
    nextIntervalSeconds: nextInterval,
    message: 'Measurement recorded successfully'
  });
});
```

**メリット**:
- ✅ 実装が簡単（10行程度の追加）
- ✅ 既存のフロントエンドがそのまま動作
- ✅ ESP32データもレート判定される
- ✅ テスト済みの仕組みを活用

**デメリット**:
- ⚠️ フロントエンド依存は解消されない
- ⚠️ データ重複（2つのテーブルに保存）
- ⚠️ タイミング遅延は残る

---

### Option B: バックエンドでレート判定を実行（推奨・複雑）

#### 実装方法

**web-service/src/server.js に追加**:

```javascript
// analytics-engine.jsのロジックをNode.jsに移植
class ServerSideRateController {
  static analyzeDiscrepancy(forecastC, observedC, previousState) {
    const absError = Math.abs(forecastC - observedC);
    // ... （analytics-engine.jsと同じロジック）
    return { sErr, mEwma, sigmaDay, ... };
  }

  static decideRate(sErr, previousRate) {
    if (sErr < 0.45) return 'HIGH';
    if (sErr < 0.70) return 'MEDIUM';
    return 'LOW';
  }
}

app.post('/api/measurements', async (req, res) => {
  const { deviceId, temperature, humidity } = req.body;

  // 1. データ保存
  await insertDeviceMeasurement({...});

  // 2. 天気予報取得
  const forecast = await getLatestForecastSnapshot();
  const forecastC = forecast?.snapshot?.forecastC;

  if (forecastC != null && temperature != null) {
    // 3. 過去状態取得
    const previousState = await getControlState(deviceId) || {};

    // 4. レート判定（サーバー側で実行）
    const { sErr, mEwma, sigmaDay } = ServerSideRateController.analyzeDiscrepancy(
      forecastC,
      temperature,
      previousState
    );

    const targetRate = ServerSideRateController.decideRate(sErr, previousState.targetRate);

    // 5. 処理済みデータを保存
    await saveProcessedMeasurementBatch({
      nodeId: deviceId,
      observedC: temperature,
      forecastC,
      sErr,
      targetRate,
      mEwma,
      sigmaDay,
      measuredAt: recordedAt || new Date().toISOString()
    });
  }

  // 6. 間隔計算（更新されたcontrol_statesを参照）
  const nextInterval = await calculateNextInterval(deviceId);

  return res.status(201).json({
    status: 'ok',
    nextIntervalSeconds: nextInterval
  });
});
```

**メリット**:
- ✅ フロントエンド不要でレート判定が動作
- ✅ リアルタイム性が高い（ESP32送信直後に判定）
- ✅ タイミング遅延がゼロ
- ✅ ESP32が完全に自律動作可能
- ✅ ダッシュボードを閉じても動作

**デメリット**:
- ❌ 実装が複雑（100行以上のコード移植）
- ❌ OpenWeatherMap API 呼び出しが増える（コスト増）
- ❌ サーバー負荷が増加（ESP32送信ごとに計算）
- ❌ フロントエンドとバックエンドでロジック重複

---

### Option C: device_measurements 用リスナーを追加（中間）

#### 実装方法

**public/js/backend-service.js に追加**:
```javascript
setupDeviceMeasurementListener(callback, intervalMs = 5000) {
  let lastTimestamp = null;

  const poll = async () => {
    const url = this.buildUrl(this.endpoints.measurements, {
      since: lastTimestamp
    });
    const payload = await this.request(url);
    const measurements = Array.isArray(payload?.data) ? payload.data : [];

    measurements.forEach((item) => {
      lastTimestamp = item.recordedAt || item.createdAt;
      callback({
        id: item.id,
        nodeId: item.deviceId,
        observedC: item.temperature,
        batteryV: item.payload?.voltage_v,
        receivedAt: item.createdAt
      });
    });
  };

  const timer = setInterval(poll, intervalMs);
  poll();
}
```

**public/js/realtime-processor.js の変更**:
```javascript
setupMeasurementListener() {
  // raw_measurements も監視（テストデータ用）
  backendService.setupRawMeasurementListener(async (rawMeasurement) => {
    await this.processMeasurement(rawMeasurement);
  });

  // device_measurements も監視（ESP32用）
  backendService.setupDeviceMeasurementListener(async (deviceMeasurement) => {
    await this.processMeasurement(deviceMeasurement);
  });
}
```

**メリット**:
- ✅ 実装が比較的簡単（50行程度）
- ✅ 既存のレート判定ロジックを再利用
- ✅ データ重複なし
- ✅ テストデータとESP32データの両方に対応

**デメリット**:
- ⚠️ フロントエンド依存は解消されない
- ⚠️ タイミング遅延は残る（最大5秒）
- ⚠️ ポーリングが2系統になる（リソース消費増）

---

### Option D: Cron Jobでバッチ処理（運用重視）

#### 実装方法

**新しいスクリプト `cron-job/process-measurements.js`**:
```javascript
async function processUnprocessedMeasurements() {
  // 1. device_measurements から未処理データを取得
  const unprocessed = await getUnprocessedMeasurements();

  for (const measurement of unprocessed) {
    // 2. レート判定
    const forecast = await getLatestForecastSnapshot();
    const previousState = await getControlState(measurement.deviceId);

    const result = ServerSideRateController.processMeasurement(
      measurement,
      previousState,
      forecast.forecastC
    );

    // 3. 結果保存
    await saveProcessedMeasurementBatch(result);
  }
}

// 1分ごとに実行
setInterval(processUnprocessedMeasurements, 60000);
```

**Renderでの設定**:
- Cron Jobサービスとして別途デプロイ
- 1分〜5分間隔で実行

**メリット**:
- ✅ フロントエンド不要
- ✅ サーバー負荷を分散（バッチ処理）
- ✅ ESP32送信とレート判定を分離

**デメリット**:
- ⚠️ リアルタイム性が低い（最大1〜5分の遅延）
- ⚠️ Renderで追加コスト（Cron Jobサービス）
- ⚠️ 実装とデプロイが複雑

---

## 📊 比較表

| 項目 | Option A<br/>raw_measurements に保存 | Option B<br/>バックエンド判定 | Option C<br/>リスナー追加 | Option D<br/>Cron Job |
|------|-----------------------------------|--------------------------|----------------------|-------------------|
| **実装難易度** | ⭐ 簡単 | ⭐⭐⭐⭐⭐ 複雑 | ⭐⭐⭐ 中 | ⭐⭐⭐⭐ やや複雑 |
| **フロントエンド依存** | ❌ あり | ✅ なし | ❌ あり | ✅ なし |
| **リアルタイム性** | ⚠️ 5秒遅延 | ✅ 即座 | ⚠️ 5秒遅延 | ❌ 1-5分遅延 |
| **データ重複** | ❌ あり | ✅ なし | ✅ なし | ✅ なし |
| **サーバー負荷** | ✅ 低 | ❌ 高 | ✅ 低 | ⚠️ 中 |
| **API呼び出し** | ✅ 少ない | ❌ 多い | ✅ 少ない | ⚠️ 中 |
| **運用コスト** | ✅ 低 | ✅ 低 | ✅ 低 | ❌ 高（Cron Job料金） |
| **推奨度** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |

---

## 🎯 推奨アプローチ

### 短期対応（今すぐ動かす）: **Option A**

```javascript
// web-service/src/server.js の POST /api/measurements に追加
await insertRawMeasurement({
  deviceId: deviceId,
  payload: { ...req.body, nodeId: deviceId, observedC: tempValue }
});
```

**理由**:
- 10行程度の追加で即座に動作
- 既存の検証済みフロントエンドをそのまま活用
- ESP32からのデータがレート判定されるようになる

### 中期対応（理想的）: **Option B**

**理由**:
- ESP32が完全に自律動作
- ダッシュボードを開かなくても間隔制御が機能
- リアルタイム性が最高

**実装ステップ**:
1. analytics-engine.jsのロジックをNode.jsに移植
2. テスト（ユニットテスト必須）
3. フロントエンドの処理を段階的に移行

---

## ✅ 次のアクション

### 緊急対応（今日中）

1. **Option A を実装** - ESP32データが raw_measurements にも保存されるようにする
2. **動作確認** - ダッシュボードでESP32データのレート判定が動作することを確認
3. **interval制御テスト** - control_states が更新され、ESP32の送信間隔が変わることを確認

### 中期計画（1週間以内）

1. **Option B の設計** - バックエンドレート判定の詳細設計
2. **ロジック移植** - analytics-engine.js → server.js
3. **テスト作成** - ユニットテスト + 統合テスト
4. **段階的移行** - フロントエンド処理を残しつつバックエンド処理を追加

---

## 📋 チェックリスト

現在の問題を解決するために必要なこと：

- [ ] Option A を実装（raw_measurements への保存追加）
- [ ] ESP32実機でテスト
- [ ] control_states が更新されることを確認
- [ ] interval が動的に変わることを確認
- [ ] ダッシュボードを閉じた状態でテスト（失敗するはず）
- [ ] Option B の詳細設計を開始
- [ ] パフォーマンステスト（OpenWeatherMap API 呼び出し回数）
- [ ] コスト試算（API呼び出し増による）

---

**作成日**: 2025-10-09
**バージョン**: 1.0.0
**ステータス**: 🚨 **緊急対応が必要**
