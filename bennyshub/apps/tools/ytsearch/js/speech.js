// TTS functionality using ONLY the unified voice manager - NO fallback TTS
function speak(text) {
    if (!text || text.trim() === '') return;
    
    console.log('🔊 Speaking:', text);
    
    // Wait for NarbeVoiceManager if not immediately available
    if (!window.NarbeVoiceManager) {
        console.log('⏳ NarbeVoiceManager not ready, waiting...');
        setTimeout(() => speak(text), 100);
        return;
    }
    
    // ONLY use the shared voice manager - no fallbacks allowed
    if (window.NarbeVoiceManager.speakProcessed) {
        window.NarbeVoiceManager.speakProcessed(text);
        const currentVoice = window.NarbeVoiceManager.getCurrentVoice();
        console.log('✅ Used NarbeVoiceManager with voice:', currentVoice?.name || 'default');
    } else {
        console.warn('❌ NarbeVoiceManager.speakProcessed not available - NO SPEECH');
    }
}

// Simple speech manager that ONLY uses the shared voice manager
class SpeechManager {
    constructor() {
        this.settingsChangeListener = null;
        this.initialized = false;
        this.initAttempts = 0;
        this.maxInitAttempts = 50; // 5 seconds max wait
        
        // Initialize synchronization with retry logic
        this.initializeVoiceSync();
    }
    
    initializeVoiceSync() {
        this.initAttempts++;
        
        if (window.NarbeVoiceManager && window.NarbeVoiceManager.onSettingsChange) {
            console.log('🔄 Setting up voice synchronization...');
            
            // Register for settings changes
            this.settingsChangeListener = (settings) => {
                console.log('🔄 Voice settings changed in ytsearch app:', settings);
                if (settings.voiceName) {
                    console.log('📢 Voice changed to:', settings.voiceName);
                }
            };
            
            window.NarbeVoiceManager.onSettingsChange(this.settingsChangeListener);
            this.initialized = true;
            console.log('✅ Voice synchronization initialized');
            
        } else if (this.initAttempts < this.maxInitAttempts) {
            // Retry initialization if voice manager isn't ready yet
            console.log(`⏳ Waiting for NarbeVoiceManager... (attempt ${this.initAttempts}/${this.maxInitAttempts})`);
            setTimeout(() => {
                this.initializeVoiceSync();
            }, 100);
        } else {
            console.error('❌ Failed to initialize NarbeVoiceManager after maximum attempts');
        }
    }

    speak(text) {
        speak(text);
    }
    
    queueSpeak(text) {
        speak(text);
    }
    
    stop() {
        try {
            if (window.NarbeVoiceManager && window.NarbeVoiceManager.cancel) {
                window.NarbeVoiceManager.cancel();
            }
        } catch (error) {
            console.error('Error stopping speech:', error);
        }
    }
    
    toggle() {
        try {
            if (window.NarbeVoiceManager && window.NarbeVoiceManager.toggleTTS) {
                return window.NarbeVoiceManager.toggleTTS();
            }
        } catch (error) {
            console.error('Error toggling TTS:', error);
        }
        return true;
    }
    
    // Getter to check if TTS is enabled
    get enabled() {
        try {
            if (window.NarbeVoiceManager && window.NarbeVoiceManager.getSettings) {
                const settings = window.NarbeVoiceManager.getSettings();
                return settings.ttsEnabled;
            }
        } catch (error) {
            console.error('Error getting TTS enabled state:', error);
        }
        return true;
    }
    
    // Setter for enabled state
    set enabled(value) {
        try {
            if (window.NarbeVoiceManager && window.NarbeVoiceManager.getSettings && window.NarbeVoiceManager.toggleTTS) {
                const settings = window.NarbeVoiceManager.getSettings();
                if (settings.ttsEnabled !== value) {
                    window.NarbeVoiceManager.toggleTTS();
                }
            }
        } catch (error) {
            console.error('Error setting TTS enabled state:', error);
        }
    }
    
    // Cleanup method
    destroy() {
        if (this.settingsChangeListener && window.NarbeVoiceManager && window.NarbeVoiceManager.offSettingsChange) {
            window.NarbeVoiceManager.offSettingsChange(this.settingsChangeListener);
            console.log('🧹 Voice synchronization cleaned up');
        }
    }
}

// Global speech manager instance
console.log('🎤 Creating global speechManager...');
window.speechManager = new SpeechManager();