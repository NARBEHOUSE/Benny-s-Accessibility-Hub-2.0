// Game State
let TRIVIA_DATA = {}; // Loaded from JSON

const state = {
    score: 0,
    streak: 0,
    level: 1,
    currentCategory: null,
    questions: [],
    currentQuestionIndex: 0,
    settings: {
        tts: true,
        scanSpeed: 'Medium', // Slow (3s), Medium (2s), Fast (1s)
        theme: 'Default', // Default, Dark, Pastel, Neon, High Contrast
        autoScan: false,
        voiceIndex: 0,
        gamesSource: localStorage.getItem('trivia_games_source') || 'ALL'
    },
    scanTimer: null,
    currentIndex: -1,
    activeElements: [],
    isPaused: false,
    audioContext: null,
    gameStartTime: 0,
    questionStartTime: 0,
    categoryPage: 0,
    previousScreen: null, // To track where to go back from settings
    inputState: {
        spaceDownTime: 0,
        enterDownTime: 0,
        longPressThreshold: 3000, // 3 seconds
        repeatInterval: 2000,     // 2 seconds
        spaceTimer: null,
        spaceInterval: null,
        enterTimer: null,
        spaceLongTriggered: false,
        enterLongTriggered: false
    }
};

// Constants
// Note: Scan speeds are now managed by NarbeScanManager

const THEMES = ['Default', 'Dark', 'Pastel', 'Neon', 'High Contrast'];

const CATS_PAGE_FIRST = 5;
const CATS_PAGE_OTHER = 6;
const LEVEL_THRESHOLD = 5;

// Audio Manager
const audio = {
    ctx: new (window.AudioContext || window.webkitAudioContext)(),
    
    playTone: function(freq, type, duration) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },

    playScan: () => audio.playTone(400, 'sine', 0.1), // "Bloop"
    playSelect: () => audio.playTone(600, 'square', 0.1),
    playCorrect: () => {
        audio.playTone(600, 'sine', 0.1);
        setTimeout(() => audio.playTone(800, 'sine', 0.2), 100);
        setTimeout(() => audio.playTone(1200, 'sine', 0.4), 200);
    },
    playWrong: () => {
        audio.playTone(300, 'sawtooth', 0.3);
        setTimeout(() => audio.playTone(200, 'sawtooth', 0.4), 200);
    },
    playFanfare: () => {
        // Simple arpeggio
        [440, 554, 659, 880].forEach((freq, i) => {
            setTimeout(() => audio.playTone(freq, 'square', 0.2), i * 100);
        });
    }
};

// TTS
function speak(text) {
    if (!text) return; // Safety check

    if (state.isPaused) {
        // Strict check: if paused, only allow speaking if text is from the pause menu
        const pauseOverlay = document.getElementById('pause-overlay');
        const isPauseMenuText = Array.from(pauseOverlay.querySelectorAll('.scannable, #pause-overlay h2, #pause-overlay p'))
                                     .some(el => (el.innerText || el.getAttribute('aria-label') || '') === text);
        
        if (!text.includes("Game Paused") && !text.includes("Game Resumed") && !isPauseMenuText) {
             // Allow 'Voice changed' feedback even if paused
             if (text !== "Voice changed") {
                 console.log("Blocked background speech while paused:", text);
                 return;
             }
        }
    }

    if (window.NarbeVoiceManager) {
        window.NarbeVoiceManager.speak(text);
    } else {
        // Fallback if manager not available
        if (!state.settings.tts) return;
        window.speechSynthesis.cancel(); // Stop previous
        const utterance = new SpeechSynthesisUtterance(text);
        
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            utterance.voice = voices[state.settings.voiceIndex % voices.length];
        }

        utterance.rate = 1;
        utterance.pitch = 1;
        window.speechSynthesis.speak(utterance);
    }
}

// DOM Elements
const screens = document.querySelectorAll('.screen');
const scoreEl = document.getElementById('score');
const streakEl = document.getElementById('streak');
const currentQEl = document.getElementById('current-q');
const totalQEl = document.getElementById('total-q');
const header = document.getElementById('game-header');

// Initialization
async function init() {
    // Scan Manager Integration
    if (window.NarbeScanManager) {
        // Initial sync
        const s = window.NarbeScanManager.getSettings();
        state.settings.autoScan = s.autoScan;
        state.settings.scanSpeed = (s.scanInterval / 1000) + 's';
        
        // Subscribe to changes
        window.NarbeScanManager.subscribe((settings) => {
            state.settings.autoScan = settings.autoScan;
            state.settings.scanSpeed = (settings.scanInterval / 1000) + 's';
            updateSettingsUI();
            startScanning();
        });
    }

    // No longer loading default questions immediately
    // We wait for user to select a game
    
    setupEventListeners();
    showScreen('main-menu');
    startScanning();
    
    // Resume Audio Context on first interaction
    document.body.addEventListener('click', () => {
        if (audio.ctx.state === 'suspended') audio.ctx.resume();
    }, { once: true });
    document.body.addEventListener('keydown', () => {
        if (audio.ctx.state === 'suspended') audio.ctx.resume();
    }, { once: true });

    // Preload voices
    // Chrome loads voices asynchronously
    window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
    };
}

async function loadLocalPersistedGames() {
    const localGames = JSON.parse(localStorage.getItem('trivia_custom_games') || '{}');
    if (Object.keys(localGames).length > 0) {
        console.log("Loading persisted custom games...");
        Object.assign(TRIVIA_DATA, localGames);
    }
}

async function loadManifestGames() {
    console.log("Loading online/manifest games...");
    try {
        const response = await fetch('games_manifest.json');
        if (!response.ok) return;
        const games = await response.json();
        
        for (const game of games) {
            if (game.path) {
                try {
                    const gameResp = await fetch(game.path);
                    if (gameResp.ok) {
                        const json = await gameResp.json();
                        // Non-destructive merge
                        if (json.meta && json.categories) {
                            Object.assign(TRIVIA_DATA, json.categories);
                        } else {
                            Object.assign(TRIVIA_DATA, json);
                        }
                    }
                } catch (err) {
                    console.warn(`Failed to preload ${game.name}`, err);
                }
            }
        }
    } catch (e) {
        console.warn("Failed to load manifest", e);
    }
}

// Navigation
function showScreen(screenId) {
    screens.forEach(s => {
        s.classList.remove('active');
        s.classList.add('hidden');
    });
    const target = document.getElementById(screenId);
    target.classList.remove('hidden');
    target.classList.add('active');
    
    if (screenId === 'game-screen') {
        header.classList.remove('hidden');
    } else if (screenId === 'main-menu') {
        header.classList.add('hidden');
        resetTheme();
    } else if (screenId === 'category-selection') {
        resetTheme();
    }
    
    // Reset scanning for new screen
    resetScanning();
    
    // TTS for screen title
    const title = target.querySelector('h1, h2');
    if (title) speak(title.innerText);
}

