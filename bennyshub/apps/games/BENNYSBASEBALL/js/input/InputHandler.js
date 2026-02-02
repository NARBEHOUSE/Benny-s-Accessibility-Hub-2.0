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
        this.game.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.game.canvas.addEventListener('touchstart', (e) => this.handleTouch(e));
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
            
            // Start checking for pause menu during hold
            this.checkPauseMenuDuringHold();
        }
    }

    checkPauseMenuDuringHold() {
        // Only check if we're in a gameplay mode and return is still held
        if (!this.game.gameState.returnHeld || 
            ![GAME_CONSTANTS.MODES.GAMEPLAY, GAME_CONSTANTS.MODES.BATTING, GAME_CONSTANTS.MODES.PITCHING].includes(this.game.gameState.mode)) {
            return;
        }

        const holdDuration = Date.now() - this.game.gameState.returnHoldStart;
        
        if (holdDuration >= GAME_CONSTANTS.TIMING.HOLD_DURATION_FOR_PAUSE) {
            // Show pause menu immediately when 3 seconds is reached
            this.game.showPauseMenu();
            return;
        }

        // Continue checking if still holding
        requestAnimationFrame(() => this.checkPauseMenuDuringHold());
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
        this.game.menuSystem.drawSwingMenu();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handlePitchingScan() {
        const gameState = this.game.gameState;
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
        this.game.menuSystem.drawSwingMenu();
        this.game.audioSystem.speak(gameState.menuOptions[gameState.selectedIndex]);
    }

    handlePitchingBackwardScan() {
        const gameState = this.game.gameState;
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
        
        const now = Date.now();
        const holdDuration = now - this.game.gameState.returnHoldStart;
        
        // Check for long press to open pause menu FIRST and ONLY if held for 3+ seconds
        if (holdDuration >= GAME_CONSTANTS.TIMING.HOLD_DURATION_FOR_PAUSE && 
            [GAME_CONSTANTS.MODES.GAMEPLAY, GAME_CONSTANTS.MODES.BATTING, GAME_CONSTANTS.MODES.PITCHING].includes(this.game.gameState.mode)) {
            this.game.showPauseMenu();
            return; // Exit immediately, don't process any other actions
        }
        
        // Block all inputs during play execution
        if (this.game.gameState.playInProgress || this.game.gameState.inputsBlocked) {
            return;
        }
        
        // Check for action cooldown (only for short presses)
        if (now - this.game.gameState.lastActionTime < GAME_CONSTANTS.TIMING.ACTION_COOLDOWN) {
            return;
        }
        
        // Only process menu selections and gameplay if it was a SHORT press (less than 3 seconds)
        if (holdDuration < GAME_CONSTANTS.TIMING.HOLD_DURATION_FOR_PAUSE) {
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
            
            // Batting/Pitching selection
            if (this.game.gameState.mode === GAME_CONSTANTS.MODES.BATTING || this.game.gameState.mode === GAME_CONSTANTS.MODES.PITCHING) {
                if (!this.validateGameplayInput()) return;
                
                // Lock inputs immediately
                this.game.gameState.playInProgress = true;
                this.game.gameState.inputsBlocked = true;
                this.game.gameState.lastActionTime = now;
                this.game.audioSystem.playSound('select');
                
                if (this.game.gameState.mode === GAME_CONSTANTS.MODES.BATTING) {
                    this.game.gameLogic.processBattingSelection(this.game.gameState.selectedIndex);
                } else {
                    this.game.gameLogic.processPitchSelection(this.game.gameState.selectedIndex);
                }
            }
        }
        // If holdDuration >= 3 seconds, we already handled the pause menu above, so do nothing else
    }

    validateGameplayInput() {
        const gameState = this.game.gameState;
        
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

        if (this.game.gameState.menuBounds.length === 0) return;

        // Which option was clicked?
        for (let i = 0; i < this.game.gameState.menuBounds.length; i++) {
            const b = this.game.gameState.menuBounds[i];
            if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
                this.game.gameState.selectedIndex = i;
                this.game.audioSystem.playSound('select');

                const mode = this.game.gameState.mode;

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
                            this.game.gameLogic.processBattingSelection(this.game.gameState.selectedIndex);
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