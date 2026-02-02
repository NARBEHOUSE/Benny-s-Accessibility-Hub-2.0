# narbe_keyboard_send.py
# Send-only NARBE keyboard that matches scan + predictive + TTS behavior of your scan browser
# Usage: python narbe_keyboard_send.py --out /path/to/result.json
# Writes: {"text":"..."} then exits on SEND

import os, sys, time, json, argparse, threading, queue
from dataclasses import dataclass
from typing import List, Optional
from PySide6 import QtCore, QtGui, QtWidgets
from PySide6.QtCore import Qt, QTimer
import subprocess

# ---------------- Recent Messages Cache ----------------
_RECENT_MESSAGES_FILE = None
_RECENT_MESSAGES_MAX = 100  # Keep last 100 sent messages

def _get_recent_messages_path():
    """Get path to recent messages cache file."""
    global _RECENT_MESSAGES_FILE
    if _RECENT_MESSAGES_FILE is None:
        here = os.path.dirname(__file__)
        _RECENT_MESSAGES_FILE = os.path.join(here, "recent_messages.json")
    return _RECENT_MESSAGES_FILE

def _load_recent_messages():
    """Load recent messages from cache file."""
    try:
        path = _get_recent_messages_path()
        if not os.path.exists(path):
            return []
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("messages", [])
    except Exception:
        return []

def _save_recent_message(text: str):
    """Save a sent message to recent messages cache."""
    try:
        if not text or not text.strip():
            return
        
        path = _get_recent_messages_path()
        messages = _load_recent_messages()
        
        # Normalize the message
        normalized = " ".join(text.strip().split())
        
        # Remove if already exists (move to front)
        messages = [m for m in messages if m.lower() != normalized.lower()]
        
        # Add to front
        messages.insert(0, normalized)
        
        # Keep only recent ones
        messages = messages[:_RECENT_MESSAGES_MAX]
        
        # Save
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"messages": messages}, f, indent=2)
    except Exception:
        pass

def _predict_from_recent(context_words, prefix, limit=6):
    """Get predictions from recently sent messages."""
    try:
        messages = _load_recent_messages()
        if not messages:
            return []
        
        # Normalize inputs
        ctx = [str(w).lower() for w in (context_words or [])]
        pfx = (prefix or "").lower()
        
        scores = {}
        
        # Strategy 1: If we have context, look for messages that contain that context sequence
        if ctx:
            ctx_len = len(ctx)
            for msg in messages:
                # Split message into words to avoid partial matches like "i" in "going"
                msg_words = msg.lower().split()
                
                # We need at least ctx_len + 1 words to have a 'next' word
                if len(msg_words) <= ctx_len:
                    continue
                    
                # Look for the sequence
                for i in range(len(msg_words) - ctx_len):
                    # Check if the sequence matches
                    if msg_words[i : i + ctx_len] == ctx:
                        # The next word is at i + ctx_len
                        next_word = msg_words[i + ctx_len]
                        
                        if not pfx or next_word.startswith(pfx):
                            # Higher score for more recent messages
                            score = len(messages) - messages.index(msg)
                            scores[next_word] = scores.get(next_word, 0) + score
        
        # Strategy 2: If we have a prefix, find matching words from any position
        if pfx:
            for msg in messages:
                words = msg.lower().split()
                for word in words:
                    if word.startswith(pfx):
                        score = len(messages) - messages.index(msg)
                        scores[word] = scores.get(word, 0) + score * 0.5
        
        # Strategy 3: If no context/prefix, suggest first words of recent messages
        if not ctx and not pfx:
            for msg in messages:
                words = msg.lower().split()
                if words:
                    first_word = words[0]
                    score = len(messages) - messages.index(msg)
                    scores[first_word] = scores.get(first_word, 0) + score * 0.3
        
        # Sort by score and return top results
        sorted_words = sorted(scores.items(), key=lambda x: -x[1])
        return [word for word, _ in sorted_words[:limit]]
    except Exception:
        return []

# ---------------- TTS queue (matches your browser keyboard style) ----------------
try:
    import pyttsx3
except Exception:
    pyttsx3 = None

_tts_queue = None
_tts_thread = None
_tts_ready = False

def _tts_worker():
    global _tts_ready
    try:
        engine = pyttsx3.init()
        _tts_ready = True
        while True:
            txt = _tts_queue.get()
            if txt is None:
                break
            # coalesce queue to latest
            try:
                while True:
                    nxt = _tts_queue.get_nowait()
                    if nxt is None:
                        txt = None
                        break
                    txt = nxt
            except queue.Empty:
                pass
            if txt is None:
                break
            try:
                engine.stop()
            except Exception:
                pass
            try:
                engine.say(str(txt))
                engine.runAndWait()
            except Exception:
                pass
    except Exception:
        pass
    finally:
        _tts_ready = False

WORD_PRONUNCIATION_MAP = {
    'IS': 'is', 'IT': 'it', 'IN': 'in', 'IF': 'if', 'OF': 'of', 'OR': 'or', 'ON': 'on',
    'TO': 'to', 'GO': 'go', 'NO': 'no', 'SO': 'so', 'DO': 'do', 'UP': 'up', 'AT': 'at',
    'AS': 'as', 'AN': 'an', 'AM': 'am', 'BE': 'be', 'BY': 'by', 'MY': 'my', 'WE': 'we',
    'HE': 'he', 'ME': 'me', 'US': 'us', 'HI': 'hi', 'OK': 'okay', 'OH': 'oh', 'AH': 'ah'
}

def speak(text: str):
    if not text:
        return
    
    # Apply pronunciation map
    upper_text = text.strip().upper()
    if upper_text in WORD_PRONUNCIATION_MAP:
        text = WORD_PRONUNCIATION_MAP[upper_text]
        
    try:
        if _tts_queue:
            # keep queue lean - clear everything to interrupt pending
            while not _tts_queue.empty():
                try: _tts_queue.get_nowait()
                except Exception: break
            _tts_queue.put_nowait(str(text))
    except Exception:
        pass

# ---------------- Predictions (KenLM optional + local n-gram fallback) ----------------
import json as _json

# Use the KenLM API URL you provided
KENLM_API = os.environ.get("KENLM_API", "https://api.imagineville.org/word/predict")
KENLM_TIMEOUT = 2  # seconds
DEFAULT_WORDS = ["yes", "no", "help", "the", "you", "i"]

# New: keep a single session and make URL robust
try:
    import requests as _requests
except Exception:
    _requests = None

_KENLM_SESSION = None
def _get_session():
    global _KENLM_SESSION
    if _requests is None:
        return None
    if (_KENLM_SESSION is None):
        try:
            _KENLM_SESSION = _requests.Session()
        except Exception:
            _KENLM_SESSION = None
    return _KENLM_SESSION

def _norm_api_url(url: str) -> str:
    if not url:
        return ""
    u = url.strip()
    if not (u.startswith("http://") or u.startswith("https://")):
        u = "http://" + u
    return u.rstrip("/")

