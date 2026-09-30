// Every IPC handler names which of our windows may call it. A message from any
// other sender (a window we did not create, a navigated-away page, a frame
// that is not our own local page) is refused.
const { pathToFileURL } = require('url');
const path = require('path');

const RENDERER_ROOT = pathToFileURL(path.join(__dirname, '..', 'renderer') + path.sep).href.toLowerCase();

function isOwnPage(url) {
  return typeof url === 'string' && url.toLowerCase().startsWith(RENDERER_ROOT);
}

// windows: functions returning the BrowserWindow (or null) allowed to call.
function allowFrom(event, windows) {
  if (!event || !event.sender) return false;
  const frame = event.senderFrame; // null once the frame navigated away or died
  if (!frame || !isOwnPage(frame.url)) return false;
  return windows.some((getWindow) => {
    const win = getWindow();
    return !!(win && !win.isDestroyed() && event.sender === win.webContents);
  });
}

// Wraps an ipcMain.handle callback. Refused calls resolve to `refused`.
function guardHandle(windows, handler, refused = undefined) {
  return (event, ...args) => (allowFrom(event, windows) ? handler(event, ...args) : refused);
}

// Wraps an ipcMain.on callback. Refused messages are dropped.
function guardOn(windows, handler) {
  return (event, ...args) => {
    if (allowFrom(event, windows)) handler(event, ...args);
  };
}

module.exports = { allowFrom, guardHandle, guardOn, isOwnPage, RENDERER_ROOT };
