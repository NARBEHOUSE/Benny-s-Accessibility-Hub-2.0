const state = {
    mode: 'menu', // menu, game, pause
    menuState: 'main', // main, singlePlayer, twoPlayer, settings, difficulty, category, editorWarning, setup
    players: 1, // 1 or 2
    gameMode: 'casual', // casual, competitive, challenge
    difficulty: 'easy',
    category: 'All',
    turn: 1,
    scores: { 1: 0, 2: 0 },
    grid: [],
    rows: 0,
    cols: 0,
    scan: { row: 0, col: 0, mode: 'row' },
    menuIndex: -1, // No initial selection
    pauseIndex: -1, // No initial selection
    assets: { categories: {} },
    firstSelection: null,
    busy: false,
    round: 0,
    soundMap: {},
    timers: { space: null, enter: null, spaceRepeat: null, enterRepeat: null, mismatch: null },
    input: { spaceHeld: false, enterHeld: false, spaceTime: 0, enterTime: 0 },
    mismatches: 0,
    mismatchLimit: 0,
    consecutiveMatches: 0,
    pauseMenuState: 'main', // main, settings
    packs: [],
    currentPackIndex: 0,
    
    // New Setup Menu State
    setup: {
        categoryIndex: 0,
        boardSizeIndex: 0,
        difficultyIndex: 0, 
        categories: [],
        boardSizes: [],
        difficulties: [
            { id: '10000', label: 'Easy (10s)', tts: 'Easy 10 Second Reveal' },
            { id: '5000', label: 'Medium (5s)', tts: 'Medium 5 Second Reveal' },
            { id: '3000', label: 'Hard (3s)', tts: 'Hard 3 Second Reveal' },
            { id: '1000', label: 'Super Hard (1s)', tts: 'Super Hard 1 Second Reveal' }
        ]
    },
    challengePlus: {
        level: 0,
        levels: []
    },
    gameSource: localStorage.getItem('matchy_game_source') || 'ALL', 
    onlinePacks: [], 
    localPacks: [],
    customAssets: {} // In-memory registry for Blob URLs
};

const settings = {
    themeIndex: 0,
    tts: true,
    ttsLocation: false,
    sound: true,
    voiceIndex: 0,
    highlightStyle: 'outline', // 'outline' or 'full'
    highlightColorIndex: 0, // 0 = Theme Default
    p1Color: 'Green',
    p2Color: 'Purple'
};

const basicColors = [
    'Red', 'Orange', 'Yellow', 'Lime', 'Green', 'Teal', 'Cyan', 'Blue', 'Purple', 'Magenta', 'Pink', 'White', 'Gray', 'Black'
];

const highlightColors = [
    'Theme Default', 'Yellow', 'White', 'Cyan', 'Lime', 'Magenta', 'Red', 'Orange', 'Pink', 'Gold', 'DeepSkyBlue', 'SpringGreen', 'Violet'
];

const themes = [
    { name: 'Default', bg: 'linear-gradient(135deg, #ff4b1f, #ff9068)', highlight: 'yellow', cardBack: '#444' },
    { name: 'Ocean', bg: 'linear-gradient(135deg, #2193b0, #6dd5ed)', highlight: 'white', cardBack: '#003366' },
    { name: 'Midnight', bg: 'linear-gradient(135deg, #232526, #414345)', highlight: '#00ff00', cardBack: '#222' },
    { name: 'Forest', bg: 'linear-gradient(135deg, #134e5e, #71b280)', highlight: '#ffcc00', cardBack: '#2e8b57' },
    { name: 'Sunset', bg: 'linear-gradient(135deg, #f12711, #f5af19)', highlight: '#ffff00', cardBack: '#8b0000' },
    { name: 'Lavender', bg: 'linear-gradient(135deg, #834d9b, #d04ed6)', highlight: '#00ffff', cardBack: '#4b0082' },
    { name: 'Mint', bg: 'linear-gradient(135deg, #00b09b, #96c93d)', highlight: '#ffffff', cardBack: '#006400' },
    { name: 'Dark Blue', bg: 'linear-gradient(135deg, #0f2027, #203a43, #2c5364)', highlight: '#00ffcc', cardBack: '#000033' }
];

const config = {
    scanHighlightPx: 8,
    spaceDebounce: 200,
    longPress: 3000,
    repeatInterval: 2000,
    colors: { ...themes[0] }
};

// --- Persistence ---
function saveSettings() {
    localStorage.setItem('matchy_settings', JSON.stringify(settings));
}

function loadSettings() {
    const saved = localStorage.getItem('matchy_settings');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            Object.assign(settings, parsed);
        } catch (e) {
            console.error("Failed to load settings:", e);
        }
    }
}

// --- Initialization ---
async function init() {
    loadSettings();
    
    // Voice Manager Integration
    if (window.NarbeVoiceManager) {
        window.NarbeVoiceManager.onSettingsChange((voiceSettings) => {
            // Re-render menu if we are in settings menu to show new voice name
            if (state.mode === 'menu' && state.menuState === 'settings') {
                renderMenu();
            } else if (state.mode === 'pause' && state.pauseMenuState === 'settings') {
                renderPauseMenu();
            }
        });
    }
    
    // Scan Manager Integration
    if (window.NarbeScanManager) {
        window.NarbeScanManager.subscribe(() => {
            if (window.NarbeScanManager.getSettings().autoScan) {
                startAutoScan();
            } else {
                stopAutoScan();
            }
        });
        // Initial start
        if (window.NarbeScanManager.getSettings().autoScan) {
            startAutoScan();
        }
    }
    
    // Initialize assets structure
    state.assets = { categories: {} };
    state.packs = [];
    state.onlinePacks = [];
    state.localPacks = [];

    // 1. Load Server Manifest
    try {
        const response = await fetch('assetManifest.json');
        if (response.ok) {
            const data = await response.json();
            
            if (data.packs && Array.isArray(data.packs)) {
                state.onlinePacks = data.packs;
            } else if (data.categories) {
                // Legacy Mode: Manifest IS the data
                console.log("Legacy manifest detected");
                state.onlinePacks = ["Default Game"]; // Placeholder
                state.assets.categories = data.categories; 
                // Note: If legacy, loading specific packs might fail if we don't handle "Default Game" special case
            }
        }
    } catch (e) {
        console.error("Failed to load server manifest:", e);
    }

    // 2. Load Local Registry
    try {
        state.localPacks = JSON.parse(localStorage.getItem('matchy_local_registry') || '[]');
    } catch(e) {
        console.error("Failed to load local registry", e);
    }
    
    // 3. Combine based on Source
    refreshPacks(); // Will populate state.packs and load first 

    setupInput();
    applyTheme();
    handleResize(); // Initial sizing check
    window.addEventListener('resize', handleResize);
    showMainMenu();
}

/*
// Deprecated old init logic for merging
    // 2. Merge Local Registry (Browser Priority)
    try {
        const localReg = JSON.parse(localStorage.getItem('matchy_local_registry') || '[]');
        
        // Helper to normalize filename for duplicate checking (ignore path)
        const getFilename = (path) => path.split('/').pop().toLowerCase();
        
        localReg.forEach(p => {
             // Check if we already have this pack (by key OR by filename match)
             const localBase = getFilename(p);
             const existingIndex = state.packs.findIndex(sp => getFilename(sp) === localBase);
             
             if (existingIndex !== -1) {
                 // Collision detected. 
                 // If the paths differ, we should prefer the LOCAL registry path 
                 // because that's what the user likely just saved/used locally.
                 // This handles "packs/animals.json" (server) vs "animals.json" (local).
                 console.log(`Duplicate pack detected: ${state.packs[existingIndex]} vs ${p}. Preferring local.`);
                 state.packs[existingIndex] = p; 
             } else {
                 state.packs.push(p);
             }
        });
    } catch(e) {
        console.error("Failed to load local registry", e);
    }
    
    // 3. Load First Pack
    // Check if __ALL__ should be injected
    if (state.packs.length > 0 && state.packs[0] !== '__ALL__') {
        state.packs.unshift('__ALL__');
    }

    if (state.packs.length > 0) {
        // Try to remember last played pack? For now just load first or specific if wanted
        // state.currentPackIndex = 0; // Default
        
        // Optional: Load last played pack if we want that behavior, 
        // but for now let's default to 0 unless we store 'last_played_pack_index'
        
        await loadPack(state.packs[0]);
    }
*/

function handleResize() {
    if (state.mode === 'game') {
        renderGame();
    } else if (state.mode === 'menu') {
        renderMenu();
    } else if (state.mode === 'pause') {
        // Rerender game background and pause menu
        const container = document.getElementById('main-content');
        if (container && container.childNodes.length === 0) {
             // If completely empty, maybe we need to redraw game underneath? 
             // Logic in pause currently creates overlay on top.
             // We can just re-adjust overlay if needed, often distinct from renderGame logic unless we clear everything.
        }
        renderPauseMenu();
    }
}

async function loadPack(filename) {
    console.log("Loading Pack:", filename);

    if (filename === '__ALL__') {
        state.assets.categories = {};
        const realPacks = state.packs.filter(p => p !== '__ALL__' && p !== 'Default Game');
        
        for (const pack of realPacks) {
             const data = await fetchPackData(pack);
             if (data && data.categories) {
                 // Check for duplicate keys if necessary, but Object.assign overwrites
                 // To behave nicely, we might want to prefix keys? 
                 // But most packs have "Animals", "Shapes". 
                 // If we just overwrite, we merge the lists? No, we replace the list.
                 // We probably want to merge lists if categories match.
                 
                 for (const [catName, cards] of Object.entries(data.categories)) {
                     if (state.assets.categories[catName]) {
                         state.assets.categories[catName] = state.assets.categories[catName].concat(cards);
                     } else {
                         state.assets.categories[catName] = cards;
                     }
                 }
             }
        }
        console.log("Loaded ALL packs");
        return;
    }
    
    // Clear categories before loading new pack (unless it's __ALL__)
    state.assets.categories = {};

    if (filename === "Default Game") {
         console.log("No pack selected / Empty state");
         return; 
    }
    
    const data = await fetchPackData(filename);
    if (data && data.categories) {
        state.assets.categories = data.categories;
        console.log("Pack loaded:", filename);
    }
}

