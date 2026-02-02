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
        this.game.gameState.inputsBlocked = true; // Block inputs immediately
        this.simulateComputerPitch();
        this.game.audioSystem.speak("Pitcher throws the ball.");
        
        setTimeout(() => {
            this.showSwingMenu();
            // Inputs unblocked inside showSwingMenu after delay
        }, 1500);
    }

    simulateComputerPitch() {
        const pitchTypes = ['Fastball', 'Curveball', 'Slider', 'Knuckleball', 'Changeup'];
        const locations = ['Inside', 'Middle', 'Outside'];
        this.game.gameState.selectedPitch = pitchTypes[Math.floor(Math.random() * pitchTypes.length)];
        this.game.gameState.selectedPitchLocation = locations[Math.floor(Math.random() * locations.length)];
    }

    showSwingMenu() {
        const gameState = this.game.gameState;
        gameState.menuOptions = ['Normal Swing', 'Power Swing', 'Hold', 'Bunt'];
        
        // Keep inputs blocked initially to provide a selection buffer
        gameState.inputsBlocked = true;
        setTimeout(() => {
            gameState.inputsBlocked = false;
        }, 2000);
        
        if (gameState.bases.first && !gameState.bases.second) {
            gameState.menuOptions.push('Steal 2nd Base');
        }
        if (gameState.bases.second && !gameState.bases.third) {
            gameState.menuOptions.push('Steal 3rd Base');
        }
        
        gameState.selectedIndex = -1;
        gameState.menuReady = false;
        gameState.hasScanned = false;
        this.game.menuSystem.drawSwingMenu();
    }

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
            // Play baseball hit sound for foul balls BEFORE announcement
            this.playBaseballHitSound();
        } else if (['Pop Fly Out', 'Ground Out'].includes(outcome)) {
            // Play baseball hit sound for contact outs BEFORE announcement
            this.playBaseballHitSound();
            
            // Double play logic - only possible with 0 or 1 outs AND runner on first
            if (outcome === 'Ground Out' && gameState.bases.first && gameState.outs <= 1 && Math.random() < 0.75) {
                outcome = 'Double Play';
                gameState.outs += 2;
            } else {
                gameState.outs++;
            }
        } else if (['Single', 'Double', 'Triple', 'Home Run'].includes(outcome)) {
            gameState.pendingBaseUpdate = () => this.updateBases(outcome, 'user');
            
            // Play baseball hit sound for all hits BEFORE announcement
            this.playBaseballHitSound();
            
            // Play home run sound effect for home runs (in addition to hit sound)
            if (outcome === 'Home Run') {
                setTimeout(() => this.playHomeRunSound(), 200); // Slight delay after hit sound
            }
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
        if (['Single', 'Double', 'Triple', 'Home Run', 'Pop Fly Out', 'Ground Out', 'Foul'].includes(outcome)) {
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
        this.game.gameState.mode = GAME_CONSTANTS.MODES.PITCHING;
        this.game.gameState.inputsBlocked = true; // Block inputs immediately
        
        setTimeout(() => {
            this.showPitchMenu();
            // Inputs unblocked inside showPitchMenu after delay
        }, 500);
    }

    showPitchMenu() {
        const gameState = this.game.gameState;
        gameState.menuOptions = ['Fastball', 'Curveball', 'Slider', 'Knuckleball', 'Changeup'];
        
        // Keep inputs blocked initially to provide a selection buffer
        gameState.inputsBlocked = true;
        setTimeout(() => {
            gameState.inputsBlocked = false;
        }, 2000);
        
        gameState.selectedIndex = -1;
        gameState.menuReady = false;
        gameState.hasScanned = false;
        this.game.menuSystem.drawPitchMenu();
        this.game.audioSystem.speak("Choose your pitch.");
    }

    processPitchSelection(selected) {
        const gameState = this.game.gameState;
        const pitchType = gameState.menuOptions[selected];
        gameState.selectedPitch = pitchType;
        
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
        
        const locations = ['Inside', 'Middle', 'Outside'];
        gameState.selectedPitchLocation = locations[Math.floor(Math.random() * locations.length)];
        
        this.game.audioSystem.speak(`Throwing ${pitchType}`);
        
        // Start pitch animation immediately
        this.game.animationSystem.drawPitchAnimation(pitchType, gameState.selectedPitchLocation, () => {
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
        
        if (gameState.samePitchCount > 2) {
            const penalty = (gameState.samePitchCount - 2) * 5;
            // Reduce strikes, increase hits
            strikeRate = Math.max(20, strikeRate - penalty);
            
            // Boost hit chances when computer recognizes the pattern
            const hitBoost = penalty / Object.keys(hitOutcomes).length;
            Object.keys(hitOutcomes).forEach(key => {
                if (key !== 'Home Run') { // Don't boost home runs
                    hitOutcomes[key] += hitBoost;
                }
            });
        }
        
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
        this.game.audioSystem.speak(outcome); // Removed "Computer batter:" prefix
        
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
                gameState.pendingBaseUpdate = () => this.updateBases(outcome, 'comp');
                terminal = true;
            }
        } else if (outcome === 'Foul') {
            if (gameState.strikes < 2) gameState.strikes++;
            // Play baseball hit sound for computer foul balls
            this.playBaseballHitSound();
        } else if (['Pop Fly Out', 'Ground Out'].includes(outcome)) {
            // Play baseball hit sound for computer contact outs
            this.playBaseballHitSound();
            
            // Double play logic - only possible with 0 or 1 outs AND runner on first
            if (outcome === 'Ground Out' && gameState.bases.first && gameState.outs <= 1 && Math.random() < 0.65) {
                outcome = 'Double Play';
                gameState.outs += 2;
            } else {
                gameState.outs++;
            }
            terminal = true;
        } else if (['Single', 'Double', 'Triple', 'Home Run'].includes(outcome)) {
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
        if (['Single', 'Double', 'Triple', 'Home Run', 'Pop Fly Out', 'Ground Out', 'Double Play', 'Foul'].includes(outcome)) {
            this.game.animationSystem.drawBallFlightAndThrow(gameState.fieldCoords.home, outcome, () => {
                // After ball animation, start runner animation for hits
                if (['Single', 'Double', 'Triple', 'Home Run'].includes(outcome)) {
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
            const homerunAudio = new Audio('audio/homerun.wav');
            homerunAudio.volume = 0.3; // Set appropriate volume
            homerunAudio.play().catch(error => {
                console.warn('Could not play home run sound:', error);
            });
        } catch (error) {
            console.warn('Error loading home run sound:', error);
        }
    }

    // Add method to play baseball hit sound effect
    playBaseballHitSound() {
        if (!this.game.audioSystem.settings.soundEnabled) return;
        
        try {
            const hitAudio = new Audio('audio/baseballhit.wav');
            hitAudio.volume = 0.3; // Set appropriate volume
            hitAudio.play().catch(error => {
                console.warn('Could not play baseball hit sound:', error);
            });
        } catch (error) {
            console.warn('Error loading baseball hit sound:', error);
        }
    }
}