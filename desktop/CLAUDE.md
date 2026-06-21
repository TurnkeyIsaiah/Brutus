# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Brutus.ai Desktop is an Electron-based real-time AI sales coaching application. It captures the rep's microphone audio (and, optionally, the prospect's system audio via screen-capture loopback) during sales calls, streams it to a backend service for transcription and analysis, and displays live coaching feedback in an always-on-top overlay window.

## Development Commands

### Running the Application
```bash
npm start                # Launch the Electron app in development mode
```

### Building for Distribution
```bash
npm run build           # Build for current platform
npm run build:win       # Build Windows installer (NSIS)
npm run build:mac       # Build macOS .dmg
npm run build:linux     # Build Linux AppImage
```

Build output is placed in the `dist/` directory.

### Releasing (CI)

Pushing a version tag (`vX.Y.Z`) triggers `.github/workflows/release.yml`, which builds the Windows/macOS/Linux installers on their native runners and publishes them — plus the `latest*.yml` feeds that `electron-updater` reads — to a GitHub Release for that tag. Typical flow: bump the version in `package.json` (and the settings "About" label), commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow uses the default `GITHUB_TOKEN`. macOS builds are code-signed (Developer ID) and notarized using the `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_ID_PASSWORD`, and `APPLE_TEAM_ID` repo secrets (scoped to the macOS runner); notarization is enabled via `mac.notarize: true` in `package.json`. Windows builds are currently unsigned.

## Architecture

### Window System (Dual Window Pattern)

The application uses two separate Electron windows:

1. **Main Window** (`renderer/main.html`)
   - Login/signup authentication
   - Dashboard with user stats and monitoring controls
   - Settings and logout
   - Can be hidden to system tray (doesn't close on minimize)
   - Frameless with custom title bar

2. **Overlay Window** (`renderer/overlay.html`)
   - Always-on-top floating panel for live coaching
   - Displays real-time Brutus feedback during calls
   - Shows metrics: talk ratio, interrupts, duration
   - Audio visualizer bars (32 bars, FFT visualization)
   - Only visible when monitoring is active
   - Draggable and resizable

Both windows share the same preload script (`src/preload.js`) which exposes IPC handlers via `window.brutus.*`.

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

Every backend request carries an `X-Brutus-Client: brutus-desktop` header so the backend can identify the desktop client by an explicit header rather than by the absence of an `Origin` header (security audit BR-14). In `renderer/main.html` this is added in the central `apiCall` helper; in `renderer/overlay.html` a scoped `window.fetch` wrapper tags only requests bound for `API_URL`. The same identifier is included in the WebSocket auth message as `client: 'brutus-desktop'`, since WS handshakes cannot send custom headers.

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
- `sessionMode` - `'cold-call'` | `'roleplay'` (deleted/absent for standard mode)

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
- Auth: `get-auth`, `set-auth`, `clear-auth`
- Window: `minimize-window`, `close-window`, `quit-app`
- Monitoring: `start-monitoring`, `stop-monitoring`, `is-monitoring`
- Overlay: `move-overlay`, `resize-overlay`
- Settings: `get-settings`, `set-settings`

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

### CORS and Web Security

Web security is **enabled** (the Electron default) in both windows:
- The backend's CORS configuration allows the null/`file://` origin that the Electron renderer sends
- Because the backend explicitly permits these requests, there is no need to disable `webSecurity`
- Keep `webSecurity` enabled; disabling it would weaken the renderer's protections unnecessarily

### CSS View Switching

View switching uses a combination of CSS classes and `!important` rules:
- Base `.view` class has `display: none !important`
- Active views have `.view.active` with `display: flex !important`
- The `!important` is necessary because specific view classes (`.login-view`, `.dashboard-view`) need flex layout
- Without `!important`, CSS specificity would cause multiple views to display simultaneously

### Monitoring State Management

The monitoring state (`isMonitoring`) is managed in the main process and synchronized across windows:
- Main window shows start/stop button with status indicator
- Overlay window only shown when monitoring is active
- System tray menu updates to reflect current state
- State persists across window closes/opens

### Audio Chunk Timing

Audio is recorded continuously but sent in discrete chunks:
- 30-second intervals controlled by `setInterval()`
- Each chunk includes `timeIntoCall` metadata
- Rep and prospect recorders are flushed together via a serialized flush queue (`enqueueFlush`) to avoid races on stop and to keep both channels aligned
- A final flush runs on session stop so the tail of the call is not dropped
- MediaRecorder state checked before operations to prevent errors

### Screen Capture Implementation

Screen capture runs in parallel with audio capture:
- The user selects a source via `desktopCapturer` (exposed through the preload script); `getDisplayMedia` provides the video/system-audio stream
- Screenshots are captured on demand on every 4th audio chunk (~2 minutes), not on a separate timer
- Each screenshot is drawn to a canvas, downscaled to max 960×540, and converted to JPEG base64
- When that chunk is sent, the screenshot is included in the payload (otherwise `screenshot` is null)
- Gracefully degrades to audio-only if screen/system audio capture fails
- All screen streams are properly cleaned up on session end

### Session Lifecycle

1. User clicks "Start Monitoring" → `startMonitoring()`
2. Main process shows overlay window
3. For live/cold-call sessions, the overlay shows a recording-consent notice (`showConsentNotice()`, audit BR-03) instructing the user to get the prospect's consent; declining calls `stopMonitoring()` and aborts the start. Roleplay (AI persona, no third party) skips this gate.
4. Overlay calls `POST /live/start` → receives `sessionId`
5. WebSocket connection established; client sends `{ type: 'auth', token }`
6. Audio capture begins (rep mic + optional prospect/system audio)
7. Screen capture begins (optional)
8. Every 30 seconds: rep + prospect audio chunks (screenshot every 4th chunk) sent via WebSocket
9. User clicks "Stop Monitoring" → `stopMonitoring()`
10. A final audio flush is sent, audio/screen capture stops, interval timers cleared
11. Overlay calls `POST /live/end` with `sessionId`
12. WebSocket disconnected
13. Overlay window hidden

### Error Handling

- Authentication failures clear stored tokens and show login
- WebSocket errors trigger auto-reconnect with exponential backoff (capped at 30s) if the session is active
- Microphone access denial shows critical feedback to user
- API errors display in UI error message components

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
