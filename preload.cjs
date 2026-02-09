const { contextBridge, ipcRenderer } = require('electron');

const validReceiveChannels = new Set([
  'screenshot-stack',
  'show-loading',
  'api-response',
  'api-error',
  'clear-ai-response',
  'scroll-ai-response',
  'shortcut-registration-warning'
]);

contextBridge.exposeInMainWorld('electronAPI', {
  on: (channel, listener) => {
    if (!validReceiveChannels.has(channel) || typeof listener !== 'function') {
      return () => {};
    }

    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  setOverlayInteractive: (allow) => {
    if (typeof allow !== 'boolean') return;
    ipcRenderer.send('allow-scroll', allow);
  }
});
