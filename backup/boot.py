from machine import SoftI2C, Pin
import bmp280
from ina219 import INA219
from logging import INFO
import os
import time

temp_f = "temp.csv"
elect_f = "elect.csv"

# Initialize the I2C bus and BME280 sensor
i2c = SoftI2C(scl=Pin(22), sda=Pin(21))
bmp_sensor = bmp280.BME280(i2c)

SHUNT_OHMS = 0.1  # Check value of shunt used with your INA219
ina = INA219(SHUNT_OHMS, i2c, log_level=INFO)
ina.configure()

blue = Pin(2, Pin.OUT)

while(True):
    blue.value(0)
    try:
      # Read sensor data
      bmp_sensor.read()

      # Print temperature, pressure, and humidity
      with open(temp_f, "a") as f:
          f.write(f"{bmp_sensor.temperature}\n")

    except Exception as e:
        print(f"An error occurred: {e}")
  

    with open(elect_f, "a") as f:
        f.write(f"{ina.voltage()}, {ina.current()}, {ina.power()}\n")
    
    blue.value(1)    
    time.sleep(300)
    