# simple_dm_listener.py
# Background DM listener with heartbeat pause, TTS, dm_index updates, and minimized console
# Requires: pip install discord.py pyttsx3
# Optional: pywin32 (not required). We use ctypes to minimize the console.

import os
import json
import time
import re
import threading
from datetime import datetime
from typing import Dict, Any

import discord

# TTS
try:
    import pyttsx3
except Exception:
    pyttsx3 = None

# Import shared voice settings
try:
    import sys as _sys
    # From messenger/ folder: go up 3 levels to bennyshub/, then into shared/
    _shared_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "shared"))
    if _shared_dir not in _sys.path:
        _sys.path.insert(0, _shared_dir)
    from voice_settings import apply_voice_settings, is_tts_enabled, check_settings_changed
    _voice_settings_available = True
except Exception as e:
    print(f"[TTS] Could not load voice_settings: {e}")
    _voice_settings_available = False
    def apply_voice_settings(engine): pass
    def is_tts_enabled(): return True
    def check_settings_changed(): return False

# --- Paths and config ---
APP_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(APP_DIR, "config.json")
DM_INDEX_PATH = os.path.join(APP_DIR, "dm_index.json")
HEARTBEAT_PATH = os.path.join(APP_DIR, "ben_app_heartbeat.lock")
PROCESSED_IDS_PATH = os.path.join(APP_DIR, "processed_dm_ids.json")

# --- Console minimize on Windows ---
def _minimize_console_forever():
    try:
        import ctypes
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        SW_MINIMIZE = 6
        SW_SHOWMINNOACTIVE = 7

        hwnd = kernel32.GetConsoleWindow()
        if hwnd:
            user32.ShowWindow(hwnd, SW_SHOWMINNOACTIVE)
            user32.ShowWindow(hwnd, SW_MINIMIZE)

            while True:
                # If somehow restored, minimize again without stealing focus
                user32.ShowWindow(hwnd, SW_SHOWMINNOACTIVE)
                user32.ShowWindow(hwnd, SW_MINIMIZE)
                time.sleep(3)
    except Exception:
        # Non Windows or no console
        pass

threading.Thread(target=_minimize_console_forever, daemon=True).start()

# --- Single Instance Lock ---
import sys
try:
    # Use a file lock to ensure only one listener runs
    LOCK_FILE_PATH = os.path.join(APP_DIR, "dm_listener_instance.lock")
    if os.path.exists(LOCK_FILE_PATH):
        try:
            os.remove(LOCK_FILE_PATH)
        except Exception:
            # If we can't remove it, another process likely holds it
            print("[listener] Another instance is running. Exiting.")
            sys.exit(0)
    
    # Create valid lock file for this session
    _lock_file = open(LOCK_FILE_PATH, "w")
    _lock_file.write(str(os.getpid()))
    _lock_file.flush()
    # We don't close it; we keep it open to hold the lock (on Windows this often prevents deletion)
except Exception as e:
    print(f"[listener] Lock error: {e}")

# --- Load config ---
def _load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    token = str(cfg.get("DISCORD_TOKEN", "")).strip()
    guild_id = int(cfg.get("GUILD_ID", 0)) if cfg.get("GUILD_ID") else 0
    dm_bridge_id = 0
    try:
        dm_bridge_id = int(str(cfg.get("DM_BRIDGE_CHANNEL_ID", "")).strip() or 0)
    except Exception:
        dm_bridge_id = 0
    if not token:
        raise RuntimeError("DISCORD_TOKEN missing in config.json")
    
    # Load channel IDs
    channel_ids = []
    try:
        raw_ids = cfg.get("CHANNEL_IDS", [])
        if isinstance(raw_ids, list):
            channel_ids = [int(cid) for cid in raw_ids if cid]
    except Exception:
        channel_ids = []
    
    # Fallback to single CHANNEL_ID
    if not channel_ids:
        try:
            cid = int(cfg.get("CHANNEL_ID", 0))
            if cid:
                channel_ids.append(cid)
        except Exception:
            pass

    return token, guild_id, dm_bridge_id, channel_ids

TOKEN, GUILD_ID, DM_BRIDGE_CHANNEL_ID, CHANNEL_IDS = _load_config()

# --- Heartbeat pause state ---
PAUSED_BY_APP = False
HEARTBEAT_STALE_SEC = 5

