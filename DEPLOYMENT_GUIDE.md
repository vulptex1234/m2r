# 🚀 Firebase クライアントサイド IoT システム デプロイガイド

## 📋 概要

このガイドでは、Firebase Functions から完全クライアントサイド処理への移行と、新しいシステムのデプロイ手順を説明します。

> **現在の運用について**
> 本プロジェクトでは Render Web Service / Cron Job / Postgres へ移行済みです。Firebase 関連の手順は過去の構成を参照するために残しています。最新の Render 向け手順は `RENDER_DEPLOYMENT_GUIDE.md` を参照してください。

## 🎯 移行のメリット

- **コスト削減**: Functions呼び出し 100% 削減
- **リアルタイム性向上**: Firestoreリアルタイムリスナー活用
- **運用負荷軽減**: サーバーサイド処理の削除
- **スケーラビリティ**: クライアント数に応じた自動スケール

## 📁 プロジェクト構成

```
M2_R/
├── public/                     # Firebase Hosting ファイル
│   ├── index.html             # メインダッシュボード
│   ├── test-panel.html        # テストパネル
│   └── js/
│       ├── firebase-config.js      # Firebase設定
│       ├── analytics-engine.js     # 統計計算エンジン
│       ├── firestore-service.js    # Firestoreアクセス層
│       ├── realtime-processor.js   # リアルタイム処理
│       ├── dashboard.js            # ダッシュボード制御
│       └── test-data-generator.js  # テストデータ生成
├── iot-samples/               # IoTデバイス用サンプル
│   └── esp32-temperature-sensor.ino
├── functions/                 # 既存Functions（削除可能）
├── firebase.json              # Firebase設定
├── firestore.rules           # セキュリティルール
└── DEPLOYMENT_GUIDE.md       # このファイル
```

## 🛠️ デプロイ手順

### 1. 事前準備

```bash
# Firebase CLI がインストールされていることを確認
firebase --version

# プロジェクトディレクトリに移動
cd /Users/kyohei/Documents/CDSL/M2_R

# Firebase プロジェクトにログイン
firebase login

# プロジェクトを選択
firebase use m2-r-24f40
```

### 2. Firestore セキュリティルールの更新

```bash
# セキュリティルールをデプロイ
firebase deploy --only firestore:rules

# ルールのテスト（オプション）
firebase emulators:start --only firestore
```

### 3. 天気APIキーの設定

`public/js/firebase-config.js` を編集：

```javascript
export const appConfig = {
  weather: {
    apiKey: "YOUR_OPENWEATHER_API_KEY", // ← 実際のAPIキーに置換
    lat: 35.6762,  // ← 実際の緯度
    lon: 139.6503, // ← 実際の経度
    units: "metric"
  }
  // ...
};
```

### 4. Firebase Hosting デプロイ

```bash
# Hosting にデプロイ
firebase deploy --only hosting

# デプロイ完了後、URLが表示されます
# 例: https://m2-r-24f40.web.app
```

### 5. 動作確認

1. **ダッシュボードアクセス**
   ```
   https://m2-r-24f40.web.app
   ```

2. **テストパネルアクセス**
   ```
   https://m2-r-24f40.web.app/test-panel.html
   ```

3. **基本動作テスト**
   - テストパネルでデータ生成開始
   - ダッシュボードでリアルタイム表示確認
   - グラフ更新とメトリクス表示確認

## 🧪 テスト手順

### 1. テストデータ生成

テストパネル（`/test-panel.html`）で：

1. **履歴データ生成**
   - 件数: 30
   - 間隔: 2分
   - 「履歴データ生成」クリック

2. **リアルタイムデータ生成**
   - 間隔: 5秒
   - 「データ生成開始」クリック

3. **異常データテスト**
   - 「異常データ生成」クリック
   - エラーハンドリング確認

### 2. ダッシュボード確認

1. **メトリクス表示**
   - 現在温度、予測温度の表示
   - システム誤差、制御レートの表示

2. **グラフ機能**
   - 温度推移グラフの表示
   - 時間軸切り替え（1h/6h/24h）

3. **リアルタイム更新**
   - データ生成時の即座な反映
   - アニメーション効果

4. **データテーブル**
   - 最新測定データの表示
   - エクスポート機能

### 3. パフォーマンステスト

```javascript
// ブラウザコンソールで実行
testDataGenerator.startGeneration(1000); // 1秒間隔で高頻度テスト

// 統計確認
console.log(realtimeProcessor.getStatistics());
```

## 🔧 IoTデバイス統合

### ESP32 設定

1. **ハードウェア準備**
   - ESP32 開発ボード
   - DS18B20 温度センサー
   - 4.7kΩ プルアップ抵抗

2. **ライブラリインストール**
   ```
   - ArduinoJson (v6.x)
   - OneWire
   - DallasTemperature
   ```

3. **コード設定**
   ```cpp
   // WiFi 設定
   const char* WIFI_SSID = "YOUR_WIFI_SSID";
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

   // ノードID（デバイス毎にユニーク）
   const char* NODE_ID = "esp32-001";
   ```

4. **デプロイ**
   - `iot-samples/esp32-temperature-sensor.ino` をアップロード
   - シリアルモニターで動作確認

### データフロー

```
ESP32 → Firestore (rawMeasurements) → Client Processing → Dashboard Update
```

## 🔒 セキュリティ設定

