// Lil Brutus window: draws the current mascot frame and forwards drags to
// the main process (see src/main.js, LIL BRUTUS section).
(function () {
  'use strict';
  var dragging = false;
  var canvas = document.getElementById('mascot');
  var ctx = canvas.getContext('2d', { alpha: true });
  var image = new Image();
  var motion = null;
  var downScreen = null;

  function paint() {
    var dpr = window.devicePixelRatio || 1;
    var cssW = document.documentElement.clientWidth || 168;
    var cssH = document.documentElement.clientHeight || 95;
    var w = Math.max(1, Math.round(cssW * dpr));
    var h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!image.complete || !image.naturalWidth) return;
    var fit = Math.min(w / image.naturalWidth, h / image.naturalHeight);
    var dw = image.naturalWidth * fit;
    var dh = image.naturalHeight * fit;
    var ox = (w - dw) / 2;
    var oy = (h - dh) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, ox, oy, dw, dh);
    // Scaling blends the solid drawing into the clear plate. Keep a faint
    // fringe out, and make the rest solid ink so the beige page cannot
    // show through the costume. The empty plate stays black for the
    // window clip.
    var frame = ctx.getImageData(0, 0, w, h);
    var data = frame.data;
    for (var i = 0; i < data.length; i += 4) {
      var a = data[i + 3];
      if (a < 16) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
        continue;
      }
      if (a < 255) {
        var scale = 255 / a;
        data[i] = Math.min(255, Math.round(data[i] * scale));
        data[i + 1] = Math.min(255, Math.round(data[i + 1] * scale));
        data[i + 2] = Math.min(255, Math.round(data[i + 2] * scale));
      }
      data[i + 3] = 255;
    }
    ctx.putImageData(frame, 0, 0);
  }

  image.onload = paint;
  image.src = 'app/mascot-frames/bust.png';
  window.addEventListener('resize', paint);

  function beginDrag() {
    if (dragging) return;
    dragging = true;
    document.body.classList.add('is-dragging');
    if (motion) motion.pauseBob();
    if (window.brutus && window.brutus.beginLilBrutusGesture) {
      window.brutus.beginLilBrutusGesture();
    }
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('is-dragging');
    if (window.brutus && window.brutus.endLilBrutusGesture) {
      window.brutus.endLilBrutusGesture();
    }
    if (motion) motion.resumeBob();
  }

  window.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    event.preventDefault();
    downScreen = { x: event.screenX, y: event.screenY };
    try { event.target.setPointerCapture(event.pointerId); } catch (e) {}
    beginDrag();
  });

  window.addEventListener('pointerup', function (event) {
    if (event.button !== 0) return;
    var start = downScreen;
    downScreen = null;
    endDrag();
    if (!start || !motion) return;
    var dx = event.screenX - start.x;
    var dy = event.screenY - start.y;
    if (Math.hypot(dx, dy) < 6) motion.cycle();
  });

  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', endDrag);

  var shown = image;
  function showFrame(_frame, file) {
    if (!file) return;
    if (!showFrame.cache) showFrame.cache = {};
    var cached = showFrame.cache[file];
    if (!cached) {
      cached = new Image();
      cached.src = 'app/mascot-frames/' + file;
      showFrame.cache[file] = cached;
    }
    shown = cached;
    image = cached;
    if (cached.complete && cached.naturalWidth) paint();
    else cached.onload = function () { if (shown === cached) paint(); };
    if (window.brutus && window.brutus.clipLilBrutus) window.brutus.clipLilBrutus(file);
  }

  ['shadow.png', 'punch-jab.png', 'punch-cross.png'].forEach(function (file) {
    if (!showFrame.cache) showFrame.cache = {};
    if (showFrame.cache[file]) return;
    var cached = new Image();
    cached.src = 'app/mascot-frames/' + file;
    showFrame.cache[file] = cached;
  });

  motion = window.createLilBrutusMotion({
    showFrame: showFrame,
    bobTarget: canvas
  });

  if (window.brutus && window.brutus.onLilBrutusSession) {
    window.brutus.onLilBrutusSession(function (session) {
      if (!session || !motion) return;
      if (session.kind === 'roleplay') motion.setRoleplay(!!session.on);
      else if (session.kind === 'monitoring') motion.setMonitoring(!!session.on);
    });
  }
})();
