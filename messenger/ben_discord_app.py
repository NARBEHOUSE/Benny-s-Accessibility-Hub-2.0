import os, sys, asyncio, threading, tempfile, json, base64, subprocess, traceback, time, re
import discord
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime
import re
import html  # for HTML escaping in message rendering

# Optional web embedding (YouTube, etc.)
try:
    from PySide6 import QtWebEngineWidgets
    from PySide6.QtWebEngineCore import QWebEngineProfile, QWebEngineSettings
    _QT_WEB = True
except Exception:
    _QT_WEB = False

from PySide6 import QtCore, QtGui, QtWidgets
from PySide6.QtCore import Qt, QTimer
from PySide6 import QtNetwork
# Optional multimedia for embedded video
try:
    from PySide6 import QtMultimedia, QtMultimediaWidgets
    _QT_MEDIA = True
except Exception:
    _QT_MEDIA = False

try:
    import pyttsx3  # FIX: actually import the TTS engine
except Exception:
    pyttsx3 = None

# Windows-specific imports for focus management
try:
    import win32gui
    import win32con
    import win32process
    import win32api
    _WIN32_AVAILABLE = True
except ImportError:
    _WIN32_AVAILABLE = False

# --- Heartbeat for pausing the background listener ---
APP_DIR = os.path.dirname(os.path.abspath(__file__))
HEARTBEAT_PATH = os.path.join(APP_DIR, "ben_app_heartbeat.lock")


# --- Messenger settings (limits & feature toggles) ---
SETTINGS_PATH = os.path.join(APP_DIR, "messenger_settings.json")
SETTINGS = {
    "CHANNEL_INITIAL_LIMIT": 25,
    "DM_INITIAL_LIMIT": 10,
    "CHANNEL_RENDER_LIMIT": 25,
    "DM_RENDER_LIMIT": 10,
    "CHANNEL_BACKFILL_BATCH": 20,
    "DM_BACKFILL_BATCH": 10,
    "ENABLE_SCROLL_BACKFILL": True,
    "ENABLE_RENDER_DM_BACKFILL": False,   # avoid auto-pulling 500 on every render
    "FOCUS_ANCHOR_RATIO": 0.5            # keep highlight around mid-pane
}
try:
    with open(SETTINGS_PATH, "r", encoding="utf-8") as _sf:
        import json as _json
        SETTINGS.update(_json.load(_sf))
except Exception:
    pass
def S(key, default=None):
    return SETTINGS.get(key, default)


# ---------- TTS ----------
class TTSWorker(QtCore.QObject):
    say = QtCore.Signal(str)
    halt = QtCore.Signal()  # new: request to stop current speech
    reset = QtCore.Signal()  # add: request to reinitialize the engine (fixes post-keyboard silence)
    keepalive = QtCore.Signal()  # NEW: watchdog ping to keep/recover the engine

    def __init__(self):
        super().__init__()
        # Always create the engine in this object's thread (after moveToThread)
        self._engine = None
        # latest-wins state
        self._speaking = False
        self._latest_text: Optional[str] = None
        self._last_use = 0.0  # NEW: last time we attempted to speak

        # connect signals
        self.say.connect(self._on_say)
        self.halt.connect(self._halt)
        self.reset.connect(self._reset)  # new connection
        self.keepalive.connect(self._keepalive)  # NEW

    def _ensure_engine(self):
        """Create the engine in the worker thread if missing."""
        if self._engine or not pyttsx3:
            return
        try:
            self._engine = pyttsx3.init()
        except Exception:
            self._engine = None

    @QtCore.Slot(str)
    def _on_say(self, text: str):
        if not text:
            return
        # ensure engine lives in this thread
        self._ensure_engine()
        if not self._engine:
            return
        # overwrite any pending text
        self._latest_text = text
        self._last_use = time.time()
        if self._speaking:
            # interrupt current playback; drain() will continue with the latest text
            try:
                self._engine.stop()  # FIX: actually stop the current utterance
            except Exception:
                # If stopping fails, reset the engine so we can recover
                self._engine = None
                self._ensure_engine()
            return
        # not speaking, drain immediately
        self._drain()

    def _drain(self):
        # ensure engine is available
        self._ensure_engine()
        if not self._engine:
            self._latest_text = None
            return
        # Speak only the most recent requested text
        while self._latest_text:
            text = self._latest_text
            self._latest_text = None
            self._speaking = True
            try:
                # stop any residual speech
                try:
                    self._engine.stop()  # FIX: clear any residual state in driver
                except Exception:
                    pass
                self._engine.say(text)
                self._engine.runAndWait()
            except Exception:
                # Harden: If the driver fails mid-speech, reset and try to continue next time
                self._engine = None
                self._ensure_engine()
            finally:
                self._speaking = False

    @QtCore.Slot()
    def _halt(self):
        # clear any pending text and stop immediately
        self._latest_text = None
        if not self._engine:
            return
        try:
            self._engine.stop()
        except Exception:
            pass

    @QtCore.Slot()
    def _reset(self):
        """Recreate the TTS engine after external window focus changes."""
        # stop and drop old engine, then recreate in this thread
        try:
            if self._engine:
                try:
                    self._engine.stop()  # FIX: stop before dropping
                except Exception:
                    pass
        except Exception:
            pass
        self._engine = None
        self._ensure_engine()

    @QtCore.Slot()
    def _keepalive(self):
        """
        Lightweight watchdog: ensure the engine exists and the driver is responsive.
        Never speaks; only reinitializes on errors.
        """
        # Ensure engine object
        self._ensure_engine()
        eng = self._engine
        if not eng:
            return
        # If not currently speaking, poke a benign property to verify driver health.
        try:
            _ = eng.getProperty("volume")
        except Exception:
            try:
                eng.stop()
            except Exception:
                pass
            self._engine = None
            self._ensure_engine()
        # Optionally refresh engines that go stale after long idle
        try:
            if (not self._speaking) and self._last_use and (time.time() - self._last_use > 30):
                # Some drivers get stuck after device changes; re-init safely
                try:
                    eng.stop()
                except Exception:
                    pass
                self._engine = None
                self._ensure_engine()
        except Exception:
            pass

# ---------- Discord background client ----------
import discord

@dataclass
class UiMessage:
    id: int
    author: str
    content: str
    ts: float
    from_me: bool = False
    attachments: Optional[List[Dict[str, Any]]] = field(default_factory=list)

