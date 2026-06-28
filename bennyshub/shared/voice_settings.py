"""
Voice Settings Reader for Python Apps

This module reads the shared voice settings file that is written by the
Electron app's NarbeVoiceManager. External Python apps (messenger, search)
can use this to sync their TTS voice with the hub.

Usage:
    from voice_settings import get_voice_settings, get_pyttsx3_voice_id
    
    settings = get_voice_settings()
    voice_id = get_pyttsx3_voice_id()  # Returns matching pyttsx3 voice ID
"""

import json
import os
import winreg
from pathlib import Path

# Path to the shared voice settings file
SETTINGS_FILE = Path(__file__).parent / 'voice-settings.json'

DEFAULT_SETTINGS = {
    'ttsEnabled': True,
    'voiceIndex': 0,
    'voiceName': None,
    'rate': 1.0,
    'pitch': 1.0,
    'volume': 1.0
}

# OneCore voice registry tokens (Windows 10/11 voices)
ONECORE_VOICES = {
    'george': r'HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enGB_GeorgeM',
    'hazel': r'HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enGB_HazelM',
    'susan': r'HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enGB_SusanM',
    'david': r'HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_DavidM',
    'mark': r'HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_MarkM',
    'zira': r'HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_ZiraM',
}


def _register_onecore_voices():
    """
    Copy OneCore voices to the SAPI5 registry location so pyttsx3 can see them.
    This only needs to be done once, but we check each time to be safe.
    """
    try:
        onecore_path = r'SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens'
        sapi_path = r'SOFTWARE\Microsoft\Speech\Voices\Tokens'
        
        # Open OneCore voices
        onecore_key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, onecore_path, 0, winreg.KEY_READ)
        
        # We need to write to SAPI location - try HKLM first, fall back to HKCU
        try:
            sapi_key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, sapi_path, 0, winreg.KEY_WRITE | winreg.KEY_READ)
            use_hklm = True
        except PermissionError:
            # No admin rights, use HKCU instead
            sapi_path_cu = r'SOFTWARE\Microsoft\Speech\Voices\Tokens'
            try:
                sapi_key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, sapi_path_cu, 0, winreg.KEY_WRITE | winreg.KEY_READ)
            except FileNotFoundError:
                winreg.CreateKey(winreg.HKEY_CURRENT_USER, sapi_path_cu)
                sapi_key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, sapi_path_cu, 0, winreg.KEY_WRITE | winreg.KEY_READ)
            use_hklm = False
        
        # List OneCore voices
        i = 0
        while True:
            try:
                voice_name = winreg.EnumKey(onecore_key, i)
                i += 1
                
                # Check if already exists in SAPI
                try:
                    existing = winreg.OpenKey(sapi_key, voice_name, 0, winreg.KEY_READ)
                    winreg.CloseKey(existing)
                    continue  # Already registered
                except FileNotFoundError:
                    pass  # Need to register
                
                # This voice isn't in SAPI yet - we can't easily copy registry keys
                # without admin rights, so we'll just note it exists
                
            except OSError:
                break  # No more keys
        
        winreg.CloseKey(onecore_key)
        winreg.CloseKey(sapi_key)
        
    except Exception as e:
        # Silently fail - OneCore registration is optional
        pass


def get_all_voices(engine=None):
    """
    Get all available voices, including both SAPI5 Desktop and OneCore voices.
    Returns a list of voice objects/dicts.
    """
    voices = []
    
    # Get pyttsx3 voices first
    if engine:
        voices = list(engine.getProperty('voices'))
    else:
        try:
            import pyttsx3
            e = pyttsx3.init()
            voices = list(e.getProperty('voices'))
        except:
            pass
    
    return voices


def get_voice_settings() -> dict:
    """
    Load voice settings from the shared JSON file.
    Returns default settings if file doesn't exist or is invalid.
    """
    try:
        if SETTINGS_FILE.exists():
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                settings = json.load(f)
                return {**DEFAULT_SETTINGS, **settings}
    except Exception as e:
        print(f"[voice_settings] Error loading settings: {e}")
    
    return DEFAULT_SETTINGS.copy()