async function fetchPackData(filename) {
    let allowLocal = true;
    let allowNetwork = true;
    
    if (state.gameSource === 'Online') {
        allowLocal = false;
    } else if (state.gameSource === 'Local') {
        allowNetwork = false;
    }

    // 1. Try Local Storage Pack first (Prioritize Local)
    if (allowLocal) {
        try {
            const localContent = localStorage.getItem('matchy_pack_' + filename);
            if (localContent) {
                const data = JSON.parse(localContent);
                if (data && data.categories) {
                    return data;
                }
            }
        } catch(e) {
            console.warn("Error reading local pack", e);
        }
    }

    // 2. Fetch from Server
    if (allowNetwork) {
        try {
            const res = await fetch(filename); 
            if (res.ok) {
                return await res.json();
            } else {
                console.error("Failed to fetch pack:", filename);
            }
        } catch (e) {
            console.error("Error loading pack:", e);
        }
    }
    return null;
}

function getPackTitle() {
    if (state.packs.length === 0 || !state.packs[state.currentPackIndex]) return "Default";
    const filename = state.packs[state.currentPackIndex];
    if (filename === '__ALL__') return "All Categories";
    if (filename === "Default Game") return "Default Game";
    
    // "packs/adult_cartoons.json" -> "Adult Cartoons"
    const base = filename.split('/').pop().replace('.json', '');
    return base.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

async function cyclePack(dir) {
    if (state.packs.length <= 1) return;
    
    // Legacy support check
    // if (state.packs[0] === "Default Game") return; // Allow cycling if we have multiple, even if one is named Default

    state.currentPackIndex = (state.currentPackIndex + dir + state.packs.length) % state.packs.length;
    await loadPack(state.packs[state.currentPackIndex]);
    
    // Reset setup state as categories might have changed
    let cats = Object.keys(state.assets.categories || {});
    cats = cats.filter(c => c !== 'Unassigned');
    state.setup.categories = ['All', ...cats];
    
    state.setup.categoryIndex = 0;
    state.category = 'All'; // Default to All

    // Refresh board sizes and UI
    updateBoardSizes();
    renderMenu();
    speak("Pack: " + getPackTitle());
}

// --- Input Handling ---
function setupInput() {
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            if (!state.input.spaceHeld) {
                state.input.spaceHeld = true;
                state.input.spaceTime = Date.now();
                state.timers.space = setTimeout(onSpaceLongPress, config.longPress);
            }
            e.preventDefault();
        } else if (e.code === 'Enter') {
            if (!state.input.enterHeld) {
                state.input.enterHeld = true;
                state.input.enterTime = Date.now();
                state.timers.enter = setTimeout(onEnterLongPress, config.longPress);
            }
            e.preventDefault();
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            clearTimeout(state.timers.space);
            clearInterval(state.timers.spaceRepeat);
            state.input.spaceHeld = false;
            const duration = Date.now() - state.input.spaceTime;
            if (duration < config.longPress) {
                onSpaceShortPress();
            }
        } else if (e.code === 'Enter') {
            clearTimeout(state.timers.enter);
            clearInterval(state.timers.enterRepeat);
            state.input.enterHeld = false;
            const duration = Date.now() - state.input.enterTime;
            if (duration < config.longPress) {
                onEnterShortPress();
            }
        }
    });
}

function onSpaceShortPress() {
    if (state.mode === 'menu') {
        if (state.menuIndex === -1) {
            state.menuIndex = 0;
            renderMenu();
        } else {
            moveMenuScan(1);
        }
    } else if (state.mode === 'game') {
        moveGameScan(1);
    } else if (state.mode === 'pause') {
        if (state.pauseIndex === -1) {
            state.pauseIndex = 0;
            renderPauseMenu();
        } else {
            movePauseScan(1);
        }
    }
}

function onSpaceLongPress() {
    performBackwardScan();
    state.timers.spaceRepeat = setInterval(() => {
        performBackwardScan();
    }, config.repeatInterval);
}

function performBackwardScan() {
    if (state.mode === 'menu') {
        if (state.menuIndex === -1) {
            state.menuIndex = 0;
            renderMenu();
        } else {
            moveMenuScan(-1);
        }
    } else if (state.mode === 'game') {
        moveGameScan(-1);
    } else if (state.mode === 'pause') {
        if (state.pauseIndex === -1) {
            state.pauseIndex = 0;
            renderPauseMenu();
        } else {
            movePauseScan(-1);
        }
    }
}

function startAutoScan() {
    stopAutoScan(); // clear existing
    
    if (!window.NarbeScanManager) return;
    
    const s = window.NarbeScanManager.getSettings();
    if (!s.autoScan) return;
    
    const speed = s.scanInterval;
    
    state.timers.scan = setInterval(() => {
        // Skip if waiting for input hold or busy
        if (state.input.spaceHeld || state.input.enterHeld || state.busy) return;
        
        onSpaceShortPress();
    }, speed);
}

function stopAutoScan() {
    if (state.timers.scan) {
        clearInterval(state.timers.scan);
        state.timers.scan = null;
    }
}

function onEnterShortPress() {
    if (state.mode === 'menu') selectMenuOption();
    else if (state.mode === 'game') selectGameOption();
    else if (state.mode === 'pause') selectPauseOption();
}

function onEnterLongPress() {
    if (state.mode === 'game') {
        showPauseMenu();
    } else if (state.mode === 'menu' || state.mode === 'pause') {
        // Handle Toggle Backwards
        performToggleBackwards();
        state.timers.enterRepeat = setInterval(() => {
            performToggleBackwards();
        }, config.repeatInterval);
    }
}

function performToggleBackwards() {
    state.ignoreHover = true;
    let items;
    if (state.mode === 'pause') {
        items = state.pauseMenuState === 'settings' ? menus.pauseSettings : menus.pause;
        if (state.pauseMenuState !== 'settings') {
            state.ignoreHover = false;
            return;
        }
        const item = items[state.pauseIndex];
        if (item && item.onPrev) {
            item.onPrev();
        }
    } else {
        items = menus[state.menuState];
        const item = items[state.menuIndex];
        if (item && item.onPrev) {
            item.onPrev();
        }
    }
    setTimeout(() => state.ignoreHover = false, 1000);
}

// --- TTS ---
function speak(text) {
    if (!settings.tts) return;
    if (window.NarbeVoiceManager) {
        window.NarbeVoiceManager.speak(text);
    }
}

// --- Menu System ---
function getColorSwatch(color) {
    return `<span style="display:inline-block; width:24px; height:24px; background-color:${color}; border:2px solid #fff; margin-left:10px; vertical-align:middle; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></span>`;
}

