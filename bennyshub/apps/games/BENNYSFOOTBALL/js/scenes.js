// ═══════════════════════════════════════════════════════════════════════════════
// BENNY'S FOOTBALL - Scenes (Title, Color Select, Game, Result)
// ═══════════════════════════════════════════════════════════════════════════════

// Shared, lazily-created singletons.
let GAME_AUDIO = null;
let GAME_SEASON = null;
function audioSys() { if (!GAME_AUDIO) GAME_AUDIO = new AudioSystem(); return GAME_AUDIO; }
function seasonMgr() { if (!GAME_SEASON) GAME_SEASON = new SeasonManager(); return GAME_SEASON; }

// ═══════════════════════════════════════════════════════════════════════════════
// TITLE SCENE  —  Quick Game / Season Mode / Settings / Exit
// ═══════════════════════════════════════════════════════════════════════════════
class TitleScene extends Phaser.Scene {
    constructor() { super({ key: 'TitleScene' }); }

    create() {
        const audio = audioSys();
        this.drawMenuField();
        this.add.rectangle(0, 0, W, H, 0x000000, 0.30).setOrigin(0).setDepth(1);

        this.add.text(W / 2, 56, "BENNY'S FOOTBALL", {
            fontSize: '54px', fontFamily: 'Arial Black', color: '#FFD700',
            stroke: '#000', strokeThickness: 7
        }).setOrigin(0.5).setDepth(5);

        const opts = [
            { label: 'QUICK GAME',    value: 'exhibition',   hint: 'casual single game, not tracked' },
            { label: 'SEASON MODE',   value: 'season',       hint: '16 game season + playoffs' },
            { label: 'INSTRUCTIONS', value: 'instructions', hint: 'how to play' },
            { label: 'SETTINGS',      value: 'settings',     hint: 'sound, scan speed, reset season' },
            { label: 'EXIT GAME',     value: 'exit',         hint: 'return to the hub' }
        ];

        const menuY = H / 2 + 20;
        const panelH = opts.length * 62 + 46;
        this.add.rectangle(W / 2, menuY, 440, panelH, 0x06120a, 0.76)
            .setOrigin(0.5).setDepth(3).setStrokeStyle(2, 0xffd700, 0.6);

        this.menu = new ScanList(this, {
            x: W / 2, y: menuY, options: opts, audio,
            title: null, itemW: 380,
            onSelect: (opt) => this.handle(opt.value)
        });

        this.add.text(W / 2, H - 22, 'SPACE or click/tap = scan  ·  ENTER or tap-and-hold = select/charge', {
            fontSize: '15px', fontFamily: 'Arial', color: '#dff5df',
            stroke: '#000', strokeThickness: 2
        }).setOrigin(0.5).setDepth(5);

        this.setupKeys();
    }

    // A big football-field backdrop that fills most of the screen.
    drawMenuField() {
        const g = this.add.graphics().setDepth(0);
        // Field bounds (nearly the whole screen) with its own end-zone width.
        const left = 18, right = W - 18, top = 92, bottom = H - 44;
        const ez = 78;                       // end-zone width
        const gl = left + ez, gr = right - ez;
        const playW = gr - gl, height = bottom - top;
        const xAt = (yd) => gl + (yd / 100) * playW;
        g.fillStyle(0x0a1408); g.fillRect(0, 0, W, H);
        // Green turf stripes across the playing area.
        const stripes = 10, stripeW = playW / stripes;
        for (let i = 0; i < stripes; i++) {
            g.fillStyle(i % 2 === 0 ? 0x2e7d32 : 0x276b2c);
            g.fillRect(gl + i * stripeW, top, stripeW, height);
        }
        // Red end zone on the left, blue end zone on the right.
        g.fillStyle(0xc62828, 0.92); g.fillRect(left, top, ez, height);
        g.fillStyle(0x1565c0, 0.92); g.fillRect(gr, top, ez, height);
        // Yard lines.
        g.lineStyle(1, 0xffffff, 0.20);
        for (let yd = 5; yd < 100; yd += 5) g.lineBetween(xAt(yd), top, xAt(yd), bottom);
        g.lineStyle(2, 0xffffff, 0.40);
        for (let yd = 10; yd < 100; yd += 10) g.lineBetween(xAt(yd), top, xAt(yd), bottom);
        g.lineStyle(3, 0xffffff, 0.9);
        g.lineBetween(gl, top, gl, bottom);
        g.lineBetween(gr, top, gr, bottom);
        g.strokeRect(left, top, right - left, height);
        // Goalposts at both ends.
        const midY = (top + bottom) / 2;
        [{ x: left + 4, dir: 1 }, { x: right - 4, dir: -1 }].forEach(p => {
            g.lineStyle(5, 0xffe14d, 0.95);
            g.lineBetween(p.x, midY - 54, p.x, midY + 54);
            g.lineBetween(p.x, midY - 54, p.x + p.dir * 20, midY - 54);
            g.lineBetween(p.x, midY + 54, p.x + p.dir * 20, midY + 54);
        });
    }

    setupKeys() {
        this.scanInput = new ScanInput(this, {
            forward: () => this.menu.next(false),
            backward: () => this.menu.prev(false),
            select: () => this.menu.select()
        });
    }