// Scanning System
function getScannables() {
    // Get scannables from active screen AND header (if visible) AND pause overlay (if visible)
    
    // Priority: Editor Warning Overlay
    const editorWarning = document.getElementById('editor-warning-overlay');
    if (editorWarning && !editorWarning.classList.contains('hidden')) {
        return Array.from(editorWarning.querySelectorAll('.scannable'));
    }

    // Priority: Load Game Warning Overlay
    const loadGameWarning = document.getElementById('load-game-warning-overlay');
    if (loadGameWarning && !loadGameWarning.classList.contains('hidden')) {
        return Array.from(loadGameWarning.querySelectorAll('.scannable'));
    }

    const pauseOverlay = document.getElementById('pause-overlay');
    // Only scan pause overlay if it's actually visible
    if (state.isPaused && pauseOverlay && !pauseOverlay.classList.contains('hidden')) {
        return Array.from(pauseOverlay.querySelectorAll('.scannable'));
    }
    
    const activeScreen = document.querySelector('.screen.active');
    let elements = [];
    
    if (!header.classList.contains('hidden')) {
        elements = elements.concat(Array.from(header.querySelectorAll('.scannable')));
    }
    
    if (activeScreen) {
        elements = elements.concat(Array.from(activeScreen.querySelectorAll('.scannable')));
    }
    
    return elements;
}

function startScanning() {
    if (state.scanTimer) clearInterval(state.scanTimer);
    if (state.settings.autoScan) {
        let speed = 2000;
        if (window.NarbeScanManager) {
            speed = window.NarbeScanManager.getScanInterval();
        }
        state.scanTimer = setInterval(scanNext, speed);
    } else {
        state.scanTimer = null;
    }
}

function restoreQuestionMedia() {
    const popupVideo = document.getElementById('popup-video-container');
    const mediaContainer = document.getElementById('media-container');
    
    if (!popupVideo || !mediaContainer) return;

    const popupChild = popupVideo.firstElementChild;
    if (popupChild && popupChild.dataset.isQuestionMedia) {
        // Restore to container
        if (popupChild.tagName === 'VIDEO') {
            popupChild.controls = true;
            popupChild.autoplay = false; 
            popupChild.loop = true;
            popupChild.pause();
            popupChild.currentTime = 0; 
        }
        
        // Restore original styles if they were saved
        if (popupChild.dataset.originalWidth) popupChild.style.width = popupChild.dataset.originalWidth;
        if (popupChild.dataset.originalHeight) popupChild.style.height = popupChild.dataset.originalHeight;

        // For iframe, reloading it stops it or at least we remove autoplay
        if (popupChild.tagName === 'IFRAME') {
             // Disable autoplay
             let src = popupChild.src;
             if (src.includes('autoplay=1')) {
                 src = src.replace('autoplay=1', 'autoplay=0');
             } else if (!src.includes('autoplay=0')) {
                 src += (src.includes('?') ? '&' : '?') + 'autoplay=0';
             }
             popupChild.src = src;
        }

        mediaContainer.appendChild(popupChild);
        // Clean up popup
        // popupVideo.innerHTML = ''; // Will be cleared by updateImagePopup anyway or we can do it here
    }
}

function updateImagePopup(el) {
    const popup = document.getElementById('image-popup-overlay');
    const popupImg = document.getElementById('popup-image');
    const popupVideo = document.getElementById('popup-video-container');
    
    // Always try to restore question media first if we are moving away or to something else
    restoreQuestionMedia();

    if (!el) {
        popup.classList.add('hidden');
        if (popupVideo) popupVideo.innerHTML = ''; // Stop video
        return;
    }

    // Check if it is the media container
    if (el.id === 'media-container') {
        const media = el.firstElementChild;
        
        if (media) {
            // Handle Images separately (Use the Image Popup, don't move element)
            if (media.tagName === 'IMG') {
                popupImg.src = media.src;
                popupImg.classList.remove('hidden');
                if (popupVideo) {
                    popupVideo.classList.add('hidden');
                    popupVideo.innerHTML = '';
                }
                popup.classList.remove('hidden');
                return;
            }

            // Handle Video/Iframe (Move element to preserve state/prevent double audio)
            if (media.tagName === 'VIDEO' || media.tagName === 'IFRAME') {
                // Move to popup
                media.dataset.isQuestionMedia = 'true';
                
                // Save original styles
                media.dataset.originalWidth = media.style.width;
                media.dataset.originalHeight = media.style.height;

                // Reset styles for popup
                media.style.width = '100%';
                media.style.height = '100%';

                popupVideo.innerHTML = '';
                popupVideo.appendChild(media);

                if (media.tagName === 'VIDEO') {
                    media.controls = false; 
                    media.autoplay = true;
                    media.loop = true;
                    media.muted = false;
                    setTimeout(() => {
                        media.play().catch(e => console.log("Autoplay prevented", e));
                    }, 100);
                }
                
                if (media.tagName === 'IFRAME') {
                     let src = media.src;
                     if (src.includes('autoplay=0')) {
                         src = src.replace('autoplay=0', 'autoplay=1');
                     } else if (!src.includes('autoplay=1')) {
                         src += (src.includes('?') ? '&' : '?') + 'autoplay=1';
                     }
                     // Force reload by reassigning src after append
                     media.src = src;
                     media.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
                }

                popupVideo.classList.remove('hidden');
                popupImg.classList.add('hidden');
                popup.classList.remove('hidden');
                return;
            }
        }
    }

    // Check for video (Answers)
    if (el.dataset.videoSrc) {
        popupImg.classList.add('hidden');
        if (popupVideo) {
            popupVideo.classList.remove('hidden');
            
            // Only update if source changed to avoid reloading on every scan tick if logic was different
            // But here we create it fresh every time the popup shows for a new element
            
            const src = el.dataset.videoSrc;
            const type = el.dataset.videoType;
            let mediaEl;

            if (type === 'youtube') {
                const id = getYouTubeId(src);
                mediaEl = document.createElement('iframe');
                mediaEl.src = `https://www.youtube.com/embed/${id}?autoplay=1&mute=0&controls=0&modestbranding=1`;
                mediaEl.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
            } else if (type === 'vimeo') {
                const id = getVimeoId(src);
                mediaEl = document.createElement('iframe');
                mediaEl.src = `https://player.vimeo.com/video/${id}?autoplay=1&background=1`;
                mediaEl.allow = "autoplay; fullscreen";
            } else if (type === 'gdrive') {
                const id = getGoogleDriveId(src);
                mediaEl = document.createElement('iframe');
                mediaEl.src = `https://drive.google.com/file/d/${id}/preview?autoplay=1`;
                mediaEl.allow = "autoplay; fullscreen";
            } else {
                mediaEl = document.createElement('video');
                mediaEl.src = src;
                mediaEl.controls = false;
                mediaEl.autoplay = true;
                mediaEl.loop = true;
                mediaEl.muted = false; // Try unmuted, browser might block
            }
            
            mediaEl.id = 'popup-media-element';
            mediaEl.style.width = '100%';
            mediaEl.style.height = '100%';
            mediaEl.style.border = 'none';
            
            popupVideo.innerHTML = '';
            popupVideo.appendChild(mediaEl);
        }
        popup.classList.remove('hidden');
        
    } else {
        // Check for image
        const img = el.querySelector('img.answer-img');
        if (img) {
            if (popupVideo) {
                popupVideo.classList.add('hidden');
                popupVideo.innerHTML = ''; // Stop any playing video
            }
            popupImg.src = img.src;
            popupImg.classList.remove('hidden');
            popup.classList.remove('hidden');
        } else {
            popup.classList.add('hidden');
            if (popupVideo) popupVideo.innerHTML = '';
        }
    }
}

