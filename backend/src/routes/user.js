const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');

let _anthropic = null;
const getAnthropic = () => {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
};

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
      take: 4,
      select: {
        id: true,
        createdAt: true,
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
    
    const userTokens = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { tokenBalance: true, tokensUsed: true }
    });

    res.json({
      tokenBalance: userTokens.tokenBalance.toString(),
      tokensUsed: userTokens.tokensUsed.toString(),
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

// ==================== PATCH ACCOUNT ====================

router.patch('/account', async (req, res, next) => {
  try {
    const { name, email } = req.body;
    if (!name && !email) {
      return res.status(400).json({ error: { message: 'name or email required' } });
    }

    const data = {};
    if (name) data.name = name.trim();
    if (email) {
      const existing = await prisma.user.findUnique({ where: { email: email.trim() } });
      if (existing && existing.id !== req.user.id) {
        return res.status(409).json({ error: { message: 'Email already in use' } });
      }
      data.email = email.trim();
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: { id: true, name: true, email: true }
    });

    res.json({ message: 'Account updated', user });
  } catch (error) {
    next(error);
  }
});

// ==================== ONBOARD ====================

router.post('/onboard', async (req, res, next) => {
  try {
    const { product, experience, challenge, company, businessName, coachingStyle } = req.body;

    // Use Haiku to generate an initial profile summary and seed coaching fields
    const prompt = `A new sales rep just joined Brutus AI. Based on their profile, write a short coaching summary and identify initial areas to improve and potential bad habits to watch for.

Their profile:
- Selling: ${product || 'not specified'}
- Company: ${company || 'not specified'}${businessName ? ` (${businessName})` : ''}
- Experience: ${experience || 'not specified'}
- Biggest challenge: ${challenge || 'not specified'}
- Estimated close rate: ${req.body.closeRate || 'not specified'}
- Coaching style preference: ${coachingStyle || 'Balanced'}

Respond with valid JSON only:
{
  "summary": "2-3 sentence coaching summary mentioning their product/role",
  "areasImproving": ["area1", "area2"],
  "badHabits": ["habit to watch for based on their challenge"]
}`;

    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });

    let profileSeed = { summary: null, areasImproving: [], badHabits: [] };
    try {
      const text = response.content[0].text.trim();
      const json = text.startsWith('{') ? text : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      profileSeed = JSON.parse(json);
    } catch (_) {}

    // Update UserProfile with seeded data
    if (profileSeed.summary) {
      await prisma.userProfile.upsert({
        where: { userId: req.user.id },
        update: {
          summary: profileSeed.summary,
          areasImproving: profileSeed.areasImproving || [],
          badHabits: profileSeed.badHabits || []
        },
        create: {
          userId: req.user.id,
          summary: profileSeed.summary,
          areasImproving: profileSeed.areasImproving || [],
          badHabits: profileSeed.badHabits || []
        }
      });
    }

    // Save all onboarding fields + mark complete
    const updatedSettings = {
      ...req.user.settings,
      product: product || '',
      experience: experience || '',
      challenge: challenge || '',
      company: company || '',
      businessName: businessName || '',
      coachingStyle: coachingStyle || 'Balanced',
      closeRate: req.body.closeRate || '',
      brutalHonestyMode: coachingStyle === 'Brutal',
      onboardingComplete: true
    };

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { settings: updatedSettings }
    });

    res.json({ message: 'Onboarding complete', settings: user.settings });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
