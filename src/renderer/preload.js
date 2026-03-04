const { contextBridge, ipcRenderer } = require('electron');

const IPC_CHANNELS = {
  networkRequestStart: 'network-request-start',
  networkRequestComplete: 'network-request-complete',
  copyToClipboard: 'copy-to-clipboard',
  getPageSource: 'get-page-source',
};

contextBridge.exposeInMainWorld('api', {
  onNetworkRequestStart: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.networkRequestStart, (_, data) => callback(data));
  },
  onNetworkRequestComplete: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.networkRequestComplete, (_, data) => callback(data));
  },
  copyToClipboard: (text) => ipcRenderer.invoke(IPC_CHANNELS.copyToClipboard, text),
  getPageSource: () => ipcRenderer.invoke(IPC_CHANNELS.getPageSource),
});
