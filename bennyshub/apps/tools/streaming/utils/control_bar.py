import argparse
import os
import sys
import time
import json
import threading
import subprocess
from typing import Optional, Dict, Any, List

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

def _close_chrome_window_gracefully():
    """
    Close Chrome window gracefully using keyboard shortcuts.
    This avoids the 'Restore pages' error on next launch.
    """
    try:
        # First, focus Chrome
        chrome_hwnds = _enum_chrome_windows()
        if not chrome_hwnds:
            return True  # No Chrome windows to close
        
        # Focus the Chrome window
        hwnd = chrome_hwnds[0]
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            win32gui.SetForegroundWindow(hwnd)
            time.sleep(0.2)
        except Exception:
            pass
        
        # Send Alt+F4 to close the window gracefully (this lets Chrome save session properly)
        try:
            # Alt down
            win32api.keybd_event(0x12, 0, 0, 0)  # VK_MENU (Alt)
            time.sleep(0.05)
            # F4 down
            win32api.keybd_event(0x73, 0, 0, 0)  # VK_F4
            time.sleep(0.05)
            # F4 up
            win32api.keybd_event(0x73, 0, 2, 0)
            # Alt up
            win32api.keybd_event(0x12, 0, 2, 0)
            time.sleep(0.3)
        except Exception as e:
            print(f"[Chrome] Alt+F4 failed: {e}")
        
        # Wait for Chrome to close gracefully
        start_wait = time.time()
        while time.time() - start_wait < 3.0:
            if not is_chrome_running():
                print("[Chrome] Closed gracefully")
                return True
            time.sleep(0.2)
        
        # If still running, try WM_CLOSE as fallback
        chrome_hwnds = _enum_chrome_windows()
        for hwnd in chrome_hwnds:
            try:
                win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
            except Exception:
                pass
        
        # Final wait
        time.sleep(1.0)
        return not is_chrome_running()
        
    except Exception as e:
        print(f"[Chrome] Error closing: {e}")
        return False


def _kill_chrome_gracefully():
    """
    Attempts to close Chrome windows gracefully first, then force kills if any remain.
    This helps avoid the 'Restore pages' bubble on next launch.
    """
    # Try the gentle approach first
    if _close_chrome_window_gracefully():
        return
    
    # If still running, try WM_CLOSE on remaining windows
    chrome_hwnds = _enum_chrome_windows()
    if chrome_hwnds:
        for hwnd in chrome_hwnds:
            try:
                win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
            except Exception:
                pass
        
        # Give it a moment to write session files
        start_wait = time.time()
        while time.time() - start_wait < 2.0:
            if not is_chrome_running():
                return
            time.sleep(0.2)
    
    # Only force kill as absolute last resort (avoid if possible)
    # This can cause the "restore pages" message
    print("[Chrome] Warning: Force killing Chrome - may cause restore message")
    for p in psutil.process_iter(['name']):
        if "chrome" in (p.info['name'] or "").lower():
            try:
                p.terminate()
            except Exception:
                pass

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
APP_TITLE_MAIN = "Accessible Menu"  # comm-v10.py window title

BUTTON_FONT = ("Arial Black", 20)   # was 16; ~25% larger
BAR_HEIGHT = 88                     # was 70; ~25% taller
BAR_OPACITY = 0.96
POLL_INTERVAL = 0.75
SCAN_DEBOUNCE = 0.35  # seconds after a scan/select before we accept another
SPACE_HOLD_DELAY = 3.0   # seconds to hold before auto-scan starts
SPACE_HOLD_REPEAT = 2.0  # repeat interval while holding Space

# Disable spreadsheet-driven navigation entirely
USE_SPREADSHEET_NAV = False

# ------------------------------ Platform profiles ------------------------------
PlatformProfile = Dict[str, Any]

