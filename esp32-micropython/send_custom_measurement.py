#!/usr/bin/env python3
"""
Custom Measurement Data Sender
Send measurement data with specific time and temperature to M2R API

Usage Examples:
  python3 send_custom_measurement.py --temp 25.5 --time "2025-09-29 14:30:00"
  python3 send_custom_measurement.py --temp 28.2 --humidity 65 --time "1 hour ago"
  python3 send_custom_measurement.py --temp 22.1 --time "now" --device "ESP32-Lab"
  python3 send_custom_measurement.py --temp 26.7 --time "2025-09-29T05:15:00Z"
"""

import requests
import json
import argparse
import sys
from datetime import datetime, timedelta
import re

# Default configuration
DEFAULT_API_URL = "https://m2r.onrender.com/api/measurements"
DEFAULT_DEVICE_ID = "ESP32-CUSTOM-TEST"
DEFAULT_HUMIDITY = 60.0

def parse_time_string(time_str):
    """Parse various time string formats"""
    if not time_str:
        return datetime.now()

    time_str = time_str.strip().lower()
    now = datetime.now()

    # Handle "now"
    if time_str == "now":
        return now

    # Handle relative time (e.g., "1 hour ago", "30 minutes ago", "2 hours ago")
    relative_pattern = r'^(\d+)\s+(minute|minutes|hour|hours|min|h)\s+ago$'
    match = re.match(relative_pattern, time_str)
    if match:
        amount = int(match.group(1))
        unit = match.group(2)

        if unit in ['minute', 'minutes', 'min']:
            return now - timedelta(minutes=amount)
        elif unit in ['hour', 'hours', 'h']:
            return now - timedelta(hours=amount)

    # Handle forward relative time (e.g., "in 1 hour", "in 30 minutes")
    forward_pattern = r'^in\s+(\d+)\s+(minute|minutes|hour|hours|min|h)$'
    match = re.match(forward_pattern, time_str)
    if match:
        amount = int(match.group(1))
        unit = match.group(2)

        if unit in ['minute', 'minutes', 'min']:
            return now + timedelta(minutes=amount)
        elif unit in ['hour', 'hours', 'h']:
            return now + timedelta(hours=amount)

    # Try to parse ISO format with timezone
    iso_formats = [
        "%Y-%m-%dT%H:%M:%SZ",           # 2025-09-29T05:15:00Z
        "%Y-%m-%dT%H:%M:%S",            # 2025-09-29T05:15:00
        "%Y-%m-%d %H:%M:%S",            # 2025-09-29 05:15:00
        "%Y-%m-%d %H:%M",               # 2025-09-29 05:15
        "%Y/%m/%d %H:%M:%S",            # 2025/09/29 05:15:00
        "%Y/%m/%d %H:%M",               # 2025/09/29 05:15
        "%m/%d/%Y %H:%M:%S",            # 09/29/2025 05:15:00
        "%m/%d/%Y %H:%M",               # 09/29/2025 05:15
        "%H:%M:%S",                     # 05:15:00 (today)
        "%H:%M",                        # 05:15 (today)
    ]

    # Restore original case for parsing
    original_time_str = time_str

    for fmt in iso_formats:
        try:
            if fmt in ["%H:%M:%S", "%H:%M"]:
                # For time-only formats, use today's date
                parsed_time = datetime.strptime(original_time_str, fmt)
                return now.replace(
                    hour=parsed_time.hour,
                    minute=parsed_time.minute,
                    second=parsed_time.second if fmt == "%H:%M:%S" else 0,
                    microsecond=0
                )
            else:
                return datetime.strptime(original_time_str, fmt)
        except ValueError:
            continue

    raise ValueError(f"Unable to parse time string: '{time_str}'. Supported formats include:\n"
                     "  - 'now'\n"
                     "  - '1 hour ago', '30 minutes ago'\n"
                     "  - 'in 1 hour', 'in 30 minutes'\n"
                     "  - '2025-09-29 14:30:00'\n"
                     "  - '2025-09-29T05:15:00Z'\n"
                     "  - '14:30:00' (today)\n"
                     "  - '14:30' (today)")

