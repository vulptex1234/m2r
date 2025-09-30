#!/bin/bash
"""
Custom Measurement Data Sender (Shell Script Version)
Send measurement data with specific time and temperature to M2R API

Usage Examples:
  ./send_custom_measurement.sh --temp 25.5 --time "2025-09-29 14:30:00"
  ./send_custom_measurement.sh --temp 28.2 --humidity 65 --time "1 hour ago"
  ./send_custom_measurement.sh --temp 22.1 --time "now" --device "ESP32-Lab"
  ./send_custom_measurement.sh --temp 26.7 --time "2025-09-29T05:15:00Z"
"""

# Default configuration
DEFAULT_API_URL="https://m2r.onrender.com/api/raw-measurements"
DEFAULT_DEVICE_ID="ESP32-CUSTOM-TEST"
DEFAULT_HUMIDITY="60.0"
DEFAULT_DASHBOARD_URL="https://m2r-frontend.onrender.com"

# Function to show usage
show_usage() {
    cat << EOF
🔧 Custom Measurement Data Sender (Shell Version)

Usage: $0 --temp <temperature> --time <time> [options]

Required Arguments:
  --temp, --temperature <value>    Temperature in Celsius (e.g., 25.5)
  --time, --datetime <time>        Time when measurement was taken

Optional Arguments:
  --humidity <value>               Humidity percentage 0-100 (default: $DEFAULT_HUMIDITY)
  --device, --device-id <id>       Device ID (default: $DEFAULT_DEVICE_ID)
  --api-url <url>                  API endpoint URL (default: $DEFAULT_API_URL)
  --description <text>             Custom description for the measurement
  --verify                         Verify that data was stored after sending
  --verbose, -v                    Show detailed output including payload
  --help, -h                       Show this help message

Time Format Examples:
  --time "now"                     # Current time (ISO format)
  --time "2025-09-29 14:30:00"     # Specific date and time
  --time "2025-09-29T05:15:00Z"    # ISO format with timezone
  --time "14:30:00"                # Today at 14:30:00 (will be converted to ISO)

Note: For relative times like "1 hour ago", please calculate manually or use:
  --time "\$(date -d '1 hour ago' -Iseconds)"

Examples:
  $0 --temp 25.5 --time "2025-09-29 14:30:00"
  $0 --temp 28.2 --humidity 65 --time "2025-09-29T05:15:00Z"
  $0 --temp 22.1 --time "now" --device "ESP32-Lab" --verify
  $0 --temp 26.7 --time "\$(date -Iseconds)" --verbose

EOF
}

# Function to log messages
log() {
    echo "$1"
}

# Function to get current timestamp in ISO format
get_current_iso_time() {
    if command -v gdate >/dev/null 2>&1; then
        # macOS with GNU date (brew install coreutils)
        gdate -Iseconds
    elif date --version >/dev/null 2>&1; then
        # GNU date (Linux)
        date -Iseconds
    else
        # macOS/BSD date
        date -u +"%Y-%m-%dT%H:%M:%SZ"
    fi
}

# Function to convert time string to ISO format
convert_time_to_iso() {
    local time_str="$1"

    if [[ "$time_str" == "now" ]]; then
        get_current_iso_time
        return 0
    fi

    # Check if already in ISO format
    if [[ "$time_str" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:[0-9]{2})$ ]]; then
        echo "$time_str"
        return 0
    fi

    # Try to convert YYYY-MM-DD HH:MM:SS to ISO
    if [[ "$time_str" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}$ ]]; then
        echo "${time_str}Z" | tr ' ' 'T'
        return 0
    fi

    # Try to convert HH:MM:SS (today) to ISO
    if [[ "$time_str" =~ ^[0-9]{2}:[0-9]{2}:[0-9]{2}$ ]]; then
        local today=$(date +"%Y-%m-%d")
        echo "${today}T${time_str}Z"
        return 0
    fi

    # Try to convert HH:MM (today) to ISO
    if [[ "$time_str" =~ ^[0-9]{2}:[0-9]{2}$ ]]; then
        local today=$(date +"%Y-%m-%d")
        echo "${today}T${time_str}:00Z"
        return 0
    fi

    # If we can't convert, return as-is and let the server handle it
    echo "$time_str"
}

