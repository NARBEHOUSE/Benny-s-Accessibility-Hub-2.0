// ═══════════════════════════════════════════════════════════════════════════════
// BENNY'S BASEBALL 2 - Main game scenes (Phaser 3)
//
// TitleScene  → simple accessible start menu
// GameScene   → the whole 9-inning game as a phase state machine:
//               pitch → bat menu → charge swing → contact → fielding →
//               throw menu (NEW) → resolve → next batter
// ResultScene → final score + play again
//
// Rules, probabilities, and the hold-to-charge batting mechanic are ported
// from BENNYSBASEBALL v1 (GameLogic.js) so the game balance carries over.
// Visual style (vector players, tween movement, camera zooms) follows
// BENNYSFOOTBALL/js/game.js. The throw-to-base fielding menu is new.
// ═══════════════════════════════════════════════════════════════════════════════


// ─── Game ────────────────────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }

    create(data) {
        this.audio = audioSys();
        this.season = seasonMgr();
        this.cameras.main.setBounds(0, 0, W, H);
        this.isSeason = !!(data && data.isSeason);

        // ── Resolve teams (opponent decided by ColorSelect/SeasonScene) ──
        const playerOpt = COLOR_OPTIONS.find(c => c.name === (data && data.playerColorName)) || COLOR_OPTIONS[0];
        let cpuOpt = COLOR_OPTIONS.find(c => c.name === (data && data.opponentColorName));
        if (!cpuOpt) {
            const pool = COLOR_OPTIONS.filter(c => c.name !== playerOpt.name);
            cpuOpt = pool[Math.floor(Math.random() * pool.length)];
        }
        let resumeData = null;
        if (this.isSeason && data && data.resume && this.season.hasGameInProgress()) {
            resumeData = this.season.loadGameState().gs;
        }
        setTeamColors(playerOpt, cpuOpt);
        this.opponentName = cpuOpt.name;
        this.playerColorName = playerOpt.name;

        // Home/away: consistent within a playoff/championship series
        let playerIsAway;
        if (resumeData) {
            playerIsAway = resumeData.playerIsAway;
        } else if (this.isSeason && this.season.isInSeries()) {
            playerIsAway = !this.season.data.seriesHomeIsPlayer;
        } else {
            playerIsAway = Math.random() < 0.5;
        }

        // ── Core game state (shape ported from v1 GameState) ──
        this.gs = {
            inning: 1,
            half: 'top',
            outs: 0,
            balls: 0,
            strikes: 0,
            score: { Red: 0, Blue: 0 },      // Red = away team, Blue = home team (v1 convention)
            bases: { first: null, second: null, third: null },  // 'user' | 'comp' | null
            playerIsAway,
            firstPitch: true,
            gameOver: false,
            samePitchCount: 0,
            lastPitchType: null,
            selectedPitch: null,
            selectedPitchLocation: null,
            selectedPitchEffectiveness: 0.5,
            bestPitchBonus: false,
            pendingBaseUpdate: null
        };
        if (resumeData) {
            Object.assign(this.gs, {
                inning: resumeData.inning, half: resumeData.half, outs: resumeData.outs,
                score: { ...resumeData.score }, bases: { ...resumeData.bases },
                balls: resumeData.balls, strikes: resumeData.strikes,
                samePitchCount: resumeData.samePitchCount || 0,
                lastPitchType: resumeData.lastPitchType || null
            });
        }
        this.resetInteractiveBatting();

        this.menu = null;
        this.chargeMonitor = null;
        this.pitchTween = null;

        this.drawFieldBackground();
        this.ball = this.makeBall();
        this.createTeams(true); // both teams run onto the field
        this.runnerDots = { first: null, second: null, third: null };
        this.createHUD();
        this.createSwingMeter();
        this.createPowerMeter();
        this.syncRunners();

        this.wireInput();

        // Random little repositioning shuffles keep the defense looking alive
        // between plays (nothing big — a step or two and back)
        this.time.addEvent({
            delay: 2400, loop: true,
            callback: () => {
                if (this.gs.gameOver || !this.fielders) return;
                const keys = Object.keys(this.fielders);
                const f = this.fielders[keys[Math.floor(Math.random() * keys.length)]];
                if (!f || !f.active || this.tweens.isTweening(f)) return;
                this.tweens.add({
                    targets: f,
                    x: f.x + Phaser.Math.Between(-6, 6),
                    y: f.y + Phaser.Math.Between(-4, 4),
                    duration: 420, yoyo: true, ease: 'Sine.easeInOut'
                });
            }
        });

        // Opening announcement (with series context)
        const you = TEAM_COLORS.player.name, cpu = TEAM_COLORS.cpu.name;
        let announcement = `${you} versus ${cpu}.`;
        if (this.isSeason) {
            const s = this.season.seriesInfo();
            if (s) {
                announcement = `${s.label} series, game ${s.gameNum} of a best of ${s.bestOf}. The series is ${s.wins} to ${s.losses}. ${announcement}`;
            } else {
                announcement = `Season game ${this.season.data.gamesPlayed + 1} of ${SEASON.REGULAR_GAMES}. ${announcement}`;
            }
        }
        if (resumeData) {
            announcement = `Resuming. ${announcement}`;
        } else {
            announcement += this.gs.playerIsAway ? ' You bat first.' : ' They bat first.';
        }
        this.audio.speak(announcement);
        this.bigMessage('PLAY BALL!', 1800);
        this.time.delayedCall(3000, () => this.nextPlay());
    }

    resetInteractiveBatting() {
        this.ib = {
            active: false,
            waitingForSwing: false,
            swingPressed: false,
            swingReleased: false,
            swingPressStart: 0,
            announcedSwingType: null,
            pitchProgress: 0,
            ballInStrikeZone: false,
            lastSwingTone: 0,
            isSwinging: false,
            outcomeProcessed: false,
            swingType: null,
            swingPowerLevel: 0,
            timingScore: 0
        };
    }

    // ─── Field & sprites ─────────────────────────────────────────────────────
    // Clean, flat-color ballpark: solid grass inside one smooth wall arc,
    // subtle mow wedges, a crisp dirt diamond band, and stands beyond the wall.
    // No alpha-stacked gradients (they looked muddy).
    drawFieldBackground() {
        const g = this.add.graphics().setDepth(-1);
        const A = FIELD.WALL_ARC;
        const a1 = Phaser.Math.DegToRad(A.startDeg), a2 = Phaser.Math.DegToRad(A.endDeg);
        const corner1 = { x: A.cx + A.r * Math.cos(a1), y: A.cy + A.r * Math.sin(a1) };
        const corner2 = { x: A.cx + A.r * Math.cos(a2), y: A.cy + A.r * Math.sin(a2) };

        // Stands / out-of-play backdrop
        this.add.rectangle(W / 2, H / 2, W, H, 0x101d28).setDepth(-2);
        g.lineStyle(26, 0x1a3040, 1);
        g.beginPath(); g.arc(A.cx, A.cy, A.r + 24, a1, a2); g.strokePath();
        g.lineStyle(20, 0x24404f, 1);
        g.beginPath(); g.arc(A.cx, A.cy, A.r + 47, a1, a2); g.strokePath();

        // Grass: everything inside the wall arc down to the bottom of the screen
        g.fillStyle(0x2e7d3a, 1);
        g.beginPath();
        g.arc(A.cx, A.cy, A.r, a1, a2, false);
        g.lineTo(corner2.x, H + 40);
        g.lineTo(corner1.x, H + 40);
        g.closePath();
        g.fillPath();

        // Subtle mow wedges radiating from home plate (kept inside the wall).
        // The fan spans exactly foul line to foul line, and the wedge count
        // is ODD — an even count of alternating stripes can't mirror, which
        // is what made the old pattern read lopsided (a light slice hugged
        // one foul line with dark grass hugging the other). Nine wedges give
        // dark-light-…-dark: symmetric about center field, evenly spread.
        const HOME = FIELD.HOME;
        const fanStart = Math.atan2(FIELD.THIRD.y - HOME.y, FIELD.THIRD.x - HOME.x);
        const fanEnd = Math.atan2(FIELD.FIRST.y - HOME.y, FIELD.FIRST.x - HOME.x);
        const wedges = 9;
        for (let i = 0; i < wedges; i++) {
            if (i % 2 === 0) continue;
            const s = fanStart + (fanEnd - fanStart) * (i / wedges);
            const e = fanStart + (fanEnd - fanStart) * ((i + 1) / wedges);
            g.fillStyle(0xffffff, 0.05);
            g.beginPath();
            g.moveTo(HOME.x, HOME.y);
            g.arc(HOME.x, HOME.y, 460, s, e, false);
            g.closePath();
            g.fillPath();
        }

        // Warning track + wall (one smooth arc)
        g.lineStyle(16, 0xa8763e, 1);
        g.beginPath(); g.arc(A.cx, A.cy, A.r - 10, a1, a2); g.strokePath();
        g.lineStyle(9, 0x1b3a63, 1);
        g.beginPath(); g.arc(A.cx, A.cy, A.r, a1, a2); g.strokePath();

        // Infield dirt: a clean band around the basepaths (outer diamond dirt,
        // inner diamond grass — no gradients)
        const C = { x: 500, y: 398 };
        const inflate = (p, d) => {
            const dx = p.x - C.x, dy = p.y - C.y;
            const len = Math.hypot(dx, dy) || 1;
            return { x: p.x + (dx / len) * d, y: p.y + (dy / len) * d };
        };
        const diamond = [FIELD.HOME, FIELD.FIRST, FIELD.SECOND, FIELD.THIRD];
        g.fillStyle(0xb98a4a, 1);
        g.fillPoints(diamond.map(p => inflate(p, 44)), true);
        g.fillStyle(0x33863f, 1);
        g.fillPoints(diamond.map(p => inflate(p, -34)), true);

        // Home plate circle + pitcher's mound
        g.fillStyle(0xb98a4a, 1);
        g.fillCircle(FIELD.HOME.x, FIELD.HOME.y, 44);
        g.fillEllipse(FIELD.MOUND.x, FIELD.MOUND.y, 58, 40);
        g.fillStyle(0xd8d2c3, 1);
        g.fillRect(FIELD.MOUND.x - 8, FIELD.MOUND.y - 2, 16, 5);

        // Foul lines: through 1st/3rd, ending exactly at the wall corners
        g.lineStyle(3, 0xffffff, 0.9);
        const foulTo = (base) => ({
            x: FIELD.HOME.x + (base.x - FIELD.HOME.x) * 2.49,
            y: FIELD.HOME.y + (base.y - FIELD.HOME.y) * 2.49
        });
        const rfCorner = foulTo(FIELD.FIRST);
        const lfCorner = foulTo(FIELD.THIRD);
        g.lineBetween(FIELD.HOME.x, FIELD.HOME.y, rfCorner.x, rfCorner.y);
        g.lineBetween(FIELD.HOME.x, FIELD.HOME.y, lfCorner.x, lfCorner.y);

        // Baselines
        g.lineStyle(2.5, 0xffffff, 0.85);
        g.strokePoints(diamond.map(p => ({ x: p.x, y: p.y })), true);

        // Bases
        const drawBase = (b) => {
            g.save();
            g.translateCanvas(b.x, b.y);
            g.rotateCanvas(Math.PI / 4);
            g.fillStyle(0xffffff, 1);
            g.fillRect(-9, -9, 18, 18);
            g.lineStyle(2, 0x555555, 1);
            g.strokeRect(-9, -9, 18, 18);
            g.restore();
        };
        drawBase(FIELD.FIRST); drawBase(FIELD.SECOND); drawBase(FIELD.THIRD);

        // Home plate
        g.fillStyle(0xffffff, 1);
        g.beginPath();
        g.moveTo(FIELD.HOME.x - 11, FIELD.HOME.y - 8);
        g.lineTo(FIELD.HOME.x + 11, FIELD.HOME.y - 8);
        g.lineTo(FIELD.HOME.x + 11, FIELD.HOME.y + 2);
        g.lineTo(FIELD.HOME.x, FIELD.HOME.y + 11);
        g.lineTo(FIELD.HOME.x - 11, FIELD.HOME.y + 2);
        g.closePath();
        g.fillPath();

        // Batter's boxes (small, tucked below the baselines) + on-deck circles
        g.lineStyle(2, 0xffffff, 0.65);
        g.strokeRect(FIELD.HOME.x - 31, FIELD.HOME.y - 8, 16, 22);
        g.strokeRect(FIELD.HOME.x + 15, FIELD.HOME.y - 8, 16, 22);
        g.lineStyle(2, 0xffffff, 0.35);
        g.strokeCircle(FIELD.HOME.x - 155, FIELD.HOME.y + 28, 16);
        g.strokeCircle(FIELD.HOME.x + 155, FIELD.HOME.y + 28, 16);
    }

    // Procedurally draw a proper baseball once and cache it as a texture:
    // white leather with the two classic horseshoe seams bowing inward,
    // each lined with small red stitch ticks. Drawn at 64px and displayed
    // small so the supersampled canvas keeps it crisp.
    ensureBallTexture() {
        if (this.textures.exists('ball-tex')) return;
        const g = this.make.graphics({ add: false });
        const S = 64, c = S / 2, R = 28;
        // Leather
        g.fillStyle(0xffffff, 1);
        g.fillCircle(c, c, R);
        g.lineStyle(3, 0xcfcfcf, 1);
        g.strokeCircle(c, c, R - 1.5);
        // Seams: arcs whose centers sit outside the ball, so each seam bows
        // toward the middle like a real baseball
        const seamR = 30, off = 42, span = 0.62;
        g.lineStyle(4, 0xc0392b, 1);
        g.beginPath(); g.arc(c - off, c, seamR, -span, span); g.strokePath();
        g.beginPath(); g.arc(c + off, c, seamR, Math.PI - span, Math.PI + span); g.strokePath();
        // Stitch ticks perpendicular to each seam
        g.lineStyle(2.5, 0xc0392b, 1);
        [-0.45, -0.15, 0.15, 0.45].forEach(a => {
            let px = c - off + Math.cos(a) * seamR, py = c + Math.sin(a) * seamR;
            let nx = Math.cos(a), ny = Math.sin(a);
            g.lineBetween(px - nx * 4.5, py - ny * 4.5, px + nx * 4.5, py + ny * 4.5);
            px = c + off + Math.cos(Math.PI + a) * seamR; py = c + Math.sin(Math.PI + a) * seamR;
            nx = Math.cos(Math.PI + a); ny = Math.sin(Math.PI + a);
            g.lineBetween(px - nx * 4.5, py - ny * 4.5, px + nx * 4.5, py + ny * 4.5);
        });
        g.generateTexture('ball-tex', S, S);
        g.destroy();
    }

    makeBall() {
        this.ensureBallTexture();
        const c = this.add.container(FIELD.MOUND.x, FIELD.MOUND.y).setDepth(8);
        const shadow = this.add.ellipse(2, 5, 12, 5, 0x000000, 0.4);
        const body = this.add.image(0, 0, 'ball-tex').setDisplaySize(15, 15);
        // Spin only while in motion — resumed by ballArc/the pitch, paused
        // the moment the ball settles in a glove
        c.spin = this.tweens.add({ targets: body, angle: 360, duration: 800, repeat: -1, ease: 'Linear', paused: true });
        // Glow ring shown while the pitch is live (red → green sweet spot)
        const glow = this.add.circle(0, 0, 12).setStrokeStyle(3.5, 0xffe14d, 1).setVisible(false);
        c.add([shadow, body, glow]);
        c.glow = glow;
        c.setVisible(false);
        return c;
    }

    // ─── Swing timing indicator ──────────────────────────────────────────────
    // Like the original game: the BALL is the indicator. It glows RED while
    // the pitch is on its way (don't let go yet) and turns GREEN in the sweet
    // spot (let go now!). Bands come from the same ported constants the
    // outcome tables use (perfect = 90% of flight).
    createSwingMeter() {
        const T = GAME_CONSTANTS.TIMING;
        const win = T.SWING_TIMING_WINDOW / T.INTERACTIVE_PITCH_DURATION; // 0.08
        this.meterBands = {
            hitLo: 0.75, hitHi: 1.0,                          // any contact possible
            okLo: 0.90 - win * 0.8, okHi: 0.90 + win * 0.8,   // decent timing
            goodLo: 0.90 - win * 0.4, goodHi: 0.90 + win * 0.4 // good→perfect (ring!)
        };

        // Only the instruction line remains on screen (v1-style); the meter
        // bar/marker are gone — watch the ball instead.
        this.meter = this.add.container(0, 0).setDepth(55).setScrollFactor(0).setVisible(false);
        this.meterTitle = this.add.text(W / 2, H - 30, 'PRESS & HOLD to charge — let go when the ball glows GREEN!', {
            fontSize: '15px', fontFamily: 'Arial Black', color: '#ffffff',
            stroke: '#000', strokeThickness: 4
        }).setOrigin(0.5);
        this.meter.add(this.meterTitle);
    }

    updateSwingMeter(p) {
        if (!this.ib.active) return;
        // v1's exact green zone: the swingable window, 0.80-0.98 of the flight
        const T = GAME_CONSTANTS.TIMING;
        const inGreen = p >= T.GREEN_ZONE_LO && p <= T.GREEN_ZONE_HI;
        const glow = this.ball.glow;
        glow.setVisible(true);
        glow.setStrokeStyle(4, inGreen ? 0x2ecc40 : 0xe03030, 1);
        const pulse = inGreen ? 0.55 + 0.45 * Math.sin(Date.now() / 55)
                              : 0.45 + 0.25 * Math.sin(Date.now() / 140);
        glow.setAlpha(pulse);
    }

    hideSwingMeter() {
        if (this.meter) this.meter.setVisible(false);
        if (this.ball && this.ball.glow) this.ball.glow.setVisible(false);
    }

    // Close-up on the batter/pitcher duel for the at-bat; zooms back out at
    // the swing (or when the pitch goes by). Screen-pinned UI scales with
    // camera zoom in Phaser, so while zoomed the meter + instruction line are
    // remapped into the visible world rect, and the HUD takes a breather.
    setBattingCamera(on) {
        if (this._battingCam === !!on) return;
        this._battingCam = !!on;
        const z = 1.9, cx = 492, cy = 462;
        const hud = this.hudAll || [];
        if (on) {
            this._zoomOnPoint(cx, cy, z, 650);
            const ox = cx - (W / 2) / z, oy = cy - (H / 2) / z;
            [this.meter, this.powerMeter].forEach(c => {
                c.setScrollFactor(1);
                c.setScale(1 / z);
                c.setPosition(ox, oy);
            });
            hud.forEach(o => o.setVisible(false));
        } else {
            this._zoomOut(380);
            [this.meter, this.powerMeter].forEach(c => {
                c.setScrollFactor(0);
                c.setScale(1);
                c.setPosition(0, 0);
            });
            hud.forEach(o => o.setVisible(true));
        }
    }

    // ─── Charge power meter (ported from v1 UIRenderer.drawPowerMeter) ──────
    // Vertical meter on the left, shown ONLY while the swing button is held:
    // BUNT (orange, 0-2s) → NORMAL (green, 2-4s) → POWER (red, 4-6s), with a
    // filling bar, the current swing type on top, and the hold time below.
    createPowerMeter() {
        const mx = 50, my = H / 2 - 100, mw = 60, mh = 200;
        const T = GAME_CONSTANTS.TIMING;
        this._power = { mx, my, mw, mh,
            buntH: (T.SWING_BUNT_MAX / T.SWING_POWER_MAX) * mh,
            normalH: ((T.SWING_POWER_MIN - T.SWING_BUNT_MAX) / T.SWING_POWER_MAX) * mh,
            powerH: ((T.SWING_POWER_MAX - T.SWING_POWER_MIN) / T.SWING_POWER_MAX) * mh
        };

        this.powerMeter = this.add.container(0, 0).setDepth(56).setScrollFactor(0).setVisible(false);

        const bg = this.add.graphics();
        bg.fillStyle(0x000000, 0.85);
        bg.fillRect(mx - 10, my - 40, mw + 92, mh + 80);
        bg.lineStyle(2, 0xffffff, 1);
        bg.strokeRect(mx - 10, my - 40, mw + 92, mh + 80);
        // Meter track
        bg.fillStyle(0x646464, 0.3);
        bg.fillRect(mx, my, mw, mh);
        // Zones bottom→top: BUNT orange / NORMAL green / POWER red (v1 colors)
        const p = this._power;
        bg.fillStyle(0xffaa00, 0.38);
        bg.fillRect(mx, my + mh - p.buntH, mw, p.buntH);
        bg.fillStyle(0x00ff00, 0.38);
        bg.fillRect(mx, my + mh - p.buntH - p.normalH, mw, p.normalH);
        bg.fillStyle(0xff4444, 0.38);
        bg.fillRect(mx, my, mw, p.powerH);
        this.powerMeter.add(bg);

        const zoneStyle = { fontSize: '11px', fontFamily: 'Courier New', fontStyle: 'bold' };
        this.powerMeter.add(this.add.text(mx + mw + 6, my + mh - p.buntH / 2, 'BUNT', { ...zoneStyle, color: '#ffaa00' }).setOrigin(0, 0.5));
        this.powerMeter.add(this.add.text(mx + mw + 6, my + mh - p.buntH - p.normalH / 2, 'NORMAL', { ...zoneStyle, color: '#00ff00' }).setOrigin(0, 0.5));
        this.powerMeter.add(this.add.text(mx + mw + 6, my + p.powerH / 2, 'POWER', { ...zoneStyle, color: '#ff4444' }).setOrigin(0, 0.5));

        this.powerTypeTxt = this.add.text(mx + mw / 2, my - 20, 'BUNT', {
            fontSize: '15px', fontFamily: 'Courier New', fontStyle: 'bold', color: '#ffaa00'
        }).setOrigin(0.5);
        this.powerMeter.add(this.powerTypeTxt);

        this.powerTimeTxt = this.add.text(mx + mw / 2, my + mh + 25, '0.0s', {
            fontSize: '16px', fontFamily: 'Courier New', fontStyle: 'bold', color: '#ffffff'
        }).setOrigin(0.5);
        this.powerMeter.add(this.powerTimeTxt);

        // Fill bar + position line, redrawn every charge tick
        this.powerFill = this.add.graphics();
        this.powerMeter.add(this.powerFill);
    }

    updatePowerMeter(holdDuration) {
        const T = GAME_CONSTANTS.TIMING;
        const p = this._power;
        const progress = Math.min(holdDuration / T.SWING_POWER_MAX, 1);

        let type, color;
        if (holdDuration < T.SWING_BUNT_MAX) { type = 'BUNT'; color = 0xffaa00; }
        else if (holdDuration < T.SWING_POWER_MIN) { type = 'NORMAL'; color = 0x00ff00; }
        else { type = 'POWER'; color = 0xff4444; }

        this.powerTypeTxt.setText(type).setColor(type === 'BUNT' ? '#ffaa00' : type === 'NORMAL' ? '#00ff00' : '#ff4444');
        this.powerTimeTxt.setText(`${(holdDuration / 1000).toFixed(1)}s`);
        // v1-style live instruction: show the swing you'd get if you let go now
        const label = type === 'BUNT' ? 'BUNT' : type === 'NORMAL' ? 'NORMAL SWING' : 'POWER SWING';
        this.meterTitle.setText(`Current: ${label} — RELEASE in the GREEN!`)
            .setColor(type === 'BUNT' ? '#ffaa00' : type === 'NORMAL' ? '#00ff00' : '#ff4444');

        const filled = progress * p.mh;
        const g = this.powerFill;
        g.clear();
        g.fillStyle(color, 0.85);
        g.fillRect(p.mx, p.my + p.mh - filled, p.mw, filled);
        g.lineStyle(3, 0xffffff, 1);
        g.lineBetween(p.mx - 5, p.my + p.mh - filled, p.mx + p.mw + 5, p.my + p.mh - filled);
    }

    hidePowerMeter() {
        if (this.powerMeter) this.powerMeter.setVisible(false);
    }

    makePlayer(colorObj, label) {
        const c = this.add.container(0, 0).setDepth(3);
        const shadow = this.add.ellipse(3, 7, 34, 11, 0x000000, 0.52);
        const body = this.add.circle(0, 0, 13, colorObj.hex).setStrokeStyle(2.5, 0x000000);
        const shine = this.add.circle(-4, -4, 4, colorObj.light, 0.6);
        const num = this.add.text(0, 0, label, {
            fontSize: '9px', fontFamily: 'Arial Black', color: '#ffffff',
            stroke: '#000', strokeThickness: 2
        }).setOrigin(0.5);
        c.add([shadow, body, shine, num]);
        // Subtle idle breathing on the body (children only, so it never
        // fights the container's movement tweens) — keeps players alive
        this.tweens.add({
            targets: [body, shine, num], y: '+=1.6',
            duration: Phaser.Math.Between(700, 1100),
            delay: Phaser.Math.Between(0, 600),
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        });
        return c;
    }

    isPlayerBatting() {
        return (this.gs.half === 'top') === this.gs.playerIsAway;
    }

    battingColor()  { return this.isPlayerBatting() ? TEAM_COLORS.player : TEAM_COLORS.cpu; }
    fieldingColor() { return this.isPlayerBatting() ? TEAM_COLORS.cpu : TEAM_COLORS.player; }
    battingTeamKey() { return this.isPlayerBatting() ? 'user' : 'comp'; }
    // Which score bucket the batting team fills (v1: away=Red, home=Blue)
    battingScoreKey() { return this.gs.half === 'top' ? 'Red' : 'Blue'; }

    // Build the defense + batter. With fromDugout=true, everyone spawns at
    // their team's dugout and jogs out to their spot (game start / half swap).
    createTeams(fromDugout) {
        if (this.fielders) Object.values(this.fielders).forEach(p => { this.tweens.killTweensOf(p); p.destroy(); });
        if (this.batter) { this.tweens.killTweensOf(this.batter); this.batter.destroy(); }

        const fieldingIsPlayer = !this.isPlayerBatting();
        const fieldDug = fieldingIsPlayer ? FIELD.DUGOUT.player : FIELD.DUGOUT.cpu;
        const batDug = fieldingIsPlayer ? FIELD.DUGOUT.cpu : FIELD.DUGOUT.player;

        this.fielders = {};
        const fc = this.fieldingColor();
        Object.keys(FIELD.FIELDER_HOMES).forEach((pos, i) => {
            const home = FIELD.FIELDER_HOMES[pos];
            const p = this.makePlayer(fc, pos);
            if (fromDugout) {
                p.setPosition(fieldDug.x, fieldDug.y);
                this.time.delayedCall(i * 70, () => this.jog(p, home.x, home.y, 950, 'Sine.easeOut'));
            } else {
                p.setPosition(home.x, home.y);
            }
            this.fielders[pos] = p;
        });

        this.createBatter(fromDugout ? batDug : null);
    }

    // Build (or rebuild) the batter with a fresh bat. Pass a dugout point to
    // have him jog in from there — used at half-inning swaps AND whenever the
    // previous batter took off running (the next batter steps in).
    createBatter(fromPoint) {
        if (this.bat && this.bat.active) { this.tweens.killTweensOf(this.bat); this.bat.destroy(); }
        if (this.batter && this.batter.active) { this.tweens.killTweensOf(this.batter); this.batter.destroy(); }
        this._batterRunning = false;

        const bc = this.battingColor();
        this.batter = this.makePlayer(bc, 'B');
        // Bat: v1-exact placement — knob pivots at the batter's center (4px
        // up), resting at -135° (up-back over the shoulder)
        this.ensureBatTexture();
        this.bat = this.add.image(0, -4, 'bat-shape').setOrigin(0.07, 0.5).setAngle(-135);
        this.batter.add(this.bat);
        this.startBatWaggle();
        if (fromPoint) {
            this.batter.setPosition(fromPoint.x, fromPoint.y);
            this.time.delayedCall(200, () => this.jog(this.batter, FIELD.BATTER_BOX.x, FIELD.BATTER_BOX.y, 950, 'Sine.easeOut'));
        } else {
            this.batter.setPosition(FIELD.BATTER_BOX.x, FIELD.BATTER_BOX.y);
        }
    }

    // On contact the batter DROPS THE BAT at the plate and becomes the runner.
    // Returns the batter container to use as the batter-runner sprite.
    batterTakesOff() {
        if (this._batterRunning) return this.batter;
        this._batterRunning = true;
        if (this.bat && this.bat.active) {
            this.tweens.killTweensOf(this.bat);
            // Re-anchor the bat to the world at its current spot, then let it
            // drop to the ground and fade
            const wx = this.batter.x + this.bat.x, wy = this.batter.y + this.bat.y;
            this.batter.remove(this.bat);
            this.bat.setPosition(wx, wy);
            this.tweens.add({ targets: this.bat, angle: 14, x: wx - 8, y: wy + 20, duration: 200, ease: 'Quad.easeIn' });
            this.tweens.add({
                targets: this.bat, alpha: 0, delay: 380, duration: 280,
                onComplete: () => { if (this.bat) { this.bat.destroy(); this.bat = null; } }
            });
        }
        return this.batter;
    }

    // The next batter steps in from the dugout side — unless that was the
    // third out, in which case nobody steps in (the sides are swapping)
    resetBatter() {
        if (!this._batterRunning) return;
        if (this.gs.outs >= GAME_CONSTANTS.GAME_RULES.MAX_OUTS || this.gs.gameOver) {
            this._batterRunning = false;
            if (this.bat && this.bat.active) { this.tweens.killTweensOf(this.bat); this.bat.destroy(); this.bat = null; }
            if (this.batter && this.batter.active) { this.tweens.killTweensOf(this.batter); this.batter.destroy(); }
            this.batter = null;
            return;
        }
        const dug = this.isPlayerBatting() ? FIELD.DUGOUT.player : FIELD.DUGOUT.cpu;
        const stepIn = {
            x: Phaser.Math.Linear(FIELD.BATTER_BOX.x, dug.x, 0.35),
            y: Phaser.Math.Linear(FIELD.BATTER_BOX.y, dug.y, 0.35)
        };
        this.createBatter(stepIn);
    }

    // Between half-innings the sides trade places: the old defense walks off
    // to its dugout while the new defense runs out from theirs.
    swapSides(cb) {
        // gs.half has already flipped, so the OLD defense is the NEW batting team
        const newBattingIsPlayer = this.isPlayerBatting();
        const outFieldersDug = newBattingIsPlayer ? FIELD.DUGOUT.player : FIELD.DUGOUT.cpu;
        const outBatterDug = newBattingIsPlayer ? FIELD.DUGOUT.cpu : FIELD.DUGOUT.player;

        Object.values(this.fielders).forEach((f, i) => {
            this.tweens.killTweensOf(f);
            this.time.delayedCall(i * 70, () => this.jog(f, outFieldersDug.x, outFieldersDug.y, 950, 'Sine.easeIn'));
        });
        if (this.batter && this.batter.active) {
            this.tweens.killTweensOf(this.batter);
            this.jog(this.batter, outBatterDug.x, outBatterDug.y, 950, 'Sine.easeIn');
        }

        // Once the field is clear, the new defense takes it
        this.time.delayedCall(2200, () => {
            this.createTeams(true);
            this.time.delayedCall(1450, cb);
        });
    }

    // Runner dots shown on occupied bases (batting team color)
    syncRunners() {
        ['first', 'second', 'third'].forEach(key => {
            if (this.runnerDots[key]) { this.runnerDots[key].destroy(); this.runnerDots[key] = null; }
            const occupant = this.gs.bases[key];
            if (occupant) {
                const col = occupant === 'user' ? TEAM_COLORS.player : TEAM_COLORS.cpu;
                const dot = this.makePlayer(col, 'R');
                const b = BASE_COORDS[key];
                dot.setPosition(b.x + 16, b.y - 14);
                dot.setScale(0.8);
                this.runnerDots[key] = dot;
            }
        });
        this.updateHUD();
    }

    // ─── Animation helpers (ported patterns from football) ──────────────────
    startBob(p) {
        if (p._bob) return;
        p._bob = this.tweens.add({
            targets: p, scaleY: 0.84, scaleX: 1.12,
            duration: 120, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        });
    }

    stopBob(p) {
        if (p._bob) { p._bob.stop(); p._bob = null; }
        p.setScale(1);
    }

    // All player movement is slowed ~50% so the game reads better visually
    // (same rule as the football game)
    jog(p, x, y, duration, ease, cb) {
        this.startBob(p);
        return this.tweens.add({
            targets: p, x, y, duration: duration * 1.5, ease: ease || 'Sine.easeInOut',
            onComplete: () => { this.stopBob(p); if (cb) cb(); }
        });
    }

    // Possession release: when the last flight/chase ends, the spin stops —
    // a held ball is a still ball
    releaseBall() {
        this._ballBusy = Math.max(0, (this._ballBusy || 0) - 1);
        if (this._ballBusy === 0) this.setBallSpin(false);
    }

    // Spin control that can never crash even if the tween was killed
    setBallSpin(on) {
        const s = this.ball && this.ball.spin;
        if (!s) return;
        try { if (on) s.resume(); else s.pause(); }
        catch (e) { this.ball.spin = null; }
    }

    // v1's exact per-pitch movement (AnimationSystem.calculatePitchMovement):
    // curveball bends, slider breaks late, knuckleball wobbles, changeup
    // drops at the end, fastball is straight.
    pitchOffset(pitchType, t) {
        switch (pitchType) {
            case 'Curveball':
                return { dx: Math.sin(t * Math.PI) * 25, dy: Math.sin(t * Math.PI * 0.5) * 15 };
            case 'Slider':
                return { dx: t > 0.7 ? (t - 0.7) * 40 : 0, dy: 0 };
            case 'Knuckleball':
                return { dx: Math.sin(t * Math.PI * 6) * 8, dy: Math.cos(t * Math.PI * 4) * 6 };
            case 'Changeup':
                return { dx: 0, dy: t > 0.8 ? (t - 0.8) * 30 : 0 };
            default:
                return { dx: 0, dy: 0 };
        }
    }

    // CPU pitch flight with v1's per-type speed and movement. Returns the
    // flight duration so the batter's swing can be timed to it.
    cpuPitchFlight(pitchType, cb) {
        const from = FIELD.MOUND, to = { x: FIELD.HOME.x, y: FIELD.HOME.y - 6 };
        const durations = { Fastball: 600, Changeup: 900, Curveball: 800, Slider: 700, Knuckleball: 1000 };
        const duration = durations[pitchType] || 700;
        if (this._ballFlight && this._ballFlight.isPlaying()) this._ballFlight.stop();
        this.ball.setVisible(true);
        this.ball.setPosition(from.x, from.y);
        this.setBallSpin(true);
        this._ballBusy = (this._ballBusy || 0) + 1;
        let settled = false;
        const settle = () => {
            if (!settled) {
                settled = true;
                this.releaseBall();
            }
        };
        const proxy = { t: 0 };
        this._ballFlight = this.tweens.add({
            targets: proxy, t: 1, duration, ease: 'Linear',
            onUpdate: () => {
                const off = this.pitchOffset(pitchType, proxy.t);
                this.ball.x = Phaser.Math.Linear(from.x, to.x, proxy.t) + off.dx;
                this.ball.y = Phaser.Math.Linear(from.y, to.y, proxy.t) - Math.sin(Math.PI * proxy.t) * 10 + off.dy;
            },
            onStop: settle,
            onComplete: () => { settle(); if (cb) cb(); }
        });
        return duration;
    }

    // Ball travels from → to in an arc. Only ONE ball flight can exist at a
    // time (a new arc cancels the previous), and _ballBusy tracks whether the
    // ball is still in the air / being chased so nothing else (like the
    // end-of-play toss to the pitcher) can grab it mid-flight.
    ballArc(from, to, duration, arcHeight, cb) {
        if (this._ballFlight && this._ballFlight.isPlaying()) this._ballFlight.stop();
        this.ball.setVisible(true);
        this.ball.setPosition(from.x, from.y);
        this.setBallSpin(true);
        this._ballBusy = (this._ballBusy || 0) + 1;
        let settled = false;
        const settle = () => {
            if (!settled) {
                settled = true;
                this.releaseBall();
            }
        };
        const proxy = { t: 0 };
        this._ballFlight = this.tweens.add({
            targets: proxy, t: 1, duration, ease: 'Linear',
            onUpdate: () => {
                const t = proxy.t;
                this.ball.x = Phaser.Math.Linear(from.x, to.x, t);
                this.ball.y = Phaser.Math.Linear(from.y, to.y, t) - Math.sin(Math.PI * t) * arcHeight;
            },
            onStop: settle,
            onComplete: () => { settle(); if (cb) cb(); }
        });
        return this._ballFlight;
    }

    // Camera helpers — ported verbatim in behavior from football's game.js
    _zoomOnPoint(wx, wy, zoom, duration) {
        const cam = this.cameras.main;
        cam.pan(wx, wy, duration, 'Sine.easeOut', true);
        cam.zoomTo(zoom, duration, 'Sine.easeOut');
    }

    _zoomOut(duration) {
        const cam = this.cameras.main;
        cam.pan(W / 2, H / 2, duration || 340, 'Sine.easeOut', true);
        cam.zoomTo(1, duration || 340, 'Sine.easeOut', true);
    }

    // ─── HUD — replicated 1:1 from the ORIGINAL game's scoreboard ──────────
    // Top-center black bar: "INNING: TOP 3    OUTS: 1/3" (white monospace).
    // Big scores on gray translucent blocks left (away) and right (home),
    // colored by team. Bottom-right count panel: STRIKES (3 red diamonds)
    // and BALLS (4 white circles) with centered labels — v1's exact offsets.
    createHUD() {
        this.hudAll = [];
        const add = (o) => { this.hudAll.push(o); return o; };

        this.topBarGfx = add(this.add.graphics().setDepth(50).setScrollFactor(0));
        this.topText = add(this.add.text(W / 2, 32, '', {
            fontSize: '20px', fontFamily: 'Courier New', fontStyle: 'bold', color: '#ffffff',
            stroke: '#000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(51).setScrollFactor(0));

        this.scoreBg = add(this.add.graphics().setDepth(50).setScrollFactor(0));
        const scoreStyle = {
            fontSize: '88px', fontFamily: 'Courier New', fontStyle: 'bold',
            stroke: '#000000', strokeThickness: 5
        };
        this.scoreAwayTxt = add(this.add.text(W * 0.2, 106, '0', scoreStyle).setOrigin(0.5).setDepth(51).setScrollFactor(0));
        this.scoreHomeTxt = add(this.add.text(W * 0.8, 106, '0', scoreStyle).setOrigin(0.5).setDepth(51).setScrollFactor(0));

        // Count panel (bottom-right, v1 dimensions 120x80)
        this.hudGfx = add(this.add.graphics().setDepth(50).setScrollFactor(0));
        const cx = W - 80, top = H - 104;
        this.hudAll.push(this.add.text(cx, top + 14, 'STRIKES', {
            fontSize: '12px', fontFamily: 'Courier New', fontStyle: 'bold', color: '#ffffff'
        }).setOrigin(0.5).setDepth(51).setScrollFactor(0));
        this.hudAll.push(this.add.text(cx, top + 50, 'BALLS', {
            fontSize: '12px', fontFamily: 'Courier New', fontStyle: 'bold', color: '#ffffff'
        }).setOrigin(0.5).setDepth(51).setScrollFactor(0));

        // Big-message text for play results
        this.msgText = this.add.text(W / 2, H * 0.36, '', {
            fontSize: '52px', fontFamily: 'Arial Black', color: '#ffe14d',
            stroke: '#000', strokeThickness: 8
        }).setOrigin(0.5).setDepth(60).setScrollFactor(0).setVisible(false);

        this.updateHUD();
    }

    updateHUD() {
        const gs = this.gs;
        const awayName = gs.playerIsAway ? TEAM_COLORS.player.name : TEAM_COLORS.cpu.name;
        const homeName = gs.playerIsAway ? TEAM_COLORS.cpu.name : TEAM_COLORS.player.name;

        // Top bar (v1: "INNING: TOP 3       OUTS: 1/3")
        this.topText.setText(`INNING: ${gs.half.toUpperCase()} ${gs.inning}       OUTS: ${gs.outs}/3`);
        const tb = this.topBarGfx;
        tb.clear();
        tb.fillStyle(0x000000, 0.7);
        const barW = this.topText.width + 40;
        tb.fillRect(W / 2 - barW / 2, 14, barW, 36);

        // Gray score blocks + team-colored numbers (v1 style, no labels)
        const bg = this.scoreBg;
        bg.clear();
        bg.fillStyle(0x808080, 0.7);
        bg.fillRect(W * 0.2 - 78, 52, 156, 108);
        bg.fillRect(W * 0.8 - 78, 52, 156, 108);
        this.scoreAwayTxt.setText(String(gs.score.Red)).setColor(getColorByName(awayName).textCss);
        this.scoreHomeTxt.setText(String(gs.score.Blue)).setColor(getColorByName(homeName).textCss);

        // Count panel — v1's exact drawing and offsets
        const g = this.hudGfx;
        g.clear();
        const cx = W - 80, top = H - 104;
        g.fillStyle(0x000000, 0.8);
        g.fillRect(cx - 60, top, 120, 84);
        g.lineStyle(2, 0xffffff, 1);
        g.strokeRect(cx - 60, top, 120, 84);

        const drawDiamond = (x, y, r) => {
            g.beginPath();
            g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
            g.closePath(); g.fillPath();
            g.strokePath();
        };
        // STRIKES: 3 red diamonds at v1's offsets (-24, +4, +32)
        for (let i = 0; i < 3; i++) {
            const on = i < gs.strikes;
            g.fillStyle(0xff4444, on ? 1 : 0.2);
            g.lineStyle(1, on ? 0xff0000 : 0x666666, 1);
            drawDiamond(cx - 24 + i * 28, top + 32, 8);
        }
        // BALLS: 4 white circles at v1's offsets (-36, -8, +20, +48)
        for (let i = 0; i < 4; i++) {
            const on = i < gs.balls;
            g.fillStyle(0xffffff, on ? 1 : 0.2);
            g.lineStyle(1, on ? 0xcccccc : 0x666666, 1);
            g.fillCircle(cx - 36 + i * 28, top + 68, 8);
            g.strokeCircle(cx - 36 + i * 28, top + 68, 8);
        }
    }

    bigMessage(text, ms, cb) {
        this.msgText.setText(text).setVisible(true).setScale(0.4).setAlpha(1);
        this.tweens.add({
            targets: this.msgText, scale: 1, duration: 240, ease: 'Back.easeOut'
        });
        this.time.delayedCall(ms || 1400, () => {
            this.tweens.add({
                targets: this.msgText, alpha: 0, duration: 260,
                onComplete: () => { this.msgText.setVisible(false); if (cb) cb(); }
            });
        });
    }

    // ─── Input — the canonical hub ScanInput scheme (same as football) ───────
    // SPACE tap = scan forward, SPACE 3s hold = scan backward, ENTER = select.
    // During the pitch, holding ENTER (or touch-and-hold) charges the swing.
    wireInput() {
        this.scanInput = new ScanInput(this, {
            forward: () => { if (this.menu && this.menu.active) this.menu.next(false); },
            backward: () => { if (this.menu && this.menu.active) this.menu.prev(false); },
            select: () => { if (this.menu && this.menu.active) this.menu.select(); },
            isChargePhase: () => this.ib.active && (this.ib.waitingForSwing || this.ib.swingPressed),
            chargeStart: () => this.onSwingStart(),
            chargeRelease: () => this.onSwingRelease()
        });
        // Arrow keys as extra conveniences (mouse users)
        this.input.keyboard.on('keydown-RIGHT', (e) => {
            if (e.repeat || this.ib.active) return;
            if (this.menu && this.menu.active) this.menu.next(false);
        });
        this.input.keyboard.on('keydown-LEFT', (e) => {
            if (e.repeat || this.ib.active) return;
            if (this.menu && this.menu.active) this.menu.prev(false);
        });
    }

    setMenu(menu) {
        if (this.menu) { this.menu.destroy(); }
        this.menu = menu;
        if (menu) menu.setScrollFactor(0);
    }

    // ─── Game flow ───────────────────────────────────────────────────────────
    nextPlay() {
        if (this.gs.gameOver) return;
        // The ball must be back with the pitcher before the next play can
        // start — no pitching while an outfielder is still holding it or the
        // throw-in is mid-flight.
        if (this.ball.visible || this._returnPending || (this._ballBusy || 0) > 0) {
            this.time.delayedCall(200, () => this.nextPlay());
            return;
        }
        if (this.gs.firstPitch) { this.announceHalfInning(); return; }
        if (this.gs.outs >= GAME_CONSTANTS.GAME_RULES.MAX_OUTS) {
            this.endHalfInning();
        } else if (this.isPlayerBatting()) {
            this.startBattingPhase();
        } else {
            this.startPitchingPhase();
        }
    }

    announceHalfInning() {
        this.gs.firstPitch = false;
        const inn = ORDINALS[this.gs.inning] || `inning ${this.gs.inning}`;
        const halfText = this.gs.half === 'top' ? 'Top' : 'Bottom';
        const battingTeam = this.isPlayerBatting() ? TEAM_COLORS.player.name : TEAM_COLORS.cpu.name;
        this.audio.speak(`${halfText} of the ${inn}. ${battingTeam} batting.`);
        this.updateHUD();
        this.time.delayedCall(3800, () => this.nextPlay());
    }

    // ══════════════════════════════════════════════════════════════════════
    // PLAYER BATTING (charge mechanic ported from v1)
    // ══════════════════════════════════════════════════════════════════════
    startBattingPhase() {
        this.resetInteractiveBatting();
        // CPU picks its pitch secretly (v1 simulateComputerPitch)
        this.gs.selectedPitch = PITCH_TYPES[Math.floor(Math.random() * PITCH_TYPES.length)];
        this.gs.selectedPitchLocation = PITCH_LOCATIONS[Math.floor(Math.random() * PITCH_LOCATIONS.length)];
        this.showBattingMenu();
    }

    showBattingMenu() {
        const bases = this.gs.bases;
        // On-field selection, like the throw menu: the BATTER is highlighted
        // for "Ready to Bat" and each stealable BASE gets a big circled
        // highlight (same guards as v1 showStealMenu).
        const targets = [
            { value: 'bat', label: 'Ready to Bat', chip: 'READY TO BAT',
              hint: 'Hold the button to charge your swing, let go to swing',
              fielder: this.batter }
        ];
        if (bases.first && !bases.second) {
            targets.push({ value: 'steal2', label: 'Steal 2nd Base', chip: 'STEAL 2ND',
                fielder: { x: BASE_COORDS.second.x, y: BASE_COORDS.second.y } });
        }
        if (bases.second && !bases.third) {
            targets.push({ value: 'steal3', label: 'Steal 3rd Base', chip: 'STEAL 3RD',
                fielder: { x: BASE_COORDS.third.x, y: BASE_COORDS.third.y } });
        }
        targets.push({ value: 'pause', label: 'Pause', chip: 'PAUSE',
            hint: 'Game options', fielder: { x: 74, y: H - 46 } });

        this.setMenu(new BaseTargetSelector(this, {
            targets, audio: this.audio, title: 'Batter Up!',
            onSelect: (opt) => this.onBattingMenuSelect(opt)
        }));
    }

    onBattingMenuSelect(opt) {
        if (opt.value === 'pause') { this.showPauseMenu(() => this.showBattingMenu()); return; }
        this.setMenu(null);
        if (opt.value === 'bat') { this.beginInteractivePitch(); return; }
        if (opt.value === 'steal2') this.processStealAttempt('second');
        if (opt.value === 'steal3') this.processStealAttempt('third');
    }

    processStealAttempt(targetBase) {
        // v1 odds: 70% to steal 2nd, 50% to steal 3rd
        const fromBase = targetBase === 'second' ? 'first' : 'second';
        const success = Math.random() < (targetBase === 'second' ? 0.7 : 0.5);
        const runner = this.runnerDots[fromBase];
        const target = BASE_COORDS[targetBase];

        this.audio.speak(`He's stealing ${targetBase === 'second' ? 'second' : 'third'}!`);
        // Catcher fires to the bag while the runner sprints — and the
        // covering infielder breaks to the bag to take the throw. The
        // runner's travel time is set RELATIVE to the throw's arrival so the
        // visuals always agree with the roll: safe means he beats the ball
        // to the bag, caught means the ball gets there first.
        this._zoomOnPoint(target.x, target.y, 1.7, 420);
        const coverPos = this.coveringFielder(targetBase, 'C');
        this.jog(this.fielders[coverPos], target.x + 9, target.y + 9, 520);
        const throwPreDelay = 250, throwFlightMs = 620;
        const ballArriveMs = throwPreDelay + throwFlightMs;
        const runnerArriveMs = success ? Math.max(500, ballArriveMs - 200) : ballArriveMs + 260;
        if (runner) this.jog(runner, target.x + 16, target.y - 14, runnerArriveMs / 1.5, 'Quad.easeIn');
        this.time.delayedCall(throwPreDelay, () => {
            this.audio.play('throw');
            this.ballArc(FIELD.FIELDER_HOMES.C, target, throwFlightMs, 46, () => {
                this.audio.play('tag');
                this.cameras.main.shake(120, 0.005);
                if (success) {
                    this.gs.bases[targetBase] = this.gs.bases[fromBase];
                    this.gs.bases[fromBase] = null;
                    this.bigMessage('SAFE!', 1300);
                    this.audio.speak('Safe!');
                    this.audio.play('crowd');
                } else {
                    this.gs.bases[fromBase] = null;
                    this.gs.outs++;
                    this.bigMessage('OUT!', 1300);
                    this.audio.speak('Caught stealing!');
                    this.audio.play('fail');
                }
                this.time.delayedCall(1200, () => {
                    this._zoomOut(380);
                    this.finishPlay(success ? 'Steal' : 'Caught Stealing');
                });
            });
        });
    }

    beginInteractivePitch() {
        const gs = this.gs;
        this.resetInteractiveBatting();
        this.ib.active = true;
        this.ib.waitingForSwing = true;

        // Close-up on the duel: batter, pitcher, and the incoming pitch
        this.setBattingCamera(true);

        this.audio.speak(`${gs.selectedPitch}, ${gs.selectedPitchLocation}!`);

        // Pitcher windup, then the deliberately slow pitch (7.5s — v1 accessibility pacing)
        const pitcher = this.fielders.P;
        this.tweens.add({
            targets: pitcher, scaleY: 1.2, duration: 300, yoyo: true, ease: 'Sine.easeInOut'
        });

        this.time.delayedCall(650, () => {
            if (!this.ib.active) return;
            const from = FIELD.MOUND;
            const to = { x: FIELD.HOME.x, y: FIELD.HOME.y - 6 };
            this.ball.setVisible(true).setPosition(from.x, from.y);
            this.setBallSpin(true);
            this.meterTitle.setText('PRESS & HOLD to charge — RELEASE in the GREEN!').setColor('#ffffff');
            this.meter.setVisible(true);
            this.updateSwingMeter(0);
            const proxy = { t: 0 };
            this.pitchTween = this.tweens.add({
                targets: proxy, t: 1,
                duration: GAME_CONSTANTS.TIMING.INTERACTIVE_PITCH_DURATION,
                ease: 'Linear',
                onUpdate: () => {
                    this.ib.pitchProgress = proxy.t;
                    // v1's per-pitch movement: curve, late break, wobble, drop
                    const off = this.pitchOffset(gs.selectedPitch, proxy.t);
                    this.ball.x = Phaser.Math.Linear(from.x, to.x, proxy.t) + off.dx;
                    this.ball.y = Phaser.Math.Linear(from.y, to.y, proxy.t) - Math.sin(Math.PI * proxy.t) * 14 + off.dy;
                    this.updateSwingMeter(proxy.t);
                    this.ib.ballInStrikeZone = proxy.t >= GAME_CONSTANTS.TIMING.GREEN_ZONE_LO
                                            && proxy.t <= GAME_CONSTANTS.TIMING.GREEN_ZONE_HI;
                    // v1 exact: the friendly two-note chirp repeats every 150ms
                    // for as long as the ball is green
                    if (this.ib.ballInStrikeZone) {
                        const now = Date.now();
                        if (!this.ib.lastSwingTone || now - this.ib.lastSwingTone > 150) {
                            this.audio.play('swingZone');
                            this.ib.lastSwingTone = now;
                        }
                    }
                },
                onComplete: () => this.onPitchComplete()
            });
        });
    }

    // Hold began (Enter/Space/touch down) — port of v1 onSwingStart
    onSwingStart() {
        if (!this.ib.active || !this.ib.waitingForSwing || this.ib.swingPressed) return;
        this.ib.swingPressed = true;
        this.ib.swingPressStart = Date.now();
        this.ib.announcedSwingType = 'bunt';
        this.audio.speak('Bunt', true);
        this.audio.startChargeSound();
        this.powerMeter.setVisible(true);
        this.updatePowerMeter(0);

        this.chargeMonitor = this.time.addEvent({
            delay: 50, loop: true,
            callback: () => {
                if (!this.ib.swingPressed) { this.stopChargeMonitor(); return; }
                const hold = Date.now() - this.ib.swingPressStart;
                const pct = Math.min(hold / GAME_CONSTANTS.TIMING.SWING_POWER_MAX, 1.0);
                this.audio.updateChargeSound(pct);
                this.updatePowerMeter(hold);
                if (hold >= GAME_CONSTANTS.TIMING.SWING_BUNT_MAX && this.ib.announcedSwingType === 'bunt') {
                    this.audio.speak('Normal swing', true);
                    this.ib.announcedSwingType = 'normal';
                }
                if (hold >= GAME_CONSTANTS.TIMING.SWING_POWER_MIN && this.ib.announcedSwingType === 'normal') {
                    this.audio.speak('Power swing', true);
                    this.ib.announcedSwingType = 'power';
                }
            }
        });
    }

    stopChargeMonitor() {
        if (this.chargeMonitor) { this.chargeMonitor.remove(); this.chargeMonitor = null; }
        this.audio.stopChargeSound();
        this.hidePowerMeter();
    }

    // Hold released — port of v1 onSwingRelease (hold time → swing type,
    // release moment vs pitch progress → timing score)
    onSwingRelease() {
        if (!this.ib.active || !this.ib.swingPressed || this.ib.swingReleased) return;
        this.ib.swingPressed = false;
        this.ib.swingReleased = true;
        this.ib.waitingForSwing = false;
        this.stopChargeMonitor();

        const T = GAME_CONSTANTS.TIMING;
        const hold = Date.now() - this.ib.swingPressStart;
        if (hold < T.SWING_BUNT_MAX) {
            this.ib.swingType = 'bunt';
            this.ib.swingPowerLevel = 0.1;
        } else if (hold < T.SWING_POWER_MIN) {
            this.ib.swingType = 'normal';
            this.ib.swingPowerLevel = 0.5;
        } else {
            this.ib.swingType = 'power';
            const powerRange = T.SWING_POWER_MAX - T.SWING_POWER_MIN;
            const powerProgress = Math.min(hold - T.SWING_POWER_MIN, powerRange) / powerRange;
            this.ib.swingPowerLevel = 0.7 + powerProgress * 0.3;
        }

        const perfectTiming = 0.90;
        const timingWindow = T.SWING_TIMING_WINDOW / T.INTERACTIVE_PITCH_DURATION;
        this.ib.timingScore = (this.ib.pitchProgress - perfectTiming) / timingWindow;

        this.executeSwing();
    }

    executeSwing() {
        this.ib.isSwinging = true;
        if (this.pitchTween) { this.pitchTween.stop(); this.pitchTween = null; }
        this.setBattingCamera(false); // pull back out to watch the outcome
        if (this.meter) this.meter.setVisible(false);
        this.audio.play('swing');
        this.animateBatterSwing(this.ib.swingType === 'bunt');
        // The ball is AT the plate the instant the bat whips — contact and
        // launch happen in the same beat as the swing
        if (this.ball.visible) this.ball.setPosition(FIELD.HOME.x, FIELD.HOME.y - 6);
        this.time.delayedCall(60, () => this.processInteractiveSwingOutcome());
    }

    // Draw a proper wooden bat once and cache it as a texture: round knob,
    // slim handle, barrel that tapers out to a rounded tip.
    ensureBatTexture() {
        if (this.textures.exists('bat-shape')) return;
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        const wood = 0xd8b46a, woodDark = 0xa8813f;
        // Knob (left end — the pivot)
        g.fillStyle(woodDark, 1);
        g.fillCircle(3.5, 6, 3);
        // Handle
        g.fillStyle(wood, 1);
        g.fillRect(4, 4.6, 13, 2.8);
        // Barrel: tapers from the handle out to a fat rounded tip
        g.beginPath();
        g.moveTo(17, 4.6);
        g.lineTo(33, 2.4);
        g.lineTo(33, 9.6);
        g.lineTo(17, 7.4);
        g.closePath();
        g.fillPath();
        g.fillCircle(33, 6, 3.6);
        // Grain stripe near the tip
        g.fillStyle(woodDark, 1);
        g.fillRect(28, 3.1, 1.6, 5.8);
        g.generateTexture('bat-shape', 38, 12);
        g.destroy();
    }

    // Slow waggle around the v1 rest pose — a batter is never statue-still
    startBatWaggle() {
        if (!this.bat || !this.bat.active) return;
        this.tweens.killTweensOf(this.bat);
        this.bat.setAngle(-135);
        this.tweens.add({
            targets: this.bat, angle: -128, duration: 620,
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        });
    }

    // v1-EXACT swing, straight from the original Player.js/AnimationSystem:
    // start -135° (up-left back stance), rotate counter-clockwise to -405°
    // (up-right follow-through) — linear, 300ms — hold 200ms, snap back to
    // the stance. Bunt: -135° → 0° (bat squared at the pitcher).
    // Used for BOTH the player's swing and the CPU batter's.
    animateBatterSwing(isBunt) {
        if (!this.bat || !this.bat.active) return;
        this.tweens.killTweensOf(this.bat);
        if (isBunt) {
            this.bat.setRotation(-Math.PI * 0.75);
            this.tweens.add({
                targets: this.bat, rotation: 0, duration: 300, ease: 'Linear',
                yoyo: true, hold: 200,
                onComplete: () => this.startBatWaggle()
            });
        } else {
            this.bat.setRotation(-Math.PI * 0.75);
            this.tweens.add({
                targets: this.bat, rotation: -Math.PI * 2.25, duration: 180, ease: 'Linear',
                onComplete: () => {
                    this.time.delayedCall(200, () => {
                        if (!this.bat || !this.bat.active) return;
                        this.startBatWaggle(); // snap back to stance (v1 behavior)
                    });
                }
            });
        }
    }

    // Quick white burst right where bat meets ball
    contactFlash() {
        const f = this.add.circle(FIELD.HOME.x, FIELD.HOME.y - 6, 10, 0xffffff, 0.9).setDepth(9);
        this.tweens.add({ targets: f, scale: 2.4, alpha: 0, duration: 160, onComplete: () => f.destroy() });
    }

    // The catcher receives any pitch that isn't hit, then tosses it back to
    // the pitcher — the ball never just vanishes at the plate. Possession is
    // held for the whole catch-and-return so nothing can interrupt it.
    catchAtPlate() {
        const glove = { x: FIELD.FIELDER_HOMES.C.x, y: FIELD.FIELDER_HOMES.C.y - 6 };
        this._ballBusy = (this._ballBusy || 0) + 1;
        this.ballArc({ x: this.ball.x, y: this.ball.y }, glove, 200, 4, () => {
            this.audio.play('catch');
            this.time.delayedCall(320, () => {
                this.audio.play('throw');
                this.ballArc(glove, FIELD.MOUND, 480, 30, () => {
                    this.audio.play('catch');
                    this.ball.setVisible(false);
                    this.releaseBall();
                });
            });
        });
    }

    // Pitch arrived without a swing — port of v1 onPitchComplete/processNoSwing
    onPitchComplete() {
        this.pitchTween = null;
        this.catchAtPlate();
        this.setBattingCamera(false);
        this.hideSwingMeter();
        if (this.ib.isSwinging) return;
        if (this.ib.swingPressed && !this.ib.swingReleased) {
            // Still charging — missed the pitch entirely
            this.stopChargeMonitor();
            this.ib.swingPressed = false;
            this.ib.waitingForSwing = false;
            this.processNoSwing();
            return;
        }
        if (!this.ib.swingReleased && !this.ib.swingPressed) {
            this.ib.waitingForSwing = false;
            this.processNoSwing();
        }
    }

    processNoSwing() {
        const gs = this.gs;
        if (this.ib.outcomeProcessed) return;
        this.ib.outcomeProcessed = true;
        this.ib.active = false;
        const location = gs.selectedPitchLocation;
        const R = GAME_CONSTANTS.GAME_RULES;

        if (Math.random() < GAME_CONSTANTS.TIMING.HIT_BY_PITCH_CHANCE) {
            gs.pendingBaseUpdate = () => this.updateBases('Walk', 'user');
            gs.balls = 0; gs.strikes = 0;
            this.audio.speak('Hit by pitch!');
            this.animateAdvances('Walk', () => this.finishPlay('Hit By Pitch'));
            return;
        }

        const isBall = (location === 'Outside' && Math.random() < 0.75) ||
                       (location === 'Inside' && Math.random() < 0.5);
        if (isBall) {
            gs.balls++;
            if (gs.balls >= R.MAX_BALLS) {
                gs.pendingBaseUpdate = () => this.updateBases('Walk', 'user');
                gs.balls = 0; gs.strikes = 0;
                this.audio.speak('Ball four. Walk.');
                this.animateAdvances('Walk', () => this.finishPlay('Walk'));
            } else {
                this.audio.speak(`Ball. ${gs.balls} and ${gs.strikes}.`);
                this.finishPlay('Ball');
            }
        } else {
            gs.strikes++;
            if (gs.strikes >= R.MAX_STRIKES) {
                gs.outs++;
                gs.balls = 0; gs.strikes = 0;
                this.audio.speak('Strike three!');
                this.bigMessage('STRIKE OUT', 1400);
                this.finishPlay('Strike Out');
            } else {
                this.audio.speak(`Strike. ${gs.balls} and ${gs.strikes}.`);
                this.finishPlay('Strike');
            }
        }
    }

    // Contact resolution — outcome tables ported verbatim from v1
    processInteractiveSwingOutcome() {
        const gs = this.gs;
        if (this.ib.outcomeProcessed) return;
        this.ib.outcomeProcessed = true;
        this.ib.active = false;

        const swingType = this.ib.swingType;
        const timingScore = Math.abs(this.ib.timingScore);
        const wasInStrikeZone = this.ib.pitchProgress >= 0.75 && this.ib.pitchProgress <= 1.0;
        const location = gs.selectedPitchLocation;

        let outcome;
        if (timingScore > 1.5) {
            outcome = 'Strike'; // way off — swing and miss
        } else if (swingType === 'bunt') {
            outcome = this.calculateBuntOutcome(timingScore, wasInStrikeZone);
        } else if (timingScore > 0.8) {
            if (wasInStrikeZone) {
                const rand = Math.random();
                if (rand < 0.6) outcome = 'Foul';
                else if (rand < 0.85) outcome = 'Ground Out';
                else outcome = 'Single';
            } else {
                outcome = Math.random() < 0.3 ? 'Foul' : 'Strike';
            }
        } else if (timingScore > 0.4) {
            outcome = this.calculateDecentTimingOutcome(swingType === 'power' ? 0.9 : 0.5, wasInStrikeZone, location, swingType);
        } else {
            outcome = this.calculateGoodTimingOutcome(swingType === 'power' ? 0.9 : 0.5, wasInStrikeZone, location, swingType);
        }

        if (this.ball.glow) this.ball.glow.setVisible(false);
        if (outcome !== 'Strike') {
            this.audio.play(outcome === 'Home Run' ? 'bigHit' : 'hit');
            this.contactFlash();
        }

        this.processBattingOutcome(outcome);
    }

    calculateBuntOutcome(timingScore, wasInStrikeZone) {
        const rand = Math.random();
        if (timingScore > 0.8) {
            if (rand < 0.5) return 'Strike';
            if (rand < 0.85) return 'Foul';
            return 'Ground Out';
        }
        if (!wasInStrikeZone) {
            if (rand < 0.5) return 'Strike';
            if (rand < 0.9) return 'Foul';
            return 'Ground Out';
        }
        if (timingScore <= 0.3) {
            if (rand < 0.30) return 'Single';
            if (rand < 0.65) return 'Ground Out';
            return 'Foul';
        } else {
            if (rand < 0.25) return 'Single';
            if (rand < 0.60) return 'Ground Out';
            return 'Foul';
        }
    }

    calculateDecentTimingOutcome(powerLevel, wasInStrikeZone, location, swingType) {
        const rand = Math.random();
        if (!wasInStrikeZone) return rand < 0.7 ? 'Foul' : 'Strike';

        let hitBonus = 0, strikeBonus = 0;
        if (location === 'Inside') {
            if (swingType === 'power') hitBonus = 0.15;
            else strikeBonus = 0.10;
        }

        if (powerLevel >= 0.8) {
            if (rand < 0.25 + hitBonus) return 'Pop Fly Out';
            if (rand < 0.45 + hitBonus) return 'Single';
            if (rand < 0.60) return 'Double';
            if (rand < 0.75 - strikeBonus) return 'Foul';
            return 'Ground Out';
        } else {
            if (rand < 0.30 + hitBonus) return 'Single';
            if (rand < 0.45 - strikeBonus) return 'Ground Out';
            if (rand < 0.65) return 'Foul';
            if (rand < 0.80) return 'Pop Fly Out';
            return 'Double';
        }
    }

    calculateGoodTimingOutcome(powerLevel, wasInStrikeZone, location, swingType) {
        const rand = Math.random();
        if (!wasInStrikeZone) {
            if (rand < 0.5) return 'Foul';
            if (rand < 0.8) return 'Single';
            return 'Ground Out';
        }

        let hitBonus = 0, strikeBonus = 0;
        if (location === 'Inside') {
            if (swingType === 'power') hitBonus = 0.15;
            else strikeBonus = 0.08;
        } else if (location === 'Middle') {
            hitBonus = 0.05;
        }

        if (powerLevel >= 0.9) {
            if (rand < 0.12 + hitBonus) return 'Home Run';
            if (rand < 0.22 + hitBonus) return 'Triple';
            if (rand < 0.35) return 'Double';
            if (rand < 0.50 - strikeBonus) return 'Single';
            if (rand < 0.70) return 'Pop Fly Out';
            return 'Foul';
        } else if (powerLevel >= 0.7) {
            if (rand < 0.08 + hitBonus) return 'Home Run';
            if (rand < 0.18 + hitBonus) return 'Triple';
            if (rand < 0.30) return 'Double';
            if (rand < 0.45 - strikeBonus) return 'Single';
            if (rand < 0.65) return 'Pop Fly Out';
            return 'Foul';
        } else if (powerLevel >= 0.4) {
            if (rand < 0.01) return 'Home Run';
            if (rand < 0.05) return 'Triple';
            if (rand < 0.18 + hitBonus) return 'Double';
            if (rand < 0.45 + hitBonus - strikeBonus) return 'Single';
            if (rand < 0.70) return 'Ground Out';
            return 'Pop Fly Out';
        } else {
            if (rand < 0.35 + hitBonus - strikeBonus) return 'Single';
            if (rand < 0.45 + hitBonus) return 'Double';
            if (rand < 0.65) return 'Ground Out';
            if (rand < 0.85) return 'Foul';
            return 'Pop Fly Out';
        }
    }

    // Count/out/base bookkeeping — ported from v1 processBattingOutcome,
    // including the double play / triple play rolls on ground outs.
    processBattingOutcome(outcome) {
        const gs = this.gs;
        const R = GAME_CONSTANTS.GAME_RULES;
        let terminal = ['Single', 'Double', 'Triple', 'Home Run'].includes(outcome);

        if (outcome === 'Strike') {
            gs.strikes++;
            if (gs.strikes >= R.MAX_STRIKES) {
                outcome = 'Strike Out';
                gs.outs++;
                terminal = true;
            }
        } else if (outcome === 'Foul') {
            if (gs.strikes < 2) gs.strikes++;
        } else if (outcome === 'Pop Fly Out') {
            gs.outs++;
            terminal = true;
        } else if (outcome === 'Ground Out') {
            terminal = true;
            if (gs.outs === 2) {
                gs.outs++;
            } else if (gs.outs === 0 && gs.bases.first && gs.bases.second && Math.random() < 0.5) {
                outcome = 'Triple Play';
                gs.outs = 3;
                gs.pendingBaseUpdate = () => {
                    gs.bases.first = null; gs.bases.second = null; gs.bases.third = null;
                };
            } else if (gs.outs <= 1 && gs.bases.first) {
                if (Math.random() < 0.5) {
                    outcome = 'Double Play';
                    gs.outs += 2;
                    gs.pendingBaseUpdate = () => {
                        if (gs.bases.second && !gs.bases.third) gs.bases.third = gs.bases.second;
                        gs.bases.second = null;
                        gs.bases.first = null;
                    };
                } else {
                    gs.outs++;
                    gs.pendingBaseUpdate = () => {
                        if (gs.bases.first) {
                            if (gs.bases.second && !gs.bases.third) gs.bases.third = gs.bases.second;
                            gs.bases.second = gs.bases.first;
                            gs.bases.first = null;
                        }
                    };
                }
            } else {
                gs.outs++;
            }
        } else if (['Single', 'Double', 'Triple', 'Home Run'].includes(outcome)) {
            gs.pendingBaseUpdate = () => this.updateBases(outcome, 'user');
        }

        if (terminal || outcome === 'Strike Out') {
            gs.balls = 0;
            gs.strikes = 0;
        }

        // Announce (grand slam check ported from v1)
        this.time.delayedCall(300, () => {
            if (outcome === 'Home Run' && gs.bases.first && gs.bases.second && gs.bases.third) {
                this.audio.speak('Grand Slam!');
            } else {
                this.audio.speak(outcome);
            }
        });

        this.animatePlayerContact(outcome, () => this.finishPlay(outcome));
    }

    // Visuals for the player's contact — the CPU defense fields automatically
    // (the result is already decided by the ported tables; this is choreography).
    animatePlayerContact(outcome, cb) {
        const home = FIELD.HOME;

        if (outcome === 'Strike' || outcome === 'Strike Out') {
            // Swing and a miss — the ball carries on into the catcher's glove
            if (this.ball.visible) this.catchAtPlate();
            if (outcome === 'Strike Out') this.bigMessage('STRIKE OUT', 1300);
            this.time.delayedCall(1100, cb);
            return;
        }

        if (outcome === 'Foul') {
            const foulSpot = { x: home.x + Phaser.Math.Between(-260, 260), y: home.y + Phaser.Math.Between(30, 70) };
            this.ballArc(home, foulSpot, 700, 90, () => {
                this.ball.setVisible(false);
                this.time.delayedCall(500, cb);
            });
            return;
        }

        if (outcome === 'Home Run') {
            const over = { x: FIELD.WALL.CF.x + Phaser.Math.Between(-160, 160), y: FIELD.WALL.CF.y - 30 };
            this._zoomOnPoint((home.x + over.x) / 2, (home.y + over.y) / 2, 1.25, 500);
            this.ballArc(home, over, 1700, 150, () => {
                this.ball.setVisible(false);
                this.audio.play('homer');
                this.cameras.main.shake(240, 0.012);
                this.bigMessage('HOME RUN!', 2200);
                // Full view for the trot: the batter (and everyone aboard)
                // rounds the bases and crosses home
                this.time.delayedCall(700, () => {
                    this._zoomOut(400);
                    this.time.delayedCall(420, () => {
                        this.animateAdvances('Home Run', () => {
                            this.audio.play('crowd_big');
                            this.time.delayedCall(400, cb);
                        });
                    });
                });
            });
            return;
        }

        if (outcome === 'Pop Fly Out') {
            const catcherPos = Phaser.Utils.Array.GetRandom(['CF', 'LF', 'RF', 'SS', '2B']);
            const spot = FIELD.FIELDER_HOMES[catcherPos];
            this.ballArc(home, spot, 1400, 170, () => {
                this.audio.play('catch');
                this._zoomOnPoint(spot.x, spot.y, 1.7, 300);
                this.bigMessage('CAUGHT!', 1200);
                this.time.delayedCall(1300, () => { this._zoomOut(350); this.time.delayedCall(400, cb); });
            });
            return;
        }

        if (['Ground Out', 'Double Play', 'Triple Play'].includes(outcome)) {
            const fielderPos = Phaser.Utils.Array.GetRandom(['SS', '2B', '3B', '1B']);
            const fielder = this.fielders[fielderPos];
            const spot = {
                x: Phaser.Math.Linear(home.x, FIELD.FIELDER_HOMES[fielderPos].x, 0.72),
                y: Phaser.Math.Linear(home.y, FIELD.FIELDER_HOMES[fielderPos].y, 0.72)
            };
            // Your runners take off; the CPU defense turns the play for real —
            // cover men take the bags and the throws beat the runners there.
            this.startContactRunners();
            this._ballBusy = (this._ballBusy || 0) + 1;
            this.ballArc(home, spot, 520, 22, () => {
                this.jog(fielder, spot.x + 4, spot.y - 4, 260, 'Quad.easeOut', () => {
                    this.audio.play('catch');
                    this.releaseBall();
                    const seq = outcome === 'Triple Play' ? ['third', 'second', 'first']
                              : outcome === 'Double Play' ? ['second', 'first']
                              : ['first'];
                    const runnerForBase = { first: 'batter', second: 'first', third: 'second', home: 'third' };
                    const arm = (FIELDER_RATINGS[fielderPos] || { arm: 3 }).arm;
                    const throwNext = (fromXY, throwerPos, chain) => {
                        if (!chain.length) {
                            // Runners not involved in the outs finish their advance
                            Object.keys(runnerForBase).forEach(b => {
                                if (!seq.includes(b)) this.sendRunner(runnerForBase[b], 1000);
                            });
                            const label = outcome === 'Triple Play' ? 'TRIPLE PLAY!'
                                        : outcome === 'Double Play' ? 'DOUBLE PLAY!'
                                        : 'OUT!';
                            this.bigMessage(label, 1400);
                            if (outcome !== 'Ground Out') this.cameras.main.shake(200, 0.008);
                            this.time.delayedCall(1400, () => { this._zoomOut(380); this.time.delayedCall(420, cb); });
                            return;
                        }
                        const base = chain[0];
                        const t = this.throwFlightMs(fromXY, base, arm);
                        this._zoomOnPoint(BASE_COORDS[base].x, BASE_COORDS[base].y, 1.5, Math.max(260, t));
                        this.animateThrowRace({
                            fromXY, throwerPos, targetBase: base,
                            out: true, throwTimeMs: t, runnerKey: runnerForBase[base]
                        }, () => throwNext(BASE_COORDS[base], this.coveringFielder(base, throwerPos), chain.slice(1)));
                    };
                    throwNext(spot, fielderPos, seq);
                });
            });
            return;
        }

        if (outcome === 'Single') {
            // A single is a GROUND BALL: it scoots past the infield spot, an
            // infielder chases it down and still tries to make a play — the
            // force at 2nd (double-play try) if a runner is on 1st, otherwise
            // first base — but on a single the runner beats the throw. SAFE.
            const fielderPos = weightedChoice({ SS: 30, '2B': 28, '3B': 22, '1B': 20 });
            const fielder = this.fielders[fielderPos];
            const fhome = FIELD.FIELDER_HOMES[fielderPos];
            const spot = {
                x: Phaser.Math.Linear(home.x, fhome.x, 0.9) + Phaser.Math.Between(-10, 10),
                y: Phaser.Math.Linear(home.y, fhome.y, 0.9) + Phaser.Math.Between(-6, 6)
            };
            this.startContactRunners();
            this._ballBusy = (this._ballBusy || 0) + 1;
            this.ballArc(home, spot, 620, 16, () => {
                this.jog(fielder, spot.x + 4, spot.y - 4, 340, 'Quad.easeOut', () => {
                    this.audio.play('catch');
                    this.releaseBall();
                    const target = this.gs.bases.first ? 'second' : 'first';
                    const runnerKey = target === 'second' ? 'first' : 'batter';
                    const arm = (FIELDER_RATINGS[fielderPos] || { arm: 3 }).arm;
                    const t = this.throwFlightMs(spot, target, arm);
                    this._zoomOnPoint(BASE_COORDS[target].x, BASE_COORDS[target].y, 1.5, Math.max(260, t));
                    this.animateThrowRace({
                        fromXY: spot, throwerPos: fielderPos, targetBase: target,
                        out: false, throwTimeMs: t, runnerKey
                    }, () => {
                        this.bigMessage('SAFE!', 1100);
                        this.audio.play('crowd');
                        // Everyone else completes their advance
                        ['batter', 'first', 'second', 'third'].forEach(k => {
                            if (k !== runnerKey) this.sendRunner(k, 550);
                        });
                        this.time.delayedCall(1200, () => {
                            this._zoomOut(360);
                            this.time.delayedCall(380, cb);
                        });
                    });
                });
            });
            return;
        }

        // Doubles/triples: driven into the outfield gap while every runner
        // takes off — a couple of fielders chase it down and fire it in to
        // the extra base for a real, timed relay instead of freezing the
        // instant it's fielded. Runners and the throw-in run concurrently;
        // cb() fires once both are done.
        let pending = 2;
        const done = () => { if (--pending === 0) cb(); };
        this.animateAdvances(outcome, done);
        this.chaseDownExtraBaseHit(outcome, done);
    }

    // Every runner visibly runs the basepaths to where the play sends them,
    // scoring runners cross home plate (and the batter tours all four bags on
    // a home run). Purely visual — state changes stay in updateBases so the
    // ported v1 rules remain the single source of truth.
    animateAdvances(outcome, cb) {
        const b = this.gs.bases;
        const col = this.battingColor();

        // {fromIdx, toIdx} on the base path: 0=batter's box, 1..3=bases, 4=home
        const moves = [];
        const push = (fromIdx, toIdx) => moves.push({ fromIdx, toIdx });
        if (outcome === 'Walk') {
            push(0, 1);
            if (b.first) push(1, 2);
            if (b.first && b.second) push(2, 3);
            if (b.first && b.second && b.third) push(3, 4);
        } else if (outcome === 'Single') {
            push(0, 1);
            if (b.first) push(1, 2);
            if (b.first && b.second) push(2, 3);
            if (b.second && b.third) push(3, 4);
        } else if (outcome === 'Double') {
            push(0, 2);
            if (b.first) push(1, 3);
            if (b.second) push(2, 4);
            if (b.third) push(3, 4);
        } else if (outcome === 'Triple') {
            push(0, 3);
            if (b.first) push(1, 4);
            if (b.second) push(2, 4);
            if (b.third) push(3, 4);
        } else if (outcome === 'Home Run') {
            push(0, 4);
            if (b.first) push(1, 4);
            if (b.second) push(2, 4);
            if (b.third) push(3, 4);
        }

        if (!moves.length) { cb(); return; }

        const PATH = [
            { x: FIELD.BATTER_BOX.x, y: FIELD.BATTER_BOX.y },
            BASE_COORDS.first, BASE_COORDS.second, BASE_COORDS.third, BASE_COORDS.home
        ];
        // Swap static dots for moving runners
        ['first', 'second', 'third'].forEach(k => {
            if (this.runnerDots[k]) this.runnerDots[k].setVisible(false);
        });

        const LEG_MS = 1000;
        let pending = moves.length;
        this._advanceSprites = this._advanceSprites || [];
        moves.forEach(m => {
            // The batter drops the bat and runs himself; base runners are
            // fresh sprites standing in for the static dots
            const isBatter = m.fromIdx === 0;
            const sprite = isBatter ? this.batterTakesOff() : this.makePlayer(col, 'R');
            if (!isBatter) {
                sprite.setScale(0.8);
                const start = PATH[m.fromIdx];
                sprite.setPosition(start.x + 16, start.y - 14);
            }
            this.startBob(sprite);
            const runLeg = (idx) => {
                if (idx > m.toIdx) {
                    this.stopBob(sprite);
                    if (m.toIdx === 4) {
                        // Score! Fade out crossing the plate
                        this.tweens.add({ targets: sprite, alpha: 0, duration: 300, onComplete: () => { if (!isBatter) sprite.destroy(); } });
                    } else if (!isBatter) {
                        // STAY on the bag — destroying him here made runners
                        // blink out and pop back seconds later when the static
                        // dot finally appeared. finishPlay's clearContactRunners
                        // swaps him for the dot in the same frame syncRunners
                        // paints it.
                        this._advanceSprites.push(sprite);
                    }
                    if (--pending === 0) cb(); // batter stays on his bag too — resetBatter comes with the dot swap
                    return;
                }
                const p = PATH[idx];
                this.tweens.add({
                    targets: sprite, x: p.x + 16, y: p.y - 14, duration: LEG_MS, ease: 'Linear',
                    onComplete: () => runLeg(idx + 1)
                });
            };
            runLeg(m.fromIdx + 1);
        });
    }

    // ─── Real-baseball throw choreography ────────────────────────────────────
    // Who covers a bag when a throw goes there. Middle infield trades coverage
    // of second; if the primary cover man made the play himself, his backup
    // takes the bag.
    coveringFielder(base, throwerPos) {
        if (base === 'second') return throwerPos === '2B' ? 'SS' : '2B';
        const primary = { first: '1B', third: '3B', home: 'C' };
        const backup  = { first: 'P',  third: 'SS', home: 'P' };
        const cover = primary[base];
        return cover === throwerPos ? (backup[base] || 'P') : cover;
    }

    // Animation-time for a throw over a real distance (same speed model as
    // computeThrowOutcome so visuals and odds agree)
    throwFlightMs(fromXY, base, arm) {
        const target = BASE_COORDS[base];
        const dist = Phaser.Math.Distance.Between(fromXY.x, fromXY.y, target.x, target.y);
        const speed = THROW_TUNING.THROW_SPEED_BASE + (arm || 3) * THROW_TUNING.THROW_SPEED_PER_ARM;
        return Math.max(220, dist / speed);
    }

    // On contact, the batter takes off for first and every runner breaks for
    // the next base — they run partway and hold while the ball is fielded
    // (the decision freeze-frame). Static base dots are swapped for these
    // moving sprites until the play resolves.
    startContactRunners() {
        this.clearContactRunners();
        const col = this.battingColor();
        this.playRunners = {};
        // Only runners who are actually FORCED run on a ground ball — a
        // runner with no force stays planted on his bag (no run-and-reset).
        const b = this.gs.bases;
        const legs = [
            { key: 'batter', from: { x: FIELD.BATTER_BOX.x, y: FIELD.BATTER_BOX.y }, to: BASE_COORDS.first, when: true },
            { key: 'first',  from: BASE_COORDS.first,  to: BASE_COORDS.second, when: !!b.first },
            { key: 'second', from: BASE_COORDS.second, to: BASE_COORDS.third,  when: !!(b.first && b.second) },
            { key: 'third',  from: BASE_COORDS.third,  to: BASE_COORDS.home,   when: !!(b.first && b.second && b.third) }
        ];
        legs.forEach(leg => {
            if (!leg.when) return;
            // The batter-runner IS the batter — he drops the bat and takes
            // off. Base runners are fresh sprites replacing static dots.
            const isBatter = leg.key === 'batter';
            const sprite = isBatter ? this.batterTakesOff() : this.makePlayer(col, 'R');
            if (!isBatter) {
                sprite.setScale(0.8);
                sprite.setPosition(leg.from.x + 16, leg.from.y - 14);
            }
            const hold = {
                x: Phaser.Math.Linear(leg.from.x, leg.to.x, 0.42) + 16,
                y: Phaser.Math.Linear(leg.from.y, leg.to.y, 0.42) - 14
            };
            this.startBob(sprite);
            this.tweens.add({
                targets: sprite, x: hold.x, y: hold.y, duration: 950, ease: 'Quad.easeOut',
                onComplete: () => this.stopBob(sprite)
            });
            this.playRunners[leg.key] = { sprite, to: leg.to, from: leg.from, isBatter };
        });
        // Hide static dots only for the runners that actually took off
        ['first', 'second', 'third'].forEach(k => {
            if (this.playRunners[k] && this.runnerDots[k]) this.runnerDots[k].setVisible(false);
        });
    }

    clearContactRunners() {
        if (this.playRunners) {
            Object.values(this.playRunners).forEach(r => {
                this.tweens.killTweensOf(r.sprite);
                if (!r.isBatter) r.sprite.destroy();
            });
        }
        this.playRunners = null;
        // Runners animateAdvances parked on their bags — swapped for static
        // dots in this same frame (finishPlay calls syncRunners right after)
        if (this._advanceSprites) {
            this._advanceSprites.forEach(s => { this.tweens.killTweensOf(s); s.destroy(); });
            this._advanceSprites = null;
        }
        // If the batter ran, the next batter steps in (destroys the old sprite)
        this.resetBatter();
    }

    // Send a play-runner the rest of the way to a base over `ms`
    sendRunner(key, ms, targetBase) {
        const r = this.playRunners && this.playRunners[key];
        if (!r) return;
        const to = targetBase ? BASE_COORDS[targetBase] : r.to;
        this.tweens.killTweensOf(r.sprite);
        this.startBob(r.sprite);
        this.tweens.add({
            targets: r.sprite, x: to.x + 16, y: to.y - 14, duration: ms, ease: 'Linear',
            onComplete: () => this.stopBob(r.sprite)
        });
    }

    // The heart of the new mechanic's presentation: a throw is a RACE.
    // The covering fielder breaks for the bag, the runner sprints, the ball
    // flies — whoever wins the race is what the roll already decided.
    animateThrowRace({ fromXY, throwerPos, targetBase, out, throwTimeMs, runnerKey }, cb) {
        const bag = BASE_COORDS[targetBase];
        const coverPos = this.coveringFielder(targetBase, throwerPos);
        const cover = this.fielders[coverPos];

        // Cover man sprints to receive at the bag
        this.tweens.killTweensOf(cover);
        this.jog(cover, bag.x + 9, bag.y + 9, Math.max(200, throwTimeMs * 0.8));

        // Runner races the ball: loses by a step on an out, beats it when safe
        if (runnerKey) {
            const arriveMs = out ? throwTimeMs + 420 : Math.max(320, throwTimeMs - 120);
            this.sendRunner(runnerKey, arriveMs, targetBase);
        }

        this.audio.play('throw');
        this.ballArc(fromXY, bag, throwTimeMs, Math.min(60, throwTimeMs * 0.09), () => {
            this.audio.play(out ? 'tag' : 'catch');
            // Ball stays live at the bag — finishPlay tosses it to the mound
            const r = runnerKey && this.playRunners && this.playRunners[runnerKey];
            if (out && r) {
                // Tag flash on the beaten runner
                this.tweens.add({ targets: r.sprite, alpha: 0.2, duration: 110, yoyo: true, repeat: 2 });
            }
            if (cb) cb();
        });
    }

    // A gap hit doesn't die the instant a fielder reaches it — it skips/rolls
    // a few more feet, a couple of fielders (the chaser + a relay/cutoff man)
    // converge on it, and it gets fired in to the extra base the batter is
    // stretching for. The extra base is already locked in by the outcome
    // tables (this never turns a real Double/Triple into an out), but it now
    // takes real, timed motion to get there instead of freezing dead the
    // moment it's fielded. Runner movement is handled separately by
    // animateAdvances(); this only choreographs the ball/fielders and calls
    // cb() once the throw-in and "Safe!" call finish.
    chaseDownExtraBaseHit(outcome, cb) {
        const home = FIELD.HOME;
        const isTriple = outcome === 'Triple';
        const targetBase = isTriple ? 'third' : 'second';
        const gapX = isTriple ? Phaser.Math.Between(620, 780) : Phaser.Math.Between(220, 380);
        const landSpot = { x: gapX, y: Phaser.Math.Between(150, 230) };
        const chaserPos = gapX < 380 ? 'LF' : gapX > 620 ? 'RF' : 'CF';
        const cutoffPos = chaserPos === 'LF' ? 'SS' : chaserPos === 'RF' ? '2B' : (isTriple ? '3B' : 'SS');

        // The batter-runner's arrival at his bag (animateAdvances runs in
        // parallel from the same instant: 1000ms per leg). The play is SAFE
        // by rule, so the throw is HELD as needed to reach the bag a beat
        // after the runner — the ball must never visibly beat a safe runner.
        const runnerEtaMs = (isTriple ? 3 : 2) * 1000;
        const t0 = this.time.now;

        const finalThrow = (fromXY, throwerPos) => {
            const arm = (FIELDER_RATINGS[throwerPos] || { arm: 3 }).arm;
            const t = this.throwFlightMs(fromXY, targetBase, arm);
            const hold = Math.max(0, (runnerEtaMs + 280) - (this.time.now - t0) - t);
            this.time.delayedCall(hold, () => {
                this.audio.play('throw');
                const cover = this.fielders[this.coveringFielder(targetBase, throwerPos)];
                this.tweens.killTweensOf(cover);
                this.jog(cover, BASE_COORDS[targetBase].x + 9, BASE_COORDS[targetBase].y + 9, Math.max(200, t * 0.8));
                this._zoomOnPoint(BASE_COORDS[targetBase].x, BASE_COORDS[targetBase].y, 1.5, Math.max(260, t));
                this.ballArc(fromXY, BASE_COORDS[targetBase], t, Math.min(50, t * 0.09), () => {
                    this.audio.play('catch');
                    this.bigMessage('SAFE!', 1200);
                    this.audio.speak(`Safe at ${BASE_NAMES[targetBase]}.`);
                    this.audio.play('crowd');
                    this.time.delayedCall(1000, () => {
                        this._zoomOut(360);
                        this.time.delayedCall(380, cb);
                    });
                });
            });
        };

        this._ballBusy = (this._ballBusy || 0) + 1;
        this.ballArc(home, landSpot, 900, 90, () => {
            // Skips/rolls a few more feet before anyone corrals it
            const rollSpot = {
                x: Phaser.Math.Clamp(landSpot.x + Phaser.Math.Between(-30, 30), 40, 960),
                y: landSpot.y + Phaser.Math.Between(25, 50)
            };
            this.tweens.add({ targets: this.ball, x: rollSpot.x, y: rollSpot.y, duration: 300, ease: 'Quad.easeOut' });

            // The cutoff man breaks for his relay spot right away — a real
            // defense doesn't wait for the ball to be fielded to start moving.
            const relaySpot = {
                x: Phaser.Math.Linear(rollSpot.x, BASE_COORDS[targetBase].x, 0.5),
                y: Phaser.Math.Linear(rollSpot.y, BASE_COORDS[targetBase].y, 0.5)
            };
            this.jog(this.fielders[cutoffPos], relaySpot.x, relaySpot.y, 480, 'Quad.easeOut');

            this.time.delayedCall(300, () => {
                this.jog(this.fielders[chaserPos], rollSpot.x + 4, rollSpot.y - 4, 420, 'Quad.easeOut', () => {
                    this.audio.play('catch');
                    this.releaseBall();
                    if (isTriple) {
                        // Classic outfield-to-third relay through the cutoff man
                        this._ballBusy = (this._ballBusy || 0) + 1;
                        const armChaser = (FIELDER_RATINGS[chaserPos] || { arm: 3 }).arm;
                        const t1 = Math.max(240, this.throwFlightMs(rollSpot, targetBase, armChaser) * 0.5);
                        this.audio.play('throw');
                        this.ballArc(rollSpot, relaySpot, t1, 24, () => {
                            this.audio.play('catch');
                            this.releaseBall();
                            this.time.delayedCall(180, () => finalThrow(relaySpot, cutoffPos));
                        });
                    } else {
                        // A plain double is a direct throw from the gap to 2nd
                        finalThrow(rollSpot, chaserPos);
                    }
                });
            });
        });
    }

    // Everyone jogs back to their positions once the play is dead
    returnFielders() {
        Object.keys(this.fielders).forEach(pos => {
            const home = FIELD.FIELDER_HOMES[pos];
            const f = this.fielders[pos];
            if (Math.abs(f.x - home.x) > 2 || Math.abs(f.y - home.y) > 2) {
                this.tweens.killTweensOf(f);
                this.jog(f, home.x, home.y, 700, 'Sine.easeInOut');
            }
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    // PLAYER PITCHING / FIELDING (CPU bats) — with the NEW throw-to-base menu
    // ══════════════════════════════════════════════════════════════════════
    startPitchingPhase() {
        this.showPitchMenu();
    }

    // 5-zone pitch selector ported from v1 generatePitchGrid (shuffled pitches,
    // one hidden "hot zone"; the green highlight mirrors v1's heatmap)
    showPitchMenu() {
        const zones = ['High Inside', 'High Outside', 'Low Outside', 'Low Inside', 'Center'];
        const shuffled = [...PITCH_TYPES];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const hotZone = Math.floor(Math.random() * 5);

        // Same tiering as before (hot zone best, adjacent/center decent,
        // opposite corner worst) but jittered into a continuous value each
        // time instead of 3 fixed numbers, so the heatmap's colors form a
        // real gradient across the grid rather than repeating the same
        // three flat shades every pitch.
        this.pitchGrid = zones.map((zone, i) => {
            let effectiveness;
            if (i === hotZone) effectiveness = 0.97 + Math.random() * 0.03;
            else if (i === 4 || hotZone === 4) effectiveness = 0.50 + Math.random() * 0.18;
            else {
                const diff = Math.abs(i - hotZone);
                effectiveness = (diff === 1 || diff === 3)
                    ? 0.52 + Math.random() * 0.18
                    : 0.14 + Math.random() * 0.18;
            }
            return { pitch: shuffled[i], zone, zoneIndex: i, effectiveness };
        });

        // The v1-style strike-zone heatmap: green cell = your best pitch
        const menu = new PitchZoneGrid(this, {
            x: 138, y: 310, size: 200,
            audio: this.audio, grid: this.pitchGrid,
            onSelect: (opt) => {
                if (opt.value === 'pause') { this.showPauseMenu(() => this.showPitchMenu()); return; }
                this.setMenu(null);
                this.processPitchSelection(this.pitchGrid[opt.value]);
            }
        });
        this.setMenu(menu);
        this.audio.speak('Choose your pitch.');
    }

    // Where the pitch actually goes — ported from v1 getPitchOutcome
    getPitchOutcome(cell) {
        const roll = Math.random() * 100;
        if (cell.zoneIndex === 4) {
            if (roll < 70) return { location: 'Center', drifted: false };
            if (roll < 77.5) return { location: 'High Center', drifted: true };
            if (roll < 85) return { location: 'Low Center', drifted: true };
            if (roll < 92.5) return { location: 'Inside', drifted: true };
            return { location: 'Outside', drifted: true };
        }
        const zoneNames = ['High Inside', 'High Outside', 'Low Outside', 'Low Inside'];
        if (roll < 85) return { location: zoneNames[cell.zoneIndex], drifted: false };
        return { location: 'Center', drifted: true };
    }

    processPitchSelection(cell) {
        const gs = this.gs;
        const pitchOutcome = this.getPitchOutcome(cell);
        const actual = pitchOutcome.location;
        gs.selectedPitch = cell.pitch;
        gs.selectedPitchLocation = actual.includes('Inside') ? 'Inside'
                                 : actual.includes('Outside') ? 'Outside' : 'Middle';
        gs.selectedPitchEffectiveness = cell.effectiveness;
        gs.bestPitchBonus = cell.effectiveness >= 0.95;

        if (gs.lastPitchType === cell.pitch) gs.samePitchCount++;
        else gs.samePitchCount = 1;
        gs.lastPitchType = cell.pitch;

        // Decide the outcome NOW so the choreography can match it: the CPU
        // batter visibly swings as the ball arrives (except on called balls)
        const outcome = this.computeCpuPitchOutcome(cell.pitch);
        const cpuSwings = outcome !== 'Ball';

        // Close-up on the duel for the pitch and the CPU's swing
        this.setBattingCamera(true);

        const pitcher = this.fielders.P;
        this.tweens.add({ targets: pitcher, scaleY: 1.2, duration: 240, yoyo: true, ease: 'Sine.easeInOut' });
        // Unhurried beats so the announcer finishes each line before the next
        this.time.delayedCall(800, () => {
            const dur = this.cpuPitchFlight(cell.pitch, () => {
                if (outcome === 'Ball' || outcome === 'Strike') {
                    // Into the catcher's glove, small breather for the call
                    this.catchAtPlate();
                    this.time.delayedCall(700, () => this.processCpuOutcome(outcome));
                } else {
                    // CRACK — the hit launches the instant the ball arrives
                    this.contactFlash();
                    this.processCpuOutcome(outcome);
                }
            });
            if (cpuSwings) {
                // Swing timed so the whip crosses the zone as the ball arrives
                this.time.delayedCall(Math.max(0, dur - 190), () => {
                    this.animateBatterSwing(false);
                    this.audio.play('swing');
                });
            }
        });
    }

    // CPU batter outcome roll — ported verbatim from v1 processPitch
    computeCpuPitchOutcome(pitchType) {
        const gs = this.gs;
        const probs = PITCH_PROBABILITIES[pitchType] || PITCH_PROBABILITIES.Fastball;

        let strikeRate = probs.strike;
        let ballRate = probs.ball;
        let foulRate = probs.foul;
        const hitOutcomes = { ...probs.outcomes };

        const effectiveness = gs.selectedPitchEffectiveness || 0.5;
        const effectivenessModifier = (effectiveness - 0.5) * 0.3;
        strikeRate = strikeRate * (1 + effectivenessModifier);

        if (gs.bestPitchBonus) {
            strikeRate = strikeRate * 1.30;
            foulRate = foulRate * 1.25;
        }

        const hitModifier = 1 - effectivenessModifier;
        Object.keys(hitOutcomes).forEach(key => { hitOutcomes[key] = hitOutcomes[key] * hitModifier; });

        if (gs.bestPitchBonus) {
            if (hitOutcomes['Double']) hitOutcomes['Double'] *= 0.25;
            if (hitOutcomes['Triple']) hitOutcomes['Triple'] *= 0.15;
            if (hitOutcomes['Home Run']) hitOutcomes['Home Run'] *= 0.10;
            if (hitOutcomes['Single']) hitOutcomes['Single'] *= 0.70;
            if (hitOutcomes['Ground Out']) hitOutcomes['Ground Out'] *= 1.60;
            if (hitOutcomes['Pop Fly Out']) hitOutcomes['Pop Fly Out'] *= 1.50;
        }

        if (gs.samePitchCount > 2) {
            const penalty = (gs.samePitchCount - 2) * 5;
            strikeRate = Math.max(20, strikeRate - penalty);
            const penaltyReduction = gs.bestPitchBonus ? 0.3 : 1.0;
            const hitBoost = (penalty * penaltyReduction) / Object.keys(hitOutcomes).length;
            Object.keys(hitOutcomes).forEach(key => {
                if (key !== 'Home Run') hitOutcomes[key] += hitBoost;
            });
        }

        const loc = gs.selectedPitchLocation;
        if (loc === 'Middle') {
            strikeRate += ballRate; ballRate = 0;
        } else if (loc === 'Inside') {
            const ballReduction = ballRate * 0.5;
            strikeRate += ballReduction; ballRate = ballRate * 0.5;
        }

        const foulTotal = strikeRate + ballRate + foulRate;
        const hitTotal = Object.values(hitOutcomes).reduce((a, b) => a + b, 0);
        const rand = Math.random() * (foulTotal + hitTotal);

        let outcome;
        if (rand < strikeRate) outcome = 'Strike';
        else if (rand < strikeRate + ballRate) outcome = 'Ball';
        else if (rand < foulTotal) outcome = 'Foul';
        else outcome = weightedChoice(hitOutcomes);

        return outcome;
    }

    processCpuOutcome(outcome) {
        // Pull back out to the full field to watch the play develop
        this.setBattingCamera(false);
        const gs = this.gs;
        const R = GAME_CONSTANTS.GAME_RULES;

        if (outcome === 'Strike') {
            gs.strikes++;
            if (gs.strikes >= R.MAX_STRIKES) {
                gs.outs++; gs.balls = 0; gs.strikes = 0;
                this.audio.speak('Strike out!');
                this.bigMessage('STRIKE OUT', 1300);
                this.finishPlay('Strike Out');
            } else {
                this.audio.speak(`Strike. ${gs.balls} and ${gs.strikes}.`);
                this.finishPlay('Strike');
            }
            return;
        }

        if (outcome === 'Ball') {
            gs.balls++;
            if (gs.balls >= R.MAX_BALLS) {
                gs.pendingBaseUpdate = () => this.updateBases('Walk', 'comp');
                gs.balls = 0; gs.strikes = 0;
                this.audio.speak('Ball four. Walk.');
                this.animateAdvances('Walk', () => this.finishPlay('Walk'));
            } else {
                this.audio.speak(`Ball. ${gs.balls} and ${gs.strikes}.`);
                this.finishPlay('Ball');
            }
            return;
        }

        if (outcome === 'Foul') {
            this.audio.play('hit');
            if (gs.strikes < 2) gs.strikes++;
            const foulSpot = { x: FIELD.HOME.x + Phaser.Math.Between(-240, 240), y: FIELD.HOME.y + Phaser.Math.Between(30, 70) };
            this.ballArc(FIELD.HOME, foulSpot, 650, 80, () => this.ball.setVisible(false));
            this.audio.speak('Foul ball.');
            this.time.delayedCall(1300, () => this.finishPlay('Foul'));
            return;
        }

        if (outcome === 'Pop Fly Out') {
            this.audio.play('hit');
            gs.outs++; gs.balls = 0; gs.strikes = 0;
            const catcherPos = Phaser.Utils.Array.GetRandom(['CF', 'LF', 'RF', 'SS', '2B']);
            const spot = FIELD.FIELDER_HOMES[catcherPos];
            this.ballArc(FIELD.HOME, spot, 1300, 160, () => {
                this.audio.play('catch');
                this._zoomOnPoint(spot.x, spot.y, 1.7, 300);
                this.bigMessage('CAUGHT!', 1200);
                this.audio.speak('Pop fly. Out!');
                this.time.delayedCall(1300, () => {
                    this._zoomOut(350);
                    this.time.delayedCall(400, () => this.finishPlay('Pop Fly Out'));
                });
            });
            return;
        }

        if (outcome === 'Ground Out') {
            // ★ THE NEW MECHANIC — you decide the throw
            this.audio.play('hit');
            gs.balls = 0; gs.strikes = 0;
            this.startGroundballPlay();
            return;
        }

        if (outcome === 'Single') {
            this.audio.play('hit');
            gs.balls = 0; gs.strikes = 0;
            this.startCpuSingle();
            return;
        }

        // Extra-base hits: ported v1 resolution, cinematic visuals
        this.audio.play(outcome === 'Home Run' ? 'bigHit' : 'hit');
        gs.balls = 0; gs.strikes = 0;
        gs.pendingBaseUpdate = () => this.updateBases(outcome, 'comp');

        if (outcome === 'Home Run') {
            const over = { x: FIELD.WALL.CF.x + Phaser.Math.Between(-160, 160), y: FIELD.WALL.CF.y - 30 };
            this.ballArc(FIELD.HOME, over, 1600, 150, () => {
                this.ball.setVisible(false);
                this.cameras.main.shake(200, 0.008);
                this.bigMessage('CPU HOME RUN', 1800);
                this.audio.speak('Home run.');
                this.audio.play('fail');
                // CPU trots the bases too — it's a real ballgame both ways
                this.animateAdvances('Home Run', () => this.finishPlay(outcome));
            });
        } else {
            this.audio.speak(`${outcome}.`);
            // Runners move while the throw-in plays out for real, same
            // relay choreography as when the player hits an extra-base hit
            let pending = 2;
            const done = () => { if (--pending === 0) this.finishPlay(outcome); };
            this.animateAdvances(outcome, done);
            this.chaseDownExtraBaseHit(outcome, done);
        }
    }

    // ─── NEW: interactive ground ball fielding ──────────────────────────────
    startGroundballPlay() {
        const gs = this.gs;
        // Which infielder gets it (weighted toward the middle infield)
        const fielderPos = weightedChoice({ SS: 26, '2B': 24, '3B': 20, '1B': 18, P: 12 });
        const fielder = this.fielders[fielderPos];
        const fhome = FIELD.FIELDER_HOMES[fielderPos];
        const spot = {
            x: Phaser.Math.Linear(FIELD.HOME.x, fhome.x, 0.70) + Phaser.Math.Between(-14, 14),
            y: Phaser.Math.Linear(FIELD.HOME.y, fhome.y, 0.70) + Phaser.Math.Between(-8, 8)
        };

        // On contact the batter and every runner take off (they hold partway
        // while you decide). Quick zoom punch on the pickup, then FULLY zoom
        // out before the menu — UI scales with camera zoom, so menus must
        // only ever appear at zoom 1.
        this.startContactRunners();
        this._ballBusy = (this._ballBusy || 0) + 1;
        this.ballArc(FIELD.HOME, spot, 540, 20, () => {
            this.jog(fielder, spot.x + 4, spot.y - 4, 280, 'Quad.easeOut', () => {
                this.audio.play('catch');
                this.releaseBall();
                this._zoomOnPoint(spot.x, spot.y, 1.4, 280);
                this.audio.speak(`Ground ball to ${FIELDER_NAMES[fielderPos]}!`);
                this.time.delayedCall(700, () => {
                    this._zoomOut(300);
                    this.time.delayedCall(320, () => this.showThrowMenu(fielderPos, spot));
                });
            });
        });
    }

    showThrowMenu(fielderPos, spot) {
        const options = getGroundballThrowOptions(this.gs.bases, this.gs.outs);
        // Highlight the base PLAYER covering each legal target (pitcher = end
        // the play) instead of a text list — you throw to a person, not a menu.
        // If the fielder who has the ball covers that bag HIMSELF (1B on a
        // grounder to first, middle infield at second, 3B at third), it's an
        // unassisted play: he races the runner to the bag.
        const chips = { first: '1ST', second: '2ND', third: '3RD', home: 'HOME', hold: 'PITCHER' };
        const UNASSISTED = { first: ['1B'], second: ['2B', 'SS'], third: ['3B'], home: ['C'] };
        const targets = options.map(o => {
            if (o.value === 'hold') return { ...o, chip: chips[o.value], fielder: this.fielders.P };
            const unassisted = (UNASSISTED[o.value] || []).includes(fielderPos);
            if (unassisted) {
                return {
                    ...o, unassisted: true, chip: chips[o.value],
                    label: `Take it to ${BASE_NAMES[o.value]}`,
                    hint: 'Race the runner to the bag yourself',
                    fielder: { x: BASE_COORDS[o.value].x, y: BASE_COORDS[o.value].y }
                };
            }
            return {
                ...o,
                chip: chips[o.value],
                fielder: this.fielders[this.coveringFielder(o.value, fielderPos)]
            };
        });
        this.setMenu(new BaseTargetSelector(this, {
            targets, audio: this.audio, title: 'Make the Throw!', zoomOnScan: true,
            onSelect: (opt) => {
                this.setMenu(null);
                this.resolveGroundThrow(fielderPos, spot, opt);
            }
        }));
    }

    resolveGroundThrow(fielderPos, spot, opt) {
        const gs = this.gs;

        if (opt.value === 'hold') {
            this.audio.speak('Infield single.');
            // Runners trot the rest of the way to their bases
            ['batter', 'first', 'second', 'third'].forEach(k => this.sendRunner(k, 1100));
            gs.pendingBaseUpdate = () => this.updateBases('Single', 'comp');
            this.time.delayedCall(1200, () => {
                this._zoomOut(360);
                this.finishPlay('Single');
            });
            return;
        }

        const targetBase = opt.value;
        const bag = BASE_COORDS[targetBase];
        const runnerForBase = { first: 'batter', second: 'first', third: 'second', home: 'third' };

        if (opt.unassisted) {
            // Unassisted: he takes it to the bag himself. Same odds model as a
            // force throw, small bonus for the short run, distance penalized.
            const fielder = this.fielders[fielderPos];
            const dist = Phaser.Math.Distance.Between(spot.x, spot.y, bag.x, bag.y);
            const runMs = Math.max(420, (dist / 0.22) * 1.5);
            const chance = Phaser.Math.Clamp(
                THROW_TUNING.BASE_CHANCE.force + 0.03 - Math.max(0, dist - 120) * 0.0008,
                THROW_TUNING.MIN, THROW_TUNING.MAX);
            const out = Math.random() < chance;
            const runnerKey = runnerForBase[targetBase];

            this.audio.speak(`Taking it to ${BASE_NAMES[targetBase]}!`);
            this._zoomOnPoint(bag.x, bag.y, 1.6, Math.max(300, runMs));
            this.tweens.killTweensOf(fielder);
            this.jog(fielder, bag.x + 7, bag.y + 7, runMs / 1.5);
            // The ball rides in his glove
            this._ballBusy = (this._ballBusy || 0) + 1;
            this.tweens.add({
                targets: this.ball, x: bag.x + 7, y: bag.y - 1, duration: runMs, ease: 'Linear',
                onComplete: () => { this.releaseBall(); }
            });
            if (runnerKey) this.sendRunner(runnerKey, out ? runMs + 280 : Math.max(180, runMs - 220), targetBase);

            this.time.delayedCall(runMs, () => {
                this.audio.play(out ? 'tag' : 'catch');
                if (out) {
                    this.cameras.main.shake(140, 0.006);
                    this.applyThrowOut(targetBase, fielderPos);
                } else {
                    this.bigMessage('SAFE!', 1300);
                    this.audio.speak(`Safe at ${BASE_NAMES[targetBase]}!`);
                    Object.keys(runnerForBase).forEach(b => {
                        if (runnerForBase[b] !== runnerKey) this.sendRunner(runnerForBase[b], 1000);
                    });
                    gs.pendingBaseUpdate = () => this.updateBases('Single', 'comp');
                    this.time.delayedCall(1300, () => {
                        this._zoomOut(380);
                        this.finishPlay('Single');
                    });
                }
            });
            return;
        }

        const result = computeThrowOutcome(fielderPos, spot, targetBase, opt.context);

        this.audio.speak(`Throw to ${BASE_NAMES[targetBase]}!`);
        // Camera rides the throw to the bag while the cover man and runner race in
        this._zoomOnPoint(bag.x, bag.y, 1.6, Math.max(280, result.throwTimeMs));

        this.animateThrowRace({
            fromXY: spot, throwerPos: fielderPos, targetBase,
            out: result.out, throwTimeMs: result.throwTimeMs,
            runnerKey: runnerForBase[targetBase]
        }, () => {
            if (result.out) {
                this.cameras.main.shake(140, 0.006);
                this.applyThrowOut(targetBase, fielderPos);
            } else {
                this.bigMessage('SAFE!', 1300);
                this.audio.speak(`Safe at ${BASE_NAMES[targetBase]}!`);
                // Everyone else completes their advance
                Object.keys(runnerForBase).forEach(b => {
                    if (runnerForBase[b] !== runnerForBase[targetBase]) this.sendRunner(runnerForBase[b], 1000);
                });
                gs.pendingBaseUpdate = () => this.updateBases('Single', 'comp');
                this.time.delayedCall(1300, () => {
                    this._zoomOut(380);
                    this.finishPlay('Single');
                });
            }
        });
    }

    // Successful throw: record the out, then handle the double-play relay
    applyThrowOut(targetBase, fielderPos) {
        const gs = this.gs;
        gs.outs++;

        if (targetBase === 'first') {
            this.bigMessage('OUT!', 1200);
            this.audio.speak('Out at first!');
            // Batter is out; the other runners finish their advance
            ['first', 'second', 'third'].forEach(k => this.sendRunner(k, 1000));
            gs.pendingBaseUpdate = () => {
                if (gs.bases.first) {
                    if (gs.bases.second && !gs.bases.third) gs.bases.third = gs.bases.second;
                    gs.bases.second = gs.bases.first;
                    gs.bases.first = null;
                }
            };
            this.time.delayedCall(1200, () => { this._zoomOut(380); this.finishPlay('Ground Out'); });
            return;
        }

        if (targetBase === 'second') {
            // Force at second succeeded. Try to turn two?
            gs.bases.first = null; // that runner is out at 2nd
            if (gs.outs < GAME_CONSTANTS.GAME_RULES.MAX_OUTS) {
                this.audio.speak('Out at second!');
                // The cover man who took the throw at 2nd turns the pivot
                const pivot = this.coveringFielder('second', fielderPos);
                const relay = computeThrowOutcome(pivot, FIELD.SECOND, 'first', 'dpRelay');
                this.time.delayedCall(240, () => {
                    this._zoomOnPoint(FIELD.FIRST.x, FIELD.FIRST.y, 1.7, Math.max(260, relay.throwTimeMs));
                    this.animateThrowRace({
                        fromXY: FIELD.SECOND, throwerPos: pivot, targetBase: 'first',
                        out: relay.out, throwTimeMs: relay.throwTimeMs, runnerKey: 'batter'
                    }, () => {
                        if (relay.out) {
                            gs.outs++;
                            this.cameras.main.shake(220, 0.009);
                            this.bigMessage('DOUBLE PLAY!', 1600);
                            this.audio.speak('Double play!');
                            this.audio.play('crowd_big');
                            ['second', 'third'].forEach(k => this.sendRunner(k, 1000));
                            gs.pendingBaseUpdate = () => {
                                if (gs.bases.second && !gs.bases.third) gs.bases.third = gs.bases.second;
                                gs.bases.second = null;
                            };
                            this.time.delayedCall(1600, () => { this._zoomOut(380); this.finishPlay('Double Play'); });
                        } else {
                            this.bigMessage('OUT AT 2ND', 1300);
                            this.audio.speak('Safe at first. One out.');
                            ['second', 'third'].forEach(k => this.sendRunner(k, 1000));
                            gs.pendingBaseUpdate = () => {
                                if (gs.bases.second && !gs.bases.third) gs.bases.third = gs.bases.second;
                                gs.bases.second = null;
                                gs.bases.first = 'comp'; // batter reaches
                            };
                            this.time.delayedCall(1300, () => { this._zoomOut(380); this.finishPlay('Ground Out'); });
                        }
                    });
                });
            } else {
                this.bigMessage('OUT!', 1300);
                this.audio.speak('Out at second!');
                this.time.delayedCall(1300, () => { this._zoomOut(380); this.finishPlay('Ground Out'); });
            }
            return;
        }

        if (targetBase === 'third') {
            this.bigMessage('OUT AT 3RD!', 1400);
            this.audio.speak('Out at third!');
            ['batter', 'first', 'third'].forEach(k => this.sendRunner(k, 1000));
            gs.pendingBaseUpdate = () => {
                gs.bases.second = null;              // lead runner out at 3rd
                if (gs.bases.first) { gs.bases.second = gs.bases.first; }
                gs.bases.first = 'comp';             // batter reaches
            };
            this.time.delayedCall(1400, () => { this._zoomOut(380); this.finishPlay('Ground Out'); });
            return;
        }

        if (targetBase === 'home') {
            this.bigMessage('OUT AT HOME!', 1500);
            this.audio.speak('Out at home!');
            this.audio.play('crowd');
            ['batter', 'first', 'second'].forEach(k => this.sendRunner(k, 1000));
            gs.pendingBaseUpdate = () => {
                gs.bases.third = null;               // runner out at home
                if (gs.bases.second && gs.bases.first) { gs.bases.third = gs.bases.second; gs.bases.second = null; }
                if (gs.bases.first) { gs.bases.second = gs.bases.first; }
                gs.bases.first = 'comp';             // batter reaches
            };
            this.time.delayedCall(1500, () => { this._zoomOut(380); this.finishPlay('Ground Out'); });
        }
    }

    // CPU single to the outfield — offer a cutdown throw when a lead runner
    // is trying for an extra base (the other half of the new mechanic)
    startCpuSingle() {
        const gs = this.gs;
        const outfielderPos = Phaser.Utils.Array.GetRandom(['LF', 'CF', 'RF']);
        const fielder = this.fielders[outfielderPos];
        const fhome = FIELD.FIELDER_HOMES[outfielderPos];
        const spot = { x: fhome.x + Phaser.Math.Between(-30, 30), y: fhome.y + Phaser.Math.Between(20, 60) };

        // Is a lead runner trying to take an extra base / score?
        let contested = null;
        if (gs.bases.third && gs.bases.second) contested = 'home';   // run trying to score
        else if (gs.bases.second && gs.bases.first) contested = 'third';

        this.startContactRunners();
        this._ballBusy = (this._ballBusy || 0) + 1;
        this.ballArc(FIELD.HOME, spot, 700, 14, () => {
            this.jog(fielder, spot.x + 4, spot.y - 4, 300, 'Quad.easeOut', () => {
                this.audio.play('catch');
                this.releaseBall();
                if (!contested) {
                    this.audio.speak('Single.');
                    ['batter', 'first', 'second', 'third'].forEach(k => this.sendRunner(k, 1100));
                    gs.pendingBaseUpdate = () => this.updateBases('Single', 'comp');
                    this.time.delayedCall(1200, () => this.finishPlay('Single'));
                    return;
                }
                this._zoomOnPoint(spot.x, spot.y, 1.35, 280);
                this.audio.speak(`Base hit! Runner going for ${BASE_NAMES[contested]}!`);
                this.time.delayedCall(700, () => {
                    this._zoomOut(300);
                    this.time.delayedCall(320, () => {
                        const options = getCutdownThrowOptions(contested);
                        const chips = { second: '2ND', third: '3RD', home: 'HOME', hold: 'PITCHER' };
                        const targets = options.map(o => ({
                            ...o,
                            chip: chips[o.value],
                            fielder: this.fielders[o.value === 'hold' ? 'P' : this.coveringFielder(o.value, outfielderPos)]
                        }));
                        this.setMenu(new BaseTargetSelector(this, {
                            targets, audio: this.audio, title: 'Cut Him Down?', zoomOnScan: true,
                            onSelect: (opt) => {
                                this.setMenu(null);
                                this.resolveCutdownThrow(outfielderPos, spot, contested, opt);
                            }
                        }));
                    });
                });
            });
        });
    }

    resolveCutdownThrow(outfielderPos, spot, contested, opt) {
        const gs = this.gs;
        const runnerKey = contested === 'home' ? 'third' : 'second';

        if (opt.value === 'hold') {
            this.audio.speak('The play stands.');
            ['batter', 'first', 'second', 'third'].forEach(k => this.sendRunner(k, 1100));
            gs.pendingBaseUpdate = () => this.updateBases('Single', 'comp');
            this.time.delayedCall(1100, () => { this._zoomOut(360); this.finishPlay('Single'); });
            return;
        }

        const target = BASE_COORDS[contested];
        const result = computeThrowOutcome(outfielderPos, spot, contested, 'cutdown');
        this.audio.speak('The throw...');
        this._zoomOnPoint(target.x, target.y, 1.7, Math.max(300, result.throwTimeMs));

        this.animateThrowRace({
            fromXY: spot, throwerPos: outfielderPos, targetBase: contested,
            out: result.out, throwTimeMs: result.throwTimeMs, runnerKey
        }, () => {
            // The other runners finish their advance either way
            ['batter', 'first', 'second', 'third'].forEach(k => {
                if (k !== runnerKey) this.sendRunner(k, 1000);
            });

            if (result.out) {
                gs.outs++;
                this.cameras.main.shake(220, 0.009);
                this.bigMessage(contested === 'home' ? 'OUT AT THE PLATE!' : 'CUT DOWN!', 1700);
                this.audio.speak(contested === 'home' ? 'Out at the plate!' : 'Out at third!');
                this.audio.play('crowd_big');
                gs.pendingBaseUpdate = () => {
                    if (contested === 'home') {
                        // Runner from 3rd erased; everyone else force-advances on the single
                        gs.bases.third = null;
                        if (gs.bases.second) { gs.bases.third = gs.bases.second; gs.bases.second = null; }
                        if (gs.bases.first) { gs.bases.second = gs.bases.first; }
                        gs.bases.first = 'comp';
                    } else {
                        // Runner from 2nd erased at 3rd
                        gs.bases.second = null;
                        if (gs.bases.first) { gs.bases.second = gs.bases.first; }
                        gs.bases.first = 'comp';
                    }
                };
                this.time.delayedCall(1700, () => { this._zoomOut(380); this.finishPlay('Ground Out'); });
            } else {
                this.bigMessage('SAFE!', 1400);
                this.audio.speak(contested === 'home' ? 'Safe. Run scores.' : 'Safe at third.');
                gs.pendingBaseUpdate = () => this.updateBases('Single', 'comp');
                this.time.delayedCall(1400, () => { this._zoomOut(380); this.finishPlay('Single'); });
            }
        });
    }

    // ─── Base advancement (ported verbatim from v1 updateBases) ─────────────
    updateBases(outcome, batter) {
        const gs = this.gs;
        const team = this.battingScoreKey();

        if (outcome === 'Single') {
            if (gs.bases.third && gs.bases.second) {
                gs.score[team]++;
                gs.bases.third = null;
            }
            if (gs.bases.second && gs.bases.first) {
                if (!gs.bases.third) gs.bases.third = gs.bases.second;
                gs.bases.second = null;
            }
            if (gs.bases.first) {
                if (!gs.bases.second) gs.bases.second = gs.bases.first;
            }
            gs.bases.first = batter;

        } else if (outcome === 'Walk') {
            if (gs.bases.first) {
                if (gs.bases.second) {
                    if (gs.bases.third) gs.score[team]++;
                    gs.bases.third = gs.bases.second;
                }
                gs.bases.second = gs.bases.first;
            }
            gs.bases.first = batter;

        } else if (outcome === 'Double') {
            if (gs.bases.third) gs.score[team]++;
            if (gs.bases.second) gs.score[team]++;
            gs.bases.third = gs.bases.first;
            gs.bases.first = null;
            gs.bases.second = batter;

        } else if (outcome === 'Triple') {
            ['first', 'second', 'third'].forEach(base => {
                if (gs.bases[base]) gs.score[team]++;
                gs.bases[base] = null;
            });
            gs.bases.third = batter;

        } else if (outcome === 'Home Run') {
            let runs = 1;
            ['first', 'second', 'third'].forEach(base => {
                if (gs.bases[base]) { runs++; gs.bases[base] = null; }
            });
            gs.score[team] += runs;
        }
    }

    // Every live ball ends its play thrown back to the pitcher — it reads as
    // the play being called dead, and guarantees the ball is never stranded
    // somewhere on the field. Dead-ball outcomes just put the ball away.
    returnBallToPitcher(outcome) {
        const deadBall = ['Home Run', 'Foul', 'Strike', 'Ball', 'Strike Out', 'Walk', 'Hit By Pitch'];
        if (!this.ball.visible) {
            this.returnFielders();
            return;
        }
        if (this._returnPending) return;
        this._returnPending = true;
        this._returnDead = deadBall.includes(outcome);
        // Wait until the ball has actually been GATHERED by a fielder (not
        // still flying / being chased). The fielders hold their spots until
        // the gatherer has released the throw — then everyone jogs home.
        let tries = 0;
        const attempt = () => {
            if (!this.ball.visible || this.gs.gameOver) {
                this._returnPending = false;
                this.returnFielders();
                return;
            }
            if ((this._ballBusy || 0) > 0 && ++tries < 40) {
                this.time.delayedCall(120, attempt);
                return;
            }
            this._returnPending = false;
            if (this._returnDead) {
                // Dead ball (caught pitch, etc.) — put it away once it has
                // settled in the glove
                this.ball.setVisible(false);
                this.returnFielders();
                return;
            }
            const from = { x: this.ball.x, y: this.ball.y };
            const dist = Phaser.Math.Distance.Between(from.x, from.y, FIELD.MOUND.x, FIELD.MOUND.y);
            if (dist < 30) {
                this.ball.setVisible(false);
                this.returnFielders();
                return;
            }
            this.audio.play('throw');
            // The throw is away — NOW the defense can jog back to position
            this.time.delayedCall(120, () => this.returnFielders());
            this.ballArc(from, FIELD.MOUND, Math.max(280, dist / 0.55), Math.min(60, dist * 0.12), () => {
                this.audio.play('catch');
                this.ball.setVisible(false);
            });
        };
        attempt();
    }

    // ─── End-of-play / inning / game (ported from v1 finishPlay etc.) ───────
    finishPlay(outcome) {
        const gs = this.gs;
        if (gs.pendingBaseUpdate) {
            gs.pendingBaseUpdate();
            gs.pendingBaseUpdate = null;
        }
        this.returnBallToPitcher(outcome);
        this.clearContactRunners();
        this.syncRunners();

        // Season games save after every play so they can be resumed
        if (this.isSeason && this.season.isActive() && !gs.gameOver) {
            this.season.saveGameState({
                inning: gs.inning, half: gs.half, outs: gs.outs,
                score: { ...gs.score }, bases: { ...gs.bases },
                balls: gs.balls, strikes: gs.strikes,
                playerIsAway: gs.playerIsAway,
                samePitchCount: gs.samePitchCount, lastPitchType: gs.lastPitchType
            }, this.opponentName);
        }

        // Walk-off: home team takes the lead in the bottom of the 9th or later
        if (gs.inning >= GAME_CONSTANTS.GAME_RULES.INNINGS_PER_GAME &&
            gs.half === 'bottom' &&
            gs.score.Blue > gs.score.Red) {
            this.time.delayedCall(1500, () => this.endGame());
            return;
        }

        this.time.delayedCall(2200, () => {
            if (gs.outs >= GAME_CONSTANTS.GAME_RULES.MAX_OUTS) {
                this.endHalfInning();
            } else {
                this.time.delayedCall(300, () => this.nextPlay());
            }
        });
    }

    endHalfInning() {
        const gs = this.gs;
        this.audio.speak('That retires the side.');
        gs.outs = 0;
        gs.bases = { first: null, second: null, third: null };
        gs.balls = 0;
        gs.strikes = 0;

        if (gs.half === 'top') {
            // Home team ahead after the visitors bat in the 9th+ → game over
            if (gs.inning >= GAME_CONSTANTS.GAME_RULES.INNINGS_PER_GAME &&
                gs.score.Blue > gs.score.Red) {
                this.endGame();
                return;
            }
            gs.half = 'bottom';
        } else {
            if (gs.inning >= GAME_CONSTANTS.GAME_RULES.INNINGS_PER_GAME) {
                if (gs.score.Red !== gs.score.Blue) {
                    this.endGame();
                    return;
                } else if (gs.inning === GAME_CONSTANTS.GAME_RULES.INNINGS_PER_GAME) {
                    this.audio.speak('The game is tied. We go to extra innings!');
                }
            }
            gs.inning++;
            gs.half = 'top';
        }

        gs.firstPitch = true;
        this.syncRunners();
        // The teams visibly trade places on the field
        this.swapSides(() => this.nextPlay());
    }

    endGame() {
        const gs = this.gs;
        gs.gameOver = true;
        const youKey = gs.playerIsAway ? 'Red' : 'Blue';
        const cpuKey = gs.playerIsAway ? 'Blue' : 'Red';
        const playerWon = gs.score[youKey] > gs.score[cpuKey];
        this.setMenu(null);
        this.stopChargeMonitor();

        // Season bookkeeping (record the result, advance stage/series)
        let seasonOutcome = null;
        if (this.isSeason && this.season.isActive()) {
            seasonOutcome = this.season.recordResult(gs.score[youKey], gs.score[cpuKey]);
            this.season.clearGameState();
        }

        this.time.delayedCall(600, () => {
            this.scene.start('ResultScene', {
                playerWon,
                you: gs.score[youKey],
                cpu: gs.score[cpuKey],
                isSeason: this.isSeason,
                playerColorName: this.playerColorName,
                opponentColorName: this.opponentName,
                seasonOutcome
            });
        });
    }

    // ─── Pause ───────────────────────────────────────────────────────────────
    showPauseMenu(resumeCb) {
        const vm = window.NarbeVoiceManager;
        const soundOn = this.audio.settings.soundEnabled;
        const musicOn = this.audio.settings.musicEnabled;
        const ttsOn = vm && vm.getSettings ? vm.getSettings().ttsEnabled !== false : true;
        const voiceName = (vm && vm.getCurrentVoice && vm.getVoiceDisplayName)
            ? vm.getVoiceDisplayName(vm.getCurrentVoice()) : 'Default';
        this.setMenu(new ScanList(this, {
            x: W / 2, y: H / 2, itemW: 340, itemH: 40, gap: 8,
            audio: this.audio, title: 'Paused',
            options: [
                { value: 'resume', label: 'Resume Game' },
                { value: 'music', label: `Music: ${musicOn ? 'ON' : 'OFF'}` },
                { value: 'sound', label: `Sound Effects: ${soundOn ? 'ON' : 'OFF'}` },
                { value: 'tts', label: `Text-to-Speech: ${ttsOn ? 'ON' : 'OFF'}` },
                { value: 'voice', label: `Voice: ${voiceName}` },
                { value: 'nexttrack', label: 'Next Track' },
                { value: 'quit', label: 'Quit to Title' }
            ],
            onSelect: (opt) => {
                if (opt.value === 'resume') { this.setMenu(null); resumeCb(); }
                else if (opt.value === 'sound') { this.audio.toggleSound(); this.showPauseMenu(resumeCb); }
                else if (opt.value === 'music') { this.audio.toggleMusic(); this.showPauseMenu(resumeCb); }
                else if (opt.value === 'tts') {
                    if (vm && typeof vm.toggleTTS === 'function') vm.toggleTTS();
                    this.showPauseMenu(resumeCb);
                }
                else if (opt.value === 'voice') {
                    if (vm && typeof vm.cycleVoice === 'function') {
                        vm.cycleVoice();
                        const nv = (vm.getCurrentVoice && vm.getVoiceDisplayName)
                            ? vm.getVoiceDisplayName(vm.getCurrentVoice()) : 'voice';
                        this.audio.speak(`Voice: ${nv}.`, true);
                    }
                    this.showPauseMenu(resumeCb);
                }
                else if (opt.value === 'nexttrack') { this.audio.nextTrack(); this.showPauseMenu(resumeCb); }
                else if (opt.value === 'quit') { this.setMenu(null); this.scene.start('TitleScene'); }
            }
        }));
    }
}

// ─── Result ──────────────────────────────────────────────────────────────────
// Post-game screen. In season mode the message reflects the football-style
// stage transition (series progress, made playoffs, champions, ...) and
// CONTINUE returns to the SeasonScene standings table.
class ResultScene extends Phaser.Scene {
    constructor() { super('ResultScene'); }

    create(data) {
        this.audio = audioSys();
        this.season = seasonMgr();
        const o = data.seasonOutcome;
        const isChamp = o === 'champions';

        this.add.rectangle(W / 2, H / 2, W, H, isChamp ? 0x2a230a : data.playerWon ? 0x123a18 : 0x2a1414);

        const headline = isChamp ? 'CHAMPIONS!' : data.playerWon ? 'YOU WON!' : 'YOU LOST';
        const head = this.add.text(W / 2, 130, headline, {
            fontSize: isChamp ? '80px' : '72px', fontFamily: 'Arial Black',
            color: isChamp ? '#ffd700' : data.playerWon ? '#ffe14d' : '#ff8888',
            stroke: '#000', strokeThickness: 10
        }).setOrigin(0.5);
        this.add.text(W / 2, 216, `Final Score:  YOU ${data.you}  —  CPU ${data.cpu}`, {
            fontSize: '28px', fontFamily: 'Arial Black', color: '#ffffff',
            stroke: '#000', strokeThickness: 5
        }).setOrigin(0.5);

        // Season transition messaging
        let sub = '', speech = data.playerWon
            ? `You won, ${data.you} to ${data.cpu}!`
            : `You lost, ${data.cpu} to ${data.you}.`;
        if (o) {
            const d = this.season.data || {};
            const s = this.season.isActive() ? this.season.seriesInfo() : null;
            if (o === 'champions') {
                sub = 'YOU WON THE CHAMPIONSHIP SERIES!';
                speech += ' You won the championship series! You are the champions! What a season!';
            } else if (o === 'perfect_to_championship') {
                sub = 'PERFECT SEASON! Straight to the Championship Series!';
                speech += ' A perfect sixteen and oh season! You go straight to the best of five championship series!';
            } else if (o === 'made_playoffs') {
                sub = 'You made the playoffs! Quarterfinal series is next.';
                speech += ' You made the playoffs! The best of three quarterfinal series is next.';
            } else if (o === 'advanced_semifinal') {
                sub = 'Series won! On to the Semifinals!';
                speech += ' You won the series! On to the best of three semifinal series!';
            } else if (o === 'advanced_championship') {
                sub = 'Series won! On to the CHAMPIONSHIP!';
                speech += ' You won the series! On to the best of five championship series!';
            } else if (o === 'series_next') {
                sub = s ? `${s.label} series: ${s.wins}-${s.losses}` : 'The series continues.';
                speech += s ? ` The series is now ${s.wins} to ${s.losses}.` : '';
            } else if (o === 'eliminated') {
                sub = 'You lost the series. Season over.';
                speech += ' You lost the series. Your season is over.';
            } else if (o === 'lost_championship') {
                sub = 'You lost the championship series.';
                speech += ' You lost the championship series. So close! Great season.';
            } else if (o === 'missed_playoffs') {
                sub = 'Season over — missed the playoffs.';
                speech += ` Your final record is ${d.wins} and ${d.losses}. Not enough wins for the playoffs.`;
            } else {
                sub = `Record: ${d.wins} - ${d.losses}`;
                speech += ` Your record is ${d.wins} and ${d.losses}.`;
            }
        } else {
            speech += data.playerWon ? ' Great game!' : ' Better luck next time.';
        }
        if (sub) {
            this.add.text(W / 2, 272, sub, {
                fontSize: '23px', fontFamily: 'Arial Black', color: '#ffe14d',
                stroke: '#000', strokeThickness: 4
            }).setOrigin(0.5);
        }
        this.audio.speak(speech);
        this.audio.play(isChamp ? 'homer' : data.playerWon ? 'crowd_big' : 'fail');

        if (isChamp) {
            this.tweens.add({ targets: head, scale: 1.12, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
            this.time.addEvent({ delay: 900, repeat: 8, callback: () => this.audio.play('crowd') });
        }

        const options = [];
        if (data.isSeason) {
            options.push({ value: 'season', label: 'CONTINUE', hint: 'back to the season screen' });
        } else {
            options.push({ value: 'again', label: 'PLAY AGAIN' });
        }
        options.push({ value: 'title', label: 'MAIN MENU' });

        this.menu = new ScanList(this, {
            x: W / 2, y: 430, itemW: 340,
            audio: this.audio, options,
            onSelect: (opt) => {
                this.menu.destroy(); this.menu = null;
                if (opt.value === 'season') this.scene.start('SeasonScene');
                else if (opt.value === 'again') {
                    this.scene.start('GameScene', {
                        isSeason: false,
                        playerColorName: data.playerColorName
                    });
                }
                else this.scene.start('TitleScene');
            }
        });
        this.scanInput = new ScanInput(this, {
            forward:  () => this.menu && this.menu.next(false),
            backward: () => this.menu && this.menu.prev(false),
            select:   () => this.menu && this.menu.select()
        });
    }
}

// ─── Shared helper (ported from v1 GameLogic.weightedChoice) ─────────────────
function weightedChoice(weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    for (const [outcome, weight] of Object.entries(weights)) {
        rand -= weight;
        if (rand <= 0) return outcome;
    }
    return Object.keys(weights)[0];
}
