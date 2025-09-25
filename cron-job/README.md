# OpenWeather Historical Fetch (Render Cron Job)

このディレクトリは Render の Cron Job として OpenWeather の過去データを取得するための構成例です。

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

   ```bash
   node src/fetch-historical-weather.js "2025-01-05"
   ```

   成功すると `outputs/2025-01-05/daily_weather_2025-01-05.json` に結果が生成されます。

## Render Cron Job 設定例

- コマンド: `node src/fetch-historical-weather.js "$(date -d 'yesterday' +%Y-%m-%d)"`
- スケジュール: `0 22 * * *`（UTC で毎日 07:00 JST 相当）

Render の Postgres を併用する場合は、`DATABASE_URL` と `PGSSLMODE=require` を設定すると自動的に `weather_history` / `weather_daily_summary` テーブルに書き込みます。
結果の JSON ファイルを Firestore や S3 などへアップロードする処理を追加する場合は、`fetch-historical-weather.js` 内で追記してください。