def get_pyttsx3_voice_id(engine=None) -> str:
    """
    Get the pyttsx3 voice ID that matches the saved voice name.
    
    The browser's Web Speech API has different voices than pyttsx3.
    We try to find the best match based on name similarity.
    Uses OneCore voice registry paths for voices not in SAPI5.
    
    Args:
        engine: Optional pyttsx3 engine instance. If not provided, creates one.
    
    Returns:
        Voice ID string for pyttsx3, or None if no match found.
    """
    settings = get_voice_settings()
    voice_name = settings.get('voiceName', '')
    
    try:
        import pyttsx3
        
        # Use provided engine or create temporary one
        if engine is None:
            engine = pyttsx3.init()
        
        voices = engine.getProperty('voices')
        if not voices:
            return None
        
        # Extract the person name from the voice setting
        # e.g., "Microsoft George - English (United Kingdom)" -> "george"
        person_name = None
        if voice_name:
            voice_name_lower = voice_name.lower()
            if 'microsoft' in voice_name_lower:
                parts = voice_name.split()
                if len(parts) >= 2:
                    person_name = parts[1].lower()
        
        # First, try to find the voice in pyttsx3's available voices
        if person_name:
            for voice in voices:
                if person_name in voice.name.lower():
                    print(f"[voice_settings] Found in pyttsx3: {voice.name}")
                    return voice.id
        
        # If not found in pyttsx3, try using the OneCore registry path directly
        # This works because pyttsx3/SAPI can use the full registry path
        if person_name and person_name in ONECORE_VOICES:
            onecore_id = ONECORE_VOICES[person_name]
            print(f"[voice_settings] Using OneCore voice: {person_name} -> {onecore_id}")
            return onecore_id
        
        # Try exact match by full name
        if voice_name:
            for voice in voices:
                if voice.name == voice_name:
                    print(f"[voice_settings] Exact match: {voice.name}")
                    return voice.id
        
        # Fallback: Try to match by region
        if voice_name:
            voice_name_lower = voice_name.lower()
            is_uk = 'kingdom' in voice_name_lower or 'britain' in voice_name_lower or '(uk)' in voice_name_lower
            is_us = 'states' in voice_name_lower or '(us)' in voice_name_lower
            
            if is_uk:
                # Try OneCore Hazel for UK, then check pyttsx3
                if 'hazel' in ONECORE_VOICES:
                    for voice in voices:
                        if 'hazel' in voice.name.lower():
                            print(f"[voice_settings] UK fallback: {voice.name}")
                            return voice.id
                    # Use OneCore path
                    print(f"[voice_settings] UK OneCore fallback: hazel")
                    return ONECORE_VOICES['hazel']
            elif is_us:
                for voice in voices:
                    if 'david' in voice.name.lower():
                        print(f"[voice_settings] US fallback: {voice.name}")
                        return voice.id
        
        # Last resort: use voice index or first voice
        voice_index = settings.get('voiceIndex', 0)
        if 0 <= voice_index < len(voices):
            print(f"[voice_settings] Using index {voice_index}: {voices[voice_index].name}")
            return voices[voice_index].id
        
        print(f"[voice_settings] Using default: {voices[0].name}")
        return voices[0].id
            
    except Exception as e:
        print(f"[voice_settings] Error getting pyttsx3 voice: {e}")
        import traceback
        traceback.print_exc()
    
    return None


def apply_voice_settings(engine) -> None:
    """
    Apply the shared voice settings to a pyttsx3 engine instance.
    
    Note: pyttsx3's setProperty('voice', ...) is unreliable on Windows.
    We access the underlying SAPI driver directly to set the voice.
    
    Args:
        engine: pyttsx3 engine instance to configure
    """
    settings = get_voice_settings()
    voice_name = settings.get('voiceName', '')
    
    try:
        # Extract person name from voice setting (e.g., "Microsoft George - ..." -> "george")
        person_name = None
        if voice_name and 'microsoft' in voice_name.lower():
            parts = voice_name.split()
            if len(parts) >= 2:
                person_name = parts[1].lower()
        
        # Access the underlying SAPI driver directly via proxy
        # pyttsx3's setProperty is unreliable, but we can set the voice on the SAPI object
        driver = None
        tts = None
        
        # Try to get the SAPI driver - path is engine.proxy._driver._tts
        if hasattr(engine, 'proxy') and engine.proxy:
            proxy = engine.proxy
            if hasattr(proxy, '_driver') and proxy._driver:
                driver = proxy._driver
                if hasattr(driver, '_tts') and driver._tts:
                    tts = driver._tts
        
        if tts and person_name:
            voices = tts.GetVoices()
            
            # Find matching voice
            target_idx = None
            for i in range(voices.Count):
                desc = voices.Item(i).GetDescription().lower()
                if person_name in desc:
                    target_idx = i
                    break
            
            if target_idx is not None:
                tts.Voice = voices.Item(target_idx)
                print(f"[voice_settings] Set SAPI voice to: {voices.Item(target_idx).GetDescription()}")
            else:
                print(f"[voice_settings] Voice '{person_name}' not found in SAPI, available: {[voices.Item(i).GetDescription() for i in range(voices.Count)]}")
        elif not tts:
            print(f"[voice_settings] Could not access SAPI driver")
        
        # Set rate (pyttsx3 uses words per minute, typically 150-200 is normal)
        # Our settings use 0.5-2.0 multiplier, so convert
        base_rate = 175
        rate_multiplier = settings.get('rate', 1.0)
        engine.setProperty('rate', int(base_rate * rate_multiplier))
        
        # Set volume (0.0 to 1.0)
        engine.setProperty('volume', settings.get('volume', 1.0))
        
    except Exception as e:
        print(f"[voice_settings] Error applying settings: {e}")
        import traceback
        traceback.print_exc()


