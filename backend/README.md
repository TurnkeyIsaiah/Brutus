# Brutus.ai Backend

The brutally honest AI sales coach backend.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Then edit `.env` with your actual values:

- `DATABASE_URL` - Your PostgreSQL connection string (from Supabase or local)
- `JWT_SECRET` - A random secret string for signing tokens
- `ANTHROPIC_API_KEY` - Your Anthropic API key (for Claude/Brutus)
- `OPENAI_API_KEY` - Your OpenAI API key (for Whisper transcription)

### 3. Set Up Database

Generate Prisma client and push schema to database:

```bash
npm run db:generate
npm run db:push
```

### 4. Run the Server

Development (with hot reload):
```bash
npm run dev
```

Production:
```bash
npm start
```

Server runs on `http://localhost:3001` by default.

## API Endpoints

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/signup` | Create new account |
| POST | `/auth/login` | Login and get token |
| POST | `/auth/logout` | Logout (invalidate token client-side) |
| GET | `/auth/me` | Get current user |

### User

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/user/profile` | Get user's Brutus profile |
| GET | `/user/settings` | Get settings |
| PUT | `/user/settings` | Update settings |
| GET | `/user/dashboard` | Get dashboard data |

### Calls

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/calls/analyze` | Upload and analyze audio file |
| POST | `/calls/analyze-transcript` | Analyze text transcript directly |
| GET | `/calls` | List all calls |
| GET | `/calls/:id` | Get specific call details |
| DELETE | `/calls/:id` | Delete a call |
| POST | `/calls/chat` | Chat with Brutus |

### Live Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/live/start` | Start live monitoring session |
| GET | `/live/active` | Check for active session |
| POST | `/live/transcript` | Send transcript chunk (HTTP fallback) |
| POST | `/live/end` | End session and get analysis |
| POST | `/live/cancel` | Cancel session without analysis |

### WebSocket

Connect to `ws://localhost:3001/ws?token=YOUR_JWT_TOKEN` for real-time feedback.

Message types:

**Send:**
```json
{
  "type": "transcript_chunk",
  "payload": {
    "sessionId": "...",
    "transcriptChunk": "what the user said",
    "timeIntoCall": 120
  }
}
```

**Receive:**
```json
{
  "type": "brutus_feedback",
  "payload": {
    "type": "warning",
    "text": "you've been talking for 3 minutes straight."
  }
}
```

## Project Structure

```
brutus-backend/
├── prisma/
│   └── schema.prisma      # Database schema
├── src/
│   ├── index.js           # Entry point, Express + WebSocket server
│   ├── lib/
│   │   └── prisma.js      # Prisma client singleton
│   ├── middleware/
│   │   └── auth.js        # JWT authentication
│   ├── routes/
│   │   ├── auth.js        # Auth endpoints
│   │   ├── user.js        # User/profile endpoints
│   │   ├── calls.js       # Call analysis endpoints
│   │   └── live.js        # Live monitoring endpoints
│   └── services/
│       ├── brutus.js      # Brutus AI (Claude integration)
│       ├── transcription.js  # Whisper transcription
│       └── live.js        # Live session management
├── .env.example           # Environment template
├── package.json
└── README.md
```

## Deployment

### Railway (Recommended)

1. Push code to GitHub
2. Connect repo to Railway
3. Add environment variables in Railway dashboard
4. Add PostgreSQL plugin (or use Supabase)
5. Deploy

### Other Options

- **Render** - Similar to Railway
- **Fly.io** - Good for WebSocket support
- **DigitalOcean App Platform**
- **AWS/GCP** - More complex but scalable

## Database (Supabase)

1. Create project at supabase.com
2. Go to Settings > Database
3. Copy connection string (URI format)
4. Use as `DATABASE_URL` in your `.env`

## Costs Estimate

| Service | 10 users | 100 users | 500 users |
|---------|----------|-----------|-----------|
| Supabase | Free | ~$25/mo | ~$75/mo |
| Whisper API | ~$30/mo | ~$300/mo | ~$1,500/mo |
| Claude API | ~$50/mo | ~$400/mo | ~$2,000/mo |
| Hosting | ~$20/mo | ~$50/mo | ~$150/mo |

## License

Proprietary - TurnkeyAI
