class Game {
    constructor() {
        this.canvas = document.getElementById(GAME_CONSTANTS.CANVAS_ID);
        this.ctx = this.canvas.getContext('2d');
        this.pauseButton = document.getElementById('pauseButton');
        this.pauseOverlay = document.getElementById('pauseOverlay');
        
        // Set canvas size
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        // Initialize all systems
        this.gameState = new GameState();
        this.audioSystem = new AudioSystem();
        this.seasonManager = new SeasonManager();
        this.fieldRenderer = new FieldRenderer(this.canvas, this.ctx, this);
        this.uiRenderer = new UIRenderer(this.canvas, this.ctx);
        this.inputHandler = new InputHandler(this);
        this.menuSystem = new MenuSystem(this);
        this.gameLogic = new GameLogic(this);
        this.animationSystem = new AnimationSystem(this);
        
        this.setupPauseMenu();
        this.setupResizeHandler();
        this.startGameLoop();
    }
    
    setupPauseMenu() {
        // Setup pause button click handler
        this.pauseButton.addEventListener('click', () => {
            if ([GAME_CONSTANTS.MODES.GAMEPLAY, GAME_CONSTANTS.MODES.BATTING, GAME_CONSTANTS.MODES.PITCHING].includes(this.gameState.mode)) {
                this.showPauseMenu();
            }
        });
        
        // Keep existing pause menu functions
        window.resumeGame = () => {
            this.pauseOverlay.classList.remove('active');
            this.resumeFromPause();
        };
        
        window.restartGame = () => {
            this.pauseOverlay.classList.remove('active');
            
            // Make sure pause button will be visible
            this.pauseButton.classList.add('visible');
            
            // Reset game state mode
            this.gameState.mode = GAME_CONSTANTS.MODES.GAMEPLAY;
            
            this.gameLogic.startGame();
        };
        
        window.quitToMenu = () => {
            this.pauseOverlay.classList.remove('active');
            
            // Set mode to main menu IMMEDIATELY to prevent any game resumption
            this.gameState.mode = GAME_CONSTANTS.MODES.MAIN_MENU;
            
            // Now call quitToMainMenu to handle the rest
            this.quitToMainMenu();
        };
        
        // Add missing pause settings functions
        window.showPauseSettings = () => {
            document.getElementById('pauseMenu').style.display = 'none';
            document.getElementById('pauseSettingsMenu').style.display = 'block';
            this.updatePauseSettingsDisplay();
            this.gameState.menuOptions = ['Music: ON', 'Sound Effects: ON', 'Text-to-Speech: ON', 'Voice: DEFAULT', 'Next Track', 'Reset Season', 'Back'];
            this.gameState.selectedIndex = 0;
            this.highlightPauseSettingsButton(0);
            this.audioSystem.speak('Settings menu');
        };
        
        window.backToPauseMenu = () => {
            document.getElementById('pauseSettingsMenu').style.display = 'none';
            document.getElementById('pauseMenu').style.display = 'block';
            this.gameState.menuOptions = ['Resume Game', 'Settings', 'Restart Game', 'Main Menu'];
            this.gameState.selectedIndex = 0;
            this.highlightPauseButton(0);
            this.audioSystem.speak('Game paused');
        };
        
        // Add individual setting toggle functions
        window.togglePauseMusic = () => {
            this.audioSystem.settings.musicEnabled = !this.audioSystem.settings.musicEnabled;
            this.audioSystem.save();
            if (this.audioSystem.settings.musicEnabled) {
                this.audioSystem.playBackgroundMusic();
            } else {
                this.audioSystem.stopMusic();
            }
            this.updatePauseSettingsDisplay();
            this.audioSystem.speak(this.audioSystem.settings.musicEnabled ? "Music enabled" : "Music disabled");
        };
        
        window.togglePauseSound = () => {
            this.audioSystem.settings.soundEnabled = !this.audioSystem.settings.soundEnabled;
            this.audioSystem.save();
            this.updatePauseSettingsDisplay();
            this.audioSystem.speak(this.audioSystem.settings.soundEnabled ? "Sound effects enabled" : "Sound effects disabled");
        };
        
        window.togglePauseTTS = () => {
            this.audioSystem.settings.ttsEnabled = !this.audioSystem.settings.ttsEnabled;
            this.audioSystem.save();
            this.updatePauseSettingsDisplay();
            if (this.audioSystem.settings.ttsEnabled) {
                this.audioSystem.speak("Text to speech enabled");
            }
        };
        
        window.togglePauseVoice = () => {
            const voices = ['default', 'male', 'female'];
            const currentIndex = voices.indexOf(this.audioSystem.settings.voiceType);
            this.audioSystem.settings.voiceType = voices[(currentIndex + 1) % voices.length];
            this.audioSystem.save();
            this.updatePauseSettingsDisplay();
            this.audioSystem.speak(`Voice changed to ${this.audioSystem.settings.voiceType}`);
        };
        
        window.pauseNextTrack = () => {
            this.audioSystem.nextTrack();
            this.audioSystem.speak("Next track");
        };
        
        window.pauseResetSeason = () => {
            this.seasonManager.reset();
            this.audioSystem.speak("Season reset");
        };

        window.showResetSeasonConfirmation = () => {
            document.getElementById('pauseSettingsMenu').style.display = 'none';
            document.getElementById('resetSeasonConfirmation').style.display = 'block';
            this.gameState.menuOptions = ['Confirm', 'Cancel'];
            this.gameState.selectedIndex = -1;
            this.highlightResetConfirmationButton(-1);
            this.audioSystem.speak('Are you sure you want to reset the season?');
        };

        window.confirmResetSeason = () => {
            this.seasonManager.reset();
            document.getElementById('resetSeasonConfirmation').style.display = 'none';
            document.getElementById('pauseSettingsMenu').style.display = 'block';
            this.gameState.menuOptions = ['Music: ON', 'Sound Effects: ON', 'Text-to-Speech: ON', 'Voice: DEFAULT', 'Next Track', 'Reset Season', 'Back'];
            this.gameState.selectedIndex = 0;
            this.updatePauseSettingsDisplay();
            this.highlightPauseSettingsButton(0);
            this.audioSystem.speak('Season reset');
        };

        window.cancelResetSeason = () => {
            document.getElementById('resetSeasonConfirmation').style.display = 'none';
            document.getElementById('pauseSettingsMenu').style.display = 'block';
            this.gameState.menuOptions = ['Music: ON', 'Sound Effects: ON', 'Text-to-Speech: ON', 'Voice: DEFAULT', 'Next Track', 'Reset Season', 'Back'];
            this.gameState.selectedIndex = 0;
            this.updatePauseSettingsDisplay();
            this.highlightPauseSettingsButton(0);
            this.audioSystem.speak('Cancelled');
        };
    }

