const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brutus', {
  // Screen capture
  getScreenSources: async () => {
    try {
      console.log('[Preload] Requesting screen sources via IPC...');
      const sources = await ipcRenderer.invoke('get-screen-sources');
      console.log(`[Preload] Received ${sources.length} sources from main process`);
      sources.forEach((source, index) => {
        console.log(`[Preload] Source ${index}:`, {
          id: source.id,
          name: source.name,
          display_id: source.display_id
        });
      });
      return sources;
    } catch (error) {
      console.error('[Preload] ERROR: Failed to get screen sources via IPC');
      console.error('[Preload] Error name:', error.name);
      console.error('[Preload] Error message:', error.message);
      console.error('[Preload] Error stack:', error.stack);
      console.error('[Preload] Full error object:', error);
      throw error;
    }
  },


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

  // Dashboard
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),

  // Open external URLs
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Events from main process
  onMonitoringStarted: (callback) => ipcRenderer.on('monitoring-started', callback),
  onMonitoringStopped: (callback) => ipcRenderer.on('monitoring-stopped', callback),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