### 本番環境での強化

1. **Firebase Authentication 有効化**
   ```bash
   # Authentication の設定
   firebase auth:import users.json
   ```

2. **セキュリティルール強化**
   ```javascript
   // firestore.rules の本番設定
   allow read: if isAuthenticated();
   allow write: if isAuthenticated() && isOwner(resource);
   ```

3. **API キー制限**
   - Firebase Console で API キー制限設定
   - HTTP Referer 制限追加

4. **CORS 設定**
   - 許可ドメインの明示的設定
   - 本番ドメインのみ許可

## 📊 モニタリング設定

### Firebase Analytics 設定

```javascript
// カスタムイベント
analytics.logEvent('measurement_processed', {
  nodeId: nodeId,
  targetRate: targetRate,
  processingTime: duration
});
```

### エラー監視

```javascript
// Sentry や Firebase Crashlytics 設定
window.addEventListener('error', (error) => {
  console.error('Global error:', error);
  // エラー報告処理
});
```

## 🚨 トラブルシューティング

### よくある問題

1. **CORS エラー**
   ```
   解決: CORSプロキシの設定確認
   代替: Firebase Functions 経由でAPI呼び出し
   ```

2. **Firestore 接続エラー**
   ```
   確認: セキュリティルールの設定
   確認: API キーの権限
   ```

3. **リアルタイム更新されない**
   ```
   確認: ブラウザタブがアクティブか
   確認: ネットワーク接続
   デバッグ: コンソールログ確認
   ```

4. **IoTデバイス接続失敗**
   ```
   確認: WiFi 接続
   確認: API キー設定
   確認: Firestore権限
   ```

### デバッグ方法

```javascript
// ブラウザコンソールでデバッグ
window.firebase = { db, analytics }; // グローバル公開
window.debugMode = true; // デバッグモード有効化

// 詳細ログ有効化
localStorage.setItem('enableDebugLogs', 'true');
```

## 🔄 旧システムからの移行

### 段階的移行

1. **Phase 1: 並行運用**
   - 新システムデプロイ
   - 旧Functions保持
   - 比較検証

2. **Phase 2: 切り替え**
   - IoTデバイスの接続先変更
   - 旧Functions停止

3. **Phase 3: クリーンアップ**
   - 旧Functions削除
   - 不要なコレクション削除

### データ移行

```bash
# 既存データのエクスポート（オプション）
firebase firestore:export gs://m2-r-24f40.appspot.com/backup

# 新システムでのインポート（必要に応じて）
firebase firestore:import gs://m2-r-24f40.appspot.com/backup
```

## 📈 パフォーマンス最適化

### Firestore最適化

1. **インデックス設定**
   ```bash
   # 必要なインデックスを作成
   firebase deploy --only firestore:indexes
   ```

2. **クエリ最適化**
   ```javascript
   // 制限付きクエリ使用
   const q = query(collection(db, 'measurements'),
                   limit(50),
                   orderBy('createdAt', 'desc'));
   ```

3. **バッチ処理**
   ```javascript
   // 複数書き込みをバッチで実行
   const batch = writeBatch(db);
   // ... バッチ操作
   await batch.commit();
   ```

### フロントエンド最適化

1. **キャッシュ活用**
   ```javascript
   // サービスワーカー設定
   // PWA 化の検討
   ```

2. **バンドル最適化**
   ```bash
   # 本番向けビルド（必要に応じて）
   npm run build
   ```

## 💰 コスト見積もり

### 無料枠での運用目安

| リソース | 無料枠 | 推定使用量 | 残り |
|----------|--------|------------|------|
| Firestore 読み取り | 50,000/日 | ~10,000/日 | 余裕 |
| Firestore 書き込み | 20,000/日 | ~5,000/日 | 余裕 |
| Functions 実行時間 | 削除 | 0 | N/A |
| Hosting 転送量 | 10GB/月 | ~1GB/月 | 余裕 |

### 本格運用時の予想コスト

- **小規模** (10ノード): $0-5/月
- **中規模** (100ノード): $10-30/月
- **大規模** (1000ノード): $100-300/月

## 📞 サポート

### 緊急時対応

1. **システム停止**
   ```bash
   # 緊急停止
   firebase hosting:disable

   # ロールバック
   firebase hosting:channel:deploy backup
   ```

2. **データ復旧**
   ```bash
   # バックアップからの復元
   firebase firestore:import gs://backup-location
   ```

### 技術サポート

- **Firebase Documentation**: https://firebase.google.com/docs
- **Stack Overflow**: `firebase` `firestore` タグ
- **GitHub Issues**: プロジェクトリポジトリ

---

## ✅ デプロイチェックリスト

- [ ] Firebase CLI インストール・設定
- [ ] プロジェクト設定確認
- [ ] 天気API キー設定
- [ ] Firestore セキュリティルール デプロイ
- [ ] Firebase Hosting デプロイ
- [ ] ダッシュボード動作確認
- [ ] テストパネル動作確認
- [ ] IoTデバイス接続テスト
- [ ] リアルタイム処理確認
- [ ] エラーハンドリング確認
- [ ] パフォーマンステスト
- [ ] セキュリティチェック
- [ ] モニタリング設定
- [ ] バックアップ設定
- [ ] ドキュメント更新

**🎉 デプロイ完了後は、安定したクライアントサイド IoT 温度制御システムの運用が開始されます！**
