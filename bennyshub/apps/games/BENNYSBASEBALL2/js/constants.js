// ═══════════════════════════════════════════════════════════════════════════════
// BENNY'S BASEBALL 2 - Constants
// Game rules and timing are ported from BENNYSBASEBALL/js/core/constants.js so
// v2 plays with the same balance. Field geometry is new (Phaser world coords).
// ═══════════════════════════════════════════════════════════════════════════════

const W = 1000, H = 600;

// localStorage key used by audio.js (separate from v1's bennyBaseball_audio)
const LS_AUDIO = 'bennyBaseball2_audio';

const GAME_CONSTANTS = {
    TIMING: {
        TRANSITION_DURATION: 4000,
        HALF_INNING_DELAY: 3000,
        GAME_OVER_DELAY: 5000,
        // Interactive batting (identical to v1):
        // 0-2s hold = bunt, 2-4s = normal swing, 4-6s = power swing
        SWING_BUNT_MAX: 2000,
        SWING_NORMAL_MIN: 2000,
        SWING_NORMAL_MAX: 4000,
        SWING_POWER_MIN: 4000,
        SWING_POWER_MAX: 6000,
        INTERACTIVE_PITCH_DURATION: 7500,  // deliberately slow pitch for accessibility
        SWING_TIMING_WINDOW: 600,          // v1 exact — outcome quality window
        // v1 exact: the ball glows green while progress is in [0.80, 0.98]
        // (~1.35 seconds of green) — the swingable window
        GREEN_ZONE_LO: 0.80,
        GREEN_ZONE_HI: 0.98,
        HIT_BY_PITCH_CHANCE: 0.05
    },

    GAME_RULES: {
        MAX_STRIKES: 3,
        MAX_BALLS: 4,
        MAX_OUTS: 3,
        INNINGS_PER_GAME: 9
    },

    STORAGE_KEYS: {
        SEASON: 'bennyBaseball2_season',
        AUDIO: LS_AUDIO,
        PREFERENCES: 'bennyBaseball2_preferences'
    }
};

const LS_SEASON = GAME_CONSTANTS.STORAGE_KEYS.SEASON;
const LS_GAME_STATE = 'bennyBaseball2_gameState';

// ─── Season structure (football-style shell, baseball series rules) ─────────
// 16 regular games. 10+ wins → playoffs. Perfect 16-0 skips straight to the
// championship series. Playoff rounds are SERIES: best-of-3 quarterfinal,
// best-of-3 semifinal, then a best-of-5 championship.
const SEASON = {
    REGULAR_GAMES: 16,
    PLAYOFF_WIN_THRESHOLD: 10,
    PERFECT_WINS: 16,
    SERIES: {
        quarterfinal: { label: 'QUARTERFINAL', short: 'QF', winsNeeded: 2, next: 'semifinal' },
        semifinal:    { label: 'SEMIFINAL',    short: 'SF', winsNeeded: 2, next: 'championship' },
        championship: { label: 'CHAMPIONSHIP', short: 'CH', winsNeeded: 3, next: null }
    },
    STAGE_ORDER: ['quarterfinal', 'semifinal', 'championship']
};

// The nine selectable team colors — ported from v1 COLOR_OPTIONS (same names,
// same palette). `hex`/`lightHex` are the Phaser ints for the css colors.
const COLOR_OPTIONS = [
    { name: 'Red',    color: '#ff0000', light: '#ff4444', hex: 0xd92b2b, lightHex: 0xff6b6b },
    { name: 'Blue',   color: '#0066ff', light: '#4488ff', hex: 0x2b5cd9, lightHex: 0x6b9bff },
    { name: 'Green',  color: '#00cc00', light: '#44dd44', hex: 0x14a02e, lightHex: 0x5ce07a },
    { name: 'Yellow', color: '#ffcc00', light: '#ffdd44', hex: 0xe6b800, lightHex: 0xffe066 },
    { name: 'Purple', color: '#8800cc', light: '#aa44dd', hex: 0x8822cc, lightHex: 0xb266e0 },
    { name: 'Orange', color: '#ff6600', light: '#ff8844', hex: 0xf26d1b, lightHex: 0xff9a5c },
    { name: 'Pink',   color: '#ff0088', light: '#ff44aa', hex: 0xf03090, lightHex: 0xff7ac0 },
    { name: 'White',  color: '#ffffff', light: '#cccccc', hex: 0xe8e8e8, lightHex: 0xffffff },
    { name: 'Black',  color: '#000000', light: '#444444', hex: 0x222222, lightHex: 0x555555 }
];

