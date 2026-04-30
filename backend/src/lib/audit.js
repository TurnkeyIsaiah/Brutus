const prisma = require('./prisma');

// Extract the real client IP respecting trust proxy 1 (same logic as Express req.ip)
function getIp(req) {
  if (!req) return null;
  const xff = req.headers?.['x-forwarded-for'];
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return req.socket?.remoteAddress || null;
}

async function logAudit(action, userId, req, metadata = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        userId: userId || null,
        ipAddress: getIp(req),
        userAgent: req?.headers?.['user-agent']?.slice(0, 500) || null,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined
      }
    });
  } catch (err) {
    // Non-blocking — audit failure must never break the primary request
    console.error('[Audit] Failed to write audit log:', err.message);
  }
}

module.exports = { logAudit };
