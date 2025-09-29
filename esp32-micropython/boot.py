"""
ESP32 Weather Station Boot Script
Automatically starts the weather station when ESP32 powers on

This file runs automatically when the ESP32 starts up.
It performs initial setup and then launches the main program.
"""

import machine
import utime as time
import gc

# Boot configuration
AUTO_START_MAIN = True      # Set to False to disable auto-start
BOOT_DELAY = 3              # Delay before starting main program (seconds)
ENABLE_SAFE_MODE = True     # Enable safe mode for debugging

def log_boot(message):
    """Print boot log message"""
    print(f"[BOOT] {message}")

def blink_boot_led():
    """Quick boot indication"""
    try:
        led = machine.Pin(2, machine.Pin.OUT)
        led.on()
        time.sleep_ms(100)
        led.off()
    except:
        pass

def check_safe_mode():
    """Check if safe mode is requested (optional feature)"""
    # You can implement safe mode trigger here
    # For example, check if a specific GPIO pin is pulled low
    # or if a file exists, etc.

    # Example: Check GPIO0 (boot button) for safe mode
    try:
        boot_pin = machine.Pin(0, machine.Pin.IN, machine.Pin.PULL_UP)
        if not boot_pin.value():  # Button pressed during boot
            return True
    except:
        pass

    return False

def main_boot_sequence():
    """Main boot sequence"""
    log_boot("ESP32 Weather Station Boot v1.0.0")

    # Boot LED indication
    blink_boot_led()

    # Show system information
    log_boot(f"MicroPython version: {machine.info()}")
    log_boot(f"Free memory: {gc.mem_free()} bytes")
    log_boot(f"Reset cause: {machine.reset_cause()}")

    # Check for safe mode
    if ENABLE_SAFE_MODE and check_safe_mode():
        log_boot("🛡️ SAFE MODE DETECTED - Main program will NOT auto-start")
        log_boot("   To start manually: import main")
        log_boot("   To exit safe mode: machine.reset()")
        return False

    # Check configuration
    try:
        import config
        errors = config.validate_config()
        if errors:
            log_boot("⚠️ Configuration issues detected:")
            for error in errors:
                log_boot(f"   {error}")
            if "❌" in str(errors):  # Critical errors
                log_boot("❌ Critical configuration errors - stopping auto-start")
                log_boot("   Please fix config.py and restart")
                return False
    except ImportError:
        log_boot("❌ config.py not found - stopping auto-start")
        return False
    except Exception as e:
        log_boot(f"❌ Configuration error: {e}")
        return False

    # Boot delay countdown
    if BOOT_DELAY > 0:
        log_boot(f"⏳ Starting main program in {BOOT_DELAY} seconds...")
        log_boot("   Press Ctrl+C to interrupt")

        try:
            for i in range(BOOT_DELAY, 0, -1):
                print(f"   {i}...")
                time.sleep(1)
        except KeyboardInterrupt:
            log_boot("🛑 Boot interrupted by user")
            log_boot("   To start manually: import main")
            return False

    return True

def start_main_program():
    """Start the main weather station program"""
    try:
        log_boot("🚀 Starting main weather station program...")

        # Import and run main program
        import main

    except KeyboardInterrupt:
        log_boot("🛑 Main program interrupted during startup")
    except ImportError as e:
        log_boot(f"❌ Failed to import main program: {e}")
        log_boot("   Make sure main.py is uploaded to the ESP32")
    except Exception as e:
        log_boot(f"❌ Unexpected error starting main program: {e}")
        log_boot("   Check main.py for syntax errors")

# ========== BOOT EXECUTION ==========
if __name__ == "__main__":
    try:
        # Run boot sequence
        if main_boot_sequence():
            if AUTO_START_MAIN:
                start_main_program()
            else:
                log_boot("ℹ️ Auto-start disabled - run 'import main' to start manually")
        else:
            log_boot("ℹ️ Main program not started due to boot checks")

    except KeyboardInterrupt:
        log_boot("🛑 Boot sequence interrupted")
    except Exception as e:
        log_boot(f"💥 Boot sequence failed: {e}")
    finally:
        log_boot("✅ Boot sequence complete")

# Always show manual start instructions
print()
print("=" * 50)
print("ESP32 Weather Station Boot Complete")
print("=" * 50)
print("Manual commands:")
print("  import main           # Start weather station")
print("  import config         # Check configuration")
print("  machine.reset()       # Restart ESP32")
print("  help()                # MicroPython help")
print("=" * 50)