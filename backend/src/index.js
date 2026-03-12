require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const callsRoutes = require('./routes/calls');
const liveRoutes = require('./routes/live');
const notesRoutes = require('./routes/notes');
const researchRoutes = require('./routes/research');
const billingRoutes = require('./routes/billing');
const ttsRoutes = require('./routes/tts');
const { authenticateWS } = require('./middleware/auth');

const app = express();
const server = createServer(app);

app.set('trust proxy', 1);

// ==================== MIDDLEWARE ====================

// CORS — allow Electron (null origin), production frontend, and localhost dev
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      process.env.FRONTEND_URL,
      'http://localhost:3000',
      'http://localhost:3001'
    ].filter(Boolean);
    // null origin = Electron app or direct API call — allow
    if (!origin || allowed.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Global rate limit — 200 requests per minute per IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many requests, slow down.' } }
}));

// Stripe webhook must receive raw body — register before express.json()
app.use('/billing/webhook', billingRoutes);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==================== ROUTES ====================

app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/calls', callsRoutes);
app.use('/live', liveRoutes);
app.use('/notes', notesRoutes);
app.use('/research', researchRoutes);
app.use('/billing', billingRoutes);
app.use('/tts', ttsRoutes);

// Serve frontend static files
app.use('/frontend', express.static(path.join(__dirname, '..', '..', 'frontend')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'brutus is watching.' });
});

// ==================== WEBSOCKET (for real-time feedback) ====================

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', async (ws, req) => {
  console.log('[WebSocket] Connection attempt from:', req.headers.origin || 'unknown', '— url:', req.url?.slice(0, 80));
  try {
    // Authenticate the WebSocket connection
    const user = await authenticateWS(req);
    
    if (!user) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    
    ws.userId = user.id;
    ws.isAlive = true;
    
    console.log(`WebSocket connected for user: ${user.email}`);
    
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        
        // Handle different message types
        switch (message.type) {
          case 'transcript_chunk':
            // Process real-time transcript and get Brutus feedback
            const { handleTranscriptChunk } = require('./services/live');
            const feedback = await handleTranscriptChunk(ws.userId, message.payload);

            if (feedback) {
              ws.send(JSON.stringify({
                type: 'brutus_feedback',
                payload: feedback
              }));
            }
            break;

          case 'monitoring_data':
            // Process audio and screenshot from desktop app
            console.log('[WebSocket] Received monitoring_data:', {
              sessionId: message.payload.sessionId,
              timeIntoCall: message.payload.timeIntoCall,
              hasAudio: !!message.payload.audioData,
              hasScreenshot: !!message.payload.screenshot,
              audioSize: message.payload.audioData ? message.payload.audioData.length : 0,
              screenshotSize: message.payload.screenshot ? message.payload.screenshot.length : 0
            });

            const { handleTranscriptChunk: handleMonitoringChunk } = require('./services/live');
            const monitoringFeedback = await handleMonitoringChunk(ws.userId, message.payload);

            if (monitoringFeedback) {
              console.log('[WebSocket] Sending brutus_feedback:', monitoringFeedback);
              ws.send(JSON.stringify({
                type: 'brutus_feedback',
                payload: monitoringFeedback
              }));
            } else {
              console.log('[WebSocket] No feedback generated for this chunk');
            }
            break;

          case 'chat_message':
            // User sent a chat message to Brutus during live call
            console.log('[WebSocket] Received chat_message:', message.payload);
            const { chatWithBrutus } = require('./services/brutus');
            const chatResponse = await chatWithBrutus(ws.userId, message.payload.message);

            ws.send(JSON.stringify({
              type: 'chat_response',
              payload: {
                message: chatResponse,
                timestamp: Date.now()
              }
            }));
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

          default:
            console.log('Unknown message type:', message.type);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Failed to process message' }
        }));
      }
    });
    
    ws.on('close', () => {
      console.log(`WebSocket disconnected for user: ${user.email}`);
    });
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      payload: { message: 'brutus is ready to judge you.' }
    }));
    
  } catch (error) {
    console.error('WebSocket connection error:', error);
    ws.close(4000, 'Connection error');
  }
});

// Heartbeat to keep connections alive
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// ==================== ERROR HANDLING ====================

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║                                          ║
  ║   BRUTUS.AI BACKEND                      ║
  ║   Running on port ${PORT}                    ║
  ║                                          ║
  ║   Ready to roast some salespeople.       ║
  ║                                          ║
  ╚══════════════════════════════════════════╝
  `);

});

module.exports = { app, server, wss };
