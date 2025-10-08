# ESP32 ↔ Render Integration Plan

## ゴール
- ESP32 上の温度・電力計測ループから Render 上の Web Service (Express + Postgres) へ自動送信するデータパイプラインを構築する。
- 計測値の欠損や通信失敗時にも再送・監視が可能な仕組みを用意し、ダッシュボード/下流処理が安定して参照できる状態にする。

## 現状把握
- ESP32 (`esp32/boot.py`) は `temp.csv` / `elect.csv` へ 5 分周期でローカル追記。ネットワーク送信処理は未実装。
- Render Web Service (`web-service/src/server.js`) には `POST /api/measurements` と `POST /api/raw-measurements` があり、Postgres へ保存するユーティリティ (`shared/persistence.js`) が用意済み。
- `device_measurements` テーブルは温度/湿度カラム、追加情報は JSONB `payload` に格納可能。電圧・電流・電力の専用カラムは未定義。
- 認証/認可は未設定。CORS は `*` デフォルトで外部アクセスが可能。

## 目標アーキテクチャ概要
- ESP32 ファームウェアで Wi-Fi 接続・API 呼び出し（`urequests` など）を実装し、計測バッチを JSON で送信。
- 通信失敗時はローカルバッファ（CSV or RAM キュー）に保持し、次回成功時にまとめ送信。
- Render 側はデバイス ID ごとの測定値を受け取り、Postgres の `device_measurements` へ挿入。電力メトリクスは `payload` JSON または追加カラムに展開。
- 必要に応じて `raw` エンドポイントに全データをアーカイブし、後段バッチ/学習の入力に利用。

## 実装タスクリスト

### Phase 0 – 調査 & 設計確定
- [ ] ESP32 側で利用可能な通信スタック（MicroPython `network` + `urequests`）とフラッシュ容量/依存ライブラリを確認。
- [ ] Render Web Service の DB スキーマとマイグレーション方針（JSONB で済ませるかカラム追加か）を決定。
- [ ] ネットワーク経路・セキュリティ要件（API キー、署名、VPN など）のポリシーを整理。

### Phase 1 – ESP32 ファームウェア拡張
- [ ] Wi-Fi 接続初期化モジュール（SSID/パスワード設定、再接続ロジック、起動時リトライ）を実装。
- [ ] 計測ループに HTTP POST 送信処理を追加し、`POST /api/measurements` 用の JSON ペイロード（`deviceId`, `recordedAt`, `temperature`, `payload.power` など）を組み立て。
- [ ] 電圧/電流/電力データを `payload` に含める整形関数を追加（ミリアンペア→アンペア変換など単位揃え）。
- [ ] 通信失敗時のリトライ＆ローカルバッファリング（CSV 再利用 or フラッシュ上の簡易キュー）を実装。
- [ ] LED 点滅やシリアルログで送信結果を可視化するデバッグフックを用意。

### Phase 2 – Render Web Service/DB 更新
- [ ] `shared/persistence.js` の `insertDeviceMeasurement` を拡張し、`payload.power` 等の構造を想定したバリデーションを追加。
- [ ] 電力指標をクエリしやすくするための DB カラム追加（`ALTER TABLE device_measurements ADD COLUMN voltage`, `current`, `power_mw` など）を検討・実施（必要ならマイグレーションスクリプト作成）。
- [ ] `POST /api/measurements` バリデーションを電力メトリクスに対応させ、入力フォーマット（例: `payload.energy`）をドキュメント化。
- [ ] `GET /api/measurements` のレスポンスに新メトリクスを含め、前端や BI が利用できるよう更新。
- [ ] （オプション）`POST /api/raw-measurements` を ESP32 バッチ取り込みに使う場合の整合性チェックを実施。

### Phase 3 – エッジ to クラウド ワークフロー検証
- [ ] ローカル環境で Render API のモック or Staging を立ち上げ、ESP32 からの実送信テストを実施。
- [ ] 投稿データが Postgres に期待通り保存されているかクエリで検証。
- [ ] 異常系（Wi-Fi 断、HTTP 500、JSON バリデーションエラー）のリカバリ挙動をシミュレート。
- [ ] 必要に応じてバックフィル用スクリプト（CSV → API POST）を作成し、過去データを取り込む。

