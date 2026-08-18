import http.server
import socketserver
import json
import os
import threading
import sys

import http.server
import socketserver
import json
import os
import sys
import subprocess
import pandas as pd
import time
import threading
import pyautogui
import win32gui
import win32con
import psutil
from psutil import process_iter
from pynput.keyboard import Controller as KeyboardController
from urllib.parse import urlparse, parse_qs
import pynput # Ensure pynput is imported if we use it, otherwise skip
import win32api
import win32process
from http.server import BaseHTTPRequestHandler, HTTPServer
import urllib.parse

PORT = 8000
URL_SAVE_PORT = 8765  # Port for URL save server (same as old app)
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(DIRECTORY, "data")
CONTROL_BAR_PATH = os.path.abspath(os.path.join(DIRECTORY, "utils", "control_bar.py"))
EPISODE_FILE = os.path.join(DATA_DIR, "EPISODE_SELECTION.xlsx")
LAST_WATCHED_FILE = os.path.join(DATA_DIR, "last_watched.json")
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# Shared directory (for scan-manager.js and voice-manager.js)
SHARED_DIR = os.path.abspath(os.path.join(DIRECTORY, "..", "..", "..", "shared"))

# --- Active Show Tracking (like MenuFrame.active_show in old app) ---
ACTIVE_SHOW = None  # Global variable to track current show being watched

def set_active_show(title):
    """Set the currently active show for URL tracking."""
    global ACTIVE_SHOW
    ACTIVE_SHOW = title
    print(f"[ACTIVE-SHOW] Set to: {title}")

def get_active_show():
    """Get the currently active show."""
    return ACTIVE_SHOW

# --- URL Save Server (port 8765, same as old app) ---
class URLSaveHandler(BaseHTTPRequestHandler):
    """HTTP handler that receives URL updates from Chrome extension/bookmarklet."""

    def log_message(self, format, *args):
        # Suppress default logging
        pass

    def do_GET(self):
        # Parse the URL from the request query string
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        url = qs.get("url", [None])[0]

        # Get the active show
        show = get_active_show()

        # Check if URL should be saved
        if not show or not url:
            print(f"[URL-SAVE] Rejected - no show or URL: show={show}, url={url}")
            self.send_response(204)
            self.end_headers()
            return

        # Check if URL is from allowed streaming domain
        if not _should_track_url_changes(url):
            print(f"[URL-SAVE] Rejected - not allowed domain: {url[:60]}...")
            self.send_response(204)
            self.end_headers()
            return

        # Save the URL
        try:
            data = {}
            if os.path.exists(LAST_WATCHED_FILE):
                with open(LAST_WATCHED_FILE, 'r') as f:
                    try: data = json.load(f)
                    except: pass

            # Remove existing to ensure most recent is at the end
            if show in data:
                del data[show]

            data[show] = {
                "season": -1,
                "episode": -1,
                "url": url
            }

            with open(LAST_WATCHED_FILE, 'w') as f:
                json.dump(data, f, indent=2)

            print(f"[URL-SAVE] {show} → {url}")
        except Exception as e:
            print(f"[URL-SAVE] Error saving: {e}")

        self.send_response(204)
        self.end_headers()

def start_url_save_server():
    """Start the URL save server on port 8765 (like old app)."""
    try:
        server = HTTPServer(("127.0.0.1", URL_SAVE_PORT), URLSaveHandler)
        print(f"[URL-SAVE-SERVER] Started on port {URL_SAVE_PORT}")
        server.serve_forever()
    except Exception as e:
        print(f"[URL-SAVE-SERVER] Failed to start: {e}")

# Start URL save server in background thread
threading.Thread(target=start_url_save_server, daemon=True).start()

# --- Get Chrome URL via CDP (Chrome DevTools Protocol) ---
def get_chrome_url_via_cdp():
    """Get the best streaming URL from Chrome via CDP on port 9222."""
    try:
        import requests
        r = requests.get("http://127.0.0.1:9222/json", timeout=0.5)
        if not r.ok:
            print(f"[CDP] Request failed with status {r.status_code}")
            return None
        tabs = r.json()
        print(f"[CDP] Found {len(tabs)} tabs")

        # Priority: streaming service URLs first
        streaming_domains = ["netflix.com", "disneyplus.com", "paramountplus.com",
                           "primevideo.com", "amazon.com", "hulu.com", "max.com",
                           "hbomax.com", "play.max.com", "pluto.tv", "youtube.com", "youtu.be"]

        best_url = None
        for tab in tabs:
            if tab.get("type") == "page" and tab.get("url"):
                url = tab.get("url")
                print(f"[CDP] Tab: {url[:80]}...")

                # Skip internal pages
                if url.startswith("chrome://") or url.startswith("chrome-extension://"):
                    continue

                # Skip localhost/hub pages
                if "localhost" in url or "127.0.0.1" in url:
                    continue

                # Check if it's a streaming service (highest priority)
                url_lower = url.lower()
                for domain in streaming_domains:
                    if domain in url_lower:
                        print(f"[CDP] Found streaming URL: {url[:60]}...")
                        return url

                # Keep first non-localhost URL as fallback
                if best_url is None:
                    best_url = url

        if best_url:
            print(f"[CDP] Using fallback URL: {best_url[:60]}...")
        else:
            print("[CDP] No suitable URL found in any tab")
        return best_url
    except Exception as e:
        print(f"[CDP] Error getting URL: {e}")
    return None

