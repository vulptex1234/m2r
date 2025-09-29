#!/usr/bin/env python3
"""
ESP32 Weather Station API Test Script
Test the backend API without requiring an actual ESP32

This script simulates ESP32 behavior and sends mock data to the API
for testing and debugging purposes.
"""

import requests
import json
import time
import random
import math
from datetime import datetime

# Configuration
API_URL = "https://m2r.onrender.com/api/measurements"
DEVICE_ID = "ESP32-TEST"
NUM_TESTS = 3
DELAY_BETWEEN_TESTS = 2  # seconds

def generate_mock_data():
    """Generate mock sensor data similar to ESP32"""
    current_time = time.time()
    hour_of_day = (current_time // 3600) % 24

    # Daily temperature variation
    daily_variation = 3.0 * math.sin((hour_of_day - 6) * math.pi / 12)
    temperature = 25.0 + daily_variation + random.uniform(-2.0, 2.0)

    # Humidity inversely related to temperature
    humidity = 60.0 - (temperature - 25.0) * 0.5 + random.uniform(-10.0, 10.0)
    humidity = max(20.0, min(95.0, humidity))

    return {
        "temperature": round(temperature, 2),
        "humidity": round(humidity, 2)
    }

def create_api_payload(sensor_data, test_number):
    """Create API payload matching ESP32 format"""
    return {
        "deviceId": DEVICE_ID,
        "temperature": sensor_data["temperature"],
        "humidity": sensor_data["humidity"],
        "recordedAt": None,  # Let server set timestamp
        "payload": {
            "testNumber": test_number,
            "sensorStatus": "ok",
            "sensorType": "mock-test",
            "deviceInfo": {
                "platform": "Python-Test",
                "framework": "requests",
                "version": "1.0.0"
            },
            "networkInfo": {
                "source": "desktop",
                "test_mode": True
            },
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
    }

def send_test_data(payload, test_number):
    """Send test data to API"""
    print(f"\n🧪 Test {test_number}: Sending mock data...")
    print(f"   Temperature: {payload['temperature']}°C")
    print(f"   Humidity: {payload['humidity']}%")

    try:
        headers = {
            'Content-Type': 'application/json',
            'User-Agent': f'ESP32-API-Test/{DEVICE_ID}'
        }

        response = requests.post(
            API_URL,
            json=payload,
            headers=headers,
            timeout=10
        )

        print(f"   Status: {response.status_code}")

        if response.status_code == 201:
            print("   ✅ SUCCESS: Data sent successfully!")
            return True
        else:
            print(f"   ❌ FAILED: HTTP {response.status_code}")
            try:
                error_data = response.json()
                print(f"   Error: {error_data}")
            except:
                print(f"   Response: {response.text}")
            return False

    except requests.exceptions.Timeout:
        print("   ❌ FAILED: Request timeout")
        return False
    except requests.exceptions.ConnectionError:
        print("   ❌ FAILED: Connection error")
        return False
    except Exception as e:
        print(f"   ❌ FAILED: {e}")
        return False

def test_api_health():
    """Test API health endpoint"""
    print("🔍 Testing API health...")
    try:
        health_url = API_URL.replace('/api/measurements', '/health')
        response = requests.get(health_url, timeout=5)
        print(f"   Health check: {response.status_code}")
        if response.status_code == 200:
            try:
                data = response.json()
                print(f"   Status: {data.get('status', 'unknown')}")
            except:
                pass
            return True
        return False
    except Exception as e:
        print(f"   Health check failed: {e}")
        return False

def main():
    """Run API test sequence"""
    print("🚀 ESP32 Weather Station API Test")
    print("=" * 50)
    print(f"API URL: {API_URL}")
    print(f"Device ID: {DEVICE_ID}")
    print(f"Number of tests: {NUM_TESTS}")
    print("=" * 50)

    # Test API health
    if not test_api_health():
        print("\n⚠️ API health check failed, but continuing with tests...")

    # Run tests
    successful_tests = 0
    failed_tests = 0

    for i in range(1, NUM_TESTS + 1):
        # Generate mock data
        sensor_data = generate_mock_data()

        # Create payload
        payload = create_api_payload(sensor_data, i)

        # Send data
        if send_test_data(payload, i):
            successful_tests += 1
        else:
            failed_tests += 1

        # Wait before next test
        if i < NUM_TESTS:
            print(f"   ⏳ Waiting {DELAY_BETWEEN_TESTS}s...")
            time.sleep(DELAY_BETWEEN_TESTS)

    # Test summary
    print("\n" + "=" * 50)
    print("📊 Test Results Summary")
    print("=" * 50)
    print(f"Total tests: {NUM_TESTS}")
    print(f"Successful: {successful_tests} ✅")
    print(f"Failed: {failed_tests} ❌")
    print(f"Success rate: {(successful_tests/NUM_TESTS)*100:.1f}%")

    if successful_tests > 0:
        print(f"\n🎉 API is working! Check dashboard: https://m2-r-24f40.web.app")
        print(f"   Look for device: {DEVICE_ID}")

    if failed_tests > 0:
        print(f"\n⚠️ {failed_tests} test(s) failed - check API connectivity")

    print("\n✅ Test completed!")

if __name__ == "__main__":
    main()