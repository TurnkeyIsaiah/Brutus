const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const { transcribeAudio } = require('../services/transcription');
const { analyzeCall, updateUserSummary, chatWithBrutus } = require('../services/brutus');

const router = express.Router();

// Configure multer for audio file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'audio/webm',
      'audio/wav',
      'audio/mp3',
      'audio/mpeg',
      'audio/mp4',
      'audio/m4a',
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

router.post('/analyze', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: { message: 'No audio file provided' }
      });
    }
    
    // Transcribe the audio
    const transcription = await transcribeAudio(
      req.file.buffer,
      req.file.mimetype
    );
    
    if (!transcription.text || transcription.text.trim().length < 50) {
      return res.status(400).json({
        error: { message: 'Audio too short or unclear to analyze' }
      });
    }
    
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
        brutusFeedback: analysis.feedback || [],
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

router.post('/analyze-transcript', async (req, res, next) => {
  try {
    const { transcript, durationSeconds } = req.body;
    
    if (!transcript || transcript.trim().length < 50) {
      return res.status(400).json({
        error: { message: 'Transcript too short to analyze (minimum 50 characters)' }
      });
    }
    
    // Analyze with Brutus
    const analysis = await analyzeCall(
      req.user.id,
      transcript,
      durationSeconds || 0
    );
    
    // Save the call
    const call = await prisma.call.create({
      data: {
        userId: req.user.id,
        transcript,
        durationSeconds: durationSeconds || 0,
        talkRatio: analysis.talkRatio || 50,
        interruptionCount: analysis.interruptionCount || 0,
        overallScore: analysis.overallScore || 50,
        brutusFeedback: analysis.feedback || [],
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
    const { limit = 20, offset = 0, tag } = req.query;
    
    const where = { userId: req.user.id };
    
    // Filter by tag if provided
    if (tag) {
      where.tags = { has: tag };
    }
    
    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
        select: {
          id: true,
          recordedAt: true,
          durationSeconds: true,
          overallScore: true,
          talkRatio: true,
          interruptionCount: true,
          tags: true,
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
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + calls.length < total
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