def validate_temperature(temp_str):
    """Validate and convert temperature"""
    try:
        temp = float(temp_str)
        if temp < -50 or temp > 80:
            print(f"⚠️ Warning: Temperature {temp}°C is outside typical range (-50°C to 80°C)")
        return temp
    except ValueError:
        raise ValueError(f"Invalid temperature value: '{temp_str}'. Must be a number.")

def validate_humidity(humidity_str):
    """Validate and convert humidity"""
    try:
        humidity = float(humidity_str)
        if humidity < 0 or humidity > 100:
            raise ValueError(f"Humidity must be between 0 and 100%. Got: {humidity}%")
        return humidity
    except ValueError:
        raise ValueError(f"Invalid humidity value: '{humidity_str}'. Must be a number between 0-100.")

def create_measurement_payload(device_id, temperature, humidity, recorded_at, description=None):
    """Create measurement payload for API"""
    payload = {
        "deviceId": device_id,
        "temperature": temperature,
        "humidity": humidity,
        "recordedAt": recorded_at.isoformat() + "Z" if recorded_at else None,
        "payload": {
            "testType": "custom-measurement",
            "source": "manual-test",
            "description": description or f"Manual test: {temperature}°C at {recorded_at.strftime('%Y-%m-%d %H:%M:%S')}",
            "deviceInfo": {
                "platform": "Python-Test",
                "framework": "custom-sender",
                "version": "1.0.0"
            },
            "timestamp": recorded_at.isoformat() + "Z" if recorded_at else datetime.now().isoformat() + "Z"
        }
    }

    return payload

def send_measurement(api_url, payload, verbose=False):
    """Send measurement to API"""
    if verbose:
        print(f"📤 Sending to: {api_url}")
        print(f"📦 Payload:")
        print(json.dumps(payload, indent=2))
        print()

    try:
        headers = {
            'Content-Type': 'application/json',
            'User-Agent': f'Custom-Measurement-Sender/{payload["deviceId"]}'
        }

        response = requests.post(
            api_url,
            json=payload,
            headers=headers,
            timeout=30
        )

        print(f"📡 Response: HTTP {response.status_code}")

        if response.status_code == 201:
            print("✅ SUCCESS: Measurement sent successfully!")
            return True
        else:
            print(f"❌ FAILED: HTTP {response.status_code}")
            try:
                error_data = response.json()
                print(f"   Error details: {error_data}")
            except:
                print(f"   Response text: {response.text}")
            return False

    except requests.exceptions.Timeout:
        print("❌ FAILED: Request timeout")
        return False
    except requests.exceptions.ConnectionError:
        print("❌ FAILED: Connection error - check internet connection and API URL")
        return False
    except Exception as e:
        print(f"❌ FAILED: {e}")
        return False