# --- Hub Window Management ---
def find_hub_window():
    """Find the hub Chrome window (localhost:8060)."""
    hub_indicators = ["localhost:8060", "127.0.0.1:8060", "benny's access hub", "narbe"]
    
    def callback(hwnd, results):
        try:
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd).lower()
                # Check if it's a Chrome window with hub indicators
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                proc = psutil.Process(pid)
                if proc.name().lower() == "chrome.exe":
                    if any(ind in title for ind in hub_indicators):
                        results.append(hwnd)
        except:
            pass
    
    results = []
    win32gui.EnumWindows(callback, results)
    return results[0] if results else None

def minimize_hub_window():
    """Minimize the hub window - DISABLED for testing."""
    # DISABLED - testing if this interferes with automation
    print("[HUB] minimize_hub_window DISABLED for testing")
    return False

def restore_hub_window():
    """Restore and focus the hub window - DISABLED for testing."""
    # DISABLED - testing if this interferes with automation
    print("[HUB] restore_hub_window DISABLED for testing")
    return False

# --- Control Bar Management (from comm-v10.py) ---
def kill_control_bar():
    """Terminates any running instances of control_bar.py."""
    for p in process_iter(['name', 'cmdline']):
        try:
            if p.info['name'] and 'python' in p.info['name'].lower():
                cmdline = p.info.get('cmdline', [])
                if cmdline and any('control_bar.py' in str(arg) for arg in cmdline):
                    print(f"[CONTROL-BAR] Killing existing instance: {p.pid}")
                    p.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

# --- Launch Helpers (Ported from comm-v10.py) ---
def force_foreground_window(window_title_fragment):
    """
    Force a window to the foreground by title fragment.
    Skips hub windows (localhost:8060) to ensure we target the video window.
    """
    try:
        # Patterns that indicate the HUB window (skip these)
        hub_indicators = ["localhost:8060", "127.0.0.1:8060", "benny's access hub"]
        
        def callback(hwnd, found):
            if win32gui.IsWindowVisible(hwnd):
                txt = win32gui.GetWindowText(hwnd)
                txt_lower = txt.lower()
                
                # Skip hub windows
                if any(ind in txt_lower for ind in hub_indicators):
                    return
                    
                if window_title_fragment.lower() in txt_lower:
                    found.append(hwnd)
                    
        hwnds = []
        win32gui.EnumWindows(callback, hwnds)
        if hwnds:
            hwnd = hwnds[0]
            print(f"[FOCUS] Found window: {win32gui.GetWindowText(hwnd)}")
            
            # Restore if minimized
            if win32gui.IsIconic(hwnd):
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            
            # Use multiple methods to force foreground
            try:
                # Method 1: Direct SetForegroundWindow
                win32gui.SetForegroundWindow(hwnd)
            except Exception:
                pass
            
            try:
                # Method 2: BringWindowToTop
                win32gui.BringWindowToTop(hwnd)
            except Exception:
                pass
                
            try:
                # Method 3: Simulate Alt key release (helps with focus stealing prevention)
                import ctypes
                user32 = ctypes.windll.user32
                user32.keybd_event(0x12, 0, 2, 0)  # Alt key up
                time.sleep(0.05)
                win32gui.SetForegroundWindow(hwnd)
            except Exception:
                pass
                
            return True
    except Exception as e:
        print(f"[FOCUS] Error: {e}")
    return False

# Global to track the current URL being played
CURRENT_PLAYBACK_URL = None

def set_current_playback_url(url):
    """Track the URL currently being played - used for saving on exit."""
    global CURRENT_PLAYBACK_URL
    CURRENT_PLAYBACK_URL = url
    # Also write to a temp file so control_bar can read it
    try:
        temp_file = os.path.join(DATA_DIR, "current_url.txt")
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(temp_file, 'w') as f:
            f.write(url or "")
        print(f"[URL-TRACK] Saved current URL: {url[:60] if url else 'None'}...")
    except Exception as e:
        print(f"[URL-TRACK] Error saving: {e}")

