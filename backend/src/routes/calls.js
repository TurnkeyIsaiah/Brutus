const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { checkTokenBalance } = require('../middleware/subscription');
const { transcribeAudio } = require('../services/transcription');
const { analyzeCall, updateUserSummary, chatWithBrutus } = require('../services/brutus');
const { scrubPii } = require('../lib/scrub');

const router = express.Router();

// Configure multer for audio file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'audio/webm',
      'audio/wav',
      'audio/mp3',
      'audio/mpeg',
      'audio/mp4',
      'audio/m4a',
      'audio/x-m4a',
      'audio/ogg',
      'video/webm',
      'video/mp4'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Supported: mp3, wav, mp4, webm, m4a, ogg'));
    }
  }
});

// All routes require authentication
router.use(authenticate);

// ==================== ANALYZE UPLOADED CALL ====================

router.post('/analyze', checkTokenBalance, upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: { message: 'No audio file provided' }
      });
    }
    
    // Transcribe the audio
    const transcription = await transcribeAudio(
      req.file.buffer,
      req.file.mimetype,
      req.user.id
    );
    
    if (!transcription.text || transcription.text.trim().length < 50) {
      return res.status(400).json({
        error: { message: 'Audio too short or unclear to analyze' }
      });
    }
    transcription.text = scrubPii(transcription.text);

    // Analyze with Brutus
    const analysis = await analyzeCall(
      req.user.id,
      transcription.text,
      transcription.duration
    );
    
    // Save the call
    const call = await prisma.call.create({
      data: {
        userId: req.user.id,
        transcript: transcription.text,
        durationSeconds: Math.floor(transcription.duration || 0),
        talkRatio: analysis.talkRatio || 50,
        interruptionCount: analysis.interruptionCount || 0,
        overallScore: analysis.overallScore || 50,
        brutusFeedback: analysis,
        tags: analysis.tags || []
      }
    });
    
    // Update user profile
    await prisma.userProfile.update({
      where: { userId: req.user.id },
      data: {
        totalCallsAnalyzed: { increment: 1 }
      }
    });
    
    // Update summary in background
    updateUserSummary(req.user.id).catch(console.error);
    
    res.json({
      message: 'Call analyzed. brace yourself.',
      call: {
        id: call.id,
        durationSeconds: call.durationSeconds,
        overallScore: call.overallScore,
        talkRatio: parseFloat(call.talkRatio),
        interruptionCount: call.interruptionCount,
        tags: call.tags
      },
      analysis: {
        feedback: analysis.feedback,
        badMoments: analysis.badMoments,
        goodMoments: analysis.goodMoments,
        actionItems: analysis.actionItems,
        overallRoast: analysis.overallRoast
      },
      transcript: transcription.text
    });
    
  } catch (error) {
    next(error);
  }
});

// ==================== ANALYZE TRANSCRIPT DIRECTLY ====================

router.post('/analyze-transcript', checkTokenBalance, async (req, res, next) => {
  try {
    const { transcript, durationSeconds } = req.body;
    
    if (!transcript || transcript.trim().length < 50) {
      return res.status(400).json({
        error: { message: 'Transcript too short to analyze (minimum 50 characters)' }
      });
    }
    const cleanTranscript = scrubPii(transcript);

    // Analyze with Brutus
    const analysis = await analyzeCall(
      req.user.id,
      cleanTranscript,
      durationSeconds || 0
    );

    // Save the call
    const call = await prisma.call.create({
      data: {
        userId: req.user.id,
        transcript: cleanTranscript,
        durationSeconds: durationSeconds || 0,
        talkRatio: analysis.talkRatio || 50,
        interruptionCount: analysis.interruptionCount || 0,
        overallScore: analysis.overallScore || 50,
        brutusFeedback: analysis,
        tags: []
      }
    });
    
    // Update user profile
    await prisma.userProfile.update({
      where: { userId: req.user.id },
      data: {
        totalCallsAnalyzed: { increment: 1 }
      }
    });
    
    // Update summary in background
    updateUserSummary(req.user.id).catch(console.error);
    
    res.json({
      message: 'Transcript analyzed.',
      call: {
        id: call.id,
        overallScore: call.overallScore,
        talkRatio: parseFloat(call.talkRatio),
        interruptionCount: call.interruptionCount
      },
      analysis
    });
    
  } catch (error) {
    next(error);
  }
});

// ==================== GET ALL CALLS ====================