def verify_sent_data(api_url, device_id, sent_time, verbose=False):
    """Verify that the data was successfully stored"""
    try:
        # Replace measurements endpoint with query endpoint
        query_url = api_url.replace('/measurements', '/measurements?limit=10')

        if verbose:
            print(f"🔍 Verifying data at: {query_url}")

        response = requests.get(query_url, timeout=10)

        if response.status_code == 200:
            data = response.json()
            measurements = data.get('data', [])

            # Look for our measurement
            for measurement in measurements:
                if (measurement.get('deviceId') == device_id and
                    measurement.get('temperature') is not None):

                    # Check if timestamp is close to our sent time (within 1 minute)
                    created_at = measurement.get('createdAt', '')
                    if created_at:
                        try:
                            created_time = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                            time_diff = abs((created_time - sent_time).total_seconds())
                            if time_diff < 60:  # Within 1 minute
                                print(f"✅ VERIFIED: Data found in database")
                                print(f"   Device ID: {measurement['deviceId']}")
                                print(f"   Temperature: {measurement['temperature']}°C")
                                print(f"   Humidity: {measurement.get('humidity', 'N/A')}%")
                                print(f"   Created at: {created_at}")
                                return True
                        except:
                            pass

            print("⚠️ WARNING: Sent measurement not found in recent data")
            if verbose:
                print(f"   Recent measurements from {device_id}:")
                device_measurements = [m for m in measurements if m.get('deviceId') == device_id]
                for m in device_measurements[:3]:
                    print(f"     - {m.get('temperature')}°C at {m.get('createdAt')}")
            return False
        else:
            print(f"⚠️ WARNING: Cannot verify data (HTTP {response.status_code})")
            return False

    except Exception as e:
        print(f"⚠️ WARNING: Verification failed: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(
        description="Send custom measurement data to M2R API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Time Format Examples:
  --time "now"                    # Current time
  --time "1 hour ago"             # 1 hour in the past
  --time "30 minutes ago"         # 30 minutes in the past
  --time "in 2 hours"             # 2 hours in the future
  --time "2025-09-29 14:30:00"    # Specific date and time
  --time "2025-09-29T05:15:00Z"   # ISO format with timezone
  --time "14:30:00"               # Today at 14:30:00
  --time "14:30"                  # Today at 14:30:00

Usage Examples:
  python3 send_custom_measurement.py --temp 25.5 --time "2025-09-29 14:30:00"
  python3 send_custom_measurement.py --temp 28.2 --humidity 65 --time "1 hour ago"
  python3 send_custom_measurement.py --temp 22.1 --time "now" --device "ESP32-Lab"
        """
    )

    parser.add_argument('--temp', '--temperature',
                       required=True,
                       help='Temperature value in Celsius (e.g., 25.5)')

    parser.add_argument('--time', '--datetime',
                       required=True,
                       help='Time when measurement was taken (various formats supported)')

    parser.add_argument('--humidity',
                       type=float,
                       default=DEFAULT_HUMIDITY,
                       help=f'Humidity percentage 0-100 (default: {DEFAULT_HUMIDITY})')

    parser.add_argument('--device', '--device-id',
                       default=DEFAULT_DEVICE_ID,
                       help=f'Device ID (default: {DEFAULT_DEVICE_ID})')

    parser.add_argument('--api-url',
                       default=DEFAULT_API_URL,
                       help=f'API endpoint URL (default: {DEFAULT_API_URL})')

    parser.add_argument('--description',
                       help='Custom description for the measurement')

    parser.add_argument('--verify',
                       action='store_true',
                       help='Verify that data was stored after sending')

    parser.add_argument('--verbose', '-v',
                       action='store_true',
                       help='Show detailed output including payload')

    args = parser.parse_args()

    try:
        # Parse and validate inputs
        print("🔧 Custom Measurement Data Sender")
        print("=" * 40)

        # Validate temperature
        temperature = validate_temperature(args.temp)
        print(f"🌡️  Temperature: {temperature}°C")

        # Validate humidity
        humidity = validate_humidity(str(args.humidity))
        print(f"💧 Humidity: {humidity}%")

        # Parse time
        recorded_at = parse_time_string(args.time)
        print(f"⏰ Recorded at: {recorded_at.strftime('%Y-%m-%d %H:%M:%S')}")

        print(f"📱 Device ID: {args.device}")
        print(f"🌐 API URL: {args.api_url}")

        if args.description:
            print(f"📝 Description: {args.description}")

        print()

        # Create payload
        payload = create_measurement_payload(
            device_id=args.device,
            temperature=temperature,
            humidity=humidity,
            recorded_at=recorded_at,
            description=args.description
        )

        # Send measurement
        success = send_measurement(args.api_url, payload, args.verbose)

        # Verify if requested
        if success and args.verify:
            print()
            verify_sent_data(args.api_url, args.device, recorded_at, args.verbose)

        # Show dashboard link
        if success:
            print()
            print("🎉 Check the dashboard to see your data:")
            print("   https://m2-r-24f40.web.app")
            print(f"   Look for device: {args.device}")

        sys.exit(0 if success else 1)

    except ValueError as e:
        print(f"❌ Input Error: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n🛑 Interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"💥 Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()