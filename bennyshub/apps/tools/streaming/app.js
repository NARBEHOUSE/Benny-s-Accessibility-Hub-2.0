// State Constants
const STATE = {
    MAIN: 'main',
    SETTINGS: 'settings',
    GENRES: 'genres',
    ITEMS: 'items',
    MODAL: 'modal',
    SEASONS: 'seasons',
    EPISODES: 'episodes',
    KEYBOARD: 'keyboard',
    PAUSE: 'pause'
};

// Global Data
let currentState = STATE.MAIN;
let previousState = null;
let lastBrowseTitle = "Browse Genres";
let allData = [];
let genreData = {};
let filteredData = [];
let genres = [];

// Navigation Indices
let mainIndex = 0;
let settingsIndex = 0;
let genreIndex = 0;
let itemIndex = 0;
let modalIndex = 0;
let seasonIndex = 0;
let episodeIndex = 0;
let pauseIndex = 0;

// Episode Data
let currentEpisodesRaw = {};
let currentEpisodesFlat = []; // For the current page of episodes
let currentSeasonEpisodes = []; // For the selected season
let currentSeasonsList = [];
let activeSeasonNum = 1;
let episodeShowTitle = "";

// Pagination
let currentPage = 1;
let currentSeasonPage = 1;
let currentEpisodePage = 1;
const ITEMS_PER_GRID = 7; 
// const GENRES_PER_PAGE = 7; // Same logic as items

// Settings (theme/highlight only - scan/voice come from shared managers)
let settings = {
    theme: 'default',
    highlightStyle: 'fill',
    highlightColor: 'yellow'
};

// Scanning Timing
let scanTimer = null;
let backwardScanInterval = null;
let pauseTimer = null;
let spacePressedTime = 0;
let isLongPress = false;
let pauseTriggered = false; // Add flag for pause hold
let isLaunching = false; // Launching flag to prevent double execution

// Timing constants
const HOLD_THRESHOLD = 3000; // 3s for backward scan
const PAUSE_THRESHOLD = 5000; // 5s for pause menu

// DOM LOAD
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Streaming] DOMContentLoaded');
    console.log('[Streaming] NarbeScanManager available:', !!window.NarbeScanManager);
    console.log('[Streaming] NarbeVoiceManager available:', !!window.NarbeVoiceManager);
    
    loadSettings();
    
    // Subscribe to shared scan manager changes
    if (window.NarbeScanManager) {
        console.log('[Streaming] Scan settings:', window.NarbeScanManager.getSettings());
        
        // Subscribe to changes from other apps
        window.NarbeScanManager.subscribe((newSettings) => {
            console.log('[Streaming] Scan settings changed:', newSettings);
            // Restart autoscan if settings changed while running
            if (autoScanIntervalId) {
                stopAutoScan();
                if (newSettings.autoScan) startAutoScan();
            }
            updateSettingsUI();
        });
    } else {
        console.warn('[Streaming] NarbeScanManager NOT available!');
    }
    
    loadData();
    setupInputListeners();
    
    // Small delay to ensure voice manager is ready before first speak
    setTimeout(() => {
        openMainMenu();
        // Start autoscan if enabled in shared settings
        if (window.NarbeScanManager && window.NarbeScanManager.getSettings().autoScan) {
            startAutoScan();
        }
    }, 100);
});

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI;

// Base path for streaming app resources (relative to hub)
const STREAMING_BASE_PATH = isElectron ? 'apps/tools/streaming/' : '/';

// --- DATA LOADING ---
async function loadData() {
    try {
        // Load main content data
        if (isElectron) {
            // Use Electron IPC for data
            allData = await window.electronAPI.streaming.getData() || [];
            console.log(`[Streaming] Loaded ${allData.length} items from Electron API`);
        } else {
            // Fallback to fetch for browser testing
            const dRes = await fetch(STREAMING_BASE_PATH + 'data.json');
            if (dRes.ok) allData = await dRes.json();
        }
        
        // Load genres data (optional enhancement)
        try {
            const gRes = await fetch(STREAMING_BASE_PATH + 'genres.json');
            if (gRes.ok) genreData = await gRes.json();
        } catch(e) {}
        
        processGenres();

        // Populate Prediction System Vocabulary
        if (window.predictionSystem && allData.length > 0) {
            const vocab = new Set();
            allData.forEach(item => {
                if (item.title) vocab.add(item.title);
                // Only titles as requested
            });
            window.predictionSystem.setCustomVocabulary(Array.from(vocab));
        }

    } catch(e) { console.error(e); }
}

function processGenres(items = null) {
    const sourceData = items || allData;
    // Split comma-separated genres into individual genres
    const raw = new Set();
    sourceData.forEach(item => {
        const genreStr = item.genre || "Other";
        // Split by comma and trim whitespace
        const itemGenres = genreStr.split(',').map(g => g.trim()).filter(g => g.length > 0);
        if (itemGenres.length === 0) {
            raw.add("Other");
        } else {
            itemGenres.forEach(g => raw.add(g));
        }
    });
    genres = Array.from(raw).sort();
    
    // Move "Other" to the end for better UX
    if (genres.includes("Other")) {
        genres = genres.filter(g => g !== "Other");
        genres.push("Other");
    }
}

function loadSettings() {
    try {
        const s = localStorage.getItem('streaming_settings');
        if (s) {
            const loaded = JSON.parse(s);
            // Only load theme/highlight settings - scan/voice come from shared managers
            settings.theme = loaded.theme || 'default';
            settings.highlightStyle = loaded.highlightStyle || 'fill';
            settings.highlightColor = loaded.highlightColor || 'yellow';
        }
        applySettings();
    } catch(e) {
        console.error('[Streaming] Error loading settings:', e);
    }
}

function saveSettings() {
    localStorage.setItem('streaming_settings', JSON.stringify(settings));
    applySettings();
}

function applySettings() {
    // Theme (placeholder)
    document.body.className = settings.theme || 'default';
    
    // Highlight Style
    document.body.classList.remove('highlight-fill', 'highlight-outline');
    if (settings.highlightStyle === 'outline') {
        document.body.classList.add('highlight-outline');
    } else {
        // Default to fill
        document.body.classList.add('highlight-fill');
    }
    
    // Highlight Color
    const colors = ['yellow', 'cyan', 'green', 'magenta', 'orange', 'white'];
    // Remove old color classes
    colors.forEach(c => document.body.classList.remove(`color-${c}`));
    
    if (!settings.highlightColor || !colors.includes(settings.highlightColor)) {
        settings.highlightColor = 'yellow';
    }
    document.body.classList.add(`color-${settings.highlightColor}`);
}

// --- VOICE (uses shared NarbeVoiceManager - same pattern as keyboard/journal) ---
function speak(text) {
    if (!text) return;
    
    // Clean text: removes arrows
    const spokenText = text.replace(/[←→]/g, '').trim();
    if (!spokenText) return;
    
    // Use shared voice manager (same pattern as keyboard and journal apps)
    if (window.NarbeVoiceManager) {
        window.NarbeVoiceManager.cancel();
        setTimeout(() => {
            window.NarbeVoiceManager.speak(spokenText);
        }, 50);
    }
}

// --- NAVIGATION CONTROLLERS ---

// Main Menu
function openMainMenu() {
    switchView('main-menu');
    currentState = STATE.MAIN;
    mainIndex = 0;
    highlightMain(0);
    // Don't speak "Main Menu" - the highlighted button will be announced
}

function highlightMain(idx) {
    clearHighlights();
    const btns = document.querySelectorAll('#main-menu .menu-btn');
    if (idx >= btns.length) idx = 0;
    if (idx < 0) idx = btns.length - 1;
    mainIndex = idx;
    
    btns[mainIndex].classList.add('highlighted');
    speak(btns[mainIndex].textContent);
}

// Settings
function openSettings() {
    // If opening from pause menu, we reuse the settings menu but change back behavior
    const fromPause = (currentState === STATE.PAUSE);
    
    switchView('settings-menu');
    
    if (fromPause) {
        // Change back button text/behavior
        const backBtn = document.querySelector('#settings-menu .back-btn-large');
        backBtn.textContent = "Back to Pause Menu";
        backBtn.onclick = () => {
            // Restore normal back
             backBtn.textContent = "Back to Main Menu";
             backBtn.onclick = openMainMenu;
             
             // Go back to pause
             // We need to restore the view that was under the pause menu...
             // Wait, switchView hides everything else. 
             // We need to restore 'app-container' (usually) if we were paused over items.
             // This is tricky because switchView is global.
             
             // Re-open pause menu logic handles `previousState`.
             // But we need to visually switch back to `app-container` (or whatever it was)
             // BEFORE showing pause menu overlay.
             
             if (previousState === STATE.ITEMS || previousState === STATE.EPISODES) {
                  switchView('app-container');
                  // Ensure sub-views correct
                  if(previousState === STATE.ITEMS) {
                      document.getElementById('items-view').style.display = 'flex';
                      document.getElementById('episode-view').style.display = 'none';
                  } else {
                       document.getElementById('items-view').style.display = 'none';
                      document.getElementById('episode-view').style.display = 'flex';
                  }
             } else {
                 // main menu or something
                 switchView(previousState === STATE.MAIN ? 'main-menu' : 'app-container');
             }
             
             document.getElementById('pause-menu').classList.remove('hidden');
             currentState = STATE.PAUSE;
        };
    }
    
    currentState = STATE.SETTINGS;
    settingsIndex = 0;
    updateSettingsUI();
    highlightSettings(0);
    speak("Settings");
}

