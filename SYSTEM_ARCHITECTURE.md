# System Architecture Overview

このドキュメントでは Render 上にデプロイされたシステム全体の構成と依存関係を説明します。

## コンポーネント一覧

| コンポーネント | デプロイ先 | 役割 | 主な依存 |
| -------------- | ---------- | ---- | -------- |
| **Web Service** (`web-service/`) | Render Web Service | OpenWeather からの過去データ取得 API、Postgres キャッシュ層 | `shared/historical-weather.js`, `shared/db.js`, `shared/persistence.js`, Render Postgres |
| **Cron Job** (`cron-job/`) | Render Cron Job | 日次で過去データを一括取得し Postgres に保管、JSON 出力 | `shared/historical-weather.js`, `shared/persistence.js`, Render Postgres |
| **Postgres** | Render PostgreSQL | 過去の天気データ・日次サマリーの保存先 | なし（他コンポーネントから参照） |
| **Firebase Functions** (`functions/`) | Firebase (必要に応じて) | 既存の天気予測書き込み処理 | Firebase プロジェクト |
| **フロントエンド** (`public/`) | Firebase Hosting など既存環境 | Dashboard UI／IoT 連携 | Render Web Service API, Firebase |

## データフロー

1. ブラウザのダッシュボードは Render Web Service に対して `GET /api/historical` を発行し、直近数時間または指定日の過去天気データを取得します。
2. Web Service は先に Render Postgres を参照し、データがなければ OpenWeather API (`onecall/timemachine`) へ問い合わせ、結果を Postgres に保存してからレスポンスを返します。
3. Render Cron Job はスケジュールに従って `cron-job/src/fetch-historical-weather.js` を実行し、OpenWeather から 24 時間分のデータを取得、JSON 出力と同時に Postgres に保存します。これにより Web Service が参照するキャッシュが事前に更新されます。
4. Firebase Functions (`functions/`) は既存の構成どおり OpenWeather の 5 日予報を Firestore に保存しており、フロントエンドから参照されます。必要に応じて Render 側の API と併用します。

## 環境変数

両コンポーネントで共通して設定する環境変数は以下です。

| 変数 | 説明 |
| ---- | ---- |
| `OPENWEATHER_API_KEY` | OpenWeather API キー |
| `OPENWEATHER_LAT` / `OPENWEATHER_LON` | データ取得に使用する緯度・経度（省略時は 35.656 / 139.324） |
| `OPENWEATHER_UNITS` | 単位（デフォルト `metric`）|
| `OPENWEATHER_LANG` | 言語（デフォルト `ja`）|
| `OPENWEATHER_DELAY_MS` | API 呼び出し間隔ミリ秒（デフォルト 1100）|
| `DATABASE_URL` | Render Postgres の接続文字列 |
| `PGSSLMODE` | `require`（Render Postgres は SSL 必須）|
| `CORS_ORIGIN` | Web Service で許可するオリジン（デフォルト `*`）|

## 提供 API

- `GET /health`  
  稼働確認用エンドポイント。
- `GET /api/historical`  
  OpenWeather の過去データを提供するメイン API。クエリ `hours` または `date` を指定し、必要に応じて `refresh`, `lat`, `lon`, `units`, `lang`, `delayMs` で上書き可能。Postgres にキャッシュされたデータがあれば `source:"database"`、無ければ OpenWeather から取得して `source:"api"` として返却。
- `POST /api/measurements`  
  ESP32 などのデバイスから温度データを受け取る。リクエスト例:
  ```json
  {
    "deviceId": "esp32-01",
    "temperature": 24.6,
    "humidity": 45.2,
    "recordedAt": "2025-01-05T12:34:56Z"
  }
  ```
  検証後 `device_measurements` テーブルに保存し、`201 {"status":"ok"}` を返す。追加フィールドは `payload` として JSON 形式で保持。

## 接続関係

```
[ブラウザ] --HTTP--> [Render Web Service] --SQL--> [Render Postgres]
                           │
                           └--HTTP--> [OpenWeather API]

[Render Cron Job] --SQL--> [Render Postgres]
                  └--HTTP--> [OpenWeather API]

[Firebase Functions] --HTTP--> [OpenWeather API]
                    └--Firestore--> [Firebase]
```

Web Service と Cron Job は `shared/` ディレクトリ内のモジュールを共有し、`axios` や `pg` などの依存は各ディレクトリ内でインストールしたものを `shared` モジュールが自動的に解決します。

## 運用確認ポイント

- Web Service のヘルス: `GET https://<service>.onrender.com/health`
- 最新データ取得: `GET /api/historical?hours=3`
- 過去日データ取得: `GET /api/historical?date=YYYY-MM-DD`
- Cron Job ログ: Render ダッシュボード → Cron Jobs → Logs
- Postgres データ検証: Render の Postgres インスタンスから `weather_history` / `weather_daily_summary` を参照

## 今後の拡張

- Cron Job の結果を S3 など他ストレージへ保存する追加処理
- Web Service の API キー制御やリクエスト制限の導入
- フロントエンドからのデータ取得先を完全に Render API へ切り替える統合作業

この構成により Render 上で Web API／定期バッチ／データベースが完結し、既存の Firebase ベースのフロントエンドと連携しながら過去データを安定的に提供できます。
