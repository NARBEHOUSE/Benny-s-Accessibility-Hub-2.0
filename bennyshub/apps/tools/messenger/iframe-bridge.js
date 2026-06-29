/**
 * iframe-bridge.js — lets Ben's Messenger run inside the hub's app iframe.
 *
 * When the messenger runs as its own Electron app, its preload exposes
 * `window.benAPI` and this file does nothing. When it runs inside the hub iframe
 * there is no such preload, so we rebuild `window.benAPI` on top of the shared
 * electron bridge (`window.electronAPI.messenger.*`, proxied to the hub's main
 * process) and kick off the python WebSocket backend.
 *
 * Load order in index.html: electron-bridge.js → iframe-bridge.js → app scripts.
 */
(function () {
  'use strict';

  // Standalone Electron app already provides the real benAPI — leave it alone.
  if (window.benAPI) return;

  // Only meaningful inside an iframe with the bridge available.
  var inIframe = window.parent && window.parent !== window;
  if (!inIframe) return;

  var msg = (window.electronAPI && window.electronAPI.messenger) || null;
  if (!msg) {
    // Bridge not available — provide a minimal benAPI so the app still loads.
    window.benAPI = {
      getConfig: function () { return Promise.resolve({ appDir: '', wsPort: 8777 }); },
      readFile: function () { return Promise.resolve(null); },
      writeFile: function () { return Promise.resolve(false); },
      updateNgrams: function () { return Promise.resolve(false); },
      openVideo: function () { return Promise.resolve(false); },
      close: function () { window.parent.postMessage({ action: 'closeApp' }, '*'); return Promise.resolve(true); }
    };
    return;
  }

  window.benAPI = {
    getConfig:    function ()        { return msg.getConfig(); },
    readFile:     function (p)       { return msg.readFile(p); },
    writeFile:    function (p, data) { return msg.writeFile(p, data); },
    updateNgrams: function (p, d)    { return msg.updateNgrams(p, d); },
    openVideo:    function (url)     { return msg.openVideo(url); },
    // In the iframe, "closing" the app means asking the hub to close the iframe
    // and return the switch focus to the hub menu (no mouse click needed).
    close:        function ()        { window.parent.postMessage({ action: 'closeApp' }, '*'); return Promise.resolve(true); }
  };

  // Make sure the python WebSocket backend is running. Idempotent on the hub
  // side; the frontend auto-reconnects until it comes up.
  try { msg.startBackend(); } catch (e) {}
})();