function updateSettingsUI() {
    document.getElementById('toggle-theme').textContent = settings.theme || 'default';
    if (document.getElementById('toggle-highlight')) {
        document.getElementById('toggle-highlight').textContent = settings.highlightStyle || 'fill';
    }
    
    // Get scan settings from shared manager
    if (window.NarbeScanManager) {
        const scanSettings = window.NarbeScanManager.getSettings();
        const speedLabels = ["1 Second", "2 Seconds", "3 Seconds", "4 Seconds"];
        document.getElementById('toggle-speed').textContent = speedLabels[scanSettings.scanSpeedIndex] || "2 Seconds";
        document.getElementById('toggle-autoscan').textContent = scanSettings.autoScan ? "On" : "Off";
    } else {
        document.getElementById('toggle-speed').textContent = "2 Seconds";
        document.getElementById('toggle-autoscan').textContent = "Off";
    }
    
    // Voice name from shared manager
    if (window.NarbeVoiceManager) {
        const voice = window.NarbeVoiceManager.getCurrentVoice();
        const displayName = voice ? window.NarbeVoiceManager.getVoiceDisplayName(voice) : "Default";
        document.getElementById('toggle-voice').textContent = displayName;
    } else {
        document.getElementById('toggle-voice').textContent = "Default";
    }
    
    if (document.getElementById('toggle-color')) {
        document.getElementById('toggle-color').textContent = (settings.highlightColor || 'yellow').charAt(0).toUpperCase() + (settings.highlightColor || 'yellow').slice(1);
    }
}

function highlightSettings(idx) {
    clearHighlights();
    // Gather logic: Rows 0-N + Back Button
    const rows = document.querySelectorAll('.setting-row');
    const backBtn = document.querySelector('#settings-menu .back-btn-large');
    
    // Dynamic total based on DOM
    const total = rows.length + 1;
    
    if (idx >= total) idx = 0;
    if (idx < 0) idx = total - 1;
    
    settingsIndex = idx;

    if (settingsIndex < rows.length) {
        const btn = rows[settingsIndex].querySelector('button');
        if (btn) btn.classList.add('highlighted');
        const span = rows[settingsIndex].querySelector('span');
        const label = span ? span.textContent : "Setting";
        speak(label + " " + (btn ? btn.textContent : ""));
    } else {
        if(backBtn) backBtn.classList.add('highlighted');
        speak("Back to Main Menu");
    }
}

// --- Menu Options specific functions ---

async function openRecent() {
    try {
        let recent = {};
        if (isElectron) {
            recent = await window.electronAPI.streaming.getLastWatched() || {};
        } else {
            const res = await fetch('/api/last_watched');
            if (res.ok) recent = await res.json();
        }
        
        // Normalize keys to lowercase and deduplicate (keep most recent)
        // This handles legacy data that might have mixed-case keys
        const normalizedRecent = {};
        for (const [key, value] of Object.entries(recent)) {
            const normalizedKey = key.toLowerCase().trim();
            // Keep the entry with the most recent timestamp
            if (!normalizedRecent[normalizedKey] || 
                (value.timestamp && value.timestamp > (normalizedRecent[normalizedKey].timestamp || 0))) {
                normalizedRecent[normalizedKey] = value;
            }
        }
        
        // Sort by timestamp (most recent first)
        const titles = Object.entries(normalizedRecent)
            .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0))
            .map(entry => entry[0]);
        
        filteredData = [];
        const seen = new Set(); // Track already-added titles to prevent duplicates
        titles.forEach(t => {
            // Find in allData (case-insensitive match)
            const found = allData.find(x => x.title.toLowerCase() === t.toLowerCase());
            if (found && !seen.has(found.title.toLowerCase())) {
                filteredData.push(found);
                seen.add(found.title.toLowerCase());
            }
        });

        lastBrowseTitle = "Recently Watched"; // Ensure back button logic works
        openItemsView("Recently Watched");
    } catch(e) { 
        console.error(e); 
        speak("Could not load recent items");
    }
}

let currentTypeFilter = null; // function taking item.type string returning boolean

function openMovies() {
    currentTypeFilter = (t) => t.toLowerCase().includes('movie');
    
    // Filter source data for genres
    const movies = allData.filter(item => item.type && currentTypeFilter(item.type));
    processGenres(movies);
    openBrowseInternal("Movies");
}

function openShows() {
    currentTypeFilter = (t) => {
        const lo = t.toLowerCase();
        return lo.includes('series') || lo.includes('show') || lo.includes('tv');
    };
    
    // Filter source data for genres
    const shows = allData.filter(item => item.type && currentTypeFilter(item.type));
    processGenres(shows);
    openBrowseInternal("TV Shows");
}

// Browse (Genres)
let currentGenrePage = 1;

function openBrowse() {
    currentTypeFilter = null;
    filteredData = allData.filter(item => item.type !== 'music').sort((a,b) => a.title.localeCompare(b.title));
    openItemsView("Browse All");
}

function openBrowseInternal(title) {
    lastBrowseTitle = title;
    switchView('app-container');
    document.getElementById('genre-view').style.display = 'block';
    document.getElementById('items-view').style.display = 'none';
    document.getElementById('episode-view').style.display = 'none'; // Ensure closed
    document.getElementById('view-title').textContent = title;
    document.getElementById('active-search-badge').style.display = 'none';
    
    // Update global back button for consistency
    const backBtn = document.getElementById('global-back-btn');
    backBtn.textContent = "← Main Menu"; 
    
    currentState = STATE.GENRES;
    currentGenrePage = 1;
    renderGenreGrid();
    highlightGenre(-1); // Focus Header
    speak(title);
}

function renderGenreGrid() {
    const grid = document.getElementById('genre-grid');
    grid.innerHTML = '';
    
    // Pagination Logic similar to Items
    const totalPages = Math.ceil(genres.length / ITEMS_PER_GRID) || 1;
    if (currentGenrePage > totalPages) currentGenrePage = totalPages;
    if (currentGenrePage < 1) currentGenrePage = 1;
    
    const start = (currentGenrePage - 1) * ITEMS_PER_GRID;
    const pageGenres = genres.slice(start, start + ITEMS_PER_GRID);
    
    // --- Slot 0: Navigation (Previous Page) ---
    const navStart = document.createElement('div');
    navStart.className = 'genre-card nav-card'; // Reuse styles
    navStart.id = `genre-0`;
    
    // Determine text based on page
    const prevText = (currentGenrePage === 1) ? "← Last Page" : "← Prev Page";
    navStart.innerHTML = `<span>${prevText}</span>`;
    
    navStart.onclick = () => { 
        currentGenrePage--; 
        if (currentGenrePage < 1) currentGenrePage = totalPages;
        renderGenreGrid(); 
        highlightGenre(0); 
    };
    grid.appendChild(navStart);

    // --- Slots 1-7: Genres ---
    for (let i = 0; i < 7; i++) {
        const g = pageGenres[i];
        const slotIdx = i + 1;
        
        if (g) {
            const card = document.createElement('div');
            card.className = 'genre-card';
            card.id = `genre-${slotIdx}`;
            
            // Image
            if (genreData[g]) {
                card.style.backgroundImage = `url('${genreData[g]}')`;
            }
            
            const label = document.createElement('span');
            label.textContent = g;
            card.appendChild(label);
            
            // Map visual slot index back to absolute index not needed if we select by name
            card.onclick = () => selectGenreByName(g);
            grid.appendChild(card);
        } else {
            // Empty
            const empty = document.createElement('div');
            empty.className = 'genre-card empty-card';
            empty.style.visibility = 'hidden';
            empty.id = `genre-${slotIdx}`;
            grid.appendChild(empty);
        }
    }

    // --- Slot 8: Navigation (Loop Next) ---
    const navEnd = document.createElement('div');
    navEnd.className = 'genre-card nav-card';
    navEnd.id = `genre-8`;
    
    // Always show if multiple pages exist
    if (totalPages > 1) {
        const nextText = (currentGenrePage === totalPages) ? "First Page →" : "Next Page →";
        navEnd.innerHTML = `<span>${nextText}</span>`;
        navEnd.onclick = () => { 
            currentGenrePage++; 
            if (currentGenrePage > totalPages) currentGenrePage = 1; // Loop back
            renderGenreGrid(); 
            highlightGenre(0); 
        };
    } else {
        navEnd.textContent = "";
        navEnd.style.visibility = 'hidden';
    }
    grid.appendChild(navEnd);
}