    handle(value) {
        if (value === 'exhibition') {
            this.menu.destroy();
            this.scene.start('ColorSelectScene', { mode: 'exhibition' });
        } else if (value === 'season') {
            this.menu.destroy();
            this.scene.start('SeasonScene');
        } else if (value === 'instructions') {
            this.menu.destroy();
            this.scene.start('InstructionsScene');
        } else if (value === 'settings') {
            this.menu.destroy();
            this.scene.start('SettingsScene');
        } else if (value === 'exit') {
            // Signal the hub to close the iframe and return to the main menu.
            // Same pattern used by Bowling and other hub games.
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ action: 'focusBackButton' }, '*');
            } else {
                window.location.href = '../../../index.html';
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS SCENE
// ═══════════════════════════════════════════════════════════════════════════════
class SettingsScene extends Phaser.Scene {
    constructor() { super({ key: 'SettingsScene' }); }

    create() {
        this._confirmingReset = false;
        this.audio = audioSys();
        this._buildBg();
        this.add.text(W / 2, 42, 'SETTINGS', {
            fontSize: '36px', fontFamily: 'Arial Black', color: '#FFD700',
            stroke: '#000', strokeThickness: 5
        }).setOrigin(0.5).setDepth(5);
        this._buildMenu();
        this.scanInput = new ScanInput(this, {
            forward:  () => this.menu && this.menu.next(false),
            backward: () => this.menu && this.menu.prev(false),
            select:   () => this.menu && this.menu.select(),
            escape:   () => this.scene.start('TitleScene')
        });
    }

    _buildBg() {
        this.add.rectangle(0, 0, W, H, 0x0a1408).setOrigin(0);
        const bg = this.add.graphics();
        for (let i = 0; i < 20; i++) {
            bg.fillStyle(i % 2 === 0 ? 0x0d1b0b : 0x0a1408, 1);
            bg.fillRect(0, i * 32, W, 32);
        }
        this.add.rectangle(0, 0, W, H, 0x000000, 0.18).setOrigin(0);
    }

    _buildMenu(restoreIndex = -1) {
        if (this.menu) { this.menu.destroy(); this.menu = null; }
        const a = this.audio;
        const nm = window.NarbeScanManager;
        const vm = window.NarbeVoiceManager;

        if (this._confirmingReset) {
            const opts = [
                { label: 'YES — RESET SEASON', value: 'confirm_reset', hint: 'this cannot be undone' },
                { label: 'NO — CANCEL',         value: 'cancel_reset',  hint: 'keep my season' }
            ];
            this.menu = new ScanList(this, {
                x: W / 2, y: H / 2, options: opts, audio: a, title: 'RESET SEASON?',
                itemW: 380,
                onSelect: (opt) => this._handle(opt.value)
            });
            a.speak('Reset season? Yes or no.', true);
            return;
        }

        const autoScan = nm && nm.getSettings ? !!nm.getSettings().autoScan : false;
        const scanSec  = nm && nm.getSettings ? ((nm.getSettings().scanInterval || 2200) / 1000).toFixed(1) : '2.2';
        const ttsOn    = vm && vm.getSettings ? vm.getSettings().ttsEnabled !== false : true;
        const sfxOn    = a.settings.soundEnabled;
        const easyThrow = easyThrowOn();
        const season   = seasonMgr();
        const cbMode   = colorblindMode();
        const cbLabel  = (COLORBLIND_MODES.find(m => m.id === cbMode) || COLORBLIND_MODES[0]).label;
        const sprite3d = sprite3dOn();

        const opts = [
            { label: `Sound Effects: ${sfxOn  ? 'ON' : 'OFF'}`, value: 'sfx' },
            { label: `TTS: ${ttsOn ? 'ON' : 'OFF'}`,           value: 'tts' },
            { label: `Auto Scan: ${autoScan ? 'ON' : 'OFF'}`,  value: 'autoscan' },
            { label: `Scan Speed: ${scanSec}s`,                  value: 'scanspeed' },
            { label: `Easy Throw: ${easyThrow ? 'ON' : 'OFF'}`, value: 'easythrow',
              hint: easyThrow ? 'no charge needed — pick receiver and it throws' : 'hold to charge throw & kick power' },
            { label: `Colorblind: ${cbLabel}`,                   value: 'colorblind',
              hint: 'cycles through Normal, Deuteranopia, Protanopia, Tritanopia' },
            { label: `Players: ${sprite3d ? '3D' : 'CLASSIC'}`,  value: 'sprite3d',
              hint: sprite3d ? 'modelled players with team helmets and pads' : 'flat colour discs — simplest to read' }
        ];
        if (season.isActive()) {
            opts.push({ label: 'RESET SEASON', value: 'reset_season', hint: 'wipe all season data' });
        }
        opts.push({ label: 'BACK TO MAIN MENU', value: 'back' });

        this.menu = new ScanList(this, {
            x: W / 2, y: H / 2 + 20, options: opts, audio: a,
            itemW: 400,
            onSelect: (opt) => this._handle(opt.value)
        });

        // Restore the highlighted row so the selection doesn't jump after a toggle.
        if (restoreIndex >= 0 && restoreIndex < opts.length) {
            this.menu.index = restoreIndex;
            this.menu._draw();
        }
    }

    _handle(value) {
        const a = this.audio;
        const nm = window.NarbeScanManager;
        const vm = window.NarbeVoiceManager;
        // Remember which row was active before we rebuild the menu.
        const idx = this.menu ? this.menu.index : -1;

        if (value === 'sfx') {
            a.settings.soundEnabled = !a.settings.soundEnabled;
            a.saveSettings();
            a.speak(a.settings.soundEnabled ? 'Sound on.' : 'Sound off.', true);
            this._buildMenu(idx);
        } else if (value === 'tts') {
            // NarbeVoiceManager exposes toggleTTS(), not setTtsEnabled().
            if (vm && typeof vm.toggleTTS === 'function') {
                const nowOn = vm.toggleTTS();
                a.speak(nowOn ? 'TTS on.' : 'TTS off.', true);
            }
            this._buildMenu(idx);
        } else if (value === 'autoscan') {
            if (nm && typeof nm.setAutoScan === 'function') {
                const cur = nm.getSettings().autoScan;
                nm.setAutoScan(!cur);
                a.speak(!cur ? 'Auto scan on.' : 'Auto scan off.', true);
            }
            this._buildMenu(idx);
        } else if (value === 'scanspeed') {
            if (nm && typeof nm.cycleScanSpeed === 'function') {
                nm.cycleScanSpeed();
            } else if (nm && nm.getSettings) {
                // Cycle through 1s / 1.5s / 2s / 2.5s / 3s
                const speeds = [1000, 1500, 2000, 2500, 3000];
                const cur = nm.getSettings().scanInterval || 2000;
                const next = speeds[(speeds.indexOf(cur) + 1) % speeds.length];
                if (typeof nm.setScanInterval === 'function') nm.setScanInterval(next);
            }
            const newSec = nm && nm.getSettings ? ((nm.getSettings().scanInterval || 2000) / 1000).toFixed(1) : '?';
            a.speak(`Scan speed ${newSec} seconds.`, true);
            this._buildMenu(idx);
        } else if (value === 'easythrow') {
            const on = !easyThrowOn();
            setEasyThrow(on);
            a.speak(on ? 'Easy Throw on. Pick receiver and it throws automatically.' : 'Easy Throw off. Hold to charge your throw.', true);
            this._buildMenu(idx);
        } else if (value === 'colorblind') {
            const ids = COLORBLIND_MODES.map(m => m.id);
            const cur = colorblindMode();
            const next = ids[(ids.indexOf(cur) + 1) % ids.length];
            setColorblindMode(next);
            const lbl = (COLORBLIND_MODES.find(m => m.id === next) || COLORBLIND_MODES[0]).label;
            a.speak(`Colorblind mode: ${lbl}.`, true);
            this._buildMenu(idx);
        } else if (value === 'sprite3d') {
            const on = !sprite3dOn();
            setSprite3d(on);
            // makePlayer() reads this when the teams are built, so a game
            // already in progress keeps whatever it started with.
            a.speak(on ? 'Players: 3D. Takes effect next game.'
                       : 'Players: classic discs. Takes effect next game.', true);
            this._buildMenu(idx);
        } else if (value === 'reset_season') {
            this._confirmingReset = true;
            this._buildMenu();
        } else if (value === 'confirm_reset') {
            seasonMgr().reset();
            seasonMgr().clearGameState();
            this._confirmingReset = false;
            a.speak('Season reset.', true);
            this._buildMenu();
        } else if (value === 'cancel_reset') {
            this._confirmingReset = false;
            this._buildMenu();
        } else if (value === 'back') {
            this.scene.start('TitleScene');
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLOR SELECT SCENE — single team-colour toggle (like the baseball game)
// One big swatch you cycle through with the arrows / SPACE, then START GAME.
// Works in every mode (Quick Game and New Season both come here).
// ═══════════════════════════════════════════════════════════════════════════════
class ColorSelectScene extends Phaser.Scene {
    constructor() { super({ key: 'ColorSelectScene' }); }
    init(data) { this.mode = data.mode || 'exhibition'; this.colorIndex = 0; }

    preload() { loadHelmets(this); }

    create() {
        const audio = audioSys();
        this.add.rectangle(0, 0, W, H, 0x0a1408).setOrigin(0);
        // Decorative turf stripes behind everything.
        const bg = this.add.graphics();
        for (let i = 0; i < 12; i++) {
            bg.fillStyle(i % 2 === 0 ? 0x102a16 : 0x0c2212, 1);
            bg.fillRect(0, i * 50, W, 50);
        }

        this.add.text(W / 2, 70, 'CHOOSE YOUR TEAM', {
            fontSize: '40px', fontFamily: 'Arial', fontStyle: 'bold', color: '#ffffff'
        }).setOrigin(0.5);
        this.add.text(W / 2, 112, this.mode === 'season' ? '16-game season' : 'Quick exhibition game', {
            fontSize: '18px', fontFamily: 'Arial', color: '#9ccc9c'
        }).setOrigin(0.5);

        // Central card showing the current colour.
        const cardW = 360, cardH = 230, cardX = W / 2 - cardW / 2, cardY = 170;
        this.card = this.add.graphics().setDepth(2);
        this.helmetImg = null;
        this.nameTxt = this.add.text(W / 2, cardY + cardH - 36, '', {
            fontSize: '34px', fontFamily: 'Arial', fontStyle: 'bold', color: '#ffffff'
        }).setOrigin(0.5).setDepth(4);
        this._card = { x: cardX, y: cardY, w: cardW, h: cardH };

        // Clickable arrow buttons either side of the card.
        this.leftBtn = this._arrow(cardX - 70, cardY + cardH / 2, '◀', () => this.cycle(-1));
        this.rightBtn = this._arrow(cardX + cardW + 70, cardY + cardH / 2, '▶', () => this.cycle(1));

        // START button (its own clickable + scannable control).
        this.startMenu = new ScanList(this, {
            x: W / 2, y: 470, options: [{ label: 'START GAME', value: 'start' }],
            audio, itemW: 300, itemH: 56, fontSize: '24px',
            onSelect: () => this.start()
        });

        this.add.text(W / 2, H - 28,
            '◀ ▶ or SPACE = change colour   ·   ENTER / click = start', {
            fontSize: '15px', fontFamily: 'Arial', color: '#9ccc9c'
        }).setOrigin(0.5);

        this.drawColor();

        // Keyboard: arrows + SPACE cycle the colour, ENTER starts.
        this.input.keyboard.on('keydown-LEFT', () => this.cycle(-1));
        this.input.keyboard.on('keydown-RIGHT', () => this.cycle(1));
        this.scanInput = new ScanInput(this, {
            forward: () => this.cycle(1),
            backward: () => this.cycle(-1),
            select: () => this.start(),
            escape: () => this.scene.start('TitleScene')
        });
    }

    _arrow(x, y, glyph, onClick) {
        const c = this.add.container(x, y).setDepth(5);
        const bg = this.add.circle(0, 0, 30, 0x1b3a23).setStrokeStyle(2, 0x57a86a, 0.7);
        const t = this.add.text(0, 0, glyph, { fontSize: '30px', fontFamily: 'Arial', color: '#ffd54a' }).setOrigin(0.5);
        c.add([bg, t]);
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerdown', onClick);
        bg.on('pointerover', () => bg.setFillStyle(0x27543a));
        bg.on('pointerout', () => bg.setFillStyle(0x1b3a23));
        return c;
    }

    cycle(dir) {
        this.colorIndex = (this.colorIndex + dir + TEAM_COLORS.length) % TEAM_COLORS.length;
        this.drawColor();
        audioSys().play('scan');
        audioSys().speak(TEAM_COLORS[this.colorIndex].name, true);
    }

    drawColor() {
        const c = TEAM_COLORS[this.colorIndex];
        const b = this._card;
        this.card.clear();
        this.card.fillStyle(0x0d1f13, 0.95); this.card.fillRoundedRect(b.x, b.y, b.w, b.h, 18);
        this.card.lineStyle(2, 0x57a86a, 0.5); this.card.strokeRoundedRect(b.x, b.y, b.w, b.h, 18);
        // Show the team's helmet sprite in the card center.
        if (this.helmetImg) { this.helmetImg.destroy(); this.helmetImg = null; }
        const hy = b.y + (b.h - 90) / 2 + 30;
        this.helmetImg = addHelmetSprite(this, c.name, W / 2, hy, 150, { depth: 3 });
        this.nameTxt.setText(c.name);
    }

    start() {
        const colorName = TEAM_COLORS[this.colorIndex].name;
        const season = seasonMgr();
        let opponentColorName;
        if (this.mode === 'season') {
            season.start(colorName);
            opponentColorName = season.data.opponentColor;
        } else {
            const others = TEAM_COLORS.filter(c => c.name !== colorName);
            opponentColorName = others[Math.floor(Math.random() * others.length)].name;
        }
        this.startMenu.destroy();
        this.scene.start('GameScene', {
            isSeason: this.mode === 'season',
            playerColorName: colorName,
            opponentColorName
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEASON SCENE — full 16-game schedule view + playoff rows
// Layout (1000×600):
//   y  0–82  : header (title, record, divider, col labels)
//   y 82–482 : game rows  (400 px, dynamic height)
//   y 482–496: bottom divider + breathing room
//   y 496–596: two buttons (itemH 38 + gap 8 = 84 px, centred at y 538)
// ═══════════════════════════════════════════════════════════════════════════════
class SeasonScene extends Phaser.Scene {
    constructor() { super({ key: 'SeasonScene' }); }

    preload() { loadHelmets(this); }

    create() {
        const audio  = audioSys();
        const season = seasonMgr();

        // If no season is active, show a "start one" prompt instead.
        if (!season.isActive()) {
            this.add.rectangle(0, 0, W, H, 0x0a1408).setOrigin(0);
            this.add.text(W / 2, 200, 'NO ACTIVE SEASON', {
                fontSize: '34px', fontFamily: 'Arial Black', color: '#FFD700',
                stroke: '#000', strokeThickness: 5
            }).setOrigin(0.5);
            this.add.text(W / 2, 260, 'Start a new season to track your record.', {
                fontSize: '18px', fontFamily: 'Arial', color: '#a8dba8'
            }).setOrigin(0.5);
            audio.speak('No active season. Start a new season?', true);
            this.menu = new ScanList(this, {
                x: W / 2, y: 370, audio,
                options: [
                    { label: 'NEW SEASON', value: 'new_season', hint: '16 game season' },
                    { label: 'MAIN MENU',  value: 'menu' }
                ],
                itemW: 340,
                onSelect: (opt) => this.handle(opt.value)
            });
            this.scanInput = new ScanInput(this, {
                forward:  () => this.menu.next(false),
                backward: () => this.menu.prev(false),
                select:   () => this.menu.select(),
                escape:   () => this.scene.start('TitleScene')
            });
            return;
        }

        const d = season.data;

        // ── Build the row descriptors ─────────────────────────────────────────
        const rows = this._buildRows(d, d.results || []);
        // 400 px list area; keep rows at least 21 px tall so text stays readable
        const ROW_H    = Math.max(21, Math.floor(400 / rows.length));
        const LIST_Y   = 82;   // top of first row
        const BTNS_Y   = 538;  // ScanList centre  (2×38 + 8 = 84 px → spans 496–580)

        // ── Background ───────────────────────────────────────────────────────
        this.add.rectangle(0, 0, W, H, 0x0a1408).setOrigin(0);
        const bg = this.add.graphics();
        for (let i = 0; i < 20; i++) {
            bg.fillStyle(i % 2 === 0 ? 0x0d1b0b : 0x0a1408, 1);
            bg.fillRect(0, i * 32, W, 32);
        }
        this.add.rectangle(0, 0, W, H, 0x000000, 0.20).setOrigin(0);

        // ── Header ───────────────────────────────────────────────────────────
        this.add.text(W / 2, 14, 'SEASON RECORD', {
            fontSize: '28px', fontFamily: 'Arial Black', color: '#FFD700',
            stroke: '#000', strokeThickness: 5
        }).setOrigin(0.5, 0);

        this.add.text(W / 2, 47, `${d.wins} - ${d.losses}   ·   ${this._stageLabel(d)}`, {
            fontSize: '17px', fontFamily: 'Arial', color: '#a8dba8',
            stroke: '#000', strokeThickness: 2
        }).setOrigin(0.5, 0);

        // Column header labels just above the list
        this.add.graphics().lineStyle(1, 0x3d6b3d, 0.7).lineBetween(24, 68, W - 24, 68);
        this._drawColHeaders(76);
        this.add.graphics().lineStyle(1, 0x3d6b3d, 0.4).lineBetween(24, LIST_Y, W - 24, LIST_Y);

        // ── Game rows ────────────────────────────────────────────────────────
        rows.forEach((row, i) => {
            const cy = LIST_Y + i * ROW_H + ROW_H / 2;
            this._drawRow(cy, row, ROW_H);
        });

        // ── Bottom divider ───────────────────────────────────────────────────
        const listBottom = LIST_Y + rows.length * ROW_H;
        this.add.graphics().lineStyle(1, 0x3d6b3d, 0.6).lineBetween(24, listBottom + 6, W - 24, listBottom + 6);

        // ── Season-over banner (replaces play button space if done) ──────────
        if (season.isSeasonOver()) {
            this.add.text(W / 2, listBottom + 16, this._overLabel(d), {
                fontSize: '20px', fontFamily: 'Arial Black',
                color: d.stage === 'champions' ? '#FFD700' : '#ff8866',
                stroke: '#000', strokeThickness: 3
            }).setOrigin(0.5, 0);
        }

        // ── Action buttons — always at fixed bottom position ─────────────────
        const opts = [];
        if (!season.isSeasonOver()) {
            if (season.hasGameInProgress()) {
                const gs = season.loadGameState().gs;
                const q = gs.overtime ? 'OT' : `Q${gs.quarter}`;
                const min = Math.floor(gs.timeRemaining / 60);
                const sec = Math.floor(gs.timeRemaining % 60);
                let resumeSpeakText;
                if (d.stage === 'regular') {
                    resumeSpeakText = `Resume game ${d.gamesPlayed + 1}`;
                } else if (d.stage === 'playoffs') {
                    if (d.playoffRound === 0) {
                        resumeSpeakText = 'Resume wildcard game';
                    } else if (d.playoffRound >= 2) {
                        resumeSpeakText = 'Resume championship';
                    } else {
                        resumeSpeakText = 'Resume playoffs';
                    }
                } else {
                    resumeSpeakText = 'Resume championship';
                }
                opts.push({
                    label: 'RESUME GAME',
                    value: 'resume',
                    hint: `${d.teamColor} ${gs.score.us} - ${gs.score.them} ${d.opponentColor} · ${q} ${min}:${sec.toString().padStart(2,'0')}`,
                    speakText: resumeSpeakText
                });
            } else {
                opts.push({ label: 'PLAY NEXT GAME', value: 'play' });
            }
        }
        if (season.isSeasonOver()) opts.push({ label: 'NEW SEASON', value: 'new_season', hint: 'start fresh' });
        opts.push({ label: 'MAIN MENU', value: 'menu' });

        this.menu = new ScanList(this, {
            x: W / 2, y: BTNS_Y, options: opts, audio,
            itemW: 340, itemH: 38, gap: 8,
            onSelect: (opt) => this.handle(opt.value)
        });

        // ── TTS — announces record and upcoming game ─────────────────────────
        let tts;
        if (season.isSeasonOver()) {
            tts = this._overLabel(d);
        } else if (season.hasGameInProgress()) {
            const gs = season.loadGameState().gs;
            const q = gs.overtime ? 'Overtime' : `Quarter ${gs.quarter}`;
            tts = `Record ${d.wins} and ${d.losses}. ${d.teamColor} ${gs.score.us}, ${d.opponentColor} ${gs.score.them}. ${q}.`;
        } else if (d.stage === 'regular') {
            tts = `Record ${d.wins} and ${d.losses}. Next game against ${d.opponentColor}.`;
        } else {
            const roundName = d.stage === 'playoffs'
                ? this._tc(SEASON.PLAYOFF_ROUNDS[d.playoffRound])
                : 'Championship';
            tts = `Record ${d.wins} and ${d.losses}. Next up: ${roundName} against ${d.opponentColor}.`;
        }
        audio.speak(tts, true);

        // ── Keyboard navigation ───────────────────────────────────────────────
        this.scanInput = new ScanInput(this, {
            forward:  () => this.menu.next(false),
            backward: () => this.menu.prev(false),
            select:   () => this.menu.select(),
            escape:   () => this.scene.start('TitleScene')
        });
    }

    // Build a flat array of row descriptors covering all 16 regular-season
    // slots plus any playoff/championship games.
    _buildRows(d, results) {
        const rows = [];
        const regRes = results.filter(r => r.stage === 'regular');

        // ── 16 regular-season slots ──
        for (let i = 0; i < SEASON.REGULAR_GAMES; i++) {
            const gameNum = i + 1;
            if (i < regRes.length) {
                // Played game
                rows.push({ kind: 'done', gameNum, result: regRes[i],
                            label: `Game ${gameNum} of ${SEASON.REGULAR_GAMES}` });
            } else if (d.stage === 'regular' && i === d.gamesPlayed) {
                // This is the next game to play
                rows.push({ kind: 'next', gameNum,
                            oppName: d.opponentColor,
                            label: `Game ${gameNum} of ${SEASON.REGULAR_GAMES}` });
            } else {
                // Not yet scheduled / future
                const oppName = (d.schedule && d.schedule[i]) || '?';
                rows.push({ kind: 'future', gameNum, oppName,
                            label: `Game ${gameNum} of ${SEASON.REGULAR_GAMES}` });
            }
        }

        // ── Playoff / championship rows ──
        const poRes = results.filter(r => r.stage === 'playoffs' || r.stage === 'championship');
        poRes.forEach((r, idx) => {
            const lbl = r.stage === 'playoffs'
                ? this._tc(SEASON.PLAYOFF_ROUNDS[idx] || 'Playoffs')
                : 'Championship';
            rows.push({ kind: 'done', gameNum: SEASON.REGULAR_GAMES + idx + 1,
                        result: r, label: lbl });
        });

        // Current active playoff / championship game
        if ((d.stage === 'playoffs' || d.stage === 'championship') &&
            !['done', 'failed', 'champions'].includes(d.stage)) {
            const lbl = d.stage === 'playoffs'
                ? this._tc(SEASON.PLAYOFF_ROUNDS[d.playoffRound])
                : 'Championship';
            rows.push({ kind: 'next', gameNum: SEASON.REGULAR_GAMES + poRes.length + 1,
                        oppName: d.opponentColor, label: lbl });
        }

        return rows;
    }

    _drawColHeaders(y) {
        const s = { fontSize: '12px', fontFamily: 'Arial', fontStyle: 'bold',
                    color: '#4d844d', stroke: '#000', strokeThickness: 1 };
        this.add.text(44,  y, '#',        s).setOrigin(0.5, 0.5);
        this.add.text(70,  y, 'GAME',     s).setOrigin(0,   0.5);
        this.add.text(265, y, 'OPPONENT', s).setOrigin(0,   0.5);
        this.add.text(695, y, 'RESULT',   s).setOrigin(0.5, 0.5);
        this.add.text(868, y, 'SCORE',    s).setOrigin(0.5, 0.5);
    }

    _drawRow(cy, row, rowH) {
        const pad    = rowH - 4;  // bg rect height
        const fMain  = `${Math.min(16, Math.max(13, rowH - 9))}px`;  // scales with row height
        const fSmall = `${Math.min(14, Math.max(12, rowH - 11))}px`;

        if (row.kind === 'next') {
            // ── NEXT UP — bright highlighted row ─────────────────────────────
            const g = this.add.graphics();
            g.fillStyle(0x1a2e0a, 1);
            g.fillRect(24, cy - pad / 2, W - 48, pad);
            g.lineStyle(2, 0xffd700, 0.85);
            g.strokeRect(24, cy - pad / 2, W - 48, pad);

            // Game #
            this.add.text(44, cy, String(row.gameNum), {
                fontSize: fSmall, fontFamily: 'Arial Black', color: '#FFD700',
                stroke: '#000', strokeThickness: 2
            }).setOrigin(0.5, 0.5);

            // Label
            this.add.text(70, cy, row.label, {
                fontSize: fSmall, fontFamily: 'Arial', color: '#FFD700',
                stroke: '#000', strokeThickness: 1
            }).setOrigin(0, 0.5);

            // Opponent helmet + name
            const opp = getColorByName(row.oppName);
            const swatchH = Math.min(rowH - 6, 18);
            const hw1 = swatchH * HELMET_ASPECT;
            addHelmetSprite(this, row.oppName, 266 + hw1 / 2, cy, swatchH);
            this.add.text(266 + hw1 + 6, cy, row.oppName, {
                fontSize: fMain, fontFamily: 'Arial Black', color: opp.css,
                stroke: '#000', strokeThickness: 2
            }).setOrigin(0, 0.5);

            // NEXT badge
            this.add.text(695, cy, '► NEXT', {
                fontSize: fMain, fontFamily: 'Arial Black', color: '#FFD700',
                stroke: '#000', strokeThickness: 2
            }).setOrigin(0.5, 0.5);

        } else if (row.kind === 'done') {
            // ── Completed game ────────────────────────────────────────────────
            const r   = row.result;
            const won = r.win;
            this.add.rectangle(W / 2, cy, W - 48, pad, won ? 0x193519 : 0x351919, 0.55)
                .setOrigin(0.5);

            this.add.text(44, cy, String(row.gameNum), {
                fontSize: fSmall, fontFamily: 'Arial', color: '#888888'
            }).setOrigin(0.5, 0.5);

            this.add.text(70, cy, row.label, {
                fontSize: fSmall, fontFamily: 'Arial', color: '#7ab87a'
            }).setOrigin(0, 0.5);

            const opp     = getColorByName(r.opp);
            const swatchH = Math.min(rowH - 8, 14);
            const hw2 = swatchH * HELMET_ASPECT;
            addHelmetSprite(this, r.opp, 266 + hw2 / 2, cy, swatchH);
            this.add.text(266 + hw2 + 6, cy, r.opp, {
                fontSize: fMain, fontFamily: 'Arial', fontStyle: 'bold', color: opp.css,
                stroke: '#000', strokeThickness: 1
            }).setOrigin(0, 0.5);

            this.add.text(695, cy, won ? 'WIN' : 'LOSS', {
                fontSize: fMain, fontFamily: 'Arial Black',
                color: won ? '#55ee55' : '#ee5555', stroke: '#000', strokeThickness: 2
            }).setOrigin(0.5, 0.5);

            this.add.text(868, cy, `${r.us} - ${r.them}`, {
                fontSize: fSmall, fontFamily: 'Arial', color: '#cccccc'
            }).setOrigin(0.5, 0.5);

        } else {
            // ── Future / upcoming game ────────────────────────────────────────
            this.add.rectangle(W / 2, cy, W - 48, pad, 0x0d1a0d, 0.35).setOrigin(0.5);

            this.add.text(44, cy, String(row.gameNum), {
                fontSize: fSmall, fontFamily: 'Arial', color: '#555555'
            }).setOrigin(0.5, 0.5);

            this.add.text(70, cy, row.label, {
                fontSize: fSmall, fontFamily: 'Arial', color: '#4a6e4a'
            }).setOrigin(0, 0.5);

            const opp     = getColorByName(row.oppName);
            const swatchH = Math.min(rowH - 8, 14);
            const hw3 = swatchH * HELMET_ASPECT;
            addHelmetSprite(this, row.oppName, 266 + hw3 / 2, cy, swatchH, { alpha: 0.55 });
            this.add.text(266 + hw3 + 6, cy, row.oppName, {
                fontSize: fMain, fontFamily: 'Arial', color: '#6a946a'
            }).setOrigin(0, 0.5);

            this.add.text(695, cy, '--', {
                fontSize: fSmall, fontFamily: 'Arial', color: '#3d5c3d'
            }).setOrigin(0.5, 0.5);

            this.add.text(868, cy, '--', {
                fontSize: fSmall, fontFamily: 'Arial', color: '#3d5c3d'
            }).setOrigin(0.5, 0.5);
        }
    }

    _stageLabel(d) {
        if (d.stage === 'regular')      return `Regular Season — Game ${d.gamesPlayed + 1} of ${SEASON.REGULAR_GAMES}`;
        if (d.stage === 'playoffs')     return `Playoffs — ${this._tc(SEASON.PLAYOFF_ROUNDS[d.playoffRound])}`;
        if (d.stage === 'championship') return 'Championship Game';
        if (d.stage === 'champions')    return 'Champions!';
        return 'Season Complete';
    }

    _overLabel(d) {
        if (d.stage === 'champions') return 'CHAMPIONS! You won it all!';
        if (d.stage === 'failed')    return 'Season over — missed the playoffs.';
        if (d.stage === 'done')      return 'Eliminated from the playoffs.';
        return '';
    }

    _tc(s) {
        return String(s).split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }

    handle(value) {
        const season = seasonMgr();
        if (value === 'play') {
            this.scene.start('GameScene', {
                isSeason: true,
                playerColorName: season.data.teamColor,
                opponentColorName: season.data.opponentColor
            });
        } else if (value === 'resume') {
            this.scene.start('GameScene', {
                isSeason: true,
                resume: true,
                playerColorName: season.data.teamColor,
                opponentColorName: season.data.opponentColor
            });
        } else if (value === 'new_season') {
            this.scene.start('ColorSelectScene', { mode: 'season' });
        } else {
            this.scene.start('TitleScene');
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSTRUCTIONS SCENE  —  how to play, with automatic TTS read-aloud
// ═══════════════════════════════════════════════════════════════════════════════
class InstructionsScene extends Phaser.Scene {
    constructor() { super({ key: 'InstructionsScene' }); }

    create() {
        this.audio = audioSys();

        // Background — same striped look as SettingsScene
        const g = this.add.graphics().setDepth(0);
        g.fillStyle(0x0a1408); g.fillRect(0, 0, W, H);
        for (let i = 0; i < 20; i++) {
            g.fillStyle(i % 2 === 0 ? 0x0d1b0b : 0x0a1408);
            g.fillRect(0, i * 32, W, 32);
        }
        this.add.rectangle(0, 0, W, H, 0x000000, 0.18).setOrigin(0).setDepth(1);

        this.add.text(W / 2, 36, 'HOW TO PLAY', {
            fontSize: '38px', fontFamily: 'Arial Black', color: '#FFD700',
            stroke: '#000', strokeThickness: 6
        }).setOrigin(0.5).setDepth(5);

        // Panel behind the instruction text
        this.add.rectangle(W / 2, 295, 940, 436, 0x06120a, 0.82)
            .setOrigin(0.5).setDepth(2).setStrokeStyle(2, 0xffd700, 0.45);

        const wrapW = 415;
        const COL1 = 58, COL2 = 515;

        // Helper: render a heading + body block, return the next y position.
        const sec = (x, y, head, body) => {
            this.add.text(x, y, head, {
                fontSize: '14px', fontFamily: 'Arial Black', color: '#FFD700',
                stroke: '#000', strokeThickness: 3
            }).setDepth(5);
            const t = this.add.text(x, y + 21, body, {
                fontSize: '13px', fontFamily: 'Arial', color: '#dff5df',
                wordWrap: { width: wrapW }, lineSpacing: 2
            }).setDepth(5);
            return y + 21 + t.height + 16;
        };

        // ── Left column ─────────────────────────────────────────────────────
        let y1 = 80;
        y1 = sec(COL1, y1, 'GOAL',
            'Score more points than the CPU before time runs out. ' +
            'You play offense and defense on every drive across 4 quarters.');
        y1 = sec(COL1, y1, 'RUNNING THE BALL',
            'Select Run, then hold ENTER (or tap-and-hold) to charge power. ' +
            'Release when the meter is high — more power means more yards.');
        y1 = sec(COL1, y1, 'DOWNS',
            'You get 4 downs to gain 10 yards for a first down. ' +
            'Fail on 4th down and the other team takes over at that spot.');
        y1 = sec(COL1, y1, 'SCORING',
            'Touchdown = 6 pts + extra-point kick (1 pt).  ' +
            'Field Goal = 3 pts.  Safety = 2 pts for the other team.');

        // ── Right column ─────────────────────────────────────────────────────
        let y2 = 80;
        y2 = sec(COL2, y2, 'CONTROLS',
            'SPACE or click/tap to scan through options. ' +
            'ENTER or click/tap to select. Hold ENTER (or tap-and-hold / click-and-hold) to charge power, then release to throw or kick.');
        y2 = sec(COL2, y2, 'PASSING',
            'Pick a route, then a receiver. Hold ENTER (or tap-and-hold) to charge the throw, ' +
            'then release. On touchscreen, tap the spot you want to aim for.');
        y2 = sec(COL2, y2, 'FIELD GOALS & PUNTS',
            'Tap the screen where you want to aim (or sweep with SPACE). ' +
            'Hold ENTER (or tap-and-hold) to charge kick power, then release. ' +
            'Punt option appears on 4th down only.');
        y2 = sec(COL2, y2, 'EASY THROW TIP',
            'Turn on Easy Throw in Settings to skip charge — ' +
            'just pick a receiver and it throws at ideal power automatically.');

        // ── Buttons at the bottom ────────────────────────────────────────────
        this.menu = new ScanList(this, {
            x: W / 2, y: 557, options: [
                { label: 'READ ALOUD AGAIN', value: 'read' },
                { label: 'BACK TO MAIN MENU', value: 'back' }
            ],
            audio: this.audio, itemW: 360, itemH: 38, gap: 8,
            onSelect: (opt) => this._handle(opt.value)
        });

        this.scanInput = new ScanInput(this, {
            forward:  () => this.menu.next(false),
            backward: () => this.menu.prev(false),
            select:   () => this.menu.select(),
            escape:   () => this.scene.start('TitleScene')
        });

        // Speak on load automatically
        this._speak();
    }

    _speak() {
        const lines = [
            "How to Play Benny's Football.",
            "Goal: Score more points than the CPU before time runs out.",
            "Controls: Press SPACE or click or tap to scan. ENTER, or click-and-hold, or tap-and-hold to charge power, then release to throw or kick.",
            "Running: Select Run, then hold ENTER or tap-and-hold to charge. Release for yards.",
            "Passing: Pick a route and a receiver. Hold ENTER or tap-and-hold to charge, then release. On touchscreen, tap where you want to aim.",
            "Field Goals: Tap where you want to aim, or sweep with SPACE. Hold ENTER or tap-and-hold to charge kick power, then release. Punts are on 4th down only.",
            "Downs: 4 downs to gain 10 yards. Fail on 4th and the other team takes over.",
            "Scoring: Touchdown is 6 points plus an extra point kick. Field Goal is 3 points.",
            "Tip: Enable Easy Throw in Settings to skip charging."
        ];
        this.audio.speak(lines.join('  '), true);
    }

    _handle(value) {
        if (value === 'read') {
            this._speak();
        } else {
            this.scene.start('TitleScene');
        }
    }
}
