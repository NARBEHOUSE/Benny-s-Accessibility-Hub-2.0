// --- Configuration & Constants ---
const themes = [
    { name: 'Default', bg: 'linear-gradient(135deg, #ff4b1f, #ff9068)', highlight: '#ffff00' },
    { name: 'Ocean', bg: 'linear-gradient(135deg, #2193b0, #6dd5ed)', highlight: '#ffffff' },
    { name: 'Midnight', bg: 'linear-gradient(135deg, #232526, #414345)', highlight: '#00ff00' },
    { name: 'Forest', bg: 'linear-gradient(135deg, #134e5e, #71b280)', highlight: '#ffcc00' },
    { name: 'Sunset', bg: 'linear-gradient(135deg, #f12711, #f5af19)', highlight: '#ffff00' },
    { name: 'Lavender', bg: 'linear-gradient(135deg, #834d9b, #d04ed6)', highlight: '#00ffff' },
    { name: 'Mint', bg: 'linear-gradient(135deg, #00b09b, #96c93d)', highlight: '#ffffff' },
    { name: 'Dark Blue', bg: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)', highlight: '#00ffcc' }
];

const highlightColors = [
    { name: 'Theme Default', val: 'var(--theme-highlight)' },
    { name: 'Yellow', val: '#ffff00' },
    { name: 'White', val: '#ffffff' },
    { name: 'Cyan', val: '#00ffff' },
    { name: 'Lime', val: '#00ff00' },
    { name: 'Magenta', val: '#ff00ff' },
    { name: 'Orange', val: '#ffa500' },
    { name: 'Blue', val: '#3366ff' }, 
    { name: 'Red', val: '#ff0000' },
    { name: 'Pink', val: '#ffc0cb' },
    { name: 'Purple', val: '#cc33ff' }
];

const scanSpeeds = [
    { label: '1s', val: 1000, spoken: '1 second' },
    { label: '2s', val: 2000, spoken: '2 seconds' },
    { label: '3s', val: 3000, spoken: '3 seconds' },
    { label: '5s', val: 5000, spoken: '5 seconds' }
];

const difficulties = {
    casual: [2, 3, 4, 5, 6, 7],
    challenge: [
        { label: "Easy", hp: 5 },
        { label: "Medium", hp: 3 },
        { label: "Hard", hp: 2 }
    ]
};

// --- Game Class ---
class WordJumbleGame {
    constructor() {
        // Data & State
        this.wordsData = [];
        this.currentWordObj = null;
        this.targetWord = "";
        this.jumbledLetters = [];
        this.currentGuess = [];
        this.usedWords = new Set();
        
        // Settings with Defaults
        this.settings = {
            themeIndex: 0,
            tts: true,
            autoScan: false, 
            scanSpeedIndex: 1, 
            highlightStyle: 'outline',
            highlightColorIndex: 0,
            dataSource: 'online' // 'online', 'local', 'all'
        };

        // Scoring State
        this.score = 0;
        this.combo = 0;
        this.highScore = 0;
        this.customFileName = "";

        // Game Mode State & Menu State
        this.gameMode = 'casual'; 
        this.currentLevelLength = 0; 
        this.casualSelectedLength = 3; // Default selection for toggle
        this.challengeSelectedDifficultyIndex = 0; // Default Easy
        
        // Challenge specific state
        this.maxHP = 5;
        this.currentHP = 5;
        this.levelProgress = 0;
        this.wordsPerLevel = 5;
        
        // Core State
        this.state = {
            mode: 'menu', 
            menuIndex: 0,
            scanIndex: 0,
            pauseIndex: 0,
            settingsIndex: 0,
            modeSelectIndex: 0,
            
            menuButtons: [],
            
            input: { spaceHeld: false, enterHeld: false, spaceTime: 0, enterTime: 0 },
            timers: { space: null, spaceRepeat: null, enter: null, autoScan: null }
        };

        this.mainContent = document.getElementById('main-content');
        this.createPauseOverlay();
        
        // Initialize Audio Context for System Sounds
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        this.loadSettings();
        this.init();
    }