def is_tts_enabled() -> bool:
    """Check if TTS is enabled in settings."""
    return get_voice_settings().get('ttsEnabled', True)


def apply_sapi_voice_settings(sapi_voice) -> None:
    """
    Apply voice settings to a direct SAPI SpVoice object (from win32com).
    
    Use this for apps that use win32com.client.Dispatch("SAPI.SpVoice")
    directly instead of pyttsx3.
    
    Args:
        sapi_voice: A win32com SAPI.SpVoice object
    """
    settings = get_voice_settings()
    voice_name = settings.get('voiceName', '')
    
    try:
        # Extract person name from voice setting (e.g., "Microsoft George - ..." -> "george")
        person_name = None
        if voice_name and 'microsoft' in voice_name.lower():
            parts = voice_name.split()
            if len(parts) >= 2:
                person_name = parts[1].lower()
        
        if person_name:
            voices = sapi_voice.GetVoices()
            
            # Find matching voice
            target_idx = None
            for i in range(voices.Count):
                desc = voices.Item(i).GetDescription().lower()
                if person_name in desc:
                    target_idx = i
                    break
            
            if target_idx is not None:
                sapi_voice.Voice = voices.Item(target_idx)
                print(f"[voice_settings] Set SAPI voice to: {voices.Item(target_idx).GetDescription()}")
            else:
                print(f"[voice_settings] Voice '{person_name}' not found in SAPI")
        
        # Set rate: SAPI rate is -10 to 10, with 0 being normal
        # Our settings use 0.5-2.0 multiplier
        rate_multiplier = settings.get('rate', 1.0)
        # Convert: 0.5 -> -5, 1.0 -> 0, 2.0 -> 10
        sapi_rate = int((rate_multiplier - 1.0) * 10)
        sapi_rate = max(-10, min(10, sapi_rate))
        sapi_voice.Rate = sapi_rate
        
        # Set volume: SAPI volume is 0-100
        volume = settings.get('volume', 1.0)
        sapi_voice.Volume = int(volume * 100)
        
    except Exception as e:
        print(f"[voice_settings] Error applying SAPI settings: {e}")
        import traceback
        traceback.print_exc()


# Watch for settings changes (optional, for long-running apps)
_last_mtime = 0

def check_settings_changed() -> bool:
    """
    Check if the settings file has been modified since last check.
    Useful for long-running apps that want to reload settings periodically.
    """
    global _last_mtime
    try:
        if SETTINGS_FILE.exists():
            mtime = SETTINGS_FILE.stat().st_mtime
            if mtime > _last_mtime:
                _last_mtime = mtime
                return True
    except:
        pass
    return False


if __name__ == '__main__':
    # Test the module
    print("Voice Settings Test")
    print("-" * 40)
    settings = get_voice_settings()
    print(f"Settings: {json.dumps(settings, indent=2)}")
    print(f"TTS Enabled: {is_tts_enabled()}")
    
    try:
        import pyttsx3
        engine = pyttsx3.init()
        voice_id = get_pyttsx3_voice_id(engine)
        print(f"Matching pyttsx3 voice ID: {voice_id}")
        
        print("\nApplying settings and testing speech...")
        apply_voice_settings(engine)
        engine.say("Voice settings test successful")
        engine.runAndWait()
    except ImportError:
        print("pyttsx3 not installed - skipping voice test")
