# システム構成図 (draw.io)

このディレクトリには、ESP32 IoT温度制御システムの包括的なシステム構成図が含まれています。

## 📁 ファイル一覧

### 1. [overall-architecture.drawio](overall-architecture.drawio)
**全体システム構成図**

システム全体の構成とコンポーネント間の接続を示します。

**含まれる要素:**
- 👤 User (Web Browser)
- 🖥️ Frontend (Render Static Site)
- ⚙️ Backend (Render Web Service)
- 🗄️ Database (Render PostgreSQL)
- 📡 ESP32 (IoT Device)
- ⏰ Cron Jobs (Render)
- 🌐 External API (OpenWeatherMap)

**主要データフロー:**
- ESP32 → Backend → Database → Frontend
- Cron Job → OpenWeatherMap API → Database

---

### 2. [operation-flow.drawio](operation-flow.drawio)
**動作フロー図**

ESP32からのデータ送信開始から、レート判定、データベース保存、動的間隔制御までの完全な処理フローを可視化。

**主要ステップ:**
1. 📡 ESP32: センサー読み取り (BMP280, INA219)
2. 📡 ESP32: HTTP POST送信 (`/api/measurements`)
3. ⚙️ Backend: データ受信・保存
4. ⚙️ Backend: `processMeasurementWithRating()` 実行
   - `getForecastForTimestamp()` (線形補間)
   - `DiscrepancyAnalyzer.analyzeDiscrepancy()` (誤差分析)
   - `RateController.decideRate()` (レート判定)
5. ⚙️ Backend: Database保存 (3テーブル)
6. ⚙️ Backend: `nextIntervalSeconds` 返却
7. 📡 ESP32: 動的スリープ → ループ継続

**並行動作:**
- ⏰ Cron Job: 予測スナップショット保存 (毎時0分)

---

### 3. [database-schema.drawio](database-schema.drawio)
**データベーススキーマ図 (ER図)**

8つのPostgreSQLテーブルの詳細スキーマと関係を示します。

**テーブル一覧:**
1. `device_measurements` - ESP32からの生データ
2. `processed_measurements` - レート判定後の処理結果
3. `control_states` - デバイスごとの現在状態 (UPSERT)
4. `score_logs` - スコア計算履歴
5. `forecast_snapshots` - 予測データスナップショット (JSONB)
6. `weather_history` - 過去の天気データ (date, hour複合キー)
7. `weather_daily_summary` - 日次天気サマリー
8. `raw_measurements` - フロントエンドテストデータ

**テーブル間関係:**
- 論理的関連: `device_id` / `node_id` でリンク
- データフロー: ESP32データ → processed/control/score_logs

---

### 4. [backend-architecture.drawio](backend-architecture.drawio)
**バックエンド詳細図**

Node.js + Express.js サーバーの内部構造を詳細に示します。

**主要構成要素:**

#### API Endpoints (25個)
- **📡 ESP32データ受信**: `POST /api/measurements` (レート判定実行)
- **📊 処理済みデータ**: `GET /api/processed-measurements`
- **📈 スコアログ**: `GET /api/score-logs`
- **🌤️ 天気データ**: `GET /api/historical` (自動更新機能付き)
- **予測スナップショット**: `GET /api/forecast-snapshots`
- **削除API**: `DELETE /api/measurements`, `/api/all-data`
- **エクスポート**: `GET /api/export/*` (CSV)

#### shared/ モジュール
- **analytics-service.js (311行)**: レート判定ロジック
  - `DiscrepancyAnalyzer`, `RateController`, `IoTProcessingEngine`
- **measurement-processor.js (227行)**: 処理パイプライン統合
- **weather-service.js (345行)**: 予測取得・線形補間
- **persistence.js**: データベース操作
- **historical-weather.js**: OpenWeatherMap API呼び出し
- **db.js (157行)**: PostgreSQL接続・スキーマ初期化

#### 処理パイプライン
```
1. データ受信
   ↓
2. device_measurements 保存
   ↓
3. processMeasurementWithRating()
   ├─ getForecastForTimestamp() (線形補間)
   ├─ getControlState()
   └─ IoTProcessingEngine.processMeasurement()
      ├─ DiscrepancyAnalyzer
      └─ RateController
   ↓
4. 結果保存 (3テーブル)
   ↓
5. nextIntervalSeconds 返却
```

