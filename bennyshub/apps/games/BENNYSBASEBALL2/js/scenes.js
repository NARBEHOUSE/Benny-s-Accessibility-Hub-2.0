// ═══════════════════════════════════════════════════════════════════════════════
// BENNY'S BASEBALL 2 - Scenes (Title, Settings, Color Select, Season, Instructions)
// Structure, layout, and theme ported from BENNYSFOOTBALL/js/scenes.js —
// same menus, same season-table presentation, same input scheme — with
// baseball caps standing in for football helmets.
// ═══════════════════════════════════════════════════════════════════════════════

// Shared, lazily-created singletons (same pattern as football).
let GAME_AUDIO = null;
let GAME_SEASON = null;
function audioSys() { if (!GAME_AUDIO) GAME_AUDIO = new AudioSystem(); return GAME_AUDIO; }
function seasonMgr() { if (!GAME_SEASON) GAME_SEASON = new SeasonManager(); return GAME_SEASON; }

// The team cap art: images/cap.png (light gray with black outlines and a
// transparent background) tinted to each team's color.
function loadCap(scene) {
    if (!scene.textures.exists('cap')) scene.load.image('cap', 'images/cap.png');
}

// Build (once per team) a recolored copy of cap.png that KEEPS the artwork's
// shading: dark outlines/stitching stay, and the gray fabric is remapped to
// team-color shades by luminance — so it still looks like the original hat,
// not a flat silhouette.
function capTextureFor(scene, colorName) {
    const key = 'cap-' + colorName;
    if (scene.textures.exists(key)) return key;
    if (!scene.textures.exists('cap')) return null;
    const srcImg = scene.textures.get('cap').getSourceImage();
    const w = srcImg.width, h = srcImg.height;
    const canvasTex = scene.textures.createCanvas(key, w, h);
    const ctx = canvasTex.getContext();
    ctx.drawImage(srcImg, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    const col = getColorByName(colorName);
    const tr = (col.hex >> 16) & 0xff, tg = (col.hex >> 8) & 0xff, tb = col.hex & 0xff;
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;                     // transparent
        const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
        if (lum < 70) continue;                            // keep outlines/stitching
        const shade = Math.min(1.15, lum / 205);           // fabric shading factor
        px[i]     = Math.min(255, tr * shade);
        px[i + 1] = Math.min(255, tg * shade);
        px[i + 2] = Math.min(255, tb * shade);
    }
    ctx.putImageData(data, 0, 0);
    canvasTex.refresh();
    return key;
}