    showPauseMenu() {
        // Store the previous mode and show HTML pause overlay
        this.gameState.previousMode = this.gameState.mode;
        this.gameState.mode = GAME_CONSTANTS.MODES.PAUSE_MENU;
        
        // Set up scanning for pause menu buttons - start with first option
        this.gameState.menuOptions = ['Resume Game', 'Settings', 'Restart Game', 'Main Menu'];
        this.gameState.selectedIndex = 0;
        this.gameState.menuReady = true;
        this.gameState.hasScanned = false;
        
        // Show the HTML pause overlay
        this.pauseOverlay.classList.add('active');
        this.audioSystem.speak('Game paused');
        
        // Highlight the first option
        this.highlightPauseButton(0);
    }

    highlightPauseButton(index) {
        // Remove highlight from all buttons
        const buttons = document.querySelectorAll('#pauseMenu button');
        buttons.forEach(btn => {
            btn.style.background = 'linear-gradient(135deg, rgba(255, 235, 59, 0.2) 0%, rgba(255, 235, 59, 0.4) 50%, rgba(255, 235, 59, 0.2) 100%)';
            btn.style.transform = 'scale(1)';
        });
        
        // Highlight selected button
        if (buttons[index]) {
            buttons[index].style.background = 'linear-gradient(135deg, rgba(255, 235, 59, 0.4) 0%, rgba(255, 235, 59, 0.6) 50%, rgba(255, 235, 59, 0.4) 100%)';
            buttons[index].style.transform = 'scale(1.05)';
        }
    }

