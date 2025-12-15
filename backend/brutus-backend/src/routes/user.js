const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ==================== GET PROFILE ====================

router.get('/profile', async (req, res, next) => {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId: req.user.id }
    });
    
    if (!profile) {
      return res.status(404).json({
        error: { message: 'Profile not found' }
      });
    }
    
    res.json({
      profile: {
        talkRatioAvg: parseFloat(profile.talkRatioAvg),
        closeRate: parseFloat(profile.closeRate),
        badHabits: profile.badHabits,
        strengths: profile.strengths,
        areasImproving: profile.areasImproving,
        totalCallsAnalyzed: profile.totalCallsAnalyzed,
        summary: profile.summary,
        updatedAt: profile.updatedAt
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// ==================== GET SETTINGS ====================

router.get('/settings', async (req, res) => {
  res.json({
    settings: req.user.settings
  });
});

// ==================== UPDATE SETTINGS ====================

router.put('/settings', async (req, res, next) => {
  try {
    const { settings } = req.body;
    
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({
        error: { message: 'Settings object is required' }
      });
    }
    
    // Merge with existing settings
    const updatedSettings = {
      ...req.user.settings,
      ...settings
    };
    
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { settings: updatedSettings }
    });
    
    res.json({
      message: 'Settings updated',
      settings: user.settings
    });
    
  } catch (error) {
    next(error);
  }
});

// ==================== GET DASHBOARD STATS ====================

router.get('/dashboard', async (req, res, next) => {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId: req.user.id }
    });
    
    // Get recent calls
    const recentCalls = await prisma.call.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        recordedAt: true,
        durationSeconds: true,
        overallScore: true,
        talkRatio: true,
        tags: true,
        brutusFeedback: true
      }
    });
    
    // Get call count for the week
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const weeklyCallCount = await prisma.call.count({
      where: {
        userId: req.user.id,
        createdAt: { gte: weekAgo }
      }
    });
    
    // Calculate weekly performance (scores from last 7 days)
    const weeklyScores = await prisma.call.findMany({
      where: {
        userId: req.user.id,
        createdAt: { gte: weekAgo }
      },
      orderBy: { createdAt: 'asc' },
      select: {
        overallScore: true,
        createdAt: true
      }
    });
    
    res.json({
      profile: profile ? {
        talkRatioAvg: parseFloat(profile.talkRatioAvg),
        closeRate: parseFloat(profile.closeRate),
        badHabits: profile.badHabits,
        strengths: profile.strengths,
        totalCallsAnalyzed: profile.totalCallsAnalyzed,
        summary: profile.summary
      } : null,
      recentCalls: recentCalls.map(call => ({
        ...call,
        talkRatio: parseFloat(call.talkRatio)
      })),
      weeklyStats: {
        callCount: weeklyCallCount,
        scores: weeklyScores.map(s => ({
          score: s.overallScore,
          date: s.createdAt
        }))
      }
    });
    
  } catch (error) {
    next(error);
  }
});

module.exports = router;
