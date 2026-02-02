import os, json, subprocess
from threading import Lock
from flask import Flask, send_from_directory, jsonify, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = BASE_DIR

# Web keyboard predictions file
WEB_DATA_PATH = os.path.join(BASE_DIR, "web_keyboard_predictions.json")

lock = Lock()
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")

def get_default_data():
    """Return default empty prediction data structure"""
    return {"frequent_words": {}, "bigrams": {}, "trigrams": {}}

def load_web_data():
    """Load web keyboard prediction data or create default"""
    if not os.path.exists(WEB_DATA_PATH) or os.stat(WEB_DATA_PATH).st_size == 0:
        data = get_default_data()
        save_web_data(data)
        return data
    
    try:
        with open(WEB_DATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading web prediction data: {e}")
        data = get_default_data()
        save_web_data(data)
        return data

def save_web_data(data):
    """Save web keyboard prediction data"""
    try:
        with open(WEB_DATA_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Saved web prediction data to {WEB_DATA_PATH}")
    except Exception as e:
        print(f"Error saving web prediction data: {e}")

@app.route("/")
def root():
    """Serve the keyboard interface"""
    try:
        return send_from_directory(STATIC_DIR, "index.html")
    except Exception as e:
        return f"Error serving index.html: {str(e)}<br>Looking in: {STATIC_DIR}", 500

@app.route("/<path:filename>")
def static_files(filename):
    """Serve static files (CSS, JS, etc.)"""
    try:
        return send_from_directory(STATIC_DIR, filename)
    except Exception as e:
        return f"File not found: {filename}", 404

@app.route("/web_keyboard_predictions.json")
def serve_predictions_file():
    """Serve the predictions JSON file directly"""
    with lock:
        data = load_web_data()
    return jsonify(data)

@app.get("/api/predictive_ngrams")
def api_predictive():
    """Return web keyboard data"""
    with lock:
        data = load_web_data()
    return jsonify(data)

@app.post("/api/clear_predictions")
def api_clear_predictions():
    """Clear all predictions and reset to default"""
    try:
        with lock:
            # Delete the file if it exists
            if os.path.exists(WEB_DATA_PATH):
                os.remove(WEB_DATA_PATH)
                print(f"Deleted {WEB_DATA_PATH}")
            
            # Recreate with default data
            data = get_default_data()
            save_web_data(data)
        
        return jsonify({"ok": True, "message": "Predictions cleared and reset to default"})
    except Exception as e:
        print(f"Error clearing predictions: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500

@app.post("/api/close_chrome")
def api_close_chrome():
    """Close Chrome browsers gracefully"""
    try:
        print("Received request to close Chrome gracefully")
        
        # Try graceful shutdown first using Windows messaging
        import ctypes
        from ctypes import wintypes
        
        user32 = ctypes.windll.user32
        
        # Find Chrome windows and send close messages
        def enum_window_callback(hwnd, lparam):
            # Get window class name
            class_name = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(hwnd, class_name, 256)
            
            # Get window title
            title_length = user32.GetWindowTextLengthW(hwnd)
            if title_length > 0:
                title = ctypes.create_unicode_buffer(title_length + 1)
                user32.GetWindowTextW(hwnd, title, title_length + 1)
                
                # Be VERY specific about Chrome windows ONLY
                is_chrome_window = (
                    class_name.value == "Chrome_WidgetWin_1" and
                    (" - Google Chrome" in title.value or 
                     " - Chrome" in title.value or
                     title.value == "Google Chrome" or
                     title.value == "New Tab - Google Chrome" or
                     title.value.endswith(" - Google Chrome"))
                )
                
                if is_chrome_window:
                    print(f"Found Chrome browser window: '{title.value}' (class: {class_name.value})")
                    # Send WM_CLOSE message to close gracefully
                    user32.SendMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE = 0x0010
            
            return True
        
        # Define the callback function type
        EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
        callback = EnumWindowsProc(enum_window_callback)
        
        # Enumerate all windows and close Chrome ones
        user32.EnumWindows(callback, 0)
        
        # Give Chrome time to close gracefully
        import time
        time.sleep(2)
        
        # As a fallback, only use taskkill on chrome.exe specifically
        try:
            result = subprocess.run(["taskkill", "/im", "chrome.exe"], 
                                  capture_output=True, text=True, timeout=5)
            print(f"Graceful taskkill result: {result.returncode}")
        except Exception as e:
            print(f"Graceful taskkill failed: {e}")
        
        return jsonify({"ok": True, "message": "Chrome close initiated gracefully"})
    except Exception as e:
        print(f"Error closing Chrome gracefully: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500

@app.post("/api/volume_control")
def api_volume_control():
    """Control system volume"""
    try:
        payload = request.get_json(force=True) or {}
        action = payload.get("action", "")  # "up" or "down"
        steps = payload.get("steps", 1)  # number of steps to change
        
        if action not in ["up", "down"]:
            return jsonify({"ok": False, "error": "Invalid action. Use 'up' or 'down"}), 400
        
        print(f"Volume control: {action} by {steps} steps")
        
        # Use Windows volume keys
        import ctypes
        import time
        
        VK_VOLUME_UP = 0xAF
        VK_VOLUME_DOWN = 0xAE
        
        key = VK_VOLUME_UP if action == "up" else VK_VOLUME_DOWN
        
        # Send the key events for the specified number of steps
        for i in range(steps):
            ctypes.windll.user32.keybd_event(key, 0, 0, 0)  # Key down
            ctypes.windll.user32.keybd_event(key, 0, 0, 2)  # Key up
            time.sleep(0.05)  # Small delay between steps
        
        action_text = "increased" if action == "up" else "decreased"
        return jsonify({
            "ok": True, 
            "message": f"Volume {action_text} by {steps} steps"
        })
        
    except Exception as e:
        print(f"Error controlling volume: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500

@app.post("/api/save_prediction")
def api_save_prediction():
    """Save prediction data from the client"""
    try:
        payload = request.get_json(force=True) or {}
        word = payload.get("word", "").strip().upper()
        
        if not word:
            return jsonify({"ok": False, "error": "No word provided"}), 400
        
        with lock:
            data = load_web_data()
            timestamp = payload.get("timestamp") or "2024-01-01T00:00:00.000Z"
            
            if word not in data["frequent_words"]:
                data["frequent_words"][word] = {"count": 0, "last_used": timestamp}
            
            data["frequent_words"][word]["count"] += 1
            data["frequent_words"][word]["last_used"] = timestamp
            
            save_web_data(data)
        
        return jsonify({"ok": True, "message": f"Saved word: {word}"})
    except Exception as e:
        print(f"Error saving prediction: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500

@app.post("/api/save_ngram")
def api_save_ngram():
    """Save n-gram data from the client"""
    try:
        payload = request.get_json(force=True) or {}
        context = payload.get("context", "").strip().upper()
        next_word = payload.get("next_word", "").strip().upper()
        
        if not context or not next_word:
            return jsonify({"ok": False, "error": "Context and next_word required"}), 400
        
        with lock:
            data = load_web_data()
            timestamp = payload.get("timestamp") or "2024-01-01T00:00:00.000Z"
            
            ctx_words = context.split()
            
            # Save bigram
            if len(ctx_words) >= 1:
                bigram_key = f"{ctx_words[-1]} {next_word}"
                if bigram_key not in data["bigrams"]:
                    data["bigrams"][bigram_key] = {"count": 0, "last_used": timestamp}
                data["bigrams"][bigram_key]["count"] += 1
                data["bigrams"][bigram_key]["last_used"] = timestamp
            
            # Save trigram
            if len(ctx_words) >= 2:
                trigram_key = f"{ctx_words[-2]} {ctx_words[-1]} {next_word}"
                if trigram_key not in data["trigrams"]:
                    data["trigrams"][trigram_key] = {"count": 0, "last_used": timestamp}
                data["trigrams"][trigram_key]["count"] += 1
                data["trigrams"][trigram_key]["last_used"] = timestamp
            
            save_web_data(data)
        
        return jsonify({"ok": True, "message": f"Saved n-gram for: {next_word}"})
    except Exception as e:
        print(f"Error saving n-gram: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500

if __name__ == "__main__":
    print(f"Starting server...")
    print(f"Base directory: {BASE_DIR}")
    print(f"Static directory: {STATIC_DIR}")
    
    # List all files in the directory
    if os.path.exists(STATIC_DIR):
        files = os.listdir(STATIC_DIR)
        print(f"Files in directory: {files}")
        
        required_files = ["index.html", "app.js", "predictions.js", "style.css"]
        for file in required_files:
            if file in files:
                print(f"✓ Found {file}")
            else:
                print(f"✗ Missing {file}")
    
    print(f"Web prediction data will be stored at: {WEB_DATA_PATH}")
    
    # Initialize the predictions file if needed
    with lock:
        load_web_data()
    
    print("Server starting on http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)