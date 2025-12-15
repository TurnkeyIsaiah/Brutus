# Brutus.AI - Brutally Honest AI Sales Coaching Platform

Brutus is a comprehensive AI-powered sales coaching platform that provides real-time feedback during live sales calls using advanced speech recognition and Claude AI.

## Project Structure

```
brutus/
├── desktop/        # Electron desktop app for live call monitoring
├── backend/        # Node.js/Express API server with AI processing
└── frontend/       # Browser-based dashboard for reviewing calls
```

## Features

### Desktop App
- **Live Call Monitoring**: Captures audio and screen during sales calls
- **Real-Time AI Coaching**: Get instant feedback from Brutus during calls
- **Audio Mixing**: Records both sides of conversations (mic + system audio)
- **Screen Capture**: Optional screen recording with vision analysis
- **AI Note-Taking**: Automatic note generation during calls
- **Manual Notes & Research**: Quick buttons to save notes and request research
- **Customizable Settings**: API configuration, overlay opacity, auto-start

### Backend
- **Whisper Transcription**: Real-time speech-to-text using OpenAI Whisper
- **Claude AI Integration**: Brutus coaching powered by Claude Sonnet 4
- **Vision Analysis**: Analyzes screenshots to provide context-aware feedback
- **Selective Feedback**: Only speaks up for critical moments (20s intervals)
- **AI Notes**: Automatically generates concise notes for important moments
- **Background Research**: AI-powered company/prospect research
- **WebSocket Support**: Real-time bidirectional communication

### Browser Dashboard
- **Call History**: Review past calls with full transcripts
- **Notes Management**: View and export all notes (manual + AI-generated)
- **Research Results**: Access AI research with export capabilities
- **Analytics**: Track talk ratio, interrupts, and performance metrics
- **Export Options**: CSV for notes, TXT for research

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database
- OpenAI API key (for Whisper)
- Anthropic API key (for Claude)

### Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your API keys and database URL
npx prisma generate
npx prisma db push
npm run dev
```

### Desktop App Setup

```bash
cd desktop
npm install
npm start
```

### Frontend Access

Open `frontend/index.html` in your browser, or navigate to `http://localhost:3000/frontend/index.html` when the backend is running.

## Environment Variables

### Backend (.env)
```
DATABASE_URL="postgresql://user:password@localhost:5432/brutus"
ANTHROPIC_API_KEY="your-anthropic-api-key"
OPENAI_API_KEY="your-openai-api-key"
PORT=3001
FRONTEND_URL="http://localhost:3000"
JWT_SECRET="your-secret-key"
```

## Technology Stack

- **Desktop**: Electron, HTML/CSS/JavaScript
- **Backend**: Node.js, Express, Prisma, PostgreSQL
- **AI**: Claude Sonnet 4 (Anthropic), Whisper (OpenAI)
- **Real-time**: WebSockets
- **Authentication**: JWT

## Sales Methodology

Brutus coaches based on NEPQ (Neuro-Emotional Persuasion Questioning) principles:
- Discovery over pitching
- Emotional connection before logic
- Problem-focused questions
- Avoiding interruptions
- Active listening techniques

## Development

### Desktop App
The Electron app uses a dual-window pattern:
- Main window for login/dashboard/settings
- Overlay window for live coaching feedback

### Backend API Endpoints
- `POST /auth/login` - User authentication
- `POST /auth/signup` - User registration
- `POST /live/start` - Start monitoring session
- `POST /live/end` - End monitoring session
- `POST /notes` - Create note
- `GET /notes` - Get user notes
- `POST /research` - Request AI research
- `GET /research` - Get research results

### WebSocket Events
- `monitoring_data` - Client sends audio + screenshot
- `brutus_feedback` - Server sends AI coaching feedback

## Audio Setup (Windows)

For capturing both sides of conversations on Windows:
1. Install VB-Cable (virtual audio cable)
2. Set VB-Cable as default playback device
3. Use "Listen to this device" to hear through speakers
4. Desktop app will capture both mic and system audio

The app includes a built-in setup wizard accessible from the dashboard.

## Contributing

This is a proprietary project. Please contact the repository owner for contribution guidelines.

## License

Copyright © 2025 Brutus.AI - All Rights Reserved

## Support

For issues or questions, please contact the development team.
