"""
ESP32 MicroPython Weather Station
Sends mock temperature and humidity data to M2R backend API

Requirements:
- ESP32 with MicroPython
- WiFi connection
- urequests library

Configuration:
- Update WIFI_SSID and WIFI_PASSWORD
- Modify API_URL if needed
- Set DEVICE_ID for unique identification
"""

import network
import urequests as requests
import ujson as json
import utime as time
import machine
import gc
from urandom import getrandbits

# ========== CONFIGURATION ==========
# WiFi Settings
WIFI_SSID = "YOUR_WIFI_SSID"
WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"

# API Settings
API_URL = "https://m2r.onrender.com/api/measurements"
DEVICE_ID = "ESP32-001"

# Data Collection Settings
MEASUREMENT_INTERVAL = 300  # 5 minutes in seconds
MAX_RETRIES = 3
RETRY_DELAY = 10  # seconds

# Mock Sensor Settings
BASE_TEMPERATURE = 25.0  # Base temperature in Celsius
TEMP_VARIATION = 5.0     # ±5°C variation
BASE_HUMIDITY = 60.0     # Base humidity in %
HUMIDITY_VARIATION = 15.0 # ±15% variation

# ========== GLOBAL VARIABLES ==========
wlan = None
measurement_count = 0

# ========== UTILITY FUNCTIONS ==========
def log(message):
    """Print timestamped log message"""
    timestamp = time.localtime()
    print("[{:04d}-{:02d}-{:02d} {:02d}:{:02d}:{:02d}] {}".format(
        timestamp[0], timestamp[1], timestamp[2],
        timestamp[3], timestamp[4], timestamp[5],
        message
    ))

def blink_led(times=1, delay_ms=200):
    """Blink onboard LED for status indication"""
    try:
        led = machine.Pin(2, machine.Pin.OUT)  # GPIO2 for most ESP32 boards
        for _ in range(times):
            led.on()
            time.sleep_ms(delay_ms)
            led.off()
            time.sleep_ms(delay_ms)
    except:
        pass  # Ignore if LED pin is not available

# ========== WIFI FUNCTIONS ==========
def connect_wifi():
    """Connect to WiFi network with retry logic"""
    global wlan

    log(f"Connecting to WiFi: {WIFI_SSID}")

    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)

    if wlan.isconnected():
        log(f"Already connected: {wlan.ifconfig()[0]}")
        return True

    wlan.connect(WIFI_SSID, WIFI_PASSWORD)

    # Wait for connection with timeout
    timeout = 20  # seconds
    start_time = time.time()

    while not wlan.isconnected() and (time.time() - start_time) < timeout:
        log("Connecting...")
        blink_led(1, 100)
        time.sleep(2)

    if wlan.isconnected():
        config = wlan.ifconfig()
        log(f"✅ WiFi connected!")
        log(f"   IP: {config[0]}")
        log(f"   Subnet: {config[1]}")
        log(f"   Gateway: {config[2]}")
        log(f"   DNS: {config[3]}")
        log(f"   RSSI: {wlan.status('rssi')} dBm")
        blink_led(3, 200)
        return True
    else:
        log("❌ WiFi connection failed")
        return False

def check_wifi():
    """Check WiFi connection and reconnect if necessary"""
    global wlan

    if not wlan or not wlan.isconnected():
        log("⚠️ WiFi disconnected, attempting to reconnect...")
        return connect_wifi()

    return True