function resetScanning() {
    // Remove highlight from current
    if (state.activeElements[state.currentIndex]) {
        state.activeElements[state.currentIndex].classList.remove('scanned');
    }
    
    updateImagePopup(null); // Hide popup

    state.activeElements = getScannables();
    state.currentIndex = -1;
    
    // Restart timer
    startScanning();
}

function scanNext() {
    if (state.activeElements.length === 0) {
        state.activeElements = getScannables();
        if (state.activeElements.length === 0) return;
    }

    // Remove prev highlight
    if (state.currentIndex >= 0 && state.currentIndex < state.activeElements.length) {
        state.activeElements[state.currentIndex].classList.remove('scanned');
    }

    // Move next
    state.currentIndex++;
    if (state.currentIndex >= state.activeElements.length) {
        state.currentIndex = 0;
    }

    // Highlight new
    const el = state.activeElements[state.currentIndex];
    if (el) {
        el.classList.add('scanned');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        audio.playScan();
        
        updateImagePopup(el); // Show popup if image

        // TTS for scanned item
        const text = el.innerText || el.getAttribute('aria-label') || "Button";
        speak(text);

        // Auto-Pause on Media Container or Question Text
        if (state.settings.autoScan && (el.id === 'media-container' || el.id === 'question-text-wrapper')) {
            if (state.scanTimer) clearInterval(state.scanTimer);
            state.scanTimer = null; // Explicitly nullify to ensure we know it's stopped
        }
    }
}

function scanPrev() {
    if (state.activeElements.length === 0) {
        state.activeElements = getScannables();
        if (state.activeElements.length === 0) return;
    }

    // Remove prev highlight
    if (state.currentIndex >= 0 && state.currentIndex < state.activeElements.length) {
        state.activeElements[state.currentIndex].classList.remove('scanned');
    }

    // Move prev
    state.currentIndex--;
    if (state.currentIndex < 0) {
        state.currentIndex = state.activeElements.length - 1;
    }

    // Highlight new
    const el = state.activeElements[state.currentIndex];
    if (el) {
        el.classList.add('scanned');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        audio.playScan();
        
        updateImagePopup(el); // Show popup if image

        // TTS for scanned item
        const text = el.innerText || el.getAttribute('aria-label') || "Button";
        speak(text);
    }
}

function selectCurrent() {
    if (state.currentIndex >= 0 && state.currentIndex < state.activeElements.length) {
        const el = state.activeElements[state.currentIndex];

        // Resume scanning if paused on media or question
        // Check if we are actually paused (scanTimer is null) OR if we just hit one of these items
        if (state.settings.autoScan && (el.id === 'media-container' || el.id === 'question-text-wrapper')) {
            scanNext();
            
            // Only start scanning if the NEXT item isn't also a pause target
            const nextEl = state.activeElements[state.currentIndex]; // scanNext updated currentIndex
            if (nextEl && (nextEl.id === 'media-container' || nextEl.id === 'question-text-wrapper')) {
                // Do not start scanning, we want to pause on this new item too
                // Ensure timer is cleared just in case scanNext didn't do it (it should have)
                if (state.scanTimer) clearInterval(state.scanTimer);
                state.scanTimer = null;
            } else {
                startScanning();
            }
            return;
        }

        audio.playSelect();
        el.click();
    }
}

