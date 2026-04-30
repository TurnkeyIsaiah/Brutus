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
const { router: billingRoutes, stripeWebhookHandler } = require('./routes/billing');
const ttsRoutes = require('./routes/tts');
const { authenticateWS, verifyToken } = require('./middleware/auth');
const { registerSession, unregisterSession } = require('./lib/wsSessions');
const { runRetentionCleanup } = require('./lib/retention');

const app = express();
const server = createServer(app);

app.set('trust proxy', 1);

// ==================== MIDDLEWARE ====================

// Security headers — applied to every response before any route handler
app.use((req, res, next) => {
  // Prevent the API from being framed
  res.setHeader('X-Frame-Options', 'DENY');
  // Block MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Don't leak referrer to external origins
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Enforce HTTPS for 1 year (browsers will remember)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Restrictive CSP for the API — no browser should be rendering content from here
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  next();
});

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

// Stripe webhook must receive raw body — registered directly before express.json()
// so signature verification sees the unmodified request body
app.post('/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

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

const wss = new WebSocketServer({
  server,
  path: '/ws',
  handleProtocols: (protocols) => protocols.has('brutus-v1') ? 'brutus-v1' : false, // only select if client offered it
  maxPayload: 2 * 1024 * 1024 // 2 MB hard cap — rejects oversized messages before any parsing
});

// Per-user rate limiting for monitoring_data (each message triggers transcription + AI calls)
const wsRateState = new Map();       // userId -> { count, windowStart }
const wsConnectionCount = new Map(); // userId -> number of open connections
const WS_MONITORING_LIMIT = 30;     // max monitoring_data messages per window
const WS_MONITORING_WINDOW_MS = 60 * 1000;

// Per-IP connection cap — prevents unauthenticated connection-flood DoS
const wsIpCount = new Map();         // ip -> number of open connections
const WS_MAX_PER_IP = 20;

function checkMonitoringRateLimit(userId) {
  const now = Date.now();
  const state = wsRateState.get(userId) || { count: 0, windowStart: now };
  if (now - state.windowStart > WS_MONITORING_WINDOW_MS) {
    state.count = 0;
    state.windowStart = now;
  }
  state.count++;
  wsRateState.set(userId, state);
  return state.count <= WS_MONITORING_LIMIT;
}

wss.on('connection', async (ws, req) => {
  // Per-IP connection cap — reject before allocating any auth state.
  // Uses socket.remoteAddress (the verified TCP peer) — X-Forwarded-For is not trusted here
  // because WebSocket upgrade runs outside Express middleware and XFF is client-spoofable.
  // In proxy deployments this cap applies per-proxy-egress-IP; configure per-user caps at the LB.
  const ip = req.socket.remoteAddress || 'unknown';
  const ipCount = (wsIpCount.get(ip) || 0) + 1;
  if (ipCount > WS_MAX_PER_IP) {
    ws.close(4029, 'Too many connections from this IP');
    return;
  }
  wsIpCount.set(ip, ipCount);
  ws.on('close', () => {
    const c = wsIpCount.get(ip) || 1;
    if (c <= 1) wsIpCount.delete(ip);
    else wsIpCount.set(ip, c - 1);
  });

  console.log('[WebSocket] Connection from:', req.headers.origin || 'unknown');

  ws.isAlive = true;
  ws.authenticated = false;

  // Close unauthenticated connections after 5 seconds
  const authTimeout = setTimeout(() => {
    if (!ws.authenticated) ws.close(4001, 'Auth timeout');
  }, 5000);

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);

      // ---- Auth handshake (must be first message) ----
      if (!ws.authenticated) {
        if (message.type !== 'auth' || typeof message.token !== 'string') {
          ws.close(4001, 'Unauthorized');
          return;
        }
        const user = await verifyToken(message.token);
        if (!user) {
          ws.close(4001, 'Unauthorized');
          return;
        }
        clearTimeout(authTimeout);
        ws.authenticated = true;
        ws.userId = user.id;
        ws.tokenVersion = user.tokenVersion;
        ws.isAlive = true;
        wsConnectionCount.set(user.id, (wsConnectionCount.get(user.id) || 0) + 1);
        registerSession(user.id, ws);
        console.log(`WebSocket authenticated for user: ${user.email}`);
        ws.send(JSON.stringify({ type: 'connected', payload: { message: 'brutus is ready to judge you.' } }));
        return;
      }

      // ---- Re-validate revocation state before processing privileged messages ----
      if (message.type !== 'ping') {
        const prisma = require('./lib/prisma');
        const current = await prisma.user.findUnique({ where: { id: ws.userId }, select: { tokenVersion: true } });
        if (!current || current.tokenVersion !== ws.tokenVersion) {
          ws.close(4001, 'Session revoked');
          return;
        }
      }

      switch (message.type) {
        case 'transcript_chunk':
          if (!checkMonitoringRateLimit(ws.userId)) {
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'Rate limit exceeded. Slow down.' } }));
            break;
          }
          {
            const { handleTranscriptChunk } = require('./services/live');
            const feedback = await handleTranscriptChunk(ws.userId, message.payload);
            if (feedback) ws.send(JSON.stringify({ type: 'brutus_feedback', payload: feedback }));
          }
          break;

        case 'monitoring_data':
          if (!checkMonitoringRateLimit(ws.userId)) {
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'Rate limit exceeded. Slow down.' } }));
            break;
          }
          console.log('[WebSocket] Received monitoring_data:', {
            sessionId: message.payload.sessionId,
            timeIntoCall: message.payload.timeIntoCall,
            hasAudio: !!message.payload.audioData,
            hasScreenshot: !!message.payload.screenshot
          });
          {
            const { handleTranscriptChunk: handleMonitoringChunk } = require('./services/live');
            const monitoringFeedback = await handleMonitoringChunk(ws.userId, message.payload);
            if (monitoringFeedback) {
              ws.send(JSON.stringify({ type: 'brutus_feedback', payload: monitoringFeedback }));
            }
          }
          break;

        case 'chat_message':
          if (!checkMonitoringRateLimit(ws.userId)) {
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'Rate limit exceeded. Slow down.' } }));
            break;
          }
          {
            const { chatWithBrutus } = require('./services/brutus');
            const chatResponse = await chatWithBrutus(ws.userId, message.payload.message);
            ws.send(JSON.stringify({ type: 'chat_response', payload: { message: chatResponse, timestamp: Date.now() } }));
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
      if (ws.readyState === 1 /* WebSocket.OPEN */) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Failed to process message' } }));
      }
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    if (ws.userId) {
      console.log(`WebSocket disconnected for user: ${ws.userId}`);
      unregisterSession(ws.userId, ws);
      const remaining = (wsConnectionCount.get(ws.userId) || 1) - 1;
      if (remaining <= 0) {
        wsConnectionCount.delete(ws.userId);
        wsRateState.delete(ws.userId);
      } else {
        wsConnectionCount.set(ws.userId, remaining);
      }
    }
  });
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

