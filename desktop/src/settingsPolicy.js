// Which settings the renderer may change, and what values are allowed. Anything
// else in a set-settings patch is dropped.
//
// apiUrl decides where the rep's password, token and call audio go, so an
// installed app only ever talks to the production API; development builds may
// also use a local backend.

const PRODUCTION_API_URL = 'https://api.brutusai.coach';

function isAllowedApiUrl(value, { packaged }) {
  if (typeof value !== 'string') return false;
  let url;
  try {
    url = new URL(value.trim());
  } catch (_) {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  const origin = `${url.protocol}//${url.host}`;
  if (origin === PRODUCTION_API_URL && (url.pathname === '/' || url.pathname === '')) return true;
  if (packaged) return false;
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return local && (url.protocol === 'http:' || url.protocol === 'https:') && (url.pathname === '/' || url.pathname === '');
}

const RULES = {
  apiUrl: (v, ctx) => (isAllowedApiUrl(v, ctx) ? v.trim().replace(/\/+$/, '') : undefined),
  autoStart: (v) => (typeof v === 'boolean' ? v : undefined),
  overlayOpacity: (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined),
  audioFeedback: (v) => (typeof v === 'boolean' ? v : undefined),
  minFeedbackInterval: (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 5 && n <= 600 ? n : undefined;
  },
  ttsVoice: (v) => (typeof v === 'string' && /^[A-Za-z0-9]{0,40}$/.test(v) ? v : undefined),
  whiteBackground: (v) => (typeof v === 'boolean' ? v : undefined)
};

// Returns { patch, rejected }: the accepted subset and the keys that were refused.
function validateSettingsPatch(input, ctx) {
  const patch = {};
  const rejected = [];
  if (!input || typeof input !== 'object') return { patch, rejected };
  for (const key of Object.keys(input)) {
    const rule = RULES[key];
    const value = rule ? rule(input[key], ctx || {}) : undefined;
    if (value === undefined) rejected.push(key);
    else patch[key] = value;
  }
  return { patch, rejected };
}

module.exports = { validateSettingsPatch, isAllowedApiUrl, PRODUCTION_API_URL };