function highlightGenre(localIdx) {
    clearHighlights();
    // -1 (Header Back) -> 0-8 (Grid)
    if (localIdx > 8) localIdx = -1;
    if (localIdx < -1) localIdx = 8;
    
    genreIndex = localIdx;

    if (genreIndex === -1) {
        document.getElementById('global-back-btn').classList.add('highlighted');
        speak("Back to Main Menu");
        return;
    }
    
    let el = document.getElementById(`genre-${genreIndex}`);
    
    // If hidden, find next visible slot
    if (!el || el.style.visibility === 'hidden') {
        let startIdx = genreIndex;
        genreIndex++;
        
        while (genreIndex !== startIdx) {
            if (genreIndex > 8) {
                genreIndex = -1; // Wrap to header
            }
            
            if (genreIndex === -1) {
                // Header is always visible
                document.getElementById('global-back-btn').classList.add('highlighted');
                speak("Back to Main Menu");
                return;
            }
            
            el = document.getElementById(`genre-${genreIndex}`);
            if (el && el.style.visibility !== 'hidden') {
                break; // Found a visible slot
            }
            genreIndex++;
        }
    }
    
    if(el && el.style.visibility !== 'hidden') {
        el.classList.add('highlighted');
        speak(el.textContent);
    }
}

function selectGenre(idx) { 
    // This is called by keyboard "Enter" based on genreIndex (0-8)
    if (genreIndex === -1) {
        document.getElementById('global-back-btn').click();
        return;
    }
    const el = document.getElementById(`genre-${genreIndex}`);
    if(el && el.onclick) el.onclick();
}

function selectGenreByName(gName) {
    if (!gName) return;
    // Filter data - check if genre string contains the selected genre
    filteredData = allData.filter(item => {
        const itemGenre = item.genre || "Other";
        // Split the item's genres and check if any match
        const itemGenres = itemGenre.split(',').map(g => g.trim());
        const hasGenre = itemGenres.includes(gName) || (itemGenres.length === 0 && gName === "Other");
        return hasGenre && item.type !== 'music';
    });
    
    // Apply currentTypeFilter if exists
    if (currentTypeFilter) {
         filteredData = filteredData.filter(item => {
             if (!item.type) return false;
             return currentTypeFilter(item.type);
         });
    }
    
    filteredData.sort((a,b) => a.title.localeCompare(b.title));
    
    openItemsView(gName);
}

// Items View
function openItemsView(title) {
    document.getElementById('genre-view').style.display = 'none';
    document.getElementById('items-view').style.display = 'flex';
    document.getElementById('view-title').textContent = title;
    
    // Update global back button
    const backBtn = document.getElementById('global-back-btn');
    if (title === "Recently Watched" || title === "Browse All") {
        backBtn.textContent = "← Main Menu";
        backBtn.onclick = openMainMenu;
    } else if (title === "Search Results") {
        backBtn.textContent = "← Back to Search";
        backBtn.onclick = () => {
            // Go back to search
            document.getElementById('items-view').style.display = 'none';
            openSearch();
        };
    } else {
        backBtn.textContent = "← Genres";
        backBtn.onclick = handleGlobalBack;
    }

    // Ensure container visible (fix for search bug)
    switchView('app-container');

    // Hide old pagination controls if they exist in DOM, we integrate them now
    const oldP = document.querySelector('.pagination-controls');
    if(oldP) oldP.style.display = 'none';

    currentState = STATE.ITEMS;
    currentPage = 1;
    renderItemsGrid();
    highlightItem(-1); // Start at Header
    speak(title);
}

function renderItemsGrid() {
    const grid = document.getElementById('items-grid');
    grid.innerHTML = '';
    
    // Determine items for this page
    const totalPages = Math.ceil(filteredData.length / ITEMS_PER_GRID) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    
    const start = (currentPage - 1) * ITEMS_PER_GRID;
    const items = filteredData.slice(start, start + ITEMS_PER_GRID);
    const needsPagination = totalPages > 1;
    
    // Layout:
    // If single page: slots 0-8 are items (no pagination)
    // If multi page: slot 0 = prev, slots 1-7 = items, slot 8 = next
    
    if (needsPagination) {
        // --- Slot 0: Previous Page (loops to last page) ---
        const navStart = document.createElement('div');
        navStart.className = 'card nav-card';
        navStart.id = `item-0`;
        if (currentPage > 1) {
            navStart.textContent = "← Previous Page";
            navStart.onclick = () => { currentPage--; renderItemsGrid(); highlightItem(0); };
        } else {
            navStart.textContent = "← Last Page";
            navStart.onclick = () => { currentPage = totalPages; renderItemsGrid(); highlightItem(0); };
        }
        grid.appendChild(navStart);
        
        // --- Slots 1-7: Items ---
        for (let i = 0; i < 7; i++) {
            const item = items[i];
            const slotIdx = i + 1;
            
            if (item) {
                grid.appendChild(createItemCard(item, slotIdx));
            } else {
                grid.appendChild(createEmptySlot(slotIdx));
            }
        }
        
        // --- Slot 8: Next Page (loops to first page) ---
        const navEnd = document.createElement('div');
        navEnd.className = 'card nav-card';
        navEnd.id = `item-8`;
        if (currentPage < totalPages) {
            navEnd.textContent = "Next Page →";
            navEnd.onclick = () => { currentPage++; renderItemsGrid(); highlightItem(0); };
        } else {
            navEnd.textContent = "First Page →";
            navEnd.onclick = () => { currentPage = 1; renderItemsGrid(); highlightItem(0); };
        }
        grid.appendChild(navEnd);
    } else {
        // Single page - fill slots 0-8 with items, no pagination
        for (let i = 0; i < 9; i++) {
            const item = items[i];
            if (item) {
                grid.appendChild(createItemCard(item, i));
            } else {
                grid.appendChild(createEmptySlot(i));
            }
        }
    }
}

function createItemCard(item, slotIdx) {
    const card = document.createElement('div');
    card.className = 'card';
    card.id = `item-${slotIdx}`;
    card.onclick = () => showModal(item);
    
    const img = document.createElement('img');
    img.className = 'card-image';
    img.src = item.image || 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/No-Image-Placeholder.svg/330px-No-Image-Placeholder.svg.png';
    
    const content = document.createElement('div');
    content.className = 'card-content';
    const t = document.createElement('div');
    t.className = 'card-title';
    t.textContent = item.title;
    content.appendChild(t);
    
    const emblemUrl = getServiceEmblem(item);
    if (emblemUrl) {
        const emblem = document.createElement('div');
        emblem.className = 'service-emblem';
        emblem.style.backgroundImage = `url('${emblemUrl}')`;
        emblem.title = item.service || 'Streaming Service';
        card.appendChild(emblem);
    }
    
    card.appendChild(img);
    card.appendChild(content);
    return card;
}

function createEmptySlot(slotIdx) {
    const empty = document.createElement('div');
    empty.className = 'card empty-card';
    empty.style.visibility = 'hidden';
    empty.id = `item-${slotIdx}`;
    return empty;
}

function highlightItem(localIdx, direction = 1) {
    if (localIdx === undefined) localIdx = 0;
    
    clearHighlights();
    // 10 positions: -1 (header) to 8 (slots 0-8)
    
    if (localIdx > 8) localIdx = -1; // Wrap top
    if (localIdx < -1) localIdx = 8; // Wrap bottom
    
    itemIndex = localIdx;

    // Handle header button (index -1)
    if (itemIndex === -1) {
        const btn = document.getElementById('global-back-btn');
        btn.classList.add('highlighted');
        speak(btn.textContent);
        return;
    }
    
    // Check if current slot is visible
    let el = document.getElementById(`item-${itemIndex}`);
    
    // If hidden, find next visible slot (scan in direction, wrap through header)
    if (!el || el.style.visibility === 'hidden') {
        let startIdx = itemIndex;
        itemIndex += direction;
        
        while (itemIndex !== startIdx) {
            if (direction === 1) {
                if (itemIndex > 8) itemIndex = -1;
            } else {
                if (itemIndex < -1) itemIndex = 8;
            }
            
            if (itemIndex === -1) {
                // Header is always visible
                const btn = document.getElementById('global-back-btn');
                btn.classList.add('highlighted');
                speak(btn.textContent);
                return;
            }
            
            el = document.getElementById(`item-${itemIndex}`);
            if (el && el.style.visibility !== 'hidden') {
                break; // Found a visible slot
            }
            itemIndex += direction;
        }
    }
    
    if (el && el.style.visibility !== 'hidden') {
        el.classList.add('highlighted');
        
        // Speak logic
        const titleEl = el.querySelector('.card-title');
        if (titleEl) {
            speak(titleEl.textContent);
        } else {
            speak(el.textContent || "");
        }
    }
}