const menus = {
    main: [
        { text: "Single Player", action: () => showSinglePlayerMenu() },
        { text: "Two Player", action: () => showTwoPlayerMenu() },
        { text: () => `Game Source: ${state.gameSource}`, action: () => cycleGameSource(), onPrev: () => cycleGameSource(-1) },
        { text: "Load Custom Game", action: () => showLoadWarning() },
        { text: "Settings", action: () => showSettingsMenu() },
        { text: "Exit", action: () => {
            speak("Exiting to Hub");
            setTimeout(() => {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ action: 'focusBackButton' }, '*');
                } else {
                    window.location.href = '../../../index.html';
                }
            }, 500);
        } }
    ],
    singlePlayer: [
        { text: "Casual", action: () => setGameMode('single', 'casual') },
        { text: "Challenge", action: () => setGameMode('single', 'challenge') },
        { text: "Challenge+", action: () => startChallengePlusSetup() },
        { text: "Back", action: () => showMainMenu() }
    ],
    twoPlayer: [
        { text: "Casual", action: () => setGameMode('two', 'casual') },
        { text: "Competitive", action: () => startCompetitiveMatch() },
        { text: "Back", action: () => showMainMenu() }
    ],
    settings: [
        { text: () => `Change Theme: ${themes[settings.themeIndex].name}`, action: () => cycleTheme(1), onPrev: () => cycleTheme(-1) },
        { text: () => `TTS: ${settings.tts ? 'On' : 'Off'}`, action: () => toggleTTS(), onPrev: () => toggleTTS() },
        { text: () => `Location TTS: ${settings.ttsLocation ? 'On' : 'Off'}`, action: () => toggleTTSLocation(), onPrev: () => toggleTTSLocation() },
        { text: () => `Sound: ${settings.sound ? 'On' : 'Off'}`, action: () => toggleSound(), onPrev: () => toggleSound() },
        { text: () => `Highlight Style: ${settings.highlightStyle === 'outline' ? 'Outline' : 'Full Cell'}`, action: () => toggleHighlightStyle(), onPrev: () => toggleHighlightStyle() },
        { text: () => `Highlight Color: ${highlightColors[settings.highlightColorIndex]}`, action: () => cycleHighlightColor(1), onPrev: () => cycleHighlightColor(-1) },
        { text: () => `P2 Color: ${settings.p2Color}${getColorSwatch(settings.p2Color)}`, action: () => cycleP2Color(1), onPrev: () => cycleP2Color(-1) },
        { text: "Open Editor", action: () => showEditorWarning() },
        { text: "Clear Local Cache", action: () => clearLocalCache() },
        { text: () => `Voice: ${getVoiceName()}`, action: () => cycleVoice(1), onPrev: () => cycleVoice(-1) },
        { 
            text: () => {
                 if(window.NarbeScanManager) return `Auto Scan: ${window.NarbeScanManager.getSettings().autoScan ? 'On' : 'Off'}`;
                 return "Auto Scan: Off";
            }, 
            action: () => {
                 if(window.NarbeScanManager) window.NarbeScanManager.updateSettings({autoScan: !window.NarbeScanManager.getSettings().autoScan});
                 if(window.NarbeScanManager && window.NarbeScanManager.getSettings().autoScan) startAutoScan();
                 else stopAutoScan();
                 renderMenu();
            }, 
            onPrev: () => {
                 if(window.NarbeScanManager) window.NarbeScanManager.updateSettings({autoScan: !window.NarbeScanManager.getSettings().autoScan});
                 if(window.NarbeScanManager && window.NarbeScanManager.getSettings().autoScan) startAutoScan();
                 else stopAutoScan();
                 renderMenu();
            }
        },
        { 
            text: () => {
                 if(window.NarbeScanManager) return `Scan Speed: ${window.NarbeScanManager.getScanInterval()/1000}s`;
                 return "Scan Speed: 2s";
            }, 
            action: () => {
                 if(window.NarbeScanManager) window.NarbeScanManager.cycleScanSpeed();
                 if(window.NarbeScanManager && window.NarbeScanManager.getSettings().autoScan) startAutoScan(); // Restart timer
                 renderMenu();
            }, 
            onPrev: () => {
                 if(window.NarbeScanManager) window.NarbeScanManager.cycleScanSpeed();
                 if(window.NarbeScanManager && window.NarbeScanManager.getSettings().autoScan) startAutoScan();
                 renderMenu();
            }
        },
        { text: "Back", action: () => showMainMenu() }
    ],
    editorWarning: [
        { text: "Continue (Mouse Needed)", action: () => openEditor() },
        { text: "Cancel", action: () => showSettingsMenu() }
    ],
    loadWarning: [
        { text: "Select Folder", action: () => promptLoadGame() },
        { text: "Cancel", action: () => showMainMenu() }
    ],
    difficulty: [
        { text: "Easy", action: () => startGame('easy') },
        { text: "Medium", action: () => startGame('medium') },
        { text: "Hard", action: () => startGame('hard') },
        { text: "Back", action: () => showCategoryMenu() }
    ],
    pause: [
        { text: "Continue Game", action: () => resumeGame() },
        { text: "Settings", action: () => showPauseSettings() },
        { text: "Return to Menu", action: () => showMainMenu() },
        { text: "Exit", action: () => {
             speak("Exiting to Hub");
             setTimeout(() => {
                 if (window.parent && window.parent !== window) {
                     window.parent.postMessage({ action: 'focusBackButton' }, '*');
                 } else {
                     window.location.href = '../../../index.html';
                 }
             }, 500);
        } }
    ],
    pauseSettings: [
        { text: () => `Change Theme: ${themes[settings.themeIndex].name}`, action: () => cycleTheme(1, true), onPrev: () => cycleTheme(-1, true) },
        { text: () => `TTS: ${settings.tts ? 'On' : 'Off'}`, action: () => toggleTTS(true), onPrev: () => toggleTTS(true) },
        { text: () => `Location TTS: ${settings.ttsLocation ? 'On' : 'Off'}`, action: () => toggleTTSLocation(true), onPrev: () => toggleTTSLocation(true) },
        { text: () => `Sound: ${settings.sound ? 'On' : 'Off'}`, action: () => toggleSound(true), onPrev: () => toggleSound(true) },
        { text: () => `Highlight Style: ${settings.highlightStyle === 'outline' ? 'Outline' : 'Full Cell'}`, action: () => toggleHighlightStyle(true), onPrev: () => toggleHighlightStyle(true) },
        { text: () => `Highlight Color: ${highlightColors[settings.highlightColorIndex]}`, action: () => cycleHighlightColor(1, true), onPrev: () => cycleHighlightColor(-1, true) },
        { text: () => `P1 Color: ${settings.p1Color}${getColorSwatch(settings.p1Color)}`, action: () => cycleP1Color(1, true), onPrev: () => cycleP1Color(-1, true) },
        { text: () => `P2 Color: ${settings.p2Color}${getColorSwatch(settings.p2Color)}`, action: () => cycleP2Color(1, true), onPrev: () => cycleP2Color(-1, true) },
        { text: () => `Voice: ${getVoiceName()}`, action: () => cycleVoice(1, true), onPrev: () => cycleVoice(-1, true) },
        { 
            text: () => {
                 if(window.NarbeScanManager) return `Auto Scan: ${window.NarbeScanManager.getSettings().autoScan ? 'On' : 'Off'}`;
                 return "Auto Scan: Off";
            }, 
            action: () => {
                 if(window.NarbeScanManager) window.NarbeScanManager.updateSettings({autoScan: !window.NarbeScanManager.getSettings().autoScan});
                 if(window.NarbeScanManager && window.NarbeScanManager.getSettings().autoScan) startAutoScan();
                 else stopAutoScan();
                 renderMenu();
            }, 
            onPrev: () => {
                 if(window.NarbeScanManager) window.NarbeScanManager.updateSettings({autoScan: !window.NarbeScanManager.getSettings().autoScan});
                 if(window.NarbeScanManager && window.NarbeScanManager.getSettings().autoScan) startAutoScan();
                 else stopAutoScan();
                 renderMenu();
            }
        },
        { 
            text: () => {
                 if(window.NarbeScanManager) return `Scan Speed: ${window.NarbeScanManager.getScanInterval()/1000}s`;
                 return "Scan Speed: 2s";
            }, 
            action: () => {
                 if(window.NarbeScanManager) window.NarbeScanManager.cycleScanSpeed();
                 if(window.NarbeScanManager && window.NarbeScanManager.getSettings().autoScan) startAutoScan();
                 renderMenu();
            }, 
            onPrev: () => {
                 if(window.NarbeScanManager) window.NarbeScanManager.cycleScanSpeed();
                 if(window.NarbeScanManager && window.NarbeScanManager.getSettings().autoScan) startAutoScan();
                 renderMenu();
            }
        },
        { text: "Back", action: () => showPauseMenu() }
    ],
    setup: []
};

function clearLocalCache() {
    if (confirm("Are you sure you want to delete all locally saved games and assets? This cannot be undone.")) {
         const keysToRemove = [];
         for (let i = 0; i < localStorage.length; i++) {
             const key = localStorage.key(i);
             if (key.startsWith('matchy_pack_') || key.startsWith('matchy_asset_') || key === 'matchy_local_registry') {
                 keysToRemove.push(key);
             }
         }
         keysToRemove.forEach(k => localStorage.removeItem(k));
         
         state.localPacks = [];
         refreshPacks();
         speak("Local cache cleared");
         
         // Force switch to Online or ALL if currently Local
         if (state.gameSource === 'Local') {
             state.gameSource = 'ALL';
             localStorage.setItem('matchy_game_source', 'ALL');
             refreshPacks();
         }
         
         renderMenu();
    }
}

function cycleGameSource(dir = 1) {
    const sources = ['ALL', 'Local', 'Online'];
    let idx = sources.indexOf(state.gameSource);
    if (idx === -1) idx = 0;
    
    idx = (idx + dir + sources.length) % sources.length;
    state.gameSource = sources[idx];
    localStorage.setItem('matchy_game_source', state.gameSource);
    
    refreshPacks();
    renderMenu();
    speak("Game Source: " + state.gameSource);
}

function refreshPacks() {
    let newPacks = [];
    
    // Filter duplicates helper (simple version, assuming unique filenames mostly)
    // Actually, local overrides online if Same Name?
    // Let's just combine for now based on source
    
    if (state.gameSource === 'Online') {
        newPacks = [...state.onlinePacks];
    } else if (state.gameSource === 'Local') {
        newPacks = [...state.localPacks];
    } else {
        // ALL: Combine unique paths from both lists
        const allPaths = new Set([...state.onlinePacks, ...state.localPacks]);
        newPacks = Array.from(allPaths);
    }
    
    // Ensure __ALL__ is present if needed
    // Only if we have multiple packs
    if (newPacks.length > 0) {
        newPacks.unshift('__ALL__');
    } else {
        newPacks = ["Default Game"]; // Fallback
    }
    
    state.packs = newPacks;
    state.currentPackIndex = 0;
    
    // Attempt to load the new first pack
    loadPack(state.packs[0]).catch(console.error);
}

function showMainMenu() {
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.remove();
    state.mode = 'menu';
    state.menuState = 'main';
    state.menuIndex = -1;
    // Clearing Timers for fresh start
    clearChallengeTimers();
    clearTimeout(state.timers.mismatch);
    state.busy = false; // Reset busy if user quit during memorize
    renderMenu();
}

function showSinglePlayerMenu() {
    state.menuState = 'singlePlayer';
    state.menuIndex = -1;
    renderMenu();
}

function showTwoPlayerMenu() {
    state.menuState = 'twoPlayer';
    state.menuIndex = -1;
    renderMenu();
}

function showSettingsMenu() {
    state.menuState = 'settings';
    state.menuIndex = -1;
    renderMenu();
}

function showEditorWarning() {
    state.menuState = 'editorWarning';
    state.menuIndex = -1;
    renderMenu();
}

function openEditor() {
    window.open('editor.html', '_blank');
}

function showLoadWarning() {
    state.menuState = 'loadWarning';
    state.menuIndex = 0;
    renderMenu();
}

function promptLoadGame() {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.directory = true;
    input.multiple = true; // Fallback
    
    input.onchange = async e => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        
        speak("Loading Custom Game Assets...");
        
        const assets = [];
        const jsonFiles = [];
        
        // Segregate files
        for (const file of files) {
            if (file.name.toLowerCase().endsWith('.json')) {
                jsonFiles.push(file);
            } else if (file.type.startsWith('image/') || file.type.startsWith('audio/') || /\.(png|jpe?g|gif|webp|svg|mp3|wav|ogg)$/i.test(file.name)) {
                assets.push(file);
            }
        }
        
        // Helper to read JSON
        const readJSON = (file) => {
             return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const json = JSON.parse(reader.result);
                        resolve({ name: file.name, json });
                    } catch (err) {
                        resolve(null); // content parse error
                    }
                };
                reader.onerror = reject;
                reader.readAsText(file);
            });
        };

        try {
            // 1. Load Assets: Use Blob URLs to bypass Local Storage limits
            state.customAssets = {}; // Reset custom registry
        
            // Clear old local storage assets to free up space and prevent conflicts
            let clearedCount = 0;
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key && key.startsWith('matchy_asset_')) {
                    localStorage.removeItem(key);
                    clearedCount++;
                }
            }
            if (clearedCount > 0) console.log(`Cleared ${clearedCount} old assets from storage.`);

            let assetCount = 0;
            
            assets.forEach(file => {
                // Determine keys: filename, lowercase filename, maybe without ext?
                // Just store by basename for now as resolver uses that
                try {
                    const url = URL.createObjectURL(file);
                    state.customAssets[file.name] = url;
                    // Add lowercase alias just in case
                    if (file.name !== file.name.toLowerCase()) {
                        state.customAssets[file.name.toLowerCase()] = url;
                    }
                    assetCount++;
                } catch (e) {
                    console.error("Error creating blob for", file.name, e);
                }
            });
            console.log(`Registered ${assetCount} assets in memory.`);
            // alert(`Loaded ${assetCount} assets into memory.`); // Debug
            speak(`${assetCount} assets loaded successfully.`);

            // 3. Load JSON definition(s)
            // We only really support one pack definition structure right now, 
            // but if multiple are present, we could try to find one with "categories".
            const jsonResults = await Promise.all(jsonFiles.map(readJSON));
            
            const validPack = jsonResults.find(r => r && r.json && r.json.categories);
            
            if (validPack) {
                const data = validPack.json;
                const filename = validPack.name;
                
                // Save to Local Storage Registry
                localStorage.setItem('matchy_pack_' + filename, JSON.stringify(data));
                
                const localReg = JSON.parse(localStorage.getItem('matchy_local_registry') || '[]');
                if (!localReg.includes(filename)) {
                    localReg.push(filename);
                    localStorage.setItem('matchy_local_registry', JSON.stringify(localReg));
                }

                // Update runtime state
                let packIndex = state.packs.findIndex(p => p === filename || p.endsWith('/' + filename));
                if (packIndex === -1) {
                    state.packs.push(filename);
                    packIndex = state.packs.length - 1;
                }
                state.currentPackIndex = packIndex;
                state.assets.categories = data.categories;
                
                // Set custom name for display
                state.customPackName = filename.replace('.json', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

                // Reset setup state
                state.setup.categories = [];
                state.setup.categoryIndex = 0;
                
                speak("Custom Game Loaded");
                showMainMenu();
            } else {
                speak("No valid game file found in folder.");
                alert("No valid .json game file found in the selected folder.");
            }
        } catch (err) {
            console.error(err);
            speak("Error loading files");
            alert("Error loading files");
        }
    };
    input.click();
}

