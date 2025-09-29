# ESP32 Weather Station - MicroPython

M2Rダッシュボードにモック温度・湿度データを送信するESP32用MicroPythonプログラムです。

## 🚀 クイックスタート

### 1. 必要なもの
- ESP32開発ボード
- USB-Cケーブル（ESP32による）
- WiFiネットワーク
- PC/Mac（プログラム書き込み用）

### 2. MicroPythonのインストール

#### Step 1: esptoolのインストール
```bash
pip install esptool
```

#### Step 2: MicroPythonファームウェアのダウンロード
[MicroPython公式サイト](https://micropython.org/download/esp32/)から最新のファームウェアをダウンロード

#### Step 3: ESP32にファームウェアを書き込み
```bash
# フラッシュメモリを消去
esptool.py --chip esp32 --port /dev/ttyUSB0 erase_flash

# MicroPythonファームウェアを書き込み（ポート名は環境に応じて変更）
esptool.py --chip esp32 --port /dev/ttyUSB0 --baud 460800 write_flash -z 0x1000 esp32-20220618-v1.19.1.bin
```

**ポート名の例:**
- Windows: `COM3`, `COM4` など
- macOS: `/dev/tty.usbserial-*` または `/dev/tty.SLAB_USBtoUART`
- Linux: `/dev/ttyUSB0`, `/dev/ttyACM0` など

### 3. プログラムのアップロード

#### Option A: Thonny IDE（推奨）
1. [Thonny](https://thonny.org/)をダウンロード・インストール
2. Tools → Options → Interpreter → "MicroPython (ESP32)"を選択
3. ポートを指定してESP32に接続
4. `config.py`と`main.py`をESP32にアップロード

#### Option B: ampy（コマンドライン）
```bash
# ampyのインストール
pip install adafruit-ampy

# ファイルをアップロード
ampy --port /dev/ttyUSB0 put config.py
ampy --port /dev/ttyUSB0 put main.py

# プログラムを実行
ampy --port /dev/ttyUSB0 run main.py
```

#### Option C: rshell
```bash
# rshellのインストール
pip install rshell

# ESP32に接続
rshell --port /dev/ttyUSB0

# ファイルをコピー
cp config.py /pyboard/
cp main.py /pyboard/

# REPL（対話モード）に入る
repl
```

### 4. 設定

`config.py`ファイルを編集してWiFi設定を変更：

```python
# WiFi設定
WIFI_SSID = "your_wifi_name"      # WiFiネットワーク名
WIFI_PASSWORD = "your_password"   # WiFiパスワード

# デバイス設定
DEVICE_ID = "ESP32-001"          # 各ESP32で異なるIDに変更

# 測定間隔
MEASUREMENT_INTERVAL = 300       # 5分間隔（300秒）
```

### 5. 実行

ESP32の電源を入れるか、シリアルモニターから実行：

```python
# REPLで実行する場合
import main
```

または`boot.py`を作成して自動起動設定：

```python
# boot.py
import main
```

## 📊 データ形式

ESP32から送信されるデータ形式：

```json
{
  "deviceId": "ESP32-001",
  "temperature": 25.3,
  "humidity": 62.1,
  "recordedAt": null,
  "payload": {
    "measurementCount": 42,
    "sensorStatus": "ok",
    "sensorType": "mock",
    "deviceInfo": {
      "platform": "ESP32",
      "framework": "MicroPython",
      "version": "1.0.0"
    },
    "networkInfo": {
      "rssi": -45,
      "ip": "192.168.1.100"
    },
    "memoryInfo": {
      "free": 4194304,
      "allocated": 2097152
    }
  }
}
```

## 🔧 カスタマイズ

### 温度・湿度の範囲を変更

```python
# config.py
BASE_TEMPERATURE = 20.0    # 基準温度（°C）
TEMP_VARIATION = 8.0       # 温度変動幅（±8°C）

BASE_HUMIDITY = 55.0       # 基準湿度（%）
HUMIDITY_VARIATION = 20.0  # 湿度変動幅（±20%）
```

### 測定間隔の変更

```python
# config.py
MEASUREMENT_INTERVAL = 60  # 1分間隔
# または
MEASUREMENT_INTERVAL = 1800  # 30分間隔
```

### 複数デバイスの設定

各ESP32で異なる`DEVICE_ID`を設定：

```python
# ESP32 #1
DEVICE_ID = "ESP32-Living-Room"

# ESP32 #2
DEVICE_ID = "ESP32-Bedroom"

# ESP32 #3
DEVICE_ID = "ESP32-Kitchen"
```

## 🔍 監視とデバッグ

### シリアルモニターでログ確認

ESP32のシリアル出力例：

```
[2025-09-29 13:45:00] 🚀 ESP32 Weather Station Starting Up
[2025-09-29 13:45:00]    Device ID: ESP32-001
[2025-09-29 13:45:00]    Measurement Interval: 300s
[2025-09-29 13:45:00]    API URL: https://m2r.onrender.com/api/measurements
[2025-09-29 13:45:01] Connecting to WiFi: MyWiFi
[2025-09-29 13:45:03] ✅ WiFi connected!
[2025-09-29 13:45:03]    IP: 192.168.1.100
[2025-09-29 13:45:03]    RSSI: -42 dBm
[2025-09-29 13:45:04] ✅ Startup complete!
[2025-09-29 13:45:04] 🔄 Starting main measurement loop
[2025-09-29 13:45:04] 📋 Starting measurement cycle
[2025-09-29 13:45:04] 📊 Mock sensor readings: 25.3°C, 62.1%
[2025-09-29 13:45:04] 🔄 Sending attempt 1/3
[2025-09-29 13:45:04] 📤 Sending data to: https://m2r.onrender.com/api/measurements
[2025-09-29 13:45:05] 📦 Payload size: 456 bytes
[2025-09-29 13:45:06] 📡 Response: 201
[2025-09-29 13:45:06] ✅ Data sent successfully!
[2025-09-29 13:45:06] 💾 Memory after cycle: 4194304 bytes free
[2025-09-29 13:45:06] ⏱️  Waiting 300s until next measurement...
```

### LEDインジケーター

- **起動時**: 1回長い点滅
- **WiFi接続成功**: 3回短い点滅
- **データ送信成功**: 2回短い点滅
- **エラー発生**: 5回短い点滅
- **致命的エラー**: 10回短い点滅

## 🚨 トラブルシューティング

### WiFiに接続できない

1. **SSID/パスワードを確認**
   ```python
   WIFI_SSID = "correct_network_name"
   WIFI_PASSWORD = "correct_password"
   ```

2. **WiFiネットワークの互換性確認**
   - 2.4GHz帯を使用（5GHzは非対応）
   - WPA2/WPA3セキュリティ
   - 企業用WiFi（認証が複雑）は避ける

3. **シリアルモニターでWiFi状況確認**

### データが送信されない

1. **API URLの確認**
   ```python
   API_URL = "https://m2r.onrender.com/api/measurements"
   ```

2. **インターネット接続の確認**
   ```python
   # REPLで簡単なテスト
   import urequests
   response = urequests.get("http://httpbin.org/get")
   print(response.text)
   ```

3. **ファイアウォール/プロキシの確認**

### メモリ不足エラー

```python
# REPLでメモリ状況確認
import gc
print("Free memory:", gc.mem_free())
print("Allocated memory:", gc.mem_alloc())

# ガベージコレクション実行
gc.collect()
```

### ESP32が再起動を繰り返す

1. **電源供給の確認**
   - 電流容量不足の可能性
   - USBケーブルを変更

2. **メモリリークの確認**
   - `MEMORY_DEBUG = True`に設定
   - ログでメモリ使用量監視

3. **無限ループの確認**
   - エラーハンドリングの問題

## 📁 ファイル構成

```
esp32-micropython/
├── main.py          # メインプログラム
├── config.py        # 設定ファイル
├── boot.py          # 自動起動設定（オプション）
└── README.md        # このファイル
```

## 🔗 関連リンク

- [MicroPython公式ドキュメント](https://docs.micropython.org/)
- [ESP32 MicroPythonチュートリアル](https://docs.micropython.org/en/latest/esp32/tutorial/intro.html)
- [M2Rプロジェクト](https://m2-r-24f40.web.app)
- [M2R API仕様](https://m2r.onrender.com/health)

## 📝 更新履歴

- **v1.0.0** (2025-09-29): 初期リリース
  - モック温度・湿度データ送信機能
  - WiFi自動接続
  - エラーハンドリング
  - LEDステータス表示

## 🤝 サポート

質問や問題がある場合：

1. シリアルモニターのログを確認
2. WiFi設定を再確認
3. ESP32の電源を確認
4. 必要に応じて開発者に連絡

Happy coding! 🎉