// Input Handling
function setupEventListeners() {
    document.addEventListener('keydown', (e) => {
        if (e.repeat) return; // Ignore auto-repeat

        if (e.code === 'Space') {
            e.preventDefault();
            state.inputState.spaceDownTime = Date.now();
            
            // Start timer for long press (3s)
            state.inputState.spaceTimer = setTimeout(() => {
                // Long press detected
                state.inputState.spaceLongTriggered = true;
                
                // Stop auto-scan while manually scanning backwards
                if (state.scanTimer) clearInterval(state.scanTimer);

                scanPrev(); // Initial backward scan
                
                // Start repeating backward scan every 2s
                state.inputState.spaceInterval = setInterval(() => {
                    scanPrev();
                }, state.inputState.repeatInterval);
                
            }, state.inputState.longPressThreshold);

        } else if (e.code === 'Enter') {
            e.preventDefault();
            state.inputState.enterDownTime = Date.now();
            
            // Start timer for long press (3s)
            state.inputState.enterTimer = setTimeout(() => {
                // Long press detected - Open Pause Menu immediately
                state.inputState.enterLongTriggered = true;
                togglePause();
            }, state.inputState.longPressThreshold);
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            clearTimeout(state.inputState.spaceTimer);
            clearInterval(state.inputState.spaceInterval);
            
            if (!state.inputState.spaceLongTriggered) {
                // Short press - Scan Forward
                scanNext();
            }
            startScanning(); // Reset/Resume auto scan timer if active
            state.inputState.spaceLongTriggered = false;

        } else if (e.code === 'Enter') {
            e.preventDefault();
            clearTimeout(state.inputState.enterTimer);
            
            if (!state.inputState.enterLongTriggered) {
                // Short press - Select
                selectCurrent();
            }
            state.inputState.enterLongTriggered = false;
        }
    });

    // Click handlers for all interactive elements (delegation)
    document.body.addEventListener('click', (e) => {
        // Allow clicking on scannable items OR the pause button (which is no longer scannable)
        const target = e.target.closest('.scannable, #pause-btn');
        if (!target) return;

        const action = target.dataset.action;
        
        if (action === 'select-game') {
            loadGamesList();
            showScreen('game-selection');
        } else if (action === 'load-game') {
            loadGameFile(target.dataset.path);
        } else if (action === 'start-category') {
            state.categoryPage = 0; // Reset page
            loadCategories();
            showScreen('category-selection');        } else if (action === 'pause-game') {
            togglePause();
        } else if (action === 'resume') {
            togglePause();
        } else if (action === 'quit') {
            togglePause(); // Unpause first
            showScreen('main-menu');        } else if (action === 'settings') {
            // Check if coming from pause menu
            if (state.isPaused) {
                state.previousScreen = 'game-screen';
                // Hide pause overlay temporarily
                document.getElementById('pause-overlay').classList.add('hidden');
            } else {
                state.previousScreen = 'main-menu';
            }
            updateSettingsUI();
            showScreen('settings-screen');
        } else if (action === 'exit-game') {
            speak("Exiting to Hub");
            setTimeout(() => {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ action: 'focusBackButton' }, '*');
                } else {
                    window.location.href = '../../../index.html';
                }
            }, 500);
        } else if (action === 'back-to-menu') {
            showScreen('main-menu');
        } else if (action === 'settings-back') {
            if (state.previousScreen === 'game-screen') {
                // Return to game and re-open pause overlay
                showScreen('game-screen');
                document.getElementById('pause-overlay').classList.remove('hidden');
                state.isPaused = true; // Ensure paused state
                resetScanning(); // Scan pause menu items
            } else {
                showScreen('main-menu');
            }
        } else if (action === 'load-local-game') {
             const index = parseInt(target.dataset.index);
             const lib = JSON.parse(localStorage.getItem('trivia_game_library') || '[]');
             if (lib[index]) {
                  loadGameData(lib[index], false); // Load it
             }
        } else if (action === 'select-category') {
            startGame(target.dataset.category);
        } else if (action === 'answer') {
            handleAnswer(target);
        } else if (action === 'next-question') {
            nextQuestion();
        } else if (action === 'toggle-tts') {
            if (window.NarbeVoiceManager) {
                const isEnabled = window.NarbeVoiceManager.toggleTTS();
                state.settings.tts = isEnabled;
                updateSettingsUI();
            } else {
                state.settings.tts = !state.settings.tts;
                updateSettingsUI();
            }
        } else if (action === 'toggle-games-source') {
            const sources = ['ALL', 'Local', 'Online'];
            const idx = sources.indexOf(state.settings.gamesSource);
            state.settings.gamesSource = sources[(idx + 1) % sources.length];
            localStorage.setItem('trivia_games_source', state.settings.gamesSource);
            updateSettingsUI();
        } else if (action === 'toggle-autoscan') {
            if (window.NarbeScanManager) {
                window.NarbeScanManager.toggleAutoScan();
            }
        } else if (action === 'cycle-speed') {
            if (window.NarbeScanManager) {
                window.NarbeScanManager.cycleScanSpeed();
            }
        } else if (action === 'cycle-theme') {
            const idx = THEMES.indexOf(state.settings.theme);
            state.settings.theme = THEMES[(idx + 1) % THEMES.length];
            applyTheme(state.settings.theme);
            updateSettingsUI();
        } else if (action === 'cycle-voice') {
            if (window.NarbeVoiceManager) {
                window.NarbeVoiceManager.cycleVoice();
                speak("Voice changed");
                updateSettingsUI();
            } else {
                const voices = window.speechSynthesis.getVoices();
                if (voices.length > 0) {
                    state.settings.voiceIndex = (state.settings.voiceIndex + 1) % voices.length;
                    speak("Voice changed");
                    updateSettingsUI();
                }
            }
        } else if (action === 'open-editor-confirm') {
            document.getElementById('editor-warning-overlay').classList.remove('hidden');
            speak("Warning. Opening the game editor will leave this site.");
            resetScanning();
        } else if (action === 'cancel-editor') {
            document.getElementById('editor-warning-overlay').classList.add('hidden');
            resetScanning();
        } else if (action === 'open-editor') {
            document.getElementById('editor-warning-overlay').classList.add('hidden');
            window.open('trivia editor/index.html', '_blank');
            resetScanning();
        } else if (action === 'open-load-game-warning') {
            document.getElementById('load-game-warning-overlay').classList.remove('hidden');
            speak("Warning. Selecting a custom game file requires mouse input.");
            resetScanning();
        } else if (action === 'cancel-load-game') {
            document.getElementById('load-game-warning-overlay').classList.add('hidden');
            resetScanning();
        } else if (action === 'clear-custom-games') {
             if (confirm("Are you sure you want to clear all custom saved games? This cannot be undone.")) {
                 localStorage.removeItem('trivia_game_library');
                 localStorage.removeItem('trivia_custom_games'); // Legacy cleanup
                 
                 TRIVIA_DATA = {};
                 
                 speak("All custom games cleared. Reloading.");
                 setTimeout(() => window.location.reload(), 1000);
             }
        } else if (action === 'proceed-load-game') {
            document.getElementById('load-game-warning-overlay').classList.add('hidden');
            triggerFileLoad();
            resetScanning();
        } else if (target.id === 'pause-btn') {
            togglePause();
        } else if (action === 'resume') {
            togglePause();
        } else if (action === 'quit') {
            togglePause();
            showScreen('main-menu');
        } else if (action === 'next-page') {
            const total = Object.keys(TRIVIA_DATA).length;
            let maxPage = 0;
            if (total > CATS_PAGE_FIRST) {
                maxPage = Math.ceil((total - CATS_PAGE_FIRST) / CATS_PAGE_OTHER);
            }
            state.categoryPage = state.categoryPage >= maxPage ? 0 : state.categoryPage + 1;
            loadCategories();
        } else if (action === 'prev-page') {
            const total = Object.keys(TRIVIA_DATA).length;
            let maxPage = 0;
            if (total > CATS_PAGE_FIRST) {
                maxPage = Math.ceil((total - CATS_PAGE_FIRST) / CATS_PAGE_OTHER);
            }
            state.categoryPage = state.categoryPage <= 0 ? maxPage : state.categoryPage - 1;
            loadCategories();
        } else if (action === 'repeat-question') {
            const q = state.questions[state.currentQuestionIndex];
            speak(q.question);
        } else if (action === 'play-again') {
            startGame(state.currentCategory);
        }
    });
}

// Theme Logic
function applyCategoryTheme(imageUrl) {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imageUrl;
    
    img.onload = () => {
        try {
            const colorThief = new ColorThief();
            // Get more colors to work with
            const palette = colorThief.getPalette(img, 5);
            const dominant = colorThief.getColor(img);
            
            if (palette && palette.length >= 3) {
                const c1 = `rgb(${palette[0].join(',')})`;
                const c2 = `rgb(${palette[1].join(',')})`;
                const c3 = `rgb(${palette[2].join(',')})`;
                const c4 = `rgb(${palette[3] ? palette[3].join(',') : palette[0].join(',')})`;
                
                // Determine brightness of dominant color to set text/card contrast
                // Formula: (R * 299 + G * 587 + B * 114) / 1000
                const brightness = Math.round(((dominant[0] * 299) + (dominant[1] * 587) + (dominant[2] * 114)) / 1000);
                const isDark = brightness < 128;

                // Apply Gradients
                document.documentElement.style.setProperty('--primary-gradient', `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`);
                document.documentElement.style.setProperty('--secondary-gradient', `linear-gradient(120deg, ${c2} 0%, ${c3} 100%)`);
                document.documentElement.style.setProperty('--accent-gradient', `linear-gradient(to right, ${c3} 0%, ${c4} 100%)`);
                
                // Background: Use dominant color but fade to black or white depending on brightness
                if (isDark) {
                    // Dark Theme
                    document.documentElement.style.setProperty('--bg-gradient', `linear-gradient(to bottom, ${c1} 0%, #1a1a1a 100%)`);
                    document.documentElement.style.setProperty('--card-bg', 'rgba(30, 30, 30, 0.9)');
                    document.documentElement.style.setProperty('--text-color', '#f0f0f0');
                    document.documentElement.style.setProperty('--highlight-color', c3);
                    document.body.classList.add('theme-dark'); // Helper for other styles
                } else {
                    // Light Theme
                    document.documentElement.style.setProperty('--bg-gradient', `linear-gradient(to bottom, ${c1} 0%, #f5f5f5 100%)`);
                    document.documentElement.style.setProperty('--card-bg', 'rgba(255, 255, 255, 0.9)');
                    document.documentElement.style.setProperty('--text-color', '#2d3748');
                    document.documentElement.style.setProperty('--highlight-color', c2);
                    document.body.classList.remove('theme-dark');
                }
            }
        } catch (e) {
            console.warn("Could not extract colors from image", e);
        }
    };
}

