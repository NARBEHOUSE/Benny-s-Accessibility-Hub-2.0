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

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(DIRECTORY, "data")
CONTROL_BAR_PATH = os.path.abspath(os.path.join(DIRECTORY, "utils", "control_bar.py"))
EPISODE_FILE = os.path.join(DATA_DIR, "EPISODE_SELECTION.xlsx")
LAST_WATCHED_FILE = os.path.join(DATA_DIR, "last_watched.json")
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

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
    try:
        def callback(hwnd, found):
            if win32gui.IsWindowVisible(hwnd):
                txt = win32gui.GetWindowText(hwnd)
                if window_title_fragment in txt:
                    found.append(hwnd)
        hwnds = []
        win32gui.EnumWindows(callback, hwnds)
        if hwnds:
            hwnd = hwnds[0]
            # Only restore if minimized. Avoid SW_MAXIMIZE/SW_RESTORE on visible windows
            # as it breaks Chrome's --start-fullscreen mode.
            if win32gui.IsIconic(hwnd):
                 win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            
            try:
                win32gui.SetForegroundWindow(hwnd)
            except Exception:
                # Sometimes fails if logic is holding ALT, etc.
                pass
            return True
    except: pass
    return False

def launch_control_bar(mode="basic", show_title=None, delay=0.0):
    try:
        cmd = [sys.executable, CONTROL_BAR_PATH, "--mode", mode, "--app-title", "Streaming Hub"]
        if show_title:
            cmd += ["--show", show_title]
        if delay > 0:
            cmd += ["--delay", str(delay)]
        subprocess.Popen(cmd)
        print(f"Launched control bar: {cmd}")
    except Exception as e:
        print(f"Failed to launch control bar: {e}")


def open_in_chrome(url, fullscreen=True):
    """
    Open URL in Chrome using shell=True (like comm-v10.py).
    This ensures --start-fullscreen works even when Chrome is already running.
    """
    try:
        # Use 'start /MAX' to ensure window is maximized at OS level
        # We construct a string command to handle quoting correctly with 'start'
        # 'start "" ...' provides an empty title so we can quote the executable path
        
        chrome_cmd = "chrome"
        if os.path.exists(CHROME_PATH):
            chrome_cmd = CHROME_PATH
            
        # Base command with maximizing flags
        # --new-window: Forces a new window (critical for maximizing to work)
        # --start-maximized: Chrome internal flag
        # /MAX: Windows cmd flag (most effective)
        cmd_str = f'start "" /MAX "{chrome_cmd}" --new-window --start-maximized --remote-debugging-port=9222'
        
        if fullscreen:
            cmd_str += ' --start-fullscreen'
            
        cmd_str += f' "{url}"'
        
        print(f"[CHROME] Command: {cmd_str}")
        subprocess.run(cmd_str, shell=True)
        print(f"[CHROME] Opened: {url}")
    except Exception as e:
        print(f"[CHROME] Error: {e}")


