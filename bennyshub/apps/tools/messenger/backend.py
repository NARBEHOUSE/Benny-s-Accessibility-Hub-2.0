# -*- coding: utf-8 -*-
# backend.py — Headless Discord backend for the new HTML5 messenger.
#
# This is a faithful, Qt-free port of the DiscordBridge from ben_discord_app.py.
# It runs the discord.py client in an asyncio loop and exposes the same data and
# operations over a local WebSocket so an Electron/HTML5 frontend can drive the UI.
#
# Config (config.json in this folder, env vars override):
#   DISCORD_TOKEN, GUILD_ID, CHANNEL_IDS [..], DM_BRIDGE_CHANNEL_ID
#
# WebSocket: ws://127.0.0.1:8777  (override with NEW_MSG_WS_PORT)
#
# Protocol (JSON text frames):
#   Client -> Server:
#     {"type":"get_state"}
#     {"type":"select_thread","tid": "..."}
#     {"type":"send_text","tid":"...","text":"..."}
#     {"type":"send_reply","tid":"...","message_id":123,"text":"..."}
#     {"type":"react","tid":"...","message_id":123,"emoji":"👍"}
#     {"type":"load_history","tid":"...","desired":500}
#     {"type":"mark_read","tid":"...","ids":[...]}     # optional persistence
#     {"type":"write_keyboard_context","tid":"..."}    # write keyboard_context.json
#   Server -> Client:
#     {"type":"status","text":"..."}
#     {"type":"state","threads":[...],"messages":{tid:[...]},"reactions":{id:[...]},
#       "me": {...}, "message_content_available": bool}
#     {"type":"threads","threads":[...]}
#     {"type":"message_added","tid":"...","message":{...}}
#     {"type":"reactions_updated","tid":"...","message_id":123,"reactions":[...]}
#     {"type":"reaction_tts","text":"..."}
#     {"type":"history_extended","tid":"...","messages":[...]}
#     {"type":"warm_complete"}

import os, sys, json, asyncio, threading, re, time
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Any

import discord
import websockets

APP_DIR = os.path.dirname(os.path.abspath(__file__))

# ---------------- Settings ----------------
SETTINGS_PATH = os.path.join(APP_DIR, "messenger_settings.json")
SETTINGS = {
    "CHANNEL_INITIAL_LIMIT": 25,
    "DM_INITIAL_LIMIT": 10,
    "CHANNEL_RENDER_LIMIT": 25,
    "DM_RENDER_LIMIT": 10,
    "CHANNEL_BACKFILL_BATCH": 20,
    "DM_BACKFILL_BATCH": 10,
    "ENABLE_SCROLL_BACKFILL": True,
    "ENABLE_RENDER_DM_BACKFILL": False,
    "FOCUS_ANCHOR_RATIO": 0.5,
}
try:
    with open(SETTINGS_PATH, "r", encoding="utf-8") as _sf:
        SETTINGS.update(json.load(_sf))
except Exception:
    pass


def S(key, default=None):
    return SETTINGS.get(key, default)


