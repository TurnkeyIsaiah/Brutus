/* Lil Brutus motion. anime.js 4.5 timelines. Navigation does not change his pose. */
(function (root) {
  var ORDER = ['bust', 'laptop', 'notes', 'shadow'];
  var FILES = {
    bust: 'bust.png',
    laptop: 'laptop.png',
    notes: 'notes.png',
    shadow: 'shadow.png',
    'lap-close': 'lap-close.png',
    'lap-stand': 'lap-stand.png',
    'lap-behind': 'lap-behind.png',
    'notes-draw': 'notes-draw.png',
    'fists-rise': 'fists-rise.png',
    'punch-jab': 'punch-jab.png',
    'punch-cross': 'punch-cross.png'
  };
  /* Guard, jab, guard, cross. The next loop starts on guard again. */
  var PUNCH = ['shadow', 'punch-jab', 'shadow', 'punch-cross'];
  /* Stand up, put the prop behind his back, then bring the next prop out.
     Reverse plays the same beats backward (reach back, items appear, sit down). */
  var PATHS = {
    'laptop>bust': ['lap-close', 'lap-stand', 'lap-behind', 'bust'],
    'bust>laptop': ['lap-behind', 'lap-stand', 'lap-close', 'laptop'],
    'notes>bust': ['notes-draw', 'bust'],
    'bust>notes': ['notes-draw', 'notes'],
    'shadow>bust': ['fists-rise', 'bust'],
    'bust>shadow': ['fists-rise', 'shadow'],
    'laptop>notes': ['lap-close', 'lap-stand', 'lap-behind', 'bust', 'notes-draw', 'notes'],
    'notes>laptop': ['notes-draw', 'bust', 'lap-behind', 'lap-stand', 'lap-close', 'laptop'],
    'laptop>shadow': ['lap-close', 'lap-stand', 'lap-behind', 'bust', 'fists-rise', 'shadow'],
    'shadow>laptop': ['fists-rise', 'bust', 'lap-behind', 'lap-stand', 'lap-close', 'laptop'],
    'notes>shadow': ['notes-draw', 'bust', 'fists-rise', 'shadow'],
    'shadow>notes': ['fists-rise', 'bust', 'notes-draw', 'notes']
  };
  var HOLD = 200;

  function createLilBrutusMotion(opts) {
    var pose = 'bust';
    var dest = 'bust';
    var playing = false;
    var pending = null;
    var timeline = null;
    var punchTl = null;
    var punchToken = 0;
    var roleplay = false;
    var monitoring = false;
    var timer = null;
    var bob = null;
    opts = opts || {};

    function reduced() {
      if (opts.reduced) return opts.reduced();
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function api() {
      return opts.anime || window.anime;
    }

    function show(frame) {
      var file = FILES[frame] || FILES.bust;
      if (opts.showFrame) opts.showFrame(frame, file);
    }

    function framesBetween(from, to) {
      if (from === to) return [];
      var listed = PATHS[from + '>' + to];
      return listed ? listed.slice() : [to];
    }

    function armTimer() {
      clearTimeout(timer);
      timer = setTimeout(onTimer, 25000);
    }

    function onTimer() {
      if (roleplay || monitoring || playing || reduced()) {
        armTimer();
        return;
      }
      cycle();
      armTimer();
    }

    function stopPunch() {
      punchToken += 1;
      if (!punchTl) return;
      try { punchTl.cancel(); } catch (e) {}
      punchTl = null;
    }

    function startPunch() {
      if (punchTl || playing || pose !== 'shadow' || reduced()) return;
      var anime = api();
      if (!anime || typeof anime.createTimeline !== 'function') return;
      var token = punchToken;
      var tl = anime.createTimeline({ autoplay: false, loop: true });
      PUNCH.forEach(function (frame, i) {
        tl.call(function () {
          if (token !== punchToken || pose !== 'shadow' || playing) return;
          show(frame);
        }, i * HOLD);
      });
      tl.add({ duration: HOLD }, (PUNCH.length - 1) * HOLD);
      punchTl = tl;
      tl.play();
    }

    function landed(to) {
      pose = to;
      dest = to;
      playing = false;
      timeline = null;
      show(pose);
      var next = pending;
      pending = null;
      if (next && next !== pose) start(next);
      else if (pose === 'shadow') startPunch();
    }

    function start(to) {
      var frames = framesBetween(pose, to);
      dest = to;
      stopPunch();
      if (!frames.length) {
        pose = to;
        show(pose);
        if (pose === 'shadow') startPunch();
        return;
      }
      var anime = api();
      if (!anime || typeof anime.createTimeline !== 'function' || reduced()) {
        pose = to;
        dest = to;
        show(to);
        return;
      }
      playing = true;
      var tl = anime.createTimeline({
        autoplay: false,
        onComplete: function () { landed(to); }
      });
      frames.forEach(function (frame, i) {
        tl.call(function () { show(frame); }, i * HOLD);
      });
      tl.add({ duration: HOLD }, (frames.length - 1) * HOLD);
      timeline = tl;
      tl.play();
    }

    function request(to) {
      if (!FILES[to]) return;
      if (playing) {
        pending = to;
        return;
      }
      if (to === pose) return;
      start(to);
      armTimer();
    }

    function cycle() {
      var base = playing ? (pending || dest) : pose;
      var i = ORDER.indexOf(base);
      if (i < 0) i = 0;
      request(ORDER[(i + 1) % ORDER.length]);
    }

    function setRoleplay(on) {
      on = !!on;
      if (on === roleplay) return;
      roleplay = on;
      if (roleplay) request('shadow');
      else if (!monitoring) request('bust');
      else request('notes');
    }

    function setMonitoring(on) {
      on = !!on;
      if (on === monitoring) return;
      monitoring = on;
      if (monitoring) request('notes');
      else if (!roleplay) request('bust');
      else request('shadow');
    }

    function startBob() {
      var anime = api();
      if (!anime || typeof anime.animate !== 'function' || reduced() || bob) return;
      if (!opts.bobTarget) return;
      // Resting position stays put. This 2px bob reverses on the element.
      // It must not write window y, CSS top, or a saved position.
      bob = anime.animate(opts.bobTarget, {
        translateY: [0, -2],
        duration: 2600,
        ease: 'inOutSine',
        loop: true,
        alternate: true,
        composition: 'replace'
      });
    }

    function pauseBob() {
      if (bob && typeof bob.pause === 'function') bob.pause();
    }

    function resumeBob() {
      if (reduced()) return;
      if (bob && typeof bob.restart === 'function') bob.restart();
      else startBob();
    }

    show('bust');
    startBob();
    armTimer();

    return {
      request: request,
      cycle: cycle,
      setRoleplay: setRoleplay,
      setMonitoring: setMonitoring,
      pauseBob: pauseBob,
      resumeBob: resumeBob,
      pose: function () { return pose; },
      playing: function () { return playing; }
    };
  }

  root.createLilBrutusMotion = createLilBrutusMotion;
})(window);
