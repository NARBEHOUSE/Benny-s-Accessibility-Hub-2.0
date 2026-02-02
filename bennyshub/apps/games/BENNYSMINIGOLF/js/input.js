class InputHandler {
    constructor() {
        this.keys = {};
        this.mode = 'MENU'; // 'MENU' or 'GAMEPLAY'
        
        // State tracking
        this.spaceHeld = false;
        this.spaceHoldStart = 0;
        this.backwardScanInterval = null;
        
        this.enterHeld = false;
        this.enterHoldStart = 0;
        this.pauseTriggered = false;

        // Callbacks
        this.onEvent = null; // (eventType, data) => {}

        this.setupListeners();
    }

    setMode(mode) {
        this.mode = mode;
        // Reset states on mode switch to prevent stuck inputs
        this.spaceHeld = false;
        this.enterHeld = false;
        this.stopBackwardScan();
    }

    setupListeners() {
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));
    }

    handleKeyDown(e) {
        if (this.keys[e.code]) return; // Ignore repeats
        this.keys[e.code] = true;

        if (e.code === 'Space') {
            this.spaceHeld = true;
            this.spaceHoldStart = Date.now();
            
            if (this.mode === 'MENU') {
                this.checkBackwardScan();
            } else {
                this.trigger('GAME_SPACE_DOWN');
            }
        }

        if (e.code === 'Enter') {
            this.enterHeld = true;
            this.enterHoldStart = Date.now();
            this.pauseTriggered = false;

            if (this.mode === 'GAMEPLAY') {
                this.checkPauseHold();
                this.trigger('GAME_ENTER_DOWN');
            }
        }
    }

    handleKeyUp(e) {
        this.keys[e.code] = false;

        if (e.code === 'Space') {
            this.spaceHeld = false;
            const duration = Date.now() - this.spaceHoldStart;

            if (this.mode === 'MENU') {
                const wasBackwardScanning = this.backwardScanInterval !== null;
                this.stopBackwardScan();

                if (!wasBackwardScanning) {
                    this.trigger('SCAN_NEXT');
                }
            } else {
                this.trigger('GAME_SPACE_UP');
            }
        }

        if (e.code === 'Enter') {
            this.enterHeld = false;
            
            if (this.mode === 'MENU') {
                if (!this.pauseTriggered) {
                    this.trigger('SELECT');
                }
            } else {
                if (!this.pauseTriggered) {
                    this.trigger('GAME_ENTER_UP');
                }
            }
            this.pauseTriggered = false;
        }
    }

    // --- Backward Scan Logic (Menu) ---
    checkBackwardScan() {
        if (!this.spaceHeld || this.mode !== 'MENU') return;

        const duration = Date.now() - this.spaceHoldStart;
        
        // Start backward scanning after 3000ms
        if (duration >= 3000 && !this.backwardScanInterval) {
            this.startBackwardScan();
            return;
        }

        if (!this.backwardScanInterval) {
            requestAnimationFrame(() => this.checkBackwardScan());
        }
    }

    startBackwardScan() {
        this.trigger('SCAN_PREV'); // Immediate first backward scan
        
        let interval = 2000;
        if (typeof NarbeScanManager !== 'undefined') {
            interval = NarbeScanManager.getScanInterval();
        }

        this.backwardScanInterval = setInterval(() => {
            if (this.spaceHeld && this.mode === 'MENU') {
                this.trigger('SCAN_PREV');
            } else {
                this.stopBackwardScan();
            }
        }, interval);
    }

    stopBackwardScan() {
        if (this.backwardScanInterval) {
            clearInterval(this.backwardScanInterval);
            this.backwardScanInterval = null;
        }
    }

    // --- Pause Logic (Gameplay) ---
    checkPauseHold() {
        if (!this.enterHeld || this.mode !== 'GAMEPLAY') return;

        const duration = Date.now() - this.enterHoldStart;

        if (duration >= 8000 && !this.pauseTriggered) { // 8 seconds for pause
            this.pauseTriggered = true;
            this.trigger('PAUSE');
            return;
        }

        if (!this.pauseTriggered) {
            requestAnimationFrame(() => this.checkPauseHold());
        }
    }

    trigger(event, data) {
        if (this.onEvent) {
            this.onEvent(event, data);
        }
    }

    // Helper for polling if needed (though we use events now)
    isDown(code) {
        return !!this.keys[code];
    }
}

const Input = new InputHandler();