function resetTheme() {
    // Reset custom properties
    document.documentElement.style.removeProperty('--primary-gradient');
    document.documentElement.style.removeProperty('--secondary-gradient');
    document.documentElement.style.removeProperty('--accent-gradient');
    document.documentElement.style.removeProperty('--bg-gradient');
    document.documentElement.style.removeProperty('--card-bg');
    document.documentElement.style.removeProperty('--text-color');
    document.documentElement.style.removeProperty('--highlight-color');
    
    // Re-apply current selected theme from settings
    applyTheme(state.settings.theme);
}

function applyTheme(themeName) {
    // Reset CSS variables to default first (in case they were overridden by inline styles)
    document.documentElement.style.removeProperty('--primary-gradient');
    document.documentElement.style.removeProperty('--secondary-gradient');
    document.documentElement.style.removeProperty('--bg-gradient');

    // Remove all theme classes
    document.body.classList.remove('theme-dark', 'theme-pastel', 'theme-neon', 'theme-high-contrast');
    
    // Add new theme class if not default
    if (themeName !== 'Default') {
        document.body.classList.add('theme-' + themeName.toLowerCase().replace(' ', '-'));
    }
}

// Game Logic
async function loadGamesList() {
    const grid = document.getElementById('games-list');
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">Loading games...</p>';
    
    try {
        const source = state.settings.gamesSource;
        const showOnline = source === 'ALL' || source === 'Online';
        const showLocal = source === 'ALL' || source === 'Local';
        
        // Clear immediately before populating
        grid.innerHTML = '';
        let hasGames = false;

        if (showOnline) {
            // Try to fetch from manifest file
            try {
                const response = await fetch('games_manifest.json');
                if (response.ok) {
                    const games = await response.json();
                    
                    if (games.length > 0) {
                        hasGames = true;
                        // Process games in parallel to fetch images if needed
                        const buttons = await Promise.all(games.map(async (game) => {
                            const btn = document.createElement('button');
                            btn.className = 'scannable category-card';
                            btn.dataset.action = 'load-game';
                            btn.dataset.path = game.path;
                            
                            let imageUrl = game.image;

                            // If no image in manifest, try to fetch from game file
                            if (!imageUrl && game.path) {
                                try {
                                    const gameResp = await fetch(game.path);
                                    if (gameResp.ok) {
                                        const gameData = await gameResp.json();
                                        if (gameData.meta && gameData.meta.image) {
                                            imageUrl = gameData.meta.image;
                                        }
                                    }
                                } catch (err) {
                                    console.warn(`Failed to fetch image for ${game.name}`, err);
                                }
                            }
                            
                            let content = '';
                            if (imageUrl) {
                                content += `<img src="${imageUrl}" class="category-img" alt="">`;
                                btn.classList.add('has-image');
                            } else {
                                content += `<i class="fas fa-gamepad"></i>`;
                            }
                            
                            content += `<span>${game.name}</span>`;
                            
                            btn.innerHTML = content;
                            return btn;
                        }));

                        buttons.forEach(btn => grid.appendChild(btn));
                    }
                }
            } catch (e) {
                console.warn("Manifest load failed", e);
            }
        }
        
        if (showLocal) {
            // Check for Local Custom Games and add a button for EACH of them
            const localLib = JSON.parse(localStorage.getItem('trivia_game_library') || '[]');
            
            if (localLib.length > 0) {
                hasGames = true;
                localLib.forEach((game, index) => {
                    const btn = document.createElement('button');
                    btn.className = 'scannable category-card';
                    btn.dataset.action = 'load-local-game';
                    btn.dataset.index = index;
                    btn.style.border = '2px solid #4a90e2';
                    

                    let content = '';
                    // Use game image if available
                    if (game.meta && game.meta.image) {
                        content += `<img src="${game.meta.image}" class="category-img" alt="">`;
                        btn.classList.add('has-image');
                    } else {
                        content += `<i class="fas fa-user-edit"></i>`;
                    }
                    

                    const title = game.meta && game.meta.title ? game.meta.title : (game.name || "Custom Game");
                    content += `<span>${title}</span>`;
                    
                    btn.innerHTML = content;
                    grid.appendChild(btn); 
                });
            }
        }

        // Add "Load Local File" Option - Always available or only when Local is active?
        // User probably expects to be able to load a file in "All" or "Local" modes.
        // If "Online" is selected, user likely wants a restricted view. 
        // Let's hide it in "Online" mode to match " Available Games" intent.
        
        if (showLocal) {
             addLoadFileButton(grid);
             hasGames = true; // Always count load button as a game entry
        }
        
        if (!hasGames) {
             grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">No games found for selected filter.</p>';
        }

        resetScanning();

    } catch (e) {
        console.warn("Error loading games list", e);
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">Error loading games.</p>';
        
        // Add "Load Local File" Option in case of error, if local is allowed
        if (state.settings.gamesSource !== 'Online') {
             addLoadFileButton(grid);
        }
        resetScanning();
    }
}

function addLoadFileButton(grid) {
    const fileBtn = document.createElement('button');
    fileBtn.className = 'scannable category-card';
    fileBtn.style.background = '#666';
    fileBtn.innerHTML = `<i class="fas fa-folder-open"></i> <span>Load File...</span>`;
    fileBtn.dataset.action = 'open-load-game-warning'; // Changed action to trigger warning
    grid.appendChild(fileBtn);
}

function saveToLibrary(json, filename) {
    const lib = JSON.parse(localStorage.getItem('trivia_game_library') || '[]');
    
    // Check duplicates by title or filename
    const title = json.meta?.title || filename.replace('.json', '');
    const idx = lib.findIndex(g => (g.meta?.title === title) || (g.name === title));
    
    const entry = {
        name: title,
        meta: json.meta || { title: title },
        categories: json.categories || json,
        added: Date.now()
    };
    
    if (idx >= 0) {
        lib[idx] = entry; // Update
    } else {
        lib.push(entry);
    }
    
    localStorage.setItem('trivia_game_library', JSON.stringify(lib));
    speak("Game Saved to Library");
}

function triggerFileLoad() {
    let input = document.getElementById('game-file-input');
    if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = 'game-file-input';
        input.accept = '.json';
        input.style.display = 'none';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                        try {
                            const json = JSON.parse(ev.target.result);
                            // New Behavior: Save to Library, Validate UI
                            if (json.categories || (json.meta && json.categories)) {
                                saveToLibrary(json, file.name);
                                loadGamesList(); // Refresh UI
                                alert("Game added! Please select it from the menu.");
                            } else {
                                alert("Invalid Game File. Missing categories.");
                            }
                        } catch (ex) {
                            alert("Invalid JSON file");
                        }
                    };
                    reader.readAsText(file);
                }
            };
            document.body.appendChild(input);
        }
        input.click();
}

