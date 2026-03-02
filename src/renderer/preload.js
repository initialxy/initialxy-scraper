const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onNetworkRequestStart: (callback) =>
    ipcRenderer.on('network-request-start', (_, data) => callback(data)),
  onNetworkRequestComplete: (callback) =>
    ipcRenderer.on('network-request-complete', (_, data) => callback(data)),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  getPageSource: () => ipcRenderer.invoke('get-page-source'),
  applySelector: () => ipcRenderer.invoke('apply-selector'),
  scrollPage: () => ipcRenderer.invoke('scroll-page'),
  checkSourceCompleted: () => ipcRenderer.invoke('check-source-completed'),
  markSourceCompleted: (url) => ipcRenderer.invoke('mark-source-completed', url),
  getCompletedStatus: () => ipcRenderer.invoke('get-completed-status'),
});