# Function to validate temperature
validate_temperature() {
    local temp="$1"

    # Check if it's a valid number
    if ! [[ "$temp" =~ ^-?[0-9]+\.?[0-9]*$ ]]; then
        echo "❌ Invalid temperature value: '$temp'. Must be a number." >&2
        return 1
    fi

    # Check range (optional warning)
    if (( $(echo "$temp < -50" | bc -l) )) || (( $(echo "$temp > 80" | bc -l) )); then
        echo "⚠️ Warning: Temperature ${temp}°C is outside typical range (-50°C to 80°C)" >&2
    fi

    return 0
}

# Function to validate humidity
validate_humidity() {
    local humidity="$1"

    # Check if it's a valid number
    if ! [[ "$humidity" =~ ^[0-9]+\.?[0-9]*$ ]]; then
        echo "❌ Invalid humidity value: '$humidity'. Must be a number." >&2
        return 1
    fi

    # Check range
    if (( $(echo "$humidity < 0" | bc -l) )) || (( $(echo "$humidity > 100" | bc -l) )); then
        echo "❌ Humidity must be between 0 and 100%. Got: ${humidity}%" >&2
        return 1
    fi

    return 0
}

# Function to create JSON payload
create_payload() {
    local device_id="$1"
    local temperature="$2"
    local humidity="$3"
    local recorded_at="$4"
    local description="$5"

    local default_desc="Manual test: ${temperature}°C at $(date '+%Y-%m-%d %H:%M:%S')"
    description="${description:-$default_desc}"

    cat << EOF
{
  "deviceId": "$device_id",
  "temperature": $temperature,
  "humidity": $humidity,
  "recordedAt": "$recorded_at",
  "payload": {
    "testType": "custom-measurement",
    "source": "manual-shell-test",
    "description": "$description",
    "deviceInfo": {
      "platform": "Shell-Script",
      "framework": "bash-curl",
      "version": "1.0.0"
    },
    "timestamp": "$recorded_at"
  }
}
EOF
}

# Function to send measurement
send_measurement() {
    local api_url="$1"
    local payload="$2"
    local verbose="$3"

    if [[ "$verbose" == "true" ]]; then
        log "📤 Sending to: $api_url"
        log "📦 Payload:"
        echo "$payload" | jq . 2>/dev/null || echo "$payload"
        log ""
    fi

    local response
    local http_code

    # Send request and capture response
    response=$(curl -s -w "\n%{http_code}" \
        -X POST "$api_url" \
        -H "Content-Type: application/json" \
        -H "User-Agent: Custom-Measurement-Sender-Shell" \
        -d "$payload")

    # Extract HTTP code from last line
    http_code=$(echo "$response" | tail -n 1)
    local response_body=$(echo "$response" | head -n -1)

    log "📡 Response: HTTP $http_code"

    if [[ "$http_code" == "201" ]]; then
        log "✅ SUCCESS: Measurement sent successfully!"
        return 0
    else
        log "❌ FAILED: HTTP $http_code"
        if [[ -n "$response_body" ]]; then
            log "   Response: $response_body"
        fi
        return 1
    fi
}

# Function to verify sent data
verify_sent_data() {
    local api_url="$1"
    local device_id="$2"
    local verbose="$3"

    local base_url="${api_url%/*}"
    local query_url="${base_url}/processed-measurements?limit=10"

    if [[ "$verbose" == "true" ]]; then
        log "🔍 Verifying data at: $query_url"
    fi

    local response
    response=$(curl -s "$query_url")

    if echo "$response" | jq -e '.data[]' >/dev/null 2>&1; then
        # Check if our device has recent data
        local found
        found=$(echo "$response" | jq -r --arg device "$device_id" \
            '.data[] | select(.nodeId == $device or .deviceId == $device) | .nodeId' | head -1)

        if [[ -n "$found" ]]; then
            log "✅ VERIFIED: Data found for device $device_id"
            if [[ "$verbose" == "true" ]]; then
                echo "$response" | jq -r --arg device "$device_id" \
                    '.data[] | select(.nodeId == $device or .deviceId == $device) |
                     "   Observed: \(.observedC // .temperature)°C, Forecast: \(.forecastC // "--")°C, Recorded: \(.recordedAt // .createdAt)"' | head -3
            fi
            return 0
        else
            log "⚠️ WARNING: No recent data found for device $device_id"
            return 1
        fi
    else
        log "⚠️ WARNING: Cannot verify data (invalid response)"
        return 1
    fi
}