### Phase 4 – 運用 & モニタリング整備
- [ ] Render 側で API キー or 固定トークンによる簡易認証を実装し、ESP32 からの送信でヘッダ付与。
- [ ] Cron Job / Web Service にヘルスチェック & アラート（失敗ログ検知、データ未着通知）を設定。
- [ ] ダッシュボード（例: `/public` 配下）や外部可視化に電力系メトリクスを表示するチャートを追加。
- [ ] 継続改善用にログローテーション・データ保持ポリシー（過去何日分を保持するか）を策定。

## データモデル案
- **`POST /api/measurements`**
  ```json
  {
    "deviceId": "esp32-node-01",
    "temperature": 24.3,
    "humidity": null,
    "recordedAt": "2025-02-05T09:30:00+09:00",
    "payload": {
      "voltage_v": 4.98,
      "current_ma": 120.4,
      "power_mw": 600.5,
      "sensor": {
        "bmp280": {
          "temperature_c": 24.3,
          "pressure_hpa": 1012.3
        },
        "ina219": {
          "shunt_ohms": 0.1
        }
      }
    }
  }
  ```
- DB カラム追加を行う場合は `device_measurements` に `voltage_v`, `current_ma`, `power_mw` を追加し、`persistence.js` で JSON とカラムを双方更新。

## リスクと対応
- **ネットワーク不安定**: 再送キューと指数バックオフを導入し、最大保持件数を設定。
- **API 無認証**: トークンベースのヘッダ検証を実装し、外部からの不正 POST を防止。
- **スキーマ変更の影響**: Render/ローカル双方で `initSchema` が idempotent であることを確認し、マイグレーション後に再デプロイ。
- **データ型差異**: 電流/電圧単位を明文化し、ESP32 ファームウェアとバックエンドで揃える。

## オープン課題
- [ ] ESP32 での Wi-Fi 設定をどこで管理するか（コード埋め込み vs 外部設定ファイル）。
- [ ] 電力データのサンプリング頻度（5 分固定か、可変にするか）。
- [ ] バッチ送信時の最大レコード数・送信間隔。
- [ ] 将来的な OTA 更新や証明書更新の運用手順。

## 追加実装計画: ESP32 温度送信関数
- **目的**: `esp32/boot.py` に BMP280 の実測温度を Render API へ送信する関数を追加し、既存の計測ループから呼び出せるようにする。
- **前提整理**
  - Wi-Fi 接続処理と Render のホスト情報を `boot.py` で扱えるようにし、ホスト情報は定数として定義する。
  - Micropython 版 `urequests` がファームウェアに導入済みか確認し、未導入なら `/lib/urequests.py` へ配置（`mpremote mip install urequests` 等で転送）。
  - `boot.py` 冒頭で `import urequests as requests` を行い、インポート失敗時は明確にログを出して送信処理をスキップできるようにする。
- **関数設計**
  - `send_temperature_to_render(temp_c, recorded_at=None)` のような関数を作成し、呼び出し元で測定した温度値を引数として渡す。
  - JSON ペイロード例: `{ "deviceId": <固定 or 設定値>, "temperature": temp_c, "recordedAt": recorded_at or iso_now() }`。
  - Render 側で必要な API キーがあれば HTTP ヘッダに付与する。
- **送信処理**
  - `urequests.post(f"{RENDER_BASE_URL}/api/measurements", json=payload, headers=headers)` の形で送信し、200 系レスポンスを確認。
  - レスポンスオブジェクトは `try/finally` で `close()` し、ソケットリークを防止。
  - 失敗時は例外を捕捉し、UART ログ出力とローカル CSV へのバックオフ記録（温度値＋タイムスタンプ）を行う。
  - 成功時は送信完了をブルー LED 点滅やログで可視化。
- **既存ループへの組み込み**
  - 計測ループで `bmp_sensor.read()` 後に温度値を取得し、CSV に追記した後で `send_temperature_to_render()` を呼び出す。
  - 連続失敗に備えて簡易リトライ（例: 最大 3 回、1 秒スリープ）を実装し、すべて失敗した場合は次サイクルまで保留。
- **検証**
  - ローカルに Render API のスタブ（簡易 HTTP サーバ）を立てて POST を受け取り、期待フォーマットで到達するか確認。
  - Wi-Fi 未接続・HTTP タイムアウトなどの異常時ログが期待通り出力されるかをテスト。
