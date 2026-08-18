import argparse
import os
import sys
import time
import json
import threading
import subprocess
from typing import Optional, Dict, Any, List

# Fix encoding for Windows console
if sys.stdout:
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except:
        pass
if sys.stderr:
    try:
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except:
        pass

# Set up file logging so we can see what's happening
LOG_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "control_bar.log")
def log(msg):
    """Log to both console and file, handling Unicode safely."""
    # Sanitize message for console output
    try:
        safe_msg = str(msg).encode('ascii', errors='replace').decode('ascii')
    except:
        safe_msg = str(msg)
    
    try:
        print(safe_msg)
    except:
        pass  # Ignore print errors
    
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"{time.strftime('%H:%M:%S')} {msg}\n")
    except:
        pass

# Append session separator on startup (don't clear - keep history for debugging)
try:
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(f"\n=== Control Bar Started {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n")
except:
    pass

import tkinter as tk

import psutil
import pyautogui
import win32gui
import win32con
import win32api
import win32process
from urllib.parse import urlparse
import ctypes
import shutil


def _get_chrome_profile_path():
    """Get the default Chrome profile path."""
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    return os.path.join(local_app_data, "Google", "Chrome", "User Data", "Default")


def _mark_chrome_clean_exit():
    """
    Mark Chrome as having exited cleanly by updating the Preferences file.
    This prevents the "Restore pages?" dialog after force kill.
    """
    try:
        prefs_path = os.path.join(_get_chrome_profile_path(), "Preferences")
        if not os.path.exists(prefs_path):
            log(f"[Chrome] Preferences file not found at {prefs_path}")
            return
        
        import json
        with open(prefs_path, 'r', encoding='utf-8') as f:
            prefs = json.load(f)
        
        # Set exit_type to "Normal" to prevent restore dialog
        if "profile" not in prefs:
            prefs["profile"] = {}
        prefs["profile"]["exit_type"] = "Normal"
        prefs["profile"]["exited_cleanly"] = True
        
        with open(prefs_path, 'w', encoding='utf-8') as f:
            json.dump(prefs, f)
        
        log("[Chrome] Marked Chrome as clean exit in Preferences")
    except Exception as e:
        log(f"[Chrome] Error marking clean exit: {e}")


def _close_chrome_gracefully():
    """
    Close Chrome by force killing all processes, then marking as clean exit.
    This ensures Chrome fully closes and doesn't show "Restore pages?" on next launch.
    """
    try:
        chrome_hwnds = _enum_chrome_windows()
        if not chrome_hwnds:
            log("[Chrome] No Chrome windows to close")
            return True
        
        log(f"[Chrome] Found {len(chrome_hwnds)} Chrome window(s), force killing...")
        
        # Force kill all Chrome processes
        killed = False
        for proc in psutil.process_iter(['pid', 'name']):
            try:
                if proc.info['name'] and proc.info['name'].lower() == 'chrome.exe':
                    proc.kill()
                    killed = True
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        
        if killed:
            log("[Chrome] Killed Chrome processes")
            time.sleep(0.5)  # Brief wait for processes to terminate
            
            # Mark Chrome as having exited cleanly to prevent restore dialog
            _mark_chrome_clean_exit()
        
        # Verify all Chrome windows are gone
        remaining = _enum_chrome_windows()
        if not remaining:
            log("[Chrome] All Chrome windows closed")
            return True
        else:
            log(f"[Chrome] {len(remaining)} window(s) still remaining")
            return False
        
    except Exception as e:
        log(f"[Chrome] Error in close: {e}")
        return False


def _kill_chrome_gracefully():
    """
    Close Chrome completely and prevent restore dialog.
    """
    log("[Chrome] Starting force close...")
    _close_chrome_gracefully()
    log("[Chrome] Force close complete")


# Optional low-level hotkey library (strong combo handling)
try:
    import keyboard as _kbd  # pip install keyboard
except Exception:
    _kbd = None  # noqa: F841 - used conditionally elsewhere

# Optional: Try pyttsx3 first, fallback to win32com
try:
    import pyttsx3
    _tts_engine = pyttsx3.init()
except Exception:
    _tts_engine = None

# Import shared voice settings
# From utils/ folder: go up 4 levels to bennyshub/, then into shared/
_shared_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared"))
if _shared_dir not in sys.path:
    sys.path.insert(0, _shared_dir)
try:
    from voice_settings import apply_voice_settings, apply_sapi_voice_settings, is_tts_enabled, check_settings_changed  # type: ignore
    _voice_settings_available = True
    # Apply settings to engine immediately if available
    if _tts_engine is not None:
        apply_voice_settings(_tts_engine)
except ImportError:
    _voice_settings_available = False
    def apply_voice_settings(_engine): pass  # noqa: E302
    def apply_sapi_voice_settings(_sapi): pass  # noqa: E302
    def is_tts_enabled(): return True  # noqa: E302
    def check_settings_changed(): return False  # noqa: E302

# Optional Windows TTS (SAPI via pywin32)
try:
    import win32com.client as _win32com_client
except Exception:
    _win32com_client = None

# ------------------------------ Config ------------------------------
# Because this file lives in utils/, the data directory is one level up.
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
EPISODE_SHEET = os.path.join(DATA_DIR, "EPISODE_SELECTION.xlsx")
LAST_WATCHED_FILE = os.path.join(DATA_DIR, "last_watched.json")
CURRENT_URL_FILE = os.path.join(DATA_DIR, "current_url.txt")  # Written by server.py
APP_TITLE_MAIN = "Accessible Menu"  # comm-v10.py window title

BUTTON_FONT = ("Arial Black", 20)   # was 16; ~25% larger
BAR_HEIGHT = 88                     # was 70; ~25% taller
BAR_OPACITY = 0.96
POLL_INTERVAL = 0.75
SCAN_DEBOUNCE = 0.15  # seconds cooldown - fast navigation
SPACE_HOLD_DELAY = 3.0   # seconds to hold before auto-scan starts
SPACE_HOLD_REPEAT = 2.0  # repeat interval while holding Space

# Disable spreadsheet-driven navigation entirely
USE_SPREADSHEET_NAV = False

# ------------------------------ Platform profiles ------------------------------
PlatformProfile = Dict[str, Any]