    highlightPauseSettingsButton(index) {
        // Remove highlight from all settings buttons
        const buttons = document.querySelectorAll('#pauseSettingsMenu button');
        buttons.forEach(btn => {
            btn.style.background = 'linear-gradient(135deg, rgba(255, 235, 59, 0.2) 0%, rgba(255, 235, 59, 0.4) 50%, rgba(255, 235, 59, 0.2) 100%)';
            btn.style.transform = 'scale(1)';
        });
        
        // Highlight selected button
        if (buttons[index]) {
            buttons[index].style.background = 'linear-gradient(135deg, rgba(255, 235, 59, 0.4) 0%, rgba(255, 235, 59, 0.6) 50%, rgba(255, 235, 59, 0.4) 100%)';
            buttons[index].style.transform = 'scale(1.05)';
        }
    }

    highlightResetConfirmationButton(index) {
        // Remove highlight from all confirmation buttons
        const buttons = document.querySelectorAll('#resetSeasonConfirmation button');
        buttons.forEach(btn => {
            btn.style.background = 'linear-gradient(135deg, rgba(255, 235, 59, 0.2) 0%, rgba(255, 235, 59, 0.4) 50%, rgba(255, 235, 59, 0.2) 100%)';
            btn.style.transform = 'scale(1)';
        });
        
        // Highlight selected button
        if (buttons[index]) {
            buttons[index].style.background = 'linear-gradient(135deg, rgba(255, 235, 59, 0.4) 0%, rgba(255, 235, 59, 0.6) 50%, rgba(255, 235, 59, 0.4) 100%)';
            buttons[index].style.transform = 'scale(1.05)';
        }
    }

    resumeFromPause() {
        // Return to the previous game mode
        this.gameState.mode = this.gameState.previousMode || GAME_CONSTANTS.MODES.GAMEPLAY;
        
        this.audioSystem.speak('Resuming game');
        
        if (this.gameState.mode === GAME_CONSTANTS.MODES.BATTING) {
            // Reset batting menu state and call showSwingMenu to restore proper options
            this.gameLogic.showSwingMenu();
        } else if (this.gameState.mode === GAME_CONSTANTS.MODES.PITCHING) {
            // Reset pitching menu state and call showPitchMenu to restore proper options
            this.gameLogic.showPitchMenu();
        } else {
            this.drawGameScreen();
        }
        
        // ALWAYS ensure pause button is visible after resuming - do this LAST
        // Use setTimeout to ensure it happens after any other state changes
        setTimeout(() => {
            this.pauseButton.classList.add('visible');
        }, 50);
    }

    quitToMainMenu() {
        // IMMEDIATELY set mode to prevent any game logic from running
        this.gameState.mode = GAME_CONSTANTS.MODES.MAIN_MENU;
        
        // Remove pause button
        this.pauseButton.classList.remove('visible');
        
        // Only clear the current game if NOT in season mode
        // In exhibition mode, clear the game since there's no save system
        // In season mode, keep the saved game so user can resume later
        if (!this.seasonManager.data.active) {
            // Exhibition mode - clear everything
            this.seasonManager.clearCurrentGame();
        }
        // If in season mode, the saved game remains intact for resuming later
        
        // Force clear any pending timeouts in GameLogic
        if (this.gameLogic.playTimeoutId) {
            clearTimeout(this.gameLogic.playTimeoutId);
            this.gameLogic.playTimeoutId = null;
        }
        
        // Reset ALL game state flags to ensure clean state
        this.gameState.animating = false;
        this.gameState.playInProgress = false;
        this.gameState.inputsBlocked = false;
        this.gameState.menuReady = false;
        this.gameState.hasScanned = false;
        this.gameState.selectedIndex = 0;
        this.gameState.returnHeld = false;
        this.gameState.spaceHeld = false;
        
        // Stop any ongoing animations
        if (this.gameState.runnerAnimation.active) {
            this.gameState.runnerAnimation.active = false;
            this.gameState.runnerAnimation.runners = [];
        }
        
        // Clear any pending base updates
        this.gameState.pendingBaseUpdate = null;
        
        this.audioSystem.speak('Returning to main menu');
        
        // Use setTimeout to ensure mode change is processed before showing menu
        setTimeout(() => {
            this.menuSystem.showMainMenu();
        }, 100);
    }
    
