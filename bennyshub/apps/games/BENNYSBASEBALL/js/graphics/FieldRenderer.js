class FieldRenderer {
    constructor(canvas, ctx, game = null) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.game = game; // Store game reference for accessing game state
        this.fieldPlayers = [];
        this.fieldCoords = null;
        this.diamondSize = 0;
    }

    drawField(gameState) {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2 + 50;
        const diamondSize = Math.min(this.canvas.width, this.canvas.height) * 0.35;

        // Draw outfield with gradient
        const gradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, diamondSize * 2);
        gradient.addColorStop(0, GAME_CONSTANTS.COLORS.grassLight);
        gradient.addColorStop(1, GAME_CONSTANTS.COLORS.grass);
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw infield dirt with gradient
        this.ctx.save();
        this.ctx.translate(cx, cy);
        this.ctx.rotate(Math.PI / 4);
        const dirtGradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, diamondSize);
        dirtGradient.addColorStop(0, GAME_CONSTANTS.COLORS.dirtLight);
        dirtGradient.addColorStop(1, GAME_CONSTANTS.COLORS.dirt);
        this.ctx.fillStyle = dirtGradient;
        this.ctx.fillRect(-diamondSize * 0.7, -diamondSize * 0.7, diamondSize * 1.4, diamondSize * 1.4);
        this.ctx.restore();

        // Draw diamond lines with glow effect
        this.ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
        this.ctx.shadowBlur = 10;
        this.ctx.strokeStyle = GAME_CONSTANTS.COLORS.baseLine;
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy + diamondSize / 2);
        this.ctx.lineTo(cx + diamondSize / 2, cy);
        this.ctx.lineTo(cx, cy - diamondSize / 2);
        this.ctx.lineTo(cx - diamondSize / 2, cy);
        this.ctx.closePath();
        this.ctx.stroke();

        // Foul lines
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy + diamondSize / 2);
        this.ctx.lineTo(cx + diamondSize, cy + diamondSize);
        this.ctx.moveTo(cx, cy + diamondSize / 2);
        this.ctx.lineTo(cx - diamondSize, cy + diamondSize);
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;

        // Draw pitcher's mound with 3D effect
        const moundRadius = diamondSize * 0.12;
        const moundGradient = this.ctx.createRadialGradient(cx, cy - 5, 0, cx, cy, moundRadius);
        moundGradient.addColorStop(0, GAME_CONSTANTS.COLORS.dirtLight);
        moundGradient.addColorStop(1, GAME_CONSTANTS.COLORS.dirt);
        this.ctx.fillStyle = moundGradient;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, moundRadius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Draw bases
        this.drawBases(cx, cy, diamondSize, gameState.bases);

        // Store field coordinates
        this.fieldCoords = {
            home: { x: cx, y: cy + diamondSize / 2 },
            first: { x: cx + diamondSize / 2, y: cy },
            second: { x: cx, y: cy - diamondSize / 2 },
            third: { x: cx - diamondSize / 2, y: cy },
            pitcher: { x: cx, y: cy }
        };
        this.diamondSize = diamondSize;
        
        // Update game state with field coordinates
        gameState.fieldCoords = this.fieldCoords;
        gameState.diamondSize = this.diamondSize;
    }

    drawBases(cx, cy, diamondSize, bases) {
        const baseSize = diamondSize * 0.08;
        const basePositions = [
            { name: 'home', x: cx, y: cy + diamondSize / 2 },
            { name: 'first', x: cx + diamondSize / 2, y: cy },
            { name: 'second', x: cx, y: cy - diamondSize / 2 },
            { name: 'third', x: cx - diamondSize / 2, y: cy }
        ];

        basePositions.forEach(base => {
            let fillColor = '#ffffff';
            
            if (base.name !== 'home' && bases) {
                const runner = bases[base.name];
                if (runner === 'user' || runner === 'comp') {
                    // Get the current batting team to determine color
                    const gameState = this.game ? this.game.gameState : null;
                    if (gameState) {
                        const battingTeam = gameState.getBattingTeam();
                        
                        // The batting team's runners should be highlighted with their team color
                        // User runners should use player's team color, comp runners use computer's team color
                        if (runner === 'user') {
                            // Use the player's actual team color
                            if (gameState.getPlayerTeam() === gameState.awayTeam) {
                                fillColor = GAME_CONSTANTS.COLORS.playerRed;
                            } else {
                                fillColor = GAME_CONSTANTS.COLORS.playerBlue;
                            }
                        } else if (runner === 'comp') {
                            // Use the computer's actual team color
                            if (gameState.getComputerTeam() === gameState.awayTeam) {
                                fillColor = GAME_CONSTANTS.COLORS.playerRed;
                            } else {
                                fillColor = GAME_CONSTANTS.COLORS.playerBlue;
                            }
                        }
                    }
                    
                    // Use gray instead of white for better visibility if color is still white
                    if (fillColor === '#ffffff') {
                        fillColor = '#888888';
                    }
                }
            }

            // Add glow effect for occupied bases
            if (fillColor !== '#ffffff') {
                this.ctx.shadowColor = fillColor;
                this.ctx.shadowBlur = 15;
            }

            this.ctx.fillStyle = fillColor;
            this.ctx.strokeStyle = '#000';
            this.ctx.lineWidth = 2;

            if (base.name === 'home') {
                this.ctx.beginPath();
                this.ctx.moveTo(base.x, base.y - baseSize);
                this.ctx.lineTo(base.x + baseSize / 2, base.y - baseSize / 2);
                this.ctx.lineTo(base.x + baseSize / 2, base.y + baseSize / 2);
                this.ctx.lineTo(base.x - baseSize / 2, base.y + baseSize / 2);
                this.ctx.lineTo(base.x - baseSize / 2, base.y - baseSize / 2);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
            } else {
                this.ctx.save();
                this.ctx.translate(base.x, base.y);
                this.ctx.rotate(Math.PI / 4);
                this.ctx.fillRect(-baseSize / 2, -baseSize / 2, baseSize, baseSize);
                this.ctx.strokeRect(-baseSize / 2, -baseSize / 2, baseSize, baseSize);
                this.ctx.restore();
            }
            
            this.ctx.shadowBlur = 0;
        });
    }

    initializeFieldPlayers(gameState) {
        if (!this.fieldCoords) return;
        
        const coords = this.fieldCoords;
        const size = this.diamondSize;
        this.fieldPlayers = [];

        // Determine team colors based on current half
        const battingTeam = gameState.getBattingTeam();
        
        let battingColor, fieldingColor;
        if (battingTeam === gameState.awayTeam) {
            battingColor = GAME_CONSTANTS.COLORS.playerRed;
            fieldingColor = GAME_CONSTANTS.COLORS.playerBlue;
        } else {
            battingColor = GAME_CONSTANTS.COLORS.playerBlue;
            fieldingColor = GAME_CONSTANTS.COLORS.playerRed;
        }

        const positions = [
            { pos: 'P', x: coords.pitcher.x, y: coords.pitcher.y, color: fieldingColor },
            { pos: 'C', x: coords.home.x, y: coords.home.y + 40, color: fieldingColor },
            { pos: '1B', x: coords.first.x + 30, y: coords.first.y + 30, color: fieldingColor },
            { pos: '2B', x: coords.second.x + size * 0.2, y: coords.second.y + size * 0.2, color: fieldingColor },
            { pos: 'SS', x: coords.second.x - size * 0.2, y: coords.second.y + size * 0.2, color: fieldingColor },
            { pos: '3B', x: coords.third.x - 30, y: coords.third.y + 30, color: fieldingColor },
            { pos: 'LF', x: coords.third.x - size * 0.5, y: coords.third.y - size * 0.3, color: fieldingColor },
            { pos: 'CF', x: coords.second.x, y: coords.second.y - size * 0.6, color: fieldingColor },
            { pos: 'RF', x: coords.first.x + size * 0.5, y: coords.first.y - size * 0.3, color: fieldingColor }
        ];

        positions.forEach(p => {
            const player = new Player(p.x, p.y, p.color, 'FIELD');
            player.setPosition(p.pos); // Set the position property correctly
            this.fieldPlayers.push(player);
        });

        // Batter uses the batting team's color
        const batter = new Player(coords.home.x - 40, coords.home.y, battingColor, 'BAT');
        batter.setPosition('BATTER');
        this.fieldPlayers.push(batter);
    }

    drawPlayers() {
        this.fieldPlayers.forEach(player => player.draw(this.ctx));
    }

    getFieldCoords() {
        return this.fieldCoords;
    }

    getDiamondSize() {
        return this.diamondSize;
    }
}