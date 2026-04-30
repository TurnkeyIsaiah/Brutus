const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const { generateToken, authenticate } = require('../middleware/auth');
const { sendWelcomeEmail, sendPasswordResetEmail } = require('../services/email');
const { closeUserSessions } = require('../lib/wsSessions');
const { logAudit } = require('../lib/audit');

const router = express.Router();

// 5 login attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many login attempts. Try again in 15 minutes.' } }
});

// 10 signups per hour per IP
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many accounts created from this IP.' } }
});

// 3 password reset requests per hour per IP
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many password reset attempts. Try again in an hour.' } }
});

// ==================== SIGNUP ====================

router.post('/signup', signupLimiter, async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    
    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({
        error: { message: 'Email, password, and name are required' }
      });
    }
    
    if (password.length < 8) {
      return res.status(400).json({
        error: { message: 'Password must be at least 8 characters' }
      });
    }
    
    // Hash password first — constant-time regardless of whether email exists,
    // preventing timing-based account enumeration on the signup endpoint.
    const passwordHash = await bcrypt.hash(password, 12);

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return res.status(400).json({
        error: { message: 'Email already registered' }
      });
    }
    
    // Create user with profile
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        name,
        profile: {
          create: {
            summary: `${name} just joined. No calls analyzed yet - let's see what they've got.`
          }
        }
      },
      include: {
        profile: true
      }
    });
    
    // Generate token
    const token = generateToken(user.id, user.tokenVersion);

    // Send welcome email (non-blocking)
    sendWelcomeEmail(user).catch(err => console.error('[Email] Welcome email failed:', err.message));

    res.status(201).json({
      message: 'Account created. brutus is ready to judge you.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tokenBalance: user.tokenBalance.toString(),
        settings: user.settings,
        profile: user.profile
      },
      token
    });

  } catch (error) {
    next(error);
  }
});

// ==================== LOGIN ====================

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        error: { message: 'Email and password are required' }
      });
    }
    
    // Find user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { profile: true }
    });
    
    if (!user) {
      logAudit('login.failed', null, req, { reason: 'user_not_found', email: email.toLowerCase() });
      return res.status(401).json({
        error: { message: 'Invalid email or password' }
      });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.passwordHash);

    if (!validPassword) {
      logAudit('login.failed', user.id, req, { reason: 'wrong_password' });
      return res.status(401).json({
        error: { message: 'Invalid email or password' }
      });
    }

    // Generate token
    const token = generateToken(user.id, user.tokenVersion);
    logAudit('login.success', user.id, req);

    res.json({
      message: 'Welcome back. ready to get roasted?',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tokenBalance: user.tokenBalance.toString(),
        settings: user.settings,
        profile: user.profile
      },
      token
    });

  } catch (error) {
    next(error);
  }
});

// ==================== LOGOUT ====================

router.post('/logout', authenticate, async (req, res) => {
  // Conditional increment — only bumps if the authenticated version is still current.
  // Prevents a stale concurrent logout from revoking a freshly issued token.
  const revoked = await prisma.user.updateMany({
    where: { id: req.user.id, tokenVersion: req.user.tokenVersion },
    data: { tokenVersion: { increment: 1 } }
  });
  // Only tear down WS sessions when this logout actually revoked the token.
  // A no-op (stale race loser) must not disconnect sessions belonging to the freshly-issued token.
  if (revoked.count > 0) {
    closeUserSessions(req.user.id);
    logAudit('logout', req.user.id, req);
  }
  res.json({ message: 'Logged out. brutus will miss judging you.' });
});

// ==================== GET CURRENT USER ====================

router.get('/me', authenticate, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      tokenBalance: req.user.tokenBalance.toString(),
      settings: req.user.settings,
      profile: req.user.profile
    }
  });
});

// ==================== FORGOT PASSWORD ====================

router.post('/forgot-password', resetLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: { message: 'Email is required' } });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Always respond 200 to prevent user enumeration
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.passwordResetToken.create({ data: { userId: user.id, token: tokenHash, expiresAt } });
      sendPasswordResetEmail(user.email, rawToken).catch(err =>
        console.error('[Email] Password reset email failed:', err.message)
      );
      logAudit('password_reset.requested', user.id, req);
    }

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (error) {
    next(error);
  }
});

// ==================== RESET PASSWORD ====================

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;

    if (!token || !password || password.length < 8) {
      return res.status(400).json({ error: { message: 'Valid token and password (8+ chars) are required' } });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resetToken = await prisma.passwordResetToken.findUnique({ where: { token: tokenHash } });

    if (!resetToken || resetToken.expiresAt < new Date()) {
      return res.status(400).json({ error: { message: 'Reset link is invalid or has expired' } });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    try {
      await prisma.$transaction(async (tx) => {
        // Atomically consume this specific token — concurrent requests will get count=0 and abort
        const consumed = await tx.passwordResetToken.deleteMany({
          where: { token: tokenHash, expiresAt: { gt: new Date() } }
        });
        if (consumed.count === 0) throw new Error('TOKEN_CONSUMED');

        await tx.user.update({
          where: { id: resetToken.userId },
          data: { passwordHash, tokenVersion: { increment: 1 } }
        });
        // Wipe all remaining reset tokens for this user (e.g. multiple links requested)
        await tx.passwordResetToken.deleteMany({ where: { userId: resetToken.userId } });
      });
    } catch (err) {
      if (err.message === 'TOKEN_CONSUMED') {
        return res.status(400).json({ error: { message: 'Reset link is invalid or has expired' } });
      }
      throw err;
    }

    closeUserSessions(resetToken.userId);
    logAudit('password_reset.completed', resetToken.userId, req);

    res.json({ message: 'Password updated. go get roasted.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
