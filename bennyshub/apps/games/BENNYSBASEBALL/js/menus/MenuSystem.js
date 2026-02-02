class MenuSystem {
    constructor(game) {
        this.game = game;
    }

    drawMainMenu() {
        const ctx = this.game.ctx;
        const canvas = this.game.canvas;
        const gameState = this.game.gameState;

        // Modern gradient background
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#000428');
        gradient.addColorStop(1, '#004e92');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        this.game.fieldRenderer.drawField(gameState);
        
        // Title with modern effects
        ctx.font = 'bold 60px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = 30;
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 4;
        ctx.strokeText("BENNY'S BASEBALL", canvas.width / 2, 100);
        ctx.fillText("BENNY'S BASEBALL", canvas.width / 2, 100);
        
        this.drawMenuPanel(gameState.menuOptions, gameState.selectedIndex);
    }

    drawPlayMenu() {
        const ctx = this.game.ctx;
        const canvas = this.game.canvas;
        const gameState = this.game.gameState;

        ctx.fillStyle = '#000428';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        this.game.fieldRenderer.drawField(gameState);
        
        // Title
        ctx.font = 'bold 48px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#4a9eff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText("CHOOSE GAME MODE", canvas.width / 2, 120);
        ctx.fillText("CHOOSE GAME MODE", canvas.width / 2, 120);
        
        this.drawMenuPanel(gameState.menuOptions, gameState.selectedIndex, 28);
    }

    drawSettingsMenu() {
        const ctx = this.game.ctx;
        const canvas = this.game.canvas;
        const gameState = this.game.gameState;

        ctx.fillStyle = '#000428';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        this.game.fieldRenderer.drawField(gameState);
        
        // Title
        ctx.font = 'bold 48px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#4a9eff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText("SETTINGS", canvas.width / 2, 100);
        ctx.fillText("SETTINGS", canvas.width / 2, 100);
        
        this.drawMenuPanel(gameState.menuOptions, gameState.selectedIndex, 22);
    }

    drawColorSelectMenu() {
        const ctx = this.game.ctx;
        const canvas = this.game.canvas;
        const gameState = this.game.gameState;

        // Modern gradient background
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#000428');
        gradient.addColorStop(1, '#004e92');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        this.game.fieldRenderer.drawField(gameState);
        
        // Title
        ctx.font = 'bold 36px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#4a9eff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText("CHOOSE TEAM COLOR", canvas.width / 2, 120);
        ctx.fillText("CHOOSE TEAM COLOR", canvas.width / 2, 120);
        
        this.drawColorSelector();
    }

    drawColorSelector() {
        const ctx = this.game.ctx;
        const canvas = this.game.canvas;
        const gameState = this.game.gameState;

        const padding = 20;
        const itemHeight = 60;
        const menuWidth = 400;
        const menuHeight = 2 * itemHeight + padding * 2;
        const menuX = canvas.width / 2 - menuWidth / 2;
        const menuY = Math.max(200, Math.min(
            canvas.height / 2 - menuHeight / 2,
            canvas.height - menuHeight - padding
        ));

        gameState.menuBounds = [];

        // Menu background
        const menuGradient = ctx.createLinearGradient(menuX, menuY, menuX, menuY + menuHeight);
        menuGradient.addColorStop(0, GAME_CONSTANTS.COLORS.menuBg);
        menuGradient.addColorStop(1, 'rgba(10, 15, 30, 0.95)');
        ctx.fillStyle = menuGradient;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 20;
        ctx.fillRect(menuX, menuY, menuWidth, menuHeight);
        ctx.shadowBlur = 0;

        ctx.strokeStyle = GAME_CONSTANTS.COLORS.menuBorder;
        ctx.lineWidth = 3;
        ctx.strokeRect(menuX, menuY, menuWidth, menuHeight);

        // Color selector
        const colorItemY = menuY + padding;
        const isColorSelected = gameState.selectedIndex === 0;
        
        gameState.menuBounds.push({
            x: menuX,
            y: colorItemY,
            width: menuWidth,
            height: itemHeight
        });
        
        if (isColorSelected) {
            this.drawSelectionHighlight(menuX + 5, colorItemY + 5, menuWidth - 10, itemHeight - 10);
        }
        
        // Color display
        const currentColor = GAME_CONSTANTS.COLOR_OPTIONS[gameState.currentColorIndex || 0];
        const colorBoxSize = 30;
        const colorBoxX = menuX + 30;
        const colorBoxY = colorItemY + (itemHeight - colorBoxSize) / 2;
        
        ctx.fillStyle = currentColor.color;
        ctx.fillRect(colorBoxX, colorBoxY, colorBoxSize, colorBoxSize);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(colorBoxX, colorBoxY, colorBoxSize, colorBoxSize);
        
        ctx.font = 'bold 24px monospace';
        ctx.fillStyle = isColorSelected ? GAME_CONSTANTS.COLORS.menuSelected : GAME_CONSTANTS.COLORS.menuText;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const colorText = isColorSelected ? `▶ TEAM COLOR: ${currentColor.name}` : `  TEAM COLOR: ${currentColor.name}`;
        ctx.fillText(colorText, colorBoxX + colorBoxSize + 20, colorItemY + itemHeight / 2);

        // Play Ball button
        const playButtonY = menuY + padding + itemHeight;
        const isPlaySelected = gameState.selectedIndex === 1;
        
        gameState.menuBounds.push({
            x: menuX,
            y: playButtonY,
            width: menuWidth,
            height: itemHeight
        });
        
        if (isPlaySelected) {
            this.drawSelectionHighlight(menuX + 5, playButtonY + 5, menuWidth - 10, itemHeight - 10);
        }
        
        ctx.font = 'bold 28px monospace';
        ctx.fillStyle = isPlaySelected ? GAME_CONSTANTS.COLORS.menuSelected : GAME_CONSTANTS.COLORS.menuText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const playText = isPlaySelected ? `▶ PLAY BALL!` : `PLAY BALL!`;
        ctx.fillText(playText, menuX + menuWidth / 2, playButtonY + itemHeight / 2);
    }

    drawSwingMenu() {
        this.game.fieldRenderer.drawField(this.game.gameState);
        this.game.fieldRenderer.drawPlayers();
        this.game.uiRenderer.drawScoreboard(this.game.gameState);
        
        this.drawGameMenuPanel(this.game.gameState.menuOptions, this.game.gameState.selectedIndex, "CHOOSE SWING");
    }

    drawPitchMenu() {
        this.game.fieldRenderer.drawField(this.game.gameState);
        this.game.fieldRenderer.drawPlayers();
        this.game.uiRenderer.drawScoreboard(this.game.gameState);
        
        this.drawGameMenuPanel(this.game.gameState.menuOptions, this.game.gameState.selectedIndex, "CHOOSE PITCH");
    }

    drawMenuPanel(options, selectedIndex, fontSize = 24) {
        const ctx = this.game.ctx;
        const canvas = this.game.canvas;

        const padding = 20;
        const itemHeight = fontSize === 22 ? 55 : (fontSize === 28 ? 70 : 60);
        const menuWidth = fontSize === 28 ? 450 : (fontSize === 22 ? 500 : 400);
        const menuHeight = options.length * itemHeight + padding * 2;
        const menuX = canvas.width / 2 - menuWidth / 2;
        const menuY = Math.max(200, Math.min(
            canvas.height / 2 - menuHeight / 2 + (fontSize === 24 ? 50 : 0),
            canvas.height - menuHeight - padding
        ));

        this.game.gameState.menuBounds = [];

        // Menu background
        const menuGradient = ctx.createLinearGradient(menuX, menuY, menuX, menuY + menuHeight);
        menuGradient.addColorStop(0, GAME_CONSTANTS.COLORS.menuBg);
        menuGradient.addColorStop(1, 'rgba(10, 15, 30, 0.95)');
        ctx.fillStyle = menuGradient;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 20;
        ctx.fillRect(menuX, menuY, menuWidth, menuHeight);
        ctx.shadowBlur = 0;

        ctx.strokeStyle = GAME_CONSTANTS.COLORS.menuBorder;
        ctx.lineWidth = 3;
        ctx.strokeRect(menuX, menuY, menuWidth, menuHeight);

        // Menu options
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = 'center';
        
        options.forEach((option, i) => {
            const itemY = menuY + padding + i * itemHeight;
            const isSelected = i === selectedIndex;
            
            this.game.gameState.menuBounds.push({
                x: menuX,
                y: itemY,
                width: menuWidth,
                height: itemHeight
            });
            
            if (isSelected) {
                this.drawSelectionHighlight(menuX + 5, itemY + 5, menuWidth - 10, itemHeight - 10);
            }
            
            ctx.fillStyle = isSelected ? GAME_CONSTANTS.COLORS.menuSelected : GAME_CONSTANTS.COLORS.menuText;
            ctx.textBaseline = 'middle';
            ctx.fillText(isSelected ? `▶ ${option}` : option, menuX + menuWidth / 2, itemY + itemHeight / 2);
        });
    }

    drawGameMenuPanel(options, selectedIndex, title) {
        const ctx = this.game.ctx;
        const canvas = this.game.canvas;
        const gameState = this.game.gameState;

        const padding = 20;
        const itemHeight = 50;
        const menuWidth = 280;
        const menuHeight = options.length * itemHeight + padding * 2;
        const menuX = 30;
        const menuY = Math.max(padding, Math.min(
            canvas.height / 2 - menuHeight / 2,
            canvas.height - menuHeight - padding
        ));

        gameState.menuBounds = [];

        // Menu background
        const gradient = ctx.createLinearGradient(menuX, menuY, menuX, menuY + menuHeight);
        gradient.addColorStop(0, GAME_CONSTANTS.COLORS.menuBg);
        gradient.addColorStop(1, 'rgba(10, 15, 30, 0.95)');
        ctx.fillStyle = gradient;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 20;
        ctx.fillRect(menuX, menuY, menuWidth, menuHeight);
        ctx.shadowBlur = 0;

        ctx.strokeStyle = GAME_CONSTANTS.COLORS.menuBorder;
        ctx.lineWidth = 3;
        ctx.strokeRect(menuX, menuY, menuWidth, menuHeight);

        // Menu title
        if (title) {
            ctx.font = 'bold 20px monospace';
            ctx.fillStyle = GAME_CONSTANTS.COLORS.menuBorder;
            ctx.textAlign = 'center';
            ctx.fillText(title, menuX + menuWidth / 2, menuY - 10);
        }

        ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'left';
        
        options.forEach((option, i) => {
            const itemY = menuY + padding + i * itemHeight;
            const isSelected = i === selectedIndex;
            
            gameState.menuBounds.push({
                x: menuX,
                y: itemY,
                width: menuWidth,
                height: itemHeight
            });
            
            // Check if this is a pitch menu and if the current option is overused
            const isOverusedPitch = title === "CHOOSE PITCH" && 
                                   gameState.lastPitchType === option && 
                                   gameState.samePitchCount > 2;
            
            // Draw overused pitch warning background
            if (isOverusedPitch) {
                const warningGradient = ctx.createLinearGradient(menuX + 5, itemY + 5, menuX + menuWidth - 10, itemY + 5);
                warningGradient.addColorStop(0, 'rgba(255, 0, 0, 0.3)');
                warningGradient.addColorStop(0.5, 'rgba(255, 0, 0, 0.5)');
                warningGradient.addColorStop(1, 'rgba(255, 0, 0, 0.3)');
                ctx.fillStyle = warningGradient;
                ctx.fillRect(menuX + 5, itemY + 5, menuWidth - 10, itemHeight - 10);
                
                // Red border for overused pitch
                ctx.strokeStyle = '#ff0000';
                ctx.lineWidth = 2;
                ctx.strokeRect(menuX + 5, itemY + 5, menuWidth - 10, itemHeight - 10);
            }
            
            if (isSelected) {
                this.drawSelectionHighlight(menuX + 5, itemY + 5, menuWidth - 10, itemHeight - 10);
            }
            
            ctx.fillStyle = isSelected ? GAME_CONSTANTS.COLORS.menuSelected : GAME_CONSTANTS.COLORS.menuText;
            ctx.textBaseline = 'middle';
            
            // Add warning text for overused pitches
            let displayText = isSelected ? `▶ ${option}` : `  ${option}`;
            if (isOverusedPitch) {
                displayText += ' ⚠️';
            }
            
            ctx.fillText(displayText, menuX + 20, itemY + itemHeight / 2);
        });
    }

    drawSelectionHighlight(x, y, width, height) {
        const ctx = this.game.ctx;
        const selGradient = ctx.createLinearGradient(x, y, x + width, y);
        selGradient.addColorStop(0, 'rgba(255, 235, 59, 0.2)');
        selGradient.addColorStop(0.5, 'rgba(255, 235, 59, 0.4)');
        selGradient.addColorStop(1, 'rgba(255, 235, 59, 0.2)');
        ctx.fillStyle = selGradient;
        ctx.fillRect(x, y, width, height);
        
        ctx.strokeStyle = GAME_CONSTANTS.COLORS.menuSelected;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
    }

    handleMenuSelection() {
        const gameState = this.game.gameState;
        const option = gameState.menuOptions[gameState.selectedIndex];
        
        if (gameState.mode === GAME_CONSTANTS.MODES.MAIN_MENU) {
            this.handleMainMenuSelection(option);
        } else if (gameState.mode === GAME_CONSTANTS.MODES.PLAY_MENU) {
            this.handlePlayMenuSelection(option);
        } else if (gameState.mode === GAME_CONSTANTS.MODES.SETTINGS_MENU) {
            this.handleSettingsSelection(option);
        } else if (gameState.mode === GAME_CONSTANTS.MODES.COLOR_SELECT) {
            this.handleColorSelection();
        } else if (gameState.mode === GAME_CONSTANTS.MODES.RESET_CONFIRMATION) {
            this.handleResetConfirmation(option);
        }
    }

    handleMainMenuSelection(option) {
        if (option === 'Play Game') {
            this.showPlayMenu();
        } else if (option.includes('Resume Game')) {
            // Resume the saved game
            this.game.gameLogic.startGameWithSettings('season', this.game.seasonManager.data.teamColor);
        } else if (option.includes('Continue Season')) {
            // Start a new game in the existing season
            this.game.gameLogic.startGameWithSettings('season', this.game.seasonManager.data.teamColor);
        } else if (option === 'Settings') {
            this.showSettingsMenu();
        } else if (option === 'Exit Game') {
            this.exitApp();
        }
    }

    exitApp() {
        try {
            // Try to message parent window to focus the back button
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ action: 'focusBackButton' }, '*');
            } else {
                // Navigate to parent directory (Access-Hub root)
                location.href = '../../../index.html';
            }
        } catch(err) {
            // Fallback: try relative navigation
            try {
                window.location.replace('../../../index.html');
            } catch(_) {
                // Last resort: go up one level
                window.location.href = '..';
            }
        }
    }

    handlePlayMenuSelection(option) {
        if (option === 'Exhibition Mode') {
            this.showColorSelectMenu('exhibition');
        } else if (option === 'Season Mode') {
            this.showColorSelectMenu('season');
        } else if (option.includes('Resume Season')) {
            // Resume existing season - start a new game with the existing season's team color
            this.game.gameLogic.startGameWithSettings('season', this.game.seasonManager.data.teamColor);
        } else if (option === 'Back') {
            this.showMainMenu();
        }
    }

    handleSettingsSelection(option) {
        if (option.includes('Auto Scan:')) {
            if (window.NarbeScanManager) {
                const current = window.NarbeScanManager.getSettings().autoScan;
                window.NarbeScanManager.setAutoScan(!current);
                this.showSettingsMenu(true);
                this.game.audioSystem.speak(window.NarbeScanManager.getSettings().autoScan ? "Auto scan enabled" : "Auto scan disabled");
            }
        } else if (option.includes('Scan Speed:')) {
            if (window.NarbeScanManager) {
                window.NarbeScanManager.cycleScanSpeed();
                const newSpeed = window.NarbeScanManager.getSettings().scanInterval / 1000;
                this.showSettingsMenu(true);
                this.game.audioSystem.speak(`Scan speed ${newSpeed} seconds`);
            }
        } else if (option.includes('Music:')) {
            this.game.audioSystem.settings.musicEnabled = !this.game.audioSystem.settings.musicEnabled;
            this.game.audioSystem.save();
            if (this.game.audioSystem.settings.musicEnabled) {
                this.game.audioSystem.playBackgroundMusic();
            } else {
                this.game.audioSystem.stopMusic();
            }
            this.showSettingsMenu(true);
            this.game.audioSystem.speak(this.game.audioSystem.settings.musicEnabled ? "Music enabled" : "Music disabled");
        } else if (option.includes('Sound Effects:')) {
            this.game.audioSystem.settings.soundEnabled = !this.game.audioSystem.settings.soundEnabled;
            this.game.audioSystem.save();
            this.showSettingsMenu(true);
            this.game.audioSystem.speak(this.game.audioSystem.settings.soundEnabled ? "Sound effects enabled" : "Sound effects disabled");
        } else if (option.includes('Text-to-Speech:')) {
            this.game.audioSystem.settings.ttsEnabled = !this.game.audioSystem.settings.ttsEnabled;
            this.game.audioSystem.save();
            this.showSettingsMenu(true);
            if (this.game.audioSystem.settings.ttsEnabled) {
                this.game.audioSystem.speak("Text to speech enabled");
            }
        } else if (option.includes('Voice:')) {
            // Use voice manager to cycle voices
            if (this.game.audioSystem.voiceManager) {
                this.game.audioSystem.voiceManager.cycleVoice();
                const currentVoice = this.game.audioSystem.voiceManager.getCurrentVoice();
                const voiceName = this.game.audioSystem.voiceManager.getVoiceDisplayName(currentVoice);
                this.showSettingsMenu(true);
                this.game.audioSystem.speak(`Voice changed to ${voiceName}`);
            } else {
                // Fallback to old voice cycling
                const voices = ['default', 'male', 'female'];
                const currentIndex = voices.indexOf(this.game.audioSystem.settings.voiceType);
                this.game.audioSystem.settings.voiceType = voices[(currentIndex + 1) % voices.length];
                this.game.audioSystem.save();
                this.showSettingsMenu(true);
                this.game.audioSystem.speak(`Voice changed to ${this.game.audioSystem.settings.voiceType}`);
            }
        } else if (option === 'Next Track') {
            this.game.audioSystem.nextTrack();
            this.showSettingsMenu(true);
            this.game.audioSystem.speak("Next track");
        } else if (option === 'Reset Season') {
            this.showResetConfirmation();
        } else if (option === 'Back') {
            this.showMainMenu();
        }
    }

    showResetConfirmation() {
        const gameState = this.game.gameState;
        gameState.mode = GAME_CONSTANTS.MODES.RESET_CONFIRMATION;
        gameState.previousMode = GAME_CONSTANTS.MODES.SETTINGS_MENU;
        gameState.menuOptions = ['Confirm', 'Cancel'];
        gameState.selectedIndex = -1;
        
        this.drawResetConfirmation();
        this.game.audioSystem.speak('Are you sure you want to reset the season?');
    }

    drawResetConfirmation() {
        const ctx = this.game.ctx;
        const canvas = this.game.canvas;
        const gameState = this.game.gameState;

        ctx.fillStyle = '#000428';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        this.game.fieldRenderer.drawField(gameState);
        
        // Warning title
        ctx.font = 'bold 48px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ff6666';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText("⚠️ RESET SEASON", canvas.width / 2, 100);
        ctx.fillText("⚠️ RESET SEASON", canvas.width / 2, 100);
        
        // Confirmation message
        ctx.font = 'bold 24px monospace';
        ctx.fillStyle = '#ffffff';
        ctx.fillText("Are you sure you want to reset the season?", canvas.width / 2, 160);
        ctx.fillText("This cannot be undone!", canvas.width / 2, 200);
        
        this.drawMenuPanel(gameState.menuOptions, gameState.selectedIndex, 28);
    }

    handleResetConfirmation(option) {
        if (option === 'Confirm') {
            this.game.seasonManager.reset();
            this.showSettingsMenu();
            this.game.audioSystem.speak("Season reset");
        } else if (option === 'Cancel') {
            this.showSettingsMenu();
            this.game.audioSystem.speak("Cancelled");
        }
    }

    handleColorSelection() {
        const gameState = this.game.gameState;
        if (gameState.selectedIndex === 0) {
            // Color selector - cycle through colors
            gameState.currentColorIndex = (gameState.currentColorIndex + 1) % GAME_CONSTANTS.COLOR_OPTIONS.length;
            const currentColor = GAME_CONSTANTS.COLOR_OPTIONS[gameState.currentColorIndex];
            this.drawColorSelectMenu();
            this.game.audioSystem.speak(currentColor.name);
        } else if (gameState.selectedIndex === 1) {
            // Play Ball button - start the game
            const selectedColor = GAME_CONSTANTS.COLOR_OPTIONS[gameState.currentColorIndex];
            const colorName = selectedColor.name;
            this.game.audioSystem.speak(`Starting game with ${colorName} team`);
            
            if (gameState.gameMode === 'season') {
                this.game.seasonManager.startSeason(colorName);
            }
            
            this.game.gameLogic.startGameWithSettings(gameState.gameMode, colorName);
        }
    }

    showMainMenu() {
        const gameState = this.game.gameState;
        gameState.mode = GAME_CONSTANTS.MODES.MAIN_MENU;
        
        // Reset input blocking flags to ensure menu is interactive
        gameState.inputsBlocked = false;
        gameState.playInProgress = false;
        
        // Simple main menu - no season info here
        gameState.menuOptions = ['Play Game', 'Settings', 'Exit Game'];
        
        gameState.selectedIndex = 0;
        this.game.pauseButton.classList.remove('visible');
        
        this.drawMainMenu();
        this.game.audioSystem.speak("Benny's Baseball Game");
        this.game.audioSystem.playBackgroundMusic();
    }

    showPlayMenu() {
        const gameState = this.game.gameState;
        gameState.mode = GAME_CONSTANTS.MODES.PLAY_MENU;
        gameState.previousMode = GAME_CONSTANTS.MODES.MAIN_MENU;
        
        // Reset input blocking flags
        gameState.inputsBlocked = false;
        gameState.playInProgress = false;
        
        // Check if there's an active season
        if (this.game.seasonManager.data.active) {
            // Replace "Season Mode" with "Resume Season" if season is active
            let seasonText = `Resume Season`;
            const sm = this.game.seasonManager.data;
            
            if (sm.inChampionship) {
                seasonText = `Resume Championship (${sm.championshipWins}-${sm.championshipLosses})`;
            } else if (sm.inPlayoffs) {
                seasonText = `Resume Playoffs (${sm.playoffWins}-${sm.playoffLosses})`;
            } else {
                seasonText = `Resume Season (${sm.wins}-${sm.losses})`;
            }
            
            gameState.menuOptions = ['Exhibition Mode', seasonText, 'Back'];
        } else {
            // Normal menu when no active season
            gameState.menuOptions = ['Exhibition Mode', 'Season Mode', 'Back'];
        }
        
        gameState.selectedIndex = 0;
        
        this.drawPlayMenu();
        this.game.audioSystem.speak("Choose game mode");
    }

    showSettingsMenu(maintainSelection = false) {
        const gameState = this.game.gameState;
        gameState.mode = GAME_CONSTANTS.MODES.SETTINGS_MENU;
        
        // Get current voice name for display
        let voiceDisplayName = 'DEFAULT';
        if (this.game.audioSystem.voiceManager) {
            const currentVoice = this.game.audioSystem.voiceManager.getCurrentVoice();
            voiceDisplayName = this.game.audioSystem.voiceManager.getVoiceDisplayName(currentVoice);
        } else {
            voiceDisplayName = this.game.audioSystem.settings.voiceType.toUpperCase();
        }

        // Get scan settings
        const scanSettings = window.NarbeScanManager ? window.NarbeScanManager.getSettings() : { autoScan: false, scanInterval: 2000 };
        
        gameState.menuOptions = [
            `Auto Scan: ${scanSettings.autoScan ? 'ON' : 'OFF'}`,
            `Scan Speed: ${scanSettings.scanInterval / 1000}s`,
            `Music: ${this.game.audioSystem.settings.musicEnabled ? 'ON' : 'OFF'}`,
            `Sound Effects: ${this.game.audioSystem.settings.soundEnabled ? 'ON' : 'OFF'}`,
            `Text-to-Speech: ${this.game.audioSystem.settings.ttsEnabled ? 'ON' : 'OFF'}`,
            `Voice: ${voiceDisplayName}`,
            'Next Track',
            'Reset Season',
            'Back'
        ];
        
        if (!maintainSelection) {
            gameState.selectedIndex = 0;
        }
        
        this.drawSettingsMenu();
        // Only announce menu entry if not maintaining selection (toggling shouldn't re-announce "Settings Menu")
        if (!maintainSelection) {
            this.game.audioSystem.speak("Settings menu");
        }
    }

    showColorSelectMenu(mode) {
        const gameState = this.game.gameState;
        gameState.mode = GAME_CONSTANTS.MODES.COLOR_SELECT;
        gameState.gameMode = mode;
        gameState.previousMode = GAME_CONSTANTS.MODES.PLAY_MENU;
        
        gameState.currentColorIndex = 0;
        gameState.selectedIndex = 0;
        
        this.drawColorSelectMenu();
        this.game.audioSystem.speak(`Choose your team color for ${mode}. Current selection: ${GAME_CONSTANTS.COLOR_OPTIONS[0].name}`);
    }
}