# Brutus.ai Desktop App

Real-time AI sales coaching that runs during your calls.

## Features

- **Live Monitoring** - Captures audio during Zoom/Teams/phone calls
- **Real-time Coaching** - Brutus gives you feedback while you're on the call
- **Floating Overlay** - Always-on-top panel shows coaching tips
- **Background Running** - Lives in system tray, always ready
- **Metrics Tracking** - Talk ratio, interruptions, call duration

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Add App Icons

Place your icons in the `assets/` folder:
- `icon.png` - Main app icon (512x512)
- `icon.ico` - Windows icon
- `icon.icns` - Mac icon
- `tray-icon.png` - System tray icon (16x16 or 32x32)

For now, you can create simple placeholder icons or use any PNG.

### 3. Make Sure Backend is Running

The desktop app connects to your Brutus backend:

```bash
cd ../brutus-backend
npm run dev
```

Backend should be running on `http://localhost:3001`

### 4. Run the App

```bash
npm start
```

## How It Works

1. **Login** - Sign in with your Brutus account
2. **Start Monitoring** - Click the button or use system tray
3. **Overlay Appears** - Floating panel shows on top of other windows
4. **Make a Call** - Start your Zoom/Teams/phone call
5. **Get Coached** - Brutus listens and gives real-time feedback
6. **Stop Monitoring** - Click stop when call ends

## Architecture

```
Desktop App (Electron)
├── Captures microphone audio
├── Records in 5-second chunks
├── Sends chunks to backend via WebSocket
│
Backend
├── Receives audio chunk
├── Transcribes with Whisper (~1-2 sec)
├── Analyzes with Claude/Brutus
├── Sends feedback back via WebSocket
│
Desktop App
├── Displays feedback in overlay
└── Updates metrics in real-time
```

## Building for Distribution

### Windows
```bash
npm run build:win
```
Creates installer in `dist/` folder.

### Mac
```bash
npm run build:mac
```
Creates .dmg in `dist/` folder.

### Linux
```bash
npm run build:linux
```
Creates AppImage in `dist/` folder.

## Configuration

Settings are stored locally. Default API URL is `http://localhost:3001`.

For production, update the API URL in settings to your deployed backend.

## Known Limitations

- Currently captures microphone only (not system audio)
- System audio capture requires additional native modules
- For full Zoom/Teams capture, users may need virtual audio cable software

## Future Enhancements

- [ ] System audio capture (hear both sides of call)
- [ ] Auto-detect when Zoom/Teams opens
- [ ] Hotkey to start/stop monitoring
- [ ] Custom overlay positioning memory
- [ ] Integration with calendar for auto-start
