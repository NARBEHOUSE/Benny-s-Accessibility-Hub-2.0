const GAME_CONSTANTS = {
    CANVAS_ID: 'gameCanvas',
    
    MODES: {
        MAIN_MENU: 'MAIN_MENU',
        PLAY_MENU: 'PLAY_MENU',
        SETTINGS_MENU: 'SETTINGS_MENU',
        COLOR_SELECT: 'COLOR_SELECT',
        GAMEPLAY: 'GAMEPLAY',
        BATTING: 'BATTING',
        PITCHING: 'PITCHING',
        HALF_INNING_TRANSITION: 'HALF_INNING_TRANSITION',
        GAME_OVER: 'GAME_OVER',
        PAUSE_MENU: 'PAUSE_MENU',
        RESET_CONFIRMATION: 'RESET_CONFIRMATION'
    },
    
    COLORS: {
        grass: '#2d5016',
        grassLight: '#3a6b1e',
        dirt: '#8b6914',
        dirtLight: '#a67c1a',
        baseLine: '#ffffff',
        playerRed: '#ff0000',
        playerBlue: '#0000ff',
        ballWhite: '#ffffff',
        strikeZone: 'rgba(255, 255, 255, 0.2)',
        menuBg: 'rgba(20, 48, 30, 0.95)',
        menuBorder: '#4aff9e',
        menuSelected: '#ffeb3b',
        menuText: '#ffffff'
    },
    
    COLOR_OPTIONS: [
        { name: 'Red', color: '#ff0000', light: '#ff4444' },
        { name: 'Blue', color: '#0066ff', light: '#4488ff' },
        { name: 'Green', color: '#00cc00', light: '#44dd44' },
        { name: 'Yellow', color: '#ffcc00', light: '#ffdd44' },
        { name: 'Purple', color: '#8800cc', light: '#aa44dd' },
        { name: 'Orange', color: '#ff6600', light: '#ff8844' },
        { name: 'Pink', color: '#ff0088', light: '#ff44aa' },
        { name: 'White', color: '#ffffff', light: '#cccccc' },
        { name: 'Black', color: '#000000', light: '#444444' }
    ],
    
    AUDIO: {
        TRACKS: [
            'audio/music/music (1).mp3',
            'audio/music/music (2).mp3',
            'audio/music/music (3).mp3',
            'audio/music/music (4).mp3',
            'audio/music/music (5).mp3'
        ]
    },
    
    TIMING: {
        ACTION_COOLDOWN: 500,
        PLAY_COMPLETE_COOLDOWN: 3000,
        TRANSITION_DURATION: 6000,
        HALF_INNING_DELAY: 4000,
        GAME_OVER_DELAY: 5000,
        SPACE_SCAN_DELAY: 200,
        HOLD_DURATION_FOR_PAUSE: 3000
    },
    
    GAME_RULES: {
        MAX_STRIKES: 3,
        MAX_BALLS: 4,
        MAX_OUTS: 3,
        INNINGS_PER_GAME: 9
    },
    
    STORAGE_KEYS: {
        SEASON: 'bennyBaseball_season',
        AUDIO: 'bennyBaseball_audio',
        STATS: 'bennyBaseball_stats',
        PREFERENCES: 'bennyBaseball_preferences'
    }
};