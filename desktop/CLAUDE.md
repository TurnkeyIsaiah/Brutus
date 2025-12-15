# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Brutus.ai Desktop is an Electron-based real-time AI sales coaching application. It captures microphone audio during sales calls, sends it to a backend service for transcription and analysis, and displays live coaching feedback in an always-on-top overlay window.

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

1. **Overlay window requests microphone access** via `getUserMedia()`
   - 16kHz sample rate for efficiency
   - Echo cancellation and noise suppression enabled

2. **Overlay window captures screen** via `desktopCapturer`
   - Uses Electron's desktopCapturer API to get screen sources
   - Creates video stream from primary display
   - Captures screenshots every 5 seconds (synced with audio chunks)
   - Screenshots converted to JPEG base64 (80% quality)
   - Falls back to audio-only mode if screen capture fails

3. **MediaRecorder records in 5-second chunks**
   - Format: `audio/webm;codecs=opus`
   - Each chunk is converted to base64
   - Combined with screenshot and sent via WebSocket to backend

4. **Real-time visualization** using Web Audio API
   - `AnalyserNode` with FFT size 64
   - Updates 32 frequency bars at ~60fps

### Backend Communication

**REST API** (default: `http://localhost:3001`):
- `POST /auth/login` - User authentication
- `POST /auth/signup` - User registration
- `GET /auth/me` - Verify token validity
- `GET /user/dashboard` - Fetch user stats
- `POST /live/start` - Start coaching session
- `POST /live/end` - End coaching session

**WebSocket** (`ws://localhost:3001/ws`):
- Connection includes auth token as query parameter
- Sends `monitoring_data` messages with combined audio and screenshot data
  - Payload structure: `{ type: 'monitoring_data', payload: { sessionId, audioData, screenshot, timestamp, timeIntoCall, mimeType } }`
  - `audioData`: base64-encoded audio chunk (audio/webm)
  - `screenshot`: base64-encoded JPEG image (or null if screen capture failed)
  - `timestamp`: Unix timestamp in milliseconds
  - `timeIntoCall`: Seconds elapsed since monitoring started
- Receives `brutus_feedback` messages with coaching tips
- Auto-reconnects on disconnect if session is active

### Data Persistence

Uses `electron-store` for local storage:
- `authToken` - JWT authentication token
- `user` - User profile object (name, email)
- `settings` - App settings object:
  - `apiUrl` - Backend URL (default: `http://localhost:3001`)
  - `autoStart` - Launch on system startup (default: `false`)
  - `overlayOpacity` - Overlay transparency (default: `0.95`)

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

Web security is disabled (`webSecurity: false`) in both windows:
- Allows Electron app (running on `file://` protocol) to make requests to localhost backend
- Backend CORS headers are configured for web apps, not Electron
- This is safe for desktop apps since they're trusted local environments
- Without this, fetch requests to the backend will be blocked by CORS

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
- 5-second intervals controlled by `setInterval()`
- Each chunk includes `timeIntoCall` metadata
- Chunks are sequential (stop current, start new) to avoid gaps
- MediaRecorder state checked before operations to prevent errors

### Screen Capture Implementation

Screen capture runs in parallel with audio capture:
- Uses Electron's `desktopCapturer` API exposed via preload script
- Captures primary display at up to 1920x1080 resolution
- Screenshots taken every 5 seconds via separate interval
- Each screenshot is drawn to canvas and converted to JPEG base64 (80% quality)
- Last screenshot is stored in `lastScreenshot` variable
- When audio chunk is sent, current screenshot is included in payload
- Gracefully degrades to audio-only if screen capture fails
- All screen streams and intervals are properly cleaned up on session end

### Session Lifecycle

1. User clicks "Start Monitoring" → `startMonitoring()`
2. Main process shows overlay window
3. Overlay calls `POST /live/start` → receives `sessionId`
4. WebSocket connection established
5. Audio capture begins
6. Screen capture begins
7. Every 5 seconds: audio chunk + screenshot sent via WebSocket
8. User clicks "Stop Monitoring" → `stopMonitoring()`
9. Audio capture stops, screen capture stops, interval timers cleared
10. Overlay calls `POST /live/end` with `sessionId`
11. WebSocket disconnected
12. Overlay window hidden

### Error Handling

- Authentication failures clear stored tokens and show login
- WebSocket errors trigger auto-reconnect after 3 seconds (if session active)
- Microphone access denial shows critical feedback to user
- API errors display in UI error message components

## Backend Requirements

This desktop app requires a separate backend service (not included in this repo):
- Expected at `http://localhost:3001` by default (configurable in settings)
- Must implement the REST and WebSocket endpoints listed above
- Handles Whisper transcription and Claude/Brutus AI analysis
- Returns coaching feedback via WebSocket in real-time

## Browser Dashboard Integration

The Brutus system has two components:
1. **Electron Desktop App** (this repo) - Lightweight live monitoring with overlay
2. **Browser Dashboard** - Full-featured web interface at `http://localhost:3000/brutus-frontend.html`

The "open dashboard" button in the footer uses `shell.openExternal()` to launch the browser dashboard:
- URL is derived from the API URL setting (port 3001 → 3000)
- Opens in the user's default browser
- Allows access to full stats, chat, uploads, and draggable panels not available in the desktop app

## Asset Requirements

Icons should be placed in `assets/`:
- `icon.png` - Main app icon (512x512)
- `icon.ico` - Windows icon
- `icon.icns` - macOS icon
- `tray-icon.png` - System tray icon (16x16 or 32x32)

The app includes fallback logic to create a red placeholder icon if assets are missing.
