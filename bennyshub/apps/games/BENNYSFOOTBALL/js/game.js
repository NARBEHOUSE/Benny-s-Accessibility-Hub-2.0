// ═══════════════════════════════════════════════════════════════════════════════
// BENNY'S FOOTBALL - Game Scene (interactive offense) + Result Scene
// You always play offense. Call a play from an accessible scan menu; runs/kicks
// auto-resolve, passes hand control to you to pick a receiver and time a throw
// (distance + power + coverage decide the catch, like the basketball shooter).
// Opponent possessions are quick narrated drives.
// ═══════════════════════════════════════════════════════════════════════════════

class GameScene extends Phaser.Scene {
    constructor() { super({ key: 'GameScene' }); }

    preload() { loadHelmets(this); loadPlayerSprites(this); }

    init(data) {
        this.isSeason = !!data.isSeason;
        this.playerColor = getColorByName(data.playerColorName);
        this.oppColor = getColorByName(data.opponentColorName);
        this.audio = audioSys();
        this._resuming = !!data.resume; // true when restoring a mid-game save
    }

    create() {
        this.fieldGfx = this.add.graphics().setDepth(0);
        this.markerGfx = this.add.graphics().setDepth(1);
        this.meterGfx = this.add.graphics().setDepth(15).setScrollFactor(0);
        this.ballGfx = this.add.graphics().setDepth(8);

        this.ball = { x: ydToX(25), y: FIELD.MID_Y, visible: false };
        this.power = 0; this.powerDir = 1; this.charging = false;

        this.drawField();
        this.createTeams();
        this.showPlayers(false);
        this.createHUD();

        this.gs = {
            quarter: 1,
            timeRemaining: QUARTER_SECONDS,
            score: { us: 0, them: 0 },
            ballPosition: 25,
            down: 1,
            yardsToGo: 10,
            firstDownTarget: 35,
            overtime: false
        };
        this.phase = 'idle';
        this.paused = false;
        this.isPAT = false;
        this._is2pt = false;
        this._lastClockSec = -1;

        this.setupKeys();
        this.updateHUD();

        if (this._resuming && this.isSeason) {
            // Restore saved mid-game state.
            const saved = seasonMgr().loadGameState();
            if (saved) {
                Object.assign(this.gs, saved.gs);
                this.onDefense = !!saved.onDefense;
                if (saved.opp) this.opp = saved.opp;
                this.updateHUD();
                const q = this.gs.overtime ? 'OT' : `Q${this.gs.quarter}`;
                const min = Math.floor(this.gs.timeRemaining / 60);
                const sec = Math.floor(this.gs.timeRemaining % 60);
                this.bigMessage('RESUMING GAME', 1800, () => {
                    this.audio.speak(`Resuming. ${this.playerColor.name} ${this.gs.score.us}, ${this.oppColor.name} ${this.gs.score.them}. ${q}, ${min}:${sec.toString().padStart(2,'0')}.`, true);
                    this.time.delayedCall(2200, () => {
                        if (this.onDefense && this.opp) {
                            this.repositionDefense(this.opp.yard);
                            this.showPlayers(true);
                            this.time.delayedCall(1000, () => this.showDefPlayCall());
                        } else {
                            this.repositionFormation(this.gs.ballPosition);
                            this.showPlayers(true);
                            this.time.delayedCall(1000, () => this.showPlayCall());
                        }
                    });
                });
                return;
            }
        }

        // Normal new game start.
        this.bigMessage(`${this.playerColor.name} vs ${this.oppColor.name}`, 1500, () => this.coinToss());
    }

    // ─── Coin toss & kickoff ───────────────────────────────────────────────────
    coinToss() {
        const result = Math.random() < 0.5 ? 'HEADS' : 'TAILS';
        const playerWins = Math.random() < 0.5;
        this.audio.play('whistle');
        this.bigMessage('COIN TOSS', 1100, () => {
            this.audio.speak('Coin toss.');
            this.flipCoin(result, () => {
                this.audio.speak(`The coin is ${result}.`);
                if (playerWins) {
                    this.audio.speak(`${this.playerColor.name} receives.`);
                    this.bigMessage(`${this.playerColor.name} RECEIVE`, 1300, () => this.kickoff('us'));
                } else {
                    this.audio.speak(`${this.oppColor.name} receives.`);
                    this.bigMessage(`${this.oppColor.name} RECEIVE`, 1300, () => this.kickoff('them'));
                }
            });
        });
    }

    // A big gold coin spins in the air and lands showing HEADS or TAILS.
    flipCoin(result, then) {
        this.phase = 'message';
        const cx = W / 2, cy = H / 2 - 10, R = 70;
        const depth = 45;
        const coin = this.add.container(cx, cy).setDepth(depth);
        // Two stacked faces; we show one or the other depending on the flip side.
        const heads = this.add.circle(0, 0, R, 0xffd54a).setStrokeStyle(6, 0xb8860b);
        const headsInner = this.add.circle(0, 0, R - 14, 0xffe9a6).setStrokeStyle(2, 0xc9981a);
        const headsLbl = this.add.text(0, 0, 'H', { fontSize: '52px', fontFamily: 'Arial Black', color: '#7a5200' }).setOrigin(0.5);
        const tails = this.add.circle(0, 0, R, 0xe0a020).setStrokeStyle(6, 0x8a6510);
        const tailsInner = this.add.circle(0, 0, R - 14, 0xf2c869).setStrokeStyle(2, 0xa9770f);
        const tailsLbl = this.add.text(0, 0, 'T', { fontSize: '52px', fontFamily: 'Arial Black', color: '#5e3d00' }).setOrigin(0.5);
        coin.add([heads, headsInner, headsLbl, tails, tailsInner, tailsLbl]);
        const shadow = this.add.ellipse(cx, cy + R + 34, R * 1.7, 24, 0x000000, 0.3).setDepth(depth - 1);

        // We flip the coin end-over-end by driving a "spin" angle; scaleY = cos(spin)
        // squashes the disc to an edge as it turns, and the sign of cos picks which
        // face is shown — exactly how a real coin reads as it tumbles.
        const spins = 7;                                  // full half-turns in the air
        // Make sure the coin settles on the correct face. HEADS shows when cos>0.
        const wantHeadsUp = result === 'HEADS';
        // Choose a final spin angle whose cos sign matches the desired face.
        let finalAngle = Math.PI * spins;
        if ((Math.cos(finalAngle) > 0) !== wantHeadsUp) finalAngle += Math.PI;

        const state = { spin: 0, h: 0 };
        let lastSide = null;
        this.audio.play('select');
        this.tweens.add({
            targets: state, spin: finalAngle,
            duration: 1900, ease: 'Cubic.easeOut',
            onUpdate: () => {
                const c = Math.cos(state.spin);
                coin.scaleY = Math.max(0.06, Math.abs(c));   // squash to an edge each half-turn
                const headsUp = c >= 0;
                heads.visible = headsInner.visible = headsLbl.visible = headsUp;
                tails.visible = tailsInner.visible = tailsLbl.visible = !headsUp;
                // Tick sound each time it flips edge-on.
                const side = headsUp ? 1 : 0;
                if (side !== lastSide) { lastSide = side; this.audio.play('scan'); }
                // Parabolic toss height.
                const arc = Math.sin(Phaser.Math.Clamp(state.spin / finalAngle, 0, 1) * Math.PI);
                coin.y = cy - arc * 150;
            },
            onComplete: () => { coin.scaleY = 1; this.settleCoin(coin, shadow, then); }
        });
    }

    settleCoin(coin, shadow, then) {
        this.audio.play('select');
        this.tweens.add({
            targets: coin, scaleX: 1.15, scaleY: 1.15, duration: 140, yoyo: true,
            onComplete: () => {
                this.time.delayedCall(750, () => {
                    this.tweens.add({
                        targets: [coin, shadow], alpha: 0, duration: 280,
                        onComplete: () => { coin.destroy(); shadow.destroy(); if (then) then(); }
                    });
                });
            }
        });
    }

    // Kick off: the kicking team lines up across the field, the receiving team
    // sets up a return wall with a deep returner. The ball is kicked in a high
    // arc; the returner fields it and runs it out before the drive begins.
    kickoff(receiving) {
        this.phase = 'anim';
        // Always reset the camera before the kickoff animation so no prior zoom leaks in.
        this._zoomOut(350);
        this.showPlayers(true);
        const us = receiving === 'us';
        // returnTeam fields & runs the ball; coverTeam chases it down.
        const returnTeam = us ? this.offense : this.defense;
        const coverTeam = us ? this.defense : this.offense;
        const kickFromYard = us ? 68 : 32;   // where the ball is launched from
        const catchYard = us ? 12 : 88;      // where the returner fields it
        const returnToYard = us ? 25 : 75;   // where the return is tackled
        const fH = FIELD.HEIGHT;

        // Direction the kick travels along the yard markers.
        const dir = us ? -1 : 1;

        // One cover-team player is the kicker; the rest spread across the field.
        const kicker = coverTeam[0];
        const coverLineYard = us ? 54 : 46;
        coverTeam.slice(1).forEach((p, i) => {
            this.stopBob(p);
            p.setPosition(ydToX(coverLineYard) + (i % 2 ? 16 : -16), FIELD.TOP + 36 + i * (fH - 72) / 4);
            p.setScale(1);
        });
        // Kicker starts a few yards behind the ball, lined up to run into it.
        this.stopBob(kicker);
        kicker.setPosition(ydToX(kickFromYard - dir * 7), FIELD.MID_Y + 4);
        kicker.setScale(1);

        // Return team: a deep returner with a wall of blockers in front of him.
        const returner = returnTeam[0];
        this.stopBob(returner);
        returner.setPosition(ydToX(catchYard), FIELD.MID_Y);
        returner.setScale(1);
        const wallYard = us ? 24 : 76;
        returnTeam.slice(1).forEach((p, i) => {
            this.stopBob(p);
            p.setPosition(ydToX(wallYard), FIELD.TOP + 64 + i * (fH - 128) / 4);
            p.setScale(1);
        });

        const fromX = ydToX(kickFromYard), toX = ydToX(catchYard);
        this.ball.visible = true; this.ball.carrier = null;
        this.ball.x = fromX; this.ball.y = FIELD.MID_Y;

        // The kicker jogs up to the ball, boots it, then the ball arcs downfield.
        this.jog(kicker, fromX, FIELD.MID_Y, 700, 'Sine.easeIn');
        this.time.delayedCall(700, () => {
            this.audio.play('kick');
            this.audio.speak('Kickoff!');
            // Brief pause lets 'Kickoff!' finish before the return commentary.
            // A little follow-through past the ball.
            this.jog(kicker, ydToX(kickFromYard + dir * 4), FIELD.MID_Y - 6, 400, 'Sine.easeOut');
            // The whole coverage unit sprints downfield while the ball is in the air.
            coverTeam.slice(1).forEach((p, i) => {
                this.jog(p, ydToX(coverLineYard + dir * 14) + (i % 2 ? 14 : -14),
                    p.y + (Math.random() - 0.5) * 30, 1250 + Math.random() * 200, 'Sine.easeIn');
            });
            // The receiving team doesn't stand and watch: blockers slide back toward
            // the returner to set up the return wall while the ball is still airborne.
            const wallSetYard = us ? catchYard + 8 : catchYard - 8;
            returnTeam.slice(1).forEach((p, i) => {
                this.jog(p, ydToX(wallSetYard) + (i % 2 ? 18 : -18),
                    FIELD.TOP + 70 + i * (fH - 140) / 4 + (Math.random() - 0.5) * 24,
                    1100 + Math.random() * 220, 'Sine.easeInOut');
            });
            // The returner shuffles under the ball instead of freezing in place.
            this.jog(returner, toX + (Math.random() * 20 - 10), FIELD.MID_Y, 1150, 'Sine.easeInOut');
            const flight = { x: fromX };
            this.tweens.add({
                targets: flight, x: toX, duration: 1300, ease: 'Quad.easeOut',
                onUpdate: (tw) => { this.ball.x = flight.x; this.ball.y = FIELD.MID_Y - Math.sin(tw.progress * Math.PI) * 150; },
                onComplete: () => {
                    this.audio.play('catch');
                    this.ball.carrier = returner;
                    this.kickReturn(receiving, returner, coverTeam, catchYard, returnToYard);
                }
            });
        });
    }

    // The returner weaves upfield to the drive's starting spot while the
    // coverage team converges for the tackle.
    kickReturn(receiving, returner, coverTeam, fromYard, toYard) {
        const us = receiving === 'us';
        // ── Kickoff return miracle: 1 % base (2.2 % if returner's team is trailing 14+).
        if (Math.random() < this._miracleChance(us)) {
            this.ball.carrier = returner; this.ball.visible = true;
            const tdEndX = us ? FIELD.GOAL_R + 52 : FIELD.GOAL_L - 52;
            this._miracleRun(
                returner, coverTeam,
                returner.x, returner.y, tdEndX, us,
                () => {
                    if (us) {
                        this.gs.score.us += 6; this.updateHUD();
                        this._doTDCelebration(returner);
                        this.bigMessage('MIRACLE RETURN! TOUCHDOWN!', 2000,
                            () => this.showAfterTouchdownMenu());
                    } else {
                        this.gs.score.them += 6; this.updateHUD();
                        this.bigMessage(`MIRACLE RETURN! ${this.oppColor.name} TOUCHDOWN!`, 2000,
                            () => this.oppAfterTouchdown());
                    }
                }
            );
            return;
        }
        const returnTeam = us ? this.offense : this.defense;
        const lane = (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 50);
        const midX = ydToX((fromYard + toYard) / 2), endX = ydToX(toYard), midY = FIELD.MID_Y;
        const dur = 950;
        // Return blockers lead the way the whole return — they escort to midfield,
        // then peel toward the convergence point, so they never stop moving.
        returnTeam.forEach((p, i) => {
            if (p === returner) return;
            const off = (i % 2 ? 1 : -1) * (24 + Math.random() * 36);
            this.jog(p, midX + (Math.random() * 30 - 15), midY + lane * 0.6 + off, dur * 0.5, 'Sine.easeOut');
            this.time.delayedCall(dur * 0.5, () => {
                this.jog(p, endX + (Math.random() * 50 - 25), midY + lane * 0.3 + off * 0.7, dur * 0.5, 'Sine.easeIn');
            });
        });
        this.audio.speak('Return!', true);
        this.jog(returner, midX, midY + lane, dur * 0.5, 'Sine.easeOut');
        this.time.delayedCall(dur * 0.5, () => this.jog(returner, endX, midY + lane * 0.3, dur * 0.5, 'Sine.easeIn'));
        coverTeam.forEach(p => this.jog(p, endX + (Math.random() * 26 - 13), midY + lane * 0.4 + (Math.random() - 0.5) * 44, dur * 0.95 + Math.random() * 160));
        this.time.delayedCall(dur + 200, () => {
            this.stopBob(returner);
            this.audio.play('tackle');
            this.tackleShake(returner);
            this.ball.carrier = null;
            if (us) this.startUsDrive(toYard, true);
            else this.defenseDrive(toYard, true);
        });
    }


    // ─── Input ───────────────────────────────────────────────────────────────
    // One shared controller, identical to every other Benny game:
    //   SPACE tap = scan forward · HOLD SPACE = scan back (scan-manager speed)
    //   ENTER tap = select
    // Passing / kicking charges use ENTER hold→release via the charge handlers.
    // During FG aim: SPACE tap reverses sweep direction; ENTER hold→release kicks.
    setupKeys() {
        this.scanInput = new ScanInput(this, {
            forward: () => this.scanForward(),
            backward: () => this.scanBackward(),
            select: () => this.commit(),
            escape: () => this.togglePause(),
            // Keyboard Enter: also active during receiver selection so hold-Enter
            // selects the current receiver and immediately starts the throw charge.
            isChargePhase: () => this.phase === 'receiver' || this.phase === 'charge' || this.phase === 'fgcharge' || this.phase === 'fgaim',
            // Pointer/touch: excludes receiver phase so pan gestures don't accidentally
            // start a throw. Touch receiver selection stays as-is (tap-to-cycle).
            isPointerChargePhase: () => this.phase === 'charge' || this.phase === 'fgcharge' || this.phase === 'fgaim',
            chargeStart: () => this.chargeStart(),
            chargeRelease: () => this.chargeRelease(),
            // During a field-goal aim: hold SPACE to sweep, each new press
            // flips direction (matching P3GL). Release stops the sweep.
            isAimPhase: () => this.phase === 'fgaim',
            aimStart: () => { this.aimDir *= -1; this._aimHeld = true; },
            aimStop: () => { this._aimHeld = false; }
        });
    }

    // SPACE tap → move the active scan list / receiver pick forward.
    scanForward() {
        if (this.paused) { if (this.pauseMenu) this.pauseMenu.next(false); return; }
        if ((this.phase === 'playcall' || this.phase === 'defcall') && this.playMenu) this.playMenu.next(false);
        else if (this.phase === 'receiver') this.receiverNext();
    }

    // HOLD SPACE → move backward (repeats at the scan-manager interval).
    scanBackward() {
        if (this.paused) { if (this.pauseMenu) this.pauseMenu.prev(false); return; }
        if ((this.phase === 'playcall' || this.phase === 'defcall') && this.playMenu) this.playMenu.prev(false);
        else if (this.phase === 'receiver') this.receiverPrev();
    }

    // ENTER tap → confirm whatever is focused for the current phase.
    commit() {
        if (this.paused) { if (this.pauseMenu) this.pauseMenu.select(); return; }
        switch (this.phase) {
            case 'playcall': if (this.playMenu) this.playMenu.select(); break;
            case 'defcall': if (this.playMenu) this.playMenu.select(); break;
            // receiver phase: Enter is now hold-to-throw (handled via chargeStart/chargeRelease)
            case 'message': if (this.skipMessage) this.skipMessage(); break;
        }
    }

    // ENTER hold begins a charge; ENTER release fires it.
    // For a field goal we mirror the basketball shooter: a single ENTER hold
    // locks the aim AND starts the power charge in one motion; release kicks.
    // During receiver selection: hold ENTER locks in the highlighted receiver
    // and immediately starts the throw charge — one less step.
    chargeStart() {
        if (this.phase === 'receiver') {
            this.selectReceiver();           // sets target, phase → 'charge' (or 'anim' if easy-throw)
            if (this.phase === 'charge') this.startCharge();
            return;
        }
        if (this.phase === 'charge') this.startCharge();
        else if (this.phase === 'fgaim') {
            // If this chargeStart was triggered by a pointer/touch tap, aim where
            // the finger landed before locking.  ScanInput's pointerdown handler
            // fires before _fgClickHandler, so aimValue must be set here — by the
            // time _fgClickHandler runs the phase has already changed to 'fgcharge'.
            const ptr = this.input.activePointer;
            if (ptr && ptr.isDown) {
                const spread = 150;
                this.aimValue = Phaser.Math.Clamp((ptr.y - FIELD.MID_Y) / spread, -1, 1);
                this.aimDir = 0;
            }
            this.lockAim(); this.startKickCharge();
        }
        else if (this.phase === 'fgcharge') this.startKickCharge();
    }
    chargeRelease() {
        if (this.phase === 'charge') this.releaseCharge();
        else if (this.phase === 'fgcharge') this.releaseKickCharge();
    }

    // ─── Scan-manager helpers ──────────────────────────────────────────────────
    scanAutoOn() {
        return !!(window.NarbeScanManager && window.NarbeScanManager.getSettings
            && window.NarbeScanManager.getSettings().autoScan);
    }

    scanInterval() {
        return (window.NarbeScanManager && window.NarbeScanManager.getScanInterval)
            ? window.NarbeScanManager.getScanInterval() : 2200;
    }

    // ─── Field rendering (adapted from the original) ───────────────────────────
    drawField() {
        const g = this.fieldGfx, F = FIELD;
        g.fillStyle(0x0a1408); g.fillRect(0, 0, W, H);
        const stripes = 10, stripeW = F.PLAY_W / stripes;
        for (let i = 0; i < stripes; i++) {
            g.fillStyle(i % 2 === 0 ? 0x2e7d32 : 0x276b2c);
            g.fillRect(F.GOAL_L + i * stripeW, F.TOP, stripeW, F.HEIGHT);
        }
        // End zones: left = our defended goal (player colour), right = scoring (opp colour)
        g.fillStyle(this.playerColor.hex, 0.9); g.fillRect(F.LEFT, F.TOP, F.END_ZONE, F.HEIGHT);
        g.fillStyle(this.oppColor.hex, 0.9); g.fillRect(F.GOAL_R, F.TOP, F.END_ZONE, F.HEIGHT);

        g.lineStyle(1, 0xffffff, 0.28);
        for (let yd = 5; yd < 100; yd += 5) g.lineBetween(ydToX(yd), F.TOP, ydToX(yd), F.BOTTOM);
        g.lineStyle(2, 0xffffff, 0.5);
        for (let yd = 10; yd < 100; yd += 10) g.lineBetween(ydToX(yd), F.TOP, ydToX(yd), F.BOTTOM);
        g.lineStyle(2, 0xffffff, 0.4);
        const h1 = F.TOP + F.HEIGHT * 0.34, h2 = F.TOP + F.HEIGHT * 0.66;
        for (let yd = 1; yd < 100; yd++) {
            const x = ydToX(yd);
            g.lineBetween(x, h1 - 5, x, h1 + 5);
            g.lineBetween(x, h2 - 5, x, h2 + 5);
        }
        g.lineStyle(3, 0xffffff, 0.95);
        g.lineBetween(F.GOAL_L, F.TOP, F.GOAL_L, F.BOTTOM);
        g.lineBetween(F.GOAL_R, F.TOP, F.GOAL_R, F.BOTTOM);
        g.strokeRect(F.LEFT, F.TOP, F.WIDTH, F.HEIGHT);

        // Goalposts at the back of each end zone, so you can see where to kick on
        // both sides of the field.
        [{ x: F.LEFT + 4, dir: 1 }, { x: F.RIGHT - 4, dir: -1 }].forEach(p => {
            g.lineStyle(5, 0xffe14d, 0.95);
            g.lineBetween(p.x, F.MID_Y - 48, p.x, F.MID_Y + 48);          // crossbar plane
            g.lineBetween(p.x, F.MID_Y - 48, p.x + p.dir * 18, F.MID_Y - 48); // upper upright
            g.lineBetween(p.x, F.MID_Y + 48, p.x + p.dir * 18, F.MID_Y + 48); // lower upright
            g.fillStyle(0xffe14d, 1);
            g.fillCircle(p.x, F.MID_Y - 48, 3.5);
            g.fillCircle(p.x, F.MID_Y + 48, 3.5);
        });

        const yardNums = [10, 20, 30, 40, 50, 40, 30, 20, 10];
        yardNums.forEach((num, idx) => {
            const x = ydToX((idx + 1) * 10);
            this.add.text(x, F.TOP + 16, String(num), { fontSize: '12px', fontFamily: 'Arial Black', color: '#ffffff' }).setOrigin(0.5).setDepth(0.5).setAlpha(0.5);
            this.add.text(x, F.BOTTOM - 16, String(num), { fontSize: '12px', fontFamily: 'Arial Black', color: '#ffffff' }).setOrigin(0.5).setDepth(0.5).setAlpha(0.5);
        });
        this.add.text(F.LEFT + F.END_ZONE / 2, F.MID_Y, this.playerColor.name, { fontSize: '15px', fontFamily: 'Arial Black', color: '#ffffff' }).setOrigin(0.5).setAngle(-90).setDepth(0.5).setAlpha(0.85);
        this.add.text(F.GOAL_R + F.END_ZONE / 2, F.MID_Y, this.oppColor.name, { fontSize: '15px', fontFamily: 'Arial Black', color: '#ffffff' }).setOrigin(0.5).setAngle(90).setDepth(0.5).setAlpha(0.85);
    }

