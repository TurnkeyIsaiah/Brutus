const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brutus', {
  // Auth
  getAuth: () => ipcRenderer.invoke('get-auth'),
  setAuth: (data) => ipcRenderer.invoke('set-auth', data),
  clearAuth: () => ipcRenderer.invoke('clear-auth'),
  
  // Window controls
  minimize: () => ipcRenderer.invoke('minimize-window'),
  close: () => ipcRenderer.invoke('close-window'),
  quit: () => ipcRenderer.invoke('quit-app'),
  
  // Monitoring
  startMonitoring: () => ipcRenderer.invoke('start-monitoring'),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  isMonitoring: () => ipcRenderer.invoke('is-monitoring'),
  
  // Overlay
  moveOverlay: (x, y) => ipcRenderer.invoke('move-overlay', { x, y }),
  resizeOverlay: (width, height) => ipcRenderer.invoke('resize-overlay', { width, height }),
  
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
  
  // Events from main process
  onMonitoringStarted: (callback) => ipcRenderer.on('monitoring-started', callback),
  onMonitoringStopped: (callback) => ipcRenderer.on('monitoring-stopped', callback),
  
  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
