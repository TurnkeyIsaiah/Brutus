const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const prisma = require('../lib/prisma');
const { generateToken, authenticate } = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail, sendDay1Email } = require('../services/email');

const SIGNUP_BONUS_TOKENS = 500000n;
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function issueVerificationToken(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
  await prisma.emailVerificationToken.deleteMany({ where: { userId } });
  await prisma.emailVerificationToken.create({ data: { userId, token: tokenHash, expiresAt } });
  return rawToken;
}
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

// 30 signups per hour per IP — bumped from 10 to absorb shared NAT traffic
// (college campuses, mobile carriers, corporate offices share one public IP).
// Bot abuse is also bounded by email verification (see /verify-email),
// so the bonus token grant is no longer a free-money vector even at higher volumes.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
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

// 5 resend-verification requests per hour per IP
const resendVerifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many verification requests. Try again in an hour.' } }
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
    
    // Generate auth token (user is logged in immediately, but tokenBalance is 0
    // until they verify their email — see /verify-email below)
    const token = generateToken(user.id, user.tokenVersion);

    // Issue verification token + send email (non-blocking)
    issueVerificationToken(user.id)
      .then((rawToken) => sendVerificationEmail(user, rawToken))
      .catch(err => console.error('[Email] Verification email failed:', err.message));

    res.status(201).json({
      message: 'Account created. check your email to claim your 500K free tokens.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
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
        emailVerified: user.emailVerified,
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
      emailVerified: req.user.emailVerified,
      tokenBalance: req.user.tokenBalance.toString(),
      settings: req.user.settings,
      profile: req.user.profile
    }
  });
});

// ==================== VERIFY EMAIL ====================

router.post('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: { message: 'Verification token is required' } });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Atomic: consume token, mark verified, grant signup bonus.
    // If the token row no longer exists (already consumed) deleteMany returns count=0 and we abort.
    let creditedUserId = null;
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.emailVerificationToken.findUnique({ where: { token: tokenHash } });
        if (!existing || existing.expiresAt < new Date()) throw new Error('TOKEN_INVALID');

        const consumed = await tx.emailVerificationToken.deleteMany({
          where: { token: tokenHash, expiresAt: { gt: new Date() } }
        });
        if (consumed.count === 0) throw new Error('TOKEN_INVALID');

        // Only grant the bonus the first time the user verifies — re-verifying must not re-grant.
        const user = await tx.user.findUnique({
          where: { id: existing.userId },
          select: { emailVerified: true }
        });
        if (!user) throw new Error('TOKEN_INVALID');

        if (!user.emailVerified) {
          await tx.user.update({
            where: { id: existing.userId },
            data: {
              emailVerified: true,
              tokenBalance: { increment: SIGNUP_BONUS_TOKENS }
            }
          });
          creditedUserId = existing.userId;
        }
      });
    } catch (err) {
      if (err.message === 'TOKEN_INVALID') {
        return res.status(400).json({ error: { message: 'Verification link is invalid or has expired' } });
      }
      throw err;
    }

    if (creditedUserId) {
      logAudit('email.verified', creditedUserId, req);

      // Fire Day 1 onboarding email immediately (non-blocking).
      // Idempotent: emailLog has a unique constraint on (userId, type), so if the
      // hourly scheduler races and writes first, this insert returns P2002 and we
      // skip the send. Only send when we get the row.
      (async () => {
        try {
          const fullUser = await prisma.user.findUnique({
            where: { id: creditedUserId },
            select: { id: true, email: true, name: true }
          });
          if (!fullUser) return;
          await prisma.emailLog.create({
            data: { userId: fullUser.id, type: 'day1', status: 'sent' }
          });
          await sendDay1Email(fullUser);
        } catch (err) {
          if (err.code === 'P2002') return; // already sent by scheduler — fine
          console.error('[Email] Day 1 send failed:', err.message);
        }
      })();
    }

    res.json({ message: 'Email verified. brutus is ready to judge you.' });
  } catch (error) {
    next(error);
  }
});

// ==================== RESEND VERIFICATION ====================

router.post('/resend-verification', resendVerifyLimiter, authenticate, async (req, res, next) => {
  try {
    if (req.user.emailVerified) {
      return res.json({ message: 'Email already verified.' });
    }

    const rawToken = await issueVerificationToken(req.user.id);
    sendVerificationEmail(req.user, rawToken)
      .catch(err => console.error('[Email] Verification resend failed:', err.message));

    res.json({ message: 'Verification email sent. check your inbox.' });
  } catch (error) {
    next(error);
  }
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