def launch_control_bar(mode="basic", show_title=None, delay=0.0):
    try:
        cmd = [sys.executable, CONTROL_BAR_PATH, "--mode", mode, "--app-title", "Streaming Hub"]
        if show_title:
            cmd += ["--show", show_title]
        if delay > 0:
            cmd += ["--delay", str(delay)]

        print(f"[CONTROL-BAR] sys.executable = {sys.executable}")
        print(f"[CONTROL-BAR] CONTROL_BAR_PATH = {CONTROL_BAR_PATH}")
        print(f"[CONTROL-BAR] Path exists: {os.path.exists(CONTROL_BAR_PATH)}")
        print(f"[CONTROL-BAR] Launching: {cmd}")

        # Launch with output redirected to a log file in temp folder for debugging
        import tempfile
        log_path = os.path.join(tempfile.gettempdir(), "bennys_control_bar_debug.log")
        with open(log_path, "w") as log_file:
            proc = subprocess.Popen(cmd, stdout=log_file, stderr=subprocess.STDOUT, bufsize=1, universal_newlines=True,
                                     creationflags=subprocess.CREATE_NO_WINDOW)
        print(f"[CONTROL-BAR] Process started with PID: {proc.pid}")
        print(f"[CONTROL-BAR] Debug log: {log_path}")
    except Exception as e:
        print(f"[CONTROL-BAR] Failed to launch: {e}")
        import traceback
        traceback.print_exc()


def open_in_chrome(url, fullscreen=True):
    """
    Open URL in Chrome in a new window for video playback.
    """
    try:
        # Minimize hub window first so video takes focus
        minimize_hub_window()

        chrome_cmd = CHROME_PATH if os.path.exists(CHROME_PATH) else "chrome"

        # Open Chrome with the URL
        # --autoplay-policy=no-user-gesture-required ensures audio isn't muted on Disney+ etc
        # --enable-features=HardwareMediaKeyHandling enables global media key support (for Plex)
        # --disable-background-mode prevents Chrome from running in background after close
        args = [
            chrome_cmd,
            "--new-window",
            "--autoplay-policy=no-user-gesture-required",
            "--enable-features=HardwareMediaKeyHandling",
            "--disable-background-mode",
            "--disable-backgrounding-occluded-windows"
        ]
        if fullscreen:
            args.append("--start-fullscreen")
        args.append(url)
        
        print(f"[CHROME] Command: {args}")
        subprocess.Popen(args)
        print(f"[CHROME] Opened: {url}")
    except Exception as e:
        print(f"[CHROME] Error: {e}")