function saveCustomGame(gameData) {
    // Deprecated in favor of Library
}

function loadGameData(json, isPersisted = true) {
    // This is now mainly for "Active" loading (when clicked)
    let gameData = {};
    if (json.meta && json.categories) {
        TRIVIA_DATA = json.categories; // Replace active data
        gameData = json.categories;
        if (json.meta.image) {
             // Optional: Set header image
        }
    } else {
        TRIVIA_DATA = json; // Replace active data
        gameData = json;
    }
    
    state.categoryPage = 0;
    loadCategories();
    showScreen('category-selection'); 
    speak("Game Loaded");
}

async function loadGameFile(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error('Failed to load game file');
        const json = await response.json();
        loadGameData(json, false); // Do not persist online games
        // Screen switch happens inside loadGameData now
    } catch (e) {
        console.error(e);
        alert("Error loading game file: " + e.message);
    }
}

function loadCategories() {
    const grid = document.getElementById('category-grid');
    grid.innerHTML = '';
    // Sort alphabetically
    const allCategories = Object.keys(TRIVIA_DATA).sort((a, b) => a.localeCompare(b));
    
    let start, end;
    if (state.categoryPage === 0) {
        start = 0;
        end = CATS_PAGE_FIRST;
    } else {
        start = CATS_PAGE_FIRST + (state.categoryPage - 1) * CATS_PAGE_OTHER;
        end = start + CATS_PAGE_OTHER;
    }
    
    const pageCategories = allCategories.slice(start, end);
    
    // Load category scores
    const categoryScores = JSON.parse(localStorage.getItem('trivia_category_scores') || '{}');

    // Pagination Controls - Prev (First)
    if (state.categoryPage === 0) {
        // Main Menu Button
        const menuBtn = document.createElement('button');
        menuBtn.className = 'scannable category-card';
        menuBtn.dataset.action = 'back-to-menu';
        menuBtn.innerHTML = '<i class="fas fa-home"></i> Main Menu';
        menuBtn.style.background = '#444';
        grid.appendChild(menuBtn);

        // Prev Page (Loops to last)
        const prevBtn = document.createElement('button');
        prevBtn.className = 'scannable category-card';
        prevBtn.dataset.action = 'prev-page';
        prevBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Prev Page';
        prevBtn.style.background = '#666';
        grid.appendChild(prevBtn);
    } else {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'scannable category-card';
        prevBtn.dataset.action = 'prev-page';
        prevBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Prev Page';
        prevBtn.style.background = '#666';
        grid.appendChild(prevBtn);
    }

    pageCategories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'scannable category-card';
        btn.dataset.action = 'select-category';
        btn.dataset.category = cat;
        
        let content = `<i class="fas fa-star"></i> <span>${cat}</span>`;
        
        // Add High Score if exists
        if (categoryScores[cat]) {
            content += `<div class="category-score" style="font-size: 0.6em; margin-top: 5px; opacity: 0.9;">Best: ${categoryScores[cat]}</div>`;
        }

        // Handle new structure with image
        if (!Array.isArray(TRIVIA_DATA[cat]) && TRIVIA_DATA[cat].image) {
            content = `<img src="${TRIVIA_DATA[cat].image}" class="category-img" alt="">` + content;
            btn.classList.add('has-image');
        }
        
        btn.innerHTML = content;
        grid.appendChild(btn);
    });

    // Pagination Controls - Next (Last)
    // Always show Next Page to allow looping
    const nextBtn = document.createElement('button');
    nextBtn.className = 'scannable category-card';
    nextBtn.dataset.action = 'next-page';
    nextBtn.innerHTML = 'Next Page <i class="fas fa-arrow-right"></i>';
    nextBtn.style.background = '#666';
    grid.appendChild(nextBtn);
    
    resetScanning();
}

/* Helper Functions for Question Usage Tracking */
function getQuestionUsage() {
    return JSON.parse(localStorage.getItem('trivia_question_usage') || '{}');
}

function updateQuestionUsage(questionsToUpdate) {
    const usage = getQuestionUsage();
    questionsToUpdate.forEach(q => {
        if (q.question) {
            const key = q.question.trim();
            usage[key] = (usage[key] || 0) + 1;
        }
    });
    localStorage.setItem('trivia_question_usage', JSON.stringify(usage));
}

function startGame(category) {
    state.currentCategory = category;
    
    // Handle new structure (Object vs Array)
    let catData = TRIVIA_DATA[category];
    let catImage = null;
    
    if (!Array.isArray(catData)) {
        if (catData.image) catImage = catData.image;
        catData = catData.questions;
    }
    
    // Apply Theme from Image
    if (catImage) {
        applyCategoryTheme(catImage);
    } else {
        resetTheme();
    }
    
    // Deduplicate questions based on question text
    const uniqueQuestions = [];
    const seenQuestions = new Set();
    
    if (catData && Array.isArray(catData)) {
        catData.forEach(q => {
            if (q && q.question && !seenQuestions.has(q.question)) {
                seenQuestions.add(q.question);
                uniqueQuestions.push(q);
            }
        });
    }

    // --- NEW LOGIC: Usage Balanced Shuffle ---
    const usageData = getQuestionUsage();
    const usageGroups = {};

    uniqueQuestions.forEach(q => {
        const key = q.question.trim();
        const count = usageData[key] || 0;
        if (!usageGroups[count]) usageGroups[count] = [];
        usageGroups[count].push(q);
    });

    let balancedQuestions = [];
    // Sort usage counts ascending (0, 1, 2...)
    const counts = Object.keys(usageGroups).sort((a,b) => parseInt(a) - parseInt(b));
    
    counts.forEach(c => {
        const group = usageGroups[c];
        // Shuffle within the group
        for (let i = group.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [group[i], group[j]] = [group[j], group[i]];
        }
        balancedQuestions = balancedQuestions.concat(group);
    });

    state.questions = balancedQuestions;
    // -----------------------------------------

    // Limit to 20 questions
    state.questions = state.questions.slice(0, 20);

    // Track usage for selected questions
    updateQuestionUsage(state.questions);
    
    state.score = 0;
    state.streak = 0;
    state.currentQuestionIndex = 0;
    state.gameStartTime = Date.now();
    
    updateHUD();
    showScreen('game-screen');
    loadQuestion();
}

