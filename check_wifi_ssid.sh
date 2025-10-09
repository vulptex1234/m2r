#!/bin/bash
# WiFi SSID確認スクリプト（macOS用）

echo "==================================="
echo "現在接続中のWiFi SSID確認"
echo "==================================="
echo ""

# 方法1: networksetup
echo "【方法1】networksetup コマンド:"
SSID1=$(networksetup -getairportnetwork en0 2>/dev/null | cut -d ':' -f 2 | xargs)
if [ -n "$SSID1" ]; then
    echo "  SSID: $SSID1"
else
    SSID1=$(networksetup -getairportnetwork en1 2>/dev/null | cut -d ':' -f 2 | xargs)
    if [ -n "$SSID1" ]; then
        echo "  SSID: $SSID1"
    else
        echo "  (WiFi接続なし)"
    fi
fi
echo ""

# 方法2: airport コマンド
echo "【方法2】airport コマンド:"
AIRPORT="/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport"
if [ -f "$AIRPORT" ]; then
    SSID2=$($AIRPORT -I | grep " SSID" | awk '{print $2}')
    if [ -n "$SSID2" ]; then
        echo "  SSID: $SSID2"
    else
        echo "  (WiFi接続なし)"
    fi
else
    echo "  (airportコマンドが見つかりません)"
fi
echo ""

# 方法3: system_profiler
echo "【方法3】system_profiler:"
SSID3=$(system_profiler SPAirPortDataType 2>/dev/null | grep -A 1 "Current Network Information" | grep "SSID" | awk -F': ' '{print $2}')
if [ -n "$SSID3" ]; then
    echo "  SSID: $SSID3"
else
    echo "  (WiFi接続なし)"
fi
echo ""

# 結果まとめ
echo "==================================="
echo "ESP32 passwords.py への設定方法:"
echo "==================================="
echo ""
if [ -n "$SSID1" ]; then
    echo "HOME_WIFI_SSID = '$SSID1'"
elif [ -n "$SSID2" ]; then
    echo "HOME_WIFI_SSID = '$SSID2'"
elif [ -n "$SSID3" ]; then
    echo "HOME_WIFI_SSID = '$SSID3'"
else
    echo "WiFiに接続されていません。"
    echo "WiFi設定から接続してから再度実行してください。"
fi
echo ""

# 利用可能なWiFiネットワーク一覧（オプション）
echo "==================================="
echo "利用可能なWiFiネットワーク:"
echo "==================================="
if [ -f "$AIRPORT" ]; then
    $AIRPORT -s | head -10
else
    echo "(airportコマンドが利用できません)"
fi