def _parse_kenlm(data):
    # Accept a wide variety of payloads
    if data is None:
        return []
    # Raw text body
    if isinstance(data, (str, bytes)):
        try:
            s = data.decode("utf-8") if isinstance(data, (bytes, bytearray)) else data
        except Exception:
            s = str(data)
        arr = [ln.strip() for ln in s.splitlines() if ln.strip()]
        return arr
    # List of strings/dicts
    if isinstance(data, list):
        out = []
        for item in data:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, dict):
                tok = item.get("text") or item.get("token") or item.get("word") or item.get("completion")
                if tok:
                    out.append(str(tok))
        return out
    # Dict with various common fields
    if isinstance(data, dict):
        for k in ("suggestions", "result", "results", "candidates", "predictions", "completions", "words", "choices", "tokens"):
            if k in data and isinstance(data[k], (list, str)):
                return _parse_kenlm(data[k])
        # Some APIs wrap under "data"
        if "data" in data:
            return _parse_kenlm(data["data"])
    return []

def fetch_kenlm(context_words, prefix, limit=6):
    api = _norm_api_url(KENLM_API)
    if not api or _requests is None:
        return []
    sess = _get_session()
    if sess is None:
        return []

    # Normalize inputs like the browser keyboard would
    try:
        ctx = [str(w).lower() for w in (context_words or [])]
        # cap left context to last 3 tokens
        if len(ctx) > 3:
            ctx = ctx[-3:]
        pfx = (prefix or "").lower()
        lim = int(limit or 6)
    except Exception:
        ctx, pfx, lim = [], "", 6

    headers = {"Accept": "application/json"}

    # Try GET query style FIRST (faster for default API)
    try:
        params = {"num": str(lim), "sort": "logprob", "safe": "true", "lang": "en"}
        if pfx:
            params["prefix"] = pfx
        if ctx:
            params["left"] = " ".join(ctx)
        r = sess.get(api, params=params, headers=headers, timeout=KENLM_TIMEOUT)
        if r.ok:
            try:
                out = _parse_kenlm(r.json())
            except Exception:
                out = _parse_kenlm(r.text)
            if out:
                return out[:lim]
    except Exception:
        pass

    # Try POST shapes commonly used by KenLM gateways
    try:
        payloads = [
            {"left": " ".join(ctx), "prefix": pfx, "num": lim},  # GET/POST style: left/prefix/num
            {"context": ctx, "prefix": pfx, "limit": lim},       # original shape
        ]
        for body in payloads:
            try:
                r = sess.post(api, json=body, headers=headers, timeout=KENLM_TIMEOUT)
                if r.ok:
                    try:
                        out = _parse_kenlm(r.json())
                    except Exception:
                        out = _parse_kenlm(r.text)
                    if out:
                        return out[:lim]
            except Exception:
                continue
    except Exception:
        pass

    return []

def _load_local_ngrams():
    try:
        here = os.path.dirname(__file__)
        path = os.path.join(here, "predictive_ngrams.json")
        if not os.path.exists(path):
            return {}, {}, {}
        data = json.load(open(path, "r", encoding="utf-8"))
        fw  = {k.upper():v for k,v in (data.get("frequent_words") or {}).items()}
        bi  = {k.upper():v for k,v in (data.get("bigrams") or {}).items()}
        tri = {k.upper():v for k,v in (data.get("trigrams") or {}).items()}
        return fw, bi, tri
    except Exception:
        return {}, {}, {}

_FREQ, _BI, _TRI = _load_local_ngrams()

def _fallback_ngram(raw_text: str, limit=6):
    txt = (raw_text or "")
    up_txt = txt.upper().strip()
    if not up_txt:
        return DEFAULT_WORDS[:limit]
    trailing = txt.endswith(" ")
    parts = up_txt.split()
    cur = "" if trailing else (parts[-1] if parts else "")
    left = " ".join(parts[:-1]) if (not trailing and len(parts) > 1) else (" ".join(parts) if trailing else "")
    scores = {}
    if left:
        ctx = left.split()
        if len(ctx) >= 2:
            key = " ".join(ctx[-2:]) + " "
            for k, d in _TRI.items():
                if k.startswith(key):
                    nxt = k.split()[-1]
                    if (not cur) or nxt.startswith(cur):
                        scores[nxt] = scores.get(nxt, 0) + 10 * float(d.get("count", 0))
        if len(ctx) >= 1:
            key = ctx[-1] + " "
            for k, d in _BI.items():
                if k.startswith(key):
                    nxt = k.split()[-1]
                    if (not cur) or nxt.startswith(cur):
                        scores[nxt] = scores.get(nxt, 0) + 5 * float(d.get("count", 0))
    if not scores and cur:
        for w, d in _FREQ.items():
            if w.startswith(cur):
                scores[w] = scores.get(w, 0) + float(d.get("count", 0))
    out = [w.lower() for w,_ in sorted(scores.items(), key=lambda kv: -kv[1])]
    for w in DEFAULT_WORDS:
        if len(out) >= limit: break
        if w not in out: out.append(w)
    return out[:limit]

class PredictWorker(QtCore.QObject):
    request = QtCore.Signal(int, str)
    ready   = QtCore.Signal(int, str, list)
    @QtCore.Slot(int, str)
    def _on_request(self, rid: int, text: str):
        try:
            raw = text or ""
            trailing = raw.endswith(" ")
            parts = raw.strip().split()
            prefix = "" if trailing else (parts[-1] if parts else "")
            ctx = parts[:-1] if (parts and not trailing) else parts
            
            # If text is completely empty, return default words immediately
            if not raw.strip():
                self.ready.emit(rid, text, DEFAULT_WORDS[:6])
                return
            
            # 1. FAST PATH: Recent + Local N-gram
            recent_words = _predict_from_recent(ctx, prefix, 6)
            fallback_words = _fallback_ngram(raw, 6)
            
            # Merge recent + fallback for immediate display
            fast_combined = list(recent_words)
            for word in fallback_words:
                if word.lower() not in [w.lower() for w in fast_combined]:
                    fast_combined.append(word)
                if len(fast_combined) >= 6:
                    break
            
            # Emit fast results immediately so user sees something
            self.ready.emit(rid, text, fast_combined[:6])
            
            # If we already have enough from recent, we might skip KenLM, 
            # but KenLM is usually smarter than local n-gram, so let's try it 
            # unless we have a full set of recent matches (which are high quality).
            if len(recent_words) >= 6:
                return

            # 2. SLOW PATH: Fetch KenLM
            # We use a shorter timeout here to not block the thread too long if network is bad
            kenlm_words = fetch_kenlm(ctx, prefix, 6) or []
            
            if not kenlm_words:
                return

            # Merge: recent first, then KenLM, then fallback
            final_combined = list(recent_words)
            
            # Add KenLM words
            for word in kenlm_words:
                if word.lower() not in [w.lower() for w in final_combined]:
                    final_combined.append(word)
                if len(final_combined) >= 6:
                    break
            
            # Fill rest with fallback if needed
            if len(final_combined) < 6:
                for word in fallback_words:
                    if word.lower() not in [w.lower() for w in final_combined]:
                        final_combined.append(word)
                    if len(final_combined) >= 6:
                        break
            
            # Only emit again if the results are actually different
            final_result = final_combined[:6]
            if final_result != fast_combined[:6]:
                self.ready.emit(rid, text, final_result)
                
        except Exception:
            self.ready.emit(rid, text, _fallback_ngram(text, 6))

# ---------------- UI scaffolding ----------------
FOCUS_STYLE = "border: 3px solid #FFD64D; background: rgba(255,214,77,0.10);"