function selectItem() {
    if (itemIndex === -1) {
        document.getElementById('global-back-btn').click();
        return;
    }
    const el = document.getElementById(`item-${itemIndex}`);
    if(el && el.onclick) el.onclick();
}

// Search
function openSearch() {
    if (window.keyboardController) {
        // Clear previous search
        document.getElementById('search-input').value = "";
        
        // Load recent searches for prediction
        const loadHistory = async () => {
            try {
                let data = [];
                if (isElectron) {
                    data = await window.electronAPI.streaming.getSearchHistory();
                } else {
                    const res = await fetch('/api/search_history');
                    if (res.ok) data = await res.json();
                }
                if (window.predictionSystem) {
                    window.predictionSystem.setRecentSearches(data);
                    window.keyboardController.updatePredictions();
                }
            } catch(e) {
                console.error("History fetch fail", e);
            }
        };
        loadHistory();

        // Reset keyboard controller state manually since it doesn't expose a reset method
        window.keyboardController.inputElement.value = "";
        window.keyboardController.updatePredictions();
        
        window.keyboardController.open();
        currentState = STATE.KEYBOARD;
    }
}

// Modal
let currentModalItem = null;
async function showModal(item) {
    currentModalItem = item;
    document.getElementById('modal-title').textContent = item.title;
    document.getElementById('modal-meta').textContent = `${item.year || ''} ${item.director ? ' • ' + item.director : ''}`;
    document.getElementById('modal-desc').textContent = item.description || "No description available.";
    document.getElementById('modal-img').src = item.image || '';
    
    // Reset Action Container
    const actionContainer = document.querySelector('.modal-actions');
    actionContainer.innerHTML = 'Loading...';
    document.getElementById('item-modal').classList.remove('hidden');
    
    // Check for episodes
    let hasEpisodes = false;
    let epsData = {};

    try {
        if (isElectron) {
            epsData = await window.electronAPI.streaming.getEpisodes(item.title) || {};
        } else {
            const res = await fetch(`/api/episodes?show=${encodeURIComponent(item.title)}`);
            if (res.ok) epsData = await res.json();
        }
        hasEpisodes = (Object.keys(epsData).length > 0);
    } catch(e) {
        console.error('Error loading episodes:', e);
    }
    
    actionContainer.innerHTML = ''; // Clear loading

    // 1. Play / Continue
    if (hasEpisodes) {
        // Continue Button
        const btnCont = createCustomModalBtn("Continue", () => continueShow(item, epsData), true);
        actionContainer.appendChild(btnCont);

        // Pick Episode Button
        const btnPick = createCustomModalBtn("Pick Episode", () => {
             closeModal();
             openSeasonSelector(item.title, epsData);
        });
        actionContainer.appendChild(btnPick);
    } else {
        // Direct Play
        const btnPlay = createCustomModalBtn("Play", () => {
             closeModal();
             launchContent(item.url, item.title, item.type);
        }, true);
        actionContainer.appendChild(btnPlay);
    }

    // 2. Info
    const btnInfo = createCustomModalBtn("Read Info", () => {
        const text = `${item.title}. ${item.year || ''}. ${item.description || ''}`;
        speak(text);
    });
    actionContainer.appendChild(btnInfo);

    // 3. Trailer
    if (item.trailer) {
        // Only show if trailer exists
        const btnTrailer = createCustomModalBtn("View Trailer", () => {
             // Launch trailer through server (same as YouTube content)
             launchContent(item.trailer, item.title + " - Trailer", "trailer");
        });
        actionContainer.appendChild(btnTrailer);
    }

    // 4. Close
    const btnClose = createCustomModalBtn("Close", closeModal, false, true);
    actionContainer.appendChild(btnClose);

    currentState = STATE.MODAL;
    modalIndex = -1;
    highlightModal(-1);
    speak(item.title);
}

function createCustomModalBtn(text, onClick, primary=false, danger=false) {
    const btn = document.createElement('button');
    btn.className = 'modal-action-btn';
    if (primary) btn.classList.add('primary');
    if (danger) btn.classList.add('danger');
    btn.textContent = text;
    btn.onclick = onClick;
    return btn;
}

function closeModal() {
    document.getElementById('item-modal').classList.add('hidden');
    currentState = STATE.ITEMS; // Return to items
    currentModalItem = null;
    highlightItem(itemIndex); // Restore focus
}

function highlightModal(idx) {
    clearHighlights();
    const btns = document.querySelectorAll('#item-modal .modal-action-btn');
    
    // Allow -1 state (No selection)
    if (idx === -1) {
        modalIndex = -1;
        return;
    }

    if (idx >= btns.length) idx = 0;
    if (idx < 0) idx = btns.length - 1;
    modalIndex = idx;
    
    if (btns[modalIndex]) {
        btns[modalIndex].classList.add('highlighted');
        speak(btns[modalIndex].textContent);
    }
}

function selectModalAction() {
    const btns = document.querySelectorAll('#item-modal .modal-action-btn');
    if (btns[modalIndex]) btns[modalIndex].click();
}

// Logic for opening content via server (replaces simple window.open)
async function launchContent(url, title, type="movies", season=null, episode=null) {
    // Prevent double launching
    if (isLaunching) return;
    
    // Set launching flag
    isLaunching = true;
    setTimeout(() => { isLaunching = false; }, 2500);

    // Stop any active scanning
    clearTimeout(scanTimer);
    clearInterval(backwardScanInterval);
    backwardScanInterval = null;
    isLongPress = false;

    speak("Opening " + title);
    
    // Determine identifying title for "Recently Watched"
    // For episodes, we want the Show Name, not "Show S1E1"
    let saveTitle = title;
    if (type === 'shows' && season !== null && episodeShowTitle) {
        saveTitle = episodeShowTitle;
    }
    // Logic: 
    // Movie -> type='movies', season=null -> uses title ("Matrix")
    // Show (Play/Continue) -> type='shows', season=null/-1 -> uses title ("The Office")
    // Show (Episode) -> type='shows', season=1 -> uses episodeShowTitle ("The Office")
    
    try {
        if (isElectron) {
            await window.electronAPI.streaming.saveProgress({
                show: saveTitle,
                season: season,
                episode: episode,
                url: url
            });
        } else {
            await fetch('/api/save_progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    show: saveTitle,
                    season: season,
                    episode: episode,
                    url: url
                })
            });
        }
    } catch(e) {
        console.error('Error saving progress:', e);
    }

    try {
        console.log("[Streaming] Launching content:", { title, url, type, showTitle: saveTitle });
        if (isElectron) {
            await window.electronAPI.streaming.launch({
                title: title || "Unknown",
                url: url,
                type: type || "movies",
                showTitle: saveTitle  // Pass base show name for control bar (without S#E# suffix)
            });
        } else {
            await fetch('/api/open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    title: title || "Unknown", 
                    url: url, 
                    type: type || "movies",
                    showTitle: saveTitle  // Pass base show name for control bar (without S#E# suffix)
                })
            });
        }
    } catch(e) {
        console.error("Launch failed:", e);
        speak("Failed to launch");
    }
}
async function playTrailer(url) {
    window.open(url, '_blank');
}

async function checkAndPlay(item) {
   // This function is largely replaced by the logic inside showModal
   // But we keep it as a fallback if called directly
   showModal(item);
}

async function continueShow(item, epsData) {
    speak("Continuing " + item.title);
    episodeShowTitle = item.title; // Set global show title text for saving logic
    try {
        let last = null;
        if (isElectron) {
            last = await window.electronAPI.streaming.getLastWatched(item.title);
        } else {
            const res = await fetch(`/api/last_watched?show=${encodeURIComponent(item.title)}`);
            if (res.ok) last = await res.json();
        }
        
        if (last && last.url) {
             launchContent(last.url, item.title, "shows", last.season, last.episode);
        } else {
            // Find first episode
            const seasons = Object.keys(epsData).map(Number).sort((a,b)=>a-b);
            if(seasons.length > 0 && epsData[seasons[0]].length > 0) {
                 const sNum = seasons[0];
                 const firstEp = epsData[sNum][0];
                 launchContent(firstEp.url, item.title, "shows", sNum, firstEp.episode);
            } else {
                speak("No episodes found.");
            }
        }
        closeModal();
    } catch(e) { 
        console.error('Error continuing:', e);
        speak("Error continuing."); 
    }
}

