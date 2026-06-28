/**
 * Electron API Bridge for Iframes
 * 
 * This script allows iframe apps to access the parent window's electronAPI
 * through postMessage communication.
 * 
 * Usage: Include this script in your iframe app's HTML
 * It will create window.electronAPI if running in an Electron iframe
 */

(function() {
  'use strict';

  // Check if we already have electronAPI (running in main window)
  if (window.electronAPI) {
    console.log('[ElectronBridge] Direct electronAPI available');
    return;
  }

  // Check if we're in an iframe
  const inIframe = window.parent && window.parent !== window;
  if (!inIframe) {
    console.log('[ElectronBridge] Not in iframe, no bridge needed');
    return;
  }

  // Check if parent has electronAPI by sending a test message
  let parentHasElectron = false;
  let pendingCalls = {};
  let callId = 0;

  // Create the bridge API
  function createBridgeMethod(methodPath) {
    return function(...args) {
      return new Promise((resolve, reject) => {
        const id = ++callId;
        pendingCalls[id] = { resolve, reject };
        
        window.parent.postMessage({
          type: 'electronAPI:call',
          id: id,
          method: methodPath,
          args: args
        }, '*');
        
        // Timeout after 10 seconds
        setTimeout(() => {
          if (pendingCalls[id]) {
            delete pendingCalls[id];
            reject(new Error('Bridge call timeout: ' + methodPath));
          }
        }, 10000);
      });
    };
  }

  // Listen for responses from parent
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'electronAPI:response') return;
    
    const { id, result, error } = event.data;
    const pending = pendingCalls[id];
    
    if (pending) {
      delete pendingCalls[id];
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    }
  });

  // Create the electronAPI bridge object
  window.electronAPI = {
    // Keyboard API
    keyboard: {
      getPredictions: createBridgeMethod('keyboard.getPredictions'),
      savePrediction: createBridgeMethod('keyboard.savePrediction'),
      saveNgram: createBridgeMethod('keyboard.saveNgram'),
      clearPredictions: createBridgeMethod('keyboard.clearPredictions')
    },
    
    // Journal API
    journal: {
      getEntries: createBridgeMethod('journal.getEntries'),
      saveEntries: createBridgeMethod('journal.saveEntries'),
      getQuestions: createBridgeMethod('journal.getQuestions')
    },
    
    // Streaming API
    streaming: {
      getData: createBridgeMethod('streaming.getData'),
      getEpisodes: createBridgeMethod('streaming.getEpisodes'),
      getLastWatched: createBridgeMethod('streaming.getLastWatched'),
      saveProgress: createBridgeMethod('streaming.saveProgress'),
      getSearchHistory: createBridgeMethod('streaming.getSearchHistory'),
      saveSearch: createBridgeMethod('streaming.saveSearch'),
      clearSearchHistory: createBridgeMethod('streaming.clearSearchHistory'),
      launch: createBridgeMethod('streaming.launch')
    },
    
    // Launch API
    launch: {
      messenger: createBridgeMethod('launch.messenger'),
      search: createBridgeMethod('launch.search'),
      editor: createBridgeMethod('launch.editor')
    },
    
    // Editor API
    editor: {
      list: createBridgeMethod('editor.list'),
      open: createBridgeMethod('editor.open')
    },
    
    // Window API
    window: {
      focus: createBridgeMethod('window.focus'),
      minimize: createBridgeMethod('window.minimize'),
      close: createBridgeMethod('window.close'),
      toggleFullscreen: createBridgeMethod('window.toggleFullscreen')
    },
    
    // System API
    system: {
      volumeUp: createBridgeMethod('system.volumeUp'),
      volumeDown: createBridgeMethod('system.volumeDown'),
      volumeMute: createBridgeMethod('system.volumeMute'),
      volumeMax: createBridgeMethod('system.volumeMax'),
      shutdownTimer: createBridgeMethod('system.shutdownTimer'),
      cancelShutdown: createBridgeMethod('system.cancelShutdown'),
      restart: createBridgeMethod('system.restart'),
      shutdown: createBridgeMethod('system.shutdown'),
      closeApp: createBridgeMethod('system.closeApp')
    },
    
    // Chrome/Control bar
    chrome: {
      close: createBridgeMethod('chrome.close')
    },
    controlBar: {
      close: createBridgeMethod('controlBar.close')
    },
    
    // Mark as bridge
    isElectron: true,
    isBridge: true
  };

  // Also set the simple check
  window.isElectron = true;

  console.log('[ElectronBridge] Iframe API bridge created');
})();
