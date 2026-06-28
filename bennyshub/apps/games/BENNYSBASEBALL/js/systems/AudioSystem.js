class AudioSystem {
    constructor() {
        this.settings = {
            musicEnabled: true,
            soundEnabled: true,
            ttsEnabled: true,
            voiceType: 'default',
            currentTrack: 0
        };
        this.currentAudio = null;
        this.audioUnlocked = false;
        
        // Use NarbeVoiceManager for TTS instead of manual voice management
        this.voiceManager = window.NarbeVoiceManager;
        
        // Position name mapping for TTS
        this.positionNames = {
            'P': 'pitcher',
            'C': 'catcher',
            '1B': 'first baseman',
            '2B': 'second baseman',
            '3B': 'third baseman',
            'SS': 'shortstop',
            'LF': 'left fielder',
            'CF': 'center fielder',
            'RF': 'right fielder',
            'BATTER': 'batter'
        };
        
        this.ctx = null;
        this.sounds = {};
        this.loadSoundEffects();
        this.load();
        
        // Auto-unlock handlers
        const unlock = () => { this.unlockAudio(); };
        window.addEventListener('touchstart', unlock, { once: true, passive: true });
        window.addEventListener('click', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });
    }

    load() {
        const saved = localStorage.getItem(GAME_CONSTANTS.STORAGE_KEYS.AUDIO);
        if (saved) {
            Object.assign(this.settings, JSON.parse(saved));
        }
        
        // Sync TTS settings with voice manager
        if (this.voiceManager) {
            const voiceSettings = this.voiceManager.getSettings();
            this.settings.ttsEnabled = voiceSettings.ttsEnabled;
        }
    }

    save() {
        localStorage.setItem(GAME_CONSTANTS.STORAGE_KEYS.AUDIO, JSON.stringify(this.settings));
        
        // Update voice manager settings
        if (this.voiceManager) {
            this.voiceManager.updateSettings({
                ttsEnabled: this.settings.ttsEnabled
            });
        }
    }

    unlockAudio() {
        // Reuse or create context
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Resume if suspended
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(()=>{});
        }

        // Play silent sound using buffer (iOS magic)
        try {
            const buffer = this.ctx.createBuffer(1, 1, 22050);
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(this.ctx.destination);
            source.start(0);
        } catch(e) {}
        
        if (this.audioUnlocked) return;
        this.audioUnlocked = true;
        
        if (this.settings.musicEnabled) {
            this.playBackgroundMusic();
        }
    }

    speak(text) {
        // Use NarbeVoiceManager for consistent TTS (it handles ttsEnabled internally)
        const processedText = this.convertPositionNames(text);
        if (window.NarbeVoiceManager) {
            window.NarbeVoiceManager.speak(processedText);
        } else if (this.settings.ttsEnabled && 'speechSynthesis' in window) {
            speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(processedText);
            speechSynthesis.speak(u);
        }
    }

    convertPositionNames(text) {
        let processedText = text;
        
        // Replace position abbreviations with full names
        for (const [abbr, fullName] of Object.entries(this.positionNames)) {
            // Match abbreviation as a whole word (with word boundaries)
            const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
            processedText = processedText.replace(regex, fullName);
        }
        
        return processedText;
    }

    playBackgroundMusic() {
        if (!this.settings.musicEnabled || GAME_CONSTANTS.AUDIO.TRACKS.length === 0) return;
        
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.currentAudio = null;
        }
        
        this.currentAudio = new Audio(GAME_CONSTANTS.AUDIO.TRACKS[this.settings.currentTrack]);
        this.currentAudio.loop = true;
        this.currentAudio.volume = 0.15;
        
        const playPromise = this.currentAudio.play();
        
        if (playPromise !== undefined) {
            playPromise.then(() => {
                console.log('Music started successfully');
            }).catch((error) => {
                console.log('Audio play prevented:', error);
                // Don't play generated music - it's just an annoying tone
                // Music will start when user interacts with the page
            });
        }
    }

    playGeneratedMusic() {
        // Disabled - generated tone is not actual music and is annoying
        // This function is kept for compatibility but does nothing
        return;
    }

    nextTrack() {
        this.settings.currentTrack = (this.settings.currentTrack + 1) % GAME_CONSTANTS.AUDIO.TRACKS.length;
        this.save(); // Save the new track selection
        this.playBackgroundMusic();
    }

    stopMusic() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
    }

    playSound(type) {
        if (!this.settings.soundEnabled) return;
        
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        const audioCtx = this.ctx;
        if(audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});

        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        switch (type) {
            case 'scan':
                oscillator.frequency.value = 440;
                gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
                oscillator.start(audioCtx.currentTime);
                oscillator.stop(audioCtx.currentTime + 0.1);
                break;
            case 'select':
                oscillator.frequency.value = 880;
                gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
                oscillator.start(audioCtx.currentTime);
                oscillator.stop(audioCtx.currentTime + 0.15);
                break;
            case 'hit':
                if (this.sounds.hit) {
                    this.sounds.hit.currentTime = 0;
                    this.sounds.hit.volume = 0.4;
                    this.sounds.hit.play().catch(e => console.warn('Audio play prevented:', e));
                } else {
                    // Fallback to oscillator if sound file not available
                    oscillator.frequency.value = 200;
                    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
                    oscillator.start(audioCtx.currentTime);
                    oscillator.stop(audioCtx.currentTime + 0.3);
                }
                break;
            case 'foul':
                if (this.sounds.hit) {
                    this.sounds.hit.currentTime = 0;
                    this.sounds.hit.volume = 0.2; // Softer for foul tip
                    this.sounds.hit.play().catch(e => console.warn('Audio play prevented:', e));
                }
                break;
            case 'homerun':
                if (this.sounds.homerun) {
                    this.sounds.homerun.currentTime = 0;
                    this.sounds.homerun.play().catch(e => console.warn('Audio play prevented:', e));
                }
                break;
            case 'swing':
                if (this.sounds.swing) {
                    this.sounds.swing.currentTime = 0;
                    this.sounds.swing.play().catch(e => console.warn('Audio play prevented:', e));
                }
                break;
            case 'cheer':
                for (let i = 0; i < 3; i++) {
                    setTimeout(() => {
                        const cheer = audioCtx.createOscillator();
                        const cheerGain = audioCtx.createGain();
                        cheer.connect(cheerGain);
                        cheerGain.connect(audioCtx.destination);
                        cheer.frequency.value = 600 + Math.random() * 400;
                        cheerGain.gain.setValueAtTime(0.15, audioCtx.currentTime);
                        cheerGain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
                        cheer.start(audioCtx.currentTime);
                        cheer.stop(audioCtx.currentTime + 0.2);
                    }, i * 100);
                }
                break;
            case 'swingZone':
                // Friendly reminder tone when ball enters strike zone - two quick ascending notes
                oscillator.type = 'sine';
                oscillator.frequency.value = 660; // E5
                gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
                oscillator.start(audioCtx.currentTime);
                oscillator.stop(audioCtx.currentTime + 0.12);
                
                // Second higher note
                setTimeout(() => {
                    const osc2 = audioCtx.createOscillator();
                    const gain2 = audioCtx.createGain();
                    osc2.connect(gain2);
                    gain2.connect(audioCtx.destination);
                    osc2.type = 'sine';
                    osc2.frequency.value = 880; // A5
                    gain2.gain.setValueAtTime(0.15, audioCtx.currentTime);
                    gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
                    osc2.start(audioCtx.currentTime);
                    osc2.stop(audioCtx.currentTime + 0.15);
                }, 80);
                break;
        }
    }

    // Batting charge tone system - plays rising tones at 25%, 50%, 75%, 100%
    startChargeSound() {
        this.lastChargeStep = 0;
    }

    updateChargeSound(percent) {
        if (!this.settings.soundEnabled) return;
        
        // Play a beep every 25% charge
        // Steps: 1 (25%), 2 (50%), 3 (75%), 4 (100%)
        const step = Math.floor(percent * 4);
        
        // Only play if we moved to a new step (and ignore step 0 which is < 25%)
        if (step > this.lastChargeStep && step > 0 && step <= 4) {
            this.playChargeBeep(step);
            this.lastChargeStep = step;
        }
    }
    
    playChargeBeep(step) {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        const audioCtx = this.ctx;
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        // Rising tones (C5, E5, G5, C6) - increases with charge
        const freqs = [523.25, 659.25, 783.99, 1046.50];
        const freq = freqs[step - 1] || freqs[freqs.length - 1];
        
        osc.type = 'sine';
        osc.frequency.value = freq;
        
        const now = audioCtx.currentTime;
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        
        osc.start(now);
        osc.stop(now + 0.12);
    }

    stopChargeSound() {
        this.lastChargeStep = 0;
    }

    loadSoundEffects() {
        this.sounds.hit = new Audio('audio/baseballhit.wav');
        this.sounds.hit.volume = 0.4;
        
        this.sounds.homerun = new Audio('audio/homerun.wav');
        this.sounds.homerun.volume = 0.5;

        this.sounds.swing = new Audio('audio/swing.wav');
        this.sounds.swing.volume = 0.5;
    }
}