// --- SEASON / EPISODE SELECTOR ---
async function openSeasonSelector(title, episodesData) {
    episodeShowTitle = title;
    currentEpisodesRaw = episodesData;
    
    // Sort seasons, and Filter out Season 0 (Specials/Extras often used in Plex)
    currentSeasonsList = Object.keys(currentEpisodesRaw)
        .map(Number)
        .filter(n => n > 0) 
        .sort((a,b) => a-b);
    
    // Fallback: If ONLY season 0 exists (e.g. a movie categorized as show?), keep it?
    // User requested specifically to ignore season 0, so we trust that.
    
    switchView('app-container');
    document.getElementById('genre-view').style.display = 'none';
    document.getElementById('items-view').style.display = 'none';
    document.getElementById('episode-view').style.display = 'flex'; // Main container
    document.getElementById('season-grid').style.display = 'grid'; // Show seasons
    document.getElementById('episode-grid').style.display = 'none'; // Hide eps
    
    document.getElementById('view-title').textContent = title;
    document.getElementById('ep-show-title').textContent = "Select Season";
    
    currentState = STATE.SEASONS;
    currentSeasonPage = 1;

    // Check if only 1 season? Maybe skip? 
    // User requested consistency, so let's show season list even if 1.
    
    renderSeasonGrid();
    highlightSeason(-1); // Header
    speak(`Select a season for ${title}`);
}

function renderSeasonGrid() {
    const grid = document.getElementById('season-grid');
    grid.innerHTML = '';
    
    const totalPages = Math.ceil(currentSeasonsList.length / ITEMS_PER_GRID) || 1;
    if (currentSeasonPage > totalPages) currentSeasonPage = totalPages;
    if (currentSeasonPage < 1) currentSeasonPage = 1;
    
    const start = (currentSeasonPage - 1) * ITEMS_PER_GRID;
    const pageSeasons = currentSeasonsList.slice(start, start + ITEMS_PER_GRID);
    
    // Update header back button to "Back to Show"
    const backBtn = document.getElementById('global-back-btn');
    backBtn.textContent = "← Back to Show";
    backBtn.onclick = () => {
        document.getElementById('episode-view').style.display = 'none';
        document.getElementById('items-view').style.display = 'flex';
        currentState = STATE.ITEMS;
        // Restore header
        backBtn.textContent = "← Genres";
        backBtn.onclick = handleGlobalBack;
        if (currentModalItem) {
            showModal(currentModalItem);
        } else {
            highlightItem(itemIndex);
        }
        speak("Back to show");
    };
    
    // Slot 0: Previous Page (loops to last page) - only if multiple pages
    const navPrev = document.createElement('div');
    navPrev.className = 'card nav-card';
    navPrev.id = `max-season-0`;
    if (totalPages > 1) {
        if (currentSeasonPage > 1) {
            navPrev.innerHTML = "<span>← Previous Page</span>";
            navPrev.onclick = () => { currentSeasonPage--; renderSeasonGrid(); highlightSeason(0); };
        } else {
            // On page 1 - loop to last page
            navPrev.innerHTML = "<span>← Last Page</span>";
            navPrev.onclick = () => { currentSeasonPage = totalPages; renderSeasonGrid(); highlightSeason(0); };
        }
    } else {
        navPrev.style.visibility = 'hidden';
    }
    grid.appendChild(navPrev);
    
    // Slots 1-7: Seasons
    for (let i = 0; i < 7; i++) {
        const sNum = pageSeasons[i];
        const slotIdx = i + 1;
        
        if (sNum !== undefined) {
            const card = document.createElement('div');
            card.className = 'card';
            card.id = `max-season-${slotIdx}`;
            
            const content = document.createElement('div');
            content.className = 'card-content';
            content.style.justifyContent = 'center';
            content.style.alignItems = 'center';
            content.style.height = '100%';
            
            const t = document.createElement('div');
            t.className = 'card-title';
            t.style.fontSize = '2em';
            t.textContent = `Season ${sNum}`;
            content.appendChild(t);
            card.appendChild(content);
            
            card.onclick = () => openSeasonEpisodes(sNum);
            grid.appendChild(card);
        } else {
            const empty = document.createElement('div');
            empty.className = 'card empty-card';
            empty.style.visibility = 'hidden';
            empty.id = `max-season-${slotIdx}`;
            grid.appendChild(empty);
        }
    }
    
    // Slot 8: Next Page (loops to first page) - only if multiple pages
    const navNext = document.createElement('div');
    navNext.className = 'card nav-card';
    navNext.id = `max-season-8`;
    if (totalPages > 1) {
        if (currentSeasonPage < totalPages) {
            navNext.innerHTML = "<span>Next Page →</span>";
            navNext.onclick = () => { currentSeasonPage++; renderSeasonGrid(); highlightSeason(0); };
        } else {
            // On last page - loop to first
            navNext.innerHTML = "<span>First Page →</span>";
            navNext.onclick = () => { currentSeasonPage = 1; renderSeasonGrid(); highlightSeason(0); };
        }
    } else {
        navNext.style.visibility = 'hidden';
    }
    grid.appendChild(navNext);
}

function highlightSeason(idx) {
    clearHighlights();
    // Range is -1 (header) to 8
    if (idx > 8) idx = -1;
    if (idx < -1) idx = 8;
    
    seasonIndex = idx;
    
    // Handle header button (index -1)
    if (seasonIndex === -1) {
        const headerBtn = document.getElementById('global-back-btn');
        if (headerBtn) {
            headerBtn.classList.add('highlighted');
            speak(headerBtn.textContent || "Back");
        }
        return;
    }
    
    let el = document.getElementById(`max-season-${seasonIndex}`);
    
    // If hidden, find next visible slot
    if (!el || el.style.visibility === 'hidden') {
        let startIdx = seasonIndex;
        seasonIndex++;
        
        while (seasonIndex !== startIdx) {
            if (seasonIndex > 8) {
                seasonIndex = -1; // Wrap to header
            }
            
            if (seasonIndex === -1) {
                // Header is always visible
                const headerBtn = document.getElementById('global-back-btn');
                if (headerBtn) {
                    headerBtn.classList.add('highlighted');
                    speak(headerBtn.textContent || "Back");
                }
                return;
            }
            
            el = document.getElementById(`max-season-${seasonIndex}`);
            if (el && el.style.visibility !== 'hidden') {
                break; // Found a visible slot
            }
            seasonIndex++;
        }
    }
    
    if(el && el.style.visibility !== 'hidden') {
        el.classList.add('highlighted');
        const txt = el.textContent || "";
        speak(txt);
    }
}

// --- EPISODE GRID ---
function openSeasonEpisodes(seasonNum) {
    activeSeasonNum = seasonNum;
    // Get episodes for this season
    currentSeasonEpisodes = currentEpisodesRaw[seasonNum] || [];
    currentSeasonEpisodes.sort((a,b) => a.episode - b.episode);
    
    document.getElementById('season-grid').style.display = 'none';
    document.getElementById('episode-grid').style.display = 'grid';
    document.getElementById('ep-show-title').textContent = `${episodeShowTitle} - Season ${seasonNum}`;
    
    currentState = STATE.EPISODES;
    currentEpisodePage = 1;
    
    renderEpisodeGrid();
    highlightEpisode(-1);
    speak(`Season ${seasonNum}. Select an episode.`);
}