    playSystemSound(type) {
        if (!this.settings.tts) return; // Actually this is sound, but we lack a separate sound toggle in Word Jumble? 
        // Let's assume TTS toggle controls overall sound for now or add a sound toggle. 
        // User asked for "sound just like matchy match".
        
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        
        const now = this.audioCtx.currentTime;

        if (type === 'hp-up') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start();
            osc.stop(now + 0.1);
        } else if (type === 'hp-down') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start();
            osc.stop(now + 0.2);
        } else if (type === 'success') {
            // Trivia Master Success Sound
            const tones = [
                { f: 600, type: 'sine', dur: 0.1, start: 0 },
                { f: 800, type: 'sine', dur: 0.2, start: 0.1 },
                { f: 1200, type: 'sine', dur: 0.4, start: 0.2 }
            ];
            
            tones.forEach(t => {
                const o = this.audioCtx.createOscillator();
                const g = this.audioCtx.createGain();
                o.connect(g);
                g.connect(this.audioCtx.destination);
                o.type = t.type;
                o.frequency.value = t.f;
                
                g.gain.setValueAtTime(0, now + t.start);
                g.gain.linearRampToValueAtTime(0.1, now + t.start + 0.01);
                g.gain.linearRampToValueAtTime(0.1, now + t.start + t.dur - 0.05);
                g.gain.linearRampToValueAtTime(0, now + t.start + t.dur);
                
                o.start(now + t.start);
                o.stop(now + t.start + t.dur);
            });
        }
    }

    createPauseOverlay() {
        this.pauseOverlay = document.createElement('div');
        this.pauseOverlay.className = 'pause-overlay';
        this.pauseOverlay.style.display = 'none';
        this.pauseOverlay.id = 'pause-overlay';
        document.body.appendChild(this.pauseOverlay);
    }
    
    loadSettings() {
        try {
            const s = localStorage.getItem('wordjumble_settings_v2');
            if (s) {
                const parsed = JSON.parse(s);
                // Migration: server -> online
                if (parsed.dataSource === 'server') parsed.dataSource = 'online';
                // Validate dataSource
                if (!['online', 'local', 'all'].includes(parsed.dataSource)) parsed.dataSource = 'online';
                
                Object.assign(this.settings, parsed);
            }
            // Migrate old settings if needed or defaulting
            if (this.settings.scanSpeedIndex >= scanSpeeds.length) this.settings.scanSpeedIndex = 1;
            this.applyTheme();
        } catch(e) { console.error(e); }
    }
    
    saveSettings() {
        localStorage.setItem('wordjumble_settings_v2', JSON.stringify(this.settings));
    }
    
    getHighScoreKey() {
        let key = 'highscore_' + this.settings.dataSource;
        
        // Distinguish between server (default), local (saved custom), and custom (temp file)
        if (this.settings.dataSource === 'custom' && this.customFileName) {
            key = 'highscore_custom_' + this.customFileName;
        }
        
        // Track unique scores per difficulty level
        const diff = difficulties.challenge[this.challengeSelectedDifficultyIndex];
        if (diff) {
            key += '_' + diff.label;
        }
        
        return key;
    }

    loadHighScores() {
        try {
            const saved = localStorage.getItem('wordjumble_highscores');
            if (saved) {
                 const data = JSON.parse(saved);
                 this.highScore = data[this.getHighScoreKey()] || 0;
            } else {
                 this.highScore = 0;
            }
        } catch(e) { console.error(e); this.highScore = 0; }
    }

    saveHighScore() {
        if (this.gameMode !== 'challenge') return;
        
        if (this.score > this.highScore) {
             this.highScore = this.score;
        }
        
        try {
            const saved = localStorage.getItem('wordjumble_highscores');
            const data = saved ? JSON.parse(saved) : {};
            data[this.getHighScoreKey()] = this.highScore;
            localStorage.setItem('wordjumble_highscores', JSON.stringify(data));
        } catch(e) { console.error(e); }
    }

    applyTheme() {
        const t = themes[this.settings.themeIndex];
        document.body.style.background = t.bg;
        document.documentElement.style.setProperty('--theme-highlight', t.highlight);
        
        const hc = highlightColors[this.settings.highlightColorIndex];
        const val = hc.val === 'var(--theme-highlight)' ? t.highlight : hc.val;
        document.documentElement.style.setProperty('--highlight-color', val);
        
        const style = this.settings.highlightStyle || 'outline'; 
        // Update highlight style variables
        if (style === 'outline') {
            document.documentElement.style.setProperty('--highlight-bg-mode', '#ffffff');
            document.documentElement.style.setProperty('--highlight-text-mode', '#333333');
            document.documentElement.style.setProperty('--highlight-box-shadow', `0 0 1.5vh ${val}, inset 0 0 1vh rgba(255, 255, 255, 0.5)`);
        } else {
            document.documentElement.style.setProperty('--highlight-bg-mode', val);
            document.documentElement.style.setProperty('--highlight-text-mode', '#000000');
            document.documentElement.style.setProperty('--highlight-box-shadow', `0 0 2vh ${val}`);
        }
    }

    async init() {
        try {
            // 1. Fetch Default Server Data
            const response = await fetch('words.json');
            this.serverWords = await response.json();
        } catch (error) {
            console.error("Failed to load words.json", error);
            this.serverWords = []; // Fallback
        }

        // 2. Determine which data to use based on settings
        this.loadWordsSource();

        this.setupInput();
        this.showMainMenu();
    }
    
    // --- Helper for Source Management ---
    getAvailableSources() {
        const sources = [];
        
        // 1. Primary Online Source
        sources.push({ id: 'online_default', type: 'online', name: 'words' });
        
        // 2. Scan Local Storage for "wordjumble_list_"
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('wordjumble_list_')) {
                const name = key.replace('wordjumble_list_', '');
                sources.push({ id: key, type: 'local', name: name });
            }
        }
        
        // 3. Current Custom File (if loaded via upload and active)
        if (this.settings.dataSource === 'custom' && this.customFileName && this.wordsData.length > 0) {
            // Check if this source isn't already covered by a local one (though file upload usually implies volatile)
            // But if we toggle away, we might lose it if we don't store it.
            // For now, let's include it if it's the CURRENT one, or exclude it from the toggle loop?
            // User said: "toggle it to go through whatever is local or online"
            // "only shows the name of the json file"
            // If I upload a file, it becomes "Custom File name". If I toggle off it, I might lose it unless I saved it.
            // Let's add it to the list if we have it in memory, but give it a unique ID
            sources.push({ id: 'custom_session', type: 'custom', name: this.customFileName.replace('.json', '') });
        }
        
        return sources;
    }

    loadWordsSource() {
        // If dataSource is 'custom', 'local', 'online' etc string, we need to migrate or interpret it as an ID now?
        // Let's rely on 'currentSourceId' in settings. If missing, default to 'online_default'.
        // BUT wait, init logic calls this.settings.dataSource which might be the old enum.
        
        if (!this.settings.currentSourceId) {
             // Migration or default
             this.settings.currentSourceId = 'online_default';
        }
        
        const sources = this.getAvailableSources();
        let activeSource = sources.find(s => s.id === this.settings.currentSourceId);
        
        // If the ID is not found (e.g. was a custom file we toggled away from/lost, or a deleted local file), fallback
        if (!activeSource) {
            activeSource = sources[0];
            this.settings.currentSourceId = activeSource.id;
        }

        if (activeSource.type === 'online') {
            this.wordsData = this.serverWords || [];
            // If serverWords empty (failed load), we have empty list
        } else if (activeSource.type === 'local') {
            try {
                const data = localStorage.getItem(activeSource.id);
                this.wordsData = JSON.parse(data) || [];
            } catch(e) { 
                console.error("Failed to load local source", e);
                this.wordsData = [];
            }
        } else if (activeSource.type === 'custom') {
            // Ideally we already have it in this.wordsData if we are staying on it
            // If we toggled AWAY and came BACK, we might have lost it unless we cached it.
            // But we didn't cache it in this simple implementation.
            // So if we switch AWAY from custom, we should probably remove it from the list or warn.
            // For now, assume if it's 'custom_session', the data is still in variables?
            // Actually, if we switch TO another source, this.wordsData gets overwritten.
            // So we can't switch BACK to custom_session unless we stored it separately.
            // We won't support switching BACK to an unsaved custom upload. Upload = set active. Toggle = leave it.
            // Thus, we shouldn't add 'custom_session' to `sources` for toggling purposes if data is lost.
            // Actually, if I just uploaded, `this.wordsData` HAS data.
            // If I call loadWordsSource() to REFRESH, I keep it.
            // If I call toggle, I move to NEXT.
        }
        
        // Recalculate lengths/difficulties
        const lengths = new Set(this.wordsData.map(w => w.word.length));
        difficulties.casual = Array.from(lengths).filter(l => l >= 2).sort((a,b) => a - b);
        
        // Ensure casualSelectedLength is valid
        if (!difficulties.casual.includes(this.casualSelectedLength)) {
            this.casualSelectedLength = difficulties.casual[0] || 2;
        }

        this.loadHighScores();
    }
    
    toggleDataSource() {
        const sources = this.getAvailableSources();
        // Exclude custom_session from coming UP in the rotation if we aren't currently ON it?
        // Actually, if we are on custom_session, it is in the list.
        // If we switch off, 'custom_session' won't be in the list on next getAvailableSources because wordsData changed?
        // Wait, getAvailableSources checks keys. 'custom_session' is only pushed if `this.settings.dataSource === 'custom'`.
        // So yes, once we toggle off, it disappears from rotation. That is correct behavior for unsaved file.
        
        // Clean source ID list for rotation
        const sourceIds = sources.map(s => s.id);
        
        let currentIdx = sourceIds.indexOf(this.settings.currentSourceId);
        if (currentIdx === -1) currentIdx = 0;
        
        const nextIdx = (currentIdx + 1) % sourceIds.length;
        const nextSource = sources[nextIdx];
        
        this.settings.currentSourceId = nextSource.id;
        // Update legacy field for compatibility if needed or just use ID
        this.settings.dataSource = nextSource.type === 'online' ? 'online' : (nextSource.type === 'local' ? 'local' : 'custom');
        
        this.saveSettings();
        this.loadWordsSource();
        this.renderSettingsMenu();
        
        // Speak
        this.speak("Source: " + nextSource.name);
    }
    
    getSourceLabel() {
        // Find current source obj
        const sources = this.getAvailableSources();
        const active = sources.find(s => s.id === this.settings.currentSourceId);
        return active ? active.name : "Unknown";
    }
    
    uploadCustomFile() {
        const self = this; // Explicitly capture instance
        this.showMouseWarning(() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                self.customFileName = file.name;
                
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        let jsonStr = ev.target.result;
                        jsonStr = jsonStr.trim();
                        if (jsonStr.charCodeAt(0) === 0xFEFF) {
                            jsonStr = jsonStr.slice(1);
                        }

                        const data = JSON.parse(jsonStr);
                        if (Array.isArray(data)) {
                            if (data.length === 0) throw new Error("File is empty (no words).");
                            if (!data[0].word) throw new Error("First item missing 'word' property.");

                            self.wordsData = data;
                            
                            // Save to LocalStorage immediately
                            try {
                                const cleanName = self.customFileName.replace(/\.json$/i, '').trim();
                                const storageKey = 'wordjumble_list_' + cleanName;
                                localStorage.setItem(storageKey, JSON.stringify(data));
                                
                                self.settings.dataSource = 'local'; 
                                self.settings.currentSourceId = storageKey;
                            } catch (e) {
                                console.error("Could not save to local storage", e);
                                // Fallback for quotas or errors
                                self.settings.dataSource = 'custom'; 
                                self.settings.currentSourceId = 'custom_session'; 
                            }

                            const lengths = new Set(self.wordsData.map(w => w.word ? w.word.length : 0));
                            difficulties.casual = Array.from(lengths).filter(l => l >= 2).sort((a,b) => a - b);
                            
                            if (difficulties.casual.length > 0) {
                                self.casualSelectedLength = difficulties.casual[0];
                            } else {
                                self.casualSelectedLength = 2; // Fallback
                            }
                            
                            self.loadHighScores(); 
                            self.saveSettings();
                            self.renderSettingsMenu();
                            
                            // Use captured self
                            if (self.speak) self.speak("Loaded " + self.customFileName);
                            if (self.showAlert) self.showAlert("Loaded " + self.wordsData.length + " words");
                        } else {
                            throw new Error("File must be a JSON Array of words.");
                        }
                    } catch(err) {
                        console.error("JSON Load Error", err);
                        alert("Invalid JSON: " + err.message);
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        }, 'settings');
    }

    // --- Input & Auto Scan ---
    setupInput() {
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                if (!this.state.input.spaceHeld) {
                    this.state.input.spaceHeld = true;
                    this.state.input.spaceTime = Date.now();
                    this.state.timers.space = setTimeout(() => this.onSpaceLongPress(), 3000); // 3 seconds wait for back scan
                }
                e.preventDefault();
            } else if (e.code === 'Enter') {
                if (!this.state.input.enterHeld) {
                    this.state.input.enterHeld = true;
                    this.state.input.enterTime = Date.now();
                    this.state.timers.enter = setTimeout(() => this.onEnterLongPress(), 2000);
                }
                e.preventDefault();
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                const duration = Date.now() - this.state.input.spaceTime;
                clearTimeout(this.state.timers.space);
                clearInterval(this.state.timers.spaceRepeat);
                this.state.input.spaceHeld = false;
                if (duration < 3000) this.onSpaceShortPress();
            } else if (e.code === 'Enter') {
                const duration = Date.now() - this.state.input.enterTime;
                clearTimeout(this.state.timers.enter);
                this.state.input.enterHeld = false;
                if (duration < 2000) this.onEnterShortPress();
            }
        });
    }

    startAutoScan() {
        clearInterval(this.state.timers.autoScan);
        let enabled = this.settings.autoScan;
        if (typeof NarbeScanManager !== 'undefined') {
            enabled = NarbeScanManager.getSettings().autoScan;
        }

        if (!enabled) return;
        
        let speed = scanSpeeds[this.settings.scanSpeedIndex].val;
        if (typeof NarbeScanManager !== 'undefined') {
            speed = NarbeScanManager.getScanInterval();
        }

        this.state.timers.autoScan = setInterval(() => {
            this.moveScan(1);
        }, speed);
    }
    
    stopAutoScan() {
        clearInterval(this.state.timers.autoScan);
    }
    
    openEditor() {
        this.showMouseWarning(() => {
             window.open('editor.html', '_blank');
        }, 'menu'); // Came from menu
    }
    


    showMouseWarning(callback, returnMode = 'settings') {
        this.stopAutoScan();
        this.state.mode = 'warning';
        this.state.warningCallback = callback;
        this.state.returnMode = returnMode;
        
        // Ensure strictly starts at -1 so first input moves to 0
        this.state.warningIndex = -1;
        
        const overlay = document.createElement('div');
        overlay.id = 'warning-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.9); z-index: 2000;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            text-align: center; color: white;
        `;
        
        overlay.innerHTML = `
            <div style="font-size: 5vmin; margin-bottom: 5vh; max-width: 80%;">
                Warning: This feature requires a mouse or touch input. It is not fully accessible with switch controls.
            </div>
            <div id="warning-buttons" style="display: flex; flex-direction: column; gap: 2vh;">
                <button class="menu-button" id="warning-cancel" onclick="game.closeWarning()">Cancel</button>
                <button class="menu-button" id="warning-proceed">Proceed</button>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        document.getElementById('warning-proceed').onclick = () => {
             document.body.removeChild(overlay);
             if (this.state.warningCallback) this.state.warningCallback();
             this.state.warningCallback = null;
             
             // After proceed (e.g. launching editor), where do we stay?
             // Usually we stay on the screen we launched from.
             if (this.state.returnMode === 'menu') this.showMainMenu();
             else this.renderSettingsMenu();
             
             // But wait, showMainMenu/renderSettingsMenu sets the mode.
             // If we just launched a window (editor), the main window is still active.
        };

        this.state.warningButtons = [
             document.getElementById('warning-cancel'),
             document.getElementById('warning-proceed')
        ];
        
        this.speak("Warning. This feature requires mouse input. Cancel. Proceed.");
        
        // Use auto scan here too for accessibility safety
        if (this.settings.autoScan) this.startAutoScan();
        // REMOVED the "else index=0" line so manual users start at -1 (nothing highlighted)
        this.updateWarningHighlights();
    }
    
    closeWarning() {
        const overlay = document.getElementById('warning-overlay');
        if (overlay) document.body.removeChild(overlay);
        
        const mode = this.state.returnMode || 'settings';
        this.state.warningCallback = null;
        
        if (mode === 'menu') {
            this.showMainMenu();
        } else {
            this.state.mode = 'settings'; 
            this.renderSettingsMenu();
        }
    }

    updateWarningHighlights() {
        if (!this.state.warningButtons) return;
        this.state.warningButtons.forEach((btn, idx) => {
            if (idx === this.state.warningIndex) btn.classList.add('highlight');
            else btn.classList.remove('highlight');
        });
    }

    onSpaceShortPress() {
        if (this.state.inputFrozen) return;
        this.startAutoScan(); // Reset timer
        this.moveScan(1);
    }

    onSpaceLongPress() {
        if (this.state.inputFrozen) return;
        this.stopAutoScan();
        this.moveScan(-1);
        // Use the same speed for repeat back scan
        const speed = scanSpeeds[this.settings.scanSpeedIndex].val; 
        
        this.state.timers.spaceRepeat = setInterval(() => this.moveScan(-1), speed);
    }
    
    onEnterShortPress() {
        if (this.state.inputFrozen) return;
        this.startAutoScan();
        this.triggerSelection();
    }
    
    onEnterLongPress() {
        if (this.state.inputFrozen) return;
        if (this.state.mode === 'game') this.showPauseMenu();
        else if (this.state.mode === 'pause') this.resumeGame();
    }

    // --- Navigation ---
    moveScan(direction) {
        if (this.state.mode === 'menu') {
            this.state.menuIndex = this.cycleIndex(this.state.menuIndex, this.state.menuButtons.length, direction);
            this.updateMenuHighlights();
            this.speakButton(this.state.menuButtons[this.state.menuIndex]);
        } else if (this.state.mode === 'settings') {
             this.state.settingsIndex = this.cycleIndex(this.state.settingsIndex, this.state.menuButtons.length, direction);
             this.updateMenuHighlights();
             this.speakButton(this.state.menuButtons[this.state.settingsIndex]);
        } else if (this.state.mode === 'mode_select') {
             this.state.modeSelectIndex = this.cycleIndex(this.state.modeSelectIndex, this.state.menuButtons.length, direction);
             this.updateMenuHighlights();
             this.speakButton(this.state.menuButtons[this.state.modeSelectIndex]);
        } else if (this.state.mode === 'game') {
            const list = this.getGameScanList();
            this.state.scanIndex = this.cycleIndex(this.state.scanIndex, list.length, direction);
            this.updateGameHighlights();
            this.announceGameItem(list[this.state.scanIndex]);
        } else if (this.state.mode === 'pause') {
            this.state.pauseIndex = this.cycleIndex(this.state.pauseIndex, this.state.pauseButtons.length, direction);
            this.updatePauseHighlights();
            this.speakButton(this.state.pauseButtons[this.state.pauseIndex]);
        } else if (this.state.mode === 'warning') {
            this.state.warningIndex = this.cycleIndex(this.state.warningIndex, this.state.warningButtons.length, direction);
            this.updateWarningHighlights();
            this.speakButton(this.state.warningButtons[this.state.warningIndex]);
        }
    }
    
    speakButton(btn) {
        if (!btn) return;
        const text = btn.getAttribute('data-spoken') || btn.innerText;
        this.speak(text);
    }
    
    cycleIndex(current, length, direction) {
        if (length === 0) return 0;
        return (current + direction + length) % length;
    }

    triggerSelection() {
        if (this.state.mode === 'menu' || this.state.mode === 'settings' || this.state.mode === 'mode_select') {
            const btn = this.state.menuButtons[this.state.mode === 'menu' ? this.state.menuIndex : (this.state.mode === 'settings' ? this.state.settingsIndex : this.state.modeSelectIndex)];
            if (btn) btn.click();
        } else if (this.state.mode === 'game') {
            const list = this.getGameScanList();
            if (list[this.state.scanIndex] && list[this.state.scanIndex].element) {
                list[this.state.scanIndex].element.click();
            }
        } else if (this.state.mode === 'pause') {
            if (this.state.pauseButtons[this.state.pauseIndex]) this.state.pauseButtons[this.state.pauseIndex].click();
        } else if (this.state.mode === 'warning') {
            if (this.state.warningButtons[this.state.warningIndex]) this.state.warningButtons[this.state.warningIndex].click();
        }
    }

    // --- Menus ---
    showMainMenu() {
        this.state.mode = 'menu';
        this.state.menuIndex = 0;
        this.pauseOverlay.style.display = 'none';
        
        this.mainContent.innerHTML = `
            <div class="menu-title">Benny's Word Jumble</div>
            <div id="menu-list" style="display:flex; flex-direction:column; align-items:center;">
                <button class="menu-button" onclick="game.showCasualMenu()">Casual Play</button>
                <button class="menu-button" onclick="game.showChallengeMenu()">Challenge Mode</button>
                <button class="menu-button" onclick="game.showSettingsMenu()">Settings</button>
                <button class="menu-button" onclick="game.openEditor()">Editor</button>
                <button class="menu-button" onclick="game.exitGame()">Exit</button>
            </div>
        `;
        
        this.state.menuButtons = Array.from(document.querySelectorAll('#menu-list .menu-button'));
        this.updateMenuHighlights();
        this.speak("Benny's Word Jumble. Main Menu.");
        this.startAutoScan();
    }
    
    showCasualMenu() {
        this.state.mode = 'mode_select';
        this.state.modeSelectIndex = 0;
        this.gameMode = 'casual';
        
        // This menu now renders a toggle button and a start button
        this.renderCasualMenu();
        this.speak("Casual Mode");
        this.startAutoScan();
    }
    
    renderCasualMenu() {
        const len = this.casualSelectedLength;
        this.mainContent.innerHTML = `
            <div class="menu-title">Casual Mode</div>
            <div id="menu-list" style="display:flex; flex-direction:column; align-items:center;">
                <button class="menu-button" onclick="game.toggleCasualLength()">Word Length: ${len} Letters</button>
                <button class="menu-button" onclick="game.startCasualGame(${len})">Start Game</button>
                <button class="menu-button" onclick="game.showMainMenu()">Back</button>
            </div>
        `;
        this.state.menuButtons = Array.from(document.querySelectorAll('#menu-list .menu-button'));
        this.updateMenuHighlights();
    }
    
    toggleCasualLength() {
        const opts = difficulties.casual;
        const currentIdx = opts.indexOf(this.casualSelectedLength);
        const nextIdx = (currentIdx + 1) % opts.length;
        this.casualSelectedLength = opts[nextIdx];
        this.renderCasualMenu();
    }
    
    showChallengeMenu() {
        this.state.mode = 'mode_select';
        this.state.modeSelectIndex = 0;
        this.gameMode = 'challenge';
        
        this.renderChallengeMenu();
        this.speak("Challenge Mode");
        this.startAutoScan();
    }
    
    renderChallengeMenu() {
        const diff = difficulties.challenge[this.challengeSelectedDifficultyIndex];
        this.mainContent.innerHTML = `
            <div class="menu-title">Challenge Mode</div>
            <div id="menu-list" style="display:flex; flex-direction:column; align-items:center;">
                <button class="menu-button" onclick="game.toggleChallengeDifficulty()" data-spoken="${diff.label}">Difficulty: ${diff.label}</button>
                <button class="menu-button" onclick="game.startChallengeGame(${diff.hp})">Start Game</button>
                <button class="menu-button" onclick="game.showMainMenu()">Back</button>
            </div>
        `;
        this.state.menuButtons = Array.from(document.querySelectorAll('#menu-list .menu-button'));
        this.updateMenuHighlights();
    }
    
    toggleChallengeDifficulty() {
        this.challengeSelectedDifficultyIndex = (this.challengeSelectedDifficultyIndex + 1) % difficulties.challenge.length;
        this.renderChallengeMenu();
        this.speak(difficulties.challenge[this.challengeSelectedDifficultyIndex].label);
    }

    showSettingsMenu(fromPause = false) {
        this.state.fromPause = fromPause;
        this.state.mode = 'settings';
        this.state.settingsIndex = 0;
        this.renderSettingsMenu();
        this.speak("Settings");
        this.startAutoScan();
    }
    
    backFromSettings() {
        if (this.state.fromPause) {
             this.showPauseMenu();
             this.state.fromPause = false;
        } else {
             this.showMainMenu();
        }
    }
    
    renderSettingsMenu() {
        const s = this.settings;
        const container = this.mainContent;
        
        let currentAutoScan = s.autoScan;
        let speedLabel = scanSpeeds[s.scanSpeedIndex].label;
        let speedSpoken = scanSpeeds[s.scanSpeedIndex].spoken;
        
        if (typeof NarbeScanManager !== 'undefined') {
            const sett = NarbeScanManager.getSettings();
            currentAutoScan = sett.autoScan;
            const interval = NarbeScanManager.getScanInterval();
            speedLabel = (interval / 1000) + 's';
            speedSpoken = (interval / 1000) + ' seconds';
        }
        
        const hColor = highlightColors[s.highlightColorIndex];
        // Swatch style
        const swatchStyle = `background-color: ${hColor.val}; box-shadow: 0 0 5px #000; width: 3vmin; height: 3vmin; display: inline-block; vertical-align: middle; border: 2px solid white;`;

        // Use spoken text for button reading logic
        container.innerHTML = `
            <div class="menu-title" style="margin-bottom: 1vh; font-size: 6vmin;">Settings</div>
            <div id="menu-list" style="display: grid; grid-template-columns: 1fr 1fr; gap: 2vmin; width: 80%; max-width: 1000px; margin: 0 auto; box-sizing: border-box;">
                <button class="menu-button" style="width: 100%; margin: 0; font-size: 3vmin; white-space: normal; height: 100%; min-height: 8vh;" onclick="game.toggleTheme()">Theme: ${themes[s.themeIndex].name}</button>
                <button class="menu-button" style="width: 100%; margin: 0; font-size: 3vmin; white-space: normal; height: 100%; min-height: 8vh;" onclick="game.toggleTTS()">TTS: ${s.tts ? 'On' : 'Off'}</button>
                <button class="menu-button" style="width: 100%; margin: 0; font-size: 3vmin; white-space: normal; height: 100%; min-height: 8vh;" onclick="game.toggleAutoScan()">Auto Scan: ${currentAutoScan ? 'On' : 'Off'}</button>
                <button class="menu-button" style="width: 100%; margin: 0; font-size: 3vmin; white-space: normal; height: 100%; min-height: 8vh;" onclick="game.toggleScanSpeed()" data-spoken="Scan Speed: ${speedSpoken}">Speed: ${speedLabel}</button>
                <button class="menu-button" style="width: 100%; margin: 0; font-size: 3vmin; white-space: normal; height: 100%; min-height: 8vh;" onclick="game.toggleHighlightColor()" data-spoken="Highlight Color: ${hColor.name}">
                    Color: <div class="color-swatch" style="${swatchStyle}"></div>
                </button>
                <button class="menu-button" style="width: 100%; margin: 0; font-size: 3vmin; white-space: normal; height: 100%; min-height: 8vh;" onclick="game.toggleHighlightStyle()">Style: ${s.highlightStyle === 'outline' ? 'Outline' : 'Full'}</button>
                <button class="menu-button" style="width: 100%; margin: 0; font-size: 3vmin; white-space: normal; height: 100%; min-height: 8vh;" onclick="game.toggleDataSource()">Source: ${this.getSourceLabel()}</button>
                <button class="menu-button" style="width: 100%; margin: 0; font-size: 3vmin; white-space: normal; height: 100%; min-height: 8vh;" onclick="game.uploadCustomFile()">Load File...</button>

                <button class="menu-button" style="width: 100%; margin: 0; font-size: 3vmin; white-space: normal; height: 100%; min-height: 8vh; grid-column: span 2; border: 2px solid #ff6666;" onclick="game.clearGameData()">Clear Game Cache</button>
                <button class="menu-button" style="width: 50%; margin: 0 auto; font-size: 3vmin; white-space: normal; height: 100%; min-height: 8vh; grid-column: span 2;" onclick="game.backFromSettings()">Back</button>
        `;
        this.state.menuButtons = Array.from(container.querySelectorAll('.menu-button'));
        this.updateMenuHighlights();
    }

    // --- Settings Toggles ---
    toggleTheme() {
        this.settings.themeIndex = (this.settings.themeIndex + 1) % themes.length;
        this.applyTheme();
        this.saveSettings();
        this.renderSettingsMenu();
        this.speak("Theme: " + themes[this.settings.themeIndex].name);
    }
    toggleTTS() {
        this.settings.tts = !this.settings.tts;
        this.saveSettings();
        this.renderSettingsMenu();
        this.speak("TTS: " + (this.settings.tts ? 'On' : 'Off'));
    }
    toggleAutoScan() {
        if (typeof NarbeScanManager !== 'undefined') {
            const current = NarbeScanManager.getSettings().autoScan;
            NarbeScanManager.setAutoScan(!current);
            const newState = NarbeScanManager.getSettings().autoScan;
            this.renderSettingsMenu();
            this.speak("Auto Scan: " + (newState ? 'On' : 'Off'));
            if(!newState) this.stopAutoScan();
            else this.startAutoScan();
        }
    }
    toggleScanSpeed() {
        if (typeof NarbeScanManager !== 'undefined') {
            NarbeScanManager.cycleScanSpeed();
            const interval = NarbeScanManager.getScanInterval();
            this.renderSettingsMenu();
            this.speak("Scan Speed: " + (interval/1000) + " seconds");
            // Restart if active
            if (this.state.timers.autoScan) {
                this.stopAutoScan();
                this.startAutoScan();
            }
        }
    }
    toggleHighlightColor() {
        this.settings.highlightColorIndex = (this.settings.highlightColorIndex + 1) % highlightColors.length;
        this.applyTheme();
        this.saveSettings();
        this.renderSettingsMenu();
        this.speak("Highlight Color: " + highlightColors[this.settings.highlightColorIndex].name);
    }
    
    toggleHighlightStyle() {
        this.settings.highlightStyle = this.settings.highlightStyle === 'outline' ? 'full' : 'outline';
        this.applyTheme();
        this.saveSettings();
        this.renderSettingsMenu();
        this.speak("Highlight Style: " + (this.settings.highlightStyle === 'outline' ? 'Outline' : 'Full Cell'));
    }

    // --- Game Logic ---
    startCasualGame(length) {
        this.currentLevelLength = length;
        this.score = 0;
        this.combo = 0;
        this.usedWords.clear();
        this.loadHighScores();
        this.nextLevel();
    }

    startChallengeGame(hp) {
        this.maxHP = hp;
        this.currentHP = hp;
        // Start minimal available length dynamically
        const availableLengths = difficulties.casual; // Calculated on load
        this.currentLevelLength = availableLengths.length > 0 ? availableLengths[0] : 2;
        
        this.levelProgress = 0;
        this.usedWords.clear();
        
        // Reset Score
        this.score = 0;
        this.combo = 0;
        this.loadHighScores();

        this.nextLevel();
    }

    nextLevel() {
        const candidates = this.wordsData.filter(w => 
            w.word.length === this.currentLevelLength && !this.usedWords.has(w.word)
        );

        if (candidates.length === 0) {
            if (this.gameMode === 'challenge') {
                this.levelProgress = 0;
                
                // Find next available length greater than current
                const currentLen = this.currentLevelLength;
                const nextLen = difficulties.casual.find(l => l > currentLen);
                
                if (nextLen) {
                    this.currentLevelLength = nextLen;
                    this.showAlert(`Level Up! ${this.currentLevelLength} Letter Words!`);
                    setTimeout(() => this.nextLevel(), 2000);
                    return;
                } else {
                    this.showAlert("Game Complete! You are a Word Master!", true);
                    return;
                }
            } else {
                this.showAlert("All words of this length completed!", true);
                return;
            }
        }

        const picked = candidates[Math.floor(Math.random() * candidates.length)];
        this.currentWordObj = picked;
        this.targetWord = picked.word.toUpperCase();
        this.usedWords.add(picked.word);
        
        this.jumbledLetters = this.targetWord.split('');
        for (let i = this.jumbledLetters.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.jumbledLetters[i], this.jumbledLetters[j]] = [this.jumbledLetters[j], this.jumbledLetters[i]];
        }
        
        this.currentGuess = new Array(this.targetWord.length).fill(null);
        this.state.mode = 'game';
        this.state.scanIndex = 0;
        this.state.inputFrozen = false;
        
        this.renderGameScreen();
        this.speakWithBrowser(`The word is ${this.targetWord.toLowerCase()}. ${this.currentWordObj.sentence}`);
        this.startAutoScan();
    }

    renderGameScreen() {
        const sentence = this.currentWordObj.sentence;
        // Use word boundaries to prevent matching parts of other words (e.g. "is" inside "this")
        const regex = new RegExp('\\b' + this.targetWord + '\\b', 'gi');
        const blankedSentence = sentence.replace(regex, '_______');
        
        let imageHtml = '';
        if (this.currentWordObj.image) {
            imageHtml = `<img src="${this.currentWordObj.image}" class="word-image" alt="Hint Image">`;
        }
        
        // Build HP display using Matchy Match structure
        let statsHtml = '';
        if (this.gameMode === 'challenge') {
            const hpPercent = (this.currentHP / this.maxHP) * 100;
            statsHtml = `
            <div class="hp-container">
                <div class="hp-fill" style="width: ${hpPercent}%;"></div>
                <div class="hp-text">HP: ${this.currentHP} / ${this.maxHP} | Lvl ${this.currentLevelLength-1}</div>
            </div>
            <div class="score-container" style="text-align: center; font-size: 3vmin; color: white; margin-bottom: 2vh; text-shadow: 2px 2px 4px black;">
                 Score: ${this.score} | High: ${this.highScore} ${this.combo > 1 ? `<span style="color:#ffff00; margin-left:1em;">Combo x${this.combo} !</span>` : ''}
            </div>`;
        }

        let slotsHtml = '';
        for (let i = 0; i < this.targetWord.length; i++) {
            const letter = this.currentGuess[i] ? this.currentGuess[i].char : '';
            // Added onclick to remove letter
            slotsHtml += `<div id="slot-${i}" class="letter-slot" onclick="game.removeLetter(${i})">${letter}</div>`;
        }

        let poolHtml = '';
        this.jumbledLetters.forEach((char, index) => {
            const isUsed = this.currentGuess.some(g => g && g.index === index);
            const className = isUsed ? "letter-tile used" : "letter-tile";
            poolHtml += `<div id="tile-${index}" class="${className}" onclick="game.selectLetter('${char}', ${index})">
                ${char}
            </div>`;
        });

        this.mainContent.innerHTML = `
            ${statsHtml}
            ${imageHtml}
            <div class="sentence-display" id="sentence-display" onclick="game.speakSentence()">${blankedSentence}</div>
            <div class="word-container" id="slots-container">
                ${slotsHtml}
            </div>
            <div class="letters-pool" id="pool-container">
                ${poolHtml}
            </div>
            <div id="result-message" class="result-message"></div>
            
            <div id="pause-button" onclick="game.showPauseMenu()">
                <div style="width: 20px; height: 20px; background: white; clip-path: path('M0 0h6v20H0zm14 0h6v20h-6z');"></div>
            </div>
        `;
        
        this.updateGameHighlights();
    }
    
    speakSentence() {
        if (this.currentWordObj) {
            this.speakWithBrowser(this.currentWordObj.sentence);
        }
    }
    
    // --- Actions ---
    selectLetter(char, index) {
        if (this.state.inputFrozen) return;
        const emptySlotIndex = this.currentGuess.findIndex(val => val === null);
        if (emptySlotIndex !== -1) {
            if (this.currentGuess.some(g => g && g.index === index)) return;
            this.currentGuess[emptySlotIndex] = { char: char, index: index };
            // Reset scan to top (first available letter) to prevent jumping to sentence
            this.state.scanIndex = 0;
            this.renderGameScreen();
            this.checkWin();
        }
    }

    removeLetter(slotIndex) {
        if (this.state.inputFrozen) return;
        if (this.currentGuess[slotIndex]) {
            this.currentGuess[slotIndex] = null;
            this.renderGameScreen();
        }
    }
    
    resetLevel() {
        this.currentGuess = new Array(this.targetWord.length).fill(null);
        this.renderGameScreen();
        this.state.scanIndex = 0;
        this.updateGameHighlights();
    }
    
    skipLevel() {
        if (this.gameMode === 'challenge') {
             this.loseHP();
        } else {
             this.nextLevel();
        }
    }

    checkWin() {
        if (this.currentGuess.some(g => g === null)) return; 

        const formedWord = this.currentGuess.map(g => g.char).join('');
        const messageEl = document.getElementById('result-message');
        
        if (formedWord === this.targetWord) {
            messageEl.textContent = "Correct! " + this.currentWordObj.sentence;
            messageEl.style.color = "#ccffcc"; 
            this.speak("Correct!");
            this.playSystemSound('success');
            
            // Scoring Logic
            if (this.gameMode === 'challenge') {
                 this.combo++;
                 // Points: 100 base + (length * 10) + (combo bonus)
                 const points = 100 + (this.targetWord.length * 10) + ((this.combo - 1) * 50);
                 this.score += points;
                 this.saveHighScore();
            }

            this.state.inputFrozen = true;
            this.stopAutoScan(); // Stop scanning visually too
            this.handleSuccess();
        } else {
            messageEl.textContent = "Try Again!";
            messageEl.style.color = "#ffcccc"; 
            this.speak("Try Again");
            
            if (this.gameMode === 'challenge') this.combo = 0; // Reset combo

            // Reset to blank on Try Again
            this.currentGuess = new Array(this.targetWord.length).fill(null);
            this.state.scanIndex = 0; // Reset scan to top
            
            if (this.gameMode === 'challenge') this.loseHP();
            else this.renderGameScreen(); // Re-render if casual
        }
    }
    
    handleSuccess() {
        if (this.gameMode === 'challenge') {
             if (this.currentHP < this.maxHP) {
                 this.currentHP++;
                 this.playSystemSound('hp-up');
             }
             this.levelProgress++;
             if (this.levelProgress >= this.wordsPerLevel) {
                 this.levelProgress = 0;
                 this.currentLevelLength++;
             }
        }
        setTimeout(() => this.nextLevel(), 3000);
    }
    
    loseHP() {
        if (this.gameMode === 'challenge') {
            this.currentHP--;
            this.combo = 0; // Combo breaks on damage
            this.playSystemSound('hp-down');
            if (this.currentHP <= 0) {
                 this.showAlert(`Game Over! Final Score: ${this.score}`, true);
                 return;
            }
            this.renderGameScreen(); // Updates hearts/bar
        }
    }
    
    showAlert(msg, returnToMenu = false) {
        const messageEl = document.getElementById('result-message');
        if (messageEl) {
            messageEl.textContent = msg;
        } else {
            // Fallback for when not in game screen (e.g. Settings)
            if (msg.startsWith("Loaded") || msg.startsWith("Game Over")) {
                alert(msg);
            }
            console.log("Alert:", msg);
        }
        
        this.speak(msg);
        
        if (returnToMenu) {
            setTimeout(() => this.showMainMenu(), 4000);
        }
    }

    // --- Helpers ---
    getGameScanList() {
        const list = [];
        
        // 1. Unused Letters (Pool)
        this.jumbledLetters.forEach((char, index) => {
             const isUsed = this.currentGuess.some(g => g && g.index === index);
             if (!isUsed) list.push({ type: 'pool', element: document.getElementById(`tile-${index}`), data: char });
        });

        // 2. Sentence (to read it)
        list.push({ type: 'control', element: document.getElementById('sentence-display'), data: this.currentWordObj.sentence });

        // 3. Filled Slots (to remove)
        for (let i = 0; i < this.targetWord.length; i++) {
             if (this.currentGuess[i] !== null) {
                 const letter = this.currentGuess[i].char;
                 list.push({ type: 'slot', element: document.getElementById(`slot-${i}`), data: letter });
             }
        }
        
        return list;
    }
    
    updateMenuHighlights() {
        if (this.state.mode === 'warning') return this.updateWarningHighlights();
        
        const buttons = this.state.mode === 'pause' ? this.state.pauseButtons : this.state.menuButtons;
        const index = this.state.mode === 'menu' ? this.state.menuIndex : 
                      (this.state.mode === 'settings' ? this.state.settingsIndex : 
                      (this.state.mode === 'mode_select' ? this.state.modeSelectIndex : this.state.pauseIndex));
                      
        buttons.forEach((btn, idx) => {
            if (index === idx) {
                btn.classList.add('highlight');
                btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            else btn.classList.remove('highlight');
        });
    }

    updatePauseHighlights() {
        this.state.pauseButtons.forEach((btn, idx) => {
            if (idx === this.state.pauseIndex) btn.classList.add('highlight');
            else btn.classList.remove('highlight');
        });
    }

    updateGameHighlights() {
        const all = document.querySelectorAll('.highlight');
        all.forEach(el => el.classList.remove('highlight'));
        
        const list = this.getGameScanList();
        if (this.state.scanIndex >= list.length) this.state.scanIndex = 0;
        if (list[this.state.scanIndex] && list[this.state.scanIndex].element) {
            list[this.state.scanIndex].element.classList.add('highlight');
        }
    }
    
    announceGameItem(item) {
        if (!item) return;
        if (item.type === 'pool') this.speak(item.data);
        else if (item.type === 'slot') this.speak("Remove " + item.data);
        else if (item.type === 'control') this.speak(item.data);
    }

    showPauseMenu() {
        this.stopAutoScan();
        this.state.mode = 'pause';
        this.state.pauseIndex = 0;
        this.pauseOverlay.style.display = 'flex';
        this.pauseOverlay.innerHTML = `
            <div class="pause-title">PAUSED</div>
            <button class="menu-button" onclick="game.resumeGame()">Continue Game</button>
            <button class="menu-button" onclick="game.showSettingsMenu(true)">Settings</button>
            <button class="menu-button" onclick="game.resetLevel(); game.resumeGame()">Reset Level</button>
            <button class="menu-button" onclick="game.showMainMenu()">Main Menu</button>
        `;
        this.state.pauseButtons = Array.from(this.pauseOverlay.getElementsByClassName('menu-button'));
        this.updatePauseHighlights();
        this.speak("Game Paused");
        this.startAutoScan(); // Resume auto scan for pause menu
    }
    
    resumeGame() {
        this.pauseOverlay.style.display = 'none';
        this.state.mode = 'game';
        this.updateGameHighlights();
        this.startAutoScan();
    }

    speak(text) {
        if (window.NarbeVoiceManager) {
             window.NarbeVoiceManager.speak(text);
        } else {
             this.speakWithBrowser(text);
        }
    }

    speakWithBrowser(text) {
        if (this.settings.tts && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 0.9;
            window.speechSynthesis.speak(utterance);
        }
    }
    
    clearGameData() {
        if (confirm("Are you sure you want to clear the 'Local' words cache and high scores? This does not delete files saved to your computer.")) {
            try {
                localStorage.removeItem('wordjumble_custom_words');
                localStorage.removeItem('wordjumble_high_scores');
                this.speak("Game Cache Cleared");
                alert("Local Cache Cleared. Reselect Source to refresh.");
                
                // If we were on 'local', we are now empty. 
                // Reloading source would handle this (usually falling back to empty or online if we force it)
                this.loadWordsSource();
                this.renderSettingsMenu();
                
            } catch (e) {
                console.error(e);
                alert("Error clearing cache.");
            }
        }
    }
    
    exitGame() {
        this.speak("Exiting to Hub");
        setTimeout(() => {
             // Try to exit via parent message if possible
             if (window.parent && window.parent !== window) {
                 window.parent.postMessage({ action: 'focusBackButton' }, '*');
             } else {
                 // Standalone fallback
                 window.location.href = '../../../index.html';
             }
        }, 500);
    }
}

const game = new WordJumbleGame();
