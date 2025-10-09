# OpenWeather Data Fetcher (Render Cron Jobs)

このディレクトリは Render の Cron Job として OpenWeather のデータを定期的に取得するためのスクリプト群です。

## スクリプト一覧

- **fetch-historical-weather.js**: 過去の天気データを取得（日次実行推奨）
- **fetch-forecast-snapshot.js**: 予測データスナップショットを取得（1時間ごと実行推奨）

## 使い方

1. 依存パッケージをインストールします。

   ```bash
   npm install --production
   ```

2. 環境変数を準備します（Render のダッシュボードまたは `.env`）。

   | 変数名 | 説明 | 例 |
   | ------ | ---- | --- |
   | `OPENWEATHER_API_KEY` | OpenWeather の API キー | `xxxx` |
   | `OPENWEATHER_LAT` | 緯度 | `35.656` |
   | `OPENWEATHER_LON` | 経度 | `139.324` |
   | `OPENWEATHER_UNITS` | 単位（任意） | `metric` |
| `OPENWEATHER_LANG` | 言語（任意） | `ja` |
| `OPENWEATHER_DELAY_MS` | 連続リクエスト間隔（任意） | `1100` |
| `DATABASE_URL` | Render Postgres 接続文字列（任意） | `postgres://...` |
| `PGSSLMODE` | SSL モード（Render Postgres は `require` 推奨） | `require` |

3. 実行例

   ### 過去の天気データ取得

   ```bash
   node src/fetch-historical-weather.js "2025-01-05"
   ```

   成功すると `outputs/2025-01-05/daily_weather_2025-01-05.json` に結果が生成されます。

   ### 予測データスナップショット取得

   ```bash
   node src/fetch-forecast-snapshot.js
   ```

   成功すると `forecast_snapshots` テーブルに予測データが保存されます。

## Render Cron Job 設定例

### Job 1: 過去の天気データ取得（日次）

- **名前**: `fetch-historical-weather`
- **コマンド**: `cd cron-job && node src/fetch-historical-weather.js "$(date -d 'yesterday' +%Y-%m-%d)"`
- **スケジュール**: `0 22 * * *`（UTC で毎日 22:00 = JST 07:00）
- **説明**: 前日の天気データを取得して `weather_history` テーブルに保存

### Job 2: 予測データスナップショット取得（1時間ごと）⭐

- **名前**: `fetch-forecast-snapshot`
- **コマンド**: `cd cron-job && node src/fetch-forecast-snapshot.js`
- **スケジュール**: `0 * * * *`（毎時0分 = 1時間ごと）
- **説明**: OpenWeatherMap から予測データを取得して `forecast_snapshots` テーブルに保存

### 注意事項

- Render の Postgres を使用する場合は、`DATABASE_URL` と `PGSSLMODE=require` を環境変数に設定してください
- 予測データスナップショットは1時間ごとに保存されるため、予測履歴グラフに均等な間隔でデータが表示されます
- フロントエンドからの予測スナップショット保存は無効化されており、cronジョブでのみ保存されます
