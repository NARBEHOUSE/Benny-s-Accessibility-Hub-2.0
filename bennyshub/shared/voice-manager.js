/**
 * Unified Voice Manager for Narbehouse Accessibility Hub
 * Provides centralized voice settings management across all apps
 */

window.NarbeVoiceManager = (function() {
  'use strict';

  // Storage key for voice settings
  const STORAGE_KEY = 'narbe-voice-settings';
  
  // Default voice settings
  const DEFAULT_SETTINGS = {
    ttsEnabled: true,
    voiceIndex: 0,
    voiceName: null, // Store voice name for better persistence
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0
  };

  // Internal state
  let settings = { ...DEFAULT_SETTINGS };
  let availableVoices = [];
  let englishVoices = [];
  let voicesLoaded = false;
  let callbacks = [];
  let isReceivingMessage = false; // Flag to prevent message loops

  /**
   * Load voice settings from localStorage
   */
  function loadSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch (error) {
      console.warn('NarbeVoiceManager: Error loading settings:', error);
      settings = { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Save voice settings to localStorage
   * @param {boolean} fromMessage - True if this save is triggered by a message to prevent loops
   */
  function saveSettings(fromMessage = false) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      
      // Notify all callbacks of settings change
      callbacks.forEach(callback => {
        try {
          callback(settings);
        } catch (error) {
          console.warn('NarbeVoiceManager: Error in callback:', error);
        }
      });
      
      // Only send messages if this wasn't triggered by a message to prevent loops
      if (!fromMessage) {
        // Post message to parent window (for iframe communication)
        if (window.parent && window.parent !== window) {
          try {
            window.parent.postMessage({
              type: 'narbe-voice-settings-changed',
              settings: settings
            }, '*');
          } catch (error) {
            console.warn('NarbeVoiceManager: Error posting to parent:', error);
          }
        }
        
        // Post message to all child iframes (if we're the parent)
        try {
          const iframes = document.querySelectorAll('iframe');
          iframes.forEach(iframe => {
            if (iframe.contentWindow) {
              iframe.contentWindow.postMessage({
                type: 'narbe-voice-settings-changed',
                settings: settings
              }, '*');
            }
          });
        } catch (error) {
          console.warn('NarbeVoiceManager: Error posting to iframes:', error);
        }
      }
      
    } catch (error) {
      console.warn('NarbeVoiceManager: Error saving settings:', error);
    }
  }

  /**
   * Load available voices from the speech synthesis API
   */
  function loadVoices() {
    if (!('speechSynthesis' in window)) {
      console.warn('NarbeVoiceManager: Speech synthesis not supported');
      return;
    }

    availableVoices = window.speechSynthesis.getVoices();
    
    if (availableVoices.length > 0) {
      // Filter for English voices
      englishVoices = availableVoices.filter(voice => 
        voice.lang.startsWith('en-') || 
        voice.lang === 'en' ||
        voice.name.toLowerCase().includes('english')
      );
      
      // If no English voices found, fallback to any English voice
      if (englishVoices.length === 0) {
        englishVoices = availableVoices.filter(voice => voice.lang.startsWith('en'));
      }
      
      // If still no voices, use first available
      if (englishVoices.length === 0 && availableVoices.length > 0) {
        englishVoices = [availableVoices[0]];
      }

      // Restore voice by name if possible, otherwise validate index
      if (settings.voiceName) {
        const savedVoiceIndex = englishVoices.findIndex(voice => voice.name === settings.voiceName);
        if (savedVoiceIndex >= 0) {
          settings.voiceIndex = savedVoiceIndex;
          console.log(`NarbeVoiceManager: Restored voice "${settings.voiceName}" at index ${savedVoiceIndex}`);
        } else {
          console.warn(`NarbeVoiceManager: Saved voice "${settings.voiceName}" not found, using index ${settings.voiceIndex}`);
        }
      }

      // Ensure voice index is within bounds
      if (settings.voiceIndex >= englishVoices.length) {
        settings.voiceIndex = 0;
        console.warn(`NarbeVoiceManager: Voice index out of bounds, reset to 0`);
      }

      // Update voice name to match current index
      if (englishVoices[settings.voiceIndex]) {
        settings.voiceName = englishVoices[settings.voiceIndex].name;
        saveSettings();
      }

      voicesLoaded = true;
      console.log(`NarbeVoiceManager: Loaded ${englishVoices.length} English voices:`, 
                  englishVoices.map(v => v.name));
      
      // Notify callbacks that voices are loaded and settings may have changed
      callbacks.forEach(callback => {
        try {
          callback(settings);
        } catch (error) {
          console.warn('NarbeVoiceManager: Error in voice load callback:', error);
        }
      });
    }
  }

  /**
   * Initialize the voice manager
   */
  function init() {
    console.log('NarbeVoiceManager: Initializing...');
    loadSettings();
    console.log('NarbeVoiceManager: Settings loaded:', settings);
    loadVoices();
    
    // Set up voice loading callback
    if ('speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    
    // Set up cross-iframe communication
    window.addEventListener('message', (event) => {
      if (!event.data) return;

      // Handle incoming settings change
      if (event.data.type === 'narbe-voice-settings-changed') {
        try {
          // Update local settings from parent/child window
          const newSettings = event.data.settings;
          if (newSettings && typeof newSettings === 'object') {
            settings = { ...DEFAULT_SETTINGS, ...newSettings };
            // Save with fromMessage=true to avoid infinite loop
            saveSettings(true);
            console.log('NarbeVoiceManager: Synced settings from message:', settings);
          }
        } catch (error) {
          console.warn('NarbeVoiceManager: Error handling voice settings message:', error);
        }
      }
      
      // Handle request for settings (from child iframe)
      if (event.data.type === 'narbe-voice-settings-request') {
          // Send current settings back to source
          if (event.source) {
              event.source.postMessage({
                  type: 'narbe-voice-settings-changed',
                  settings: settings
              }, '*');
          }
      }
    });
    
    // Request settings from parent (if we are a child)
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'narbe-voice-settings-request' }, '*');
    }
    
    // Retry loading voices after a delay if not loaded
    if (!voicesLoaded) {
      setTimeout(loadVoices, 100);
    }
  }

  /**
   * Get current voice settings
   */
  function getSettings() {
    return { ...settings };
  }

  /**
   * Update voice settings
   */
  function updateSettings(newSettings) {
    settings = { ...settings, ...newSettings };
    
    // If voice index changed, update voice name to match
    if (newSettings.voiceIndex !== undefined && englishVoices[settings.voiceIndex]) {
      settings.voiceName = englishVoices[settings.voiceIndex].name;
    }
    
    saveSettings();
  }

  /**
   * Get available English voices
   */
  function getEnglishVoices() {
    return [...englishVoices];
  }

  /**
   * Get the current voice object
   */
  function getCurrentVoice() {
    if (englishVoices.length > 0) {
      // Validate voice index is within bounds
      if (settings.voiceIndex >= 0 && settings.voiceIndex < englishVoices.length) {
        return englishVoices[settings.voiceIndex];
      } else {
        // If saved index is invalid, reset to 0 and save
        console.warn(`NarbeVoiceManager: Invalid voice index ${settings.voiceIndex}, resetting to 0`);
        settings.voiceIndex = 0;
        saveSettings();
        return englishVoices[0];
      }
    }
    return null;
  }

  /**
   * Get a user-friendly display name for a voice
   */
  function getVoiceDisplayName(voice) {
    if (!voice) return "Default";
    
    const name = voice.name.toLowerCase();
    
    // Clean up voice name for better display
    let displayName = voice.name;
    
    // Remove common prefixes and suffixes for cleaner display
    displayName = displayName.replace(/^(Microsoft|Google|Apple|Samsung)\s+/i, '');
    displayName = displayName.replace(/\s+(Premium|Enhanced|Compact|Desktop|Mobile)$/i, '');
    displayName = displayName.replace(/\s+\([^)]+\)$/i, ''); // Remove parenthetical info
    
    // Take only the first word/name for simplicity
    displayName = displayName.split(' ')[0];
    
    // Capitalize first letter
    displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
    
    return displayName;
  }

  /**
   * Cycle to the next available voice
   */
  function cycleVoice() {
    if (englishVoices.length === 0) return false;
    
    settings.voiceIndex = (settings.voiceIndex + 1) % englishVoices.length;
    
    // Update voice name to match new index
    if (englishVoices[settings.voiceIndex]) {
      settings.voiceName = englishVoices[settings.voiceIndex].name;
    }
    
    saveSettings();
    return true;
  }

  /**
   * Toggle TTS enabled/disabled
   */
  function toggleTTS() {
    settings.ttsEnabled = !settings.ttsEnabled;
    saveSettings();
    return settings.ttsEnabled;
  }

  /**
   * Speak text using current voice settings
   */
  function speak(text, options = {}) {
    if (!settings.ttsEnabled || !text || !('speechSynthesis' in window)) return;
    
    // If voices aren't loaded yet, wait for them
    if (!voicesLoaded || englishVoices.length === 0) {
      // Wait for voices to load, then try again
      const waitForVoices = () => {
        if (voicesLoaded && englishVoices.length > 0) {
          speak(text, options);
        } else {
          setTimeout(waitForVoices, 100);
        }
      };
      waitForVoices();
      return;
    }
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(String(text));
    
    // Apply voice settings
    utterance.rate = options.rate || settings.rate;
    utterance.pitch = options.pitch || settings.pitch;
    utterance.volume = options.volume || settings.volume;
    
    // Set voice - should be available now
    const currentVoice = getCurrentVoice();
    if (currentVoice) {
      utterance.voice = currentVoice;
    } else {
      console.warn('NarbeVoiceManager: No voice available, using default');
    }
    
    window.speechSynthesis.speak(utterance);
  }

  /**
   * Process text for better TTS pronunciation
   */
  function processTextForTTS(text) {
    // List of common 2-letter words that should be spoken as words, not letters
    const twoLetterWords = ['IT', 'IS', 'IN', 'AT', 'ON', 'TO', 'OF', 'AS', 'BY', 'IF', 
                           'OR', 'SO', 'UP', 'DO', 'GO', 'HE', 'WE', 'ME', 'BE', 'NO', 
                           'MY', 'AN', 'AM', 'US', 'OK', 'HI', 'OH', 'AH', 'HA'];
    
    return text.split(' ').map(fullWord => {
      // Handle contractions
      if (fullWord.includes("'")) {
        const parts = fullWord.split("'");
        const processedParts = parts.map((part, index) => {
          if (index === 0) {
            return part.toLowerCase();
          } else {
            return part.toLowerCase();
          }
        });
        return processedParts.join("'");
      }
      // Non-contraction words
      else {
        // Check if it's a 2-letter word that should be spoken as a word
        if (fullWord.length === 2 && twoLetterWords.includes(fullWord.toUpperCase())) {
          return fullWord.toLowerCase();
        }
        // For other all-caps words longer than 2 letters, convert to lowercase
        else if (fullWord.length > 2 && fullWord === fullWord.toUpperCase() && /^[A-Z]+$/.test(fullWord)) {
          return fullWord.toLowerCase();
        }
        // Keep single letters as uppercase (they should be spelled out)
        else if (fullWord.length === 1 && /^[A-Z]$/.test(fullWord)) {
          return fullWord;
        }
        // Default: convert to lowercase for natural speech
        else {
          return fullWord.toLowerCase();
        }
      }
    }).join(' ');
  }

  /**
   * Speak text with improved pronunciation processing
   */
  function speakProcessed(text, options = {}) {
    const processedText = processTextForTTS(text);
    speak(processedText, options);
  }

  /**
   * Cancel any ongoing speech
   */
  function cancel() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * Register a callback to be notified when settings change
   */
  function onSettingsChange(callback) {
    if (typeof callback === 'function') {
      callbacks.push(callback);
    }
  }

  /**
   * Unregister a settings change callback
   */
  function offSettingsChange(callback) {
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  /**
   * Check if voices are loaded
   */
  function areVoicesLoaded() {
    return voicesLoaded;
  }

  /**
   * Wait for voices to be loaded
   */
  function waitForVoices() {
    return new Promise((resolve) => {
      if (voicesLoaded) {
        resolve();
        return;
      }
      
      const checkVoices = () => {
        if (voicesLoaded) {
          resolve();
        } else {
          setTimeout(checkVoices, 50);
        }
      };
      
      checkVoices();
    });
  }

  // Initialize when the script loads
  init();

  // Public API
  return {
    // Settings management
    getSettings,
    updateSettings,
    
    // Voice management
    getEnglishVoices,
    getCurrentVoice,
    getVoiceDisplayName,
    cycleVoice,
    
    // TTS functionality
    toggleTTS,
    speak,
    speakProcessed,
    cancel,
    
    // Text processing
    processTextForTTS,
    
    // Event handling
    onSettingsChange,
    offSettingsChange,
    
    // Status
    areVoicesLoaded,
    waitForVoices
  };
})();