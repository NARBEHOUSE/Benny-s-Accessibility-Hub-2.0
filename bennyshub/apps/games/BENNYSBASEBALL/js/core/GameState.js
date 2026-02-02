class GameState {
    constructor() {
        this.mode = GAME_CONSTANTS.MODES.MAIN_MENU;
        this.previousMode = null;
        
        // Game progress
        this.currentInning = 1;
        this.half = 'top';
        this.outs = 0;
        this.score = { Blue: 0, Red: 0 };
        this.bases = { first: null, second: null, third: null };
        this.balls = 0;
        this.strikes = 0;
        
        // Teams
        this.homeTeam = 'Blue';
        this.awayTeam = 'Red';
        this.playerSelectedColor = null; // Track player's selected color
        
        // Menu system
        this.selectedIndex = 0;
        this.menuOptions = [];
        this.menuBounds = [];
        this.currentColorIndex = 0;
        this.gameMode = null;
        
        // Game mechanics
        this.firstPitch = true;
        this.selectedPitch = null;
        this.selectedPitchLocation = null;
        this.selectedSwing = null;
        this.samePitchCount = 0;
        this.lastPitchType = null;
        this.consecutiveHolds = 0; // Track consecutive "Hold" selections
        
        // Input handling
        this.spaceHeld = false;
        this.spaceHoldStart = 0;
        this.lastSpaceScan = 0;
        this.returnHeld = false;
        this.returnHoldStart = 0;
        
        // Animation and timing
        this.animating = false;
        this.playInProgress = false;
        this.inputsBlocked = false;
        this.lastActionTime = 0;
        this.menuReady = false;
        this.hasScanned = false;
        
        // Field coordinates
        this.fieldCoords = null;
        this.diamondSize = 0;
        
        // Animations
        this.ballAnimation = null;
        this.runnerAnimation = {
            active: false,
            runners: [],
            completedAnimations: 0,
            totalAnimations: 0
        };
        
        // Base updates
        this.pendingBaseUpdate = null;
        this.transitionText = '';
        
        // Speech synthesis
        this.speech = window.speechSynthesis;
    }
    
    reset() {
        this.currentInning = 1;
        // Always start with top of the 1st inning
        this.half = 'top';
        this.outs = 0;
        this.score = { Blue: 0, Red: 0 };
        this.bases = { first: null, second: null, third: null };
        this.balls = 0;
        this.strikes = 0;
        this.firstPitch = true;
        this.samePitchCount = 0;
        this.lastPitchType = null;
        this.consecutiveHolds = 0; // Reset hold counter
        this.animating = false;
        this.playInProgress = false;
        this.inputsBlocked = false;
        this.menuReady = false;
        this.hasScanned = false;
        this.selectedIndex = -1;
        
        if (this.runnerAnimation.active) {
            this.runnerAnimation.active = false;
            this.runnerAnimation.runners = [];
        }
    }
    
    getBattingTeam() {
        return this.half === 'top' ? this.awayTeam : this.homeTeam;
    }
    
    getFieldingTeam() {
        return this.half === 'top' ? this.homeTeam : this.awayTeam;
    }
    
    isPlayerBatting() {
        const battingTeam = this.getBattingTeam();
        // Player could be either Red or Blue team depending on randomization
        // Check if the current batting team matches the player's team color
        const playerTeam = this.getPlayerTeam();
        return battingTeam === playerTeam;
    }
    
    getPlayerTeam() {
        // Determine which team the player is on based on color assignments
        // The player's team is whichever team has their selected color
        if (GAME_CONSTANTS.COLORS.playerRed === this.getPlayerColor()) {
            return this.awayTeam; // Player is Red (away team)
        } else {
            return this.homeTeam; // Player is Blue (home team)
        }
    }
    
    getComputerTeam() {
        // Computer is the opposite team from the player
        return this.getPlayerTeam() === this.awayTeam ? this.homeTeam : this.awayTeam;
    }
    
    getPlayerColor() {
        // This will be set during game initialization to track the player's selected color
        return this.playerSelectedColor || GAME_CONSTANTS.COLORS.playerRed;
    }
}