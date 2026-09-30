// Clips the Lil Brutus window to the mascot's opaque pixels.
// Hardware acceleration is off, so a transparent BrowserWindow never paints.
// The page stays opaque (the character blocks whatever is behind him) and
// Windows drops the empty plate with a window region. Color-keying black
// would also punch out the engraved lines, which are opaque pixels.

const { nativeImage } = require('electron');
const fs = require('fs');

const RGN_OR = 2;

let api = null;
let cachedImage = null;

function win32() {
  if (api) return api;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const gdi32 = koffi.load('gdi32.dll');
  api = {
    hwndOf(win) {
      return koffi.decode(win.getNativeWindowHandle(), 'void *');
    },
    GetWindowRect: user32.func('int __stdcall GetWindowRect(void *hWnd, void *lpRect)'),
    GetClientRect: user32.func('int __stdcall GetClientRect(void *hWnd, void *lpRect)'),
    ClientToScreen: user32.func('int __stdcall ClientToScreen(void *hWnd, void *lpPoint)'),
    SetWindowRgn: user32.func('int __stdcall SetWindowRgn(void *hWnd, void *hRgn, int bRedraw)'),
    CreateRectRgn: gdi32.func('void * __stdcall CreateRectRgn(int x1, int y1, int x2, int y2)'),
    CombineRgn: gdi32.func('int __stdcall CombineRgn(void *dest, void *src1, void *src2, int mode)'),
    DeleteObject: gdi32.func('int __stdcall DeleteObject(void *ho)')
  };
  return api;
}

function loadMascot(pngPath) {
  if (cachedImage && cachedImage.path === pngPath) return cachedImage;
  if (!fs.existsSync(pngPath)) return null;
  const image = nativeImage.createFromPath(pngPath);
  const size = image.getSize();
  if (!size.width || !size.height || image.isEmpty()) return null;
  cachedImage = {
    path: pngPath,
    width: size.width,
    height: size.height,
    bitmap: image.toBitmap()
  };
  return cachedImage;
}

function clientMetrics(user, hwnd) {
  const client = Buffer.alloc(16);
  const windowRect = Buffer.alloc(16);
  const origin = Buffer.alloc(8);
  if (!user.GetClientRect(hwnd, client) || !user.GetWindowRect(hwnd, windowRect)) return null;
  user.ClientToScreen(hwnd, origin);
  return {
    width: client.readInt32LE(8),
    height: client.readInt32LE(12),
    originX: origin.readInt32LE(0) - windowRect.readInt32LE(0),
    originY: origin.readInt32LE(4) - windowRect.readInt32LE(4)
  };
}

function opaqueRuns(mascot, metrics) {
  const { width: clientW, height: clientH, originX, originY } = metrics;
  const fit = Math.min(clientW / mascot.width, clientH / mascot.height);
  if (!Number.isFinite(fit) || fit <= 0) return [];
  const drawW = mascot.width * fit;
  const drawH = mascot.height * fit;
  const offX = (clientW - drawW) / 2;
  const offY = (clientH - drawH) / 2;
  const runs = [];
  const alphaAt = (x, y) => {
    const sx = Math.floor((x + 0.5 - offX) / fit);
    const sy = Math.floor((y + 0.5 - offY) / fit);
    if (sx < 0 || sy < 0 || sx >= mascot.width || sy >= mascot.height) return 0;
    return mascot.bitmap[(sy * mascot.width + sx) * 4 + 3];
  };
  for (let y = 0; y < clientH; y++) {
    let x = 0;
    while (x < clientW) {
      if (alphaAt(x, y) <= 128) {
        x += 1;
        continue;
      }
      const start = x;
      x += 1;
      while (x < clientW && alphaAt(x, y) > 128) x += 1;
      runs.push({
        left: originX + start,
        top: originY + y,
        right: originX + x,
        bottom: originY + y + 1
      });
    }
  }
  return runs;
}

function clipLilBrutusToMascot(win, pngPath) {
  if (process.platform !== 'win32') return false;
  if (!win || win.isDestroyed()) return false;
  const mascot = loadMascot(pngPath);
  if (!mascot) {
    console.error('[lil-brutus] clip skipped, mascot image missing');
    return false;
  }
  let user;
  try {
    user = win32();
  } catch (err) {
    console.error('[lil-brutus] clip skipped', err?.message || err);
    return false;
  }
  const hwnd = user.hwndOf(win);
  const metrics = clientMetrics(user, hwnd);
  if (!metrics || metrics.width < 8 || metrics.height < 8) return false;
  const runs = opaqueRuns(mascot, metrics);
  if (runs.length < 8) {
    console.error('[lil-brutus] clip skipped, empty silhouette');
    return false;
  }
  const region = user.CreateRectRgn(0, 0, 0, 0);
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const piece = user.CreateRectRgn(run.left, run.top, run.right, run.bottom);
    user.CombineRgn(region, region, piece, RGN_OR);
    user.DeleteObject(piece);
  }
  const ok = user.SetWindowRgn(hwnd, region, 1);
  if (!ok) {
    user.DeleteObject(region);
    console.error('[lil-brutus] SetWindowRgn failed');
    return false;
  }
  return true;
}

module.exports = { clipLilBrutusToMascot };