function renderEpisodeGrid() {
    const grid = document.getElementById('episode-grid');
    grid.innerHTML = '';
    
    const totalPages = Math.ceil(currentSeasonEpisodes.length / ITEMS_PER_GRID) || 1;
    if (currentEpisodePage > totalPages) currentEpisodePage = totalPages;
    if (currentEpisodePage < 1) currentEpisodePage = 1;
    
    const start = (currentEpisodePage - 1) * ITEMS_PER_GRID;
    const pageEps = currentSeasonEpisodes.slice(start, start + ITEMS_PER_GRID);
    
    // Update header back button to "Back to Seasons"
    const backBtn = document.getElementById('global-back-btn');
    backBtn.textContent = "← Back to Seasons";
    backBtn.onclick = () => {
        document.getElementById('episode-grid').style.display = 'none';
        document.getElementById('season-grid').style.display = 'grid';
        document.getElementById('ep-show-title').textContent = "Select Season";
        currentState = STATE.SEASONS;
        // Restore header for seasons
        backBtn.textContent = "← Back to Show";
        backBtn.onclick = () => {
            document.getElementById('episode-view').style.display = 'none';
            document.getElementById('items-view').style.display = 'flex';
            currentState = STATE.ITEMS;
            backBtn.textContent = "← Genres";
            backBtn.onclick = handleGlobalBack;
            if (currentModalItem) {
                showModal(currentModalItem);
            } else {
                highlightItem(itemIndex);
            }
            speak("Back to show");
        };
        highlightSeason(-1);
        speak("Back to Seasons");
    };
    
    // Slot 0: Previous Page (loops to last page) - only if multiple pages
    const navPrev = document.createElement('div');
    navPrev.className = 'card nav-card';
    navPrev.id = `max-ep-0`;
    if (totalPages > 1) {
        if (currentEpisodePage > 1) {
            navPrev.innerHTML = "<span>← Previous Page</span>";
            navPrev.onclick = () => { currentEpisodePage--; renderEpisodeGrid(); highlightEpisode(0); };
        } else {
            // On page 1 - loop to last page
            navPrev.innerHTML = "<span>← Last Page</span>";
            navPrev.onclick = () => { currentEpisodePage = totalPages; renderEpisodeGrid(); highlightEpisode(0); };
        }
    } else {
        navPrev.style.visibility = 'hidden';
    }
    grid.appendChild(navPrev);
    
    // Slots 1-7: Episodes
    for (let i = 0; i < 7; i++) {
        const ep = pageEps[i];
        const slotIdx = i + 1;
        
        if (ep) {
            const card = document.createElement('div');
            card.className = 'card';
            card.id = `max-ep-${slotIdx}`;
            
            const content = document.createElement('div');
            content.className = 'card-content';
            
            const t = document.createElement('div');
            t.className = 'card-title';
            t.style.fontSize = '1.2em';
            t.textContent = `E${ep.episode}: ${ep.title}`;
            content.appendChild(t);
            card.appendChild(content);
            
            card.onclick = () => launchContent(ep.url, `${episodeShowTitle} S${activeSeasonNum}E${ep.episode}`, 'shows', activeSeasonNum, ep.episode);
            grid.appendChild(card);
        } else {
            const empty = document.createElement('div');
            empty.className = 'card empty-card';
            empty.style.visibility = 'hidden';
            empty.id = `max-ep-${slotIdx}`;
            grid.appendChild(empty);
        }
    }
    
    // Slot 8: Next Page (loops to first page) - only if multiple pages
    const navPage = document.createElement('div');
    navPage.className = 'card nav-card';
    navPage.id = `max-ep-8`;
    
    if (totalPages > 1) {
        if (currentEpisodePage < totalPages) {
            navPage.innerHTML = "<span>Next Page →</span>";
            navPage.onclick = () => { currentEpisodePage++; renderEpisodeGrid(); highlightEpisode(0); };
        } else {
            // On last page - loop back to first
            navPage.innerHTML = "<span>First Page →</span>";
            navPage.onclick = () => { currentEpisodePage = 1; renderEpisodeGrid(); highlightEpisode(0); };
        }
    } else {
        // Only 1 page - hide this slot
        navPage.style.visibility = 'hidden';
    }
    grid.appendChild(navPage);
}

function highlightEpisode(idx) {
    clearHighlights();
    // Range is -1 (header) to 8
    if (idx > 8) idx = -1;
    if (idx < -1) idx = 8;
    
    episodeIndex = idx;
    
    // Handle header button (index -1)
    if (episodeIndex === -1) {
        const headerBtn = document.getElementById('global-back-btn');
        if (headerBtn) {
            headerBtn.classList.add('highlighted');
            speak(headerBtn.textContent || "Back");
        }
        return;
    }
    
    let el = document.getElementById(`max-ep-${episodeIndex}`);
    
    // If hidden, find next visible slot
    if (!el || el.style.visibility === 'hidden') {
        let startIdx = episodeIndex;
        episodeIndex++;
        
        while (episodeIndex !== startIdx) {
            if (episodeIndex > 8) {
                episodeIndex = -1; // Wrap to header
            }
            
            if (episodeIndex === -1) {
                // Header is always visible
                const headerBtn = document.getElementById('global-back-btn');
                if (headerBtn) {
                    headerBtn.classList.add('highlighted');
                    speak(headerBtn.textContent || "Back");
                }
                return;
            }
            
            el = document.getElementById(`max-ep-${episodeIndex}`);
            if (el && el.style.visibility !== 'hidden') {
                break; // Found a visible slot
            }
            episodeIndex++;
        }
    }
    
    if(el && el.style.visibility !== 'hidden') {
        el.classList.add('highlighted');
        const txt = el.textContent || "";
        speak(txt);
    }
}

// --- UTILITIES ---
function switchView(id) {
    document.querySelectorAll('.screen-view').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    
    // Handle specific display properties
    document.getElementById('app-container').style.display = (id === 'app-container') ? 'flex' : 'none';
    document.getElementById('settings-menu').style.display = (id === 'settings-menu') ? 'flex' : 'none';
    document.getElementById('main-menu').style.display = (id === 'main-menu') ? 'flex' : 'none';
}

function clearHighlights() {
    document.querySelectorAll('.highlighted').forEach(el => el.classList.remove('highlighted'));
}

function handleGlobalBack() {
    if (currentState === STATE.SEASONS) {
        // Go back to the modal for the current show
        document.getElementById('episode-view').style.display = 'none';
        document.getElementById('items-view').style.display = 'flex';
        currentState = STATE.ITEMS;
        
        // Re-open the modal for the show we came from
        if (currentModalItem) {
            showModal(currentModalItem);
        } else {
            highlightItem(itemIndex);
        }
        speak("Back to show");
    } else if (currentState === STATE.EPISODES) {
        // Go back to season selector
        document.getElementById('episode-grid').style.display = 'none';
        document.getElementById('season-grid').style.display = 'grid';
        document.getElementById('ep-show-title').textContent = "Select Season";
        currentState = STATE.SEASONS;
        highlightSeason(-1);
        speak("Back to Seasons");
    } else if (currentState === STATE.ITEMS) {
        // Special case for Recently Watched
        if (lastBrowseTitle === "Recently Watched") { // Assuming lastBrowseTitle tracks this or we check view title
             // Correct logic: we used openItemsView("Recently Watched"), so current view title is that.
             const vt = document.getElementById('view-title').textContent;
             if (vt === "Recently Watched") {
                 openMainMenu();
                 return;
             }
        }
        
        if (currentTypeFilter) {
             // Re-apply filter to get genres
             const filteredSource = allData.filter(item => item.type && currentTypeFilter(item.type));
             processGenres(filteredSource);
             openBrowseInternal(lastBrowseTitle);
        } else {
             openBrowse();
        }
    } else if (currentState === STATE.GENRES) {
        // Now handled by Slot 0 usually, but if called globally:
        openMainMenu();
    }
}

// --- SCANNING INPUTS ---
// Note: scan-manager.js handles global cooldown for Space/Enter
function setupInputListeners() {
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Enter') {
            e.preventDefault(); 
            if (e.repeat) return;
            
            pauseTriggered = false;

            // Differentiate logic based on state
            if (currentState === STATE.KEYBOARD && window.keyboardController) {
                // Keyboard specific hold logic (3s)
                 keyboardEnterTimer = setTimeout(() => {
                     pauseTriggered = true; // Use same flag to block click
                     window.keyboardController.handleLongPressEnter();
                 }, 3000);
            } else {
                // Default Pause Timer (5s)
                 pauseTimer = setTimeout(() => {
                     pauseTriggered = true;
                     openPauseMenu();
                 }, PAUSE_THRESHOLD);
            }
        }

        if (e.code === 'Space') {
            e.preventDefault();
            if (e.repeat) return;

            spacePressedTime = Date.now();
            isLongPress = false;
            
            // Check for Keyboard Overlay
            if (window.keyboardController && window.keyboardController.isOpen) {
                 // Delegate to keyboard logic
            }
            
            // Get scan interval from shared manager
            const scanInterval = window.NarbeScanManager ? window.NarbeScanManager.getScanInterval() : 2000;
            
            // Setup Hold Logic
            if (scanTimer) clearTimeout(scanTimer);
            scanTimer = setTimeout(() => {
                isLongPress = true;
                if (backwardScanInterval) clearInterval(backwardScanInterval); // Safety clear

                if (!window.keyboardController || !window.keyboardController.isOpen) {
                    scanBackward();
                    backwardScanInterval = setInterval(scanBackward, scanInterval);
                } else if (window.keyboardController.isOpen) {
                    window.keyboardController.scanBackward();
                    backwardScanInterval = setInterval(() => window.keyboardController.scanBackward(), scanInterval);
                }
            }, HOLD_THRESHOLD);
        }
    });
    
    document.addEventListener('keyup', (e) => {
        // ALWAYS clear timers immediately on keyup to prevent ghost actions
        if (e.code === 'Space') {
            clearTimeout(scanTimer);
            clearInterval(backwardScanInterval);
            backwardScanInterval = null; // Reset
        }
        if (e.code === 'Enter') {
            clearTimeout(pauseTimer);
            clearTimeout(keyboardEnterTimer);
        }

        if (e.code === 'Enter') {
            // Timer cleared above
            if (!pauseTriggered) {
                if (currentState === STATE.PAUSE) {
                    handlePauseSelect();
                } else if (window.keyboardController && window.keyboardController.isOpen) {
                    window.keyboardController.select();
                } else {
                    handleSelect();
                }
            }
            pauseTriggered = false;
        }
        
        if (e.code === 'Space') {
            // Timer cleared above
            
            if (!isLongPress) {
                if (window.keyboardController && window.keyboardController.isOpen) {
                    window.keyboardController.scanForward();
                } else {
                    scanForward();
                }
            }
            isLongPress = false;
        }
        // Cooldown is handled by shared scan-manager.js
    });
    
    // Keyboard Event Hooks
    document.addEventListener('keyboard-search', () => {
        // From Search
        const inp = document.getElementById('search-input');
        // Trim whitespace to ensure "Simpsons " matches "The Simpsons"
        const q = inp ? inp.value.trim() : ''; 
        if(q) {
             

            // Open items view sets state to ITEMS, rendering results
             filteredData = allData.filter(item => 
                (item.title && item.title.toLowerCase().includes(q.toLowerCase()))
                && item.type !== 'music'
            );
            
            openItemsView("Search Results"); 
            // openItemsView sets currentState = STATE.ITEMS
            speak("Search Results. Found " + filteredData.length + " results");
        }
    });
    
    document.addEventListener('keyboard-closed', () => {
        // Only go back to main menu if we did NOT just trigger a search
        // The search logic below handles the redirect to ITEMS.
        // We delay the check slightly or check precise state?
        // Actually, keyboard-search fires AFTER close.
        // So openMainMenu happens, then openItemsView overwrites it.
        // openItemsView now calls switchView('app-container'), so it should fix the visual bug.
        
        // We can add a small check: if we are already in ITEMS, don't go to main.
        // But transition is KEYBOARD -> MAIN -> ITEMS
        
        if (currentState === STATE.KEYBOARD) {
            // Returned without search?
            openMainMenu();
        }
    });

    // Safety: Stop scanning if window loses focus
    window.addEventListener('blur', () => {
        clearTimeout(scanTimer);
        clearInterval(backwardScanInterval);
        backwardScanInterval = null;
        isLongPress = false; 
    });
}

