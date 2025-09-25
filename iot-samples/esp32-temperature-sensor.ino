/*
 * ESP32 Temperature Sensor for Firebase IoT System
 *
 * This code sends temperature readings directly to Firestore
 * Compatible with the client-side processing system
 *
 * Required Libraries:
 * - WiFi
 * - HTTPClient
 * - ArduinoJson (v6.x)
 * - OneWire (for DS18B20)
 * - DallasTemperature (for DS18B20)
 *
 * Hardware:
 * - ESP32 DevKit
 * - DS18B20 temperature sensor
 * - 4.7kΩ pull-up resistor
 *
 * Connections:
 * - DS18B20 VDD -> 3.3V
 * - DS18B20 GND -> GND
 * - DS18B20 DATA -> GPIO 4 (with 4.7kΩ pull-up to 3.3V)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ========== Configuration ==========
// WiFi credentials
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Firebase project configuration
const char* PROJECT_ID = "m2-r-24f40";
const char* API_KEY = "AIzaSyAwZVmiypeiZEWPepxGbIGeJdZNjX1aez8";

// Device configuration
const char* NODE_ID = "esp32-001";           // Unique node identifier
const int MEASUREMENT_INTERVAL = 30000;     // 30 seconds
const int TEMP_SENSOR_PIN = 4;               // DS18B20 data pin

// Temperature sensor setup
OneWire oneWire(TEMP_SENSOR_PIN);
DallasTemperature tempSensor(&oneWire);

// System variables
float batteryVoltage = 3.7;  // Simulated battery voltage
unsigned long lastMeasurement = 0;
int measurementCount = 0;
bool isConnected = false;

// ========== Setup Function ==========
void setup() {
  Serial.begin(115200);
  Serial.println("\n🌡️ ESP32 Temperature Sensor Starting...");

  // Initialize temperature sensor
  tempSensor.begin();
  tempSensor.setResolution(12);  // 12-bit resolution (0.0625°C)

  // Connect to WiFi
  connectToWiFi();

  Serial.println("✅ Setup complete!");
  Serial.printf("📡 Node ID: %s\n", NODE_ID);
  Serial.printf("⏱️  Measurement interval: %d seconds\n", MEASUREMENT_INTERVAL / 1000);
}

// ========== Main Loop ==========
void loop() {
  // Check WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ WiFi disconnected, reconnecting...");
    connectToWiFi();
    return;
  }

  // Check if it's time for measurement
  unsigned long currentTime = millis();
  if (currentTime - lastMeasurement >= MEASUREMENT_INTERVAL) {
    lastMeasurement = currentTime;

    // Take temperature measurement
    float temperature = readTemperature();

    if (temperature != DEVICE_DISCONNECTED_C) {
      // Send measurement to Firestore
      sendMeasurement(temperature);

      // Update battery simulation (slowly decreasing)
      batteryVoltage -= 0.001;
      if (batteryVoltage < 3.0) {
        batteryVoltage = 3.7;  // Reset for simulation
      }

      measurementCount++;
    } else {
      Serial.println("❌ Temperature sensor error");
    }
  }

  // Small delay to prevent watchdog issues
  delay(100);
}

// ========== WiFi Connection ==========
void connectToWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("🔗 Connecting to WiFi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("");
    Serial.printf("✅ Connected to %s\n", WIFI_SSID);
    Serial.printf("📶 IP Address: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("📶 Signal Strength: %d dBm\n", WiFi.RSSI());
    isConnected = true;
  } else {
    Serial.println("");
    Serial.println("❌ WiFi connection failed!");
    isConnected = false;
  }
}

// ========== Temperature Reading ==========
float readTemperature() {
  tempSensor.requestTemperatures();
  float temperature = tempSensor.getTempCByIndex(0);

  if (temperature != DEVICE_DISCONNECTED_C) {
    Serial.printf("🌡️  Temperature: %.2f°C\n", temperature);
  }

  return temperature;
}

// ========== Send Measurement to Firestore ==========
void sendMeasurement(float temperature) {
  if (!isConnected) {
    Serial.println("❌ Not connected to WiFi, skipping measurement");
    return;
  }

  HTTPClient http;

  // Firestore REST API endpoint for adding documents
  String url = "https://firestore.googleapis.com/v1/projects/" + String(PROJECT_ID) +
               "/databases/(default)/documents/rawMeasurements?key=" + String(API_KEY);

  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  // Create JSON payload
  DynamicJsonDocument doc(1024);
  JsonObject fields = doc.createNestedObject("fields");

  // Node ID
  JsonObject nodeIdField = fields.createNestedObject("nodeId");
  nodeIdField["stringValue"] = NODE_ID;

  // Observed temperature
  JsonObject observedCField = fields.createNestedObject("observedC");
  observedCField["doubleValue"] = temperature;

  // Battery voltage
  JsonObject batteryVField = fields.createNestedObject("batteryV");
  batteryVField["doubleValue"] = batteryVoltage;

  // Timestamp (ISO 8601 format)
  JsonObject timestampField = fields.createNestedObject("timestamp");
  timestampField["timestampValue"] = getCurrentTimestamp();

  // Device info
  JsonObject deviceInfoField = fields.createNestedObject("deviceInfo");
  JsonObject deviceInfoValue = deviceInfoField.createNestedObject("mapValue");
  JsonObject deviceFields = deviceInfoValue.createNestedObject("fields");

  JsonObject firmwareField = deviceFields.createNestedObject("firmware");
  firmwareField["stringValue"] = "ESP32_v1.0.0";

  JsonObject rssiField = deviceFields.createNestedObject("rssi");
  rssiField["integerValue"] = WiFi.RSSI();

  JsonObject uptimeField = deviceFields.createNestedObject("uptime");
  uptimeField["integerValue"] = millis();

  // Convert to string
  String payload;
  serializeJson(doc, payload);

  Serial.println("📤 Sending measurement to Firestore...");

  // Send HTTP POST request
  int httpResponseCode = http.POST(payload);

  if (httpResponseCode > 0) {
    String response = http.getString();

    if (httpResponseCode == 200) {
      Serial.printf("✅ Measurement sent successfully (Code: %d)\n", httpResponseCode);
      Serial.printf("📊 Total measurements: %d\n", measurementCount);

      // Parse response to get document ID (optional)
      DynamicJsonDocument responseDoc(1024);
      deserializeJson(responseDoc, response);
      if (responseDoc["name"]) {
        String docPath = responseDoc["name"];
        String docId = docPath.substring(docPath.lastIndexOf('/') + 1);
        Serial.printf("📄 Document ID: %s\n", docId.c_str());
      }

    } else {
      Serial.printf("⚠️ Server responded with code: %d\n", httpResponseCode);
      Serial.printf("📄 Response: %s\n", response.c_str());
    }
  } else {
    Serial.printf("❌ HTTP request failed with error: %d\n", httpResponseCode);
    Serial.printf("📄 Error: %s\n", http.errorToString(httpResponseCode).c_str());
  }

  http.end();
}

// ========== Get Current Timestamp ==========
String getCurrentTimestamp() {
  // Note: For production use, you should sync with NTP server
  // This is a simplified version using millis()

  unsigned long epochTime = 1672531200 + (millis() / 1000); // Approx timestamp (Jan 1, 2023 + uptime)

  // Convert to ISO 8601 format (simplified)
  // In production, use proper time library
  return String(epochTime) + ".000Z";
}

// ========== Utility Functions ==========

// Check system health
void printSystemStatus() {
  Serial.println("\n📊 === System Status ===");
  Serial.printf("📶 WiFi: %s (RSSI: %d dBm)\n",
                WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected",
                WiFi.RSSI());
  Serial.printf("🔋 Battery: %.2fV\n", batteryVoltage);
  Serial.printf("⏱️  Uptime: %lu seconds\n", millis() / 1000);
  Serial.printf("📊 Measurements sent: %d\n", measurementCount);
  Serial.printf("🆔 Node ID: %s\n", NODE_ID);
  Serial.println("========================\n");
}

// Handle serial commands (for debugging)
void handleSerialInput() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();

    if (command == "status") {
      printSystemStatus();
    } else if (command == "measure") {
      float temp = readTemperature();
      if (temp != DEVICE_DISCONNECTED_C) {
        sendMeasurement(temp);
      }
    } else if (command == "reset") {
      ESP.restart();
    } else if (command == "help") {
      Serial.println("\n📚 Available commands:");
      Serial.println("  status  - Show system status");
      Serial.println("  measure - Take immediate measurement");
      Serial.println("  reset   - Restart device");
      Serial.println("  help    - Show this help");
    }
  }
}

// ========== Error Handling ==========

// Watchdog timer reset (called periodically)
void feedWatchdog() {
  // ESP32 has built-in watchdog, but you can add custom logic here
  static unsigned long lastFeed = 0;
  if (millis() - lastFeed > 10000) {  // Feed every 10 seconds
    lastFeed = millis();
    Serial.println("🐕 Feeding watchdog...");
  }
}

// Handle system errors
void handleError(const char* errorMessage) {
  Serial.printf("❌ ERROR: %s\n", errorMessage);

  // Optionally, send error to logging service
  // For now, just print and continue

  // Could implement error recovery logic here
  // e.g., restart WiFi, reset sensors, etc.
}

/*
 * ========== Installation Instructions ==========
 *
 * 1. Install Arduino IDE and ESP32 board package
 * 2. Install required libraries through Library Manager:
 *    - ArduinoJson by Benoit Blanchon
 *    - OneWire by Jim Studt
 *    - DallasTemperature by Miles Burton
 *
 * 3. Update configuration:
 *    - Set your WiFi credentials
 *    - Update NODE_ID to be unique for each device
 *    - Verify PROJECT_ID and API_KEY match your Firebase project
 *
 * 4. Hardware setup:
 *    - Connect DS18B20 temperature sensor to GPIO 4
 *    - Add 4.7kΩ pull-up resistor between data line and 3.3V
 *
 * 5. Upload code to ESP32
 *
 * 6. Open Serial Monitor (115200 baud) to see status messages
 *
 * 7. Verify data appears in Firebase console under:
 *    Firestore Database > rawMeasurements collection
 *
 * ========== Troubleshooting ==========
 *
 * - If WiFi won't connect: Check SSID/password, ensure 2.4GHz network
 * - If Firestore requests fail: Verify API key and project ID
 * - If temperature reads -127°C: Check sensor wiring and pull-up resistor
 * - If device resets frequently: Check power supply stability
 *
 * ========== Security Notes ==========
 *
 * For production deployment:
 * - Use Firebase App Check for additional security
 * - Implement proper certificate validation
 * - Store sensitive credentials in secure storage
 * - Set up proper Firestore security rules
 */