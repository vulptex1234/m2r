# OpenWeather Historical API (Render Web Service)

Render 上にデプロイして OpenWeather の過去データを提供する Web API の構成例です。

## エンドポイント

- `GET /health`
  - 稼働確認用。
- `GET /api/historical`
  - クエリ `date=YYYY-MM-DD` を指定すると 24 時間分のデータを返します。
  - `hours=3` など時間数を指定すると直近の逐次データを返します。
  - `lat` / `lon` / `units` / `lang` / `delayMs` で上書き可能。

## 環境変数

| 変数名 | 説明 | 例 |
| ------ | ---- | --- |
| `OPENWEATHER_API_KEY` | OpenWeather API キー（必須） | `xxxx` |
| `OPENWEATHER_LAT` | デフォルト緯度 | `35.656` |
| `OPENWEATHER_LON` | デフォルト経度 | `139.324` |
| `OPENWEATHER_UNITS` | 単位（任意） | `metric` |
| `OPENWEATHER_LANG` | 言語（任意） | `ja` |
| `OPENWEATHER_DELAY_MS` | レート制御の待機時間 ms | `1100` |
| `CORS_ORIGIN` | CORS 許可するオリジン（省略で `*`） | `https://example.com` |
| `DATABASE_URL` | Render Postgres 接続文字列 | `postgres://...` |
| `PGSSLMODE` | SSL モード（Render Postgres は `require` 推奨） | `require` |

## ローカル実行

```bash
cd web-service
npm install
npm run dev
```

## Render デプロイ手順

1. Render で Web Service を作成し、このディレクトリをリポジトリとして接続。
2. 起動コマンド: `npm run start`
3. 環境変数に上記キーを設定。
4. デプロイ後、`/api/historical?hours=3` などにアクセスして動作確認します。
