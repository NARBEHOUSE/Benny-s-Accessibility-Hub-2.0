// preload.js — context bridge for Ben's Messenger frontend.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('benAPI', {
  readFile:     (p)            => ipcRenderer.invoke('msg-read-file', p),
  writeFile:    (p, data)      => ipcRenderer.invoke('msg-write-file', p, data),
  updateNgrams: (p, delta)     => ipcRenderer.invoke('msg-update-ngrams', p, delta),
  getConfig:    ()             => ipcRenderer.invoke('msg-get-config'),
  close:        ()             => ipcRenderer.invoke('msg-close'),
  openVideo:    (url)          => ipcRenderer.invoke('msg-open-video', url),
});
