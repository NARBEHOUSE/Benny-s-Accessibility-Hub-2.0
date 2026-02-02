class AnimationSystem {
    constructor(game) {
        this.game = game;
    }

    drawBallFlightAndThrow(from, outcome, callback) {
        try {
            const targetInfo = this.getFielderPosition(outcome);
            if (!targetInfo) {
                this.safeCallback(callback);
                return;
            }
            
            const to = { x: targetInfo.x, y: targetInfo.y };
            const fielder = targetInfo.player;
            
            // Always start ball animation from home plate coordinates for batting plays
            let ballStartPos = from;
            if (this.game.gameState.fieldCoords) {
                // Use home plate as the starting position for all batted balls
                ballStartPos = { 
                    x: this.game.gameState.fieldCoords.home.x, 
                    y: this.game.gameState.fieldCoords.home.y 
                };
            }
            
            if (outcome === 'Ground Out' || outcome === 'Double Play') {
                this.drawGroundBall(ballStartPos, to, fielder, callback);
            } else {
                this.drawBallArc(ballStartPos, to, 1200, () => {
                    if (fielder && ['Pop Fly Out', 'Ground Out', 'Double Play'].includes(outcome)) {
                        this.game.audioSystem.speak(`Caught by ${fielder.position}`);
                    }
                    this.safeCallback(callback);
                });
            }
        } catch (error) {
            console.error('Animation error:', error);
            this.safeCallback(callback);
        }
    }

    getFielderPosition(outcome) {
        if (!this.game.gameState.fieldCoords || !this.game.fieldRenderer.fieldPlayers) return null;
        
        const fieldPlayers = this.game.fieldRenderer.fieldPlayers;
        let targetPlayer = null;
        
        if (outcome === 'Pop Fly Out') {
            const outfielders = fieldPlayers.filter(p => ['LF', 'CF', 'RF'].includes(p.position));
            targetPlayer = outfielders[Math.floor(Math.random() * outfielders.length)];
        } else if (outcome === 'Ground Out' || outcome === 'Double Play') {
            const infielders = fieldPlayers.filter(p => ['1B', '2B', 'SS', '3B'].includes(p.position));
            targetPlayer = infielders[Math.floor(Math.random() * infielders.length)];
        } else if (outcome === 'Single') {
            const coords = this.game.gameState.fieldCoords;
            const size = this.game.gameState.diamondSize;
            const gapOptions = [
                { x: coords.first.x - size * 0.3, y: coords.first.y + size * 0.2 },
                { x: coords.third.x + size * 0.3, y: coords.third.y + size * 0.2 },
                { x: coords.second.x + size * 0.1, y: coords.second.y + size * 0.3 }
            ];
            return gapOptions[Math.floor(Math.random() * gapOptions.length)];
        } else if (outcome === 'Double') {
            const coords = this.game.gameState.fieldCoords;
            const size = this.game.gameState.diamondSize;
            const gapOptions = [
                { x: coords.first.x + size * 0.3, y: coords.first.y - size * 0.4 },
                { x: coords.third.x - size * 0.3, y: coords.third.y - size * 0.4 },
                { x: coords.second.x, y: coords.second.y - size * 0.5 }
            ];
            return gapOptions[Math.floor(Math.random() * gapOptions.length)];
        } else if (outcome === 'Triple') {
            const coords = this.game.gameState.fieldCoords;
            const size = this.game.gameState.diamondSize;
            const gapOptions = [
                { x: coords.first.x + size * 0.6, y: coords.first.y - size * 0.6 },
                { x: coords.third.x - size * 0.6, y: coords.third.y - size * 0.6 },
                { x: coords.second.x, y: coords.second.y - size * 0.8 }
            ];
            return gapOptions[Math.floor(Math.random() * gapOptions.length)];
        } else if (outcome === 'Home Run') {
            const coords = this.game.gameState.fieldCoords;
            return { x: coords.second.x, y: coords.second.y - this.game.gameState.diamondSize * 1.2 };
        } else if (outcome === 'Foul') {
            const coords = this.game.gameState.fieldCoords;
            const isLeft = Math.random() < 0.5;
            return {
                x: coords.home.x + (isLeft ? -200 : 200),
                y: coords.home.y + 100
            };
        }
        
        return targetPlayer ? { x: targetPlayer.x, y: targetPlayer.y, player: targetPlayer } : null;
    }

    drawBallArc(from, to, duration, callback) {
        const startTime = Date.now();
        const ballSize = 8;
        const distance = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
        const arcHeight = Math.min(150, distance * 0.3);

        // Add timeout to prevent infinite animation
        const timeoutId = setTimeout(() => {
            console.warn('Ball arc animation timeout, forcing completion');
            this.game.gameState.animating = false;
            this.safeCallback(callback);
        }, duration + 1000);

        const animate = () => {
            try {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                const currentX = from.x + (to.x - from.x) * progress;
                const baseY = from.y + (to.y - from.y) * progress;
                const arcOffset = Math.sin(progress * Math.PI) * arcHeight;
                const currentY = baseY - arcOffset;

                this.game.fieldRenderer.drawField(this.game.gameState);
                this.game.fieldRenderer.drawPlayers();
                this.game.uiRenderer.drawScoreboard(this.game.gameState);
                
                // Draw ball shadow on ground
                const shadowY = from.y + (to.y - from.y) * progress;
                const shadowSize = ballSize * (1 - arcOffset / (arcHeight + 50));
                this.game.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                this.game.ctx.beginPath();
                this.game.ctx.ellipse(from.x + (to.x - from.x) * progress, shadowY, shadowSize / 2, shadowSize / 4, 0, 0, Math.PI * 2);
                this.game.ctx.fill();

                // Draw ball with glow
                this.game.ctx.shadowColor = GAME_CONSTANTS.COLORS.ballWhite;
                this.game.ctx.shadowBlur = 10;
                this.game.ctx.fillStyle = GAME_CONSTANTS.COLORS.ballWhite;
                this.game.ctx.beginPath();
                this.game.ctx.arc(currentX, currentY, ballSize / 2, 0, Math.PI * 2);
                this.game.ctx.fill();
                this.game.ctx.shadowBlur = 0;

                // Draw ball seams
                this.game.ctx.strokeStyle = '#cccccc';
                this.game.ctx.lineWidth = 1;
                this.game.ctx.beginPath();
                this.game.ctx.arc(currentX, currentY, ballSize / 2 - 1, 0, Math.PI, false);
                this.game.ctx.stroke();
                this.game.ctx.beginPath();
                this.game.ctx.arc(currentX, currentY, ballSize / 2 - 1, Math.PI, Math.PI * 2, false);
                this.game.ctx.stroke();

                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    clearTimeout(timeoutId);
                    this.game.gameState.animating = false;
                    this.safeCallback(callback);
                }
            } catch (error) {
                console.error('Ball arc animation error:', error);
                clearTimeout(timeoutId);
                this.game.gameState.animating = false;
                this.safeCallback(callback);
            }
        };

        this.game.gameState.animating = true;
        animate();
    }

    drawGroundBall(from, to, fielder, callback) {
        const startTime = Date.now();
        const duration = 1000;
        const ballSize = 8;
        const bounceCount = 3;
        
        // Add timeout to prevent infinite animation
        const timeoutId = setTimeout(() => {
            console.warn('Ground ball animation timeout, forcing completion');
            this.game.gameState.animating = false;
            this.safeCallback(callback);
        }, duration + 1000);
        
        const animate = () => {
            try {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                const currentX = from.x + (to.x - from.x) * progress;
                const currentY = from.y + (to.y - from.y) * progress;
                
                // Calculate bounce
                const bounceProgress = (progress * bounceCount) % 1;
                const bounceHeight = Math.sin(bounceProgress * Math.PI) * (20 - progress * 15);

                this.game.fieldRenderer.drawField(this.game.gameState);
                this.game.fieldRenderer.drawPlayers();
                this.game.uiRenderer.drawScoreboard(this.game.gameState);
                
                // Draw ball shadow
                this.game.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                this.game.ctx.beginPath();
                this.game.ctx.ellipse(currentX, currentY, ballSize / 2, ballSize / 4, 0, 0, Math.PI * 2);
                this.game.ctx.fill();

                // Draw bouncing ball
                this.game.ctx.fillStyle = GAME_CONSTANTS.COLORS.ballWhite;
                this.game.ctx.beginPath();
                this.game.ctx.arc(currentX, currentY - bounceHeight, ballSize / 2, 0, Math.PI * 2);
                this.game.ctx.fill();

                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    clearTimeout(timeoutId);
                    this.game.gameState.animating = false;
                    // Always announce fielder for ground outs, regardless of who's batting
                    if (fielder && fielder.position) {
                        this.game.audioSystem.speak(`Fielded by ${fielder.position}`);
                    }
                    this.safeCallback(callback);
                }
            } catch (error) {
                console.error('Ground ball animation error:', error);
                clearTimeout(timeoutId);
                this.game.gameState.animating = false;
                this.safeCallback(callback);
            }
        };

        this.game.gameState.animating = true;
        animate();
    }

    drawPitchAnimation(pitchType, location, callback) {
        try {
            if (!this.game.gameState.fieldCoords) {
                this.safeCallback(callback);
                return;
            }

            const coords = this.game.gameState.fieldCoords;
            // Use the pitcher mound coordinate (center of diamond)
            const from = { x: coords.pitcher.x, y: coords.pitcher.y };
            const to = { x: coords.home.x, y: coords.home.y - 20 }; // Slightly above home plate
            
            // Adjust target based on pitch location
            if (location === 'Inside') {
                to.x -= 15;
            } else if (location === 'Outside') {
                to.x += 15;
            }
            
            const startTime = Date.now();
            const duration = this.getPitchDuration(pitchType);
            const ballSize = 8;
            
            // Add timeout to prevent infinite animation
            const timeoutId = setTimeout(() => {
                console.warn('Pitch animation timeout, forcing completion');
                this.game.gameState.animating = false;
                this.safeCallback(callback);
            }, duration + 1000);

            const animate = () => {
                try {
                    const elapsed = Date.now() - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    
                    // Calculate ball position with pitch-specific movement
                    const { x: currentX, y: currentY } = this.calculatePitchMovement(
                        from, to, progress, pitchType
                    );

                    // Redraw field and players
                    this.game.fieldRenderer.drawField(this.game.gameState);
                    this.game.fieldRenderer.drawPlayers();
                    this.game.uiRenderer.drawScoreboard(this.game.gameState);
                    
                    // Draw ball shadow on ground
                    const shadowY = from.y + (to.y - from.y) * progress + 20;
                    this.game.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                    this.game.ctx.beginPath();
                    this.game.ctx.ellipse(currentX, shadowY, ballSize / 2, ballSize / 4, 0, 0, Math.PI * 2);
                    this.game.ctx.fill();

                    // Draw pitch trail based on type
                    this.drawPitchTrail(from, { x: currentX, y: currentY }, pitchType, progress);

                    // Draw ball with glow
                    this.game.ctx.shadowColor = GAME_CONSTANTS.COLORS.ballWhite;
                    this.game.ctx.shadowBlur = 8;
                    this.game.ctx.fillStyle = GAME_CONSTANTS.COLORS.ballWhite;
                    this.game.ctx.beginPath();
                    this.game.ctx.arc(currentX, currentY, ballSize / 2, 0, Math.PI * 2);
                    this.game.ctx.fill();
                    this.game.ctx.shadowBlur = 0;

                    // Draw ball seams with rotation
                    const rotation = progress * Math.PI * 8; // Fast rotation
                    this.game.ctx.strokeStyle = '#cccccc';
                    this.game.ctx.lineWidth = 1;
                    this.game.ctx.save();
                    this.game.ctx.translate(currentX, currentY);
                    this.game.ctx.rotate(rotation);
                    this.game.ctx.beginPath();
                    this.game.ctx.arc(0, 0, ballSize / 2 - 1, 0, Math.PI, false);
                    this.game.ctx.stroke();
                    this.game.ctx.beginPath();
                    this.game.ctx.arc(0, 0, ballSize / 2 - 1, Math.PI, Math.PI * 2, false);
                    this.game.ctx.stroke();
                    this.game.ctx.restore();

                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    } else {
                        clearTimeout(timeoutId);
                        this.game.gameState.animating = false;
                        this.safeCallback(callback);
                    }
                } catch (error) {
                    console.error('Pitch animation error:', error);
                    clearTimeout(timeoutId);
                    this.game.gameState.animating = false;
                    this.safeCallback(callback);
                }
            };

            this.game.gameState.animating = true;
            animate();
        } catch (error) {
            console.error('Pitch animation initialization error:', error);
            this.safeCallback(callback);
        }
    }

    getPitchDuration(pitchType) {
        switch (pitchType) {
            case 'Fastball': return 600;
            case 'Changeup': return 900;
            case 'Curveball': return 800;
            case 'Slider': return 700;
            case 'Knuckleball': return 1000;
            default: return 700;
        }
    }

    calculatePitchMovement(from, to, progress, pitchType) {
        const baseX = from.x + (to.x - from.x) * progress;
        const baseY = from.y + (to.y - from.y) * progress;
        
        switch (pitchType) {
            case 'Curveball':
                // Curves down and to the side
                const curveOffset = Math.sin(progress * Math.PI) * 25;
                return {
                    x: baseX + curveOffset,
                    y: baseY + Math.sin(progress * Math.PI * 0.5) * 15
                };
                
            case 'Slider':
                // Sharp horizontal break late
                const sliderBreak = progress > 0.7 ? (progress - 0.7) * 40 : 0;
                return {
                    x: baseX + sliderBreak,
                    y: baseY
                };
                
            case 'Knuckleball':
                // Erratic movement
                const wobbleX = Math.sin(progress * Math.PI * 6) * 8;
                const wobbleY = Math.cos(progress * Math.PI * 4) * 6;
                return {
                    x: baseX + wobbleX,
                    y: baseY + wobbleY
                };
                
            case 'Changeup':
                // Slight drop at the end
                const dropOffset = progress > 0.8 ? (progress - 0.8) * 30 : 0;
                return {
                    x: baseX,
                    y: baseY + dropOffset
                };
                
            case 'Fastball':
            default:
                // Straight line
                return { x: baseX, y: baseY };
        }
    }

    drawPitchTrail(from, current, pitchType, progress) {
        const ctx = this.game.ctx;
        const trailLength = 5;
        const alpha = 0.3;
        
        // Different trail colors for different pitches
        let trailColor;
        switch (pitchType) {
            case 'Fastball': trailColor = 'rgba(255, 255, 255,'; break;
            case 'Curveball': trailColor = 'rgba(255, 255, 0,'; break;
            case 'Slider': trailColor = 'rgba(255, 128, 0,'; break;
            case 'Changeup': trailColor = 'rgba(128, 255, 128,'; break;
            case 'Knuckleball': trailColor = 'rgba(255, 128, 255,'; break;
            default: trailColor = 'rgba(255, 255, 255,'; break;
        }
        
        // Draw trail segments
        for (let i = 0; i < trailLength; i++) {
            const trailProgress = Math.max(0, progress - (i * 0.05));
            if (trailProgress <= 0) break;
            
            const trailPos = this.calculatePitchMovement(from, 
                { x: current.x + (from.x - current.x) * 0.1, y: current.y + (from.y - current.y) * 0.1 }, 
                trailProgress, pitchType);
            
            const segmentAlpha = alpha * (1 - i / trailLength) * trailProgress;
            ctx.fillStyle = trailColor + segmentAlpha + ')';
            ctx.beginPath();
            ctx.arc(trailPos.x, trailPos.y, 3 - i * 0.3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    startRunnerAnimation(outcome, callback) {
        try {
            const currentBases = { ...this.game.gameState.bases };
            const runnerData = this.createAllRunnerPaths(outcome, currentBases);
            
            if (runnerData.length === 0) {
                this.safeCallback(callback);
                return;
            }

            this.game.gameState.runnerAnimation.active = true;
            this.game.gameState.runnerAnimation.runners = runnerData.map(data => ({
                id: data.id,
                player: new Player(data.path[0].x, data.path[0].y, data.color, 'RUN'),
                path: data.path,
                pathIndex: 0,
                progress: 0,
                speed: 0.012, // Slightly faster for better visibility
                pauseTime: 0,
                pauseDuration: 400, // Shorter pause at bases
                completed: false
            }));
            
            this.game.gameState.runnerAnimation.completedAnimations = 0;
            this.game.gameState.runnerAnimation.totalAnimations = this.game.gameState.runnerAnimation.runners.length;
            this.game.gameState.animating = true;
            
            // Add timeout for runner animations
            setTimeout(() => {
                if (this.game.gameState.runnerAnimation.active) {
                    console.warn('Runner animation timeout, forcing completion');
                    this.game.gameState.runnerAnimation.active = false;
                    this.game.gameState.animating = false;
                    this.safeCallback(callback);
                }
            }, 10000); // 10 second timeout
            
            this.animateAllRunners(callback);
        } catch (error) {
            console.error('Runner animation error:', error);
            this.game.gameState.runnerAnimation.active = false;
            this.game.gameState.animating = false;
            this.safeCallback(callback);
        }
    }

    createAllRunnerPaths(outcome, currentBases) {
        if (!this.game.gameState.fieldCoords) return [];
        
        const coords = this.game.gameState.fieldCoords;
        const runners = [];
        
        // Determine the correct colors based on who is currently batting
        const gameState = this.game.gameState;
        const battingTeam = gameState.getBattingTeam();
        
        // Get the actual batting team color (not hardcoded Red/Blue)
        let batterColor;
        if (battingTeam === gameState.awayTeam) {
            // Away team is batting - use Red color
            batterColor = GAME_CONSTANTS.COLORS.playerRed;
        } else {
            // Home team is batting - use Blue color
            batterColor = GAME_CONSTANTS.COLORS.playerBlue;
        }
        
        // Helper function to get runner color based on runner type
        const getRunnerColor = (runnerType) => {
            if (runnerType === 'user') {
                // User runner - check if user's team is currently batting
                const userTeam = gameState.getPlayerTeam();
                if (userTeam === battingTeam) {
                    // User is batting, use batting team color
                    return batterColor;
                } else {
                    // User is fielding, but this runner was placed when user was batting
                    // Use the user's actual team color
                    if (userTeam === gameState.awayTeam) {
                        return GAME_CONSTANTS.COLORS.playerRed;
                    } else {
                        return GAME_CONSTANTS.COLORS.playerBlue;
                    }
                }
            } else if (runnerType === 'comp') {
                // Computer runner - check if computer's team is currently batting
                const compTeam = gameState.getComputerTeam();
                if (compTeam === battingTeam) {
                    // Computer is batting, use batting team color
                    return batterColor;
                } else {
                    // Computer is fielding, but this runner was placed when computer was batting
                    // Use the computer's actual team color
                    if (compTeam === gameState.awayTeam) {
                        return GAME_CONSTANTS.COLORS.playerRed;
                    } else {
                        return GAME_CONSTANTS.COLORS.playerBlue;
                    }
                }
            } else {
                // Fallback - use current batting team color
                return batterColor;
            }
        };
        
        // ...existing code for steal logic...
        
        if (outcome === 'Steal Second') {
            if (currentBases.first) {
                runners.push({
                    id: 'first_to_second',
                    color: getRunnerColor(currentBases.first),
                    path: [coords.first, coords.second]
                });
            }
        } else if (outcome === 'Steal Third') {
            if (currentBases.second) {
                runners.push({
                    id: 'second_to_third',
                    color: getRunnerColor(currentBases.second),
                    path: [coords.second, coords.third]
                });
            }
        } else if (['Single', 'Double', 'Triple', 'Home Run'].includes(outcome)) {
            // For singles, only show animations for runners that actually advance due to force rules
            if (outcome === 'Single') {
                // Third base runner only advances (and shows animation) if forced by BOTH second AND first base runners
                if (currentBases.third && currentBases.second && currentBases.first) {
                    runners.push({
                        id: 'third_to_home',
                        color: getRunnerColor(currentBases.third),
                        path: [coords.third, coords.home]
                    });
                }
                
                // Second base runner only advances if forced by first base runner AND third is now empty
                if (currentBases.second && currentBases.first) {
                    // Only show animation if third wasn't occupied or was forced home
                    if (!currentBases.third || (currentBases.third && currentBases.second && currentBases.first)) {
                        runners.push({
                            id: 'second_to_third',
                            color: getRunnerColor(currentBases.second),
                            path: [coords.second, coords.third]
                        });
                    }
                }
                
                // First base runner always advances to second (forced by batter)
                if (currentBases.first) {
                    runners.push({
                        id: 'first_to_second',
                        color: getRunnerColor(currentBases.first),
                        path: [coords.first, coords.second]
                    });
                }
            } else {
                if (currentBases.third) {
                    runners.push({
                        id: 'third_to_home',
                        color: getRunnerColor(currentBases.third),
                        path: [coords.third, coords.home]
                    });
                }
                
                if (currentBases.second) {
                    if (outcome === 'Double') {
                        runners.push({
                            id: 'second_to_home',
                            color: getRunnerColor(currentBases.second),
                            path: [coords.second, coords.third, coords.home]
                        });
                    } else {
                        runners.push({
                            id: 'second_to_home',
                            color: getRunnerColor(currentBases.second),
                            path: [coords.second, coords.third, coords.home]
                        });
                    }
                }
                
                if (currentBases.first) {
                    if (outcome === 'Double') {
                        runners.push({
                            id: 'first_to_third',
                            color: getRunnerColor(currentBases.first),
                            path: [coords.first, coords.second, coords.third]
                        });
                    } else {
                        runners.push({
                            id: 'first_to_home',
                            color: getRunnerColor(currentBases.first),
                            path: [coords.first, coords.second, coords.third, coords.home]
                        });
                    }
                }
            }
            
            // Batter runs (uses current batting team color)
            const batterPath = [{ x: coords.home.x - 40, y: coords.home.y }];
            const firstApproach = { x: coords.first.x - 20, y: coords.first.y + 20 };
            batterPath.push(firstApproach, coords.first);
            
            if (['Double', 'Triple', 'Home Run'].includes(outcome)) {
                batterPath.push(coords.second);
            }
            if (['Triple', 'Home Run'].includes(outcome)) {
                batterPath.push(coords.third);
            }
            if (outcome === 'Home Run') {
                batterPath.push(coords.home);
            }
            
            runners.push({
                id: 'batter',
                color: batterColor,
                path: batterPath
            });
        } else if (outcome === 'Walk') {
            // Force advance - only runners that are forced move, using their original colors
            if (currentBases.first) {
                if (currentBases.second) {
                    if (currentBases.third) {
                        // Bases loaded - runner on third scores
                        runners.push({
                            id: 'third_to_home',
                            color: getRunnerColor(currentBases.third),
                            path: [coords.third, coords.home]
                        });
                    }
                    // Runner on second advances to third
                    runners.push({
                        id: 'second_to_third',
                        color: getRunnerColor(currentBases.second),
                        path: [coords.second, coords.third]
                    });
                }
                // Runner on first advances to second
                runners.push({
                    id: 'first_to_second',
                    color: getRunnerColor(currentBases.first),
                    path: [coords.first, coords.second]
                });
            }
            
            // Batter takes first base (uses current batting team color)
            runners.push({
                id: 'batter_walk',
                color: batterColor,
                path: [{ x: coords.home.x - 40, y: coords.home.y }, coords.first]
            });
        }
        
        return runners;
    }

    animateAllRunners(callback) {
        if (!this.game.gameState.runnerAnimation.active) {
            this.safeCallback(callback);
            return;
        }
        
        try {
            const currentTime = Date.now();
            let allCompleted = true;
            
            this.game.gameState.runnerAnimation.runners.forEach(runner => {
                if (!runner.completed) {
                    allCompleted = false;
                    
                    if (runner.pauseTime > 0) {
                        runner.pauseTime -= 16;
                        return;
                    }
                    
                    if (runner.pathIndex < runner.path.length - 1) {
                        const start = runner.path[runner.pathIndex];
                        const end = runner.path[runner.pathIndex + 1];
                        
                        runner.progress += runner.speed;
                        const easedProgress = this.easeInOutQuad(Math.min(runner.progress, 1));
                        
                        runner.player.x = start.x + (end.x - start.x) * easedProgress;
                        runner.player.y = start.y + (end.y - start.y) * easedProgress;
                        
                        if (runner.progress >= 1) {
                            runner.pathIndex++;
                            runner.progress = 0;
                            
                            if (runner.pathIndex < runner.path.length - 1) {
                                runner.pauseTime = runner.pauseDuration;
                            }
                        }
                    } else {
                        runner.completed = true;
                        this.game.gameState.runnerAnimation.completedAnimations++;
                    }
                }
            });
            
            // Render the scene
            this.game.fieldRenderer.drawField(this.game.gameState);
            this.game.fieldRenderer.drawPlayers();
            this.drawAllRunningPlayers();
            this.game.uiRenderer.drawScoreboard(this.game.gameState);
            
            if (allCompleted) {
                this.game.gameState.runnerAnimation.active = false;
                this.game.gameState.animating = false;
                this.safeCallback(callback);
            } else {
                requestAnimationFrame(() => this.animateAllRunners(callback));
            }
        } catch (error) {
            console.error('All runners animation error:', error);
            this.game.gameState.runnerAnimation.active = false;
            this.game.gameState.animating = false;
            this.safeCallback(callback);
        }
    }

    drawAllRunningPlayers() {
        if (this.game.gameState.runnerAnimation.active) {
            this.game.gameState.runnerAnimation.runners.forEach(runner => {
                if (!runner.completed && runner.player) {
                    // Make sure the runner player uses the RUN type for proper animation effects
                    runner.player.type = 'RUN';
                    runner.player.draw(this.game.ctx);
                }
            });
        }
    }

    easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    // Safe callback execution with error handling
    safeCallback(callback) {
        if (typeof callback === 'function') {
            try {
                callback();
            } catch (error) {
                console.error('Callback execution error:', error);
            }
        }
    }

    // Add this new method for failed steal animations
    drawFailedStealAnimation(base, callback) {
        try {
            if (!this.game.gameState.fieldCoords || !this.game.fieldRenderer.fieldPlayers) {
                this.safeCallback(callback);
                return;
            }

            const coords = this.game.gameState.fieldCoords;
            const fieldPlayers = this.game.fieldRenderer.fieldPlayers;
            
            // Find the appropriate fielder based on which base the steal was attempted to
            let targetFielder;
            if (base === 'second') {
                // Steal attempt to 2nd base - pitcher throws to 2nd baseman
                targetFielder = fieldPlayers.find(p => p.position === '2B');
            } else if (base === 'third') {
                // Steal attempt to 3rd base - pitcher throws to 3rd baseman
                targetFielder = fieldPlayers.find(p => p.position === '3B');
            }
            
            if (!targetFielder) {
                this.safeCallback(callback);
                return;
            }

            // Pitcher throws to the base
            const from = coords.pitcher;
            const to = { x: targetFielder.x, y: targetFielder.y };
            
            this.drawBallArc(from, to, 800, () => {
                this.game.audioSystem.speak(`Thrown out trying to steal ${base === 'second' ? 'second base' : 'third base'}!`);
                this.safeCallback(callback);
            });
        } catch (error) {
            console.error('Failed steal animation error:', error);
            this.safeCallback(callback);
        }
    }
}