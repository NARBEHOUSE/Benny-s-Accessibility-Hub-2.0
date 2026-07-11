// ═══════════════════════════════════════════════════════════════════════════════
// BENNY'S BASEBALL 2 - Fielding & throw-to-base mechanic (the new system)
//
// After a ground ball is fielded by YOUR team, a scan-friendly menu asks which
// base to throw to. The outcome is one probability roll, but the probability is
// built from real inputs — the fielder's arm rating, the actual pixel distance
// of the throw, and the play context (force vs tag vs relay) — instead of the
// flat Math.random() thresholds v1 used. No timing or reflexes involved.
// ═══════════════════════════════════════════════════════════════════════════════

// Arm strength per position, 1-5 scale. Corner infield + SS + RF have cannons.
const FIELDER_RATINGS = {
    P:    { arm: 2 },
    C:    { arm: 3 },
    '1B': { arm: 2 },
    '2B': { arm: 3 },
    '3B': { arm: 4 },
    SS:   { arm: 4 },
    LF:   { arm: 3 },
    CF:   { arm: 3 },
    RF:   { arm: 4 }
};

const THROW_TUNING = {
    // Baseline out chance per play context, before arm/distance adjustments.
    BASE_CHANCE: {
        force:   0.90,  // routine force play (e.g. grounder, step on the bag)
        dpRelay: 0.62,  // second throw of a double-play attempt
        tagLead: 0.45,  // cutting down a lead runner who must be tagged
        cutdown: 0.33   // long outfield throw to nail an advancing runner
    },
    ARM_BONUS_PER_POINT: 0.06,     // per arm point above/below 3
    DIST_FREE: 250,                // px of throw distance with no penalty
    DIST_PENALTY_PER_PX: 0.0004,   // chance lost per px beyond DIST_FREE
    RUNNER_SPEED_ADJ: 0.05,        // per speed point below/above 3
    MIN: 0.05,
    MAX: 0.95,
    // Ball flight speed for animation: px/ms, scaled by arm.
    THROW_SPEED_BASE: 0.45,
    THROW_SPEED_PER_ARM: 0.06
};

// Names for TTS narration
const FIELDER_NAMES = {
    P: 'the pitcher', C: 'the catcher', '1B': 'the first baseman',
    '2B': 'the second baseman', SS: 'the shortstop', '3B': 'the third baseman',
    LF: 'the left fielder', CF: 'the center fielder', RF: 'the right fielder'
};

const BASE_NAMES = {
    first: 'first base', second: 'second base', third: 'third base', home: 'home plate'
};

// One throw resolution. from = {x,y} where the fielder is holding the ball.
// Returns { out, chance, throwTimeMs } — a single roll, explainable via TTS.
function computeThrowOutcome(fielderPos, from, targetBaseKey, context, runnerSpeed) {
    const rating = FIELDER_RATINGS[fielderPos] || { arm: 3 };
    const target = BASE_COORDS[targetBaseKey];
    const dist = Phaser.Math.Distance.Between(from.x, from.y, target.x, target.y);

    let chance = THROW_TUNING.BASE_CHANCE[context] != null ? THROW_TUNING.BASE_CHANCE[context] : 0.5;
    chance += (rating.arm - 3) * THROW_TUNING.ARM_BONUS_PER_POINT;
    chance -= Math.max(0, dist - THROW_TUNING.DIST_FREE) * THROW_TUNING.DIST_PENALTY_PER_PX;
    chance += (3 - (runnerSpeed != null ? runnerSpeed : 3)) * THROW_TUNING.RUNNER_SPEED_ADJ;
    chance = Phaser.Math.Clamp(chance, THROW_TUNING.MIN, THROW_TUNING.MAX);

    const speed = THROW_TUNING.THROW_SPEED_BASE + rating.arm * THROW_TUNING.THROW_SPEED_PER_ARM;
    const throwTimeMs = Math.max(220, dist / speed);

    return { out: Math.random() < chance, chance, throwTimeMs, dist };
}

// Build the throw menu for a ground ball fielded by an infielder while the
// CPU is batting. Mirrors v1 showStealMenu's conditional-push guard style:
// only bases where a play is actually live get an option.
function getGroundballThrowOptions(bases, outs) {
    const opts = [];

    opts.push({
        value: 'first', label: 'Throw to 1st', context: 'force',
        hint: 'Get the batter for the sure out'
    });

    if (bases.first) {
        opts.push({
            value: 'second', label: 'Throw to 2nd',
            context: 'force', dpChance: outs < 2,
            hint: outs < 2 ? 'Force out, and a chance to turn two' : 'Force out the lead runner'
        });
    }

    // Throws are only offered where a runner is actually FORCED to advance —
    // non-forced runners hold on a ground ball, so there is no play on them.
    if (bases.first && bases.second) {
        opts.push({
            value: 'third', label: 'Throw to 3rd',
            context: 'force',
            hint: 'Force out the lead runner'
        });
    }

    if (bases.first && bases.second && bases.third) {
        opts.push({
            value: 'home', label: 'Throw Home',
            context: 'force',
            hint: 'Force at the plate, save the run'
        });
    }

    opts.push({
        value: 'hold', label: 'Throw to the Pitcher',
        hint: 'End the play. Everyone is safe'
    });

    return opts;
}

// Build the cutdown menu after a CPU single to the outfield when a lead
// runner tried to take an extra base. leadBase = the base being contested.
function getCutdownThrowOptions(leadBase) {
    return [
        {
            value: leadBase, label: leadBase === 'home' ? 'Throw Home' : `Throw to ${leadBase === 'third' ? '3rd' : '2nd'}`,
            context: 'cutdown',
            hint: 'Long throw to cut down the runner'
        },
        {
            value: 'hold', label: 'Throw to the Pitcher',
            hint: 'End the play. The runner advances'
        }
    ];
}