async function validateSchema() {
  const prisma = require('./lib/prisma');
  // stripe_events table
  try {
    await prisma.$queryRaw`SELECT 1 FROM stripe_events LIMIT 1`;
  } catch {
    console.error('[startup] FATAL: stripe_events table is missing. Run add_stripe_events.sql in Supabase before deploying.');
    process.exit(1);
  }
  // token_version column on users
  try {
    await prisma.$queryRaw`SELECT token_version FROM users LIMIT 1`;
  } catch {
    console.error('[startup] FATAL: users.token_version column is missing. Run add_token_version.sql in Supabase before deploying.');
    process.exit(1);
  }
  // audit_logs table
  try {
    await prisma.$queryRaw`SELECT 1 FROM audit_logs LIMIT 1`;
  } catch {
    console.error('[startup] FATAL: audit_logs table is missing. Run add_audit_log.sql in Supabase before deploying.');
    process.exit(1);
  }
}

validateSchema().then(() => {
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

  // Run data retention cleanup at startup and then every 24 hours
  runRetentionCleanup();
  setInterval(runRetentionCleanup, 24 * 60 * 60 * 1000);
});
}).catch((err) => {
  console.error('[startup] Schema validation failed:', err);
  process.exit(1);
});

module.exports = { app, server, wss };
