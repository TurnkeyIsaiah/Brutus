const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

// Middleware for HTTP routes
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: 'No token provided' } });
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { profile: true }
    });

    if (!user) {
      return res.status(401).json({ error: { message: 'User not found' } });
    }

    // Reject legacy tokens that predate tokenVersion (issued before revocation was added)
    if (decoded.tokenVersion === undefined || decoded.tokenVersion === null) {
      return res.status(401).json({ error: { message: 'Token has been revoked' } });
    }
    // Reject tokens issued before a logout or password reset
    if (decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({ error: { message: 'Token has been revoked' } });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: { message: 'Invalid token' } });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: { message: 'Token expired' } });
    }
    next(error);
  }
};

// Validate a raw JWT string and return the user (or null on failure).
// Used for post-connect WebSocket authentication.
const verifyToken = async (token) => {
  try {
    if (!token || typeof token !== 'string') return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) return null;
    if (decoded.tokenVersion === undefined || decoded.tokenVersion === null) return null;
    if (decoded.tokenVersion !== user.tokenVersion) return null;
    return user;
  } catch {
    return null;
  }
};

// Authentication for WebSocket connections (kept for backward compat)
const authenticateWS = async (req) => {
  const token = req.headers['sec-websocket-protocol'];
  return verifyToken(token);
};

// Generate JWT token
const generateToken = (userId, tokenVersion = 0) => {
  return jwt.sign(
    { userId, tokenVersion },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d', algorithm: 'HS256' }
  );
};

module.exports = {
  authenticate,
  authenticateWS,
  verifyToken,
  generateToken
};
