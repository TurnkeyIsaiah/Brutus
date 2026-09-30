# CLAUDE.md

Astra 6 reviews this app (web and desktop) and should read HANDOFF.md at the repo root first. It is the live redesign handoff. Claude's separate job is a later motion-design demo video of the marketing site, not this review.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Brutus.ai Desktop is an Electron-based real-time AI sales coaching application. It captures the rep's microphone audio (and, optionally, the prospect's system audio via screen-capture loopback) during sales calls, streams it to a backend service for transcription and analysis, and displays live coaching feedback in an always-on-top overlay window.

## Development Commands

### Running the Application
```bash
npm start                # Launch the Electron app in development mode
```

Electron 42+ no longer downloads its binary during `npm install`; the first `npm start` (or `npx electron --version`) downloads it.

The installed app and `npm start` share the `brutus-desktop` userData folder, so a running installed copy holds the single-instance lock and a dev launch just focuses it and exits. To run beside it, give the dev build its own profile: `BRUTUS_USER_DATA=<some folder> npm start` (ignored in packaged builds).

### Building for Distribution
```bash
npm run build           # Build for current platform
npm run build:win       # Build Windows installer (NSIS)
npm run build:mac       # Build macOS .dmg
npm run build:linux     # Build Linux AppImage
```

Build output is placed in the `dist/` directory.

### Releasing (CI)

Pushing a version tag (`vX.Y.Z`) triggers `.github/workflows/release.yml`, which builds the Windows/macOS/Linux installers on their native runners and publishes them — plus the `latest*.yml` feeds that `electron-updater` reads — to a GitHub Release for that tag. Typical flow: bump the version in `package.json` (and the settings "About" label), commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow uses the default `GITHUB_TOKEN`. macOS builds are code-signed (Developer ID) and notarized using the `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_ID_PASSWORD`, and `APPLE_TEAM_ID` repo secrets (scoped to the macOS runner). Build config is wrapped by `desktop/electron-builder.config.js`, which enables notarization (passing the Team ID explicitly to notarytool) only when those Apple credentials are present in the environment, and otherwise builds unsigned — so local `npm run build` still works without certs. Windows builds are currently unsigned.

## Architecture

### Window System (Dual Window Pattern)

The application uses two separate Electron windows:

1. **Main Window** (`renderer/app/index.html`, the bundled Paper UI)
   - Login/signup, dashboard, calls, roleplay, in-app Settings, logout
   - Start/Stop monitoring button (desktop only)
   - Can be hidden to system tray (doesn't close on minimize)

2. **Overlay Window** (`renderer/overlay.html`)
   - Always-on-top floating panel for live coaching (standard live calls only;
     cold-call mode is archived server-side and roleplay runs in the main window)
   - Excluded from screen capture (`setContentProtection(true)`)
   - Displays real-time Brutus feedback during calls
   - Shows metrics: talk ratio, interrupts, duration
   - Audio visualizer bars (32 bars, FFT visualization)
   - Only visible when monitoring is active
   - Draggable and resizable

Each window has its own preload (`src/preload-main.js`, `src/preload-overlay.js`, `src/preload-mascot.js`) exposing only the `window.brutus.*` functions that window uses. A third window, Lil Brutus (`renderer/lil-brutus.html`), is the always-on-top mascot.

### Audio and Screen Capture Flow

1. **Overlay window requests microphone access** via `getUserMedia()` (rep channel)
   - 16kHz sample rate for efficiency
   - Echo cancellation and noise suppression are **disabled** to preserve both voices

2. **Overlay window optionally captures system/screen audio** via `getDisplayMedia()` (prospect channel)
   - User picks a screen/window source; system audio loopback becomes the prospect channel
   - Falls back to rep-only audio if screen/system audio capture is unavailable

3. **Overlay window captures screenshots** via the selected screen source
   - A screenshot is taken on every 4th audio chunk (~2 minutes)
   - Drawn to a canvas and converted to JPEG base64, downscaled to max 960×540
   - Screenshot is omitted (null) when screen capture is disabled or fails

4. **Dual MediaRecorders record in 30-second chunks**
   - Format: `audio/webm;codecs=opus`
   - Rep and prospect channels are recorded separately and base64-encoded
   - Sent (with an optional screenshot) via WebSocket to the backend as `monitoring_data`

5. **Real-time visualization** using Web Audio API
   - `AnalyserNode` with FFT size 64
   - Updates 32 frequency bars at ~60fps

### Backend Communication

**REST API** (default: `https://api.brutusai.coach`, configurable in settings):
- `POST /auth/login` - User authentication
- `POST /auth/signup` - User registration
- `GET /auth/me` - Verify token validity
- `GET /user/dashboard` - Fetch user stats
- `POST /live/start` - Start coaching session
- `POST /live/end` - End coaching session

Mode-specific routes also exist for cold-call (`/coldcall/*`), roleplay (`/roleplay/*`), TTS (`/tts`), notes (`/notes`), and research (`/research`).

Every backend request carries an `X-Brutus-Client: brutus-desktop` header so the backend can identify the desktop client by an explicit header rather than by the absence of an `Origin` header (security audit BR-14). In `renderer/app/app.js` this is added in `authFetch`; in `renderer/overlay.html` a scoped `window.fetch` wrapper tags only requests bound for `API_URL`. The same identifier is included in the WebSocket auth message as `client: 'brutus-desktop'`, since WS handshakes cannot send custom headers.

**WebSocket** (`/ws`, derived from the API URL with `http`→`ws`):
- After the socket opens, the client sends an auth message: `{ type: 'auth', token }`
- Sends `monitoring_data` messages with dual-channel audio and an optional screenshot
  - Payload structure: `{ type: 'monitoring_data', payload: { sessionId, repAudio, prospectAudio, screenshot, timestamp, timeIntoCall, mimeType, aiNotesEnabled } }`
  - `repAudio` / `prospectAudio`: base64-encoded audio chunks (audio/webm); either may be null
  - `screenshot`: base64-encoded JPEG image (or null when not captured this chunk)
  - `timestamp`: Unix timestamp in milliseconds
  - `timeIntoCall`: Seconds elapsed since monitoring started
  - `aiNotesEnabled`: whether the AI notes toggle is on
- Receives `brutus_feedback` (shown only when `payload.coach === true`), `chat_response`, and `OUT_OF_TOKENS` (auto-stops the session)
- Auto-reconnects on disconnect (exponential backoff capped at 30s) if session is active

### Data Persistence

Uses `electron-store` for local storage:
- `authToken` - JWT authentication token
- `user` - User profile object (name, email)
- `settings` - App settings object:
  - `apiUrl` - Backend URL (default: `https://api.brutusai.coach`)
  - `autoStart` - Launch on system startup (default: `false`)
  - `overlayOpacity` - Overlay transparency (default: `0.95`)
  - `audioFeedback` / `minFeedbackInterval` / `ttsVoice` - TTS playback preferences
  - `whiteBackground`, `lilBrutusPos`, `lilBrutusVisible` - Paper UI preferences
- `sessionMode` is removed on startup (left by 1.4.0 and earlier; no longer used)

### System Tray Integration

- App lives in system tray and doesn't quit when windows are closed
- Tray menu provides:
  - Open Brutus (shows main window)
  - Start/Stop Monitoring (toggles overlay)
  - Quit (exits application)
- Single instance lock prevents multiple app instances

### IPC Communication Pattern

Main process (`src/main.js`) exposes handlers via `ipcMain.handle()`:
- All handlers are asynchronous and return promises
- Renderer processes call via `ipcRenderer.invoke()` (wrapped in preload)
- Events from main to renderer use `webContents.send()` for monitoring state changes

Key IPC channels:
- Auth: `get-auth`, `set-auth`, `clear-auth` (clear-auth ends a live call first)
- Window: `minimize-window`, `close-window`, `quit-app`
- Monitoring: `start-monitoring` (returns `{ok, reason}`; refused while signed out or while the last call is saving), `stop-monitoring` (fire and forget), `end-monitoring` (waits until the overlay has closed the session; used by logout and account deletion), `is-monitoring`, `get-monitoring-state` (`idle|live|stopping`)
- Overlay handshake: `overlay-ready`, `capture-state`, `overlay-stopped` (overlay → main, sender-checked)
- Capture: `get-screen-sources`, `set-capture-intent` (overlay only; see Screen Capture)
- Overlay: `move-overlay`, `resize-overlay`, gesture channels
- Settings: `get-settings`, `set-settings`
- Main → main window: `monitoring-started`, `monitoring-stopped`, `monitoring-finished` (call saved or failed)

Preload callbacks receive only the payload, never the IPC event, and each `on*` subscription returns an unsubscribe function.

### Feedback Classification

Brutus feedback comes in 4 types (displayed with different colors):
- `critical` - Red, urgent issues (e.g., interrupting prospect)
- `warning` - Orange, important but not critical
- `insight` - Blue, helpful observations
- `good` - Green, positive reinforcement

## Key Implementation Details

### GPU Hardware Acceleration

Hardware acceleration is disabled to prevent GPU-related crashes:
- `app.disableHardwareAcceleration()` called on startup
- Command-line switches: `--disable-gpu` and `--disable-software-rasterizer`
- This fixes "GPU state invalid after WaitForGetOffsetInRange" errors
- No visual performance impact for this application

### Security model

- **Windows**: every BrowserWindow uses  in : sandbox on, contextIsolation on, nodeIntegration off, webSecurity on, DevTools only in unpackaged builds (F12 / Ctrl+Shift+I likewise). The backend's CORS allows the null origin the file:// renderer sends, so webSecurity stays on.
- **Navigation**:  keeps every window on our own  pages, denies popups and webviews; the main window hands https links to the system browser.
- **IPC**: every channel is registered through  / , which refuse any sender that is not one of the named windows showing one of our own pages (). There is no unguarded  registration.
- **Permissions**:  allows the microphone for the main window (roleplay) and overlay, screen capture for the overlay only, and denies everything else.
- **Content-Security-Policy**  on every page: scripts only from local files (no inline scripts or handlers anywhere), connections only to the API (plus localhost for dev) and PostHog ingest/config in the main window, fonts from Google Fonts. Remote images used by the Paper design are shipped locally (, ).
- **Analytics**: PostHog runs in the main window only, from the local  bundle with ; autocapture and session replay mask all text and inputs; events are tagged ; dev builds are marked internal. The overlay has no analytics.
- **Settings**:  allow-lists the keys  accepts. The installed app only ever uses  (the API URL field is hidden); dev builds may also use .
- **Overlay**:  keeps it out of screen shares and Brutus's own screenshots.

### CSS View Switching

View switching uses a combination of CSS classes and `!important` rules:
- Base `.view` class has `display: none !important`
- Active views have `.view.active` with `display: flex !important`
- The `!important` is necessary because specific view classes (`.login-view`, `.dashboard-view`) need flex layout
- Without `!important`, CSS specificity would cause multiple views to display simultaneously

### Monitoring State Management

`src/monitoringController.js` owns monitoring state in the main process (`idle | live | stopping`). Every way of leaving a call goes through its `requestStop()`, which asks the overlay to stop and waits (up to 45s) for `overlay-stopped`: the Stop button, tray, logout, account deletion, API URL change, quitting (before-quit is held until the call is saved), "Restart now" for an update (the update prompt is also deferred until no call is live), and Alt+F4 on the overlay (the overlay is hidden, not destroyed). If the overlay renderer crashes, main ends the session itself with `/live/end` and builds a fresh overlay on the next start. A start requested while the overlay page is loading is delivered once, on `overlay-ready`.

### Audio Chunk Timing

Audio is recorded continuously but sent in discrete chunks:
- 30-second intervals controlled by `setInterval()`
- Each chunk includes `timeIntoCall` metadata
- Rep and prospect recorders are flushed together via a serialized flush queue (`enqueueFlush`) to avoid races on stop and to keep both channels aligned
- A final flush runs on session stop so the tail of the call is not dropped
- MediaRecorder state checked before operations to prevent errors

### Screen Capture Implementation

- The overlay tells main exactly what it wants right before each `getDisplayMedia` call (`set-capture-intent`: `{screenSourceId|null, systemAudio}`). `src/displayMediaIntent.js` turns that into the display-media answer; an intent is single-use and expires after 30s, and a request without one is denied. There is **no fallback to the first screen**.
- "Screen" off or "skip — call audio only": no window is watched and no screenshots are taken, but the computer's call audio is still recorded (product rule). Chromium needs a video source anyway, so the overlay window is used as the carrier and its video track is stopped at once.
- Turning Screen back on mid-call goes through the picker and requests video only.
- Screenshots: every 4th audio chunk (~2 minutes), only while a picked window's video track is live; downscaled to max 960×540 JPEG.

### Session Lifecycle

`renderer/capture/capture-session.js` runs one session: `idle → consenting → picking → starting → live → stopping → idle`. `renderer/overlay.js` is only the UI around it. Both load in Node for tests (UMD).

1. Start Monitoring → main shows the overlay → `monitoring-started`
2. Recording-consent notice (audit BR-03); declining stops monitoring
3. Source picker (if Screen is on)
4. Auth and API URL are read now and snapshotted for the whole session
5. `POST /live/start` → `sessionId`; then the mic (failure → `/live/cancel` and a real message)
6. WebSocket `{type:'auth', token, client}`; the `connected` reply may list `capabilities: ['chunk_ack']`
7. Every 30s the rep + prospect chunks go into `renderer/capture/chunk-outbox.js` with a per-session `seq`; unacked chunks are replayed in order after a reconnect (memory only, max 20)
8. Stop: final flush → wait for every chunk to be acked (20s; old backends without acks get an 8s grace) → `POST /live/end {sessionId, lastSeq}` (90s timeout, one retry) → socket closed

Stop at any step cancels cleanly: a generation counter is checked after every await, a late `/live/start` is cancelled with `/live/cancel`, and a late mic grant is released. Close code 4001 (token revoked) ends the session instead of reconnecting. Out-of-tokens / subscription errors end the session and show the server's message.

### Error Handling

- Start failures show the actual reason (signed out, out of tokens, subscription required, archived mode, no mic, no network) and leave the overlay open to show it
- `/live/end`, notes and research check the response; a failed save is shown as a failure
- A "reconnecting… / N unsent" line under the metrics shows delivery trouble instead of silently dropping audio

## Backend Requirements

This desktop app requires a separate backend service (not included in this repo):
- Expected at `https://api.brutusai.coach` by default (configurable in settings)
- Must implement the REST and WebSocket endpoints listed above
- Handles Whisper transcription and Claude/Brutus AI analysis
- Returns coaching feedback via WebSocket in real-time

## Browser Dashboard Integration

The Brutus system has two components:
1. **Electron Desktop App** (this repo) - Lightweight live monitoring with overlay
2. **Browser Dashboard** - Full-featured web interface at `https://app.brutusai.coach/index.html`

The "open dashboard" button in the footer uses `shell.openExternal()` to launch the browser dashboard:
- Opens the fixed production dashboard URL (`https://app.brutusai.coach/index.html`)
- Opens in the user's default browser
- Allows access to full stats, chat, uploads, and draggable panels not available in the desktop app

## Asset Requirements

Icons should be placed in `assets/`:
- `icon.png` - Main app icon (512x512)
- `icon.ico` - Windows icon
- `icon.icns` - macOS icon
- `tray-icon.png` - System tray icon (16x16 or 32x32)

The app includes fallback logic to create a red placeholder icon if assets are missing.
