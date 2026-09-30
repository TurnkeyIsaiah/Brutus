const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brutus', {
  // Screen capture
  setSelectedSource: (sourceId) => ipcRenderer.invoke('set-selected-source', sourceId),
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
  showOverlay: () => ipcRenderer.invoke('show-overlay'),

  // Overlay
  getOverlayBounds: () => ipcRenderer.invoke('get-overlay-bounds'),
  moveOverlay: (x, y) => ipcRenderer.invoke('move-overlay', { x, y }),
  resizeOverlay: (width, height) => ipcRenderer.invoke('resize-overlay', { width, height }),
  beginOverlayGesture: (mode, edge) => ipcRenderer.send('overlay-gesture-begin', { mode, edge }),
  endOverlayGesture: () => ipcRenderer.send('overlay-gesture-end'),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),

  // Lil Brutus — a small always-on-top window, dragged like the overlay.
  setLilBrutusVisible: (shown) => ipcRenderer.invoke('set-lil-brutus-visible', !!shown),
  beginLilBrutusGesture: () => ipcRenderer.send('lil-brutus-gesture-begin'),
  endLilBrutusGesture: () => ipcRenderer.send('lil-brutus-gesture-end'),
  setLilBrutusSession: (session) => ipcRenderer.send('lil-brutus-session', session || {}),
  onLilBrutusSession: (callback) => ipcRenderer.on('lil-brutus-session', (_event, session) => callback(session)),
  clipLilBrutus: (file) => ipcRenderer.send('lil-brutus-clip', String(file || 'bust.png')),

  // Settings
  showSettings: () => ipcRenderer.invoke('show-settings'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),

  // Session mode (null = standard | 'cold-call')
  getSessionMode: () => ipcRenderer.invoke('get-session-mode'),
  setSessionMode: (mode) => ipcRenderer.invoke('set-session-mode', mode),

  // Dashboard
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),

  // Open external URLs
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Events from main process
  onMonitoringStarted: (callback) => ipcRenderer.on('monitoring-started', callback),
  onMonitoringStopped: (callback) => ipcRenderer.on('monitoring-stopped', callback),
  onAuthCleared: (callback) => ipcRenderer.on('auth-cleared', callback),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