PROFILES: List[PlatformProfile] = [
    {"name": "YouTube", "match": ["youtube.com", "youtu.be"],
     "playpause": ["k", "space"], "fullscreen": ["f"], "post_nav": ["f"]},
    {"name": "Disney+", "match": ["disneyplus.com"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": ["f"]},
    {"name": "Netflix", "match": ["netflix.com"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": ["f"]},
    {"name": "Prime Video", "match": ["primevideo.com", "amazon.com"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": ["f"]},
    {"name": "Hulu", "match": ["hulu.com"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": ["f"]},
    {"name": "Paramount+", "match": ["paramountplus.com"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": ["f"]},
    {"name": "Max", "match": ["max.com", "hbomax.com"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": ["f"]},
    {"name": "PlutoTV", "match": ["pluto.tv"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": ["m", "f"]},
    {"name": "Plex", "match": ["plex.tv", "app.plex.tv", ":32400"],
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": ["x", "enter", "p", "f"]},
    {"name": "Generic", "match": ["."],  # fallback
     "playpause": ["space"], "fullscreen": ["f"], "post_nav": ["f"]},
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
        if ("plex.tv" in host) or ("plex.direct" in host) or host.startswith("127.0.0.1"):
            return False
        allowed = [
            "netflix.com","disneyplus.com","paramountplus.com","primevideo.com","amazon.com",
            "hulu.com","max.com","hbomax.com","pluto.tv","youtube.com","youtu.be"
        ]
        return any(h in host for h in allowed)
    except Exception:
        return False

def set_last_position(show_title: str, season: int, episode: int, url: str, linear_index: Optional[int] = None):
    # Only persist if the URL is allowed
    if not _safe_to_persist(url):
        return
    data = load_last_watched()
    rec = {"season": int(season), "episode": int(episode), "url": url}
    if linear_index is not None:
        rec["linear_index"] = int(linear_index)
    data[show_title] = rec
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(LAST_WATCHED_FILE, "w") as f:
        json.dump(data, f, indent=2)

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
    """Find ALL Chrome windows regardless of title."""
    handles: List[int] = []
    def _enum(hwnd, _res):
        try:
            if not win32gui.IsWindowVisible(hwnd):
                return
            # Check if window belongs to chrome.exe process
            try:
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                proc = psutil.Process(pid)
                if proc.name().lower() == "chrome.exe":
                    handles.append(hwnd)
            except Exception:
                pass
        except Exception:
            pass
    win32gui.EnumWindows(_enum, None)
    return handles

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


def focus_chrome_window() -> bool:
    for hwnd in _enum_chrome_windows():
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            win32gui.SetForegroundWindow(hwnd)
            time.sleep(0.05)
            return True
        except Exception:
            continue
    return False


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
    if not requests:
        return None
    try:
        r = requests.get("http://127.0.0.1:9222/json", timeout=0.3)
        tabs = r.json() if r.ok else []
        for t in tabs:
            if t.get("type") == "page" and t.get("url"):
                return t.get("url")
    except Exception:
        return None
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
    js = """
(() => { const v = document.querySelector('video'); if (!v) return 'no video';
  if (v.paused) { try{v.play();}catch(e){} return 'play'; } else { v.pause(); return 'pause'; } })();
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
            win32api.keybd_event(0xB3, 0, 0, 0)
            win32api.keybd_event(0xB3, 0, 2, 0)
        except Exception:
            pass

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

        # One-shot bootstrap: Apply post-navigation keys (x,enter,p,f for Plex, f for fullscreen, etc.)
        # This runs FIRST, before any focus-stealing mechanisms
        def _bootstrap_once():
            self._automation_in_progress = True
            try:
                url = self._last_url_hint()
                prof = get_profile_for_url(url)
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
        self._space_pressed = False
        if self._space_hold_job:
            try:
                self.after_cancel(self._space_hold_job)
            except Exception:
                pass
            self._space_hold_job = None
        if self._space_hold_active:
            self._space_hold_active = False
            return
        
        now = time.time()
        if now - self._last_action_ts < SCAN_DEBOUNCE:
            return
        
        self._scan_forward()
        # Update timestamp AFTER logic to prevent stacked events if processing is slow
        self._last_action_ts = time.time()

    def _space_hold_tick(self):
        if not self.winfo_exists() or not self._space_pressed:
            self._space_hold_active = False
            return
        self._scan_backward()
        self._space_hold_job = self.after(int(SPACE_HOLD_REPEAT * 1000), self._space_hold_tick)

    def _on_return_press(self, _evt=None):
        pass

    def _on_return_release(self, _evt=None):
        self._select_current()

    # ---------- Housekeeping ----------
    def _watch_chrome(self):
        while True:
            time.sleep(POLL_INTERVAL)
            if not self.winfo_exists():
                break
            running = is_chrome_running()
            if getattr(self, "_restarting_chrome", False):
                continue

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

    def _send_media_prev_next(self, direction: str) -> bool:
        # Fallback to global media keys
        try:
            vk = 0xB0 if (direction or "").lower() == "next" else 0xB1
            win32api.keybd_event(vk, 0, 0, 0)
            win32api.keybd_event(vk, 0, 2, 0)
            return True
        except Exception:
            return False

    def on_prev(self):
        self._send_media_prev_next("previous")
        self._refocus_for(1.0)

    def on_next(self):
        self._send_media_prev_next("next")
        self._refocus_for(1.0)

    def _refresh_buttons(self):
        self.items = self._make_items()
        self._build_ui()
        self.current_index = 0
        self._highlight(0)

    def on_toggle_menu_comm(self):
        self.menu_state = "comm"
        # Pause playback explicitly
        ws = cdp_find_ws(self._last_url_hint())
        if ws:
            try:
                # Force pause
                js = "(() => { const v = document.querySelector('video'); if (v && !v.paused) { v.pause(); } })();"
                cdp_runtime_eval(ws, js)
            except Exception:
                pass
        else:
            # Fallback toggle if no CDP (assume it was playing)
            # on_play_pause toggle logic is complex, let's just trigger play/pause key
            try:
                 win32api.keybd_event(0xB3, 0, 0, 0) # VK_MEDIA_PLAY_PAUSE
                 win32api.keybd_event(0xB3, 0, 2, 0)
            except: pass

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
            # Path: streaming/utils -> streaming -> tools -> apps -> bennyshub
            nav_file = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "nav_signal.json")
            nav_file = os.path.abspath(nav_file)
            signal_data["timestamp"] = time.time()
            
            with open(nav_file, 'w') as f:
                json.dump(signal_data, f)
            
            print(f"[CONTROL-BAR] Navigation signal written: {signal_data}")
        except Exception as e:
            print(f"[CONTROL-BAR] Error writing nav signal: {e}")

    def on_open_keyboard(self):
        """Close Chrome and navigate the Electron hub to the keyboard app."""
        try:
            self.withdraw()
            # Close Chrome browser
            _kill_chrome_gracefully()
            time.sleep(0.3)
            
            # Write navigation signal for keyboard
            self._write_nav_signal({
                "target": "keyboard",
                "path": "apps/tools/keyboard/index.html",
                "title": "Keyboard"
            })
            
        except Exception as e:
            print(f"Error navigating to keyboard: {e}")
        
        os._exit(0)

    def on_open_messenger(self):
        """Close Chrome, launch ben_discord_app.py directly, and exit."""
        try:
            self.withdraw()
            # Close Chrome browser
            _kill_chrome_gracefully()
            time.sleep(0.3)
            
            # Launch ben_discord_app.py directly
            discord_app_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "messenger", "ben_discord_app.py"))
            subprocess.Popen(["pythonw", discord_app_path], cwd=os.path.dirname(discord_app_path))
            
        except Exception as e:
            print(f"Error launching messenger: {e}")
        
        os._exit(0)

    def on_close_all(self):
        """Close Chrome and return to the Electron hub main menu."""
        try:
            self.withdraw()
            # Close Chrome browser
            _kill_chrome_gracefully()
            time.sleep(0.3)
            
            # Write navigation signal to return to main menu
            self._write_nav_signal({
                "action": "close",
                "target": "menu"
            })
            
            # Aggressively focus the Electron app
            time.sleep(0.2)
            self._force_focus_electron_app()
            
        except Exception as e:
            print(f"Error closing: {e}")
        
        os._exit(0)

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
                        if "Benny" in title or "Hub" in title:
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
        if not self._activated_once:
            self._activated_once = True
            did = False
            ws = cdp_find_ws(self._last_url_hint())
            if ws:
                did = cdp_click_center(ws)
                cdp_ensure_play_and_fullscreen(ws)
            else:
                try:
                    sw, sh = pyautogui.size()
                    pyautogui.click(sw // 2, sh // 2)
                    did = True
                except Exception:
                    pass
            self._refocus_bar()
            if did:
                return
        ws = cdp_find_ws(self._last_url_hint())
        ok = cdp_toggle_play(ws)
        if not ok:
            send_to_chrome([" "])
        self._refocus_bar()

    def on_volume_up(self):
        ws = cdp_find_ws(self._last_url_hint())
        if not cdp_adjust_volume(ws, 0.1):
            try:
                for _ in range(5):
                    win32api.keybd_event(0xAF, 0, 0, 0)
                    win32api.keybd_event(0xAF, 0, 2, 0)
            except Exception:
                pass
        self._refocus_bar()

    def on_volume_down(self):
        ws = cdp_find_ws(self._last_url_hint())
        if not cdp_adjust_volume(ws, -0.1):
            try:
                for _ in range(5):
                    win32api.keybd_event(0xAE, 0, 0, 0)
                    win32api.keybd_event(0xAE, 0, 2, 0)
            except Exception:
                pass
        self._refocus_bar()

    def on_fullscreen_toggle(self):
        ws = cdp_find_ws(self._last_url_hint())
        done = False
        if ws and websocket:
            try:
                w = websocket.create_connection(ws, timeout=0.8)
                try:
                    _cdp_send(w, "Input.dispatchKeyEvent", {"type": "keyDown", "key": "f", "code": "KeyF", "windowsVirtualKeyCode": 0x46, "keyCode": 0x46})
                    _cdp_send(w, "Input.dispatchKeyEvent", {"type": "keyUp", "key": "f", "code": "KeyF", "windowsVirtualKeyCode": 0x46, "keyCode": 0x46})
                    done = True
                finally:
                    try: w.close()
                    except Exception: pass
            except Exception:
                done = False
        if not done:
            if focus_chrome_window():
                try:
                    win32api.keybd_event(0x46, 0, 0, 0)
                    win32api.keybd_event(0x46, 0, 2, 0)
                except Exception:
                    pass
        self._refocus_bar()

    def on_mute_toggle(self):
        pass

    def on_exit(self):
        # 1. Hide the control bar immediately
        try:
            self.withdraw()
            self.update_idletasks()
        except Exception:
            pass

        # 2. Close ALL Chrome windows - just kill them all
        try:
            print("[Exit] Closing all Chrome windows...")
            _kill_chrome_gracefully()
        except Exception as e:
            print(f"[Exit] Error closing Chrome: {e}")
        
        # 3. Focus the Electron app
        time.sleep(0.3)
        try:
            self._force_focus_electron_app()
        except Exception as e:
            print(f"[Exit] Error focusing Electron: {e}")
            
        # 4. Hard exit the control bar
        os._exit(0)

    def _apply_post_nav(self, prof: PlatformProfile) -> bool:
        """Apply post-navigation keys for platform (e.g., x,enter,p,f for Plex, f for YouTube)."""
        ok = False
        ws = cdp_find_ws(self._last_url_hint())
        if ws:
            try:
                ok = cdp_ensure_play_and_fullscreen(ws)
            except Exception:
                ok = False
        if ok:
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
                post_nav_keys = prof.get("post_nav") or []
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
        try:
            ws = cdp_find_ws(self._last_url_hint())
            if ws:
                cdp_ensure_play_and_fullscreen(ws)
                return
        except Exception:
            pass
        if focus_chrome_window():
            try:
                win32api.keybd_event(0x46, 0, 0, 0)
                win32api.keybd_event(0x46, 0, 2, 0)
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

    if args.delay > 0:
        time.sleep(args.delay)

    if args.app_title:
        APP_TITLE_MAIN = args.app_title

    app = ControlBar(args.mode, args.show)
    app.mainloop()


if __name__ == "__main__":
    main()