def open_link_logic(title, url, ctype, show_title=None, plex_continue=False, save_url=None):
    """
    Platform-specific launch logic ported from comm-v10.py.
    Handles: Plex, YouTube, PlutoTV, Paramount+, Amazon, trailers, and generic services.

    Args:
        title: Display title (may include S#E# suffix for episodes)
        url: URL to open
        ctype: Content type (movies, shows, trailer)
        show_title: Base show name for control bar (e.g. "Breaking Bad" not "Breaking Bad S1E5")
                   Used to look up progress in last_watched.json
        plex_continue: If True, this is a Plex "continue" action using base show URL
        save_url: URL to save in last_watched (for Plex shows, this is the default show URL)
    """
    # Use show_title if provided, otherwise fall back to title
    control_bar_title = show_title or title
    # Use save_url if provided, otherwise fall back to url
    url_to_save = save_url or url
    print(f"Opening: {title} | {url} | Type: {ctype} | ControlBar: {control_bar_title} | PlexContinue: {plex_continue} | SaveUrl: {url_to_save[:60] if url_to_save else 'None'}...")

    # Set the active show for URL tracking (like MenuFrame.active_show in old app)
    # This allows the URL save server (port 8765) to know which show to save URLs for
    set_active_show(control_bar_title)

    # Track the current playback URL (for saving on exit)
    set_current_playback_url(url)

    # Kill any existing control bar first
    kill_control_bar()
    
    kb = KeyboardController()  # pynput keyboard for reliable key presses
    
    def click_to_focus():
        """Click center of screen to ensure browser has focus for keyboard input."""
        try:
            sw, sh = pyautogui.size()
            pyautogui.click(sw // 2, sh // 2)
            time.sleep(0.2)
        except Exception as e:
            print(f"[FOCUS] Click failed: {e}")
    
    # --- TRAILERS (YouTube links launched as trailers) ---
    # Treat trailers the same as YouTube
    if ctype == "trailer" or (("youtube.com" in url or "youtu.be" in url) and ctype == "trailer"):
        open_in_chrome(url)
        
        def _automate_trailer():
            print(f"[TRAILER] Waiting for YouTube page load...")
            time.sleep(5)
            
            force_foreground_window("YouTube")
            force_foreground_window("Chrome")
            click_to_focus()
            
            time.sleep(0.5)
            
            # YouTube: 'f' for fullscreen
            print("[TRAILER] Sending 'f' to fullscreen...")
            pyautogui.press('f')
            
        threading.Thread(target=_automate_trailer, daemon=True).start()
        launch_control_bar("basic", show_title=control_bar_title, delay=10.0)
        return  # Exit early so it doesn't fall through to other handlers

    # --- PLEX ---
    if "plex.tv" in url or "plex.direct" in url:
        open_in_chrome(url)

        def _automate_plex():
            print(f"[PLEX] Waiting for page load... (plex_continue={plex_continue})")
            time.sleep(7)

            # Force Chrome/Plex to foreground
            force_foreground_window("Plex")
            force_foreground_window("Chrome")
            click_to_focus()

            if plex_continue:
                # Base show page: just press Enter to activate the "Play" button
                # which resumes from where Plex left off
                print("[PLEX CONTINUE] Pressing Enter to start playing...")
                pyautogui.press('enter')
                time.sleep(2)
                print("[PLEX CONTINUE] Sending 'f' to fullscreen...")
                pyautogui.press('f')
            else:
                # Episode/Movie page: use full automation sequence
                # Plex key sequence: x (close overlay) -> enter (select) -> p (play)
                print("[PLEX] Sending keys: x, enter, p")
                pyautogui.press('x')
                time.sleep(1)
                pyautogui.press('enter')
                time.sleep(1)
                pyautogui.press('p')  # 'p' plays the video

                # Wait for video to start, then fullscreen the Plex player
                time.sleep(2)
                print("[PLEX] Sending 'f' to fullscreen the player...")
                pyautogui.press('f')

        threading.Thread(target=_automate_plex, daemon=True).start()
        launch_control_bar("basic", show_title=control_bar_title, delay=14.0 if not plex_continue else 10.0)
        
    # --- PLUTO TV ---
    elif "pluto.tv" in url:
        open_in_chrome(url)
        
        def _automate_pluto():
            print(f"[PLUTO] Waiting for page load...")
            time.sleep(7)
            
            force_foreground_window("Pluto")
            force_foreground_window("Chrome")
            click_to_focus()
            
            time.sleep(6)  # Extra wait for video player
            
            # PlutoTV sequence: m (unmute) -> f (fullscreen)
            print("[PLUTO] Sending 'm' to unmute...")
            kb.press('m')
            time.sleep(0.1)
            kb.release('m')
            
            time.sleep(2)
            
            print("[PLUTO] Sending 'f' to fullscreen...")
            kb.press('f')
            time.sleep(0.1)
            kb.release('f')
            
            print("[PLUTO] Automation complete.")
            
        threading.Thread(target=_automate_pluto, daemon=True).start()
        launch_control_bar("basic", show_title=control_bar_title, delay=16.0)

    # --- YOUTUBE ---
    elif "youtube.com" in url or "youtu.be" in url:
        open_in_chrome(url)
        
        def _automate_youtube():
            print(f"[YOUTUBE] Waiting for page load...")
            time.sleep(5)
            
            force_foreground_window("YouTube")
            force_foreground_window("Chrome")
            click_to_focus()
            
            time.sleep(0.5)
            
            # YouTube: 'f' for fullscreen
            print("[YOUTUBE] Sending 'f' to fullscreen...")
            pyautogui.press('f')
            
        threading.Thread(target=_automate_youtube, daemon=True).start()
        launch_control_bar("basic", show_title=control_bar_title, delay=10.0)

    # --- PARAMOUNT+ / AMAZON (need click to dismiss overlays) ---
    elif "paramountplus.com" in url or "amazon.com" in url or "primevideo.com" in url:
        open_in_chrome(url)
        
        def _automate_click():
            print(f"[CLICK-SERVICE] Waiting for page load...")
            time.sleep(5)
            
            force_foreground_window("Chrome")
            click_to_focus()
            
            # Click center to dismiss any overlay
            try:
                sw, sh = pyautogui.size()
                pyautogui.click(sw // 2, sh // 2)
                print(f"[CLICK-SERVICE] Clicked center: ({sw//2}, {sh//2})")
            except: pass
            
            time.sleep(2)
            
        threading.Thread(target=_automate_click, daemon=True).start()
        launch_control_bar("basic", show_title=control_bar_title, delay=8.0)

    # --- NETFLIX / DISNEY+ / HULU / MAX / OTHER ---
    else:
        # These services auto-play and auto-fullscreen when you navigate to watch URLs
        open_in_chrome(url)

        # Save the URL immediately for non-Plex streaming services
        # This ensures Recently Watched and Continue work even if CDP tracking fails
        # Use url_to_save (which may be the default Plex URL for Plex shows)
        if is_allowed_streaming_url(url_to_save):
            set_last_watched(control_bar_title, -1, -1, url_to_save)
            print(f"[URL-SAVE] Saved on launch: {control_bar_title} → {url_to_save[:60]}...")

        def _automate_generic():
            print(f"[GENERIC] Waiting for page load...")
            time.sleep(5)
            force_foreground_window("Chrome")
            click_to_focus()
            # F11 removed: Chrome is already launched with --start-fullscreen.
            # Pressing F11 toggles it OFF if it is already on.
            # try:
            #     pyautogui.press('f11')
            #     print("[GENERIC] Sent F11 for browser fullscreen")
            # except: pass

        threading.Thread(target=_automate_generic, daemon=True).start()
        launch_control_bar("basic", show_title=control_bar_title, delay=6.0)

# Cache for episodes
EPISODE_CACHE = {}

def load_episode_catalog():
    """Load episodes from JSON (preferred) or Excel into memory."""
    global EPISODE_CACHE
    
    # Check for JSON first
    json_path = os.path.join(DIRECTORY, "episodes.json")
    if os.path.exists(json_path):
        try:
            with open(json_path, 'r') as f:
                # Load JSON but ensure integer keys for seasons
                raw_data = json.load(f)
                # Convert season keys back to integers for Python cache consistency (json keys are strings)
                EPISODE_CACHE = {}
                for show, seasons in raw_data.items():
                    # Normalize show title to lowercase for reliable matching
                    key = str(show).lower().strip()
                    try:
                        # Handle season keys that might be strings of ints
                        params = {}
                        for k, v in seasons.items():
                            try:
                                params[int(k)] = v
                            except ValueError:
                                # Keep string key if not int? or skip? 
                                # Episodes usually need int seasons.
                                print(f"Warning: Non-integer season key '{k}' in '{show}'")
                                continue
                        EPISODE_CACHE[key] = params
                    except Exception as e:
                        print(f"Error parsing show '{show}': {e}")
                        
            print(f"Loaded {len(EPISODE_CACHE)} shows from JSON.")
            return
        except Exception as e:
            print(f"Error loading episodes.json: {e}")

    # Fallback to Excel
    if not os.path.exists(EPISODE_FILE):
        print(f"Episode file not found: {EPISODE_FILE}")
        return

    try:
        print("Migrating/Loading from Excel...")
        df = pd.read_excel(EPISODE_FILE)
        cols = {c.lower().strip(): c for c in df.columns}
        
        # Map columns
        show_col   = cols.get("show title") or cols.get("show") or cols.get("title") or cols.get("series")
        season_col = cols.get("season number") or cols.get("season")
        episode_col= cols.get("episode number") or cols.get("episode")
        title_col  = cols.get("episode title") or cols.get("title")
        url_col    = cols.get("disneyplusurl") or cols.get("episode url") or cols.get("url")

        if not (show_col and season_col and episode_col and title_col and url_col):
            print("Missing columns in Excel")
            return

        EPISODE_CACHE = {}
        for _, row in df.iterrows():
            show = str(row[show_col]).strip()
            if not show: continue
            
            try:
                s_num = int(row[season_col])
                e_num = int(row[episode_col])
            except: continue
            
            title = str(row[title_col]).strip()
            url = str(row[url_col]).strip() if pd.notna(row[url_col]) else ""

            key = show.lower()
            if key not in EPISODE_CACHE:
                EPISODE_CACHE[key] = {}
            if s_num not in EPISODE_CACHE[key]:
                EPISODE_CACHE[key][s_num] = []
                
            EPISODE_CACHE[key][s_num].append({
                "season": s_num,
                "episode": e_num,
                "title": title,
                "url": url
            })

        # Sort
        for show in EPISODE_CACHE:
            for s in EPISODE_CACHE[show]:
                EPISODE_CACHE[show][s].sort(key=lambda x: x['episode'])
        
        # Save to JSON for future use
        try:
            with open(json_path, 'w') as f:
                json.dump(EPISODE_CACHE, f, indent=2)
            print("Successfully migrated Excel to episodes.json")
        except Exception as e:
            print(f"Error saving to episodes.json: {e}")
                
        print(f"Loaded {len(EPISODE_CACHE)} shows.")
    except Exception as e:
        print(f"Error loading episodes: {e}")

# Initial load
load_episode_catalog()

def get_last_watched(show_title=None):
    try:
        if os.path.exists(LAST_WATCHED_FILE):
            with open(LAST_WATCHED_FILE, 'r') as f:
                data = json.load(f)
                if not show_title:
                    return data # Return all data
                info = data.get(show_title)
                if isinstance(info, dict): return info
                # Handle lagacy string format (just url)
                if isinstance(info, str): return {"url": info}
    except: pass
    return None

# Whitelist of allowed streaming domains for persistent URL tracking (control bar tracks these)
ALLOWED_STREAMING_DOMAINS = [
    "netflix.com", "disneyplus.com", "paramountplus.com", "primevideo.com",
    "amazon.com", "hulu.com", "max.com", "hbomax.com", "pluto.tv",
    "youtube.com", "youtu.be"
]

def _is_plex_url(url):
    """Check if URL is a Plex URL."""
    if not url:
        return False
    url_lower = url.lower()
    return "plex.tv" in url_lower or "plex.direct" in url_lower

def _should_track_url_changes(url):
    """Check if URL changes should be tracked by control bar (non-Plex streaming services)."""
    if not url:
        return False
    url_lower = url.lower()
    # Don't track Plex - it handles its own continue
    if _is_plex_url(url):
        return False
    # Only track known streaming services
    return any(domain in url_lower for domain in ALLOWED_STREAMING_DOMAINS)

def is_allowed_streaming_url(url):
    """Check if URL is an allowed streaming service (non-Plex) for saving."""
    # Alias for _should_track_url_changes - used in save logic
    return _should_track_url_changes(url)

def set_last_watched(show_title, season, episode, url):
    # Always save to last_watched.json for Recently Watched display
    # (Plex URLs are saved but the Continue button uses base show URL instead)
    try:
        import time
        data = {}
        if os.path.exists(LAST_WATCHED_FILE):
            with open(LAST_WATCHED_FILE, 'r') as f:
                try: data = json.load(f)
                except: pass

        # Remove existing to ensure most recent is at the end (Python 3.7+ dict order)
        if show_title in data:
            del data[show_title]

        data[show_title] = {
            "season": int(season) if season is not None else -1,
            "episode": int(episode) if episode is not None else -1,
            "url": url,
            "timestamp": int(time.time() * 1000)  # JS-style timestamp for sorting
        }

        with open(LAST_WATCHED_FILE, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"[SAVE] {show_title} → {url[:60]}...")
    except Exception as e:
        print(f"Error saving last watched: {e}")

def _strip_saved_url(entry):
    """
    Drop the saved resume URL but keep the entry itself.

    last_watched.json doubles as the Recently Watched list, so deleting the whole entry
    would make the show disappear from that grid. With no url, the modal falls back to the
    base link from data.json (or to the first episode for shows in episodes.json).
    """
    if isinstance(entry, dict):
        entry.pop("url", None)
        entry["season"] = -1
        entry["episode"] = -1
        return entry
    # Legacy entries were a bare URL string with no timestamp - keep it that way
    return {"season": -1, "episode": -1}

def _load_last_watched_raw():
    if os.path.exists(LAST_WATCHED_FILE):
        try:
            with open(LAST_WATCHED_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def _write_last_watched_raw(data):
    with open(LAST_WATCHED_FILE, 'w') as f:
        json.dump(data, f, indent=2)

def reset_last_watched(show_title):
    """Clear one show's saved resume URL. Returns True if an entry was actually cleared."""
    if not show_title:
        return False
    try:
        data = _load_last_watched_raw()
        # set_last_watched() writes whatever case it was handed, so match loosely
        wanted = show_title.lower().strip()
        keys = [k for k in data if k.lower().strip() == wanted]
        if not keys:
            return False
        for k in keys:
            data[k] = _strip_saved_url(data[k])
        _write_last_watched_raw(data)
        print(f"[RESET] Cleared saved URL for: {show_title}")
        return True
    except Exception as e:
        print(f"Error resetting last watched: {e}")
        return False

def clear_all_last_watched():
    """Strip every saved resume URL, keeping the Recently Watched list populated."""
    try:
        data = _load_last_watched_raw()
        count = 0
        for k in list(data.keys()):
            entry = data[k]
            if isinstance(entry, str) or (isinstance(entry, dict) and entry.get("url")):
                count += 1
            data[k] = _strip_saved_url(entry)
        _write_last_watched_raw(data)
        print(f"[RESET] Cleared saved URLs for {count} show(s)")
        return count
    except Exception as e:
        print(f"Error clearing last watched: {e}")
        return 0

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        
        print(f"[GET] Request path: {path}")  # Debug all requests

        # Serve shared files (scan-manager.js, voice-manager.js)
        if path.startswith('/shared/'):
            # Extract filename from path
            filename = path.replace('/shared/', '')
            shared_file = os.path.join(SHARED_DIR, filename)
            print(f"[Shared] Requested: {filename}, Full path: {shared_file}, Exists: {os.path.exists(shared_file)}")
            if os.path.exists(shared_file):
                self.send_response(200)
                if filename.endswith('.js'):
                    self.send_header('Content-type', 'application/javascript')
                else:
                    self.send_header('Content-type', 'text/plain')
                self.end_headers()
                with open(shared_file, 'rb') as f:
                    self.wfile.write(f.read())
                return
            else:
                print(f"[Shared] File not found: {shared_file}")
                self.send_error(404)
                return

        if path == '/api/episodes':
            raw_show = qs.get('show', [''])[0]
            show = raw_show.lower().strip()
            print(f"API Episode Request: '{raw_show}' -> '{show}'") # Debug
            
            if show in EPISODE_CACHE:
                print(f"  Found in cache with {len(EPISODE_CACHE[show])} seasons")
                self._send_json(EPISODE_CACHE[show])
            else:
                print(f"  Not found in cache. Cache keys sample: {list(EPISODE_CACHE.keys())[:5]}")
                self._send_json({})
                
        elif path == '/api/last_watched':
            show = qs.get('show', [''])[0].strip()
            data = get_last_watched(show)
            self._send_json(data or {})

        elif path == '/api/search_history':
            try:
                history_path = os.path.join(DIRECTORY, "search_history.json")
                if os.path.exists(history_path):
                    with open(history_path, 'r') as f:
                        data = json.load(f)
                        self._send_json(data)
                else:
                    self._send_json([])
            except Exception as e:
                self._send_error(str(e))

        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/save_data':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data)
                json_path = os.path.join(DIRECTORY, "data.json")
                with open(json_path, "w") as f:
                    json.dump(data, f, indent=2)
                self._send_json({"status": "success"})
            except Exception as e:
                self._send_error(str(e))

        elif self.path == '/api/save_progress':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data)
                set_last_watched(
                    data.get('show'),
                    data.get('season'),
                    data.get('episode'),
                    data.get('url')
                )
                self._send_json({"status": "saved"})
            except Exception as e:
                self._send_error(str(e))

        elif self.path == '/api/reset_progress':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data)
                cleared = reset_last_watched(data.get('show'))
                self._send_json({"status": "reset", "cleared": cleared})
            except Exception as e:
                self._send_error(str(e))

        elif self.path == '/api/clear_progress':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                if length:
                    self.rfile.read(length)
                count = clear_all_last_watched()
                self._send_json({"status": "cleared", "count": count})
            except Exception as e:
                self._send_error(str(e))

        elif self.path == '/api/open':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data)
                title = data.get('title', '')
                url = data.get('url', '')
                ctype = data.get('type', 'movies')
                # showTitle is the base show name for the control bar (e.g. "Breaking Bad" not "Breaking Bad S1E5")
                show_title = data.get('showTitle', title)
                # saveUrl is the URL to save in last_watched (for Plex shows, this is the default show URL)
                save_url = data.get('saveUrl', url)
                # plexContinue flag: true when using base show URL for Plex continue
                plex_continue = data.get('plexContinue', False)

                open_link_logic(title, url, ctype, show_title, plex_continue, save_url)

                self._send_json({"status": "launched"})
            except Exception as e:
                self._send_error(str(e))

        elif self.path == '/save_genres':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data)
                json_path = os.path.join(DIRECTORY, "genres.json")
                with open(json_path, "w") as f:
                    json.dump(data, f, indent=2)
                self._send_json({"status": "success"})
            except Exception as e:
                self._send_error(str(e))

        elif self.path == '/launch_control_bar':
            try:
                # Path to control_bar.py relative to streaming/
                control_bar_path = os.path.abspath(os.path.join(DIRECTORY, "..", "utils", "control_bar.py"))
                subprocess.Popen([sys.executable, control_bar_path, "--mode", "basic"],
                                  creationflags=subprocess.CREATE_NO_WINDOW)
                self._send_json({"status": "launched"})
            except Exception as e:
                print(f"Error launching control bar: {e}")
                self._send_error(str(e))

        elif self.path == '/api/save_search':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data)
                term = data.get('term', '').strip()
                if term:
                    history_path = os.path.join(DIRECTORY, "search_history.json")
                    history = []
                    if os.path.exists(history_path):
                        with open(history_path, 'r') as f:
                            try: history = json.load(f)
                            except: pass
                    
                    # Add to front, remove duplicates
                    if term in history:
                        history.remove(term)
                    history.insert(0, term)
                    # Keep max 50
                    history = history[:50]
                    
                    with open(history_path, 'w') as f:
                        json.dump(history, f, indent=2)
                        
                self._send_json({"status": "saved"})
            except Exception as e:
                self._send_error(str(e))

        elif self.path == '/api/clear_search_history':
            try:
                history_path = os.path.join(DIRECTORY, "search_history.json")
                with open(history_path, 'w') as f:
                    json.dump([], f)
                self._send_json({"status": "cleared"})
            except Exception as e:
                self._send_error(str(e))

        elif self.path == '/close_app':
            try:
                # SAVE URL BEFORE CLOSING: Get Chrome URL via CDP and save for the active show
                show = get_active_show()
                if show:
                    url = get_chrome_url_via_cdp()
                    if url and is_allowed_streaming_url(url):
                        set_last_watched(show, -1, -1, url)
                        print(f"[EXIT] Saved URL on close: {show} → {url[:60]}...")
                    else:
                        print(f"[EXIT] No saveable URL found (show={show}, url={url})")
                else:
                    print("[EXIT] No active show to save")

                # Send response first before killing Chrome
                self._send_json({"status": "closed"})
                # Kill Chrome after response is sent
                print("[EXIT] Killing Chrome...")
                result = subprocess.run("taskkill /IM chrome.exe /F", shell=True, capture_output=True, text=True)
                print(f"[EXIT] taskkill result: {result.returncode}, stdout: {result.stdout}, stderr: {result.stderr}")
            except Exception as e:
                print(f"[EXIT] Error: {e}")
                self._send_error(str(e))
        else:
            self.send_error(404)

    def _send_json(self, data):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def _send_error(self, msg):
        self.send_response(500)
        self.end_headers()
        print(f"Server Error: {msg}")
        self.wfile.write(json.dumps({"error": msg}).encode('utf-8'))