// State-Dependent Scanning
function scanForward() {
    if (currentState === 'editor_confirm') highlightEditorModal(editorModalIndex + 1);
    else if (currentState === STATE.MAIN) highlightMain(mainIndex + 1);
    else if (currentState === STATE.SETTINGS) highlightSettings(settingsIndex + 1);
    else if (currentState === STATE.GENRES) highlightGenre(genreIndex + 1);
    else if (currentState === STATE.ITEMS) highlightItem(itemIndex + 1, 1);
    else if (currentState === STATE.MODAL) highlightModal(modalIndex + 1);
    else if (currentState === STATE.SEASONS) highlightSeason(seasonIndex + 1);
    else if (currentState === STATE.EPISODES) highlightEpisode(episodeIndex + 1);
    else if (currentState === STATE.PAUSE) highlightPause(pauseIndex + 1);
}

function scanBackward() {
    if (currentState === 'editor_confirm') highlightEditorModal(editorModalIndex - 1);
    else if (currentState === STATE.MAIN) highlightMain(mainIndex - 1);
    else if (currentState === STATE.SETTINGS) highlightSettings(settingsIndex - 1);
    else if (currentState === STATE.GENRES) highlightGenre(genreIndex - 1);
    else if (currentState === STATE.ITEMS) highlightItem(itemIndex - 1, -1);
    else if (currentState === STATE.MODAL) highlightModal(modalIndex - 1);
    else if (currentState === STATE.SEASONS) highlightSeason(seasonIndex - 1);
    else if (currentState === STATE.EPISODES) highlightEpisode(episodeIndex - 1);
    else if (currentState === STATE.PAUSE) highlightPause(pauseIndex - 1);
}

function handleSelect() {
    if (currentState === 'editor_confirm') {
        selectEditorModal();
    }
    else if (currentState === STATE.MAIN) {
        const btns = document.querySelectorAll('#main-menu .menu-btn');
        if(btns[mainIndex]) btns[mainIndex].click();
    }
    else if (currentState === STATE.SETTINGS) {
        if (settingsIndex < document.querySelectorAll('.setting-row').length) {
            const row = document.querySelectorAll('.setting-row')[settingsIndex];
            row.querySelector('button').click();
        } else {
            // Back button - Click it to respect dynamic onclick (Pause vs Main)
            const backBtn = document.querySelector('#settings-menu .back-btn-large');
            if(backBtn) backBtn.click();
        }
    }
    else if (currentState === STATE.GENRES) selectGenre(genreIndex);
    else if (currentState === STATE.ITEMS) selectItem();
    else if (currentState === STATE.MODAL) selectModalAction();
    else if (currentState === STATE.SEASONS) {
        if (seasonIndex === -1) {
            // Header back button
            const headerBtn = document.getElementById('global-back-btn');
            if (headerBtn && headerBtn.onclick) headerBtn.onclick();
        } else {
            const sEl = document.getElementById(`max-season-${seasonIndex}`);
            if (sEl && sEl.onclick) sEl.onclick();
        }
    }
    else if (currentState === STATE.EPISODES) {
        if (episodeIndex === -1) {
            // Header back button
            const headerBtn = document.getElementById('global-back-btn');
            if (headerBtn && headerBtn.onclick) headerBtn.onclick();
        } else {
            const eEl = document.getElementById(`max-ep-${episodeIndex}`);
            if (eEl && eEl.onclick) eEl.onclick();
        }
    }
}

// --- SETTINGS ACTIONS ---
function cycleTheme() {
    const themes = ["default", "high-contrast", "dark-blue", "midnight", "forest", "slate"];
    let idx = themes.indexOf(settings.theme);
    idx = (idx + 1) % themes.length;
    settings.theme = themes[idx];
    saveSettings();
    updateSettingsUI();
    speak("Theme " + settings.theme);
}

function cycleHighlightStyle() {
    const styles = ['fill', 'outline'];
    let idx = styles.indexOf(settings.highlightStyle || 'fill');
    idx = (idx + 1) % styles.length;
    settings.highlightStyle = styles[idx];
    saveSettings();
    updateSettingsUI();
    speak("Style " + settings.highlightStyle);
}

function cycleSpeed() {
    console.log('[Streaming] cycleSpeed called, NarbeScanManager:', !!window.NarbeScanManager);
    // Use shared scan manager
    if (window.NarbeScanManager) {
        window.NarbeScanManager.cycleScanSpeed();
        const scanSettings = window.NarbeScanManager.getSettings();
        const speedLabels = ["1 Second", "2 Seconds", "3 Seconds", "4 Seconds"];
        console.log('[Streaming] New speed:', speedLabels[scanSettings.scanSpeedIndex], scanSettings.scanInterval);
        
        // Restart autoscan with new speed if running
        if (autoScanIntervalId) {
            stopAutoScan();
            startAutoScan();
        }
        updateSettingsUI();
        speak("Speed " + speedLabels[scanSettings.scanSpeedIndex]);
    } else {
        console.warn('[Streaming] cycleSpeed: NarbeScanManager not available');
        speak("Speed settings not available");
    }
}

function toggleAutoScan() {
    console.log('[Streaming] toggleAutoScan called, NarbeScanManager:', !!window.NarbeScanManager);
    // Use shared scan manager
    if (window.NarbeScanManager) {
        window.NarbeScanManager.toggleAutoScan();
        const scanSettings = window.NarbeScanManager.getSettings();
        updateSettingsUI();
        speak("Auto Scan " + (scanSettings.autoScan ? "On" : "Off"));
        
        if(scanSettings.autoScan) startAutoScan();
        else stopAutoScan();
    } else {
        console.warn('[Streaming] toggleAutoScan: NarbeScanManager not available');
        speak("Auto scan settings not available");
    }
}

let autoScanIntervalId = null;
function startAutoScan() {
    if(autoScanIntervalId) clearInterval(autoScanIntervalId);
    
    // Get scan interval from shared manager
    const scanInterval = window.NarbeScanManager ? window.NarbeScanManager.getScanInterval() : 2000;
    
    autoScanIntervalId = setInterval(() => {
        if (!isLongPress && currentState !== STATE.KEYBOARD) {
            scanForward();
        }
    }, scanInterval);
}
function stopAutoScan() {
    if(autoScanIntervalId) clearInterval(autoScanIntervalId);
    autoScanIntervalId = null;
}