# Parse command line arguments
TEMP=""
TIME=""
HUMIDITY="$DEFAULT_HUMIDITY"
DEVICE_ID="$DEFAULT_DEVICE_ID"
API_URL="$DEFAULT_API_URL"
DESCRIPTION=""
VERIFY="false"
VERBOSE="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        --temp|--temperature)
            TEMP="$2"
            shift 2
            ;;
        --time|--datetime)
            TIME="$2"
            shift 2
            ;;
        --humidity)
            HUMIDITY="$2"
            shift 2
            ;;
        --device|--device-id)
            DEVICE_ID="$2"
            shift 2
            ;;
        --api-url)
            API_URL="$2"
            shift 2
            ;;
        --description)
            DESCRIPTION="$2"
            shift 2
            ;;
        --verify)
            VERIFY="true"
            shift
            ;;
        --verbose|-v)
            VERBOSE="true"
            shift
            ;;
        --help|-h)
            show_usage
            exit 0
            ;;
        *)
            echo "❌ Unknown option: $1" >&2
            echo "Use --help for usage information" >&2
            exit 1
            ;;
    esac
done

# Validate required arguments
if [[ -z "$TEMP" ]]; then
    echo "❌ Error: Temperature is required (--temp)" >&2
    echo "Use --help for usage information" >&2
    exit 1
fi

if [[ -z "$TIME" ]]; then
    echo "❌ Error: Time is required (--time)" >&2
    echo "Use --help for usage information" >&2
    exit 1
fi

# Main execution
main() {
    log "🔧 Custom Measurement Data Sender (Shell Version)"
    log "=========================================="

    # Validate temperature
    if ! validate_temperature "$TEMP"; then
        exit 1
    fi
    log "🌡️  Temperature: ${TEMP}°C"

    # Validate humidity
    if ! validate_humidity "$HUMIDITY"; then
        exit 1
    fi
    log "💧 Humidity: ${HUMIDITY}%"

    # Convert time to ISO format
    local iso_time
    iso_time=$(convert_time_to_iso "$TIME")
    log "⏰ Recorded at: $iso_time"

    log "📱 Device ID: $DEVICE_ID"
    log "🌐 API URL: $API_URL"

    if [[ -n "$DESCRIPTION" ]]; then
        log "📝 Description: $DESCRIPTION"
    fi

    log ""

    # Create payload
    local payload
    payload=$(create_payload "$DEVICE_ID" "$TEMP" "$HUMIDITY" "$iso_time" "$DESCRIPTION")

    # Send measurement
    if send_measurement "$API_URL" "$payload" "$VERBOSE"; then
        # Verify if requested
        if [[ "$VERIFY" == "true" ]]; then
            log ""
            verify_sent_data "$API_URL" "$DEVICE_ID" "$VERBOSE"
        fi

        # Show dashboard link
        log ""
        log "🎉 Check the dashboard to see your data:"
        log "   ${DEFAULT_DASHBOARD_URL}"
        log "   Look for device: $DEVICE_ID"

        exit 0
    else
        exit 1
    fi
}

# Check for required tools
if ! command -v curl >/dev/null 2>&1; then
    echo "❌ Error: curl is required but not installed" >&2
    exit 1
fi

if ! command -v bc >/dev/null 2>&1; then
    echo "❌ Error: bc is required but not installed" >&2
    exit 1
fi

# Run main function
main