function startCompetitiveMatch() {
    state.players = 2;
    state.gameMode = 'competitive';
    state.competitive = true;
    state.scores = { 1: 0, 2: 0 };
    state.round = 0;
    state.turn = 1;
    speak("Competitive mode. First to 10 points wins. Player one starts.");
    startGame('4x4');
}

function setGameMode(players, mode) {
    state.players = (players === 'single') ? 1 : 2;
    state.gameMode = mode;
    state.competitive = (mode === 'competitive');
    showSetupMenu();
}

function showSetupMenu() {
    state.mode = 'menu';
    state.menuState = 'setup';
    state.menuIndex = 0;

    // Initialize Categories Check
    if (state.setup.categories.length === 0) {
        let cats = Object.keys(state.assets.categories || {});
        cats = cats.filter(c => c !== 'Unassigned');
        state.setup.categories = ['All', ...cats];
    }
    
    // Ensure current category is valid
    if (state.setup.categoryIndex >= state.setup.categories.length) state.setup.categoryIndex = 0;
    state.category = state.setup.categories[state.setup.categoryIndex];

    updateBoardSizes(); // Updates state.setup.boardSizes based on category

    updateSetupMenu();
    renderMenu();
}

function updateBoardSizes() {
    const cats = state.assets.categories || {};
    let availableCount = 0;
    
    if (state.category === 'All') {
        Object.keys(cats).forEach(k => {
            if (Array.isArray(cats[k])) {
                availableCount += cats[k].length;
            }
        });
    } else {
        if (Array.isArray(cats[state.category])) {
            availableCount = cats[state.category].length;
        }
    }

    state.setup.boardSizes = [];
    
    if (availableCount >= 8) state.setup.boardSizes.push({ label: "4x4", id: "4x4", tts: "4 by 4" });
    if (availableCount >= 10) state.setup.boardSizes.push({ label: "4x5", id: "4x5", tts: "4 by 5" });
    if (availableCount >= 15) state.setup.boardSizes.push({ label: "5x6", id: "5x6", tts: "5 by 6" });
    if (availableCount >= 18) state.setup.boardSizes.push({ label: "6x6", id: "6x6", tts: "6 by 6" });
    
    if (state.setup.boardSizes.length === 0) {
        state.setup.boardSizes.push({ label: "Not enough cards", id: null, tts: "Not enough cards" });
    }

    // Reset loop if out of bounds (though usually we want to keep index if possible)
    if (state.setup.boardSizeIndex >= state.setup.boardSizes.length) {
        state.setup.boardSizeIndex = 0;
    }
}

function updateSetupMenu() {
    menus.setup = [
        { 
            text: () => `Pack: ${getPackTitle()}`, 
            action: () => cyclePack(1),
            onPrev: () => cyclePack(-1)
        },
        { 
            text: () => `Category: ${state.category}`, 
            tts: () => `Category: ${state.category}`,
            action: () => cycleCategory(1),
            onPrev: () => cycleCategory(-1)
        },
        { 
            text: () => {
                const b = state.setup.boardSizes[state.setup.boardSizeIndex];
                return `Board Size: ${b ? b.label : 'N/A'}`;
            }, 
            tts: () => {
                const b = state.setup.boardSizes[state.setup.boardSizeIndex];
                return `Board Size: ${b ? (b.tts || b.label) : 'N/A'}`;
            },
            action: () => cycleBoardSize(1),
            onPrev: () => cycleBoardSize(-1)
        }
    ];

    if (state.gameMode === 'challenge') {
        menus.setup.push({ 
            text: () => `Difficulty: ${state.setup.difficulties[state.setup.difficultyIndex].label}`, 
            tts: () => `Difficulty: ${state.setup.difficulties[state.setup.difficultyIndex].tts}`, 
            action: () => cycleChallengeDifficulty(1),
            onPrev: () => cycleChallengeDifficulty(-1)
        });
    }

    menus.setup.push({ 
        text: "Play Game", 
        action: () => {
            const size = state.setup.boardSizes[state.setup.boardSizeIndex];
            if (size && size.id) {
                if (state.gameMode === 'challenge') {
                    const diff = state.setup.difficulties[state.setup.difficultyIndex];
                    state.pendingBoardSize = size.id;
                    startChallengeGame(parseInt(diff.id));
                } else {
                    startGame(size.id);
                }
            } else {
                speak("Not enough cards for this category");
            }
        }
    });

    menus.setup.push({ 
        text: "Back", 
        action: () => {
            if (state.players === 2) showTwoPlayerMenu();
            else showSinglePlayerMenu();
        } 
    });
}

function cycleCategory(dir) {
    state.setup.categoryIndex = (state.setup.categoryIndex + dir + state.setup.categories.length) % state.setup.categories.length;
    state.category = state.setup.categories[state.setup.categoryIndex];
    updateBoardSizes();
    // Reset board size index when category changes to ensure valid selection
    state.setup.boardSizeIndex = 0; 
    updateSetupMenu(); // Re-bind menu items just in case, heavily reliant on dynamic text though
    renderMenu();
}

function cycleBoardSize(dir) {
    if (state.setup.boardSizes.length === 0) return;
    state.setup.boardSizeIndex = (state.setup.boardSizeIndex + dir + state.setup.boardSizes.length) % state.setup.boardSizes.length;
    renderMenu();
}

function cycleChallengeDifficulty(dir) {
    state.setup.difficultyIndex = (state.setup.difficultyIndex + dir + state.setup.difficulties.length) % state.setup.difficulties.length;
    renderMenu();
}

// Deprecated old menu functions kept as stubs or removed if possible.
// Updating old functions to redirect or just removing the flow to them.

function showCategoryMenu() {
    // Redirect to new setup
    showSetupMenu(); 
}

/*
function showBoardSizeMenu() { ... }
function selectCategory(cat) { ... }
function selectBoardSize(size) { ... }
function showChallengeDifficultyMenu() { ... }
*/

function startChallengeGame(time) {
    state.revealTime = time;
    startGame(state.pendingBoardSize);
}

function startChallengePlusSetup() {
    state.gameMode = 'challenge-plus';
    state.category = 'All';
    state.players = 1;
    
    // Generate Levels
    state.challengePlus.levels = [];
    const sizes = ['4x4', '4x5', '5x6', '6x6'];
    const times = [10000, 5000, 3000, 1000];
    
    // Check available cards to see max size
    // We need to assume updateBoardSizes logic or check manually
    // For simplicity, we add all, but startGame will handle (or fail) if not enough cards.
    // Ideally we filter sizes based on available count in 'All'.
    
    sizes.forEach(size => {
        times.forEach(time => {
             state.challengePlus.levels.push({ size, time });
        });
    });
    
    state.challengePlus.level = 0;
    
    // Announce
    speak("Challenge Plus Mode. Use all categories. Good luck.");
    startChallengePlusLevel();
}

function startChallengePlusLevel() {
    if (state.challengePlus.level >= state.challengePlus.levels.length) {
        // Victory
        state.busy = true;
        speak("You are the Champion of the Universe! All levels completed!");
        const container = document.getElementById('main-content');
        container.innerHTML = `<div class="win-message" style="color:gold; font-size:48px;">🏆<br>CHAMPION<br>OF THE UNIVERSE</div>`;
        playSystemSound('success');
        setTimeout(showMainMenu, 8000);
        return;
    }
    
    const lvl = state.challengePlus.levels[state.challengePlus.level];
    
    // Update Difficulty Display
    // We can inject a level display overlay
    state.busy = true;
    showLevelAnnouncement(state.challengePlus.level + 1, lvl.size, lvl.time);
    
    // Increased timeout to allow TTS to finish (approx 4-5 seconds)
    setTimeout(() => {
        state.revealTime = lvl.time;
        // startGame handles grid creation
        startGame(lvl.size);
    }, 5000);
}

function showLevelAnnouncement(num, size, time) {
    const container = document.getElementById('main-content');
    container.innerHTML = `
        <div style="text-align:center; animation: fadeIn 0.5s;">
            <h1 style="font-size: 60px; margin-bottom: 20px;">Level ${num}</h1>
            <div style="font-size: 32px; color: #eee;">Board: ${size}</div>
            <div style="font-size: 32px; color: #ffeb3b;">Time: ${time/1000}s</div>
        </div>
    `;
    speak(`Level ${num}, ${size.replace('x', ' by ')}, ${time/1000} second reveal`);
}

function showPauseMenu() {
    state.prevMode = state.mode;
    state.mode = 'pause';
    state.pauseMenuState = 'main';
    state.pauseIndex = -1;
    speak("Paused");
    renderPauseMenu();
}

function showPauseSettings() {
    state.pauseMenuState = 'settings';
    state.pauseIndex = 0;
    renderPauseMenu();
}

function resumeGame() {
    state.mode = 'game';
    document.getElementById('pause-overlay').remove();
}

// --- Settings Logic (Refactored for Prev/Next) ---
function cycleTheme(dir = 1, isPause = false) {
    settings.themeIndex = (settings.themeIndex + dir + themes.length) % themes.length;
    saveSettings();
    applyTheme();
    if (isPause) renderPauseMenu(); else renderMenu();
}

