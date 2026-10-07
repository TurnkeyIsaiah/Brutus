// Shared API origin for static frontend pages.
(function () {
  const host = window.location.hostname;
  const port = window.location.port;
  const isPreviewProxy = (host === 'localhost' || host === '127.0.0.1') && port === '4174';
  const isLocalBackend = (host === 'localhost' || host === '127.0.0.1') && !isPreviewProxy;
  window.BRUTUS_API_URL = isPreviewProxy ? window.location.origin : (isLocalBackend ? 'http://localhost:3001' : 'https://api.brutusai.coach');
  window.BRUTUS_FETCH_CREDENTIALS = 'include';

  // Signups.
  // Reopened 2026-07-21 so content creators can make accounts pre-launch.
  // The backend /auth/signup route has a matching SIGNUPS_ENABLED flag in
  // backend/src/routes/auth.js — flip both together.
  window.BRUTUS_SIGNUPS_ENABLED = true;
  window.BRUTUS_WAITLIST_URL = 'https://www.brutusai.coach/waitlist.html';

  // Desktop app downloads.
  // Restored 2026-07-21 (walkthrough modal, empty-calls card, credits view).
  // Update the URLs below when a newer release ships.
  window.BRUTUS_DOWNLOADS_ENABLED = true;
  window.BRUTUS_DOWNLOAD_URLS = {
    windows: 'https://github.com/TurnkeyIsaiah/Brutus/releases/download/v1.5.0/Brutus-AI-Setup-1.5.0.exe',
    macArm: 'https://github.com/TurnkeyIsaiah/Brutus/releases/download/v1.5.0/Brutus-AI-1.5.0-arm64.dmg',
    macIntel: 'https://github.com/TurnkeyIsaiah/Brutus/releases/download/v1.5.0/Brutus-AI-1.5.0.dmg'
  };
  // Both mac builds ship LSMinimumSystemVersion 12.0, and the arm64 dmg carries an
  // arm64-only binary that will not launch on an Intel mac. Surfaced next to every
  // mac CTA so Intel owners pick the right build instead of a dead one.
  window.BRUTUS_MAC_REQUIREMENT = 'macOS 12 (Monterey) or later';
})();
