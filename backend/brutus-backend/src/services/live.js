const prisma = require('../lib/prisma');
const { getRealTimeFeedback, updateUserSummary, analyzeCall } = require('./brutus');
const { transcribeChunk } = require('./transcription');

// ==================== START SESSION ====================

async function startSession(userId) {
  try {
    // End any existing active sessions for this user
    await prisma.session.updateMany({
      where: {
        userId,
        status: 'active'
      },
      data: {
        status: 'cancelled',
        endedAt: new Date()
      }
    });
    
    // Create new session
    const session = await prisma.session.create({
      data: {
        userId,
        status: 'active',
        transcriptSoFar: '',
        feedbackGiven: []
      }
    });
    
    return session;
    
  } catch (error) {
    console.error('Start session error:', error);
    throw new Error('Failed to start session');
  }
}

// ==================== HANDLE TRANSCRIPT CHUNK ====================

async function handleTranscriptChunk(userId, payload) {
  try {
    const { sessionId, transcriptChunk, timeIntoCall, audioData, mimeType, screenshot } = payload;

    // Get active session
    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        userId,
        status: 'active'
      }
    });

    if (!session) {
      console.error('No active session found');
      return null;
    }

    let transcript = transcriptChunk;

    // If audio data provided, transcribe it first
    if (audioData && !transcriptChunk) {
      const audioBuffer = Buffer.from(audioData, 'base64');
      transcript = await transcribeChunk(audioBuffer, mimeType || 'audio/webm');

      if (!transcript) {
        return null;
      }
    }

    // Skip if no transcript
    if (!transcript || transcript.trim().length === 0) {
      return null;
    }

    // Update session with new transcript
    const updatedTranscript = session.transcriptSoFar + '\n' + transcript;

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        transcriptSoFar: updatedTranscript
      }
    });

    // Get real-time feedback from Brutus (with screenshot if available)
    const feedback = await getRealTimeFeedback(
      userId,
      transcript,
      {
        feedbackGiven: session.feedbackGiven,
        timeIntoCall: timeIntoCall || 0,
        fullTranscript: updatedTranscript
      },
      screenshot || null  // Pass the screenshot to Brutus
    );
    
    // If Brutus has feedback, save it and return
    if (feedback) {
      const updatedFeedback = [
        ...session.feedbackGiven,
        {
          ...feedback,
          timestamp: timeIntoCall || 0,
          createdAt: new Date().toISOString()
        }
      ];
      
      await prisma.session.update({
        where: { id: sessionId },
        data: {
          feedbackGiven: updatedFeedback
        }
      });
      
      return {
        ...feedback,
        timestamp: timeIntoCall
      };
    }
    
    return null;
    
  } catch (error) {
    console.error('Handle transcript chunk error:', error);
    return null;
  }
}

// ==================== END SESSION ====================

async function endSession(userId, sessionId) {
  try {
    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        userId,
        status: 'active'
      }
    });
    
    if (!session) {
      throw new Error('Session not found');
    }
    
    // Calculate duration
    const durationSeconds = Math.floor(
      (new Date() - new Date(session.startedAt)) / 1000
    );
    
    // Only save as a call if there's meaningful content
    if (session.transcriptSoFar.trim().length > 50) {
      // Analyze the full call
      const analysis = await analyzeCall(
        userId,
        session.transcriptSoFar,
        durationSeconds
      );
      
      // Create call record
      const call = await prisma.call.create({
        data: {
          userId,
          transcript: session.transcriptSoFar,
          durationSeconds,
          talkRatio: analysis.talkRatio || 50,
          interruptionCount: analysis.interruptionCount || 0,
          overallScore: analysis.overallScore || 50,
          brutusFeedback: analysis.feedback || [],
          tags: detectCallTags(session.transcriptSoFar)
        }
      });
      
      // Update user profile
      await prisma.userProfile.update({
        where: { userId },
        data: {
          totalCallsAnalyzed: { increment: 1 }
        }
      });
      
      // Update user summary (async, don't wait)
      updateUserSummary(userId).catch(console.error);
      
      // Mark session as completed
      await prisma.session.update({
        where: { id: sessionId },
        data: {
          status: 'completed',
          endedAt: new Date()
        }
      });
      
      return {
        callId: call.id,
        analysis,
        durationSeconds
      };
    } else {
      // Not enough content, just cancel the session
      await prisma.session.update({
        where: { id: sessionId },
        data: {
          status: 'cancelled',
          endedAt: new Date()
        }
      });
      
      return {
        callId: null,
        analysis: null,
        durationSeconds,
        message: 'Session too short to analyze'
      };
    }
    
  } catch (error) {
    console.error('End session error:', error);
    throw new Error('Failed to end session: ' + error.message);
  }
}

// ==================== DETECT CALL TAGS ====================

function detectCallTags(transcript) {
  const tags = [];
  const lowerTranscript = transcript.toLowerCase();
  
  // Discovery call indicators
  if (
    lowerTranscript.includes('tell me about') ||
    lowerTranscript.includes('what are you currently') ||
    lowerTranscript.includes('walk me through')
  ) {
    tags.push('discovery');
  }
  
  // Cold call indicators
  if (
    lowerTranscript.includes('reaching out') ||
    lowerTranscript.includes('first time') ||
    lowerTranscript.includes('introduction')
  ) {
    tags.push('cold-call');
  }
  
  // Follow-up indicators
  if (
    lowerTranscript.includes('following up') ||
    lowerTranscript.includes('last time we spoke') ||
    lowerTranscript.includes('checking in')
  ) {
    tags.push('follow-up');
  }
  
  // Pricing discussion
  if (
    lowerTranscript.includes('price') ||
    lowerTranscript.includes('cost') ||
    lowerTranscript.includes('investment') ||
    lowerTranscript.includes('budget')
  ) {
    tags.push('pricing');
  }
  
  // Objection handling
  if (
    lowerTranscript.includes('too expensive') ||
    lowerTranscript.includes('think about it') ||
    lowerTranscript.includes('not sure') ||
    lowerTranscript.includes('competitor')
  ) {
    tags.push('objection-handling');
  }
  
  // Closing attempt
  if (
    lowerTranscript.includes('move forward') ||
    lowerTranscript.includes('next steps') ||
    lowerTranscript.includes('get started') ||
    lowerTranscript.includes('sign')
  ) {
    tags.push('closing');
  }
  
  return tags;
}

// ==================== GET ACTIVE SESSION ====================

async function getActiveSession(userId) {
  return await prisma.session.findFirst({
    where: {
      userId,
      status: 'active'
    }
  });
}

module.exports = {
  startSession,
  handleTranscriptChunk,
  endSession,
  getActiveSession
};