function applyTheme() {
    const t = themes[settings.themeIndex];
    config.colors = { ...t };
    
    // Override highlight if custom color selected
    if (settings.highlightColorIndex > 0) {
        config.colors.highlight = highlightColors[settings.highlightColorIndex];
    }

    document.body.style.background = t.bg;
    
    // Update existing elements if needed
    const header = document.getElementById('header');
    if (header) {
        header.style.background = 'rgba(0,0,0,0.3)';
        header.style.color = 'white';
    }
    
    // Re-render if in game
    if (state.mode === 'game') {
        renderGame();
    }
}

function toggleTTS(isPause = false) {
    settings.tts = !settings.tts; // Adding prev/next creates same effect for boolean
    saveSettings();
    if (isPause) renderPauseMenu(); else renderMenu();
}

function toggleTTSLocation(isPause = false) {
    settings.ttsLocation = !settings.ttsLocation; 
    saveSettings();
    if (isPause) renderPauseMenu(); else renderMenu();
}

function toggleSound(isPause = false) {
    settings.sound = !settings.sound;
    saveSettings();
    if (isPause) renderPauseMenu(); else renderMenu();
}

function toggleHighlightStyle(isPause = false) {
    settings.highlightStyle = settings.highlightStyle === 'outline' ? 'full' : 'outline';
    saveSettings();
    if (isPause) renderPauseMenu(); else renderMenu();
}

function cycleHighlightColor(dir = 1, isPause = false) {
    settings.highlightColorIndex = (settings.highlightColorIndex + dir + highlightColors.length) % highlightColors.length;
    saveSettings();
    applyTheme(); // Re-apply theme to update highlight color
    if (isPause) renderPauseMenu(); else renderMenu();
}

function cycleP1Color(dir = 1, isPause = false) {
    let idx = basicColors.indexOf(settings.p1Color);
    do {
        idx = (idx + dir + basicColors.length) % basicColors.length;
    } while (basicColors[idx] === settings.p2Color);
    
    settings.p1Color = basicColors[idx];
    saveSettings();
    if (isPause) renderPauseMenu(); else renderMenu();
}

function cycleP2Color(dir = 1, isPause = false) {
    let idx = basicColors.indexOf(settings.p2Color);
    do {
        idx = (idx + dir + basicColors.length) % basicColors.length;
    } while (basicColors[idx] === settings.p1Color);

    settings.p2Color = basicColors[idx];
    saveSettings();
    if (isPause) renderPauseMenu(); else renderMenu();
}

function cycleVoice(dir = 1, isPause = false) {
    if (window.NarbeVoiceManager) {
        // Sync with NarbeVoiceManager
        const voices = window.NarbeVoiceManager.getEnglishVoices();
        if (voices.length > 0) {
            const currentSettings = window.NarbeVoiceManager.getSettings();
            let idx = currentSettings.voiceIndex || 0;
            idx = (idx + dir + voices.length) % voices.length;
            
            window.NarbeVoiceManager.updateSettings({
                voiceIndex: idx,
                voiceName: voices[idx].name
            });
            speak("Voice changed");
        }
    } else {
        const voices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
        if (voices.length > 0) {
            settings.voiceIndex = (settings.voiceIndex + dir + voices.length) % voices.length;
            saveSettings();
            speak("Voice changed");
        }
    }
    if (isPause) renderPauseMenu(); else renderMenu();
}

function getVoiceName() {
    if (window.NarbeVoiceManager) {
        const voices = window.NarbeVoiceManager.getEnglishVoices();
        const cfg = window.NarbeVoiceManager.getSettings();
        const idx = cfg.voiceIndex || 0;
        if (voices && voices[idx]) {
            return window.NarbeVoiceManager.getVoiceDisplayName(voices[idx]);
        }
    }

    const voices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
    if (voices.length > 0) {
        return voices[settings.voiceIndex % voices.length].name.slice(0, 15) + "...";
    }
    return "Default";
}

// --- Rendering ---
function applyActiveStyle(btn) {
    const t = config.colors;
    // Reset first to ensure clean state if switching styles
    btn.style.transform = 'scale(1.05)';
    
    if (settings.highlightStyle === 'outline') {
        btn.style.background = 'rgba(255, 255, 255, 0.9)'; 
        btn.style.color = '#333';
        btn.style.border = `4px solid ${t.highlight}`;
        btn.style.boxShadow = `0 0 20px ${t.highlight}`;
    } else {
        btn.style.background = t.highlight;
        btn.style.color = '#000'; 
        btn.style.border = '4px solid white';
        btn.style.boxShadow = `0 0 20px ${t.highlight}`;
    }
}

function removeActiveStyle(btn) {
    btn.style.background = '';
    btn.style.color = '';
    btn.style.border = '';
    btn.style.transform = '';
    btn.style.boxShadow = '';
}

function renderMenu() {
    // Hide game specific displays
    const scoreDisplay = document.getElementById('score-display');
    const turnDisplay = document.getElementById('turn-display');
    if (scoreDisplay) scoreDisplay.style.display = 'none';
    if (turnDisplay) turnDisplay.style.display = 'none';

    const container = document.getElementById('main-content');
    container.innerHTML = '';
    
    const title = document.createElement('div');
    title.className = 'menu-title';
    
    const titles = {
        main: "BENNY'S MATCHY MATCH",
        singlePlayer: "SINGLE PLAYER",
        twoPlayer: "TWO PLAYER",
        settings: "SETTINGS",
        editorWarning: "WARNING",
        category: "SELECT CATEGORY",
        boardSize: "SELECT BOARD SIZE",
        challengeDifficulty: "SELECT DIFFICULTY",
        setup: "GAME TYPE",
        loadWarning: "LOAD CUSTOM GAME"
    };
    title.innerText = titles[state.menuState] || "MENU";
    
    // Theme text color adjustment
    const t = themes[settings.themeIndex];
    title.style.color = (t.bg === '#eee' || t.bg === 'white') ? 'black' : 'white';
    
    container.appendChild(title);

    if (state.menuState === 'loadWarning') {
        const info = document.createElement('div');
        info.style.color = (t.bg === '#eee' || t.bg === 'white') ? 'black' : 'white';
        info.style.marginBottom = '20px';
        info.style.fontSize = '18px';
        info.style.textAlign = 'center';
        info.style.padding = '0 20px';
        info.style.maxWidth = '600px';
        info.innerText = "Upload your assets and/or packs folder to this browser and play your own custom game";
        container.appendChild(info);
    }

    const items = menus[state.menuState];
    const isSettings = state.menuState === 'settings';

    let buttonContainer = container;
    if (isSettings) {
        buttonContainer = document.createElement('div');
        buttonContainer.className = 'menu-grid';
        container.appendChild(buttonContainer);
    }


    // Reset scan state index if this is a fresh menu render without interaction (prevent jump-reset)
    // Actually, we want to SUPPORT mouse clicking without resetting.
    // The issue is likely that renderMenu re-reads state.menuIndex.
    // So if we click, we probably shouldn't set state.menuIndex to something else 
    // unless we specifically want to.
    
    // However, if we enter a new menu (like from Main -> Settings), 
    // state.menuIndex should probably reset to -1 or 0 for that new context.
    // Currently switch-case logic calling renderMenu usually resets it manually if needed,
    // or preserves it.
    
    // But the user issue "everytime I toggle something with a mouse click, it keeps jumping back to the top"
    // implies that performing an action (like toggle Sound) calls renderMenu()
    // which then highlights index 0 or whatever index is stored in state.menuIndex.
    // If we use mouse, state.menuIndex might not be updated to what we clicked.
    // So if I click item 3 (Sound), action fires -> renderMenu() -> highlight item state.menuIndex (which is 0).

    items.forEach((item, index) => {
        const btn = document.createElement('button');
        btn.className = 'menu-button';
        
        // Handle dynamic text (functions)
        const btnText = typeof item.text === 'function' ? item.text() : item.text;
        btn.innerHTML = btnText;
        
        // Only verify active scan highlight if index is valid (>= 0)
        if (state.menuIndex !== -1 && index === state.menuIndex) {
            btn.classList.add('active');
            applyActiveStyle(btn);
            // Ensure visible in scrollable lists (like settings)
            requestAnimationFrame(() => {
                btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            });
        }
        btn.onclick = () => {
             // For mouse clicks, we don't necessarily want to hijack the scan index
             // UNLESS we want keyboard/switch users to resume from there.
             // But to solve "jumping back to top":
             // We should set the scan index to THIS item so re-render keeps it here.
             state.menuIndex = index;
             item.action();
        };
        btn.onmouseenter = () => {
            if (state.ignoreHover) return;
            // Optional: Auto-select on hover? 
            // state.menuIndex = index; 
            // renderMenu(); // This would cause re-renders on hover, maybe bad performance.
            // Just speaking is fine.
            let speakText = item.tts || btnText;
            if (typeof speakText === 'function') speakText = speakText();
            speak(speakText.replace(/<[^>]*>/g, ''));
        };

        if (isSettings && index === items.length - 1) {
            btn.classList.add('span-two-cols');
        }

        buttonContainer.appendChild(btn);
    });
    
    // Only announce if we have a valid selection
    if (items.length > 0 && state.menuIndex !== -1) {
        const item = items[state.menuIndex];
        const txt = typeof item.text === 'function' ? item.text() : item.text;
        let speakText = item.tts || txt;
        if (typeof speakText === 'function') speakText = speakText();
        speak(speakText.replace(/<[^>]*>/g, ''));
    }
    startAutoScan();
}

function moveMenuScan(dir) {
    state.ignoreHover = true;
    const items = menus[state.menuState];
    state.menuIndex = (state.menuIndex + dir + items.length) % items.length;
    renderMenu();
    // Reset after a delay to allow mouse interactions again
    setTimeout(() => state.ignoreHover = false, 1000);
}

function selectMenuOption() {
    state.ignoreHover = true;
    const items = menus[state.menuState];
    items[state.menuIndex].action();
    setTimeout(() => state.ignoreHover = false, 1000);
}

