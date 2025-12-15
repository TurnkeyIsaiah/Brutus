require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const callsRoutes = require('./routes/calls');
const liveRoutes = require('./routes/live');
const { authenticateWS } = require('./middleware/auth');

const app = express();
const server = createServer(app);

// ==================== MIDDLEWARE ====================

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==================== ROUTES ====================

app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/calls', callsRoutes);
app.use('/live', liveRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'brutus is watching.' });
});

// ==================== WEBSOCKET (for real-time feedback) ====================

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', async (ws, req) => {
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
