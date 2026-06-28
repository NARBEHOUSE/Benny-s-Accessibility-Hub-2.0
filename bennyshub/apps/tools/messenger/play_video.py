"""play_video.py — open a video URL fullscreen in Chrome with the accessible
control bar.

Mirrors the old PySide6 messenger's ``_launch_chrome_with_control_bar`` so Ben
gets the exact same experience: the video plays fullscreen (kiosk + the YouTube
player pushed into fullscreen) and the switch-friendly control bar appears so he
can pause and close the browser.

Usage:
    python play_video.py <url> [--app-title "Window Title"]

The new messenger's Electron main process minimizes its own window and then
launches this helper. Timing/fullscreen logic lives here in Python (matching the
proven old app) rather than in Node.
"""
import os
import sys
import time
import argparse
import subprocess


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

    # Launch Chrome in kiosk mode with remote debugging so the control bar can
    # drive playback over CDP.
    subprocess.Popen([
        chrome, "--new-window", "--kiosk",
        "--remote-debugging-port=9222", args.url,
    ])

    # Wait for Chrome/YouTube to load, then push the video into fullscreen by
    # pressing 'f' (same as the old app). pyautogui targets the focused Chrome
    # kiosk window.
    time.sleep(8)
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