function renderPauseMenu() {
    let overlay = document.getElementById('pause-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'pause-overlay';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = '';
    
    const title = document.createElement('div');
    title.className = 'pause-title';
    title.innerText = state.pauseMenuState === 'settings' ? "Pause Settings" : "Pause Menu";
    overlay.appendChild(title);
    
    const items = state.pauseMenuState === 'settings' ? menus.pauseSettings : menus.pause;
    const isSettings = state.pauseMenuState === 'settings';

    let container = overlay;
    if (isSettings) {
        container = document.createElement('div');
        container.className = 'menu-grid';
        overlay.appendChild(container);
    }

    items.forEach((item, index) => {
        const btn = document.createElement('button');
        btn.className = 'menu-button';
        const btnText = typeof item.text === 'function' ? item.text() : item.text;
        btn.innerHTML = btnText;
        if (index === state.pauseIndex) {
            btn.classList.add('active');
            applyActiveStyle(btn);
            requestAnimationFrame(() => {
                btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            });
        }
        btn.onclick = item.action;

        // If it's the last item (Back/Exit/Return) in settings, make it span two columns
        if (isSettings && index === items.length - 1) {
            btn.classList.add('span-two-cols');
        }

        container.appendChild(btn);
    });
    
    if (state.pauseIndex !== -1) {
        const txt = typeof items[state.pauseIndex].text === 'function' ? items[state.pauseIndex].text() : items[state.pauseIndex].text;
        speak(txt.replace(/<[^>]*>/g, ''));
    }
}

function movePauseScan(dir) {
    const items = state.pauseMenuState === 'settings' ? menus.pauseSettings : menus.pause;
    if (state.pauseIndex === -1) {
        state.pauseIndex = 0;
    } else {
        state.pauseIndex = (state.pauseIndex + dir + items.length) % items.length;
    }
    
    const overlay = document.getElementById('pause-overlay');
    const buttons = overlay.getElementsByClassName('menu-button');
    for (let i = 0; i < buttons.length; i++) {
        if (i === state.pauseIndex) {
            buttons[i].classList.add('active');
            applyActiveStyle(buttons[i]);
        } else {
            buttons[i].classList.remove('active');
            removeActiveStyle(buttons[i]);
        }
    }
    
    const txt = typeof items[state.pauseIndex].text === 'function' ? items[state.pauseIndex].text() : items[state.pauseIndex].text;
    speak(txt.replace(/<[^>]*>/g, ''));
    startAutoScan();
}

function selectPauseOption() {
    const items = state.pauseMenuState === 'settings' ? menus.pauseSettings : menus.pause;
    if (state.pauseIndex !== -1) {
        items[state.pauseIndex].action();
    }
}

// --- Game Logic ---
function startGame(difficulty) {
    state.mode = 'game';
    state.difficulty = difficulty;
    state.busy = false; // Reset busy flag if forced restart
    clearTimeout(state.timers.mismatch); // Clear any pending mismatch hides
    state.firstSelection = null;
    state.scan = { row: -1, col: 0, mode: 'row' };
    state.mismatches = 0;
    state.pairsFound = { 1: 0, 2: 0 };
    state.challengePhase = 'playing'; // Default

    if (state.gameMode === 'challenge' || state.gameMode === 'challenge-plus') {
        const limits = { 
            'easy': 4, 'medium': 5, 'hard': 6, // Legacy fallback
            '4x4': 4,
            '4x5': 5,
            '5x6': 6,
            '6x6': 8
        };
        state.mismatchLimit = limits[difficulty] !== undefined ? limits[difficulty] : 4;
        
        // Bonus HP for harder Challenge+ levels? Or keep it standard. Standard for now.
        
        // Set Reveal Time based on Setup Menu Selection or Level
        if (state.gameMode === 'challenge') {
            if (state.setup && state.setup.difficulties && state.setup.difficulties[state.setup.difficultyIndex]) {
                const d = state.setup.difficulties[state.setup.difficultyIndex];
                state.revealTime = parseInt(d.id) || 5000;
            } else {
                 state.revealTime = 5000;
            }
        } else {
            // Challenge+ revealTime is set in startChallengePlusLevel before calling startGame
        }

        state.challengePhase = 'countdown';
    }
    
    if (state.gameMode === 'competitive' || state.gameMode === 'challenge' || state.gameMode === 'challenge-plus') {
        state.round++;
    }
    
    // Grid setup
    const dims = {
        'easy': [4, 4], 'medium': [4, 5], 'hard': [6, 5], // Legacy fallback
        '4x4': [4, 4],
        '4x5': [4, 5],
        '5x6': [5, 6],
        '6x6': [6, 6]
    };
    
    if (dims[difficulty]) {
        [state.rows, state.cols] = dims[difficulty];
    } else {
        // Fallback default
        [state.rows, state.cols] = [4, 4];
    }
    
    generateGrid();
    renderGame();
    
    if (state.gameMode === 'competitive') {
        announceRoundStart();
        setTimeout(() => speak(`Player ${state.turn}'s turn`), 2000);
    } else if (state.players === 2) {
        speak(`Player ${state.turn}'s turn`);
    } else if (state.gameMode === 'challenge' || state.gameMode === 'challenge-plus') {
        state.busy = true;
        startChallengeSequence();
    }
}

function startChallengeSequence() {
    updateChallengeStatus("3");
    speak("3");
    
    // Clear any existing challenge timers just in case
    clearChallengeTimers();

    state.timers.challenge1 = setTimeout(() => {
        updateChallengeStatus("2");
        speak("2");
    }, 1000);

    state.timers.challenge2 = setTimeout(() => {
        updateChallengeStatus("1");
        speak("1");
    }, 2000);

    state.timers.challenge3 = setTimeout(() => {
        updateChallengeStatus("MEMORIZE!");
        speak("Memorize!");
        
        // Reveal all
        state.grid.forEach(cell => cell.revealed = true);
        renderGame(); // renderGame preserves the status text because of state.challengePhase check we will add
        
        const revealDuration = state.revealTime || 5000;
        
        state.timers.challengeReveal = setTimeout(() => {
            // Hide all
            state.grid.forEach(cell => cell.revealed = false);
            
            state.challengePhase = 'playing';
            speak("Go!");
            state.busy = false; // Enable input
            renderGame(); // This will bring back the HP bar
        }, revealDuration);
    }, 3000);
}

function clearChallengeTimers() {
    if (state.timers.challenge1) clearTimeout(state.timers.challenge1);
    if (state.timers.challenge2) clearTimeout(state.timers.challenge2);
    if (state.timers.challenge3) clearTimeout(state.timers.challenge3);
    if (state.timers.challengeReveal) clearTimeout(state.timers.challengeReveal);
    
    state.timers.challenge1 = null;
    state.timers.challenge2 = null;
    state.timers.challenge3 = null;
    state.timers.challengeReveal = null;
}

function updateChallengeStatus(text) {
    state.challengeMessage = text;
    const bar = document.getElementById('challenge-status-bar');
    if (bar) {
        bar.innerText = text;
        bar.style.display = 'flex';
        bar.style.alignItems = 'center';
        bar.style.justifyContent = 'center';
        bar.style.fontSize = '24px';
        bar.style.fontWeight = 'bold';
        bar.style.color = '#fff';
        bar.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)';
    }
}

function generateGrid() {
    state.soundMap = {}; // Clear sound map to prevent ghost sounds
    const totalCells = state.rows * state.cols;
    let activeCells = totalCells;
    let inactiveIndex = -1;
    
    if (totalCells % 2 !== 0) {
        activeCells--;
        inactiveIndex = Math.floor(Math.random() * totalCells);
    }
    
    const pairs = activeCells / 2;
    
    let availableCards = [];
    const cats = state.assets.categories || {};
    
    if (state.category === 'All') {
        Object.keys(cats).forEach(k => {
            const cards = cats[k];
            if (Array.isArray(cards)) {
                cards.forEach(c => availableCards.push(c));
            }
        });
    } else {
        const cards = cats[state.category];
        if (Array.isArray(cards)) {
            availableCards = [...cards];
        }
    }
    
    // Shuffle available cards
    for (let i = availableCards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableCards[i], availableCards[j]] = [availableCards[j], availableCards[i]];
    }
    
    const selectedCards = [];
    for(let i=0; i<pairs; i++) {
        if (availableCards.length > 0) {
            selectedCards.push(availableCards[i % availableCards.length]);
        }
    }
    
    let cards = [];
    selectedCards.forEach(card => {
        const name = card.title || "Untitled";
        let imagePath = '';
        if (card.image) {
            if (card.image.startsWith('http') || card.image.startsWith('data:')) {
                imagePath = card.image;
            } else if (card.image.startsWith('assets/')) {
                imagePath = card.image;
            } else {
                imagePath = `assets/${card.image}`;
            }
        }
        
        const altTitle = card.altTitle || "";
        cards.push({ name, image: imagePath, altTitle });
        cards.push({ name, image: imagePath, altTitle });
        
        // Store full card object for sound/tts
        state.soundMap[name] = card;
    });
    
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    
    state.grid = [];
    let cardIdx = 0;
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            const idx = r * state.cols + c;
            if (idx === inactiveIndex) {
                state.grid.push({ r, c, inactive: true });
            } else {
                state.grid.push({
                    r, c,
                    ...cards[cardIdx],
                    matched: false,
                    revealed: false,
                    inactive: false
                });
                cardIdx++;
            }
        }
    }
}

// --- Sound & UI Helpers ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSystemSound(type) {
    if (!settings.sound) {
        console.log("System sound skipped: Settings.sound is off");
        return;
    }
    
    // Ensure Context is running
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
            // Re-call or just proceed? if we rely on timing, proceeding immediately is risky if not resumed.
            // But usually immediate scheduling works.
        });
    }
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;

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
        // Simple chime: Two tones
        osc.type = 'sine';
        
        // Tone 1
        osc.frequency.setValueAtTime(523.25, now); // C5
        
        // Tone 2 (Jump)
        osc.frequency.setValueAtTime(783.99, now + 0.1); // G5 
        
        // Envelope
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.05); // Attack
        gain.gain.linearRampToValueAtTime(0.3, now + 0.2);  // Sustain
        gain.gain.linearRampToValueAtTime(0.001, now + 0.5); // Release
        
        osc.start(now);
        osc.stop(now + 0.5);
        console.log("Playing Success Sound");
    }
}

function updateHPBar() {
    const fill = document.getElementById('hp-bar-fill');
    const text = document.getElementById('hp-bar-text');
    if (fill && text) {
        const hp = state.mismatchLimit - state.mismatches;
        const hpPercent = (hp / state.mismatchLimit) * 100;
        fill.style.width = `${Math.max(0, hpPercent)}%`;
        text.innerText = `HP: ${hp} / ${state.mismatchLimit}`;
    }
}