function cycleVoice() {
    console.log('[Streaming] cycleVoice called, NarbeVoiceManager:', !!window.NarbeVoiceManager);
    // Use shared voice manager if available
    if (window.NarbeVoiceManager) {
        window.NarbeVoiceManager.cycleVoice();
        const voice = window.NarbeVoiceManager.getCurrentVoice();
        const displayName = voice ? window.NarbeVoiceManager.getVoiceDisplayName(voice) : "Default";
        console.log('[Streaming] New voice:', displayName);
        updateSettingsUI();
        speak("Voice " + displayName);
    } else {
        // Fallback: just announce that voices aren't available
        console.warn('[Streaming] cycleVoice: NarbeVoiceManager not available');
        speak("Voice settings not available");
    }
}

function cycleHighlightColor() {
    const colors = ['yellow', 'cyan', 'green', 'magenta', 'orange', 'white'];
    let idx = colors.indexOf(settings.highlightColor || 'yellow');
    idx = (idx + 1) % colors.length;
    settings.highlightColor = colors[idx];
    saveSettings(); 
    // Immediate apply
    updateSettingsUI();
    highlightSettings(settingsIndex); // Re-highlight to show change
    speak("Color " + settings.highlightColor);
}

function exitApp() {
    console.log('[EXIT] exitApp called');
    
    // Check if we're in an iframe (loaded from main hub)
    if (window.parent && window.parent !== window) {
        console.log('[EXIT] In iframe - sending close message to parent');
        // Send message to parent to close the iframe
        window.parent.postMessage({ action: 'closeApp' }, '*');
        return;
    }
    
    // If in Electron standalone (shouldn't happen, but handle it)
    if (isElectron && window.electronAPI.window) {
        console.log('[EXIT] Electron standalone - closing window');
        window.electronAPI.window.close();
        return;
    }
    
    // Legacy standalone mode - close Chrome via server
    console.log('[EXIT] Standalone mode - sending close_app request...');
    fetch('/close_app', {method: 'POST'})
        .then(response => {
            console.log('[EXIT] Response:', response.status);
            return response.json();
        })
        .then(data => {
            console.log('[EXIT] Server responded:', data);
        })
        .catch(err => {
            // Expected - Chrome gets killed so request may fail
            console.log('[EXIT] Request completed (Chrome closing):', err.message);
        });
}

// Global scope for clicks
window.openBrowse = openBrowse;
window.openSearch = openSearch;
window.openSettings = openSettings;
window.exitApp = exitApp;
window.openMainMenu = openMainMenu;
window.cycleTheme = cycleTheme;
window.cycleHighlightStyle = cycleHighlightStyle;
window.cycleSpeed = cycleSpeed;
window.cycleVoice = cycleVoice;
window.toggleAutoScan = toggleAutoScan;
window.handleGlobalBack = handleGlobalBack;
window.backToGenres = openBrowse; // Alias if old code refs it
window.showModal = showModal;
window.selectGenre = selectGenre;
window.clearSearchHistory = clearSearchHistory;

// --- PAUSE MENU LOGIC ---
function openPauseMenu() {
    if (currentState === STATE.PAUSE) return;
    
    // Save state
    previousState = currentState;
    document.getElementById('pause-menu').classList.remove('hidden');
    currentState = STATE.PAUSE;
    pauseIndex = 0;
    highlightPause(0);
    speak('Paused.');
}

function closePauseMenu(resume=true) {
    document.getElementById('pause-menu').classList.add('hidden');
    if (resume && previousState) {
        currentState = previousState;
        // Re-highlight appropriate element based on state
        if (currentState === STATE.ITEMS) highlightItem(itemIndex);
        else if (currentState === STATE.GENRES) highlightGenre(genreIndex);
        else if (currentState === STATE.MAIN) highlightMain(mainIndex);
        else if (currentState === STATE.SETTINGS) highlightSettings(settingsIndex);
        else if (currentState === STATE.EPISODES) highlightEpisode(episodeIndex);
        
        speak('Resumed.');
    }
}

function highlightPause(idx) {
    const btns = document.querySelectorAll('#pause-menu .pause-btn');
    if (idx >= btns.length) idx = 0;
    if (idx < 0) idx = btns.length - 1;
    pauseIndex = idx;
    
    // Clear old
    btns.forEach(b => b.classList.remove('highlighted'));
    
    const target = btns[pauseIndex];
    target.classList.add('highlighted');
    speak(target.textContent);
}

function handlePauseSelect() {
    const btns = document.querySelectorAll('#pause-menu .pause-btn');
    const target = btns[pauseIndex];
    
    if (target.id === 'btn-resume') {
        closePauseMenu(true);
    } else if (target.id === 'btn-pause-settings') {
        // Go to settings, but remember to back out to pause? 
        // Or just go to settings normally. 
        // User asked: 'settings' opens all the settings in this modal with a back button to go back to the pause menu main page
        // Complex: Render settings inside pause menu? OR switch view to settings?
        // Simplest: Switch view to normal settings menu, but override 'back' functionality?
        
        document.getElementById('pause-menu').classList.add('hidden');
        openSettings(); // Switches to settings state
        // We need a way to return to Pause menu.
        // We can set a flag 'returnToPause = true'
    } else if (target.id === 'btn-main-menu') {
        document.getElementById('pause-menu').classList.add('hidden');
        openMainMenu();
    }
}

// --- EDITOR MODAL LOGIC ---
function openEditorConfirm() {
    document.getElementById('editor-modal').classList.remove('hidden');
    previousState = currentState;
    currentState = 'editor_confirm';
    highlightEditorModal(0);
    speak("Opening Editor. You are about to enter the Editor Mode. This requires a mouse and keyboard.");
}

function closeEditorModal() {
    document.getElementById('editor-modal').classList.add('hidden');
    currentState = previousState;
    if (currentState === STATE.SETTINGS) highlightSettings(settingsIndex);
}

function startEditor() {
    // Launch editor in Chrome via Electron API (or fallback to direct URL)
    const isElectron = typeof window !== 'undefined' && window.electronAPI;
    if (isElectron && window.electronAPI.editor) {
        window.electronAPI.editor.open('streaming').then(result => {
            if (result.success) {
                console.log('[Editor] Opened streaming editor in Chrome:', result.url);
            } else {
                console.error('[Editor] Failed to open editor:', result.error);
                // Fallback to direct navigation
                window.location.href = 'editor.html';
            }
        }).catch(err => {
            console.error('[Editor] Error:', err);
            window.location.href = 'editor.html';
        });
    } else {
        // Non-Electron fallback
        window.location.href = 'editor.html';
    }
}

let editorModalIndex = 0;
function highlightEditorModal(idx) {
    const btns = document.querySelectorAll('#editor-modal .modal-action-btn');
    if(idx >= btns.length) idx = 0;
    if(idx < 0) idx = btns.length - 1;
    editorModalIndex = idx;
    
    btns.forEach(b => b.classList.remove('highlighted'));
    btns[editorModalIndex].classList.add('highlighted');
    speak(btns[editorModalIndex].textContent);
}

function selectEditorModal() {
    const btns = document.querySelectorAll('#editor-modal .modal-action-btn');
    if(btns[editorModalIndex]) btns[editorModalIndex].click();
}

// --- SERVICE EMBLEM HELPER ---
function getServiceEmblem(item) {
    if (item.service) { // Prioritize new map always due to broken icons in JSON
        const key = item.service.toLowerCase();
        // Fallback map - Synced with editor.js
        const Map = {
            'disney': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Disney%2B_logo.svg/1024px-Disney%2B_logo.svg.png',
            'netflix': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/1024px-Netflix_2015_logo.svg.png',
            'hulu': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Hulu_Logo.svg/1024px-Hulu_Logo.svg.png',
            'youtube': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/YouTube_full-color_icon_%282017%29.svg/1024px-YouTube_full-color_icon_%282017%29.svg.png',
            'prime': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Amazon_Prime_Video_logo.svg/1024px-Amazon_Prime_Video_logo.svg.png',
            'plex': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Plex_logo_2022.svg/800px-Plex_logo_2022.svg.png',
            'max': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Max_logo.svg/1024px-Max_logo.svg.png',
            'paramount': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Paramount_Plus.svg/1024px-Paramount_Plus.svg.png',
            'pluto': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Pluto_TV_logo_2024.svg/1024px-Pluto_TV_logo_2024.svg.png'
        };
        // Partial match
        for (let k in Map) {
            if (key.includes(k)) return Map[k];
        }
    }
    // Only return item.service_icon if not found in map (or if map logic skipped)
    if (item.service_icon) return item.service_icon;
    return null;
}

function clearSearchHistory() {
    const doClear = async () => {
        try {
            if (isElectron) {
                await window.electronAPI.streaming.clearSearchHistory();
            } else {
                await fetch('/api/clear_search_history', {method: 'POST'});
            }
            speak("Search History Cleared");
        } catch(e) {
            speak("Failed to clear history");
        }
    };
    doClear();
}

let keyboardEnterTimer = null;

