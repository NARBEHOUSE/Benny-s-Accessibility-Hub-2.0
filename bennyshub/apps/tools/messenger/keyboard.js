/* ============================================================
   keyboard.js — NARBE keyboard composer for Ben's Messenger.
   Adapted from narbe_keyboard.html. Exposed as window.BenKeyboard.

   Scan model (identical to narbe_keyboard.html):
     Short Space = next row/key
     Long Space  = prev row/key (hold one scan-interval, then repeat each interval)
     Short Enter = enter row / activate key (text box: read text)
     Long Enter  = ALWAYS jump to predictions

   ROW ORDER: 0=textbox 1=predictions 2=controls 3-8=alpha
   ============================================================ */
window.BenKeyboard = (function () {
  'use strict';

  var SHORT_MIN = 150;
  var PRED_ROW = 1;
  var PRED_PURPLE_ROW = 2;

  var DEFAULTS = [
    'I','THE','AND','TO','YOU','IS','IT','IN','A','THIS',
    'THAT','WE','CAN','MY','LOVE','GOOD','YES','NO','OKAY','THANKS'
  ];
  // Fallback two-word phrases so the purple row is never blank even before (or
  // without) a Claude response. Rotated by refreshCount so each refresh shows a
  // different slice.
  var DEFAULT_PHRASES = [
    'I AM','I WANT','I NEED','I LIKE','I FEEL','THANK YOU','LOVE YOU','I THINK',
    'LET ME','I CAN','COME HERE','ALL DONE','MORE PLEASE','NOT NOW','I KNOW',
    'I SEE','HOW ARE','WHAT IS','LOOK AT','I HAVE','ME TOO','YES PLEASE',
    'NO THANKS','SO MUCH','I LOVE','CAN WE','WILL YOU','I DID','TELL ME','GIVE ME'
  ];
  // Default words for the KenLM/ngrams bottom row, shown until predictions load.
  var KENLM_DEFAULTS = ['YES', 'NO', 'IDK', 'THE', 'YOU', 'I'];
  var CTRL_DEFS = [
    {icon:'--', label:'SPACE',    action:'space'},
    {icon:'\u232B',  label:'DEL LTR', action:'del_letter'},
    {icon:'\u2326',  label:'DEL WRD', action:'del_word'},
    {icon:'\u2327',  label:'CLEAR',   action:'clear'},
    {icon:'\uD83D\uDD0A', label:'HEAR CTX', action:'context_tts'},
    {icon:'\u21B5',  label:'SEND',    action:'send', primary:true},
    {icon:'\u2715',  label:'CLOSE',   action:'close'},
  ];
  var ALPHA_ROWS = [
    ['A','B','C','D','E','F'],
    ['G','H','I','J','K','L'],
    ['M','N','O','P','Q','R'],
    ['S','T','U','V','W','X'],
    ['Y','Z','0','1','2','3'],
    ['4','5','6','7','8','9'],
  ];

  var text = '';
  var mode = 'ROWS';
  var rowIdx = PRED_ROW;
  var keyIdx = 0;
  var refreshCount = 0;
  // Words/phrases already shown since the last text change. Each refresh adds
  // the currently-displayed set here so the NEXT refresh produces completely
  // unique suggestions. Reset whenever the text changes (a word is added or
  // deleted) so normal prediction resumes for the new context.
  var excludedWords = {};   // UPPERCASE -> true
  var excludedPhrases = {}; // UPPERCASE -> true
  var appDir = '';
  var apiKey = '';
  var ngrams = null;
  var open = false;
  var sendCallback = null;
  var built = false;
  // Personalised context loaded from keyboard_context.json (written by the
  // backend): who Ben is talking to, recent contacts, and a running log of his
  // frequent words. Used to seed completions (e.g. "AR" -> "ARI") and to give
  // the Claude predictor richer, more personal context.
  var personalCtx = { talking_to: '', contacts: [], recent_words: [] };
  var personalWords = [];   // UPPERCASE: contacts + recent words, for completion

  var rows = [];
  var predGreenBtns = [];
  var predPurpleBtns = [];
  var kenLMRowBtns = [];
  var KENLM_ROW = null;
  var predRefreshGreenBtn = null;
  var predRefreshPurpleBtn = null;
  var predGreenPanelEl = null;
  var predPurplePanelEl = null;
  var textAreaEl = null;
  var overlayEl = null;

  /* ---------------- file access (Electron preload) ---------------- */
  function readFile(p) {
    if (window.benAPI && window.benAPI.readFile) return window.benAPI.readFile(p);
    return Promise.resolve(null);
  }

  // Load the personalised context (contacts, frequent words, current person)
  // the backend writes to keyboard_context.json. Refreshed each time the
  // keyboard opens so completions stay current.
  function loadPersonalContext() {
    if (!appDir) return Promise.resolve();
    return readFile(appDir + '\\keyboard_context.json').then(function (j) {
      if (!j) return;
      try {
        var d = JSON.parse(j);
        personalCtx = {
          talking_to: d.talking_to || '',
          contacts: Array.isArray(d.contacts) ? d.contacts : [],
          recent_words: Array.isArray(d.recent_words) ? d.recent_words : []
        };
        var seen = {}, list = [];
        personalCtx.contacts.concat(personalCtx.recent_words).forEach(function (w) {
          var u = String(w || '').toUpperCase().trim();
          if (u && /^[A-Z']/.test(u) && !seen[u]) { seen[u] = 1; list.push(u); }
        });
        personalWords = list;
      } catch (e) {}
    }).catch(function () {});
  }

  /* ---------------- build UI ---------------- */
  function makeEl(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }
  function makeRow() { return makeEl('div', 'kb-row'); }
  function addClick(el, fn) {
    el.addEventListener('mousedown', function (e) { e.preventDefault(); });
    el.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
  }

  function buildUI() {
    var app = document.getElementById('kb-app');
    textAreaEl = document.getElementById('kb-text-area');
    rows.push({ rowEl: textAreaEl, keys: [], isTextBox: true });

    // Green words row
    predGreenPanelEl = makeEl('div', 'kb-row');
    predGreenPanelEl.id = 'kb-pred-green-panel';
    predRefreshGreenBtn = makeEl('div', 'kb-pred-refresh');
    predRefreshGreenBtn.id = 'kb-pred-refresh-green';
    predRefreshGreenBtn.textContent = '\u21BA';
    predRefreshGreenBtn.dataset.action = 'refresh_words';
    addClick(predRefreshGreenBtn, doRefreshGreen);
    predGreenPanelEl.appendChild(predRefreshGreenBtn);
    for (var i = 0; i < 5; i++) {
      var b = makeEl('div', 'kb-pred-btn kb-pred-green');
      b.textContent = '...';
      (function (btn) { addClick(btn, function () { insertPredWord(btn.textContent); }); })(b);
      predGreenPanelEl.appendChild(b); predGreenBtns.push(b);
    }
    rows.push({ rowEl: predGreenPanelEl, keys: [predRefreshGreenBtn].concat(predGreenBtns) });
    app.appendChild(predGreenPanelEl);

    // Purple phrases row
    predPurplePanelEl = makeEl('div', 'kb-row');
    predPurplePanelEl.id = 'kb-pred-purple-panel';
    predRefreshPurpleBtn = makeEl('div', 'kb-pred-refresh');
    predRefreshPurpleBtn.id = 'kb-pred-refresh-purple';
    predRefreshPurpleBtn.textContent = '\u21BA';
    predRefreshPurpleBtn.dataset.action = 'refresh_phrases';
    addClick(predRefreshPurpleBtn, doRefreshPurple);
    predPurplePanelEl.appendChild(predRefreshPurpleBtn);
    for (var j = 0; j < 5; j++) {
      var b2 = makeEl('div', 'kb-pred-btn kb-pred-purple');
      b2.textContent = '...';
      (function (btn) { addClick(btn, function () { insertPredWord(btn.textContent); }); })(b2);
      predPurplePanelEl.appendChild(b2); predPurpleBtns.push(b2);
    }
    rows.push({ rowEl: predPurplePanelEl, keys: [predRefreshPurpleBtn].concat(predPurpleBtns) });
    app.appendChild(predPurplePanelEl);

    // controls
    var ctrlRow = makeRow();
    var ctrlDef = { rowEl: ctrlRow, keys: [] };
    CTRL_DEFS.forEach(function (k) {
      var btn = makeEl('div', 'kb-key' + (k.primary ? ' primary' : ''));
      btn.innerHTML = '<span class="ctrl-icon">' + k.icon + '</span><span class="ctrl-label">' + k.label + '</span>';
      btn.dataset.action = k.action;
      addClick(btn, (function (action) { return function () { handleAction(action); }; })(k.action));
      ctrlRow.appendChild(btn); ctrlDef.keys.push(btn);
    });
    rows.push(ctrlDef);
    app.appendChild(ctrlRow);

    // alpha
    ALPHA_ROWS.forEach(function (chars) {
      var row = makeRow();
      var def = { rowEl: row, keys: [] };
      chars.forEach(function (ch) {
        var btn = makeEl('div', 'kb-key');
        btn.textContent = ch; btn.dataset.char = ch;
        addClick(btn, (function (c) { return function () { typeChar(c); }; })(ch));
        row.appendChild(btn); def.keys.push(btn);
      });
      rows.push(def);
      app.appendChild(row);
    });

    // KenLM / ngrams bottom row — 6 buttons, defaults YES NO IDK YOU THE I
    var klRow = makeRow();
    klRow.id = 'kb-kenlm-row';
    var klDef = { rowEl: klRow, keys: [] };
    for (var ki = 0; ki < KENLM_DEFAULTS.length; ki++) {
      var kb = makeEl('div', 'kb-pred-btn kb-kenlm-btn');
      kb.textContent = KENLM_DEFAULTS[ki];
      (function (btn) { addClick(btn, function () { insertPredWord(btn.textContent); }); })(kb);
      klRow.appendChild(kb); klDef.keys.push(kb); kenLMRowBtns.push(kb);
    }
    rows.push(klDef);
    app.appendChild(klRow);
    KENLM_ROW = rows.length - 1;

    built = true;
  }

  function updateDisplay() { textAreaEl.textContent = text || '|'; }

  /* ---------------- speech ---------------- */
  var selectedVoice = null, voiceRate = 1.0;
  function selectVoice(vs) {
    var voices = window.speechSynthesis.getVoices();
    if (!voices || !voices.length) return;
    var name = (vs && vs.voiceName) || '';
    var pm = name.match(/microsoft\s+(\w+)/i);
    var pn = pm ? pm[1].toLowerCase() : '';
    if (pn) {
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].name.toLowerCase().indexOf(pn) !== -1) { selectedVoice = voices[i]; return; }
      }
    }
    var idx = (vs && vs.voiceIndex) || 0;
    selectedVoice = voices[Math.min(idx, voices.length - 1)] || voices[0];
  }
  // Predictions are spoken only after they SETTLE (stop changing) for a hold
  // window. The timer resets on every change, so it fires once predictions have
  // finished loading — the NEWEST words get read, never stale ones mid-load.
  var predSpeakTimer = null;
  var PRED_SETTLE_MS = 900;
  var lastSpokenPredLabel = '';
  function scheduleSettledPredSpeak() {
    clearTimeout(predSpeakTimer);
    predSpeakTimer = setTimeout(function () {
      if (mode !== 'ROWS') return;
      var label = '';
      if (rowIdx === PRED_ROW) label = predWordsLabel();
      else if (rowIdx === PRED_PURPLE_ROW) label = predPhrasesLabel();
      if (label && label !== 'loading predictions' && label !== 'loading phrases' && label !== lastSpokenPredLabel) {
        lastSpokenPredLabel = label;
        speak(label);
      }
    }, PRED_SETTLE_MS);
  }
  var TTS_ABBREVS = { 'IDK': "i don't know" };
  function ttsNormalize(t) {
    // Expand known abbreviations first, then lowercase remaining all-caps words so
    // TTS reads "IT" as "it" not "I T". Single uppercase chars are left alone.
    return String(t).replace(/\b([A-Z]{2,})\b/g, function (m) {
      return TTS_ABBREVS[m] || m.toLowerCase();
    });
  }
  function speak(t) {
    if (!t) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(ttsNormalize(t));
      if (selectedVoice) u.voice = selectedVoice;
      u.rate = voiceRate; u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* ---------------- focus ---------------- */
  function clearAll() {
    rows.forEach(function (r) {
      r.rowEl.classList.remove('row-focus');
      r.keys.forEach(function (k) { k.classList.remove('key-focus'); });
    });
  }
  function setRowFocus(idx) { clearAll(); if (rows[idx]) rows[idx].rowEl.classList.add('row-focus'); }
  function setKeyFocus(r, k) {
    clearAll();
    if (rows[r]) {
      rows[r].rowEl.classList.add('row-focus');
      if (rows[r].keys[k]) rows[r].keys[k].classList.add('key-focus');
    }
  }

  /* ---------------- labels ---------------- */
  function rowLabel(idx) {
    if (idx === 0) return 'text box';
    if (idx === PRED_ROW) return 'words';
    if (idx === PRED_PURPLE_ROW) return 'phrases';
    if (idx === 3) return 'controls';
    if (KENLM_ROW !== null && idx === KENLM_ROW) return 'common words';
    var a = idx - 4;
    if (a >= 0 && a < ALPHA_ROWS.length) return ALPHA_ROWS[a].join(' ').toLowerCase();
    return '';
  }
  function predWordsLabel() {
    var singles = [];
    predGreenBtns.forEach(function (b) { var t = (b.textContent || '').trim(); if (t && t !== '...') singles.push(t); });
    return singles.length ? singles.join('. ') : 'loading predictions';
  }
  function predPhrasesLabel() {
    var phrases = [];
    predPurpleBtns.forEach(function (b) { var t = (b.textContent || '').trim(); if (t && t !== '...') phrases.push(t); });
    return phrases.length ? phrases.join('. ') : 'loading phrases';
  }
  function kenLMRowLabel() {
    var words = kenLMRowBtns.map(function (b) { return (b.textContent || '').trim(); }).filter(function (w) { return w && w !== '...'; });
    return words.length ? words.join('. ') : '';
  }
  function announceRow(idx) {
    if (idx === 0) speak(text.trim() ? text.trim() : 'text box empty');
    else if (idx === PRED_ROW) speak(predWordsLabel());
    else if (idx === PRED_PURPLE_ROW) speak(predPhrasesLabel());
    else if (KENLM_ROW !== null && idx === KENLM_ROW) speak(kenLMRowLabel());
    else speak(rowLabel(idx));
  }
  function keyLabel(r, k) {
    var el = rows[r] && rows[r].keys[k];
    if (!el) return '';
    if (el.dataset.char) return el.dataset.char;
    if (el.dataset.action) {
      var m = { space:'space', del_letter:'delete letter', del_word:'delete word',
                clear:'clear', send:'send', close:'close',
                refresh_words:'refresh words', refresh_phrases:'refresh phrases',
                context_tts:'hear context' };
      return m[el.dataset.action] || el.dataset.action;
    }
    return (el.textContent || '').trim();
  }

  /* ---------------- navigation ---------------- */
  function rowNext() { rowIdx = (rowIdx + 1) % rows.length; mode = 'ROWS'; setRowFocus(rowIdx); announceRow(rowIdx); }
  function rowPrev() { rowIdx = (rowIdx - 1 + rows.length) % rows.length; mode = 'ROWS'; setRowFocus(rowIdx); announceRow(rowIdx); }
  function enterRow() {
    if (rows[rowIdx] && rows[rowIdx].isTextBox) { speak(text.trim() ? text.trim() : 'text box empty'); return; }
    mode = 'KEYS'; keyIdx = 0; setKeyFocus(rowIdx, keyIdx); speak(keyLabel(rowIdx, keyIdx));
  }
  function keyNext() { var n = rows[rowIdx].keys.length; keyIdx = (keyIdx + 1) % n; setKeyFocus(rowIdx, keyIdx); speak(keyLabel(rowIdx, keyIdx)); }
  function keyPrev() { var n = rows[rowIdx].keys.length; keyIdx = (keyIdx - 1 + n) % n; setKeyFocus(rowIdx, keyIdx); speak(keyLabel(rowIdx, keyIdx)); }
  function jumpToPreds() { rowIdx = PRED_ROW; mode = 'ROWS'; setRowFocus(PRED_ROW); }

  /* ---------------- key actions ---------------- */
  // After any text edit we jump to the predictions row, so always (re)arm the
  // settle-based TTS so the NEW predictions are read once they finish loading.
  function typeChar(ch) { resetExcluded(); text += ch; updateDisplay(); speak(ch); mode = 'ROWS'; setRowFocus(rowIdx); schedulePreds(80, false); scheduleKenLMRow(100); }
  function insertPredWord(word) {
    word = (word || '').trim();
    if (!word || word === '...') return;
    // The user found the word they wanted: clear the refresh-exclusion so normal
    // prediction resumes for the new context.
    resetExcluded();
    // If the user is mid-word (no trailing space), the prediction REPLACES the
    // partial word they're typing — "IC" + "ICE CREAM" -> "ICE CREAM", not
    // "IC ICE CREAM". If there's a trailing space, just append after it.
    if (text.endsWith(' ') || text === '') {
      text = (text.replace(/\s+$/, '') ? text.replace(/\s+$/, '') + ' ' : '') + word + ' ';
    } else {
      var parts = text.split(' ');
      parts.pop(); // drop the partial word being typed
      var before = parts.join(' ');
      text = (before ? before + ' ' : '') + word + ' ';
    }
    updateDisplay(); speak(word); jumpToPreds();
    schedulePreds(80, true);
    scheduleKenLMRow(100);
  }
  function activateKey() {
    var el = rows[rowIdx] && rows[rowIdx].keys[keyIdx];
    if (!el) return;
    if (el.dataset.char) { typeChar(el.dataset.char); return; }
    if (el.dataset.action) { handleAction(el.dataset.action); return; }
    insertPredWord((el.textContent || '').trim());
  }
  function handleAction(action) {
    switch (action) {
      case 'space': resetExcluded(); text += ' '; updateDisplay(); speak('space'); mode = 'ROWS'; setRowFocus(rowIdx); schedulePreds(80, false); scheduleKenLMRow(100); break;
      case 'del_letter': resetExcluded(); text = text.slice(0, -1); updateDisplay(); speak('delete'); mode = 'ROWS'; setRowFocus(rowIdx); schedulePreds(100, false); scheduleKenLMRow(120); break;
      case 'del_word': {
        resetExcluded();
        var t = text.replace(/\s+$/, '');
        text = !t ? '' : t.lastIndexOf(' ') === -1 ? '' : t.slice(0, t.lastIndexOf(' ') + 1);
        updateDisplay(); speak('delete word'); mode = 'ROWS'; setRowFocus(rowIdx); schedulePreds(100, false); scheduleKenLMRow(120); break;
      }
      case 'clear': resetExcluded(); text = ''; updateDisplay(); speak('clear'); mode = 'ROWS'; setRowFocus(rowIdx); schedulePreds(100, false); scheduleKenLMRow(120); break;
      case 'context_tts': doContextTts(); break;
      case 'send': sendText(); break;
      case 'close': closeKb(); break;
      case 'refresh_words': doRefreshGreen(); break;
      case 'refresh_phrases': doRefreshPurple(); break;
    }
  }
  function doRefreshGreen() {
    refreshCount++;
    predGreenBtns.forEach(function (b) {
      var t = (b.textContent || '').trim().toUpperCase();
      if (t && t !== '...') excludedWords[t] = true;
    });
    speak('refreshing');
    rowIdx = PRED_ROW;
    mode = 'ROWS';
    setRowFocus(PRED_ROW);
    fetchPredsWordsOnly(true);
    scheduleKenLMRow(100);
  }
  function doRefreshPurple() {
    refreshCount++;
    predPurpleBtns.forEach(function (b) {
      var t = (b.textContent || '').trim().toUpperCase();
      if (t && t !== '...') excludedPhrases[t] = true;
    });
    speak('refreshing');
    rowIdx = PRED_PURPLE_ROW;
    mode = 'ROWS';
    setRowFocus(PRED_PURPLE_ROW);
    fetchPredsPhrasesOnly(true);
  }
  function resetExcluded() { excludedWords = {}; excludedPhrases = {}; }
  function notExclWord(w) { return !excludedWords[(w || '').toUpperCase()]; }
  function notExclPhrase(p) { return !excludedPhrases[(p || '').toUpperCase()]; }

  function doContextTts() {
    var talkingTo = personalCtx.talking_to;
    readFile(appDir + '\\keyboard_context.json').catch(function () { return null; })
      .then(function (j) {
        var msgs = [];
        if (j) {
          try { msgs = (JSON.parse(j).context || []).slice(-2); } catch (e) {}
        }
        var parts = [];
        if (talkingTo) parts.push('Replying to ' + talkingTo);
        if (msgs.length) {
          parts.push('Last ' + (msgs.length === 1 ? 'message' : '2 messages') + ': ' + msgs.join('. '));
        } else {
          parts.push('No recent messages');
        }
        speak(parts.join('. '));
      }).catch(function () {
        speak(talkingTo ? 'Replying to ' + talkingTo : 'No context available');
      });
  }

  function sendText() {
    var t = text.trim();
    if (!t) { speak('nothing to send'); return; }
    speak('sent');
    updateNgramsOnSend(t);
    var cb = sendCallback;
    if (cb) { try { cb(t); } catch (e) {} }
    closeKb(true, true);
  }
  function closeKb(silent, wasSent) {
    if (!silent) speak('close');
    open = false;
    if (overlayEl) overlayEl.classList.remove('active');
    try { window.speechSynthesis.cancel(); } catch (e) {}
    if (window.BenApp && window.BenApp.onKeyboardClosed) {
      setTimeout(function () { window.BenApp.onKeyboardClosed(!!wasSent); }, silent ? 0 : 200);
    }
  }

  /* ---------------- AI predictions (Claude primary) ---------------- */
  var schedTimer = null, currentPredId = 0;
  var predSpeakArmed = false;
  function schedulePreds(delay, speakWhenDone) {
    clearTimeout(schedTimer);
    schedTimer = setTimeout(function () { fetchPreds(speakWhenDone); }, delay || 120);
  }
  function fetchPreds(speakWhenDone) {
    var myId = ++currentPredId;
    predSpeakArmed = !!speakWhenDone;
    var snapRefresh = refreshCount;
    var partialWord = text.endsWith(' ') ? '' : (text.trim().split(/\s+/).pop() || '');
    // Claude only — no seed, no fallback shown in AI pred rows if Claude fails
    if (!apiKey) return;
    fetchClaude(text, snapRefresh, partialWord).then(function (result) {
      if (currentPredId !== myId) return;
      if ((result.words || []).length >= 2) applyPreds(result.words, result.phrases || []);
    }).catch(function () {});
  }
  function fetchPredsWordsOnly(speakWhenDone) {
    var myId = ++currentPredId;
    predSpeakArmed = !!speakWhenDone;
    var snapRefresh = refreshCount;
    var partialWord = text.endsWith(' ') ? '' : (text.trim().split(/\s+/).pop() || '');
    if (!apiKey) return;
    fetchClaude(text, snapRefresh, partialWord).then(function (result) {
      if (currentPredId !== myId) return;
      if ((result.words || []).length >= 2) applyPreds(result.words, null);
    }).catch(function () {});
  }
  function fetchPredsPhrasesOnly(speakWhenDone) {
    var myId = ++currentPredId;
    predSpeakArmed = !!speakWhenDone;
    var snapRefresh = refreshCount;
    var partialWord = text.endsWith(' ') ? '' : (text.trim().split(/\s+/).pop() || '');
    if (!apiKey) return;
    fetchClaude(text, snapRefresh, partialWord).then(function (result) {
      if (currentPredId !== myId) return;
      if ((result.phrases || []).length >= 2) applyPreds(null, result.phrases);
    }).catch(function () {});
  }

  /* ---------------- KenLM / ngrams bottom row ---------------- */
  var kenLMRowTimer = null, kenLMRowPredId = 0;
  function scheduleKenLMRow(delay) {
    clearTimeout(kenLMRowTimer);
    kenLMRowTimer = setTimeout(fetchKenLMRowPreds, delay || 150);
  }
  function fetchKenLMRowPreds() {
    var myId = ++kenLMRowPredId;

    // Nothing typed: show static defaults, no API call.
    if (!text.trim()) {
      for (var d = 0; d < kenLMRowBtns.length; d++) kenLMRowBtns[d].textContent = KENLM_DEFAULTS[d] || '';
      return;
    }

    var trailing = text.endsWith(' ');
    var partial = trailing ? '' : (text.trim().split(/\s+/).pop() || '');

    if (trailing) {
      // Word complete + space: predict NEXT word using bigrams/trigrams from ngrams.
      // localPredict handles this — ctx = preceding words, cur = '' → returns next-word candidates.
      applyKenLMRow(localPredict(text, 6));
    } else {
      // Partial word typed: KenLM for completions, ngrams as fallback.
      fetchKenLM(text).then(function (kw) {
        if (kenLMRowPredId !== myId) return;
        var filtered = kw.filter(function (w) { return w.startsWith(partial); }).filter(notExclWord);
        if (filtered.length >= 2) { applyKenLMRow(filtered.slice(0, 6)); return; }
        applyKenLMRow(localPredict(text, 6));
      }).catch(function () {
        if (kenLMRowPredId !== myId) return;
        applyKenLMRow(localPredict(text, 6));
      });
    }
  }
  function applyKenLMRow(words) {
    var padded = (words || []).filter(notExclWord).slice();
    for (var i = 0; i < KENLM_DEFAULTS.length && padded.length < 6; i++) {
      if (padded.indexOf(KENLM_DEFAULTS[i]) === -1) padded.push(KENLM_DEFAULTS[i]);
    }
    for (var k = 0; k < kenLMRowBtns.length; k++) kenLMRowBtns[k].textContent = padded[k] || '';
  }

  /* ---------------- ngrams update on send ---------------- */
  function updateNgramsOnSend(msg) {
    var words = msg.toUpperCase().split(/\s+/).filter(function (w) { return w && /^[A-Z]/.test(w); });
    if (!words.length) return;
    if (!ngrams) ngrams = { frequent_words: {}, bigrams: {}, trigrams: {} };
    var fw = ngrams.frequent_words, bi = ngrams.bigrams, tri = ngrams.trigrams;
    var ts = new Date().toISOString();
    // Build delta — only the new entries from this message
    var deltaFw = {}, deltaBi = {}, deltaTri = {};
    words.forEach(function (w) {
      if (!fw[w]) fw[w] = { count: 0 };
      fw[w].count++; fw[w].last_used = ts;
      if (!deltaFw[w]) deltaFw[w] = { count: 0 };
      deltaFw[w].count++;
    });
    for (var i = 0; i < words.length - 1; i++) {
      var bk = words[i] + ' ' + words[i + 1];
      if (!bi[bk]) bi[bk] = { count: 0 };
      bi[bk].count++; bi[bk].last_used = ts;
      if (!deltaBi[bk]) deltaBi[bk] = { count: 0 };
      deltaBi[bk].count++;
    }
    for (var j = 0; j < words.length - 2; j++) {
      var tk = words[j] + ' ' + words[j + 1] + ' ' + words[j + 2];
      if (!tri[tk]) tri[tk] = { count: 0 };
      tri[tk].count++; tri[tk].last_used = ts;
      if (!deltaTri[tk]) deltaTri[tk] = { count: 0 };
      deltaTri[tk].count++;
    }
    if (!appDir || !window.benAPI || !window.benAPI.updateNgrams) return;
    var ngramFile = appDir + '\\..\\..\\..\\shared\\predictive_ngrams.json';
    window.benAPI.updateNgrams(ngramFile, { frequent_words: deltaFw, bigrams: deltaBi, trigrams: deltaTri, timestamp: ts });
  }
  function padTo5(words) {
    var out = (words || []).filter(notExclWord);
    // Pad with fallback words that haven't been shown yet.
    for (var i = 0; i < DEFAULTS.length; i++) { if (out.length >= 5) break; if (out.indexOf(DEFAULTS[i]) === -1 && notExclWord(DEFAULTS[i])) out.push(DEFAULTS[i]); }
    // Pool exhausted by exclusion -> allow already-shown fillers so it's never blank.
    for (var k = 0; k < DEFAULTS.length && out.length < 5; k++) { if (out.indexOf(DEFAULTS[k]) === -1) out.push(DEFAULTS[k]); }
    return out.slice(0, 5);
  }
  // Pad a phrase list up to 5 using the fallback phrase pool (rotated by the
  // current refresh count) so the purple row is always completely filled.
  function padPhrasesTo5(phrases, partialWord) {
    var out = (phrases || []).filter(notExclPhrase).slice(0, 5);
    var n = DEFAULT_PHRASES.length;
    for (var i = 0; i < n && out.length < 5; i++) {
      var p = DEFAULT_PHRASES[(i + refreshCount) % n];
      if (partialWord && p.split(' ')[0].indexOf(partialWord.toUpperCase()) !== 0) continue;
      if (out.indexOf(p) === -1 && notExclPhrase(p)) out.push(p);
    }
    // If a partial word filtered everything out, fall back to unfiltered pool
    // (still skipping already-shown phrases).
    for (var k = 0; k < n && out.length < 5; k++) {
      var q = DEFAULT_PHRASES[(k + refreshCount) % n];
      if (out.indexOf(q) === -1 && notExclPhrase(q)) out.push(q);
    }
    // Pool exhausted by exclusion -> allow already-shown fillers so it's never blank.
    for (var m = 0; m < n && out.length < 5; m++) {
      var r = DEFAULT_PHRASES[(m + refreshCount) % n];
      if (out.indexOf(r) === -1) out.push(r);
    }
    return out.slice(0, 5);
  }
  // Build local two-word phrases: context bigrams (when available) plus the
  // rotated fallback pool, so the purple row is filled instantly.
  function localPhrases(count, rotate, partialWord) {
    count = count || 5;
    var out = [];
    try {
      var up = text.toUpperCase();
      var trailing = text.endsWith(' ');
      var parts = up.trim().split(/\s+/).filter(function (x) { return x; });
      var lastWord = trailing ? (parts.length ? parts[parts.length - 1] : '')
        : (parts.length >= 2 ? parts[parts.length - 2] : '');
      if (!partialWord && ngrams && ngrams.bigrams && lastWord) {
        var key = lastWord + ' ';
        var big = ngrams.bigrams;
        Object.keys(big)
          .filter(function (kk) { return kk.indexOf(key) === 0; })
          .sort(function (a, b) { return ((big[b].count) || 1) - ((big[a].count) || 1); })
          .forEach(function (p) { if (out.indexOf(p) === -1 && out.length < count) out.push(p); });
      }
    } catch (e) {}
    return padPhrasesTo5(out, partialWord).slice(0, count);
  }
  function applyPreds(words, phrases) {
    var before = predWordsLabel() + '|' + predPhrasesLabel();
    // null = leave that row unchanged; array (even empty) = update and pad
    if (words !== null && words !== undefined) {
      var w = padTo5(words);
      for (var i = 0; i < 5; i++) predGreenBtns[i].textContent = w[i] || '';
    }
    if (phrases !== null && phrases !== undefined) {
      var p = padPhrasesTo5(phrases);
      for (var j = 0; j < 5; j++) predPurpleBtns[j].textContent = p[j] || '';
    }
    if (predSpeakArmed && (rowIdx === PRED_ROW || rowIdx === PRED_PURPLE_ROW) && mode === 'ROWS' && predWordsLabel() + '|' + predPhrasesLabel() !== before) {
      scheduleSettledPredSpeak();
    }
  }
  function fetchKenLM(txt) {
    var q = txt.trim() || ' ';
    var url = 'https://api.imagineville.org/word/predict?text=' + encodeURIComponent(q) + '&n=10&sort=logprob&safe=true&lang=en';
    return fetch(url).then(function (r) { return r.ok ? r.json() : []; }).then(function (d) {
      var arr = d.results || d.predictions || d.words || [];
      return arr.slice(0, 10).map(function (x) {
        return typeof x === 'string' ? x.toUpperCase() : (x.word || x.text || '').toUpperCase();
      }).filter(function (w) { return w && /^[A-Z]/.test(w); });
    }).catch(function () { return []; });
  }
  function fetchClaude(txt, snapRefresh, partialWord) {
    return Promise.all([
      readFile(appDir + '\\keyboard_context.json').catch(function () { return null; }),
      readFile(appDir + '\\recent_messages.json').catch(function () { return null; })
    ]).then(function (results) {
      var conversation = '';
      if (results[0]) { try { var d = JSON.parse(results[0]); conversation = (d.context || []).slice(-12).join('\n'); } catch (e) {} }
      if (!conversation && results[1]) {
        try { var d2 = JSON.parse(results[1]); conversation = (d2.messages || []).slice(-8).map(function (m) { return 'ME: ' + m; }).join('\n'); } catch (e) {}
      }
      // Personalised background: who Ben is talking to, his contacts, and the
      // words/interests he uses most. Helps Claude suggest names and on-topic
      // vocabulary instead of generic words.
      var personal = '';
      if (personalCtx.talking_to) personal += '\nBen is currently talking to: ' + personalCtx.talking_to + '.';
      if (personalCtx.contacts && personalCtx.contacts.length) personal += '\nPeople Ben talks to (use their names when relevant): ' + personalCtx.contacts.slice(0, 15).join(', ') + '.';
      if (personalCtx.recent_words && personalCtx.recent_words.length) personal += '\nWords & topics Ben uses often: ' + personalCtx.recent_words.slice(0, 30).join(', ') + '.';
      var avoid = Object.keys(excludedWords).concat(Object.keys(excludedPhrases));
      var hint = '';
      if (snapRefresh > 0) {
        hint = '\n[Refresh #' + snapRefresh + ': the user wants COMPLETELY DIFFERENT suggestions.';
        if (avoid.length) hint += ' Do NOT repeat any of these already-shown options: ' + avoid.slice(0, 50).join(', ') + '.';
        hint += ' Give fresh, unique words and phrases.]';
      }
      var isPartial = partialWord && partialWord.length > 0;
      var sys, userMsg;
      if (isPartial) {
        sys = 'You are an AAC word-completion assistant for Ben who types in ALL CAPS.\n' +
          'The user is still typing the word "' + partialWord + '" — they have NOT finished it yet.\n' +
          'Your ONLY job is to complete this partial fragment.\n' +
          'Prefer the names of people Ben talks to and words he uses often when they match.\n' +
          'Return ONLY valid JSON:\n' +
          '  "words": 5 complete words that START WITH "' + partialWord + '" (no spaces inside, each word must begin with "' + partialWord + '")\n' +
          '  "phrases": 5 two-word phrases where the FIRST word starts with "' + partialWord + '" (exactly one space each)\n' +
          'All uppercase. Do NOT predict what word comes AFTER "' + partialWord + '" — only complete it.\n' +
          'Example for "HE": {"words":["HELLO","HER","HIM","HELP","HERE"],"phrases":["HELLO THERE","HELP ME","HER NAME","HE IS","HERE NOW"]}';
        userMsg = 'Fragment to complete: "' + partialWord + '"\n' +
          'Personal context:' + (personal || ' (none)') + '\n' +
          'Conversation context:\n' + (conversation || '(none)') + hint + '\n\n' +
          'Return words and phrases that all begin with "' + partialWord + '".';
      } else {
        var compose = txt.trim() ? 'Text typed so far: "' + txt.trim() + '"' : '(Starting a new message)';
        sys = 'You are a word predictor for Ben, an AAC user who types in ALL CAPS.\n' +
          'Return ONLY valid JSON with two arrays:\n' +
          '  "words": 5 SINGLE next words to say after the typed text (no spaces inside)\n' +
          '  "phrases": 5 TWO-WORD phrases to say next (exactly one space each, e.g. "I AM")\n' +
          'All uppercase. Be contextually relevant to the conversation and to Ben\'s\n' +
          'personal context — use the names of people he is talking to and the\n' +
          'topics/words he uses often when they fit.\n' +
          'Example: {"words":["GOOD","FINE","WELL","HAPPY","OKAY"],"phrases":["I AM","FEEL GOOD","I THINK","NOT SURE","LOVE YOU"]}';
        userMsg = 'Personal context:' + (personal || ' (none)') + '\n\n' +
          'Conversation:\n' + (conversation || '(none)') + '\n\n' + compose + hint + '\n\nPredict the next 5 single words and 5 two-word phrases.';
      }
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 220, temperature: 0.85,
          system: sys, messages: [{ role: 'user', content: userMsg }]
        })
      }).then(function (r) { return r.ok ? r.json() : []; }).then(function (d) {
        var raw = (d.content && d.content[0] && d.content[0].text || '').trim();
        var match = raw.match(/\{[\s\S]*\}/);
        if (!match) return { words: [], phrases: [] };
        var parsed = JSON.parse(match[0]);
        var cw = function (w) { return String(w).toUpperCase().replace(/[^A-Z' \-]/g, '').trim(); };
        var words = (parsed.words || []).map(cw).filter(function (w) { return w && w.indexOf(' ') === -1; }).slice(0, 5);
        var phrases = (parsed.phrases || []).map(cw).filter(function (w) { return w && w.indexOf(' ') !== -1; }).slice(0, 5);
        return { words: words, phrases: phrases };
      }).catch(function () { return { words: [], phrases: [] }; });
    });
  }
  function localPredict(rawText, limit) {
    limit = limit || 10;
    var up = rawText.toUpperCase();
    var trailing = rawText.endsWith(' ');
    var parts = up.trim().split(/\s+/).filter(function (x) { return x; });
    var cur = trailing ? '' : (parts.length ? parts.pop() : '');
    var ctx = parts;
    // Personalised completions (contacts + Ben's frequent words) that start
    // with what he's typing — e.g. "AR" -> "ARI". These are high value, so they
    // go to the front.
    var personalMatches = (cur && personalWords.length)
      ? personalWords.filter(function (w) { return w.indexOf(cur) === 0 && w !== cur; })
      : [];
    if (!ngrams) {
      if (!cur) return personalWords.slice(0, 3).concat(DEFAULTS).slice(0, limit);
      var mDef = DEFAULTS.filter(function (w) { return w.startsWith(cur); });
      var base0 = personalMatches.concat(mDef);
      return base0.concat(DEFAULTS.filter(function (w) { return base0.indexOf(w) === -1; })).slice(0, limit);
    }
    var scores = {};
    if (ctx.length >= 2) {
      var key2 = ctx.slice(-2).join(' ') + ' ';
      var trig = ngrams.trigrams || {};
      Object.keys(trig).forEach(function (k) {
        if (k.startsWith(key2)) { var nxt = k.split(' ').pop(); if (!cur || nxt.startsWith(cur)) scores[nxt] = (scores[nxt] || 0) + 10 * ((trig[k].count) || 1); }
      });
    }
    if (ctx.length >= 1) {
      var key1 = ctx[ctx.length - 1] + ' ';
      var big = ngrams.bigrams || {};
      Object.keys(big).forEach(function (k) {
        if (k.startsWith(key1)) { var nxt = k.split(' ').pop(); if (!cur || nxt.startsWith(cur)) scores[nxt] = (scores[nxt] || 0) + 5 * ((big[k].count) || 1); }
      });
    }
    if (cur && Object.keys(scores).length === 0) {
      var fw = ngrams.frequent_words || {};
      Object.keys(fw).forEach(function (w) { if (w.startsWith(cur)) scores[w] = (scores[w] || 0) + ((fw[w].count) || 1); });
    }
    var sorted = Object.keys(scores).sort(function (a, b) { return scores[b] - scores[a]; });
    // Front-load personalised matches (names/interests) so they're never buried.
    var out = [];
    personalMatches.forEach(function (w) { if (out.indexOf(w) === -1) out.push(w); });
    sorted.forEach(function (w) { if (out.indexOf(w) === -1) out.push(w); });
    DEFAULTS.forEach(function (w) { if (out.length < limit && out.indexOf(w) === -1) out.push(w); });
    return out.slice(0, limit);
  }

  /* ---------------- key handling (scan) ---------------- */
  var spaceDown = false, spaceAt = 0, spaceTimer = null, spaceFired = false, spaceInterval = null;
  var enterDown = false, enterAt = 0, enterTimer = null, enterFired = false;

  // Backward scan timing follows the user's configured scan speed (NarbeScanManager):
  // hold for one interval to start, then step back once per interval until released.
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
    if (!open) return;
    if (e.code === 'Space') {
      e.preventDefault();
      // Keep this event from also reaching the app's document handler — when the
      // keyboard closes mid-keypress the app would otherwise re-process it.
      e.stopImmediatePropagation();
      if (spaceDown) return;
      spaceDown = true; spaceAt = Date.now(); spaceFired = false;
      spaceTimer = setTimeout(function () {
        spaceFired = true;
        mode === 'ROWS' ? rowPrev() : keyPrev();
        spaceInterval = setInterval(function () { mode === 'ROWS' ? rowPrev() : keyPrev(); }, scanInterval());
      }, scanInterval());
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (enterDown) return;
      enterDown = true; enterAt = Date.now(); enterFired = false;
      var capturedMode = mode;
      // In cell-select (KEYS) mode: hold 5 s to escape back to row scan at the current row.
      // In row scan (ROWS) mode: hold one scan interval to jump to the predictions row.
      enterTimer = setTimeout(function () {
        enterFired = true;
        if (capturedMode === 'KEYS') {
          mode = 'ROWS';
          setRowFocus(rowIdx);
          speak(rowLabel(rowIdx));
        } else {
          jumpToPreds();
          announceRow(PRED_ROW);
        }
      }, capturedMode === 'KEYS' ? 5000 : scanInterval());
    }
  }
  function onKeyUp(e) {
    if (!open) return;
    if (e.code === 'Space') {
      e.preventDefault();
      e.stopImmediatePropagation();
      clearTimeout(spaceTimer); clearInterval(spaceInterval); spaceInterval = null;
      if (!spaceFired && Date.now() - spaceAt >= SHORT_MIN) { mode === 'ROWS' ? rowNext() : keyNext(); }
      spaceDown = false; spaceFired = false;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      clearTimeout(enterTimer);
      if (!enterFired && Date.now() - enterAt >= SHORT_MIN) { mode === 'ROWS' ? enterRow() : activateKey(); }
      enterDown = false;
    }
  }
  function onCancelled() {
    // narbe-input-cancelled from scan-manager (too-short press): reset latch state
    clearTimeout(spaceTimer); clearInterval(spaceInterval); spaceInterval = null;
    clearTimeout(enterTimer);
    spaceDown = false; spaceFired = false; enterDown = false; enterFired = false;
  }

  /* ---------------- lifecycle ---------------- */
  function loadConfigOnce() {
    var cfgP = (window.benAPI && window.benAPI.getConfig) ? window.benAPI.getConfig() : Promise.resolve({ appDir: '' });
    return cfgP.then(function (cfg) {
      appDir = (cfg && cfg.appDir) || '';
      return readFile(appDir + '\\ai_key.json');
    }).then(function (kj) {
      if (kj) { try { var d = JSON.parse(kj); apiKey = (d.api_key || '').trim(); } catch (e) {} }
      readFile(appDir + '\\..\\..\\..\\shared\\predictive_ngrams.json').then(function (jt) {
        if (!jt) return;
        try {
          var d = JSON.parse(jt);
          function up(o) { if (!o) return {}; var r = {}; Object.keys(o).forEach(function (k) { r[k.toUpperCase()] = o[k]; }); return r; }
          ngrams = { frequent_words: up(d.frequent_words), bigrams: up(d.bigrams), trigrams: up(d.trigrams) };
        } catch (e) {}
      }).catch(function () {});
      return readFile(appDir + '\\..\\..\\..\\shared\\voice-settings.json');
    }).then(function (vj) {
      if (vj) {
        try {
          var vs = JSON.parse(vj);
          voiceRate = vs.rate || 1.0;
          var voices = window.speechSynthesis.getVoices();
          if (voices && voices.length) selectVoice(vs);
          else window.speechSynthesis.onvoiceschanged = function () { selectVoice(vs); };
        } catch (e) {}
      }
      try { window.speechSynthesis.getVoices(); } catch (e) {}
    }).catch(function () {});
  }

  return {
    init: function () {
      if (!built) buildUI();
      overlayEl = document.getElementById('kb-overlay');
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
      document.addEventListener('narbe-input-cancelled', onCancelled);
      loadConfigOnce();
    },
    open: function (opts) {
      opts = opts || {};
      sendCallback = opts.onSend || null;
      text = '';
      mode = 'ROWS';
      rowIdx = PRED_ROW;
      refreshCount = 0;
      updateDisplay();
      setRowFocus(PRED_ROW);
      open = true;
      overlayEl.classList.add('active');
      // Refresh personalised context (contacts/frequent words), then predict.
      // Re-run predictions once it loads so names like "ARI" are available.
      loadPersonalContext().then(function () { if (open) fetchPreds(true); });
      fetchPreds(true);
      fetchKenLMRowPreds();
    },
    close: function () { closeKb(true); },
    isOpen: function () { return open; }
  };
})();