function renderGame() {
    const container = document.getElementById('main-content');
    container.innerHTML = '';
    
    const header = document.getElementById('header');
    const scoreDisplay = document.getElementById('score-display');
    const turnDisplay = document.getElementById('turn-display');
    
    // Theme colors
    const t = config.colors;
    header.style.backgroundColor = t.bg;
    header.style.color = (t.bg === '#eee' || t.bg === 'white') ? 'black' : 'white';
    
    if (state.players === 2) {
        scoreDisplay.style.display = state.competitive ? 'block' : 'none';
        scoreDisplay.innerText = `Score - P1: ${state.scores[1]}  P2: ${state.scores[2]}`;
        turnDisplay.style.display = 'block';
        turnDisplay.innerText = `Turn: Player ${state.turn}`;
    } else {
        scoreDisplay.style.display = 'none';
        turnDisplay.style.display = 'none';
    }

    if (state.gameMode === 'challenge' || state.gameMode === 'challenge-plus') {
        const hpContainer = document.createElement('div');
        hpContainer.className = 'hp-container';
        hpContainer.id = 'challenge-status-bar';
        
        if (state.challengePhase === 'playing') {
            const hpFill = document.createElement('div');
            hpFill.className = 'hp-fill';
            hpFill.id = 'hp-bar-fill';
            
            const hp = state.mismatchLimit - state.mismatches;
            const hpPercent = (hp / state.mismatchLimit) * 100;
            hpFill.style.width = `${Math.max(0, hpPercent)}%`;
            
            const hpText = document.createElement('div');
            hpText.className = 'hp-text';
            hpText.id = 'hp-bar-text';
            if (state.gameMode === 'challenge-plus') {
                 hpText.innerText = `Lvl ${state.challengePlus.level + 1} | HP: ${hp} / ${state.mismatchLimit}`;
            } else {
                 hpText.innerText = `HP: ${hp} / ${state.mismatchLimit}`;
            }
            
            hpContainer.appendChild(hpFill);
            hpContainer.appendChild(hpText);
        } else {
             // Setup/Countdown phase
             hpContainer.innerText = state.challengeMessage || "Ready?";
             // Inline styles to override some bar defaults if needed, 
             // but CSS class mostly handles dimensions.
             hpContainer.style.display = 'flex';
             hpContainer.style.alignItems = 'center';
             hpContainer.style.justifyContent = 'center';
             hpContainer.style.fontSize = '24px';
             hpContainer.style.fontWeight = 'bold';
             hpContainer.style.color = '#fff';
             hpContainer.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)';
        }
        
        container.appendChild(hpContainer);
    }

    const pauseBtn = document.createElement('div');
    pauseBtn.id = 'pause-button';
    pauseBtn.innerHTML = '&#10074;&#10074;';
    pauseBtn.onclick = showPauseMenu;
    pauseBtn.title = "Pause Game";
    container.appendChild(pauseBtn);
    
    const gridContainer = document.createElement('div');
    gridContainer.id = 'grid-container';
    gridContainer.style.gridTemplateColumns = `repeat(${state.cols}, 1fr)`;
    gridContainer.style.gridTemplateRows = `repeat(${state.rows}, 1fr)`;
    // gridContainer.style.backgroundColor = t.bg; // Removed to let body gradient show
    
    // Maximize screen usage with tiny padding
    const extraHeadroom = state.gameMode === 'challenge' ? 140 : 80; // Space for Header/HP
    const availHeight = window.innerHeight - extraHeadroom;
    const availWidth = window.innerWidth - 20; // 10px padding each side
    
    // We want the grid to fill the available space
    gridContainer.style.width = `${availWidth}px`;
    gridContainer.style.height = `${availHeight}px`;

    // Remove aspect ratio constraint to allow filling the screen (rectangular cells)
    // gridContainer.style.aspectRatio = ... 
    
    state.grid.forEach(cell => {
        const cellDiv = document.createElement('div');
        cellDiv.className = 'grid-cell';
        cellDiv.style.width = '100%'; 
        cellDiv.style.height = '100%';
        // cellDiv.style.backgroundColor = t.bg; // Removed
        cellDiv.id = `cell-${cell.r}-${cell.c}`;
        
        if (!cell.inactive) {
            const btn = document.createElement('div');
            btn.className = 'card-button';
            btn.id = `btn-${cell.r}-${cell.c}`;
            btn.onclick = () => revealCard(cell.r, cell.c);
            btn.style.backgroundColor = t.cardBack;
            
            if (cell.matched) {
                btn.style.backgroundColor = cell.owner === 1 ? settings.p1Color : settings.p2Color;
                btn.style.borderColor = cell.owner === 1 ? settings.p1Color : settings.p2Color;
                btn.classList.add('matched');
                const img = document.createElement('img');
                
                img.src = resolveAsset(cell.image);
                
                // Use altTitle for alt text if available
                img.alt = (cell.altTitle && cell.altTitle.trim() !== "") ? cell.altTitle : cell.name;
                
                btn.appendChild(img);
            } else if (cell.revealed) {
                btn.style.backgroundColor = 'white';
                const img = document.createElement('img');
                
                img.src = resolveAsset(cell.image);
                
                // Use altTitle for alt text if available
                img.alt = (cell.altTitle && cell.altTitle.trim() !== "") ? cell.altTitle : cell.name;

                btn.appendChild(img);
            }
            
            cellDiv.appendChild(btn);
        } else {
            cellDiv.style.backgroundColor = 'transparent';
            cellDiv.style.opacity = '0.3';
        }
        
        gridContainer.appendChild(cellDiv);
    });
    
    container.appendChild(gridContainer);
    updateScanHighlight();
    if (!state.busy) startAutoScan();
}

function updateScanHighlight() {
    const t = config.colors;

    // Reset all card buttons to default state
    document.querySelectorAll('.card-button').forEach(btn => {
        if (!btn.classList.contains('matched') && !btn.classList.contains('revealed')) {
             btn.style.border = '2px solid rgba(255,255,255,0.2)';
             btn.style.backgroundColor = t.cardBack;
             btn.style.transform = 'scale(1)';
             btn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
        }
    });
    
    if (state.scan.mode === 'row') {
        for (let c = 0; c < state.cols; c++) {
            const cell = getCell(state.scan.row, c);
            if (cell && !cell.inactive && !cell.matched) {
                const btn = document.getElementById(`btn-${state.scan.row}-${c}`);
                if (btn) {
                    if (settings.highlightStyle === 'outline') {
                        btn.style.border = `8px solid ${t.highlight}`;
                    } else {
                        btn.style.backgroundColor = t.highlight;
                        btn.style.boxShadow = `0 0 15px ${t.highlight}`;
                    }
                }
            }
        }
    } else {
        const cell = getCell(state.scan.row, state.scan.col);
        if (cell && !cell.matched && !cell.revealed) {
            const btn = document.getElementById(`btn-${state.scan.row}-${state.scan.col}`);
            if (btn) {
                if (settings.highlightStyle === 'outline') {
                    btn.style.border = `8px solid ${t.highlight}`;
                } else {
                    btn.style.backgroundColor = t.highlight;
                    btn.style.boxShadow = `0 0 15px ${t.highlight}`;
                }
            }
        }
    }
}

function getCell(r, c) {
    return state.grid.find(cell => cell.r === r && cell.c === c);
}

function moveGameScan(dir) {
    state.ignoreHover = true;
    if (state.scan.mode === 'row') {
        let currentVirtual = state.scan.row === -1 ? state.rows : state.scan.row;
        const virtualLimit = state.rows + 1; // rows 0..N-1 plus one dead row

        for (let i = 0; i < virtualLimit; i++) {
            currentVirtual = (currentVirtual + dir + virtualLimit) % virtualLimit;
            const nextRow = currentVirtual === state.rows ? -1 : currentVirtual;
            
            if (nextRow === -1) {
                state.scan.row = -1;
                break;
            } else if (rowHasUnmatched(nextRow)) {
                state.scan.row = nextRow;
                break;
            }
        }
        if (settings.ttsLocation && state.scan.row !== -1) speak(`Row ${state.scan.row + 1}`);
    } else {
        let nextCol = state.scan.col;
        let found = false;
        for (let i = 1; i < state.cols; i++) {
            let check = (nextCol + dir + state.cols) % state.cols;
            const cell = getCell(state.scan.row, check);
            if (cell && !cell.inactive && !cell.matched && !cell.revealed) {
                if (dir === -1 && check > state.scan.col) {
                    state.scan.mode = 'row';
                    found = true;
                    // Switching back to row scanning
                    if (settings.ttsLocation) speak(`Row ${state.scan.row + 1}`);
                    break;
                }
                
                if (dir === 1 && check < state.scan.col) {
                    state.scan.mode = 'row';
                    found = true;
                    // Switching back to row scanning
                    if (settings.ttsLocation) speak(`Row ${state.scan.row + 1}`);
                    break;
                }

                state.scan.col = check;
                found = true;
                if (settings.ttsLocation) speak(`Card ${state.scan.col + 1}`);
                break;
            }
            nextCol = check;
        }
        
        if (!found) {
            state.scan.mode = 'row';
            if (settings.ttsLocation) speak(`Row ${state.scan.row + 1}`);
        }
    }
    updateScanHighlight();
    setTimeout(() => state.ignoreHover = false, 1000);
    startAutoScan();
}

function rowHasUnmatched(r) {
    return state.grid.some(cell => cell.r === r && !cell.matched && !cell.inactive && !cell.revealed);
}

function selectGameOption() {
    state.ignoreHover = true;
    if (state.scan.mode === 'row') {
        state.scan.mode = 'col';
        const firstCol = state.grid.find(cell => cell.r === state.scan.row && !cell.matched && !cell.inactive && !cell.revealed);
        if (firstCol) {
            state.scan.col = firstCol.c;
            if (settings.ttsLocation) speak(`Card ${state.scan.col + 1}`);
        } else {
            state.scan.mode = 'row';
            if (settings.ttsLocation) speak(`Row ${state.scan.row + 1}`);
        }
        updateScanHighlight();
        setTimeout(() => state.ignoreHover = false, 1000);
    } else {
        const revealed = revealCard(state.scan.row, state.scan.col);
        state.scan.mode = 'row';
        if (!rowHasUnmatched(state.scan.row)) {
            moveGameScan(1);
        } else {
            updateScanHighlight();
            if (settings.ttsLocation && !revealed) speak(`Row ${state.scan.row + 1}`);
        }
    }
}