// Active team colors for the current game — set by setTeamColors() before a
// game starts (defaults keep the title screen happy before selection).
const TEAM_COLORS = {
    player: { name: 'Red',  hex: 0xd92b2b, light: 0xff6b6b, css: '#ff0000' },
    cpu:    { name: 'Blue', hex: 0x2b5cd9, light: 0x6b9bff, css: '#0066ff' }
};

function setTeamColors(playerOpt, cpuOpt) {
    TEAM_COLORS.player = { name: playerOpt.name, hex: playerOpt.hex, light: playerOpt.lightHex, css: playerOpt.color };
    TEAM_COLORS.cpu    = { name: cpuOpt.name,    hex: cpuOpt.hex,    light: cpuOpt.lightHex,    css: cpuOpt.color };
}

function getColorByName(name) {
    const c = COLOR_OPTIONS.find(o => o.name === name) || COLOR_OPTIONS[0];
    // textCss keeps dark team names (Black) readable on dark menu backgrounds
    const textCss = c.name === 'Black' ? '#aaaaaa' : c.color;
    return { name: c.name, css: c.color, textCss, lightCss: c.light, hex: c.hex, lightHex: c.lightHex };
}

// ─── Field geometry (world px) ──────────────────────────────────────────────
// Home plate bottom-center, second base toward the top of the screen.
const FIELD = {
    HOME:   { x: 500, y: 520 },
    FIRST:  { x: 665, y: 398 },
    SECOND: { x: 500, y: 276 },
    THIRD:  { x: 335, y: 398 },
    MOUND:  { x: 500, y: 420 },
    BATTER_BOX: { x: 460, y: 514 },
    // Where each defensive player stands at the start of a play
    FIELDER_HOMES: {
        P:    { x: 500, y: 424 },
        C:    { x: 500, y: 556 },
        '1B': { x: 692, y: 380 },
        '2B': { x: 582, y: 300 },
        SS:   { x: 418, y: 300 },
        '3B': { x: 308, y: 380 },
        LF:   { x: 290, y: 178 },
        CF:   { x: 500, y: 118 },
        RF:   { x: 710, y: 178 }
    },
    // Outfield wall: one smooth arc. Corners sit exactly on the extended
    // foul lines (home→3rd and home→1st directions, scale 2.49).
    WALL_ARC: { cx: 500, cy: 630, r: 585, startDeg: 225.3, endDeg: 314.7 },
    WALL: { LF: { x: 89, y: 214 }, CF: { x: 500, y: 45 }, RF: { x: 911, y: 214 } },
    // Dugouts: player team enters/exits stage left, CPU stage right
    DUGOUT: { player: { x: -60, y: 470 }, cpu: { x: W + 60, y: 470 } }
};

// Base coordinates by the keys the game state uses
const BASE_COORDS = {
    first:  FIELD.FIRST,
    second: FIELD.SECOND,
    third:  FIELD.THIRD,
    home:   FIELD.HOME
};

const ORDINALS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth',
                  'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth'];

const PITCH_TYPES = ['Fastball', 'Curveball', 'Slider', 'Knuckleball', 'Changeup'];
const PITCH_LOCATIONS = ['Inside', 'Middle', 'Outside'];

// CPU-batting pitch outcome probabilities (ported verbatim from v1 GameLogic.processPitch)
const PITCH_PROBABILITIES = {
    Fastball: {
        strike: 48, ball: 20, foul: 12,
        outcomes: { Single: 8, Double: 7, Triple: 5, 'Home Run': 1, 'Pop Fly Out': 10, 'Ground Out': 14 }
    },
    Curveball: {
        strike: 38, ball: 24, foul: 16,
        outcomes: { Single: 10, Double: 10, Triple: 5, 'Home Run': 0, 'Pop Fly Out': 8, 'Ground Out': 17 }
    },
    Slider: {
        strike: 34, ball: 24, foul: 14,
        outcomes: { Single: 11, Double: 8, Triple: 3, 'Home Run': 0, 'Pop Fly Out': 12, 'Ground Out': 16 }
    },
    Knuckleball: {
        strike: 30, ball: 32, foul: 10,
        outcomes: { Single: 15, Double: 6, Triple: 2, 'Home Run': 0, 'Pop Fly Out': 15, 'Ground Out': 12 }
    },
    Changeup: {
        strike: 34, ball: 20, foul: 16,
        outcomes: { Single: 12, Double: 9, Triple: 4, 'Home Run': 1, 'Pop Fly Out': 14, 'Ground Out': 13 }
    }
};
