const { contextBridge, ipcRenderer } = require('electron');

const IPC_CHANNELS = {
  networkRequestStart: 'network-request-start',
  networkRequestComplete: 'network-request-complete',
  copyToClipboard: 'copy-to-clipboard',
  getPageSource: 'get-page-source',
  applySelector: 'apply-selector',
  scrollPage: 'scroll-page',
  checkSourceCompleted: 'check-source-completed',
  markSourceCompleted: 'mark-source-completed',
  getCompletedStatus: 'get-completed-status',
};

contextBridge.exposeInMainWorld('api', {
  onNetworkRequestStart: (callback) =>
    ipcRenderer.on(IPC_CHANNELS.networkRequestStart, (_, data) => callback(data)),
  onNetworkRequestComplete: (callback) =>
    ipcRenderer.on(IPC_CHANNELS.networkRequestComplete, (_, data) => callback(data)),
  copyToClipboard: (text) => ipcRenderer.invoke(IPC_CHANNELS.copyToClipboard, text),
  getPageSource: () => ipcRenderer.invoke(IPC_CHANNELS.getPageSource),
  applySelector: () => ipcRenderer.invoke(IPC_CHANNELS.applySelector),
  scrollPage: () => ipcRenderer.invoke(IPC_CHANNELS.scrollPage),
  checkSourceCompleted: () => ipcRenderer.invoke(IPC_CHANNELS.checkSourceCompleted),
  markSourceCompleted: (url) => ipcRenderer.invoke(IPC_CHANNELS.markSourceCompleted, url),
  getCompletedStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getCompletedStatus),
});
