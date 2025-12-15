const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { generateToken, authenticate } = require('../middleware/auth');

const router = express.Router();

// ==================== SIGNUP ====================

router.post('/signup', async (req, res, next) => {
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
    
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
    
    if (existingUser) {
      return res.status(400).json({
        error: { message: 'Email already registered' }
      });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    
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
    const token = generateToken(user.id);
    
    res.status(201).json({
      message: 'Account created. brutus is ready to judge you.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        subscriptionStatus: user.subscriptionStatus,
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

router.post('/login', async (req, res, next) => {
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
      return res.status(401).json({
        error: { message: 'Invalid email or password' }
      });
    }
    
    // Check password
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    
    if (!validPassword) {
      return res.status(401).json({
        error: { message: 'Invalid email or password' }
      });
    }
    
    // Generate token
    const token = generateToken(user.id);
    
    res.json({
      message: 'Welcome back. ready to get roasted?',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        subscriptionStatus: user.subscriptionStatus,
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
  // With JWT, logout is handled client-side by deleting the token
  // This endpoint exists for consistency and potential future token blacklisting
  res.json({ message: 'Logged out. brutus will miss judging you.' });
});

// ==================== GET CURRENT USER ====================

router.get('/me', authenticate, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      subscriptionStatus: req.user.subscriptionStatus,
      settings: req.user.settings,
      profile: req.user.profile
    }
  });
});

module.exports = router;
