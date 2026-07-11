// ═══════════════════════════════════════════════════════════════════════════════
// BENNY'S BASEBALL 2 - Audio System
// Procedural SFX (Web Audio) + queued TTS narration through the shared
// NarbeVoiceManager. Structure mirrors BENNYSFOOTBALL/js/audio.js; the charge
// tone (startChargeSound/updateChargeSound/stopChargeSound) is ported in
// behavior from v1 baseball's AudioSystem for the hold-to-charge swing.
// ═══════════════════════════════════════════════════════════════════════════════

class AudioSystem {
    constructor() {
        this.ctx = null;
        this.settings = {
            musicEnabled: true,
            soundEnabled: true,
            musicMode: 'shuffle'   // 'shuffle' = random next track, 'loop' = repeat current
        };
        this.music = null;
        this.trackIndex = 0;
        this.loadSettings();
        this.musicCandidates = [
            'audio/music/music (1).mp3',
            'audio/music/music (2).mp3',
            'audio/music/music (3).mp3',
            'audio/music/music (4).mp3',
            'audio/music/music (5).mp3'
        ];
        this._chargeOsc = null;
        this._chargeGain = null;
        // v1's real samples (copied from the original game). Procedural
        // versions remain as fallbacks if a file fails to load.
        this.samples = {};
        [['hit', 'audio/baseballhit.wav', 0.4],
         ['swing', 'audio/swing.wav', 0.45],
         ['homer', 'audio/homerun.wav', 0.5]].forEach(([key, url, vol]) => {
            try {
                const a = new Audio(url);
                a.volume = vol;
                this.samples[key] = a;
            } catch (e) { /* ignore */ }
        });
    }

    loadSettings() {
        try {
            const raw = localStorage.getItem(LS_AUDIO);
            if (raw) Object.assign(this.settings, JSON.parse(raw));
        } catch (e) { /* ignore */ }
    }

    saveSettings() {
        try { localStorage.setItem(LS_AUDIO, JSON.stringify(this.settings)); }
        catch (e) { /* ignore */ }
    }