router.get('/', async (req, res, next) => {
  try {
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;
    const tag = req.query.tag;
    const limit = Math.min(Math.max(parseInt(limitRaw) || 20, 1), 100);
    const offset = Math.max(parseInt(offsetRaw) || 0, 0);

    const where = { userId: req.user.id };
    
    // Filter by tag if provided
    if (tag) {
      where.tags = { has: tag };
    }
    
    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          recordedAt: true,
          durationSeconds: true,
          overallScore: true,
          talkRatio: true,
          interruptionCount: true,
          tags: true,
          outcome: true,
          createdAt: true
        }
      }),
      prisma.call.count({ where })
    ]);
    
    res.json({
      calls: calls.map(call => ({
        ...call,
        talkRatio: parseFloat(call.talkRatio)
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + calls.length < total
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// ==================== GET SINGLE CALL ====================

router.get('/:id', async (req, res, next) => {
  try {
    const call = await prisma.call.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: {
        moments: true
      }
    });
    
    if (!call) {
      return res.status(404).json({
        error: { message: 'Call not found' }
      });
    }
    
    res.json({
      call: {
        ...call,
        talkRatio: parseFloat(call.talkRatio)
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// ==================== DELETE CALL ====================

router.delete('/:id', async (req, res, next) => {
  try {
    const call = await prisma.call.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });
    
    if (!call) {
      return res.status(404).json({
        error: { message: 'Call not found' }
      });
    }
    
    await prisma.call.delete({
      where: { id: req.params.id }
    });
    
    // Decrement call count
    await prisma.userProfile.update({
      where: { userId: req.user.id },
      data: {
        totalCallsAnalyzed: { decrement: 1 }
      }
    });
    
    res.json({
      message: 'Call deleted. brutus forgets nothing though.'
    });
    
  } catch (error) {
    next(error);
  }
});

// ==================== LOG CALL OUTCOME ====================

router.patch('/:id/outcome', async (req, res, next) => {
  try {
    const { outcome } = req.body;
    const valid = ['closed', 'lost', 'follow_up', 'no_show'];
    if (!outcome || !valid.includes(outcome)) {
      return res.status(400).json({ error: { message: `outcome must be one of: ${valid.join(', ')}` } });
    }

    const call = await prisma.call.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!call) return res.status(404).json({ error: { message: 'Call not found' } });

    await prisma.call.update({
      where: { id: req.params.id },
      data: { outcome }
    });

    // Recompute close rate across all outcome-logged calls
    const outcomeCalls = await prisma.call.findMany({
      where: { userId: req.user.id, outcome: { not: null } },
      select: { outcome: true }
    });
    const closeRate = outcomeCalls.length > 0
      ? (outcomeCalls.filter(c => c.outcome === 'closed').length / outcomeCalls.length) * 100
      : 0;

    await prisma.userProfile.update({
      where: { userId: req.user.id },
      data: { closeRate }
    });

    // Trigger profile summary update in background
    updateUserSummary(req.user.id).catch(console.error);

    res.json({ outcome, closeRate: parseFloat(closeRate.toFixed(1)) });
  } catch (error) {
    next(error);
  }
});

// ==================== RATE FEEDBACK ITEM ====================

router.patch('/:id/feedback-rating', async (req, res, next) => {
  try {
    const { index, rating } = req.body;
    if (typeof index !== 'number' || !['up', 'down', null].includes(rating)) {
      return res.status(400).json({ error: { message: 'index (number) and rating ("up"|"down"|null) required' } });
    }

    const call = await prisma.call.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      select: { feedbackRatings: true }
    });
    if (!call) return res.status(404).json({ error: { message: 'Call not found' } });

    const ratings = (call.feedbackRatings && typeof call.feedbackRatings === 'object')
      ? { ...call.feedbackRatings }
      : {};

    if (rating === null) {
      delete ratings[index];
    } else {
      ratings[index] = rating;
    }

    await prisma.call.update({
      where: { id: req.params.id },
      data: { feedbackRatings: ratings }
    });

    res.json({ feedbackRatings: ratings });
  } catch (error) {
    next(error);
  }
});

// ==================== CHAT WITH BRUTUS ====================

router.post('/chat', async (req, res, next) => {
  try {
    const { message } = req.body;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        error: { message: 'Message is required' }
      });
    }
    
    const response = await chatWithBrutus(req.user.id, message);
    
    res.json({
      response
    });
    
  } catch (error) {
    next(error);
  }
});

module.exports = router;