class DiscordBridge(QtCore.QObject):
    # signals for UI thread
    channel_ready = QtCore.Signal(object)  # discord.TextChannel
    dm_threads_changed = QtCore.Signal()
    message_added = QtCore.Signal(str, UiMessage)  # thread_id, message
    status = QtCore.Signal(str)
    warm_complete = QtCore.Signal()  # fired after warm-load completes
    reactions_updated = QtCore.Signal(str, object)     # thread_id, message_id (avoid 32-bit int overflow)
    reaction_tts = QtCore.Signal(str)               # speak this line
    history_extended = QtCore.Signal(str)  # NEW: emitted after older DM history is fetched

    def __init__(self, token: str, guild_id: int, chan_id: int, dm_bridge_chan_id: int, channel_ids: List[int] = None):
        super().__init__()
        self.token = token
        self.guild_id = guild_id
        self.chan_id = chan_id  # primary channel (backward compat)
        self.dm_bridge_chan_id = dm_bridge_chan_id
        # NEW: support multiple channels
        self.channel_ids: List[int] = channel_ids or ([chan_id] if chan_id else [])
        self.client = None
        self.loop = None
        self.thread = None

        # internal stores
        self.main_channel: Optional[discord.TextChannel] = None
        # NEW: store all monitored channels
        self.channels: Dict[int, discord.TextChannel] = {}  # channel_id -> TextChannel
        # threads: "main" for the server channel, "channel:<id>" for additional channels, "dm:<user_id>" for DMs
        self.dm_threads: Dict[str, discord.User] = {}
        self.ui_messages: Dict[str, List[UiMessage]] = {"main": []}
        # flag to stop retries and shutdown loop cleanly
        self._stopping = False
        # whether Message Content intent is available
        self.message_content_available = True
        # Persisted DM user index
        self.dm_index_path = os.path.join(os.path.dirname(__file__), "dm_index.json")
        self._dm_index: dict[str, str] = {}  # str(user_id) -> display name
        # cache for guild display names (nicknames)
        self.guild: Optional[discord.Guild] = None
        self._name_cache: Dict[int, str] = {}
        # reactions store: message_id -> list of dicts {emoji, name, url, count}
        self.ui_reactions: Dict[int, List[Dict[str, Any]]] = {}
        # NEW: track DM history loading states to avoid duplicate fetches
        self._dm_history_loading: set[str] = set()
        # NEW: global de-duplication for all messages we accept into ui_messages
        self._seen_ids: set[int] = set()

    # ----- public calls from UI thread -----
    def start(self):
        self.thread = threading.Thread(target=self._runner, daemon=True)
        self.thread.start()

    def stop(self):
        # Gracefully close discord client and loop, then join thread
        self._stopping = True
        try:
            if self.loop:
                # Close client on its loop and wait, then stop the loop
                client = self.client
                if client and not client.is_closed():
                    try:
                        fut = asyncio.run_coroutine_threadsafe(client.close(), self.loop)
                        try:
                            fut.result(timeout=5)
                        except Exception:
                            pass
                    except Exception:
                        pass
                try:
                    self.loop.call_soon_threadsafe(self.loop.stop)
                except Exception:
                    pass
        except Exception:
            pass
        try:
            if self.thread and self.thread.is_alive():
                self.thread.join(timeout=5)
        except Exception:
            pass

    # Attach event handlers to current self.client
    def _setup_handlers(self):
        @self.client.event
        async def on_ready():
            self.status.emit(f"Logged in as {self.client.user}")
            guild = self.client.get_guild(self.guild_id)
            self.guild = guild
            if not guild:
                self.status.emit("Guild not found (continuing — DMs can still load)")

            # NEW: warm-load ALL channels from channel_ids
            if guild:
                for chan_id in self.channel_ids:
                    ch = guild.get_channel(chan_id)
                    if isinstance(ch, discord.TextChannel):
                        # Store in channels dict
                        self.channels[chan_id] = ch
                        
                        # Use "main" for the first/primary channel, "channel:<id>" for others
                        if chan_id == self.chan_id:
                            tid = "main"
                            self.main_channel = ch
                        else:
                            tid = f"channel:{chan_id}"
                        
                        try:
                            limit = int(S("CHANNEL_INITIAL_LIMIT", 25))
                        except Exception:
                            limit = 25
                        self.ui_messages[tid] = []
                        try:
                            msgs = [m async for m in ch.history(limit=limit, oldest_first=False)]
                            msgs.reverse()
                        except Exception:
                            msgs = []
                        for m in msgs:
                            if m.id in self._seen_ids:
                                continue
                            try:
                                author_name = await self._author_display_async(m, tid)
                            except Exception:
                                author_name = getattr(getattr(m, "author", None), "name", "user")
                            ui = UiMessage(
                                id=m.id,
                                author=author_name,
                                content=self._format_message_content(m),
                                ts=m.created_at.timestamp(),
                                from_me=bool(self.client.user and m.author.id == self.client.user.id),
                                attachments=self._extract_attachments(m),
                            )
                            self.ui_messages[tid].append(ui)
                            self._seen_ids.add(m.id)
                            try:
                                self.ui_reactions[m.id] = self._build_ui_reactions(m)
                            except Exception:
                                self.ui_reactions[m.id] = []
                        try:
                            self.channel_ready.emit(ch)
                        except Exception:
                            pass
                    else:
                        self.status.emit(f"Channel {chan_id} not found or invalid")

            # DM bridge warm load -> index only (small window), no UI message creation
            bridge = None
            try:
                if self.dm_bridge_chan_id:
                    bridge = self.client.get_channel(self.dm_bridge_chan_id)
                    if not isinstance(bridge, discord.TextChannel):
                        try:
                            bridge = await self.client.fetch_channel(self.dm_bridge_chan_id)
                        except Exception:
                            bridge = None
            except Exception:
                bridge = None
            if isinstance(bridge, discord.TextChannel):
                try:
                    async for m in bridge.history(limit=200, oldest_first=True):
                        self._maybe_index_dm_from_bridge(m)
                    # Mark as seen globally
                    self._seen_ids.add(m.id)
                except Exception:
                    pass

            # Existing open DM channels: index only, no history yet (fast warm-load)
            try:
                for dm in list(getattr(self.client, "private_channels", []) or []):
                    try:
                        if isinstance(dm, discord.DMChannel):
                            u = getattr(dm, "recipient", None)
                            if not u:
                                continue
                            self.dm_threads[str(u.id)] = u
                            # NEW: resolve and cache server nickname for list label
                            try:
                                disp = await self._resolve_member_display(int(u.id))
                                if disp:
                                    self._name_cache[int(u.id)] = disp
                            except Exception:
                                pass
                    except Exception:
                        pass
                self.dm_threads_changed.emit()
            except Exception:
                pass

            # Persisted DM index (stubs only; resolve nickname now for first render)
            try:
                self._load_dm_index()
                for uid_str, disp in list(self._dm_index.items()):
                    try:
                        uid = int(uid_str)
                    except Exception:
                        continue
                    # Ensure a stub thread entry without network
                    if str(uid) not in self.dm_threads:
                        class _Stub: pass
                        s = _Stub(); s.name = disp; s.id = uid
                        self.dm_threads[str(uid)] = s  # type: ignore
                    # NEW: resolve and cache nickname so list shows it immediately
                    try:
                        name = await self._resolve_member_display(uid)
                        if name:
                            self._name_cache[uid] = name
                    except Exception:
                        pass
                self.dm_threads_changed.emit()
            except Exception:
                pass

            # Also discover DMs from cached messages (index only)
            try:
                cached = list(getattr(self.client, "cached_messages", []) or [])
                for m in cached:
                    try:
                        if isinstance(getattr(m, "channel", None), discord.DMChannel):
                            other = getattr(m.channel, "recipient", None)
                            if not other:
                                me = getattr(getattr(self, "client", None), "user", None)
                                if me and getattr(m, "author", None) and m.author.id != me.id:
                                    other = m.author
                            if not other:
                                continue
                            uid = int(getattr(other, "id", 0) or 0)
                            if not uid:
                                continue
                            self.dm_threads[str(uid)] = other
                            # NEW: resolve and cache nickname for first list render
                            try:
                                disp = await self._resolve_member_display(uid)
                                if disp:
                                    self._name_cache[uid] = disp
                            except Exception:
                                pass
                    except Exception:
                        pass
                self.dm_threads_changed.emit()
            except Exception:
                pass

            try:
                self.warm_complete.emit()
            except Exception:
                pass

        @self.client.event
        async def on_message(message: discord.Message):
            # Check all monitored channels
            for chan_id, ch in self.channels.items():
                if message.channel.id == chan_id:
                    # Determine the thread id for this channel
                    if chan_id == self.chan_id:
                        tid = "main"
                    else:
                        tid = f"channel:{chan_id}"
                    name = await self._author_display_async(message, tid)
                    self._push_ui_message_with_author(tid, message, name)
                    return

            # Bridge echo
            if getattr(getattr(message, "channel", None), "id", None) == self.dm_bridge_chan_id:
                self._maybe_index_dm_from_bridge(message)
                return

            # Direct DM to bot (route by recipient to keep one DM thread per peer)
            if isinstance(message.channel, discord.DMChannel):
                try:
                    other = getattr(message.channel, "recipient", None)
                    # Fallback if recipient missing
                    if other is None:
                        me = getattr(self, "client", None)
                        me = getattr(me, "user", None)
                        other = message.author if (me and message.author.id != me.id) else None
                    if other is None:
                        return
                    uid = int(getattr(other, "id", 0) or 0)
                    if not uid:
                        return
                    tid = f"dm:{uid}"

                    # Ensure the DM thread is indexed and persisted
                    self.dm_threads[str(uid)] = other
                    try:
                        base = getattr(other, "global_name", None) or getattr(other, "name", None) or "user"
                        self._remember_dm_user(uid, base)
                    except Exception:
                        pass
                    try:
                        self.dm_threads_changed.emit()
                    except Exception:
                        pass

                    # Resolve display name and push
                    name = await self._author_display_async(message, tid)
                    self._push_ui_message_with_author(tid, message, name)
                except Exception:
                    pass
                return

        @self.client.event
        async def on_reaction_add(reaction, user):
            await self._handle_reaction_change(reaction.message, added=True, reactor=user)

        @self.client.event
        async def on_reaction_remove(reaction, user):
            await self._handle_reaction_change(reaction.message, added=False, reactor=user)

        @self.client.event
        async def on_raw_reaction_add(payload: discord.RawReactionActionEvent):
            try:
                ch = self.client.get_channel(payload.channel_id) or await self.client.fetch_channel(payload.channel_id)
                m = await ch.fetch_message(payload.message_id)
                u = self.client.get_user(payload.user_id) or await self.client.fetch_user(payload.user_id)
                await self._handle_reaction_change(m, added=True, reactor=u)
            except Exception:
                pass

        @self.client.event
        async def on_raw_reaction_remove(payload: discord.RawReactionActionEvent):
            try:
                ch = self.client.get_channel(payload.channel_id) or await self.client.fetch_channel(payload.channel_id)
                m = await ch.fetch_message(payload.message_id)
                u = self.client.get_user(payload.user_id) or await self.client.fetch_user(payload.user_id)
                await self._handle_reaction_change(m, added=False, reactor=u)
            except Exception:
                pass

    async def _fetch_recent_dm(self, uid: int, recent: int = 75):
        """Fetch only the most recent N messages for a DM (fast path, no TTS/unread spam)."""
        try:
            user = await self.client.fetch_user(uid)
            await user.create_dm()
            chan = user.dm_channel
            if not chan:
                return
            tid = f"dm:{uid}"
            self.ui_messages.setdefault(tid, [])
            have = {m.id for m in self.ui_messages[tid]}
            # newest first, then reverse for chronological append
            msgs = [m async for m in chan.history(limit=recent, oldest_first=False)]
            msgs.reverse()
            for msg in msgs:
                # Skip duplicates across all sources
                if msg.id in self._seen_ids:
                    continue
                if msg.id in have:
                    continue
                try:
                    author_name = await self._author_display_async(msg, tid)
                except Exception:
                    author_name = getattr(getattr(msg, "author", None), "name", "user")
                atts = self._extract_attachments(msg)
                ui = UiMessage(
                    id=msg.id,
                    author=author_name,
                    content=self._format_message_content(msg),
                    ts=msg.created_at.timestamp(),
                    from_me=bool(self.client.user and msg.author.id == self.client.user.id),
                    attachments=atts,
                )
                self.ui_messages[tid].append(ui)
                # Mark as seen globally
                self._seen_ids.add(msg.id)
                # NEW: capture reactions so they render after restart
                try:
                    self.ui_reactions[msg.id] = self._build_ui_reactions(msg)
                except Exception:
                    self.ui_reactions[msg.id] = []
            # keep chronological just in case
            self.ui_messages[tid].sort(key=lambda m: m.ts)
            # NEW: notify UI so it can recompute unread and refresh the list
            try:
                self.history_extended.emit(tid)
            except Exception:
                pass
        except Exception:
            pass

    def fetch_recent_dm(self, thread_id: str, recent: int = 10):
        if not thread_id.startswith("dm:") or not self.loop:
            return
        try:
            uid = int(thread_id.split(":", 1)[1])
        except Exception:
            return
        try:
            self.loop.call_soon_threadsafe(lambda: asyncio.create_task(self._fetch_recent_dm(uid, recent)))
        except Exception:
            pass

    def react_to_message(self, thread_id: str, message_id: int, emoji: str):
        # Fill previously blank logic
        if not self.loop or not emoji:
            return
        async def _do():
            try:
                msg = None
                if thread_id == "main" and self.main_channel:
                    try:
                        msg = await self.main_channel.fetch_message(int(message_id))
                    except Exception:
                        return
                elif thread_id.startswith("dm:"):
                    try:
                        uid = int(thread_id.split(":",1)[1])
                    except Exception:
                        uid = 0
                    if uid:
                        try:
                            user = await self.client.fetch_user(uid)
                            await user.create_dm()
                            chan = user.dm_channel
                            if chan:
                                msg = await chan.fetch_message(int(message_id))
                        except Exception:
                            return
                if not msg:
                    return
                me = self.client.user
                already = False
                for r in getattr(msg, "reactions", []) or []:
                    if r.emoji == emoji and me:
                        try:
                            async for u in r.users():
                                if u.id == me.id:
                                    already = True
                                    break
                        except Exception:
                            pass
                if already:
                    try:
                        await msg.remove_reaction(emoji, me)
                    except Exception:
                        pass
                else:
                    try:
                        await msg.add_reaction(emoji)
                    except Exception:
                        pass
                try:
                    msg = await msg.channel.fetch_message(msg.id)
                except Exception:
                    pass
                self.ui_reactions[msg.id] = self._build_ui_reactions(msg)
                tid = self._thread_id_for_message(msg) or thread_id
                self.reactions_updated.emit(tid, msg.id)
            except Exception:
                pass
        try:
            self.loop.call_soon_threadsafe(lambda: asyncio.create_task(_do()))
        except Exception:
            pass

    def ensure_dm_history(self, thread_id: str, desired: int = 500):
        if not thread_id.startswith("dm:") or not self.loop:
            return
        if thread_id in self._dm_history_loading:
            return
        existing = self.ui_messages.get(thread_id, [])
        if len(existing) >= desired:
            return
        try:
            uid = int(thread_id.split(":", 1)[1])
        except Exception:
            return

        self._dm_history_loading.add(thread_id)

        async def _load():
            try:
                user = await self.client.fetch_user(uid)
                await user.create_dm()
                chan = user.dm_channel
                if not chan:
                    return

                have_ids = {m.id for m in self.ui_messages.get(thread_id, [])}
                need = max(0, desired - len(have_ids))
                if need <= 0:
                    return

                # Fetch newest first, then reverse so we append in chronological order
                msgs = [m async for m in chan.history(limit=need, oldest_first=False)]
                msgs.reverse()

                for msg in msgs:
                    # Skip if already present or globally seen
                    if msg.id in have_ids or msg.id in self._seen_ids:
                        continue
                    try:
                        author_name = await self._author_display_async(msg, thread_id)
                    except Exception:
                        author_name = getattr(getattr(msg, "author", None), "name", "user")
                    ui = UiMessage(
                        id=msg.id,
                        author=author_name,
                        content=self._format_message_content(msg),
                        ts=msg.created_at.timestamp(),
                        from_me=bool(self.client.user and msg.author.id == self.client.user.id),
                        attachments=self._extract_attachments(msg),
                    )
                    self.ui_messages.setdefault(thread_id, []).append(ui)
                    # Update local/global seen to prevent duplicates within same batch
                    have_ids.add(msg.id)
                    self._seen_ids.add(msg.id)
                    # NEW: persist reactions for older history too
                    try:
                        self.ui_reactions[msg.id] = self._build_ui_reactions(msg)
                    except Exception:
                        self.ui_reactions[msg.id] = []

                self.ui_messages[thread_id].sort(key=lambda m: m.ts)
            except Exception:
                pass
            finally:
                try:
                    self.history_extended.emit(thread_id)
                except Exception:
                    pass
                self._dm_history_loading.discard(thread_id)

        try:
            self.loop.call_soon_threadsafe(lambda: asyncio.create_task(_load()))
        except Exception:
            self._dm_history_loading.discard(thread_id)

    # ----- internals -----
    def _runner(self):
        # build initial intents (try with message_content first)
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = False
        intents.presences = False
        intents.dm_messages = True
        intents.guild_messages = True
        intents.guilds = True

        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

        current_intents_box = [intents]

        async def _close_client():
            try:
                if self.client and not self.client.is_closed():
                    await self.client.close()
            except Exception:
                pass
            finally:
                self.client = None

        def start_client():
            if self._stopping:
                return
            try:
                # assume available when trying with message_content=True
                self.message_content_available = current_intents_box[0].message_content
                self.client = discord.Client(intents=current_intents_box[0])
                self._setup_handlers()
                task = self.loop.create_task(self.client.start(self.token))

                def on_task_done(fut: asyncio.Future):
                    if self._stopping:
                        return
                    try:
                        fut.result()
                    except discord.errors.PrivilegedIntentsRequired:
                        # retry without message content — close old client first, then restart
                        self.status.emit("Message Content intent not enabled. Falling back without it. Enable it in Developer Portal for full functionality.")
                        ii = discord.Intents.default()
                        ii.message_content = False
                        ii.members = False
                        ii.presences = False
                        ii.dm_messages = True
                        ii.guild_messages = True
                        ii.guilds = True
                        current_intents_box[0] = ii
                        self.message_content_available = False
                        # ensure previous client is closed before retry
                        self.loop.create_task(_close_client())
                        # schedule fresh start on the event loop
                        self.loop.call_soon(start_client)
                    except Exception as e:
                        self.status.emit(f"Discord closed: {e}")
                        try:
                            self.loop.stop()
                        except Exception:
                            pass

                task.add_done_callback(on_task_done)
            except Exception as e:
                self.status.emit(f"Discord error during start: {e}")
                try:
                    self.loop.stop()
                except Exception:
                    pass

        # kick off first attempt and run loop
        start_client()
        try:
            self.loop.run_forever()
        finally:
            # cleanup loop to avoid 'Unclosed connector' warnings
            try:
                pending = asyncio.all_tasks(loop=self.loop)
                for t in pending:
                    t.cancel()
                if pending:
                    self.loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            except Exception:
                pass
            try:
                self.loop.run_until_complete(self.loop.shutdown_asyncgens())
            except Exception:
                pass
            try:
                self.loop.close()
            except Exception:
                pass

    async def _forward_to_bridge(self, user: discord.User, content: str):
        # Read-only mode: listener is the single source for bridge mirroring
        return

    def _maybe_index_dm_from_bridge(self, message: discord.Message):
        # Ensure nickname preference when indexing via bridge
        try:
            txt = message.content or ""
            m = re.match(r"DM from (.+?) \((\d+)\):\s*(.*)", txt, flags=re.S)
            if not m:
                return
            raw_name = m.group(1).strip()
            uid = int(m.group(2))
            body = (m.group(3) or "").strip()

            # Ignore any outgoing mirrors and any self-id to avoid self-DM threads
            try:
                if body.lower().startswith("(outgoing"):
                    return
                me = getattr(self, "client", None)
                me = getattr(me, "user", None)
                if me and int(uid) == int(getattr(me, "id", 0)):
                    return
            except Exception:
                pass

            tid = f"dm:{uid}"
            # resolve display name if possible
            disp = None
            try:
                if uid in self._name_cache:
                    disp = self._name_cache[uid]
                elif self.guild:
                    mem = self.guild.get_member(uid)
                    if mem and getattr(mem, "display_name", None):
                        # NEW: prefer guild nickname and cache it now for list label
                        disp = mem.display_name
                        self._name_cache[uid] = disp
            except Exception:
                pass
            name = disp or raw_name

            # Remember user and ensure a thread stub so the DM shows up in the list,
            # but DO NOT append the bridged message to the UI to avoid duplicates.
            self._remember_dm_user(uid, name)
            if str(uid) not in self.dm_threads:
                class _Stub: pass
                s = _Stub(); s.name = name; s.id = uid
                self.dm_threads[str(uid)] = s  # type: ignore
                self.dm_threads_changed.emit()
            self.ui_messages.setdefault(tid, [])
            # NOTE: Intentionally skip creating UiMessage for bridge echoes
            return
        except Exception:
            pass

    def _format_message_content(self, m: discord.Message) -> str:
        # Prefer text content; if missing, include embed text; attachments are rendered as chips in UI
        txt = (m.content or "").strip()
        parts = []
        if txt:
            parts.append(txt)
        # embeds
        try:
            for emb in getattr(m, "embeds", []) or []:
                t = getattr(emb, "title", None) or ""
                d = getattr(emb, "description", None) or ""
                e_txt = " — ".join([s for s in [t.strip(), d.strip()] if s])
                if e_txt:
                    parts.append(e_txt)
        except Exception:
            pass
        out = "\n".join([p for p in parts if p]).strip()
        if not out:
            # If DM, content should be available even without intent; otherwise show placeholder.
            if not isinstance(m.channel, discord.DMChannel) and not self.message_content_available and not getattr(m.author, "bot", False):
                out = "[message content not available — enable Message Content intent]"
        # NEW: replace <@123...> user mentions with @DisplayName (no raw IDs)
        try:
            out = self._replace_user_mentions(out, m)
        except Exception:
            pass
        return out

    # NEW: resolve a user display name synchronously without network when possible
    def _mention_display_name_sync(self, uid: int) -> Optional[str]:
        # cache first
        if uid in self._name_cache:
            return self._name_cache[uid]
        # guild member cache
        try:
            g = self.guild or (self.main_channel.guild if self.main_channel else None)
            if g:
                mem = g.get_member(uid)
                if mem and getattr(mem, "display_name", None):
                    self._name_cache[uid] = mem.display_name
                    return mem.display_name
        except Exception:
            pass
        # user cache
        try:
            u = self.client.get_user(uid) if self.client else None
            if u:
                name = getattr(u, "global_name", None) or getattr(u, "name", None)
                if name:
                    self._name_cache[uid] = name
                    return name
        except Exception:
            pass
        return None

    # NEW: replace all user mention tokens with @DisplayName
    def _replace_user_mentions(self, text: str, m: Optional[discord.Message] = None) -> str:
        if not text:
            return text
        # Build quick map from message mentions if available
        id_to_name: Dict[int, str] = {}
        try:
            for u in (getattr(m, "mentions", []) or []):
                uid = int(getattr(u, "id", 0) or 0)
                if not uid:
                    continue
                # Prefer guild nickname if this is a Member
                name = getattr(u, "display_name", None) or getattr(u, "global_name", None) or getattr(u, "name", None)
                if name:
                    id_to_name[uid] = name
                    self._name_cache[uid] = name
        except Exception:
            pass

        pat = re.compile(r"<@!?(\d+)>")

        def _repl(match: re.Match) -> str:
            try:
                uid = int(match.group(1))
            except Exception:
                return "@user"
            name = id_to_name.get(uid) or self._mention_display_name_sync(uid) or "user"
            return f"@{name}"

        return pat.sub(_repl, text)

    def _author_display(self, m: discord.Message, thread_id: str) -> str:
        a = getattr(m, "author", None)
        # In the main guild channel, prefer the member's guild nickname/display name
        if thread_id == "main":
            dn = getattr(a, "display_name", None)
            if dn:
                return dn
        # For DMs, prefer server nickname from cache
        try:
            if thread_id.startswith("dm:") and a and getattr(a, "id", None):
                nm = self._name_cache.get(a.id)
                if nm:
                    return nm
        except Exception:
            pass
        # Fallbacks for DMs or when no nickname is available
        return getattr(a, "global_name", None) or getattr(a, "name", "user")

    async def _author_display_async(self, m: discord.Message, thread_id: str) -> str:
        """
        Resolve a display name prioritizing server nickname (Member.display_name).
        Falls back to global_name then name.
        """
        try:
            a = getattr(m, "author", None)
            if not a:
                return "user"
            # Main guild context
            g = self.guild or (self.main_channel.guild if self.main_channel else None)
            if g:
                mem = g.get_member(a.id)
                if not mem:
                    try:
                        mem = await g.fetch_member(a.id)
                    except Exception:
                        mem = None
                if mem and getattr(mem, "display_name", None):
                    self._name_cache[a.id] = mem.display_name
                    return mem.display_name
            # DM thread: attempt guild nickname via cache if already resolved
            if thread_id.startswith("dm:"):
                if a.id in self._name_cache:
                    return self._name_cache[a.id]
                if g:
                    mem = g.get_member(a.id)
                    if mem and getattr(mem, "display_name", None):
                        self._name_cache[a.id] = mem.display_name
                        return mem.display_name
            return getattr(a, "global_name", None) or getattr(a, "name", "user")
        except Exception:
            try:
                return m.author.name
            except Exception:
                return "user"

    async def _resolve_member_display(self, uid: int) -> Optional[str]:
        """
        Resolve a user's display name, preferring the guild nickname (Member.display_name),
        then global_name, then name. Caches results in _name_cache.
        """
        try:
            if uid in self._name_cache:
                return self._name_cache[uid]
            g = self.guild or (self.main_channel.guild if self.main_channel else None)
            if g:
                mem = g.get_member(uid)
                if not mem:
                    try:
                        mem = await g.fetch_member(uid)
                    except Exception:
                        mem = None
                if mem and getattr(mem, "display_name", None):
                    self._name_cache[uid] = mem.display_name
                    return mem.display_name
            # Fallback to user profile
            u = self.client.get_user(uid)
            if not u:
                try:
                    u = await self.client.fetch_user(uid)
                except Exception:
                    u = None
            if u:
                name = getattr(u, "global_name", None) or getattr(u, "name", None)
                if name:
                    self._name_cache[uid] = name
                    return name
        except Exception:
            pass
        return None

    def display_for_user_id(self, uid: int, fallback: str = "user") -> str:
        # Sync helper for UI lists/headers
        return self._name_cache.get(uid, fallback)

    def _push_ui_message(self, thread_id: str, m: discord.Message):
        # Global de-dup: skip if we've ever seen this message ID
        try:
            if m.id in self._seen_ids:
                return
        except Exception:
            pass
        # De-dup within thread list
        try:
            lst = self.ui_messages.setdefault(thread_id, [])
            if any(mm.id == m.id for mm in lst):
                return  # NEW: prevent duplicates
        except Exception:
            pass
        from_me = False
        try:
            u = self.client.user if self.client else None
            from_me = bool(u and getattr(m, "author", None) and m.author.id == u.id)
        except Exception:
            pass
        atts = self._extract_attachments(m)
        ui = UiMessage(
            id=m.id,
            author=self._author_display(m, thread_id),
            content=self._format_message_content(m),
            ts=m.created_at.timestamp(),
            from_me=from_me,
            attachments=atts,
        )
        self.ui_messages.setdefault(thread_id, []).append(ui)
        # Mark as seen globally
        try:
            self._seen_ids.add(m.id)
        except Exception:
            pass
        try:
            self.ui_reactions[m.id] = self._build_ui_reactions(m)
        except Exception:
            self.ui_reactions[m.id] = []
        self.message_added.emit(thread_id, ui)

    def _push_ui_message_with_author(self, thread_id: str, m: discord.Message, author_name: str):
        # Global de-dup: skip if we've ever seen this message ID
        try:
            if m.id in self._seen_ids:
                return
        except Exception:
            pass
        # De-dup within thread list
        try:
            lst = self.ui_messages.setdefault(thread_id, [])
            if any(mm.id == m.id for mm in lst):
                return  # NEW: prevent duplicates
        except Exception:
            pass
        from_me = False
        try:
            u = self.client.user if self.client else None
            from_me = bool(u and getattr(m, "author", None) and m.author.id == u.id)
        except Exception:
            pass
        atts = self._extract_attachments(m)
        ui = UiMessage(
            id=m.id,
            author=author_name,
            content=self._format_message_content(m),
            ts=m.created_at.timestamp(),
            from_me=from_me,
            attachments=atts,
        )
        self.ui_messages.setdefault(thread_id, []).append(ui)
        # Mark as seen globally
        try:
            self._seen_ids.add(m.id)
        except Exception:
            pass
        try:
            self.ui_reactions[m.id] = self._build_ui_reactions(m)
        except Exception:
            self.ui_reactions[m.id] = []
        self.message_added.emit(thread_id, ui)

    async def _mirror_outgoing_dm(self, recipient: discord.User, content: str):
        """Mirror outgoing DM to the private bridge channel."""
        try:
            if not self.dm_bridge_chan_id:
                return
            # Resolve bridge channel
            bridge = self.client.get_channel(self.dm_bridge_chan_id)
            if not bridge:
                try:
                    bridge = await self.client.fetch_channel(self.dm_bridge_chan_id)
                except Exception:
                    bridge = None
            if not isinstance(bridge, discord.TextChannel):
                return
            
            # Resolve recipient display name
            try:
                disp = await self._resolve_member_display(recipient.id)
            except Exception:
                disp = None
            name = disp or getattr(recipient, "global_name", None) or getattr(recipient, "name", "user")
            
            # Send to bridge
            await bridge.send(f"To {name} ({recipient.id}): {content}")
        except Exception:
            pass

    def send_text(self, thread_id: str, text: str):
        if not text or not self.loop:
            return
        async def _send():
            try:
                if thread_id == "main" and self.main_channel:
                    msg = await self.main_channel.send(text)
                    # Push our own message to UI
                    try:
                        name = await self._author_display_async(msg, "main")
                    except Exception:
                        name = getattr(getattr(self.client, "user", None), "name", "me")
                    self._push_ui_message_with_author("main", msg, name)
                elif thread_id.startswith("channel:"):
                    try:
                        chan_id = int(thread_id.split(":", 1)[1])
                        ch = self.channels.get(chan_id)
                        if ch:
                            msg = await ch.send(text)
                            try:
                                name = await self._author_display_async(msg, thread_id)
                            except Exception:
                                name = getattr(getattr(self.client, "user", None), "name", "me")
                            self._push_ui_message_with_author(thread_id, msg, name)
                    except Exception:
                        pass
                elif thread_id.startswith("dm:"):
                    uid = None
                    try:
                        uid = int(thread_id.split(":", 1)[1])
                    except Exception:
                        uid = None
                    if uid is None:
                        return
                    # Ensure user and channel
                    user = self.client.get_user(uid)
                    if not user:
                        try:
                            user = await self.client.fetch_user(uid)
                        except Exception:
                            user = None
                    if not user:
                        return
                    await user.create_dm()
                    # Send and get the created message
                    msg = await user.dm_channel.send(text)
                    # Mirror to bridge
                    await self._mirror_outgoing_dm(user, text)

                    # Index the DM thread and notify list
                    try:
                        self.dm_threads[str(uid)] = user
                        base = getattr(user, "global_name", None) or getattr(user, "name", None) or "user"
                        self._remember_dm_user(uid, base)
                        # NEW: resolve and cache nickname for immediate list update
                        try:
                            disp = await self._resolve_member_display(uid)
                            if disp:
                                self._name_cache[uid] = disp
                        except Exception:
                            pass
                        self.dm_threads_changed.emit()
                    except Exception:
                        pass
                    # Push our own message to UI
                    tid = f"dm:{uid}"
                    try:
                        name = await self._author_display_async(msg, tid)
                    except Exception:
                        name = getattr(getattr(self.client, "user", None), "name", "me")
                    self._push_ui_message_with_author(tid, msg, name)
            except Exception:
                pass
        try:
            self.loop.call_soon_threadsafe(lambda: asyncio.create_task(_send()))
        except Exception:
            pass

    def send_reply(self, thread_id: str, message_id: int, text: str):
        if not text or not self.loop:
            return
        async def _send():
            try:
                # Resolve the display name we are replying to
                reply_to = None
                try:
                    ui = next((m for m in self.ui_messages.get(thread_id, []) if m.id == int(message_id)), None)
                    if ui and ui.author:
                        reply_to = ui.author
                except Exception:
                    reply_to = None
                if not reply_to and thread_id.startswith("dm:"):
                    try:
                        uid = int(thread_id.split(":", 1)[1])
                        # Replying in a DM: the peer's name
                        reply_to = self.display_for_user_id(uid, "user")
                    except Exception:
                        reply_to = None
                if not reply_to:
                    reply_to = "user"

                # Requested format for the DM content itself
                content = f"(reply to {reply_to}) {text}"

                if thread_id == "main" and self.main_channel:
                    # Send reply to main thread as a plain message (no reply reference in this UI)
                    msg = await self.main_channel.send(content)
                    try:
                        name = await self._author_display_async(msg, "main")
                    except Exception:
                        name = getattr(getattr(self.client, "user", None), "name", "me")
                    self._push_ui_message_with_author("main", msg, name)
                elif thread_id.startswith("channel:"):
                    try:
                        chan_id = int(thread_id.split(":", 1)[1])
                        ch = self.channels.get(chan_id)
                        if ch:
                            msg = await ch.send(content)
                            try:
                                name = await self._author_display_async(msg, thread_id)
                            except Exception:
                                name = getattr(getattr(self.client, "user", None), "name", "me")
                            self._push_ui_message_with_author(thread_id, msg, name)
                    except Exception:
                        pass
                elif thread_id.startswith("dm:"):
                    uid = None
                    try:
                        uid = int(thread_id.split(":", 1)[1])
                    except Exception:
                        uid = None
                    if uid is None:
                        return
                    user = self.client.get_user(uid)
                    if not user:
                        try:
                            user = await self.client.fetch_user(uid)
                        except Exception:
                            user = None
                    if not user:
                        return
                    await user.create_dm()
                    msg = await user.dm_channel.send(content)
                    # Mirror to bridge
                    await self._mirror_outgoing_dm(user, content)

                    # Index the DM thread and notify list
                    try:
                        self.dm_threads[str(uid)] = user
                        base = getattr(user, "global_name", None) or getattr(user, "name", None) or "user"
                        self._remember_dm_user(uid, base)
                        # NEW: resolve and cache nickname for immediate list update
                        try:
                            disp = await self._resolve_member_display(uid)
                            if disp:
                                self._name_cache[uid] = disp
                        except Exception:
                            pass
                        self.dm_threads_changed.emit()
                    except Exception:
                        pass
                    # Push our own message to UI
                    tid = f"dm:{uid}"
                    try:
                        name = await self._author_display_async(msg, tid)
                    except Exception:
                        name = getattr(getattr(self.client, "user", None), "name", "me")
                    self._push_ui_message_with_author(tid, msg, name)
            except Exception:
                pass
        try:
            self.loop.call_soon_threadsafe(lambda: asyncio.create_task(_send()))
        except Exception:
            pass

    # DM index persistence helpers
    def _load_dm_index(self):
        try:
            with open(self.dm_index_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                self._dm_index = {str(k): str(v) for k, v in data.items()}
            else:
                self._dm_index = {}
        except Exception:
            self._dm_index = {}

    def _save_dm_index(self):
        # Read-only mode: do not write from the UI app
        return

    def _remember_dm_user(self, user_id: int, name: str):
        # Read-only mode: do not mutate dm_index from the UI app
        return

    # Rebuild UI-friendly reactions list from a discord.Message
    def _build_ui_reactions(self, m: discord.Message) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        try:
            for r in getattr(m, "reactions", []) or []:
                e = r.emoji
                cnt = int(getattr(r, "count", 1) or 1)
                if isinstance(e, str):
                    out.append({
                        "emoji": e,
                        "name": self._emoji_spoken_name(e),
                        "url": None,
                        "count": cnt
                    })
                else:
                    # custom emoji
                    try:
                        name = (getattr(e, "name", None) or "emoji").replace("_", " ")
                    except Exception:
                        name = "emoji"
                    try:
                        url = str(getattr(e, "url", None) or "") or None
                    except Exception:
                        url = None
                    out.append({
                        "emoji": None,
                        "name": name,
                        "url": url,
                        "count": cnt
                    })
        except Exception:
            pass
        return out

    def _thread_id_for_message(self, m: discord.Message) -> Optional[str]:
        try:
            if self.main_channel and getattr(m.channel, "id", None) == self.main_channel.id:
                return "main"
            if isinstance(m.channel, discord.DMChannel):
                other = getattr(m.channel, "recipient", None)
                if other and getattr(other, "id", None):
                    return f"dm:{int(other.id)}"
        except Exception:
            pass
        return None

    def _emoji_spoken_name(self, emoji_obj) -> str:
        try:
            # unicode emoji
            if isinstance(emoji_obj, str):
                map_ = {"👍": "thumbs up", "👎": "thumbs down", "❤️": "heart", "😂": "laughing face"}
                return map_.get(emoji_obj, "emoji")
            # custom emoji
            nm = getattr(emoji_obj, "name", None)
            return (nm or "emoji").replace("_", " ")
        except Exception:
            return "emoji"

    async def _handle_reaction_change(self, m: discord.Message, added: bool, reactor):
        try:
            tid = self._thread_id_for_message(m)
            if not tid:
                return
            # refresh message to get accurate counts
            full = None
            try:
                full = await m.channel.fetch_message(m.id)
            except Exception:
                full = m
            self.ui_reactions[m.id] = self._build_ui_reactions(full)
            # notify UI
            self.reactions_updated.emit(tid, m.id)
            # TTS only on add, and only if we have this message in UI
            if added:
                msgs = self.ui_messages.get(tid, [])
                if any(mm.id == m.id for mm in msgs):
                    # resolve reactor display name
                    disp = None
                    try:
                        uid = getattr(reactor, "id", None)
                        if uid:
                            disp = await self._resolve_member_display(uid)
                    except Exception:
                        disp = None
                    name = disp or getattr(reactor, "global_name", None) or getattr(reactor, "name", "user")
                    # reaction spoken name
                    spoken = "reaction"
                    try:
                        # find matching reaction entry by emoji
                        for r in getattr(full, "reactions", []) or []:
                            if getattr(reactor, "bot", False):
                                pass
                        # fallback to emoji param on payload is complex; use generic
                    except Exception:
                        pass
                    # Use last added/any for spoken; best-effort using first entry if unknown
                    try:
                        if getattr(full, "reactions", None):
                            r0 = full.reactions[-1]
                            spoken = self._emoji_spoken_name(getattr(r0, "emoji", None))
                    except Exception:
                        spoken = "reaction"
                    self.reaction_tts.emit(f"{name} reacted {spoken}")
        except Exception:
            pass

    def _extract_attachments(self, m: discord.Message) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        try:
            for a in getattr(m, "attachments", []) or []:
                url = getattr(a, "url", None) or getattr(a, "proxy_url", None) or ""
                fn = getattr(a, "filename", "") or ""
                ctype = (getattr(a, "content_type", None) or "").lower()
                typ = "other"
                if ctype.startswith("image/") or fn.lower().endswith((".png",".jpg",".jpeg",".gif",".bmp",".webp",".avif",".tif",".tiff")):
                    typ = "image"
                elif ctype.startswith("video/") or fn.lower().endswith((".mp4",".mov",".m4v",".webm",".avi",".mkv",".3gp",".mpg",".mpeg")):
                    typ = "video"
                out.append({"type": typ, "url": url, "filename": fn})
        except Exception:
            pass
        try:
            # embeds -> treat image/video rich media as pseudo-attachments
            for emb in getattr(m, "embeds", []) or []:
                et = getattr(emb, "type", "") or ""
                # Image
                img_url = None
                try:
                    if getattr(emb, "image", None):
                        img_url = getattr(getattr(emb, "image"), "url", None)
                    if not img_url and getattr(emb, "thumbnail", None):
                        img_url = getattr(getattr(emb, "thumbnail"), "url", None)
                except Exception:
                    img_url = None
                if img_url:
                    out.append({"type": "image", "url": img_url, "filename": "embedded-image"})
                # Video
                vid_url = None
                try:
                    if getattr(emb, "video", None):
                        vid_url = getattr(getattr(emb, "video"), "url", None)
                except Exception:
                    vid_url = None
                if vid_url:
                    out.append({"type": "video", "url": vid_url, "filename": "embedded-video"})
        except Exception:
            pass
        return out

# ---------- UI ----------
class ThreadListDelegate(QtWidgets.QStyledItemDelegate):
    # Paint green text for items marked unread (role = Qt.UserRole+1)
    def paint(self, painter, option, index):
        opt = QtWidgets.QStyleOptionViewItem(option)
        self.initStyleOption(opt, index)
        has_unread = bool(index.data(Qt.UserRole + 1) or 0)

        # Remove focus rectangle and force "active" state so selection looks the same without focus
        try:
            opt.state &= ~QtWidgets.QStyle.State_HasFocus
            opt.state |= QtWidgets.QStyle.State_Active
        except Exception:
            pass

        # draw background without text
        text = opt.text
        opt.text = ""
        style = opt.widget.style() if opt.widget else QtWidgets.QApplication.style()
        style.drawControl(QtWidgets.QStyle.CE_ItemViewItem, opt, painter, opt.widget)

        # centered, larger, bold, green if unread (avoid clipping)
        painter.save()
        try:
            color = QtGui.QColor("#00ff1a") if has_unread else QtGui.QColor("#e9eef5")
            painter.setPen(color)
            f = QtGui.QFont(opt.font)
            # 50% larger (was ~48px via stylesheet); keep delegate in pixels to match CSS
            f.setPixelSize(72)
            f.setBold(True)
            painter.setFont(f)
            rect = opt.rect
            painter.drawText(rect, int(Qt.AlignCenter | Qt.TextSingleLine), text)
        finally:
            painter.restore()

    def sizeHint(self, option, index):
        # provide taller rows so larger text isn't clipped
        f = QtGui.QFont(option.font)
        f.setPixelSize(72)
        fm = QtGui.QFontMetrics(f)
        h = fm.height() + 40
        return QtCore.QSize(option.rect.width(), h)

class BenDiscordUI(QtWidgets.QMainWindow):
    def __init__(self, bridge: DiscordBridge):
        super().__init__()
        self.bridge = bridge
        self.setWindowTitle("Ben — Discord Mirror")
        # Start fullscreen instead of windowed
        self.setWindowState(Qt.WindowFullScreen)
        self.showFullScreen()
        
        # Network Access Manager for downloading images
        self.nam = QtNetwork.QNetworkAccessManager(self)
        self._downloaded_images = set()
        
        # Windows focus management
        self._keyboard_active = False  # Track when keyboard is open
        self._hwnd = None
        
        # Setup focus timer to maintain priority
        self._focus_timer = QTimer(self)
        self._focus_timer.setInterval(250)  # Check every 250ms
        self._focus_timer.timeout.connect(self._maintain_focus)
        self._focus_timer.start()
        
        # Get window handle after show
        QtCore.QTimer.singleShot(100, self._setup_window_focus)
        
        # Style with fullscreen-optimized sizing
        self.setStyleSheet("""
            * { font-family: Arial, Helvetica, sans-serif; }
            QMainWindow { background:#0b0f14; color:#e9eef5; }
            QLabel#big { font-size: 48px; font-weight: 800; text-align: center; }
            QLabel#info { font-size: 24px; color:#9fb6c9; text-align: center; }
            QListWidget { background:#0f1521; border:1px solid rgba(255,255,255,0.1); }
            QListWidget::item { padding: 30px; font-size: 60px; }  /* was 48px -> ~50% larger */
            QListWidget::item:hover { background: rgba(255,255,255,0.05); }  /* mouse hover */
            QTextBrowser { background:#0f1521; border:1px solid rgba(255,255,255,0.1); font-size: 28px; }
            QPushButton { padding: 30px 40px; font-size: 36px; border-radius: 16px; background:#152033; color:#e9eef5; }
            QPushButton:hover { background:#1a2a44; }  /* mouse hover */
            QPushButton[primary="true"] { background:#79c0ff; color:#001; font-weight: 800; }
            QPushButton[primary="true"]:hover { background:#90d0ff; }
            QPushButton[focused="true"], QListWidget::item:selected { border:3px solid #FFD64D; background: rgba(255,214,77,0.10); }
            /* Ensure selection looks the same whether the list has focus or not */
            QListWidget::item:selected:active { border:3px solid #FFD64D; background: rgba(255,214,77,0.10); }
            QListWidget::item:selected:!active { border:3px solid #FFD64D; background: rgba(255,214,77,0.10); }
            /* block-level scan focus highlight */
            QListWidget[scanFocus="true"], QTextBrowser[scanFocus="true"], QPushButton[scanFocus="true"] {
                border:3px solid #FFD64D; background: rgba(255,214,77,0.10);
            }
            /* Close button style */
            QPushButton#closeBtn, QPushButton#exitBtn {
                background: #d22; color: white; font-size: 28px; padding: 20px 32px;
                border-radius: 12px; font-weight: bold;
            }
            QPushButton#closeBtn:hover, QPushButton#exitBtn:hover { background: #f33; }
        """)

        # Create stacked widget to hold both menus
        self.stacked_widget = QtWidgets.QStackedWidget()
        self.setCentralWidget(self.stacked_widget)
        
        # Create both menu pages
        self._create_channel_list_page()
        self._create_message_view_page()
        
        # Start on channel list
        self.current_ui_mode = "channel_list"  # "channel_list" or "message_view"
        self.stacked_widget.setCurrentWidget(self.channel_list_page)

        # state
        self.current_thread_id = "main"
        # scanning state
        self.scan_mode = "idle"            # idle | blocks | channels | messages
        self.scan_block_index = -1         # varies by UI mode
        self.channel_scan_row = -1         # active row while scanning channels
        self.msg_scan_index = -1           # active msg block index while scanning messages
        
        # Anchor state for messages scan (position-based)
        self._scan_anchor_active = False
        self._scan_anchor_y = None  # viewport Y (int)
        
        # Initialize missing attributes before using them
        self.block_msg_ids = []
        self.unread_ids = set()
        self.read_ids = set()
        
        # Initialize state tracking
        self._react_tap_armed = False
        self._last_tts_msg_id = None
        
        # Initialize keyboard process tracking
        self._kb_process = None
        self._keyboard_pid = None

        # Spacebar debounce timer (prevent rapid fire)
        self._space_debounce_ms = 1000
        self._last_space_release = 0
        
        # Unified input cooldown for space/enter (ms)
        self._input_cooldown_ms = 1000
        self._space_cooldown_until = 0
        self._enter_cooldown_until = 0

        # legacy flags (unused now, retained for compatibility)
        self.focus_side = "left"
        self.space_down = False
        self.enter_down = False
        self.enter_at = 0.0
        self.ENTER_HOLD_MS = 2500

        # Spacebar long-hold scan (3s hold, then every 2s)
        self.SPACE_HOLD_MS = 3000
        self.SPACE_REPEAT_MS = 2000
        self.space_at = 0.0
        self._space_hold_active = False
        self._space_hold_timer = QtCore.QTimer(self)
        self._space_hold_timer.setSingleShot(False)
        self._space_hold_timer.setInterval(self.SPACE_REPEAT_MS)
        self._space_hold_timer.timeout.connect(self._space_hold_tick)
        # Arm timers for hold detection
        self._space_hold_arm = QtCore.QTimer(self)
        self._space_hold_arm.setSingleShot(True)
        self._space_hold_arm.setInterval(self.SPACE_HOLD_MS)
        self._space_hold_arm.timeout.connect(self._arm_space_hold)
        self._enter_hold_arm = QtCore.QTimer(self)
        self._enter_hold_arm.setSingleShot(True)
        self._enter_hold_arm.setInterval(self.ENTER_HOLD_MS)
        self._enter_hold_arm.timeout.connect(self._arm_enter_hold)

        # Persistent read memory
        self._read_state_path = os.path.join(os.path.dirname(__file__), "read_state.json")
        # NEW: persisted last seen timestamp (epoch seconds)
        self._last_seen_ts = 0.0
        self._load_read_state()

        # Suppress DM TTS until warm load completes
        self._suppress_incoming_dm_tts = True
        # NEW: suppress unread marking during warm-load; only mark "offline" unreads after warm completes
        self._during_warmload = True

        # reaction tap-after-tts state
        self._react_tap_timer = QtCore.QTimer(self)
        self._react_tap_timer.setSingleShot(True)
        self._react_tap_timer.setInterval(4000)
        self._react_tap_timer.timeout.connect(lambda: setattr(self, "_react_tap_armed", False))

        # Heartbeat: let the listener know we are active
        self._hb_timer = QTimer(self)
        self._hb_timer.setInterval(2000)  # every 2s
        self._hb_timer.timeout.connect(self._write_heartbeat)
        self._hb_timer.start()
        # Write immediately so the listener pauses right away
        self._write_heartbeat()

        # Initialize overlays after message view is created
        self._setup_overlays()

        # Create TTS worker
        self._tts_thread = QtCore.QThread(self)
        self._tts_worker = TTSWorker()
        self._tts_worker.moveToThread(self._tts_thread)
        self._tts_thread.start()

        # NEW: TTS keepalive watchdog (engine auto-recovery)
        try:
            self._tts_keepalive = QtCore.QTimer(self)
            self._tts_keepalive.setInterval(5000)  # every 5s
            self._tts_keepalive.timeout.connect(lambda: self._tts_worker.keepalive.emit())
            self._tts_keepalive.start()
        except Exception:
            pass

        # Install event filter
        QtWidgets.QApplication.instance().installEventFilter(self)
        self.view_msgs.viewport().installEventFilter(self)

        # Connect bridge signals
        self.bridge.channel_ready.connect(self._on_channel_ready)
        self.bridge.dm_threads_changed.connect(self._refresh_threads)
        self.bridge.message_added.connect(self._on_message_added)
        self.bridge.status.connect(self._on_status)
        self.bridge.warm_complete.connect(self._on_warm_complete)
        self.bridge.reactions_updated.connect(self._on_reactions_updated)
        self.bridge.reaction_tts.connect(lambda txt: self._speak(txt))
        self.bridge.history_extended.connect(self._on_history_extended)

        # initial fill without auto-selection
        self._refresh_threads()
        # ensure no block highlighted initially
        self._set_block_focus(-1)

        self._enter_hold_fired = False  # track if long-hold Enter fired to suppress short action
        self._space_hold_started = False  # NEW: track if Space long-hold engaged

    def _create_channel_list_page(self):
        """Create the first menu: Channel/DM list with Exit button"""
        self.channel_list_page = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(self.channel_list_page)
        layout.setContentsMargins(40, 40, 40, 40)
        layout.setSpacing(30)
        
        # Title
        title = QtWidgets.QLabel("Discord Channels & DMs")
        title.setObjectName("big")
        layout.addWidget(title)
        
        # Status info
        self.label_info = QtWidgets.QLabel("")
        self.label_info.setObjectName("info")
        layout.addWidget(self.label_info)
        
        # Channel/DM list (takes most space)
        self.list_threads = QtWidgets.QListWidget()
        self.list_threads.setSelectionMode(QtWidgets.QAbstractItemView.SingleSelection)
        # Prevent blue focus/indicator lines and any drop indicator
        self.list_threads.setFocusPolicy(Qt.NoFocus)
        self.list_threads.setDragDropMode(QtWidgets.QAbstractItemView.NoDragDrop)
        self.list_threads.setDropIndicatorShown(False)
        layout.addWidget(self.list_threads, 1)
        
        # Use custom delegate for unread styling
        self.list_threads.setItemDelegate(ThreadListDelegate(self.list_threads))
        
        # Mouse click support
        self.list_threads.itemClicked.connect(self._on_thread_clicked)
        
        # Exit button at bottom
        self.btn_exit_main = QtWidgets.QPushButton("EXIT")
        self.btn_exit_main.setObjectName("exitBtn")
        self.btn_exit_main.setCursor(Qt.PointingHandCursor)
        self.btn_exit_main.clicked.connect(self._on_exit_clicked)
        layout.addWidget(self.btn_exit_main)
        
        self.stacked_widget.addWidget(self.channel_list_page)
    
    def _create_message_view_page(self):
        """Create the second menu: Message view with 2 options (Send, Back) and the pane as selectable block"""
        self.message_view_page = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(self.message_view_page)
        layout.setContentsMargins(40, 40, 40, 40)
        layout.setSpacing(20)

        self.label_thread_title = QtWidgets.QLabel("Messages")
        self.label_thread_title.setObjectName("big")
        layout.addWidget(self.label_thread_title)

        # Messages pane acts as the "Messages" block
        self.view_msgs = QtWidgets.QTextBrowser()
        layout.addWidget(self.view_msgs, 1)

        # Message outline overlay
        self._msg_outline = QtWidgets.QFrame(self.view_msgs.viewport())
        self._msg_outline.setAttribute(Qt.WA_TransparentForMouseEvents, True)
        self._msg_outline.setStyleSheet("QFrame { border: 4px solid #FFD64D; border-radius: 12px; background: transparent; }")
        self._msg_outline.hide()
        self._overlay_idx = -1

        self.view_msgs.verticalScrollBar().valueChanged.connect(self._reposition_message_outline)
        self.view_msgs.horizontalScrollBar().valueChanged.connect(self._reposition_message_outline)
        self.view_msgs.document().contentsChanged.connect(self._reposition_message_outline)
        # Handle link clicks
        self.view_msgs.setOpenExternalLinks(False)
        self.view_msgs.anchorClicked.connect(self._on_anchor_clicked)

        # Bottom buttons: Send and Back
        button_layout = QtWidgets.QHBoxLayout()
        button_layout.setSpacing(30)

        self.btn_send = QtWidgets.QPushButton("Send Message")
        self.btn_send.setProperty("primary", True)
        self.btn_send.setCursor(Qt.PointingHandCursor)
        self.btn_send.clicked.connect(lambda: self._open_keyboard_and_send())
        button_layout.addWidget(self.btn_send, 1)

        self.btn_back = QtWidgets.QPushButton("Back")
        self.btn_back.setCursor(Qt.PointingHandCursor)
        self.btn_back.clicked.connect(self._go_back_to_channel_list)
        button_layout.addWidget(self.btn_back, 1)

        layout.addLayout(button_layout)
        self.stacked_widget.addWidget(self.message_view_page)

    def _setup_window_focus(self):
        """Setup window to stay on top and get handle for focus management"""
        if _WIN32_AVAILABLE:
            try:
                # Get the window handle
                self._hwnd = int(self.winId())
                
                # Set window to always on top
                win32gui.SetWindowPos(
                    self._hwnd,
                    win32con.HWND_TOPMOST,
                    0, 0, 0, 0,
                    win32con.SWP_NOMOVE | win32con.SWP_NOSIZE
                )
                
                # Force initial focus
                self._force_focus()
            except Exception as e:
                print(f"Failed to setup window focus: {e}")
    
    def _maintain_focus(self):
        """Maintain window focus and close interfering windows"""
        if not _WIN32_AVAILABLE or not self._hwnd:
            return
        
        # If keyboard is active, don't steal focus - stay minimized
        if self._keyboard_active:
            return
            
        try:
            # Get current foreground window
            fg_hwnd = win32gui.GetForegroundWindow()
            
            # If we have focus, we're good
            if fg_hwnd == self._hwnd:
                return
                
            # Get window class name to identify the window
            try:
                class_name = win32gui.GetClassName(fg_hwnd)
            except:
                class_name = ""
            
            # Don't steal focus if we're minimized (keyboard is active)
            if self.isMinimized():
                return
            
            # Check for Start Menu or other system windows
            if class_name in ["Windows.UI.Core.CoreWindow", "Shell_TrayWnd", "DV2ControlHost", "Windows.UI.Core.CoreComponentInputSource"]:
                # Close the Start Menu or system overlay
                try:
                    # Send ESC to close Start Menu
                    win32api.keybd_event(0x1B, 0, 0, 0)  # ESC key down
                    win32api.keybd_event(0x1B, 0, win32con.KEYEVENTF_KEYUP, 0)  # ESC key up
                except:
                    pass
                # Force focus back to us
                self._force_focus()
                return
            
            # Check window title for other interfering windows
            try:
                window_title = win32gui.GetWindowText(fg_hwnd).lower()
                if "start" in window_title or "search" in window_title or "cortana" in window_title:
                    # Close it and take focus back
                    try:
                        win32gui.PostMessage(fg_hwnd, win32con.WM_CLOSE, 0, 0)
                    except:
                        pass
                    self._force_focus()
                    return
            except:
                pass
            
            # If we're not minimized and don't have focus, take it back
            if not self.isMinimized():
                self._force_focus()
                
        except Exception as e:
            # Silently continue on errors
            pass

    def _force_focus(self):
        """Force window to foreground"""
        if not _WIN32_AVAILABLE or not self._hwnd:
            return
        try:
            # Ensure we're on top
            win32gui.SetWindowPos(
                self._hwnd,
                win32con.HWND_TOPMOST,
                0, 0, 0, 0,
                win32con.SWP_NOMOVE | win32con.SWP_NOSIZE
            )
            # Show window if hidden
            win32gui.ShowWindow(self._hwnd, win32con.SW_SHOW)
            # Force to foreground
            win32gui.SetForegroundWindow(self._hwnd)
            win32gui.BringWindowToTop(self._hwnd)
            win32gui.SetActiveWindow(self._hwnd)
            # Qt side
            self.raise_()
            self.activateWindow()
            self.setFocus()
        except Exception:
            try:
                self.raise_()
                self.activateWindow()
                self.setFocus()
            except:
                pass

    # ---------- focus helpers for external windows (keyboard) ----------
    def _set_topmost(self, enable: bool):
        if not _WIN32_AVAILABLE or not self._hwnd:
            return
        try:
            win32gui.SetWindowPos(
                self._hwnd,
                win32con.HWND_TOPMOST if enable else win32con.HWND_NOTOPMOST,
                0, 0, 0, 0,
                win32con.SWP_NOMOVE | win32con.SWP_NOSIZE
            )
        except Exception:
            pass

    def _focus_pid_window(self, pid: int, timeout_ms: int = 3000):
        """Try to bring the top-level window of a given PID to the foreground.""" 
        if not _WIN32_AVAILABLE:
            return
        start = time.time()
        target = None

        def _enum_cb(hwnd, out):
            try:
                if not win32gui.IsWindowVisible(hwnd):
                    return
                _, wpid = win32process.GetWindowThreadProcessId(hwnd)
                if int(wpid) != int(pid):
                    return
                # skip tool windows with no title if possible
                title = win32gui.GetWindowText(hwnd) or ""
                if title.strip() == "":
                    return
                out.append(hwnd)
            except Exception:
                pass

        while (time.time() - start) * 1000 < timeout_ms and not target:
            found = []
            try:
                win32gui.EnumWindows(_enum_cb, found)
            except Exception:
                found = []
            if found:
                target = found[0]
                break
            time.sleep(0.1)

        if not target:
            return
        try:
            win32gui.ShowWindow(target, win32con.SW_SHOW)
            win32gui.SetForegroundWindow(target)
            win32gui.BringWindowToTop(target)
            win32gui.SetActiveWindow(target)
        except Exception:
            pass

    def _go_back_to_channel_list(self):
        """Switch back to channel list menu"""
        self.current_ui_mode = "channel_list"
        self.stacked_widget.setCurrentWidget(self.channel_list_page)
        # Stop any ongoing speech from the previous menu
        self._tts_stop()
        # Clean up overlays and message highlight, but leave scan in idle and no block highlighted
        self._exit_to_blocks(-1)
        # Clear any row selection/current in the list; wait for Space to start scanning
        try:
            self.list_threads.clearSelection()
            self.list_threads.setCurrentItem(None)
        except Exception:
            pass
        # No TTS cue here; Space will announce the first block

    def _on_thread_clicked(self, item):
        """Handle mouse click on thread list - go to message view"""
        if not item:
            return
        tid = item.data(Qt.UserRole)
        if tid:
            self._select_thread_and_switch(tid)

    def _select_thread_and_switch(self, tid: str):
        """Select a thread and switch to message view"""
        # NEW: prevent opening a self-DM thread even if one slipped in
        try:
            if tid.startswith("dm:"):
                uid = int(tid.split(":", 1)[1])
                me = getattr(getattr(self.bridge, "client", None), "user", None)
                if me and uid == int(getattr(me, "id", 0)):
                    self._speak("Cannot open self direct message")
                    return
        except Exception:
            pass

        self.current_thread_id = tid
        self._render_thread(tid)
        
        # Switch to message view
        self.current_ui_mode = "message_view"
        self.stacked_widget.setCurrentWidget(self.message_view_page)

        # Stop any ongoing speech from the previous menu
        self._tts_stop()
        
        # Start at Messages block and in blocks mode so Enter begins message scan
        self._exit_to_blocks(0)
        self._speak("Messages")

    def _set_block_focus(self, idx: int):
        """Highlight the current focusable block depending on the active UI mode.""" 
        self.scan_block_index = idx
        if self.current_ui_mode == "channel_list":
            # 0 = channels list, 1 = exit button
            for w in (self.list_threads, self.btn_exit_main):
                w.setProperty("scanFocus", False)
                w.style().unpolish(w); w.style().polish(w)
            if idx == 0:
                self.list_threads.setProperty("scanFocus", True)
            elif idx == 1:
                self.btn_exit_main.setProperty("scanFocus", True)
            for w in (self.list_threads, self.btn_exit_main):
                w.style().unpolish(w); w.style().polish(w)
        elif self.current_ui_mode == "message_view":
            # 0 = messages pane, 1 = send, 2 = back
            for w in (self.view_msgs, self.btn_send, self.btn_back):
                w.setProperty("scanFocus", False)
                w.style().unpolish(w); w.style().polish(w)
            if idx == 0:
                self.view_msgs.setProperty("scanFocus", True)
            elif idx == 1:
                self.btn_send.setProperty("scanFocus", True)
            elif idx == 2:
                self.btn_back.setProperty("scanFocus", True)
            for w in (self.view_msgs, self.btn_send, self.btn_back):
                w.style().unpolish(w); w.style().polish(w)

    def _on_space_short(self):
        # stop any ongoing TTS before announcing the next focus
        self._tts_stop()

        # If actions overlay is open, Space cycles current option (or selects first on first press)
        if hasattr(self, "_act_overlay") and self._act_overlay.isVisible():
            self._actions_focus_next(backward=False)
            return

        # If reaction overlay is open, Space cycles emoji focus (or selects first on first press)
        if self._react_overlay.isVisible():
            self._react_focus_next()
            return

        if self.scan_mode == "idle":
            self.scan_mode = "blocks"
            self._set_block_focus(0)
            if self.current_ui_mode == "channel_list":
                self._speak("Channels")
            else:
                self._speak("Messages")
            return

        if self.scan_mode == "blocks":
            if self.current_ui_mode == "channel_list":
                # 0=channels, 1=exit
                next_idx = (self.scan_block_index + 1) % 2
                self._set_block_focus(next_idx)
                self._speak(["Channels", "Exit"][next_idx])
            elif self.current_ui_mode == "message_view":
                # 0=messages, 1=send, 2=back
                next_idx = (self.scan_block_index + 1) % 3
                self._set_block_focus(next_idx)
                self._speak(["Messages", "Send Message", "Back"][next_idx])
            return

        if self.scan_mode == "channels":
            c = self.list_threads.count()
            if c == 0:
                self._speak("No channels")
                return
            self.channel_scan_row = (self.channel_scan_row + 1) % c
            # Ensure visible selection, not only "current" (prevents thin blue line)
            self._select_list_row(self.channel_scan_row)
            item = self.list_threads.item(self.channel_scan_row)
            if item:
                self._speak(item.text())
            return

        if self.scan_mode == "messages":
            if getattr(self, "_act_overlay", None) and self._act_overlay.isVisible():
                # cycle actions
                self._actions_focus_next(backward=False)
                return
            total = len(self.block_msg_ids)
            if total == 0:
                self._speak("No messages")
                return
            # ensure actions are closed when moving
            if getattr(self, "_act_overlay", None) and self._act_overlay.isVisible():
                self._close_actions_overlay()
            # move to previous (older) message; start from newest (bottom); wrap at oldest to newest
            if self.msg_scan_index < 0:
                self.msg_scan_index = total - 1
            else:
                self.msg_scan_index -= 1
                if self.msg_scan_index < 0:
                    # wrap to newest and reset anchoring; keep bottom aligned
                    self.msg_scan_index = total - 1
                    self._scan_anchor_active = False
                    self._scan_anchor_y = None
                    self._scroll_messages_to_bottom()
            self._highlight_message_scan(self.msg_scan_index)
            return

    def _space_back_step(self):
        # Backward scan for both UI modes
        self._tts_stop()

        # If actions overlay is open, cycle backward (or select last on first press)
        if hasattr(self, "_act_overlay") and self._act_overlay.isVisible():
            self._actions_focus_next(backward=True)
            return

        # If reaction overlay is open, move to previous emoji (or select last on first press)
        if self._react_overlay.isVisible():
            self._react_focus_prev()
            return

        if self.scan_mode == "idle":
            # enter blocks and start at last block
            self.scan_mode = "blocks"
            if self.current_ui_mode == "channel_list":
                self._set_block_focus(1)  # Exit button
                self._speak("Exit")
            else:
                self._set_block_focus(2)  # Back button
                self._speak("Back")
            return

        if self.scan_mode == "blocks":
            if self.current_ui_mode == "channel_list":
                prev_idx = (self.scan_block_index - 1) % 2
                self._set_block_focus(prev_idx)
                self._speak(["Channels", "Exit"][prev_idx])
            elif self.current_ui_mode == "message_view":
                prev_idx = (self.scan_block_index - 1) % 3
                self._set_block_focus(prev_idx)
                self._speak(["Messages", "Send Message", "Back"][prev_idx])
            return

        if self.scan_mode == "channels":
            c = self.list_threads.count()
            if c == 0:
                self._speak("No channels")
                return
            self.channel_scan_row = (self.channel_scan_row - 1) % c if self.channel_scan_row >= 0 else (c - 1)
            # Ensure visible selection, not only "current"
            self._select_list_row(self.channel_scan_row)
            item = self.list_threads.item(self.channel_scan_row)
            if item:
                self._speak(item.text())
            return

        if self.scan_mode == "messages":
            # Long-hold: scan DOWN (toward newer messages), repeating every 2s.
            # Close actions overlay if open while moving
            if getattr(self, "_act_overlay", None) and self._act_overlay.isVisible():
                self._close_actions_overlay()
                # fall through to move selection

            total = len(self.block_msg_ids)
            if total == 0:
                self._speak("No messages")
                return

            # First long-hold tick starts at the top so we scan down the list
            if self.msg_scan_index < 0:
                self.msg_scan_index = 0
            else:
                self.msg_scan_index += 1
                if self.msg_scan_index >= total:
                    self.msg_scan_index = 0  # wrap to top

            self._highlight_message_scan(self.msg_scan_index)
            return

    def _maybe_enter_hold(self):
        if not self.enter_down:
            return
        # if actions overlay open, close it and go back to appropriate mode
        if getattr(self, "_act_overlay", None) and self._act_overlay.isVisible():
            self._close_actions_overlay()
            self._speak("Messages")
            return
        # If overlay open, long-hold closes it
        if self._react_overlay.isVisible():
            self._close_react_overlay()
            return
        # NEW: Close image overlay
        if hasattr(self, "_img_overlay") and self._img_overlay.isVisible():
            self._close_image_overlay()
            return
        # NEW: Close video overlay
        if hasattr(self, "_vid_overlay") and self._vid_overlay.isVisible():
            self._close_video_overlay()
            return
        # Back out to block-level scan from inner scans
        if self.scan_mode == "channels":
            self._tts_stop()
            self._exit_to_blocks(0)  # back to first block
            if self.current_ui_mode == "channel_list":
                self._speak("Channels")
            else:
                self._speak("Messages")
        elif self.scan_mode == "messages":
            # CHANGE: jump to Send Message button instead of exiting messages select
            self._tts_stop()
            self._exit_to_blocks(1)  # 0=messages pane, 1=send, 2=back
            self._speak("Send Message")

    def _on_enter_short(self):
        # stop any ongoing TTS
        self._tts_stop()

        # If reaction overlay is open, Enter activates current emoji
        if self._react_overlay.isVisible():
            self._react_activate_current()
            return

        # If actions overlay is open, Enter activates current action (works even if not in 'messages' scan mode)
        if hasattr(self, "_act_overlay") and self._act_overlay.isVisible():
            self._activate_current_action()
            return

        if self.scan_mode == "blocks":
            if self.current_ui_mode == "channel_list":
                if self.scan_block_index == 0:
                    self._start_channel_scan()
                elif self.scan_block_index == 1:
                    self._on_exit_clicked()
            elif self.current_ui_mode == "message_view":
                if self.scan_block_index == 0:
                    self._start_message_scan()
                elif self.scan_block_index == 1:
                    self._open_keyboard_and_send()
                elif self.scan_block_index == 2:
                    self._go_back_to_channel_list()
            return

        if self.scan_mode == "channels":
            self._select_current_channel()
            return

        if self.scan_mode == "messages":
            # If actions overlay visible, activate current action
            if getattr(self, "_act_overlay", None) and self._act_overlay.isVisible():
                self._activate_current_action()
                return
            # Otherwise open actions overlay for current highlighted (or newest)
            total = len(self.block_msg_ids)
            if total == 0:
                self._speak("No messages"); return
            if self.msg_scan_index < 0 or self.msg_scan_index >= total:
                self.msg_scan_index = total - 1
                self._highlight_message_scan(self.msg_scan_index)
            self._open_actions_for_message(self.msg_scan_index)
            return

    def _select_current_channel(self):
        # Select channel and switch to message view
        item = self.list_threads.currentItem()
        if not item:
            self._speak("No channel")
            return
        tid = item.data(Qt.UserRole)
        self._select_thread_and_switch(tid)

    def _start_channel_scan(self):
        c = self.list_threads.count()
        if c == 0:
            self._speak("No channels")
            return
        # Turn off block-level highlight on the whole list when scanning items
        self.list_threads.setProperty("scanFocus", False)
        self.list_threads.style().unpolish(self.list_threads)
        self.list_threads.style().polish(self.list_threads)

        self.scan_mode = "channels"
        # Start at first item if none yet
        self.channel_scan_row = 0 if self.channel_scan_row < 0 else self.channel_scan_row
        # Ensure row is selected (not just current) so highlight doesn't disappear
        self._select_list_row(self.channel_scan_row)
        item = self.list_threads.item(self.channel_scan_row)
        if item:
            self._speak(item.text())

    def _start_message_scan(self):
        total = len(self.block_msg_ids)
        if total == 0:
            self._speak("No messages")
            return
        self.scan_mode = "messages"
        # reset anchor on start
        self._scan_anchor_active = False
        self._scan_anchor_y = None
        # Always scroll to bottom when entering the messages selector
        self._scroll_messages_to_bottom()
        # start from newest (bottom)
        self.msg_scan_index = total - 1
        self._highlight_message_scan(self.msg_scan_index)

    def _exit_to_blocks(self, idx: int):
        # Always reset when entering a menu; if idx < 0: go idle with no block highlighted
        self.scan_mode = "idle" if (idx is not None and idx < 0) else "blocks"

        # disarm reaction tap on mode exit
        self._react_tap_armed = False
        self._last_tts_msg_id = None
        if hasattr(self, '_react_tap_timer'):
            self._react_tap_timer.stop()
        if hasattr(self, '_react_overlay') and self._react_overlay.isVisible():
            self._close_react_overlay()
        # close actions overlay if open
        if hasattr(self, "_act_overlay") and self._act_overlay.isVisible():
            self._close_actions_overlay()
        self.channel_scan_row = -1
        self.msg_scan_index = -1
        # reset anchored highlight when leaving messages scan
        self._scan_anchor_active = False
        self._scan_anchor_y = None
        self._clear_message_scan_highlight()

        # Apply block focus state: -1 clears all highlights
        if idx is not None and idx < 0:
            self._set_block_focus(-1)
        else:
            self._set_block_focus(idx)

    def _highlight_message_scan(self, idx: int):
        # Outline the message block via an overlay (no fill)
        self._overlay_idx = idx
        self._position_message_outline(idx)
        # move caret to block for SR alignment
        doc = self.view_msgs.document()
        b = doc.begin(); bi = 0
        while b.isValid():
            if bi == idx:
                cur = self.view_msgs.textCursor()
                cur.setPosition(b.position())
                self.view_msgs.setTextCursor(cur)
                # Avoid Qt auto-scroll fighting the anchor: only auto-center if not anchored
                try:
                    if not self._scan_anchor_active:
                        # Ensure the highlighted block is visible so anchor can activate at midpoint
                        self.view_msgs.ensureCursorVisible()
                except Exception:
                    pass

                # Activate and/or enforce anchored position
                try:
                    self._maybe_activate_message_anchor(idx)
                    self._enforce_anchor_position(idx)
                    # After enforcing scroll, reposition the outline to match
                    self._position_message_outline(idx)
                    # Enforce once more after any deferred internal scrolling
                    QtCore.QTimer.singleShot(0, lambda: (
                        self._enforce_anchor_position(idx),
                        self._position_message_outline(idx)
                    ))
                except Exception:
                    pass
                break
            bi += 1; b = b.next()
        # Announce header: "Message from {author} at {time}"
        try:
            mid = self.block_msg_ids[idx]
            ui = next((m for m in self.bridge.ui_messages.get(self.current_thread_id, []) if m.id == mid), None)
            if ui:
                # Detect embedded media presence
                has_img = any(a.get("type") == "image" for a in (ui.attachments or []))
                has_vid = any(a.get("type") == "video" for a in (ui.attachments or []))
                has_yt = bool(self._extract_youtube_url(ui.content))
                
                extra = ""
                if has_yt:
                    extra = " with YouTube video"
                elif has_img and has_vid:
                    extra = " with embedded media"
                elif has_vid:
                    extra = " with embedded video"
                elif has_img:
                    extra = " with embedded image"
                self._speak(f"Message from {ui.author} at {self._fmt_12h(ui.ts)}{extra}")
        except Exception:
            pass

    def _clear_message_scan_highlight(self):
        self._overlay_idx = -1
        self._msg_outline.hide()

    def _position_message_outline(self, idx: int):
        try:
            doc = self.view_msgs.document()
            dl = doc.documentLayout()
            if not dl:
                self._msg_outline.hide(); return
            # Find target block
            b = doc.begin(); bi = 0
            while b.isValid() and bi < idx:
                b = b.next(); bi += 1
            if not b.isValid():
                self._msg_outline.hide(); return
            br = dl.blockBoundingRect(b)  # QRectF in document coords
            # Map to viewport coords using scroll offsets
            vx = -self.view_msgs.horizontalScrollBar().value()
            vy = -self.view_msgs.verticalScrollBar().value()
            x = int(br.left() + vx)
            y = int(br.top() + vy)
            w = int(br.width())
            h = int(br.height())

            # Expand outline slightly OUTSIDE the block so it doesn't intersect text
            expand = 8  # px outside
            x -= expand; y -= expand; w += expand*2; h += expand*2

            # Clamp to viewport
            vp = self.view_msgs.viewport().rect()
            if y > vp.bottom() or (y + h) < vp.top():
                self._msg_outline.hide(); return
            x = max(vp.left(), x)
            y = max(vp.top(), y)
            w = max(8, min(w, vp.right() - x + 1))
            h = max(8, min(h, vp.bottom() - y + 1))

            self._msg_outline.setGeometry(x, y, w, h)
            self._msg_outline.show()
        except Exception:
            self._msg_outline.hide()

    def _current_block_viewport_top(self, idx: int) -> Optional[int]:
        """Return the top Y of the given text block in viewport coordinates."""
        try:
            doc = self.view_msgs.document()
            dl = doc.documentLayout()
            if not dl:
                return None
            # Find target block
            b = doc.begin(); bi = 0
            while b.isValid() and bi < idx:
                b = b.next(); bi += 1
            if not b.isValid():
                return None
            br = dl.blockBoundingRect(b)  # QRectF in document coords
            # Map to viewport Y using scroll offset
            vy = -self.view_msgs.verticalScrollBar().value()
            return int(br.top() + vy)
        except Exception:
            return None

    def _maybe_activate_message_anchor(self, idx: int):
        """
        Activate anchor once the highlight crosses the viewport midpoint (position-based).
        """
        if self._scan_anchor_active or self.scan_mode != "messages":
            return
        try:
            vp = self.view_msgs.viewport().rect()
            anchor_y_mid = int(vp.height() * float(S("FOCUS_ANCHOR_RATIO", 0.5)))
            top_y = self._current_block_viewport_top(idx)
            cond_mid = (top_y is not None) and (top_y <= anchor_y_mid)
            if cond_mid:
                self._scan_anchor_active = True
                self._scan_anchor_y = anchor_y_mid
                # Snap current block to exact anchor Y
                sb = self.view_msgs.verticalScrollBar()
                if top_y is not None:
                    new_val = sb.value() + (top_y - self._scan_anchor_y)
                    sb.setValue(max(sb.minimum(), min(sb.maximum(), new_val)))
        except Exception:
            pass

    def _enforce_anchor_position(self, idx: int):
        """Keep the highlighted block frozen at the anchor Y by adjusting scroll."""
        if not self._scan_anchor_active or self._scan_anchor_y is None or self.scan_mode != "messages":
            return
        try:
            top_y = self._current_block_viewport_top(idx)
            if top_y is None:
                return
            delta = top_y - int(self._scan_anchor_y)
            if abs(delta) > 1:
                sb = self.view_msgs.verticalScrollBar()
                new_val = sb.value() + delta
                sb.setValue(max(sb.minimum(), min(sb.maximum(), new_val)))
        except Exception:
            pass

    def _reposition_message_outline(self):
        # Keep the pinned block anchored while scrolling/layout happens
        try:
            if self.scan_mode == "messages" and self._overlay_idx >= 0 and self._scan_anchor_active:
                self._enforce_anchor_position(self._overlay_idx)
        except Exception:
            pass
        # Recompute outline position when view moves
        if self.scan_mode == "messages" and self._overlay_idx >= 0:
            self._position_message_outline(self._overlay_idx)
        # Also keep the reaction overlay anchored while scrolling
        if hasattr(self, '_react_overlay') and self._react_overlay.isVisible():
            self._reposition_react_overlay()
        # keep the actions overlay anchored as well
        if hasattr(self, "_act_overlay") and self._act_overlay.isVisible():
            self._reposition_actions_overlay()
        # NEW: extend DM history when user scrolls to top
        try:
            if self.current_thread_id.startswith("dm:"):
                sb = self.view_msgs.verticalScrollBar()
                if sb.value() <= sb.minimum() + 24:
                    have = len(self.bridge.ui_messages.get(self.current_thread_id, []) or [])
                    batch = int(S("DM_BACKFILL_BATCH", 10))
                    self.bridge.ensure_dm_history(self.current_thread_id, desired=have + batch)
        except Exception:
            pass

    def _setup_overlays(self):
        """Setup all the overlay widgets after the main UI is created"""
        # Reaction overlay (slightly smaller, horizontal, appears centered/low)
        self._react_overlay = QtWidgets.QFrame(self.view_msgs.viewport())
        self._react_overlay.setStyleSheet(
            "QFrame { background: rgba(15,21,33,0.96); border: 5px solid #FFD64D; border-radius: 16px; }"
            "QPushButton { font-size: 80px; padding: 16px 24px; min-width: 120px; min-height: 120px; "
            "border: 4px solid transparent; border-radius: 14px; }"
            "QPushButton[focus='true'] { border-color: #FFD64D; }"
        )
        self._react_overlay.setAttribute(Qt.WA_TransparentForMouseEvents, False)
        lay = QtWidgets.QHBoxLayout(self._react_overlay)
        lay.setContentsMargins(18,18,18,18)
        lay.setSpacing(20)
        self._react_buttons = []
        for em in ["👍", "👎","❤️","😂"]:
            b = QtWidgets.QPushButton(em, self._react_overlay)
            b.setProperty("focus", False)
            b.setFocusPolicy(Qt.NoFocus)
            lay.addWidget(b)
            self._react_buttons.append(b)
        # Connect clickable reactions
        for i, b in enumerate(self._react_buttons):
            b.clicked.connect(lambda _=False, idx=i: (setattr(self, "_react_focus_idx", idx), self._update_react_focus(), self._react_activate_current()))
        # Selection outline (thicker)
        self._react_sel_outline = QtWidgets.QFrame(self._react_overlay)
        self._react_sel_outline.setAttribute(Qt.WA_TransparentForMouseEvents, True)
        self._react_sel_outline.setStyleSheet("QFrame { border: 6px solid #FFD64D; border-radius: 14px; background: transparent; }")
        self._react_sel_outline.hide()
        self._react_overlay.hide()
        # Start with no selection highlighted
        self._react_focus_idx = -1
        self._react_for_msg_id = None
        self._react_for_block_idx = None

        # Actions overlay (slightly smaller, horizontal, centered/low)
        self._act_overlay = QtWidgets.QFrame(self.view_msgs.viewport())
        self._act_overlay.setStyleSheet(
            "QFrame { background: rgba(15,21,33,0.96); border: 5px solid #FFD64D; border-radius: 16px; }"
            "QPushButton { font-size: 64px; padding: 16px 24px; margin: 0 10px; min-height: 120px; min-width: 200px; "
            "border: 4px solid transparent; border-radius: 14px; }"
            "QPushButton[focus='true'] { border-color: #FFD64D; }"
        )
        self._act_overlay.setAttribute(Qt.WA_TransparentForMouseEvents, False)
        _act_lay = QtWidgets.QHBoxLayout(self._act_overlay)  # horizontal
        _act_lay.setContentsMargins(18,18,18,18)
        _act_lay.setSpacing(20)
        self._act_buttons = []
        # Start with no selection highlighted
        self._act_focus_idx = -1
        self._act_for_msg_id = None
        self._act_for_block_idx = None
        self._act_sel_outline = QtWidgets.QFrame(self._act_overlay)
        self._act_sel_outline.setStyleSheet("QFrame { border: 6px solid #FFD64D; border-radius: 14px; background: transparent; }")
        self._act_sel_outline.setAttribute(Qt.WA_TransparentForMouseEvents, True)
        self._act_sel_outline.hide()
        self._act_overlay.hide()

        # Remember last centered geometry to reuse between Actions and Reactions
        self._last_center_overlay_geom = None

        # Image Viewer Overlay (Fullscreen)
        self._img_overlay = QtWidgets.QFrame(self.view_msgs.viewport())
        self._img_overlay.setStyleSheet("background: rgba(0,0,0,0.95);")
        self._img_overlay.setAttribute(Qt.WA_TransparentForMouseEvents, False)
        self._img_overlay.hide()
        
        img_layout = QtWidgets.QVBoxLayout(self._img_overlay)
        img_layout.setContentsMargins(0,0,0,0)
        img_layout.setAlignment(Qt.AlignCenter)
        
        self._img_label = QtWidgets.QLabel(self._img_overlay)
        self._img_label.setAlignment(Qt.AlignCenter)
        img_layout.addWidget(self._img_label)

        # Video Viewer Overlay (Fullscreen)
        self._vid_overlay = QtWidgets.QFrame(self.view_msgs.viewport())
        self._vid_overlay.setStyleSheet("background: black;")
        self._vid_overlay.setAttribute(Qt.WA_TransparentForMouseEvents, False)
        self._vid_overlay.hide()
        
        vid_layout = QtWidgets.QVBoxLayout(self._vid_overlay)
        vid_layout.setContentsMargins(0,0,0,0)
        
        self._vid_stack = QtWidgets.QStackedWidget()
        vid_layout.addWidget(self._vid_stack)
        
        # Page 0: Native Video (QtMultimedia)
        self._video_widget = None
        self._media_player = None
        self._audio_output = None
        if _QT_MEDIA:
            try:
                self._video_widget = QtMultimediaWidgets.QVideoWidget()
                self._media_player = QtMultimedia.QMediaPlayer()
                self._audio_output = QtMultimedia.QAudioOutput()
                self._media_player.setAudioOutput(self._audio_output)
                self._media_player.setVideoOutput(self._video_widget)
                self._vid_stack.addWidget(self._video_widget)
            except Exception:
                print("QtMultimedia initialization failed")
                self._media_player = None
                self._video_widget = None
                self._audio_output = None
        if not self._video_widget:
            self._vid_stack.addWidget(QtWidgets.QLabel("Native video playback not supported"))

        # Page 1: Web Video (QtWebEngine)
        self._web_view = None
        if _QT_WEB:
            try:
                self._web_view = QtWebEngineWidgets.QWebEngineView()
                self._web_view.setStyleSheet("background: black;")
                
                # Apply settings for YouTube playback (User Agent & Autoplay)
                ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
                try:
                    self._web_view.page().profile().setHttpUserAgent(ua)
                    QWebEngineProfile.defaultProfile().setHttpUserAgent(ua)
                    QWebEngineProfile.defaultProfile().setPersistentCookiesPolicy(QWebEngineProfile.ForcePersistentCookies)
                except Exception:
                    pass
                try:
                    self._web_view.settings().setAttribute(QWebEngineSettings.WebAttribute.PlaybackRequiresUserGesture, False)
                    self._web_view.settings().setAutoplayPolicy(QWebEngineSettings.AutoplayPolicy.NoUserGestureRequired)
                except Exception:
                    pass
                    
                self._vid_stack.addWidget(self._web_view)
            except Exception:
                pass
        if not self._web_view:
            self._vid_stack.addWidget(QtWidgets.QLabel("Web video playback not supported"))

    def _center_overlay(self, overlay: QtWidgets.QWidget):
        """
        Center the overlay horizontally and place it in the lower-middle of the viewport.
        Stores the geometry for reuse.
        """
        try:
            vp = self.view_msgs.viewport().rect()
            overlay.adjustSize()
            hint = overlay.sizeHint()
            # Cap the overlay width to viewport with margins, keep height large but inside viewport
            margin = 24
            max_w = max(320, vp.width() - margin*2)
            max_h = max(160, vp.height() - margin*2)
            w = min(hint.width(), max_w)
            h = min(hint.height(), max_h)
            cx = vp.left() + (vp.width() - w) // 2
            # lower-middle (about 62% down)
            cy = vp.top() + int(vp.height() * 0.62) - (h // 2)
            # clamp
            x = max(vp.left() + margin, min(cx, vp.right() - w - margin))
            y = max(vp.top() + margin, min(cy, vp.bottom() - h - margin))
            overlay.setGeometry(x, y, w, h)
            # remember geometry
            self._last_center_overlay_geom = overlay.geometry()
        except Exception:
            pass

    def _react_focus_next(self):
        # First press selects the first emoji
        if not getattr(self, "_react_buttons", None):
            return
        if self._react_focus_idx < 0:
            self._react_focus_idx = 0
        else:
            self._react_focus_idx = (self._react_focus_idx + 1) % len(self._react_buttons)
        self._update_react_focus()
        self._speak_current_reaction()

    def _react_focus_prev(self):
        # Backward: first press selects the last emoji
        if not getattr(self, "_react_buttons", None):
            return
        if self._react_focus_idx < 0:
            self._react_focus_idx = len(self._react_buttons) - 1
        else:
            self._react_focus_idx = (self._react_focus_idx - 1) % len(self._react_buttons)
        self._update_react_focus()
        self._speak_current_reaction()

    def _update_react_focus(self):
        # No selection: clear highlights and hide outline
        if self._react_focus_idx is None or self._react_focus_idx < 0:
            for b in self._react_buttons:
                b.setProperty("focus", False)
                b.style().unpolish(b); b.style().polish(b)
            try:
                self._react_sel_outline.hide()
            except Exception:
                pass
            return
        for i, b in enumerate(self._react_buttons):
            b.setProperty("focus", i == self._react_focus_idx)
            b.style().unpolish(b); b.style().polish(b)
        # Draw visible outline around the focused emoji
        try:
            btn = self._react_buttons[self._react_focus_idx]
            r = btn.geometry()
            pad = 10
            self._react_sel_outline.setGeometry(r.adjusted(-pad, -pad, pad, pad))
            self._react_sel_outline.show()
        except Exception:
            try:
                self._react_sel_outline.hide()
            except Exception:
                pass

    def _speak_current_reaction(self):
        # Announce the currently focused reaction
        try:
            if self._react_focus_idx is None or self._react_focus_idx < 0:
                return
            if not self._react_buttons or self._react_focus_idx >= len(self._react_buttons):
                return
            em = self._react_buttons[self._react_focus_idx].text()
            names = {"👍": "thumbs up", "👎": "thumbs down", "❤️": "heart", "😂": "laughing face"}
            self._speak(names.get(em, em))
        except Exception:
            pass

    def _react_activate_current(self):
        if self._react_for_msg_id is None:
            return
        # Do nothing if no emoji is selected yet
        if self._react_focus_idx is None or self._react_focus_idx < 0:
            return
        emoji = self._react_buttons[self._react_focus_idx].text()
        try:
            self.bridge.react_to_message(self.current_thread_id, int(self._react_for_msg_id), emoji)
        except Exception:
            pass
        self._speak("Reacted")
        self._close_react_overlay()

    def _close_react_overlay(self):
        self._react_overlay.hide()
        self._react_sel_outline.hide()

    def _reposition_react_overlay(self):
        """Center reaction overlay in the same space as Actions (large and easy to see)."""
        if not self._react_overlay.isVisible():
            return
        try:
            # If we have a remembered rect from actions, reuse it; otherwise center
            if self._last_center_overlay_geom:
                self._react_overlay.setGeometry(self._last_center_overlay_geom)
            else:
                self._center_overlay(self._react_overlay)
            # Also reposition the selection outline to wrap the focused button
            try:
                if self._react_sel_outline and self._react_sel_outline.isVisible() and self._react_buttons and self._react_focus_idx >= 0:
                    btn = self._react_buttons[self._react_focus_idx]
                    r = btn.geometry()
                    pad = 10
                    self._react_sel_outline.setGeometry(r.adjusted(-pad, -pad, pad, pad))
            except Exception:
                pass
        except Exception:
            pass

    def _close_actions_overlay(self):
        if hasattr(self, "_act_overlay"):
            self._act_overlay.hide()
        # Hide selection outline as well
        try:
            if hasattr(self, "_act_sel_outline"):
                self._act_sel_outline.hide()
        except Exception:
            pass

    def _reposition_actions_overlay(self):
        """Center actions overlay (large and horizontal) in the lower-middle of the viewport."""
        if not self._act_overlay.isVisible():
            return
        try:
            self._center_overlay(self._act_overlay)
            # Also reposition the selection outline to wrap the focused action button
            try:
                if self._act_sel_outline and self._act_sel_outline.isVisible() and self._act_buttons and self._act_focus_idx >= 0:
                    btn = self._act_buttons[self._act_focus_idx]
                    r = btn.geometry()
                    pad = 10
                    self._act_sel_outline.setGeometry(r.adjusted(-pad, -pad, pad, pad))
                    self._act_sel_outline.show()
            except Exception:
                pass
        except Exception:
            pass

    def _update_actions_focus(self):
        # No selection: clear highlights and hide outline
        if self._act_focus_idx is None or self._act_focus_idx < 0:
            for b in self._act_buttons:
                b.setProperty("focus", False)
                b.style().unpolish(b); b.style().polish(b)
            try:
                self._act_sel_outline.hide()
            except Exception:
                pass
            return
        for i, b in enumerate(self._act_buttons):
            b.setProperty("focus", i == self._act_focus_idx)
            b.style().unpolish(b); b.style().polish(b)
        # Draw visible outline around the focused action
        try:
            btn = self._act_buttons[self._act_focus_idx]
            r = btn.geometry()
            pad = 10
            self._act_sel_outline.setGeometry(r.adjusted(-pad, -pad, pad, pad))
            self._act_sel_outline.show()
        except Exception:
            try:
                self._act_sel_outline.hide()
            except Exception:
                pass

    def _actions_focus_next(self, backward=False):
        if not self._act_buttons:
            return
        if self._act_focus_idx < 0:
            # First press selects first/last
            self._act_focus_idx = (len(self._act_buttons) - 1) if backward else 0
        else:
            if backward:
                self._act_focus_idx = (self._act_focus_idx - 1) % len(self._act_buttons)
            else:
                self._act_focus_idx = (self._act_focus_idx + 1) % len(self._act_buttons)
        self._update_actions_focus()
        # speak current option
        try:
            self._speak(self._act_buttons[self._act_focus_idx].text())
        except Exception:
            pass

    def _on_action_button_clicked(self, idx: int):
        # Click from mouse: set focus to clicked index and activate it
        if idx < 0 or idx >= len(self._act_buttons):
            return
        self._act_focus_idx = idx
        self._update_actions_focus()
        self._activate_current_action()

    def _open_actions_for_message(self, idx):
        # build actions based on authorship; self messages: only "Read"
        if idx < 0 or idx >= len(self.block_msg_ids):
            return
        self._act_for_block_idx = idx
        self._act_for_msg_id = self.block_msg_ids[idx]

        # Determine if the message is from me
        from_me = False
        has_image = False
        has_video = False
        try:
            mid = self._act_for_msg_id
            ui = next((m for m in self.bridge.ui_messages.get(self.current_thread_id, []) if m.id == mid), None)
            from_me = bool(ui and ui.from_me)
            if ui:
                if ui.attachments:
                    has_image = any(a.get("type") == "image" for a in ui.attachments)
                    has_video = any(a.get("type") == "video" for a in ui.attachments)
                # Check for YouTube link
                if self._extract_youtube_url(ui.content):
                    has_video = True
        except Exception:
            pass

        # Clear previous buttons
        try:
            lay = self._act_overlay.layout()
            while lay.count():
                item = lay.takeAt(0)
                w = item.widget()
                if w is not None:
                    w.deleteLater()
        except Exception:
            pass
        self._act_buttons = []

        # Build actions
        actions = ["Read"]
        if has_image or has_video:
            actions.append("View")
        if not from_me:
            actions += ["Reply", "React"]

        try:
            lay = self._act_overlay.layout()
            # Clear previous buttons (ensure empty before adding)
            while lay.count():
                item = lay.takeAt(0)
                w = item.widget()
                if w is not None:
                    w.deleteLater()
            self._act_buttons = []

            for i, label in enumerate(actions):
                btn = QtWidgets.QPushButton(label, self._act_overlay)
                btn.setFocusPolicy(Qt.NoFocus)
                btn.clicked.connect(lambda _=False, j=i: self._on_action_button_clicked(j))
                lay.addWidget(btn)
                self._act_buttons.append(btn)
            # Start with nothing highlighted
            self._act_focus_idx = -1
            self._update_actions_focus()

            # Show and center
            self._act_overlay.show()
            self._act_overlay.raise_()
            self._reposition_actions_overlay()
            QtCore.QTimer.singleShot(0, self._reposition_actions_overlay)

            self._speak("Actions")
        except Exception:
            pass

    def _activate_current_action(self):
        if not self._act_buttons:
            return
        # If nothing is selected yet, do nothing on Enter
        if self._act_focus_idx is None or self._act_focus_idx < 0:
            return
        try:
            label = self._act_buttons[self._act_focus_idx].text().lower()
        except Exception:
            label = ""

        if label.startswith("read"):
            self._read_current_message_aloud()
            self._close_actions_overlay()
        elif label == "view":
            self._close_actions_overlay()
            self._view_media_fullscreen()
        elif label.startswith("reply"):
            self._close_actions_overlay()
            try:
                self._open_keyboard_and_reply(int(self._act_for_msg_id))
            except Exception:
                self._speak("Failed to send")
        elif label.startswith("react"):
            # Open reaction overlay centered in the same location as the actions menu
            try:
                # Capture current centered rect before closing
                same_rect = None
                try:
                    if hasattr(self, "_act_overlay") and self._act_overlay.isVisible():
                        same_rect = self._act_overlay.geometry()
                except Exception:
                    same_rect = None

                self._close_actions_overlay()

                self._react_for_block_idx = self._act_for_block_idx
                self._react_for_msg_id = self._act_for_msg_id
                # Start with nothing highlighted; first Space will select the first emoji
                self._react_focus_idx = -1
                self._update_react_focus()

                self._react_overlay.show()
                self._react_overlay.raise_()

                # Reuse the same rect if available; otherwise center
                if same_rect:
                    self._react_overlay.setGeometry(same_rect)
                    self._last_center_overlay_geom = same_rect
                else:
                    self._reposition_react_overlay()

                # Defer one more center after layout
                QtCore.QTimer.singleShot(0, self._reposition_react_overlay)

                self._speak("Reactions")
            except Exception:
                pass

    def _launch_chrome_with_control_bar(self, url: str, speak_text: str = "Opening browser"):
        self._speak(speak_text)
        
        # Minimize app
        if _WIN32_AVAILABLE and self._hwnd:
            try:
                self._set_topmost(False)
                win32gui.ShowWindow(self._hwnd, win32con.SW_MINIMIZE)
            except Exception:
                pass
        else:
            self.showMinimized()

        # Launch Chrome
        chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
        if not os.path.exists(chrome_path):
            chrome_path = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
        
        if os.path.exists(chrome_path):
            # Launch Chrome in kiosk mode with native URL (no embed conversion)
            # Add --remote-debugging-port=9222 for control_bar.py integration
            subprocess.Popen([chrome_path, "--new-window", "--kiosk", "--remote-debugging-port=9222", url])
            
            # Delayed sequence: Wait -> Fullscreen -> Launch Control Bar
            def _step3_launch_bar():
                base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                script_path = os.path.join(base_dir, "utils", "control_bar.py")
                if os.path.exists(script_path):
                    # Use CREATE_NO_WINDOW (0x08000000) to avoid a visible console window
                    subprocess.Popen(
                        [sys.executable, script_path, "--app-title", "Ben — Discord Mirror", "--cdp"],
                        creationflags=0x08000000
                    )
                else:
                    print(f"Control bar not found at {script_path}")

            def _step2_fullscreen():
                try:
                    # Try to send 'f' key
                    import pyautogui
                    pyautogui.press('f')
                except Exception:
                    pass
                    try:
                        if _WIN32_AVAILABLE:
                            win32api.keybd_event(0x46, 0, 0, 0) # F key down
                            win32api.keybd_event(0x46, 0, 2, 0) # F key up
                    except Exception:
                        pass
                
                # Launch Control Bar after fullscreen attempt
                QTimer.singleShot(1000, _step3_launch_bar)

            # Start the sequence: Wait 8 seconds for Chrome to load (increased from 5s)
            QTimer.singleShot(8000, _step2_fullscreen)

        else:
            # Fallback to default browser
            import webbrowser
            webbrowser.open(url)

    def _on_anchor_clicked(self, url: QtCore.QUrl):
        self._launch_chrome_with_control_bar(url.toString(), "Opening link")

    def _view_media_fullscreen(self):
        try:
            mid = self._act_for_msg_id
            ui = next((m for m in self.bridge.ui_messages.get(self.current_thread_id, []) if m.id == mid), None)
            if not ui:
                self._speak("Message not found")
                return

            # Check for video attachment first
            vid_att = next((a for a in (ui.attachments or []) if a.get("type") == "video"), None)
            yt_url = self._extract_youtube_url(ui.content)
            
            # 1. YouTube Link -> Play EXTERNAL (Chrome)
            # Prioritize YouTube URL even if it appears as an attachment (embed)
            if yt_url:
                self._launch_chrome_with_control_bar(yt_url, "Opening video")
                return

            # 2. Native Video Attachment (MP4, etc.) -> Download & Play EXTERNAL (Chrome)
            # QtWebEngine lacks proprietary codecs (H.264/AAC), so we must use Chrome.
            # Direct URL navigation in Chrome might fail if headers are needed, so we download first.
            if vid_att:
                url = vid_att.get("url")
                if not url:
                    self._speak("Invalid video URL")
                    return
                
                self._speak("Downloading video")
                req = QtNetwork.QNetworkRequest(QtCore.QUrl(url))
                reply = self.nam.get(req)
                reply.finished.connect(lambda: self._on_video_downloaded(reply, url))
                return

            # 3. Image Attachment -> View INSIDE app
            img_att = next((a for a in (ui.attachments or []) if a.get("type") == "image"), None)
            if img_att:
                url = img_att.get("url")
                if not url:
                    self._speak("No image found")
                    return

                self._speak("Loading image")
                self._img_overlay.setGeometry(self.view_msgs.viewport().rect())
                self._img_overlay.show()
                self._img_overlay.raise_()
                self._img_label.setText("Loading...")
                
                req = QtNetwork.QNetworkRequest(QtCore.QUrl(url))
                reply = self.nam.get(req)
                reply.finished.connect(lambda: self._on_image_downloaded(reply))
                return
            
            self._speak("No supported media found")
            
        except Exception:
            traceback.print_exc()
            self._speak("Error loading media")

    def _on_video_downloaded(self, reply, original_url):
        try:
            if reply.error() == QtNetwork.QNetworkReply.NoError:
                data = reply.readAll()
                # Determine extension
                ext = ".mp4"
                if ".mov" in original_url.lower(): ext = ".mov"
                elif ".mp3" in original_url.lower(): ext = ".mp3"
                elif ".webm" in original_url.lower(): ext = ".webm"
                elif ".mkv" in original_url.lower(): ext = ".mkv"
                
                # Save to temp file
                fd, path = tempfile.mkstemp(suffix=ext)
                with os.fdopen(fd, 'wb') as f:
                    f.write(data.data())
                
                # Launch Chrome with file URL
                file_url = QtCore.QUrl.fromLocalFile(path).toString()
                self._launch_chrome_with_control_bar(file_url, "Opening video")
            else:
                self._speak("Download failed")
            reply.deleteLater()
        except Exception:
            traceback.print_exc()
            self._speak("Error playing video")

    def _on_image_downloaded(self, reply):
        try:
            if reply.error() == QtNetwork.QNetworkReply.NoError:
                data = reply.readAll()
                pixmap = QtGui.QPixmap()
                pixmap.loadFromData(data)
                
                # Scale to fit screen
                vp = self.view_msgs.viewport().rect()
                scaled = pixmap.scaled(vp.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation)
                self._img_label.setPixmap(scaled)
                self._speak("Image loaded")
            else:
                self._img_label.setText("Failed to load image")
                self._speak("Failed to load image")
            reply.deleteLater()
        except Exception:
            pass

    def _close_image_overlay(self):
        if hasattr(self, "_img_overlay"):
            self._img_overlay.hide()
            self._img_label.clear()

    def _close_video_overlay(self):
        if hasattr(self, "_vid_overlay"):
            self._vid_overlay.hide()
            # Stop playback
            if self._media_player:
                self._media_player.stop()
            if self._web_view:
                self._web_view.setUrl(QtCore.QUrl("about:blank"))

    def eventFilter(self, obj, ev):
        try:
            if ev.type() == QtCore.QEvent.KeyPress and isinstance(ev, QtGui.QKeyEvent):
                if ev.isAutoRepeat():
                    return True
                now_ms = int(time.time() * 1000)

                if ev.key() == Qt.Key_Space:
                    # respect cooldown and avoid re-entry
                    if now_ms < self._space_cooldown_until or self.space_down:
                        return True
                    self.space_down = True
                    self.space_at = time.time()
                    self._space_hold_started = False
                    self._space_hold_active = False
                    try:
                        self._space_hold_arm.start()
                    except Exception:
                        pass
                    return True

                if ev.key() in (Qt.Key_Return, Qt.Key_Enter):
                    # respect cooldown and avoid re-entry
                    if now_ms < self._enter_cooldown_until or self.enter_down:
                        return True

                    # NEW: Close image overlay if open
                    if hasattr(self, "_img_overlay") and self._img_overlay.isVisible():
                        self._close_image_overlay()
                        self._speak("Closed image")
                        # Reset cooldown and mark as handled to prevent menu opening
                        self.enter_down = True
                        self.enter_at = time.time()
                        self._enter_hold_fired = True  # Treat as consumed so KeyRelease doesn't fire short action
                        self._enter_cooldown_until = now_ms + self._input_cooldown_ms
                        return True

                    # NEW: Close video overlay if open
                    if hasattr(self, "_vid_overlay") and self._vid_overlay.isVisible():
                        self._close_video_overlay()
                        self._speak("Closed video")
                        # Reset cooldown and mark as handled
                        self.enter_down = True
                        self.enter_at = time.time()
                        self._enter_hold_fired = True
                        self._enter_cooldown_until = now_ms + self._input_cooldown_ms
                        return True
                    self.enter_down = True
                    self.enter_at = time.time()
                    self._enter_hold_fired = False
                    try:
                        self._enter_hold_arm.start()
                    except Exception:
                        pass
                    return True

            if ev.type() == QtCore.QEvent.KeyRelease and isinstance(ev, QtGui.QKeyEvent):
                if ev.isAutoRepeat():
                    return True
                now_ms = int(time.time() * 1000)

                if ev.key() == Qt.Key_Space:
                    if not self.space_down:
                        return True
                    # snapshot whether a long-hold was active BEFORE stopping timers
                    was_hold = bool(self._space_hold_started or self._space_hold_active)
                    self._stop_space_hold()
                    self.space_down = False
                    # If long-hold did NOT fire, treat as short press; otherwise do nothing
                    if not was_hold:
                        try:
                            self._on_space_short()
                        except Exception:
                            pass
                    # reset hold-started flag and set cooldown
                    self._space_hold_started = False
                    self._space_cooldown_until = now_ms + self._input_cooldown_ms
                    return True

                if ev.key() in (Qt.Key_Return, Qt.Key_Enter):
                    if not self.enter_down:
                        return True
                    try:
                        self._enter_hold_arm.stop()
                    except Exception:
                        pass
                    self.enter_down = False
                    # If long-hold didn't fire, do short action
                    if not self._enter_hold_fired:
                        try:
                            self._on_enter_short()
                        except Exception:
                            pass
                    # reset long-hold flag and set cooldown
                    self._enter_hold_fired = False
                    self._enter_cooldown_until = now_ms + self._input_cooldown_ms
                    return True
        except Exception:
            pass
        return super().eventFilter(obj, ev)

    def _fmt_12h(self, ts: float) -> str:
        dt = datetime.fromtimestamp(ts)
        h = dt.hour % 12 or 12
        return f"{h}:{dt.minute:02d} {'AM' if dt.hour < 12 else 'PM'}"

    def _sanitize_tts(self, text: str) -> str:
        if not text:
            return ""
        url_pat = re.compile(r'(https?://\S+|www\.\S+|\b[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\S*)')
        s = url_pat.sub(" link ", text)
        s = re.sub(r'\s+', ' ', s).strip()
        return s

    def _speak(self, text: str):
        if hasattr(self, '_tts_worker'):
            self._tts_worker.say.emit(self._sanitize_tts(text))

    def _tts_stop(self):
        try:
            if hasattr(self, '_tts_worker'):
                self._tts_worker.halt.emit()
        except Exception:
            pass

    def _load_read_state(self):
        try:
            with open(self._read_state_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            ids = data.get("read_ids", [])
            self.read_ids = {int(i) for i in ids if isinstance(i, (int, str))}
            # NEW: load last seen timestamp (default 0.0 for first run)
            try:
                self._last_seen_ts = float(data.get("last_seen_ts", 0.0) or 0.0)
            except Exception:
                self._last_seen_ts = 0.0
        except Exception:
            self.read_ids = set()
            # keep default last_seen_ts=0.0

    def _save_read_state(self):
        try:
            tmp = self._read_state_path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                # NEW: persist last_seen_ts alongside read_ids
                json.dump({"read_ids": sorted(self.read_ids), "last_seen_ts": self._last_seen_ts}, f)
            os.replace(tmp, self._read_state_path)
        except Exception:
            pass

    def _mark_read(self, msg_id: int):
        if msg_id not in self.read_ids:
            self.read_ids.add(msg_id)
            self.unread_ids.discard(msg_id)
            self._save_read_state()
            self._refresh_threads()

    def _on_channel_ready(self, ch):
        self._refresh_threads()
        self._render_thread("main")
        # NEW: compute offline unreads now that main channel is ready
        try:
            self._label_offline_unreads()
        except Exception:
            pass

    def _on_status(self, s: str):
        print(s)
        self.label_info.setText(s or "")

    def _on_warm_complete(self):
        self._suppress_incoming_dm_tts = False
        self._label_offline_unreads()
        self._during_warmload = False

        # Fast path: fetch only the most recent DM messages so the list turns green quickly
        try:
            recent = int(S("DM_INITIAL_LIMIT", 10))
            for uid_str in list((self.bridge.dm_threads or {}).keys()):
                tid = f"dm:{uid_str}"
                self.bridge.fetch_recent_dm(tid, recent=recent)
        except Exception:
            pass

    # NEW: compute unread for messages received while app was not running
    def _label_offline_unreads(self):
        try:
            if self._last_seen_ts <= 0:
                # First run or no prior session recorded; don't mark everything unread
                return
            for tid, msgs in (self.bridge.ui_messages or {}).items():
                for ui in msgs:
                    if (not ui.from_me) and (ui.id not in self.read_ids) and (ui.ts > self._last_seen_ts):
                        self.unread_ids.add(ui.id)
            # Refresh list and current thread to apply green coloring
            self._refresh_threads()
            try:
                self._render_thread(self.current_thread_id)
            except Exception:
                pass
        except Exception:
            pass

    def closeEvent(self, e):
        # NEW: record last seen time for next session before shutting down
        try:
            self._last_seen_ts = time.time()
            self._save_read_state()
        except Exception:
            pass
        try:
            self._focus_timer.stop()
        except:
            pass
        try:
            self.bridge.stop()
        except Exception:
            pass
        try:
            self._tts_stop()
            if hasattr(self, '_tts_thread') and self._tts_thread.isRunning():
                self._tts_thread.quit()
                self._tts_thread.wait(2000)
        except Exception:
            pass
        try:
            QtWidgets.QApplication.instance().removeEventFilter(self)
        except Exception:
            pass

        # Stop heartbeat and clear the lock before closing
        try:
            if hasattr(self, "_hb_timer"):
                self._hb_timer.stop()
            self._clear_heartbeat()
        except Exception:
            pass

        super().closeEvent(e)

    def _read_current_message_aloud(self):
        """Speak only the message content, ignoring username/time and URLs.""" 
        try:
            mid = self._act_for_msg_id
            ui = next((m for m in self.bridge.ui_messages.get(self.current_thread_id, []) if m.id == mid), None)
            if not ui:
                return
            body = self._sanitize_tts(ui.content or "")
            self._speak(body if body else "No text")
            self._mark_read(ui.id)
        except Exception:
            pass

    def _open_keyboard_and_reply(self, message_id: int):
        txt = self._keyboard_exec_and_get_text("Reply")
        if not txt:
            self._speak("Canceled")
            return
        try:
            self.bridge.send_reply(self.current_thread_id, int(message_id), txt)
            self._speak("Replied")
        except Exception:
            self._speak("Failed to send")

    def _scroll_messages_to_bottom(self):
        """Reliably scroll the messages view all the way to the bottom.""" 
        try:
            # Move cursor to end and ensure visible
            cur = self.view_msgs.textCursor()
            cur.movePosition(QtGui.QTextCursor.End)
            self.view_msgs.setTextCursor(cur)
            self.view_msgs.ensureCursorVisible()
            # Also force the scrollbar to its maximum (with a deferred pass)
            sb = self.view_msgs.verticalScrollBar()
            sb.setValue(sb.maximum())
            QtCore.QTimer.singleShot(0, lambda: sb.setValue(sb.maximum()))
        except Exception:
            pass

    def _ensure_image_resource(self, url: str):
        if not url or url in self._downloaded_images:
            return
        self._downloaded_images.add(url)
        try:
            req = QtNetwork.QNetworkRequest(QtCore.QUrl(url))
            reply = self.nam.get(req)
            reply.finished.connect(lambda: self._on_thumb_downloaded(url, reply))
        except Exception:
            pass

    def _on_thumb_downloaded(self, url: str, reply):
        try:
            if reply.error() == QtNetwork.QNetworkReply.NoError:
                data = reply.readAll()
                img = QtGui.QImage()
                img.loadFromData(data)
                if not img.isNull():
                    # Scale for thumbnail (max 400px width)
                    if img.width() > 400:
                        img = img.scaledToWidth(400, Qt.SmoothTransformation)
                    
                    self.view_msgs.document().addResource(
                        QtGui.QTextDocument.ImageResource,
                        QtCore.QUrl(url),
                        img
                    )
                    # Force refresh of the view
                    self.view_msgs.setLineWrapColumnOrWidth(self.view_msgs.lineWrapColumnOrWidth())
            reply.deleteLater()
        except Exception:
            pass

    def _extract_youtube_url(self, text: str) -> Optional[str]:
        """Extract the first YouTube URL from text."""
        if not text:
            return None
        # Basic regex for youtube.com/watch?v=ID, youtube.com/shorts/ID and youtu.be/ID (optional protocol)
        import re
        match = re.search(r"((?:https?://)?(?:www\.)?(?:youtube\.com/(?:watch\?v=|shorts/)|youtu\.be/)([\w-]+))", text)
        if match:
            url = match.group(1)
            # Ensure protocol if missing
            if not url.startswith("http"):
                url = "https://" + url
            return url
        return None

    def _append_message(self, ui):
        """Append one message as a single large block; unread text in green.""" 
        # Prevent duplicate rendering of the same message in the current view
        try:
            if ui.id in self.block_msg_ids:
                return
        except Exception:
            pass
        try:
            # NEW: Attachments (Images & Videos)
            attachments_html = ""
            
            # Check for embedded YouTube link in content
            yt_url = self._extract_youtube_url(ui.content)
            if yt_url:
                attachments_html += (
                    "&nbsp;<span style='display:inline-block; vertical-align:middle; margin-left:8px; padding:4px 16px; "
                    "background:#202225; border-radius:10px; border:2px solid #FF0000; color:#FF0000; "
                    "font-size:32px; font-weight:bold;'>🎥 YOUTUBE</span>"
                )

            if ui.attachments:
                for att in ui.attachments:
                    if att.get("type") == "image":
                        # Placeholder for image (inline)
                        attachments_html += (
                            "&nbsp;<span style='display:inline-block; vertical-align:middle; margin-left:8px; padding:4px 16px; "
                            "background:#202225; border-radius:10px; border:2px solid #79c0ff; color:#79c0ff; "
                            "font-size:32px; font-weight:bold;'>📷 IMAGE</span>"
                        )
                    elif att.get("type") == "video":
                        # Placeholder for video (inline)
                        attachments_html += (
                            "&nbsp;<span style='display:inline-block; vertical-align:middle; margin-left:8px; padding:4px 16px; "
                            "background:#202225; border-radius:10px; border:2px solid #FFD64D; color:#FFD64D; "
                            "font-size:32px; font-weight:bold;'>🎥 VIDEO</span>"
                        )

            esc_author = (ui.author or "").replace("<","&lt;").replace(">","&gt;")
            body_raw = (ui.content or "")
            esc_body = body_raw.replace("<","&lt;").replace(">","&gt;")
            # Linkify URLs
            esc_body = re.sub(r'(https?://[^\s]+)', r'<a href="\1" style="color:#79c0ff; text-decoration:underline;">\1</a>', esc_body)
            esc_body = esc_body.replace("\n","<br>")
            
            # If empty body but has attachments, don't show [no text], just show attachments
            if not esc_body.strip():
                if attachments_html:
                    esc_body = ""
                else:
                    esc_body = "[no text]"
            
            tm = self._fmt_12h(ui.ts)

            # unread green, read white
            is_unread = ui.id in self.unread_ids
            text_color = "#00ff1a" if is_unread else "#e9eef5"

            # Inline reactions under the message (same paragraph/block)
            reactions_html = self._reaction_badges_html(ui.id)

            html_block = (
                "<p style='margin: 14px 0; padding: 22px 26px; border-radius: 14px; "
                "background:#0f1521; font-size: 48px; line-height: 1.5;'>"
                f"<span style='font-weight:800; color:#e9eef5;'>{esc_author}</span> "
                f"<span style='color:#cfd7e3; font-weight:600;'>({tm})</span>"
                f"<br><span style='color:{text_color};'>{esc_body}{attachments_html}</span>"
                f"{reactions_html}"
                "</p>"
            )
            self.view_msgs.append(html_block)
            self.block_msg_ids.append(ui.id)

            # keep scrolled to latest only when not actively scanning messages
            try:
                sb = self.view_msgs.verticalScrollBar()
                if self.scan_mode != "messages":
                    if sb.value() >= sb.maximum() - 10:
                        sb.setValue(sb.maximum())
            except Exception:
                pass
        except Exception:
            pass

    def _reaction_badges_html(self, message_id: int) -> str:
        """
        Build small inline chips showing reactions for a message.
        Kept inline within the same paragraph so scanning remains one row per message.
        """
        try:
            data = self.bridge.ui_reactions.get(message_id) or []
            if not data:
                return ""
            chips = []
            # Inline chip style (no block/flex)
            chip_css = (
                "display:inline-block; vertical-align:middle; "
                "padding:2px 10px; margin:8px 6px 0 0; border-radius:12px; "
                "background:rgba(233,238,245,0.08); color:#cfd7e3; "
                "border:1px solid rgba(233,238,245,0.16); font-size:22px;"
            )
            for r in data:
                count = int(r.get("count", 1) or 1)
                if r.get("emoji"):
                    # unicode emoji
                    em = r.get("emoji")
                    chips.append(f"<span style='{chip_css}'>{em} {count}</span>")
                else:
                    # custom emoji (render image if we have a URL)
                    name = (r.get("name") or "emoji")
                    url = r.get("url") or ""
                    if url:
                        chips.append(
                            f"<span style='{chip_css}'>"
                            f"<img src='{url}' alt='{name}' style='height:1.2em; vertical-align:middle;'/> {count}"
                            f"</span>"
                        )
                    else:
                        chips.append(f"<span style='{chip_css}'>{name} {count}</span>")
            # Single line-break to keep chips inside same paragraph block, under header
            return "<br>" + "".join(chips)
        except Exception:
            return ""

    def _thread_header_text(self, tid: str) -> str:
        """Human-friendly title for the thread header.""" 
        if tid == "main":
            try:
                if self.bridge.main_channel:
                    return f"#{self.bridge.main_channel.name}"
            except Exception:
                pass
            return "Main"
        # NEW: Handle additional channels with "channel:<id>" format
        if tid.startswith("channel:"):
            try:
                chan_id = int(tid.split(":", 1)[1])
                ch = self.bridge.channels.get(chan_id)
                if ch and hasattr(ch, "name"):
                    return f"#{ch.name}"
            except Exception:
                pass
            return f"Channel {tid.split(':', 1)[1] if ':' in tid else tid}"
        if tid.startswith("dm:"):
            try:
                uid = int(tid.split(":", 1)[1])
                name = self.bridge.display_for_user_id(uid, "DM")
                return f"DM — {name}"
            except Exception:
                return "DM"
        return tid

    # Launch narbe_keyboard_send.py and return captured text
    def _keyboard_exec_and_get_text(self, title: str) -> Optional[str]:
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            kb_path = os.path.join(script_dir, "narbe_keyboard_send.py")
            if not os.path.exists(kb_path):
                self._speak("Keyboard not found")
                return None

            out_path = os.path.join(tempfile.gettempdir(), f"narbi_out_{int(time.time())}.json")

            # Stop any ongoing TTS before handing focus away
            self._tts_stop()

            # Mark keyboard active and let it take focus
            self._keyboard_active = True
            if _WIN32_AVAILABLE and self._hwnd:
                # Drop always-on-top and minimize so the keyboard can appear above
                self._set_topmost(False)
                try:
                    win32gui.ShowWindow(self._hwnd, win32con.SW_MINIMIZE)
                except Exception:
                    pass

            # pass --out as required by the script
            p = subprocess.Popen([sys.executable, kb_path, "--out", out_path], cwd=script_dir)

            # Try to give focus to the keyboard window
            if _WIN32_AVAILABLE:
                # small delay to allow the keyboard window to be created, then focus it
                time.sleep(0.15)
                self._focus_pid_window(p.pid, timeout_ms=3000)

            # Block until the keyboard closes
            p.wait()

            # Keyboard closed, restore our window and focus
            self._keyboard_active = False
            if _WIN32_AVAILABLE and self._hwnd:
                try:
                    win32gui.ShowWindow(self._hwnd, win32con.SW_RESTORE)
                except Exception:
                    pass
                # Restore topmost and focus to our app
                self._force_focus()
                # Re-init TTS shortly after focus returns to fix post-keyboard silence
                QtCore.QTimer.singleShot(150, self._reset_tts_engine)
                # Do a second delayed reset to handle late audio device handoff
                QtCore.QTimer.singleShot(800, self._reset_tts_engine)

            if not os.path.exists(out_path):
                return None
            with open(out_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            try:
                os.remove(out_path)
            except Exception:
                pass
            txt = (data or {}).get("text", "")
            return txt.strip() or None
        except Exception:
            # Ensure flag resets if anything failed
            self._keyboard_active = False
            return None

    def _open_keyboard_and_send(self):
        txt = self._keyboard_exec_and_get_text("Send Message")
        if not txt:
            self._speak("Canceled")
            return
        try:
            self.bridge.send_text(self.current_thread_id, txt)
            self._speak("Sent")
        except Exception:
            self._speak("Failed to send")

    def _on_exit_clicked(self):
        # Launch comm-v10.py before closing
        try:
            root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
            comm = os.path.join(root, "comm-v10.py")
            if (os.path.exists(comm)):
                try:
                    DETACHED_PROCESS = 0x00000008
                    CREATE_NEW_PROCESS_GROUP = 0x00000200
                    subprocess.Popen(
                        [sys.executable, comm],
                        cwd=root,
                        creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
                        close_fds=True
                    )
                except Exception:
                    subprocess.Popen([sys.executable, comm], cwd=root)
        except Exception:
            pass
        # Then close this app
        self.close()

    def _reset_tts_engine(self):
        """Reinitialize pyttsx3 engine after external focus changes.""" 
        try:
            if hasattr(self, "_tts_worker") and self._tts_worker:
                self._tts_worker.reset.emit()
        except Exception:
            pass

    def _refresh_threads(self):
        """Rebuild the Channels & DMs list from the bridge state (unread first).""" 
        if not hasattr(self, "list_threads"):
            return

        # Preserve current selection by thread id while refreshing
        preserve_tid = None
        prev_row = -1
        try:
            it = self.list_threads.currentItem()
            if it:
                preserve_tid = it.data(Qt.UserRole)
                prev_row = self.list_threads.currentRow()
            elif self.scan_mode == "channels" and self.channel_scan_row >= 0:
                it2 = self.list_threads.item(self.channel_scan_row)
                if it2:
                    preserve_tid = it2.data(Qt.UserRole)
        except Exception:
            preserve_tid = None

        self.list_threads.clear()

        entries = []

        # NEW: Add ALL channels from channel_ids
        for chan_id in self.bridge.channel_ids:
            ch = self.bridge.channels.get(chan_id)
            if chan_id == self.bridge.chan_id:
                tid = "main"
                ch_name = f"#{ch.name}" if ch else "Channel"
            else:
                tid = f"channel:{chan_id}"
                ch_name = f"#{ch.name}" if ch else f"Channel {chan_id}"
            
            has_unread = any(
                (m.id in self.unread_ids) and (not m.from_me)
                for m in self.bridge.ui_messages.get(tid, [])
            )
            entries.append({
                "tid": tid,
                "label": ch_name,
                "is_channel": True,
                "is_main": (chan_id == self.bridge.chan_id),
                "has_unread": has_unread,
            })

        # DMs
        try:
            my_id = None
            try:
                my_id = getattr(getattr(self.bridge, "client", None), "user", None)
                my_id = getattr(my_id, "id", None)
            except Exception:
                my_id = None

            for uid_str, user in (self.bridge.dm_threads or {}).items():
                # hide self-DM thread if it exists
                try:
                    if my_id is not None and str(uid_str) == str(my_id):
                        continue
                except Exception:
                    pass

                tid = f"dm:{uid_str}"
                try:
                    uid_int = int(uid_str)
                except Exception:
                    uid_int = None
                base = getattr(user, "global_name", None) or getattr(user, "name", "user")
                label = self.bridge.display_for_user_id(uid_int, base) if uid_int is not None else base
                has_unread = any(
                    (m.id in self.unread_ids) and (not m.from_me)
                    for m in self.bridge.ui_messages.get(tid, [])
                )
                entries.append({
                    "tid": tid,
                    "label": label,
                    "is_channel": False,
                    "is_main": False,
                    "has_unread": has_unread,
                })
        except Exception:
            pass

        # sort: unread first, then channels first (main channel first among channels), then DMs
        unread = [e for e in entries if e["has_unread"]]
        read = [e for e in entries if not e["has_unread"]]
        # Within read: channels first (main first), then DMs
        read.sort(key=lambda e: (0 if e["is_channel"] else 1, 0 if e.get("is_main") else 1))
        ordered = unread + read

        for e in ordered:
            it = QtWidgets.QListWidgetItem(e["label"])
            it.setData(Qt.UserRole, e["tid"])
            it.setData(Qt.UserRole + 1, 1 if e["has_unread"] else 0)
            self.list_threads.addItem(it)

        # Restore selection if we were scanning channels
        if preserve_tid and self.list_threads.count() > 0:
            try:
                for i in range(self.list_threads.count()):
                    it = self.list_threads.item(i)
                    if it and it.data(Qt.UserRole) == preserve_tid:
                        self.list_threads.setCurrentRow(i)
                        it.setSelected(True)
                        self.channel_scan_row = i
                        break
            except Exception:
                pass
        else:
            # Only clear selection if not in channel scan mode
            if self.scan_mode != "channels":
                self.list_threads.setCurrentRow(-1)

    def _render_thread(self, tid: str):
        """Render all messages for the given thread (one paragraph per message)."""
        # Update title
        self.label_thread_title.setText(self._thread_header_text(tid))

        # Optional: backfill a small DM batch on first render
        if tid.startswith("dm:") and bool(S("ENABLE_RENDER_DM_BACKFILL", False)):
            try:
                have = len(self.bridge.ui_messages.get(tid, []) or [])
                want = have + int(S("DM_BACKFILL_BATCH", 10))
                self.bridge.ensure_dm_history(tid, desired=want)
            except Exception:
                pass

        # Clear view and block map
        self.view_msgs.clear()
        self.block_msg_ids = []

        # Append existing messages in chronological order as large blocks
        msgs_all = sorted(self.bridge.ui_messages.get(tid, []), key=lambda x: x.ts)
        # NEW: defensively dedupe by ID before rendering
        try:
            uniq = []
            _seen_local = set()
            for _m in msgs_all:
                if _m.id in _seen_local:
                    continue
                _seen_local.add(_m.id)
                uniq.append(_m)
            msgs_all = uniq
        except Exception:
            pass
        limit = int(S("DM_RENDER_LIMIT" if tid.startswith("dm:") else "CHANNEL_RENDER_LIMIT", 25))
        msgs = msgs_all[-limit:] if limit and len(msgs_all) > limit else msgs_all
        for m in msgs:
            self._append_message(m)

        # Scroll to bottom
        try:
            sb = self.view_msgs.verticalScrollBar()
            sb.setValue(sb.maximum())
        except Exception:
            pass

    def _on_reactions_updated(self, thread_id: str, message_id):
        # Re-render current thread to refresh inline reaction chips
        if thread_id == self.current_thread_id:
            self._render_thread(self.current_thread_id)

    def _on_history_extended(self, tid: str):
        # When older history loads for the visible DM, re-render
        if tid == self.current_thread_id:
            self._render_thread(tid)
        # NEW: each time history is extended (for any DM), recompute offline unreads and refresh list
        try:
            self._label_offline_unreads()
        except Exception:
            pass

    def _on_message_added(self, thread_id: str, ui):
        # During warm-load, don't mark unread; offline unreads are computed after warm completes.
        try:
            if (not self._during_warmload) and (not ui.from_me) and (ui.id not in self.read_ids):
                self.unread_ids.add(ui.id)
        except Exception:
            pass
        # Speak DMs and Channel messages only after warm-load suppression is lifted
        try:
            if not self._suppress_incoming_dm_tts:
                if thread_id.startswith("dm:"):
                    self._speak(f"DM from {ui.author}: {ui.content}")
                elif thread_id == "main" or thread_id.startswith("channel:"):
                    # Also speak channel messages
                    self._speak(f"New Message from {ui.author}: {ui.content}")
        except Exception:
            pass
        # If the current thread is visible, append immediately
        try:
            if thread_id == self.current_thread_id:
                self._append_message(ui)
        except Exception:
            pass
        # Update channel/DM list highlighting
        self._refresh_threads()

    # Helper to force selection highlight on a given row
    def _select_list_row(self, row: int):
        try:
            if row < 0 or row >= self.list_threads.count():
                return
            # Set as current, then explicitly select this item and clear others
            self.list_threads.setCurrentRow(row)
            self.list_threads.blockSignals(True)
            self.list_threads.clearSelection()
            it = self.list_threads.item(row)
            if it:
                it.setSelected(True)
            self.list_threads.blockSignals(False)
        except Exception:
            pass

    def _write_heartbeat(self):
        try:
            with open(HEARTBEAT_PATH, "w", encoding="utf-8") as f:
                f.write(str(time.time()))
        except Exception:
            pass

    def _clear_heartbeat(self):
        try:
            if os.path.exists(HEARTBEAT_PATH):
                os.remove(HEARTBEAT_PATH)
        except Exception:
            pass

    def _space_hold_tick(self):
        if not getattr(self, "_space_hold_active", False):
            return
        # Long-hold Space: always take a single backward step based on current context
        try:
            self._space_back_step()
        except Exception:
            pass

    def _arm_space_hold(self):
        # Begin repeating long-hold (works in all modes, including overlays)
        if not self.space_down:
            return
        self._space_hold_started = True  # NEW: mark that long-hold engaged
        self._space_hold_active = True
        self._space_hold_timer.start()
        # Immediate first step, then continue every SPACE_REPEAT_MS
        self._space_hold_tick()

    def _stop_space_hold(self):
        self._space_hold_active = False
        try:
            self._space_hold_timer.stop()
        except Exception:
            pass
        try:
            self._space_hold_arm.stop()
        except Exception:
            pass

    def _arm_enter_hold(self):
        # Delegate to existing long-hold handler
        try:
            if not self.enter_down:
                return
            self._enter_hold_fired = True  # mark as long-hold consumed
            self._maybe_enter_hold()
        except Exception:
            pass

# ---------- main ----------
def main():
    # Prefer config.json (in the same directory) with env variables as overrides
    cfg_path = os.path.join(os.path.dirname(__file__), "config.json")
    cfg = {}
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        cfg = {}

    def get_cfg(name: str, default: str = "") -> str:
        # env var overrides config.json
        return os.environ.get(name, str(cfg.get(name, default)))

    token = get_cfg("DISCORD_TOKEN", "").strip()
    guild_id = int(get_cfg("GUILD_ID", "0") or 0)
    channel_id = int(get_cfg("CHANNEL_ID", "0") or 0)
    
    # NEW: support CHANNEL_IDS array for multiple channels
    channel_ids = []
    try:
        raw_ids = cfg.get("CHANNEL_IDS", [])
        if isinstance(raw_ids, list):
            channel_ids = [int(cid) for cid in raw_ids if cid]
    except Exception:
        channel_ids = []
    # Fallback: if no CHANNEL_IDS, use single CHANNEL_ID
    if not channel_ids and channel_id:
        channel_ids = [channel_id]
    
    # Accept alternate JSON keys for the bridge channel id
    dm_bridge_str = (
        get_cfg("DM_BRIDGE_CHANNEL_ID", "") or
        get_cfg("DM_Bridge_channel_id", "") or
        get_cfg("dm_bridge_channel_id", "")
    )
    dm_bridge_id = int(dm_bridge_str or 0)

    # Allow dm_bridge_id to be optional
    if not token or not guild_id or not channel_ids:
        print(f"Provide DISCORD_TOKEN, GUILD_ID, CHANNEL_ID or CHANNEL_IDS in {cfg_path} or environment.")
        sys.exit(1)

    app = QtWidgets.QApplication(sys.argv)
    bridge = DiscordBridge(token, guild_id, channel_ids[0] if channel_ids else 0, dm_bridge_id, channel_ids=channel_ids)
    ui = BenDiscordUI(bridge)
    ui.show()
    bridge.start()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()