# ---------------- Data model ----------------
@dataclass
class UiMessage:
    id: int
    author: str
    content: str
    ts: float
    from_me: bool = False
    attachments: Optional[List[Dict[str, Any]]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        # JSON-safe: ids are large; keep as int (JS handles up to 2^53, Discord ids fit in string better)
        d["id"] = str(self.id)
        return d


# ---------------- Discord backend ----------------
class DiscordBackend:
    """Headless port of DiscordBridge. Emits events via an injected callback."""

    def __init__(self, token, guild_id, chan_id, dm_bridge_chan_id, channel_ids=None, emit=None):
        self.token = token
        self.guild_id = guild_id
        self.chan_id = chan_id
        self.dm_bridge_chan_id = dm_bridge_chan_id
        self.channel_ids: List[int] = channel_ids or ([chan_id] if chan_id else [])
        self.client: Optional[discord.Client] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.thread: Optional[threading.Thread] = None
        self._emit = emit or (lambda evt: None)

        self.main_channel: Optional[discord.TextChannel] = None
        self.channels: Dict[int, discord.TextChannel] = {}
        self.dm_threads: Dict[str, Any] = {}
        self.ui_messages: Dict[str, List[UiMessage]] = {"main": []}
        self._stopping = False
        self.message_content_available = True
        self.dm_index_path = os.path.join(APP_DIR, "dm_index.json")
        self._dm_index: Dict[str, str] = {}
        self.guild: Optional[discord.Guild] = None
        self._name_cache: Dict[int, str] = {}
        self.ui_reactions: Dict[int, List[Dict[str, Any]]] = {}
        self._dm_history_loading: set = set()
        self._seen_ids: set = set()
        self._warm_done = False
        # Latest *incoming* (not from_me) message timestamp per thread. Used so
        # the UI can highlight DMs/channels with new activity even before their
        # full message history has been loaded.
        self._thread_last_ts: Dict[str, float] = {}

    def _mark_incoming(self, tid: str, ts: float):
        try:
            if ts and ts > self._thread_last_ts.get(tid, 0):
                self._thread_last_ts[tid] = float(ts)
        except Exception:
            pass

    # ----- event emission helper (thread-safe, schedules on emit thread) -----
    def emit(self, evt: Dict[str, Any]):
        try:
            self._emit(evt)
        except Exception:
            pass

    # ----- lifecycle -----
    def start(self):
        self.thread = threading.Thread(target=self._runner, daemon=True)
        self.thread.start()

    def stop(self):
        self._stopping = True
        try:
            if self.loop:
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

    # ----- handlers -----
    def _setup_handlers(self):
        @self.client.event
        async def on_ready():
            self.emit({"type": "status", "text": f"Logged in as {self.client.user}"})
            guild = self.client.get_guild(self.guild_id)
            self.guild = guild
            if not guild:
                self.emit({"type": "status", "text": "Guild not found (continuing — DMs can still load)"})

            if guild:
                for chan_id in self.channel_ids:
                    ch = guild.get_channel(chan_id)
                    if isinstance(ch, discord.TextChannel):
                        self.channels[chan_id] = ch
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
                            if not ui.from_me:
                                self._mark_incoming(tid, ui.ts)
                            try:
                                self.ui_reactions[m.id] = self._build_ui_reactions(m)
                            except Exception:
                                self.ui_reactions[m.id] = []
                        # Push this channel's history to the UI as soon as it's
                        # loaded so the list fills in progressively instead of
                        # waiting for the entire warm-load to finish.
                        self._emit_threads()
                        self._emit_history(tid)
                    else:
                        self.emit({"type": "status", "text": f"Channel {chan_id} not found or invalid"})

            # DM bridge warm load -> index only
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
                    self._emit_threads()
                except Exception:
                    pass

            # Existing open DM channels: index only
            try:
                for dm in list(getattr(self.client, "private_channels", []) or []):
                    try:
                        if isinstance(dm, discord.DMChannel):
                            u = getattr(dm, "recipient", None)
                            if not u:
                                continue
                            self.dm_threads[str(u.id)] = u
                            # Seed the name cache from data we already have — no
                            # network call (keeps warm-load fast). Nicknames get
                            # refined lazily when messages actually load.
                            try:
                                if int(u.id) not in self._name_cache:
                                    nm = getattr(u, "global_name", None) or getattr(u, "name", None)
                                    if nm:
                                        self._name_cache[int(u.id)] = nm
                            except Exception:
                                pass
                    except Exception:
                        pass
                self._emit_threads()
            except Exception:
                pass

            # Persisted DM index (stubs only)
            try:
                self._load_dm_index()
                for uid_str, disp in list(self._dm_index.items()):
                    try:
                        uid = int(uid_str)
                    except Exception:
                        continue
                    if str(uid) not in self.dm_threads:
                        class _Stub:
                            pass
                        s = _Stub(); s.name = disp; s.id = uid
                        self.dm_threads[str(uid)] = s
                    # The persisted index already holds a resolved display name;
                    # seed the cache from it instead of hitting the network.
                    try:
                        if disp and uid not in self._name_cache:
                            self._name_cache[uid] = disp
                    except Exception:
                        pass
                self._emit_threads()
            except Exception:
                pass

            # Discover DMs from cached messages (index only)
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
                            try:
                                if uid not in self._name_cache:
                                    nm = getattr(other, "global_name", None) or getattr(other, "name", None)
                                    if nm:
                                        self._name_cache[uid] = nm
                            except Exception:
                                pass
                    except Exception:
                        pass
                self._emit_threads()
            except Exception:
                pass

            self._warm_done = True
            self.emit({"type": "warm_complete"})
            # Push a full snapshot now that warm-load is done
            self.emit(self.build_state())

        @self.client.event
        async def on_message(message: discord.Message):
            for chan_id, ch in self.channels.items():
                if message.channel.id == chan_id:
                    if chan_id == self.chan_id:
                        tid = "main"
                    else:
                        tid = f"channel:{chan_id}"
                    name = await self._author_display_async(message, tid)
                    self._push_ui_message_with_author(tid, message, name)
                    return

            if getattr(getattr(message, "channel", None), "id", None) == self.dm_bridge_chan_id:
                self._maybe_index_dm_from_bridge(message, emit_live=True)
                return

            if isinstance(message.channel, discord.DMChannel):
                try:
                    other = getattr(message.channel, "recipient", None)
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
                    self.dm_threads[str(uid)] = other
                    self._emit_threads()
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

    # ----- public ops (schedule on the discord loop) -----
    def _schedule(self, coro_factory):
        if not self.loop:
            return
        try:
            self.loop.call_soon_threadsafe(lambda: asyncio.create_task(coro_factory()))
        except Exception:
            pass

    async def _fetch_recent_dm(self, uid: int, recent: int = 75):
        try:
            user = await self.client.fetch_user(uid)
            await user.create_dm()
            chan = user.dm_channel
            if not chan:
                return
            tid = f"dm:{uid}"
            self.ui_messages.setdefault(tid, [])
            have = {m.id for m in self.ui_messages[tid]}
            msgs = [m async for m in chan.history(limit=recent, oldest_first=False)]
            msgs.reverse()
            for msg in msgs:
                if msg.id in self._seen_ids or msg.id in have:
                    continue
                try:
                    author_name = await self._author_display_async(msg, tid)
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
                self.ui_messages[tid].append(ui)
                self._seen_ids.add(msg.id)
                try:
                    self.ui_reactions[msg.id] = self._build_ui_reactions(msg)
                except Exception:
                    self.ui_reactions[msg.id] = []
            self.ui_messages[tid].sort(key=lambda m: m.ts)
            self._emit_history(tid)
        except Exception:
            pass

    def fetch_recent_dm(self, thread_id: str, recent: int = 10):
        if not thread_id.startswith("dm:"):
            return
        try:
            uid = int(thread_id.split(":", 1)[1])
        except Exception:
            return
        self._schedule(lambda: self._fetch_recent_dm(uid, recent))

    def react_to_message(self, thread_id: str, message_id: int, emoji: str):
        if not emoji:
            return

        async def _do():
            try:
                msg = None
                if thread_id == "main" and self.main_channel:
                    try:
                        msg = await self.main_channel.fetch_message(int(message_id))
                    except Exception:
                        return
                elif thread_id.startswith("channel:"):
                    try:
                        chan_id = int(thread_id.split(":", 1)[1])
                        ch = self.channels.get(chan_id)
                        if ch:
                            msg = await ch.fetch_message(int(message_id))
                    except Exception:
                        return
                elif thread_id.startswith("dm:"):
                    try:
                        uid = int(thread_id.split(":", 1)[1])
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
                self.emit({"type": "reactions_updated", "tid": tid, "message_id": str(msg.id),
                           "reactions": self.ui_reactions.get(msg.id, [])})
            except Exception:
                pass

        self._schedule(_do)

    def ensure_dm_history(self, thread_id: str, desired: int = 500):
        if not thread_id.startswith("dm:"):
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
                msgs = [m async for m in chan.history(limit=need, oldest_first=False)]
                msgs.reverse()
                for msg in msgs:
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
                    have_ids.add(msg.id)
                    self._seen_ids.add(msg.id)
                    try:
                        self.ui_reactions[msg.id] = self._build_ui_reactions(msg)
                    except Exception:
                        self.ui_reactions[msg.id] = []
                self.ui_messages[thread_id].sort(key=lambda m: m.ts)
            except Exception:
                pass
            finally:
                self._emit_history(thread_id)
                self._dm_history_loading.discard(thread_id)

        self._schedule(_load)

    def send_text(self, thread_id: str, text: str):
        if not text:
            return

        async def _send():
            try:
                if thread_id == "main" and self.main_channel:
                    msg = await self.main_channel.send(text)
                    name = await self._safe_author(msg, "main")
                    self._push_ui_message_with_author("main", msg, name)
                elif thread_id.startswith("channel:"):
                    try:
                        chan_id = int(thread_id.split(":", 1)[1])
                        ch = self.channels.get(chan_id)
                        if ch:
                            msg = await ch.send(text)
                            name = await self._safe_author(msg, thread_id)
                            self._push_ui_message_with_author(thread_id, msg, name)
                    except Exception:
                        pass
                elif thread_id.startswith("dm:"):
                    try:
                        uid = int(thread_id.split(":", 1)[1])
                    except Exception:
                        uid = None
                    if uid is None:
                        return
                    user = self.client.get_user(uid) or await self.client.fetch_user(uid)
                    if not user:
                        return
                    await user.create_dm()
                    msg = await user.dm_channel.send(text)
                    self.dm_threads[str(uid)] = user
                    try:
                        disp = await self._resolve_member_display(uid)
                        if disp:
                            self._name_cache[uid] = disp
                    except Exception:
                        pass
                    self._emit_threads()
                    tid = f"dm:{uid}"
                    name = await self._safe_author(msg, tid)
                    self._push_ui_message_with_author(tid, msg, name)
            except Exception:
                pass

        self._schedule(_send)

    def send_reply(self, thread_id: str, message_id: int, text: str):
        if not text:
            return

        async def _send():
            try:
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
                        reply_to = self.display_for_user_id(uid, "user")
                    except Exception:
                        reply_to = None
                if not reply_to:
                    reply_to = "user"
                content = f"(reply to {reply_to}) {text}"

                if thread_id == "main" and self.main_channel:
                    msg = await self.main_channel.send(content)
                    name = await self._safe_author(msg, "main")
                    self._push_ui_message_with_author("main", msg, name)
                elif thread_id.startswith("channel:"):
                    try:
                        chan_id = int(thread_id.split(":", 1)[1])
                        ch = self.channels.get(chan_id)
                        if ch:
                            msg = await ch.send(content)
                            name = await self._safe_author(msg, thread_id)
                            self._push_ui_message_with_author(thread_id, msg, name)
                    except Exception:
                        pass
                elif thread_id.startswith("dm:"):
                    try:
                        uid = int(thread_id.split(":", 1)[1])
                    except Exception:
                        uid = None
                    if uid is None:
                        return
                    user = self.client.get_user(uid) or await self.client.fetch_user(uid)
                    if not user:
                        return
                    await user.create_dm()
                    msg = await user.dm_channel.send(content)
                    self.dm_threads[str(uid)] = user
                    try:
                        disp = await self._resolve_member_display(uid)
                        if disp:
                            self._name_cache[uid] = disp
                    except Exception:
                        pass
                    self._emit_threads()
                    tid = f"dm:{uid}"
                    name = await self._safe_author(msg, tid)
                    self._push_ui_message_with_author(tid, msg, name)
            except Exception:
                pass

        self._schedule(_send)

    async def _safe_author(self, msg, tid):
        try:
            return await self._author_display_async(msg, tid)
        except Exception:
            return getattr(getattr(self.client, "user", None), "name", "me")

    # ----- runner -----
    def _runner(self):
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
                        self.emit({"type": "status", "text": "Message Content intent not enabled. Falling back without it."})
                        ii = discord.Intents.default()
                        ii.message_content = False
                        ii.members = False
                        ii.presences = False
                        ii.dm_messages = True
                        ii.guild_messages = True
                        ii.guilds = True
                        current_intents_box[0] = ii
                        self.message_content_available = False
                        self.loop.create_task(_close_client())
                        self.loop.call_soon(start_client)
                    except Exception as e:
                        self.emit({"type": "status", "text": f"Discord closed: {e}"})
                        try:
                            self.loop.stop()
                        except Exception:
                            pass

                task.add_done_callback(on_task_done)
            except Exception as e:
                self.emit({"type": "status", "text": f"Discord error during start: {e}"})
                try:
                    self.loop.stop()
                except Exception:
                    pass

        start_client()
        try:
            self.loop.run_forever()
        finally:
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

    # ----- indexing / formatting (Qt-free copies) -----
    def _maybe_index_dm_from_bridge(self, message: discord.Message, emit_live: bool = False):
        try:
            txt = message.content or ""
            m = re.match(r"DM from (.+?) \((\d+)\):\s*(.*)", txt, flags=re.S)
            if not m:
                return
            raw_name = m.group(1).strip()
            uid = int(m.group(2))
            body = (m.group(3) or "").strip()

            # Outgoing: bridge relays Ben's sent messages with "(outgoing…)" prefix.
            # Show them as from_me=True so the conversation is complete.
            from_me = body.lower().startswith("(outgoing")
            if from_me:
                body = re.sub(r'^\([^)]*\)\s*', '', body).strip()
            else:
                # Skip if uid belongs to Ben's own account (self-DM noise).
                try:
                    me_user = getattr(getattr(self, "client", None), "user", None)
                    if me_user and int(uid) == int(getattr(me_user, "id", 0)):
                        return
                except Exception:
                    pass

            tid = f"dm:{uid}"
            disp = None
            try:
                if uid in self._name_cache:
                    disp = self._name_cache[uid]
                elif self.guild:
                    mem = self.guild.get_member(uid)
                    if mem and getattr(mem, "display_name", None):
                        disp = mem.display_name
                        self._name_cache[uid] = disp
            except Exception:
                pass
            name = disp or raw_name

            if str(uid) not in self.dm_threads:
                class _Stub:
                    pass
                s = _Stub(); s.name = name; s.id = uid
                self.dm_threads[str(uid)] = s

            self.ui_messages.setdefault(tid, [])

            # Add the message content to the thread so it appears when opened.
            lst = self.ui_messages[tid]
            if not any(mm.id == message.id for mm in lst) and message.id not in self._seen_ids:
                author_name = name
                if from_me:
                    try:
                        me_user = getattr(getattr(self, "client", None), "user", None)
                        author_name = getattr(me_user, "global_name", None) or getattr(me_user, "name", None) or "Me"
                    except Exception:
                        author_name = "Me"
                ui = UiMessage(
                    id=message.id,
                    author=author_name,
                    content=body,
                    ts=message.created_at.timestamp(),
                    from_me=from_me,
                    attachments=[],
                )
                lst.append(ui)
                self._seen_ids.add(message.id)
                if not from_me:
                    self._mark_incoming(tid, ui.ts)
                if emit_live:
                    self.emit({"type": "message_added", "tid": tid,
                               "message": ui.to_dict(), "reactions": []})

            self._emit_threads()
            return
        except Exception:
            pass

    def _format_message_content(self, m: discord.Message) -> str:
        txt = (m.content or "").strip()
        parts = []
        if txt:
            parts.append(txt)
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
            if not isinstance(m.channel, discord.DMChannel) and not self.message_content_available and not getattr(m.author, "bot", False):
                out = "[message content not available — enable Message Content intent]"
        try:
            out = self._replace_user_mentions(out, m)
        except Exception:
            pass
        return out

    def _mention_display_name_sync(self, uid: int) -> Optional[str]:
        if uid in self._name_cache:
            return self._name_cache[uid]
        try:
            g = self.guild or (self.main_channel.guild if self.main_channel else None)
            if g:
                mem = g.get_member(uid)
                if mem and getattr(mem, "display_name", None):
                    self._name_cache[uid] = mem.display_name
                    return mem.display_name
        except Exception:
            pass
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

    def _replace_user_mentions(self, text: str, m: Optional[discord.Message] = None) -> str:
        if not text:
            return text
        id_to_name: Dict[int, str] = {}
        try:
            for u in (getattr(m, "mentions", []) or []):
                uid = int(getattr(u, "id", 0) or 0)
                if not uid:
                    continue
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

    async def _author_display_async(self, m: discord.Message, thread_id: str) -> str:
        try:
            a = getattr(m, "author", None)
            if not a:
                return "user"
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
        return self._name_cache.get(uid, fallback)

    def _push_ui_message_with_author(self, thread_id: str, m: discord.Message, author_name: str):
        try:
            if m.id in self._seen_ids:
                return
        except Exception:
            pass
        try:
            lst = self.ui_messages.setdefault(thread_id, [])
            if any(mm.id == m.id for mm in lst):
                return
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
        try:
            self._seen_ids.add(m.id)
        except Exception:
            pass
        if not from_me:
            self._mark_incoming(thread_id, ui.ts)
        try:
            self.ui_reactions[m.id] = self._build_ui_reactions(m)
        except Exception:
            self.ui_reactions[m.id] = []
        self.emit({"type": "message_added", "tid": thread_id, "message": ui.to_dict(),
                   "reactions": self.ui_reactions.get(m.id, [])})

    def _build_ui_reactions(self, m: discord.Message) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        try:
            for r in getattr(m, "reactions", []) or []:
                e = r.emoji
                cnt = int(getattr(r, "count", 1) or 1)
                if isinstance(e, str):
                    out.append({"emoji": e, "name": self._emoji_spoken_name(e), "url": None, "count": cnt})
                else:
                    try:
                        name = (getattr(e, "name", None) or "emoji").replace("_", " ")
                    except Exception:
                        name = "emoji"
                    try:
                        url = str(getattr(e, "url", None) or "") or None
                    except Exception:
                        url = None
                    out.append({"emoji": None, "name": name, "url": url, "count": cnt})
        except Exception:
            pass
        return out

    def _thread_id_for_message(self, m: discord.Message) -> Optional[str]:
        try:
            if self.main_channel and getattr(m.channel, "id", None) == self.main_channel.id:
                return "main"
            for chan_id, ch in self.channels.items():
                if getattr(m.channel, "id", None) == chan_id:
                    return "main" if chan_id == self.chan_id else f"channel:{chan_id}"
            if isinstance(m.channel, discord.DMChannel):
                other = getattr(m.channel, "recipient", None)
                if other and getattr(other, "id", None):
                    return f"dm:{int(other.id)}"
        except Exception:
            pass
        return None

    def _emoji_spoken_name(self, emoji_obj) -> str:
        try:
            if isinstance(emoji_obj, str):
                map_ = {"👍": "thumbs up", "👎": "thumbs down", "❤️": "heart", "😂": "laughing face"}
                return map_.get(emoji_obj, "emoji")
            nm = getattr(emoji_obj, "name", None)
            return (nm or "emoji").replace("_", " ")
        except Exception:
            return "emoji"

    async def _handle_reaction_change(self, m: discord.Message, added: bool, reactor):
        try:
            tid = self._thread_id_for_message(m)
            if not tid:
                return
            full = None
            try:
                full = await m.channel.fetch_message(m.id)
            except Exception:
                full = m
            self.ui_reactions[m.id] = self._build_ui_reactions(full)
            self.emit({"type": "reactions_updated", "tid": tid, "message_id": str(m.id),
                       "reactions": self.ui_reactions.get(m.id, [])})
            if added:
                msgs = self.ui_messages.get(tid, [])
                if any(mm.id == m.id for mm in msgs):
                    disp = None
                    try:
                        uid = getattr(reactor, "id", None)
                        if uid:
                            disp = await self._resolve_member_display(uid)
                    except Exception:
                        disp = None
                    name = disp or getattr(reactor, "global_name", None) or getattr(reactor, "name", "user")
                    spoken = "reaction"
                    try:
                        if getattr(full, "reactions", None):
                            r0 = full.reactions[-1]
                            spoken = self._emoji_spoken_name(getattr(r0, "emoji", None))
                    except Exception:
                        spoken = "reaction"
                    self.emit({"type": "reaction_tts", "text": f"{name} reacted {spoken}"})
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
                if ctype.startswith("image/") or fn.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".avif", ".tif", ".tiff")):
                    typ = "image"
                elif ctype.startswith("video/") or fn.lower().endswith((".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv", ".3gp", ".mpg", ".mpeg")):
                    typ = "video"
                elif ctype.startswith("audio/") or fn.lower().endswith((".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".wma", ".opus", ".aiff", ".aif")):
                    typ = "audio"
                out.append({"type": typ, "url": url, "filename": fn})
        except Exception:
            pass
        try:
            for emb in getattr(m, "embeds", []) or []:
                # Skip YouTube (and other site) link embeds entirely — they only
                # produce a thumbnail + a non-playable embed "video" URL, which
                # renders as a broken inline player. The frontend detects the
                # YouTube link in the message text and shows a tappable badge
                # that opens it fullscreen instead.
                try:
                    emb_url = (getattr(emb, "url", None) or "").lower()
                    prov = getattr(emb, "provider", None)
                    prov_name = (getattr(prov, "name", None) or "").lower() if prov else ""
                    if ("youtube" in emb_url or "youtu.be" in emb_url or "youtube" in prov_name):
                        continue
                except Exception:
                    pass
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

    # ----- snapshots for WS -----
    def build_threads(self) -> List[Dict[str, Any]]:
        entries = []
        for chan_id in self.channel_ids:
            ch = self.channels.get(chan_id)
            if chan_id == self.chan_id:
                tid = "main"
                ch_name = f"#{ch.name}" if ch else "Channel"
            else:
                tid = f"channel:{chan_id}"
                ch_name = f"#{ch.name}" if ch else f"Channel {chan_id}"
            entries.append({"tid": tid, "label": ch_name, "is_channel": True,
                            "is_main": (chan_id == self.chan_id),
                            "last_ts": self._thread_last_ts.get(tid, 0)})
        try:
            my_id = getattr(getattr(self.client, "user", None), "id", None)
            for uid_str, user in (self.dm_threads or {}).items():
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
                label = self.display_for_user_id(uid_int, base) if uid_int is not None else base
                entries.append({"tid": tid, "label": label, "is_channel": False, "is_main": False,
                                "last_ts": self._thread_last_ts.get(tid, 0)})
        except Exception:
            pass
        return entries

    def build_state(self) -> Dict[str, Any]:
        messages = {}
        for tid, lst in self.ui_messages.items():
            messages[tid] = [m.to_dict() for m in sorted(lst, key=lambda x: x.ts)]
        reactions = {str(k): v for k, v in self.ui_reactions.items()}
        me = None
        try:
            u = getattr(self.client, "user", None)
            if u:
                me = {"id": str(u.id), "name": getattr(u, "name", "me")}
        except Exception:
            me = None
        return {
            "type": "state",
            "threads": self.build_threads(),
            "messages": messages,
            "reactions": reactions,
            "me": me,
            "message_content_available": self.message_content_available,
            "warm_done": self._warm_done,
            "settings": SETTINGS,
        }

    def _emit_threads(self):
        self.emit({"type": "threads", "threads": self.build_threads()})

    def _emit_history(self, tid: str):
        msgs = [m.to_dict() for m in sorted(self.ui_messages.get(tid, []), key=lambda x: x.ts)]
        reactions = {}
        for m in self.ui_messages.get(tid, []):
            reactions[str(m.id)] = self.ui_reactions.get(m.id, [])
        self.emit({"type": "history_extended", "tid": tid, "messages": msgs, "reactions": reactions})


# ---------------- WebSocket server ----------------
class WSServer:
    def __init__(self, backend: DiscordBackend, host="127.0.0.1", port=8777):
        self.backend = backend
        self.host = host
        self.port = port
        self.clients: set = set()
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def emit(self, evt: Dict[str, Any]):
        """Called from the discord thread; marshals to the WS loop."""
        if not self.loop:
            return
        try:
            data = json.dumps(evt, ensure_ascii=False)
        except Exception:
            return
        try:
            asyncio.run_coroutine_threadsafe(self._broadcast(data), self.loop)
        except Exception:
            pass

    async def _broadcast(self, data: str):
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def _handler(self, ws):
        self.clients.add(ws)
        try:
            # Send a fresh snapshot on connect
            await ws.send(json.dumps(self.backend.build_state(), ensure_ascii=False))
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                await self._dispatch(ws, msg)
        except Exception:
            pass
        finally:
            self.clients.discard(ws)

    async def _dispatch(self, ws, msg: Dict[str, Any]):
        t = msg.get("type")
        b = self.backend
        try:
            if t == "get_state":
                await ws.send(json.dumps(b.build_state(), ensure_ascii=False))
            elif t == "select_thread":
                tid = msg.get("tid", "")
                if tid.startswith("dm:"):
                    # ensure we have recent messages for this DM
                    b.fetch_recent_dm(tid, recent=int(msg.get("recent", 75)))
                b.write_keyboard_context(tid)
            elif t == "send_text":
                b.send_text(msg.get("tid", ""), msg.get("text", ""))
            elif t == "send_reply":
                b.send_reply(msg.get("tid", ""), int(msg.get("message_id", 0)), msg.get("text", ""))
            elif t == "react":
                b.react_to_message(msg.get("tid", ""), int(msg.get("message_id", 0)), msg.get("emoji", ""))
            elif t == "load_history":
                b.ensure_dm_history(msg.get("tid", ""), desired=int(msg.get("desired", 500)))
            elif t == "write_keyboard_context":
                b.write_keyboard_context(msg.get("tid", ""))
            elif t == "mark_read":
                b.save_read_state(msg.get("ids", []), msg.get("last_seen_ts", 0))
        except Exception:
            pass

    async def serve(self):
        self.loop = asyncio.get_event_loop()
        async with websockets.serve(self._handler, self.host, self.port, max_size=None):
            print(f"[backend] WebSocket listening on ws://{self.host}:{self.port}", flush=True)
            await asyncio.Future()  # run forever


# ---------------- Persistence helpers on backend ----------------
def _attach_persistence(backend: DiscordBackend):
    read_state_path = os.path.join(APP_DIR, "read_state.json")
    kb_ctx_path = os.path.join(APP_DIR, "keyboard_context.json")

    def write_keyboard_context(tid: str):
        try:
            thread_msgs = backend.ui_messages.get(tid, [])
            recent = thread_msgs[-20:] if len(thread_msgs) > 20 else thread_msgs
            ctx_lines = []
            for m in recent:
                who = "ME" if m.from_me else (m.author or "THEM")
                body = (m.content or "").strip()
                if body:
                    ctx_lines.append(f"{who}: {body}")

            # ---- Who is Ben talking to right now (current thread label) ----
            talking_to = ""
            try:
                for t in backend.build_threads():
                    if t.get("tid") == tid:
                        talking_to = str(t.get("label") or "").lstrip("#").strip()
                        break
            except Exception:
                pass

            # ---- Recent contacts: people Ben has been messaging, across all
            #      threads (DM labels + authors of incoming messages). Most
            #      recently active first. These are great word-completion seeds
            #      (e.g. names like "ARI"). ----
            contacts: List[str] = []
            seen_contacts = set()
            def _add_contact(name: str):
                n = (name or "").strip()
                if not n:
                    return
                # split multi-word labels into first names too
                for part in [n] + n.split():
                    key = part.upper()
                    if part and key not in seen_contacts and not key.startswith("#"):
                        seen_contacts.add(key)
                        contacts.append(part)
            try:
                # current thread person first
                if talking_to:
                    _add_contact(talking_to)
                # DM thread labels
                for t in backend.build_threads():
                    if not t.get("is_channel"):
                        _add_contact(str(t.get("label") or ""))
                # authors from every thread's messages
                for _tid, lst in backend.ui_messages.items():
                    for m in lst:
                        if not m.from_me and m.author:
                            _add_contact(m.author)
            except Exception:
                pass
            contacts = contacts[:25]

            # ---- Running log of Ben's own frequent / recent words. Built from
            #      his sent (from_me) messages across all threads. Gives the
            #      predictor personalised vocabulary (interests, names, phrases
            #      he actually uses). ----
            word_counts: Dict[str, float] = {}
            try:
                # weight recent messages a little higher by iterating newest-last
                all_mine = []
                for _tid, lst in backend.ui_messages.items():
                    for m in lst:
                        if m.from_me and m.content:
                            all_mine.append(m)
                all_mine.sort(key=lambda x: getattr(x, "ts", 0))
                for i, m in enumerate(all_mine):
                    recency = 1.0 + (i / max(1, len(all_mine)))  # 1.0 .. 2.0
                    for raw in re.findall(r"[A-Za-z']+", m.content):
                        w = raw.upper()
                        if len(w) >= 2:
                            word_counts[w] = word_counts.get(w, 0) + recency
            except Exception:
                pass
            # drop the most common filler words so the log highlights meaningful vocab
            STOP = {"THE","AND","TO","A","I","IS","IT","IN","OF","YOU","ME","MY","ON",
                    "FOR","AT","SO","NO","YES","OK","DO","BE","WE","AM","ARE","WAS"}
            recent_words = [w for w, _ in sorted(word_counts.items(), key=lambda kv: kv[1], reverse=True)
                            if w not in STOP][:40]

            payload = {
                "context": ctx_lines,
                "talking_to": talking_to,
                "contacts": contacts,
                "recent_words": recent_words,
            }
            with open(kb_ctx_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)

            # Keep recent_messages.json (Ben's own sent messages) fresh too — the
            # keyboard reads it as a secondary context source.
            try:
                mine_recent = [m.content.strip() for m in all_mine if (m.content or "").strip()][-100:]
                with open(os.path.join(APP_DIR, "recent_messages.json"), "w", encoding="utf-8") as f:
                    json.dump({"messages": mine_recent}, f, ensure_ascii=False, indent=2)
            except Exception:
                pass
        except Exception:
            pass

    def save_read_state(ids, last_seen_ts):
        try:
            data = {"read_ids": [str(i) for i in (ids or [])], "last_seen_ts": float(last_seen_ts or 0)}
            with open(read_state_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    backend.write_keyboard_context = write_keyboard_context
    backend.save_read_state = save_read_state


# ---------------- Entry ----------------
def load_config():
    cfg_path = os.path.join(APP_DIR, "config.json")
    cfg = {}
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        cfg = {}

    def get_cfg(name, default=""):
        return os.environ.get(name, str(cfg.get(name, default)))

    token = get_cfg("DISCORD_TOKEN", "").strip()
    guild_id = int(get_cfg("GUILD_ID", "0") or 0)
    channel_id = int(get_cfg("CHANNEL_ID", "0") or 0)
    channel_ids = []
    try:
        raw_ids = cfg.get("CHANNEL_IDS", [])
        if isinstance(raw_ids, list):
            channel_ids = [int(cid) for cid in raw_ids if cid]
    except Exception:
        channel_ids = []
    if not channel_ids and channel_id:
        channel_ids = [channel_id]
    dm_bridge_str = (
        get_cfg("DM_BRIDGE_CHANNEL_ID", "")
        or get_cfg("DM_Bridge_channel_id", "")
        or get_cfg("dm_bridge_channel_id", "")
    )
    dm_bridge_id = int(dm_bridge_str or 0)
    return token, guild_id, channel_ids, dm_bridge_id, cfg_path


def main():
    token, guild_id, channel_ids, dm_bridge_id, cfg_path = load_config()
    if not token or not guild_id or not channel_ids:
        print(f"Provide DISCORD_TOKEN, GUILD_ID, CHANNEL_ID or CHANNEL_IDS in {cfg_path} or environment.")
        sys.exit(1)

    port = int(os.environ.get("NEW_MSG_WS_PORT", "8777"))

    # The WS server holds the asyncio loop on the main thread; the backend runs
    # its own discord loop in a daemon thread. emit() marshals between them.
    server_holder = {}

    def emit(evt):
        srv = server_holder.get("srv")
        if srv:
            srv.emit(evt)

    backend = DiscordBackend(
        token, guild_id, channel_ids[0] if channel_ids else 0,
        dm_bridge_id, channel_ids=channel_ids, emit=emit
    )
    _attach_persistence(backend)

    server = WSServer(backend, port=port)
    server_holder["srv"] = server

    backend.start()

    try:
        asyncio.run(server.serve())
    except KeyboardInterrupt:
        pass
    finally:
        backend.stop()


if __name__ == "__main__":
    main()