def run_server():
    # Print startup info
    print(f"[Server] Starting Streaming server on port {PORT}")
    print(f"[Server] DIRECTORY: {DIRECTORY}")
    print(f"[Server] SHARED_DIR: {SHARED_DIR}")
    print(f"[Server] SHARED_DIR exists: {os.path.exists(SHARED_DIR)}")
    if os.path.exists(SHARED_DIR):
        print(f"[Server] SHARED_DIR contents: {os.listdir(SHARED_DIR)}")
    
    # Launch Chrome
    def open_browser():
        time.sleep(1.5) # Give server a moment
        url = f"http://localhost:{PORT}/index.html"
        print(f"Opening {url} in Chrome...")
        
        # Helper to force focus
        def force_focus(hwnd):
            border_width = win32api.GetSystemMetrics(win32con.SM_CXFRAME)
            title_height = win32api.GetSystemMetrics(win32con.SM_CYCAPTION)
            
            # Restore if minimized
            if win32gui.IsIconic(hwnd):
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            
            # Force foreground
            try:
                win32gui.SetForegroundWindow(hwnd)
            except Exception:
                # Fallback: Simulate Alt keypress to allow focus stealing
                pyautogui.press('alt') 
                try:
                    win32gui.SetForegroundWindow(hwnd)
                except:
                    pass
            
            # Click center of screen to ensure document focus
            width = win32api.GetSystemMetrics(win32con.SM_CXSCREEN)
            height = win32api.GetSystemMetrics(win32con.SM_CYSCREEN)
            pyautogui.click(width // 2, height // 2)

        try:
            if os.path.exists(CHROME_PATH):
                # Launch in App mode with all required flags
                # --remote-debugging-port=9222 enables CDP for control_bar.py automation
                # --autoplay-policy=no-user-gesture-required ensures audio isn't muted
                # --enable-features=HardwareMediaKeyHandling enables media key support
                # --disable-background-mode prevents Chrome from running in background after close
                subprocess.Popen([
                    CHROME_PATH,
                    "--remote-debugging-port=9222",
                    "--new-window",
                    "--start-fullscreen",
                    "--autoplay-policy=no-user-gesture-required",
                    "--enable-features=HardwareMediaKeyHandling",
                    "--disable-background-mode",
                    "--disable-backgrounding-occluded-windows",
                    "--app=" + url
                ])
                
                # Wait for window to load
                for _ in range(20): # Try for 10 seconds
                    time.sleep(0.5)
                    hwnd = win32gui.FindWindow(None, "Streaming Hub")
                    if hwnd:
                        print(f"Found window: {hwnd}, forcing focus...")
                        force_focus(hwnd)
                        break
                
            else:
                import webbrowser
                webbrowser.open(url)
        except Exception as e:
            print(f"Error opening browser: {e}")

    threading.Thread(target=open_browser, daemon=True).start()

    # allow reuse address
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass

if __name__ == "__main__":
    # Ensure we serve from the directory containing this script
    os.chdir(DIRECTORY)
    
    # Check for --no-browser flag
    if "--no-browser" in sys.argv:
        # Define run_server variant that doesn't launch browser
        def run_headless_server():
            socketserver.TCPServer.allow_reuse_address = True
            with socketserver.TCPServer(("", PORT), Handler) as httpd:
                print(f"Serving at http://localhost:{PORT} (Headless)")
                try:
                    httpd.serve_forever()
                except KeyboardInterrupt:
                    pass
        run_headless_server()
    else:
        run_server()