function updateCardVisual(r, c) {
    const cell = getCell(r, c);
    const btn = document.getElementById(`btn-${r}-${c}`);
    if (!cell || !btn) return;

    const t = config.colors;

    // Reset content but keep the button itself
    btn.innerHTML = '';
    btn.className = 'card-button'; // Reset classes

    if (cell.matched) {
        btn.style.backgroundColor = cell.owner === 1 ? settings.p1Color : settings.p2Color;
        btn.style.borderColor = cell.owner === 1 ? settings.p1Color : settings.p2Color;
        btn.classList.add('matched');
    } else if (cell.revealed) {
        btn.style.backgroundColor = 'white';
        // Ensure no matched border override
        btn.style.borderColor = ''; 
    } else {
        btn.style.backgroundColor = t.cardBack;
        btn.style.borderColor = '';
    }

    if (cell.matched || cell.revealed) {
        const img = document.createElement('img');
        img.src = resolveAsset(cell.image);
        btn.appendChild(img);
    }
    
    updateScanHighlight();
}

function revealCard(r, c) {
    if (state.busy) return false;
    
    const cell = getCell(r, c);
    if (!cell || cell.matched || cell.revealed) return false;
    
    cell.revealed = true;
    
    // Alt-Title Logic for TTS
    let speakText = cell.name;
    if (cell.altTitle && cell.altTitle.trim() !== "") {
        speakText = cell.altTitle;
    }
    
    speak(speakText);
    updateCardVisual(r, c);
    
    if (!state.firstSelection) {
        state.firstSelection = cell;
    } else {
        if (state.firstSelection.name === cell.name) {
            state.firstSelection.matched = true;
            cell.matched = true;
            state.firstSelection.owner = state.turn;
            cell.owner = state.turn;
            
            playSound(cell.name);
            
            state.consecutiveMatches++;
            
            if (state.gameMode === 'challenge' || state.gameMode === 'challenge-plus') {
                if (state.mismatches > 0) {
                    state.mismatches--;
                    updateHPBar();
                    playSystemSound('hp-up');
                    speak("Point recovered.");
                }
            }

            if (state.players === 2) {
                state.pairsFound[state.turn]++;
            }
            
            const firstR = state.firstSelection.r;
            const firstC = state.firstSelection.c;
            state.firstSelection = null;

            updateCardVisual(firstR, firstC);
            updateCardVisual(cell.r, cell.c);
            
            checkWinCondition();
        } else {
            state.consecutiveMatches = 0;
            if (state.gameMode === 'challenge' || state.gameMode === 'challenge-plus') {
                state.mismatches++;
                updateHPBar();
                playSystemSound('hp-down');
                if (state.mismatches >= state.mismatchLimit) {
                    state.busy = true;
                    setTimeout(gameOverChallenge, 1000);
                    return true;
                }
            }

            state.busy = true;
            state.timers.mismatch = setTimeout(() => {
                const first = state.firstSelection;
                if (first) {
                    first.revealed = false;
                    updateCardVisual(first.r, first.c);
                }
                
                cell.revealed = false;
                updateCardVisual(cell.r, cell.c);

                state.firstSelection = null;
                state.busy = false;
                
                if (state.players === 2) {
                    state.turn = state.turn === 1 ? 2 : 1;
                    speak(`Player ${state.turn}'s turn`);
                    // Update turn display
                    const turnDisplay = document.getElementById('turn-display');
                    if(turnDisplay) turnDisplay.innerText = `Turn: Player ${state.turn}`;
                }
            }, 3000);
        }
    }
    return true;
}

function gameOverChallenge() {
    speak("Game Over. Too many mismatches.");
    const container = document.getElementById('main-content');
    container.innerHTML = `<div class="win-message" style="color:#ff3333">GAME OVER<br>Too many mismatches!</div>`;
    setTimeout(showMainMenu, 5000);
}

function checkWinCondition() {
    const totalPairs = Math.floor((state.rows * state.cols) / 2);
    const winThreshold = Math.floor(totalPairs / 2) + 1;

    if (state.competitive) {
        if (state.pairsFound[state.turn] >= winThreshold) {
            handleRoundEnd(state.turn);
            return;
        }
    }

    const allMatched = state.grid.every(cell => cell.inactive || cell.matched);
    if (allMatched) {
        if (state.competitive) {
            let winner = state.pairsFound[1] > state.pairsFound[2] ? 1 : 2;
            if (state.pairsFound[1] === state.pairsFound[2]) winner = 0;
            handleRoundEnd(winner);
        } else if (state.gameMode === 'challenge-plus') {
             // Win Level
             speak("Level Complete!");
             playSystemSound('success');
             state.challengePlus.level++;
             setTimeout(startChallengePlusLevel, 2000);
        } else {
            const msg = "Congratulations! You won!";
            speak(msg);
            showWinMessage(msg);
        }
    }
}

function handleRoundEnd(winner) {
    if (winner === 0) {
        speak("It's a draw. No points.");
    } else {
        const ptsMap = { 
            'easy': 1, 'medium': 2, 'hard': 3,
            '4x4': 1, '4x5': 2, '5x6': 3, '6x6': 4 
        };
        const pts = ptsMap[state.difficulty] || 1;
        state.scores[winner] += pts;
        speak(`Player ${winner} wins ${pts} points.`);
    }
    
    if (winner !== 0 && state.scores[winner] >= 10) { // Bumped win score slightly or keep 5? Keep logic simple, user didn't ask to change win condition.
        showMatchWinner(winner);
    } else {
        // Progression
        let nextDiff = '4x4';
        if (state.difficulty === '4x4' || state.difficulty === 'easy') nextDiff = '4x5';
        else if (state.difficulty === '4x5' || state.difficulty === 'medium') nextDiff = '4x4'; // Cycle back for now to be safe? 
        // Or if we have logic for 5x6
        else if (state.difficulty === '5x6') nextDiff = '4x4';
        
        // Check availability just in case? 
        // For now, let's just cycle 4x4 -> 4x5 -> 4x4 as a safe bet for competitive
        // unless I check card count.
        
        // Actually, let's just use the robust difficulty map
        const progression = {
             'easy': 'medium', 'medium': 'hard', 'hard': 'easy',
             '4x4': '4x5', '4x5': '5x6', '5x6': '6x6', '6x6': '4x4' 
        };
        
        const candidate = progression[state.difficulty] || '4x4';
        
        // Verify we have enough cards? 
        // Accessing state.assets.categories[...] length roughly
        // If not enough cards, fall back to 4x4.
        // It's a bit complex to insert here without full logic.
        // Let's stick to simple mapping for now, but assume if they are playing competitive, they probably selected a category?
        // If I make 4x4 default, it's safe.
        
        nextDiff = candidate;

        state.turn = winner !== 0 ? winner : 1;
        speak(`Next round. ${nextDiff} mode.`);
        setTimeout(() => startGame(nextDiff), 3000);
    }
}

function showWinMessage(msg) {
    const container = document.getElementById('main-content');
    container.innerHTML = `<div class="win-message">${msg}</div>`;
    setTimeout(showMainMenu, 5000);
}

function showMatchWinner(winner) {
    const container = document.getElementById('main-content');
    container.innerHTML = `
        <div class="win-message">
            Player ${winner} wins the match!<br>
            Final Score P1:${state.scores[1]} P2:${state.scores[2]}
        </div>`;
    speak(`Player ${winner} wins the match!`);
    setTimeout(showMainMenu, 6000);
}

// --- Helpers ---
function formatName(filename) {
    return filename.split('.')[0].replace(/_/g, ' ');
}

function getSlug(name) {
    let out = '';
    let prevUnderscore = false;
    
    for (let char of name.toLowerCase()) {
        if (/[a-z0-9]/.test(char)) {
            out += char;
            prevUnderscore = false;
        } else if (/\s|-|_/.test(char)) {
            if (!prevUnderscore) {
                out += '_';
                prevUnderscore = true;
            }
        }
    }
    if (out.startsWith('_')) out = out.substring(1);
    if (out.endsWith('_')) out = out.substring(0, out.length - 1);
    return out;
}

function playSound(name) {
    const card = state.soundMap[name];
    if (!card) return;

    let soundPlayed = false;

    // Priority: MP3 > TTS Text > Alt Title > Title
    if (card.sound && settings.sound) {
        let soundFile = card.sound;
        if (Array.isArray(card.sound)) {
            if (card.sound.length > 0) {
                soundFile = card.sound[Math.floor(Math.random() * card.sound.length)];
            } else {
                soundFile = null;
            }
        }

        if (soundFile) {
            const src = resolveAsset(soundFile);
            const audio = new Audio(src);
            audio.play().catch(e => console.log("Audio play failed", e));
            soundPlayed = true;
        }
    }
    
    // Fallback: If no custom sound was played, play generic success sound
    if (!soundPlayed && settings.sound) {
        playSystemSound('success');
    }

    if (!soundPlayed && settings.tts) {
        let textToSpeak = card.ttsText;
        if (!textToSpeak) textToSpeak = card.altTitle;
        if (!textToSpeak) textToSpeak = card.title;
        
        if (textToSpeak) speak(textToSpeak);
    }
}

function announceRoundStart() {
    const ordinals = ["first", "second", "third", "fourth", "fifth"];
    const roundName = ordinals[state.round - 1] || `${state.round}th`;
    speak(`${roundName} round, ${state.difficulty} mode, the score is ${state.scores[1]} to ${state.scores[2]}.`);
}

// Asset resolution helper
function resolveAsset(path) {
    if (!path) return '';
    
    // 1. Check Local Asset Registry (In-Memory Blob first, then LocalStorage)
    let fileName = path.split('/').pop().split('?')[0]; // Extract filename
    try { fileName = decodeURIComponent(fileName); } catch(e) {}

    // Check in-memory custom assets (Blob URLs)
    if (state.customAssets) {
        if (state.customAssets[fileName]) return state.customAssets[fileName];
        if (state.customAssets[fileName.toLowerCase()]) return state.customAssets[fileName.toLowerCase()];
    }

    const localKey = 'matchy_asset_' + fileName;
    const localData = localStorage.getItem(localKey);
    if (localData) {
        return localData; 
    }

    // 2. Default Path Handling
    if (path.startsWith('http') || path.startsWith('data:')) {
        return path;
    } else if (path.startsWith('assets/')) {
        return path;
    } else {
        return `assets/${path}`;
    }
}

// Start
init();