# --- Persistence Helpers ---
def _load_processed_ids() -> set:
    try:
        if os.path.exists(PROCESSED_IDS_PATH):
            with open(PROCESSED_IDS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return set(data)
    except Exception:
        pass
    return set()

def _save_processed_ids():
    try:
        # Keep only last 2000
        safe_list = sorted(list(_processed_ids))[-2000:]
        tmp = PROCESSED_IDS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(safe_list, f)
        os.replace(tmp, PROCESSED_IDS_PATH)
    except Exception:
        pass

# Deduplication set to prevent processing the same message multiple times
_processed_ids = _load_processed_ids()

def _heartbeat_monitor():
    global PAUSED_BY_APP
    while True:
        try:
            if os.path.exists(HEARTBEAT_PATH):
                mtime = os.path.getmtime(HEARTBEAT_PATH)
                PAUSED_BY_APP = (time.time() - mtime) < HEARTBEAT_STALE_SEC
            else:
                PAUSED_BY_APP = False
        except Exception:
            PAUSED_BY_APP = False
        time.sleep(2)

threading.Thread(target=_heartbeat_monitor, daemon=True).start()

# --- TTS engine and rate limiting ---
TTS_ENABLED = True
RATE_WINDOW_SEC = 120  # 2 minutes
_last_tts_by_user: Dict[int, float] = {}  # user_id -> timestamp
_tts_engine = None

def _tts_say(line: str):
    global _tts_engine
    # Check shared settings first
    if _voice_settings_available and not is_tts_enabled():
        return
    if not TTS_ENABLED or not line or pyttsx3 is None:
        return
    try:
        if _tts_engine is None:
            _tts_engine = pyttsx3.init()
            # Apply shared voice settings
            if _voice_settings_available:
                apply_voice_settings(_tts_engine)
        # Check for settings changes
        elif _voice_settings_available and check_settings_changed():
            apply_voice_settings(_tts_engine)
        _tts_engine.say(line)
        _tts_engine.runAndWait()
    except Exception:
        pass

_url_re = re.compile(r'(https?://\S+|www\.\S+|\b[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\S*)')

def _sanitize_tts_text(text: str) -> str:
    if not text:
        return ""
    text = _url_re.sub(" link ", text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def _first_n_words(text: str, n=5) -> str:
    if not text:
        return ""
    text = _sanitize_tts_text(text)
    words = text.split()
    return " ".join(words[:n])

def _should_tts_for_user(user_id: int) -> bool:
    now = time.time()
    last = _last_tts_by_user.get(user_id, 0)
    if (now - last) >= RATE_WINDOW_SEC:
        _last_tts_by_user[user_id] = now
        return True
    return False

# --- dm_index helpers ---
def _load_dm_index() -> Dict[str, str]:
    try:
        with open(DM_INDEX_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items()}
    except Exception:
        pass
    return {}

def _save_dm_index(d: Dict[str, str]):
    try:
        tmp = DM_INDEX_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DM_INDEX_PATH)
    except Exception:
        pass

def _remember_dm_user(user_id: int, display_name: str):
    try:
        idx = _load_dm_index()
        key = str(int(user_id))
        if idx.get(key) != display_name:
            idx[key] = display_name
            _save_dm_index(idx)
    except Exception:
        pass

# --- Discord client and nickname resolution ---
intents = discord.Intents.default()
intents.message_content = True   # also enable this in the dev portal
intents.dm_messages = True
intents.guild_messages = True
intents.guilds = True

client = discord.Client(intents=intents)
_guild_cache = None  # discord.Guild or None

async def _get_guild():
    global _guild_cache
    if _guild_cache:
        return _guild_cache
    if GUILD_ID:
        g = client.get_guild(GUILD_ID)
        if g is None:
            try:
                g = await client.fetch_guild(GUILD_ID)
            except Exception:
                g = None
        _guild_cache = g
    return _guild_cache

async def _guild_display_name(user_id: int, fallback: str) -> str:
    g = await _get_guild()
    if g:
        mem = g.get_member(user_id)
        if mem is None:
            try:
                mem = await g.fetch_member(user_id)
            except Exception:
                mem = None
        if mem and getattr(mem, "display_name", None):
            return mem.display_name
    return fallback

def _base_username(u: discord.User) -> str:
    return getattr(u, "global_name", None) or getattr(u, "name", "user")

def _bridge_body_from_message(message: discord.Message) -> str:
    try:
        parts = []
        if (message.content or "").strip():
            parts.append(message.content.strip())
        for a in getattr(message, "attachments", []) or []:
            url = getattr(a, "url", None) or ""
            if url:
                parts.append(f"[attachment: {url}]")
        body = " ".join(parts).strip()
        return body if body else "[no text]"
    except Exception:
        return (message.content or "").strip() or "[no text]"

async def _forward_dm_to_bridge(author: discord.User, display_name: str, message: discord.Message):
    try:
        # Check if already processed (triple check)
        # However, if called from _handle_new_dm, it MIGHT be in _processed_ids already.
        # So create a local check or just rely on caller?
        # For safety, allow caller to manage _processed_ids if they wish.
        
        if not DM_BRIDGE_CHANNEL_ID:
            return
        g = await _get_guild()
        if not g:
            return
        ch = g.get_channel(DM_BRIDGE_CHANNEL_ID)
        if ch is None:
            try:
                ch = await client.fetch_channel(DM_BRIDGE_CHANNEL_ID)
            except Exception:
                ch = None
        if not isinstance(ch, discord.TextChannel):
            return

        body = _bridge_body_from_message(message)
        await ch.send(f"DM from {display_name} ({author.id}): {body}")
    except Exception:
        # Best effort
        pass

# --- DM handling ---
async def _forward_outgoing_dm_to_bridge(recipient: discord.User, display_name: str, message: discord.Message):
    try:
        if not DM_BRIDGE_CHANNEL_ID:
            return
        g = await _get_guild()
        if not g:
            return
        ch = g.get_channel(DM_BRIDGE_CHANNEL_ID)
        if ch is None:
            try:
                ch = await client.fetch_channel(DM_BRIDGE_CHANNEL_ID)
            except Exception:
                ch = None
        if not isinstance(ch, discord.TextChannel):
            return
        body = _bridge_body_from_message(message)
        await ch.send(f"To {display_name} ({recipient.id}): {body}")
    except Exception:
        pass

async def _handle_new_dm(message: discord.Message):
    # Deduplication
    if message.id in _processed_ids:
        return
    _processed_ids.add(message.id)
    _save_processed_ids()

    # Keep set size manageable
    if len(_processed_ids) > 1000:
        try:
            _processed_ids.pop()
        except:
            pass

    author = message.author
    is_me = (client.user and author.id == client.user.id)
    if author.bot and not is_me:
        return

    base = _base_username(author)
    try:
        display_name = await _guild_display_name(author.id, base)
    except Exception:
        display_name = base

    if is_me:
        # Outgoing response
        recipient = getattr(message.channel, "recipient", None)
        if recipient:
            recip_base = _base_username(recipient)
            try:
                recip_disp = await _guild_display_name(recipient.id, recip_base)
            except Exception:
                recip_disp = recip_base
            await _forward_outgoing_dm_to_bridge(recipient, recip_disp, message)
    else:
        # Incoming message
        first10 = _first_n_words(message.content or "", 10)
        tts_line = f"New Message from {display_name}: {first10}".strip()

        # Always update files and mirror
        _remember_dm_user(author.id, display_name)
        await _forward_dm_to_bridge(author, display_name, message)

        # Only speak when the app is not active
        if not PAUSED_BY_APP and _should_tts_for_user(author.id):
            _tts_say(tts_line)

async def _handle_channel_message(message: discord.Message):
    # Deduplication
    if message.id in _processed_ids:
        return
    _processed_ids.add(message.id)
    _save_processed_ids()
    if len(_processed_ids) > 1000:
        try:
            _processed_ids.pop()
        except:
            pass

    author = message.author
    is_me = (client.user and author.id == client.user.id)
    if author.bot and not is_me:
        return
    if is_me:
        return

    base = _base_username(author)
    try:
        display_name = await _guild_display_name(author.id, base)
    except Exception:
        display_name = base
    
    channel_name = getattr(message.channel, "name", "channel")

    first10 = _first_n_words(message.content or "", 10)
    tts_line = f"Message from {display_name} in {channel_name}: {first10}".strip()

    # Only speak when the app is not active
    if not PAUSED_BY_APP and _should_tts_for_user(author.id):
        _tts_say(tts_line)

@client.event
async def on_message(message: discord.Message):
    # Handle DMs
    if isinstance(message.channel, discord.DMChannel):
        try:
            await _handle_new_dm(message)
        except Exception:
            pass
        return

    # Handle monitored channels
    if message.channel.id in CHANNEL_IDS:
        try:
            await _handle_channel_message(message)
        except Exception:
            pass
            pass

@client.event
async def on_ready():
    try:
        me = client.user
        print(f"[listener] Logged in as {me} ({getattr(me, 'id', '?')})")
        g = await _get_guild()
        if g:
            print(f"[listener] Guild ready: {g.name} ({g.id})")
        else:
            print("[listener] No guild configured or accessible")
    except Exception:
        print("[listener] Logged in.")

# --- Run ---
if __name__ == "__main__":
    try:
        print("[listener] starting. heartbeat guard is enabled.")
        client.run(TOKEN)
    except discord.errors.PrivilegedIntentsRequired:
        print("[listener] Enable Message Content Intent in the developer portal.")
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(f"[listener] fatal error: {e}")
