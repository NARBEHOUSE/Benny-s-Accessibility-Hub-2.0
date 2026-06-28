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

    // Old drawSwingMenu removed - now using drawStealMenu for batting phase

    drawStealMenu() {
        this.game.fieldRenderer.drawField(this.game.gameState);
        this.game.fieldRenderer.drawPlayers();
        this.game.uiRenderer.drawScoreboard(this.game.gameState);
        
        this.drawGameMenuPanel(this.game.gameState.menuOptions, this.game.gameState.selectedIndex, "STEAL OR BAT?");
    }

    drawPitchMenu() {
        // Don't draw if pitch grid is cleared (transition in progress)
        if (!this.game.gameState.pitchGrid) {
            // Just draw the field without menu
            this.game.fieldRenderer.drawField(this.game.gameState);
            this.game.fieldRenderer.drawPlayers();
            this.game.uiRenderer.drawScoreboard(this.game.gameState);
            return;
        }
        
        this.game.fieldRenderer.drawField(this.game.gameState);
        this.game.fieldRenderer.drawPlayers();
        this.game.uiRenderer.drawScoreboard(this.game.gameState);
        
        this.drawGameMenuPanel(this.game.gameState.menuOptions, this.game.gameState.selectedIndex, "CHOOSE PITCH");
    }
    
    drawPitchGridMenu() {
        this.game.fieldRenderer.drawField(this.game.gameState);
        this.game.fieldRenderer.drawPlayers();
        this.game.uiRenderer.drawScoreboard(this.game.gameState);
        
        const ctx = this.game.ctx;
        const canvas = this.game.canvas;
        const gameState = this.game.gameState;
        const grid = gameState.pitchGrid;
        
        if (!grid) return;
        
        const size = 200; // Size of the square
        const padding = 15;
        const menuX = 20;
        const menuY = canvas.height / 2 - size / 2 - 40;
        
        gameState.menuBounds = [];
        gameState.pitchZoneBounds = [];
        
        // Draw title
        ctx.font = 'bold 18px monospace';
        ctx.fillStyle = GAME_CONSTANTS.COLORS.menuBorder;
        ctx.textAlign = 'center';
        ctx.fillText('CHOOSE PITCH', menuX + size / 2 + padding, menuY);
        
        // Draw background
        const bgGradient = ctx.createLinearGradient(menuX, menuY + 20, menuX, menuY + 20 + size + padding * 2);
        bgGradient.addColorStop(0, GAME_CONSTANTS.COLORS.menuBg);
        bgGradient.addColorStop(1, 'rgba(10, 15, 30, 0.95)');
        ctx.fillStyle = bgGradient;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 20;
        ctx.fillRect(menuX, menuY + 20, size + padding * 2, size + padding * 2 + 50);
        ctx.shadowBlur = 0;
        
        ctx.strokeStyle = GAME_CONSTANTS.COLORS.menuBorder;
        ctx.lineWidth = 3;
        ctx.strokeRect(menuX, menuY + 20, size + padding * 2, size + padding * 2 + 50);
        
        // Square area starts here
        const squareX = menuX + padding;
        const squareY = menuY + 35;
        const centerX = squareX + size / 2;
        const centerY = squareY + size / 2;
        
        // Corner points
        const topLeft = { x: squareX, y: squareY };
        const topRight = { x: squareX + size, y: squareY };
        const bottomRight = { x: squareX + size, y: squareY + size };
        const bottomLeft = { x: squareX, y: squareY + size };
        
        // Edge midpoints (where corner curves meet the center)
        const topMid = { x: centerX, y: squareY };
        const rightMid = { x: squareX + size, y: centerY };
        const bottomMid = { x: centerX, y: squareY + size };
        const leftMid = { x: squareX, y: centerY };
        
        // Create a gradient across the entire pitch selector based on effectiveness
        // Find min and max effectiveness to determine gradient direction
        let bestZoneIndex = 0;
        let worstZoneIndex = 0;
        for (let i = 0; i < 5; i++) {
            if (grid[i].effectiveness > grid[bestZoneIndex].effectiveness) bestZoneIndex = i;
            if (grid[i].effectiveness < grid[worstZoneIndex].effectiveness) worstZoneIndex = i;
        }
        
        // Get the zone positions for gradient calculation
        const zoneCenters = [
            { x: squareX + size * 0.22, y: squareY + size * 0.22 },  // Top-left (High Inside)
            { x: squareX + size * 0.78, y: squareY + size * 0.22 },  // Top-right (High Outside)
            { x: squareX + size * 0.78, y: squareY + size * 0.78 },  // Bottom-right (Low Outside)
            { x: squareX + size * 0.22, y: squareY + size * 0.78 },  // Bottom-left (Low Inside)
            { x: centerX, y: centerY }                               // Center
        ];
        
        let mainGradient;
        
        // Colorblind-friendly gradient: Dark Purple/Blue (worst) → Light Blue → White/Yellow (best)
        // This uses luminance differences which are visible to all color vision types
        
        if (bestZoneIndex === 4) {
            // Center is best - use radial gradient going outward (bright center → dark edges)
            const outerRadius = size * 0.75;
            mainGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, outerRadius);
            mainGradient.addColorStop(0, 'rgba(255, 255, 150, 0.75)');     // Bright yellow (best - center)
            mainGradient.addColorStop(0.25, 'rgba(200, 230, 255, 0.70)');  // Light cyan
            mainGradient.addColorStop(0.5, 'rgba(100, 180, 255, 0.65)');   // Sky blue (mid)
            mainGradient.addColorStop(0.75, 'rgba(80, 100, 180, 0.65)');   // Medium blue
            mainGradient.addColorStop(1, 'rgba(60, 60, 120, 0.70)');       // Dark purple-blue (worst - edges)
        } else if (worstZoneIndex === 4) {
            // Center is worst - use radial gradient going inward (dark center → bright edges)
            const outerRadius = size * 0.75;
            mainGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, outerRadius);
            mainGradient.addColorStop(0, 'rgba(60, 60, 120, 0.70)');       // Dark purple-blue (worst - center)
            mainGradient.addColorStop(0.25, 'rgba(80, 100, 180, 0.65)');   // Medium blue
            mainGradient.addColorStop(0.5, 'rgba(100, 180, 255, 0.65)');   // Sky blue (mid)
            mainGradient.addColorStop(0.75, 'rgba(200, 230, 255, 0.70)');  // Light cyan
            mainGradient.addColorStop(1, 'rgba(255, 255, 150, 0.75)');     // Bright yellow (best - edges)
        } else {
            // Best/worst are both corners - use linear gradient
            const worstPos = zoneCenters[worstZoneIndex];
            const bestPos = zoneCenters[bestZoneIndex];
            
            // Calculate direction vector and extend it
            const dx = bestPos.x - worstPos.x;
            const dy = bestPos.y - worstPos.y;
            
            // Extend gradient 20% beyond each end for more even distribution
            const extendFactor = 0.2;
            const startX = worstPos.x - dx * extendFactor;
            const startY = worstPos.y - dy * extendFactor;
            const endX = bestPos.x + dx * extendFactor;
            const endY = bestPos.y + dy * extendFactor;
            
            mainGradient = ctx.createLinearGradient(startX, startY, endX, endY);
            mainGradient.addColorStop(0, 'rgba(60, 60, 120, 0.70)');       // Dark purple-blue (worst)
            mainGradient.addColorStop(0.25, 'rgba(80, 100, 180, 0.65)');   // Medium blue
            mainGradient.addColorStop(0.5, 'rgba(100, 180, 255, 0.65)');   // Sky blue (mid)
            mainGradient.addColorStop(0.75, 'rgba(200, 230, 255, 0.70)');  // Light cyan
            mainGradient.addColorStop(1, 'rgba(255, 255, 150, 0.75)');     // Bright yellow (best)
        }
        
        // Base button color (dark blue/gray)
        const getBaseColor = (isSelected) => {
            return isSelected ? 'rgba(50, 60, 90, 0.95)' : 'rgba(35, 45, 75, 0.9)';
        };
        
        // Zone 0: Top-left corner (curved inner edge toward center)
        const drawTopLeftCorner = () => {
            ctx.beginPath();
            ctx.moveTo(topLeft.x, topLeft.y);
            ctx.lineTo(topMid.x, topMid.y);
            // Curve inward toward center then back out to left edge
            ctx.quadraticCurveTo(centerX, centerY, leftMid.x, leftMid.y);
            ctx.closePath();
        };
        
        // Zone 1: Top-right corner (curved inner edge toward center)
        const drawTopRightCorner = () => {
            ctx.beginPath();
            ctx.moveTo(topMid.x, topMid.y);
            ctx.lineTo(topRight.x, topRight.y);
            ctx.lineTo(rightMid.x, rightMid.y);
            // Curve inward toward center then back out to top edge
            ctx.quadraticCurveTo(centerX, centerY, topMid.x, topMid.y);
            ctx.closePath();
        };
        
        // Zone 2: Bottom-right corner (curved inner edge toward center)
        const drawBottomRightCorner = () => {
            ctx.beginPath();
            ctx.moveTo(rightMid.x, rightMid.y);
            ctx.lineTo(bottomRight.x, bottomRight.y);
            ctx.lineTo(bottomMid.x, bottomMid.y);
            // Curve inward toward center then back out to right edge
            ctx.quadraticCurveTo(centerX, centerY, rightMid.x, rightMid.y);
            ctx.closePath();
        };
        
        // Zone 3: Bottom-left corner (curved inner edge toward center)
        const drawBottomLeftCorner = () => {
            ctx.beginPath();
            ctx.moveTo(bottomMid.x, bottomMid.y);
            ctx.lineTo(bottomLeft.x, bottomLeft.y);
            ctx.lineTo(leftMid.x, leftMid.y);
            // Curve inward toward center then back out to bottom edge
            ctx.quadraticCurveTo(centerX, centerY, bottomMid.x, bottomMid.y);
            ctx.closePath();
        };
        
        // Zone 4: Center zone - fills the negative space between the 4 corners
        // Uses 4 curves that mirror the corner curves (bulging outward)
        const drawCenterZone = () => {
            ctx.beginPath();
            // Start at top midpoint, curve outward to right midpoint
            ctx.moveTo(topMid.x, topMid.y);
            ctx.quadraticCurveTo(centerX, centerY, rightMid.x, rightMid.y);
            // Curve outward to bottom midpoint
            ctx.quadraticCurveTo(centerX, centerY, bottomMid.x, bottomMid.y);
            // Curve outward to left midpoint
            ctx.quadraticCurveTo(centerX, centerY, leftMid.x, leftMid.y);
            // Curve outward back to top midpoint
            ctx.quadraticCurveTo(centerX, centerY, topMid.x, topMid.y);
            ctx.closePath();
        };
        
        const drawFunctions = [drawTopLeftCorner, drawTopRightCorner, drawBottomRightCorner, drawBottomLeftCorner, drawCenterZone];
        // Zone labels using baseball terminology
        const zoneLabels = ['High In', 'High Out', 'Low Out', 'Low In', 'Center'];
        
        // Label positions - corners now have more space with curved center
        const labelPositions = [
            { x: squareX + size * 0.22, y: squareY + size * 0.22 },           // Top-left corner (High Inside)
            { x: squareX + size * 0.78, y: squareY + size * 0.22 },           // Top-right corner (High Outside)
            { x: squareX + size * 0.78, y: squareY + size * 0.78 },           // Bottom-right corner (Low Outside)
            { x: squareX + size * 0.22, y: squareY + size * 0.78 },           // Bottom-left corner (Low Inside)
            { x: centerX, y: centerY }                                         // Center zone
        ];
        
        // Store zone bounds for click detection
        // For curved zones, we use simplified rectangular hit areas
        const halfSize = size / 2;
        gameState.pitchZoneBounds = [
            { zoneIndex: 0, x: squareX, y: squareY, width: halfSize, height: halfSize },                    // Top-left
            { zoneIndex: 1, x: squareX + halfSize, y: squareY, width: halfSize, height: halfSize },         // Top-right
            { zoneIndex: 2, x: squareX + halfSize, y: squareY + halfSize, width: halfSize, height: halfSize }, // Bottom-right
            { zoneIndex: 3, x: squareX, y: squareY + halfSize, width: halfSize, height: halfSize },         // Bottom-left
        ];
        // Center zone - a smaller area in the middle
        const centerZoneSize = size * 0.4;
        gameState.pitchZoneBounds.push({
            zoneIndex: 4,
            x: centerX - centerZoneSize / 2,
            y: centerY - centerZoneSize / 2,
            width: centerZoneSize,
            height: centerZoneSize,
            isCenter: true
        });
        
        // PASS 1: Draw all zone fills first
        for (let i = 0; i < 5; i++) {
            const cell = grid[i];
            const isSelected = gameState.pitchZoneIndex === i;
            
            // Step 1: Draw base button color
            ctx.fillStyle = getBaseColor(isSelected);
            drawFunctions[i]();
            ctx.fill();
            
            // Step 2: Draw the unified gradient overlay (clipped to this zone's shape)
            ctx.save();
            drawFunctions[i]();
            ctx.clip();
            ctx.fillStyle = mainGradient;
            ctx.fillRect(squareX, squareY, size, size);
            ctx.restore();
        }
        
        // PASS 2: Draw all black borders
        for (let i = 0; i < 5; i++) {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.lineWidth = 2;
            drawFunctions[i]();
            ctx.stroke();
        }
        
        // PASS 3: Draw selection highlights ON TOP of everything
        for (let i = 0; i < 5; i++) {
            const isSelected = gameState.pitchZoneIndex === i;
            const cell = grid[i];
            const isBestPitch = cell.effectiveness >= 0.95;
            
            // Draw selection highlight on top if selected - SUPER PROMINENT
            if (isSelected) {
                // Pulsing effect - calculate pulse intensity
                const pulseTime = Date.now() % 1000;
                const pulseIntensity = 0.7 + 0.3 * Math.sin(pulseTime / 1000 * Math.PI * 2);
                
                // Best pitch gets BLUE oscillating glow, others get YELLOW
                const glowColor = isBestPitch ? '#00BFFF' : '#FFFF00';  // Deep sky blue for best
                const borderColor = isBestPitch ? '#00BFFF' : '#FFD700';
                
                // Outer bright glow effect (very large) - oscillating for best pitch
                ctx.save();
                ctx.shadowColor = glowColor;
                ctx.shadowBlur = isBestPitch ? 25 + 15 * pulseIntensity : 25;
                ctx.strokeStyle = isBestPitch ? `rgba(0, 191, 255, ${pulseIntensity})` : `rgba(255, 255, 0, ${pulseIntensity})`;
                ctx.lineWidth = isBestPitch ? 10 + 4 * pulseIntensity : 10;
                drawFunctions[i]();
                ctx.stroke();
                ctx.restore();
                
                // Second glow layer
                ctx.save();
                ctx.shadowColor = '#FFFFFF';
                ctx.shadowBlur = 15;
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 8;
                drawFunctions[i]();
                ctx.stroke();
                ctx.restore();
                
                // Bright border
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = 6;
                drawFunctions[i]();
                ctx.stroke();
                
                // Inner white highlight
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 3;
                drawFunctions[i]();
                ctx.stroke();
                
                // Only fill for NON-best pitch (yellow fill)
                // Best pitch is outline only with blue glow
                if (!isBestPitch) {
                    ctx.save();
                    ctx.globalAlpha = 0.25;
                    ctx.fillStyle = '#FFFF00';
                    drawFunctions[i]();
                    ctx.fill();
                    ctx.restore();
                }
            }
        }
        
        // PASS 4: Draw all text labels on top with black outlines for readability
        for (let i = 0; i < 5; i++) {
            const cell = grid[i];
            const isSelected = gameState.pitchZoneIndex === i;
            const isBestPitch = cell.effectiveness >= 0.95;
            
            // Draw pitch name
            const pos = labelPositions[i];
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Abbreviate pitch names
            let pitchAbbr = cell.pitch;
            if (pitchAbbr === 'Fastball') pitchAbbr = 'FAST';
            else if (pitchAbbr === 'Curveball') pitchAbbr = 'CURVE';
            else if (pitchAbbr === 'Slider') pitchAbbr = 'SLIDE';
            else if (pitchAbbr === 'Knuckleball') pitchAbbr = 'KNUCK';
            else if (pitchAbbr === 'Changeup') pitchAbbr = 'CHANGE';
            
            // Helper function to draw text with black outline for readability
            const drawTextWithOutline = (text, x, y, font, fillColor) => {
                ctx.font = font;
                // Draw black outline (stroke)
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 3;
                ctx.strokeText(text, x, y);
                // Draw fill
                ctx.fillStyle = fillColor;
                ctx.fillText(text, x, y);
            };
            
            // For corner zones, show pitch name + zone abbreviation
            if (i < 4) {
                const pitchFont = isSelected ? 'bold 11px monospace' : 'bold 10px monospace';
                const pitchColor = isSelected ? '#FFFFFF' : '#FFFFFF';
                drawTextWithOutline(pitchAbbr, pos.x, pos.y - 5, pitchFont, pitchColor);
                
                const zoneFont = 'bold 8px monospace';
                const zoneColor = isSelected ? (isBestPitch ? '#00FF00' : '#FFFF00') : '#DDDDDD';
                drawTextWithOutline(zoneLabels[i], pos.x, pos.y + 6, zoneFont, zoneColor);
            } else {
                // Center zone has more space
                const pitchFont = isSelected ? 'bold 12px monospace' : 'bold 11px monospace';
                const pitchColor = isSelected ? '#FFFFFF' : '#FFFFFF';
                drawTextWithOutline(pitchAbbr, pos.x, pos.y - 8, pitchFont, pitchColor);
                
                const zoneFont = 'bold 9px monospace';
                const zoneColor = isSelected ? (isBestPitch ? '#00FF00' : '#FFFF00') : '#DDDDDD';
                drawTextWithOutline(zoneLabels[i], pos.x, pos.y + 6, zoneFont, zoneColor);
            }
        }
        
        // Draw pause button below
        const pauseBtnY = squareY + size + 15;
        const pauseBtnWidth = size;
        const pauseBtnHeight = 35;
        const pauseBtnX = squareX;
        
        gameState.pauseButtonBounds = {
            x: pauseBtnX,
            y: pauseBtnY,
            width: pauseBtnWidth,
            height: pauseBtnHeight
        };
        
        // Check if pause is selected (index 5)
        const pauseSelected = gameState.pitchZoneIndex === 5;
        
        ctx.fillStyle = pauseSelected ? 'rgba(100, 100, 150, 0.6)' : 'rgba(50, 50, 80, 0.6)';
        ctx.fillRect(pauseBtnX, pauseBtnY, pauseBtnWidth, pauseBtnHeight);
        
        if (pauseSelected) {
            this.drawSelectionHighlight(pauseBtnX, pauseBtnY, pauseBtnWidth, pauseBtnHeight);
        } else {
            ctx.strokeStyle = 'rgba(100, 100, 100, 0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(pauseBtnX, pauseBtnY, pauseBtnWidth, pauseBtnHeight);
        }
        
        ctx.font = pauseSelected ? 'bold 14px monospace' : '12px monospace';
        ctx.fillStyle = pauseSelected ? GAME_CONSTANTS.COLORS.menuSelected : GAME_CONSTANTS.COLORS.menuText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PAUSE', pauseBtnX + pauseBtnWidth / 2, pauseBtnY + pauseBtnHeight / 2);
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
            if (window.NarbeVoiceManager) {
                window.NarbeVoiceManager.toggleTTS();
                this.game.audioSystem.settings.ttsEnabled = window.NarbeVoiceManager.getSettings().ttsEnabled;
            } else {
                this.game.audioSystem.settings.ttsEnabled = !this.game.audioSystem.settings.ttsEnabled;
            }
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
            `Text-to-Speech: ${window.NarbeVoiceManager ? (window.NarbeVoiceManager.getSettings().ttsEnabled ? 'ON' : 'OFF') : (this.game.audioSystem.settings.ttsEnabled ? 'ON' : 'OFF')}`,
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