---

### 5. [esp32-architecture.drawio](esp32-architecture.drawio)
**ESP32詳細図**

IoTデバイスのハードウェア構成とソフトウェア構造を示します。

**ハードウェア:**
- **ESP32 DevKit C**: Dual-core Xtensa LX6, 240MHz, WiFi
- **I2C Bus**: SCL=GPIO22, SDA=GPIO21, 100kHz
- **BMP280**: 温度・湿度・気圧センサー (0x76/0x77)
- **INA219**: 電圧・電流センサー (0x40-0x45)
- **Status LED**: GPIO2 (青色)

**ソフトウェア (MicroPython):**
- **boot.py (517行)**: メインプログラム
  - WiFi接続 (HOME/LAB mode)
  - センサー初期化 (I2Cスキャン、リトライ)
  - メインループ (センサー読み取り → HTTP POST → 動的スリープ)
- **bmp280.py**: BME280 I2C通信
- **ina219.py**: INA219 I2C通信
- **passwords.py**: WiFi認証情報 (not in repo)

**エラーハンドリング:**
- WiFi接続エラー: 3回リトライ、Exponential backoff
- センサーエラー: CSVに"ERROR"記録
- API送信エラー: デフォルト間隔(300s)でスリープ

**動的間隔制御:**
- HIGH rate: 60s (1分ごと)
- MEDIUM rate: 300s (5分ごと)
- LOW rate: 600s (10分ごと)

---

### 6. [frontend-architecture.drawio](frontend-architecture.drawio)
**フロントエンド詳細図**

HTML/CSS/JavaScript の構造とUIコンポーネントを詳細に示します。

**UIコンポーネント (Tailwind CSS):**
- **Header**: タイトル、接続ステータス、Refreshボタン
- **Metrics Cards (4個)**: 実測温度、予測温度、誤差スコア、現在レート
- **Charts Section (Chart.js 3つ)**:
  - 実測温度グラフ (1h/6h/24h/72h/120h)
  - 過去天気グラフ (自動更新)
  - 予測履歴グラフ (5/10/20/all件表示)
- **Data Table**: 最新50件、CSVエクスポート
- **Control Panel**: 予測更新、データ削除
- **Alert Container**: Toast通知

**JavaScriptモジュール (ES6):**
- **dashboard.js**: メインコントローラ
  - 初期化、データ読み込み、グラフ更新
  - 30秒ごと自動更新
- **backend-service.js**: API通信
  - `getProcessedMeasurements()`, `getForecastSnapshots()`
- **weather-service.js**: OpenWeatherMap API
  - `cacheForecastSnapshot()` 無効化済み
- **analytics-engine.js**: テストデータ生成用
- **realtime-processor.js**: テストデータ処理
- **export-manager.js**: CSV出力
- **app-config.js**: 設定 (endpoints, thresholds)

**外部ライブラリ:**
- Chart.js 4.x (グラフ描画)
- Tailwind CSS (スタイリング)
- date-fns (日時処理)

---

### 7. [database-architecture.drawio](database-architecture.drawio)
**データベース詳細図**

PostgreSQLデータベースの運用詳細とパフォーマンス考慮事項を示します。

**接続情報:**
- DATABASE_URL: `postgres://user:pass@host:5432/dbname`
- PGSSLMODE: `require`
- Connection Pool: `pg.Pool` (Max 10)

**テーブルグループ別:**

#### ESP32関連
- `device_measurements`: 書き込み頻度 60s〜600s (動的)

#### レート判定関連
- `processed_measurements`: インデックス `recorded_at DESC`
- `control_states`: UPSERT、小規模高速
- `score_logs`: デバッグ・分析用

#### 天気データ関連
- `forecast_snapshots`: 7日間保持 (自動削除)、JSONB
- `weather_history`: PRIMARY KEY (date, hour)
- `weather_daily_summary`: 日次サマリー

#### テスト用
- `raw_measurements`: 開発用、インデックス `received_at DESC`

**パフォーマンス考慮:**
- インデックス戦略: 時系列クエリ最適化
- JSONB vs 正規化: 柔軟性と速度のバランス
- データ保持ポリシー: 7日間 / 無制限
- 接続プール: 接続再利用