@dataclass
class RowDef:
    wrap: QtWidgets.QFrame
    widgets: list
    id: str
    label: str

class SendKeyboard(QtWidgets.QMainWindow):
    def __init__(self, out_path: str):
        super().__init__()
        self.out_path = out_path

        # Fullscreen and base style
        self.setWindowTitle("NARBE — Send")
        self.setStyleSheet("""
background:#0b0f14; color:#e9eef5;

/* Base button shape and weight */
QPushButton{
    border:2px solid #000;
    border-radius:12px;
    padding:18px 22px;
    font-weight:900;
}

/* Big fonts by role */
QPushButton[role="control"]{ font-size: 30pt; }
QPushButton[role="alpha"]  { font-size: 36pt; }
QPushButton[role="pred"]   { font-size: 24pt; }

/* Row outline when focused (support both true forms) */
QFrame[scanRow="true"][focused="true"],
QFrame[scanRow=true][focused=true]{
    border:3px solid #FFD64D;
    border-radius:12px;
}

/* Button outline when focused (support both true forms) */
QPushButton[focused="true"],
QPushButton[focused=true]{
    border:3px solid #FFD64D;
    background:rgba(255,214,77,0.20);
}

/* Text inputs */
QLineEdit, QTextEdit{
    border:1px solid rgba(255,255,255,0.15);
    border-radius:8px;
    padding:10px 12px;
    font-size:24pt;
}
QLineEdit[focused="true"], QTextEdit[focused="true"],
QLineEdit[focused=true],  QTextEdit[focused=true]{
    border:3px solid #FFD64D;
}

/* Primary */
QPushButton[variant="primary"]{
    background:#2a7; color:#000; font-weight:900;
}
""")
        self.showFullScreen()

        # Scan state (aligned with scan browser)
        self.mode = "ROWS"      # ROWS | KEYS
        self.row_idx = 0
        self.key_idx = 0

        # Timers and thresholds
        self.SHORT_MIN = 250
        self.SHORT_MAX = 3000

        # Updated: continuous backward scan like browser app - SLOWER for keyboard
        self.SCAN_BACK_FIRST_MS = int(os.environ.get("SCAN_BACK_FIRST_MS", "2500"))
        self.SCAN_BACK_STEP_MS  = int(os.environ.get("SCAN_BACK_STEP_MS", "2500"))  # 2.5 seconds per step

        self.space_down = False
        self.space_at = 0.0
        self.space_scanned = False
        self.space_timer = QTimer(self)
        self.space_timer.setSingleShot(True)
        self.space_timer.timeout.connect(self._space_prev)

        self.ENTER_HOLD_MS = 3000
        self.enter_down = False
        self.enter_at = 0.0
        self.enter_long_fired = False
        self.enter_timer = QTimer(self); self.enter_timer.setSingleShot(True); self.enter_timer.setInterval(self.ENTER_HOLD_MS)
        self.enter_timer.timeout.connect(self._on_enter_hold)

        self.INPUT_COOLDOWN_MS = 500
        self._cooldown_until_ms = 0

        # One time suppression for row label TTS when jumping to predictive row
        self._suppress_row_label_once = False
        # Flag to suppress reading predictive row after selecting a word
        self._just_selected_pred = False

        # Predictions
        self.pred_req_id = 0
        self._pred_current = [""]*6
        self.pred_timer = QTimer(self); self.pred_timer.setSingleShot(True); self.pred_timer.setInterval(120)
        self._pred_read_gen = 0

        # Text auto-fit bounds
        self.TEXT_MAX_PT = int(os.environ.get("TEXT_MAX_PT", "80"))
        self.TEXT_MIN_PT = int(os.environ.get("TEXT_MIN_PT", "36"))
        
        # Two-tier sizing: large (one line) and small (two lines)
        self.ONE_LINE_PT = int(os.environ.get("ONE_LINE_PT", "80"))  # starting large size
        self.TWO_LINE_PT = max(self.TEXT_MIN_PT, self.ONE_LINE_PT // 2)  # ~half

        # Build UI
        self._make_ui()
        self._highlight_rows()

        # Prediction thread
        self.pred_thread = QtCore.QThread(self)
        self.pred_worker = PredictWorker()
        self.pred_worker.moveToThread(self.pred_thread)
        self.pred_worker.request.connect(self.pred_worker._on_request)
        self.pred_worker.ready.connect(self._on_predictions_ready)
        self.pred_thread.start()
        self.pred_timer.timeout.connect(self._refresh_predictions_async)

        # Seed predictions once on startup
        self._schedule_predictions()

        # Start TTS worker
        global _tts_queue, _tts_thread
        _tts_queue = queue.Queue(maxsize=8)
        _tts_thread = threading.Thread(target=_tts_worker, daemon=True); _tts_thread.start()

        # Capture space and enter globally
        app = QtWidgets.QApplication.instance()
        if app: app.installEventFilter(self)

    # ---------- UI build ----------
    def _make_ui(self):
        root = QtWidgets.QWidget()
        v = QtWidgets.QVBoxLayout(root)
        v.setContentsMargins(4,4,4,4)   # minimal margins
        v.setSpacing(4)                 # minimal spacing

        # Tiny header
        top = QtWidgets.QHBoxLayout()
        title = QtWidgets.QLabel("<b>NARBE</b> Send"); title.setStyleSheet("font-size:16px;")
        self.status = QtWidgets.QLabel("Mode: Rows • Space=next • Enter=select"); self.status.setStyleSheet("color:#9fb6c9; font-size:10px;")
        top.addWidget(title); top.addStretch(1); top.addWidget(self.status)
        top.setContentsMargins(0,0,0,0)
        v.addLayout(top)

        # Calculate available screen height for rows
        screen = QtWidgets.QApplication.primaryScreen().availableGeometry()
        header_height = 30  # approximate header height
        avail_height = screen.height() - header_height - 20  # leave small buffer
        # 9 total rows (text + controls + 6 alpha + predictive)
        # Make text row taller to accommodate 2 lines
        row_height = max(60, (avail_height - 80) // 8)  # 8 regular rows, leave extra for text
        text_row_height = max(100, row_height * 1.3)  # Taller for 2 lines
        
        # Store row heights for font sizing
        self.row_height = row_height
        self.text_row_height = text_row_height
        
        # Adjust two-tier font sizes based on actual row height
        approx_large = max(40, int(self.text_row_height * 0.55))  # scale with row height
        self.ONE_LINE_PT = approx_large
        self.TWO_LINE_PT = max(self.TEXT_MIN_PT, approx_large // 2)

        # Text row (same height as other rows)
        text_wrap = QtWidgets.QFrame()
        text_wrap.setAttribute(Qt.WA_StyledBackground, True)
        text_wrap.setStyleSheet("""
QFrame {
  background-color:#ADD8E6;
  border:2px solid #000;
  border-radius:12px;
}""")
        text_wrap.setFixedHeight(text_row_height)
        twv = QtWidgets.QVBoxLayout(text_wrap); twv.setContentsMargins(1,1,1,1)  # Even less margins
        
        # Create a container widget for the text and cursor
        text_container = QtWidgets.QWidget()
        text_container_layout = QtWidgets.QHBoxLayout(text_container)
        text_container_layout.setContentsMargins(0,0,0,0)
        text_container_layout.setSpacing(0)
        
        self.text = QtWidgets.QTextEdit()
        self.text.setReadOnly(True)  # KEEP READ-ONLY - no typing allowed
        self.text.setAcceptRichText(False)
        self.text.setAlignment(Qt.AlignCenter)  # CENTER align for better appearance
        self.text.setWordWrapMode(QtGui.QTextOption.WrapAtWordBoundaryOrAnywhere)
        self.text.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.text.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        # Set up for mostly single-line behavior
        self.text.setLineWrapMode(QtWidgets.QTextEdit.WidgetWidth)
        # Center-align text
        opt = QtGui.QTextOption()
        opt.setAlignment(Qt.AlignCenter)  # CENTER alignment
        opt.setWrapMode(QtGui.QTextOption.WrapAtWordBoundaryOrAnywhere)
        self.text.document().setDefaultTextOption(opt)
        self.text.setStyleSheet("""
QTextEdit{
  background:transparent;
  border:none;
  padding:2px 12px;  /* Small vertical padding, good horizontal */
  /* font-size removed - controlled programmatically */
  font-weight:800;
  color:black !important;  /* force black text */
  line-height: 1.1;  /* Tighter line spacing for 2 lines */
}""")
        pal = self.text.palette()
        # Set all possible text color roles to black
        black = QtGui.QColor(0, 0, 0, 255)  # Fully opaque black
        pal.setColor(QtGui.QPalette.ColorRole.Text, black)
        pal.setColor(QtGui.QPalette.ColorRole.WindowText, black)
        pal.setColor(QtGui.QPalette.ColorRole.HighlightedText, black)
        pal.setColor(QtGui.QPalette.ColorRole.PlaceholderText, black)
        pal.setColor(QtGui.QPalette.ColorRole.ButtonText, black)
        pal.setColor(QtGui.QPalette.ColorRole.Base, QtGui.QColor("transparent"))
        pal.setColor(QtGui.QPalette.ColorRole.AlternateBase, QtGui.QColor("transparent"))
        self.text.setPalette(pal)
        # Force document default text format to black
        self.text.setTextColor(black)
        # Set document default text option
        opt = QtGui.QTextOption()
        opt.setAlignment(Qt.AlignCenter)  # CENTER alignment
        self.text.document().setDefaultTextOption(opt)
        # Force the document's default format
        fmt = QtGui.QTextCharFormat()
        fmt.setForeground(black)
        self.text.document().setDefaultFont(QtGui.QFont("Arial", 48, QtGui.QFont.Bold))
        
        # Create cursor as a separate widget overlay
        self.cursor_widget = QtWidgets.QLabel("|", self.text.viewport())
        self.cursor_widget.setAttribute(Qt.WA_TransparentForMouseEvents, True)
        self.cursor_widget.setStyleSheet("""
QLabel {
  background: black;  /* Solid black background instead of just text */
  color: black;
  font-size: 48px;
  font-weight: 900;
  padding: 0px;
  border: none;
}""")
        self.cursor_widget.hide()
        
        # Add blinking cursor animation
        self._cursor_visible = True
        self._cursor_timer = QTimer(self)
        self._cursor_timer.setInterval(500)  # Blink every 500ms
        self._cursor_timer.timeout.connect(self._toggle_cursor)
        self._cursor_timer.start()
        
        # No text change handler needed since we're read-only
        
        twv.addWidget(self.text)
        v.addWidget(text_wrap)
        
        # Connect text content change to reposition cursor
        self.text.document().contentsChanged.connect(self._update_cursor_position)
        self.text.verticalScrollBar().valueChanged.connect(self._update_cursor_position)
        self.text.horizontalScrollBar().valueChanged.connect(self._update_cursor_position)

        # Controls row
        controls_wrap = QtWidgets.QFrame()
        controls_wrap.setAttribute(Qt.WA_StyledBackground, True)
        controls_wrap.setStyleSheet("background:#0f1521; border-radius:12px;")
        controls_wrap.setFixedHeight(row_height)
        cw = QtWidgets.QHBoxLayout(controls_wrap); cw.setContentsMargins(4,4,4,4); cw.setSpacing(4)
        self.btn_space = self._btn("SPACE", action="space_char", height=row_height-12, role="control")
        self.btn_dl = self._btn("DEL LETTER", action="del_letter", height=row_height-12, role="control")
        self.btn_dw = self._btn("DEL WORD", action="del_word", height=row_height-12, role="control")
        self.btn_cl = self._btn("CLEAR", action="clear", height=row_height-12, role="control")
        self.btn_send = self._btn("SEND", action="send", primary=True, height=row_height-12, role="control")
        self.btn_close = self._btn("CLOSE", action="close_keyboard", height=row_height-12, role="control")
        for b in (self.btn_space, self.btn_dl, self.btn_dw, self.btn_cl, self.btn_send, self.btn_close):
            cw.addWidget(b)
        v.addWidget(controls_wrap)

        # Alpha rows
        self.row_frames = []; self.row_buttons = []
        def add_alpha(chars, label):
            fr = QtWidgets.QFrame()
            fr.setAttribute(Qt.WA_StyledBackground, True)
            fr.setStyleSheet("background:#0f1521; border-radius:12px;")
            fr.setFixedHeight(row_height)
            lay = QtWidgets.QHBoxLayout(fr); lay.setContentsMargins(4,4,4,4); lay.setSpacing(4)
            btns=[]
            for ch in chars:
                b = self._btn(ch, char=ch, height=row_height-12, role="alpha")
                lay.addWidget(b); btns.append(b)
            v.addWidget(fr)
            self.row_frames.append((fr, label))
            self.row_buttons.append(btns)
        add_alpha("ABCDEF","a b c d e f")
        add_alpha("GHIJKL","g h i j k l")
        add_alpha("MNOPQR","m n o p q r")
        add_alpha("STUVWX","s t u v w x")
        add_alpha("YZ0123","y z 0 1 2 3")
        add_alpha("456789","4 5 6 7 8 9")

        # Predictive row
        pred_wrap = QtWidgets.QFrame()
        pred_wrap.setAttribute(Qt.WA_StyledBackground, True)
        pred_wrap.setStyleSheet("background:#0f1521; border-radius:12px;")
        pred_wrap.setFixedHeight(row_height)
        pl = QtWidgets.QHBoxLayout(pred_wrap); pl.setContentsMargins(4,4,4,4); pl.setSpacing(4)
        self.pred_btns = [self._btn("", pred=True, height=row_height-12, role="pred") for _ in range(6)]
        for b in self.pred_btns: pl.addWidget(b)
        v.addWidget(pred_wrap)
        # Schedule initial predictive font fitting after layout
        QtCore.QTimer.singleShot(0, self._fit_pred_fonts)

        # Register scan rows
        self.rows: List[RowDef] = []
        self.rows.append(RowDef(text_wrap, [self.text], "row_text", "text"))
        self.rows.append(RowDef(controls_wrap, [self.btn_space,self.btn_dl,self.btn_dw,self.btn_cl,self.btn_send,self.btn_close], "row_controls", "controls"))
        ids = ["row1","row2","row3","row4","row5","row6"]
        for idx,(fr,label) in enumerate(self.row_frames):
            self.rows.append(RowDef(fr, self.row_buttons[idx], ids[idx], label))
        self.rows.append(RowDef(pred_wrap, self.pred_btns, "predRow", "predictive text"))
        for rd in self.rows:
            rd.wrap.setObjectName(rd.id)
            rd.wrap.setProperty("scanRow", True)
            rd.wrap.setAttribute(Qt.WA_StyledBackground, True)
            rd.wrap.style().unpolish(rd.wrap); rd.wrap.style().polish(rd.wrap); rd.wrap.update()

        self.setCentralWidget(root)
        # Initial fit - don't position cursor yet
        QtCore.QTimer.singleShot(0, self._auto_fit_text_font)

    def _btn(self, text, action: Optional[str]=None, char: Optional[str]=None, pred: bool=False, primary: bool=False, height: int=80, role: str="alpha"):
        b = QtWidgets.QPushButton()
        
        # For control buttons, create icon + text layout
        if role == "control":
            # Map actions to symbols and labels
            icon_map = {
                "space_char": ("—", "SPACE"),      # EM dash for space
                "del_letter": ("⌫", "DEL LETTER"), # Backspace symbol
                "del_word": ("⌦", "DEL WORD"),     # Delete symbol
                "clear": ("⌧", "CLEAR"),           # Clear symbol
                "send": ("↵", "SEND"),             # Return symbol
                "close_keyboard": ("✕", "CLOSE")   # X symbol
            }
            
            if action in icon_map:
                symbol, label = icon_map[action]
                # Create a vertical layout with symbol on top, text below
                layout = QtWidgets.QVBoxLayout(b)
                layout.setContentsMargins(2, 2, 2, 2)
                layout.setSpacing(2)
                
                # Large symbol
                symbol_label = QtWidgets.QLabel(symbol)
                symbol_label.setAlignment(Qt.AlignCenter)
                symbol_label.setStyleSheet(f"""
                    font-size: {max(20, int(height * 0.4))}px;
                    font-weight: normal;
                    color: white;
                    background: transparent;
                    border: none;
                """)
                
                # Small text
                text_label = QtWidgets.QLabel(label)
                text_label.setAlignment(Qt.AlignCenter)
                text_label.setStyleSheet(f"""
                    font-size: {max(8, int(height * 0.15))}px;
                    font-weight: 600;
                    color: white;
                    opacity: 0.7;
                    background: transparent;
                    border: none;
                """)
                
                layout.addWidget(symbol_label, 1)  # Takes more space
                layout.addWidget(text_label, 0)    # Takes less space
                
                b.setLayout(layout)
            else:
                b.setText(text)
        else:
            b.setText(text)
        
        if primary:
            b.setProperty("variant", "primary")
        b.setProperty("action", action)
        b.setProperty("char", char)
        b.setProperty("pred", pred)
        b.setProperty("role", role)  # control | alpha | pred
        b.setFixedHeight(height)
        b.setSizePolicy(QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Fixed)
        
        # For non-control buttons, set safety net font
        if role != "control":
            f = QtGui.QFont()
            ps = max(30, min(48, int(height * 0.55)))
            f.setPointSize(ps)
            f.setWeight(QtGui.QFont.Black)
            b.setFont(f)
        
        b.clicked.connect(lambda _=False, btn=b: self._perform(btn))
        return b

    # Helpers to abstract text widget differences and keep uppercase
    def _get_text(self) -> str:
        try:
            if isinstance(self.text, QtWidgets.QTextEdit):
                return self.text.toPlainText()
            return self.text.text()
        except Exception:
            return ""
            
    def _set_text(self, s: str):
        try:
            s2 = (s or "").upper()
            if isinstance(self.text, QtWidgets.QTextEdit):
                # Block signal during programmatic set to avoid jitter then re-fit
                self.text.blockSignals(True)
                self.text.setPlainText(s2)
                # Force text color to black after setting text
                self.text.selectAll()
                black = QtGui.QColor(0, 0, 0, 255)
                self.text.setTextColor(black)
                cursor = self.text.textCursor()
                cursor.clearSelection()
                self.text.setTextCursor(cursor)
                self.text.blockSignals(False)
                # Re-apply center alignment after setting text
                self.text.setAlignment(Qt.AlignCenter)
            else:
                self.text.setText(s2)
        finally:
            self._auto_fit_text_font()
            self._update_cursor_position()

    def _toggle_cursor(self):
        # Toggle cursor visibility for blinking effect
        if not hasattr(self, "text"):
            return
        txt = self._get_text()
        if not txt:  # No text - hide cursor completely
            self.cursor_widget.hide()
            self._cursor_visible = False
            return
        # Text exists - toggle visibility
        self._cursor_visible = not self._cursor_visible
        if self._cursor_visible:
            self.cursor_widget.show()
        else:
            self.cursor_widget.hide()
    
    def _update_cursor_position(self):
        # Position the cursor widget at the end of the text (hide if empty)
        try:
            if not hasattr(self, "text") or not isinstance(self.text, QtWidgets.QTextEdit):
                return
            
            txt = self._get_text()
            
            if not txt:  # Empty text - hide cursor completely
                self.cursor_widget.hide()
                return
                
            # Text exists - position cursor at end of text
            cursor = self.text.textCursor()
            cursor.movePosition(QtGui.QTextCursor.End)
            
            # Get the rectangle for cursor position
            rect = self.text.cursorRect(cursor)
            
            # Make cursor a solid black vertical line
            f = self.cursor_widget.font()
            pt_size = self.text.font().pointSize()
            f.setPointSize(pt_size)
            
            # Set cursor as a narrow solid black rectangle (not just text)
            fm = QtGui.QFontMetrics(f)
            cursor_width = 3  # 3px wide solid line
            cursor_height = fm.height()
            
            # Position cursor widget
            self.cursor_widget.move(rect.x(), rect.y())
            self.cursor_widget.resize(cursor_width, cursor_height)
            self.cursor_widget.setText("")  # No text, just solid black background
            
            # Show/hide based on current blink state (only if text exists)
            if self._cursor_visible:
                self.cursor_widget.show()
            else:
                self.cursor_widget.hide()
        except Exception:
            pass

    # Auto-fit the text font so content fits within the text box height
    def _auto_fit_text_font(self):
        try:
            if not hasattr(self, "text") or not isinstance(self.text, QtWidgets.QTextEdit):
                return

            txt = self._get_text()
            vp = self.text.viewport()
            avail_w = max(10, vp.width() - 24)   # leave a bit for padding/cursor
            avail_h = max(10, vp.height() - 2)

            # Helper to check doc height for a given point size
            def doc_height_for(pt: int) -> tuple:
                f = self.text.font()
                f.setPointSize(pt)
                f.setBold(True)
                doc = QtGui.QTextDocument()
                doc.setDefaultFont(f)
                opt = QtGui.QTextOption()
                opt.setAlignment(Qt.AlignCenter)
                opt.setWrapMode(QtGui.QTextOption.WrapAtWordBoundaryOrAnywhere)
                doc.setDefaultTextOption(opt)
                doc.setTextWidth(avail_w)
                doc.setPlainText(txt)
                doc.adjustSize()
                return doc.size().height(), f

            # 1) Try LARGE: must fit on a single line
            f_large = self.text.font()
            f_large.setPointSize(self.ONE_LINE_PT)
            f_large.setBold(True)
            fm_large = QtGui.QFontMetricsF(f_large)
            single_line_width = fm_large.horizontalAdvance(txt) if txt else 0.0
            single_line_height = fm_large.height()

            if single_line_width <= avail_w and single_line_height <= avail_h:
                # Fits as one line → use large
                self.text.setFont(f_large)
                self.text.setAlignment(Qt.AlignCenter)
                return

            # 2) Use SMALL (~half) and ensure it fits within TWO lines
            h_small, f_small = doc_height_for(self.TWO_LINE_PT)
            line_h = QtGui.QFontMetricsF(f_small).lineSpacing()
            max_two_lines_h = (2.0 * line_h) + 4.0  # tiny tolerance

            if h_small <= max_two_lines_h and h_small <= avail_h:
                self.text.setFont(f_small)
                self.text.setAlignment(Qt.AlignCenter)
                return

            # 3) If still too tall, binary-search down to a size that fits two lines
            lo = self.TEXT_MIN_PT
            hi = self.TWO_LINE_PT
            best_f = f_small
            while lo <= hi:
                mid = (lo + hi) // 2
                h_mid, f_mid = doc_height_for(mid)
                line_h_mid = QtGui.QFontMetricsF(f_mid).lineSpacing()
                max_h_mid = (2.0 * line_h_mid) + 4.0
                
                if h_mid <= max_h_mid and h_mid <= avail_h:
                    best_f = f_mid
                    lo = mid + 1  # try larger size that still fits
                else:
                    hi = mid - 1  # too tall, try smaller

            self.text.setFont(best_f)
            self.text.setAlignment(Qt.AlignCenter)

        except Exception as e:
            print(f"Auto-fit error: {e}")
            pass

    # ---------- scanning visuals (property based) ----------
    def _highlight_rows(self):
        # Stop any ongoing predictive reading when changing rows
        self._pred_words_to_read = []
        self._pred_read_gen += 1

        # clear key highlights and row focuses (no inline style resets)
        for rd in self.rows:
            for w in rd.widgets:
                if isinstance(w, (QtWidgets.QPushButton, QtWidgets.QLineEdit, QtWidgets.QTextEdit)):
                    w.setProperty("focused", False)
                    # Clear any explicit button highlight left from KEYS mode
                    if isinstance(w, QtWidgets.QPushButton):
                        w.setStyleSheet("")
                    w.style().unpolish(w); w.style().polish(w); w.update()
            rd.wrap.setProperty("focused", False)
            rd.wrap.style().unpolish(rd.wrap); rd.wrap.style().polish(rd.wrap); rd.wrap.update()

        if self.mode == "ROWS":
            rd = self.rows[self.row_idx]
            rd.wrap.setProperty("focused", True)
            rd.wrap.style().unpolish(rd.wrap); rd.wrap.style().polish(rd.wrap); rd.wrap.update()

        # Keep using property-based styling only
        self._apply_row_focus_styles()

        if self._suppress_row_label_once:
            self._suppress_row_label_once = False
            return
            
        # If we just selected a predictive word, don't read the row label/contents immediately
        if self._just_selected_pred:
            if self.rows[self.row_idx].id == "predRow":
                return
            else:
                self._just_selected_pred = False
            
        self._speak_row_label()

    def _highlight_keys(self):
        # Clear any previous key highlights (no inline style resets except focused button)
        for rd in self.rows:
            for w in rd.widgets:
                if isinstance(w, (QtWidgets.QPushButton, QtWidgets.QLineEdit, QtWidgets.QTextEdit)):
                    w.setProperty("focused", False)
                    # Clear any explicit highlight we add below
                    if isinstance(w, QtWidgets.QPushButton):
                        w.setStyleSheet("")
                    w.style().unpolish(w); w.style().polish(w); w.update()

        # Ensure ALL row wraps are NOT outlined in KEYS mode
        for rd in self.rows:
            rd.wrap.setProperty("focused", False)
            rd.wrap.style().unpolish(rd.wrap); rd.wrap.style().polish(rd.wrap); rd.wrap.update()

        # Focus current key — property highlight + explicit fallback for visibility
        cur = self.rows[self.row_idx]
        for i, w in enumerate(cur.widgets):
            if isinstance(w, (QtWidgets.QPushButton, QtWidgets.QLineEdit, QtWidgets.QTextEdit)):
                is_cur = (i == self.key_idx)
                w.setProperty("focused", is_cur)
                if is_cur and isinstance(w, QtWidgets.QPushButton):
                    # Explicit visible highlight to guarantee contrast
                    w.setStyleSheet("border:3px solid #FFD64D; background:rgba(255,214,77,0.20);")
                elif isinstance(w, QtWidgets.QPushButton):
                    w.setStyleSheet("")
                w.style().unpolish(w); w.style().polish(w); w.update()

        # Apply KEYS-mode row styles to remove any leftover row outline
        self._apply_row_focus_styles()

        self._speak_key_label()

    def _apply_row_focus_styles(self):
        # Ensure visible row outlines and preserve the text row’s blue bar
        try:
            if self.mode != "ROWS":
                for rd in self.rows:
                    if rd.id == "row_text":
                        rd.wrap.setStyleSheet("background-color:#ADD8E6; border:2px solid #000; border-radius:12px;")
                    else:
                        rd.wrap.setStyleSheet("background:#0f1521; border-radius:12px; border:none;")
                return

            for i, rd in enumerate(self.rows):
                if rd.id == "row_text":
                    if i == self.row_idx:
                        rd.wrap.setStyleSheet("background-color:#ADD8E6; border:3px solid #FFD64D; border-radius:12px;")
                    else:
                        rd.wrap.setStyleSheet("background-color:#ADD8E6; border:2px solid #000; border-radius:12px;")
                else:
                    if i == self.row_idx:
                        rd.wrap.setStyleSheet("background:#0f1521; border-radius:12px; border:3px solid #FFD64D;")
                    else:
                        rd.wrap.setStyleSheet("background:#0f1521; border-radius:12px; border:none;")
        except Exception:
            pass

    def _speak_row_label(self):
        try:
            if self.mode != "ROWS":
                return
            rd = self.rows[self.row_idx]
            if rd.id == "row_text":
                txt = (self._get_text() or "").strip()
                speak(txt if txt else "empty")
            elif rd.id == "predRow":
                self._read_pred_row()
            else:
                speak(rd.label)
        except Exception:
            pass

    def _speak_key_label(self):
        try:
            rd = self.rows[self.row_idx]
            if not rd.widgets:
                return
            w = rd.widgets[self.key_idx]
            
            # For control buttons, get the action-based label
            if isinstance(w, QtWidgets.QPushButton):
                action = w.property("action")
                if action:
                    # Map actions to spoken labels
                    action_labels = {
                        "space_char": "space",
                        "del_letter": "delete letter", 
                        "del_word": "delete word",
                        "clear": "clear",
                        "send": "send",
                        "close_keyboard": "close"
                    }
                    label = action_labels.get(action)
                    if label:
                        speak(label)
                        return
                
                # Fallback to button text for non-control buttons
                lbl = (w.text() or "").strip()
                speak(lbl if lbl else "button")
            else:
                speak("button")
        except Exception:
            pass

    # ---------- global key capture like the browser keyboard ----------
    def eventFilter(self, obj, ev):
        try:
            if ev.type() == QtCore.QEvent.KeyPress and isinstance(ev, QtGui.QKeyEvent):
                if ev.key() in (Qt.Key_Space, Qt.Key_Return, Qt.Key_Enter):
                    self.keyPressEvent(ev); return True
            if ev.type() == QtCore.QEvent.KeyRelease and isinstance(ev, QtGui.QKeyEvent):
                if ev.key() in (Qt.Key_Space, Qt.Key_Return, Qt.Key_Enter):
                    self.keyReleaseEvent(ev); return True
        except Exception:
            pass
        return super().eventFilter(obj, ev)

    def keyPressEvent(self, e: QtGui.QKeyEvent):
        if e.isAutoRepeat(): return
        if e.key() == Qt.Key_Space:
            e.accept()
            if not self.space_down:
                self.space_down = True
                self.space_at = time.time()
                self.space_scanned = False
                try:
                    # Start long-hold detection; first backward step after FIRST_MS
                    self.space_timer.setInterval(self.SCAN_BACK_FIRST_MS)
                    self.space_timer.start()
                except Exception:
                    pass
        elif e.key() in (Qt.Key_Return, Qt.Key_Enter):
            e.accept()
            if not self.enter_down:
                self.enter_down = True
                self.enter_at = time.time()
                try: self.enter_timer.start()
                except Exception: pass
        else:
            super().keyPressEvent(e)

    def keyReleaseEvent(self, e: QtGui.QKeyEvent):
        if e.isAutoRepeat(): return
        if e.key() == Qt.Key_Space:
            e.accept()
            if not self.space_down: return
            held = (time.time() - self.space_at) * 1000.0
            self.space_down = False
            try: self.space_timer.stop()
            except Exception: pass
            if self._in_cooldown(): return
            # Short tap advances forward (rows or keys), unless a long-hold backward already ran
            if self.SHORT_MIN <= held < self.SHORT_MAX and not self.space_scanned:
                if self.mode == "ROWS": self._scan_rows_next()
                else: self._scan_keys_next()
                self._arm_cooldown()
            return
        elif e.key() in (Qt.Key_Return, Qt.Key_Enter):
            e.accept()
            if not self.enter_down: return
            self.enter_down = False
            try:
                if self.enter_timer.isActive(): self.enter_timer.stop()
            except Exception: pass
            if self.enter_long_fired:
                self.enter_long_fired = False
                return
            if self._in_cooldown(): return
            if self.mode == "KEYS":
                self._activate_key()
                self.mode = "ROWS"
                self._highlight_rows()
            else:
                self._enter_row()
            self._arm_cooldown()
        else:
            super().keyReleaseEvent(e)

    def _space_prev(self):
        # On timeout, go backward once; if still holding, continue repeating at STEP_MS
        self.space_scanned = True
        if self.mode == "ROWS":
            self._scan_rows_prev()
        else:
            self._scan_keys_prev()
        # keep repeating while the key is held
        if self.space_down:
            try:
                self.space_timer.setInterval(self.SCAN_BACK_STEP_MS)
                self.space_timer.start()
            except Exception:
                pass

    def _scan_rows_next(self):
        self.row_idx = (self.row_idx + 1) % len(self.rows)
        self._highlight_rows()

    def _scan_rows_prev(self):
        self.row_idx = (self.row_idx - 1 + len(self.rows)) % len(self.rows)
        self._highlight_rows()

    def _scan_keys_next(self):
        rd = self.rows[self.row_idx]
        self.key_idx = (self.key_idx + 1) % len(rd.widgets)
        self._highlight_keys()

    def _scan_keys_prev(self):
        rd = self.rows[self.row_idx]
        self.key_idx = (self.key_idx - 1 + len(rd.widgets)) % len(rd.widgets)
        self._highlight_keys()

    def _enter_row(self):
        # Stop any predictive reading when entering a row
        self._pred_read_gen += 1

        rd = self.rows[self.row_idx]
        if rd.id == "row_text":
            txt = (self._get_text() or "").strip()
            speak(txt if txt else "empty")
            return
        self.mode = "KEYS"
        self.key_idx = 0
        self._highlight_keys()

    def _on_enter_hold(self):
        if not self.enter_down:
            return
        try:
            if self.mode == "KEYS":
                self.mode = "ROWS"
                self._highlight_rows()
                # speak("rows") - removed so it speaks the row label via _highlight_rows instead
                self.enter_long_fired = True
                return
            if self.mode == "ROWS":
                # Jump to predictive row and read each suggestion
                pred_idx = next((i for i, rd in enumerate(self.rows) if rd.id == "predRow"), None)
                if pred_idx is not None:
                    self.row_idx = pred_idx
                    self._suppress_row_label_once = True
                    self._highlight_rows()
                    self._read_pred_row()
                    self.enter_long_fired = True
        except Exception:
            pass

    def _read_pred_row(self):
        try:
            # Collect all non-empty prediction button texts
            words = []
            for i, b in enumerate(self.pred_btns):
                txt = (b.text() or "").strip()
                if txt:
                    words.append(txt)
            
            if not words:
                speak("predictive text")
                return
            
            # Debug: ensure we captured all words
            print(f"[DEBUG] Collected {len(words)} words to read: {words}")
            
            self._pred_read_gen += 1
            self._pred_read_index = 0
            self._pred_words_to_read = words
            self._read_next_pred_word(self._pred_read_gen)
        except Exception as e:
            print(f"[ERROR] _read_pred_row failed: {e}")
            pass
    
    def _read_next_pred_word(self, gen):
        try:
            if gen != self._pred_read_gen:
                return
            if not hasattr(self, '_pred_words_to_read') or not self._pred_words_to_read:
                return
            if self._pred_read_index >= len(self._pred_words_to_read):
                print(f"[DEBUG] Finished reading all {self._pred_read_index} words")
                return
            
            word = self._pred_words_to_read[self._pred_read_index]
            print(f"[DEBUG] Reading word {self._pred_read_index + 1}/{len(self._pred_words_to_read)}: {word}")
            speak(word)
            self._pred_read_index += 1
            
            # Schedule next word if there are more
            if self._pred_read_index < len(self._pred_words_to_read):
                # Increased delay to prevent skipping words
                QtCore.QTimer.singleShot(1400, lambda: self._read_next_pred_word(gen))
        except Exception as e:
            print(f"[ERROR] _read_next_pred_word failed at index {self._pred_read_index}: {e}")
            pass

    def _in_cooldown(self) -> bool:
        return int(time.time()*1000) < self._cooldown_until_ms
    def _arm_cooldown(self):
        self._cooldown_until_ms = int(time.time()*1000) + self.INPUT_COOLDOWN_MS

    # Add: activate current highlighted key on Enter in KEYS mode
    def _activate_key(self):
        try:
            rd = self.rows[self.row_idx]
            if not rd.widgets: return
            w = rd.widgets[self.key_idx]
            if isinstance(w, QtWidgets.QPushButton):
                self._perform(w)
            elif isinstance(w, (QtWidgets.QLineEdit, QtWidgets.QTextEdit)):
                txt = (self._get_text() or "").strip()
                speak(txt if txt else "empty")
        except Exception:
            pass

    # ---------- actions ----------
    def _perform(self, btn: QtWidgets.QPushButton):
        action = btn.property("action")
        ch = btn.property("char")
        is_pred = bool(btn.property("pred"))

        if ch:
            self._set_text(self._get_text() + ch)
            speak(ch)
            self._schedule_predictions()
            return

        if is_pred:
            v = self._get_text()
            has_sp = v.endswith(" ")
            trimmed = v.rstrip()
            parts = trimmed.split() if trimmed else []
            current = parts[-1] if parts else ""
            before = " ".join(parts[:-1]) if len(parts) > 1 else ""
            pred = btn.text()
            if has_sp or current == "":
                newv = (trimmed + " " + pred + " ")
            elif pred.lower().startswith(current.lower()):
                newv = ((before + " " if before else "") + pred + " ")
            else:
                newv = (trimmed + " " + pred + " ")
            normalized = " ".join(newv.split())
            if not normalized.endswith(" "): normalized += " "
            self._set_text(normalized)
            speak(pred)
            self._just_selected_pred = True  # Suppress auto-read of new predictions
            self._schedule_predictions()
            return

        if action == "space_char":
            self._set_text(self._get_text() + " ")
            speak("space")
            self._schedule_predictions()
            return
        if action == "del_letter":
            speak("delete letter")
            self._set_text(self._get_text()[:-1])
            self._schedule_predictions()
            return
        if action == "del_word":
            speak("delete word")
            v = self._get_text()
            trimmed = v.rstrip()
            if not trimmed:
                self._set_text("")
            else:
                idx = trimmed.rfind(" ")
                self._set_text("" if idx == -1 else trimmed[:idx+1])
            self._schedule_predictions()
            return
        if action == "clear":
            speak("clear")
            self._set_text("")
            self._schedule_predictions()
            return
        if action == "send":
            speak("send")
            self._send_and_exit()
            return
        if action == "close_keyboard":
            speak("close")
            # Just close the keyboard and return to Discord app
            self._close_keyboard_only()
            return
        if action == "close_app":  # This action isn't used anymore but keep for compatibility
            speak("close")
            self._close_keyboard_only()
            return

    # ---------- predictions: debounced + threaded ----------
    def _schedule_predictions(self):
        try:
            self.pred_timer.start()
        except Exception:
            pass

    def _refresh_predictions_async(self):
        self.pred_req_id += 1
        rid = self.pred_req_id
        txt = self._get_text()
        try:
            self.pred_worker.request.emit(rid, txt)
        except Exception:
            # sync fallback
            words = _fallback_ngram(txt, 6)
            self._on_predictions_ready(rid, txt, words)

    @QtCore.Slot(int, str, list)
    def _on_predictions_ready(self, rid: int, text: str, words: list):
        if rid != self.pred_req_id:
            return
        arr = (words or [])[:6]
        for i, b in enumerate(self.pred_btns):
            b.setText(arr[i].upper() if i < len(arr) else "")
        self._pred_current = arr
        # Fit prediction button fonts after texts applied
        QtCore.QTimer.singleShot(0, self._fit_pred_fonts)
        
        # If we are currently focused on the predictive row in ROWS mode, read the new predictions
        if self.mode == "ROWS" and 0 <= self.row_idx < len(self.rows):
            if self.rows[self.row_idx].id == "predRow":
                if self._just_selected_pred:
                    self._just_selected_pred = False
                    return
                # Stop any existing reading and start fresh with new words
                QtCore.QTimer.singleShot(200, self._read_pred_row)

    def _fit_pred_fonts(self):
        # Aggressively shrink predictive button text to prevent layout growth
        try:
            if not hasattr(self, "pred_btns"):
                return
            for b in self.pred_btns:
                txt = (b.text() or "").strip()
                # Much more conservative sizing to prevent layout growth
                max_pt = max(8, int(b.height() * 0.25))  # Reduced from 0.45 to 0.25
                min_pt = 6  # Reduced minimum
                # Much more conservative available width
                avail_w = max(10, b.width() - 32)  # More padding to prevent overflow

                f = b.font()
                f.setBold(True)

                if not txt:
                    f.setPointSize(max_pt)
                    b.setFont(f)
                    continue

                # For very long words, start even smaller
                if len(txt) > 12:
                    max_pt = max(6, int(b.height() * 0.20))
                elif len(txt) > 8:
                    max_pt = max(7, int(b.height() * 0.22))

                # Binary search largest point size that fits the width
                lo, hi, best = min_pt, max_pt, min_pt
                while lo <= hi:
                    mid = (lo + hi) // 2
                    f.setPointSize(mid)
                    fm = QtGui.QFontMetrics(f)
                    w = fm.horizontalAdvance(txt)
                    if w <= avail_w:
                        best = mid
                        lo = mid + 1
                    else:
                        hi = mid - 1
                
                # Final safety check - if still too wide, use minimum size
                f.setPointSize(best)
                fm = QtGui.QFontMetrics(f)
                if fm.horizontalAdvance(txt) > avail_w:
                    f.setPointSize(min_pt)
                
                b.setFont(f)
                
                # Also set size policy to prevent button growth
                b.setSizePolicy(QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Fixed)
                b.setMaximumWidth(b.width())  # Lock current width
        except Exception:
            pass

    # ---------- finish ----------
    def _send_and_exit(self):
        txt = self._get_text().strip()
        if not txt:
            speak("type something first")
            return
        
        # Save to recent messages cache
        _save_recent_message(txt)
        
        data = {"text": txt}
        try:
            with open(self.out_path, "w", encoding="utf-8") as f:
                json.dump(data, f)
        except Exception:
            pass
        # Stop cursor timer before exit
        try:
            self._cursor_timer.stop()
            self.cursor_widget.hide()
        except:
            pass
        QtCore.QTimer.singleShot(0, QtWidgets.QApplication.quit)

    # Ensure auto-fit responds to window resizes
    def resizeEvent(self, e: QtGui.QResizeEvent):
        super().resizeEvent(e)
        self._auto_fit_text_font()
        self._update_cursor_position()
        # Refit predictive buttons on resize to avoid clipping/overflow
        self._fit_pred_fonts()

    # Write empty text on window close (not the typed text!)
    def closeEvent(self, e: QtGui.QCloseEvent):
        # Only save text if explicitly sent via SEND button
        # Otherwise write empty to indicate cancellation
        try:
            # Stop cursor timer
            self._cursor_timer.stop()
        except:
            pass
        # Don't save text here - only on explicit SEND
        super().closeEvent(e)

    # Helper: just close the keyboard without launching comm-v10.py
    def _close_keyboard_only(self):
        # Write empty text to indicate cancellation (not sending)
        try:
            with open(self.out_path, "w", encoding="utf-8") as f:
                json.dump({"text": ""}, f)
        except Exception:
            pass
        # Stop cursor timer
        try:
            self._cursor_timer.stop()
            self.cursor_widget.hide()
        except:
            pass
        QtCore.QTimer.singleShot(0, QtWidgets.QApplication.quit)

# ---------- main ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="Path to write JSON with {text: ...}")
    args = ap.parse_args()
    app = QtWidgets.QApplication(sys.argv)
    ui = SendKeyboard(args.out)
    ui.showFullScreen()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()