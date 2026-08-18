"""play_video.py — open a video URL fullscreen in Chrome with the accessible
control bar.

Mirrors the old PySide6 messenger's ``_launch_chrome_with_control_bar`` so Ben
gets the exact same experience: the video plays fullscreen (kiosk + the YouTube
player pushed into fullscreen) and the switch-friendly control bar appears so he
can pause and close the browser.

Uses the DEFAULT Chrome profile so the family's YouTube login (Premium, no ads,
age-restriction handling) applies. That has one catch: if any Chrome instance is
already running — including the invisible background one from "Continue running
background apps when Chrome is closed" — a plain launch just hands the URL to it
("Opening in existing browser session.") and --kiosk is silently discarded, so
the video opens as an unfocused normal window buried behind the messenger.
FAILSAFE: close every running Chrome first (visible windows gracefully via
WM_CLOSE, then leftover/background processes), then launch fresh so kiosk mode
always takes.

Note: Chrome 136+ ignores --remote-debugging-port on the default profile, so on
modern Chrome the CDP niceties are unavailable and the control bar falls back to
media keys (play/pause) and system volume — the same behavior the old app had.
The CDP flags are still passed for machines running older Chrome.

Usage:
    python play_video.py <url> [--app-title "Window Title"]

The new messenger's Electron main process minimizes its own window and then
launches this helper. Timing/fullscreen logic lives here in Python (matching the
proven old app) rather than in Node.
"""
import os
import sys
import time
import json
import argparse
import subprocess
import urllib.request

CDP_PORT = 9222


def find_chrome():
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def close_all_chrome():
    """Failsafe: shut down every running Chrome so our kiosk launch starts a
    fresh instance instead of handing the URL to an existing session (which
    drops --kiosk and buries the video). Visible windows get a graceful
    WM_CLOSE first so their tabs land in session restore; the windowless
    background process is then terminated."""
    try:
        import psutil
    except Exception:
        psutil = None

    # 1. Graceful close of visible Chrome windows.
    try:
        import win32gui
        import win32con
        import win32process
        def _enum(hwnd, _res):
            try:
                if not win32gui.IsWindowVisible(hwnd):
                    return
                if not (win32gui.GetClassName(hwnd) or "").startswith("Chrome_WidgetWin"):
                    return
                if psutil:
                    _, pid = win32process.GetWindowThreadProcessId(hwnd)
                    if psutil.Process(pid).name().lower() != "chrome.exe":
                        return
                win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
            except Exception:
                pass
        win32gui.EnumWindows(_enum, None)
        time.sleep(1.5)
    except Exception:
        pass

    # 2. Terminate whatever is left (background instance has no window, so
    #    WM_CLOSE can never reach it). Also clear any stale control bar from a
    #    previous video so two bars don't stack.
    if not psutil:
        return
    ctrl_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "utils", "control_bar.py").lower()
    victims = []
    for p in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            if p.pid == os.getpid():
                continue
            name = (p.info.get("name") or "").lower()
            if name == "chrome.exe":
                victims.append(p)
            elif name in ("python.exe", "pythonw.exe"):
                cmd = " ".join(p.info.get("cmdline") or []).lower()
                if ctrl_path in cmd:
                    victims.append(p)
        except Exception:
            continue
    for p in victims:
        try:
            p.terminate()
        except Exception:
            pass
    if victims:
        try:
            psutil.wait_procs(victims, timeout=4)
            for p in victims:
                if p.is_running():
                    p.kill()
        except Exception:
            pass
        time.sleep(0.5)


def _cdp_tabs():
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json", timeout=0.5) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return []


def wait_for_video_page(timeout=6.0):
    """Poll CDP until the video tab exists. Returns its webSocketDebuggerUrl.
    On Chrome 136+ the port is ignored for the default profile, so this simply
    times out and the caller uses the classic keypress path instead."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        for t in _cdp_tabs():
            url = (t.get("url") or "").lower()
            if t.get("type") == "page" and url and not url.startswith("chrome"):
                if t.get("webSocketDebuggerUrl"):
                    return t.get("webSocketDebuggerUrl")
        time.sleep(0.5)
    return None


def cdp_ensure_play_and_fullscreen(ws_url):
    """Best-effort: start playback and push the player fullscreen over CDP so it
    works even if the kiosk window never got keyboard focus."""
    try:
        import websocket  # pip install websocket-client (control_bar uses it too)
    except Exception:
        return False
    try:
        ws = websocket.create_connection(ws_url, timeout=1.5)
    except Exception:
        return False
    try:
        def send(method, params=None, msg_id=1):
            payload = {"id": msg_id, "method": method}
            if params:
                payload["params"] = params
            ws.send(json.dumps(payload))
            ws.settimeout(1.5)
            try:
                return json.loads(ws.recv())
            except Exception:
                return None

        send("Runtime.enable")
        send("Runtime.evaluate", {
            "expression": "(async()=>{try{const v=document.querySelector('video'); if(v){await v.play().catch(()=>{});}}catch(e){}})();",
            "awaitPromise": True,
        })
        # 'f' is YouTube's player-fullscreen shortcut; dispatched over CDP it
        # works without the window being focused.
        send("Input.dispatchKeyEvent", {"type": "keyDown", "key": "f", "code": "KeyF", "windowsVirtualKeyCode": 0x46, "keyCode": 0x46})
        send("Input.dispatchKeyEvent", {"type": "keyUp", "key": "f", "code": "KeyF", "windowsVirtualKeyCode": 0x46, "keyCode": 0x46})
        return True
    finally:
        try:
            ws.close()
        except Exception:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--app-title", default="Ben \u2014 Discord Mirror",
                    help="Title of the messenger window to refocus on exit")
    args = ap.parse_args()

    chrome = find_chrome()
    if not chrome:
        import webbrowser
        webbrowser.open(args.url)
        return

    # Failsafe: a running Chrome (even the invisible background one) would
    # swallow --kiosk. Close everything first, then launch fresh.
    close_all_chrome()

    subprocess.Popen([
        chrome,
        "--new-window", "--kiosk",
        "--autoplay-policy=no-user-gesture-required",
        "--hide-crash-restore-bubble",
        # CDP flags: honored only on Chrome <136 (later versions ignore the
        # port on the default profile). Harmless otherwise; the control bar
        # then falls back to media keys.
        f"--remote-debugging-port={CDP_PORT}",
        "--remote-allow-origins=*",
        args.url,
    ])

    # If CDP is available (older Chrome), drive play + fullscreen focus-free.
    # Otherwise fall back to the old proven timing: wait for load, then press
    # 'f' at the focused kiosk window.
    ws_url = wait_for_video_page(timeout=6.0)
    handled = False
    if ws_url:
        time.sleep(3)
        handled = cdp_ensure_play_and_fullscreen(ws_url)
    if not handled:
        if not ws_url:
            time.sleep(3)  # ~9s total since launch, matching the old 8s sleep
        try:
            import pyautogui
            pyautogui.press("f")
        except Exception:
            pass

    # Give fullscreen a moment to take effect, then launch the accessible
    # control bar (it also ensures play + fullscreen over CDP as a backup).
    time.sleep(1)
    base = os.path.dirname(os.path.abspath(__file__))
    ctrl = os.path.abspath(os.path.join(base, "utils", "control_bar.py"))
    if os.path.exists(ctrl):
        CREATE_NO_WINDOW = 0x08000000
        try:
            subprocess.Popen(
                [sys.executable, ctrl, "--app-title", args.app_title, "--cdp"],
                creationflags=CREATE_NO_WINDOW,
            )
        except Exception:
            pass


if __name__ == "__main__":
    main()