function loadQuestion() {
    if (state.currentQuestionIndex >= state.questions.length) {
        endGame();
        return;
    }

    const q = state.questions[state.currentQuestionIndex];
    document.getElementById('question-text').innerText = q.question;
    
    // Handle Media
    const mediaContainer = document.getElementById('media-container');
    mediaContainer.innerHTML = '';
    mediaContainer.classList.remove('scannable');
    mediaContainer.removeAttribute('aria-label');
    
    if (q.media && q.media.src) {
        mediaContainer.classList.add('scannable');
        mediaContainer.setAttribute('aria-label', 'Question Media');
        let mediaEl;
        if (q.media.type === 'image') {
            mediaEl = document.createElement('img');
            mediaEl.src = q.media.src;
            mediaEl.className = 'question-media';
        } else if (q.media.type === 'audio') {
            mediaEl = document.createElement('audio');
            mediaEl.src = q.media.src;
            mediaEl.controls = true;
            mediaEl.className = 'question-media';
            // Auto-play audio if desired, or let user play
            // mediaEl.autoplay = true; 
        } else if (q.media.type === 'video') {
            // Check for YouTube, Vimeo, Google Drive
            const ytId = getYouTubeId(q.media.src);
            const vimeoId = getVimeoId(q.media.src);
            const gDriveId = getGoogleDriveId(q.media.src);

            if (ytId) {
                mediaEl = document.createElement('iframe');
                mediaEl.src = `https://www.youtube.com/embed/${ytId}?autoplay=0&mute=0`;
                mediaEl.className = 'question-media';
                mediaEl.style.width = '100%';
                mediaEl.style.height = '20vh';
                mediaEl.style.border = 'none';
                mediaEl.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
                mediaEl.allowFullscreen = true;
            } else if (vimeoId) {
                mediaEl = document.createElement('iframe');
                mediaEl.src = `https://player.vimeo.com/video/${vimeoId}?autoplay=0&background=0`;
                mediaEl.className = 'question-media';
                mediaEl.style.width = '100%';
                mediaEl.style.height = '20vh';
                mediaEl.style.border = 'none';
                mediaEl.allow = "autoplay; fullscreen; picture-in-picture";
                mediaEl.allowFullscreen = true;
            } else if (gDriveId) {
                mediaEl = document.createElement('iframe');
                mediaEl.src = `https://drive.google.com/file/d/${gDriveId}/preview?autoplay=0`;
                mediaEl.className = 'question-media';
                mediaEl.style.width = '100%';
                mediaEl.style.height = '20vh';
                mediaEl.style.border = 'none';
                mediaEl.allow = "autoplay";
                mediaEl.allowFullscreen = true;
            } else {
                // Local video or direct link
                mediaEl = document.createElement('video');
                mediaEl.src = q.media.src;
                mediaEl.controls = true;
                mediaEl.className = 'question-media';
                mediaEl.autoplay = false;
                mediaEl.muted = false; // Ensure sound is on if available
                mediaEl.loop = true;
            }
        }
        
        if (mediaEl) {
            mediaContainer.appendChild(mediaEl);
        }
    }
    
    const container = document.getElementById('answers-container');
    container.innerHTML = '';
    
    // Create array of choice objects with correctness flag
    // User specified that the first answer in the list is always the correct one
    let choices = q.choices.map((choice, index) => {
        let text = choice;
        let image = null;
        
        if (typeof choice === 'object' && choice !== null) {
            text = choice.text;
            image = choice.image;
        }
        
        return {
            text: text,
            image: image,
            isCorrect: index === 0
        };
    });

    // Shuffle choices
    choices.sort(() => Math.random() - 0.5);

    choices.forEach((choiceObj, index) => {
        const btn = document.createElement('button');
        btn.className = 'scannable answer-btn';
        btn.dataset.action = 'answer';
        btn.dataset.isCorrect = choiceObj.isCorrect;
        
        let content = '';
        if (choiceObj.image) {
            // Check if it's a video
            const ytId = getYouTubeId(choiceObj.image);
            const vimeoId = getVimeoId(choiceObj.image);
            const gDriveId = getGoogleDriveId(choiceObj.image);
            const isVideoFile = choiceObj.image.match(/\.(mp4|webm|ogg)$/i);

            if (ytId || vimeoId || gDriveId || isVideoFile) {
                // It's a video
                btn.dataset.videoSrc = choiceObj.image;
                btn.dataset.videoType = ytId ? 'youtube' : (vimeoId ? 'vimeo' : (gDriveId ? 'gdrive' : 'file'));
                
                // Thumbnail logic
                let thumbSrc = '';
                if (ytId) thumbSrc = `https://img.youtube.com/vi/${ytId}/0.jpg`;;
                
                if (thumbSrc) {
                     content += `<img src="${thumbSrc}" class="answer-img" alt="Video">`;
                } else {
                     // Fallback icon/placeholder
                     content += `<div class="answer-img video-placeholder" style="display:flex;justify-content:center;align-items:center;height:100%;width:100%;background:#000;color:#fff;border-radius:10px;"><i class="fas fa-play-circle" style="font-size: 3em;"></i></div>`;
                }
                btn.classList.add('has-image');
            } else {
                // Regular image
                content += `<img src="${choiceObj.image}" class="answer-img" alt="">`;
                btn.classList.add('has-image');
            }
        }
        // Only show text if it exists, or if there is no image (fallback)
        if (choiceObj.text || !choiceObj.image) {
            content += `<span class="answer-text">${choiceObj.text || ''}</span>`;
        } else {
            // Image only - Set aria-label to space to prevent "Button" from being spoken
            btn.setAttribute('aria-label', ' ');
        }
        
        btn.innerHTML = content;
        container.appendChild(btn);
    });

    currentQEl.innerText = state.currentQuestionIndex + 1;
    totalQEl.innerText = state.questions.length;
    
    speak(q.question);
    
    // Adjust font size to fit
    setTimeout(adjustQuestionFontSize, 50); // Small delay to allow render

    state.questionStartTime = Date.now();
    resetScanning();

    // Start scanning on the Question Text immediately
    const qIndex = state.activeElements.findIndex(el => el.id === 'question-text-wrapper');
    if (qIndex !== -1) {
        state.currentIndex = qIndex - 1;
        scanNext();
    }
}

function handleAnswer(btn) {
    const isCorrect = btn.dataset.isCorrect === 'true';
    
    // Disable all buttons
    const buttons = document.querySelectorAll('.answer-btn');
    buttons.forEach(b => b.classList.remove('scanned')); // Stop scanning them
    
    if (isCorrect) {
        btn.classList.add('correct');
        audio.playCorrect();
        
        // Score calculation
        let points = 100;
        
        // Speed Bonus (within 5 seconds = +50, within 10s = +20)
        const timeTaken = (Date.now() - state.questionStartTime) / 1000;
        if (timeTaken < 5) points += 50;
        else if (timeTaken < 10) points += 20;

        state.streak++;
        if (state.streak >= 2) points *= Math.min(state.streak, 5); // Max 5x
        
        state.score += points;
        
        // Visual Score Update
        animateScoreUpdate(points);

        // Level Up Check
        if (state.streak > 0 && state.streak % LEVEL_THRESHOLD === 0) {
            state.level++;
            const levelBonus = 500 * state.level;
            state.score += levelBonus;
            updateHUD(); // Update HUD immediately after adding level bonus
            animateScoreUpdate(levelBonus); // Show bonus visually too
            
            audio.playFanfare();
            speak(`Level Up!`);
        } else {
            speak("Correct");
        }

        triggerConfetti();
    } else {
        btn.classList.add('wrong');
        // Highlight correct one
        buttons.forEach(b => {
            if (b.dataset.isCorrect === 'true') b.classList.add('correct');
        });
        
        audio.playWrong();
        state.streak = 0;
    }
    
    updateHUD();

    // Automatically go to next question after short delay
    setTimeout(() => {
        nextQuestion();
    }, 1500);
}

