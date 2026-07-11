// ═══════════════════════════════════════════════════════════════════════════════
// BENNY'S BASEBALL 2 - Season Manager
// Football-style season shell (16-game schedule, per-game results list,
// stage machine, mid-game save/resume) with BASEBALL playoff rules:
//   16 regular games → 10+ wins makes the playoffs
//   Quarterfinal series: best of 3
//   Semifinal series:    best of 3
//   Championship series: best of 5
//   Perfect 16-0 season skips straight to the championship series.
// Structure and method names mirror BENNYSFOOTBALL/js/season.js so the
// SeasonScene port works the same way.
// ═══════════════════════════════════════════════════════════════════════════════

class SeasonManager {
    constructor() {
        this.data = null;
        this.load();
    }

    load() {
        try {
            const raw = localStorage.getItem(LS_SEASON);
            if (raw) this.data = JSON.parse(raw);
            // Discard saves from the old (pre-football-model) season format
            if (this.data && this.data.stage === undefined) this.data = null;
        } catch (e) { this.data = null; }
    }

    save() {
        try { localStorage.setItem(LS_SEASON, JSON.stringify(this.data)); }
        catch (e) { /* ignore */ }
    }

    reset() {
        this.data = null;
        try { localStorage.removeItem(LS_SEASON); } catch (e) { /* ignore */ }
        this.clearGameState();
    }

    isActive() { return !!(this.data && this.data.active); }

    // Begin a fresh season with the chosen team colour.
    start(teamColorName) {
        this.data = {
            active: true,
            teamColor: teamColorName,
            wins: 0,
            losses: 0,
            gamesPlayed: 0,
            schedule: this._buildSchedule(teamColorName),
            results: [],              // { opp, us, them, win, stage }
            stage: 'regular',         // 'regular' | 'quarterfinal' | 'semifinal' | 'championship' | 'done' | 'failed' | 'champions'
            seriesWins: 0,            // current playoff/championship series
            seriesLosses: 0,
            opponentColor: null,      // current opponent (fixed for a whole series)
            seriesHomeIsPlayer: null  // consistent home/away within a series
        };
        this._setNextOpponent();
        this.save();
        return this.data;
    }

    // 16-game schedule: all 8 unique opponents (shuffled), twice.
    _buildSchedule(teamColorName) {
        const others = COLOR_OPTIONS.filter(c => c.name !== teamColorName).map(c => c.name);
        const shuffle = arr => {
            const a = [...arr];
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        };
        const schedule = [];
        while (schedule.length < SEASON.REGULAR_GAMES) {
            for (const name of shuffle(others)) {
                if (schedule.length >= SEASON.REGULAR_GAMES) break;
                schedule.push(name);
            }
        }
        return schedule;
    }

    _seriesOpponentsUsed() {
        return (this.data.results || [])
            .filter(r => r.stage !== 'regular')
            .map(r => r.opp);
    }

    // Decide who we face next. Regular season follows the schedule; each new
    // playoff series draws a fresh opponent not faced in earlier series.
    _setNextOpponent() {
        const d = this.data;
        if (d.stage === 'regular') {
            d.opponentColor = d.schedule[d.gamesPlayed];
        } else if (SEASON.SERIES[d.stage]) {
            const used = new Set([d.teamColor, ...this._seriesOpponentsUsed()]);
            let choices = COLOR_OPTIONS.filter(c => !used.has(c.name));
            if (choices.length === 0) choices = COLOR_OPTIONS.filter(c => c.name !== d.teamColor);
            d.opponentColor = choices[Math.floor(Math.random() * choices.length)].name;
            d.seriesWins = 0;
            d.seriesLosses = 0;
            d.seriesHomeIsPlayer = Math.random() < 0.5;
        }
    }

    isInSeries() { return !!(this.data && SEASON.SERIES[this.data.stage]); }

    seriesInfo() {
        const d = this.data;
        const s = SEASON.SERIES[d.stage];
        if (!s) return null;
        return { ...s, stage: d.stage, wins: d.seriesWins, losses: d.seriesLosses,
                 gameNum: d.seriesWins + d.seriesLosses + 1,
                 bestOf: s.winsNeeded * 2 - 1 };
    }

    // Human-readable label for the upcoming matchup.
    currentMatchupLabel() {
        const d = this.data;
        if (d.stage === 'regular') {
            return `GAME ${d.gamesPlayed + 1} OF ${SEASON.REGULAR_GAMES}`;
        }
        const s = this.seriesInfo();
        if (s) return `${s.label} SERIES — GAME ${s.gameNum} (BEST OF ${s.bestOf})`;
        return '';
    }

    // Record a finished game and advance the season.
    // Returns an outcome string describing the transition.
    recordResult(usScore, themScore) {
        const d = this.data;
        const win = usScore > themScore;
        d.results.push({ opp: d.opponentColor, us: usScore, them: themScore, win, stage: d.stage });

        if (d.stage === 'regular') return this._advanceRegular(win);
        if (SEASON.SERIES[d.stage]) return this._advanceSeries(win);
        this.save();
        return 'done';
    }

    _advanceRegular(win) {
        const d = this.data;
        d.gamesPlayed++;
        if (win) d.wins++; else d.losses++;

        if (d.gamesPlayed < SEASON.REGULAR_GAMES) {
            this._setNextOpponent();
            this.save();
            return 'next_game';
        }

        // Regular season complete.
        if (d.wins >= SEASON.PERFECT_WINS) {
            d.stage = 'championship';
            this._setNextOpponent();
            this.save();
            return 'perfect_to_championship';
        }
        if (d.wins >= SEASON.PLAYOFF_WIN_THRESHOLD) {
            d.stage = 'quarterfinal';
            this._setNextOpponent();
            this.save();
            return 'made_playoffs';
        }
        d.stage = 'failed';
        this.save();
        return 'missed_playoffs';
    }

    _advanceSeries(win) {
        const d = this.data;
        const spec = SEASON.SERIES[d.stage];
        if (win) d.seriesWins++; else d.seriesLosses++;

        if (d.seriesWins >= spec.winsNeeded) {
            // Series won
            if (!spec.next) {
                d.stage = 'champions';
                this.save();
                return 'champions';
            }
            const advanced = spec.next;
            d.stage = advanced;
            this._setNextOpponent();
            this.save();
            return advanced === 'championship' ? 'advanced_championship' : 'advanced_semifinal';
        }
        if (d.seriesLosses >= spec.winsNeeded) {
            // Series lost
            d.stage = 'done';
            this.save();
            return spec.next ? 'eliminated' : 'lost_championship';
        }
        // Series continues
        this.save();
        return 'series_next';
    }

    isSeasonOver() {
        return this.data && ['done', 'failed', 'champions'].includes(this.data.stage);
    }

    // ─── Mid-game state persistence (same shape idea as football) ───────────
    saveGameState(snapshot, opp) {
        try {
            localStorage.setItem(LS_GAME_STATE, JSON.stringify({ gs: snapshot, opp }));
        } catch (e) { /* ignore */ }
    }

    loadGameState() {
        try {
            const raw = localStorage.getItem(LS_GAME_STATE);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    clearGameState() {
        try { localStorage.removeItem(LS_GAME_STATE); } catch (e) { /* ignore */ }
    }

    hasGameInProgress() {
        return !!this.loadGameState();
    }
}
