/**
 * iframe-bridge.js — lets Benny's Web Search run inside the hub's app iframe.
 *
 * Mirrors the same pattern as the messenger's iframe-bridge.js.
 * Builds window.searchAPI on top of electronAPI.search (exposed by preload.js)
 * and kicks off the Python WebSocket backend.
 */
(function () {
  'use strict';

  var inIframe = window.parent && window.parent !== window;
  if (!inIframe) return;

  var api = (window.electronAPI && window.electronAPI.search) || null;

  window.searchAPI = {
    getConfig: function () {
      if (api) return api.getConfig();
      return Promise.resolve({ appDir: '', wsPort: 8778 });
    },
    close: function () {
      window.parent.postMessage({ action: 'closeApp' }, '*');
      return Promise.resolve(true);
    }
  };

  // Start the backend — idempotent on the hub side.
  try { if (api) api.startBackend(); } catch (e) {}
})();