    ensureCtx() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) this.ctx = new AC();
        }
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
    }

    startMusic() {
        if (!this.settings.musicEnabled) return;
        if (this.music) { this.music.play().catch(() => {}); return; }
        this._tryTrack(0);
    }

    _tryTrack(i) {
        if (i >= this.musicCandidates.length) return;
        const audio = new Audio(this.musicCandidates[i]);
        audio.volume = 0.144;   // 20% quieter than the original 0.18
        audio.loop = false;
        audio.addEventListener('canplaythrough', () => {
            this.music = audio;
            if (this.settings.musicEnabled) audio.play().catch(() => {});
        }, { once: true });
        audio.addEventListener('ended', () => {
            if (this.settings.musicMode === 'loop') {
                // Loop: replay this same track
                audio.currentTime = 0;
                audio.play().catch(() => {});
                return;
            }
            // Shuffle: jump to a random different track
            let next = Math.floor(Math.random() * this.musicCandidates.length);
            if (this.musicCandidates.length > 1 && next === i) {
                next = (next + 1) % this.musicCandidates.length;
            }
            this.trackIndex = next;
            this.music = null;
            this._tryTrack(next);
        });
        audio.addEventListener('error', () => this._tryTrack(i + 1), { once: true });
        audio.load();
    }

    stopMusic() {
        if (this.music) { this.music.pause(); }
    }

    // Skip to the next music track (v1's pause-menu option)
    nextTrack() {
        if (this.music) { this.music.pause(); this.music = null; }
        this.trackIndex = (this.trackIndex + 1) % this.musicCandidates.length;
        if (this.settings.musicEnabled) this._tryTrack(this.trackIndex);
        return this.trackIndex + 1;
    }

    toggleMusic() {
        this.settings.musicEnabled = !this.settings.musicEnabled;
        this.saveSettings();
        if (this.settings.musicEnabled) this.startMusic();
        else this.stopMusic();
        return this.settings.musicEnabled;
    }

    toggleMusicMode() {
        this.settings.musicMode = this.settings.musicMode === 'loop' ? 'shuffle' : 'loop';
        this.saveSettings();
        return this.settings.musicMode;
    }

    toggleSound() {
        this.settings.soundEnabled = !this.settings.soundEnabled;
        this.saveSettings();
        return this.settings.soundEnabled;
    }

    // ─── Sound effects: v1 samples first, procedural fallback ───
    play(type) {
        if (!this.settings.soundEnabled) return;
        const sampleKey = { hit: 'hit', swing: 'swing', homer: 'homer' }[type];
        if (sampleKey && this.samples[sampleKey] && !this.samples[sampleKey].error) {
            try {
                const s = this.samples[sampleKey];
                s.currentTime = 0;
                s.play().catch(() => {});
                return;
            } catch (e) { /* fall through to procedural */ }
        }
        const ctx = this.ensureCtx();
        if (!ctx) return;

        const now = ctx.currentTime;
        const connect = (node, g) => { node.connect(g); g.connect(ctx.destination); };

        switch (type) {
            case 'scan': {
                // Quick blip — short triangle pulse
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'triangle'; o.frequency.setValueAtTime(520, now);
                g.gain.setValueAtTime(0.10, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
                connect(o, g); o.start(now); o.stop(now + 0.06);
                break;
            }
            case 'select': {
                // Two-note confirm chime
                [{ f: 660, t: 0 }, { f: 990, t: 0.07 }].forEach(({ f, t }) => {
                    const o = ctx.createOscillator(), g = ctx.createGain();
                    o.type = 'square'; o.frequency.setValueAtTime(f, now + t);
                    g.gain.setValueAtTime(0.13, now + t); g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.13);
                    connect(o, g); o.start(now + t); o.stop(now + t + 0.14);
                });
                break;
            }
            case 'swing': {
                // Bat whoosh — falling filtered noise sweep
                const len = Math.floor(ctx.sampleRate * 0.16);
                const buf = ctx.createBuffer(1, len, ctx.sampleRate);
                const d = buf.getChannelData(0);
                for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.6;
                const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
                bp.frequency.setValueAtTime(1400, now);
                bp.frequency.exponentialRampToValueAtTime(300, now + 0.15);
                const src = ctx.createBufferSource(), g = ctx.createGain();
                g.gain.setValueAtTime(0.24, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
                src.buffer = buf; src.connect(bp); bp.connect(g); g.connect(ctx.destination);
                src.start(now);
                break;
            }
            case 'hit': {
                // Crack of the bat — sharp noise snap + bright ping
                const len = Math.floor(ctx.sampleRate * 0.05);
                const buf = ctx.createBuffer(1, len, ctx.sampleRate);
                const d = buf.getChannelData(0);
                for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
                const src = ctx.createBufferSource(), g = ctx.createGain();
                g.gain.setValueAtTime(0.34, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
                connect(src, g); src.buffer = buf; src.start(now);
                const o = ctx.createOscillator(), g2 = ctx.createGain();
                o.type = 'triangle'; o.frequency.setValueAtTime(1500, now);
                o.frequency.exponentialRampToValueAtTime(700, now + 0.09);
                g2.gain.setValueAtTime(0.16, now); g2.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
                connect(o, g2); o.start(now); o.stop(now + 0.11);
                break;
            }
            case 'bigHit': {
                // Monster contact for home runs — deeper crack, louder
                this.play('hit');
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'sine'; o.frequency.setValueAtTime(110, now);
                o.frequency.exponentialRampToValueAtTime(45, now + 0.16);
                g.gain.setValueAtTime(0.26, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
                connect(o, g); o.start(now); o.stop(now + 0.19);
                break;
            }
            case 'catch': {
                // Glove pop — noise slap + soft ping
                const len = Math.floor(ctx.sampleRate * 0.04);
                const buf = ctx.createBuffer(1, len, ctx.sampleRate);
                const d = buf.getChannelData(0);
                for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.9;
                const src = ctx.createBufferSource(), g = ctx.createGain();
                g.gain.setValueAtTime(0.28, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
                connect(src, g); src.buffer = buf; src.start(now);
                const o2 = ctx.createOscillator(), g2 = ctx.createGain();
                o2.type = 'triangle'; o2.frequency.setValueAtTime(900, now);
                g2.gain.setValueAtTime(0.12, now); g2.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
                connect(o2, g2); o2.start(now); o2.stop(now + 0.11);
                break;
            }
            case 'throw': {
                // Arm whip + ball hiss (same recipe as football's throw)
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'sine'; o.frequency.setValueAtTime(750, now);
                o.frequency.exponentialRampToValueAtTime(180, now + 0.22);
                g.gain.setValueAtTime(0.13, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
                connect(o, g); o.start(now); o.stop(now + 0.23);
                const len2 = Math.floor(ctx.sampleRate * 0.18);
                const buf2 = ctx.createBuffer(1, len2, ctx.sampleRate);
                const d2 = buf2.getChannelData(0);
                for (let i = 0; i < len2; i++) d2[i] = (Math.random() * 2 - 1) * (1 - i / len2) * 0.4;
                const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 2200;
                const src2 = ctx.createBufferSource(), g2 = ctx.createGain();
                g2.gain.setValueAtTime(0.10, now); g2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
                src2.buffer = buf2; src2.connect(hf); hf.connect(g2); g2.connect(ctx.destination);
                src2.start(now);
                break;
            }
            case 'tag': {
                // Slide/tag collision — layered dirt-crunch thud
                for (let layer = 0; layer < 2; layer++) {
                    const len = Math.floor(ctx.sampleRate * (0.09 + layer * 0.05));
                    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
                    const d = buf.getChannelData(0);
                    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, layer === 0 ? 2 : 1.2);
                    const src = ctx.createBufferSource(), g = ctx.createGain();
                    g.gain.setValueAtTime(layer === 0 ? 0.28 : 0.18, now + layer * 0.02);
                    g.gain.exponentialRampToValueAtTime(0.001, now + (layer === 0 ? 0.12 : 0.16));
                    connect(src, g); src.buffer = buf; src.start(now + layer * 0.02);
                }
                const o3 = ctx.createOscillator(), g3 = ctx.createGain();
                o3.type = 'sine'; o3.frequency.setValueAtTime(70, now);
                o3.frequency.exponentialRampToValueAtTime(32, now + 0.11);
                g3.gain.setValueAtTime(0.18, now); g3.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
                connect(o3, g3); o3.start(now); o3.stop(now + 0.14);
                break;
            }
            case 'homer': {
                // Celebration fanfare — 4-note ascending, then crowd roar
                [{ f: 523, t: 0 }, { f: 659, t: 0.14 }, { f: 784, t: 0.28 }, { f: 1047, t: 0.42 }].forEach(({ f, t }) => {
                    const o = ctx.createOscillator(), g = ctx.createGain();
                    o.type = 'square'; o.frequency.setValueAtTime(f, now + t);
                    g.gain.setValueAtTime(0.18, now + t); g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.28);
                    connect(o, g); o.start(now + t); o.stop(now + t + 0.30);
                });
                setTimeout(() => this.play('crowd_big'), 540);
                break;
            }
            case 'fail': {
                // Sad trombone slide down
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'sawtooth'; o.frequency.setValueAtTime(340, now);
                o.frequency.linearRampToValueAtTime(180, now + 0.35);
                o.frequency.linearRampToValueAtTime(110, now + 0.55);
                g.gain.setValueAtTime(0.15, now); g.gain.setValueAtTime(0.13, now + 0.45);
                g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
                connect(o, g); o.start(now); o.stop(now + 0.62);
                break;
            }
            case 'crowd': {
                // Moderate crowd noise burst
                const len = Math.floor(ctx.sampleRate * 0.45);
                const buf = ctx.createBuffer(1, len, ctx.sampleRate);
                const d = buf.getChannelData(0);
                for (let i = 0; i < len; i++) {
                    const env = i < len * 0.15 ? i / (len * 0.15) : (1 - (i - len * 0.15) / (len * 0.85));
                    d[i] = (Math.random() * 2 - 1) * env * 0.5;
                }
                const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
                lp.type = 'lowpass'; lp.frequency.value = 1800;
                g.gain.setValueAtTime(0.12, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
                src.buffer = buf; src.connect(lp); lp.connect(g); g.connect(ctx.destination);
                src.start(now);
                break;
            }
            case 'crowd_big': {
                // Roaring crowd for big plays
                const len = Math.floor(ctx.sampleRate * 1.4);
                const buf = ctx.createBuffer(1, len, ctx.sampleRate);
                const d = buf.getChannelData(0);
                for (let i = 0; i < len; i++) {
                    const env = i < len * 0.2 ? i / (len * 0.2) : Math.pow(1 - (i - len * 0.2) / (len * 0.8), 0.6);
                    d[i] = (Math.random() * 2 - 1) * env * 0.75;
                }
                const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
                lp.type = 'bandpass'; lp.frequency.value = 900; lp.Q.value = 0.5;
                g.gain.setValueAtTime(0.18, now);
                src.buffer = buf; src.connect(lp); lp.connect(g); g.connect(ctx.destination);
                src.start(now);
                break;
            }
            case 'swingZone': {
                // v1's friendly two-note ascending chirp while the ball is in
                // the strike zone (E5 → A5)
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'sine'; o.frequency.setValueAtTime(660, now);
                g.gain.setValueAtTime(0.15, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
                connect(o, g); o.start(now); o.stop(now + 0.12);
                const o2 = ctx.createOscillator(), g2 = ctx.createGain();
                o2.type = 'sine'; o2.frequency.setValueAtTime(880, now + 0.08);
                g2.gain.setValueAtTime(0.15, now + 0.08); g2.gain.exponentialRampToValueAtTime(0.001, now + 0.23);
                connect(o2, g2); o2.start(now + 0.08); o2.stop(now + 0.23);
                break;
            }
            case 'ring': {
                // Bright bell ring — "let go NOW, this is the sweet spot!"
                // Fundamental + soft octave overtone with a bell-like decay.
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'sine'; o.frequency.setValueAtTime(1318, now);
                g.gain.setValueAtTime(0.001, now);
                g.gain.linearRampToValueAtTime(0.17, now + 0.012);
                g.gain.exponentialRampToValueAtTime(0.001, now + 0.30);
                connect(o, g); o.start(now); o.stop(now + 0.31);
                const o2 = ctx.createOscillator(), g2 = ctx.createGain();
                o2.type = 'sine'; o2.frequency.setValueAtTime(2637, now);
                g2.gain.setValueAtTime(0.001, now);
                g2.gain.linearRampToValueAtTime(0.06, now + 0.012);
                g2.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
                connect(o2, g2); o2.start(now); o2.stop(now + 0.21);
                break;
            }
            default: break;
        }
    }

    // ─── Charge tones for hold-to-swing — ported exactly from v1 AudioSystem:
    // a discrete rising beep each time the charge crosses 25/50/75/100%
    // (C5, E5, G5, C6), not a continuous tone.
    startChargeSound() {
        this._lastChargeStep = 0;
    }

    // percent: 0..1 of max charge (6 second hold)
    updateChargeSound(percent) {
        if (!this.settings.soundEnabled) return;
        const step = Math.floor(percent * 4);
        if (step > this._lastChargeStep && step > 0 && step <= 4) {
            this._playChargeBeep(step);
            this._lastChargeStep = step;
        }
    }

    _playChargeBeep(step) {
        const ctx = this.ensureCtx();
        if (!ctx) return;
        const freqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freqs[step - 1] || freqs[freqs.length - 1];
        const now = ctx.currentTime;
        g.gain.setValueAtTime(0.18, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        o.connect(g); g.connect(ctx.destination);
        o.start(now); o.stop(now + 0.12);
    }

    stopChargeSound() {
        // Discrete beeps — nothing continuous to stop (v1 parity)
        this._lastChargeStep = 0;
    }

    // ─── Text-to-speech: NO QUEUE, EVER ─────────────────────────────────────
    //  • interrupt=true (menu scanning, charge callouts — user-driven cues):
    //    cancels whatever is speaking and says the new line immediately.
    //  • gameplay narration (default): speaks now if the voice is idle. If
    //    it's busy — almost always the "Bunt"/"Normal swing"/"Power swing"
    //    charge callout still finishing, since a power swing routinely gets
    //    released within a couple hundred ms of that cue — it gets ONE
    //    bounded retry ~400ms later instead of being dropped outright. This
    //    is not a queue: at most one retry is ever pending per call, and if
    //    a newer line has already been requested by the time the retry
    //    fires, the stale one is abandoned rather than talking over it.
    speak(text, interrupt = false) {
        if (!text) return;
        if (!('speechSynthesis' in window)) return;
        this._speakReqId = (this._speakReqId || 0) + 1;
        const reqId = this._speakReqId;
        if (interrupt) {
            this._speaking = false;
            clearTimeout(this._speakTimer);
            clearTimeout(this._retryTimer);
            clearTimeout(this._speakSafetyTimer);
            try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
            // Defer so the browser fully processes the cancel first
            this._speakTimer = setTimeout(() => {
                if (this._speakReqId !== reqId) return; // superseded already
                this._sayNow(String(text));
            }, 50);
            return;
        }
        this._trySpeak(String(text), reqId, false);
    }

    _trySpeak(text, reqId, isRetry) {
        if (this._speaking) {
            if (!isRetry) {
                clearTimeout(this._retryTimer);
                this._retryTimer = setTimeout(() => {
                    if (this._speakReqId !== reqId) return; // a newer line replaced this one
                    this._trySpeak(text, reqId, true);
                }, 400);
            }
            return; // busy on the retry attempt too → give up, never queue
        }
        this._sayNow(text);
    }

    _sayNow(text) {
        // Borrow voice + rate/pitch/volume from the shared manager when present.
        let voice = null, rate = 1.0, pitch = 1.0, volume = 1.0;
        const vm = window.NarbeVoiceManager;
        if (vm && typeof vm.getSettings === 'function') {
            const s = vm.getSettings() || {};
            if (s.ttsEnabled === false) return;
            rate = s.rate || 1.0;
            pitch = s.pitch || 1.0;
            volume = (s.volume != null) ? s.volume : 1.0;
            if (typeof vm.getCurrentVoice === 'function') voice = vm.getCurrentVoice();
        }
        const ttsText = (vm && typeof vm.processTextForTTS === 'function') ? vm.processTextForTTS(text) : text;
        const u = new SpeechSynthesisUtterance(ttsText);
        u.rate = rate; u.pitch = pitch; u.volume = volume;
        if (voice) u.voice = voice;
        this._speaking = true;
        this._speakGen = (this._speakGen || 0) + 1;
        const gen = this._speakGen;
        const done = () => {
            if (this._speakGen !== gen) return;
            this._speaking = false;
            clearTimeout(this._speakSafetyTimer);
        };
        u.onend = done;
        u.onerror = done;
        // Safety net: some engines can leave onend/onerror from ever firing
        // (e.g. after a rapid cancel+speak from cursor scanning) which would
        // otherwise wedge _speaking = true forever and silently kill every
        // future narration line. Force-clear after a generous ceiling.
        clearTimeout(this._speakSafetyTimer);
        const estMs = Math.min(7000, Math.max(1200, ttsText.length * 90));
        this._speakSafetyTimer = setTimeout(done, estMs);
        try { speechSynthesis.speak(u); } catch (e) { this._speaking = false; }
    }
}