**主要クエリパターン:**
- 最新N件取得 (`ORDER BY recorded_at DESC LIMIT`)
- UPSERT (`ON CONFLICT DO UPDATE`)
- 予測スナップショット検索
- 日次天気取得

---

## 🔧 draw.ioで開く方法

### オンライン (推奨)
1. https://app.diagrams.net/ にアクセス
2. **Open Existing Diagram** をクリック
3. **Device** → ファイル選択 (例: `overall-architecture.drawio`)

### デスクトップアプリ
1. draw.io Desktop をダウンロード: https://github.com/jgraph/drawio-desktop/releases
2. インストール後、`.drawio` ファイルをダブルクリック

### VSCode拡張機能
1. **Draw.io Integration** 拡張機能をインストール
2. `.drawio` ファイルをVSCodeで開く

---

## 📤 エクスポート方法

### PNG画像としてエクスポート
1. draw.ioで図を開く
2. **File** → **Export as** → **PNG**
3. 解像度を選択 (推奨: 300 DPI)
4. `exports/` フォルダに保存

### SVG画像としてエクスポート
1. draw.ioで図を開く
2. **File** → **Export as** → **SVG**
3. `exports/` フォルダに保存

### PDF文書としてエクスポート
1. draw.ioで図を開く
2. **File** → **Export as** → **PDF**
3. ページ設定を確認
4. `exports/` フォルダに保存

---

## 📝 図の編集

### 編集ガイドライン
1. **色の統一**: 既存の色スキームを維持
   - ESP32: オレンジ系 (#ffe6cc)
   - Backend: 黄色系 (#fff2cc)
   - Frontend: 緑系 (#d5e8d4)
   - Database: 紫系 (#e1d5e7)
2. **フォント**: システムデフォルト、サイズ11-14pt
3. **矢印**: 太さ2px、直線または直交

### 新規要素追加時
1. 既存のスタイルをコピー (Ctrl+C, Ctrl+V)
2. テキストを編集
3. 位置を調整
4. 矢印で接続

---

## 🔄 更新履歴

### 2025-01-10
- 初版作成
- 7つの構成図を作成
  - 全体システム構成図
  - 動作フロー図
  - データベーススキーマ図
  - バックエンド詳細図
  - ESP32詳細図
  - フロントエンド詳細図
  - データベース詳細図

---

## 📚 関連ドキュメント

- [DIAGRAM_CREATION_PLAN.md](../DIAGRAM_CREATION_PLAN.md) - 図作成計画の詳細
- [OPTION_B_IMPLEMENTATION_PLAN.md](../OPTION_B_IMPLEMENTATION_PLAN.md) - サーバーサイドレート判定の実装計画
- [README.md](../README.md) - プロジェクト全体のREADME
- [architecture.md](../architecture.md) - システムアーキテクチャ解説

---

## 🎯 推奨利用シーン

### 新規開発者のオンボーディング
1. **全体システム構成図** で全体像を把握
2. **動作フロー図** でデータフローを理解
3. **個別詳細図** で担当コンポーネントを深掘り

### システム設計レビュー
1. **データベーススキーマ図** でデータ構造を確認
2. **バックエンド詳細図** でAPI設計をレビュー
3. **フロントエンド詳細図** でUI/UX設計を検討

### デバッグ・トラブルシューティング
1. **動作フロー図** で処理の流れを追跡
2. **データベース詳細図** でクエリパターンを確認
3. **ESP32詳細図** でエラーハンドリングを確認

### 技術プレゼンテーション
1. PNG/SVGにエクスポート
2. スライドに挿入
3. 各コンポーネントを説明

---

## 💡 Tips

### 図を見やすくする
- **ズーム**: Ctrl+マウスホイール (またはトラックパッドピンチ)
- **全体表示**: Ctrl+0
- **パン**: スペース+ドラッグ

### 複数の図を比較
- draw.ioで複数タブを開く
- ウィンドウを並べて表示

### Git管理
- `.drawio` ファイルはXML形式でGit差分管理可能
- コミット前に図を保存
- コミットメッセージに変更内容を記載

---

## 🤝 貢献

図の改善提案や追加要望は、以下の方法で受け付けています:
1. Issue作成
2. Pull Request送信
3. ディスカッション

---

## 📄 ライセンス

このプロジェクトのドキュメントは、プロジェクト本体と同じライセンスに従います。