    makePlayer(colorObj, label) {
        const c = this.add.container(0, 0).setDepth(3);
        // Larger, darker shadow so every team color pops off the green field.
        const shadow = this.add.ellipse(3, 7, 34, 11, 0x000000, 0.52);

        if (playerSpritesReady(this)) {
            const P = PLAYER_SPRITE, h = P.displayH;
            // Put the measured foot line at footOffsetY so the body straddles
            // the origin like the disc did and lands on the existing shadow.
            const sy = P.footOffsetY - (P.footFrac - 0.5) * h;
            const jersey = this.add.sprite(0, sy, P.jerseyKey, 0)
                .setDisplaySize(h, h).setTint(colorObj.hex);
            const base = this.add.sprite(0, sy, P.baseKey, 0).setDisplaySize(h, h);
            // The label rides above the helmet rather than across the chest,
            // where the shoulder pads would swallow it.
            const num = this.add.text(0, sy - h * 0.46, label,
                { fontSize: '9px', fontFamily: 'Arial Black', color: '#ffffff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
            // Index 3 stays the label — _setPlayerLabel() addresses it by position.
            c.add([shadow, jersey, base, num]);
            c._spr = { base, jersey, dir: 0, phase: 0, lastX: null, lastY: null };
            return c;
        }

        const body = this.add.circle(0, 0, 13, colorObj.hex).setStrokeStyle(2.5, 0x000000);
        const shine = this.add.circle(-4, -4, 4, colorObj.light, 0.6);
        const num = this.add.text(0, 0, label, { fontSize: '9px', fontFamily: 'Arial Black', color: '#ffffff', stroke: '#000', strokeThickness: 2 }).setOrigin(0.5);
        c.add([shadow, body, shine, num]);
        return c;
    }

    // Drive each sprite's facing and run-cycle frame from how the container
    // actually moved this tick. Everything in this game moves players with
    // tweens, so velocity is not stored anywhere — differencing position is
    // what keeps the legs in step with whatever tween is running, including
    // kickoff returns and tackle rushes that never go through jog().
    _updatePlayerSprites(delta) {
        if (!this.offense || !this.defense) return;
        const P = PLAYER_SPRITE, RUN = P.anims.run;
        const dt = Math.max(delta, 1) / 1000;
        [...this.offense, ...this.defense].forEach(p => {
            const s = p && p._spr;
            if (!s) return;
            if (s.lastX === null) { s.lastX = p.x; s.lastY = p.y; }
            const dx = p.x - s.lastX, dy = p.y - s.lastY;
            s.lastX = p.x; s.lastY = p.y;

            let row, clip = null, frame = 0;
            if (s.action) {
                // A one-shot owns the sprite until it finishes. Facing was
                // frozen when it started, so a throw does not pirouette if the
                // QB drifts a pixel mid-animation.
                const a = s.action;
                a.t += dt * a.clip.fps;
                const last = a.clip.frames - 1;
                if (a.t >= a.clip.frames) {
                    // A held clip (the tackle) stays on its last frame until
                    // the next play sets up. Both formation paths release it
                    // through _standDownedPlayers; releasing it here on
                    // movement instead would stand players up early, which is
                    // the opposite of staying down.
                    if (a.clip.hold) a.t = last;
                    else s.action = null;
                }
                if (s.action) {
                    clip = a.clip;
                    frame = Math.min(Math.floor(a.t), last);
                    row = clip.row + frame;
                }
            }

            if (row === undefined) {
                const speed = Math.sqrt(dx * dx + dy * dy) / dt;
                if (speed > P.runSpeed) {
                    s.dir = spriteDirIndex(Math.atan2(dy, dx));
                    // Advance the cycle by distance travelled, not wall time.
                    s.phase += (speed * dt) / P.stridePx * RUN.frames;
                } else {
                    s.phase = 0;   // planted: hold the contact frame
                }
                // The carrier runs from the row set that has the ball modelled
                // into their hand; everyone else from the empty-handed one.
                clip = (this.ball && this.ball.carrier === p) ? P.anims.run_carry : RUN;
                frame = ((Math.floor(s.phase) % clip.frames) + clip.frames) % clip.frames;
                row = clip.row + frame;
            }

            // Does the art on screen already contain the ball? The drawn one is
            // suppressed while it does.
            s.showsBall = !!(clip && clip.ballFrames && clip.ballFrames.indexOf(frame) !== -1);

            const idx = row * P.dirs + s.dir;
            s.base.setFrame(idx);
            s.jersey.setFrame(idx);
        });
    }

    // Play a one-shot action clip on a player. Safe to call for disc players
    // and for any name the bake did not produce — both are simply ignored, so
    // callers never have to check which rendering mode is active.
    //
    // `face` is the point the action is directed at — the receiver for a throw,
    // the passer for a catch. Without it the clip plays in whatever direction
    // the player last MOVED, and a quarterback stands still before the snap, so
    // a throw would fire off toward the bottom of the screen with the arm
    // swinging straight at the camera where none of it reads.
    playPlayerAction(p, name, face) {
        const s = p && p._spr;
        if (!s) return;
        const clip = PLAYER_SPRITE.anims[name];
        if (!clip || clip.loop) return;
        if (face && (face.x !== p.x || face.y !== p.y)) {
            s.dir = spriteDirIndex(Math.atan2(face.y - p.y, face.x - p.x));
        }
        // Facing is then frozen for the duration; actions are performed, not
        // steered.
        s.action = { clip, t: 0 };
    }

    // Update the position label shown on a player sprite (list[3] is the text child).
    _setPlayerLabel(p, label) { if (p && p.list && p.list[3]) p.list[3].setText(label); }

    createTeams() {
        this.offense = OFFENSE_SETUP.map(s => {
            const p = this.makePlayer(this.playerColor, s.label);
            p.role = s.role;
            return p;
        });
        const defLabels = ['DL', 'DL', 'LB', 'CB', 'CB', 'S'];
        this.defense = defLabels.map(l => this.makePlayer(this.oppColor, l));
        this.repositionFormation(this.gs ? this.gs.ballPosition : 25);
    }

    // Compute formation target positions for a given line of scrimmage.
    formationPositions(losYard) {
        const losX = ydToX(losYard), midY = FIELD.MID_Y;
        const off = [
            { x: losX - 38, y: midY },        // QB
            { x: losX - 52, y: midY + 20 },   // RB
            { x: losX - 8, y: midY - 130 },   // WR
            { x: losX - 8, y: midY + 130 },   // WR
            { x: losX - 8, y: midY - 55 },    // TE
            { x: losX - 12, y: midY }         // OL
        ];
        const def = [
            { x: losX + 14, y: midY - 12 },
            { x: losX + 14, y: midY + 12 },
            { x: losX + 48, y: midY },
            { x: losX + 26, y: midY - 120 },
            { x: losX + 26, y: midY + 120 },
            { x: losX + 95, y: midY }
        ];
        return { off, def };
    }

    // Where the ball sits when this player has it, and where a throw leaves
    // from. Discs keep the original offset; sprites need chest height.
    _carryPoint(p) {
        const off = (p && p._spr) ? PLAYER_SPRITE.ballOffset : { x: 12, y: -2 };
        return { x: p.x + off.x, y: p.y + off.y };
    }

    // True while some player's sprite already has the football modelled into
    // it. There is only ever one ball, so the drawn one stands down.
    _ballIsModelled() {
        return [...(this.offense || []), ...(this.defense || [])]
            .some(p => p && p._spr && p._spr.showsBall);
    }

    // How long after a throw starts the ball actually leaves the hand. The
    // release is baked into the art, so the flight has to wait for it instead
    // of setting off during the wind-up.
    _throwReleaseDelay(p) {
        const clip = PLAYER_SPRITE.anims.throw;
        if (!p || !p._spr || !clip || !clip.ballFrames.length) return 0;
        return clip.ballFrames.length / clip.fps * 1000;
    }

    // Hard reset of every action clip, for an instant snap into formation at a
    // drive start. The gradual path is _standDownedPlayers(); this one exists
    // because a player teleported to a new line of scrimmage must not still be
    // lying in the pose they fell in somewhere else.
    _clearPlayerActions() {
        [...(this.offense || []), ...(this.defense || [])].forEach(p => {
            if (p && p._spr) p._spr.action = null;
        });
    }

    // True while a player is playing or holding a knockdown. They stay where
    // they fell for the whole transition instead of being jogged back to the
    // line of scrimmage still face-down, and are stood up as the next play
    // sets up.
    _isDown(p) {
        const a = p && p._spr && p._spr.action;
        return !!(a && a.clip.hold);
    }

    // Stand up anyone still on the ground and send them to their spot. Called
    // as a formation tween lands, which is the moment the next play sets up.
    // Returns true if anyone had to get up, so the caller can hold the play
    // menu back until they are actually in place.
    _standDownedPlayers(offPos, defPos, duration) {
        let any = false;
        const send = (list, pos) => list.forEach((p, i) => {
            if (!this._isDown(p)) return;
            any = true;
            p._spr.action = null;
            this.jog(p, pos[i].x, pos[i].y, duration);
        });
        send(this.offense, offPos);
        send(this.defense, defPos);
        return any;
    }

    // Snap players to formation instantly (drive start / kickoff).
    repositionFormation(losYard) {
        const { off, def } = this.formationPositions(losYard);
        this._clearPlayerActions();
        // Kill any leftover animation tweens so kickoff/play tweens can't override us.
        [...this.offense, ...this.defense].forEach(p => this.tweens.killTweensOf(p));
        this.offense.forEach((p, i) => { this.stopBob(p); p.setPosition(off[i].x, off[i].y); p.setScale(1); p.homeX = off[i].x; p.homeY = off[i].y; });
        this.defense.forEach((p, i) => { this.stopBob(p); p.setPosition(def[i].x, def[i].y); p.setScale(1); });
        // Restore correct position labels for offensive phase.
        ['QB','RB','WR','WR','TE','OL'].forEach((l, i) => this._setPlayerLabel(this.offense[i], l));
        ['DL','DL','LB','CB','CB','S'].forEach((l, i) => this._setPlayerLabel(this.defense[i], l));
        // Ball rests in the QB's hands at the line of scrimmage.
        this.ball.carrier = this.offense[0];
    }

    // Smoothly jog all players back into formation, then run the callback.
    tweenFormation(losYard, duration, cb) {
        const { off, def } = this.formationPositions(losYard);
        // Deliberately no _clearPlayerActions() here: downed players are held
        // in place and released by _standDownedPlayers as this tween lands.
        // Kill any leftover animation tweens so kickoff/play tweens can't override the formation.
        [...this.offense, ...this.defense].forEach(p => { this.tweens.killTweensOf(p); this.stopBob(p); });
        // Anyone knocked down stays down where they fell while the rest jog
        // back; they get up as this tween lands.
        this.offense.forEach((p, i) => { p.homeX = off[i].x; p.homeY = off[i].y; if (!this._isDown(p)) this.jog(p, off[i].x, off[i].y, duration, 'Sine.easeInOut'); });
        this.defense.forEach((p, i) => { if (!this._isDown(p)) this.jog(p, def[i].x, def[i].y, duration, 'Sine.easeInOut'); });
        // Restore correct position labels for offensive phase.
        ['QB','RB','WR','WR','TE','OL'].forEach((l, i) => this._setPlayerLabel(this.offense[i], l));
        ['DL','DL','LB','CB','CB','S'].forEach((l, i) => this._setPlayerLabel(this.defense[i], l));
        // Ball follows the QB as the offense jogs back into formation.
        this.ball.carrier = this.offense[0]; this.ball.visible = true;
        this.time.delayedCall(duration + 120, () => {
            const gotUp = this._standDownedPlayers(off, def, 420);
            this.time.delayedCall(gotUp ? 470 : 0, cb);
        });
    }

    // ─── Animation helpers ─────────────────────────────────────────────────────
    // A little squash/stretch bob makes a moving player look like they're running.
    startBob(p) {
        // The baked run cycle already carries the sense of running; squashing
        // the sprite on top of it reads as a wobble rather than a stride.
        if (p._spr) return;
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

    // Tween a player while bobbing; stops bobbing on arrival.
    // All player movement is slowed ~50% so the game reads better visually.
    jog(p, x, y, duration, ease) {
        // Hard-clamp every destination so no animation can place a player outside
        // the visible field boundary, regardless of where it was called from.
        const cx = Phaser.Math.Clamp(x, FIELD.LEFT + 8, FIELD.RIGHT  - 8);
        const cy = Phaser.Math.Clamp(y, FIELD.TOP  + 10, FIELD.BOTTOM - 10);
        this.startBob(p);
        return this.tweens.add({
            targets: p, x: cx, y: cy, duration: duration * 1.5, ease: ease || 'Sine.easeInOut',
            onComplete: () => this.stopBob(p)
        });
    }

    // Returns the larger of nominalDur and the time needed so the player never
    // moves faster than maxSpeed px/ms (visual). jog() multiplies by 1.5 so we
    // divide by (maxSpeed * 1.5) to get the value to pass into jog().
    _capJogDur(p, tx, ty, nominalDur, maxSpeed = 0.22) {
        const dist = Phaser.Math.Distance.Between(p.x, p.y, tx, ty);
        return Math.max(nominalDur, dist / (maxSpeed * 1.5));
    }

    // Send a group of players toward a tackle/pile spot realistically.
    // The closest `minClose` players (default 2) ALWAYS sprint to the tackle spot
    // so there is never a ghost tackle — at least one player is visibly there.
    // Called just before the tackle fires: forces the 2 nearest defenders in
    // `tacklers` to be actively running into the carrier (cx, cy) so the
    // tackle never looks like a stationary player absorbing a hit.
    _rushIntoTackle(tacklers, cx, cy) {
        // Sort defenders by proximity and drive the nearest two INTO the carrier.
        // No setPosition is ever used — everything is a tween so there's no snap.
        // Returns the longest rush duration so callers can defer the tackle
        // sound/shake until a defender has visibly arrived at the carrier.
        const sorted = [...tacklers]
            .filter(p => !!p)
            .sort((a, b) =>
                Phaser.Math.Distance.Between(a.x, a.y, cx, cy) -
                Phaser.Math.Distance.Between(b.x, b.y, cx, cy));
        let maxDur = 0;
        // Constant running speed (px/ms). Slightly slower than jog cap so it
        // reads as a smooth, deliberate pursuit rather than a teleport/zoom.
        const RUN_SPEED = 0.18;
        sorted.slice(0, 2).forEach((p, i) => {
            this.tweens.killTweensOf(p);
            const dist = Phaser.Math.Distance.Between(p.x, p.y, cx, cy);
            // Duration = distance / speed → constant-velocity run.
            // Floor keeps very close defenders from snapping; no hard ceiling
            // so far defenders take the realistic time to actually get there.
            const rushDur = Math.max(180, dist / RUN_SPEED);
            if (rushDur > maxDur) maxDur = rushDur;
            const offset = i === 0 ? { x: cx - 6, y: cy - 5 } : { x: cx + 5, y: cy + 6 };
            this.startBob(p);
            this.tweens.add({
                targets: p,
                x: Phaser.Math.Clamp(offset.x, FIELD.LEFT + 8, FIELD.RIGHT - 8),
                y: Phaser.Math.Clamp(offset.y, FIELD.TOP + 10, FIELD.BOTTOM - 10),
                duration: rushDur, ease: 'Sine.easeOut',
                onComplete: () => this.stopBob(p)
            });
        });
        return maxDur;
    }

    // Remaining players beyond closeRadius only drift partway.
    // All destinations are clamped inside the visible field boundary.
    _convergePlayers(players, tackleX, tackleY, baseDur, opts) {
        const o         = opts || {};
        const closeR    = o.closeRadius !== undefined ? o.closeRadius : 140;
        const minClose  = o.minClose    !== undefined ? o.minClose    : 2;
        const scatterX  = o.scatterX   !== undefined ? o.scatterX    : 14;
        const scatterY  = o.scatterY   !== undefined ? o.scatterY    : 16;
        const driftFrac = o.driftFrac  !== undefined ? o.driftFrac   : 0.38;
        const minY = FIELD.TOP    + 14;
        const maxY = FIELD.BOTTOM - 14;
        const minX = FIELD.LEFT   + 10;
        const maxX = FIELD.RIGHT  - 10;

        // Sort a filtered copy by distance so we can guarantee the closest ones
        // always make it to the tackle spot regardless of how far away they are.
        const sorted = players
            .filter(p => !!p)
            .map(p => ({ p, dist: Phaser.Math.Distance.Between(p.x, p.y, tackleX, tackleY) }))
            .sort((a, b) => a.dist - b.dist);

        sorted.forEach(({ p, dist }, i) => {
            const isClose = dist <= closeR || i < minClose;
            let tx, ty, dur;
            if (isClose) {
                // Sprint into the pile with a tight scatter so they don't pile on
                // the exact same pixel. Duration is capped so they arrive in time.
                tx  = Phaser.Math.Clamp(tackleX + (Math.random() * scatterX * 2 - scatterX), minX, maxX);
                ty  = Phaser.Math.Clamp(tackleY + (Math.random() * scatterY * 2 - scatterY), minY, maxY);
                dur = baseDur + Math.random() * 160;
            } else {
                // React and drift partway — visibly chasing but can't close the gap.
                const frac = driftFrac + Math.random() * 0.15;
                tx  = Phaser.Math.Clamp(p.x + (tackleX - p.x) * frac + (Math.random() * 14 - 7), minX, maxX);
                ty  = Phaser.Math.Clamp(p.y + (tackleY - p.y) * frac + (Math.random() * 14 - 7), minY, maxY);
                // Slow drift — cap at 0.10 px/ms so they visibly lag behind.
                dur = this._capJogDur(p, tx, ty, baseDur * 1.6 + Math.random() * 400, 0.10);
            }
            this.jog(p, tx, ty, dur);
        });
    }

    // Smoothly shift our defenders (this.offense in defense mode) into the
    // formation that matches the highlighted defensive play.  Called every time
    // the player scans to a new option so they can see the alignment change.
    _previewDefFormation(playId) {
        const losX = ydToX(this.opp.yard), midY = FIELD.MID_Y;
        // Four distinct alignments — our defenders are this.offense[0-5].
        const formations = {
            // Load the box: DL tight to line, LB fills middle, CBs come up as
            // edge-contain, Safety in the box for run support.
            STOP_RUN: [
                { x: losX -  5, y: midY - 10 },
                { x: losX -  5, y: midY + 10 },
                { x: losX - 20, y: midY      },
                { x: losX - 16, y: midY - 75 },
                { x: losX - 16, y: midY + 75 },
                { x: losX - 55, y: midY      }
            ],
            // Drop into coverage: DL standard, LB drops to flat, CBs wide and
            // deep protecting the sidelines, Safety single-high.
            DEFEND_PASS: [
                { x: losX - 14, y: midY - 18  },
                { x: losX - 14, y: midY + 18  },
                { x: losX - 70, y: midY       },
                { x: losX - 18, y: midY - 150 },
                { x: losX - 18, y: midY + 150 },
                { x: losX - 145, y: midY      }
            ],
            // Blitz: everyone crashes the LOS. CBs hold man coverage;
            // LB joins DL right at the line.
            BLITZ: [
                { x: losX -  3, y: midY -  7 },
                { x: losX -  3, y: midY +  7 },
                { x: losX -  8, y: midY      },
                { x: losX - 26, y: midY - 120 },
                { x: losX - 26, y: midY + 120 },
                { x: losX - 65, y: midY      }
            ],
            // Balanced 4-3: base alignment, no strong lean either way.
            BALANCED: [
                { x: losX - 14, y: midY - 12 },
                { x: losX - 14, y: midY + 12 },
                { x: losX - 48, y: midY      },
                { x: losX - 26, y: midY - 120 },
                { x: losX - 26, y: midY + 120 },
                { x: losX - 95, y: midY      }
            ]
        };
        const pos = formations[playId] || formations.BALANCED;
        this.offense.forEach((p, i) => {
            if (!pos[i]) return;
            this.tweens.killTweensOf(p); this.stopBob(p);
            this.jog(p, pos[i].x, pos[i].y, 420, 'Sine.easeOut');
        });
    }

    tackleShake(p) {
        this.cameras.main.shake(160, 0.006);
        if (p) {
            // Push the tackled player to the bottom of the player depth stack
            // so defenders visually pile on top of them.
            this._tackledPlayer = p;
            p.setDepth(2.0);
            this.playPlayerAction(p, 'tackle');
            if (p._spr) {
                // The tackle clip already puts the player on the ground, so the
                // spin that stands in for it on disc players would read as the
                // sprite tipping over on top of its own fall.
                this.time.delayedCall(600, () => {
                    if (this._tackledPlayer === p) this._tackledPlayer = null;
                });
                return;
            }
            this.tweens.add({
                targets: p, angle: (Math.random() < 0.5 ? -28 : 28), duration: 120, yoyo: true,
                onComplete: () => {
                    // Clear the tackled flag after the shake so the Y-sort
                    // takes over again once everyone repositions.
                    this.time.delayedCall(600, () => {
                        if (this._tackledPlayer === p) this._tackledPlayer = null;
                    });
                }
            });
        }
    }

    // ─── Dynamic player depth sorting ──────────────────────────────────────────
    // Called every frame from update(). Players further down the field (higher Y)
    // appear closer to the camera and are drawn on top of players higher up.
    // Special cases: the ball carrier is always on top (7.0); the player who just
    // got tackled is pinned at the bottom (2.0) so defenders pile over them.
    _sortPlayerDepths() {
        if (!this.offense || !this.defense) return;
        const carrier  = this.ball && this.ball.carrier;
        const tackled  = this._tackledPlayer;
        const fieldH   = FIELD.BOTTOM - FIELD.TOP || 380;
        const allPlayers = [...this.offense, ...this.defense];
        allPlayers.forEach(p => {
            if (!p) return;
            if (p === carrier) {
                // Ball carrier always on top of the player layer.
                p.setDepth(7.0);
            } else if (p === tackled) {
                // Tackled player is pinned under everyone.
                p.setDepth(2.0);
            } else {
                // Y-sort: lower Y (far side of field) = lower depth;
                // higher Y (near side) = higher depth, appears in front.
                const t = Phaser.Math.Clamp((p.y - FIELD.TOP) / fieldH, 0, 1);
                p.setDepth(2.5 + t * 4.0); // range 2.5 – 6.5
            }
        });
    }

    // ─── Camera helpers ────────────────────────────────────────────────────────
    // Zoom into a world point during a key moment; call _zoomOut() when done.
    _zoomOnPoint(wx, wy, zoom, duration) {
        const cam = this.cameras.main;
        cam.pan(wx, wy, duration, 'Sine.easeOut');
        cam.zoomTo(zoom, duration, 'Sine.easeOut');
    }

    _zoomOut(duration) {
        const cam = this.cameras.main;
        // force=true so this always overrides any currently-running pan/zoom effect.
        cam.pan(W / 2, H / 2, duration || 340, 'Sine.easeOut', true);
        cam.zoomTo(1, duration || 340, 'Sine.easeOut', true);
    }

    // ─── HUD ───────────────────────────────────────────────────────────────────
    createHUD() {
        this.hudGfx = this.add.graphics().setDepth(9).setScrollFactor(0);
        this.quarterTxt = this.add.text(150, 24, '', { fontSize: '18px', fontFamily: 'Arial Black', color: '#fff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(10).setScrollFactor(0);
        this.scoreUsTxt   = this.add.text(470, 30, '0', { fontSize: '44px', fontFamily: 'Arial Black', color: '#ffffff', stroke: '#000', strokeThickness: 5 }).setOrigin(1, 0.5).setDepth(10).setScrollFactor(0);
        this.scoreDashTxt = this.add.text(500, 30, '-', { fontSize: '44px', fontFamily: 'Arial Black', color: '#aaaaaa', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5, 0.5).setDepth(10).setScrollFactor(0);
        this.scoreThmTxt  = this.add.text(530, 30, '0', { fontSize: '44px', fontFamily: 'Arial Black', color: '#ffffff', stroke: '#000', strokeThickness: 5 }).setOrigin(0, 0.5).setDepth(10).setScrollFactor(0);
        this.downTxt = this.add.text(W - 150, 18, '', { fontSize: '18px', fontFamily: 'Arial Black', color: '#fff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(10).setScrollFactor(0);
        this.posTxt = this.add.text(W - 150, 40, '', { fontSize: '13px', fontFamily: 'Arial', color: '#aaffaa', stroke: '#000', strokeThickness: 2 }).setOrigin(0.5).setDepth(10).setScrollFactor(0);
        this.msgTxt = this.add.text(W / 2, H / 2 - 40, '', { fontSize: '42px', fontFamily: 'Arial Black', color: '#FFD700', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(30).setAlpha(0).setScrollFactor(0);
        // Sub-text sits just below the HUD bar (line at y=60) so it never blocks the field.
        this.subTxt = this.add.text(W / 2, 72, '', { fontSize: '18px', fontFamily: 'Arial Black', color: '#ffffff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(30).setAlpha(0).setScrollFactor(0);
    }

    updateHUD() {
        const gs = this.gs;
        const min = Math.floor(gs.timeRemaining / 60);
        const sec = Math.floor(gs.timeRemaining % 60);
        const q = gs.overtime ? 'OT' : 'Q' + gs.quarter;
        this.quarterTxt.setText(`${q}  ${min}:${sec.toString().padStart(2, '0')}`);
        this.scoreUsTxt.setText(String(gs.score.us)).setColor(this.playerColor.lightCss);
        this.scoreThmTxt.setText(String(gs.score.them)).setColor(this.oppColor.lightCss);
        const downNames = ['1ST', '2ND', '3RD', '4TH'];
        if (this.onDefense && this.opp) {
            this.downTxt.setText(`DEF · ${downNames[Math.min(this.opp.down, 4) - 1]} & ${this.opp.toGo > 0 ? this.opp.toGo : 'GOAL'}`);
            const oyl = this.opp.yard;
            this.posTxt.setText(oyl <= 50 ? `BALL ON OUR ${oyl}` : `BALL ON THEIR ${100 - oyl}`);
        } else {
            this.downTxt.setText(`${downNames[Math.min(gs.down, 4) - 1]} & ${gs.yardsToGo > 0 ? gs.yardsToGo : 'GOAL'}`);
            const yl = gs.ballPosition;
            this.posTxt.setText(yl <= 50 ? `BALL ON OWN ${yl}` : `BALL ON OPP ${100 - yl}`);
        }

        const g = this.hudGfx;
        g.clear();
        // Top status bar spanning the full width.
        g.fillStyle(0x0a1408, 0.82); g.fillRect(0, 0, W, 60);
        g.lineStyle(2, 0xffd700, 0.45); g.lineBetween(0, 60, W, 60);
    }

    // ─── Drive / down management ───────────────────────────────────────────────
    startUsDrive(yardLine, isKickoff) {
        this.onDefense = false;
        this._cpuDriveHot = 0;  // clear any hot-drive bonus when we get the ball back
        this.gs.ballPosition = Phaser.Math.Clamp(yardLine, 1, 99);
        this.gs.down = 1;
        this.gs.firstDownTarget = Math.min(this.gs.ballPosition + 10, 100);
        this.gs.yardsToGo = this.gs.firstDownTarget - this.gs.ballPosition;
        this.showPlayers(true);
        this.updateHUD();
        if (isKickoff) {
            // After a return the players are scattered — tween them into formation
            // then pause so the return commentary finishes before the play menu appears.
            this._zoomOut(400);
            this.tweenFormation(this.gs.ballPosition, 1000, () => this.time.delayedCall(2500, () => this.showPlayCall()));
        } else {
            // Always reset the camera — previous play may have left it zoomed in
            // (e.g. incomplete pass, interception, turnover on downs).
            this._zoomOut(380);
            this.repositionFormation(this.gs.ballPosition);
            this.showPlayCall();
        }
    }

    showPlayers(v) {
        this.offense.forEach(p => p.setVisible(v));
        this.defense.forEach(p => p.setVisible(v));
        this.ball.visible = v;
    }

    // Persist current game state so season games can be resumed across sessions.
    _saveGameState() {
        if (!this.isSeason) return;
        seasonMgr().saveGameState(
            Object.assign({}, this.gs, { score: Object.assign({}, this.gs.score) }),
            this.onDefense || false,
            this.opp || null
        );
    }

    showPlayCall() {
        this._saveGameState();
        this.phase = 'playcall';
        const gs = this.gs;
        const opts = [
            { label: 'Inside Run', value: 'INSIDE_RUN', hint: 'steady short yardage' },
            { label: 'Outside Run', value: 'OUTSIDE_RUN', hint: 'risky, can break big' },
            { label: 'Short Pass', value: 'SHORT_PASS', hint: 'high percentage' },
            { label: 'Long Pass', value: 'LONG_PASS', hint: 'go for big yards' }
        ];
        // Field goal only when reasonably in range; punt on 4th down only.
        if (gs.ballPosition >= 55) opts.push({ label: 'Field Goal', value: 'FIELD_GOAL', hint: 'kick for 3 points' });
        if (gs.down >= 4) opts.push({ label: 'Punt', value: 'PUNT', hint: 'flip the field' });
        // Pause is always available straight from the play bar, like the other games.
        opts.push({ label: 'Pause', value: 'PAUSE' });

        // Dark panel strip beneath the field so the play bar reads clearly.
        this.playPanel = this.add.graphics().setDepth(40).setScrollFactor(0);
        this.playPanel.fillStyle(0x06100a, 0.94); this.playPanel.fillRect(0, 504, W, H - 504);
        this.playPanel.lineStyle(2, 0xffd700, 0.5); this.playPanel.lineBetween(0, 504, W, 504);
        this.playLabel = this.add.text(W / 2, 520, 'CALL YOUR PLAY', {
            fontSize: '15px', fontFamily: 'Arial Black', color: '#ffd700', stroke: '#000', strokeThickness: 2
        }).setOrigin(0.5).setDepth(42).setScrollFactor(0);

        this.audio.speak(this._downSpeech(), true);
        const itemW = Math.min(154, Math.floor((W - 40) / opts.length) - 6);
        this.playMenu = new ScanList(this, {
            x: W / 2, y: 562, options: opts, audio: this.audio,
            columns: opts.length, itemW, itemH: 44, gap: 6, fontSize: '15px',
            onSelect: (opt) => this.onPlayChosen(opt.value)
        });
        this.playMenu.setScrollFactor(0);

        // PlayDiagram: a notebook-style sketch card that appears above the
        // highlighted play button so the player can see what each play looks like.
        const bestOff = this._getBestOffensePlays();
        this.playMenu.bestPlayValues = new Set(Object.keys(bestOff));
        this.playMenu._draw();   // re-draw now that bestPlayValues is set
        const playValues = opts.map(o => o.value);
        this.playDiagram = new PlayDiagram(this, playValues);
        // Hook into ScanList highlight changes by wrapping _announceCurrent.
        const menu = this.playMenu, diag = this.playDiagram;
        const origAnnounce = menu._announceCurrent.bind(menu);
        menu._announceCurrent = (initial) => {
            origAnnounce(initial);
            if (menu.index >= 0) {
                const label = menu.labels[menu.index];
                const cx = label ? label._cx : W / 2;
                diag.show(menu.index, cx);
            } else {
                diag.hide();
            }
        };
        // Trigger for pointer-hover selections which skip _announceCurrent.
        const origDraw = menu._draw.bind(menu);
        menu._draw = () => {
            origDraw();
            if (menu.index >= 0) {
                const label = menu.labels[menu.index];
                const cx = label ? label._cx : W / 2;
                diag.show(menu.index, cx);
            } else {
                diag.hide();
            }
        };

        // On 4th down (punt option available), the opponent's deep safety
        // drifts back to a standard punt-return spot as a precaution.
        // Skip when we're within 30 yards of the end zone — a punt is irrelevant that close.
        if (gs.down >= 4 && gs.ballPosition < 70) {
            const puntLandYard = Phaser.Math.Clamp(gs.ballPosition + 40, 5, 95);
            this.jog(this.defense[5], ydToX(puntLandYard), FIELD.MID_Y, 1800, 'Sine.easeInOut');
        }
    }

    _downSpeech() {
        const names = ['first', 'second', 'third', 'fourth'];
        const dn = names[Math.min(this.gs.down, 4) - 1];
        const dist = this.gs.yardsToGo <= 0 ? 'goal' : this.gs.yardsToGo + ' yards to go';
        return `${dn} down and ${dist}`;
    }

    // Returns a { [playValue]: shortTipString } map (max 2 entries) of recommended
    // offensive plays for the current down-and-distance situation.
    // Philosophy: pass plays are freely suggested on 1st/2nd down or when far from
    // scoring. On 3rd/4th, risk is weighted by distance — being close to the endzone
    // makes a risky pass worthwhile; the middle of the field on a late down favors
    // safer or run-oriented choices. Short passes always carry the highest success rate.
    _getBestOffensePlays() {
        const down = this.gs.down, toGo = this.gs.yardsToGo, pos = this.gs.ballPosition;
        const best = {};
        const inRedZone   = pos >= 88;   // ~12 yards out — short plays dominate
        const nearScoring = pos >= 65;   // ~35 yards out — INT risk increases
        const earlyDown   = down <= 2;   // 1st or 2nd: can afford to take chances

        if (toGo <= 2) {
            // Short yardage: power run is the safe call.
            best['INSIDE_RUN'] = 'Short yardage – run it';
            if (down >= 3) best['SHORT_PASS'] = 'Quick out as backup on 3rd';
        } else if (toGo <= 5) {
            // Medium yardage: short pass is highest percentage.
            best['SHORT_PASS'] = 'Short throw – high percentage';
            if (earlyDown) best['OUTSIDE_RUN'] = 'Sweep around the end';
        } else if (toGo <= 9) {
            if (earlyDown) {
                // 1st/2nd: suggest passes freely — still have downs to adjust.
                best['SHORT_PASS'] = 'Move the chains';
                best['LONG_PASS'] = 'Take a shot downfield';
            } else if (!nearScoring) {
                // 3rd/4th but still far from scoring — need yards, pass is right.
                best['SHORT_PASS'] = 'Best chance at the first';
                best['LONG_PASS'] = 'Far from scoring – worth the risk';
            } else if (inRedZone) {
                // 3rd/4th in red zone: points are close, the risk is worth it.
                best['SHORT_PASS'] = 'Red zone – quick slant';
                best['INSIDE_RUN'] = 'Red zone – punch it in';
            } else {
                // 3rd/4th, near scoring but not red zone: safer plays preferred.
                best['SHORT_PASS'] = '3rd down – move the chains';
                best['INSIDE_RUN'] = 'Could grind for the first';
            }
        } else {
            // Long yardage: need to air it out.
            if (earlyDown || !nearScoring) {
                // Pass freely on early downs or when far from scoring.
                best['LONG_PASS'] = earlyDown ? 'Take a big shot' : 'Need yards – go deep';
                best['SHORT_PASS'] = 'Safe check-down option';
            } else if (inRedZone) {
                // Red zone, 3rd/4th and long: the points are worth the risk.
                best['SHORT_PASS'] = 'Red zone – take what\'s there';
                best['LONG_PASS'] = 'Throw it up – you need the score';
            } else {
                // 3rd/4th and long near scoring: an INT here is costly. Stay safer.
                best['SHORT_PASS'] = 'High percentage – stay in field goal range';
                best['INSIDE_RUN'] = 'Grind for yards – keep the drive alive';
            }
        }

        // In red zone on early downs: long pass rarely helps — swap for run.
        if (inRedZone && earlyDown && best['LONG_PASS']) {
            delete best['LONG_PASS'];
            if (!best['INSIDE_RUN']) best['INSIDE_RUN'] = 'Red zone – punch it in';
        }

        // Cap at 2 recommendations.
        const keys = Object.keys(best);
        if (keys.length > 2) delete best[keys[2]];
        return best;
    }

    // Returns a { [playValue]: shortTipString } map (max 2 entries) of recommended
    // defensive plays based on the opponent's down-and-distance.
    _getBestDefPlays() {
        const down = this.opp.down, toGo = this.opp.toGo, pos = this.opp.yard;
        const best = {};

        if (toGo <= 2) {
            // Opponent short yardage — expect a run; stack the box.
            best['STOP_RUN'] = 'Short yardage – stack the box';
            best['BLITZ'] = 'Blow up the play early';
        } else if (toGo <= 5) {
            // Balanced situation.
            best['BALANCED'] = 'Mixed look – stay disciplined';
            best['STOP_RUN'] = 'Could be a run – be ready';
        } else {
            // Long yardage — they almost certainly pass.
            best['DEFEND_PASS'] = 'Long yardage – get in coverage';
            best['BLITZ'] = 'Pressure on passing down';
        }

        // 4th down: go all out, don't give up easy yards.
        if (down >= 4) {
            Object.keys(best).forEach(k => delete best[k]);
            best['BLITZ'] = '4th down – bring the house';
            best['DEFEND_PASS'] = 'Keep them from a first down';
        }

        // Opponent in red zone (≥80 yards): prevent defense over blitz.
        if (pos >= 80) {
            delete best['BLITZ'];
            best['DEFEND_PASS'] = 'Red zone – no big plays';
            best['BALANCED'] = 'Make them earn every yard';
        }

        const keys = Object.keys(best);
        if (keys.length > 2) delete best[keys[2]];
        return best;
    }

    onPlayChosen(playId) {
        if (playId === 'PAUSE') { this.togglePause(); return; }
        // Reset all spacebar state so a held-space that committed this play
        // doesn't keep the backTimer running into the next play-call menu.
        if (this.scanInput) this.scanInput._clearSpaceState();
        if (this.playMenu) { this.playMenu.destroy(); this.playMenu = null; }
        if (this.playLabel) { this.playLabel.destroy(); this.playLabel = null; }
        if (this.playPanel) { this.playPanel.destroy(); this.playPanel = null; }
        if (this.playDiagram) { this.playDiagram.destroy(); this.playDiagram = null; }
        const play = PLAYS[playId];
        this.audio.play('snap');
        if (play.kind === 'run') this.execRun(play);
        else if (play.kind === 'pass') this.startPass(play);
        else if (play.kind === 'fg') this.execFieldGoal();
        else if (play.kind === 'punt') this.execPunt();
    }

    // Defence tightens up as the score climbs. Two-stage ramp:
    //   * Soft pressure starts at 14 pts, caps at 0.20.
    //   * Hard pressure kicks in once the score crosses 35 to keep games sane,
    //     adding up to another 0.30 by 65 pts.
    // Pass to a specific score (e.g. the CPU's) to apply the same curve to them.
    _scorePressure(score) {
        const s = score !== undefined ? score : this.gs.score.us;
        const soft = Phaser.Math.Clamp((s - 14) / 84, 0, 0.20);
        const hard = Phaser.Math.Clamp((s - 35) / 30, 0, 0.30);
        return soft + hard;
    }

    // ── CPU difficulty boost ────────────────────────────────────────────────────
    // Returns 0..~0.38 — a hidden multiplier that makes the CPU harder when:
    //   1. The player is winning by a big margin (comeback factor).
    //   2. The player is on a season win streak (secret difficulty ramp).
    //   3. The CPU randomly "catches fire" for a single drive (_cpuDriveHot).
    // Applied to CPU yardage/completion and as a small drag on player success.
    _cpuBoost() {
        // Comeback: ramps from 0 at +7 player lead to 0.18 at +49.
        const lead = this.gs.score.us - this.gs.score.them;
        const comeback = Phaser.Math.Clamp((lead - 7) / 42, 0, 0.18);
        // Win-streak secret multiplier: every season win after 2 adds difficulty.
        let streakBoost = 0;
        if (this.isSeason) {
            const sm = seasonMgr();
            if (sm && sm.data) streakBoost = Phaser.Math.Clamp((sm.data.wins - 2) / 10, 0, 0.15);
        }
        // Hot-drive bonus: set in defenseDrive(), cleared in startUsDrive().
        const hotBonus = this._cpuDriveHot || 0;
        return Math.min(comeback + streakBoost + hotBonus, 0.38);
    }

    // ─── Running plays ─────────────────────────────────────────────────────────
    execRun(play) {
        this.phase = 'anim';
        // ── Miracle run: rare breakaway TD on any run play ─────────────────────
        // ~1 % base chance (higher if player is trailing by 14+).
        if (Math.random() < this._miracleChance(true)) {
            const rb = this.offense[1];
            this.ball.carrier = rb; this.ball.visible = true;
            const endX = FIELD.GOAL_R + 52; // deep into the scoring endzone
            this._miracleRun(
                rb, this.defense,
                rb.x, rb.y, endX, true,
                () => {
                    const yards = 100 - this.gs.ballPosition;
                    this._doTDCelebration(rb);
                    this.bigMessage('MIRACLE RUN! TOUCHDOWN!', 2000, () => this.endPlay(yards, 'run'));
                }
            );
            return;
        }
        // Yardage model: base +/- variance, with a chance at a big gain.
        let yards = play.base + Math.round((Math.random() - 0.45) * play.variance);
        // Big plays are rarer and a touch shorter; stuffs more common.
        if (Math.random() < play.big * 0.7) yards += 5 + Math.floor(Math.random() * 14);
        if (Math.random() < 0.14) yards = -1 - Math.floor(Math.random() * 3); // stuffed
        yards = Math.max(yards, -6);

        // 3rd/4th-down risk: the defense knows you have to go for it, so they
        // pin their ears back. Running on 3rd/4th behind the 50 is especially
        // risky — extra chance of being stuffed short of the sticks.
        if (this.gs.down >= 3 && this.gs.ballPosition < 50) {
            if (Math.random() < 0.35) yards = Math.max(yards - (2 + Math.floor(Math.random() * 4)), -3);
        } else if (this.gs.down >= 3) {
            if (Math.random() < 0.20) yards = Math.max(yards - (1 + Math.floor(Math.random() * 3)), -2);
        }

        // Defence adjusts after the player scores big — harder to pick up yards.
        const sp = this._scorePressure();
        if (sp > 0 && Math.random() < sp * 1.1) yards = Math.max(yards - (2 + Math.floor(Math.random() * 4)), -2);
        // Once the player is over 35, shave a couple yards off most carries.
        if (this.gs.score.us > 35 && yards > 2) yards = Math.max(2, yards - (2 + Math.floor(Math.random() * 3)));
        // CPU comeback/hot-streak tightens the defense against us slightly.
        const cpuB = this._cpuBoost();
        if (cpuB > 0 && Math.random() < cpuB * 0.75) yards = Math.max(yards - (1 + Math.floor(Math.random() * 3)), -2);

        const startYard = this.gs.ballPosition;
        const endYard = Phaser.Math.Clamp(startYard + yards, 0, 100);
        const qb = this.offense[0], rb = this.offense[1];
        const losX = ydToX(startYard), midY = FIELD.MID_Y;
        const endX = endYard >= 100 ? FIELD.GOAL_R + 38 : ydToX(endYard);

        // Outside runs always sweep wide to one edge; inside runs use a tighter
        // lane through the A/B gaps.
        const isOutside = play.id === 'OUTSIDE_RUN';
        // Outside: large fixed lane (80–110px) that stays wide the whole play.
        // Inside:  smaller lane (12–36px) with slight drift.
        const laneDir = Math.random() < 0.5 ? -1 : 1;
        const lane = isOutside
            ? laneDir * (80 + Math.random() * 30)
            : laneDir * (12 + Math.random() * 24);
        // How much the lane returns toward center on the second leg:
        //   outside → barely narrows (stays on the edge)
        //   inside  → slight drift back (natural cut upfield)
        const leg2LaneFrac = isOutside ? 0.88 : 0.55;
        // Clamp the final Y so the carrier never runs out of bounds.
        const tackleLaneY = Phaser.Math.Clamp(
            midY + lane * leg2LaneFrac, FIELD.TOP + 20, FIELD.BOTTOM - 20);
        const midLaneY = Phaser.Math.Clamp(
            midY + lane, FIELD.TOP + 20, FIELD.BOTTOM - 20);

        // Ball sticks to the running back.
        this.ball.carrier = rb; this.ball.visible = true;
        this.audio.speak(isOutside ? 'Sweep!' : 'Handoff!', true);

        // Zoom in on the line of scrimmage so the run is visible up close.
        this._zoomOnPoint(losX, midY, 1.6, 260);

        // Linemen drive forward to block. On outside runs the WR/TE also
        // release to the perimeter to simulate edge blocking.
        this.offense.forEach((p, i) => {
            if (i === 0 || i === 1) return;
            const xPush = isOutside ? (48 + Math.random() * 30) : (28 + Math.random() * 22);
            const yPush = isOutside ? laneDir * (20 + Math.random() * 28) : (Math.random() - 0.5) * 24;
            this.jog(p, p.x + xPush, p.y + yPush, 900);
        });

        // At snap, defenders react to the OPPOSITE side of the run lane so they
        // must pursue diagonally — never standing directly in the carrier's path.
        const laneSign = lane >= 0 ? 1 : -1;
        const opp = -laneSign;
        const _cy = (y) => Phaser.Math.Clamp(y, FIELD.TOP + 14, FIELD.BOTTOM - 14);
        this.tweens.add({ targets: this.defense[0], x: this.defense[0].x + 20, y: _cy(this.defense[0].y + opp * 54), duration: 300, ease: 'Sine.easeOut' });
        this.tweens.add({ targets: this.defense[1], x: this.defense[1].x + 20, y: _cy(this.defense[1].y - opp * 54), duration: 300, ease: 'Sine.easeOut' });
        this.tweens.add({ targets: this.defense[2], x: this.defense[2].x + 8,  y: _cy(this.defense[2].y + opp * 62), duration: 360, ease: 'Sine.easeOut' });
        [this.defense[3], this.defense[4]].forEach(p => {
            this.tweens.add({ targets: p, x: p.x + 18, y: _cy(p.y + opp * (28 + Math.random() * 18)), duration: 420, ease: 'Sine.easeOut' });
        });

        // Outside run: RB sweeps wide first (lateral arc then turns upfield).
        // Inside run:  RB takes the handoff and hits the gap directly.
        const rbStartY = isOutside ? midLaneY : midY;
        this.jog(rb, losX - 4, rbStartY, isOutside ? 480 : 340, 'Quad.easeOut');
        this.time.delayedCall(isOutside ? 500 : 360, () => {
            const dur = Math.max(1300, Math.abs(endYard - startYard) * 75 + 1000);
            const midX = (losX + endX) / 2;

            // Leg 1: carrier reaches peak of their lane.
            // Leg 2: carrier drives toward the tackle spot — outside runs stay
            //        on the edge, inside runs have a slight upfield cut.
            this.startBob(rb);
            this.tweens.add({
                targets: rb, x: midX, y: midLaneY, duration: dur * 0.5, ease: 'Sine.easeOut',
                onComplete: () => {
                    this.tweens.add({
                        targets: rb, x: endX, y: tackleLaneY, duration: dur * 0.5, ease: 'Sine.easeIn',
                        onComplete: () => this._finishRun(rb, yards)
                    });
                }
            });

            // Defenders converge diagonally from their displaced positions.
            this.time.delayedCall(dur * 0.32, () => {
                this._convergePlayers(this.defense, endX, tackleLaneY, dur * 0.52);
            });
        });
    }

    // ─── Miracle Run touchdown ──────────────────────────────────────────────
    // A rare electrifying play: the carrier breaks into the open field and races
    // to the endzone untouched while the whole defense chases desperately.
    //
    // runner    – the sprite that carries the ball
    // chasers   – array of defender sprites that pursue
    // startX/Y  – where the break happens (runner's current position)
    // tdEndX    – x position deep inside the scoring endzone
    // isUs      – true = player team scored, false = CPU scored
    // onDone    – callback fired after celebration, scored 6pts, then caller
    //             should call the appropriate endPlay / endOppPlay equivalent
    _miracleRun(runner, chasers, startX, startY, tdEndX, isUs, onDone) {
        this.phase = 'anim';
        // Kill any existing tweens on everyone involved.
        this.tweens.killTweensOf(runner);
        chasers.forEach(p => { if (p) this.tweens.killTweensOf(p); });

        const midY   = FIELD.MID_Y;
        const totalDist = Math.abs(tdEndX - startX);
        // Total animation time scales with distance; minimum 2.1s so it feels epic.
        const totalDur  = Math.max(2100, totalDist * 8.5);

        // Pick a weave lane — the runner cuts to one side of the field.
        const laneDir = startY <= midY ? 1 : -1; // cut toward open space
        const peakY   = Phaser.Math.Clamp(
            startY + laneDir * (55 + Math.random() * 35),
            FIELD.TOP + 18, FIELD.BOTTOM - 18);

        // Mid-field x is used as the apex of the cut.
        const midRunX = startX + (tdEndX - startX) * 0.38;

        // 1. Brief dramatic freeze — the "what just happened" moment.
        this.audio.play('whistle');
        this.cameras.main.shake(60, 0.005);
        this.bigMessage(isUs ? 'HE\'S IN THE OPEN!' : `${this.oppColor.name} BREAKS FREE!`, 900, () => {
            this.audio.speak(isUs ? 'He\'s gone! Nobody can catch him!' : 'Breaks free! Nobody can stop him!', true);
            this.audio.play('crowd_big');

            // Zoom onto the runner.
            this._zoomOnPoint(startX, startY, 1.8, 220);

            // Ball sticks to runner.
            this.ball.carrier = runner; this.ball.visible = true;
            this.startBob(runner);

            // Runner weaves: cut to edge, then straighten into the endzone.
            this.tweens.add({
                targets: runner, x: midRunX, y: peakY,
                duration: totalDur * 0.45, ease: 'Sine.easeOut',
                onComplete: () => {
                    // Zoom widens to show the whole chase.
                    this._zoomOnPoint(runner.x + (tdEndX - runner.x) * 0.4, midY, 1.4, 300);
                    this.tweens.add({
                        targets: runner, x: tdEndX, y: Phaser.Math.Clamp(midY + laneDir * 18, FIELD.TOP + 16, FIELD.BOTTOM - 16),
                        duration: totalDur * 0.55, ease: 'Quad.easeIn',
                        onUpdate: (tw) => {
                            // Pulse the zoom forward as runner approaches endzone.
                            if (tw.progress > 0.6) {
                                const progExcess = (tw.progress - 0.6) / 0.4;
                                this.cameras.main.shake(16, 0.003 * progExcess);
                            }
                        },
                        onComplete: () => {
                            this.stopBob(runner);
                            this.ball.carrier = null;
                            this.audio.play('touchdown');
                            this.audio.play('crowd_big');
                            // Massive zoom onto the scorer in the endzone.
                            this._zoomOnPoint(runner.x, runner.y, 2.4, 250);
                            this.cameras.main.shake(240, 0.012);
                            onDone();
                        }
                    });
                }
            });

            // Defenders chase at full sprint — they close the gap but can never
            // quite get there. The closest two almost make it; the rest trail off.
            chasers.forEach((p, i) => {
                if (!p) return;
                this.tweens.killTweensOf(p);
                const dist = Phaser.Math.Distance.Between(p.x, p.y, tdEndX, midY);
                // Lean ahead of the runner slightly so they're visibly straining.
                const chaseTargetX = Phaser.Math.Clamp(
                    tdEndX + (i < 2 ? 20 + i * 12 : 50 + i * 20), FIELD.LEFT + 8, FIELD.RIGHT - 8);
                const chaseTargetY = Phaser.Math.Clamp(
                    peakY + (i % 2 ? 1 : -1) * (12 + i * 8), FIELD.TOP + 12, FIELD.BOTTOM - 12);
                const chaseDur = totalDur * (i < 2 ? 0.90 : 1.05); // two closest nearly get there
                this.startBob(p);
                this.tweens.add({
                    targets: p, x: chaseTargetX, y: chaseTargetY,
                    duration: chaseDur, ease: 'Sine.easeIn',
                    onComplete: () => this.stopBob(p)
                });
            });
        });
    }

    // Returns the miracle-run chance for the current context.
    // Base 1 % (1/100), bumped if the runner's team is trailing by 14+.
    _miracleChance(isUs) {
        const lead = this.gs.score.us - this.gs.score.them;
        const trailing = isUs ? lead <= -14 : lead >= 14; // runner's team is down by 14+
        return trailing ? 0.022 : 0.010;
    }

    _finishRun(rb, yards) {
        this.stopBob(rb);
        this._zoomOut(340);
        // No tackle on a touchdown — zoom in on the scorer and celebrate.
        if (this.gs.ballPosition + yards >= 100) {
            this._zoomOnPoint(rb.x, rb.y, 2.2, 280);
            this.time.delayedCall(320, () => this.endPlay(yards, 'run'));
            return;
        }
        // Guarantee defenders are visibly running in at the moment of contact.
        const rushDur = this._rushIntoTackle(this.defense, rb.x, rb.y);
        this.time.delayedCall(rushDur, () => {
            this.audio.play('tackle');
            this.tackleShake(rb);
        });
        this.ball.carrier = null;

        // ~10% fumble chance on any tackle. The 50/50 coin flip decides possession.
        if (Math.random() < 0.10) {
            const weLose = Math.random() < 0.5;
            this.audio.play('incomplete'); // thud sound stands in for a fumble
            this.time.delayedCall(350, () => {
                this.audio.speak(weLose ? 'Fumble! Defense recovers!' : 'Fumble! We recover!', true);
                this.bigMessage(weLose ? 'FUMBLE — TURNOVER!' : 'FUMBLE — RECOVERED!', 2000, () => {
                    if (weLose) {
                        this.turnover('fumble');
                    } else {
                        // We keep the ball but it's spotted at the fumble point.
                        this.endPlay(yards, 'run');
                    }
                });
            });
            return;
        }

        this.time.delayedCall(400, () => this.endPlay(yards, 'run'));
    }

    // ─── Passing plays (basketball-style hold-to-charge throw) ─────────────────
    startPass(play) {
        this.phase = 'route';
        const losX = ydToX(this.gs.ballPosition), midY = FIELD.MID_Y;
        const isLong = play.depth === 'long';
        // Eligible receivers: WR, WR, TE, RB (offense indices 2,3,4,1)
        const idxs = [2, 3, 4, 1];

        // Coverage model: the defense has THREE coverage defenders to spread over
        // the four receivers. Distribution multisets that total 3 defenders (max 2 per man).
        // Later in the game (large lead / high score), the defence tightens — fewer or
        // no receivers are wide open, matching the difficulty ramp the player feels.
        const scoreLead = this.gs.score.us - this.gs.score.them;
        const gamePressure = Phaser.Math.Clamp(
            this._scorePressure() + Math.max(0, scoreLead - 7) / 42, 0, 1);
        // Low pressure  → normal: at least one wide-open receiver.
        // Moderate      → tighter: maybe one open, rest covered.
        // High pressure → everyone covered; the read is genuinely hard.
        const normalDists   = [[0, 1, 1, 1], [0, 0, 1, 2], [0, 0, 2, 1], [1, 0, 1, 1]];
        const moderateDists = [[1, 1, 1, 1], [0, 1, 1, 2], [1, 0, 2, 1], [0, 1, 2, 1]];
        const heavyDists    = [[1, 1, 1, 2], [1, 1, 2, 1], [1, 2, 1, 1], [2, 1, 1, 1]];
        const distPool = gamePressure < 0.30 ? normalDists
                       : gamePressure < 0.55 ? moderateDists
                       : heavyDists;
        const coverage = Phaser.Utils.Array.Shuffle(
            [...Phaser.Utils.Array.GetRandom(distPool)]
        );
        const dbPool = [this.defense[3], this.defense[4], this.defense[5]];
        let dbi = 0;

        this.receivers = idxs.map((oi, k) => {
            const depthYards = isLong ? (12 + Math.floor(Math.random() * 18)) : (3 + Math.floor(Math.random() * 8));
            const targetYard = Phaser.Math.Clamp(this.gs.ballPosition + depthYards, 0, 100);
            const lateral = [-130, 130, -55, 60][k] * (0.6 + Math.random() * 0.5);
            const cov = coverage[k];
            // Fewer defenders = more open. 0 → wide open, 1 → contested, 2 → blanketed.
            // Base for cov=2 is intentionally very low (0.08) so doubles are genuinely
            // dangerous. Long routes get a heavier penalty (-0.14) because the DB has
            // more reaction time. distRisk also shaves actual openness so visual and
            // math stay in sync.
            // distRisk is DETERMINISTIC: any open receiver 18+ yards downfield is
            // always orange — no randomness — so the further receiver is always the
            // riskier-looking one, never the closer one.
            const distRisk = (cov === 0) && (depthYards >= 18);
            const openness = Phaser.Math.Clamp(
                [0.92, 0.45, 0.08][cov]
                + (Math.random() * 0.10 - 0.05)
                - (isLong ? 0.14 : 0)
                - (distRisk ? 0.18 : 0),
                0.04, 0.95);
            const rx = ydToX(targetYard), ry = midY + lateral;
            // Pull this man's defenders from the shared pool.
            const defenders = [];
            for (let c = 0; c < cov && dbi < dbPool.length; c++) defenders.push(dbPool[dbi++]);
            // displayCov shows orange on technically-open deep receivers too; distRisk
            // is already baked into openness so visual and completion math agree.
            const displayCov = Math.min(2, cov + (distRisk ? 1 : 0));
            return {
                player: this.offense[oi], depthYards, targetYard,
                x: rx, y: ry, openness, coverage: cov, displayCov,
                defender: defenders[0] || this.defense[3 + (k % 3)],
                defenders
            };
        });

        // QB drops back a touch; line blocks.
        this.jog(this.offense[0], losX - 50, midY, 800);
        this.offense[5] && this.jog(this.offense[5], this.offense[5].x + 12, this.offense[5].y, 800);

        // Receivers run their routes; each covering defender sticks to his man.
        this.receivers.forEach(r => {
            this.jog(r.player, r.x, r.y, 1600, 'Sine.easeOut');
            r.defenders.forEach((d, i) => {
                if (!d) return;
                const side = i === 0 ? 1 : -1;
                this.jog(d, r.x + side * 20, r.y + 14 + i * 10, 1650, 'Sine.easeOut');
            });
        });
        // Pass rush.
        this.jog(this.defense[0], losX - 24, midY - 14, 1650);
        this.jog(this.defense[1], losX - 24, midY + 14, 1650);

        this.time.delayedCall(1700, () => this.beginReceiverSelect());
    }

    beginReceiverSelect() {
        this.phase = 'receiver';
        this.recIndex = 0;
        const auto = this.scanAutoOn();
        this.announceReceiver();
        // Make each receiver sprite tappable/clickable so mouse/touch players
        // can directly pick who they want to throw to.
        // First tap on a receiver selects/announces it; a second tap on the SAME
        // receiver confirms and starts the charge meter. This prevents accidental
        // charges and lets the user look at all options before committing.
        this._recPointerZones = [];
        this.receivers.forEach((r, idx) => {
            r.player.setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Circle(0, 0, 28), hitAreaCallback: Phaser.Geom.Circle.Contains });
            const fn = (ptr) => {
                if (this.phase !== 'receiver') return;
                // Ignore if the pointer moved significantly — that was a pan drag.
                const moved = Phaser.Math.Distance.Between(ptr.downX, ptr.downY, ptr.x, ptr.y);
                if (moved > 14) return;
                if (this.recIndex === idx) {
                    // Second tap on the already-selected receiver — confirm and charge.
                    this.audio.play('select');
                    this.selectReceiver();
                } else {
                    // First tap — just highlight this receiver and announce.
                    this.recIndex = idx;
                    this.audio.play('scan');
                    this.announceReceiver();
                }
            };
            r.player.on('pointerup', fn);
            this._recPointerZones.push({ player: r.player, fn });
        });
        // Allow drag-to-pan during receiver selection so players who are off-screen
        // (due to the close-up zoom) can still be reached by touch or mouse.
        this._setupReceiverPan();
        // Only auto-advance when the scan manager says auto-scan is on.
        if (auto) {
            this.recTimer = this.time.addEvent({
                delay: this.scanInterval(),
                loop: true, callback: () => this.receiverNext(true)
            });
        }
    }

    receiverNext(fromTimer) {
        if (this.phase !== 'receiver') return;
        this.recIndex = (this.recIndex + 1) % this.receivers.length;
        this.audio.play('scan');
        this.announceReceiver();
        // Reset the auto-scan timer after a manual advance (only if auto is on).
        if (!fromTimer && this.recTimer) {
            this.recTimer.remove();
            this.recTimer = this.time.addEvent({
                delay: this.scanInterval(),
                loop: true, callback: () => this.receiverNext(true)
            });
        }
    }

    receiverPrev() {
        if (this.phase !== 'receiver') return;
        this.recIndex = (this.recIndex - 1 + this.receivers.length) % this.receivers.length;
        this.audio.play('scan');
        this.announceReceiver();
        if (this.recTimer) {
            this.recTimer.remove();
            this.recTimer = this.time.addEvent({
                delay: this.scanInterval(),
                loop: true, callback: () => this.receiverNext(true)
            });
        }
    }

    announceReceiver() {
        const r = this.receivers[this.recIndex];
        const cov = r.coverage || 0;
        const dist = Math.round((r.targetYard - this.gs.ballPosition));
        // Zoom in so the player can read the receiver's coverage situation up close.
        this._zoomOnPoint(r.player.x, r.player.y, 2.0, 280);
        // Concise receiver call — interrupts any previous announcement immediately.
        const roleFull = positionName(r.player.role || 'WR');
        // Use displayCov to match what the orange/red ring actually shows.
        // If displayCov > cov it means distance is the risk, not defenders.
        const disp = r.displayCov !== undefined ? r.displayCov : cov;
        let covShort;
        if (disp > cov) {
            covShort = 'open but far';
        } else {
            covShort = cov === 0 ? 'open' : (cov === 1 ? 'covered' : 'doubled');
        }
        this.audio.speak(`${roleFull}, ${dist} yards, ${covShort}.`, true);

        // Play a distinct audio scan cue whenever a non-normal colorblind mode is
        // active and the display-coverage state changes (or on every scan).
        if (colorblindMode() !== 'normal') {
            this.audio.scanCue(disp);
        }
    }

    selectReceiver() {
        if (this.recTimer) { this.recTimer.remove(); this.recTimer = null; }
        // Remove pointer interactivity from receiver sprites.
        if (this._recPointerZones) {
            this._recPointerZones.forEach(z => { z.player.off('pointerup', z.fn); z.player.disableInteractive(); });
            this._recPointerZones = null;
        }
        this._cleanupReceiverPan();
        this.audio.play('select');
        this.target = this.receivers[this.recIndex];
        this.beginCharge();
    }

    // Drag-to-pan during receiver selection: lets touch/mouse users scroll the
    // zoomed-in view to find receivers that are off-screen.
    // Hold-to-charge: holding still for 300ms selects the current receiver and
    // starts the throw charge. Moving >14px before that timer fires cancels it
    // and treats the gesture as a pan instead.  Releasing during 'charge' phase
    // is already handled by ScanInput's existing pointerup handler.
    _setupReceiverPan() {
        let panStart = null, camStart = null, holdTimer = null, isPanning = false;

        const cancelHold = () => {
            if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        };

        const onDown = (ptr) => {
            isPanning = false;
            panStart = { x: ptr.x, y: ptr.y };
            camStart = { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY };
            // Start hold-to-charge timer.
            holdTimer = setTimeout(() => {
                holdTimer = null;
                if (this.phase !== 'receiver') return;
                this.selectReceiver();           // sets target, phase → 'charge' (or 'anim' easy-throw)
                if (this.phase === 'charge') this.startCharge();
            }, 300);
        };
        const onMove = (ptr) => {
            if (!ptr.isDown || !panStart) return;
            const dx = (ptr.x - panStart.x) / this.cameras.main.zoom;
            const dy = (ptr.y - panStart.y) / this.cameras.main.zoom;
            // Cancel the hold timer once the pointer drifts — treat as pan.
            if (!isPanning && Phaser.Math.Distance.Between(ptr.x, ptr.y, panStart.x, panStart.y) > 14) {
                isPanning = true;
                cancelHold();
            }
            if (isPanning) {
                this.cameras.main.scrollX = camStart.x - dx;
                this.cameras.main.scrollY = camStart.y - dy;
            }
        };
        const onUp = () => { cancelHold(); isPanning = false; };
        this.input.on('pointerdown', onDown);
        this.input.on('pointermove', onMove);
        this.input.on('pointerup', onUp);
        this._recPanHandlers = { onDown, onMove, onUp, cancelHold };
    }
    _cleanupReceiverPan() {
        if (!this._recPanHandlers) return;
        this._recPanHandlers.cancelHold();
        this.input.off('pointerdown', this._recPanHandlers.onDown);
        this.input.off('pointermove', this._recPanHandlers.onMove);
        this.input.off('pointerup', this._recPanHandlers.onUp);
        this._recPanHandlers = null;
    }

    idealPowerFor(target) {
        const distYards = Math.max(2, target.targetYard - this.gs.ballPosition);
        return Phaser.Math.Clamp(35 + distYards * 2.0, 30, 95);
    }

    beginCharge() {
        this.phase = 'charge';
        this.power = 0; this.charging = false; this.passCuePlayed = false; this.passOverPlayed = false;
        // Accessibility: "Easy Throw" mode skips the charge entirely and throws
        // at ideal power so the player only needs to pick a receiver, not hold.
        if (easyThrowOn()) {
            this.phase = 'anim';
            this.audio.play('select');
            this.audio.speak('Throwing.', true);
            this.throwPass(this.idealPowerFor(this.target));
            return;
        }
        // Zoom back out to full field so the throw and coverage are all visible.
        this._zoomOut(350);
        this._startCoverageCreep();
    }

    // While you line up and charge the throw, the whole field keeps moving in slow
    // motion: receivers drift along their routes and the coverage gradually closes
    // in — so defenders never "teleport" onto the catch at the last second.
    _startCoverageCreep() {
        if (!this.receivers) return;
        this.receivers.forEach(r => {
            // Kill any still-running route tweens on these players before adding
            // new ones.  Without this, two simultaneous tweens fight over x/y
            // every frame — the shorter route tween's final-frame position update
            // snaps the player to its 100% destination, then the longer creep tween
            // immediately overrides it with a different interpolated value, producing
            // a visible 1-frame teleport/warp.
            this.tweens.killTweensOf(r.player);
            if (r.defender) this.tweens.killTweensOf(r.defender);
            // Receivers keep working downfield a little.
            this.jog(r.player, r.x + (Math.random() * 22 - 11), r.y + (Math.random() * 26 - 13), 4200, 'Sine.easeInOut');
            if (r.defender) {
                // The man you targeted gets shadowed tighter; everyone else closes too.
                const isTarget = r === this.target;
                const gap = isTarget ? 16 : 30;
                const ang = Math.random() * Math.PI * 2;
                this.jog(r.defender, r.x + Math.cos(ang) * gap, r.y + Math.sin(ang) * gap,
                    isTarget ? 3800 : 4400, 'Sine.easeInOut');
            }
        });
        // The pass rush keeps pressing toward the quarterback.
        const qb = this.offense[0];
        if (this.defense[0]) this.jog(this.defense[0], qb.x + 26, qb.y - 16, 4000, 'Sine.easeInOut');
        if (this.defense[1]) this.jog(this.defense[1], qb.x + 26, qb.y + 16, 4000, 'Sine.easeInOut');
    }

    // Halt the slow-motion drift so the throw animation starts from a clean slate.
    _stopCoverageCreep() {
        [...this.offense, ...this.defense].forEach(p => { this.tweens.killTweensOf(p); this.stopBob(p); });
    }

    // Pressing (and holding) begins building throw power.
    startCharge() {
        if (this.charging) return;
        this.charging = true;
        this.power = 0;
        this.passCuePlayed = false;
        this.passOverPlayed = false;
        this.audio.play('charge');
    }

    // Releasing throws with whatever power was built (short hold = soft, short pass).
    releaseCharge() {
        if (!this.charging) return;
        this.charging = false;
        this.phase = 'anim';
        this._stopCoverageCreep();
        this.audio.play('throw');
        this.throwPass(this.power);
    }

    throwPass(power) {
        const r = this.target;
        const qb = this.offense[0];
        const idealPower = this.idealPowerFor(r);
        // A pass can ONLY be caught when you charge into the green window shown on
        // the meter (the same band drawPowerMeter draws: ideal ± 14). A quick tap
        // with no charge falls short; an over-charge sails long. Inside the window
        // it's forgiving — coverage decides between a catch, a break-up, or a pick.
        const band = 14;
        const lo = idealPower - band, hi = idealPower + band;
        const inWindow = power >= lo && power <= hi;
        const undercharged = power < lo;

        let complete = false, intercepted = false;
        const cov = r.coverage || 0;
        // INT risk on a failed throw:
        //   0 defenders → rare (3 %)
        //   1 defender  → meaningful (22 %)
        //   2 defenders → near coin-flip (52 %) — throwing into doubles is genuinely risky
        const intBase = [0.03, 0.22, 0.52][cov];

        // 3rd/4th-down risk: defense knows you have to throw; they press harder.
        // Passing behind the 50 on 3rd/4th is especially risky (should punt).
        let downPenalty = 0;
        if (this.gs.down >= 3 && this.gs.ballPosition < 50) downPenalty = 0.18;
        else if (this.gs.down >= 3) downPenalty = 0.10;

        if (inWindow) {
            const centered = 1 - Math.abs(power - idealPower) / band; // 0..1
            // Per-coverage floors guarantee the ring colour always means something:
            //   green  (cov=0) — never below 65 % even when down by a lot
            //   orange (cov=1) — never below 25 %
            //   red    (cov=2) — can drop to 5 % (genuinely dangerous)
            const covFloor = [0.65, 0.25, 0.05][cov];
            const completion = Phaser.Math.Clamp(
                0.12 + 0.78 * r.openness + 0.05 * centered
                - downPenalty - this._scorePressure() * 0.8 - this._cpuBoost() * 0.30,
                covFloor, 0.90);
            complete = Math.random() < completion;
            if (!complete) intercepted = Math.random() < intBase;
        } else if (!undercharged) {
            // Overthrown into coverage can be picked off; otherwise just incomplete.
            intercepted = Math.random() < intBase * 1.2;
        }

        // Where the ball lands: short if undercharged, long if overthrown.
        const reach = Phaser.Math.Clamp(power / idealPower, 0.4, 1.28);
        const landX = qb.x + (r.x - qb.x) * reach;
        const landY = qb.y + (r.y - qb.y) * reach;

        // Ball flight; faster ball when thrown harder.
        this.ball.visible = true; this.ball.carrier = null;
        const _qbPt = this._carryPoint(qb);
        this.ball.x = _qbPt.x; this.ball.y = _qbPt.y; this.ball.flying = true;
        this.playPlayerAction(qb, 'throw', r);
        const flightDur = Phaser.Math.Linear(820, 480, Phaser.Math.Clamp(power / 100, 0, 1));
        const tx = complete ? r.x : landX, ty = complete ? r.y : landY;
        // The art holds the ball until frame 5, so the flight waits for the
        // release rather than setting off during the wind-up.
        const _release = this._throwReleaseDelay(qb);
        const flight = { x: _qbPt.x, y: _qbPt.y };
        this.tweens.add({
            targets: flight, x: tx, y: ty, duration: flightDur, delay: _release, ease: 'Sine.easeInOut',
            onUpdate: () => { this.ball.x = flight.x; this.ball.y = flight.y; },
            onComplete: () => {
                this.ball.flying = false;
                if (complete) this._completePass(r);
                else if (intercepted) this._interceptPass(r);
                else {
                    this.audio.play('incomplete');
                    this.audio.speak(undercharged ? 'Short. Incomplete.' : 'Overthrown.', true);
                    this.ball.visible = false;
                    this.endPlay(0, 'incomplete');
                }
            }
        });
    }

    _completePass(r) {
        this.audio.play('catch');
        this.audio.play('crowd');
        this.audio.speak('Caught!', true);
        this.playPlayerAction(r.player, 'catch', this.offense[0]);
        // Zoom in on the receiver so the player can see the run-after-catch.
        this._zoomOnPoint(r.player.x, r.player.y, 1.55, 260);
        const rec = r.player;
        this.ball.carrier = rec;
        // If the route target was at or past the goal line the catch is an
        // immediate touchdown — receiver takes a few steps into the end zone.
        if (r.x >= FIELD.GOAL_R - 5) {
            this.audio.speak('Touchdown!', true);
            this._zoomOnPoint(rec.x, rec.y, 2.2, 280);
            const tdYards = r.targetYard - this.gs.ballPosition;
            // Step the scorer a few yards deeper into the end zone.
            const ezX = rec.x + 22 + Math.random() * 16;
            const ezY = rec.y + (Math.random() - 0.5) * 16;
            // Other players do small natural in-place drifts — no convergence.
            this.offense.forEach(p => {
                if (p === rec) return;
                this.jog(p, p.x + (Math.random() - 0.5) * 20, p.y + (Math.random() - 0.5) * 20, 460, 'Sine.easeOut');
            });
            this.defense.forEach(p => {
                this.jog(p, p.x + (Math.random() - 0.5) * 16, p.y + (Math.random() - 0.5) * 16, 460, 'Sine.easeOut');
            });
            this.tweens.add({
                targets: rec, x: ezX, y: ezY, duration: 460, ease: 'Sine.easeOut',
                onComplete: () => this.endPlay(tdYards, 'pass')
            });
            return;
        }
        // The receiver always gets to run after the catch — more room when open.
        const rawYac = (r.openness > 0.6 ? 4 + Math.floor(Math.random() * 9) : 1 + Math.floor(Math.random() * 4));
        const yac = Math.max(0, Math.round(rawYac * (1 - this._scorePressure()) * (1 - this._cpuBoost() * 0.45)));
        const gained = (r.targetYard - this.gs.ballPosition) + yac;
        const endYard = Phaser.Math.Clamp(this.gs.ballPosition + gained, 0, 100);
        // Carry the receiver slightly past the goal line for TDs so they don't
        // hover right at the boundary.
        const endX = endYard >= 100 ? FIELD.GOAL_R + 38 : ydToX(endYard);
        const midX = (rec.x + endX) / 2;
        // Capture catch position before any tweens move rec.
        const catchY = rec.y;
        // Run toward open space: lean away from field center (outward), not randomly.
        const sideDir = catchY <= FIELD.MID_Y ? -1 : 1;
        const lane = sideDir * (10 + Math.random() * 22);
        const runDur = 900 + yac * 80;

        // The receiver weaves upfield; the defense pursues and gradually runs him
        // down rather than snapping onto him instantly.
        this.jog(rec, midX, catchY + lane, runDur * 0.5, 'Sine.easeOut').on('complete', () => {
            this.jog(rec, endX, catchY + lane * 0.35, runDur * 0.5, 'Sine.easeIn').on('complete', () => {
                const isTD = this.gs.ballPosition + gained >= 100;
                if (isTD) {
                    // Zoom in on the receiver before the celebration fires.
                    this._zoomOnPoint(rec.x, rec.y, 2.2, 280);
                    this.time.delayedCall(320, () => this.endPlay(gained, 'pass'));
                    return;
                }
                // Guarantee defenders are visibly running in at the moment of contact.
                const rushDur = this._rushIntoTackle(this.defense, rec.x, rec.y);
                this.time.delayedCall(rushDur, () => {
                    this.audio.play('tackle');
                    this.tackleShake(rec);
                });
                this.ball.carrier = null;
                this.time.delayedCall(rushDur + 400, () => this.endPlay(gained, 'pass'));
            });
        });
        // Defense closes in after the receiver starts running — chasing from their
        // coverage spots rather than materialising head-on in front of the ball.
        this.time.delayedCall(runDur * 0.20, () => {
            this._convergePlayers(this.defense, endX, catchY + lane * 0.4, runDur * 0.72);
        });
        // Blockers push downfield to seal the edge after the catch.
        this.time.delayedCall(runDur * 0.12, () => {
            this._convergePlayers(this.offense.filter(p => p !== rec), endX, catchY + lane * 0.35, runDur * 0.80);
        });
    }

    _interceptPass(r) {
        this.audio.play('interception');
        this.audio.play('crowd_big');
        // Use whichever defender is physically closest to where the ball is going.
        const db = this.defense.reduce((best, p) => {
            const d = Phaser.Math.Distance.Between(p.x, p.y, r.x, r.y);
            const bd = Phaser.Math.Distance.Between(best.x, best.y, r.x, r.y);
            return d < bd ? p : best;
        }, this.defense[0]);
        this.ball.carrier = db;
        this.playPlayerAction(db, 'catch', this.offense[0]);
        this.audio.speak('Intercepted!', true);

        // Defender returns the ball toward their own end zone (left).
        // The return covers 5–22 yards; the offense must chase and tackle.
        const startYard   = this.gs.ballPosition;
        const returnYards = 5 + Math.floor(Math.random() * 18);
        const returnToYard = Phaser.Math.Clamp(startYard - returnYards, 1, 99);
        const endX    = ydToX(returnToYard);
        const midY    = FIELD.MID_Y;
        const totalDur = 1300 + returnYards * 45;
        const laneDir  = db.y <= midY ? 1 : -1;
        const lane     = laneDir * (12 + Math.random() * 22);
        const midRunX  = (db.x + endX) * 0.5;

        const isPickSixCPU = returnToYard <= 0;
        const actualEndX   = isPickSixCPU ? FIELD.GOAL_L - 52 : endX;

        this._zoomOnPoint(db.x, db.y, 1.7, 280);
        this.startBob(db);
        this.tweens.add({
            targets: db, x: (db.x + actualEndX) * 0.5,
            y: Phaser.Math.Clamp(db.y + lane, FIELD.TOP + 14, FIELD.BOTTOM - 14),
            duration: totalDur * 0.5, ease: 'Sine.easeOut',
            onComplete: () => {
                this._zoomOnPoint(db.x + (actualEndX - db.x) * 0.35, midY, 1.4, 260);
                this.tweens.add({
                    targets: db, x: actualEndX,
                    y: Phaser.Math.Clamp(db.y + lane * 0.3, FIELD.TOP + 14, FIELD.BOTTOM - 14),
                    duration: totalDur * 0.5, ease: 'Sine.easeIn',
                    onComplete: () => {
                        this.stopBob(db);
                        this.ball.carrier = null;
                        if (isPickSixCPU) {
                            this.gs.score.them += 6; this.updateHUD();
                            this.audio.play('touchdown'); this.audio.play('crowd_big');
                            this._zoomOnPoint(db.x, db.y, 2.2, 280);
                            this.cameras.main.shake(220, 0.009);
                            this.bigMessage(`${this.oppColor.name} PICK SIX! TOUCHDOWN!`, 2000,
                                () => this.oppAfterTouchdown());
                        } else {
                            const rushDur = this._rushIntoTackle(this.offense, db.x, db.y);
                            this.time.delayedCall(rushDur, () => {
                                this.audio.play('tackle');
                                this.tackleShake(db);
                                this.bigMessage('INTERCEPTED!', 1600, () => {
                                    this.time.delayedCall(300, () =>
                                        this.defenseDrive(Phaser.Math.Clamp(returnToYard, 1, 99)));
                                });
                            });
                        }
                    }
                });
            }
        });
        // Offense chases the interceptor from their coverage positions.
        this.time.delayedCall(totalDur * 0.15, () => {
            this._convergePlayers(this.offense, actualEndX,
                db.y + lane * 0.35, totalDur * 0.78);
        });
        // Other defenders escort the returner downfield.
        this.defense.forEach(p => {
            if (p === db) return;
            this.jog(p,
                (db.x + actualEndX) * 0.5 - 20 - Math.random() * 30,
                p.y + (Math.random() - 0.5) * 40,
                totalDur * 0.75 + Math.random() * 200);
        });
    }

    // ─── Kicks ─────────────────────────────────────────────────────────────────
    // Field goals are a two-step skill shot: first AIM the kick inside a cone
    // toward the uprights, then CHARGE the power like a pass. Aiming respects the
    // scan manager (auto-sweep only when auto-scan is on) and everything commits
    // on key up.
    execFieldGoal() {
        this.isPAT = false;
        this.beginFgAim();
    }

    // After a player TD: let them choose PAT kick (+1) or 2-pt conversion (+2).
    showAfterTouchdownMenu() {
        this._zoomOut(380);
        this.phase = 'playcall';
        const opts = [
            { label: 'Kick Extra Point  (+1)', value: 'pat',  hint: 'chip shot through the uprights' },
            { label: 'Go for 2 Points  (+2)',  value: '2pt',  hint: 'run or pass from the 2-yard line' }
        ];
        this.playPanel = this.add.graphics().setDepth(40).setScrollFactor(0);
        this.playPanel.fillStyle(0x06100a, 0.94); this.playPanel.fillRect(0, 504, W, H - 504);
        this.playPanel.lineStyle(2, 0xffd700, 0.5); this.playPanel.lineBetween(0, 504, W, 504);
        this.playLabel = this.add.text(W / 2, 520, 'AFTER TOUCHDOWN', {
            fontSize: '15px', fontFamily: 'Arial', fontStyle: 'bold', color: '#ffd700'
        }).setOrigin(0.5).setDepth(42).setScrollFactor(0);
        this.audio.speak('Touchdown! Kick the extra point for one, or go for two?');
        const itemW = Math.min(220, Math.floor((W - 40) / opts.length) - 6);
        this.playMenu = new ScanList(this, {
            x: W / 2, y: 562, options: opts, audio: this.audio,
            columns: opts.length, itemW, itemH: 44, gap: 6, fontSize: '14px',
            onSelect: (opt) => this.onAfterTDChosen(opt.value)
        });
        this.playMenu.setScrollFactor(0);
    }

    onAfterTDChosen(choice) {
        if (this.playMenu)  { this.playMenu.destroy();  this.playMenu  = null; }
        if (this.playLabel) { this.playLabel.destroy(); this.playLabel = null; }
        if (this.playPanel) { this.playPanel.destroy(); this.playPanel = null; }
        if (choice === '2pt') {
            this.beginTwoPointConversion();
        } else {
            this.beginExtraPoint();
        }
    }

    // Player-controlled 2-point conversion: run or pass from the 2-yard line.
    // A touchdown (ball reaches 100 from position 98) scores 2 pts; failure kicks off.
    beginTwoPointConversion() {
        this._is2pt = true;
        this.gs.ballPosition = 98;  // 2-yard line
        this.gs.down = 1;
        this.gs.yardsToGo = 2;
        this.gs.firstDownTarget = 100;
        this.showPlayers(true);
        // Snap players into proper 2-yard-line formation while the camera is still
        // zoomed in from the celebration — the zoom-out then reveals them in position.
        this.repositionFormation(98);
        this.updateHUD();
        this.audio.play('huddle');
        // Zoom out over 500 ms so the full 2-yard-line formation slides into view.
        this._zoomOut(500);
        // Wait for the zoom to settle before showing the play-call menu.
        this.time.delayedCall(1800, () => {
            this.phase = 'playcall';
            const opts = [
                { label: 'Run It In', value: 'INSIDE_RUN',  hint: 'smash it up the middle' },
                { label: 'Pass',      value: 'SHORT_PASS',  hint: 'quick throw to a receiver' }
            ];
            this.playPanel = this.add.graphics().setDepth(40).setScrollFactor(0);
            this.playPanel.fillStyle(0x06100a, 0.94); this.playPanel.fillRect(0, 504, W, H - 504);
            this.playPanel.lineStyle(2, 0xffd700, 0.5); this.playPanel.lineBetween(0, 504, W, 504);
            this.playLabel = this.add.text(W / 2, 520, 'GO FOR 2', {
                fontSize: '15px', fontFamily: 'Arial', fontStyle: 'bold', color: '#ffd700'
            }).setOrigin(0.5).setDepth(42).setScrollFactor(0);
            this.audio.speak('Going for two. Pick your play.');
            const itemW = Math.min(220, Math.floor((W - 40) / opts.length) - 6);
            this.playMenu = new ScanList(this, {
                x: W / 2, y: 562, options: opts, audio: this.audio,
                columns: opts.length, itemW, itemH: 44, gap: 6, fontSize: '14px',
                onSelect: (opt) => this.onPlayChosen(opt.value)
            });
            this.playMenu.setScrollFactor(0);
        });
    }

    // After a touchdown you kick the extra point with the same aim + power skill
    // shot (a short chip), then kick off to the opponent.
    beginExtraPoint() {
        this.isPAT = true;
        this.showPlayers(true);
        this.repositionFormation(85);
        this.gs.ballPosition = 85;
        this.updateHUD();
        this.beginFgAim();
    }

    beginFgAim() {
        this.phase = 'fgaim';
        this._aimHeld = false;
        if (this.isPAT) {
            this.fgDist = 20;                 // short chip shot
            this.aimWindow = 0.46;            // generous window
        } else {
            this.fgDist = (100 - this.gs.ballPosition) + 17;
            this.aimWindow = Phaser.Math.Clamp(0.52 - (this.fgDist - 20) * 0.005, 0.22, 0.52);
        }
        // Start the aim off to one side so you sweep it onto the target.
        this.aimValue = Math.random() < 0.5 ? -0.9 : 0.9;
        this.aimDir = this.aimValue > 0 ? -1 : 1;
        this._aimDing = false;
        this._onTarget = false;
        this.audio.play('whistle');

        // Zoom to show both the kicker AND the goal posts in frame.
        // Pan to the midpoint between ball and uprights; zoom just enough to
        // make the posts readable without pushing the kicker off-screen.
        const _fgBallX = ydToX(this.gs.ballPosition);
        const _fgGoalX = FIELD.GOAL_R + 30;
        const _fgMidX = (_fgBallX + _fgGoalX) / 2;
        const _fgZoom = this.isPAT ? 1.25 : 1.15;
        this._zoomOnPoint(_fgMidX, FIELD.MID_Y, _fgZoom, 400);

        // Mouse / touch aim: moving the pointer anywhere on screen directly
        // controls aimValue (Y position mapped into -1..+1 across the cone spread).
        // A tap/click on the field locks the aim and starts the charge.
        const spread = 150;
        this._fgMoveHandler = (ptr) => {
            if (this.phase !== 'fgaim') return;
            // Map pointer Y to aimValue: centre of field = 0, top = -1, bottom = +1.
            const raw = (ptr.y - FIELD.MID_Y) / spread;
            this.aimValue = Phaser.Math.Clamp(raw, -1, 1);
            this.aimDir = 0; // moving manually — stop the auto-sweep
        };
        this._fgClickHandler = (ptr) => {
            if (this.phase !== 'fgaim') return;
            // Update aim to where they tapped, then lock + begin charge.
            const raw = (ptr.y - FIELD.MID_Y) / spread;
            this.aimValue = Phaser.Math.Clamp(raw, -1, 1);
            this.lockAim();
            this.startKickCharge();
        };
        this.input.on('pointermove', this._fgMoveHandler);
        this.input.on('pointerdown', this._fgClickHandler);
    }

    _clearFgPointers() {
        if (this._fgMoveHandler) { this.input.off('pointermove', this._fgMoveHandler); this._fgMoveHandler = null; }
        if (this._fgClickHandler) { this.input.off('pointerdown', this._fgClickHandler); this._fgClickHandler = null; }
    }

    lockAim() {
        if (this.phase !== 'fgaim') return;
        this._clearFgPointers();
        this.aimLocked = this.aimValue;
        this.audio.play('select');
        // Accessibility: easy-throw mode skips the kick charge and kicks at
        // ideal power immediately after the aim is locked.
        if (easyThrowOn()) {
            this.phase = 'anim';
            this.audio.speak('Kicking.', true);
            this.kickFieldGoal(this.aimLocked, this.idealKickPower());
            return;
        }
        this.beginKickCharge();
    }

    beginKickCharge() {
        this.phase = 'fgcharge';
        this.kickPower = 0; this.kickCharging = false; this.kickCuePlayed = false;
    }

    startKickCharge() {
        if (this.kickCharging) return;
        this.kickCharging = true; this.kickPower = 0; this.kickCuePlayed = false;
        this.audio.play('charge');
    }

    releaseKickCharge() {
        if (!this.kickCharging) return;
        this.kickCharging = false;
        this.phase = 'anim';
        // Already zoomed on the goal posts since beginFgAim — just kick.
        this.kickFieldGoal(this.aimLocked, this.kickPower);
    }

    idealKickPower() {
        return Phaser.Math.Clamp(38 + this.fgDist * 1.1, 35, 100);
    }

    kickFieldGoal(aim, power) {
        const ideal = this.idealKickPower();
        const enough = power >= ideal * 0.9;
        const onTarget = Math.abs(aim) <= this.aimWindow;
        const made = enough && onTarget;
        this.audio.play('kick');

        const start = { x: ydToX(this.gs.ballPosition), y: FIELD.MID_Y };
        this.ball.visible = true; this.ball.carrier = null; this.ball.x = start.x; this.ball.y = start.y;
        const goalX = FIELD.GOAL_R + 30;
        const reach = Phaser.Math.Clamp(power / ideal, 0.4, 1.12);
        const endX = enough ? goalX : start.x + (goalX - start.x) * reach;
        // Wide kicks drift further off; on-target kicks split the uprights.
        const endY = FIELD.MID_Y + aim * 60 + (onTarget ? 0 : (aim >= 0 ? 55 : -55));
        const peak = 70 + this.fgDist * 1.4;

        this.tweens.add({
            targets: start, x: endX, y: endY, duration: 880, ease: 'Quad.easeOut',
            onUpdate: (tw) => {
                const t = tw.progress;
                this.ball.x = start.x;
                this.ball.y = start.y - Math.sin(t * Math.PI) * peak; // simple arc
            },
            onComplete: () => {
                this.ball.visible = false;
                this._zoomOut(500);
                if (made) {
                    this.audio.play('fieldgoal'); this.audio.play('crowd_big');
                    if (this.isPAT) {
                        this.gs.score.us += 1; this.updateHUD();
                        this.bigMessage('EXTRA POINT GOOD!  +1', 1500, () => { this.isPAT = false; this.kickToOpponent(); });
                    } else {
                        this.gs.score.us += 3; this.updateHUD();
                        this.bigMessage('FIELD GOAL!  +3', 1700, () => this.kickToOpponent());
                    }
                } else {
                    this.audio.play('fail');
                    const why = !enough ? 'SHORT' : (aim < 0 ? 'WIDE LEFT' : 'WIDE RIGHT');
                    if (this.isPAT) {
                        this.bigMessage('EXTRA POINT NO GOOD', 1500, () => { this.isPAT = false; this.kickToOpponent(); });
                    } else {
                        this.bigMessage('NO GOOD — ' + why, 1600, () => {
                        // NFL rule: opponent gets ball at spot of kick; minimum their own 20.
                        this.defenseDrive(Math.min(this.gs.ballPosition, 80));
                    });
                    }
                }
            }
        });
    }

    // Draw the aiming cone, the scoring window between the uprights, and the
    // sweeping aim indicator.
    drawFgAim() {
        const m = this.markerGfx;
        const kx = ydToX(this.gs.ballPosition), ky = FIELD.MID_Y;
        const goalX = FIELD.GOAL_R;
        const spread = 150;
        // Cone fan from the kick spot toward the goal.
        m.fillStyle(0xffffff, 0.05);
        m.fillTriangle(kx, ky, goalX, ky - spread, goalX, ky + spread);
        m.lineStyle(2, 0xffffff, 0.22);
        m.lineBetween(kx, ky, goalX, ky - spread);
        m.lineBetween(kx, ky, goalX, ky + spread);
        // Scoring window between the uprights. Lights up brightly when the
        // sweeping reticle is inside it (basketball-shooter style cue).
        const onTarget = Math.abs(this.aimValue) <= this.aimWindow;
        const winH = spread * this.aimWindow;
        m.fillStyle(0x4caf50, onTarget ? 0.42 : 0.16);
        m.fillRect(goalX - 4, ky - winH, 30, winH * 2);
        // Uprights (yellow posts) at the edges of the scoring window.
        m.lineStyle(6, onTarget ? 0x9dff5a : 0xffe14d, onTarget ? 1 : 0.95);
        m.lineBetween(goalX + 22, ky - winH - 26, goalX + 22, ky - winH);
        m.lineBetween(goalX + 22, ky + winH, goalX + 22, ky + winH + 26);
        m.lineBetween(goalX + 22, ky - winH, goalX + 22, ky + winH); // crossbar-ish base
        // Sweeping aim indicator.
        const ay = ky + this.aimValue * spread;
        m.lineStyle(3, onTarget ? 0x66ff66 : 0xffffff, 0.95);
        m.lineBetween(kx, ky, goalX + 24, ay);
        m.fillStyle(onTarget ? 0x66ff66 : 0xff5555, 1);
        m.fillCircle(goalX + 24, ay, 9);
    }

    drawKickMeter() {
        const g = this.meterGfx;
        g.clear();
        const x = W - 60, y = 90, w = 30, h = 360;
        g.fillStyle(0x000000, 0.6); g.fillRoundedRect(x, y, w, h, 6);
        const ideal = this.idealKickPower();
        // Make-it band runs from 90% of the needed power up to full (clamped in bar).
        const lo = Phaser.Math.Clamp(ideal * 0.9, 0, 100);
        const yHi = y;                       // hi = 100 -> bar top
        const yLo = y + h * (1 - lo / 100);
        g.fillStyle(0x4caf50, 0.5); g.fillRect(x, yHi, w, yLo - yHi);
        const fillH = h * (this.kickPower / 100);
        g.fillStyle(this.kickCuePlayed ? 0x66ff66 : 0xffd54f, 0.95);
        g.fillRect(x, y + h - fillH, w, fillH);
        g.lineStyle(2, 0xffffff, 0.9); g.strokeRoundedRect(x, y, w, h, 6);
    }

    execPunt() {
        this.phase = 'anim';
        const net = 35 + Math.floor(Math.random() * 12);
        const oppStartFromUs = Phaser.Math.Clamp(this.gs.ballPosition + net, 0, 99);
        const startX = ydToX(this.gs.ballPosition);
        const landX  = ydToX(oppStartFromUs);
        const midY   = FIELD.MID_Y;

        // Punter (QB slot) takes a short drop-step before the kick.
        const punter = this.offense[0];
        this.jog(punter, startX - 18, midY, 320, 'Quad.easeOut');

        // Gunners sprint downfield toward the landing spot.
        this.offense.forEach((p, i) => {
            if (i === 0) return;
            this.jog(p, landX - 30 + Math.random() * 60, midY + (Math.random() - 0.5) * 80, 1200, 'Sine.easeIn');
        });

        // Returner (deepest safety) runs toward the landing spot.
        const returner = this.defense[5] || this.defense[4];
        if (returner) this.jog(returner, landX + 12, midY, 1100, 'Sine.easeIn');

        this.time.delayedCall(350, () => {
            this.audio.play('kick');
            const ball = this.ball;
            ball.visible = true; ball.carrier = null;
            ball.x = startX; ball.y = midY;
            const flight = { x: startX, y: midY };
            this.tweens.add({
                targets: flight, x: landX, y: midY, duration: 900, ease: 'Quad.easeOut',
                onUpdate: (tw) => {
                    ball.x = flight.x;
                    ball.y = midY - Math.sin(tw.progress * Math.PI) * 120;
                },
                onComplete: () => {
                    ball.visible = false;
                    this.bigMessage('PUNT', 1200, () =>
                        this.defenseDrive(Phaser.Math.Clamp(oppStartFromUs, 1, 99)));
                }
            });
        });
    }

    // ─── Resolve a completed play ──────────────────────────────────────────────
    endPlay(yards, type) {
        // Clean up any receiver tap zones left over (e.g. sack before selection).
        if (this._recPointerZones) {
            this._recPointerZones.forEach(z => { z.player.off('pointerdown', z.fn); z.player.disableInteractive(); });
            this._recPointerZones = null;
        }
        const gs = this.gs;
        gs.ballPosition = Phaser.Math.Clamp(gs.ballPosition + yards, 0, 100);

        let sub = '';
        if (type === 'incomplete') sub = 'Incomplete pass';
        else if (yards < 0) sub = `Loss of ${-yards}`;
        else if (yards === 0) sub = 'No gain';
        else sub = `Gain of ${yards}`;

        // ── 2-point conversion result ─────────────────────────────────────────
        if (this._is2pt) {
            this._is2pt = false;
            this._zoomOut(400);
            if (gs.ballPosition >= 100) {
                gs.score.us += 2; this.updateHUD();
                this.audio.play('touchdown');
                this.bigMessage('2-PT CONVERSION GOOD!  +2', 1600, () => {
                    this._zoomOut(350);
                    this.time.delayedCall(370, () => this.kickToOpponent());
                });
            } else {
                this.audio.play('fail');
                this.bigMessage('2-PT CONVERSION STOPPED', 1400, () => {
                    this._zoomOut(350);
                    this.time.delayedCall(370, () => this.kickToOpponent());
                });
            }
            return;
        }

        // Touchdown?
        if (gs.ballPosition >= 100) {
            gs.score.us += 6; this.updateHUD();
            // Run celebration before the message so the player sees the spike + wiggle.
            const scorer = this.ball.carrier;
            this.ball.carrier = null;
            this._doTDCelebration(scorer);
            this.audio.play('touchdown'); this.audio.play('crowd_big');
            this.bigMessage('TOUCHDOWN!', 1800, () => this.showAfterTouchdownMenu());
            return;
        }

        // First down?
        if (gs.ballPosition >= gs.firstDownTarget) {
            gs.down = 1;
            gs.firstDownTarget = Math.min(gs.ballPosition + 10, 100);
            gs.yardsToGo = gs.firstDownTarget - gs.ballPosition;
            this.updateHUD();
            this.flashSub(`${sub}. FIRST DOWN!`);
            this.audio.speak(`${sub}! First down!`, true);
            this.resetForNextSnap(() => this.checkClockThen(() => this.showPlayCall()));
            return;
        }

        gs.down++;
        gs.yardsToGo = gs.firstDownTarget - gs.ballPosition;
        if (gs.down > 4) {
            this.updateHUD();
            this._zoomOut(380);
            this.bigMessage('TURNOVER ON DOWNS', 1800, () => this.turnover('downs'));
            return;
        }
        this.updateHUD();
        this.flashSub(`${sub}. ${this._downSpeech()}.`);
        this.audio.speak(`${sub}.`, true);
        this.resetForNextSnap(() => this.checkClockThen(() => this.showPlayCall()));
    }

    // Smoothly jog everyone back to the new line of scrimmage before the next snap.
    resetForNextSnap(cb) {
        this.phase = 'transition';
        this._zoomOut(380);
        // Delay the huddle sound so the play-result TTS can finish speaking.
        this.time.delayedCall(1600, () => this.audio.play('huddle'));
        // Long formation tween + generous pause so commentary fully plays out before
        // the play menu opens and ScanList starts announcing the first option.
        this.tweenFormation(this.gs.ballPosition, 1200, () => this.time.delayedCall(2200, cb));
    }

    turnover(reason) {
        // Opponent takes over at the current spot (measured in our yard line).
        this.defenseDrive(Phaser.Math.Clamp(this.gs.ballPosition, 1, 99));
    }

    // Announce the current score before a kickoff so low-vision players always
    // know the standing after a score. e.g. "Blue leads 10 to 7" or "Tied 7 each".
    _speakScore() {
        const us = this.gs.score.us, them = this.gs.score.them;
        const uName = this.playerColor.name, tName = this.oppColor.name;
        let line;
        if (us > them)        line = `${uName} leads ${us} to ${them}.`;
        else if (them > us)   line = `${tName} leads ${them} to ${us}.`;
        else                  line = `Tied ${us} each.`;
        this.audio.speak(line, true);
    }

    kickToOpponent() {
        // Kickoff: we kick off to the opponent, who returns to roughly our 75.
        this._speakScore();
        this.kickoff('them');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTERACTIVE DEFENSE — you pick a defensive play; the opponent's offence
    // reacts. Field position is tracked in OUR yard line (the x the ball sits on),
    // so the opponent drives from a high yard number down toward 0 (our goal).
    // ═══════════════════════════════════════════════════════════════════════════
    defenseDrive(oppYard, isKickoff) {
        this.onDefense = true;
        // 20% chance the CPU offense is "hot" this drive — small but noticeable boost.
        this._cpuDriveHot = Math.random() < 0.20 ? 0.10 : 0;
        this.opp = {
            yard: Phaser.Math.Clamp(oppYard, 1, 99),
            down: 1,
            toGo: 10
        };
        this.opp.fdTarget = Math.max(this.opp.yard - 10, 0);
        this.showPlayers(true);
        this.updateHUD();
        if (isKickoff) {
            // After the return the players are scattered — tween them into formation
            // then pause so the return commentary finishes before the play menu appears.
            this._zoomOut(400);
            this.tweenDefense(this.opp.yard, 1000, () => this.time.delayedCall(2500, () => this.showDefPlayCall()));
        } else {
            // Always reset the camera — previous play may have left it zoomed in.
            this._zoomOut(380);
            this.repositionDefense(this.opp.yard);
            // Pause after the message so any preceding TTS (punt, FG, turnover, etc.) can finish.
            this.bigMessage(`${this.oppColor.name} BALL`, 1400, () => this.time.delayedCall(2000, () => this.showDefPlayCall()));
        }
    }

    // Opponent offence lines up to the RIGHT of the LOS (driving left toward our
    // goal); our defenders line up to the left. Reuses the sprite pools:
    // this.defense = opponent (their colour), this.offense = our defenders.
    defenseFormationPositions(losYard) {
        const losX = ydToX(losYard), midY = FIELD.MID_Y;
        const oppOff = [
            { x: losX + 38, y: midY },        // QB
            { x: losX + 52, y: midY + 20 },   // RB
            { x: losX + 8, y: midY - 130 },   // WR
            { x: losX + 8, y: midY + 130 },   // WR
            { x: losX + 8, y: midY - 55 },    // TE
            { x: losX + 12, y: midY }         // OL
        ];
        const ourDef = [
            { x: losX - 14, y: midY - 12 },
            { x: losX - 14, y: midY + 12 },
            { x: losX - 48, y: midY },
            { x: losX - 26, y: midY - 120 },
            { x: losX - 26, y: midY + 120 },
            { x: losX - 95, y: midY }
        ];
        return { oppOff, ourDef };
    }

    repositionDefense(losYard) {
        // Use a smooth tween instead of an instant setPosition so there's no
        // visible warp when switching from offensive to defensive formation.
        this.tweenDefense(losYard, 700, () => {});
        this.ball.carrier = this.defense[0];
        this.ball.x = ydToX(losYard) + 24; this.ball.y = FIELD.MID_Y; this.ball.visible = true;
    }

    tweenDefense(losYard, duration, cb) {
        const { oppOff, ourDef } = this.defenseFormationPositions(losYard);
        // Defensive series run through here rather than tweenFormation, so
        // this is the path that stands a tackled CPU ball carrier back up.
        // As above, the release happens when the tween lands, not up front.
        // Kill any leftover animation tweens so kickoff/play tweens can't override the formation.
        [...this.offense, ...this.defense].forEach(p => { this.tweens.killTweensOf(p); this.stopBob(p); });
        // Anyone knocked down stays down where they fell while the rest jog
        // back; they get up as this tween lands.
        this.defense.forEach((p, i) => { if (!this._isDown(p)) this.jog(p, oppOff[i].x, oppOff[i].y, duration); });
        this.offense.forEach((p, i) => { if (!this._isDown(p)) this.jog(p, ourDef[i].x, ourDef[i].y, duration); });
        // Flip labels: this.defense sprites are now the opp offense; this.offense are our defense.
        ['QB','RB','WR','WR','TE','OL'].forEach((l, i) => this._setPlayerLabel(this.defense[i], l));
        ['DL','DL','LB','CB','CB','S'].forEach((l, i) => this._setPlayerLabel(this.offense[i], l));
        this.ball.carrier = null;
        this.ball.x = ydToX(losYard) + 24; this.ball.y = FIELD.MID_Y; this.ball.visible = true;
        this.time.delayedCall(duration + 120, () => {
            // Note the swap: on defence `this.defense` holds the opposing
            // offence and `this.offense` holds our defenders.
            const gotUp = this._standDownedPlayers(ourDef, oppOff, 420);
            this.time.delayedCall(gotUp ? 470 : 0, cb);
        });
    }

    showDefPlayCall() {
        this._saveGameState();
        this.phase = 'defcall';
        const opts = [
            { label: 'Stop the Run', value: 'STOP_RUN', hint: 'load the box' },
            { label: 'Defend Pass', value: 'DEFEND_PASS', hint: 'drop into coverage' },
            { label: 'Blitz', value: 'BLITZ', hint: 'send pressure, risk a big play' },
            { label: 'Balanced D', value: 'BALANCED', hint: 'play it safe' },
            { label: 'Pause', value: 'PAUSE' }
        ];
        this.playPanel = this.add.graphics().setDepth(40).setScrollFactor(0);
        this.playPanel.fillStyle(0x06100a, 0.94); this.playPanel.fillRect(0, 504, W, H - 504);
        this.playPanel.lineStyle(2, 0xffd700, 0.5); this.playPanel.lineBetween(0, 504, W, 504);
        this.playLabel = this.add.text(W / 2, 520, 'CHOOSE YOUR DEFENSE', {
            fontSize: '15px', fontFamily: 'Arial', fontStyle: 'bold', color: '#ffd700'
        }).setOrigin(0.5).setDepth(42).setScrollFactor(0);

        const oppToGo = this.opp.toGo <= 0 ? 'goal' : this.opp.toGo + ' to go';
        this.audio.speak(`${this.oppColor.name}. ${this._ordinal(this.opp.down)} and ${oppToGo}.`);
        const itemW = Math.min(154, Math.floor((W - 40) / opts.length) - 6);
        this.playMenu = new ScanList(this, {
            x: W / 2, y: 562, options: opts, audio: this.audio,
            columns: opts.length, itemW, itemH: 44, gap: 6, fontSize: '14px',
            onSelect: (opt) => this.onDefChosen(opt.value)
        });
        this.playMenu.setScrollFactor(0);

        // PlayDiagram for defense — same hook pattern as offense.
        const bestDef = this._getBestDefPlays();
        this.playMenu.bestPlayValues = new Set(Object.keys(bestDef));
        this.playMenu._draw();   // re-draw now that bestPlayValues is set
        const defPlayValues = opts.map(o => o.value);
        this.playDiagram = new PlayDiagram(this, defPlayValues);
        const dmenu = this.playMenu, ddiag = this.playDiagram;
        const dOrigAnnounce = dmenu._announceCurrent.bind(dmenu);
        dmenu._announceCurrent = (initial) => {
            dOrigAnnounce(initial);
            if (dmenu.index >= 0) {
                const lbl = dmenu.labels[dmenu.index];
                ddiag.show(dmenu.index, lbl ? lbl._cx : W / 2);
                // Shift defenders into the formation for the highlighted play so
                // the player can see the alignment change as they scan.
                const hov = opts[dmenu.index];
                if (hov && hov.value !== 'PAUSE') this._previewDefFormation(hov.value);
            } else { ddiag.hide(); }
        };
        const dOrigDraw = dmenu._draw.bind(dmenu);
        dmenu._draw = () => {
            dOrigDraw();
            if (dmenu.index >= 0) {
                const lbl = dmenu.labels[dmenu.index];
                ddiag.show(dmenu.index, lbl ? lbl._cx : W / 2);
            } else { ddiag.hide(); }
        };

        // On 4th down when a punt is realistic (opp is beyond midfield), our
        // deepest back drifts to punt-return depth as a standard safety measure.
        if (this.opp.down >= 4 && this.opp.yard >= 45) {
            const puntLandYard = Phaser.Math.Clamp(this.opp.yard - 40, 5, 50);
            this.jog(this.offense[5], ydToX(puntLandYard), FIELD.MID_Y, 1800, 'Sine.easeInOut');
        }
    }

    _doTDCelebration(scorer) {
        if (!scorer) return;

        // Zoom tightly onto the scorer so they fill the view and aren't buried.
        this._zoomOnPoint(scorer.x, scorer.y, 2.2, 300);

        // Scatter all other players away from the scorer so nothing blocks the view.
        const allPlayers = [...this.offense, ...this.defense];
        allPlayers.forEach(p => {
            if (p === scorer) return;
            // Push outward: players to the left go further left, right go right.
            const dx = p.x < scorer.x ? -(40 + Math.random() * 50) : (40 + Math.random() * 50);
            const dy = (Math.random() - 0.5) * 60;
            this.tweens.add({ targets: p, x: p.x + dx, y: p.y + dy, duration: 280, ease: 'Quad.easeOut' });
        });

        // Spike the ball: it drops fast and bounces on the turf. It has to
        // leave the scorer's hands, which are chest height on a sprite.
        const _spikePt = this._carryPoint(scorer);
        this.ball.x = _spikePt.x; this.ball.y = _spikePt.y; this.ball.visible = true;
        this.tweens.add({
            targets: this.ball, y: scorer.y + 20, duration: 150, ease: 'Quad.easeIn',
            onComplete: () => this.tweens.add({
                targets: this.ball, y: scorer.y - 4, duration: 80, ease: 'Quad.easeOut',
                onComplete: () => this.tweens.add({
                    targets: this.ball, y: scorer.y + 8, duration: 60, ease: 'Quad.easeIn',
                    onComplete: () => { this.ball.visible = false; }
                })
            })
        });
        // Celebration wiggle: player pumps their arms side to side.
        this.tweens.add({
            targets: scorer, angle: 22, duration: 75, yoyo: true, repeat: 5,
            ease: 'Sine.easeInOut', onComplete: () => scorer.setAngle(0)
        });
        this.cameras.main.shake(220, 0.009);
    }

    _ordinal(n) { return ['first', 'second', 'third', 'fourth'][Math.min(n, 4) - 1]; }

    onDefChosen(defId) {
        if (defId === 'PAUSE') { this.togglePause(); return; }
        // Reset all spacebar state so a held-space that committed this play
        // doesn't keep the backTimer running into the next play-call menu.
        if (this.scanInput) this.scanInput._clearSpaceState();
        if (this.playMenu) { this.playMenu.destroy(); this.playMenu = null; }
        if (this.playLabel) { this.playLabel.destroy(); this.playLabel = null; }
        if (this.playPanel) { this.playPanel.destroy(); this.playPanel = null; }
        if (this.playDiagram) { this.playDiagram.destroy(); this.playDiagram = null; }
        this.audio.play('snap');

        // On 4th down the opponent's coach decides whether to kick instead of run a play.
        if (this.opp.down >= 4) {
            const shortYardage = this.opp.toGo <= 4;  // close enough to go for it
            if (this.opp.yard <= 38) { this.oppKickFG(); return; }       // in range → field goal
            if (!shortYardage && this.opp.yard >= 55) { this.oppPunt(); return; }  // deep & not short yardage → punt
            // short yardage or 39-54 yard range → go for it (fall through and run a play)
        }
        this.resolveOppPlay(DEF_PLAYS[defId]);
    }

    resolveOppPlay(defPlay) {
        this.phase = 'oppanim';
        // Kill any lingering formation-preview tweens so the play animation
        // starts from stable, finished positions — no mid-tween conflicts.
        [...this.offense, ...this.defense].forEach(p => { this.tweens.killTweensOf(p); this.stopBob(p); });
        // Opponent AI: pass more on long-yardage / late downs, run on short yardage.
        const longish = this.opp.toGo >= 7 || this.opp.down >= 3;
        const isPass = Math.random() < (longish ? 0.68 : 0.4);

        // Sack / tackle-for-loss chance from the called defense.
        if (Math.random() < defPlay.sack) {
            const loss = isPass ? -(5 + Math.floor(Math.random() * 5)) : -(1 + Math.floor(Math.random() * 3));
            // Sacks and TFLs are always a perfect defensive outcome visually.
            this.animateOppPlay(loss, isPass ? 'sack' : 'tfl', () => this.endOppPlay(loss, isPass ? 'sack' : 'tfl'), null, null, 'perfect');
            return;
        }

        // On a pass, run the route concept: the CPU picks a target, we see who
        // they're throwing to, and the coverage we called decides the outcome.
        if (isPass) {
            this.resolveOppPass(defPlay);
            return;
        }

        // ── CPU miracle run: rare breakaway TD on any CPU run play ─────────────
        if (!isPass && Math.random() < this._miracleChance(false)) {
            const rb = this.defense[1]; // CPU's RB
            this.ball.carrier = rb; this.ball.visible = true;
            const endX = FIELD.GOAL_L - 52; // deep into the CPU scoring endzone
            this._miracleRun(
                rb, this.offense,
                rb.x, rb.y, endX, false,
                () => {
                    this.gs.score.them += 6; this.updateHUD();
                    this.bigMessage(`MIRACLE RUN! ${this.oppColor.name} TOUCHDOWN!`, 2000,
                        () => this.oppAfterTouchdown());
                }
            );
            return;
        }
        // Visual matchup quality for run plays: right call = defenders converge
        // fast (perfect), wrong call = gap opens (blown), blitz = coin flip.
        const runMatchup = defPlay.id === 'STOP_RUN'    ? 'perfect'
                         : defPlay.id === 'DEFEND_PASS' ? 'blown'
                         : defPlay.id === 'BLITZ'       ? (Math.random() < 0.5 ? 'perfect' : 'blown')
                         : 'neutral';

        let base = (3 + Math.random() * 5);
        base += defPlay.runMod;
        // Difficulty boost: more yards when CPU is in comeback/hot-streak mode.
        const cpuBoost = this._cpuBoost();
        base += cpuBoost * (5 + Math.random() * 6);
        // Occasional big play (less likely when the matchup was correct).
        if (Math.random() < (runMatchup === 'perfect' ? 0.04 : runMatchup === 'blown' ? 0.22 : 0.10))
            base += 6 + Math.random() * 12;
        let yards = Math.round(base);
        // Stuff chance reduced when CPU is boosted.
        if (Math.random() < Math.max(0.04, 0.18 - cpuBoost * 0.6)) yards = Math.min(yards, -1 - Math.floor(Math.random() * 2));
        // CPU score pressure: their offence cools off as they pile points on.
        const cpuSP = this._scorePressure(this.gs.score.them);
        if (cpuSP > 0 && Math.random() < cpuSP * 1.1) yards = Math.max(yards - (2 + Math.floor(Math.random() * 4)), -2);
        if (this.gs.score.them > 35 && yards > 2) yards = Math.max(2, yards - (2 + Math.floor(Math.random() * 3)));
        yards = Phaser.Math.Clamp(yards, -6, this.opp.yard);

        this.animateOppPlay(yards, 'run', () => this.endOppPlay(yards, 'run'), null, null, runMatchup);
    }

    // Opponent dropback pass: their receivers run routes, the defense YOU called
    // blankets them, the CPU targets the man we left most open, and we get to see
    // the target highlighted before the ball arrives.
    resolveOppPass(defPlay) {
        this.phase = 'oppanim';
        const midY = FIELD.MID_Y;
        // Capture the snap yard-line before anything mutates it so route targets
        // and yardage calculations both reference the same starting position.
        const startYard = this.opp.yard;
        const recs = [this.defense[2], this.defense[3], this.defense[4]].filter(Boolean);
        const dbs = [this.offense[3], this.offense[4], this.offense[5]].filter(Boolean);

        // How tightly we cover depends on the called defense.
        let coverDist;
        switch (defPlay.id) {
            case 'DEFEND_PASS': coverDist = [1, 1, 1]; break;  // blanket coverage
            case 'BALANCED':    coverDist = [1, 1, 0]; break;
            case 'STOP_RUN':    coverDist = [1, 0, 0]; break;  // soft coverage
            case 'BLITZ':       coverDist = [1, 0, 0]; break;  // holes behind the rush
            default:            coverDist = [1, 1, 0];
        }
        coverDist = Phaser.Utils.Array.Shuffle([...coverDist]);

        let di = 0;
        const recInfo = recs.map((p, k) => {
            const cov = coverDist[k] || 0;
            const defenders = [];
            for (let c = 0; c < cov && di < dbs.length; c++) defenders.push(dbs[di++]);
            return { player: p, cov, defenders };
        });

        // The CPU usually throws to its most open man, sometimes forces it.
        const byOpen = [...recInfo].sort((a, b) => a.cov - b.cov);
        const target = (Math.random() < 0.78) ? byOpen[0] : Phaser.Utils.Array.GetRandom(recInfo);
        this.oppTarget = target.player;

        // ── Compute outcome BEFORE routing so the target receiver's route ─────
        // endpoint can match the actual gain. Previously, routes were always
        // 5–11 yards deep regardless of the reported gain, so short completions
        // would show the receiver already past the endpoint → carrier barely
        // moved → "gain of 1" after an 8-yard visual route (the core mismatch).
        const cpuSP        = this._scorePressure(this.gs.score.them);
        const cpuBoostPass = this._cpuBoost();
        const intChance  = [0.06, 0.20, 0.38][target.cov];
        const buChance   = Math.max(0.04, [0.14, 0.30, 0.38][target.cov] - cpuBoostPass * 0.4);
        const missChance = Math.max(0.02, 0.10 + cpuSP * 0.6 + (this.gs.score.them > 35 ? 0.12 : 0) - cpuBoostPass * 0.35);
        const roll = Math.random();
        let passOutcome, passYards = 0;
        if (roll < intChance) {
            passOutcome = 'int';
        } else if (roll < intChance + buChance || Math.random() < missChance) {
            passOutcome = 'incomplete';
        } else {
            passOutcome = 'complete';
            let base = (target.cov === 0 ? 7 + Math.random() * 11 : 4 + Math.random() * 6) + defPlay.passMod;
            base += cpuBoostPass * (4 + Math.random() * 5);
            const bigChance = (target.cov === 0 ? 0.14 : 0) * (1 - cpuSP) + cpuBoostPass * 0.10;
            if (Math.random() < bigChance) base += 6 + Math.random() * 12;
            base *= (1 - cpuSP * 0.5);
            passYards = Phaser.Math.Clamp(Math.round(base), 1, startYard);
        }
        const passMatchup = target.cov >= 2 ? 'perfect' : target.cov === 1 ? 'neutral' : 'blown';
        const myDef = target.defenders[0] || this.offense[3];

        // ── Route receivers. For a completion the target goes to their catch ──
        // point: roughly 50–80 % of the gain as route depth, rest is YAC.
        // This guarantees that carrier.x is never already past endX when
        // _startRun fires, so the run-after-catch animation covers the correct
        // remaining distance and the total visual movement matches the game result.
        recInfo.forEach((ri, k) => {
            let tx;
            if (passOutcome === 'complete' && ri === target && passYards >= 1) {
                // Route the TARGET to the catch point so the run-after-catch
                // covers exactly the remaining yards to the tackle spot.
                // routeYards is 50–80 % of the gain, clamped to [0, passYards-1]
                // so there is always at least 1 yard of visible run after the catch.
                // For a 1-yard gain this means catch at the LOS then run 1 yard.
                const raw = Math.round(passYards * (0.5 + Math.random() * 0.3));
                const routeYards = Phaser.Math.Clamp(raw, 0, passYards - 1);
                tx = ydToX(Phaser.Math.Clamp(startYard - routeYards, 1, 99));
            } else {
                // Non-target, incomplete, INT, or negative gain: random route depth.
                tx = ri.player.x - 46 - Math.random() * 40;
            }
            // Give each receiver a distinct route shape (same as before).
            const rawAngle  = k === 0 ? (Math.random() - 0.5) * 60
                            : k === 1 ? (Math.random() < 0.5 ? 1 : -1) * (18 + Math.random() * 26)
                            :           (Math.random() - 0.5) * 38;
            const routeAngle = Phaser.Math.Clamp(
                ri.player.y + rawAngle, FIELD.TOP + 22, FIELD.BOTTOM - 22) - ri.player.y;
            const ty = ri.player.y + routeAngle;
            this.jog(ri.player, tx, ty, 1100, 'Sine.easeOut');
            ri.defenders.forEach((d, i) => { if (d) this.jog(d, tx + (i ? -18 : 18), ty + 12, 1150, 'Sine.easeOut'); });
        });
        const qb = this.defense[0];
        this.jog(qb, qb.x + 26, midY, 700);
        if (this.offense[0]) this.jog(this.offense[0], qb.x + 40, midY - 14, 1150);
        if (this.offense[1]) this.jog(this.offense[1], qb.x + 40, midY + 14, 1150);

        const side = target.player.y < midY - 40 ? 'left'
            : (target.player.y > midY + 40 ? 'right' : 'the middle');
        // Zoom onto the QB/receiver side so the routes are readable.
        this._zoomOnPoint(qb.x - 60, target.player.y, 1.45, 380);
        this.audio.speak(`Quarterback drops back, looking ${side}.`, true);

        this.time.delayedCall(1220, () => {
            this.audio.speak(target.cov === 0 ? 'Open!' : 'Into coverage.', true);
            if (passOutcome === 'int') {
                this.animateOppInterception(target.player, myDef);
            } else if (passOutcome === 'incomplete') {
                this.animateOppPlay(0, 'incomplete', () => this.endOppPlay(0, 'incomplete'), target.player, myDef);
            } else {
                this.animateOppPlay(passYards, 'pass', () => this.endOppPlay(passYards, 'pass'), target.player, null, passMatchup);
            }
        });
    }

    // One of OUR defenders steps in front of the throw and takes it the other way.
    animateOppInterception(wrOverride, defOverride) {
        this.phase = 'oppanim';
        this.oppTarget = null;
        const qb = this.defense[0];                   // CPU QB
        const wr = wrOverride || this.defense[2];     // CPU's intended receiver
        const myDef = defOverride || this.offense[3]; // our cornerback who breaks on the ball
        this.ball.visible = true; this.ball.carrier = null;
        const _qbPt = this._carryPoint(qb);
        this.ball.x = _qbPt.x; this.ball.y = _qbPt.y;
        this.playPlayerAction(qb, 'throw', wr);
        // Zoom onto the route endpoint so the pick is clearly visible.
        this._zoomOnPoint(wr.x, wr.y, 1.6, 320);
        this.audio.speak('Up for grabs!', true);
        // Our defender breaks toward the catch point.
        this.jog(myDef, wr.x - 6, wr.y - 10, 640, 'Sine.easeOut');
        // The art holds the ball until frame 5, so the flight waits for the
        // release rather than setting off during the wind-up.
        const _release = this._throwReleaseDelay(qb);
        const flight = { x: _qbPt.x, y: _qbPt.y };
        this.tweens.add({
            targets: flight, x: wr.x - 6, y: wr.y - 10, duration: 660, delay: _release, ease: 'Sine.easeInOut',
            onUpdate: () => { this.ball.x = flight.x; this.ball.y = flight.y; },
            onComplete: () => {
                this.ball.carrier = myDef;
                this.playPlayerAction(myDef, 'catch', qb);
                this.audio.play('interception'); this.audio.play('crowd_big');
                this.audio.speak('Intercepted!', true);
                this.tweens.killTweensOf(myDef); this.stopBob(myDef);

                // ── Full return run toward our scoring end zone (right / high yards) ──
                // opp.yard is in OUR yard numbers (they drive high→0).
                // After a pick our player runs right → returnToYard = opp.yard + return.
                const catchYard   = Phaser.Math.Clamp(this.opp.yard, 1, 99);
                const returnYards = 5 + Math.floor(Math.random() * 20);
                const returnToYard = catchYard + returnYards;             // may exceed 100 (pick-six)
                const isPickSix   = returnToYard >= 100;
                const endX = isPickSix ? FIELD.GOAL_R + 52 : ydToX(Phaser.Math.Clamp(returnToYard, 1, 99));
                const midY    = FIELD.MID_Y;
                const totalDur = 1300 + Math.min(returnYards, 28) * 50;
                const laneDir  = myDef.y <= midY ? 1 : -1;
                const lane     = laneDir * (12 + Math.random() * 24);
                const midRunX  = (myDef.x + endX) * 0.5;

                this._zoomOnPoint(myDef.x, myDef.y, 1.7, 260);
                this.startBob(myDef);
                this.tweens.add({
                    targets: myDef, x: midRunX,
                    y: Phaser.Math.Clamp(myDef.y + lane, FIELD.TOP + 14, FIELD.BOTTOM - 14),
                    duration: totalDur * 0.5, ease: 'Sine.easeOut',
                    onComplete: () => {
                        this._zoomOnPoint(myDef.x + (endX - myDef.x) * 0.35, midY, 1.4, 260);
                        this.tweens.add({
                            targets: myDef, x: endX,
                            y: Phaser.Math.Clamp(myDef.y + lane * 0.3, FIELD.TOP + 14, FIELD.BOTTOM - 14),
                            duration: totalDur * 0.5, ease: 'Sine.easeIn',
                            onComplete: () => {
                                this.stopBob(myDef);
                                this.ball.carrier = null;
                                this.onDefense = false;
                                if (isPickSix) {
                                    this.gs.score.us += 6; this.updateHUD();
                                    this.audio.play('touchdown'); this.audio.play('crowd_big');
                                    this._zoomOnPoint(myDef.x, myDef.y, 2.2, 280);
                                    this.cameras.main.shake(220, 0.009);
                                    this._doTDCelebration(myDef);
                                    this.bigMessage('PICK SIX! TOUCHDOWN!', 2000, () =>
                                        this.checkClockThen(() => this.showAfterTouchdownMenu()));
                                } else {
                                    const rushDur = this._rushIntoTackle(this.defense, myDef.x, myDef.y);
                                    this.time.delayedCall(rushDur, () => {
                                        this.audio.play('tackle');
                                        this.tackleShake(myDef);
                                        this.bigMessage('INTERCEPTED!', 1700, () =>
                                            this.checkClockThen(() =>
                                                this.startUsDrive(Phaser.Math.Clamp(returnToYard, 1, 99))));
                                    });
                                }
                            }
                        });
                    }
                });
                // CPU offense chases our returner.
                this.time.delayedCall(totalDur * 0.15, () => {
                    this._convergePlayers(this.defense, endX,
                        myDef.y + lane * 0.35, totalDur * 0.78);
                });
                // Our other players escort/block downfield.
                this.offense.forEach(p => {
                    if (p === myDef) return;
                    this.jog(p,
                        (myDef.x + endX) * 0.5 + 18 + Math.random() * 28,
                        p.y + (Math.random() - 0.5) * 40,
                        totalDur * 0.75 + Math.random() * 200);
                });
            }
        });
    }

    // Move the opponent ball-carrier left by the gained yards; our defenders pursue.
    // matchup: 'perfect' | 'neutral' | 'blown' — controls lane width and how
    // quickly defenders converge, making the right/wrong play call visually obvious.
    animateOppPlay(yards, type, done, wrOverride, defOverride, matchup) {
        this.oppTarget = null;
        const mq = matchup || 'neutral';
        // Incomplete pass: the throw sails to the receiver and falls to the turf.
        if (type === 'incomplete') {
            const qb = this.defense[0], wr = wrOverride || this.defense[2], myDef = defOverride || this.offense[3];
            this.ball.visible = true; this.ball.carrier = null;
            const _qbPt = this._carryPoint(qb);
            this.ball.x = _qbPt.x; this.ball.y = _qbPt.y;
            this.playPlayerAction(qb, 'throw', wr);
            this.audio.speak('Knocked away.', true);
            this.jog(myDef, wr.x + 4, wr.y - 6, 560, 'Sine.easeOut'); // defender contests
            // Everyone else is in motion too: receivers run routes, our defenders
            // drop into coverage, the opposing line blocks. Nobody stands still.
            this.defense.forEach((p, i) => {
                if (i === 0 || i === 2) return; // QB stays, target WR handled above
                this.jog(p, p.x - 26 - Math.random() * 30, p.y + (Math.random() - 0.5) * 50, 620 + Math.random() * 200);
            });
            this.offense.forEach((p, i) => {
                if (i === 3) return; // contesting defender handled above
                this.jog(p, p.x - 14 + Math.random() * 24, p.y + (Math.random() - 0.5) * 40, 600 + Math.random() * 220);
            });
            // The art holds the ball until frame 5, so the flight waits for the
        // release rather than setting off during the wind-up.
        const _release = this._throwReleaseDelay(qb);
        const flight = { x: _qbPt.x, y: _qbPt.y };
            this.tweens.add({
                targets: flight, x: wr.x, y: wr.y + 16, duration: 620, delay: _release, ease: 'Sine.easeIn',
                onUpdate: () => { this.ball.x = flight.x; this.ball.y = flight.y; },
                onComplete: () => { this.audio.play('fail'); this.ball.visible = false; done(); }
            });
            return;
        }

        const startYard = this.opp.yard;
        const endYard = Phaser.Math.Clamp(startYard - yards, 0, 100);
        const startX = ydToX(startYard);
        // On a TD the carrier runs well into the endzone so it's visually clear
        // they crossed — not just stopped at the goal line.
        const endX = endYard <= 0 ? FIELD.GOAL_L - 58 : ydToX(endYard);
        const midY = FIELD.MID_Y;
        const carrier = type === 'pass' ? (wrOverride || this.defense[2]) : this.defense[1]; // WR on pass, RB on run
        // Capture the carrier's position BEFORE any tweens so run paths are relative
        // to where they actually caught the ball, not the absolute field center.
        const carrierStartY = carrier.y;
        // Lean away from field center so the carrier seeks open space, not traffic.
        const sideDir = carrierStartY <= FIELD.MID_Y ? -1 : 1;
        // Matchup quality widens or narrows the running lane:
        //   perfect → defense fills the gap, lane is tight
        //   blown   → defense misread it, carrier finds open space
        const laneMult = mq === 'perfect' ? 0.45 : mq === 'blown' ? 1.55 : 1.0;
        const lane = sideDir * (type === 'pass' ? 28 + Math.random() * 44 : 12 + Math.random() * 30) * laneMult;

        const _startRun = () => {
            // Kill any route-jog tween still running on the carrier (e.g. the last
            // fraction of a 1650ms jog) so it can't fight the run-after-catch tween.
            this.tweens.killTweensOf(carrier);
            this.stopBob(carrier);
            // If the CPU receiver catches the ball already at or past the goal line
            // it's an immediate TD. Use this.opp.yard (full remaining distance) when
            // calling endOppPlay to guarantee the TD registers — the `yards` variable
            // from resolveOppPass is clamped to opp.yard and may fall 1-2 yards short
            // if base rounded down, which would cause the receiver to visually enter
            // the endzone yet get spotted at the 1-yard line.
            if (type === 'pass' && carrier.x <= FIELD.GOAL_L + 8) {
                this.audio.play('catch');
                this.audio.speak('Touchdown!', true);
                this.ball.carrier = carrier; this.ball.visible = true;
                const tdYards = this.opp.yard; // guarantees o.yard - tdYards = 0 in endOppPlay
                // Carry the receiver clearly into the endzone — if they caught near
                // the goal line, animate a quick burst deeper so it never looks like
                // they stopped right on the line.
                const tdTargetX = Math.min(carrier.x, FIELD.GOAL_L - 42);
                if (carrier.x > tdTargetX + 8) {
                    this.startBob(carrier);
                    this.tweens.add({
                        targets: carrier, x: tdTargetX, duration: 270, ease: 'Sine.easeOut',
                        onComplete: () => {
                            this.stopBob(carrier);
                            this._zoomOnPoint(carrier.x, carrier.y, 2.2, 280);
                            this.time.delayedCall(300, () => { this.ball.carrier = null; this.endOppPlay(tdYards, 'pass'); });
                        }
                    });
                } else {
                    this._zoomOnPoint(carrier.x, carrier.y, 2.2, 280);
                    this.time.delayedCall(320, () => { this.ball.carrier = null; this.endOppPlay(tdYards, 'pass'); });
                }
                return;
            }
            // Zoom onto the carrier so the defense pursuit reads clearly.
            this._zoomOnPoint(carrier.x, carrier.y, 1.5, 280);
            this.ball.carrier = carrier; this.ball.visible = true;

            const dur = Math.max(1200, Math.abs(endYard - startYard) * 70 + 980);
            // For pass plays, the receiver ran their route leftward during coverage.
            // If they already passed endX (overshot), carry them a little further
            // for natural momentum rather than running them backward or barely moving.
            const passOvershot = type === 'pass' && carrier.x < endX;
            const fwdEndX = passOvershot
                ? carrier.x - (10 + Math.random() * 20)   // small momentum carry
                : endX;
            const runFromX = (type === 'pass') ? carrier.x : startX;
            const midX = (runFromX + fwdEndX) / 2;

            // Clamp carrier Y so raw tweens never carry them outside the field.
            const clampFY = (y) => Phaser.Math.Clamp(y, FIELD.TOP + 14, FIELD.BOTTOM - 14);
            const midLaneY = clampFY(carrierStartY + lane);
            const endLaneY = clampFY(carrierStartY + lane * 0.35);

            // Raw tweens (not jog) so the tackle fires in onComplete — exactly when
            // the carrier reaches their tackle spot, never before.
            this.startBob(carrier);
            this.tweens.add({
                targets: carrier, x: midX, y: midLaneY, duration: dur * 0.5, ease: 'Sine.easeOut',
                onComplete: () => {
                    this.tweens.add({
                        targets: carrier, x: fwdEndX, y: endLaneY, duration: dur * 0.5, ease: 'Sine.easeIn',
                        onComplete: () => {
                            this.stopBob(carrier);
                            // Touchdown — no tackle. Carrier is already past the
                            // goal line, so zoom in and celebrate like player-offense TDs.
                            if (endYard <= 0) {
                                this._zoomOnPoint(carrier.x, carrier.y, 2.2, 280);
                                this.ball.carrier = null;
                                done();
                                return;
                            }
                            // Guarantee our defenders are visibly running in at contact.
                            const rushDur = this._rushIntoTackle(this.offense, carrier.x, carrier.y);
                            this.time.delayedCall(rushDur, () => {
                                this.audio.play('tackle');
                                this.tackleShake(carrier);
                                this._zoomOut(380);
                                this.ball.carrier = null;
                                done();
                            });
                        }
                    });
                }
            });
            // The rest of the opposing team blocks/escorts toward the play.
            this.defense.forEach((p) => {
                if (p === carrier) return;
                this.jog(p,
                    (startX + endX) / 2 - 20 - Math.random() * 30,
                    p.y + (Math.random() - 0.5) * 40,
                    dur * 0.85 + Math.random() * 200);
            });
            // Our defenders react first — step to the opposite side of the CPU
            // carrier's lane so they must converge diagonally (pursuit angle).
            // All Y values clamped so no defender can step outside the field.
            const defOpp = -(lane >= 0 ? 1 : -1);
            const _dcy = (y) => Phaser.Math.Clamp(y, FIELD.TOP + 14, FIELD.BOTTOM - 14);
            this.tweens.add({ targets: this.offense[0], x: this.offense[0].x - 20, y: _dcy(this.offense[0].y + defOpp * 54), duration: 300, ease: 'Sine.easeOut' });
            this.tweens.add({ targets: this.offense[1], x: this.offense[1].x - 20, y: _dcy(this.offense[1].y - defOpp * 54), duration: 300, ease: 'Sine.easeOut' });
            this.tweens.add({ targets: this.offense[2], x: this.offense[2].x - 8,  y: _dcy(this.offense[2].y + defOpp * 62), duration: 360, ease: 'Sine.easeOut' });
            // After the read step, converge from the displaced positions.
            const convR    = mq === 'perfect' ? 240 : mq === 'blown' ? 75  : 140;
            const convDur  = dur * (mq === 'perfect' ? 0.42 : mq === 'blown' ? 0.82 : 0.60);
            this.time.delayedCall(dur * 0.32, () => {
                this._convergePlayers(this.offense, fwdEndX, carrierStartY + lane * 0.4, convDur, { closeRadius: convR });
            });
        };

        if (type === 'pass') {
            // Show the ball flying from QB to receiver before the run-after-catch.
            const qb = this.defense[0];
            this.ball.visible = true; this.ball.carrier = null;
            const _qbPt = this._carryPoint(qb);
            this.ball.x = _qbPt.x; this.ball.y = _qbPt.y;
            this.playPlayerAction(qb, 'throw', carrier);
            this.audio.speak('Complete!', true);
            this.audio.play('throw');
            const flightDur = 380 + Math.abs(carrier.x - qb.x) * 0.55;
            // The art holds the ball until frame 5, so the flight waits for the
        // release rather than setting off during the wind-up.
        const _release = this._throwReleaseDelay(qb);
        const flight = { x: _qbPt.x, y: _qbPt.y };
            this.tweens.add({
                targets: flight, x: carrier.x, y: carrier.y, duration: flightDur, delay: _release, ease: 'Sine.easeInOut',
                onUpdate: () => { this.ball.x = flight.x; this.ball.y = flight.y; },
                onComplete: () => {
                    this.audio.play('catch');
                    _startRun();
                }
            });
        } else {
            this.audio.speak(type === 'sack' ? 'Sacked!' : (type === 'tfl' ? 'Stuffed!' : 'Handoff!'), true);
            _startRun();
        }
    }

    endOppPlay(yards, type) {
        const o = this.opp;
        o.yard = Phaser.Math.Clamp(o.yard - yards, 0, 100);

        let sub;
        if (type === 'sack') sub = `Sack for ${-yards}`;
        else if (type === 'tfl') sub = `Stuffed for ${-yards}`;
        else if (type === 'incomplete') sub = 'Incomplete';
        else if (yards < 0) sub = `Loss of ${-yards}`;
        else if (yards === 0) sub = 'No gain';
        else sub = `${this.oppColor.name} gains ${yards}`;

        // Opponent touchdown?
        if (o.yard <= 0) {
            this.gs.score.them += 6; this.updateHUD();
            this.audio.play('touchdown');
            this.bigMessage(`${this.oppColor.name} TOUCHDOWN`, 1800, () => this.oppAfterTouchdown());
            return;
        }

        // Opponent first down?
        if (o.yard <= o.fdTarget) {
            o.down = 1;
            o.fdTarget = Math.max(o.yard - 10, 0);
            o.toGo = o.yard - o.fdTarget;
            this.updateHUD();
            this.flashSub(`${sub}. ${this.oppColor.name} first down.`);
            this.audio.speak(`${sub}! First down!`, true);
            this.resetDefenseSnap(() => this.checkClockThen(() => this.showDefPlayCall()));
            return;
        }

        o.down++;
        o.toGo = o.yard - o.fdTarget;
        if (o.down > 4) {
            this.updateHUD();
            this.bigMessage('STOPPED ON DOWNS!', 1700, () => {
                this.audio.speak('Stop! Your ball.', true);
                this.checkClockThen(() => this.startUsDrive(this.opp.yard));
            });
            return;
        }
        this.updateHUD();
        this.flashSub(`${sub}. ${this._ordinal(o.down)} and ${o.toGo <= 0 ? 'goal' : o.toGo}.`);
        this.audio.speak(`${sub}.`, true);
        this.resetDefenseSnap(() => this.checkClockThen(() => this.showDefPlayCall()));
    }

    resetDefenseSnap(cb) {
        this.phase = 'transition';
        this._zoomOut(380);
        this.time.delayedCall(1600, () => this.audio.play('huddle'));
        this.tweenDefense(this.opp.yard, 1200, () => this.time.delayedCall(2200, cb));
    }

    oppKickFG() {
        this.phase = 'oppanim';
        this.audio.play('kick');
        const start = { x: ydToX(this.opp.yard), y: FIELD.MID_Y };
        const fgDist = this.opp.yard + 17;
        const made = Math.random() < Phaser.Math.Clamp(1.05 - fgDist / 60, 0.35, 0.95);
        this.ball.visible = true; this.ball.carrier = null;
        const goalX = FIELD.GOAL_L - 30;
        this.tweens.add({
            targets: start, x: goalX, y: FIELD.MID_Y + (made ? 0 : 70), duration: 900, ease: 'Quad.easeOut',
            onUpdate: (tw) => { this.ball.x = start.x; this.ball.y = FIELD.MID_Y - Math.sin(tw.progress * Math.PI) * (70 + fgDist); },
            onComplete: () => {
                this.ball.visible = false;
                if (made) {
                    this.gs.score.them += 3; this.updateHUD();
                    this.audio.play('fieldgoal');
                    this.bigMessage(`${this.oppColor.name} FIELD GOAL`, 1600, () => this.kickoffToUs());
                } else {
                    this.audio.play('fail');
                    this.bigMessage('NO GOOD!', 1500, () => {
                        this.audio.speak('Missed! Your ball.');
                        this.checkClockThen(() => this.startUsDrive(Phaser.Math.Clamp(this.opp.yard, 20, 80)));
                    });
                }
            }
        });
    }

    oppPunt() {
        this.phase = 'oppanim';
        this._zoomOut(350);
        const net = 35 + Math.floor(Math.random() * 12);
        const usStart = Phaser.Math.Clamp(this.opp.yard - net, 5, 95); // our new yard line
        const startX = ydToX(this.opp.yard);
        const landX  = ydToX(usStart);
        const midY   = FIELD.MID_Y;

        // CPU punter (QB slot) takes a short drop-step before the kick.
        const punter = this.defense[0];
        this.jog(punter, startX + 18, midY, 320, 'Quad.easeOut');

        // CPU gunners sprint downfield toward the landing spot.
        this.defense.forEach((p, i) => {
            if (i === 0) return;
            this.jog(p, landX + 30 - Math.random() * 60, midY + (Math.random() - 0.5) * 80, 1200, 'Sine.easeIn');
        });

        // Our returner (deep safety) runs toward the landing spot.
        const returner = this.offense[5] || this.offense[4];
        if (returner) this.jog(returner, landX - 12, midY, 1100, 'Sine.easeIn');

        this.time.delayedCall(350, () => {
            this.audio.play('kick');
            const ball = this.ball;
            ball.visible = true; ball.carrier = null;
            ball.x = startX; ball.y = midY;
            const flight = { x: startX, y: midY };
            this.tweens.add({
                targets: flight, x: landX, y: midY, duration: 900, ease: 'Quad.easeOut',
                onUpdate: (tw) => {
                    ball.x = flight.x;
                    ball.y = midY - Math.sin(tw.progress * Math.PI) * 120;
                },
                onComplete: () => {
                    ball.visible = false;
                    this.bigMessage(`${this.oppColor.name} PUNT`, 1300, () => {
                        this.audio.speak('Your ball.');
                        // Pass isKickoff=true so startUsDrive tweens the formation
                        // smoothly rather than snapping players into position.
                        this.checkClockThen(() => this.startUsDrive(usStart, true));
                    });
                }
            });
        });
    }

    // After the opponent scores, they kick off to us.
    kickoffToUs() {
        this._speakScore();
        this.kickoff('us');
    }

    // ─── Opponent post-touchdown: PAT or 2-point conversion ───────────────────
    // After a CPU touchdown the CPU decides whether to kick the extra point (PAT,
    // worth 1 pt, ~94% success) or go for the 2-point conversion (run play from
    // the 2-yard line, worth 2 pts, ~50% success). Animated + narrated; player
    // does not control this sequence.
    oppAfterTouchdown() {
        // Go for 2 only when it can tie the game or take the lead.
        const diff = this.gs.score.us - this.gs.score.them;
        const goFor2 = diff === 2 || diff === 1;
        // Zoom back out and let the players jog to the 2-yard line first.
        this._zoomOut(500);
        this.audio.play('huddle');
        this.tweenDefense(2, 1100, () => {
            this.time.delayedCall(600, () => {
                if (goFor2) {
                    this.oppTwoPointConversion();
                } else {
                    this.oppKickPAT();
                }
            });
        });
    }

    oppKickPAT() {
        this.phase = 'oppanim';
        this.audio.speak(`${this.oppColor.name} kicking the extra point.`, true);
        this.time.delayedCall(900, () => {
            this.audio.play('kick');
            const made = Math.random() < 0.94;
            const startX = ydToX(3), goalX = FIELD.GOAL_L - 30;
            const start = { x: startX, y: FIELD.MID_Y };
            this.ball.x = start.x; this.ball.y = start.y; this.ball.visible = true;
            this.tweens.add({
                targets: start, x: goalX, y: FIELD.MID_Y, duration: 700, ease: 'Quad.easeOut',
                onUpdate: (tw) => {
                    this.ball.x = start.x;
                    this.ball.y = FIELD.MID_Y - Math.sin(tw.progress * Math.PI) * 90;
                },
                onComplete: () => {
                    this.ball.visible = false;
                    if (made) {
                        this.gs.score.them += 1; this.updateHUD();
                        this.audio.play('fieldgoal');
                        this.bigMessage(`${this.oppColor.name} EXTRA POINT  +1`, 1400, () => this.kickoffToUs());
                    } else {
                        this.audio.play('fail');
                        this.bigMessage('EXTRA POINT NO GOOD', 1200, () => this.kickoffToUs());
                    }
                }
            });
        });
    }

    // CPU 2-point conversion: a short run/pass from the 2-yard line into our end
    // zone. ~50% success. Worth 2 pts if made, 0 if stopped.
    oppTwoPointConversion() {
        this.phase = 'oppanim';
        this.audio.speak(`${this.oppColor.name} going for two.`, true);
        const carrier = this.defense[1] || this.defense[0]; // RB already in formation
        this.ball.carrier = carrier; this.ball.visible = true;
        this.time.delayedCall(800, () => {
            this.audio.play('snap');
            const made = Math.random() < 0.50;
            const endX = made ? ydToX(0) - 18 : ydToX(2) - 12;
            this.jog(carrier, endX, carrier.y + (Math.random() - 0.5) * 20, 680, 'Sine.easeIn');
            this.time.delayedCall(720, () => {
                this.ball.carrier = null; this.ball.visible = false;
                if (made) {
                    this.gs.score.them += 2; this.updateHUD();
                    this.audio.play('touchdown');
                    this.bigMessage(`${this.oppColor.name} 2-PT CONVERSION  +2`, 1500, () => this.kickoffToUs());
                } else {
                    this.audio.play('fail');
                    this.bigMessage('2-PT CONVERSION STOPS', 1300, () => this.kickoffToUs());
                }
            });
        });
    }

    // ─── Clock / quarters / end of game ────────────────────────────────────────
    // The clock only ticks once a play has been selected, and stops again before
    // the next play call — so menus and aiming setup never burn the clock.
    clockShouldRun() {
        if (this.paused) return false;
        // 'receiver', 'fgaim', 'fgcharge' are intentionally excluded: clock
        // pauses while the player picks a receiver or aims/kicks a field goal,
        // resuming once play is back in motion.
        return ['route', 'charge', 'anim', 'oppanim'].includes(this.phase);
    }

    // Called once when the real-time clock reaches 0. The quarter/game boundary
    // itself is resolved at the next dead ball via checkClockThen().
    onClockExpired() {
        this.audio.play('whistle');
    }

    advanceClock(seconds) {
        this.gs.timeRemaining -= seconds;
        if (this.gs.timeRemaining < 0) this.gs.timeRemaining = 0;
        this.updateHUD();
    }

    checkClockThen(next) {
        if (this.gs.timeRemaining > 0) { next(); return; }
        // Quarter or game boundary.
        if (this.gs.overtime) { this.evaluateOvertime(next); return; }
        if (this.gs.quarter < 4) {
            this.gs.quarter++;
            this.gs.timeRemaining = QUARTER_SECONDS;
            this.updateHUD();
            this.bigMessage(`QUARTER ${this.gs.quarter}`, 1300, next);
            return;
        }
        // End of regulation.
        if (this.gs.score.us === this.gs.score.them) {
            this.gs.overtime = true;
            this.gs.timeRemaining = QUARTER_SECONDS;
            this.otPossessions = 0;
            this.updateHUD();
            this.bigMessage('OVERTIME', 1500, next);
            return;
        }
        this.endGame();
    }

    evaluateOvertime(next) {
        // Give the clock back for another OT period; end when someone leads after
        // an even number of possessions.
        this.gs.timeRemaining = QUARTER_SECONDS;
        if (this.gs.score.us !== this.gs.score.them) { this.endGame(); return; }
        this.updateHUD();
        next();
    }

    endGame() {
        this.phase = 'gameover';
        if (this.isSeason) seasonMgr().clearGameState();
        this.scene.start('ResultScene', {
            isSeason: this.isSeason,
            us: this.gs.score.us, them: this.gs.score.them,
            playerColorName: this.playerColor.name,
            opponentColorName: this.oppColor.name
        });
    }

    // ─── Messaging helpers ─────────────────────────────────────────────────────
    bigMessage(text, ms, then) {
        this.phase = 'message';
        this._zoomOut(200);
        this.msgTxt.setText(text).setAlpha(1);
        this.subTxt.setAlpha(0);
        let done = false;
        const finish = () => { if (done) return; done = true; this.msgTxt.setAlpha(0); this.skipMessage = null; if (then) then(); };
        this.skipMessage = finish;
        this.time.delayedCall(ms, finish);
    }

    flashSub(text) {
        this.subTxt.setText(text).setAlpha(1);
        this.tweens.add({ targets: this.subTxt, alpha: 0, delay: 2200, duration: 600 });
        this.audio.speak(text);
    }

    // ─── Pause ─────────────────────────────────────────────────────────────────
    togglePause() {
        if (this.phase === 'gameover') return;
        if (this.paused) { this.closePause(); return; }
        this.paused = true;
        this.pauseView = 'main';
        this.audio.play('whistle');
        this.audio.speak('Paused.');
        if (this.playDiagram) { this.playDiagram.destroy(); this.playDiagram = null; }
        this.pauseOverlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6).setDepth(39).setScrollFactor(0);
        this.showPauseMenu();
    }

    showPauseMenu(restoreIndex = -1) {
        if (this.pauseMenu) { this.pauseMenu.destroy(); this.pauseMenu = null; }
        const a = this.audio;
        const nm = window.NarbeScanManager;
        const vm = window.NarbeVoiceManager;
        let opts, title;
        if (this.pauseView === 'settings') {
            title = 'SETTINGS';
            const autoScan  = nm && nm.getSettings ? !!nm.getSettings().autoScan : false;
            const scanSec   = nm && nm.getSettings ? ((nm.getSettings().scanInterval || 2200) / 1000).toFixed(1) : '2.2';
            const ttsOn     = vm && vm.getSettings ? vm.getSettings().ttsEnabled !== false : true;
            const sfxOn     = a.settings.soundEnabled;
            const musicOn   = a.settings.musicEnabled;
            const easy      = easyThrowOn();
            const cbMode    = colorblindMode();
            const cbLabel   = (COLORBLIND_MODES.find(m => m.id === cbMode) || COLORBLIND_MODES[0]).label;
            opts = [
                { label: `Sound Effects: ${sfxOn ? 'ON' : 'OFF'}`,  value: 'sfx' },
                { label: `Music: ${musicOn ? 'ON' : 'OFF'}`,         value: 'music' },
                { label: `TTS: ${ttsOn ? 'ON' : 'OFF'}`,             value: 'tts' },
                { label: `Auto Scan: ${autoScan ? 'ON' : 'OFF'}`,    value: 'autoscan' },
                { label: `Scan Speed: ${scanSec}s`,                   value: 'scanspeed' },
                { label: `Easy Throw: ${easy ? 'ON' : 'OFF'}`,       value: 'easythrow',
                  hint: easy ? 'no charge needed — pick receiver and it throws' : 'hold to charge throw & kick power' },
                { label: `Colorblind: ${cbLabel}`,                    value: 'colorblind',
                  hint: 'cycles Normal → Deuteranopia → Protanopia → Tritanopia' },
                { label: 'Back', value: 'back' }
            ];
        } else {
            title = 'PAUSED';
            opts = [
                { label: 'Continue Game', value: 'continue' },
                { label: 'Settings',      value: 'settings' },
                { label: 'Main Menu',     value: 'menu' }
            ];
        }
        this.pauseMenu = new ScanList(this, {
            x: W / 2, y: H / 2, options: opts, audio: a, title, itemW: 340,
            onSelect: (opt) => this.onPauseSelect(opt.value)
        });
        this.pauseMenu.setScrollFactor(0);
        if (restoreIndex >= 0 && restoreIndex < opts.length) {
            this.pauseMenu.index = restoreIndex;
            this.pauseMenu._draw();
        }
    }

    onPauseSelect(value) {
        const a = this.audio;
        const nm = window.NarbeScanManager;
        const vm = window.NarbeVoiceManager;
        const idx = this.pauseMenu ? this.pauseMenu.index : -1;
        if (value === 'continue') { this.closePause(); }
        else if (value === 'settings') { this.pauseView = 'settings'; this.showPauseMenu(); }
        else if (value === 'back') { this.pauseView = 'main'; this.showPauseMenu(); }
        else if (value === 'menu') { this.closePause(); this.scene.start('TitleScene'); }
        else if (value === 'music') { a.toggleMusic(); this.showPauseMenu(idx); }
        else if (value === 'sfx') {
            a.settings.soundEnabled = !a.settings.soundEnabled;
            a.saveSettings();
            a.speak(a.settings.soundEnabled ? 'Sound on.' : 'Sound off.', true);
            this.showPauseMenu(idx);
        } else if (value === 'tts') {
            if (vm && typeof vm.toggleTTS === 'function') {
                const nowOn = vm.toggleTTS();
                a.speak(nowOn ? 'TTS on.' : 'TTS off.', true);
            }
            this.showPauseMenu(idx);
        } else if (value === 'autoscan') {
            if (nm && typeof nm.setAutoScan === 'function') {
                const cur = nm.getSettings().autoScan;
                nm.setAutoScan(!cur);
                a.speak(!cur ? 'Auto scan on.' : 'Auto scan off.', true);
            }
            this.showPauseMenu(idx);
        } else if (value === 'scanspeed') {
            if (nm && typeof nm.cycleScanSpeed === 'function') {
                nm.cycleScanSpeed();
            }
            const newSec = nm && nm.getSettings ? ((nm.getSettings().scanInterval || 2000) / 1000).toFixed(1) : '?';
            a.speak(`Scan speed ${newSec} seconds.`, true);
            this.showPauseMenu(idx);
        } else if (value === 'easythrow') {
            const on = !easyThrowOn();
            setEasyThrow(on);
            a.speak(on ? 'Easy Throw on.' : 'Easy Throw off.', true);
            this.showPauseMenu(idx);
        } else if (value === 'colorblind') {
            const ids = COLORBLIND_MODES.map(m => m.id);
            const cur = colorblindMode();
            const next = ids[(ids.indexOf(cur) + 1) % ids.length];
            setColorblindMode(next);
            const lbl = (COLORBLIND_MODES.find(m => m.id === next) || COLORBLIND_MODES[0]).label;
            a.speak(`Colorblind mode: ${lbl}.`, true);
            this.showPauseMenu(idx);
        }
    }

    closePause() {
        this.paused = false;
        if (this.pauseMenu) { this.pauseMenu.destroy(); this.pauseMenu = null; }
        if (this.pauseOverlay) { this.pauseOverlay.destroy(); this.pauseOverlay = null; }
        // Re-sync the live game menu's auto-scan timer with the current setting so
        // any change made in pause settings takes effect immediately on resume.
        if (this.playMenu) { this.playMenu._stopTimer(); this.playMenu._startTimer(); }
    }

    // ─── Per-frame rendering ───────────────────────────────────────────────────
    update(time, delta) {
        // Dynamic depth sort: players closer to the bottom of the screen (higher Y)
        // are drawn on top; ball carrier always on top; tackled player under everyone.
        this._sortPlayerDepths();
        this._updatePlayerSprites(delta);

        // Real-time game clock: ticks down only while a play is live.
        if (this.gs && this.gs.timeRemaining > 0 && this.clockShouldRun()) {
            this.gs.timeRemaining -= delta / 1000;
            if (this.gs.timeRemaining <= 0) {
                this.gs.timeRemaining = 0;
                this.updateHUD();
                this.onClockExpired();
            } else {
                const sec = Math.ceil(this.gs.timeRemaining);
                if (sec !== this._lastClockSec) { this._lastClockSec = sec; this.updateHUD(); }
            }
        }

        // Ball tracks its carrier so it looks like it's being run with. The
        // (12, -2) offset was tuned against the 26px disc, whose middle sits at
        // the container origin. A sprite is 52px tall and stands almost
        // entirely ABOVE that origin, so the same offset drops the ball at the
        // player's shins and reads as a loose ball rather than a carried one.
        if (this.ball.carrier) {
            const pt = this._carryPoint(this.ball.carrier);
            this.ball.x = pt.x; this.ball.y = pt.y;
        }

        // Line of scrimmage + first-down markers during live phases.
        const m = this.markerGfx;
        m.clear();
        if (this.onDefense && this.opp && ['defcall', 'oppanim', 'transition'].includes(this.phase)) {
            const losX = ydToX(this.opp.yard);
            m.lineStyle(3, 0x2196f3, 0.85); m.lineBetween(losX, FIELD.TOP, losX, FIELD.BOTTOM);
            const fdX = ydToX(this.opp.fdTarget);
            m.lineStyle(3, 0xffeb3b, 0.8); m.lineBetween(fdX, FIELD.TOP, fdX, FIELD.BOTTOM);
            // Show who the opposing QB is targeting so you can read the play.
            if (this.oppTarget) {
                const t = this.oppTarget;
                m.lineStyle(4, 0xff3b3b, 1); m.strokeCircle(t.x, t.y, 24);
                m.lineStyle(2, 0xffffff, 0.9); m.strokeCircle(t.x, t.y, 30);
                // crosshair
                m.lineStyle(2, 0xff3b3b, 0.9);
                m.lineBetween(t.x - 32, t.y, t.x - 24, t.y);
                m.lineBetween(t.x + 24, t.y, t.x + 32, t.y);
                m.lineBetween(t.x, t.y - 32, t.x, t.y - 24);
                m.lineBetween(t.x, t.y + 24, t.x, t.y + 32);
            }
        } else if (['playcall', 'route', 'receiver', 'charge', 'anim', 'transition'].includes(this.phase)) {
            const losX = ydToX(this.gs.ballPosition);
            m.lineStyle(3, 0x2196f3, 0.85); m.lineBetween(losX, FIELD.TOP, losX, FIELD.BOTTOM);
            const fdX = ydToX(this.gs.firstDownTarget);
            m.lineStyle(3, 0xffeb3b, 0.8); m.lineBetween(fdX, FIELD.TOP, fdX, FIELD.BOTTOM);
        }

        // Highlight every receiver by coverage status using shape + colour.
        // Shape encodes status in all modes:
        //   disp 0 (open)             → circle
        //   disp 1 (covered/distant)  → triangle (pointing up)
        //   disp 2 (blocked)          → square
        // Colour comes from cbHighlightColor() which respects the colorblind setting.
        // The pulsing selection reticle also uses the same shape so there is only
        // one consistent visual indicator — no extra circle stacked on top.
        if ((this.phase === 'receiver' || this.phase === 'charge') && this.receivers) {

            // ── Helper: draw a shape outline & fill at (px,py) scaled by `scale`.
            // Used for both the static base marker and the pulsing reticle.
            const drawShape = (disp, px, py, scale, fillAlpha, strokeW, strokeCol, shadowW) => {
                const tr = 26 * scale;   // triangle circumradius / circle radius / half-square
                const hs = 22 * scale;   // half-side for square
                const col = cbHighlightColor(disp);

                if (disp === 0) {
                    // Circle — open
                    if (fillAlpha > 0) { m.fillStyle(col, fillAlpha); m.fillCircle(px, py, tr + 4); }
                    if (shadowW > 0)   { m.lineStyle(shadowW, 0x000000, 0.75); m.strokeCircle(px, py, tr); }
                    m.lineStyle(strokeW, strokeCol, 1.0); m.strokeCircle(px, py, tr);
                } else if (disp === 1) {
                    // Triangle — covered/distant
                    const x1 = px,              y1 = py - tr;
                    const x2 = px - tr * 0.866, y2 = py + tr * 0.5;
                    const x3 = px + tr * 0.866, y3 = py + tr * 0.5;
                    if (fillAlpha > 0) { m.fillStyle(col, fillAlpha); m.fillTriangle(x1, y1, x2, y2, x3, y3); }
                    if (shadowW > 0)   { m.lineStyle(shadowW, 0x000000, 0.75); m.strokeTriangle(x1, y1, x2, y2, x3, y3); }
                    m.lineStyle(strokeW, strokeCol, 1.0); m.strokeTriangle(x1, y1, x2, y2, x3, y3);
                } else {
                    // Square — blocked
                    if (fillAlpha > 0) { m.fillStyle(col, fillAlpha); m.fillRect(px - hs, py - hs, hs * 2, hs * 2); }
                    if (shadowW > 0)   { m.lineStyle(shadowW, 0x000000, 0.75); m.strokeRect(px - hs, py - hs, hs * 2, hs * 2); }
                    m.lineStyle(strokeW, strokeCol, 1.0); m.strokeRect(px - hs, py - hs, hs * 2, hs * 2);
                }
            };

            this.receivers.forEach((rr) => {
                const cov  = rr.coverage || 0;
                const disp = rr.displayCov !== undefined ? rr.displayCov : cov;
                const px   = rr.player.x, py = rr.player.y;

                // Base marker: filled + shadow outline + coloured outline at scale 1.
                drawShape(disp, px, py, 1.0, cbGlowAlpha(disp), 6, cbHighlightColor(disp), 9);

                // Connector lines to covering defenders.
                (rr.defenders || []).forEach(def => {
                    if (!def) return;
                    m.lineStyle(3, 0xff5050, 0.65);
                    m.lineBetween(px, py, def.x, def.y);
                });
            });

            // --- Pulsing selection reticle: same shape as the base marker,
            //     scaled up and breathing so it's clearly the "selected" one.
            const r = this.phase === 'charge' && this.target ? this.target : this.receivers[this.recIndex];
            if (r) {
                const rDisp = r.displayCov !== undefined ? r.displayCov : (r.coverage || 0);
                const pulse = 0.5 + 0.5 * Math.sin(time * 0.007); // 0.5–1.0
                // Scale oscillates between 1.35 and 1.65 so the pulsing reticle
                // is clearly larger than the static base marker underneath.
                const scale = 1.35 + 0.30 * pulse;
                // Black halo pass first (shadow), then white inner fill, then colour outline.
                drawShape(rDisp, r.player.x, r.player.y, scale, 0, 4, 0xffffff, 9);
                drawShape(rDisp, r.player.x, r.player.y, scale * 0.88, 0, 3, cbHighlightColor(rDisp), 0);
            }
        }

        // Charge phase: build power while held; draw a growing beam toward the receiver.
        if (this.phase === 'charge') {
            if (this.charging) {
                const ideal = this.idealPowerFor(this.target);
                const inWindow = this.power >= ideal - 14 && this.power <= ideal + 14;
                // Slow the charge dramatically inside the green window so players
                // with limited mobility have 4-5 seconds to release in time.
                const rate = inWindow ? 5 : 19;
                this.power = Math.min(100, this.power + (delta / 1000) * rate);
                // Play cue sound the moment power enters the green window.
                if (!this.passCuePlayed && this.power >= ideal - 14) {
                    this.passCuePlayed = true;
                    this.audio.play('cue');
                } else if (this.passCuePlayed && !this.passOverPlayed && this.power > ideal + 14) {
                    this.passOverPlayed = true;
                }
                if (this.power >= 100) this.releaseCharge();
            }
            // Growing beam from QB toward selected receiver.
            // Ease-out curve: starts fast, decelerates visually as it nears the target.
            if (this.target) {
                const qb = this.offense[0];
                const ideal = this.idealPowerFor(this.target);
                const inWindow = this.power >= ideal - 14 && this.power <= ideal + 14;
                const overcharged = this.power > ideal + 14;
                const beamColor = overcharged ? 0xff4040 : (inWindow ? 0x66ff66 : 0xffd700);
                const rawT = Phaser.Math.Clamp(this.power / ideal, 0, 1.35);
                const eased = rawT < 1 ? 1 - Math.pow(1 - rawT, 1.8) : rawT;
                const tipX = qb.x + (this.target.player.x - qb.x) * eased;
                const tipY = qb.y + (this.target.player.y - qb.y) * eased;
                // Faint ghost line showing the full route to the receiver.
                m.lineStyle(1, 0xffffff, 0.18);
                m.lineBetween(qb.x, qb.y, this.target.player.x, this.target.player.y);
                // Charge beam
                m.lineStyle(inWindow ? 5 : 3, beamColor, 0.9);
                m.lineBetween(qb.x, qb.y, tipX, tipY);
                // Glowing tip dot
                m.fillStyle(beamColor, 1);
                m.fillCircle(tipX, tipY, inWindow ? 11 : 7);
                if (inWindow) { m.lineStyle(2, 0xffffff, 0.75); m.strokeCircle(tipX, tipY, 16); }
                // Target reticle
                m.lineStyle(4, 0xffffff, 1); m.strokeCircle(this.target.player.x, this.target.player.y, 22);
            }
            this.meterGfx.clear();
        } else if (this.phase === 'fgaim') {
            // Hold SPACE to sweep the reticle; each new SPACE press flips direction.
            // Release stops movement. HOLD ENTER to charge and kick.
            if (this._aimHeld) {
                // 0.7× multiplier makes the sweep ~30% slower for both manual and auto-scan.
                const spd = Phaser.Math.Clamp(1500 / this.scanInterval(), 0.3, 0.7) * 0.7;
                this.aimValue += this.aimDir * (delta / 1000) * spd;
                if (this.aimValue >= 1) { this.aimValue = 1; this.aimDir = -1; }
                if (this.aimValue <= -1) { this.aimValue = -1; this.aimDir = 1; }
            }
            // On-target = reticle inside the scoring window → light up + helper tone.
            this._onTarget = Math.abs(this.aimValue) <= this.aimWindow;
            if (this._onTarget) {
                if (!this._aimDing) {
                    this._aimDing = true; this.audio.play('fgcue');
                    this.time.delayedCall(700, () => { this._aimDing = false; });
                }
            } else {
                this._aimDing = false;
            }
            this.drawFgAim();
            this.meterGfx.clear();
        } else if (this.phase === 'fgcharge') {
            if (this.kickCharging) {
                const ideal = this.idealKickPower();
                const inZone = this.kickPower >= ideal * 0.9;
                // Slow the charge when in the sweet zone (same ~4-5s window as pass).
                const rate = inZone ? 7 : 40;
                this.kickPower = Math.min(100, this.kickPower + (delta / 1000) * rate);
                if (!this.kickCuePlayed && this.kickPower >= ideal * 0.9) {
                    this.kickCuePlayed = true;
                    this.audio.play('cue');
                }
                if (this.kickPower >= 100) this.releaseKickCharge();
            }
            // Growing kick beam from ball toward the goal posts.
            {
                const kx = ydToX(this.gs.ballPosition), ky = FIELD.MID_Y;
                const goalX = FIELD.GOAL_R + 22;
                const spread = 150;
                const targetY = ky + (this.aimLocked || 0) * spread;
                const ideal = this.idealKickPower();
                const enough = this.kickPower >= ideal * 0.9;
                const rawT = Phaser.Math.Clamp(this.kickPower / ideal, 0, 1.2);
                const eased = rawT < 1 ? 1 - Math.pow(1 - rawT, 1.8) : rawT;
                const tipX = kx + (goalX - kx) * eased;
                const tipY = ky + (targetY - ky) * eased;
                const beamColor = enough ? 0x66ff66 : 0xffd700;
                // Faint ghost line to the posts.
                m.lineStyle(1, 0xffffff, 0.18);
                m.lineBetween(kx, ky, goalX, targetY);
                // Charge beam
                m.lineStyle(enough ? 5 : 3, beamColor, 0.9);
                m.lineBetween(kx, ky, tipX, tipY);
                // Glowing tip
                m.fillStyle(beamColor, 1);
                m.fillCircle(tipX, tipY, enough ? 11 : 7);
                if (enough) { m.lineStyle(2, 0xffffff, 0.75); m.strokeCircle(tipX, tipY, 16); }
            }
            this.meterGfx.clear();
        } else {
            this.meterGfx.clear();
        }

        // Ball. Suppressed while a player's own art is carrying it.
        this.ballGfx.clear();
        if (this.ball.visible && !this._ballIsModelled()) {
            this.ballGfx.fillStyle(0x000000, 0.25);
            this.ballGfx.fillEllipse(this.ball.x + 2, this.ball.y + 6, 16, 7);
            this.ballGfx.fillStyle(0x8d4a2b, 1);
            this.ballGfx.fillEllipse(this.ball.x, this.ball.y, 16, 10);
            this.ballGfx.lineStyle(1.5, 0xffffff, 0.95);
            this.ballGfx.lineBetween(this.ball.x - 5, this.ball.y, this.ball.x + 5, this.ball.y);
        }
    }

    drawPowerMeter() {
        const g = this.meterGfx;
        g.clear();
        const x = W - 60, y = 90, w = 30, h = 360;
        g.fillStyle(0x000000, 0.6); g.fillRoundedRect(x, y, w, h, 6);
        // Sweet-spot band based on selected receiver distance (clamped inside the bar).
        if (this.target) {
            const ideal = this.idealPowerFor(this.target);
            const lo = Phaser.Math.Clamp(ideal - 14, 0, 100);
            const hi = Phaser.Math.Clamp(ideal + 14, 0, 100);
            const yHi = y + h * (1 - hi / 100);
            const yLo = y + h * (1 - lo / 100);
            g.fillStyle(0x4caf50, 0.55); g.fillRect(x, yHi, w, yLo - yHi);
        }
        const fillH = h * (this.power / 100);
        let fillCol = 0xffd54f;                       // building up
        if (this.target) {
            const ideal = this.idealPowerFor(this.target);
            if (this.power > ideal + 14) fillCol = 0xff5252;   // overthrow zone
            else if (this.power >= ideal - 14) fillCol = 0x66ff66; // in the green
        }
        g.fillStyle(fillCol, 0.95);
        g.fillRect(x, y + h - fillH, w, fillH);
        g.lineStyle(2, 0xffffff, 0.9); g.strokeRoundedRect(x, y, w, h, 6);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESULT SCENE
// ═══════════════════════════════════════════════════════════════════════════════
class ResultScene extends Phaser.Scene {
    constructor() { super({ key: 'ResultScene' }); }
    init(data) { this.data = data; }

    preload() { loadHelmets(this); }

    create() {
        const audio = audioSys();
        const d = this.data;
        this.add.rectangle(0, 0, W, H, 0x0a1408).setOrigin(0);
        const won = d.us > d.them;

        let headline = won ? 'YOU WIN!' : (d.us === d.them ? 'TIE GAME' : 'YOU LOSE');
        let detail = '';
        let outcome = '';

        if (d.isSeason) {
            const season = seasonMgr();
            outcome = season.recordResult(d.us, d.them);
            detail = this._seasonDetail(season, outcome);
        }

        // Playoff / championship wins get a 10-second celebration screen first.
        const isPlayoffWin      = won && (outcome === 'advanced_playoff' || outcome === 'made_playoffs' || outcome === 'perfect_to_championship');
        const isChampionshipWin = won && outcome === 'champions';
        if (isPlayoffWin || isChampionshipWin) {
            this._celebrate(audio, d, headline, detail, isChampionshipWin);
            return;
        }

        this._buildResultUI(audio, d, headline, detail);
    }

    _buildResultUI(audio, d, headline, detail) {
        const won = d.us > d.them;
        this.add.text(W / 2, 110, headline, {
            fontSize: '60px', fontFamily: 'Arial Black', color: won ? '#FFD700' : '#ff7043',
            stroke: '#000', strokeThickness: 7
        }).setOrigin(0.5);

        // Score line with mini helmets.
        const playerCol = getColorByName(d.playerColorName);
        const oppCol    = getColorByName(d.opponentColorName);
        addHelmetSprite(this, d.playerColorName, W / 2 - 200, 190, 48);
        addHelmetSprite(this, d.opponentColorName, W / 2 + 200, 190, 48, { flipX: true });
        this.add.text(W / 2, 190, `${d.us}  —  ${d.them}`, {
            fontSize: '36px', fontFamily: 'Arial Black', color: '#ffffff', stroke: '#000', strokeThickness: 4
        }).setOrigin(0.5);
        this.add.text(W / 2 - 160, 222, d.playerColorName, {
            fontSize: '15px', fontFamily: 'Arial', color: playerCol.css
        }).setOrigin(0.5);
        this.add.text(W / 2 + 160, 222, d.opponentColorName, {
            fontSize: '15px', fontFamily: 'Arial', color: oppCol.css
        }).setOrigin(0.5);

        if (detail) {
            this.add.text(W / 2, 270, detail, {
                fontSize: '20px', fontFamily: 'Arial', color: '#aaffaa', align: 'center',
                stroke: '#000', strokeThickness: 2, wordWrap: { width: 760 }
            }).setOrigin(0.5);
        }
        audio.speak(`${headline}. ${detail}`);

        // For season games: auto-return to the standings after 6 s.
        // The player can tap or press ENTER to skip the wait.
        if (d.isSeason) {
            const skipTxt = this.add.text(W / 2, H - 32, 'Returning to standings…  (press ENTER to skip)', {
                fontSize: '15px', fontFamily: 'Arial', color: '#888888'
            }).setOrigin(0.5);
            this.tweens.add({ targets: skipTxt, alpha: 0.25, duration: 600, yoyo: true, repeat: -1 });

            let gone = false;
            const goToSeason = () => {
                if (gone) return;
                gone = true;
                this.scene.start('SeasonScene');
            };
            this.time.delayedCall(6000, goToSeason);
            this.input.once('pointerdown', goToSeason);
            this.scanInput = new ScanInput(this, {
                forward: () => {}, backward: () => {}, select: goToSeason
            });
        } else {
            // Exhibition game — show the normal menu.
            const opts = [{ label: 'MAIN MENU', value: 'menu' }];
            this.menu = new ScanList(this, {
                x: W / 2, y: 420, options: opts, audio: audioSys(), itemW: 320,
                onSelect: (opt) => this.handle(opt.value)
            });
            this.scanInput = new ScanInput(this, {
                forward:  () => this.menu && this.menu.next(false),
                backward: () => this.menu && this.menu.prev(false),
                select:   () => this.menu && this.menu.select()
            });
        }
    }

    _celebrate(audio, d, headline, detail, isChampionship) {
        this.add.rectangle(0, 0, W, H, isChampionship ? 0x1a1000 : 0x001a06).setOrigin(0);

        const celebTitle = isChampionship ? 'CHAMPIONS!' : 'PLAYOFFS ADVANCE!';
        const celebColor = isChampionship ? '#FFD700' : '#66ff88';

        // Big helmet in player color, center-top.
        addHelmetSprite(this, d.playerColorName, W / 2, 120, isChampionship ? 144 : 116);

        // Trophy emoji text for championship.
        if (isChampionship) {
            this.add.text(W / 2, 50, '🏆', { fontSize: '52px' }).setOrigin(0.5);
        }

        const mainTxt = this.add.text(W / 2, 230, celebTitle, {
            fontSize: isChampionship ? '68px' : '52px',
            fontFamily: 'Arial Black', color: celebColor,
            stroke: '#000', strokeThickness: 8
        }).setOrigin(0.5).setAlpha(0);
        this.tweens.add({ targets: mainTxt, alpha: 1, duration: 600, ease: 'Back.easeOut' });

        this.add.text(W / 2, 315, `${d.playerColorName} ${d.us}  —  ${d.them} ${d.opponentColorName}`, {
            fontSize: '26px', fontFamily: 'Arial Black', color: '#ffffff',
            stroke: '#000', strokeThickness: 4
        }).setOrigin(0.5);

        if (detail) {
            this.add.text(W / 2, 358, detail, {
                fontSize: '18px', fontFamily: 'Arial', color: '#aaffaa', align: 'center',
                stroke: '#000', strokeThickness: 2, wordWrap: { width: 720 }
            }).setOrigin(0.5);
        }

        const skipTxt = this.add.text(W / 2, H - 28, 'Press ENTER or tap to continue', {
            fontSize: '15px', fontFamily: 'Arial', color: '#888888'
        }).setOrigin(0.5);
        this.tweens.add({ targets: skipTxt, alpha: 0.2, duration: 700, yoyo: true, repeat: -1 });

        // Confetti rain.
        const confettiColors = isChampionship
            ? [0xffd700, 0xffaa00, 0xffffff, 0xff6600, 0xffee44]
            : [0x66ff88, 0x44ffcc, 0xffffff, 0x88ff44, 0x44ff66];
        const numPieces = isChampionship ? 90 : 50;
        for (let i = 0; i < numPieces; i++) {
            this.time.delayedCall(Math.random() * 4000, () => {
                if (!this.scene.isActive()) return;
                const g = this.add.graphics();
                const col = confettiColors[Math.floor(Math.random() * confettiColors.length)];
                const sz = 5 + Math.random() * 9;
                g.fillStyle(col, 0.9); g.fillRect(-sz / 2, -sz / 2, sz, sz);
                const sx = Math.random() * W;
                g.setPosition(sx, -20);
                this.tweens.add({
                    targets: g, x: sx + (Math.random() - 0.5) * 180, y: H + 20,
                    angle: (Math.random() - 0.5) * 720,
                    duration: 2800 + Math.random() * 2500, ease: 'Sine.easeIn',
                    onComplete: () => g.destroy()
                });
            });
        }

        // Championship: burst rings emanating from center.
        if (isChampionship) {
            const ringColors = [0xffd700, 0xffaa00, 0xffffff, 0xff8800, 0xffdd00, 0xffeebb];
            for (let b = 0; b < 8; b++) {
                this.time.delayedCall(b * 1100 + 200, () => {
                    if (!this.scene.isActive()) return;
                    const ring = this.add.graphics();
                    ring.lineStyle(5, ringColors[b % ringColors.length], 1);
                    ring.strokeCircle(W / 2, 120, 1);
                    this.tweens.add({
                        targets: ring, scaleX: 28, scaleY: 28, alpha: 0,
                        duration: 1000, ease: 'Quad.easeOut',
                        onComplete: () => ring.destroy()
                    });
                });
            }
        }

        audio.speak(celebTitle + '. ' + detail, true);

        // Proceed to season record after 10 seconds (or on skip).
        const proceed = () => {
            this.input.off('pointerdown', proceed);
            this.scene.start('SeasonScene');
        };
        this.time.delayedCall(10000, proceed);
        this.input.once('pointerdown', proceed);
        this.scanInput = new ScanInput(this, {
            forward: () => {}, backward: () => {}, select: proceed
        });
    }

    _seasonDetail(season, outcome) {
        const d = season.data;
        const record = `Record: ${d.wins} - ${d.losses}`;
        switch (outcome) {
            case 'next_game':               return `${record}.  Next up: ${season.currentMatchupLabel()}.`;
            case 'made_playoffs':           return `${record}.  PLAYOFFS! Next: ${SEASON.PLAYOFF_ROUNDS[d.playoffRound]}.`;
            case 'perfect_to_championship': return `PERFECT 16-0!  Straight to the Championship!`;
            case 'missed_playoffs':         return `${record}.  Season over — missed the playoffs.`;
            case 'advanced_playoff':        return `Advancing!  Next: ${SEASON.PLAYOFF_ROUNDS[d.playoffRound]}.`;
            case 'eliminated':              return `Eliminated in the playoffs.  Season over.`;
            case 'champions':               return `You won it all!`;
            case 'lost_championship':       return `So close — lost the Championship.`;
            default:                        return record;
        }
    }

    handle(value) {
        if (value === 'next' || value === 'record') {
            this.scene.start('SeasonScene');
        } else {
            this.scene.start('TitleScene');
        }
    }
}
