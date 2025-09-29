"""
ESP32 Weather Station Configuration
Update these settings according to your environment
"""

# ========== WIFI SETTINGS ==========
# Update with your WiFi credentials
WIFI_SSID = "YOUR_WIFI_SSID"        # Replace with your WiFi network name
WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"  # Replace with your WiFi password

# ========== API SETTINGS ==========
# M2R Backend API Configuration
API_URL = "https://m2r.onrender.com/api/measurements"

# Device identification - make this unique for each ESP32
DEVICE_ID = "ESP32-001"  # Change this for each device (ESP32-002, ESP32-003, etc.)

# ========== MEASUREMENT SETTINGS ==========
# How often to take and send measurements (in seconds)
MEASUREMENT_INTERVAL = 300  # 5 minutes (300 seconds)

# Network retry settings
MAX_RETRIES = 3           # Number of retry attempts for failed requests
RETRY_DELAY = 10          # Delay between retries (seconds)

# ========== SENSOR SIMULATION SETTINGS ==========
# Mock temperature sensor configuration
BASE_TEMPERATURE = 25.0   # Base temperature in Celsius
TEMP_VARIATION = 5.0      # Temperature variation range (±5°C)

# Mock humidity sensor configuration
BASE_HUMIDITY = 60.0      # Base humidity percentage
HUMIDITY_VARIATION = 15.0 # Humidity variation range (±15%)

# ========== HARDWARE SETTINGS ==========
# GPIO pin for status LED (usually GPIO2 on ESP32)
LED_PIN = 2

# ========== DEBUG SETTINGS ==========
# Enable verbose logging
DEBUG_MODE = True

# Print memory usage information
MEMORY_DEBUG = True

# ========== ADVANCED SETTINGS ==========
# HTTP request timeout (seconds)
REQUEST_TIMEOUT = 30

# WiFi connection timeout (seconds)
WIFI_TIMEOUT = 20

# ========== LOCATION SETTINGS (OPTIONAL) ==========
# Optional location information to include in payload
LOCATION = {
    "name": "ESP32 Weather Station",
    "description": "Mock temperature and humidity sensor",
    "latitude": None,   # Add GPS coordinates if available
    "longitude": None,
    "altitude": None    # Altitude in meters
}

# ========== VALIDATION ==========
def validate_config():
    """Validate configuration settings"""
    errors = []

    if WIFI_SSID == "YOUR_WIFI_SSID":
        errors.append("❌ WIFI_SSID not configured")

    if WIFI_PASSWORD == "YOUR_WIFI_PASSWORD":
        errors.append("❌ WIFI_PASSWORD not configured")

    if not API_URL.startswith("http"):
        errors.append("❌ Invalid API_URL format")

    if not DEVICE_ID or DEVICE_ID == "ESP32-001":
        errors.append("⚠️  Consider changing DEVICE_ID to unique value")

    if MEASUREMENT_INTERVAL < 60:
        errors.append("⚠️  MEASUREMENT_INTERVAL < 60s may overwhelm API")

    return errors

# ========== CONFIGURATION EXPORT ==========
def get_config():
    """Get configuration as dictionary"""
    return {
        'wifi': {
            'ssid': WIFI_SSID,
            'password': WIFI_PASSWORD,
            'timeout': WIFI_TIMEOUT
        },
        'api': {
            'url': API_URL,
            'timeout': REQUEST_TIMEOUT,
            'max_retries': MAX_RETRIES,
            'retry_delay': RETRY_DELAY
        },
        'device': {
            'id': DEVICE_ID,
            'led_pin': LED_PIN
        },
        'measurement': {
            'interval': MEASUREMENT_INTERVAL,
            'base_temperature': BASE_TEMPERATURE,
            'temp_variation': TEMP_VARIATION,
            'base_humidity': BASE_HUMIDITY,
            'humidity_variation': HUMIDITY_VARIATION
        },
        'debug': {
            'enabled': DEBUG_MODE,
            'memory': MEMORY_DEBUG
        },
        'location': LOCATION
    }

if __name__ == "__main__":
    # Test configuration when run directly
    errors = validate_config()
    if errors:
        print("Configuration issues found:")
        for error in errors:
            print(f"  {error}")
    else:
        print("✅ Configuration valid!")

    print(f"\nDevice ID: {DEVICE_ID}")
    print(f"Measurement Interval: {MEASUREMENT_INTERVAL}s")
    print(f"API URL: {API_URL}")