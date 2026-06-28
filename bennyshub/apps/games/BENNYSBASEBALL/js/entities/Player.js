class Player {
    constructor(x, y, color, type = 'FIELD') {
        this.x = x;
        this.y = y;
        this.baseX = x; // Store original position for idle animation
        this.baseY = y;
        this.color = color;
        this.type = type; // 'FIELD', 'BAT', 'RUN', 'SWING', 'BUNT'
        this.position = '';
        this.size = type === 'RUN' ? 16 : 20;
        this.animation = 0;
        this.swingProgress = 0; // 0 to 1 for swing animation
        this.swingPower = 0;    // Power level for visual feedback
        this.buntProgress = 0;  // 0 to 1 for bunt stance transition
        
        // Random idle animation parameters for natural movement
        this.idleTimer = Math.random() * 1000; // Random start phase
        this.idleSpeed = 0.01 + Math.random() * 0.015; // Random speed (slower)
        this.idleAmplitude = 0.3 + Math.random() * 0.4; // Random amplitude (more subtle)
        this.idleOffsetX = (Math.random() - 0.5) * 0.5; // Slight horizontal variation
    }

    draw(ctx) {
        // Don't interfere with buntProgress if in BUNT mode - animation controls it
        if (this.type !== 'BUNT' && this.buntProgress !== 0) {
            this.buntProgress = 0;
        }
        
        // Add subtle idle animation for field players
        if (this.type === 'FIELD') {
            this.idleTimer++;
            // Each player moves at their own speed and amplitude
            const idleOffsetY = Math.sin(this.idleTimer * this.idleSpeed) * this.idleAmplitude;
            const idleOffsetX = Math.cos(this.idleTimer * this.idleSpeed * 0.7) * this.idleOffsetX;
            this.x = this.baseX + idleOffsetX;
            this.y = this.baseY + idleOffsetY;
        }

        ctx.save();
        
        // Draw shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(this.x, this.y + 12, 8, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw player as retro pixel character
        ctx.fillStyle = this.color;
        
        // Head
        ctx.fillRect(this.x - 4, this.y - 16, 8, 8);
        
        // Body
        ctx.fillRect(this.x - 6, this.y - 8, 12, 10);
        
        // Arms (animated for running players or swinging)
        if (this.type === 'SWING') {
            this.drawSwingingArms(ctx);
        } else {
            const armOffset = this.type === 'RUN' ? Math.sin(this.animation) * 3 : Math.sin(this.animation) * 1;
            ctx.fillRect(this.x - 10, this.y - 6 + armOffset, 4, 8);
            ctx.fillRect(this.x + 6, this.y - 6 - armOffset, 4, 8);
        }
        
        // Legs
        ctx.fillRect(this.x - 6, this.y + 2, 4, 8);
        ctx.fillRect(this.x + 2, this.y + 2, 4, 8);
        
        // Add position label on jersey with better contrast for field players
        if (this.type === 'FIELD' && this.position) {
            // Black background for position text
            ctx.fillStyle = '#000000';
            ctx.fillRect(this.x - 3, this.y - 5, 6, 6);
            
            // White text for position
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 7px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.position, this.x, this.y - 2);
        } else if (this.type === 'BAT' || this.type === 'SWING' || this.type === 'BUNT') {
            // Draw the bat for batting stance, swing, or bunt
            this.drawBat(ctx);
            
            // Batter gets "BAT" label
            ctx.fillStyle = '#000000';
            ctx.fillRect(this.x - 5, this.y - 5, 10, 6);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 6px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('BAT', this.x, this.y - 2);
        }
        
        // Add running animation effects for running players
        if (this.type === 'RUN') {
            // Add motion blur effect with player color
            ctx.fillStyle = this.color + '40'; // Semi-transparent
            ctx.fillRect(this.x - 7, this.y - 12, 6, 6); // Trailing head
            ctx.fillRect(this.x - 8, this.y - 4, 8, 6);  // Trailing body
            
            // Add dust trail effect
            ctx.fillStyle = 'rgba(139, 105, 20, 0.3)';
            for (let i = 0; i < 3; i++) {
                const trailX = this.x - (i + 1) * 8;
                const trailY = this.y + 8 + Math.random() * 4;
                ctx.beginPath();
                ctx.arc(trailX, trailY, 2 - i * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        
        // Increment animation for next frame
        this.animation += this.type === 'RUN' ? 0.2 : 0.05;
        
        ctx.restore();
    }

    drawBat(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y - 4);
        
        // Calculate bat rotation based on swing progress or bunt stance
        let batAngle;
        const startBatAngle = -Math.PI * 0.75; // Up-Left (Back Stance)

        if (this.type === 'BUNT') {
            console.log('Player.drawBat - BUNT detected, setting angle to 0');
            // Bunt stance: Animate from back position to horizontal
            // Start at -135 degrees (startBatAngle), end at 0 degrees (horizontal/pointing at pitcher)
            const targetBuntAngle = 0;
            batAngle = startBatAngle + (this.buntProgress * (targetBuntAngle - startBatAngle));
        } else if (this.type === 'SWING' && this.swingProgress > 0) {
            // Swing animation: Counter-Clockwise rotation
            // Start at -135 degrees (Up-Left)
            // End at -405 degrees (Up-Right / Follow Through)
            const finishAngle = -Math.PI * 2.25; 
            batAngle = startBatAngle + (this.swingProgress * (finishAngle - startBatAngle));
        } else {
            // Ready/waiting position
            batAngle = startBatAngle; 
        }
        
        ctx.rotate(batAngle);
        
        // Draw bat as a single shape
        ctx.fillStyle = '#D2691E'; // Wood color
        ctx.strokeStyle = '#5D2906'; // Darker outline
        ctx.lineWidth = 1;

        ctx.beginPath();
        // Handle (thin)
        ctx.moveTo(0, -1.5);
        ctx.lineTo(6, -1.5);
        // Taper to barrel
        ctx.lineTo(10, -3);
        // Barrel (thick)
        ctx.lineTo(22, -3);
        // Tip (rounded)
        ctx.bezierCurveTo(24, -3, 24, 3, 22, 3);
        // Return path
        // Barrel bottom
        ctx.lineTo(10, 3);
        // Taper in
        ctx.lineTo(6, 1.5);
        // Handle bottom
        ctx.lineTo(0, 1.5);
        ctx.closePath();
        
        ctx.fill();
        ctx.stroke();
        
        // Add swing effect if actively swinging
        if (this.type === 'SWING' && this.swingProgress > 0.2 && this.swingProgress < 0.8) {
            // Motion blur effect
            ctx.fillStyle = 'rgba(210, 105, 30, 0.3)';
            ctx.fillRect(6, -6, 16, 12);
            
            // Swing trail
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 24, -0.3, 0.3);
            ctx.stroke();
        }
        
        ctx.restore();
    }

    drawSwingingArms(ctx) {
        // Arms position based on swing progress
        const swingOffset = Math.sin(this.swingProgress * Math.PI) * 10;
        
        // Back arm (follows through with swing)
        ctx.fillRect(this.x - 10 + swingOffset, this.y - 6, 4, 8);
        
        // Front arm (leads the swing)
        ctx.fillRect(this.x + 6 + swingOffset * 0.5, this.y - 8 + swingOffset * 0.3, 4, 8);
    }

    setPosition(position) {
        this.position = position;
    }
    
    // Set swing animation state
    setSwingProgress(progress) {
        this.swingProgress = Math.max(0, Math.min(1, progress));
    }
    
    setSwingPower(power) {
        this.swingPower = Math.max(0, Math.min(1, power));
    }
    
    // Start a swing animation
    startSwing() {
        this.type = 'SWING';
        this.swingProgress = 0;
    }
    
    // Update swing animation (call each frame)
    updateSwingAnimation(deltaProgress) {
        if (this.type === 'SWING') {
            this.swingProgress = Math.min(1, this.swingProgress + deltaProgress);
            return this.swingProgress >= 1; // Return true when complete
        }
        return false;
    }
    
    // Animate fielder moving to a target position and returning
    moveToPosition(targetX, targetY, duration, callback) {
        const originalX = this.baseX;
        const originalY = this.baseY;
        const startTime = Date.now();
        const moveDuration = duration * 0.6; // 60% of time to reach target
        const returnDuration = duration * 0.4; // 40% to return
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const totalDuration = moveDuration + returnDuration;
            
            if (elapsed < moveDuration) {
                // Moving to catch position
                const progress = Math.min(elapsed / moveDuration, 1);
                const easeProgress = 1 - Math.pow(1 - progress, 3);
                
                this.x = originalX + (targetX - originalX) * easeProgress;
                this.y = originalY + (targetY - originalY) * easeProgress;
                
                requestAnimationFrame(animate);
            } else if (elapsed < totalDuration) {
                // Returning to original position
                const returnProgress = Math.min((elapsed - moveDuration) / returnDuration, 1);
                const easeProgress = returnProgress < 0.5 
                    ? 2 * returnProgress * returnProgress 
                    : 1 - Math.pow(-2 * returnProgress + 2, 2) / 2;
                
                this.x = targetX + (originalX - targetX) * easeProgress;
                this.y = targetY + (originalY - targetY) * easeProgress;
                
                requestAnimationFrame(animate);
            } else {
                // Ensure we end exactly at original position
                this.x = originalX;
                this.y = originalY;
                this.baseX = originalX;
                this.baseY = originalY;
                if (callback) callback();
            }
        };
        
        animate();
    }
}