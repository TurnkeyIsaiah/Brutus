const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  startSession,
  endSession,
  getActiveSession,
  handleTranscriptChunk
} = require('../services/live');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ==================== START LIVE SESSION ====================

router.post('/start', async (req, res, next) => {
  try {
    const session = await startSession(req.user.id);
    
    res.json({
      message: 'Live monitoring started. brutus is watching.',
      session: {
        id: session.id,
        startedAt: session.startedAt,
        status: session.status
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// ==================== GET ACTIVE SESSION ====================

router.get('/active', async (req, res, next) => {
  try {
    const session = await getActiveSession(req.user.id);
    
    if (!session) {
      return res.json({
        active: false,
        session: null
      });
    }
    
    res.json({
      active: true,
      session: {
        id: session.id,
        startedAt: session.startedAt,
        feedbackCount: session.feedbackGiven?.length || 0
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// ==================== SEND TRANSCRIPT CHUNK (HTTP fallback) ====================

router.post('/transcript', async (req, res, next) => {
  try {
    const { sessionId, transcriptChunk, timeIntoCall, audioData, mimeType } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        error: { message: 'Session ID is required' }
      });
    }
    
    const feedback = await handleTranscriptChunk(req.user.id, {
      sessionId,
      transcriptChunk,
      timeIntoCall,
      audioData,
      mimeType
    });
    
    res.json({
      feedback: feedback || null,
      message: feedback ? 'Brutus has feedback' : 'No feedback at this time'
    });
    
  } catch (error) {
    next(error);
  }
});

// ==================== END LIVE SESSION ====================

router.post('/end', async (req, res, next) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        error: { message: 'Session ID is required' }
      });
    }
    
    const result = await endSession(req.user.id, sessionId);
    
    res.json({
      message: result.callId 
        ? 'Session ended and analyzed. check your results.'
        : 'Session ended. too short to analyze.',
      callId: result.callId,
      analysis: result.analysis,
      durationSeconds: result.durationSeconds
    });
    
  } catch (error) {
    next(error);
  }
});

// ==================== CANCEL SESSION ====================

router.post('/cancel', async (req, res, next) => {
  try {
    const { sessionId } = req.body;
    
    // Just update status, don't analyze
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'cancelled',
        endedAt: new Date()
      }
    });
    
    res.json({
      message: 'Session cancelled. brutus will pretend he didn\'t see anything.'
    });
    
  } catch (error) {
    next(error);
  }
});

module.exports = router;
