class UIRenderer {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
    }

    drawScoreboard(gameState) {
        const padding = 20;
        const fontSize = 24;
        
        this.ctx.font = `bold ${fontSize}px monospace`;
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3;

        // Inning and Outs at top with background
        const topText = `INNING: ${gameState.half.toUpperCase()} ${gameState.currentInning}       OUTS: ${gameState.outs}/3`;
        const topWidth = this.ctx.measureText(topText).width + 40;
        
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(this.canvas.width / 2 - topWidth / 2, 15, topWidth, 40);
        
        this.ctx.fillStyle = '#ffffff';
        this.ctx.strokeText(topText, this.canvas.width / 2, 40);
        this.ctx.fillText(topText, this.canvas.width / 2, 40);

        // Score display
        const scoreSize = 120;
        this.ctx.font = `bold ${scoreSize}px monospace`;
        
        // Player score (Red) on left
        const leftScoreBg = { x: this.canvas.width * 0.2 - 100, y: 50, width: 200, height: 140 };
        
        this.ctx.fillStyle = 'rgba(128, 128, 128, 0.7)';
        this.ctx.fillRect(leftScoreBg.x, leftScoreBg.y, leftScoreBg.width, leftScoreBg.height);
        
        const leftScore = gameState.score.Red.toString();
        const leftScoreX = this.canvas.width * 0.2;
        const leftScoreY = 150;
        
        this.ctx.fillStyle = GAME_CONSTANTS.COLORS.playerRed;
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3;
        this.ctx.strokeText(leftScore, leftScoreX, leftScoreY);
        this.ctx.fillText(leftScore, leftScoreX, leftScoreY);
        
        // Computer score (Blue) on right
        const rightScoreBg = { x: this.canvas.width * 0.8 - 100, y: 50, width: 200, height: 140 };
        
        this.ctx.fillStyle = 'rgba(128, 128, 128, 0.7)';
        this.ctx.fillRect(rightScoreBg.x, rightScoreBg.y, rightScoreBg.width, rightScoreBg.height);
        
        const rightScore = gameState.score.Blue.toString();
        const rightScoreX = this.canvas.width * 0.8;
        const rightScoreY = 150;
        
        this.ctx.fillStyle = GAME_CONSTANTS.COLORS.playerBlue;
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3;
        this.ctx.strokeText(rightScore, rightScoreX, rightScoreY);
        this.ctx.fillText(rightScore, rightScoreX, rightScoreY);

        // Count indicators
        if (gameState.mode === GAME_CONSTANTS.MODES.BATTING || 
            gameState.mode === GAME_CONSTANTS.MODES.PITCHING ||
            gameState.mode === GAME_CONSTANTS.MODES.INTERACTIVE_BATTING) {
            this.drawCountIndicators(gameState);
        }
    }

    drawCountIndicators(gameState) {
        const countX = this.canvas.width - 120;
        const countY = this.canvas.height - 140;
        const indicatorSize = 16;
        const spacing = 12;
        
        // Background panel
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.fillRect(countX - 60, countY - 20, 120, 80);
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(countX - 60, countY - 20, 120, 80);
        
        // Strikes
        this.ctx.font = 'bold 12px monospace';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('STRIKES', countX, countY - 5);
        
        const activeStrikeColor = '#ff4444';
        const inactiveStrikeColor = 'rgba(255, 68, 68, 0.2)';
        
        for (let i = 0; i < 3; i++) {
            const strikeX = countX - 24 + i * (indicatorSize + spacing);
            const strikeY = countY + 15;
            const isActive = i < gameState.strikes;
            
            this.ctx.fillStyle = isActive ? activeStrikeColor : inactiveStrikeColor;
            this.ctx.strokeStyle = isActive ? '#ff0000' : '#666666';
            this.ctx.lineWidth = 1;
            
            // Draw diamond shape
            this.ctx.beginPath();
            this.ctx.moveTo(strikeX, strikeY - indicatorSize / 2);
            this.ctx.lineTo(strikeX + indicatorSize / 2, strikeY);
            this.ctx.lineTo(strikeX, strikeY + indicatorSize / 2);
            this.ctx.lineTo(strikeX - indicatorSize / 2, strikeY);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
            
            if (isActive) {
                this.ctx.shadowColor = activeStrikeColor;
                this.ctx.shadowBlur = 8;
                this.ctx.fill();
                this.ctx.shadowBlur = 0;
            }
        }
        
        // Balls
        const ballsStartY = countY + 40;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillText('BALLS', countX, ballsStartY - 5);
        
        const activeBallColor = '#ffffff';
        const inactiveBallColor = 'rgba(255, 255, 255, 0.2)';
        
        for (let i = 0; i < 4; i++) {
            const ballX = countX - 36 + i * (indicatorSize + spacing);
            const ballY = ballsStartY + 10;
            const isActive = i < gameState.balls;
            
            this.ctx.fillStyle = isActive ? activeBallColor : inactiveBallColor;
            this.ctx.strokeStyle = isActive ? '#cccccc' : '#666666';
            this.ctx.lineWidth = 1;
            
            this.ctx.beginPath();
            this.ctx.arc(ballX, ballY, indicatorSize / 2, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
            
            if (isActive) {
                this.ctx.shadowColor = activeBallColor;
                this.ctx.shadowBlur = 6;
                this.ctx.fill();
                this.ctx.shadowBlur = 0;
            }
        }
    }
    
    drawInteractiveBattingUI(gameState) {
        const ib = gameState.interactiveBatting;
        
        // Draw power meter if player is holding swing button
        if (ib.swingPressed && !ib.swingReleased) {
            this.drawPowerMeter(ib);
        }
        
        // Draw timing zone indicator
        /* Timing meter removed as per request - ball is the indicator
        if (ib.pitchInProgress && !ib.isSwinging) {
            this.drawTimingIndicator(ib);
        }
        */
        
        // Draw count indicators
        this.drawCountIndicators(gameState);
        
        // Draw instructions
        this.drawBattingInstructions(ib);
    }
    
    drawPowerMeter(ib) {
        const meterX = 50;
        const meterY = this.canvas.height / 2 - 100;
        const meterWidth = 60;
        const meterHeight = 200;
        
        // Calculate current hold duration and determine swing type
        const holdDuration = Date.now() - ib.swingPressStart;
        const maxDuration = GAME_CONSTANTS.TIMING.SWING_POWER_MAX; // 4 seconds max
        const progress = Math.min(holdDuration / maxDuration, 1);
        
        // Determine current swing type based on hold duration (or pre-selected bunt)
        let currentSwingType = 'NORMAL';
        let swingColor = '#00ff00';
        
        if (ib.swingType === 'bunt') {
            currentSwingType = 'BUNT';
            swingColor = '#ffaa00';
        } else if (holdDuration >= GAME_CONSTANTS.TIMING.SWING_POWER_MIN) {
            currentSwingType = 'POWER';
            swingColor = '#ff4444';
        }
        
        // Background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        this.ctx.fillRect(meterX - 10, meterY - 40, meterWidth + 20, meterHeight + 80);
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(meterX - 10, meterY - 40, meterWidth + 20, meterHeight + 80);
        
        // Swing type label
        this.ctx.font = 'bold 14px monospace';
        this.ctx.fillStyle = swingColor;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(currentSwingType, meterX + meterWidth / 2, meterY - 20);
        
        // Meter background
        this.ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
        this.ctx.fillRect(meterX, meterY, meterWidth, meterHeight);
        
        // If bunt mode, show single bunt zone
        if (ib.swingType === 'bunt') {
            this.ctx.fillStyle = '#ffaa00' + '60';
            this.ctx.fillRect(meterX, meterY, meterWidth, meterHeight);
            
            this.ctx.font = 'bold 10px monospace';
            this.ctx.textAlign = 'left';
            this.ctx.fillStyle = '#ffaa00';
            this.ctx.fillText('BUNT', meterX + meterWidth + 5, meterY + meterHeight / 2);
        } else {
            // Draw swing type zones (from bottom to top)
            // Zone 1: NORMAL (0-2s) - green
            const normalZoneHeight = (GAME_CONSTANTS.TIMING.SWING_NORMAL_MAX / maxDuration) * meterHeight;
            this.ctx.fillStyle = '#00ff00' + '60';
            this.ctx.fillRect(meterX, meterY + meterHeight - normalZoneHeight, meterWidth, normalZoneHeight);
            
            // Zone 2: POWER (2-4s) - red  
            const powerZoneStart = normalZoneHeight;
            const powerZoneHeight = ((GAME_CONSTANTS.TIMING.SWING_POWER_MAX - GAME_CONSTANTS.TIMING.SWING_POWER_MIN) / maxDuration) * meterHeight;
            this.ctx.fillStyle = '#ff4444' + '60';
            this.ctx.fillRect(meterX, meterY + meterHeight - powerZoneStart - powerZoneHeight, meterWidth, powerZoneHeight);
            
            // Zone labels on the side
            this.ctx.font = 'bold 10px monospace';
            this.ctx.textAlign = 'left';
            this.ctx.fillStyle = '#00ff00';
            this.ctx.fillText('NORMAL', meterX + meterWidth + 5, meterY + meterHeight - normalZoneHeight/2);
            this.ctx.fillStyle = '#ff4444';
            this.ctx.fillText('POWER', meterX + meterWidth + 5, meterY + meterHeight - powerZoneStart - powerZoneHeight/2);
        }
        
        // Filled progress bar
        const filledHeight = progress * meterHeight;
        this.ctx.fillStyle = swingColor;
        this.ctx.fillRect(meterX, meterY + meterHeight - filledHeight, meterWidth, filledHeight);
        
        // Current position line
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(meterX - 5, meterY + meterHeight - filledHeight);
        this.ctx.lineTo(meterX + meterWidth + 5, meterY + meterHeight - filledHeight);
        this.ctx.stroke();
        
        // Time display
        this.ctx.font = 'bold 16px monospace';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`${(holdDuration / 1000).toFixed(1)}s`, meterX + meterWidth / 2, meterY + meterHeight + 25);
    }
    
    drawTimingIndicator(ib) {
        const indicatorX = this.canvas.width - 100;
        const indicatorY = this.canvas.height / 2;
        const indicatorWidth = 30;
        const indicatorHeight = 200;
        
        // Background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(indicatorX - 15, indicatorY - indicatorHeight / 2 - 30, indicatorWidth + 30, indicatorHeight + 60);
        
        // Timing bar
        this.ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
        this.ctx.fillRect(indicatorX, indicatorY - indicatorHeight / 2, indicatorWidth, indicatorHeight);
        
        // Sweet spot zone (green area in the middle-lower portion)
        const sweetSpotStart = 0.70;  // 70% progress
        const sweetSpotEnd = 0.95;    // 95% progress
        const sweetSpotY = indicatorY - indicatorHeight / 2 + (1 - sweetSpotEnd) * indicatorHeight;
        const sweetSpotHeight = (sweetSpotEnd - sweetSpotStart) * indicatorHeight;
        
        this.ctx.fillStyle = 'rgba(0, 255, 0, 0.4)';
        this.ctx.fillRect(indicatorX, sweetSpotY, indicatorWidth, sweetSpotHeight);
        this.ctx.strokeStyle = '#00ff00';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(indicatorX, sweetSpotY, indicatorWidth, sweetSpotHeight);
        
        // Ball progress indicator (moving bar)
        const ballY = indicatorY - indicatorHeight / 2 + (1 - ib.pitchProgress) * indicatorHeight;
        
        // Ball indicator with glow
        this.ctx.fillStyle = ib.ballInStrikeZone ? '#00ff00' : '#ffffff';
        this.ctx.shadowColor = ib.ballInStrikeZone ? '#00ff00' : '#ffffff';
        this.ctx.shadowBlur = 10;
        this.ctx.fillRect(indicatorX - 5, ballY - 3, indicatorWidth + 10, 6);
        this.ctx.shadowBlur = 0;
        
        // Label
        this.ctx.font = 'bold 12px monospace';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('TIMING', indicatorX + indicatorWidth / 2, indicatorY - indicatorHeight / 2 - 10);
        
        // "SWING!" prompt when in sweet spot
        if (ib.ballInStrikeZone) {
            this.ctx.font = 'bold 16px monospace';
            this.ctx.fillStyle = '#00ff00';
            this.ctx.shadowColor = '#00ff00';
            this.ctx.shadowBlur = 15;
            this.ctx.fillText('SWING!', indicatorX + indicatorWidth / 2, indicatorY + indicatorHeight / 2 + 25);
            this.ctx.shadowBlur = 0;
        }
    }
    
    drawBattingInstructions(ib) {
        const instructY = this.canvas.height - 70;
        
        this.ctx.font = 'bold 14px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        this.ctx.fillRect(this.canvas.width / 2 - 220, instructY - 25, 440, 65);
        
        this.ctx.fillStyle = '#ffffff';
        
        if (ib.swingPressed) {
            const holdDuration = Date.now() - ib.swingPressStart;
            let swingTypeText, swingColor;
            
            if (holdDuration >= GAME_CONSTANTS.TIMING.SWING_BUNT_MIN) {
                swingTypeText = 'BUNT';
                swingColor = '#ffaa00';
            } else if (holdDuration >= GAME_CONSTANTS.TIMING.SWING_POWER_MIN) {
                swingTypeText = 'POWER SWING';
                swingColor = '#ff4444';
            } else {
                swingTypeText = 'NORMAL SWING';
                swingColor = '#00ff00';
            }
            
            this.ctx.fillStyle = swingColor;
            this.ctx.fillText(`Current: ${swingTypeText} - RELEASE to SWING!`, this.canvas.width / 2, instructY);
            this.ctx.font = 'bold 11px monospace';
            this.ctx.fillStyle = '#cccccc';
            this.ctx.fillText('0-3s = Normal | 3-6s = Power | 6s+ = Bunt', this.canvas.width / 2, instructY + 18);
        } else if (ib.waitingForSwing) {
            this.ctx.fillStyle = '#00ff00';
            this.ctx.fillText('Press & Release ENTER to SWING!', this.canvas.width / 2, instructY);
            this.ctx.font = 'bold 11px monospace';
            this.ctx.fillStyle = '#cccccc';
            this.ctx.fillText('0-3s = Normal | 3-6s = Power | 6s+ = Bunt', this.canvas.width / 2, instructY + 18);
        }
    }

    drawTransitionScreen(gameState) {
        // Background with dark overlay
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Main transition box
        const boxWidth = 800;
        const boxHeight = 250;
        const boxX = this.canvas.width / 2 - boxWidth / 2;
        const boxY = this.canvas.height / 2 - boxHeight / 2;
        
        // Box background with gradient
        const gradient = this.ctx.createLinearGradient(boxX, boxY, boxX, boxY + boxHeight);
        gradient.addColorStop(0, GAME_CONSTANTS.COLORS.menuBg);
        gradient.addColorStop(1, 'rgba(10, 30, 15, 0.95)');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        
        // Box border with glow
        this.ctx.strokeStyle = GAME_CONSTANTS.COLORS.menuBorder;
        this.ctx.lineWidth = 4;
        this.ctx.shadowColor = GAME_CONSTANTS.COLORS.menuBorder;
        this.ctx.shadowBlur = 15;
        this.ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
        this.ctx.shadowBlur = 0;
        
        // Title text
        this.ctx.font = 'bold 48px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillStyle = GAME_CONSTANTS.COLORS.menuBorder;
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3;
        
        const ordinals = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
        const inningText = ordinals[gameState.currentInning] || `${gameState.currentInning}th`;
        const halfText = gameState.half === 'top' ? 'TOP' : 'BOTTOM';
        
        const titleText = `${halfText} OF THE ${inningText} INNING`;
        this.ctx.strokeText(titleText, this.canvas.width / 2, boxY + 70);
        this.ctx.fillText(titleText, this.canvas.width / 2, boxY + 70);
        
        // Team batting info
        this.ctx.font = 'bold 32px monospace';
        const battingTeam = gameState.getBattingTeam();
        const battingText = `${battingTeam.toUpperCase()} BATTING`;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.strokeText(battingText, this.canvas.width / 2, boxY + 130);
        this.ctx.fillText(battingText, this.canvas.width / 2, boxY + 130);
        
        // Score display
        this.ctx.font = 'bold 24px monospace';
        const scoreText = `SCORE: ${gameState.awayTeam} ${gameState.score.Red} - ${gameState.score.Blue} ${gameState.homeTeam}`;
        this.ctx.fillStyle = '#cccccc';
        this.ctx.strokeText(scoreText, this.canvas.width / 2, boxY + 190);
        this.ctx.fillText(scoreText, this.canvas.width / 2, boxY + 190);
    }

    drawGameOverScreen(gameState) {
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Determine winner based on player's actual team
        const playerTeam = gameState.getPlayerTeam();
        const computerTeam = gameState.getComputerTeam();
        
        // Get scores for player and computer based on their actual team assignments
        const playerScore = playerTeam === gameState.awayTeam ? gameState.score.Red : gameState.score.Blue;
        const computerScore = computerTeam === gameState.awayTeam ? gameState.score.Red : gameState.score.Blue;
        
        const playerWon = playerScore > computerScore;
        
        this.ctx.font = 'bold 80px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = playerWon ? '#00ff00' : '#ff0000';
        this.ctx.shadowColor = this.ctx.fillStyle;
        this.ctx.shadowBlur = 30;
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 4;
        
        const resultText = playerWon ? 'YOU WON!' : 'YOU LOST!';
        this.ctx.strokeText(resultText, this.canvas.width / 2, this.canvas.height / 2);
        this.ctx.fillText(resultText, this.canvas.width / 2, this.canvas.height / 2);
        
        this.ctx.font = 'bold 36px monospace';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.shadowBlur = 10;
        const finalScore = `Final Score: ${gameState.score.Red} - ${gameState.score.Blue}`;
        this.ctx.strokeText(finalScore, this.canvas.width / 2, this.canvas.height / 2 + 60);
        this.ctx.fillText(finalScore, this.canvas.width / 2, this.canvas.height / 2 + 60);
        this.ctx.shadowBlur = 0;
    }

    drawChampionshipVictoryScreen(gameState, victoryData) {
        // Dark background
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Gold trophy background glow
        const gradient = this.ctx.createRadialGradient(
            this.canvas.width / 2, this.canvas.height / 2,
            50,
            this.canvas.width / 2, this.canvas.height / 2,
            400
        );
        gradient.addColorStop(0, 'rgba(255, 215, 0, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Championship trophy/banner
        this.ctx.font = 'bold 72px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = '#FFD700'; // Gold
        this.ctx.shadowColor = '#FFD700';
        this.ctx.shadowBlur = 40;
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 5;
        
        this.ctx.strokeText('🏆 CHAMPIONSHIP! 🏆', this.canvas.width / 2, 120);
        this.ctx.fillText('🏆 CHAMPIONSHIP! 🏆', this.canvas.width / 2, 120);
        
        // Victory message
        this.ctx.font = 'bold 56px monospace';
        this.ctx.fillStyle = '#00ff00';
        this.ctx.shadowColor = '#00ff00';
        this.ctx.shadowBlur = 25;
        this.ctx.strokeText('YOU ARE THE CHAMPION!', this.canvas.width / 2, 220);
        this.ctx.fillText('YOU ARE THE CHAMPION!', this.canvas.width / 2, 220);
        
        // Team name
        this.ctx.font = 'bold 48px monospace';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.shadowColor = '#ffffff';
        this.ctx.shadowBlur = 15;
        this.ctx.strokeText(victoryData.teamColor.toUpperCase(), this.canvas.width / 2, 300);
        this.ctx.fillText(victoryData.teamColor.toUpperCase(), this.canvas.width / 2, 300);
        
        // Season record box
        const boxWidth = 600;
        const boxHeight = 200;
        const boxX = this.canvas.width / 2 - boxWidth / 2;
        const boxY = 350;
        
        // Box with gradient
        const boxGradient = this.ctx.createLinearGradient(boxX, boxY, boxX, boxY + boxHeight);
        boxGradient.addColorStop(0, 'rgba(255, 215, 0, 0.2)');
        boxGradient.addColorStop(1, 'rgba(139, 69, 19, 0.3)');
        this.ctx.fillStyle = boxGradient;
        this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        
        // Box border
        this.ctx.strokeStyle = '#FFD700';
        this.ctx.lineWidth = 4;
        this.ctx.shadowColor = '#FFD700';
        this.ctx.shadowBlur = 20;
        this.ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
        
        // Season stats
        this.ctx.font = 'bold 36px monospace';
        this.ctx.fillStyle = '#FFD700';
        this.ctx.shadowColor = '#FFD700';
        this.ctx.shadowBlur = 15;
        this.ctx.strokeText('SEASON STATS', this.canvas.width / 2, boxY + 50);
        this.ctx.fillText('SEASON STATS', this.canvas.width / 2, boxY + 50);
        
        // Final record
        this.ctx.font = 'bold 52px monospace';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.shadowColor = '#ffffff';
        this.ctx.shadowBlur = 15;
        const recordText = `Final Record: ${victoryData.finalRecord}`;
        this.ctx.strokeText(recordText, this.canvas.width / 2, boxY + 120);
        this.ctx.fillText(recordText, this.canvas.width / 2, boxY + 120);
        
        // Game final score
        const playerTeam = gameState.getPlayerTeam();
        const playerScore = playerTeam === gameState.awayTeam ? gameState.score.Red : gameState.score.Blue;
        const computerScore = playerTeam === gameState.awayTeam ? gameState.score.Blue : gameState.score.Red;
        
        this.ctx.font = 'bold 32px monospace';
        this.ctx.fillStyle = '#cccccc';
        this.ctx.shadowBlur = 10;
        const finalScore = `Championship Series Won!`;
        this.ctx.strokeText(finalScore, this.canvas.width / 2, boxY + 170);
        this.ctx.fillText(finalScore, this.canvas.width / 2, boxY + 170);
        
        this.ctx.shadowBlur = 0;
    }
}