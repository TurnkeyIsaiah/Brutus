// Registry of active WebSocket connections keyed by userId.
// Used to forcibly close sessions when a token is revoked (logout / password reset).

const sessions = new Map(); // userId -> Set<ws>

function registerSession(userId, ws) {
  if (!sessions.has(userId)) sessions.set(userId, new Set());
  sessions.get(userId).add(ws);
}

function unregisterSession(userId, ws) {
  const set = sessions.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) sessions.delete(userId);
}

function closeUserSessions(userId) {
  const set = sessions.get(userId);
  if (!set) return;
  for (const ws of set) {
    try { ws.close(4001, 'Session revoked'); } catch (_) {}
  }
  sessions.delete(userId);
}

module.exports = { registerSession, unregisterSession, closeUserSessions };
