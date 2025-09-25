# Render Deployment Guide

Render 上で Web Service・Cron Job・Postgres を組み合わせて OpenWeather の過去データ API を構築するための詳細手順です。

## プロジェクト構成の概要

```
shared/
  historical-weather.js   # OpenWeather 取得ロジック
  db.js                   # Postgres 接続とスキーマ初期化
  persistence.js          # データ保存ヘルパー

web-service/
  package.json
  src/server.js           # Express API (Render Web Service)
  README.md
  .env.example

cron-job/
  package.json
  src/fetch-historical-weather.js  # Render Cron Job entrypoint
  README.md
  .env.example

public/ ...               # 既存のフロントエンド資産（必要に応じて更新）
```

## 1. 前提準備

1. Render アカウントを作成し、_Postgres_ インスタンス・_Web Service_・_Cron Job_ を作成できる状態にしておきます。
2. OpenWeather API キー（One Call Time Machine が利用できるプラン）を用意します。
3. ローカルで以下のコマンドを実行して依存関係をインストールしておきます。

   ```bash
   cd cron-job && npm install
   cd ../web-service && npm install
   ```

## 2. Postgres の準備

1. Render のダッシュボードで _New → PostgreSQL_ を選び、最小構成でインスタンスを作成します。
2. Provision されたら接続情報（Internal DB URL / External DB URL）を控え、Web Service と Cron Job で共通の `DATABASE_URL` として利用します。
   `Internal DB URL : postgresql://m2r_postgres_user:QFuTTS3Wd36ne6AsGZGFRJhziU9izYC6@dpg-d3aau8h5pdvs73cndabg-a/m2r_postgres`
3. Render Postgres は SSL 接続が必要なので、環境変数 `PGSSLMODE=require` を指定します。

## 3. Web Service のデプロイ

1. Render ダッシュボードで _New → Web Service_ を選択し、リポジトリを接続します。
2. ルートディレクトリを `web-service/` に設定し、以下のビルド／起動コマンドを設定します。

   - Build Command: `npm install`
   - Start Command: `npm run start`

3. 環境変数を以下の通り設定します（不足分があれば `.env.example` を参照）。

   | KEY                    | VALUE (例)                 |
   | ---------------------- | -------------------------- |
   | `OPENWEATHER_API_KEY`  | `...`                      |
   | `OPENWEATHER_LAT`      | `35.656`                   |
   | `OPENWEATHER_LON`      | `139.324`                  |
   | `OPENWEATHER_UNITS`    | `metric`                   |
   | `OPENWEATHER_LANG`     | `ja`                       |
   | `OPENWEATHER_DELAY_MS` | `1100`                     |
   | `CORS_ORIGIN`          | `*` または利用するドメイン |
   | `DATABASE_URL`         | Render Postgres 接続文字列 |
   | `PGSSLMODE`            | `require`                  |

4. Deploy を実行します。初回起動時に `shared/db.js` がテーブル (`weather_history`, `weather_daily_summary`) を自動生成します。
5. 動作確認：デプロイ URL に対して `https://<service>.onrender.com/api/historical?hours=3` や `...?date=2025-01-05` を実行し、JSON レスポンスが取得できることを確認します。

## 4. Cron Job のデプロイ

1. Render ダッシュボードで _New → Cron Job_ を選択し、リポジトリの `cron-job/` ディレクトリを指定します。
2. コマンドを以下のように設定します。

   ```bash
   npm install --production && node src/fetch-historical-weather.js "$(date -d 'yesterday' +%Y-%m-%d)"
   ```

   ※ Render の Cron Job は Linux ベースなので `date -d 'yesterday'` が利用可能です。別環境の場合は Node.js や Python で日付計算を行うよう調整します。

3. スケジュールを任意で設定します（例：`0 21 * * *` → UTC 21:00/ JST 06:00）。
4. Web Service と同じ環境変数を設定します（`.env.example` を参照）。特に `OPENWEATHER_*`, `DATABASE_URL`, `PGSSLMODE=require` を忘れずに。
5. 初回は手動実行（Run Now）で動作を確認し、成功後に Postgres の `weather_history` テーブルにレコードが投入されていることを Render の “Connect” から確認します。

## 5. フロントエンドからの利用

- ブラウザや他のサービスからは Web Service のエンドポイントを呼び出します。
  - 直近 3 時間のデータ: `GET /api/historical?hours=3`
  - 特定日 (24 時間) のデータ: `GET /api/historical?date=YYYY-MM-DD`
  - `refresh=true` を付与すると API 呼び出しを強制し再取得します。
- CORS 設定を `CORS_ORIGIN` で制御できます。

## 6. 補足

- Postgres テーブル定義は `shared/db.js` の `initSchema()` で管理されます。スキーマ変更が必要な場合はここを更新し Web Service/Cron Job を再デプロイしてください。
- Cron Job は取得結果の JSON を `cron-job/outputs/DATE/...` にも保存します。必要に応じて追加処理（S3 へのアップロードなど）を `cron-job/src/fetch-historical-weather.js` に実装してください。
- ログや障害通知などが必要な場合は Render のダッシュボードや外部モニタリング（例: LogDNA, Datadog）と連携します。

これで Render 上に Web API・バッチ処理・データベースを統合した構成が実現できます。
