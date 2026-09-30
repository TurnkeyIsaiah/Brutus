// Decides what a getDisplayMedia request from the overlay is allowed to capture.
//
// The overlay states its intent right before asking: which window the rep picked
// (or none) and whether the computer's audio should be recorded. An intent is
// used once and expires, and a request without one is denied. There is no
// fallback to "the first screen": capturing something the rep did not pick is
// exactly the bug this replaces.
//
// Chromium's getDisplayMedia always needs a video source, even when only the
// computer audio is wanted. For audio-only the overlay's own window (excluded
// from capture by content protection) or, failing that, a screen is supplied as
// the carrier, and the overlay stops that video track immediately.

const INTENT_TTL_MS = 30000;

function createIntentStore({ now = () => Date.now() } = {}) {
  let pending = null;
  return {
    set(intent) {
      pending = normalize(intent) ? { intent: normalize(intent), at: now() } : null;
      return !!pending;
    },
    take() {
      const current = pending;
      pending = null;
      if (!current || now() - current.at > INTENT_TTL_MS) return null;
      return current.intent;
    }
  };
}

function normalize(intent) {
  if (!intent || typeof intent !== 'object') return null;
  const screenSourceId = typeof intent.screenSourceId === 'string' && intent.screenSourceId
    ? intent.screenSourceId
    : null;
  const systemAudio = intent.systemAudio === true;
  if (!screenSourceId && !systemAudio) return null;
  return { screenSourceId, systemAudio };
}

// Returns the object to pass to setDisplayMediaRequestHandler's callback.
// `{}` denies the request.
function resolveDisplayMedia(intent, sources, carrierSourceId) {
  if (!intent || !Array.isArray(sources)) return {};
  let video = null;
  if (intent.screenSourceId) {
    video = sources.find((s) => s.id === intent.screenSourceId) || null;
    if (!video) return {}; // the picked window is gone: never substitute another
  } else if (intent.systemAudio) {
    video = (carrierSourceId && sources.find((s) => s.id === carrierSourceId)) ||
      sources.find((s) => typeof s.id === 'string' && s.id.startsWith('screen:')) ||
      null;
    if (!video) return {};
  } else {
    return {};
  }
  return intent.systemAudio ? { video, audio: 'loopback' } : { video };
}

module.exports = { createIntentStore, resolveDisplayMedia, INTENT_TTL_MS };