# ========== SENSOR FUNCTIONS ==========
def generate_mock_temperature():
    """Generate realistic mock temperature data"""
    # Create time-based variation (simulating daily temperature cycle)
    current_time = time.time()
    hour_of_day = (current_time // 3600) % 24

    # Simple sinusoidal variation over 24 hours
    daily_variation = 3.0 * math.sin((hour_of_day - 6) * 3.14159 / 12)

    # Add random variation
    random_variation = (getrandbits(10) / 1024.0 - 0.5) * TEMP_VARIATION

    temperature = BASE_TEMPERATURE + daily_variation + random_variation
    return round(temperature, 2)

def generate_mock_humidity():
    """Generate realistic mock humidity data"""
    # Inverse correlation with temperature (higher temp = lower humidity)
    temp_factor = (generate_mock_temperature() - BASE_TEMPERATURE) * -0.5

    # Add random variation
    random_variation = (getrandbits(10) / 1024.0 - 0.5) * HUMIDITY_VARIATION

    humidity = BASE_HUMIDITY + temp_factor + random_variation

    # Clamp to realistic range
    humidity = max(20.0, min(95.0, humidity))
    return round(humidity, 2)

def get_sensor_readings():
    """Get mock sensor readings"""
    try:
        temperature = generate_mock_temperature()
        humidity = generate_mock_humidity()

        log(f"📊 Mock sensor readings: {temperature}°C, {humidity}%")

        return {
            "temperature": temperature,
            "humidity": humidity,
            "status": "ok",
            "type": "mock"
        }
    except Exception as e:
        log(f"❌ Sensor reading error: {e}")
        return {
            "temperature": None,
            "humidity": None,
            "status": "error",
            "error": str(e)
        }

# ========== API FUNCTIONS ==========
def create_measurement_payload(sensor_data):
    """Create API payload from sensor data"""
    global measurement_count
    measurement_count += 1

    # Get current time in ISO format
    current_time = time.time()
    # Simple ISO format (MicroPython limitation)
    recorded_at = f"{current_time:.0f}"  # Unix timestamp as string

    payload = {
        "deviceId": DEVICE_ID,
        "temperature": sensor_data["temperature"],
        "humidity": sensor_data["humidity"],
        "recordedAt": None,  # Let server set the timestamp
        "payload": {
            "measurementCount": measurement_count,
            "sensorStatus": sensor_data["status"],
            "sensorType": sensor_data["type"],
            "deviceInfo": {
                "platform": "ESP32",
                "framework": "MicroPython",
                "version": "1.0.0"
            },
            "networkInfo": {
                "rssi": wlan.status('rssi') if wlan and wlan.isconnected() else None,
                "ip": wlan.ifconfig()[0] if wlan and wlan.isconnected() else None
            },
            "memoryInfo": {
                "free": gc.mem_free(),
                "allocated": gc.mem_alloc()
            }
        }
    }

    # Add error info if sensor reading failed
    if sensor_data["status"] == "error":
        payload["payload"]["error"] = sensor_data.get("error", "Unknown error")

    return payload

def send_measurement(payload):
    """Send measurement data to API"""
    log(f"📤 Sending data to: {API_URL}")

    try:
        # Convert payload to JSON
        json_data = json.dumps(payload)

        # Prepare headers
        headers = {
            'Content-Type': 'application/json',
            'User-Agent': f'ESP32-MicroPython/{DEVICE_ID}'
        }

        log(f"📦 Payload size: {len(json_data)} bytes")

        # Send POST request
        response = requests.post(
            API_URL,
            data=json_data,
            headers=headers,
            timeout=30
        )

        log(f"📡 Response: {response.status_code}")

        if response.status_code == 201:
            log("✅ Data sent successfully!")
            blink_led(2, 100)
            return True
        else:
            log(f"❌ API error: {response.status_code}")
            try:
                error_data = response.json()
                log(f"   Error details: {error_data}")
            except:
                log(f"   Response text: {response.text}")
            return False

    except Exception as e:
        log(f"❌ Request failed: {e}")
        return False
    finally:
        try:
            response.close()
        except:
            pass

def send_measurement_with_retry(sensor_data):
    """Send measurement with retry logic"""
    for attempt in range(1, MAX_RETRIES + 1):
        log(f"🔄 Sending attempt {attempt}/{MAX_RETRIES}")

        # Check WiFi connection
        if not check_wifi():
            log("❌ WiFi not available, skipping send")
            time.sleep(RETRY_DELAY)
            continue

        # Create payload
        payload = create_measurement_payload(sensor_data)

        # Attempt to send
        if send_measurement(payload):
            return True

        # Wait before retry (except on last attempt)
        if attempt < MAX_RETRIES:
            log(f"⏳ Waiting {RETRY_DELAY}s before retry...")
            time.sleep(RETRY_DELAY)

    log(f"❌ Failed to send after {MAX_RETRIES} attempts")
    blink_led(5, 100)  # Error indication
    return False

# ========== MAIN FUNCTIONS ==========
def startup_sequence():
    """Perform startup sequence"""
    log("🚀 ESP32 Weather Station Starting Up")
    log(f"   Device ID: {DEVICE_ID}")
    log(f"   Measurement Interval: {MEASUREMENT_INTERVAL}s")
    log(f"   API URL: {API_URL}")

    # Startup blink sequence
    blink_led(1, 500)

    # Connect to WiFi
    if not connect_wifi():
        log("❌ Startup failed: WiFi connection required")
        return False

    # Memory info
    log(f"💾 Memory: {gc.mem_free()} bytes free, {gc.mem_alloc()} bytes allocated")

    log("✅ Startup complete!")
    return True

def main_loop():
    """Main measurement and transmission loop"""
    log("🔄 Starting main measurement loop")

    while True:
        try:
            log("📋 Starting measurement cycle")

            # Collect sensor data
            sensor_data = get_sensor_readings()

            # Send data to API
            send_measurement_with_retry(sensor_data)

            # Garbage collection
            gc.collect()

            # Log memory status
            log(f"💾 Memory after cycle: {gc.mem_free()} bytes free")

            # Wait for next measurement
            log(f"⏱️  Waiting {MEASUREMENT_INTERVAL}s until next measurement...")
            time.sleep(MEASUREMENT_INTERVAL)

        except KeyboardInterrupt:
            log("🛑 Interrupted by user")
            break
        except Exception as e:
            log(f"❌ Unexpected error in main loop: {e}")
            log("⏳ Waiting 30s before retry...")
            time.sleep(30)

# ========== MISSING MATH MODULE WORKAROUND ==========
# Simple sine approximation for daily temperature variation
def math_sin_approx(x):
    """Simple sine approximation using Taylor series"""
    # Normalize x to [0, 2π]
    while x > 6.28318:
        x -= 6.28318
    while x < 0:
        x += 6.28318

    # Taylor series approximation: sin(x) ≈ x - x³/6 + x⁵/120
    return x - (x**3)/6 + (x**5)/120 - (x**7)/5040

# Replace math.sin with approximation
import builtins
builtins.math = type('math', (), {'sin': math_sin_approx})

# ========== ENTRY POINT ==========
if __name__ == "__main__":
    try:
        if startup_sequence():
            main_loop()
        else:
            log("❌ Startup failed, halting")
    except Exception as e:
        log(f"💥 Fatal error: {e}")
        blink_led(10, 100)  # Panic blink
    finally:
        log("👋 ESP32 Weather Station stopped")