    setupResizeHandler() {
        window.addEventListener('resize', () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            
            // Redraw current screen
            const mode = this.gameState.mode;
            if (mode === GAME_CONSTANTS.MODES.MAIN_MENU) {
                this.menuSystem.drawMainMenu();
            } else if (mode === GAME_CONSTANTS.MODES.PLAY_MENU) {
                this.menuSystem.drawPlayMenu();
            } else if (mode === GAME_CONSTANTS.MODES.SETTINGS_MENU) {
                this.menuSystem.drawSettingsMenu();
            } else if (mode === GAME_CONSTANTS.MODES.COLOR_SELECT) {
                this.menuSystem.drawColorSelectMenu();
            } else if (mode === GAME_CONSTANTS.MODES.GAMEPLAY) {
                this.drawGameScreen();
                this.fieldRenderer.initializeFieldPlayers(this.gameState);
            } else if (mode === GAME_CONSTANTS.MODES.BATTING) {
                this.menuSystem.drawSwingMenu();
            } else if (mode === GAME_CONSTANTS.MODES.PITCHING) {
                this.menuSystem.drawPitchMenu();
            } else if (mode === GAME_CONSTANTS.MODES.HALF_INNING_TRANSITION) {
                this.uiRenderer.drawTransitionScreen(this.gameState);
            }
        });
    }
    
    drawGameScreen() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.fieldRenderer.drawField(this.gameState);
        this.fieldRenderer.drawPlayers();
        this.uiRenderer.drawScoreboard(this.gameState);
    }
    
    startGameLoop() {
        const gameLoop = () => {
            if (this.gameState.mode === GAME_CONSTANTS.MODES.GAMEPLAY && !this.gameState.animating) {
                this.drawGameScreen();
            } else if (this.gameState.mode === GAME_CONSTANTS.MODES.HALF_INNING_TRANSITION) {
                this.uiRenderer.drawTransitionScreen(this.gameState);
            }
            
            requestAnimationFrame(gameLoop);
        };
        
        gameLoop();
    }
    
    initialize() {
        this.menuSystem.showMainMenu();
    }

    updatePauseSettingsDisplay() {
        // Get current voice name for display
        let voiceDisplayName = 'DEFAULT';
        if (this.audioSystem.voiceManager) {
            const currentVoice = this.audioSystem.voiceManager.getCurrentVoice();
            voiceDisplayName = this.audioSystem.voiceManager.getVoiceDisplayName(currentVoice);
        } else {
            voiceDisplayName = this.audioSystem.settings.voiceType.toUpperCase();
        }
        
        // Update the button text to reflect current settings
        document.getElementById('pauseMusicToggle').textContent = `Music: ${this.audioSystem.settings.musicEnabled ? 'ON' : 'OFF'}`;
        document.getElementById('pauseSoundToggle').textContent = `Sound Effects: ${this.audioSystem.settings.soundEnabled ? 'ON' : 'OFF'}`;
        document.getElementById('pauseTTSToggle').textContent = `Text-to-Speech: ${this.audioSystem.settings.ttsEnabled ? 'ON' : 'OFF'}`;
        document.getElementById('pauseVoiceToggle').textContent = `Voice: ${voiceDisplayName}`;
        
        // Update menu options array to match
        this.gameState.menuOptions = [
            `Music: ${this.audioSystem.settings.musicEnabled ? 'ON' : 'OFF'}`,
            `Sound Effects: ${this.audioSystem.settings.soundEnabled ? 'ON' : 'OFF'}`,
            `Text-to-Speech: ${this.audioSystem.settings.ttsEnabled ? 'ON' : 'OFF'}`,
            `Voice: ${voiceDisplayName}`,
            'Next Track',
            'Reset Season',
            'Back'
        ];
    }
}

// Initialize the game when the page loads
window.addEventListener('load', () => {
    const game = new Game();
    game.initialize();
});