function addCapSprite(scene, colorName, x, y, h, opts) {
    const c = getColorByName(colorName);
    const alpha = (opts && opts.alpha != null) ? opts.alpha : 1;
    const texKey = capTextureFor(scene, colorName);
    if (texKey) {
        const src = scene.textures.get('cap').getSourceImage();
        const aspect = src.width / src.height;
        const img = scene.add.image(x, y, texKey)
            .setDisplaySize(h * aspect, h)
            .setAlpha(alpha);
        if (opts && opts.depth != null) img.setDepth(opts.depth);
        return img;
    }
    // Fallback if the texture isn't available: simple drawn cap
    const cont = scene.add.container(x, y);
    if (opts && opts.depth != null) cont.setDepth(opts.depth);
    const g = scene.add.graphics();
    const r = h * 0.62;
    g.fillStyle(c.hex, alpha);
    g.slice(0, h * 0.18, r, Math.PI, 0, false);
    g.fillPath();
    g.fillEllipse(r * 0.72, h * 0.20, r * 1.25, h * 0.30);
    cont.add(g);
    return cont;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TITLE SCENE  —  Quick Game / Season Mode / Instructions / Settings / Exit
// ═══════════════════════════════════════════════════════════════════════════════
class TitleScene extends Phaser.Scene {
    constructor() { super({ key: 'TitleScene' }); }

    create() {
        const audio = audioSys();
        // Background music (v1's tracks). Autoplay may need a gesture, so
        // retry on the first press/click.
        audio.startMusic();
        this.input.once('pointerdown', () => audio.startMusic());
        if (this.input.keyboard) this.input.keyboard.once('keydown', () => audio.startMusic());
        this.drawMenuField();
        this.add.rectangle(0, 0, W, H, 0x000000, 0.30).setOrigin(0).setDepth(1);

        this.add.text(W / 2, 56, "BENNY'S BASEBALL", {
            fontSize: '54px', fontFamily: 'Arial Black', color: '#FFD700',
            stroke: '#000', strokeThickness: 7
        }).setOrigin(0.5).setDepth(5);

        const opts = [
            { label: 'QUICK GAME',    value: 'exhibition',   hint: 'casual single game, not tracked' },
            { label: 'SEASON MODE',   value: 'season',       hint: '16 game season, playoff series, and a best of five championship' },
            { label: 'INSTRUCTIONS',  value: 'instructions', hint: 'how to play' },
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

        this.add.text(W / 2, H - 22, 'SPACE or click/tap = scan  ·  ENTER = select  ·  hold ENTER = charge your swing', {
            fontSize: '15px', fontFamily: 'Arial', color: '#dff5df',
            stroke: '#000', strokeThickness: 2
        }).setOrigin(0.5).setDepth(5);

        this.scanInput = new ScanInput(this, {
            forward: () => this.menu.next(false),
            backward: () => this.menu.prev(false),
            select: () => this.menu.select()
        });
    }

    // A big clean baseball-diamond backdrop filling the screen.
    drawMenuField() {
        const g = this.add.graphics().setDepth(0);
        g.fillStyle(0x0a1408); g.fillRect(0, 0, W, H);
        // Outfield grass fan
        g.fillStyle(0x2e7d3a, 1);
        g.beginPath();
        g.arc(W / 2, H + 160, 640, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340));
        g.lineTo(W / 2 + 610, H + 160);
        g.lineTo(W / 2 - 610, H + 160);
        g.closePath();
        g.fillPath();
        // Subtle mow wedges
        for (let i = 0; i < 8; i++) {
            if (i % 2 === 0) continue;
            const a0 = Phaser.Math.DegToRad(210 + i * 15), a1 = Phaser.Math.DegToRad(210 + (i + 1) * 15);
            g.fillStyle(0xffffff, 0.045);
            g.beginPath();
            g.moveTo(W / 2, H + 160);
            g.arc(W / 2, H + 160, 640, a0, a1);
            g.closePath();
            g.fillPath();
        }
        // Diamond
        const home = { x: W / 2, y: H - 60 }, size = 210;
        const first = { x: home.x + size, y: home.y - size * 0.72 };
        const second = { x: home.x, y: home.y - size * 1.44 };
        const third = { x: home.x - size, y: home.y - size * 0.72 };
        g.fillStyle(0xb98a4a, 1);
        const cd = { x: home.x, y: home.y - size * 0.72 };
        const inflate = (p, d) => {
            const dx = p.x - cd.x, dy = p.y - cd.y, len = Math.hypot(dx, dy) || 1;
            return { x: p.x + dx / len * d, y: p.y + dy / len * d };
        };
        g.fillPoints([home, first, second, third].map(p => inflate(p, 34)), true);
        g.fillStyle(0x2c7a38, 1);
        g.fillPoints([home, first, second, third].map(p => inflate(p, -26)), true);
        g.fillStyle(0xb98a4a, 1);
        g.fillEllipse(cd.x, cd.y + 6, 52, 32);
        g.lineStyle(3, 0xffffff, 0.85);
        g.strokePoints([home, first, second, third], true);
        [first, second, third].forEach(b => {
            g.fillStyle(0xffffff, 1);
            g.save(); g.translateCanvas(b.x, b.y); g.rotateCanvas(Math.PI / 4);
            g.fillRect(-8, -8, 16, 16); g.restore();
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
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ action: 'focusBackButton' }, '*');
            } else {
                window.location.href = '../../../index.html';
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS SCENE — same options as football minus its game-specific toggles
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
        const musicOn  = a.settings.musicEnabled;
        const season   = seasonMgr();

        const voiceName = (vm && vm.getCurrentVoice && vm.getVoiceDisplayName)
            ? vm.getVoiceDisplayName(vm.getCurrentVoice()) : 'Default';
        const opts = [
            { label: `Sound Effects: ${sfxOn  ? 'ON' : 'OFF'}`, value: 'sfx' },
            { label: `Music: ${musicOn ? 'ON' : 'OFF'}`,        value: 'music' },
            { label: 'Next Track',                                value: 'nexttrack' },
            { label: `Music Mode: ${(a.settings.musicMode || 'shuffle').toUpperCase()}`, value: 'musicmode' },
            { label: `TTS: ${ttsOn ? 'ON' : 'OFF'}`,            value: 'tts' },
            { label: `Voice: ${voiceName}`,                       value: 'voice' },
            { label: `Auto Scan: ${autoScan ? 'ON' : 'OFF'}`,   value: 'autoscan' },
            { label: `Scan Speed: ${scanSec}s`,                   value: 'scanspeed' }
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

        if (restoreIndex >= 0 && restoreIndex < opts.length) {
            this.menu.index = restoreIndex;
            this.menu._draw();
        }
    }

    _handle(value) {
        const a = this.audio;
        const nm = window.NarbeScanManager;
        const vm = window.NarbeVoiceManager;
        const idx = this.menu ? this.menu.index : -1;

        if (value === 'sfx') {
            a.toggleSound();
            a.speak(a.settings.soundEnabled ? 'Sound on.' : 'Sound off.', true);
            this._buildMenu(idx);
        } else if (value === 'music') {
            a.toggleMusic();
            a.speak(a.settings.musicEnabled ? 'Music on.' : 'Music off.', true);
            this._buildMenu(idx);
        } else if (value === 'tts') {
            if (vm && typeof vm.toggleTTS === 'function') {
                const nowOn = vm.toggleTTS();
                a.speak(nowOn ? 'TTS on.' : 'TTS off.', true);
            }
            this._buildMenu(idx);
        } else if (value === 'voice') {
            if (vm && typeof vm.cycleVoice === 'function') {
                vm.cycleVoice();
                const nv = (vm.getCurrentVoice && vm.getVoiceDisplayName)
                    ? vm.getVoiceDisplayName(vm.getCurrentVoice()) : 'voice';
                a.speak(`Voice: ${nv}.`, true);
            }
            this._buildMenu(idx);
        } else if (value === 'nexttrack') {
            const t = a.nextTrack();
            a.speak(`Track ${t}.`, true);
            this._buildMenu(idx);
        } else if (value === 'musicmode') {
            const mode = a.toggleMusicMode();
            a.speak(mode === 'loop' ? 'Music will loop the current song.' : 'Music will shuffle between songs.', true);
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
                const speeds = [1000, 1500, 2000, 2500, 3000];
                const cur = nm.getSettings().scanInterval || 2000;
                const next = speeds[(speeds.indexOf(cur) + 1) % speeds.length];
                if (typeof nm.setScanInterval === 'function') nm.setScanInterval(next);
            }
            const newSec = nm && nm.getSettings ? ((nm.getSettings().scanInterval || 2000) / 1000).toFixed(1) : '?';
            a.speak(`Scan speed ${newSec} seconds.`, true);
            this._buildMenu(idx);
        } else if (value === 'reset_season') {
            this._confirmingReset = true;
            this._buildMenu();
        } else if (value === 'confirm_reset') {
            seasonMgr().reset();
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
// COLOR SELECT SCENE — one big swatch card you cycle with the arrows / SPACE,
// then START GAME. Identical layout to football's; the card shows a baseball cap.
// ═══════════════════════════════════════════════════════════════════════════════
class ColorSelectScene extends Phaser.Scene {
    constructor() { super({ key: 'ColorSelectScene' }); }
    init(data) { this.mode = data.mode || 'exhibition'; this.colorIndex = 0; }
    preload() { loadCap(this); }

    create() {
        const audio = audioSys();
        this.add.rectangle(0, 0, W, H, 0x0a1408).setOrigin(0);
        const bg = this.add.graphics();
        for (let i = 0; i < 12; i++) {
            bg.fillStyle(i % 2 === 0 ? 0x102a16 : 0x0c2212, 1);
            bg.fillRect(0, i * 50, W, 50);
        }

        this.add.text(W / 2, 70, 'CHOOSE YOUR TEAM', {
            fontSize: '40px', fontFamily: 'Arial', fontStyle: 'bold', color: '#ffffff'
        }).setOrigin(0.5);
        this.add.text(W / 2, 112, this.mode === 'season'
            ? '16-game season · best-of-3 playoff series · best-of-5 championship'
            : 'Quick exhibition game', {
            fontSize: '18px', fontFamily: 'Arial', color: '#9ccc9c'
        }).setOrigin(0.5);

        const cardW = 360, cardH = 230, cardX = W / 2 - cardW / 2, cardY = 170;
        this.card = this.add.graphics().setDepth(2);
        this.capImg = null;
        this.nameTxt = this.add.text(W / 2, cardY + cardH - 36, '', {
            fontSize: '34px', fontFamily: 'Arial', fontStyle: 'bold', color: '#ffffff'
        }).setOrigin(0.5).setDepth(4);
        this._card = { x: cardX, y: cardY, w: cardW, h: cardH };

        this.leftBtn = this._arrow(cardX - 70, cardY + cardH / 2, '◀', () => this.cycle(-1));
        this.rightBtn = this._arrow(cardX + cardW + 70, cardY + cardH / 2, '▶', () => this.cycle(1));

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

        this.input.keyboard.on('keydown-LEFT', () => this.cycle(-1));
        this.input.keyboard.on('keydown-RIGHT', () => this.cycle(1));
        this.scanInput = new ScanInput(this, {
            forward: () => this.cycle(1),
            backward: () => this.cycle(-1),
            select: () => this.start(),
            escape: () => this.scene.start('TitleScene')
        });
        audioSys().speak('Choose your team. Space to change color, enter to start.', true);
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
        this.colorIndex = (this.colorIndex + dir + COLOR_OPTIONS.length) % COLOR_OPTIONS.length;
        this.drawColor();
        audioSys().play('scan');
        audioSys().speak(COLOR_OPTIONS[this.colorIndex].name, true);
    }

    drawColor() {
        const c = COLOR_OPTIONS[this.colorIndex];
        const b = this._card;
        this.card.clear();
        this.card.fillStyle(0x0d1f13, 0.95); this.card.fillRoundedRect(b.x, b.y, b.w, b.h, 18);
        this.card.lineStyle(2, 0x57a86a, 0.5); this.card.strokeRoundedRect(b.x, b.y, b.w, b.h, 18);
        if (this.capImg) { this.capImg.destroy(); this.capImg = null; }
        this.capImg = addCapSprite(this, c.name, W / 2, b.y + (b.h - 60) / 2 + 8, 128, { depth: 3 });
        this.nameTxt.setText(c.name);
    }

    start() {
        const colorName = COLOR_OPTIONS[this.colorIndex].name;
        const season = seasonMgr();
        let opponentColorName;
        if (this.mode === 'season') {
            season.start(colorName);
            opponentColorName = season.data.opponentColor;
        } else {
            const others = COLOR_OPTIONS.filter(c => c.name !== colorName);
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
// SEASON SCENE — full 16-game schedule view + playoff-series rows
// (direct port of football's SeasonScene layout with cap swatches)
// ═══════════════════════════════════════════════════════════════════════════════
class SeasonScene extends Phaser.Scene {
    constructor() { super({ key: 'SeasonScene' }); }

    preload() { loadCap(this); }

    create() {
        const audio  = audioSys();
        const season = seasonMgr();

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
                    { label: 'NEW SEASON', value: 'new_season', hint: '16 game season plus playoff series' },
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
        const rows = this._buildRows(d, d.results || []);
        const ROW_H  = Math.max(19, Math.floor(400 / rows.length));
        const LIST_Y = 82;
        const BTNS_Y = 538;

        this.add.rectangle(0, 0, W, H, 0x0a1408).setOrigin(0);
        const bg = this.add.graphics();
        for (let i = 0; i < 20; i++) {
            bg.fillStyle(i % 2 === 0 ? 0x0d1b0b : 0x0a1408, 1);
            bg.fillRect(0, i * 32, W, 32);
        }
        this.add.rectangle(0, 0, W, H, 0x000000, 0.20).setOrigin(0);

        this.add.text(W / 2, 14, 'SEASON RECORD', {
            fontSize: '28px', fontFamily: 'Arial Black', color: '#FFD700',
            stroke: '#000', strokeThickness: 5
        }).setOrigin(0.5, 0);

        this.add.text(W / 2, 47, `${d.wins} - ${d.losses}   ·   ${this._stageLabel(season)}`, {
            fontSize: '17px', fontFamily: 'Arial', color: '#a8dba8',
            stroke: '#000', strokeThickness: 2
        }).setOrigin(0.5, 0);

        this.add.graphics().lineStyle(1, 0x3d6b3d, 0.7).lineBetween(24, 68, W - 24, 68);
        this._drawColHeaders(76);
        this.add.graphics().lineStyle(1, 0x3d6b3d, 0.4).lineBetween(24, LIST_Y, W - 24, LIST_Y);

        rows.forEach((row, i) => {
            const cy = LIST_Y + i * ROW_H + ROW_H / 2;
            this._drawRow(cy, row, ROW_H);
        });

        const listBottom = LIST_Y + rows.length * ROW_H;
        this.add.graphics().lineStyle(1, 0x3d6b3d, 0.6).lineBetween(24, listBottom + 6, W - 24, listBottom + 6);

        if (season.isSeasonOver()) {
            this.add.text(W / 2, listBottom + 16, this._overLabel(d), {
                fontSize: '20px', fontFamily: 'Arial Black',
                color: d.stage === 'champions' ? '#FFD700' : '#ff8866',
                stroke: '#000', strokeThickness: 3
            }).setOrigin(0.5, 0);
        }

        const opts = [];
        if (!season.isSeasonOver()) {
            if (season.hasGameInProgress()) {
                const savedGs = season.loadGameState().gs;
                const youKey = savedGs.playerIsAway ? 'Red' : 'Blue';
                const cpuKey = savedGs.playerIsAway ? 'Blue' : 'Red';
                const halfTxt = savedGs.half === 'top' ? 'Top' : 'Bottom';
                opts.push({
                    label: 'RESUME GAME',
                    value: 'resume',
                    hint: `${d.teamColor} ${savedGs.score[youKey]} - ${savedGs.score[cpuKey]} ${d.opponentColor} · ${halfTxt} ${savedGs.inning}`,
                    speakText: `Resume game. ${d.teamColor} ${savedGs.score[youKey]}, ${d.opponentColor} ${savedGs.score[cpuKey]}, ${halfTxt} of the ${savedGs.inning}.`
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

        // TTS summary
        let tts;
        if (season.isSeasonOver()) {
            tts = this._overLabel(d);
        } else if (season.hasGameInProgress()) {
            tts = `Record ${d.wins} and ${d.losses}. You have a game in progress against ${d.opponentColor}.`;
        } else if (d.stage === 'regular') {
            tts = `Record ${d.wins} and ${d.losses}. Next game against ${d.opponentColor}.`;
        } else {
            const s = season.seriesInfo();
            tts = `Record ${d.wins} and ${d.losses}. ${this._tc(s.label)} series against ${d.opponentColor}. The series is ${s.wins} to ${s.losses}.`;
        }
        audio.speak(tts, true);

        this.scanInput = new ScanInput(this, {
            forward:  () => this.menu.next(false),
            backward: () => this.menu.prev(false),
            select:   () => this.menu.select(),
            escape:   () => this.scene.start('TitleScene')
        });
    }

    // 16 regular slots + one row per playoff-series game already played +
    // the next series game when a series is live.
    _buildRows(d, results) {
        const rows = [];
        const regRes = results.filter(r => r.stage === 'regular');

        for (let i = 0; i < SEASON.REGULAR_GAMES; i++) {
            const gameNum = i + 1;
            if (i < regRes.length) {
                rows.push({ kind: 'done', gameNum, result: regRes[i], label: `Game ${gameNum}` });
            } else if (d.stage === 'regular' && i === d.gamesPlayed) {
                rows.push({ kind: 'next', gameNum, oppName: d.opponentColor, label: `Game ${gameNum}` });
            } else {
                const oppName = (d.schedule && d.schedule[i]) || '?';
                rows.push({ kind: 'future', gameNum, oppName, label: `Game ${gameNum}` });
            }
        }

        // Playoff/championship series games
        const stageCounts = {};
        const poRes = results.filter(r => r.stage !== 'regular');
        poRes.forEach((r, idx) => {
            stageCounts[r.stage] = (stageCounts[r.stage] || 0) + 1;
            const spec = SEASON.SERIES[r.stage];
            rows.push({
                kind: 'done', gameNum: SEASON.REGULAR_GAMES + idx + 1, result: r,
                label: `${this._tc(spec ? spec.label : r.stage)} G${stageCounts[r.stage]}`
            });
        });

        if (SEASON.SERIES[d.stage]) {
            const spec = SEASON.SERIES[d.stage];
            const gameN = (stageCounts[d.stage] || 0) + 1;
            rows.push({
                kind: 'next', gameNum: SEASON.REGULAR_GAMES + poRes.length + 1,
                oppName: d.opponentColor,
                label: `${this._tc(spec.label)} G${gameN} (Bo${spec.winsNeeded * 2 - 1})`
            });
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
        const pad    = rowH - 4;
        const fMain  = `${Math.min(16, Math.max(13, rowH - 9))}px`;
        const fSmall = `${Math.min(14, Math.max(12, rowH - 11))}px`;

        if (row.kind === 'next') {
            const g = this.add.graphics();
            g.fillStyle(0x1a2e0a, 1);
            g.fillRect(24, cy - pad / 2, W - 48, pad);
            g.lineStyle(2, 0xffd700, 0.85);
            g.strokeRect(24, cy - pad / 2, W - 48, pad);

            this.add.text(44, cy, String(row.gameNum), {
                fontSize: fSmall, fontFamily: 'Arial Black', color: '#FFD700',
                stroke: '#000', strokeThickness: 2
            }).setOrigin(0.5, 0.5);
            this.add.text(70, cy, row.label, {
                fontSize: fSmall, fontFamily: 'Arial', color: '#FFD700',
                stroke: '#000', strokeThickness: 1
            }).setOrigin(0, 0.5);

            const opp = getColorByName(row.oppName);
            const capH = Math.min(rowH - 6, 18);
            addCapSprite(this, row.oppName, 274, cy, capH);
            this.add.text(294, cy, row.oppName, {
                fontSize: fMain, fontFamily: 'Arial Black', color: opp.textCss,
                stroke: '#000', strokeThickness: 2
            }).setOrigin(0, 0.5);

            this.add.text(695, cy, '► NEXT', {
                fontSize: fMain, fontFamily: 'Arial Black', color: '#FFD700',
                stroke: '#000', strokeThickness: 2
            }).setOrigin(0.5, 0.5);

        } else if (row.kind === 'done') {
            const r   = row.result;
            const won = r.win;
            this.add.rectangle(W / 2, cy, W - 48, pad, won ? 0x193519 : 0x351919, 0.55).setOrigin(0.5);

            this.add.text(44, cy, String(row.gameNum), {
                fontSize: fSmall, fontFamily: 'Arial', color: '#888888'
            }).setOrigin(0.5, 0.5);
            this.add.text(70, cy, row.label, {
                fontSize: fSmall, fontFamily: 'Arial', color: '#7ab87a'
            }).setOrigin(0, 0.5);

            const opp = getColorByName(r.opp);
            const capH = Math.min(rowH - 8, 14);
            addCapSprite(this, r.opp, 274, cy, capH);
            this.add.text(294, cy, r.opp, {
                fontSize: fMain, fontFamily: 'Arial', fontStyle: 'bold', color: opp.textCss,
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
            this.add.rectangle(W / 2, cy, W - 48, pad, 0x0d1a0d, 0.35).setOrigin(0.5);

            this.add.text(44, cy, String(row.gameNum), {
                fontSize: fSmall, fontFamily: 'Arial', color: '#555555'
            }).setOrigin(0.5, 0.5);
            this.add.text(70, cy, row.label, {
                fontSize: fSmall, fontFamily: 'Arial', color: '#4a6e4a'
            }).setOrigin(0, 0.5);

            addCapSprite(this, row.oppName, 274, cy, Math.min(rowH - 8, 14), { alpha: 0.55 });
            this.add.text(294, cy, row.oppName, {
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

    _stageLabel(season) {
        const d = season.data;
        if (d.stage === 'regular') return `Regular Season — Game ${d.gamesPlayed + 1} of ${SEASON.REGULAR_GAMES}`;
        const s = season.seriesInfo();
        if (s) return `${this._tc(s.label)} Series — Game ${s.gameNum} of ${s.bestOf} (${s.wins}-${s.losses})`;
        if (d.stage === 'champions') return 'Champions!';
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
// INSTRUCTIONS SCENE — how to play, read aloud
// ═══════════════════════════════════════════════════════════════════════════════
class InstructionsScene extends Phaser.Scene {
    constructor() { super({ key: 'InstructionsScene' }); }

    create() {
        const audio = audioSys();
        this.add.rectangle(0, 0, W, H, 0x0a1408).setOrigin(0);
        const bg = this.add.graphics();
        for (let i = 0; i < 20; i++) {
            bg.fillStyle(i % 2 === 0 ? 0x0d1b0b : 0x0a1408, 1);
            bg.fillRect(0, i * 32, W, 32);
        }

        this.add.text(W / 2, 40, 'HOW TO PLAY', {
            fontSize: '36px', fontFamily: 'Arial Black', color: '#FFD700',
            stroke: '#000', strokeThickness: 5
        }).setOrigin(0.5);

        const lines = [
            'BATTING — Pick READY TO BAT, then PRESS AND HOLD to charge your swing:',
            'a quick tap bunts, 2 to 4 seconds is a normal swing, 4 to 6 is a power swing.',
            'LET GO while the ball is in the GREEN part of the timing bar to smash it!',
            '',
            'FIELDING — Pick where your pitch goes. Green is your best pitch.',
            'When you field a ground ball, choose which base to throw to:',
            'first base is the safe out — or gun down the lead runner for a double play!',
            '',
            'SEASON — Play 16 games. Win 10 or more to make the playoffs:',
            'best-of-3 quarterfinal and semifinal series, then a best-of-5 championship.'
        ];
        this.add.text(W / 2, 92, lines.join('\n'), {
            fontSize: '19px', fontFamily: 'Arial', color: '#dff3e4', align: 'center',
            stroke: '#000', strokeThickness: 2, lineSpacing: 7
        }).setOrigin(0.5, 0);

        this.menu = new ScanList(this, {
            x: W / 2, y: H - 60, audio, itemW: 340,
            options: [{ label: 'BACK TO MAIN MENU', value: 'back' }],
            onSelect: () => this.scene.start('TitleScene')
        });
        this.scanInput = new ScanInput(this, {
            forward:  () => this.menu.next(false),
            backward: () => this.menu.prev(false),
            select:   () => this.menu.select(),
            escape:   () => this.scene.start('TitleScene')
        });

        audio.speak('How to play. Batting: hold to charge your swing, and let go in the green. ' +
            'Fielding: choose your pitch, and when you field a ground ball, pick which base to throw to. ' +
            'Season: sixteen games, then playoff series, then a best of five championship.', true);
    }
}
