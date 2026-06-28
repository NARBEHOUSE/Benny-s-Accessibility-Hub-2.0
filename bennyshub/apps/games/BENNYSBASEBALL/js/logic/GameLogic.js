class GameLogic {
    constructor(game) {
        this.game = game;
        this.playTimeoutId = null; // Add timeout tracking
    }

    startGame() {
        this.game.gameState.reset();
        
        // Block inputs during startup delay to prevent premature auto-scan
        this.game.gameState.inputsBlocked = true;
        
        this.game.gameState.mode = GAME_CONSTANTS.MODES.GAMEPLAY;
        this.game.pauseButton.classList.add('visible');
        this.game.fieldRenderer.drawField(this.game.gameState);
        this.game.fieldRenderer.initializeFieldPlayers(this.game.gameState);
        setTimeout(() => this.nextPlay(), 1000);
    }

    startGameWithSettings(mode, playerColor) {
        // Block inputs during transition to prevent auto-scan
        this.game.gameState.inputsBlocked = true;
        
        // Set team colors
        const playerColorData = GAME_CONSTANTS.COLOR_OPTIONS.find(c => c.name === playerColor);
        let opponentColorData;
        
        // Store the player's selected color for team identification
        this.game.gameState.playerSelectedColor = playerColorData.color;
        
        if (mode === 'season') {
            // Check if there's a game in progress to resume
            if (this.game.seasonManager.hasGameInProgress()) {
                this.resumeSeasonGame();
                return;
            }
            
            opponentColorData = this.game.seasonManager.selectOpponent();
            
            // Check if season is over or failed
            if (!opponentColorData) {
                if (this.game.seasonManager.data.seasonFailed) {
                    this.game.audioSystem.speak("Season failed. Better luck next time.");
                } else {
                    this.game.audioSystem.speak("Season complete.");
                }
                this.game.seasonManager.reset();
                this.game.menuSystem.showMainMenu();
                return;
            }
            
            this.game.seasonManager.save();
        } else {
            // Exhibition - random opponent
            const available = GAME_CONSTANTS.COLOR_OPTIONS.filter(c => c.name !== playerColor);
            opponentColorData = available[Math.floor(Math.random() * available.length)];
        }
        
        // Randomly determine who is home vs away team (this determines who bats first)
        const playerIsAwayTeam = Math.random() < 0.5;
        
        if (playerIsAwayTeam) {
            // Player is away team (Red), bats first in top of 1st
            this.game.gameState.awayTeam = playerColorData.name;
            this.game.gameState.homeTeam = opponentColorData.name;
            GAME_CONSTANTS.COLORS.playerRed = playerColorData.color;
            GAME_CONSTANTS.COLORS.playerBlue = opponentColorData.color;
        } else {
            // Player is home team (Blue), bats second in bottom of 1st
            this.game.gameState.homeTeam = playerColorData.name;
            this.game.gameState.awayTeam = opponentColorData.name;
            GAME_CONSTANTS.COLORS.playerBlue = playerColorData.color;
            GAME_CONSTANTS.COLORS.playerRed = opponentColorData.color;
        }
        
        // Announce game type
        let announcement = `${playerColorData.name} versus ${opponentColorData.name}`;
        if (mode === 'season') {
            if (this.game.seasonManager.data.inChampionship) {
                const wins = this.game.seasonManager.data.championshipWins;
                const losses = this.game.seasonManager.data.championshipLosses;
                announcement = `Championship Series Game. Series is ${wins} to ${losses}. ${announcement}`;
            } else if (this.game.seasonManager.data.inPlayoffs) {
                const wins = this.game.seasonManager.data.playoffWins;
                const losses = this.game.seasonManager.data.playoffLosses;
                announcement = `Playoff Series Game. Series is ${wins} to ${losses}. ${announcement}`;
            }
        }
        
        this.game.audioSystem.speak(announcement);
        
        setTimeout(() => this.startGame(), 2000);
    }

    // Resume a saved season game
    resumeSeasonGame() {
        // Block inputs during transition to prevent auto-scan
        this.game.gameState.inputsBlocked = true;

        const savedGame = this.game.seasonManager.loadCurrentGame();
        if (!savedGame) {
            this.game.audioSystem.speak('No saved game found');
            return;
        }

        // Restore game state
        const gameState = this.game.gameState;
        gameState.reset();
        gameState.inputsBlocked = true; // Block inputs during restoration
        
        gameState.currentInning = savedGame.currentInning;
        gameState.half = savedGame.half;
        gameState.outs = savedGame.outs;
        gameState.score = { ...savedGame.score };
        gameState.bases = { ...savedGame.bases };
        gameState.balls = savedGame.balls;
        gameState.strikes = savedGame.strikes;
        gameState.homeTeam = savedGame.homeTeam;
        gameState.awayTeam = savedGame.awayTeam;
        gameState.playerSelectedColor = savedGame.playerSelectedColor;
        gameState.samePitchCount = savedGame.samePitchCount || 0;
        gameState.lastPitchType = savedGame.lastPitchType;

        // Restore team colors based on saved data
        const playerColorData = GAME_CONSTANTS.COLOR_OPTIONS.find(c => c.color === savedGame.playerSelectedColor);
        const opponentColorData = GAME_CONSTANTS.COLOR_OPTIONS.find(c => 
            c.name === (savedGame.homeTeam === playerColorData?.name ? savedGame.awayTeam : savedGame.homeTeam)
        );

        // Determine if player is away team based on name match
        if (savedGame.awayTeam === playerColorData.name) {
            GAME_CONSTANTS.COLORS.playerRed = playerColorData.color;
            GAME_CONSTANTS.COLORS.playerBlue = opponentColorData.color;
        } else {
            GAME_CONSTANTS.COLORS.playerBlue = playerColorData.color;
            GAME_CONSTANTS.COLORS.playerRed = opponentColorData.color;
        }

        this.game.audioSystem.speak(`Resuming saved game. ${gameState.homeTeam} versus ${gameState.awayTeam}`);
        
        setTimeout(() => {
            this.game.gameState.mode = GAME_CONSTANTS.MODES.GAMEPLAY;
            // Keep inputs blocked until nextPlay -> announceHalfInning/play logic is ready
            this.game.gameState.inputsBlocked = true; 
            this.game.pauseButton.classList.add('visible');
            this.game.fieldRenderer.drawField(this.game.gameState);
            this.game.fieldRenderer.initializeFieldPlayers(this.game.gameState);
            setTimeout(() => this.nextPlay(), 1000);
        }, 2000);
    }

    nextPlay() {
        if (this.game.gameState.firstPitch) {
            this.announceHalfInning();
            return;
        }

        if (this.game.gameState.outs >= GAME_CONSTANTS.GAME_RULES.MAX_OUTS) {
            this.endHalfInning();
        } else {
            if (this.game.gameState.isPlayerBatting()) {
                this.startBattingPhase();
            } else {
                this.startPitchingPhase();
            }
        }
    }

    announceHalfInning() {
        this.game.gameState.mode = GAME_CONSTANTS.MODES.HALF_INNING_TRANSITION;
        this.game.gameState.inputsBlocked = true; // Block inputs to prevent scan sound
        this.game.uiRenderer.drawTransitionScreen(this.game.gameState);
        
        const ordinals = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth'];
        const inningText = ordinals[this.game.gameState.currentInning] || this.game.gameState.currentInning;
        const halfText = this.game.gameState.half === 'top' ? 'Top' : 'Bottom';
        
        const battingTeam = this.game.gameState.getBattingTeam();
        const announcement = `${halfText} of the ${inningText} inning. ${battingTeam} batting.`;
        
        this.game.audioSystem.speak(announcement);
        this.game.gameState.firstPitch = false;
        
        // Clear previous menu options to prevent bleeding into gameplay
        this.game.gameState.menuOptions = [];
        
        setTimeout(() => {
            this.game.gameState.mode = GAME_CONSTANTS.MODES.GAMEPLAY;
            // Removed inputsBlocked = false here; it will be unblocked when gameplay menus are ready
            this.nextPlay();
        }, GAME_CONSTANTS.TIMING.TRANSITION_DURATION);
    }

    startBattingPhase() {
        this.game.gameState.mode = GAME_CONSTANTS.MODES.BATTING;
        this.game.gameState.inputsBlocked = true;
        
        // Reset interactive batting state
        this.game.gameState.resetInteractiveBatting();
        this.game.gameState.interactiveBatting.active = true;
        
        // Simulate computer's pitch selection
        this.simulateComputerPitch();
        
        // Always show the batting menu first (Ready to Bat, Bunt, Pause, and steal options if applicable)
        this.showStealMenu();
    }
    
    showStealMenu() {
        const gameState = this.game.gameState;
        gameState.menuOptions = ['Ready to Bat'];
        
        // Add steal options based on base runners
        if (gameState.bases.first && !gameState.bases.second) {
            gameState.menuOptions.push('Steal 2nd Base');
        }
        if (gameState.bases.second && !gameState.bases.third) {
            gameState.menuOptions.push('Steal 3rd Base');
        }
        
        // Always add Pause option at the end
        gameState.menuOptions.push('Pause');
        
        gameState.selectedIndex = -1; // Start with no option highlighted - user must scan first
        gameState.menuReady = false;
        gameState.hasScanned = false;
        
        // Temporarily switch to BATTING mode for menu display
        gameState.mode = GAME_CONSTANTS.MODES.BATTING;
        
        setTimeout(() => {
            gameState.inputsBlocked = false;
        }, 1000);
        
        this.game.menuSystem.drawStealMenu();
        this.game.audioSystem.speak("Select an action.");
    }
    
    processStealOrBat(selected) {
        const gameState = this.game.gameState;
        const option = gameState.menuOptions[selected];
        
        console.log('processStealOrBat - Option selected:', option);
        
        if (option === 'Ready to Bat') {
            // Proceed to interactive batting
            gameState.mode = GAME_CONSTANTS.MODES.INTERACTIVE_BATTING;
            gameState.interactiveBatting.swingType = 'normal'; // Default swing type
            gameState.inputsBlocked = true;
            this.startInteractivePitch();
        } else if (option === 'Pause') {
            // Show pause menu
            this.game.showPauseMenu();
        } else if (option.includes('Steal')) {
            // Process steal attempt
            this.processStealAttempt(option);
        }
    }
    
    processStealAttempt(option) {
        const gameState = this.game.gameState;
        const base = option.includes('2nd') ? 'second' : 'third';
        const success = Math.random() < (base === 'second' ? 0.7 : 0.5);
        
        gameState.inputsBlocked = true;
        gameState.playInProgress = true;
        
        if (success) {
            const outcome = base === 'second' ? 'Steal Second' : 'Steal Third';
            
            gameState.pendingBaseUpdate = () => {
                if (base === 'second') {
                    gameState.bases.second = gameState.bases.first;
                    gameState.bases.first = null;
                } else {
                    gameState.bases.third = gameState.bases.second;
                    gameState.bases.second = null;
                }
            };
            
            this.game.audioSystem.speak(`Steal successful!`);
            this.game.animationSystem.startRunnerAnimation(outcome, () => this.finishPlay(outcome));
        } else {
            const outcome = 'Caught Stealing';
            gameState.outs++;
            
            if (base === 'second') {
                gameState.bases.first = null;
            } else {
                gameState.bases.second = null;
            }
            
            this.game.audioSystem.speak(`Steal failed. Runner is out.`);
            this.game.animationSystem.drawFailedStealAnimation(base, () => this.finishPlay(outcome));
        }
    }
    
    startInteractivePitch() {
        const gameState = this.game.gameState;
        gameState.mode = GAME_CONSTANTS.MODES.INTERACTIVE_BATTING;
        gameState.interactiveBatting.active = true;
        gameState.interactiveBatting.pitchInProgress = true;
        gameState.interactiveBatting.waitingForSwing = true;
        gameState.interactiveBatting.lastSwingTone = null; // Reset swing tone timer
        gameState.inputsBlocked = false;
        
        // Set batter stance based on swing type (BUNT shows bat pointing toward pitcher)
        // Find batter - could be 'BATTER' or just type 'BAT'
        const batter = this.game.fieldRenderer.fieldPlayers.find(p => p.position === 'BATTER' || p.type === 'BAT' || p.type === 'BUNT');
        
        console.log('startInteractivePitch - Found batter:', batter);
        console.log('startInteractivePitch - Swing type:', gameState.interactiveBatting.swingType);
        
        if (batter && gameState.interactiveBatting.swingType === 'bunt') {
            // Trigger bunt animation - bat moves to horizontal and holds
            this.game.animationSystem.animateBatterBunt(() => {
                // After bunt animation completes, reset to normal stance
                console.log('Bunt animation complete');
            });
        }
        
        const pitchType = gameState.selectedPitch;
        const location = gameState.selectedPitchLocation;
        
        this.game.audioSystem.speak(`${pitchType} ${location}!`);
        
        // Redraw field AFTER setting batter stance so bunt position shows immediately
        this.game.fieldRenderer.drawField(gameState);
        this.game.fieldRenderer.drawPlayers();
        this.game.uiRenderer.drawScoreboard(gameState);
        
        // Start the interactive pitch animation
        this.game.animationSystem.drawInteractivePitchAnimation(
            pitchType, 
            location,
            // Progress callback - called each frame with pitch progress
            (progress) => this.onPitchProgress(progress),
            // Complete callback - called when pitch reaches batter without swing
            () => this.onPitchComplete()
        );
    }
    
    onPitchProgress(progress) {
        const gameState = this.game.gameState;
        gameState.interactiveBatting.pitchProgress = progress;
        
        // Ball is in strike zone when progress is between 0.80 and 0.98 (closer to batter)
        gameState.interactiveBatting.ballInStrikeZone = progress >= 0.80 && progress <= 0.98;
        
        // Play swing zone reminder tone repeatedly while in strike zone
        if (gameState.interactiveBatting.ballInStrikeZone) {
            const now = Date.now();
            // Play tone every 150ms while in zone
            if (!gameState.interactiveBatting.lastSwingTone || now - gameState.interactiveBatting.lastSwingTone > 150) {
                this.game.audioSystem.playSound('swingZone');
                gameState.interactiveBatting.lastSwingTone = now;
            }
        }
    }
    
    onPitchComplete() {
        // Player didn't swing - determine outcome (ball, strike, or hit by pitch)
        const gameState = this.game.gameState;
        
        // If player is still charging (swingPressed but hasn't released or auto-bunted),
        // they missed their chance - treat as no swing (ball or strike)
        if (gameState.interactiveBatting.swingPressed && !gameState.interactiveBatting.swingReleased) {
            // Stop the charge sound and monitoring
            if (this.chargeMonitorId) {
                clearInterval(this.chargeMonitorId);
                this.chargeMonitorId = null;
            }
            this.game.audioSystem.stopChargeSound();
            
            // Reset swing state - they didn't swing in time
            gameState.interactiveBatting.swingPressed = false;
            gameState.interactiveBatting.waitingForSwing = false;
            
            // Process as no swing (ball or strike based on pitch location)
            this.processNoSwing();
            return;
        }
        
        // Only process as no swing if player hasn't pressed swing button at all
        if (!gameState.interactiveBatting.swingReleased && !gameState.interactiveBatting.swingPressed) {
            gameState.interactiveBatting.waitingForSwing = false;
            this.processNoSwing();
        }
    }
    
    processNoSwing() {
        const gameState = this.game.gameState;
        const location = gameState.selectedPitchLocation;
        
        // Determine outcome based on pitch location
        let outcome;
        const rand = Math.random();
        
        if (rand < GAME_CONSTANTS.TIMING.HIT_BY_PITCH_CHANCE) {
            // Hit by pitch - batter takes first base
            outcome = 'Hit By Pitch';
            gameState.pendingBaseUpdate = () => this.updateBases('Walk', 'user');
            
            gameState.balls = 0;
            gameState.strikes = 0;
            
            this.game.audioSystem.speak('Hit by pitch! Take your base.');
            this.game.animationSystem.startRunnerAnimation('Walk', () => this.finishPlay(outcome));
        } else if (location === 'Outside' && Math.random() < 0.75) {
            // Outside pitch has 75% chance to be a ball if you don't swing
            outcome = 'Ball';
            gameState.balls++;
            
            if (gameState.balls >= GAME_CONSTANTS.GAME_RULES.MAX_BALLS) {
                outcome = 'Walk';
                gameState.pendingBaseUpdate = () => this.updateBases(outcome, 'user');
                gameState.balls = 0;
                gameState.strikes = 0;
                
                this.game.audioSystem.speak('Ball four! Walk.');
                this.game.animationSystem.startRunnerAnimation('Walk', () => this.finishPlay(outcome));
            } else {
                this.game.audioSystem.speak(`Ball. Count is ${gameState.balls}-${gameState.strikes}.`);
                this.finishPlay(outcome);
            }
        } else if (location === 'Inside' && Math.random() < 0.5) {
            // Inside pitch has 50% chance to be a ball if you don't swing
            outcome = 'Ball';
            gameState.balls++;
            
            if (gameState.balls >= GAME_CONSTANTS.GAME_RULES.MAX_BALLS) {
                outcome = 'Walk';
                gameState.pendingBaseUpdate = () => this.updateBases(outcome, 'user');
                gameState.balls = 0;
                gameState.strikes = 0;
                
                this.game.audioSystem.speak('Ball four! Walk.');
                this.game.animationSystem.startRunnerAnimation('Walk', () => this.finishPlay(outcome));
            } else {
                this.game.audioSystem.speak(`Ball. Count is ${gameState.balls}-${gameState.strikes}.`);
                this.finishPlay(outcome);
            }
        } else {
            // Strike (called strike)
            outcome = 'Strike';
            gameState.strikes++;
            
            if (gameState.strikes >= GAME_CONSTANTS.GAME_RULES.MAX_STRIKES) {
                outcome = 'Strike Out';
                gameState.outs++;
                gameState.balls = 0;
                gameState.strikes = 0;
                
                this.game.audioSystem.speak('Strike three! You\'re out!');
                this.finishPlay(outcome);
            } else {
                this.game.audioSystem.speak(`Strike! Count is ${gameState.balls}-${gameState.strikes}.`);
                this.finishPlay(outcome);
            }
        }
    }
    
    // Called when player presses Enter during interactive batting
    onSwingStart() {
        const gameState = this.game.gameState;
        
        if (!gameState.interactiveBatting.active || !gameState.interactiveBatting.waitingForSwing) {
            return false;
        }
        
        gameState.interactiveBatting.swingPressed = true;
        gameState.interactiveBatting.swingPressStart = Date.now();
        gameState.interactiveBatting.announcedSwingType = null; // Track announced type
        
        // Announce initial swing type
        this.game.audioSystem.speak('Normal swing');
        gameState.interactiveBatting.announcedSwingType = 'normal';
        
        // Start charge tone monitoring (6 seconds max for bunt)
        this.game.audioSystem.startChargeSound();
        this.chargeMonitorId = setInterval(() => {
            if (!gameState.interactiveBatting.swingPressed) {
                clearInterval(this.chargeMonitorId);
                return;
            }
            const holdDuration = Date.now() - gameState.interactiveBatting.swingPressStart;
            // 6 seconds = 100% charge (SWING_BUNT_MIN)
            const chargePercent = Math.min(holdDuration / GAME_CONSTANTS.TIMING.SWING_BUNT_MIN, 1.0);
            this.game.audioSystem.updateChargeSound(chargePercent);
            
            // Announce swing type transitions
            if (holdDuration >= GAME_CONSTANTS.TIMING.SWING_POWER_MIN && 
                gameState.interactiveBatting.announcedSwingType === 'normal') {
                this.game.audioSystem.speak('Power swing');
                gameState.interactiveBatting.announcedSwingType = 'power';
            }
            
            // Auto-trigger bunt when fully charged (100%)
            if (chargePercent >= 1.0) {
                this.game.audioSystem.speak('Bunt');
                gameState.interactiveBatting.announcedSwingType = 'bunt';
                this.triggerAutoBunt();
            }
        }, 50); // Check every 50ms
        
        return true;
    }
    
    // Called when player releases Enter during interactive batting
    onSwingRelease() {
        const gameState = this.game.gameState;
        
        // Guard against multiple calls - check active, swingPressed, and NOT already released
        if (!gameState.interactiveBatting.active || 
            !gameState.interactiveBatting.swingPressed || 
            gameState.interactiveBatting.swingReleased) {
            return;
        }
        
        // Immediately mark as released and clear swingPressed to prevent any further swing processing
        gameState.interactiveBatting.swingPressed = false;
        gameState.interactiveBatting.swingReleased = true;
        gameState.interactiveBatting.waitingForSwing = false;
        
        // Stop charge tone monitoring
        if (this.chargeMonitorId) {
            clearInterval(this.chargeMonitorId);
            this.chargeMonitorId = null;
        }
        this.game.audioSystem.stopChargeSound();
        
        const holdDuration = Date.now() - gameState.interactiveBatting.swingPressStart;
        
        // Determine swing type based on hold duration:
        // 0-3s = normal swing
        // 3-6s = power swing
        // 6s+ = bunt (hold from start of pitch)
        let swingType;
        if (holdDuration >= GAME_CONSTANTS.TIMING.SWING_BUNT_MIN) {
            // Bunt (6+ seconds)
            swingType = 'bunt';
            gameState.interactiveBatting.swingPowerLevel = 0.1; // Low power for bunt
        } else if (holdDuration >= GAME_CONSTANTS.TIMING.SWING_POWER_MIN) {
            // Power swing (3-6 seconds)
            swingType = 'power';
            // Scale power from 0.7 to 1.0 based on how close to 6 seconds
            const powerRange = GAME_CONSTANTS.TIMING.SWING_POWER_MAX - GAME_CONSTANTS.TIMING.SWING_POWER_MIN;
            const powerProgress = Math.min(holdDuration - GAME_CONSTANTS.TIMING.SWING_POWER_MIN, powerRange) / powerRange;
            gameState.interactiveBatting.swingPowerLevel = 0.7 + (powerProgress * 0.3);
        } else {
            // Normal swing (0-3 seconds)
            swingType = 'normal';
            gameState.interactiveBatting.swingPowerLevel = 0.5; // Medium power for normal
        }
        
        gameState.interactiveBatting.swingType = swingType;
        
        // Calculate timing score based on pitch progress (-1 = early, 0 = perfect, 1 = late)
        const pitchProgress = gameState.interactiveBatting.pitchProgress;
        const perfectTiming = 0.90; // Perfect timing is when ball is 90% to batter (closer)
        const timingWindow = GAME_CONSTANTS.TIMING.SWING_TIMING_WINDOW / GAME_CONSTANTS.TIMING.INTERACTIVE_PITCH_DURATION;
        
        gameState.interactiveBatting.timingScore = (pitchProgress - perfectTiming) / timingWindow;
        
        // Trigger swing animation
        this.executeSwing();
    }
    
    // Called automatically when charge reaches 100% - triggers bunt without waiting for release
    triggerAutoBunt() {
        const gameState = this.game.gameState;
        
        if (!gameState.interactiveBatting.active || !gameState.interactiveBatting.swingPressed) {
            return;
        }
        
        // Stop charge tone monitoring
        if (this.chargeMonitorId) {
            clearInterval(this.chargeMonitorId);
            this.chargeMonitorId = null;
        }
        this.game.audioSystem.stopChargeSound();
        
        // Mark as released so normal release doesn't double-trigger
        gameState.interactiveBatting.swingPressed = false;
        gameState.interactiveBatting.swingReleased = true;
        gameState.interactiveBatting.waitingForSwing = false;
        
        // Set bunt swing type
        gameState.interactiveBatting.swingType = 'bunt';
        gameState.interactiveBatting.swingPowerLevel = 0.1; // Low power for bunt
        
        // Calculate timing score based on pitch progress
        const pitchProgress = gameState.interactiveBatting.pitchProgress;
        const perfectTiming = 0.90;
        const timingWindow = GAME_CONSTANTS.TIMING.SWING_TIMING_WINDOW / GAME_CONSTANTS.TIMING.INTERACTIVE_PITCH_DURATION;
        
        gameState.interactiveBatting.timingScore = (pitchProgress - perfectTiming) / timingWindow;
        
        // Trigger swing animation
        this.executeSwing();
    }
    
    executeSwing() {
        const gameState = this.game.gameState;
        gameState.interactiveBatting.isSwinging = true;
        
        // Play swing sound
        this.game.audioSystem.playSound('swing');

        // Get the batter
        const batter = this.game.fieldRenderer.fieldPlayers.find(p => p.position === 'BATTER');
        
        // If bunting, use bunt animation (bat extends forward)
        if (gameState.interactiveBatting.swingType === 'bunt') {
            // Get the batter for bunt animation
            const batterForBunt = this.game.fieldRenderer.fieldPlayers.find(p => p.position === 'BATTER');
            if (batterForBunt) {
                batterForBunt.type = 'BUNT';
                batterForBunt.buntProgress = 0;
            }
            
            // Animate the bunt (bat extends horizontally)
            const buntStartTime = Date.now();
            const buntDuration = 300; // Quick bunt animation
            
            const animateBunt = () => {
                const elapsed = Date.now() - buntStartTime;
                const progress = Math.min(elapsed / buntDuration, 1.0);
                
                if (batterForBunt) {
                    batterForBunt.buntProgress = progress;
                }
                
                // Redraw
                this.game.fieldRenderer.drawField(gameState);
                this.game.fieldRenderer.drawPlayers();
                this.game.uiRenderer.drawScoreboard(gameState);
                
                if (progress < 1.0) {
                    requestAnimationFrame(animateBunt);
                } else {
                    // Bunt animation complete, process outcome
                    if (batterForBunt) {
                        batterForBunt.type = 'BAT';
                        batterForBunt.buntProgress = 0;
                    }
                    this.processInteractiveSwingOutcome();
                }
            };
            
            animateBunt();
            return;
        }

        if (batter) {
            batter.startSwing();
        }
        
        // Animate the swing
        this.game.animationSystem.animateBatterSwing(() => {
            // After swing animation, process the outcome
            this.processInteractiveSwingOutcome();
        });
    }
    
    processInteractiveSwingOutcome() {
        const gameState = this.game.gameState;
        const ib = gameState.interactiveBatting;
        
        const swingType = ib.swingType; // 'normal', 'power', or 'bunt'
        const timingScore = Math.abs(ib.timingScore); // 0 = perfect, higher = worse
        const wasInStrikeZone = ib.pitchProgress >= 0.75 && ib.pitchProgress <= 1.0; // Updated to match new timing
        const location = gameState.selectedPitchLocation;
        
        // Calculate outcome based on swing type and timing
        let outcome;
        
        if (timingScore > 1.5) {
            // Way off timing - miss (swinging = always a strike, even if ball was outside zone)
            // No hit sound - bat didn't make contact
            outcome = 'Strike';
        } else if (swingType === 'bunt') {
            // Bunt outcomes - different logic
            outcome = this.calculateBuntOutcome(timingScore, wasInStrikeZone);
        } else if (timingScore > 0.8) {
            // Poor timing - likely foul or weak contact
            if (wasInStrikeZone) {
                // Ball in zone, poor timing
                const rand = Math.random();
                if (rand < 0.6) {
                    outcome = 'Foul';
                } else if (rand < 0.85) {
                    outcome = 'Ground Out';
                } else {
                    outcome = 'Single'; // Lucky hit
                }
            } else {
                // Ball outside zone, poor timing
                // Mostly strikes (swing and miss), or fouls
                const rand = Math.random();
                if (rand < 0.3) {
                     outcome = 'Foul';
                } else {
                     outcome = 'Strike'; // Swing and miss
                }
            }
        } else if (timingScore > 0.4) {
            // Decent timing - always makes contact if in zone
            outcome = this.calculateDecentTimingOutcome(swingType === 'power' ? 0.9 : 0.5, wasInStrikeZone, location, swingType);
        } else {
            // Good to perfect timing - always makes contact
            outcome = this.calculateGoodTimingOutcome(swingType === 'power' ? 0.9 : 0.5, wasInStrikeZone, location, swingType);
        }
        
        // Play hit sound for ANY contact (not Strike)
        // This is the single source of truth for player batting hit sounds
        if (outcome !== 'Strike') {
            this.playBaseballHitSound();
            // Play additional homerun sound for home runs
            if (outcome === 'Home Run') {
                setTimeout(() => this.playHomeRunSound(), 300);
            }
        }
        
        this.processBattingOutcome(outcome, ['Single', 'Double', 'Triple', 'Home Run', 'Walk', 'Strike Out', 'Pop Fly Out', 'Ground Out'].includes(outcome));
    }
    
    calculateBuntOutcome(timingScore, wasInStrikeZone) {
        const rand = Math.random();
        
        if (timingScore > 0.8) {
            // Poor bunt timing - mostly misses or weak contact
            if (rand < 0.5) return 'Strike'; // Missed the bunt
            if (rand < 0.85) return 'Foul';
            return 'Ground Out';
        }
        
        if (!wasInStrikeZone) {
            // Bunting at ball outside zone - hard to make good contact
            if (rand < 0.5) return 'Strike'; // Missed
            if (rand < 0.9) return 'Foul';
            return 'Ground Out';
        }
        
        // Good bunt timing in strike zone
        // Bunts can only result in: Single (30%), Ground Out (35%), Foul (35%)
        if (timingScore <= 0.3) {
            // Excellent bunt timing
            if (rand < 0.30) return 'Single'; // Bunt single!
            if (rand < 0.65) return 'Ground Out'; // Sacrifice successful
            return 'Foul';
        } else {
            // Decent bunt timing
            if (rand < 0.25) return 'Single';
            if (rand < 0.60) return 'Ground Out';
            return 'Foul';
        }
    }
    
    processBuntOutcome(pitchType, location) {
        const gameState = this.game.gameState;
        
        // Calculate bunt outcome based on location
        let outcome;
        const rand = Math.random();
        
        if (location === 'Outside' && rand < 0.4) {
            // Outside pitches harder to bunt - more likely to miss
            outcome = 'Strike';
        } else if (rand < 0.40) {
            outcome = 'Ground Out';
        } else if (rand < 0.70) {
            outcome = 'Foul';
        } else {
            outcome = 'Single';
        }
        
        // Update count and process terminal outcomes
        let terminal = false;
        
        if (outcome === 'Strike') {
            gameState.strikes++;
            if (gameState.strikes >= GAME_CONSTANTS.GAME_RULES.MAX_STRIKES) {
                outcome = 'Strike Out';
                gameState.outs++;
                terminal = true;
            }
        } else if (outcome === 'Foul') {
            if (gameState.strikes < 2) gameState.strikes++;
            this.playBaseballHitSound();
        } else if (outcome === 'Ground Out') {
            gameState.outs++;
            terminal = true;
            this.playBaseballHitSound();
        } else if (outcome === 'Single') {
            gameState.pendingBaseUpdate = () => this.updateBases(outcome, 'user');
            terminal = true;
            this.playBaseballHitSound();
        }
        
        if (terminal) {
            gameState.balls = 0;
            gameState.strikes = 0;
        }
        
        // Don't announce Ground Out - the animation will say "Fielded by [position]" then "Out!"
        if (outcome !== 'Ground Out') {
            this.game.audioSystem.speak(outcome);
        }
        
        // Animate the result
        if (['Single', 'Ground Out', 'Foul'].includes(outcome)) {
            this.game.animationSystem.drawBallFlightAndThrow(gameState.fieldCoords.home, outcome, () => {
                if (outcome === 'Single') {
                    this.game.animationSystem.startRunnerAnimation(outcome, () => this.finishPlay(outcome));
                } else {
                    this.finishPlay(outcome);
                }
            });
        } else {
            this.finishPlay(outcome);
        }
    }
    
    calculateDecentTimingOutcome(powerLevel, wasInStrikeZone, location, swingType) {
        const rand = Math.random();
        
        if (!wasInStrikeZone) {
            return rand < 0.7 ? 'Foul' : 'Strike';
        }
        
        // Adjust outcomes based on location and swing type
        let hitBonus = 0;
        let strikeBonus = 0;
        
        if (location === 'Inside') {
            if (swingType === 'power') {
                hitBonus = 0.15; // Inside pitches are better for power swings
            } else {
                strikeBonus = 0.10; // Inside pitches harder to hit with normal swing
            }
        }
        
        if (powerLevel >= 0.8) {
            // Power swing with decent timing
            if (rand < 0.25 + hitBonus) return 'Pop Fly Out';
            if (rand < 0.45 + hitBonus) return 'Single';
            if (rand < 0.60) return 'Double';
            if (rand < 0.75 - strikeBonus) return 'Foul';
            return 'Ground Out';
        } else {
            // Normal swing with decent timing
            if (rand < 0.30 + hitBonus) return 'Single';
            if (rand < 0.45 - strikeBonus) return 'Ground Out';
            if (rand < 0.65) return 'Foul';
            if (rand < 0.80) return 'Pop Fly Out';
            return 'Double';
        }
    }
    
    calculateGoodTimingOutcome(powerLevel, wasInStrikeZone, location, swingType) {
        const rand = Math.random();
        
        if (!wasInStrikeZone) {
            // Good timing but ball was outside zone
            if (rand < 0.5) return 'Foul';
            if (rand < 0.8) return 'Single';
            return 'Ground Out';
        }
        
        // Adjust outcomes based on location and swing type
        let hitBonus = 0;
        let strikeBonus = 0;
        
        if (location === 'Inside') {
            if (swingType === 'power') {
                hitBonus = 0.15; // Inside pitches are better for power swings
            } else {
                strikeBonus = 0.08; // Inside pitches harder to hit cleanly with normal swing
            }
        } else if (location === 'Middle') {
            // Middle pitches are ideal for all swing types
            hitBonus = 0.05;
        }
        
        if (powerLevel >= 0.9) {
            // Max power with perfect timing (+5% triples/HRs, +25% outs/fouls - high risk/reward)
            if (rand < 0.25 + hitBonus) return 'Home Run';
            if (rand < 0.50 + hitBonus) return 'Triple';
            if (rand < 0.60) return 'Double';
            if (rand < 0.70 - strikeBonus) return 'Single';
            if (rand < 0.90) return 'Foul';
            return 'Pop Fly Out';
        } else if (powerLevel >= 0.7) {
            // Strong power with good timing (+5% triples/HRs, +25% outs/fouls)
            if (rand < 0.13 + hitBonus) return 'Home Run';
            if (rand < 0.30 + hitBonus) return 'Triple';
            if (rand < 0.45) return 'Double';
            if (rand < 0.60 - strikeBonus) return 'Single';
            if (rand < 0.82) return 'Foul';
            return 'Pop Fly Out';
        } else if (powerLevel >= 0.4) {
            // Medium power with good timing (+10% bonus for singles/doubles on normal swing)
            if (rand < 0.02) return 'Home Run';
            if (rand < 0.10) return 'Triple';
            if (rand < 0.35 + hitBonus) return 'Double';
            if (rand < 0.70 + hitBonus - strikeBonus) return 'Single';
            if (rand < 0.85) return 'Ground Out';
            return 'Pop Fly Out';
        } else {
            // Low power (quick tap) with good timing - contact hitter (+10% bonus for singles/doubles)
            if (rand < 0.55 + hitBonus - strikeBonus) return 'Single';
            if (rand < 0.68 + hitBonus) return 'Double';
            if (rand < 0.80) return 'Ground Out';
            if (rand < 0.92) return 'Foul';
            return 'Pop Fly Out';
        }
    }

    simulateComputerPitch() {
        const pitchTypes = ['Fastball', 'Curveball', 'Slider', 'Knuckleball', 'Changeup'];
        const locations = ['Inside', 'Middle', 'Outside'];
        this.game.gameState.selectedPitch = pitchTypes[Math.floor(Math.random() * pitchTypes.length)];
        this.game.gameState.selectedPitchLocation = locations[Math.floor(Math.random() * locations.length)];
    }

    // Old showSwingMenu removed - now using showStealMenu for batting phase
    // The new batting system uses INTERACTIVE_BATTING mode with timing-based swings

    processBattingSelection(selected) {
        const gameState = this.game.gameState;
        const option = gameState.menuOptions[selected];

        // Clear any existing timeout
        if (this.playTimeoutId) {
            clearTimeout(this.playTimeoutId);
            this.playTimeoutId = null;
        }

        // Set a fallback timeout to prevent permanent freezing
        this.playTimeoutId = setTimeout(() => {
            console.warn('Play timeout reached, forcing unlock');
            this.forceUnlockInputs();
        }, 15000); // 15 second timeout

        if (option.includes('Steal')) {
            const base = option.includes('2nd') ? 'second' : 'third';
            const success = Math.random() < (base === 'second' ? 0.7 : 0.5);
            
            if (success) {
                const outcome = base === 'second' ? 'Steal Second' : 'Steal Third';
                
                // Set up the base update to happen after animation
                gameState.pendingBaseUpdate = () => {
                    if (base === 'second') {
                        // Move runner from first to second
                        gameState.bases.second = gameState.bases.first;
                        gameState.bases.first = null;
                    } else {
                        // Move runner from second to third
                        gameState.bases.third = gameState.bases.second;
                        gameState.bases.second = null;
                    }
                };
                
                this.game.audioSystem.speak(`Steal successful!`);
                this.game.animationSystem.startRunnerAnimation(outcome, () => this.finishPlay(outcome));
            } else {
                const outcome = 'Caught Stealing';
                gameState.outs++;
                
                // Remove the caught runner
                if (base === 'second') {
                    gameState.bases.first = null;
                } else {
                    gameState.bases.second = null;
                }
                
                this.game.audioSystem.speak(`Steal failed. Runner is out.`);
                
                // Show pitcher throwing to the appropriate base
                this.game.animationSystem.drawFailedStealAnimation(base, () => this.finishPlay(outcome));
            }
        } else {
            // Store the swing type for processing after pitch animation
            gameState.selectedSwing = option;
            
            // Show the pitch animation first
            const pitchType = gameState.selectedPitch;
            const location = gameState.selectedPitchLocation;
            
            this.game.audioSystem.speak(`${pitchType} pitch incoming`);
            
            this.game.animationSystem.drawPitchAnimation(pitchType, location, () => {
                // After pitch animation completes, process the swing
                // Increased delay to allow pitch announcement to finish ("Fastball pitch incoming" etc)
                setTimeout(() => this.processSwingOutcome(option), 1500);
            });
        }
    }

    processSwingOutcome(swing) {
        const gameState = this.game.gameState;
        let outcome = null;
        let terminal = false;

        // Track consecutive holds for boost mechanic
        if (swing === 'Hold') {
            gameState.consecutiveHolds++;
        } else if (swing === 'Bunt' || swing.includes('Steal')) {
            // Reset hold counter for bunt or steal (non-swing actions)
            gameState.consecutiveHolds = 0;
        }
        // NOTE: Do NOT reset consecutiveHolds for Normal Swing or Power Swing here
        // It will be reset AFTER simulateBatting() processes the hold bonus

        if (swing === 'Bunt') {
            const rand = Math.random();
            if (rand < 0.4) {
                outcome = 'Ground Out';
                // Play baseball hit sound for bunt ground outs
                this.playBaseballHitSound();
            } else if (rand < 0.7) {
                outcome = 'Foul';
                // Play baseball hit sound for bunt fouls
                this.playBaseballHitSound();
            } else {
                outcome = 'Single';
                // Play baseball hit sound for bunt singles
                this.playBaseballHitSound();
            }
            
            terminal = outcome !== 'Foul';
            
            if (outcome === 'Ground Out') {
                gameState.outs++;
                
                // Force advance logic for bunt ground out (sacrifice bunt)
                gameState.pendingBaseUpdate = () => {
                    // Force advance chain: only advance if the runner behind forces them
                    
                    // Check if 3rd base runner is forced home (only if BOTH 2nd AND 1st base are occupied)
                    if (gameState.bases.third && gameState.bases.second && gameState.bases.first) {
                        gameState.bases.third = null; // Runner scores
                        // Add run to batting team
                        const battingTeam = gameState.getBattingTeam();
                        const team = battingTeam === gameState.awayTeam ? 'Red' : 'Blue';
                        gameState.score[team]++;
                    }
                    
                    // Check if 2nd base runner is forced to 3rd (only if 1st base is occupied AND 3rd is now empty)
                    if (gameState.bases.second && gameState.bases.first && !gameState.bases.third) {
                        gameState.bases.third = gameState.bases.second;
                        gameState.bases.second = null;
                    }
                    
                    // Check if 1st base runner is forced to 2nd (always forced by batter attempting to reach 1st, and 2nd is now empty)
                    if (gameState.bases.first && !gameState.bases.second) {
                        gameState.bases.second = gameState.bases.first;
                    }
                    
                    // Batter is out, doesn't reach first base
                    gameState.bases.first = null;
                };
            } else if (outcome === 'Single') {
                // Force advance logic for successful bunt + batter reaches first
                gameState.pendingBaseUpdate = () => {
                    // Force advance chain: advance all forced runners
                    
                    // Check if 3rd base runner is forced home (only if BOTH 2nd AND 1st base are occupied)
                    if (gameState.bases.third && gameState.bases.second && gameState.bases.first) {
                        gameState.bases.third = null; // Runner scores
                        // Add run to batting team
                        const battingTeam = gameState.getBattingTeam();
                        const team = battingTeam === gameState.awayTeam ? 'Red' : 'Blue';
                        gameState.score[team]++;
                    }
                    
                    // Check if 2nd base runner is forced to 3rd (only if 1st base is occupied AND 3rd is now empty)
                    if (gameState.bases.second && gameState.bases.first && !gameState.bases.third) {
                        gameState.bases.third = gameState.bases.second;
                    }
                    
                    // Check if 1st base runner is forced to 2nd (always forced by batter taking 1st, and 2nd is now empty)
                    if (gameState.bases.first && !gameState.bases.second) {
                        gameState.bases.second = gameState.bases.first;
                    }
                    
                    // Batter takes first base
                    gameState.bases.first = 'user';
                };
            } else if (outcome === 'Foul') {
                if (gameState.strikes < 2) gameState.strikes++;
            }
        } else {
            outcome = this.simulateBatting(swing);
            terminal = ['Single', 'Double', 'Triple', 'Home Run', 'Walk', 'Strike Out', 'Pop Fly Out', 'Ground Out'].includes(outcome);
            
            this.processBattingOutcome(outcome, terminal);
            return; // Let processBattingOutcome handle the rest
        }

        if (terminal) {
            gameState.balls = 0;
            gameState.strikes = 0;
        }

        // Announce outcome
        setTimeout(() => {
            if (outcome === 'Home Run' && gameState.bases.first && gameState.bases.second && gameState.bases.third) {
                this.game.audioSystem.speak('Grand Slam!');
            } else {
                this.game.audioSystem.speak(`${outcome}`);
            }
        }, 300);

        // Animate the result
        if (['Single', 'Double', 'Triple', 'Home Run', 'Pop Fly Out', 'Ground Out', 'Foul'].includes(outcome)) {
            this.game.animationSystem.drawBallFlightAndThrow(gameState.fieldCoords.home, outcome, () => {
                // After ball animation, start runner animation if needed
                if (['Single', 'Double', 'Triple', 'Home Run'].includes(outcome)) {
                    this.game.animationSystem.startRunnerAnimation(outcome, () => this.finishPlay(outcome));
                } else {
                    this.finishPlay(outcome);
                }
            });
        } else {
            this.finishPlay(outcome);
        }
    }

    processBattingOutcome(outcome, terminal) {
        const gameState = this.game.gameState;
        
        if (outcome === 'Strike') {
            gameState.strikes++;
            if (gameState.strikes >= GAME_CONSTANTS.GAME_RULES.MAX_STRIKES) {
                outcome = 'Strike Out';
                gameState.outs++;
                terminal = true;
            }
        } else if (outcome === 'Ball') {
            gameState.balls++;
            if (gameState.balls >= GAME_CONSTANTS.GAME_RULES.MAX_BALLS) {
                outcome = 'Walk';
                gameState.pendingBaseUpdate = () => this.updateBases(outcome, 'user');
                terminal = true;
            }
        } else if (outcome === 'Foul') {
            if (gameState.strikes < 2) gameState.strikes++;
            // Hit sound played in processInteractiveSwingOutcome
        } else if (['Pop Fly Out', 'Ground Out'].includes(outcome)) {
            // Hit sound played in processInteractiveSwingOutcome
            
            if (outcome === 'Ground Out') {
                // Ground out logic based on correct baseball rules:
                // - Runner on 3rd NEVER scores on double/triple play
                // - With 2 outs: just single ground out (no need for double play)
                // - With 0 outs + runners on 1st and 2nd (or bases loaded): 50% triple play, 50% double play
                // - With 0-1 outs + runner on 1st only: 50% double play, 50% single out (runner advances to 2nd)
                
                if (gameState.outs === 2) {
                    // 2 outs - just a regular ground out, inning ends
                    gameState.outs++;
                    // Bases stay as-is (no one advances since inning ends)
                }
                // Triple Play: 0 outs with runners on 1st AND 2nd (includes bases loaded), 50% chance
                else if (gameState.outs === 0 && gameState.bases.first && gameState.bases.second && Math.random() < 0.5) {
                    outcome = 'Triple Play';
                    gameState.outs = 3; // End the inning
                    gameState.pendingBaseUpdate = () => {
                        // All runners and batter are out - clear all bases, NO runs score
                        gameState.bases.first = null;
                        gameState.bases.second = null;
                        gameState.bases.third = null;
                    };
                }
                // Double Play: 0 or 1 out with runner on 1st (or more runners)
                else if (gameState.outs <= 1 && gameState.bases.first) {
                    // 50% chance of double play vs single out with runner advancing
                    if (Math.random() < 0.5) {
                        outcome = 'Double Play';
                        gameState.outs += 2;
                        
                        gameState.pendingBaseUpdate = () => {
                            // Runner on 3rd does NOT score - double play ends threat
                            // Runner on 2nd advances to 3rd (if no one on 3rd)
                            if (gameState.bases.second && !gameState.bases.third) {
                                gameState.bases.third = gameState.bases.second;
                            }
                            gameState.bases.second = null;
                            // Runner on 1st and batter are both out
                            gameState.bases.first = null;
                        };
                    } else {
                        // Single ground out - batter is out, runners advance
                        gameState.outs++;
                        gameState.pendingBaseUpdate = () => {
                            // Force runner from 1st to 2nd
                            if (gameState.bases.first) {
                                if (gameState.bases.second && !gameState.bases.third) {
                                    // Runner on 2nd advances to 3rd
                                    gameState.bases.third = gameState.bases.second;
                                }
                                gameState.bases.second = gameState.bases.first;
                                gameState.bases.first = null;
                            }
                        };
                    }
                }
                // Regular Ground Out: No one on base
                else {
                    gameState.outs++;
                }
            } else {
                // Pop Fly Out - always just 1 out, runners hold
                gameState.outs++;
            }
        } else if (['Single', 'Double', 'Triple', 'Home Run'].includes(outcome)) {
            gameState.pendingBaseUpdate = () => this.updateBases(outcome, 'user');
            // Hit sound played in processInteractiveSwingOutcome
        }

        if (terminal) {
            gameState.balls = 0;
            gameState.strikes = 0;
        }

        // Announce outcome AFTER sound effects - check for Grand Slam
        setTimeout(() => {
            if (outcome === 'Home Run' && gameState.bases.first && gameState.bases.second && gameState.bases.third) {
                this.game.audioSystem.speak('Grand Slam!');
            } else {
                this.game.audioSystem.speak(`${outcome}`);
            }
        }, 300);

        // Animate the result
        if (['Single', 'Double', 'Triple', 'Home Run', 'Pop Fly Out', 'Ground Out', 'Double Play', 'Triple Play', 'Foul'].includes(outcome)) {
            this.game.animationSystem.drawBallFlightAndThrow(gameState.fieldCoords.home, outcome, () => {
                // After ball animation, start runner animation if needed
                if (['Single', 'Double', 'Triple', 'Home Run', 'Walk'].includes(outcome)) {
                    this.game.animationSystem.startRunnerAnimation(outcome, () => this.finishPlay(outcome));
                } else {
                    this.finishPlay(outcome);
                }
            });
        } else if (outcome === 'Walk') {
            // Walk doesn't need ball animation, just runner animation
            this.game.animationSystem.startRunnerAnimation(outcome, () => this.finishPlay(outcome));
        } else {
            this.finishPlay(outcome);
        }
    }

    simulateBatting(swing) {
        const gameState = this.game.gameState;
        
        if (swing === 'Hold') {
            return gameState.selectedPitchLocation === 'Outside' ? 'Ball' : (Math.random() < 0.3 ? 'Ball' : 'Strike');
        }
        
        // Store the hold count before resetting (for announcements)
        const holdCount = gameState.consecutiveHolds;
        
        // Special logic: 4+ holds guarantees a hit
        if (holdCount >= 5) {
            // Determine hit type based on swing type
            const hitWeights = swing === 'Power Swing' ? 
                { Single: 90, Double: 5, Triple: 3, 'Home Run': 2 } :
                { Single: 85, Double: 10, Triple: 3, 'Home Run': 2 };
            
            // Reset hold counter after using the boost
            gameState.consecutiveHolds = 0;
            
            return this.weightedChoice(hitWeights);
        }
        
        // Calculate boost: 10% per consecutive hold (capped at 100% for 10 holds)
        const boostPercent = Math.min(holdCount * 10, 100);
        const boostFactor = 1 + (boostPercent / 100); // 1.0 to 2.0
        
        // Announce boost if active (but less than 4 holds)
        if (holdCount > 0) {
            this.game.audioSystem.speak(`${boostPercent}% patience boost activated!`);
        }
        
        // Base weights for power swing and normal swing
        const weights = swing === 'Power Swing' ? 
            { Strike: 58, Foul: 15, 'Pop Fly Out': 10, 'Home Run': 3, Double: 7, Single: 7 } :
            // Normal swing: 10% boost to hits (reduced strikes/outs, increased hit chances)
            { Strike: 42, Foul: 20, 'Pop Fly Out': 9, 'Ground Out': 7, Single: 12, Double: 6, Triple: 3, 'Home Run': 1 };
        
        // Apply hold boost if player held before swinging
        if (holdCount > 0) {
            // Reduce strike and out chances
            weights.Strike = Math.round(weights.Strike / boostFactor);
            if (weights['Pop Fly Out']) weights['Pop Fly Out'] = Math.round(weights['Pop Fly Out'] / boostFactor);
            if (weights['Ground Out']) weights['Ground Out'] = Math.round(weights['Ground Out'] / boostFactor);
            
            // Boost hit chances
            if (weights.Single) weights.Single = Math.round(weights.Single * boostFactor);
            if (weights.Double) weights.Double = Math.round(weights.Double * boostFactor);
            if (weights.Triple) weights.Triple = Math.round(weights.Triple * boostFactor);
            if (weights['Home Run']) weights['Home Run'] = Math.round(weights['Home Run'] * boostFactor);
        }
        
        // Reset hold counter after using the boost
        gameState.consecutiveHolds = 0;
        
        // Comeback logic: 30% boost to hits if player is losing by 2+ after 7th inning
        if (gameState.currentInning >= 7) {
            const playerTeam = gameState.getPlayerTeam();
            const computerTeam = gameState.getComputerTeam();
            
            // Get scores for player and computer
            const playerScore = playerTeam === gameState.awayTeam ? gameState.score.Red : gameState.score.Blue;
            const computerScore = computerTeam === gameState.awayTeam ? gameState.score.Red : gameState.score.Blue;
            
            // If player is losing by 2 or more runs, boost hit chances
            if (playerScore + 2 <= computerScore) {
                // Calculate 30% boost by reducing outs and increasing hits
                const comebackBoostFactor = 1.3;
                
                // Reduce strike and out chances
                weights.Strike = Math.round(weights.Strike / comebackBoostFactor);
                if (weights['Pop Fly Out']) weights['Pop Fly Out'] = Math.round(weights['Pop Fly Out'] / comebackBoostFactor);
                if (weights['Ground Out']) weights['Ground Out'] = Math.round(weights['Ground Out'] / comebackBoostFactor);
                
                // Boost hit chances
                if (weights.Single) weights.Single = Math.round(weights.Single * comebackBoostFactor);
                if (weights.Double) weights.Double = Math.round(weights.Double * comebackBoostFactor);
                if (weights.Triple) weights.Triple = Math.round(weights.Triple * comebackBoostFactor);
                if (weights['Home Run']) weights['Home Run'] = Math.round(weights['Home Run'] / comebackBoostFactor);
            }
        }
        
        return this.weightedChoice(weights);
    }

    startPitchingPhase() {
        const gameState = this.game.gameState;
        gameState.mode = GAME_CONSTANTS.MODES.PITCHING;
        gameState.inputsBlocked = true; // Block inputs immediately
        
        // IMMEDIATELY clear the old pitch grid so scans are ignored during transition
        gameState.pitchGrid = null;
        gameState.pitchZoneIndex = -1;
        
        // Force reset spacebar state
        gameState.spaceHeld = false;
        gameState.spaceHoldStart = null;
        if (this.game.inputHandler) {
            this.game.inputHandler.keyStates[' '] = true; // Require fresh keypress
            this.game.inputHandler.stopBackwardScan();
            this.game.inputHandler.stopAutoScan();
        }
        
        setTimeout(() => {
            this.showPitchMenu();
            // Inputs unblocked inside showPitchMenu after delay
        }, 500);
    }

    showPitchMenu() {
        const gameState = this.game.gameState;
        
        // Generate 5-zone pitch selector (4 corners + center diamond)
        gameState.pitchGrid = this.generatePitchGrid();
        gameState.pitchGridTimestamp = Date.now(); // Track when this grid was created
        gameState.pitchZoneIndex = -1; // Start with nothing selected (0-4 for zones, 5 for pause)
        gameState.menuOptions = ['Pause']; // Keep pause option separate
        
        // FORCE reset spacebar state - require fresh keypress after menu appears
        // This prevents held spacebar from immediately scanning the new menu
        gameState.spaceHeld = false;
        gameState.spaceHoldStart = null;
        if (this.game.inputHandler) {
            this.game.inputHandler.keyStates[' '] = true; // Mark as "already pressed" so keydown is ignored until release
            this.game.inputHandler.stopBackwardScan();
        }
        
        // Keep inputs blocked initially to provide a selection buffer
        gameState.inputsBlocked = true;
        setTimeout(() => {
            gameState.inputsBlocked = false;
        }, 2000);
        
        gameState.selectedIndex = -1;
        gameState.menuReady = false;
        gameState.hasScanned = false;
        this.game.menuSystem.drawPitchGridMenu();
        this.game.audioSystem.speak("Choose your pitch.");
    }
    
    generatePitchGrid() {
        const pitchTypes = ['Fastball', 'Curveball', 'Slider', 'Knuckleball', 'Changeup'];
        // Zone labels: 0=High Inside, 1=High Outside, 2=Low Outside, 3=Low Inside, 4=Center
        const zones = ['High Inside', 'High Outside', 'Low Outside', 'Low Inside', 'Center'];
        
        // Shuffle the pitch types to randomize which pitch goes where
        const shuffledPitches = [...pitchTypes];
        for (let i = shuffledPitches.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledPitches[i], shuffledPitches[j]] = [shuffledPitches[j], shuffledPitches[i]];
        }
        
        // Pick a random "hot spot" zone (0-4) - the best pitch location
        const hotZone = Math.floor(Math.random() * 5);
        
        const grid = [];
        
        for (let i = 0; i < 5; i++) {
            // Each zone gets a unique pitch from the shuffled array
            const pitch = shuffledPitches[i];
            const zone = zones[i];
            
            // Calculate effectiveness based on distance from hot zone
            // Hot zone = 1.0, adjacent = ~0.6, opposite = ~0.3
            let effectiveness;
            if (i === hotZone) {
                effectiveness = 1.0; // Best pitch
            } else if (i === 4 || hotZone === 4) {
                // Center is adjacent to all corners, corners adjacent to center
                effectiveness = 0.6;
            } else {
                // Calculate distance between corner zones (0-3)
                // Adjacent corners (differ by 1 or 3) = 0.6, diagonal (differ by 2) = 0.3
                const diff = Math.abs(i - hotZone);
                if (diff === 1 || diff === 3) {
                    effectiveness = 0.6; // Adjacent corner
                } else {
                    effectiveness = 0.3; // Diagonal corner (opposite)
                }
            }
            
            grid[i] = {
                pitch: pitch,
                zone: zone,
                zoneIndex: i,
                effectiveness: effectiveness,
                label: `${pitch}, ${zone}`
            };
        }
        
        return grid;
    }
    
    // Determine where the pitch actually ends up based on selected zone
    getPitchOutcome(selectedZone) {
        const roll = Math.random() * 100;
        
        if (selectedZone.zoneIndex === 4) {
            // Center zone - usually center, small chance to drift
            // 70% center, 7.5% each direction (high center, low center, inside, outside)
            if (roll < 70) {
                return { location: 'Center', drifted: false };
            } else if (roll < 77.5) {
                return { location: 'High Center', drifted: true };
            } else if (roll < 85) {
                return { location: 'Low Center', drifted: true };
            } else if (roll < 92.5) {
                return { location: 'Inside', drifted: true };
            } else {
                return { location: 'Outside', drifted: true };
            }
        } else {
            // Corner zones - usually their zone, small chance to drift to center
            // 85% their zone, 15% center
            const zoneNames = ['High Inside', 'High Outside', 'Low Outside', 'Low Inside'];
            if (roll < 85) {
                return { location: zoneNames[selectedZone.zoneIndex], drifted: false };
            } else {
                return { location: 'Center', drifted: true };
            }
        }
    }

    processPitchSelection(selected) {
        const gameState = this.game.gameState;
        
        // Handle Pause option (selected = -1 means pause button was clicked/selected)
        if (selected === -1) {
            this.game.showPauseMenu();
            return;
        }
        
        // IMMEDIATELY block all inputs and clear the menu to prevent any more scans
        gameState.inputsBlocked = true;
        gameState.spaceHeld = false;
        gameState.spaceHoldStart = null;
        if (this.game.inputHandler) {
            this.game.inputHandler.keyStates[' '] = true; // Require fresh keypress
            this.game.inputHandler.stopBackwardScan();
            this.game.inputHandler.stopAutoScan();
        }
        
        // Get pitch from the 5-zone grid using pitchZoneIndex BEFORE clearing
        const zoneIndex = gameState.pitchZoneIndex;
        const gridCell = gameState.pitchGrid[zoneIndex];
        
        // NOW clear the pitch grid so the old menu can never be drawn again
        gameState.pitchGrid = null;
        gameState.pitchZoneIndex = -1;
        const pitchType = gridCell.pitch;
        
        // Get the actual pitch outcome (where the ball actually goes)
        const pitchOutcome = this.getPitchOutcome(gridCell);
        const actualLocation = pitchOutcome.location;
        
        // Map the actual location to animation location
        let pitchLocation;
        if (actualLocation.includes('Inside')) pitchLocation = 'Inside';
        else if (actualLocation.includes('Outside')) pitchLocation = 'Outside';
        else pitchLocation = 'Middle';
        
        // Check if this is the best pitch (30% strike bonus)
        const isBestPitch = gridCell.effectiveness >= 0.95;
        if (isBestPitch) {
            gameState.bestPitchBonus = true;
        } else {
            gameState.bestPitchBonus = false;
        }
        
        gameState.selectedPitch = pitchType;
        gameState.selectedPitchLocation = pitchLocation;
        gameState.actualPitchLocation = actualLocation; // Store the detailed location
        gameState.pitchDrifted = pitchOutcome.drifted; // Whether pitch drifted from intended zone
        gameState.selectedPitchEffectiveness = gridCell.effectiveness; // Store for outcome calculation
        
        // Clear any existing timeout
        if (this.playTimeoutId) {
            clearTimeout(this.playTimeoutId);
            this.playTimeoutId = null;
        }

        // Set a fallback timeout to prevent permanent freezing
        this.playTimeoutId = setTimeout(() => {
            console.warn('Pitch timeout reached, forcing unlock');
            this.forceUnlockInputs();
        }, 10000); // 10 second timeout
        
        if (gameState.lastPitchType === pitchType) {
            gameState.samePitchCount++;
        } else {
            gameState.samePitchCount = 1;
        }
        gameState.lastPitchType = pitchType;
        
        // Start pitch animation immediately (no announcement - outcome will be announced after)
        this.game.animationSystem.drawPitchAnimation(pitchType, pitchLocation, () => {
            // After pitch animation completes, process the outcome
            setTimeout(() => this.processPitch(pitchType), 500);
        });
    }

    processPitch(pitchType) {
        const gameState = this.game.gameState;
        
        // Each pitch has unique strategic probabilities
        // Outcomes are whole numbers, with some weight shifted from Single to Ground Out
        const probabilities = {
            // Fastball: High strike rate, some power potential, risky
            Fastball: { 
                strike: 48, 
                ball: 20, 
                foul: 12,
                outcomes: { Single: 8, Double: 7, Triple: 5, 'Home Run': 1, 'Pop Fly Out': 10, 'Ground Out': 14 }
            },
            
            // Curveball: Moderate strike rate, more ground balls, no home runs
            Curveball: { 
                strike: 38, 
                ball: 24, 
                foul: 16,
                outcomes: { Single: 10, Double: 10, Triple: 5, 'Home Run': 0, 'Pop Fly Out': 8, 'Ground Out': 17 }
            },
            
            // Slider: Good strike rate, balanced outcomes, no home runs
            Slider: { 
                strike: 34, 
                ball: 24, 
                foul: 14,
                outcomes: { Single: 11, Double: 8, Triple: 3, 'Home Run': 0, 'Pop Fly Out': 12, 'Ground Out': 16 }
            },
            
            // Knuckleball: Unpredictable, high ball rate, tricky to hit hard
            Knuckleball: { 
                strike: 30, 
                ball: 32, 
                foul: 10,
                outcomes: { Single: 15, Double: 6, Triple: 2, 'Home Run': 0, 'Pop Fly Out': 15, 'Ground Out': 12 }
            },
            
            // Changeup: Deceptive, decent strikes, some power risk
            Changeup: { 
                strike: 34, 
                ball: 20, 
                foul: 16,
                outcomes: { Single: 12, Double: 9, Triple: 4, 'Home Run': 1, 'Pop Fly Out': 14, 'Ground Out': 13 }
            }
        };
        
        let pitchProbs = probabilities[pitchType] || probabilities.Fastball;
        
        // Penalty for throwing same pitch repeatedly (computer learns pattern)
        let strikeRate = pitchProbs.strike;
        let ballRate = pitchProbs.ball;
        let foulRate = pitchProbs.foul;
        let hitOutcomes = { ...pitchProbs.outcomes };
        
        // Apply effectiveness modifier from heatmap selection
        // Green (high effectiveness ~1.0): +15% strike rate, -15% hit outcomes (good for pitcher)
        // Red (low effectiveness ~0.3): -15% strike rate, +15% hit outcomes (bad for pitcher)
        const effectiveness = gameState.selectedPitchEffectiveness || 0.5;
        const effectivenessModifier = (effectiveness - 0.5) * 0.3; // -0.15 to +0.15 range
        
        // Apply to strike rate (positive = more strikes, negative = fewer strikes)
        strikeRate = strikeRate * (1 + effectivenessModifier);
        
        // BEST PITCH BONUS: 30% increased strike rate for selecting the best pitch
        if (gameState.bestPitchBonus) {
            strikeRate = strikeRate * 1.30; // 30% bonus
            foulRate = foulRate * 1.25; // 25% more fouls (batter is fooled)
        }
        
        // Apply inverse to hit outcomes (positive effectiveness = fewer hits, negative = more hits)
        const hitModifier = 1 - effectivenessModifier; // Green reduces hits, red increases hits
        Object.keys(hitOutcomes).forEach(key => {
            hitOutcomes[key] = hitOutcomes[key] * hitModifier;
        });
        
        // BEST PITCH BONUS: Heavily favor outs and weak contact
        if (gameState.bestPitchBonus) {
            // DRASTICALLY reduce extra base hits (very hard to hit best pitch hard)
            if (hitOutcomes['Double']) {
                hitOutcomes['Double'] = hitOutcomes['Double'] * 0.25; // 75% reduction
            }
            if (hitOutcomes['Triple']) {
                hitOutcomes['Triple'] = hitOutcomes['Triple'] * 0.15; // 85% reduction
            }
            if (hitOutcomes['Home Run']) {
                hitOutcomes['Home Run'] = hitOutcomes['Home Run'] * 0.10; // 90% reduction
            }
            
            // Moderately reduce singles (still possible but harder)
            if (hitOutcomes['Single']) {
                hitOutcomes['Single'] = hitOutcomes['Single'] * 0.70; // 30% reduction
            }
            
            // INCREASE outs significantly (batter is fooled by best pitch)
            if (hitOutcomes['Ground Out']) {
                hitOutcomes['Ground Out'] = hitOutcomes['Ground Out'] * 1.60; // 60% increase
            }
            if (hitOutcomes['Pop Fly Out']) {
                hitOutcomes['Pop Fly Out'] = hitOutcomes['Pop Fly Out'] * 1.50; // 50% increase
            }
        }
        
        if (gameState.samePitchCount > 2) {
            const penalty = (gameState.samePitchCount - 2) * 5;
            // Reduce strikes, increase hits
            strikeRate = Math.max(20, strikeRate - penalty);
            
            // Boost hit chances when computer recognizes the pattern
            // BUT if best pitch was selected, reduce the penalty effect significantly
            const penaltyReduction = gameState.bestPitchBonus ? 0.3 : 1.0; // Best pitch only gets 30% of penalty
            const hitBoost = (penalty * penaltyReduction) / Object.keys(hitOutcomes).length;
            Object.keys(hitOutcomes).forEach(key => {
                if (key !== 'Home Run') { // Don't boost home runs
                    hitOutcomes[key] += hitBoost;
                }
            });
        }
        
        // Adjust ball rate based on pitch location
        // Middle = always in strike zone (0% ball chance)
        // Inside = sometimes a ball (50% of base ball rate)
        // Outside = often a ball (100% of base ball rate)
        const pitchLocation = gameState.selectedPitchLocation;
        if (pitchLocation === 'Middle') {
            // Middle pitches are always strikes if not swung at - redistribute ball rate to strikes
            strikeRate += ballRate;
            ballRate = 0;
        } else if (pitchLocation === 'Inside') {
            // Inside pitches are sometimes balls
            const ballReduction = ballRate * 0.5;
            strikeRate += ballReduction;
            ballRate = ballRate * 0.5;
        }
        // Outside keeps full ball rate
        
        // Calculate total probabilities
        const strikeTotal = strikeRate;
        const ballTotal = strikeRate + ballRate;
        const foulTotal = strikeRate + ballRate + foulRate;
        const hitTotal = Object.values(hitOutcomes).reduce((a, b) => a + b, 0);
        const grandTotal = foulTotal + hitTotal;
        
        const rand = Math.random() * grandTotal;
        
        let outcome;
        if (rand < strikeRate) {
            outcome = 'Strike';
        } else if (rand < ballTotal) {
            outcome = 'Ball';
        } else if (rand < foulTotal) {
            outcome = 'Foul';
        } else {
            // Determine hit outcome
            outcome = this.weightedChoice(hitOutcomes);
        }
        
        this.processPitchOutcome(outcome);
    }
    
    processPitchOutcome(outcome) {
        const gameState = this.game.gameState;
        let terminal = false;
        
        if (outcome === 'Strike') {
            gameState.strikes++;
            if (gameState.strikes >= GAME_CONSTANTS.GAME_RULES.MAX_STRIKES) {
                outcome = 'Strike Out';
                gameState.outs++;
                terminal = true;
                // Announce strikeout
                this.game.audioSystem.speak('Strikeout');
            } else {
                this.game.audioSystem.speak(outcome);
            }
        } else if (outcome === 'Ball') {
            this.game.audioSystem.speak(outcome);
            gameState.balls++;
            if (gameState.balls >= GAME_CONSTANTS.GAME_RULES.MAX_BALLS) {
                outcome = 'Walk';
                gameState.pendingBaseUpdate = () => this.updateBases(outcome, 'comp');
                terminal = true;
            }
        } else if (outcome === 'Foul') {
            this.game.audioSystem.speak(outcome);
            if (gameState.strikes < 2) gameState.strikes++;
            // Play baseball hit sound for computer foul balls
            this.playBaseballHitSound();
        } else if (['Pop Fly Out', 'Ground Out'].includes(outcome)) {
            // Play baseball hit sound for computer contact outs
            this.playBaseballHitSound();
            
            if (outcome === 'Ground Out') {
                // Ground out logic based on correct baseball rules:
                // - Runner on 3rd NEVER scores on double/triple play
                // - With 2 outs: just single ground out (no need for double play)
                // - With 0 outs + runners on 1st and 2nd (or bases loaded): 50% triple play, 50% double play
                // - With 0-1 outs + runner on 1st only: 50% double play, 50% single out (runner advances to 2nd)
                
                if (gameState.outs === 2) {
                    // 2 outs - just a regular ground out, inning ends
                    gameState.outs++;
                    // Bases stay as-is (no one advances since inning ends)
                }
                // Triple Play: 0 outs with runners on 1st AND 2nd (includes bases loaded), 50% chance
                else if (gameState.outs === 0 && gameState.bases.first && gameState.bases.second && Math.random() < 0.5) {
                    outcome = 'Triple Play';
                    gameState.outs = 3; // End the inning
                    gameState.pendingBaseUpdate = () => {
                        // All runners and batter are out - clear all bases, NO runs score
                        gameState.bases.first = null;
                        gameState.bases.second = null;
                        gameState.bases.third = null;
                    };
                }
                // Double Play: 0 or 1 out with runner on 1st (or more runners)
                else if (gameState.outs <= 1 && gameState.bases.first) {
                    // 50% chance of double play vs single out with runner advancing
                    if (Math.random() < 0.5) {
                        outcome = 'Double Play';
                        gameState.outs += 2;
                        
                        gameState.pendingBaseUpdate = () => {
                            // Runner on 3rd does NOT score - double play ends threat
                            // Runner on 2nd advances to 3rd (if no one on 3rd)
                            if (gameState.bases.second && !gameState.bases.third) {
                                gameState.bases.third = gameState.bases.second;
                            }
                            gameState.bases.second = null;
                            // Runner on 1st and batter are both out
                            gameState.bases.first = null;
                        };
                    } else {
                        // Single ground out - batter is out, runners advance
                        gameState.outs++;
                        gameState.pendingBaseUpdate = () => {
                            // Force runner from 1st to 2nd
                            if (gameState.bases.first) {
                                if (gameState.bases.second && !gameState.bases.third) {
                                    // Runner on 2nd advances to 3rd
                                    gameState.bases.third = gameState.bases.second;
                                }
                                gameState.bases.second = gameState.bases.first;
                                gameState.bases.first = null;
                            }
                        };
                    }
                }
                // Regular Ground Out: No one on base
                else {
                    gameState.outs++;
                }
                // Announce the final outcome (Ground Out, Double Play, or Triple Play)
                this.game.audioSystem.speak(outcome);
            } else {
                // Pop Fly Out - always just 1 out, runners hold
                gameState.outs++;
                this.game.audioSystem.speak(outcome);
            }
            terminal = true;
        } else if (['Single', 'Double', 'Triple', 'Home Run'].includes(outcome)) {
            this.game.audioSystem.speak(outcome);
            gameState.pendingBaseUpdate = () => this.updateBases(outcome, 'comp');
            terminal = true;
            
            // Play baseball hit sound for computer hits
            this.playBaseballHitSound();
            
            // Play home run sound effect for computer home runs (in addition to hit sound)
            if (outcome === 'Home Run') {
                this.playHomeRunSound();
            }
        }

        if (terminal) {
            gameState.balls = 0;
            gameState.strikes = 0;
        }

        // Animate the result - FIXED: Include Walk in runner animations
        
        // Play swing sound for any non-ball/walk outcome (CPU decided to swing)
        if (outcome !== 'Ball' && outcome !== 'Walk') {
            this.game.audioSystem.playSound('swing');
        }

        // Check if we need to animate a swing (for strikes, outs, fouls, hits)
        if (outcome !== 'Ball' && outcome !== 'Walk') {
            // Animate computer's swing before ball flight
            this.game.animationSystem.animateBatterSwing(() => {
                // Only animate ball flight for contact plays
                if (['Single', 'Double', 'Triple', 'Home Run', 'Pop Fly Out', 'Ground Out', 'Double Play', 'Triple Play', 'Foul'].includes(outcome)) {
                    this.game.animationSystem.drawBallFlightAndThrow(gameState.fieldCoords.home, outcome, () => {
                        // After ball animation, start runner animation for hits
                        if (['Single', 'Double', 'Triple', 'Home Run'].includes(outcome)) {
                            this.game.animationSystem.startRunnerAnimation(outcome, () => this.finishPlay(outcome));
                        } else {
                            this.finishPlay(outcome);
                        }
                    });
                } else {
                    // Strike or Strike Out - no ball flight needed
                    this.finishPlay(outcome);
                }
            });
        } else if (outcome === 'Walk') {
            // Walk doesn't need ball animation, just runner animation
            this.game.animationSystem.startRunnerAnimation(outcome, () => this.finishPlay(outcome));
        } else {
            this.finishPlay(outcome);
        }
    }

    updateBases(outcome, batter) {
        const gameState = this.game.gameState;
        
        // Determine which team scores based on who is currently batting
        const battingTeam = gameState.getBattingTeam();
        let team;
        if (battingTeam === gameState.awayTeam) {
            team = 'Red'; // Away team always uses Red score
        } else {
            team = 'Blue'; // Home team always uses Blue score
        }
        
        if (outcome === 'Single') {
            // Force advance logic: only runners forced by runners behind them advance
            
            // Third base runner only scores if forced by second base runner
            if (gameState.bases.third && gameState.bases.second) {
                gameState.score[team]++;
                gameState.bases.third = null;
            }
            
            // Second base runner only advances to third if forced by first base runner
            if (gameState.bases.second && gameState.bases.first) {
                // If third wasn't occupied or was forced home, second goes to third
                if (!gameState.bases.third) {
                    gameState.bases.third = gameState.bases.second;
                }
                gameState.bases.second = null;
            }
            
            // First base runner always advances to second (forced by batter)
            if (gameState.bases.first) {
                // If second wasn't occupied or was forced to third, first goes to second
                if (!gameState.bases.second) {
                    gameState.bases.second = gameState.bases.first;
                }
            }
            
            // Batter takes first base
            gameState.bases.first = batter;
            
        } else if (outcome === 'Walk') {
            // Walk uses pure force advance - only move if forced
            if (gameState.bases.first) {
                if (gameState.bases.second) {
                    if (gameState.bases.third) {
                        // Bases loaded - third base runner forced home
                        gameState.score[team]++;
                    }
                    // Second base runner forced to third
                    gameState.bases.third = gameState.bases.second;
                }
                // First base runner forced to second
                gameState.bases.second = gameState.bases.first;
            }
            // Batter takes first base
            gameState.bases.first = batter;
            
        } else if (outcome === 'Double') {
            // Double: all runners advance 2 bases, but still check force logic
            
            // Third base runner scores (would advance to home + 1 more)
            if (gameState.bases.third) {
                gameState.score[team]++;
            }
            
            // Second base runner scores (would advance to home)
            if (gameState.bases.second) {
                gameState.score[team]++;
            }
            
            // First base runner advances to third
            gameState.bases.third = gameState.bases.first;
            
            // Clear other bases and put batter on second
            gameState.bases.first = null;
            gameState.bases.second = batter;
            
        } else if (outcome === 'Triple') {
            // Triple: all existing runners score
            ['first', 'second', 'third'].forEach(base => {
                if (gameState.bases[base]) gameState.score[team]++;
                gameState.bases[base] = null;
            });
            gameState.bases.third = batter;
            
        } else if (outcome === 'Home Run') {
            // Home run: everyone scores
            let runs = 1; // Batter scores
            ['first', 'second', 'third'].forEach(base => {
                if (gameState.bases[base]) {
                    runs++;
                    gameState.bases[base] = null;
                }
            });
            gameState.score[team] += runs;
        }
    }

    finishPlay(outcome) {
        // Clear the timeout since play is completing normally
        if (this.playTimeoutId) {
            clearTimeout(this.playTimeoutId);
            this.playTimeoutId = null;
        }

        // Execute pending base updates first
        if (this.game.gameState.pendingBaseUpdate) {
            this.game.gameState.pendingBaseUpdate();
            this.game.gameState.pendingBaseUpdate = null;
        }
        
        // Check for walk-off win: home team takes lead in bottom of 9th or later
        const gameState = this.game.gameState;
        if (gameState.currentInning >= GAME_CONSTANTS.GAME_RULES.INNINGS_PER_GAME && 
            gameState.half === 'bottom' && 
            gameState.score.Blue > gameState.score.Red) {
            // Home team (Blue) has taken the lead in bottom of 9th or later - walk-off win!
            
            // Save game state if in season mode before ending
            if (this.game.seasonManager.data.active) {
                this.game.seasonManager.saveCurrentGame(this.game.gameState);
            }
            
            // Redraw everything to show final state
            this.game.fieldRenderer.drawField(this.game.gameState);
            this.game.fieldRenderer.drawPlayers();
            this.game.uiRenderer.drawScoreboard(this.game.gameState);
            
            // End the game immediately - walk-off!
            setTimeout(() => this.endGame(), 2000);
            return;
        }
        
        // Save game state if in season mode (before potential game end)
        if (this.game.seasonManager.data.active) {
            this.game.seasonManager.saveCurrentGame(this.game.gameState);
        }
        
        // Redraw everything after base updates to show correct highlighting
        this.game.fieldRenderer.drawField(this.game.gameState);
        this.game.fieldRenderer.drawPlayers();
        this.game.uiRenderer.drawScoreboard(this.game.gameState);
        
        setTimeout(() => {
            // Determine if inning is over
            const isInningOver = this.game.gameState.outs >= GAME_CONSTANTS.GAME_RULES.MAX_OUTS;
            
            // Reset common play state flags safely
            this.game.gameState.playInProgress = false;
            this.game.gameState.menuReady = false;
            this.game.gameState.hasScanned = false;
            this.game.gameState.selectedIndex = -1;
            this.game.gameState.animating = false;
            
            if (isInningOver) {
                // If inning is over, KEEP inputs blocked so scan doesn't trigger
                this.game.gameState.inputsBlocked = true;
                this.endHalfInning();
            } else {
                // If continuing, KEEP inputs blocked to prevent premature scanning during delay
                // startBattingPhase / startPitchingPhase will handle unblocking when safe
                this.game.gameState.inputsBlocked = true;
                setTimeout(() => this.nextPlay(), 1000);
            }
        }, 2000);
    }

    unlockInputsAfterPlay() {
        // Deprecated - logic moved directly into finishPlay for better control
        console.warn('unlockInputsAfterPlay is deprecated');
    }

    // Add a force unlock method as a safety net
    forceUnlockInputs() {
        console.log('Force unlocking inputs due to timeout');
        this.game.gameState.playInProgress = false;
        
        // Only unblock if not ending the inning
        if (this.game.gameState.outs >= GAME_CONSTANTS.GAME_RULES.MAX_OUTS) {
            this.game.gameState.inputsBlocked = true;
        } else {
            this.game.gameState.inputsBlocked = false;
        }

        this.game.gameState.menuReady = false;
        this.game.gameState.hasScanned = false;
        this.game.gameState.selectedIndex = -1;
        this.game.gameState.animating = false;
        
        // Clear any running animations
        if (this.game.gameState.runnerAnimation.active) {
            this.game.gameState.runnerAnimation.active = false;
            this.game.gameState.runnerAnimation.runners = [];
        }
        
        // Continue the game
        if (this.game.gameState.outs >= GAME_CONSTANTS.GAME_RULES.MAX_OUTS) {
            this.endHalfInning();
        } else {
            setTimeout(() => this.nextPlay(), 1000);
        }
    }

    endHalfInning() {
        const gameState = this.game.gameState;
        this.game.audioSystem.speak(`Half inning over with ${gameState.outs} outs.`);
        gameState.outs = 0;
        gameState.bases = { first: null, second: null, third: null };
        gameState.balls = 0;
        gameState.strikes = 0;

        if (gameState.half === 'top') {
            // Switch to bottom of the same inning
            gameState.half = 'bottom';
        } else {
            // Bottom half is over, check for game end
            if (gameState.currentInning >= GAME_CONSTANTS.GAME_RULES.INNINGS_PER_GAME) {
                // In regulation or extra innings
                if (gameState.score.Red !== gameState.score.Blue) {
                    // Game is not tied, end the game
                    this.endGame();
                    return;
                } else {
                    // Game is tied, continue to extra innings
                    if (gameState.currentInning === GAME_CONSTANTS.GAME_RULES.INNINGS_PER_GAME) {
                        this.game.audioSystem.speak('Game is tied. Going to extra innings!');
                    }
                }
            }
            
            // Advance to next inning and switch to top
            gameState.currentInning++;
            gameState.half = 'top';
        }

        // Check for walk-off win in extra innings (home team takes lead in bottom half)
        if (gameState.currentInning > GAME_CONSTANTS.GAME_RULES.INNINGS_PER_GAME && 
            gameState.half === 'bottom' && 
            gameState.score.Blue > gameState.score.Red) {
            // Home team (Blue) has taken the lead in bottom of extra inning - walk-off win
            this.endGame();
            return;
        }

        // Reinitialize field players for the new half inning (teams switch batting/fielding roles)
        if (gameState.fieldCoords) {
            this.game.fieldRenderer.initializeFieldPlayers(gameState);
        }

        gameState.firstPitch = true;
        setTimeout(() => this.nextPlay(), GAME_CONSTANTS.TIMING.HALF_INNING_DELAY);
    }

    endGame() {
        const gameState = this.game.gameState;
        gameState.mode = GAME_CONSTANTS.MODES.GAME_OVER;
        this.game.pauseButton.classList.remove('visible');
        
        // Determine winner based on final score and which team the player is on
        const playerTeam = gameState.getPlayerTeam();
        const computerTeam = gameState.getComputerTeam();
        
        // Get scores for player and computer based on their actual team assignments
        const playerScore = playerTeam === gameState.awayTeam ? gameState.score.Red : gameState.score.Blue;
        const computerScore = computerTeam === gameState.awayTeam ? gameState.score.Red : gameState.score.Blue;
        
        const playerWon = playerScore > computerScore;
        
        // Update season progress and check if championship was won
        const wasChampionshipWin = this.game.seasonManager.updateProgress(playerWon);
        
        // If championship was won, show special victory screen
        if (wasChampionshipWin) {
            const victoryData = this.game.seasonManager.getChampionshipVictoryData();
            this.game.uiRenderer.drawChampionshipVictoryScreen(gameState, victoryData);
            this.game.audioSystem.speak('Championship won! You are the champion!');
            
            // Reset season after showing victory screen
            setTimeout(() => {
                this.game.seasonManager.reset();
                this.game.menuSystem.showMainMenu();
            }, 15000); // 15 seconds total
        } else {
            // Normal game over screen
            this.game.uiRenderer.drawGameOverScreen(gameState);
            this.game.audioSystem.speak(playerWon ? 'YOU WON!' : 'YOU LOST!');
            
            setTimeout(() => this.game.menuSystem.showMainMenu(), GAME_CONSTANTS.TIMING.GAME_OVER_DELAY);
        }
    }

    weightedChoice(weights) {
        const total = Object.values(weights).reduce((a, b) => a + b, 0);
        let rand = Math.random() * total;
        
        for (const [outcome, weight] of Object.entries(weights)) {
            rand -= weight;
            if (rand <= 0) return outcome;
        }
        
        return Object.keys(weights)[0];
    }

    // Add method to play home run sound effect
    playHomeRunSound() {
        if (!this.game.audioSystem.settings.soundEnabled) return;
        
        try {
            // Use the preloaded sound from AudioSystem
            if (this.game.audioSystem.sounds.homerun) {
                this.game.audioSystem.sounds.homerun.currentTime = 0;
                this.game.audioSystem.sounds.homerun.play().catch(error => {
                    console.warn('Could not play home run sound:', error);
                });
            } else {
                // Fallback to creating new Audio
                const homerunAudio = new Audio('audio/homerun.wav');
                homerunAudio.volume = 0.5;
                homerunAudio.play().catch(error => {
                    console.warn('Could not play home run sound:', error);
                });
            }
        } catch (error) {
            console.warn('Error playing home run sound:', error);
        }
    }

    // Add method to play baseball hit sound effect
    playBaseballHitSound() {
        if (!this.game.audioSystem.settings.soundEnabled) return;
        
        try {
            // Use the preloaded sound from AudioSystem
            if (this.game.audioSystem.sounds.hit) {
                this.game.audioSystem.sounds.hit.currentTime = 0;
                this.game.audioSystem.sounds.hit.play().catch(error => {
                    console.warn('Could not play baseball hit sound:', error);
                });
            } else {
                // Fallback to creating new Audio
                const hitAudio = new Audio('audio/baseballhit.wav');
                hitAudio.volume = 0.4;
                hitAudio.play().catch(error => {
                    console.warn('Could not play baseball hit sound:', error);
                });
            }
        } catch (error) {
            console.warn('Error playing baseball hit sound:', error);
        }
    }
}