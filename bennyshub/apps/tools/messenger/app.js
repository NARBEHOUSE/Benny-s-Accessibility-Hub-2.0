/* ============================================================
   app.js — Ben's Messenger HTML5 frontend.
   Connects to the headless Python backend over WebSocket and
   drives the accessible scan UI (faithful port of ben_discord_app.py).
   ============================================================ */
window.BenApp = (function () {
  'use strict';

  /* ---------------- config ---------------- */
  var WS_PORT = 8777;
  var ws = null;
  var wsReady = false;
  var reconnectTimer = null;

  /* ---------------- state ---------------- */
  var threads = [];                 // [{tid,label,is_channel,is_main}]
  var messagesByTid = {};           // tid -> [msg]
  var reactionsByMid = {};          // msgIdStr -> [react]
  var me = null;
  var settings = {};
  var warmDone = false;
  var messageContentAvailable = true;

  var uiMode = 'channel_list';      // channel_list | message_view
  var scanMode = 'idle';            // idle | blocks | channels | messages
  var blockIndex = 0;
  var channelRow = -1;
  var msgIndex = -1;
  var currentTid = null;

  var renderedMsgIds = [];          // ordered (ascending) string ids of current thread

  // overlays
  var actionsOpen = false, actionsFocus = -1, actionsList = [];
  var reactOpen = false, reactFocus = -1;
  var mediaOpen = false;
  var actForMsgId = null;
  var justSent = false;             // set when a message was just sent, to return to messages
  var lastSentText = '';            // text of the last sent message, spoken after keyboard closes

  // media slideshow state
  var mediaList = [];               // [{type,url,filename}] images+videos+audio
  var mediaIndex = 0;               // current slide
  var mediaNav = [];                // ['prev','next','close'] or ['close']
  var mediaNavFocus = -1;           // focused nav button index

  var REACT_EMOJIS = [
    { e: '\uD83D\uDC4D', name: 'thumbs up' },
    { e: '\uD83D\uDC4E', name: 'thumbs down' },
    { e: '\u2764\uFE0F', name: 'heart' },
    { e: '\uD83D\uDE02', name: 'laughing face' }
  ];

  /* ---------------- read/unread tracking ---------------- */
  var READ_KEY = 'benmsg-read-ids';
  var readIds = (function () {
    try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]')); } catch (e) { return new Set(); }
  })();
  function persistReadIds() {
    try { localStorage.setItem(READ_KEY, JSON.stringify(Array.from(readIds))); } catch (e) {}
  }
  // Per-thread last-activity timestamp (from the backend) and the timestamp the
  // user has "read" up to. This lets DMs/channels highlight as unread even
  // before their full message history is loaded into messagesByTid.
  var threadLastTs = {};
  var READ_TS_KEY = 'benmsg-read-ts';
  var readTsByTid = (function () {
    try { return JSON.parse(localStorage.getItem(READ_TS_KEY) || '{}') || {}; } catch (e) { return {}; }
  })();
  function persistReadTs() {
    try { localStorage.setItem(READ_TS_KEY, JSON.stringify(readTsByTid)); } catch (e) {}
  }
  // Record each thread's last-activity ts as reported by the backend.
  function captureThreadTimestamps(list) {
    (list || []).forEach(function (t) {
      if (t && t.tid && typeof t.last_ts === 'number' && t.last_ts > (threadLastTs[t.tid] || 0)) {
        threadLastTs[t.tid] = t.last_ts;
      }
    });
  }
  function threadHasUnread(tid) {
    // Timestamp-based: any incoming activity newer than what the user has read.
    if ((threadLastTs[tid] || 0) > (readTsByTid[tid] || 0)) return true;
    // Fallback: message-id based check for threads whose history is loaded.
    var list = messagesByTid[tid] || [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m.from_me && !readIds.has(String(m.id))) return true;
    }
    return false;
  }
  function markThreadRead(tid) {
    var list = messagesByTid[tid] || [];
    var added = false, lastTs = 0;
    list.forEach(function (m) {
      if (!readIds.has(String(m.id))) { readIds.add(String(m.id)); added = true; }
      if (m.ts > lastTs) lastTs = m.ts;
    });
    // Clear the timestamp-based unread flag for this thread.
    var tts = Math.max(threadLastTs[tid] || 0, lastTs);
    if (tts > (readTsByTid[tid] || 0)) { readTsByTid[tid] = tts; persistReadTs(); }
    if (added) {
      persistReadIds();
      send({ type: 'mark_read', ids: Array.from(readIds), last_seen_ts: lastTs });
    }
  }

  /* ---------------- DOM refs ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var elStatusDot, elStatusText, elThreadList, elThreadHeader, elMsgScroll;
  var pageChannels, pageMessages;

  /* ---------------- TTS ---------------- */
  var ttsVoice = null, ttsRate = 1.0;
  function loadVoice() {
    var p = (window.benAPI && window.benAPI.getConfig) ? window.benAPI.getConfig() : Promise.resolve({ appDir: '' });
    p.then(function (cfg) {
      var dir = (cfg && cfg.appDir) || '';
      return window.benAPI ? window.benAPI.readFile(dir + '\\..\\..\\..\\shared\\voice-settings.json') : null;
    }).then(function (vj) {
      if (!vj) return;
      try {
        var vs = JSON.parse(vj);
        ttsRate = vs.rate || 1.0;
        var pick = function () {
          var voices = window.speechSynthesis.getVoices();
          if (!voices || !voices.length) return;
          var nm = (vs.voiceName || '').match(/microsoft\s+(\w+)/i);
          var pn = nm ? nm[1].toLowerCase() : '';
          if (pn) { for (var i = 0; i < voices.length; i++) { if (voices[i].name.toLowerCase().indexOf(pn) !== -1) { ttsVoice = voices[i]; return; } } }
          ttsVoice = voices[Math.min(vs.voiceIndex || 0, voices.length - 1)] || voices[0];
        };
        var v = window.speechSynthesis.getVoices();
        if (v && v.length) pick(); else window.speechSynthesis.onvoiceschanged = pick;
      } catch (e) {}
    }).catch(function () {});
  }
  function ttsNormalize(t) {
    // Convert all-caps words of 2+ letters to lowercase so TTS reads "IT" as "it" not "I T".
    return String(t).replace(/\b([A-Z]{2,})\b/g, function (m) { return m.toLowerCase(); });
  }
  function speak(t) {
    if (!t) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(ttsNormalize(t));
      if (ttsVoice) u.voice = ttsVoice;
      u.rate = ttsRate; u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }
  function ttsStop() { try { window.speechSynthesis.cancel(); } catch (e) {} }

  /* ---------------- helpers ---------------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtTime(ts) {
    try {
      var d = new Date(ts * 1000);
      var h = d.getHours(), m = d.getMinutes();
      var ap = h >= 12 ? 'PM' : 'AM';
      h = h % 12; if (h === 0) h = 12;
      return h + ':' + (m < 10 ? '0' + m : m) + ' ' + ap;
    } catch (e) { return ''; }
  }
  function youtubeId(text) {
    if (!text) return null;
    var m = String(text).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_\-]{6,})/);
    return m ? m[1] : null;
  }
  // Return the full YouTube URL (with protocol) so it can be opened externally.
  function youtubeUrl(text) {
    if (!text) return null;
    var m = String(text).match(/((?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[\w-]+)/);
    if (!m) return null;
    var url = m[1];
    if (url.indexOf('http') !== 0) url = 'https://' + url;
    return url;
  }
  // Spoken weekday + time, e.g. "Friday at 9:05 PM" / "Today at 9 PM".
  function fmtDayTime(ts) {
    try {
      var d = new Date(ts * 1000);
      var now = new Date();
      var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      var h = d.getHours(), mi = d.getMinutes();
      var ap = h >= 12 ? 'PM' : 'AM';
      h = h % 12; if (h === 0) h = 12;
      var tstr = h + (mi ? ':' + (mi < 10 ? '0' + mi : mi) : '') + ' ' + ap;
      var yest = new Date(now); yest.setDate(now.getDate() - 1);
      var dayLabel;
      if (d.toDateString() === now.toDateString()) dayLabel = 'Today';
      else if (d.toDateString() === yest.toDateString()) dayLabel = 'Yesterday';
      else dayLabel = days[d.getDay()];
      return dayLabel + ' at ' + tstr;
    } catch (e) { return ''; }
  }
  // Text suitable for TTS: strip URLs (never read links aloud) and represent a
  // YouTube link as "YouTube Video" plus an abbreviated title if one is present.
  function spokenContent(content) {
    if (!content) return '';
    var hasYt = !!youtubeUrl(content);
    var t = String(content)
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/\b(?:www\.)?(?:youtube\.com|youtu\.be)\/\S*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (hasYt) {
      if (t) {
        if (t.length > 60) t = t.slice(0, 60).replace(/\s+\S*$/, '').trim() + '\u2026';
        return 'YouTube Video. ' + t;
      }
      return 'YouTube Video';
    }
    return t;
  }
  // Full spoken form of a message: "Name, Friday at 9 PM: content".
  function messageSpeech(m) {
    if (!m) return 'no message';
    var who = m.from_me ? 'Me' : (m.author || 'Unknown');
    var when = fmtDayTime(m.ts);
    var body = spokenContent(m.content) || 'no text';
    return who + (when ? ', ' + when : '') + ': ' + body;
  }
  function threadByTid(tid) { for (var i = 0; i < threads.length; i++) if (threads[i].tid === tid) return threads[i]; return null; }
  function blockLabels() {
    return uiMode === 'channel_list' ? ['Channels', 'Exit'] : ['Messages', 'Send', 'Back'];
  }

  /* ---------------- WebSocket ---------------- */
  function connect() {
    setStatus('off', 'Connecting…');
    try { ws = new WebSocket('ws://127.0.0.1:' + WS_PORT); }
    catch (e) { scheduleReconnect(); return; }
    ws.onopen = function () { wsReady = true; setStatus('warm', 'Connected — loading…'); send({ type: 'get_state' }); };
    ws.onclose = function () { wsReady = false; setStatus('off', 'Disconnected'); scheduleReconnect(); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
    ws.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleEvent(msg);
    };
  }
  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () { reconnectTimer = null; connect(); }, 1500);
  }
  function send(obj) { if (ws && wsReady) { try { ws.send(JSON.stringify(obj)); } catch (e) {} } }
  function setStatus(cls, text) {
    if (!elStatusDot) return;
    elStatusDot.className = cls;
    elStatusText.textContent = text;
  }

  function handleEvent(msg) {
    switch (msg.type) {
      case 'state':
        threads = msg.threads || [];
        captureThreadTimestamps(threads);
        messagesByTid = msg.messages || {};
        reactionsByMid = msg.reactions || {};
        me = msg.me || me;
        settings = msg.settings || settings;
        warmDone = !!msg.warm_done;
        messageContentAvailable = msg.message_content_available !== false;
        setStatus(warmDone ? 'on' : 'warm', warmDone ? 'Ready' : 'Loading history…');
        renderThreadList();
        if (currentTid && uiMode === 'message_view') { renderMessages(currentTid); if (scanMode !== 'messages') scrollMessagesToBottom(); }
        break;
      case 'threads':
        threads = msg.threads || threads;
        captureThreadTimestamps(threads);
        renderThreadList();
        break;
      case 'status':
        if (msg.text) setStatus(wsReady ? (warmDone ? 'on' : 'warm') : 'off', msg.text);
        break;
      case 'warm_complete':
        warmDone = true; setStatus('on', 'Ready'); renderThreadList();
        break;
      case 'message_added':
        onMessageAdded(msg.tid, msg.message, msg.reactions);
        break;
      case 'reactions_updated':
        reactionsByMid[String(msg.message_id)] = msg.reactions || [];
        if (currentTid === msg.tid && uiMode === 'message_view') updateMessageReactions(String(msg.message_id));
        if (warmDone && !actionsOpen && !reactOpen) announceReaction(msg.reactions);
        break;
      case 'history_extended':
        if (msg.messages) {
          messagesByTid[msg.tid] = msg.messages;
          if (msg.reactions) { Object.keys(msg.reactions).forEach(function (k) { reactionsByMid[k] = msg.reactions[k]; }); }
          if (currentTid === msg.tid && uiMode === 'message_view') {
            renderMessages(msg.tid);
            // Keep the view pinned to the newest message on (re)load, unless the
            // user is actively scanning through older messages.
            if (scanMode !== 'messages') scrollMessagesToBottom();
          }
          renderThreadList();
        }
        break;
    }
  }

  function announceReaction(reactions) {
    if (!reactions || !reactions.length) return;
    var r = reactions[reactions.length - 1];
    var name = r.name || (r.emoji || 'reaction');
    speak('Reacted ' + name);
  }

  function onMessageAdded(tid, m, reactions) {
    if (!m) return;
    var list = messagesByTid[tid] || (messagesByTid[tid] = []);
    var isNew = !list.some(function (x) { return String(x.id) === String(m.id); });
    if (isNew) list.push(m);
    if (reactions) reactionsByMid[String(m.id)] = reactions;
    if (isNew && !m.from_me && (m.ts || 0) > (threadLastTs[tid] || 0)) threadLastTs[tid] = m.ts;
    renderThreadList();
    if (currentTid === tid && uiMode === 'message_view') {
      renderMessages(tid);
      if (scanMode !== 'messages') scrollMessagesToBottom();
    }
    // Only announce messages that are genuinely live. Backfilled/offline-replay
    // messages arrive through the same channel but were created long ago, so we
    // skip TTS for anything older than ~2 minutes (it still appears in the list).
    var ageSec = (Date.now() / 1000) - (m.ts || 0);
    if (isNew && warmDone && !m.from_me && ageSec < 120) {
      speak((m.author || 'New message') + ' says ' + spokenContent(m.content));
    }
  }

  /* ---------------- render: thread list ---------------- */
  function renderThreadList() {
    if (!elThreadList) return;
    // sort: unread first, then channels before DMs, preserve given order otherwise
    var ordered = threads.slice();
    var idxMap = {};
    ordered.forEach(function (t, i) { idxMap[t.tid] = i; });
    ordered.sort(function (a, b) {
      var ua = threadHasUnread(a.tid) ? 0 : 1;
      var ub = threadHasUnread(b.tid) ? 0 : 1;
      if (ua !== ub) return ua - ub;
      return idxMap[a.tid] - idxMap[b.tid];
    });

    var prevTid = (channelRow >= 0 && currentThreadOrder[channelRow]) ? currentThreadOrder[channelRow].tid : null;
    currentThreadOrder = ordered;

    elThreadList.innerHTML = '';
    ordered.forEach(function (t, i) {
      var li = document.createElement('li');
      li.className = 'thread-item' + (threadHasUnread(t.tid) ? ' unread' : '');
      li.dataset.tid = t.tid;
      li.innerHTML = escapeHtml(t.label) + (threadHasUnread(t.tid) ? '<span class="unread-dot"></span>' : '');
      li.addEventListener('click', function () { selectChannelByTid(t.tid); });
      elThreadList.appendChild(li);
    });

    // restore highlight if scanning channels
    if (scanMode === 'channels') {
      if (prevTid) { var ni = ordered.findIndex(function (t) { return t.tid === prevTid; }); if (ni >= 0) channelRow = ni; }
      highlightChannel(channelRow, false);
    }
  }
  var currentThreadOrder = [];

  /* ---------------- render: messages ---------------- */
  function renderMessages(tid) {
    if (!elMsgScroll) return;
    var list = (messagesByTid[tid] || []).slice().sort(function (a, b) { return a.ts - b.ts; });
    elMsgScroll.innerHTML = '';
    renderedMsgIds = [];
    list.forEach(function (m) {
      elMsgScroll.appendChild(buildMessageEl(m));
      renderedMsgIds.push(String(m.id));
    });
  }

  function buildMessageEl(m) {
    var div = document.createElement('div');
    div.className = 'msg ' + (m.from_me ? 'from-me' : 'from-them');
    div.dataset.mid = String(m.id);

    var head = document.createElement('div');
    head.className = 'msg-head';
    if (m.from_me) {
      head.innerHTML = 'Me &nbsp;' + escapeHtml(fmtTime(m.ts));
    } else {
      head.innerHTML = '<span class="author">' + escapeHtml(m.author || 'user') + '</span> ' +
        '<span class="time">(' + escapeHtml(fmtTime(m.ts)) + ')</span>';
    }
    div.appendChild(head);

    var body = document.createElement('div');
    body.className = 'msg-body';
    body.textContent = m.content || '';
    div.appendChild(body);

    // media
    var mediaEl = buildMediaEl(m);
    if (mediaEl) div.appendChild(mediaEl);

    // reactions
    var rx = buildReactionsEl(String(m.id));
    if (rx) div.appendChild(rx);

    // Mouse/touch: tapping a message selects it and opens its actions menu.
    div.addEventListener('click', function (ev) {
      // Don't hijack taps on interactive media (video/audio controls, links).
      var tag = (ev.target && ev.target.tagName) ? ev.target.tagName.toLowerCase() : '';
      if (tag === 'video' || tag === 'audio' || tag === 'a' || tag === 'iframe') return;
      openActionsForMessageId(String(m.id));
    });

    return div;
  }

  function buildMediaEl(m) {
    var atts = m.attachments || [];
    var yt = youtubeId(m.content);
    if (!atts.length && !yt) return null;
    var wrap = document.createElement('div');
    wrap.className = 'msg-media';
    atts.forEach(function (a) {
      if (a.type === 'image') {
        var img = document.createElement('img'); img.src = a.url; img.alt = a.filename || 'image'; wrap.appendChild(img);
      } else if (a.type === 'video') {
        var v = document.createElement('video'); v.src = a.url; v.controls = true; wrap.appendChild(v);
      } else if (a.type === 'audio') {
        var au = document.createElement('audio'); au.src = a.url; au.controls = true; wrap.appendChild(au);
      } else {
        var link = document.createElement('a'); link.className = 'media-link'; link.href = a.url; link.textContent = a.filename || a.url; wrap.appendChild(link);
      }
    });
    if (yt) {
      // Embeds fail from a local file:// origin, so show a tappable badge that
      // opens the video fullscreen in Chrome (handled by the View action too).
      var ytUrl = youtubeUrl(m.content);
      var badge = document.createElement('div');
      badge.className = 'yt-badge';
      badge.textContent = '\u25B6 YouTube video';
      badge.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (ytUrl && window.benAPI && window.benAPI.openVideo) { speak('Opening video'); window.benAPI.openVideo(ytUrl); }
      });
      wrap.appendChild(badge);
    }
    return wrap;
  }

  function buildReactionsEl(mid) {
    var data = reactionsByMid[mid] || [];
    if (!data.length) return null;
    var wrap = document.createElement('div');
    wrap.className = 'msg-reactions';
    data.forEach(function (r) {
      var chip = document.createElement('span');
      chip.className = 'react-chip';
      var count = r.count || 1;
      if (r.emoji) chip.textContent = r.emoji + ' ' + count;
      else if (r.url) { chip.innerHTML = '<img src="' + escapeHtml(r.url) + '" alt="' + escapeHtml(r.name || 'emoji') + '"> ' + count; }
      else chip.textContent = (r.name || 'emoji') + ' ' + count;
      wrap.appendChild(chip);
    });
    return wrap;
  }

  function updateMessageReactions(mid) {
    var el = elMsgScroll.querySelector('.msg[data-mid="' + cssEscape(mid) + '"]');
    if (!el) return;
    var old = el.querySelector('.msg-reactions');
    if (old) old.remove();
    var rx = buildReactionsEl(mid);
    if (rx) el.appendChild(rx);
  }
  function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  function scrollMessagesToBottom() {
    if (!elMsgScroll) return;
    elMsgScroll.scrollTop = elMsgScroll.scrollHeight;
    // Re-pin after layout settles (images/videos can change height as they load).
    requestAnimationFrame(function () { if (elMsgScroll) elMsgScroll.scrollTop = elMsgScroll.scrollHeight; });
    setTimeout(function () { if (elMsgScroll && scanMode !== 'messages') elMsgScroll.scrollTop = elMsgScroll.scrollHeight; }, 250);
  }

  /* ---------------- page switching ---------------- */
  function showPage(which) {
    pageChannels.classList.toggle('active', which === 'channels');
    pageMessages.classList.toggle('active', which === 'messages');
  }

  /* ---------------- block focus ---------------- */
  function currentBlocks() {
    return uiMode === 'channel_list'
      ? [$('block-channels'), $('block-exit')]
      : [$('block-messages'), $('block-send'), $('block-back')];
  }
  function setBlockFocus(idx) {
    var blocks = currentBlocks();
    blocks.forEach(function (b, i) { if (b) b.classList.toggle('block-focus', i === idx); });
    blockIndex = idx;
  }
  function clearBlockFocus() { currentBlocks().forEach(function (b) { if (b) b.classList.remove('block-focus'); }); }

  /* ---------------- channel scan ---------------- */
  function highlightChannel(row, doSpeak) {
    var items = elThreadList.querySelectorAll('.thread-item');
    items.forEach(function (it, i) { it.classList.toggle('row-focus', i === row); });
    if (row >= 0 && items[row]) {
      items[row].scrollIntoView({ block: 'nearest' });
      if (doSpeak) speak(currentThreadOrder[row] ? currentThreadOrder[row].label : items[row].textContent);
    }
  }
  function startChannelScan() {
    var c = currentThreadOrder.length;
    if (c === 0) { speak('No channels'); return; }
    $('block-channels').classList.remove('block-focus');
    scanMode = 'channels';
    if (channelRow < 0) channelRow = 0;
    highlightChannel(channelRow, true);
  }
  function selectChannelByTid(tid) {
    var t = threadByTid(tid); if (!t) return;
    currentTid = tid;
    uiMode = 'message_view';
    scanMode = 'idle';
    msgIndex = -1;
    // ask backend for fresh DM history + write keyboard context
    // (25 keeps the first load fast; older messages load on demand)
    send({ type: 'select_thread', tid: tid, recent: 25 });
    elThreadHeader.textContent = t.label;
    renderMessages(tid);
    showPage('messages');
    scrollMessagesToBottom();
    markThreadRead(tid);
    renderThreadList();
    clearBlockFocus();
    speak(t.label);
  }
  function selectCurrentChannel() {
    if (channelRow < 0 || !currentThreadOrder[channelRow]) { speak('No channel'); return; }
    selectChannelByTid(currentThreadOrder[channelRow].tid);
  }

  /* ---------------- message scan ---------------- */
  function highlightMessage(idx) {
    var els = elMsgScroll.querySelectorAll('.msg');
    els.forEach(function (e, i) { e.classList.toggle('msg-focus', i === idx); });
    if (idx >= 0 && els[idx]) {
      els[idx].scrollIntoView({ block: 'center' });
      var mid = renderedMsgIds[idx];
      var m = (messagesByTid[currentTid] || []).find(function (x) { return String(x.id) === mid; });
      if (m) {
        markRead(mid);
        speak(messageSpeech(m));
      }
    }
  }
  function markRead(mid) {
    if (!readIds.has(mid)) { readIds.add(mid); persistReadIds(); }
  }
  function startMessageScan() {
    var total = renderedMsgIds.length;
    if (total === 0) { speak('No messages'); return; }
    scanMode = 'messages';
    scrollMessagesToBottom();
    msgIndex = total - 1;
    highlightMessage(msgIndex);
  }
  function clearMessageHighlight() {
    var els = elMsgScroll.querySelectorAll('.msg');
    els.forEach(function (e) { e.classList.remove('msg-focus'); });
  }

  /* ---------------- actions overlay ---------------- */
  // Mouse/touch entry point: select a message by id (entering messages scan if
  // needed), highlight it, then open its actions menu.
  function openActionsForMessageId(mid) {
    var idx = renderedMsgIds.indexOf(String(mid));
    if (idx < 0) return;
    if (uiMode !== 'message_view') return;
    scanMode = 'messages';
    msgIndex = idx;
    clearBlockFocus();
    highlightMessage(msgIndex);
    openActionsForCurrent();
  }

  function openActionsForCurrent() {
    var total = renderedMsgIds.length;
    if (total === 0) { speak('No messages'); return; }
    if (msgIndex < 0 || msgIndex >= total) { msgIndex = total - 1; highlightMessage(msgIndex); }
    var mid = renderedMsgIds[msgIndex];
    actForMsgId = mid;
    var m = (messagesByTid[currentTid] || []).find(function (x) { return String(x.id) === mid; });
    var fromMe = !!(m && m.from_me);
    var hasMedia = false;
    if (m) {
      hasMedia = (m.attachments || []).some(function (a) { return a.type === 'image' || a.type === 'video' || a.type === 'audio'; });
      if (youtubeId(m.content)) hasMedia = true;
    }
    actionsList = ['Read'];
    if (hasMedia) actionsList.push('View');
    if (!fromMe) actionsList.push('Reply', 'React');

    var container = $('actions-buttons');
    container.innerHTML = '';
    actionsList.forEach(function (label, i) {
      var b = document.createElement('div');
      b.className = 'action-btn';
      b.textContent = label;
      b.addEventListener('click', function () { actionsFocus = i; activateAction(); });
      container.appendChild(b);
    });
    actionsFocus = -1;
    updateActionsFocus();
    actionsOpen = true;
    $('actions-overlay').classList.add('active');
    speak('Actions');
  }
  function updateActionsFocus() {
    var btns = $('actions-buttons').children;
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('opt-focus', i === actionsFocus);
  }
  function actionsFocusNext(backward) {
    var n = actionsList.length; if (!n) return;
    if (actionsFocus < 0) actionsFocus = backward ? n - 1 : 0;
    else actionsFocus = backward ? (actionsFocus - 1 + n) % n : (actionsFocus + 1) % n;
    updateActionsFocus();
    speak(actionsList[actionsFocus]);
  }
  function closeActions() { actionsOpen = false; actionsFocus = -1; $('actions-overlay').classList.remove('active'); }
  function activateAction() {
    if (actionsFocus < 0 || actionsFocus >= actionsList.length) return;
    var label = actionsList[actionsFocus].toLowerCase();
    if (label === 'read') { readCurrentMessage(); closeActions(); }
    else if (label === 'view') { closeActions(); openMediaForCurrent(); }
    else if (label === 'reply') { closeActions(); openKeyboardReply(); }
    else if (label === 'react') { closeActions(); openReactOverlay(); }
  }
  function readCurrentMessage() {
    var m = (messagesByTid[currentTid] || []).find(function (x) { return String(x.id) === actForMsgId; });
    if (m) speak(messageSpeech(m));
  }

  /* ---------------- reaction overlay ---------------- */
  function openReactOverlay() {
    var container = $('react-buttons');
    container.innerHTML = '';
    REACT_EMOJIS.forEach(function (r, i) {
      var b = document.createElement('div');
      b.className = 'react-btn';
      b.textContent = r.e;
      b.addEventListener('click', function () { reactFocus = i; reactActivate(); });
      container.appendChild(b);
    });
    reactFocus = -1;
    updateReactFocus();
    reactOpen = true;
    $('react-overlay').classList.add('active');
    speak('Reactions');
  }
  function updateReactFocus() {
    var btns = $('react-buttons').children;
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('opt-focus', i === reactFocus);
  }
  function reactFocusNext() {
    var n = REACT_EMOJIS.length;
    if (reactFocus < 0) reactFocus = 0; else reactFocus = (reactFocus + 1) % n;
    updateReactFocus(); speak(REACT_EMOJIS[reactFocus].name);
  }
  function reactFocusPrev() {
    var n = REACT_EMOJIS.length;
    if (reactFocus < 0) reactFocus = n - 1; else reactFocus = (reactFocus - 1 + n) % n;
    updateReactFocus(); speak(REACT_EMOJIS[reactFocus].name);
  }
  function closeReact() { reactOpen = false; reactFocus = -1; $('react-overlay').classList.remove('active'); }
  function reactActivate() {
    if (reactFocus < 0 || reactFocus >= REACT_EMOJIS.length) return;
    var r = REACT_EMOJIS[reactFocus];
    send({ type: 'react', tid: currentTid, message_id: actForMsgId, emoji: r.e });
    speak('Reacted ' + r.name);
    closeReact();
  }

  /* ---------------- media overlay (slideshow) ---------------- */
  function openMediaForCurrent() {
    var m = (messagesByTid[currentTid] || []).find(function (x) { return String(x.id) === actForMsgId; });
    if (!m) return;

    // YouTube takes priority: play it fullscreen in Chrome with the accessible
    // control bar (embeds are unreliable from a local file:// origin).
    var yt = youtubeUrl(m.content);
    if (yt) {
      if (window.benAPI && window.benAPI.openVideo) {
        speak('Opening video');
        window.benAPI.openVideo(yt);
      } else {
        speak('Cannot open video');
      }
      return;
    }

    // Collect every viewable attachment into one slideshow.
    mediaList = (m.attachments || []).filter(function (a) {
      return a.type === 'image' || a.type === 'video' || a.type === 'audio';
    });
    if (!mediaList.length) { speak('No media'); return; }

    mediaIndex = 0;
    mediaNav = mediaList.length > 1 ? ['prev', 'next', 'close'] : ['close'];
    mediaNavFocus = -1;
    mediaOpen = true;
    $('media-overlay').classList.add('active');
    renderMediaSlide();
    renderMediaNav();
    speak('Viewing media');
  }

  function renderMediaSlide() {
    var content = $('media-content');
    content.innerHTML = '';
    var a = mediaList[mediaIndex];
    if (!a) return;
    if (a.type === 'image') {
      var img = document.createElement('img'); img.src = a.url; img.alt = a.filename || 'image'; content.appendChild(img);
    } else if (a.type === 'video') {
      var v = document.createElement('video'); v.src = a.url; v.controls = true; v.autoplay = true; content.appendChild(v);
    } else if (a.type === 'audio') {
      var au = document.createElement('audio'); au.src = a.url; au.controls = true; au.autoplay = true; content.appendChild(au);
    }
    var counter = $('media-counter');
    counter.textContent = mediaList.length > 1 ? (mediaIndex + 1) + ' of ' + mediaList.length : '';
  }

  var MEDIA_NAV_LABELS = { prev: 'Previous', next: 'Next', close: 'Close' };
  function renderMediaNav() {
    var nav = $('media-nav');
    nav.innerHTML = '';
    mediaNav.forEach(function (act, i) {
      var b = document.createElement('div');
      b.className = 'media-btn';
      b.textContent = MEDIA_NAV_LABELS[act];
      b.dataset.act = act;
      b.addEventListener('click', function () { mediaNavFocus = i; mediaActivateNav(); });
      nav.appendChild(b);
    });
    updateMediaNavFocus();
  }
  function updateMediaNavFocus() {
    var btns = $('media-nav').children;
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('opt-focus', i === mediaNavFocus);
  }
  function mediaNavNext() {
    var n = mediaNav.length; if (!n) return;
    mediaNavFocus = mediaNavFocus < 0 ? 0 : (mediaNavFocus + 1) % n;
    updateMediaNavFocus();
    speak(MEDIA_NAV_LABELS[mediaNav[mediaNavFocus]]);
  }
  function mediaNavPrev() {
    var n = mediaNav.length; if (!n) return;
    mediaNavFocus = mediaNavFocus < 0 ? n - 1 : (mediaNavFocus - 1 + n) % n;
    updateMediaNavFocus();
    speak(MEDIA_NAV_LABELS[mediaNav[mediaNavFocus]]);
  }
  function mediaActivateNav() {
    if (mediaNavFocus < 0 || mediaNavFocus >= mediaNav.length) return;
    var act = mediaNav[mediaNavFocus];
    if (act === 'close') { closeMedia(); speak('Closed'); }
    else if (act === 'prev') { mediaPrevSlide(); }
    else if (act === 'next') { mediaNextSlide(); }
  }
  function mediaNextSlide() {
    if (mediaList.length < 2) return;
    mediaIndex = (mediaIndex + 1) % mediaList.length;
    renderMediaSlide();
    speak('Image ' + (mediaIndex + 1));
  }
  function mediaPrevSlide() {
    if (mediaList.length < 2) return;
    mediaIndex = (mediaIndex - 1 + mediaList.length) % mediaList.length;
    renderMediaSlide();
    speak('Image ' + (mediaIndex + 1));
  }
  function closeMedia() {
    mediaOpen = false;
    mediaList = []; mediaIndex = 0; mediaNav = []; mediaNavFocus = -1;
    $('media-overlay').classList.remove('active');
    $('media-content').innerHTML = '';
    $('media-counter').textContent = '';
    $('media-nav').innerHTML = '';
  }

  /* ---------------- keyboard composer ---------------- */
  function openKeyboardSend() {
    send({ type: 'write_keyboard_context', tid: currentTid });
    window.BenKeyboard.open({
      onSend: function (text) { justSent = true; lastSentText = text; send({ type: 'send_text', tid: currentTid, text: text }); }
    });
  }
  function openKeyboardReply() {
    var mid = actForMsgId;
    send({ type: 'write_keyboard_context', tid: currentTid });
    window.BenKeyboard.open({
      onSend: function (text) { justSent = true; lastSentText = text; send({ type: 'send_reply', tid: currentTid, message_id: mid, text: text }); }
    });
  }
  function onKeyboardClosed(wasSent) {
    justSent = false;
    var sentText = wasSent ? lastSentText : '';
    lastSentText = '';
    // Make sure no leftover overlay (read/react/reply actions, reactions,
    // media) is still showing — we want the plain message view back.
    if (actionsOpen) closeActions();
    if (reactOpen) closeReact();
    if (mediaOpen) closeMedia();
    // Keep the conversation pinned to the newest message after sending.
    if (wasSent && uiMode === 'message_view') scrollMessagesToBottom();
    // restore scan to blocks (Send focus) on message view — the previous
    // interface, exactly like before. No stuck message highlight.
    clearMessageHighlight();
    scanMode = 'blocks';
    setBlockFocus(uiMode === 'message_view' ? 1 : 0);
    // TTS the sent message so Ben knows what he just sent before scanning.
    if (sentText) {
      setTimeout(function () { speak(sentText); }, 350);
    } else {
      speak(uiMode === 'message_view' ? 'Send' : 'Channels');
    }
  }

  /* ---------------- back navigation ---------------- */
  function goBackToChannels() {
    uiMode = 'channel_list';
    scanMode = 'idle';
    currentTid = null;
    channelRow = -1; msgIndex = -1;
    clearBlockFocus();
    showPage('channels');
    renderThreadList();
    speak('Channels');
  }

  /* ---------------- scan: forward (short space) ---------------- */
  function spaceForward() {
    ttsStop();
    if (mediaOpen) { mediaNavNext(); return; }
    if (actionsOpen) { actionsFocusNext(false); return; }
    if (reactOpen) { reactFocusNext(); return; }

    if (scanMode === 'idle') {
      scanMode = 'blocks';
      setBlockFocus(0);
      speak(blockLabels()[0]);
      return;
    }
    if (scanMode === 'blocks') {
      var n = blockLabels().length;
      setBlockFocus((blockIndex + 1) % n);
      speak(blockLabels()[blockIndex]);
      return;
    }
    if (scanMode === 'channels') {
      var c = currentThreadOrder.length;
      if (c === 0) { speak('No channels'); return; }
      channelRow = (channelRow + 1) % c;
      highlightChannel(channelRow, true);
      return;
    }
    if (scanMode === 'messages') {
      var total = renderedMsgIds.length;
      if (total === 0) { speak('No messages'); return; }
      if (msgIndex < 0) msgIndex = total - 1;
      else { msgIndex -= 1; if (msgIndex < 0) { msgIndex = total - 1; scrollMessagesToBottom(); } }
      highlightMessage(msgIndex);
      return;
    }
  }

  /* ---------------- scan: backward (long space, repeating) ---------------- */
  function spaceBackward() {
    ttsStop();
    if (mediaOpen) { mediaNavPrev(); return; }
    if (actionsOpen) { actionsFocusNext(true); return; }
    if (reactOpen) { reactFocusPrev(); return; }

    if (scanMode === 'idle') {
      scanMode = 'blocks';
      var n0 = blockLabels().length;
      setBlockFocus(n0 - 1);
      speak(blockLabels()[n0 - 1]);
      return;
    }
    if (scanMode === 'blocks') {
      var n = blockLabels().length;
      setBlockFocus((blockIndex - 1 + n) % n);
      speak(blockLabels()[blockIndex]);
      return;
    }
    if (scanMode === 'channels') {
      var c = currentThreadOrder.length;
      if (c === 0) { speak('No channels'); return; }
      channelRow = channelRow >= 0 ? (channelRow - 1 + c) % c : c - 1;
      highlightChannel(channelRow, true);
      return;
    }
    if (scanMode === 'messages') {
      var total = renderedMsgIds.length;
      if (total === 0) { speak('No messages'); return; }
      if (msgIndex < 0) msgIndex = 0;
      else { msgIndex += 1; if (msgIndex >= total) msgIndex = 0; }
      highlightMessage(msgIndex);
      return;
    }
  }

  /* ---------------- scan: enter short ---------------- */
  function enterShort() {
    ttsStop();
    if (mediaOpen) { mediaActivateNav(); return; }
    if (reactOpen) { reactActivate(); return; }
    if (actionsOpen) { activateAction(); return; }

    if (scanMode === 'blocks') {
      if (uiMode === 'channel_list') {
        if (blockIndex === 0) startChannelScan();
        else if (blockIndex === 1) exitApp();
      } else {
        if (blockIndex === 0) startMessageScan();
        else if (blockIndex === 1) openKeyboardSend();
        else if (blockIndex === 2) goBackToChannels();
      }
      return;
    }
    if (scanMode === 'channels') { selectCurrentChannel(); return; }
    if (scanMode === 'messages') { openActionsForCurrent(); return; }
  }

  /* ---------------- scan: enter long (hold) ---------------- */
  function enterLong() {
    if (mediaOpen) { closeMedia(); speak('Closed'); return; }
    if (actionsOpen) { closeActions(); speak('Messages'); return; }
    if (reactOpen) { closeReact(); return; }
    if (scanMode === 'channels') {
      ttsStop();
      scanMode = 'blocks'; setBlockFocus(0);
      speak(uiMode === 'channel_list' ? 'Channels' : 'Messages');
    } else if (scanMode === 'messages') {
      ttsStop();
      clearMessageHighlight();
      msgIndex = -1;
      scanMode = 'blocks'; setBlockFocus(1);
      speak('Send Message');
    }
  }

  function exitApp() {
    speak('Exit');
    if (window.benAPI && window.benAPI.close) setTimeout(function () { window.benAPI.close(); }, 250);
  }

  /* ---------------- global key handling ---------------- */
  var spaceDown = false, spaceAt = 0, spaceHoldTimer = null, spaceFired = false, spaceRepeat = null;
  var enterDown = false, enterAt = 0, enterHoldTimer = null, enterFired = false;
  var SHORT_MIN = 150;

  // Backward scan timing follows the user's configured scan speed (NarbeScanManager).
  // Hold the switch for one scan-interval to start scanning backward, then it
  // steps back once per interval until released (e.g. 3s hold, then every 3s).
  function scanInterval() {
    try {
      if (window.NarbeScanManager && window.NarbeScanManager.getScanInterval) {
        var v = window.NarbeScanManager.getScanInterval();
        if (v && v > 0) return v;
      }
    } catch (e) {}
    return 3000;
  }

  function onKeyDown(e) {
    if (window.BenKeyboard && window.BenKeyboard.isOpen()) return; // keyboard owns input
    if (e.code === 'Space') {
      e.preventDefault();
      if (spaceDown) return;
      spaceDown = true; spaceAt = Date.now(); spaceFired = false;
      var iv = scanInterval();
      spaceHoldTimer = setTimeout(function () {
        spaceFired = true;
        spaceBackward();
        spaceRepeat = setInterval(spaceBackward, scanInterval());
      }, iv);
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      if (enterDown) return;
      enterDown = true; enterAt = Date.now(); enterFired = false;
      enterHoldTimer = setTimeout(function () { enterFired = true; enterLong(); }, scanInterval());
    }
  }
  function onKeyUp(e) {
    if (window.BenKeyboard && window.BenKeyboard.isOpen()) return;
    if (e.code === 'Space') {
      e.preventDefault();
      clearTimeout(spaceHoldTimer); clearInterval(spaceRepeat); spaceRepeat = null;
      if (!spaceFired && Date.now() - spaceAt >= SHORT_MIN) spaceForward();
      spaceDown = false; spaceFired = false;
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      clearTimeout(enterHoldTimer);
      if (!enterFired && Date.now() - enterAt >= SHORT_MIN) enterShort();
      enterDown = false;
    }
  }
  function onCancelled() {
    clearTimeout(spaceHoldTimer); clearInterval(spaceRepeat); spaceRepeat = null;
    clearTimeout(enterHoldTimer);
    spaceDown = false; spaceFired = false; enterDown = false; enterFired = false;
  }

  /* ---------------- mouse / touch wiring ---------------- */
  // Direct tap targets for the big action blocks and overlays, so the app is
  // fully usable by mouse/touch in addition to switch scanning.
  function wireClicks() {
    var bind = function (id, fn) {
      var el = $(id);
      if (el) el.addEventListener('click', function (e) { e.stopPropagation(); ttsStop(); fn(); });
    };
    // Channel list page
    bind('block-exit', function () { exitApp(); });
    // Note: block-channels taps fall through to the individual thread items.
    // Message view page
    bind('block-send', function () { openKeyboardSend(); });
    bind('block-back', function () { goBackToChannels(); });

    // Media overlay: tap the dark backdrop to close.
    var media = $('media-overlay');
    if (media) media.addEventListener('click', function (e) {
      if (e.target === media) { closeMedia(); speak('Closed'); }
    });
    // Actions/React overlays: tap the backdrop to dismiss.
    var act = $('actions-overlay');
    if (act) act.addEventListener('click', function (e) { if (e.target === act) { closeActions(); } });
    var rea = $('react-overlay');
    if (rea) rea.addEventListener('click', function (e) { if (e.target === rea) { closeReact(); } });
  }

  /* ---------------- init ---------------- */
  function init() {
    elStatusDot = $('status-dot'); elStatusText = $('status-text');
    elThreadList = $('thread-list'); elThreadHeader = $('thread-header'); elMsgScroll = $('message-scroll');
    pageChannels = $('page-channels'); pageMessages = $('page-messages');

    if (window.benAPI && window.benAPI.getConfig) {
      window.benAPI.getConfig().then(function (cfg) { if (cfg && cfg.wsPort) WS_PORT = cfg.wsPort; connect(); }).catch(connect);
    } else { connect(); }

    loadVoice();
    if (window.BenKeyboard) window.BenKeyboard.init();

    wireClicks();

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('narbe-input-cancelled', onCancelled);

    try { window.speechSynthesis.getVoices(); } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', init);

  return { onKeyboardClosed: onKeyboardClosed };
})();
