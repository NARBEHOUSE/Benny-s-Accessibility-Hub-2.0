class InputHandler {
    constructor(game) {
        this.game = game;
        this.keyStates = {};
        this.selectedPlayerIndex = -1; // Track selected field player for scanning
        this.backwardScanInterval = null; // Track backward scan interval
        this.autoScanInterval = null; // Auto scan timer
        this.setupEventListeners();
        
        // Subscribe to scan manager settings changes
        if (window.NarbeScanManager) {
            window.NarbeScanManager.subscribe(() => this.restartAutoScan());
        }

        // Start auto scan if enabled
        setTimeout(() => this.startAutoScan(), 100);
    }

    setupEventListeners() {
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));
        // Add mouse support for interactive batting
        this.game.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.game.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.game.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.game.canvas.addEventListener('touchstart', (e) => this.handleTouch(e));
    }
    
    handleMouseDown(e) {
        if (e.button === 0) { // Left Mouse Button
            // If in interactive batting, holding click charges swing
            if (this.game.gameState.mode === GAME_CONSTANTS.MODES.INTERACTIVE_BATTING) {
                if (this.game.gameLogic.onSwingStart()) {
                    // Prevent default if swing started successfully
                    // We don't prevent default on canvas generally to allow other interactions
                }
            }
        }
    }

    handleMouseUp(e) {
        if (e.button === 0) { // Left Mouse Button
            // Release swing
            if (this.game.gameState.mode === GAME_CONSTANTS.MODES.INTERACTIVE_BATTING) {
                this.game.gameLogic.onSwingRelease();
            }
        }
    }

    startAutoScan() {
        this.stopAutoScan();
        
        if (!window.NarbeScanManager || !window.NarbeScanManager.getSettings().autoScan) return;

        const interval = window.NarbeScanManager.getScanInterval();
        this.autoScanInterval = setInterval(() => {
            this.performAutoScan();
        }, interval);
    }

    stopAutoScan() {
        if (this.autoScanInterval) {
            clearInterval(this.autoScanInterval);
            this.autoScanInterval = null;
        }
    }

    restartAutoScan() {
        this.stopAutoScan();
        this.startAutoScan();
    }

    performAutoScan() {
        // Don't auto scan if inputs are blocked
        if (this.game.gameState.playInProgress || this.game.gameState.inputsBlocked) return;

        // Don't auto scan if user is holding a key (interacting)
        if (this.game.gameState.spaceHeld || this.game.gameState.returnHeld) return;

        // Don't auto scan if backward scanning is active
        if (this.backwardScanInterval) return;

        // Perform the scan
        this.game.audioSystem.playSound('scan');
        this.executeScan();
    }

    handleKeyDown(e) {
        if (this.keyStates[e.key]) return;
        this.keyStates[e.key] = true;

        // Reset auto scan on interaction
        this.restartAutoScan();

        if (e.key === ' ') {
            e.preventDefault();
            this.game.gameState.spaceHeld = true;
            this.game.gameState.spaceHoldStart = Date.now();
            
            // Start checking for backward scan during hold
            this.checkBackwardScanDuringHold();
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            this.game.gameState.returnHeld = true;
            this.game.gameState.returnHoldStart = Date.now();
            
            // Track if this keydown started an action (to prevent conflicts)
            this.enterActionStarted = false;
            
            // Handle interactive batting swing press
            if (this.game.gameState.mode === GAME_CONSTANTS.MODES.INTERACTIVE_BATTING) {
                if (this.handleInteractiveBattingKeyDown()) {
                    this.enterActionStarted = true;
                }
            }
            // No long-press to pause - pause is only available via menu buttons
        }
    }
    
    handleInteractiveBattingKeyDown() {
        const gameState = this.game.gameState;
        const ib = gameState.interactiveBatting;
        
        // Only respond if waiting for swing and not already swinging
        if (ib.active && ib.waitingForSwing && !ib.swingPressed && !ib.isSwinging) {
            return this.game.gameLogic.onSwingStart();
        }
        return false;
    }

    checkBackwardScanDuringHold() {
        // Only check if spacebar is still held and we're in a menu mode
        if (!this.game.gameState.spaceHeld) {
            return;
        }

        const holdDuration = Date.now() - this.game.gameState.spaceHoldStart;
        
        if (holdDuration >= 3000 && !this.backwardScanInterval) {
            // Start backward scanning after 3 seconds
            this.startBackwardScan();
            return;
        }

        // Continue checking if still holding and haven't started backward scan yet
        if (!this.backwardScanInterval) {
            requestAnimationFrame(() => this.checkBackwardScanDuringHold());
        }
    }

    startBackwardScan() {
        const menuModes = [
            GAME_CONSTANTS.MODES.MAIN_MENU, 
            GAME_CONSTANTS.MODES.PLAY_MENU, 
            GAME_CONSTANTS.MODES.SETTINGS_MENU, 
            GAME_CONSTANTS.MODES.RESET_CONFIRMATION,
            GAME_CONSTANTS.MODES.COLOR_SELECT,
            GAME_CONSTANTS.MODES.BATTING,
            GAME_CONSTANTS.MODES.PITCHING,
            GAME_CONSTANTS.MODES.PAUSE_MENU
        ];
        
        // Don't allow backward scan in interactive batting mode
        if (this.game.gameState.mode === GAME_CONSTANTS.MODES.INTERACTIVE_BATTING) {
            return;
        }
        
        if (!menuModes.includes(this.game.gameState.mode)) {
            return;
        }

        // Perform first backward scan immediately
        this.performBackwardScan();
        
        // Set up interval for continued backward scanning
        const scanInterval = window.NarbeScanManager ? window.NarbeScanManager.getScanInterval() : 2000;
        this.backwardScanInterval = setInterval(() => {
            if (this.game.gameState.spaceHeld) {
                this.performBackwardScan();
            } else {
                this.stopBackwardScan();
            }
        }, scanInterval);
    }

    performBackwardScan() {
        const mode = this.game.gameState.mode;
        
        // Play scan sound
        this.game.audioSystem.playSound('scan');
        
        if (mode === GAME_CONSTANTS.MODES.MAIN_MENU) {
            this.handleMainMenuBackwardScan();
        } else if (mode === GAME_CONSTANTS.MODES.PLAY_MENU) {
            this.handlePlayMenuBackwardScan();
        } else if (mode === GAME_CONSTANTS.MODES.SETTINGS_MENU) {
            this.handleSettingsMenuBackwardScan();
        } else if (mode === GAME_CONSTANTS.MODES.RESET_CONFIRMATION) {
            this.handleResetConfirmationBackwardScan();
        } else if (mode === GAME_CONSTANTS.MODES.COLOR_SELECT) {
            this.handleColorSelectBackwardScan();
        } else if (mode === GAME_CONSTANTS.MODES.BATTING) {
            this.handleBattingBackwardScan();
        } else if (mode === GAME_CONSTANTS.MODES.PITCHING) {
            this.handlePitchingBackwardScan();
        } else if (mode === GAME_CONSTANTS.MODES.PAUSE_MENU) {
            this.handlePauseMenuBackwardScan();
        }
    }

    stopBackwardScan() {
        if (this.backwardScanInterval) {
            clearInterval(this.backwardScanInterval);
            this.backwardScanInterval = null;
        }
    }

    handleKeyUp(e) {
        this.keyStates[e.key] = false;

        // Ensure auto scan resumes after interaction
        this.startAutoScan();

        if (e.key === ' ') {
            e.preventDefault();
            this.game.gameState.spaceHeld = false;
            
            // Check if we were in backward scan mode
            const wasBackwardScanning = this.backwardScanInterval !== null;
            
            // Stop backward scanning when spacebar is released
            this.stopBackwardScan();
            
            // Only handle normal space release if we weren't in backward scan mode
            if (!wasBackwardScanning) {
                this.handleSpaceRelease();
            }
            // If we were backward scanning, do nothing - just stay on current selection
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            this.game.gameState.returnHeld = false;
            // Note: returnHoldStart is reset in handleEnterRelease for accurate duration calculation
            this.handleEnterRelease();
        }
    }

    handleSpaceRelease() {
        // Unlock audio on first interaction
        this.game.audioSystem.unlockAudio();
        
        // Block all inputs during play execution
        if (this.game.gameState.playInProgress || this.game.gameState.inputsBlocked) {
            return;
        }
        
        const now = Date.now();
        if (now - this.game.gameState.lastSpaceScan < GAME_CONSTANTS.TIMING.SPACE_SCAN_DELAY) return;
        
        this.game.gameState.lastSpaceScan = now;
        this.game.audioSystem.playSound('scan');
        
        this.executeScan();

        // Reset auto scan on manual scan
        this.restartAutoScan();
    }

    executeScan() {
        const mode = this.game.gameState.mode;

        if (mode === GAME_CONSTANTS.MODES.PAUSE_MENU) {
            this.handlePauseMenuScan();
        } else if (mode === GAME_CONSTANTS.MODES.MAIN_MENU) {
            this.handleMainMenuScan();
        } else if (mode === GAME_CONSTANTS.MODES.PLAY_MENU) {
            this.handlePlayMenuScan();
        } else if (mode === GAME_CONSTANTS.MODES.SETTINGS_MENU) {
            this.handleSettingsMenuScan();
        } else if (mode === GAME_CONSTANTS.MODES.RESET_CONFIRMATION) {
            this.handleResetConfirmationScan();
        } else if (mode === GAME_CONSTANTS.MODES.COLOR_SELECT) {
            this.handleColorSelectScan();
        } else if (mode === GAME_CONSTANTS.MODES.BATTING) {
            this.handleBattingScan();
        } else if (mode === GAME_CONSTANTS.MODES.PITCHING) {
            this.handlePitchingScan();
        } else if (mode === GAME_CONSTANTS.MODES.GAMEPLAY) {
            this.handleGameplayScan();
        }
    }

    handleMainMenuScan() {
        const gameState = this.game.gameState;
        gameState.selectedIndex = (gameState.selectedIndex + 1) % gameState.menuOptions.length;
        this.game.menuSystem.drawMainMenu();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handlePlayMenuScan() {
        const gameState = this.game.gameState;
        gameState.selectedIndex = (gameState.selectedIndex + 1) % gameState.menuOptions.length;
        this.game.menuSystem.drawPlayMenu();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handleSettingsMenuScan() {
        const gameState = this.game.gameState;
        gameState.selectedIndex = (gameState.selectedIndex + 1) % gameState.menuOptions.length;
        this.game.menuSystem.drawSettingsMenu();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handleResetConfirmationScan() {
        const gameState = this.game.gameState;
        gameState.selectedIndex = (gameState.selectedIndex + 1) % gameState.menuOptions.length;
        this.game.menuSystem.drawResetConfirmation();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handleColorSelectScan() {
        const gameState = this.game.gameState;
        gameState.selectedIndex = (gameState.selectedIndex + 1) % 2;
        
        this.game.menuSystem.drawColorSelectMenu();
        
        if (gameState.selectedIndex === 0) {
            this.game.audioSystem.speak(`Team color selector. Current: ${GAME_CONSTANTS.COLOR_OPTIONS[gameState.currentColorIndex].name}`);
        } else {
            this.game.audioSystem.speak('Play Ball button');
        }
    }

    handleBattingScan() {
        const gameState = this.game.gameState;
        if (gameState.selectedIndex === -1) {
            gameState.selectedIndex = 0;
        } else {
            gameState.selectedIndex = (gameState.selectedIndex + 1) % gameState.menuOptions.length;
        }
        gameState.hasScanned = true;
        gameState.menuReady = true;
        this.game.menuSystem.drawStealMenu();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handlePitchingScan() {
        const gameState = this.game.gameState;
        
        // Handle 5-zone pitch selector navigation
        if (gameState.pitchGrid) {
            // Don't scan if spacebar was held BEFORE this pitch grid was generated
            // This prevents scanning on old grid when holding space during menu transition
            if (gameState.pitchGridTimestamp && gameState.spaceHoldStart && 
                gameState.spaceHoldStart < gameState.pitchGridTimestamp) {
                return; // Ignore this scan - space was held before menu appeared
            }
            
            gameState.hasScanned = true;
            gameState.menuReady = true;
            
            // Scan through 5 zones (0-4) then pause (5)
            // Order: Top(0), Right(1), Bottom(2), Left(3), Center(4), Pause(5)
            if (gameState.pitchZoneIndex === -1) {
                // First scan - start at top (0)
                gameState.pitchZoneIndex = 0;
            } else if (gameState.pitchZoneIndex >= 5) {
                // Currently on pause, wrap to top
                gameState.pitchZoneIndex = 0;
            } else {
                gameState.pitchZoneIndex++;
            }
            
            this.game.menuSystem.drawPitchGridMenu();
            
            // Announce current selection
            if (gameState.pitchZoneIndex === 5) {
                this.game.audioSystem.speak('Pause');
            } else {
                const cell = gameState.pitchGrid[gameState.pitchZoneIndex];
                // Check if this is the best pitch (effectiveness = 1.0)
                if (cell.effectiveness >= 0.95) {
                    this.game.audioSystem.speak(`Best pitch! ${cell.pitch}, ${cell.zone}`);
                } else {
                    this.game.audioSystem.speak(`${cell.pitch}, ${cell.zone}`);
                }
            }
            return;
        }
        
        // Legacy menu fallback
        if (gameState.selectedIndex === -1) {
            gameState.selectedIndex = 0;
        } else {
            gameState.selectedIndex = (gameState.selectedIndex + 1) % gameState.menuOptions.length;
        }
        gameState.hasScanned = true;
        gameState.menuReady = true;
        this.game.menuSystem.drawPitchMenu();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handleGameplayScan() {
        // Scan through field players and announce their positions
        const fieldPlayers = this.game.fieldRenderer.fieldPlayers;
        if (!fieldPlayers || fieldPlayers.length === 0) return;
        
        this.selectedPlayerIndex = (this.selectedPlayerIndex + 1) % fieldPlayers.length;
        const selectedPlayer = fieldPlayers[this.selectedPlayerIndex];
        
        if (selectedPlayer && selectedPlayer.position) {
            // The AudioSystem will automatically convert position abbreviations to full names
            this.game.audioSystem.speak(selectedPlayer.position);
        }
    }

    handlePauseMenuScan() {
        const gameState = this.game.gameState;
        gameState.selectedIndex = (gameState.selectedIndex + 1) % gameState.menuOptions.length;
        
        // Check which pause menu is currently visible
        const pauseMenu = document.getElementById('pauseMenu');
        const pauseSettingsMenu = document.getElementById('pauseSettingsMenu');
        const resetSeasonConfirmation = document.getElementById('resetSeasonConfirmation');
        
        if (pauseMenu.style.display !== 'none') {
            // Main pause menu
            this.game.highlightPauseButton(gameState.selectedIndex);
        } else if (resetSeasonConfirmation.style.display !== 'none') {
            // Reset confirmation dialog
            this.game.highlightResetConfirmationButton(gameState.selectedIndex);
        } else {
            // Settings menu
            this.game.highlightPauseSettingsButton(gameState.selectedIndex);
        }
        
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handleMainMenuBackwardScan() {
        const gameState = this.game.gameState;
        gameState.selectedIndex = gameState.selectedIndex <= 0 ? 
            gameState.menuOptions.length - 1 : 
            gameState.selectedIndex - 1;
        this.game.menuSystem.drawMainMenu();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handlePlayMenuBackwardScan() {
        const gameState = this.game.gameState;
        gameState.selectedIndex = gameState.selectedIndex <= 0 ? 
            gameState.menuOptions.length - 1 : 
            gameState.selectedIndex - 1;
        this.game.menuSystem.drawPlayMenu();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handleSettingsMenuBackwardScan() {
        const gameState = this.game.gameState;
        gameState.selectedIndex = gameState.selectedIndex <= 0 ? 
            gameState.menuOptions.length - 1 : 
            gameState.selectedIndex - 1;
        this.game.menuSystem.drawSettingsMenu();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handleResetConfirmationBackwardScan() {
        const gameState = this.game.gameState;
        gameState.selectedIndex = gameState.selectedIndex <= 0 ? 
            gameState.menuOptions.length - 1 : 
            gameState.selectedIndex - 1;
        this.game.menuSystem.drawResetConfirmation();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handleColorSelectBackwardScan() {
        const gameState = this.game.gameState;
        gameState.selectedIndex = gameState.selectedIndex <= 0 ? 1 : 0;
        
        this.game.menuSystem.drawColorSelectMenu();
        
        if (gameState.selectedIndex === 0) {
            this.game.audioSystem.speak(`Team color selector. Current: ${GAME_CONSTANTS.COLOR_OPTIONS[gameState.currentColorIndex].name}`);
        } else {
            this.game.audioSystem.speak('Play Ball button');
        }
    }

    handleBattingBackwardScan() {
        const gameState = this.game.gameState;
        if (gameState.selectedIndex <= 0) {
            gameState.selectedIndex = gameState.menuOptions.length - 1;
        } else {
            gameState.selectedIndex--;
        }
        gameState.hasScanned = true;
        gameState.menuReady = true;
        this.game.menuSystem.drawStealMenu();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handlePitchingBackwardScan() {
        const gameState = this.game.gameState;
        
        // Handle 5-zone pitch selector backward navigation
        if (gameState.pitchGrid) {
            // Don't scan if spacebar was held BEFORE this pitch grid was generated
            if (gameState.pitchGridTimestamp && gameState.spaceHoldStart && 
                gameState.spaceHoldStart < gameState.pitchGridTimestamp) {
                return; // Ignore this scan - space was held before menu appeared
            }
            
            gameState.hasScanned = true;
            gameState.menuReady = true;
            
            // Scan backwards: Pause(5), Center(4), Left(3), Bottom(2), Right(1), Top(0)
            if (gameState.pitchZoneIndex === -1) {
                // First scan - start at pause
                gameState.pitchZoneIndex = 5;
            } else if (gameState.pitchZoneIndex === 0) {
                // At top, wrap to pause
                gameState.pitchZoneIndex = 5;
            } else {
                gameState.pitchZoneIndex--;
            }
            
            this.game.menuSystem.drawPitchGridMenu();
            
            // Announce current selection
            if (gameState.pitchZoneIndex === 5) {
                this.game.audioSystem.speak('Pause');
            } else {
                const cell = gameState.pitchGrid[gameState.pitchZoneIndex];
                // Check if this is the best pitch (effectiveness = 1.0)
                if (cell.effectiveness >= 0.95) {
                    this.game.audioSystem.speak(`Best pitch! ${cell.pitch}, ${cell.zone}`);
                } else {
                    this.game.audioSystem.speak(`${cell.pitch}, ${cell.zone}`);
                }
            }
            return;
        }
        
        // Legacy menu fallback
        if (gameState.selectedIndex <= 0) {
            gameState.selectedIndex = gameState.menuOptions.length - 1;
        } else {
            gameState.selectedIndex--;
        }
        gameState.hasScanned = true;
        gameState.menuReady = true;
        this.game.menuSystem.drawPitchMenu();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handlePauseMenuBackwardScan() {
        const gameState = this.game.gameState;
        gameState.selectedIndex = gameState.selectedIndex <= 0 ? 
            gameState.menuOptions.length - 1 : 
            gameState.selectedIndex - 1;
        
        // Check which pause menu is currently visible
        const pauseMenu = document.getElementById('pauseMenu');
        const pauseSettingsMenu = document.getElementById('pauseSettingsMenu');
        const resetSeasonConfirmation = document.getElementById('resetSeasonConfirmation');
        
        if (pauseMenu.style.display !== 'none') {
            // Main pause menu
            this.game.highlightPauseButton(gameState.selectedIndex);
        } else if (resetSeasonConfirmation.style.display !== 'none') {
            // Reset confirmation dialog
            this.game.highlightResetConfirmationButton(gameState.selectedIndex);
        } else {
            // Settings menu
            this.game.highlightPauseSettingsButton(gameState.selectedIndex);
        }
        
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handleEnterRelease() {
        // Unlock audio on first interaction
        this.game.audioSystem.unlockAudio();
        
        // Reset the hold start time
        this.game.gameState.returnHoldStart = 0;
        
        // Handle interactive batting swing release FIRST
        if (this.game.gameState.mode === GAME_CONSTANTS.MODES.INTERACTIVE_BATTING) {
            const ib = this.game.gameState.interactiveBatting;
            
            // If player was pressing swing button, release it
            if (ib.swingPressed) {
                this.game.gameLogic.onSwingRelease();
                return;
            }
        }
        
        // Block all inputs during play execution
        if (this.game.gameState.playInProgress || this.game.gameState.inputsBlocked) {
            return;
        }
        
        const now = Date.now();
        
        // Check for action cooldown
        if (now - this.game.gameState.lastActionTime < GAME_CONSTANTS.TIMING.ACTION_COOLDOWN) {
            return;
        }
        
        // Menu navigation - handle pause menu selection
        if (this.game.gameState.mode === GAME_CONSTANTS.MODES.PAUSE_MENU) {
            const selectedOption = this.game.gameState.menuOptions[this.game.gameState.selectedIndex];
            this.game.gameState.lastActionTime = now;
            this.game.audioSystem.playSound('select');
            
            // Check which pause menu is currently visible
            const pauseMenu = document.getElementById('pauseMenu');
            const pauseSettingsMenu = document.getElementById('pauseSettingsMenu');
            const resetSeasonConfirmation = document.getElementById('resetSeasonConfirmation');
            
            if (pauseMenu.style.display !== 'none') {
                // Main pause menu - trigger the appropriate button click
                const buttons = document.querySelectorAll('#pauseMenu button');
                if (buttons[this.game.gameState.selectedIndex]) {
                    buttons[this.game.gameState.selectedIndex].click();
                }
            } else if (resetSeasonConfirmation.style.display !== 'none') {
                // Reset confirmation dialog - trigger the appropriate button click
                const confirmButtons = document.querySelectorAll('#resetSeasonConfirmation button');
                if (confirmButtons[this.game.gameState.selectedIndex]) {
                    confirmButtons[this.game.gameState.selectedIndex].click();
                }
            } else {
                // Settings menu - trigger the appropriate settings button click
                const settingsButtons = document.querySelectorAll('#pauseSettingsMenu button');
                if (settingsButtons[this.game.gameState.selectedIndex]) {
                    settingsButtons[this.game.gameState.selectedIndex].click();
                }
            }
            return;
        }
        
        // Menu navigation for other menus
        const menuModes = [GAME_CONSTANTS.MODES.MAIN_MENU, GAME_CONSTANTS.MODES.PLAY_MENU, GAME_CONSTANTS.MODES.SETTINGS_MENU, GAME_CONSTANTS.MODES.RESET_CONFIRMATION, GAME_CONSTANTS.MODES.COLOR_SELECT];
        if (menuModes.includes(this.game.gameState.mode)) {
            this.game.gameState.lastActionTime = now;
            this.game.audioSystem.playSound('select');
            this.game.menuSystem.handleMenuSelection();
            return;
        }
        
        // Batting/Pitching selection (for steal menu in BATTING mode)
        if (this.game.gameState.mode === GAME_CONSTANTS.MODES.BATTING || this.game.gameState.mode === GAME_CONSTANTS.MODES.PITCHING) {
            if (!this.validateGameplayInput()) return;
            
            // Lock inputs immediately
            this.game.gameState.playInProgress = true;
            this.game.gameState.inputsBlocked = true;
            this.game.gameState.lastActionTime = now;
            this.game.audioSystem.playSound('select');
            
            if (this.game.gameState.mode === GAME_CONSTANTS.MODES.BATTING) {
                // Steal/Bat menu selection
                this.game.gameLogic.processStealOrBat(this.game.gameState.selectedIndex);
            } else {
                // 5-zone pitch selector
                if (this.game.gameState.pitchGrid) {
                    // Check if pause is selected (index 5)
                    if (this.game.gameState.pitchZoneIndex === 5) {
                        this.game.gameLogic.processPitchSelection(-1); // -1 means pause
                    } else {
                        this.game.gameLogic.processPitchSelection(0); // Zone selection (actual pitch from grid)
                    }
                } else {
                    this.game.gameLogic.processPitchSelection(this.game.gameState.selectedIndex);
                }
            }
        }
    }

    validateGameplayInput() {
        const gameState = this.game.gameState;
        
        // For pitch grid, we don't need the traditional selectedIndex validation
        if (gameState.mode === GAME_CONSTANTS.MODES.PITCHING && gameState.pitchGrid) {
            // Must have scanned at least once
            if (!gameState.hasScanned) {
                this.game.audioSystem.speak('Press space to scan options first.');
                return false;
            }
            
            // Must be in ready state
            if (!gameState.menuReady) {
                this.game.audioSystem.speak('Please wait for menu to be ready.');
                return false;
            }
            
            // Must not be animating
            if (gameState.animating) {
                this.game.audioSystem.speak('Please wait for current action to complete.');
                return false;
            }
            
            return true;
        }
        
        // Must have a valid selection
        if (gameState.selectedIndex === -1) {
            this.game.audioSystem.speak('No option selected. Press space to scan options first.');
            return false;
        }
        
        // Must have scanned at least once
        if (!gameState.hasScanned) {
            this.game.audioSystem.speak('Press space to scan options first.');
            return false;
        }
        
        // Must be in ready state
        if (!gameState.menuReady) {
            this.game.audioSystem.speak('Please wait for menu to be ready.');
            return false;
        }
        
        // Must not be animating
        if (gameState.animating) {
            this.game.audioSystem.speak('Please wait for current action to complete.');
            return false;
        }
        
        return true;
    }

    handleCanvasClick(e) {
        // Block all inputs during play execution
        if (this.game.gameState.playInProgress || this.game.gameState.inputsBlocked) return;
        
        // Unlock audio on first interaction
        this.game.audioSystem.unlockAudio();

        const rect = this.game.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const gameState = this.game.gameState;
        const mode = gameState.mode;
        
        // Handle pitch grid click (5-zone system)
        if (mode === GAME_CONSTANTS.MODES.PITCHING && gameState.pitchGrid && gameState.pitchZoneBounds) {
            // Check center zone first (it overlaps with corners)
            for (let i = gameState.pitchZoneBounds.length - 1; i >= 0; i--) {
                const b = gameState.pitchZoneBounds[i];
                if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
                    gameState.pitchZoneIndex = b.zoneIndex;
                    gameState.hasScanned = true;
                    gameState.menuReady = true;
                    
                    const cell = gameState.pitchGrid[b.zoneIndex];
                    this.game.audioSystem.speak(`${cell.pitch}, ${cell.zone}`);
                    this.game.audioSystem.playSound('select');
                    
                    // Lock inputs and process
                    gameState.playInProgress = true;
                    gameState.inputsBlocked = true;
                    gameState.lastActionTime = Date.now();
                    
                    this.game.gameLogic.processPitchSelection(b.zoneIndex);
                    return;
                }
            }
            
            // Check pause button
            if (gameState.pauseButtonBounds) {
                const pb = gameState.pauseButtonBounds;
                if (x >= pb.x && x <= pb.x + pb.width && y >= pb.y && y <= pb.y + pb.height) {
                    gameState.pitchZoneIndex = 5;
                    this.game.audioSystem.speak('Pause');
                    this.game.audioSystem.playSound('select');
                    this.game.gameLogic.processPitchSelection(-1);
                    return;
                }
            }
        }

        if (this.game.gameState.menuBounds.length === 0) return;

        // Which option was clicked?
        for (let i = 0; i < this.game.gameState.menuBounds.length; i++) {
            const b = this.game.gameState.menuBounds[i];
            if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
                this.game.gameState.selectedIndex = i;
                this.game.audioSystem.playSound('select');

                if (mode === GAME_CONSTANTS.MODES.BATTING || mode === GAME_CONSTANTS.MODES.PITCHING) {
                    // Set the necessary flags for clicks (don't require scanning)
                    this.game.gameState.hasScanned = true;
                    this.game.gameState.menuReady = true;
                    
                    // Speak the selected option
                    this.game.audioSystem.speak(this.game.gameState.menuOptions[i]);
                    
                    // Use the same validation as Enter but without scan requirement
                    if (this.game.gameState.animating) {
                        this.game.audioSystem.speak('Please wait for current action to complete.');
                        return;
                    }

                    // Lock inputs immediately like Enter does
                    this.game.gameState.playInProgress = true;
                    this.game.gameState.inputsBlocked = true;
                    this.game.gameState.lastActionTime = Date.now();

                    try {
                        if (mode === GAME_CONSTANTS.MODES.BATTING) {
                            // Steal/Bat menu selection
                            this.game.gameLogic.processStealOrBat(this.game.gameState.selectedIndex);
                        } else {
                            this.game.gameLogic.processPitchSelection(this.game.gameState.selectedIndex);
                        }
                    } catch (error) {
                        console.error('Gameplay selection error:', error);
                        this.game.audioSystem.speak('Oops, something went wrong');
                        // Force unlock as safety net
                        setTimeout(() => {
                            this.game.gameState.playInProgress = false;
                            this.game.gameState.inputsBlocked = false;
                        }, 1000);
                    }
                } else {
                    // In menus, go through the menu system as before
                    this.game.menuSystem.handleMenuSelection();
                }
                break;
            }
        }
    }

    handleTouch(e) {
        e.preventDefault();
        const t = e.touches[0];
        if (!t) return;
        // Synthesize a click so we keep logic in one place
        this.handleCanvasClick({ clientX: t.clientX, clientY: t.clientY });
    }
}