function showFeedback(isCorrect, points) {
    // Deprecated - Feedback is now inline
}

function nextQuestion() {
    state.currentQuestionIndex++;
    showScreen('game-screen');
    loadQuestion();
}

function endGame() {
    // Calculate Time Bonus
    const totalTime = (Date.now() - state.gameStartTime) / 1000; // in seconds
    const maxTime = state.questions.length * 30; // Assuming 30s per question as baseline
    let timeBonus = 0;
    
    if (totalTime < maxTime) {
        // Bonus: 10 points for every 10 seconds saved
        timeBonus = Math.floor((maxTime - totalTime) / 10) * 10;
    }
    
    state.score += timeBonus;
    updateHUD(); // Update HUD with final score including time bonus

    showScreen('end-screen');
    document.getElementById('final-score').innerText = state.score;
    if (timeBonus > 0) {
        speak(`Game Over. Time Bonus: ${timeBonus} points.`);
    }
    audio.playFanfare();
    
    // Save high score (per category)
    const categoryScores = JSON.parse(localStorage.getItem('trivia_category_scores') || '{}');
    const currentBest = categoryScores[state.currentCategory] || 0;
    let msg = `Game Over. Your final score is ${state.score}.`;

    if (state.score > currentBest) {
        categoryScores[state.currentCategory] = state.score;
        localStorage.setItem('trivia_category_scores', JSON.stringify(categoryScores));
        document.getElementById('new-highscore-msg').innerText = `New Best for ${state.currentCategory}!`;
        msg += " New High Score!";
    } else {
        document.getElementById('new-highscore-msg').innerText = `Best: ${currentBest}`;
    }
    
    speak(msg);
    
    // Save high score (local storage) - Legacy global list (optional, keeping for now)
    const highscores = JSON.parse(localStorage.getItem('trivia_highscores') || '[]');
    highscores.push({ score: state.score, date: new Date().toLocaleDateString() });
    highscores.sort((a, b) => b.score - a.score);
    localStorage.setItem('trivia_highscores', JSON.stringify(highscores.slice(0, 5)));
}

function showHighScores() {
    const list = document.getElementById('highscore-list');
    const highscores = JSON.parse(localStorage.getItem('trivia_highscores') || '[]');
    
    list.innerHTML = highscores.length ? '' : '<li>No scores yet!</li>';
    
    highscores.forEach((s, i) => {
        const li = document.createElement('li');
        li.innerText = `${i+1}. ${s.score} pts (${s.date})`;
        list.appendChild(li);
    });
}

function updateHUD() {
    scoreEl.innerText = state.score;
    streakEl.innerText = state.streak;
}

function animateScoreUpdate(points) {
    const hud = document.getElementById('score-display');
    const floatEl = document.createElement('div');
    floatEl.className = 'score-float';
    floatEl.innerText = `+${points}`;
    hud.appendChild(floatEl);
    
    setTimeout(() => floatEl.remove(), 1000);
}

function updateSettingsUI() {
    state.settings.tts = window.NarbeVoiceManager ? window.NarbeVoiceManager.getSettings().ttsEnabled : state.settings.tts; // Sync local TTS state
    document.getElementById('tts-status').innerText = state.settings.tts ? "ON" : "OFF";
    document.getElementById('games-source-status').innerText = state.settings.gamesSource;
    document.getElementById('speed-status').innerText = state.settings.scanSpeed;
    document.getElementById('theme-status').innerText = state.settings.theme;
    document.getElementById('autoscan-status').innerText = state.settings.autoScan ? "ON" : "OFF";
    
    if (window.NarbeVoiceManager) {
        const v = window.NarbeVoiceManager.getCurrentVoice();
        document.getElementById('voice-status').innerText = window.NarbeVoiceManager.getVoiceDisplayName(v);
    } else {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            const v = voices[state.settings.voiceIndex % voices.length];
            document.getElementById('voice-status').innerText = v.name.substring(0, 15) + "...";
        } else {
            document.getElementById('voice-status').innerText = "Default";
        }
    }
}

// Visual Effects
function triggerConfetti() {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'];
    for (let i = 0; i < 50; i++) {
        const conf = document.createElement('div');
        conf.className = 'confetti';
        conf.style.left = Math.random() * 100 + 'vw';
        conf.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        conf.style.animationDuration = (Math.random() * 2 + 1) + 's';
        document.getElementById('particles').appendChild(conf);
        
        setTimeout(() => conf.remove(), 3000);
    }
}

function togglePause() {
    state.isPaused = !state.isPaused;
    const overlay = document.getElementById('pause-overlay');
    
    if (state.isPaused) {
        overlay.classList.remove('hidden');
        clearInterval(state.scanTimer);
        speak("Game Paused");
    } else {
        overlay.classList.add('hidden');
        startScanning();
        speak("Game Resumed");
    }
    resetScanning();
}

// Start
// loadLocalPersistedGames().then(async () => {
    // await loadManifestGames();
    // init();
// });
// New Start Logic: Just Init, let loadGamesList handle display
init();
loadGamesList();

function getYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function getVimeoId(url) {
    const regExp = /vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^\/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)(\d+)(?:$|\/|\?)/;
    const match = url.match(regExp);
    return match ? match[1] : null;
}

function getGoogleDriveId(url) {
    const regExp = /\/file\/d\/([a-zA-Z0-9_-]+)\/|\?id=([a-zA-Z0-9_-]+)/;
    const match = url.match(regExp);
    return match ? (match[1] || match[2]) : null;
}

function adjustQuestionFontSize() {
    const textEl = document.getElementById('question-text');
    const container = document.getElementById('question-container');
    const mediaContainer = document.getElementById('media-container');
    
    if (!textEl || !container) return;

    const text = textEl.innerText;
    const len = text.length;
    const hasMedia = mediaContainer && mediaContainer.innerHTML.trim() !== '' && mediaContainer.style.display !== 'none';

    let fontSize = 4; // Default large size (vh)

    if (hasMedia) {
        // Less space available because of image/video
        if (len < 30) fontSize = 3.5;
        else if (len < 60) fontSize = 3;
        else if (len < 100) fontSize = 2.5;
        else fontSize = 2.0;
    } else {
        // Full height available
        if (len < 50) fontSize = 4;
        else if (len < 100) fontSize = 3.5;
        else if (len < 150) fontSize = 3;
        else fontSize = 2.5;
    }

    textEl.style.fontSize = `${fontSize}vh`;
    
    // Safety check: specific to when media pushes text out
    // If we are still overflowing, shrink a bit more (down to 1.5vh)
    let safety = 0;
    while ((container.scrollHeight > container.clientHeight) && fontSize > 1.5 && safety < 20) {
        fontSize -= 0.1;
        textEl.style.fontSize = `${fontSize}vh`;
        safety++;
    }
}
