/**
 * Safe Audio Manager for Electron Iframes
 * 
 * Uses HTML5 Audio elements instead of Web Audio API to avoid crashes
 * in Electron iframe renderer processes.
 * 
 * The Web Audio API (AudioContext, decodeAudioData) can cause ACCESS_VIOLATION
 * crashes in Electron iframes. HTML5 Audio is more stable.
 * 
 * Includes built-in synthesized sounds for UI feedback.
 */

window.SafeAudio = (function() {
    'use strict';
    
    const audioPool = {};  // Pooled audio elements by sound name
    const poolSize = 3;    // Number of audio elements per sound for overlapping playback
    const poolIndex = {};  // Current index in each pool
    
    let enabled = true;
    let volume = 0.5;
    let initialized = false;
    
    // Generate a simple WAV tone as a data URI
    function generateTone(frequency, duration, waveType = 'sine', fadeOut = true) {
        const sampleRate = 22050;
        const numSamples = Math.floor(sampleRate * duration);
        const numChannels = 1;
        const bitsPerSample = 16;
        
        // WAV header
        const headerSize = 44;
        const dataSize = numSamples * numChannels * (bitsPerSample / 8);
        const fileSize = headerSize + dataSize - 8;
        
        const buffer = new ArrayBuffer(headerSize + dataSize);
        const view = new DataView(buffer);
        
        // RIFF header
        writeString(view, 0, 'RIFF');
        view.setUint32(4, fileSize, true);
        writeString(view, 8, 'WAVE');
        
        // fmt chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // chunk size
        view.setUint16(20, 1, true);  // audio format (PCM)
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
        view.setUint16(32, numChannels * (bitsPerSample / 8), true);
        view.setUint16(34, bitsPerSample, true);
        
        // data chunk
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);
        
        // Generate samples
        for (let i = 0; i < numSamples; i++) {
            const t = i / sampleRate;
            let sample = 0;
            
            // Handle frequency as number or array (for chords/sequences)
            const freq = Array.isArray(frequency) ? frequency[0] : frequency;
            
            switch (waveType) {
                case 'sine':
                    sample = Math.sin(2 * Math.PI * freq * t);
                    break;
                case 'square':
                    sample = Math.sin(2 * Math.PI * freq * t) > 0 ? 1 : -1;
                    sample *= 0.5; // Reduce volume for square
                    break;
                case 'sawtooth':
                    sample = 2 * (freq * t - Math.floor(freq * t + 0.5));
                    sample *= 0.5;
                    break;
                case 'triangle':
                    sample = 2 * Math.abs(2 * (freq * t - Math.floor(freq * t + 0.5))) - 1;
                    break;
            }
            
            // Apply fade out envelope
            if (fadeOut) {
                const envelope = 1 - (i / numSamples);
                sample *= envelope * envelope; // Quadratic fade
            }
            
            // Apply volume
            sample *= 0.7;
            
            // Convert to 16-bit PCM
            const pcmSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
            view.setInt16(headerSize + i * 2, pcmSample, true);
        }
        
        // Convert to base64
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return 'data:audio/wav;base64,' + btoa(binary);
    }
    
    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
    
    // Generate multi-tone sound (for melodies)
    function generateMelody(notes, noteDuration = 0.15) {
        const sampleRate = 22050;
        const samplesPerNote = Math.floor(sampleRate * noteDuration);
        const totalSamples = samplesPerNote * notes.length;
        const numChannels = 1;
        const bitsPerSample = 16;
        
        const headerSize = 44;
        const dataSize = totalSamples * numChannels * (bitsPerSample / 8);
        const fileSize = headerSize + dataSize - 8;
        
        const buffer = new ArrayBuffer(headerSize + dataSize);
        const view = new DataView(buffer);
        
        // WAV header
        writeString(view, 0, 'RIFF');
        view.setUint32(4, fileSize, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
        view.setUint16(32, numChannels * (bitsPerSample / 8), true);
        view.setUint16(34, bitsPerSample, true);
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);
        
        // Generate each note
        for (let n = 0; n < notes.length; n++) {
            const freq = notes[n];
            for (let i = 0; i < samplesPerNote; i++) {
                const t = i / sampleRate;
                let sample = Math.sin(2 * Math.PI * freq * t);
                
                // Envelope for each note
                const noteProgress = i / samplesPerNote;
                const attack = Math.min(1, noteProgress * 10);
                const release = 1 - noteProgress;
                sample *= attack * release * 0.6;
                
                const pcmSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
                view.setInt16(headerSize + (n * samplesPerNote + i) * 2, pcmSample, true);
            }
        }
        
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return 'data:audio/wav;base64,' + btoa(binary);
    }
    
    // Built-in synthesized sounds
    const builtInSounds = {
        // UI click sound
        select: () => generateTone(800, 0.08, 'sine'),
        // Hover blip
        hover: () => generateTone(600, 0.04, 'sine'),
        // Positive score ding
        score: () => generateMelody([523, 659, 784], 0.1),
        // Failure/bust sound
        bust: () => generateTone(200, 0.4, 'sawtooth'),
        // Cash register / bank sound
        bank: () => generateMelody([1200, 1600], 0.1),
        // Fahtzee fanfare
        fahtzee: () => generateMelody([523, 659, 784, 1047, 784, 1047], 0.12),
        // Win sound
        win: () => generateMelody([523, 659, 784, 1047, 784, 659, 784, 1047, 1319], 0.12),
        // Lose sound  
        lose: () => generateMelody([400, 350, 300, 250], 0.18)
    };
    
    /**
     * Preload a sound file
     * @param {string} name - Identifier for the sound
     * @param {string} url - Path to the audio file (optional if using built-in)
     */
    function preload(name, url) {
        if (audioPool[name]) return; // Already loaded
        
        try {
            audioPool[name] = [];
            poolIndex[name] = 0;
            
            // Use built-in sound if no URL provided or if it's a known synth sound
            let soundUrl = url;
            if (!url && builtInSounds[name]) {
                soundUrl = builtInSounds[name]();
            }
            
            if (!soundUrl) {
                console.warn(`[SafeAudio] No source for "${name}"`);
                return;
            }
            
            for (let i = 0; i < poolSize; i++) {
                const audio = new Audio();
                audio.preload = 'auto';
                audio.volume = volume;
                
                // Error handling
                audio.onerror = function(e) {
                    console.warn(`[SafeAudio] Failed to load "${name}":`, e);
                };
                
                // Set source after error handler
                audio.src = soundUrl;
                audioPool[name].push(audio);
            }
            
            console.log(`[SafeAudio] Preloaded: ${name}`);
        } catch (err) {
            console.warn(`[SafeAudio] Error preloading "${name}":`, err);
        }
    }
    
    /**
     * Play a preloaded sound, auto-loading built-in sounds if needed
     * @param {string} name - Identifier of the sound to play
     * @param {number} [volumeOverride] - Optional volume override (0-1)
     */
    function play(name, volumeOverride) {
        if (!enabled) return;
        
        // Auto-load built-in sound if not preloaded
        if ((!audioPool[name] || audioPool[name].length === 0) && builtInSounds[name]) {
            preload(name);
        }
        
        const pool = audioPool[name];
        if (!pool || pool.length === 0) {
            console.warn(`[SafeAudio] Sound not loaded: ${name}`);
            return;
        }
        
        try {
            // Get next audio element from pool (round-robin)
            const audio = pool[poolIndex[name]];
            poolIndex[name] = (poolIndex[name] + 1) % poolSize;
            
            // Reset and play
            audio.volume = volumeOverride !== undefined ? volumeOverride : volume;
            audio.currentTime = 0;
            
            // Use play() with promise handling for browsers that require user interaction
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    // Autoplay was prevented - this is normal before user interaction
                    if (err.name !== 'NotAllowedError') {
                        console.warn(`[SafeAudio] Play error for "${name}":`, err);
                    }
                });
            }
        } catch (err) {
            console.warn(`[SafeAudio] Error playing "${name}":`, err);
        }
    }
    
    /**
     * Stop all instances of a sound
     * @param {string} name - Identifier of the sound to stop
     */
    function stop(name) {
        const pool = audioPool[name];
        if (!pool) return;
        
        try {
            pool.forEach(audio => {
                audio.pause();
                audio.currentTime = 0;
            });
        } catch (err) {
            console.warn(`[SafeAudio] Error stopping "${name}":`, err);
        }
    }
    
    /**
     * Stop all sounds
     */
    function stopAll() {
        Object.keys(audioPool).forEach(name => stop(name));
    }
    
    /**
     * Set master volume
     * @param {number} vol - Volume level (0-1)
     */
    function setVolume(vol) {
        volume = Math.max(0, Math.min(1, vol));
        
        // Update all pooled audio elements
        Object.values(audioPool).forEach(pool => {
            pool.forEach(audio => {
                try {
                    audio.volume = volume;
                } catch (e) {}
            });
        });
    }
    
    /**
     * Enable or disable all sounds
     * @param {boolean} state - True to enable, false to disable
     */
    function setEnabled(state) {
        enabled = !!state;
        if (!enabled) {
            stopAll();
        }
    }
    
    /**
     * Check if sounds are enabled
     * @returns {boolean}
     */
    function isEnabled() {
        return enabled;
    }
    
    /**
     * Get current volume
     * @returns {number}
     */
    function getVolume() {
        return volume;
    }
    
    // Public API
    return {
        preload: preload,
        play: play,
        stop: stop,
        stopAll: stopAll,
        setVolume: setVolume,
        getVolume: getVolume,
        setEnabled: setEnabled,
        isEnabled: isEnabled
    };
})();

console.log('[SafeAudio] Safe audio manager loaded');