def open_link_logic(title, url, ctype):
    """
    Platform-specific launch logic ported from comm-v10.py.
    Handles: Plex, YouTube, PlutoTV, Paramount+, Amazon, trailers, and generic services.
    """
    print(f"Opening: {title} | {url} | Type: {ctype}")
    
    # Kill any existing control bar first
    kill_control_bar()
    
    kb = KeyboardController()  # pynput keyboard for reliable key presses
    
    # --- TRAILERS (YouTube links launched as trailers) ---
    # Treat trailers the same as YouTube
    if ctype == "trailer" or (("youtube.com" in url or "youtu.be" in url) and ctype == "trailer"):
        open_in_chrome(url)
        
        def _automate_trailer():
            print(f"[TRAILER] Waiting for YouTube page load...")
            time.sleep(5)
            
            force_foreground_window("YouTube")
            force_foreground_window("Chrome")
            
            time.sleep(0.5)
            
            # YouTube: 'f' for fullscreen
            print("[TRAILER] Sending 'f' to fullscreen...")
            pyautogui.press('f')
            
        threading.Thread(target=_automate_trailer, daemon=True).start()
        launch_control_bar("basic", show_title=title, delay=10.0)
        return  # Exit early so it doesn't fall through to other handlers
    
    # --- PLEX ---
    if "plex.tv" in url or "plex.direct" in url:
        open_in_chrome(url)

        def _automate_plex():
            print(f"[PLEX] Waiting for page load...")
            time.sleep(7)
            
            # Force Chrome/Plex to foreground
            force_foreground_window("Plex")
            force_foreground_window("Chrome")
            
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
        launch_control_bar("basic", show_title=title, delay=14.0)  # Increased delay to account for extra steps
        
    # --- PLUTO TV ---
    elif "pluto.tv" in url:
        open_in_chrome(url)
        
        def _automate_pluto():
            print(f"[PLUTO] Waiting for page load...")
            time.sleep(7)
            
            force_foreground_window("Pluto")
            force_foreground_window("Chrome")
            
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
        launch_control_bar("basic", show_title=title, delay=16.0)

    # --- YOUTUBE ---
    elif "youtube.com" in url or "youtu.be" in url:
        open_in_chrome(url)
        
        def _automate_youtube():
            print(f"[YOUTUBE] Waiting for page load...")
            time.sleep(5)
            
            force_foreground_window("YouTube")
            force_foreground_window("Chrome")
            
            time.sleep(0.5)
            
            # YouTube: 'f' for fullscreen
            print("[YOUTUBE] Sending 'f' to fullscreen...")
            pyautogui.press('f')
            
        threading.Thread(target=_automate_youtube, daemon=True).start()
        launch_control_bar("basic", show_title=title, delay=10.0)

    # --- PARAMOUNT+ / AMAZON (need click to dismiss overlays) ---
    elif "paramountplus.com" in url or "amazon.com" in url or "primevideo.com" in url:
        open_in_chrome(url)
        
        def _automate_click():
            print(f"[CLICK-SERVICE] Waiting for page load...")
            time.sleep(5)
            
            force_foreground_window("Chrome")
            
            # Click center to dismiss any overlay
            try:
                sw, sh = pyautogui.size()
                pyautogui.click(sw // 2, sh // 2)
                print(f"[CLICK-SERVICE] Clicked center: ({sw//2}, {sh//2})")
            except: pass
            
            time.sleep(2)
            
        threading.Thread(target=_automate_click, daemon=True).start()
        launch_control_bar("basic", show_title=title, delay=8.0)

    # --- NETFLIX / DISNEY+ / HULU / MAX / OTHER ---
    else:
        # These services auto-play and auto-fullscreen when you navigate to watch URLs
        open_in_chrome(url)
        
        def _automate_generic():
            print(f"[GENERIC] Waiting for page load...")
            time.sleep(5)
            force_foreground_window("Chrome")
            # F11 removed: Chrome is already launched with --start-fullscreen. 
            # Pressing F11 toggles it OFF if it is already on.
            # try: 
            #     pyautogui.press('f11')
            #     print("[GENERIC] Sent F11 for browser fullscreen")
            # except: pass
            
        threading.Thread(target=_automate_generic, daemon=True).start()
        launch_control_bar("basic", show_title=title, delay=6.0)

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

def set_last_watched(show_title, season, episode, url):
    try:
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
            "url": url
        }
        
        with open(LAST_WATCHED_FILE, 'w') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Error saving last watched: {e}")

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

        elif self.path == '/api/open':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data)
                title = data.get('title', '')
                url = data.get('url', '')
                ctype = data.get('type', 'movies')
                
                open_link_logic(title, url, ctype)
                
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
                subprocess.Popen([sys.executable, control_bar_path, "--mode", "basic"])
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
                # Kill Chrome
                os.system("taskkill /IM chrome.exe /F")
                self._send_json({"status": "closed"})
            except Exception as e:
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
                # Launch in App mode (starts windowed by default usually)
                # ENABLE CDP: --remote-debugging-port=9222
                subprocess.Popen([CHROME_PATH, "--remote-debugging-port=9222", "--new-window", "--start-fullscreen", "--app=" + url])
                
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
