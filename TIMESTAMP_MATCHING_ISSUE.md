# ⚠️ タイムスタンプマッチング問題の分析

## 問題の概要

**現在の実装では、実測値のタイムスタンプと予測値のタイムスタンプが適切にマッチングされていません。**

## 実際のデータ例（2025-10-09 確認）

### 実測データ
```json
{
  "observedC": 24.05,
  "recordedAt": "2025-10-09T06:55:25.630Z"  // UTC 06:55 = JST 15:55
}
```

### 予測データ（forecast_snapshots）
```json
{
  "forecastC": 20.21,
  "forecastTime": "2025-10-09T09:00:00.000Z",  // UTC 09:00 = JST 18:00
  "fetchedAt": "2025-10-09T06:32:37.481Z",
  "fullForecast": [
    { "dateTime": "2025-10-09T09:00:00Z", "temperature": 20.21 },  // JST 18:00
    { "dateTime": "2025-10-09T12:00:00Z", "temperature": 18.79 },  // JST 21:00
    { "dateTime": "2025-10-09T15:00:00Z", "temperature": 16.85 },  // JST 00:00 (翌日)
    { "dateTime": "2025-10-09T18:00:00Z", "temperature": 16.68 },  // JST 03:00
    ...
  ]
}
```

## 問題点の詳細

### 1. 時間のズレ
- **実測**: JST 15:55（2025-10-09 15:55）
- **予測**: JST 18:00（2025-10-09 18:00）の予測を使用
- **時間差**: 約2時間5分先の予測と比較している

### 2. 正しくは
実測値 15:55 に最も近い予測時間帯を選択すべき：
- ✅ **15:00 (UTC 06:00)**: -55分（直前）← **これを使うべき**
- ❌ **18:00 (UTC 09:00)**: +2時間5分（使用中）

### 3. 現在の実装フロー

#### フロントエンド（realtime-processor.js:54-55）
```javascript
const forecastData = {
  forecastC: firstEntry.main?.temp,  // 最初のエントリー（現在時刻に最も近い未来）
  forecastTime: new Date(firstEntry.dt * 1000).toISOString()
};
```

#### バックエンド（weather-service.js:58-65）
```javascript
async function getCachedForecast() {
  const forecast = await getLatestForecastSnapshot();
  // forecast.forecastC を返すだけ（タイムスタンプマッチングなし）
  return forecast;
}
```

#### measurement-processor.js:76-84
```javascript
const processingResult = IoTProcessingEngine.processMeasurement(
  {
    nodeId: deviceId,
    observedC: temperature,
    timestamp: recordedAt  // 使用されていない！
  },
  previousState,
  forecast.forecastC  // 単一の予測値（時間帯不明）
);
```

## 影響範囲

### 誤差への影響
天気は時間とともに変化するため、2時間のズレは大きな影響を与えます：

```
実測 15:55: 24.05°C
予測 18:00: 20.21°C → absError = 3.84°C

もし正しく 15:00 の予測を使うと:
予測 15:00: [不明だが、おそらく 21-22°C] → absError = 2-3°C
```

### レート決定への影響
- **sErr = exp(-mEwma/sigmaDay)** が不正確
- 時間ズレにより **absError が過大評価**
- 結果として **不必要に HIGH レートに昇格する可能性**

## 解決策

### Option A: 最も近い予測時間帯を選択（推奨）

**実装箇所**: `shared/weather-service.js`

```javascript
/**
 * Get forecast closest to measurement time
 */
async function getForecastForTimestamp(measurementTimestamp) {
  const forecast = await getLatestForecastSnapshot();

  if (!forecast || !forecast.fullForecast) {
    return { forecastC: forecast?.forecastC || null };
  }

  const measurementTime = new Date(measurementTimestamp).getTime();

  // Find closest forecast entry
  let closestEntry = null;
  let minDiff = Infinity;

  for (const entry of forecast.fullForecast) {
    const forecastTime = new Date(entry.dateTime).getTime();
    const diff = Math.abs(forecastTime - measurementTime);

    if (diff < minDiff) {
      minDiff = diff;
      closestEntry = entry;
    }
  }

  if (closestEntry) {
    return {
      forecastC: closestEntry.temperature,
      forecastTime: closestEntry.dateTime,
      timeDiffMinutes: Math.floor(minDiff / 60000)
    };
  }

  // Fallback to forecastC
  return { forecastC: forecast.forecastC };
}
```

**使用箇所**: `shared/measurement-processor.js:38`

```javascript
// Before:
const forecast = await getCachedForecast();

// After:
const forecast = await getForecastForTimestamp(recordedAt);
```

### Option B: 前方予測のみ使用（現在の実装維持）

**理由付け**:
- IoT システムの目的は「将来の予測精度」を評価すること
- 過去の予測（15:00）ではなく、将来の予測（18:00）との比較が妥当
- ただし、ドキュメントに明記すべき

## 推奨アクション

### 🔴 優先度: 高

1. **Option A を実装** - 正確なタイムスタンプマッチング
   - より正確な誤差計算
   - より適切なレート決定
   - データの一貫性向上

2. **ログ追加** - デバッグ用
   ```javascript
   console.log(`📊 Timestamp matching:`, {
     measured: recordedAt,
     forecastTime: forecast.forecastTime,
     timeDiff: forecast.timeDiffMinutes + 'min'
   });
   ```

3. **テスト** - タイムマッチングの検証
   - 15:55 の実測 → 15:00 の予測を使用
   - 16:30 の実測 → 18:00 の予測を使用（より近い）
   - 境界ケースのテスト

### 🟡 優先度: 中

4. **データ検証** - 既存データの再計算
   - 過去のprocessed_measurementsは不正確な可能性
   - 再計算が必要かどうか検討

### 🔵 優先度: 低

5. **UI表示** - ダッシュボードに時間差表示
   - 「予測との時間差: 2時間5分」
   - ユーザーが精度を理解しやすくなる

## 関連ファイル

- `shared/weather-service.js` - 予測データ取得
- `shared/measurement-processor.js` - 測定処理
- `public/js/realtime-processor.js` - フロントエンド処理
- `shared/analytics-service.js` - レート決定アルゴリズム

## 結論

**タイムスタンプマッチングの実装は必須です。** 現在の実装では、2時間程度のズレが常に発生しており、レート決定の精度に重大な影響を与えています。

Option A の実装を強く推奨します。
