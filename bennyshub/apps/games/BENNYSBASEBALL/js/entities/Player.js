class Player {
    constructor(x, y, color, type = 'FIELD') {
        this.x = x;
        this.y = y;
        this.color = color;
        this.type = type; // 'FIELD', 'BAT', 'RUN'
        this.position = '';
        this.size = type === 'RUN' ? 16 : 20;
        this.animation = 0;
    }

    draw(ctx) {
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
        
        // Arms (animated for running players)
        const armOffset = this.type === 'RUN' ? Math.sin(this.animation) * 3 : Math.sin(this.animation) * 1;
        ctx.fillRect(this.x - 10, this.y - 6 + armOffset, 4, 8);
        ctx.fillRect(this.x + 6, this.y - 6 - armOffset, 4, 8);
        
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
        } else if (this.type === 'BAT') {
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

    setPosition(position) {
        this.position = position;
    }
}