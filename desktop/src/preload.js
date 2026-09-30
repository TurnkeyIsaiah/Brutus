const { contextBridge, ipcRenderer } = require('electron');

// Subscribes a page callback to a main-process event. The callback gets only the
// payload (never the IPC event object), and the return value unsubscribes.
function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('brutus', {
  // Screen capture (overlay)
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  setCaptureIntent: (intent) => ipcRenderer.invoke('set-capture-intent', intent),

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
  endMonitoring: (options) => ipcRenderer.invoke('end-monitoring', options || {}),
  isMonitoring: () => ipcRenderer.invoke('is-monitoring'),
  getMonitoringState: () => ipcRenderer.invoke('get-monitoring-state'),
  showOverlay: () => ipcRenderer.invoke('show-overlay'),

  // Overlay ↔ main session bookkeeping
  overlayReady: () => ipcRenderer.send('overlay-ready'),
  reportCaptureState: (state) => ipcRenderer.send('capture-state', state || {}),
  overlayStopped: (info) => ipcRenderer.send('overlay-stopped', info || {}),

  // Overlay window
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
  onLilBrutusSession: (callback) => subscribe('lil-brutus-session', callback),
  clipLilBrutus: (file) => ipcRenderer.send('lil-brutus-clip', String(file || 'bust.png')),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),

  // Dashboard
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),

  // Open external URLs
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Events from main process
  onMonitoringStarted: (callback) => subscribe('monitoring-started', callback),
  onMonitoringStopped: (callback) => subscribe('monitoring-stopped', callback),
  onMonitoringFinished: (callback) => subscribe('monitoring-finished', callback),
  onAuthCleared: (callback) => subscribe('auth-cleared', callback)
});
