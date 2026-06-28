"""
Register OneCore Voices for SAPI5/pyttsx3

This script copies the OneCore voice registry entries to the standard
SAPI5 location so that pyttsx3 and other SAPI5 applications can use them.

Run this script AS ADMINISTRATOR once to enable all 6 voices:
- Microsoft David (US Male)
- Microsoft Zira (US Female)  
- Microsoft Mark (US Male)
- Microsoft Hazel (UK Female)
- Microsoft George (UK Male)
- Microsoft Susan (UK Female)

Usage:
    Run as Administrator:
    python register_onecore_voices.py
"""

import winreg
import sys
import ctypes

def is_admin():
    """Check if running with admin privileges."""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False

def copy_registry_key(src_key, src_path, dst_key, dst_path):
    """Recursively copy a registry key and all its values/subkeys."""
    try:
        # Open source
        src = winreg.OpenKey(src_key, src_path, 0, winreg.KEY_READ)
        
        # Create destination
        try:
            dst = winreg.OpenKey(dst_key, dst_path, 0, winreg.KEY_WRITE | winreg.KEY_READ)
        except FileNotFoundError:
            dst = winreg.CreateKey(dst_key, dst_path)
        
        # Copy values
        i = 0
        while True:
            try:
                name, value, vtype = winreg.EnumValue(src, i)
                winreg.SetValueEx(dst, name, 0, vtype, value)
                i += 1
            except OSError:
                break
        
        # Copy subkeys
        i = 0
        while True:
            try:
                subkey_name = winreg.EnumKey(src, i)
                copy_registry_key(
                    src_key, f"{src_path}\\{subkey_name}",
                    dst_key, f"{dst_path}\\{subkey_name}"
                )
                i += 1
            except OSError:
                break
        
        winreg.CloseKey(src)
        winreg.CloseKey(dst)
        return True
        
    except Exception as e:
        print(f"  Error copying {src_path}: {e}")
        return False

def register_onecore_voices():
    """Copy OneCore voice tokens to standard SAPI location."""
    
    onecore_base = r"SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens"
    sapi_base = r"SOFTWARE\Microsoft\Speech\Voices\Tokens"
    
    # Voices to copy (OneCore name -> SAPI name)
    voices = {
        "MSTTS_V110_enGB_GeorgeM": "TTS_MS_EN-GB_GEORGE_11.0",
        "MSTTS_V110_enGB_HazelM": "TTS_MS_EN-GB_HAZEL_11.0",
        "MSTTS_V110_enGB_SusanM": "TTS_MS_EN-GB_SUSAN_11.0",
        "MSTTS_V110_enUS_DavidM": "TTS_MS_EN-US_DAVID_11.0",
        "MSTTS_V110_enUS_MarkM": "TTS_MS_EN-US_MARK_11.0",
        "MSTTS_V110_enUS_ZiraM": "TTS_MS_EN-US_ZIRA_11.0",
    }
    
    print("Registering OneCore voices for SAPI5...")
    print()
    
    registered = 0
    skipped = 0
    failed = 0
    
    for onecore_name, sapi_name in voices.items():
        src_path = f"{onecore_base}\\{onecore_name}"
        dst_path = f"{sapi_base}\\{sapi_name}"
        
        # Check if already exists
        try:
            existing = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, dst_path, 0, winreg.KEY_READ)
            winreg.CloseKey(existing)
            print(f"  [SKIP] {sapi_name} - already registered")
            skipped += 1
            continue
        except FileNotFoundError:
            pass
        
        # Check if source exists
        try:
            src = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, src_path, 0, winreg.KEY_READ)
            winreg.CloseKey(src)
        except FileNotFoundError:
            print(f"  [SKIP] {onecore_name} - not installed")
            skipped += 1
            continue
        
        # Copy the voice
        print(f"  Copying {onecore_name} -> {sapi_name}...")
        if copy_registry_key(
            winreg.HKEY_LOCAL_MACHINE, src_path,
            winreg.HKEY_LOCAL_MACHINE, dst_path
        ):
            print(f"  [OK] {sapi_name} registered")
            registered += 1
        else:
            print(f"  [FAIL] {sapi_name}")
            failed += 1
    
    print()
    print(f"Done! Registered: {registered}, Skipped: {skipped}, Failed: {failed}")
    
    if registered > 0:
        print()
        print("New voices should now be available in pyttsx3 and other SAPI5 apps.")
        print("You may need to restart your Python applications to see them.")

def main():
    print("=" * 60)
    print("OneCore Voice Registration for SAPI5")
    print("=" * 60)
    print()
    
    if not is_admin():
        print("ERROR: This script must be run as Administrator!")
        print()
        print("Right-click on Command Prompt or PowerShell and select")
        print("'Run as administrator', then run this script again.")
        print()
        input("Press Enter to exit...")
        sys.exit(1)
    
    register_onecore_voices()
    print()
    input("Press Enter to exit...")

if __name__ == "__main__":
    main()