PROFILES: List[PlatformProfile] = [
    {"name": "YouTube", "match": ["youtube.com", "youtu.be"],
     "playpause": ["k", "space"], "fullscreen": ["f"], "post_nav": ["f"], "use_keyboard": False},
    # Disney+ auto-plays and auto-fullscreens - no post_nav needed, use keyboard for responsiveness
    {"name": "Disney+", "match": ["disneyplus.com"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": [], "use_keyboard": True},
    # Netflix auto-plays and auto-fullscreens - no post_nav needed
    {"name": "Netflix", "match": ["netflix.com"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": [], "use_keyboard": True},
    # Prime Video auto-plays - no post_nav needed
    {"name": "Prime Video", "match": ["primevideo.com", "amazon.com"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": [], "use_keyboard": True},
    # Hulu auto-plays - no post_nav needed
    {"name": "Hulu", "match": ["hulu.com"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": [], "use_keyboard": True},
    # Paramount+ auto-plays - no post_nav needed
    {"name": "Paramount+", "match": ["paramountplus.com"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": [], "use_keyboard": True},
    # Max auto-plays - no post_nav needed
    {"name": "Max", "match": ["max.com", "hbomax.com"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": [], "use_keyboard": True},
    {"name": "PlutoTV", "match": ["pluto.tv"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": ["m", "f"], "use_keyboard": True},
    {"name": "Plex", "match": ["plex.tv", "app.plex.tv", ":32400"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": ["x", "enter", "p", "f"], "use_keyboard": False},
    {"name": "Generic", "match": ["."],  # fallback
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": ["f"], "use_keyboard": False},
]

# ------------------------------ Episode cache (kept for compatibility, unused) ------------------------------
# We retain these structures so existing imports and calls don't crash, but we won't use them.
EPISODE_CACHE: Dict[str, Dict[int, List[Dict[str, Any]]]] = {}
EPISODE_LINEAR: Dict[str, List[Dict[str, Any]]] = {}

def load_last_watched() -> dict:
    if os.path.exists(LAST_WATCHED_FILE):
        try:
            with open(LAST_WATCHED_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

# NEW: guard to avoid persisting unwanted locations
def _safe_to_persist(url: str) -> bool:
    try:
        u = urlparse(url or "")
        if u.scheme == "file":
            return False
        host = (u.netloc or "").lower()
        # Never persist Plex or local hub URLs
        if ("plex.tv" in host) or ("plex.direct" in host):
            return False
        if host.startswith("127.0.0.1") or host.startswith("localhost"):
            return False
        allowed = [
            "netflix.com","disneyplus.com","paramountplus.com","primevideo.com","amazon.com",
            "hulu.com","max.com","hbomax.com","play.max.com","play.hbomax.com","pluto.tv","youtube.com","youtu.be"
        ]
        return any(h in host for h in allowed)
    except Exception:
        return False

def set_last_position(show_title: str, season: int, episode: int, url: str, linear_index: Optional[int] = None):
    # Only persist if the URL is allowed
    if not _safe_to_persist(url):
        print(f"[SAVE] Skipped (not allowed): {show_title} → {url[:50]}...")
        return
    data = load_last_watched()
    
    # Remove existing entry first so it goes to end (most recent)
    if show_title in data:
        del data[show_title]
    
    rec = {
        "season": int(season), 
        "episode": int(episode), 
        "url": url,
        "timestamp": int(time.time() * 1000)  # JS-style timestamp for sorting
    }
    if linear_index is not None:
        rec["linear_index"] = int(linear_index)
    data[show_title] = rec
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(LAST_WATCHED_FILE, "w") as f:
        json.dump(data, f, indent=2)
    print(f"[SAVE] {show_title} → {url[:60]}...")

# ---- Console window helpers (keep the terminal out of the way) ----

def _hide_own_console():
    try:
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            win32gui.ShowWindow(hwnd, win32con.SW_HIDE)
    except Exception:
        pass


def _minimize_all_consoles():
    try:
        def _enum(hwnd, _res):
            try:
                if win32gui.IsWindowVisible(hwnd):
                    cls = (win32gui.GetClassName(hwnd) or "").lower()
                    if cls == "consolewindowclass":
                        win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
            except Exception:
                pass
        win32gui.EnumWindows(_enum, None)
    except Exception:
        pass

# ------------------------------ Chrome helpers ------------------------------

def is_chrome_running() -> bool:
    for p in psutil.process_iter(["name"]):
        n = p.info.get("name")
        if n and "chrome" in n.lower():
            return True
    return False


def _enum_chrome_windows() -> List[int]:
    """Find ALL Chrome windows regardless of title, including fullscreen windows."""
    handles: List[int] = []
    def _enum(hwnd, _res):
        try:
            # Check if window belongs to chrome.exe process (don't require IsWindowVisible for fullscreen)
            try:
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                proc = psutil.Process(pid)
                if proc.name().lower() == "chrome.exe":
                    # Check window has some size (not a hidden helper window)
                    try:
                        rect = win32gui.GetWindowRect(hwnd)
                        width = rect[2] - rect[0]
                        height = rect[3] - rect[1]
                        if width > 100 and height > 100:  # Main window, not a tiny helper
                            handles.append(hwnd)
                    except:
                        # If we can't get rect, still add if visible
                        if win32gui.IsWindowVisible(hwnd):
                            handles.append(hwnd)
            except Exception:
                pass
        except Exception:
            pass
    win32gui.EnumWindows(_enum, None)
    return handles


# --- CDP-based URL grabber (Chrome launched with --remote-debugging-port=9222) ---
def get_current_url_from_file() -> Optional[str]:
    """
    Read the current playback URL from the temp file written by server.py.
    This is the most reliable method since it's set when playback starts.
    """
    try:
        if os.path.exists(CURRENT_URL_FILE):
            with open(CURRENT_URL_FILE, 'r') as f:
                url = f.read().strip()
                if url and (url.startswith('http://') or url.startswith('https://')):
                    print(f"[URL-FILE] Got URL: {url[:60]}...")
                    return url
    except Exception as e:
        print(f"[URL-FILE] Error: {e}")
    return None


def get_chrome_url_via_uiautomation() -> Optional[str]:
    """
    Get Chrome's current URL using pywinauto UI Automation.
    This reads the address bar directly without needing CDP.
    """
    try:
        from pywinauto import Desktop
        
        print("[UIA] Looking for Chrome window...")
        desktop = Desktop(backend='uia')
        
        # Find Chrome window
        try:
            chrome = desktop.window(title_re='.*- Google Chrome$')
        except:
            try:
                chrome = desktop.window(title_re='.*Chrome.*')
            except:
                print("[UIA] No Chrome window found")
                return None
        
        print(f"[UIA] Found Chrome: {chrome.window_text()[:50]}...")
        
        # Try to find the address bar
        try:
            # Chrome's address bar is an Edit control with specific name
            addr_bar = chrome.child_window(title='Address and search bar', control_type='Edit')
            url = addr_bar.get_value()
            if url and (url.startswith('http://') or url.startswith('https://')):
                print(f"[UIA] Got URL: {url[:60]}...")
                return url
        except Exception as e:
            print(f"[UIA] Address bar method failed: {e}")
        
        # Fallback: find any Edit control with a URL
        try:
            edits = chrome.descendants(control_type='Edit')
            for edit in edits[:10]:
                try:
                    val = edit.get_value()
                    if val and (val.startswith('http://') or val.startswith('https://')):
                        print(f"[UIA] Found URL in Edit control: {val[:60]}...")
                        return val
                except:
                    pass
        except Exception as e:
            print(f"[UIA] Fallback method failed: {e}")
        
        print("[UIA] Could not find URL")
        return None
        
    except ImportError:
        print("[UIA] pywinauto not available")
        return None
    except Exception as e:
        print(f"[UIA] Error: {e}")
        return None


def get_chrome_url_via_cdp() -> Optional[str]:
    """
    Get Chrome's current URL via CDP (Chrome DevTools Protocol).
    Requires Chrome to be launched with --remote-debugging-port=9222.
    """
    try:
        import requests
        print("[CDP] Fetching URL from Chrome via port 9222...")
        r = requests.get("http://127.0.0.1:9222/json", timeout=1.0)
        if not r.ok:
            print(f"[CDP] Request failed: {r.status_code}")
            return None
        
        tabs = r.json()
        print(f"[CDP] Found {len(tabs)} tabs")
        
        # Priority: streaming service URLs
        streaming_domains = ["netflix.com", "disneyplus.com", "paramountplus.com", 
                           "primevideo.com", "amazon.com", "hulu.com", "max.com", 
                           "hbomax.com", "play.max.com", "pluto.tv", "youtube.com", "youtu.be"]
        
        best_url = None
        for tab in tabs:
            if tab.get("type") == "page" and tab.get("url"):
                url = tab.get("url")
                
                # Skip internal pages
                if url.startswith("chrome://") or url.startswith("chrome-extension://"):
                    continue
                
                # Skip localhost/hub pages
                if "localhost" in url or "127.0.0.1" in url:
                    continue
                
                # Check if it's a streaming service
                url_lower = url.lower()
                for domain in streaming_domains:
                    if domain in url_lower:
                        print(f"[CDP] Found streaming URL: {url[:60]}...")
                        return url
                
                # Keep first valid URL as fallback
                if best_url is None:
                    best_url = url
        
        if best_url:
            print(f"[CDP] Using fallback URL: {best_url[:60]}...")
        return best_url
    except requests.exceptions.ConnectionError:
        print("[CDP] Connection refused - Chrome not running with CDP")
        return None
    except Exception as e:
        print(f"[CDP] Error: {e}")
        return None


# --- Clipboard-based URL grabber (FAST version) ---
def get_chrome_url_via_clipboard() -> Optional[str]:
    """
    Get Chrome's current URL quickly:
    1. Focus Chrome, 2. F11 exit fullscreen, 3. Ctrl+L, 4. Ctrl+C, 5. Read clipboard
    """
    import pyperclip
    
    log("[CLIPBOARD] Quick URL grab...")
    
    try:
        chrome_hwnds = _enum_chrome_windows()
        if not chrome_hwnds:
            log("[CLIPBOARD] No Chrome window")
            return None
        
        hwnd = chrome_hwnds[0]
        pyperclip.copy('')  # Clear clipboard
        
        # Focus Chrome
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            ctypes.windll.user32.keybd_event(0x12, 0, 0, 0)  # Alt down
            ctypes.windll.user32.keybd_event(0x12, 0, 2, 0)  # Alt up
            win32gui.SetForegroundWindow(hwnd)
            time.sleep(0.15)
        except:
            pass
        
        # F11 to exit fullscreen, Ctrl+L to select URL, Ctrl+C to copy
        pyautogui.press('f11')
        time.sleep(0.2)
        pyautogui.hotkey('ctrl', 'l')
        time.sleep(0.1)
        pyautogui.hotkey('ctrl', 'c')
        time.sleep(0.15)
        
        # Read clipboard
        url = pyperclip.paste()
        log(f"[CLIPBOARD] Got: {url[:60] if url else 'EMPTY'}")
        
        if url and url.startswith('http'):
            return url.strip()
        return None
            
    except Exception as e:
        log(f"[CLIPBOARD] Error: {e}")
        return None


# NEW: enumerate all visible top-level windows (not limited to Chrome)
def _enum_visible_windows() -> List[int]:
    handles: List[int] = []
    def _enum(hwnd, _res):
        try:
            if win32gui.IsWindowVisible(hwnd):
                handles.append(hwnd)
        except Exception:
            pass
    win32gui.EnumWindows(_enum, None)
    return handles


def find_electron_hub_window() -> Optional[int]:
    """Find the Electron hub window by title (not limited to Chrome process)."""
    hub_title_indicators = ["narbe", "benny's", "bennys", "access hub"]
    
    for hwnd in _enum_visible_windows():
        try:
            title = win32gui.GetWindowText(hwnd) or ""
            title_lower = title.lower()
            
            if any(ind in title_lower for ind in hub_title_indicators):
                # Verify it's NOT Chrome (Electron uses electron.exe)
                try:
                    _, pid = win32process.GetWindowThreadProcessId(hwnd)
                    proc = psutil.Process(pid)
                    pname = proc.name().lower()
                    # Accept electron or bennys-hub.exe (when packaged)
                    if "electron" in pname or "benny" in pname or "hub" in pname:
                        return hwnd
                except Exception:
                    pass
        except Exception:
            pass
    return None


def focus_hub_window() -> bool:
    """Focus the hub window (Electron or Chrome)."""
    # First try Electron
    hwnd = find_electron_hub_window()
    if hwnd:
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            win32gui.SetForegroundWindow(hwnd)
            print(f"[Focus] Restored Electron hub window")
            return True
        except Exception as e:
            print(f"[Focus] Failed to restore Electron hub: {e}")
    
    # Fallback to Chrome (for backwards compatibility)
    for hwnd in _enum_chrome_windows():
        title = win32gui.GetWindowText(hwnd) or ""
        title_lower = title.lower()
        if "8060" in title_lower or "benny" in title_lower or "narbe" in title_lower:
            try:
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                win32gui.SetForegroundWindow(hwnd)
                print(f"[Focus] Restored Chrome hub window")
                return True
            except Exception:
                continue
    return False


def focus_chrome_window(prefer_title: str = None) -> bool:
    """
    Focus a Chrome window. If prefer_title is given, try to find a window
    with that text in the title first.
    """
    chrome_windows = _enum_chrome_windows()
    
    # Log ALL Chrome windows found for debugging
    log(f"[focus_chrome_window] Found {len(chrome_windows)} Chrome window(s)")
    for i, hwnd in enumerate(chrome_windows):
        try:
            title = win32gui.GetWindowText(hwnd)
            visible = win32gui.IsWindowVisible(hwnd)
            log(f"[focus_chrome_window]   Window {i}: hwnd={hwnd}, visible={visible}, title='{title[:60]}'")
        except:
            log(f"[focus_chrome_window]   Window {i}: hwnd={hwnd}, could not get title")
    
    # If we have a preferred title, try to find that window first
    if prefer_title:
        prefer_lower = prefer_title.lower()
        for hwnd in chrome_windows:
            try:
                title = win32gui.GetWindowText(hwnd).lower()
                if prefer_lower in title:
                    log(f"[focus_chrome_window] Found preferred window: {title[:50]}")
                    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                    win32gui.SetForegroundWindow(hwnd)
                    time.sleep(0.05)
                    return True
            except Exception:
                continue
    
    # Fallback: focus any Chrome window
    for hwnd in chrome_windows:
        try:
            title = win32gui.GetWindowText(hwnd)
            log(f"[focus_chrome_window] Focusing: {title[:50] if title else 'untitled'}")
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            win32gui.SetForegroundWindow(hwnd)
            time.sleep(0.05)
            return True
        except Exception:
            continue
    
    log("[focus_chrome_window] No Chrome windows found")
    return False


def focus_plex_chrome() -> bool:
    """Focus the Chrome window running Plex specifically."""
    return focus_chrome_window(prefer_title="plex")


def close_chrome():
    hwnd = win32gui.GetForegroundWindow()
    # Check foreground window process
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        if proc.name().lower() == "chrome.exe":
             pyautogui.hotkey("alt", "f4")
             return
    except Exception:
        pass
    
    # Fallback: Close ONLY the top-most Chrome window found
    chrome_hwnds = _enum_chrome_windows()
    if chrome_hwnds:
        try:
            # EnumWindows usually returns in Z-order, so index 0 is likely the most recent
            target_hwnd = chrome_hwnds[0]
            win32gui.PostMessage(target_hwnd, win32con.WM_CLOSE, 0, 0)
        except Exception:
            pass

# NEW: find Chrome executable path (best-effort on Windows)
def _find_chrome_exe() -> Optional[str]:  # noqa: F811 - utility for future use
    exe = shutil.which("chrome") or shutil.which("chrome.exe")
    if exe and os.path.exists(exe):
        return exe
    candidates = [
        os.path.join(os.environ.get("ProgramFiles", r"C:\\Program Files"), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\\Program Files (x86)"), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def focus_comm_app():
    hwnd = win32gui.FindWindow(None, APP_TITLE_MAIN)
    if hwnd:
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)


def navigate_current_tab(url: str) -> bool:
    ws = cdp_find_ws()
    if ws:
        return cdp_navigate(ws, url)
    print("[control_bar] CDP unavailable; cannot navigate without stealing focus.")
    return False

# Try to read Chrome's active tab URL via the DevTools HTTP endpoint.
# Requires launching Chrome with --remote-debugging-port=9222.
try:
    import requests  # local loopback only
except Exception:
    requests = None

# Optional: WebSocket CDP for focus-free control
try:
    import websocket  # pip install websocket-client
except Exception:
    websocket = None


def get_active_chrome_url_via_cdp() -> Optional[str]:
    """Get the best streaming URL from Chrome via CDP. Single attempt, no retries."""
    if not requests:
        return None
    
    try:
        r = requests.get("http://127.0.0.1:9222/json", timeout=0.3)
        if not r.ok:
            return None
        tabs = r.json()
        
        # Priority: streaming service URLs and Plex
        streaming_domains = ["netflix.com", "disneyplus.com", "paramountplus.com", 
                           "primevideo.com", "amazon.com", "hulu.com", "max.com", 
                           "hbomax.com", "play.max.com", "pluto.tv", "youtube.com", 
                           "youtu.be", "plex.tv", "plex.direct", ":32400"]
        
        for t in tabs:
            if t.get("type") == "page" and t.get("url"):
                url = t.get("url")
                if url.startswith("chrome://") or "localhost" in url or "127.0.0.1" in url:
                    continue
                url_lower = url.lower()
                for domain in streaming_domains:
                    if domain in url_lower:
                        return url
        return None
    except Exception:
        return None


def get_active_chrome_url_via_cdp_with_retries() -> Optional[str]:
    """Get URL with retries - ONLY use during bootstrap, not for button actions."""
    if not requests:
        print("[CDP] requests module not available")
        return None
    
    for attempt in range(3):
        try:
            r = requests.get("http://127.0.0.1:9222/json", timeout=1.0)
            if not r.ok:
                print(f"[CDP] Attempt {attempt+1}: Request failed")
                time.sleep(0.3)
                continue
            tabs = r.json()
            
            streaming_domains = ["netflix.com", "disneyplus.com", "paramountplus.com", 
                               "primevideo.com", "amazon.com", "hulu.com", "max.com", 
                               "hbomax.com", "play.max.com", "pluto.tv", "youtube.com", 
                               "youtu.be", "plex.tv", "plex.direct", ":32400"]
            
            best_url = None
            for t in tabs:
                if t.get("type") == "page" and t.get("url"):
                    url = t.get("url")
                    if url.startswith("chrome://") or "localhost" in url or "127.0.0.1" in url:
                        continue
                    url_lower = url.lower()
                    for domain in streaming_domains:
                        if domain in url_lower:
                            return url
                    if best_url is None:
                        best_url = url
            
            if best_url:
                return best_url
                
        except requests.exceptions.ConnectionError:
            time.sleep(0.3)
        except Exception:
            time.sleep(0.3)
    
    return None

# ---------------- CDP helpers (no focus change) ----------------

def _cdp_tabs():
    if not requests:
        return []
    try:
        r = requests.get("http://127.0.0.1:9222/json", timeout=0.4)
        return r.json() if r.ok else []
    except Exception:
        return []


def cdp_find_ws(url_hint: Optional[str] = None) -> Optional[str]:
    tabs = _cdp_tabs()
    if not tabs:
        return None
    if url_hint:
        base = _normalize_url(url_hint)
        for t in tabs:
            u = t.get("url", "")
            if t.get("type") == "page" and t.get("webSocketDebuggerUrl") and (base == _normalize_url(u) or _normalize_url(u).startswith(base)):
                return t.get("webSocketDebuggerUrl")
    for t in tabs:
        if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
            return t.get("webSocketDebuggerUrl")
    return None


def _cdp_send(ws, method: str, params: Optional[dict] = None, msg_id: int = 1, timeout: float = 1.2):
    payload = {"id": msg_id, "method": method}
    if params:
        payload["params"] = params
    ws.send(json.dumps(payload))
    ws.settimeout(timeout)
    try:
        reply = ws.recv()
        return json.loads(reply)
    except Exception:
        return None


def cdp_runtime_eval(ws_url: str, expression: str) -> bool:
    if not websocket or not ws_url:
        return False
    try:
        ws = websocket.create_connection(ws_url, timeout=0.8)
    except Exception:
        return False
    try:
        _cdp_send(ws, "Runtime.enable")
        res = _cdp_send(ws, "Runtime.evaluate", {"expression": expression, "awaitPromise": True, "returnByValue": True})
        return bool(res)
    finally:
        try:
            ws.close()
        except Exception:
            pass


def cdp_navigate(ws_url: str, url: str) -> bool:
    if not websocket or not ws_url:
        return False
    try:
        ws = websocket.create_connection(ws_url, timeout=0.8)
    except Exception:
        return False
    try:
        _cdp_send(ws, "Page.enable")
        res = _cdp_send(ws, "Page.navigate", {"url": url})
        return bool(res)
    finally:
        try:
            ws.close()
        except Exception:
            pass


def cdp_toggle_play(ws_url: str) -> bool:
    """Toggle play/pause via CDP. Works with most streaming services."""
    # Disney+ and other services may have video in shadow DOM or iframes
    # Try multiple selectors to find the video element
    js = """
(() => {
    // Try direct video element first
    let v = document.querySelector('video');
    
    // If not found, check shadow DOMs (Disney+ uses these)
    if (!v) {
        const shadowHosts = document.querySelectorAll('*');
        for (const host of shadowHosts) {
            if (host.shadowRoot) {
                v = host.shadowRoot.querySelector('video');
                if (v) break;
            }
        }
    }
    
    // Try iframes as fallback
    if (!v) {
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                v = iframe.contentDocument?.querySelector('video');
                if (v) break;
            } catch(e) {}
        }
    }
    
    if (!v) return 'no video';
    if (v.paused) { 
        try { v.play(); } catch(e) {} 
        return 'play'; 
    } else { 
        v.pause(); 
        return 'pause'; 
    }
})();
"""
    return cdp_runtime_eval(ws_url, js)


def cdp_adjust_volume(ws_url: str, delta: float) -> bool:
    """Adjust video volume via CDP. delta should be between -1.0 and 1.0."""
    js = f"""
(() => {{ 
    const v = document.querySelector('video'); 
    if (!v) return false;
    v.volume = Math.max(0, Math.min(1, v.volume + {delta}));
    return true;
}})();
"""
    return cdp_runtime_eval(ws_url, js)


def cdp_click_center_internal(ws) -> bool:
    # Helper that assumes ws is open
    try:
        res = _cdp_send(ws, "Runtime.evaluate", {
            "expression": "({width: window.innerWidth, height: window.innerHeight})",
            "returnByValue": True
        })
        if res and res.get("result", {}).get("result", {}).get("value"):
            dims = res["result"]["result"]["value"]
            cx = dims.get("width", 1920) // 2
            cy = dims.get("height", 1080) // 2
            _cdp_send(ws, "Input.dispatchMouseEvent", {
                "type": "mousePressed", "x": cx, "y": cy, "button": "left", "clickCount": 1
            })
            _cdp_send(ws, "Input.dispatchMouseEvent", {
                "type": "mouseReleased", "x": cx, "y": cy, "button": "left", "clickCount": 1
            })
            return True
    except Exception:
        pass
    return False

def cdp_click_center(ws_url: str) -> bool:
    """Click the center of the page via CDP."""
    if not websocket or not ws_url:
        return False
    try:
        ws = websocket.create_connection(ws_url, timeout=0.8)
    except Exception:
        return False
    try:
        _cdp_send(ws, "Runtime.enable")
        return cdp_click_center_internal(ws)
    finally:
        try:
            ws.close()
        except Exception:
            pass
    return False

# ensure video is playing and page is fullscreen (best-effort, focus-safe)
def cdp_ensure_play_and_fullscreen(ws_url: Optional[str]) -> bool:
    if not websocket or not ws_url:
        return False
    try:
        ws = websocket.create_connection(ws_url, timeout=1.2)
    except Exception:
        return False
    ok = False
    try:
        _cdp_send(ws, "Runtime.enable")
        _cdp_send(ws, "Runtime.evaluate", {
            "expression": "(async() => {try{const v=document.querySelector('video'); if(v){await v.play().catch(()=>{});} }catch(e){} })();",
            "awaitPromise": True
        })
        _cdp_send(ws, "Runtime.evaluate", {
            "expression": "(async()=>{try{if(!document.fullscreenElement){const v=document.querySelector('video'); if(v&&v.requestFullscreen){await v.requestFullscreen().catch(()=>{});} else if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen().catch(()=>{});} }}catch(e){} })();",
            "awaitPromise": True
        })
        time.sleep(0.15)
        _cdp_send(ws, "Runtime.evaluate", {"expression": "!!document.fullscreenElement", "returnByValue": True})
        _cdp_send(ws, "Input.dispatchKeyEvent", {"type": "keyDown", "key": "f", "code": "KeyF", "windowsVirtualKeyCode": 0x46, "keyCode": 0x46})
        _cdp_send(ws, "Input.dispatchKeyEvent", {"type": "keyUp", "key": "f", "code": "KeyF", "windowsVirtualKeyCode": 0x46, "keyCode": 0x46})
        ok = True
    finally:
        try:
            ws.close()
        except Exception:
            pass
    return ok

# ------------------------------ Platform detection & actions ------------------------------

def get_profile_for_url(url: Optional[str], explicit_platform: Optional[str] = None) -> PlatformProfile:
    if explicit_platform:
        for prof in PROFILES:
            if prof["name"].lower() == explicit_platform.lower():
                return prof
    if not url:
        return PROFILES[-1]
    u = url.lower()
    for prof in PROFILES:
        for needle in prof["match"]:
            if needle in u:
                return prof
    return PROFILES[-1]

# quick URL check for Plex
def _is_plex_url(u: Optional[str]) -> bool:  # noqa: F811 - utility for future use
    if not u:
        return False
    s = u.lower()
    return ("plex" in s) or (":32400" in s) or ("/web/index.html" in s)


def send_to_chrome(_seq: List[str], _delay: float = 0.05, fallback_media_key: bool = True):
    # Note: _seq and _delay are for future implementation
    if fallback_media_key:
        try:
            print("[send_to_chrome] Sending VK_MEDIA_PLAY_PAUSE (0xB3)")
            KEYEVENTF_EXTENDEDKEY = 0x0001
            KEYEVENTF_KEYUP = 0x0002
            ctypes.windll.user32.keybd_event(0xB3, 0, KEYEVENTF_EXTENDEDKEY, 0)
            ctypes.windll.user32.keybd_event(0xB3, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)
            print("[send_to_chrome] Media key sent")
        except Exception as e:
            print(f"[send_to_chrome] Error: {e}")

# ------------------------------ Resolver (kept minimal) ------------------------------

def _normalize_url(u: str) -> str:
    base = u.split('#', 1)[0]
    base = base.split('?', 1)[0]
    return base.rstrip('/')

# ------------------------------ UI (Scan/Select) ------------------------------
class ControlBar(tk.Tk):
    def __init__(self, _mode: str, show_title: Optional[str]):
        super().__init__()
        # Force basic mode regardless of arg to avoid spreadsheet stepping
        self.mode = "basic"  # _mode parameter ignored, always use basic
        self.show_title = show_title
        self.menu_state = "player"  # "player" or "comm"
        self.title("Playback Bar")
        self.overrideredirect(True)
        self.configure(bg="#111111")
        self.attributes("-topmost", True)
        try:
            self.attributes("-alpha", BAR_OPACITY)
        except Exception:
            pass

        self._place_bottom()

        self.items: List[Dict[str, Any]] = self._make_items()
        self.tk_buttons: List[tk.Button] = []
        self.current_index = 0
        self._return_hold_thread: Optional[threading.Thread] = None
        self._activated_once = False
        self._restarting_chrome = False
        self._restart_deadline = 0.0
        self._btn_idx: Dict[str, int] = {}
        
        # Cache platform detection to avoid URL lookups on every button press
        self._cached_platform: Optional[str] = None
        self._cached_is_plex: bool = False
        self._cached_ws_url: Optional[str] = None
        
        # Early Plex detection from last_watched.json as fallback (before CDP is available)
        if self.show_title:
            try:
                show_key = self.show_title.lower().strip()
                lw = load_last_watched()
                if show_key in lw:
                    saved_url = lw[show_key].get("url", "") if isinstance(lw[show_key], dict) else str(lw[show_key])
                    if _is_plex_url(saved_url):
                        self._cached_is_plex = True
                        log(f"[Init] Detected Plex from last_watched.json for '{self.show_title}'")
            except Exception as e:
                log(f"[Init] Error checking last_watched for Plex: {e}")
        
        log(f"[Init] _cached_is_plex initial value: {self._cached_is_plex}")
        
        # We need to initialize the row container first since _build_ui uses it
        self.row = None
        
        self._build_ui()
        self._highlight(0)

        _hide_own_console()
        # _minimize_all_consoles()
        # self.after(300, _minimize_all_consoles)
        # self.after(1200, _minimize_all_consoles)

        self._update_prev_next_labels()
        self.after(400, self._pulse_labels)

        self._last_action_ts = 0.0
        self._space_pressed = False
        self._space_press_time = 0.0
        self._space_hold_job = None
        self._space_hold_active = False
        
        # Flag to prevent focus stealing during automation
        self._automation_in_progress = False
        self._automation_complete = False

        self._watcher = threading.Thread(target=self._watch_chrome, daemon=True)
        self._watcher.start()

        self.bind("<KeyPress-space>", self._on_space_press)
        self.bind("<KeyRelease-space>", self._on_space_release)
        self.bind("<KeyPress-Return>", self._on_return_press)
        self.bind("<KeyRelease-Return>", self._on_return_release)

        # Initialize global SAPI voice object for performance
        self._sapi_voice = None
        if _win32com_client:
            try:
                self._sapi_voice = _win32com_client.Dispatch("SAPI.SpVoice")
                # Apply shared voice settings
                if _voice_settings_available:
                    apply_sapi_voice_settings(self._sapi_voice)
            except Exception:
                pass

        # One-shot bootstrap: Fullscreen browser (if not already in F11 fullscreen), then apply post-navigation keys
        # This runs FIRST, before any focus-stealing mechanisms
        def _bootstrap_once():
            self._automation_in_progress = True
            try:
                # First: Check if Chrome is in TRUE fullscreen (F11 mode - no window frame)
                print("[Bootstrap] Checking Chrome fullscreen state...")
                chrome_hwnds = _enum_chrome_windows()
                if chrome_hwnds:
                    hwnd = chrome_hwnds[0]
                    try:
                        # Check window style - true F11 fullscreen has no border/caption
                        style = win32gui.GetWindowLong(hwnd, win32con.GWL_STYLE)
                        has_caption = bool(style & win32con.WS_CAPTION)
                        has_border = bool(style & win32con.WS_BORDER)
                        
                        # True fullscreen (F11) has no caption and no border
                        is_true_fullscreen = not has_caption and not has_border
                        print(f"[Bootstrap] Window style: {hex(style)}, Caption: {has_caption}, Border: {has_border}, True F11 Fullscreen: {is_true_fullscreen}")
                        
                        if is_true_fullscreen:
                            print("[Bootstrap] Chrome already in F11 fullscreen, skipping")
                        else:
                            # Not in true fullscreen, send F11
                            print("[Bootstrap] Chrome not in F11 fullscreen, sending F11...")
                            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                            ctypes.windll.user32.keybd_event(0x12, 0, 0, 0)  # Alt down
                            ctypes.windll.user32.keybd_event(0x12, 0, 2, 0)  # Alt up
                            win32gui.SetForegroundWindow(hwnd)
                            time.sleep(0.15)
                            pyautogui.press('f11')
                            print("[Bootstrap] F11 sent for fullscreen")
                            time.sleep(0.3)
                    except Exception as e:
                        print(f"[Bootstrap] Fullscreen check/F11 failed: {e}")
                else:
                    print("[Bootstrap] No Chrome window found")
                
                # Then: Apply post-navigation keys (x,enter,p,f for Plex, etc.)
                # Use retry version ONLY here during bootstrap
                url = get_active_chrome_url_via_cdp_with_retries()
                if not url and self.show_title:
                    lw = load_last_watched().get(self.show_title.lower().strip())
                    if isinstance(lw, dict):
                        url = lw.get("url")
                    elif isinstance(lw, str):
                        url = lw
                
                # Cache the platform for instant button responses
                log(f"[Bootstrap] URL detected: {url}")
                prof = get_profile_for_url(url)
                self._cached_platform = prof.get("name", "Generic")
                self._cached_is_plex = url and ("plex" in url.lower() or ":32400" in url.lower()) if url else False
                self._cached_ws_url = cdp_find_ws(url) if url else None
                log(f"[Bootstrap] Cached platform: {self._cached_platform}, is_plex: {self._cached_is_plex}, url_lower: {url.lower() if url else 'None'}")
                
                print(f"[Bootstrap] Applying post_nav for {prof.get('name', 'Unknown')}: {prof.get('post_nav', [])}")
                self._apply_post_nav(prof)
            except Exception as e:
                print(f"[Bootstrap] Error: {e}")
            finally:
                self._automation_in_progress = False
                self._automation_complete = True
                # NOW start the focus-stealing for the control bar
                self.after(500, self._start_focus_management)
        
        # Run bootstrap after a short delay for window to be ready
        self.after(500, _bootstrap_once)

    def _start_focus_management(self):
        """Start focus management AFTER automation is complete."""
        if not self.winfo_exists():
            return
        self.bind("<FocusOut>", lambda _e: self.after(1, self._force_foreground))
        self.after(100, self._force_foreground)
        self.after(500, self._raise_forever)

    # ---------- Layout ----------
    def _place_bottom(self):
        sw = self.winfo_screenwidth()
        sh = self.winfo_screenheight()
        self.geometry(f"{sw}x{BAR_HEIGHT}+0+{sh - BAR_HEIGHT}")

    def _make_items(self) -> List[Dict[str, Any]]:
        # Toggle between Player Bar and Communication Menu
        if self.menu_state == "comm":
            return [
                {"label": "⬅ Player", "action": self.on_toggle_menu_player, "bg": "#b3d9ff", "tts": "player toggle"},
                {"label": "Help", "action": self.on_help_tts, "bg": "#b3ffb3", "tts": "help"},
                {"label": "Suction", "action": self.on_suction_tts, "bg": "#e6ccff", "tts": "suction"},
                {"label": "Keyboard", "action": self.on_open_keyboard, "bg": "#ffffb3", "tts": "keyboard"},
                {"label": "Messenger", "action": self.on_open_messenger, "bg": "#ffccff", "tts": "messenger"},
                {"label": "✖ Close All", "action": self.on_close_all, "bg": "#ffb3b3", "tts": "close all"},
            ]
        else:
            # Default "player"
            return [
                {"label": "Menu", "action": self.on_toggle_menu_comm, "bg": "#e6f0ff"},       # Light Blue
                {"label": "⏯ Play / Pause", "action": self.on_play_pause, "bg": "#b3ffb3"},   # Light Green
                {"id": "vol_down", "label": "🔉", "action": self.on_volume_down, "bg": "#d9b3ff"}, # Violet
                {"id": "vol_up", "label": "🔊", "action": self.on_volume_up, "bg": "#d9b3ff"},     # Violet
                {"id": "prev", "label": "⏮ Previous", "action": self.on_prev, "bg": "#80b3ff"},      # Darker Blue
                {"id": "next", "label": "⏭ Next", "action": self.on_next, "bg": "#80b3ff"},          # Darker Blue
                {"label": "⏹ Exit", "action": self.on_exit, "bg": "#ffb3b3"}                  # Light Red
            ]

    def _build_ui(self):
        if hasattr(self, "row") and self.row is not None:
             self.row.destroy()
        
        # Change bar background based on state
        bar_bg = "#2b0000" if self.menu_state == "comm" else "#111111"
        self.configure(bg=bar_bg)

        self.row = tk.Frame(self, bg=bar_bg)
        self.row.pack(expand=True, fill=tk.BOTH)
        self.tk_buttons.clear()
        
        # New: clear _btn_idx so we don't hold outdated IDs
        self._btn_idx.clear()

        for i, it in enumerate(self.items):
            # Use specific bg color if defined, else default light blue
            btn_bg = it.get("bg", "#e6f0ff")
            b = tk.Button(
                self.row,
                text=it["label"],
                font=BUTTON_FONT,
                bg=btn_bg,
                fg="#000",
                activebackground="#ffeb99",
                activeforeground="#000",
                command=it["action"],
                wraplength=800,
                justify="center",
                takefocus=0
            )
            b.pack(side=tk.LEFT, expand=True, fill=tk.BOTH, padx=8, pady=10)
            b._current_pady = 10
            self.tk_buttons.append(b)
            if "id" in it:
                self._btn_idx[it["id"]] = len(self.tk_buttons) - 1

    def _speak(self, text: str):
        if not text:
            return
        
        # Check shared voice settings
        if _voice_settings_available and not is_tts_enabled():
            return
        
        # Check for settings changes and reapply to both engines
        if _voice_settings_available and check_settings_changed():
            if _tts_engine:
                apply_voice_settings(_tts_engine)
            if self._sapi_voice:
                apply_sapi_voice_settings(self._sapi_voice)
        
        # Prefer SAPI via win32com for robust async/interrupt behavior
        if self._sapi_voice:
            try:
                # SVSFlagsAsync = 1, SVSFPurgeBeforeSpeak = 2
                # 1|2 ensures it returns immediately AND cuts off any previous speech
                self._sapi_voice.Speak(text, 1 | 2)
                return
            except Exception:
                pass

        # Fallback to pyttsx3 in a thread if SAPI failed or unavailable
        if _tts_engine:
            def _t():
                try:
                    # Cloning the engine per thread is safer or just hope for the best with the global
                    # pyttsx3 is finicky with threads. 
                    # Actually, if we are falling back, just try:
                    _tts_engine.stop()
                    _tts_engine.say(text)
                    _tts_engine.runAndWait()
                except Exception:
                    pass
            threading.Thread(target=_t, daemon=True).start()

    # ---------- Highlight helpers ----------
    def _highlight(self, idx: int):
        for i, b in enumerate(self.tk_buttons):
            is_active = (i == idx)
            target_bg = "#ffd84d" if is_active else self.items[i].get("bg", "#e6f0ff")
            target_pady = 2 if is_active else 10
            
            # Optimization: check current configured values to minimize layout thrashing
            current_bg = b.cget("bg")
            if current_bg != target_bg:
                b.configure(bg=target_bg)
            
            current_pady = getattr(b, "_current_pady", 10)
            if current_pady != target_pady:
                try:
                    b.pack_configure(pady=target_pady)
                    b._current_pady = target_pady
                except Exception:
                    pass

        self.update_idletasks()
        
        # TTS if definition exists for this item
        try:
            item = self.items[idx]
            if item.get("tts"):
                self._speak(item["tts"])
        except Exception:
            pass


    def _scan_forward(self):
        self.current_index = (self.current_index + 1) % len(self.tk_buttons)
        self._highlight(self.current_index)

    def _scan_backward(self):
        self.current_index = (self.current_index - 1) % len(self.tk_buttons)
        self._highlight(self.current_index)

    def _select_current(self):
        now = time.time()
        if now - self._last_action_ts < SCAN_DEBOUNCE:
            return
        
        try:
            self.items[self.current_index]["action"]()
        except Exception:
            pass
        finally:
            self._last_action_ts = time.time()

    def _refocus_bar(self):
        try:
            self.grab_set_global()
        except Exception:
            self.grab_set()
        try:
            hwnd = self.winfo_id()
            win32gui.SetForegroundWindow(hwnd)
        except Exception:
            pass
        self.focus_force()
        self.lift()
        self.update_idletasks()

    def _set_foreground_win32(self, hwnd: int):
        try:
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32

            GetWindowThreadProcessId = user32.GetWindowThreadProcessId
            GetForegroundWindow = user32.GetForegroundWindow
            AttachThreadInput = user32.AttachThreadInput
            SetForegroundWindow = user32.SetForegroundWindow
            SetFocus = user32.SetFocus
            BringWindowToTop = user32.BringWindowToTop

            fg = GetForegroundWindow()
            if fg == hwnd:
                return

            pid = wintypes.DWORD()
            fg_thread = GetWindowThreadProcessId(fg, ctypes.byref(pid))
            cur_thread = kernel32.GetCurrentThreadId()

            AttachThreadInput(cur_thread, fg_thread, True)
            try:
                try:
                    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                except Exception:
                    pass
                try:
                    win32gui.SetWindowPos(hwnd, win32con.HWND_TOPMOST, 0, 0, 0, 0,
                                          win32con.SWP_NOMOVE | win32con.SWP_NOSIZE)
                except Exception:
                    pass
                SetForegroundWindow(hwnd)
                BringWindowToTop(hwnd)
                SetFocus(hwnd)
            finally:
                AttachThreadInput(cur_thread, fg_thread, False)
        except Exception:
            try:
                win32gui.SetForegroundWindow(hwnd)
            except Exception:
                pass

    def _force_foreground(self):
        if not self.winfo_exists():
            return
        # Don't steal focus if automation is in progress
        if self._automation_in_progress:
            return
        try:
            self.attributes("-topmost", True)
        except Exception:
            pass
        try:
            self.grab_set_global()
        except Exception:
            self.grab_set()
        try:
            hwnd = self.winfo_id()
            self._set_foreground_win32(hwnd)
        except Exception:
            pass
        try:
            self.focus_force()
            self.lift()
        except Exception:
            pass
        self.update_idletasks()

    # ---------- Key handling ----------
    def _on_space_press(self, _evt=None):
        if self._space_pressed:
            return
        self._space_pressed = True
        self._space_press_time = time.time()
        self._space_hold_active = False
        def _check():
            if not self.winfo_exists() or not self._space_pressed:
                self._space_hold_job = None
                return
            if time.time() - self._space_press_time >= SPACE_HOLD_DELAY:
                self._space_hold_job = None
                self._space_hold_active = True
                self._space_hold_tick()
                return
            self._space_hold_job = self.after(100, _check)
        if not self._space_hold_job:
            self._space_hold_job = self.after(100, _check)

    def _on_space_release(self, _evt=None):
        was_holding = self._space_hold_active
        self._space_pressed = False
        
        if self._space_hold_job:
            try:
                self.after_cancel(self._space_hold_job)
            except Exception:
                pass
            self._space_hold_job = None
        
        # If we were in hold mode, just exit hold mode without scanning
        if was_holding:
            self._space_hold_active = False
            return
        
        # Check cooldown before allowing scan
        now = time.time()
        if now - self._last_action_ts < SCAN_DEBOUNCE:
            return
        
        self._last_action_ts = now  # Update timestamp BEFORE action
        self._scan_forward()

    def _space_hold_tick(self):
        if not self.winfo_exists() or not self._space_pressed:
            self._space_hold_active = False
            return
        
        # Check cooldown even for auto-scan
        now = time.time()
        if now - self._last_action_ts >= SCAN_DEBOUNCE:
            self._last_action_ts = now
            self._scan_backward()
        
        self._space_hold_job = self.after(int(SPACE_HOLD_REPEAT * 1000), self._space_hold_tick)

    def _on_return_press(self, _evt=None):
        pass

    def _on_return_release(self, _evt=None):
        # Check cooldown before allowing selection
        now = time.time()
        if now - self._last_action_ts < SCAN_DEBOUNCE:
            return
        self._select_current()

    # ---------- Housekeeping ----------
    def _watch_chrome(self):
        """
        Chrome watcher - periodically saves the current URL to last_watched.json.
        This ensures we don't lose our place even if the user watches multiple episodes.
        """
        print(f"[WATCH] Started Chrome watcher for show: {self.show_title}")
        
        last_saved_url = None
        save_interval = 30  # Save URL every 30 seconds
        ticks = 0
        
        while True:
            time.sleep(POLL_INTERVAL)
            if not self.winfo_exists():
                break
            
            running = is_chrome_running()
            if not running:
                print("[WATCH] Chrome not running, stopping watcher")
                break
                
            if getattr(self, "_restarting_chrome", False):
                continue
            
            ticks += 1
            
            # Every 30 seconds (save_interval / POLL_INTERVAL ticks), save the current URL
            if ticks >= int(save_interval / POLL_INTERVAL) and self.show_title:
                ticks = 0
                try:
                    url = self._grab_current_url_silent()
                    if url and url != last_saved_url:
                        if _safe_to_persist(url):
                            set_last_position(self.show_title, -1, -1, url)
                            last_saved_url = url
                            print(f"[WATCH] Auto-saved URL: {url[:60]}...")
                except Exception as e:
                    print(f"[WATCH] Error saving URL: {e}")

    def _grab_current_url_silent(self) -> Optional[str]:
        """
        Grab the current Chrome URL silently (without stealing focus or disrupting playback).
        Uses multiple methods in order of preference.
        """
        # Method 1: Try CDP first (fastest, no UI interaction)
        try:
            import requests
            r = requests.get("http://127.0.0.1:9222/json", timeout=0.5)
            if r.ok:
                for tab in r.json():
                    if tab.get("type") == "page":
                        url = tab.get("url", "")
                        if url and not url.startswith("chrome://") and "localhost" not in url:
                            if _safe_to_persist(url):
                                return url
        except:
            pass
        
        # Method 2: Read from the temp file (updated by server when episode changes via Next/Prev)
        try:
            if os.path.exists(CURRENT_URL_FILE):
                with open(CURRENT_URL_FILE, 'r') as f:
                    url = f.read().strip()
                    if url and _safe_to_persist(url):
                        return url
        except:
            pass
        
        return None

    def _raise_forever(self):
        if not self.winfo_exists():
            return
        try:
            self._force_foreground()
        except Exception:
            try:
                self.attributes("-topmost", True)
                self.lift()
            except Exception:
                pass
        _minimize_all_consoles()
        self.after(400, self._raise_forever)

    # ---------------- actions ----------------
    def _last_url_hint(self) -> Optional[str]:
        url = get_active_chrome_url_via_cdp()
        if url:
            return url
        if not self.show_title:
            return None
        # Try lowercase key (matches how Electron saves progress)
        lw = load_last_watched().get(self.show_title.lower().strip())
        if isinstance(lw, str):
            return lw
        if isinstance(lw, dict):
            return lw.get("url")
        return None

    def _update_prev_next_labels(self):
        prev_idx = self._btn_idx.get("prev")
        next_idx = self._btn_idx.get("next")
        # If we are in "comm" mode, these keys won't exist in _btn_idx, so just return
        if prev_idx is None or next_idx is None:
            return
        
        # Guard against index out of range if something weird happens
        if prev_idx >= len(self.tk_buttons) or next_idx >= len(self.tk_buttons):
            return

        # Always generic labels now
        self.tk_buttons[prev_idx].configure(text="⏮ Previous", state=tk.NORMAL)
        self.tk_buttons[next_idx].configure(text="⏭ Next", state=tk.NORMAL)

    def _pulse_labels(self):
        if not self.winfo_exists():
            return
        try:
            self._update_prev_next_labels()
        except Exception:
            pass
        self.after(1500, self._pulse_labels)

    def _send_key_to_chrome(self, key: str, modifiers: list = None) -> bool:
        """Send a key to Chrome by focusing it and using pyautogui.
        This is the most reliable method for controlling playback.
        
        Args:
            key: The key to send (e.g., 'space', 'left', 'right')
            modifiers: Optional list of modifier keys (e.g., ['shift'])
        """
        print(f"[_send_key_to_chrome] Sending key='{key}', modifiers={modifiers}, is_plex={self._cached_is_plex}")
        try:
            # Find and focus Chrome window
            chrome_hwnds = _enum_chrome_windows()
            if not chrome_hwnds:
                print("[_send_key_to_chrome] No Chrome window found")
                return False
            
            hwnd = chrome_hwnds[0]
            print(f"[_send_key_to_chrome] Found Chrome hwnd={hwnd}")
            
            # Get current foreground window to see if we already have focus
            current_fg = win32gui.GetForegroundWindow()
            print(f"[_send_key_to_chrome] Current foreground: {current_fg}, Chrome: {hwnd}")
            
            # Focus Chrome window using Alt trick (more reliable)
            try:
                ctypes.windll.user32.AllowSetForegroundWindow(-1)
                # Alt trick to allow focus change
                ctypes.windll.user32.keybd_event(0x12, 0, 0, 0)  # Alt down
                ctypes.windll.user32.keybd_event(0x12, 0, 2, 0)  # Alt up
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                win32gui.SetForegroundWindow(hwnd)
                print(f"[_send_key_to_chrome] Focused Chrome")
            except Exception as e:
                print(f"[_send_key_to_chrome] Focus failed: {e}")
                return False
            
            # Give Plex more time if needed (Plex seems slower to respond)
            delay = 0.3 if self._cached_is_plex else 0.15
            print(f"[_send_key_to_chrome] Waiting {delay}s for focus...")
            time.sleep(delay)
            
            # Verify focus switched
            new_fg = win32gui.GetForegroundWindow()
            print(f"[_send_key_to_chrome] New foreground: {new_fg}, expected: {hwnd}, match: {new_fg == hwnd}")
            
            # Send the key using pyautogui (most reliable)
            if modifiers:
                # Use hotkey for key combinations (e.g., shift+left, shift+right)
                pyautogui.hotkey(*modifiers, key)
                print(f"[_send_key_to_chrome] Hotkey {modifiers}+{key} sent via pyautogui")
            else:
                pyautogui.press(key)
                print(f"[_send_key_to_chrome] Key '{key}' sent via pyautogui")
            
            return True
        except Exception as e:
            print(f"[_send_key_to_chrome] Error: {e}")
            return False

    def _send_media_key_global(self, vk_code: int):
        """Send a media key globally using SendInput API (more reliable than keybd_event).
        
        Args:
            vk_code: Virtual key code (0xB3=play/pause, 0xB1=prev, 0xB0=next)
        """
        try:
            # Define INPUT structure for SendInput
            class KEYBDINPUT(ctypes.Structure):
                _fields_ = [
                    ("wVk", ctypes.c_ushort),
                    ("wScan", ctypes.c_ushort),
                    ("dwFlags", ctypes.c_ulong),
                    ("time", ctypes.c_ulong),
                    ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong))
                ]
            
            class INPUT(ctypes.Structure):
                _fields_ = [
                    ("type", ctypes.c_ulong),
                    ("ki", KEYBDINPUT)
                ]
            
            # Constants
            INPUT_KEYBOARD = 1
            KEYEVENTF_EXTENDEDKEY = 0x0001
            KEYEVENTF_KEYUP = 0x0002
            
            # Create key down event
            ki_down = KEYBDINPUT(
                wVk=vk_code,
                wScan=0,
                dwFlags=KEYEVENTF_EXTENDEDKEY,
                time=0,
                dwExtraInfo=ctypes.cast(0, ctypes.POINTER(ctypes.c_ulong))
            )
            input_down = INPUT(type=INPUT_KEYBOARD, ki=ki_down)
            
            # Create key up event
            ki_up = KEYBDINPUT(
                wVk=vk_code,
                wScan=0,
                dwFlags=KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP,
                time=0,
                dwExtraInfo=ctypes.cast(0, ctypes.POINTER(ctypes.c_ulong))
            )
            input_up = INPUT(type=INPUT_KEYBOARD, ki=ki_up)
            
            # Send both events
            inputs = (INPUT * 2)(input_down, input_up)
            result = ctypes.windll.user32.SendInput(2, ctypes.pointer(inputs), ctypes.sizeof(INPUT))
            print(f"[_send_media_key_global] SendInput result: {result} (expected 2)")
            
            if result != 2:
                print(f"[_send_media_key_global] WARNING: SendInput returned {result}, expected 2")
            
        except Exception as e:
            print(f"[_send_media_key_global] Error: {e}")

    def _focus_chrome_and_send_media_key(self, vk_code: int) -> bool:
        """Focus Chrome window and send a media key.
        
        Args:
            vk_code: Virtual key code (e.g., 0xB3 for play/pause)
        """
        try:
            # Find and focus Chrome window
            chrome_hwnds = _enum_chrome_windows()
            if not chrome_hwnds:
                print("[MediaKey] No Chrome window found")
                return False
            
            hwnd = chrome_hwnds[0]
            
            # Focus Chrome window
            try:
                ctypes.windll.user32.AllowSetForegroundWindow(-1)
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                win32gui.SetForegroundWindow(hwnd)
            except Exception as e:
                print(f"[MediaKey] Focus failed: {e}")
                return False
            
            # Brief pause to ensure focus
            time.sleep(0.05)
            
            # Send the media key
            win32api.keybd_event(vk_code, 0, 0, 0)
            win32api.keybd_event(vk_code, 0, 2, 0)
            
            return True
        except Exception as e:
            print(f"[MediaKey] Error: {e}")
            return False

    def _is_plex_now(self) -> bool:
        """
        Check if we're currently on Plex using multiple methods.
        Returns True if any method indicates Plex.
        This is a fallback check in case _cached_is_plex didn't get set properly.
        """
        # 1. Check cached value (fastest)
        if self._cached_is_plex:
            return True
        
        # 2. Check Chrome window title for "Plex"
        try:
            def check_title(hwnd, titles):
                if win32gui.IsWindowVisible(hwnd):
                    cls = win32gui.GetClassName(hwnd)
                    if cls == "Chrome_WidgetWin_1":
                        title = win32gui.GetWindowText(hwnd)
                        if title:
                            titles.append(title.lower())
                return True
            
            titles = []
            win32gui.EnumWindows(check_title, titles)
            if any("plex" in t for t in titles):
                log("[_is_plex_now] Detected Plex from Chrome window title")
                self._cached_is_plex = True  # Update cache
                return True
        except Exception as e:
            log(f"[_is_plex_now] Error checking window title: {e}")
        
        # 3. Check last_watched.json for this show
        if self.show_title:
            try:
                show_key = self.show_title.lower().strip()
                lw = load_last_watched()
                if show_key in lw:
                    saved_url = lw[show_key].get("url", "") if isinstance(lw[show_key], dict) else str(lw[show_key])
                    if _is_plex_url(saved_url):
                        log(f"[_is_plex_now] Detected Plex from last_watched for '{self.show_title}'")
                        self._cached_is_plex = True  # Update cache
                        return True
            except Exception as e:
                log(f"[_is_plex_now] Error checking last_watched: {e}")
        
        return False

    def on_prev(self):
        """Previous: Plex uses media key for prev episode, others use left arrow to skip back 10s."""
        is_plex = self._is_plex_now()
        log(f"[on_prev] called. is_plex={is_plex}")
        try:
            if is_plex:
                # Plex: Focus Plex Chrome first, then send media key
                log("[on_prev] Plex - focusing Plex Chrome before media key")
                focused = focus_plex_chrome()
                log(f"[on_prev] Plex Chrome focus result: {focused}")
                time.sleep(0.15)
                log("[on_prev] Plex - Sending VK_MEDIA_PREV_TRACK (0xB1)")
                win32api.keybd_event(0xB1, 0, 0, 0)
                win32api.keybd_event(0xB1, 0, 2, 0)
                log("[on_prev] Media key sent")
            else:
                # Other platforms: Focus Chrome and send left arrow to skip back 10s
                log("[on_prev] Non-Plex - Focusing Chrome and sending Left Arrow")
                if focus_chrome_window():
                    time.sleep(0.1)
                    pyautogui.press('left')
                    log("[on_prev] Left arrow sent via pyautogui")
                else:
                    log("[on_prev] Could not focus Chrome")
        except Exception as e:
            log(f"[on_prev] Error: {e}")
        self._refocus_for(1.0)

    def on_next(self):
        """Next: Plex uses media key for next episode, others use right arrow to skip forward 10s."""
        is_plex = self._is_plex_now()
        log(f"[on_next] called. is_plex={is_plex}")
        try:
            if is_plex:
                # Plex: Focus Plex Chrome first, then send media key
                log("[on_next] Plex - focusing Plex Chrome before media key")
                focused = focus_plex_chrome()
                log(f"[on_next] Plex Chrome focus result: {focused}")
                time.sleep(0.15)
                log("[on_next] Plex - Sending VK_MEDIA_NEXT_TRACK (0xB0)")
                win32api.keybd_event(0xB0, 0, 0, 0)
                win32api.keybd_event(0xB0, 0, 2, 0)
                log("[on_next] Media key sent")
            else:
                # Other platforms: Focus Chrome and send right arrow to skip forward 10s
                log("[on_next] Non-Plex - Focusing Chrome and sending Right Arrow")
                if focus_chrome_window():
                    time.sleep(0.1)
                    pyautogui.press('right')
                    log("[on_next] Right arrow sent via pyautogui")
                else:
                    log("[on_next] Could not focus Chrome")
        except Exception as e:
            log(f"[on_next] Error: {e}")
        self._refocus_for(1.0)

    def _refresh_buttons(self):
        self.items = self._make_items()
        self._build_ui()
        self.current_index = 0
        self._highlight(0)

    def on_toggle_menu_comm(self):
        self.menu_state = "comm"
        # Pause playback using cached websocket or media key - instant
        if self._cached_ws_url:
            try:
                js = "(() => { const v = document.querySelector('video'); if (v && !v.paused) { v.pause(); } })();"
                cdp_runtime_eval(self._cached_ws_url, js)
            except Exception:
                pass
        else:
            # Use media key for pause
            try:
                 win32api.keybd_event(0xB3, 0, 0, 0)  # VK_MEDIA_PLAY_PAUSE
                 win32api.keybd_event(0xB3, 0, 2, 0)
            except:
                pass

        self._refresh_buttons()

    def on_toggle_menu_player(self):
        self.menu_state = "player"
        self._refresh_buttons()

    def on_help_tts(self):
        if _voice_settings_available and not is_tts_enabled():
            self._refocus_bar()
            return
        # Use class SAPI voice with interrupt flag to prevent queuing
        if self._sapi_voice:
            try:
                if _voice_settings_available:
                    apply_sapi_voice_settings(self._sapi_voice)
                # SVSFlagsAsync = 1, SVSFPurgeBeforeSpeak = 2 (interrupts any current speech)
                self._sapi_voice.Speak("I need help", 1 | 2)
            except Exception:
                pass
        elif _win32com_client:
            try:
                speaker = _win32com_client.Dispatch("SAPI.SpVoice")
                if _voice_settings_available:
                    apply_sapi_voice_settings(speaker)
                speaker.Speak("I need help", 1 | 2)
            except Exception:
                pass
        self._refocus_bar()

    def on_suction_tts(self):
        if _voice_settings_available and not is_tts_enabled():
            self._refocus_bar()
            return
        # Use class SAPI voice with interrupt flag to prevent queuing
        if self._sapi_voice:
            try:
                if _voice_settings_available:
                    apply_sapi_voice_settings(self._sapi_voice)
                # SVSFlagsAsync = 1, SVSFPurgeBeforeSpeak = 2 (interrupts any current speech)
                self._sapi_voice.Speak("I need suction", 1 | 2)
            except Exception:
                pass
        elif _win32com_client:
            try:
                speaker = _win32com_client.Dispatch("SAPI.SpVoice")
                if _voice_settings_available:
                    apply_sapi_voice_settings(speaker)
                speaker.Speak("I need suction", 1 | 2)
            except Exception:
                pass
        self._refocus_bar()

    def _write_nav_signal(self, signal_data: dict):
        """Write navigation signal for Electron hub to pick up."""
        try:
            # Get absolute path to bennyshub folder (this file is in bennyshub/apps/tools/streaming/utils/)
            # Go up 4 levels: utils -> streaming -> tools -> apps -> bennyshub
            current_file = os.path.abspath(__file__)
            bennyshub_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(current_file)))))
            nav_file = os.path.join(bennyshub_dir, "nav_signal.json")

            # Only stamp a timestamp if the caller hasn't already fixed one
            # (_write_nav_signal_repeated reuses a single timestamp across
            # retries so Electron's dedup treats them as the same event).
            signal_data.setdefault("timestamp", time.time())

            with open(nav_file, 'w') as f:
                json.dump(signal_data, f)

            print(f"[CONTROL-BAR] Navigation signal written to {nav_file}: {signal_data}")
        except Exception as e:
            print(f"[CONTROL-BAR] Error writing nav signal: {e}")

    def _write_nav_signal_repeated(self, signal_data: dict, attempts: int = 3, interval: float = 0.35):
        """Write the nav signal several times, reusing one timestamp.

        This project's folder lives inside a live-synced OneDrive folder, and
        Electron's watcher only reads the file on a 300ms poll with no retry
        of its own - a single transient read miss (e.g. sync I/O touching the
        file) leaves the hub stuck showing whatever was on screen. Repeating
        the write gives the watcher several clean chances to catch it.

        The timestamp is fixed once up front (not regenerated per attempt) so
        Electron's `signal.timestamp > lastNavTimestamp` dedup only acts on it
        once - otherwise every retry looks like a brand-new signal and each
        one re-triggers mainWindow.focus()/setFullScreen(), which desyncs OS
        keyboard focus from the renderer (spacebar/enter stop working).
        """
        signal_data = dict(signal_data)
        signal_data["timestamp"] = time.time()
        for i in range(attempts):
            self._write_nav_signal(dict(signal_data))
            if i < attempts - 1:
                time.sleep(interval)

    def on_open_keyboard(self):
        """Close Chrome and navigate the Electron hub to the keyboard app."""
        try:
            # Save URL before closing (same as exit button)
            self._save_url_before_close("keyboard")
            
            self.withdraw()
            # Close Chrome browser
            _kill_chrome_gracefully()
            time.sleep(0.3)

            # Write navigation signal for keyboard (repeated - see
            # _write_nav_signal_repeated for why a single write isn't reliable)
            self._write_nav_signal_repeated({
                "target": "keyboard",
                "path": "apps/tools/keyboard/index.html",
                "title": "Keyboard"
            })

            # Aggressively focus the Electron app
            self._force_focus_electron_app()

        except Exception as e:
            print(f"Error navigating to keyboard: {e}")

        os._exit(0)

    def on_open_messenger(self):
        """Close Chrome and navigate the Electron hub to the messenger app.

        The messenger now runs as an iframe tool inside the hub (backend.py +
        index.html/app.js), the same as every other tool — there's no separate
        ben_discord_app.py process to launch anymore. Same nav-signal pattern
        as on_open_keyboard."""
        try:
            # Save URL before closing (same as exit button)
            self._save_url_before_close("messenger")

            self.withdraw()
            # Close Chrome browser
            _kill_chrome_gracefully()
            time.sleep(0.3)

            # Write navigation signal for messenger (repeated - see
            # _write_nav_signal_repeated for why a single write isn't reliable)
            self._write_nav_signal_repeated({
                "target": "messenger",
                "path": "apps/tools/messenger/index.html",
                "title": "Messenger"
            })

            # Aggressively focus the Electron app
            self._force_focus_electron_app()

        except Exception as e:
            print(f"Error navigating to messenger: {e}")

        os._exit(0)

    def on_close_all(self):
        """Close Chrome and return to the Electron hub main menu."""
        try:
            # Save URL before closing (same as exit button)
            self._save_url_before_close("close_all")
            
            self.withdraw()
            # Close Chrome browser
            _kill_chrome_gracefully()
            time.sleep(0.3)

            # Write navigation signal to return to main menu (repeated - see
            # _write_nav_signal_repeated for why a single write isn't reliable)
            self._write_nav_signal_repeated({
                "action": "close",
                "target": "menu"
            })

            # Aggressively focus the Electron app
            self._force_focus_electron_app()

        except Exception as e:
            print(f"Error closing: {e}")

        os._exit(0)
    
    def _save_url_before_close(self, source="unknown"):
        """Save the current URL before closing Chrome (shared logic for exit/keyboard/messenger/close_all)."""
        log(f"[{source}] Saving URL, show_title={self.show_title}")
        
        # Check if this is Plex content by looking at last_watched.json
        is_plex = False
        if self.show_title:
            try:
                show_key = self.show_title.lower().strip()
                lw = load_last_watched()
                if show_key in lw:
                    saved_url = lw[show_key].get("url", "") if isinstance(lw[show_key], dict) else str(lw[show_key])
                    is_plex = "plex" in saved_url.lower()
            except:
                pass
        
        if is_plex:
            log(f"[{source}] Plex content - skipping URL grab")
            return
        
        if not self.show_title:
            log(f"[{source}] No show title - skipping URL grab")
            return
        
        # Non-Plex content - try to grab URL using multiple methods
        log(f"[{source}] Non-Plex content - grabbing URL...")
        url = None
        
        # Method 1: Try CDP first (fastest, no UI disruption)
        try:
            url = self._grab_current_url_silent()
            if url:
                log(f"[{source}] Got URL via CDP/file: {url[:60]}...")
        except Exception as e:
            log(f"[{source}] CDP method failed: {e}")
        
        # Method 2: If CDP failed, try clipboard method
        if not url:
            try:
                url = get_chrome_url_via_clipboard()
                if url:
                    log(f"[{source}] Got URL via clipboard: {url[:60]}...")
            except Exception as e:
                log(f"[{source}] Clipboard method failed: {e}")
        
        # Method 3: If still no URL, try reading from current_url.txt file
        if not url:
            try:
                url = get_current_url_from_file()
                if url:
                    log(f"[{source}] Got URL from file: {url[:60]}...")
            except Exception as e:
                log(f"[{source}] File method failed: {e}")
        
        log(f"[{source}] Final URL: {url}")
        if url:
            is_safe = _safe_to_persist(url)
            log(f"[{source}] URL safe to persist: {is_safe}")
            if is_safe:
                # DIRECT FILE WRITE - bypass helper function to ensure it works
                try:
                    show_key = self.show_title.lower().strip()
                    data = {}
                    if os.path.exists(LAST_WATCHED_FILE):
                        with open(LAST_WATCHED_FILE, 'r') as f:
                            data = json.load(f)
                    
                    # Remove old entry so new one goes to end
                    if show_key in data:
                        del data[show_key]
                    
                    data[show_key] = {
                        "season": -1,
                        "episode": -1,
                        "url": url,
                        "timestamp": int(time.time() * 1000)
                    }
                    
                    os.makedirs(os.path.dirname(LAST_WATCHED_FILE), exist_ok=True)
                    with open(LAST_WATCHED_FILE, 'w') as f:
                        json.dump(data, f, indent=2)
                    
                    log(f"[{source}] ✓ SAVED: {show_key} → {url[:60]}...")
                except Exception as write_err:
                    log(f"[{source}] Direct write failed: {write_err}")
                    # Try the helper as backup
                    set_last_position(self.show_title, -1, -1, url)
            else:
                log(f"[{source}] URL not in allowed list: {url}")
        else:
            log(f"[{source}] Could not get URL from any method")

    def _force_focus_electron_app(self):
        """Aggressively bring Electron app to foreground."""
        try:
            # Find Electron/Benny's Hub window
            target_hwnd = None
            def _enum(hwnd, _):
                nonlocal target_hwnd
                try:
                    if win32gui.IsWindowVisible(hwnd):
                        title = win32gui.GetWindowText(hwnd) or ""
                        if "Benny's Access Hub" in title or "NARBE" in title:
                            target_hwnd = hwnd
                except Exception:
                    pass
            win32gui.EnumWindows(_enum, None)
            
            if not target_hwnd:
                return
            
            # Use multiple techniques to force focus
            try:
                # Minimize then restore to force to front
                win32gui.ShowWindow(target_hwnd, win32con.SW_MINIMIZE)
                time.sleep(0.05)
                win32gui.ShowWindow(target_hwnd, win32con.SW_RESTORE)
            except Exception:
                pass
            
            try:
                # Bring to top
                win32gui.BringWindowToTop(target_hwnd)
            except Exception:
                pass
            
            try:
                # Set as topmost temporarily then remove topmost
                win32gui.SetWindowPos(target_hwnd, win32con.HWND_TOPMOST, 0, 0, 0, 0,
                                      win32con.SWP_NOMOVE | win32con.SWP_NOSIZE)
                win32gui.SetWindowPos(target_hwnd, win32con.HWND_NOTOPMOST, 0, 0, 0, 0,
                                      win32con.SWP_NOMOVE | win32con.SWP_NOSIZE)
            except Exception:
                pass
            
            try:
                # Use AllowSetForegroundWindow and SetForegroundWindow
                ctypes.windll.user32.AllowSetForegroundWindow(-1)  # ASFW_ANY
                win32gui.SetForegroundWindow(target_hwnd)
            except Exception:
                pass
            
            try:
                # Simulate Alt key to allow focus change
                win32api.keybd_event(0x12, 0, 0, 0)  # Alt down
                win32api.keybd_event(0x12, 0, 2, 0)  # Alt up
                win32gui.SetForegroundWindow(target_hwnd)
            except Exception:
                pass
                
        except Exception as e:
            print(f"Error focusing Electron app: {e}")

    def on_play_pause(self):
        """Toggle play/pause - Media key for Plex (after focusing), spacebar for others."""
        is_plex = self._is_plex_now()
        log(f"[on_play_pause] called. is_plex={is_plex}")
        try:
            if is_plex:
                # Plex: Focus Plex Chrome first, then send media key
                log("[on_play_pause] Plex - focusing Plex Chrome before media key")
                focused = focus_plex_chrome()
                log(f"[on_play_pause] Plex Chrome focus result: {focused}")
                time.sleep(0.15)
                log("[on_play_pause] Plex - sending VK_MEDIA_PLAY_PAUSE (0xB3)")
                win32api.keybd_event(0xB3, 0, 0, 0)
                win32api.keybd_event(0xB3, 0, 2, 0)
                log("[on_play_pause] Media key sent")
            else:
                # Non-Plex: Focus Chrome and send spacebar
                log("[on_play_pause] Non-Plex - focusing Chrome and sending spacebar")
                focused = focus_chrome_window()
                log(f"[on_play_pause] Chrome focus result: {focused}")
                if focused:
                    time.sleep(0.15)
                    pyautogui.press('space')
                    log("[on_play_pause] Spacebar sent")
                else:
                    log("[on_play_pause] Could not focus Chrome")
        except Exception as e:
            log(f"[on_play_pause] Error: {e}")
        self._refocus_for(1.0)
    
    def _last_url_hint(self) -> Optional[str]:
        """Get URL hint for CDP - checks active Chrome URL first, then last_watched."""
        url = get_active_chrome_url_via_cdp()
        if url:
            return url
        if not self.show_title:
            return None
        lw = load_last_watched().get(self.show_title.lower().strip() if self.show_title else "")
        if isinstance(lw, str):
            return lw
        if isinstance(lw, dict):
            return lw.get("url")
        return None

    def on_volume_up(self):
        """Increase volume - INSTANT response."""
        try:
            win32api.keybd_event(0xAF, 0, 0, 0)  # VK_VOLUME_UP
            win32api.keybd_event(0xAF, 0, 2, 0)
            win32api.keybd_event(0xAF, 0, 0, 0)
            win32api.keybd_event(0xAF, 0, 2, 0)
        except Exception:
            pass
        self.after(20, self._refocus_bar)

    def on_volume_down(self):
        """Decrease volume - INSTANT response."""
        try:
            win32api.keybd_event(0xAE, 0, 0, 0)  # VK_VOLUME_DOWN
            win32api.keybd_event(0xAE, 0, 2, 0)
            win32api.keybd_event(0xAE, 0, 0, 0)
            win32api.keybd_event(0xAE, 0, 2, 0)
        except Exception:
            pass
        self.after(20, self._refocus_bar)

    def on_fullscreen_toggle(self):
        # Use cached websocket for instant response
        ws = self._cached_ws_url
        done = False
        if ws and websocket:
            try:
                w = websocket.create_connection(ws, timeout=0.15)
                try:
                    _cdp_send(w, "Input.dispatchKeyEvent", {"type": "keyDown", "key": "f", "code": "KeyF", "windowsVirtualKeyCode": 0x46, "keyCode": 0x46}, 1, 0.1)
                    _cdp_send(w, "Input.dispatchKeyEvent", {"type": "keyUp", "key": "f", "code": "KeyF", "windowsVirtualKeyCode": 0x46, "keyCode": 0x46}, 2, 0.1)
                    done = True
                finally:
                    try: w.close()
                    except Exception: pass
            except Exception:
                done = False
        if not done:
            # Fallback to keyboard - send F11 for browser fullscreen
            try:
                win32api.keybd_event(0x7A, 0, 0, 0)  # VK_F11
                win32api.keybd_event(0x7A, 0, 2, 0)
            except Exception:
                pass
        self.after(20, self._refocus_bar)

    def on_mute_toggle(self):
        pass

    def on_exit(self):
        # Save URL before closing (shared logic)
        self._save_url_before_close("Exit")

        # 1. Hide the control bar
        try:
            self.withdraw()
            self.update_idletasks()
        except Exception:
            pass

        # 2. Close Chrome windows
        try:
            _kill_chrome_gracefully()
        except Exception:
            pass

        # 3. Send a signal that only makes Electron restore/focus/fullscreen
        # itself - Exit must land back on whatever the streaming iframe was
        # already showing (recently-watched/catalog), NOT the hub home menu.
        # "focus_home" intentionally matches none of the action/target/path
        # branches handleNavSignal() checks for in index.html, so the iframe
        # is left untouched; only Close All should use {"action": "close"}.
        try:
            self._write_nav_signal_repeated({
                "action": "focus_home"
            })
        except Exception:
            pass

        # 4. Focus Electron
        try:
            self._force_focus_electron_app()
        except Exception:
            pass

        # 5. Exit
        os._exit(0)

    def _apply_post_nav(self, prof: PlatformProfile) -> bool:
        """Apply post-navigation keys for platform (e.g., x,enter,p,f for Plex, f for YouTube).
        
        For keyboard-preferred platforms (Disney+, Netflix, etc.), these services auto-play
        and auto-fullscreen, so we skip the CDP automation and post_nav keys to avoid
        accidentally pausing the video.
        """
        # Check if this platform prefers keyboard and has no post_nav keys
        # These platforms (Disney+, Netflix, etc.) auto-play and auto-fullscreen
        post_nav_keys = prof.get("post_nav") or []
        if prof.get("use_keyboard", False) and not post_nav_keys:
            print(f"[PostNav] Skipping for {prof.get('name', 'Unknown')} - auto-plays, no post_nav needed")
            return True
        
        # For platforms that need CDP automation (Plex, YouTube)
        ok = False
        ws = self._cached_ws_url  # Use cached websocket
        if ws and not prof.get("use_keyboard", False):
            try:
                ok = cdp_ensure_play_and_fullscreen(ws)
            except Exception:
                ok = False
        if ok:
            return True
        
        # If no post_nav keys to send, we're done
        if not post_nav_keys:
            return True

        played_fullscreen = False
        if focus_chrome_window():
            try:
                time.sleep(0.3)
                # Click center to ensure focus
                try:
                    hwnd = win32gui.GetForegroundWindow()
                    l, t, r, b = win32gui.GetWindowRect(hwnd)
                    cx, cy = max(0, (l + r) // 2), max(0, (t + b) // 2)
                    pyautogui.click(cx, cy)
                except Exception:
                    sw, sh = pyautogui.size()
                    pyautogui.click(sw // 2, sh // 2)
                time.sleep(0.3)

                def _vk_for(k: str) -> Optional[int]:
                    if not k:
                        return None
                    k = k.lower()
                    if k in ("enter", "return"):
                        return 0x0D
                    if k in ("space",):
                        return 0x20
                    if len(k) == 1 and "a" <= k <= "z":
                        return ord(k.upper())
                    return None

                # Send post_nav keys with proper delays (1 second for Plex sequence)
                platform_name = prof.get("name", "").lower()
                
                # Use longer delays for Plex (x, enter, p, f needs time between each)
                key_delay = 1.0 if platform_name == "plex" else 0.3
                
                for key in post_nav_keys:
                    vk = _vk_for(str(key))
                    if vk is None:
                        continue
                    print(f"[PostNav] Pressing '{key}' (VK={hex(vk)})")
                    win32api.keybd_event(vk, 0, 0, 0)
                    win32api.keybd_event(vk, 0, 2, 0)
                    time.sleep(key_delay)

                played_fullscreen = True
            except Exception as e:
                print(f"[PostNav] Error: {e}")
                played_fullscreen = False

        # Only refocus bar if NOT during bootstrap automation
        # During bootstrap, focus management will be started separately
        if not getattr(self, '_automation_in_progress', False):
            self._refocus_for(1.5)
        return played_fullscreen

    def _ensure_fullscreen_once(self, prof: PlatformProfile):
        # Use cached websocket for instant response
        try:
            ws = self._cached_ws_url
            if ws:
                cdp_ensure_play_and_fullscreen(ws)
                return
        except Exception:
            pass
        # Fallback: send F11
        try:
            win32api.keybd_event(0x7A, 0, 0, 0)  # VK_F11
            win32api.keybd_event(0x7A, 0, 2, 0)
        except Exception:
            pass
        self._refocus_bar()

    def _refocus_for(self, seconds: float):
        t_end = time.time() + max(0.1, float(seconds))
        def pump():
            if not self.winfo_exists():
                return
            self._refocus_bar()
            if time.time() < t_end:
                self.after(120, pump)
        pump()

# ------------------------------ Main ------------------------------

def main():
    global APP_TITLE_MAIN
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["basic", "episodes"], default="basic")
    ap.add_argument("--show", type=str, default=None, help="Show title (ignored for spreadsheet stepping)")
    ap.add_argument("--cdp", action="store_true", help="Launch Chrome with --remote-debugging-port=9222 for best results")
    ap.add_argument("--app-title", type=str, default=None, help="Title of the main app to refocus on exit")
    ap.add_argument("--delay", type=float, default=0.0, help="Seconds to wait before showing the bar")
    args = ap.parse_args()

    log(f"[MAIN] Control bar starting with args: mode={args.mode}, show={args.show}, delay={args.delay}")

    if args.delay > 0:
        log(f"[MAIN] Waiting {args.delay} seconds before showing bar...")
        time.sleep(args.delay)

    if args.app_title:
        APP_TITLE_MAIN = args.app_title

    log(f"[MAIN] Creating ControlBar for show: {args.show}")
    app = ControlBar(args.mode, args.show)
    log("[MAIN] Starting mainloop...")
    app.mainloop()
    log("[MAIN] Mainloop ended")


if __name__ == "__main__":
    main()

