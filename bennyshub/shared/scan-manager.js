/**
 * Unified Scan Manager for Narbehouse Accessibility Hub
 * Provides centralized scanning settings and logic helpers across all apps
 */

window.NarbeScanManager = (function() {
  'use strict';

  // Storage key for scan settings
  const STORAGE_KEY = 'narbe-scan-settings';
  
  // Available scan speeds in milliseconds
  const SCAN_SPEEDS = [1000, 2000, 3000, 4000];

  // Default settings
  const DEFAULT_SETTINGS = {
    autoScan: false,   // Default per agents.md (Off for Ben games)
    scanSpeedIndex: 1  // Default to 2000ms (index 1)
  };

  // Internal state
  let settings = { ...DEFAULT_SETTINGS };
  let observers = []; // For notifying games of setting changes

  /**
   * Load settings from localStorage
   */
  function loadSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Validate and merge
        settings = { ...DEFAULT_SETTINGS, ...parsed };
        
        // Ensure index is valid
        if (settings.scanSpeedIndex < 0 || settings.scanSpeedIndex >= SCAN_SPEEDS.length) {
          settings.scanSpeedIndex = DEFAULT_SETTINGS.scanSpeedIndex;
        }
      }
    } catch (error) {
      console.warn('NarbeScanManager: Error loading settings:', error);
      settings = { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Save settings to localStorage
   */
  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      notifyObservers();
    } catch (error) {
      console.error('NarbeScanManager: Error saving settings:', error);
    }
  }

  /**
   * Notify all registered observers of changes
   */
  function notifyObservers() {
    observers.forEach(callback => {
      try {
        callback(getPublicState());
      } catch (e) {
        console.error('NarbeScanManager: Error in observer callback:', e);
      }
    });
  }

  /**
   * Get current state for public consumption
   */
  function getPublicState() {
    return {
      autoScan: settings.autoScan,
      scanSpeedIndex: settings.scanSpeedIndex,
      scanInterval: SCAN_SPEEDS[settings.scanSpeedIndex]
    };
  }

  // Initialize
  loadSettings();

  // Listen for storage events from other windows/iframes
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      loadSettings();
      notifyObservers();
    }
  });

  // Universal Input Cooldown
  // Blocks rapid repetitive inputs (spamming) to prevent accidental double-scanning
  // Implements a strict .5s cooldown after any valid release (Key Up / Click)
  const INPUT_COOLDOWN_MS = 250;
  let lastReleaseTime = 0; // Shared timestamp for the last valid release
  const blockedInteractions = new Set(); // Set of IDs currently in a blocked sequence

  function handleGlobalInput(e) {
    let id;
    let isTargetEvent = false;

    // 1. Identify Source
    if (e.type.startsWith('key')) {
      // Only target Space and Enter for cooldown logic as requested
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        id = e.code;
        isTargetEvent = true;
      }
    } else {
      id = 'pointer'; // Group mouse/touch/pointer as one
      isTargetEvent = true;
    }

    // Pass through non-target keys (e.g. arrows, letters)
    if (!isTargetEvent) return;

    const now = Date.now();

    // 2. Start of Sequence (Down)
    // Check if we start a new press. If we are in cooldown, BLOCK IT.
    if (e.type === 'keydown' || e.type === 'mousedown' || e.type === 'touchstart') {
      
      // Strict global cooldown check from last release
      if (now - lastReleaseTime < INPUT_COOLDOWN_MS) {
        blockedInteractions.add(id);
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        return false;
      }
      
      // Also block if this specific source is already flagged (e.g. held down repeats)
      if (blockedInteractions.has(id)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        return false;
      }
    }

    // 3. End of Sequence (Up/Click)
    else if (e.type === 'keyup' || e.type === 'mouseup' || e.type === 'touchend' || e.type === 'click' || e.type === 'touchcancel') {
      
      // If this sequence was blocked, consume the release event and clear the flag
      if (blockedInteractions.has(id)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();

        // Clear flag on final events
        // KeyUp is final for keys. Click is final for mouse. TouchEnd/Cancel for touch.
        const isFinalEvent = (e.type === 'keyup' || e.type === 'click' || e.type === 'touchend' || e.type === 'touchcancel');
        
        // Ensure we clear 'pointer' eventually even if click doesn't fire (mouseup fallback if needed? 
        // No, let's stick to click for robustness against click-listeners. Stuck state (rare) requires one dead click to clear.)
        if (isFinalEvent) { 
             blockedInteractions.delete(id);
        } else if (e.type === 'mouseup') {
             // For mouseup, we keep the block active to catch the subsequent click.
        }
        return false;
      }

      // Valid release: Update the cooldown timer
      if (e.type === 'keyup' || e.type === 'mouseup') {
        lastReleaseTime = now;
      }
    }
  }

  // Register capturing listeners to intercept events before they reach apps
  ['keydown', 'keyup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'].forEach(type => {
    window.addEventListener(type, handleGlobalInput, true);
  });

  // Public API
  return {
    /**
     * Force reload settings from storage
     */
    reload: function() {
      loadSettings();
      notifyObservers();
    },

    /**
     * Get current scan settings
     * @returns {Object} { autoScan, scanSpeedIndex, scanInterval }
     */
    getSettings: function() {
      return getPublicState();
    },

    /**
     * Get the actual scan interval in milliseconds
     * @returns {number} Milliseconds
     */
    getScanInterval: function() {
      return SCAN_SPEEDS[settings.scanSpeedIndex];
    },

    /**
     * Update multiple settings at once
     * @param {Object} newSettings Partial settings object
     */
    updateSettings: function(newSettings) {
      if (!newSettings) return;
      
      let changed = false;
      
      if (typeof newSettings.autoScan === 'boolean') {
        settings.autoScan = newSettings.autoScan;
        changed = true;
      }
      
      if (typeof newSettings.scanSpeedIndex === 'number' && 
          newSettings.scanSpeedIndex >= 0 && 
          newSettings.scanSpeedIndex < SCAN_SPEEDS.length) {
        settings.scanSpeedIndex = newSettings.scanSpeedIndex;
        changed = true;
      }
      
      if (changed) {
        saveSettings();
      }
    },

    /**
     * Set auto scan enabled/disabled
     * @param {boolean} enabled 
     */
    setAutoScan: function(enabled) {
      settings.autoScan = !!enabled;
      saveSettings();
    },

    /**
     * Toggle auto scan enabled/disabled
     */
    toggleAutoScan: function() {
      this.setAutoScan(!settings.autoScan);
    },

    /**
     * Set scan speed by index
     * @param {number} index 0-3 corresponding to 1s, 2s, 3s, 4s
     */
    setScanSpeedIndex: function(index) {
      if (index >= 0 && index < SCAN_SPEEDS.length) {
        settings.scanSpeedIndex = index;
        saveSettings();
      }
    },

    /**
     * Cycle to next scan speed
     */
    cycleScanSpeed: function() {
      let next = settings.scanSpeedIndex + 1;
      if (next >= SCAN_SPEEDS.length) next = 0;
      this.setScanSpeedIndex(next);
      return next;
    },

    /**
     * Subscribe to setting changes
     * @param {Function} callback Function to call when settings change
     */
    subscribe: function(callback) {
      if (typeof callback === 'function' && !observers.includes(callback)) {
        observers.push(callback);
      }
    },

    /**
     * Unsubscribe from setting changes
     * @param {Function} callback 
     */
    unsubscribe: function(callback) {
      observers = observers.filter(obs => obs !== callback);
    },

    /**
     * Helper to get available speeds
     */
    getAvailableSpeeds: function() {
      return [...SCAN_SPEEDS];
    }
  };
})();
