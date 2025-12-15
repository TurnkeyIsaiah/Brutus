const prisma = require('../lib/prisma');
const { getRealTimeFeedback, updateUserSummary, analyzeCall } = require('./brutus');
const { transcribeChunk } = require('./transcription');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Track last AI note time per session
const lastAiNoteTime = new Map();

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
    const { sessionId, transcriptChunk, timeIntoCall, audioData, mimeType, screenshot, aiNotesEnabled } = payload;

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

    // If Brutus has feedback, check if enough time has passed since last feedback
    if (feedback) {
      // Get the timestamp of the last feedback
      const lastFeedback = session.feedbackGiven[session.feedbackGiven.length - 1];
      const lastFeedbackTime = lastFeedback ? lastFeedback.timestamp : 0;
      const timeSinceLastFeedback = (timeIntoCall || 0) - lastFeedbackTime;

      // Only send feedback if at least 20 seconds have passed (configurable minimum)
      const MIN_FEEDBACK_INTERVAL = 20; // seconds

      if (timeSinceLastFeedback < MIN_FEEDBACK_INTERVAL && session.feedbackGiven.length > 0) {
        console.log(`[Brutus] Skipping feedback - only ${timeSinceLastFeedback}s since last feedback (min: ${MIN_FEEDBACK_INTERVAL}s)`);
        return null;
      }

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

    // Generate AI notes if enabled and enough time has passed
    if (aiNotesEnabled && transcript.trim().length > 0) {
      await generateAiNote(userId, sessionId, transcript, updatedTranscript, timeIntoCall);
    }

    return null;
    
  } catch (error) {
    console.error('Handle transcript chunk error:', error);
    return null;
  }
}

// ==================== GENERATE AI NOTE ====================

async function generateAiNote(userId, sessionId, recentTranscript, fullTranscript, timeIntoCall) {
  try {
    // Only generate notes every 30 seconds
    const lastNoteTime = lastAiNoteTime.get(sessionId) || 0;
    const timeSinceLastNote = timeIntoCall - lastNoteTime;
    const MIN_NOTE_INTERVAL = 30; // seconds

    if (timeSinceLastNote < MIN_NOTE_INTERVAL && lastNoteTime > 0) {
      console.log(`[AI Notes] Skipping - only ${timeSinceLastNote}s since last note (min: ${MIN_NOTE_INTERVAL}s)`);
      return;
    }

    // Need at least 100 characters of transcript for meaningful notes
    if (fullTranscript.trim().length < 100) {
      console.log('[AI Notes] Skipping - not enough content yet');
      return;
    }

    console.log('[AI Notes] Generating note for session:', sessionId);

    // Generate concise note using Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are an AI sales assistant taking notes during a live call. Based on this recent snippet of conversation, generate ONE concise, actionable note (1-2 sentences max).

Recent conversation snippet:
"""
${recentTranscript}
"""

Full context (last 500 chars):
"""
${fullTranscript.slice(-500)}
"""

Generate a single bullet point note that captures:
- Key information mentioned (company names, pain points, objections, commitments)
- Action items or follow-ups
- Important insights or decisions

Format: Just return the note text, no prefix or bullet point. Keep it under 150 characters if possible.

IMPORTANT: Only generate a note if something NOTABLE happened in this snippet. If nothing significant was said, respond with exactly: "SKIP"

Examples of good notes:
- "Prospect confirmed budget of $50k, needs to loop in CFO before next week"
- "Major pain point: current CRM doesn't integrate with their accounting software"
- "Scheduled follow-up demo for Friday 2pm with full team"
- "Objection: price too high. Need to emphasize ROI and cost savings"

Only generate notes for IMPORTANT moments. Routine small talk should return SKIP.`
      }]
    });

    const noteContent = response.content[0].text.trim();

    // Skip if Claude says to skip or if note is too generic
    if (noteContent === 'SKIP' || noteContent.length < 10) {
      console.log('[AI Notes] Claude skipped note generation - nothing notable');
      return;
    }

    // Create the note
    await prisma.note.create({
      data: {
        sessionId,
        userId,
        content: noteContent,
        type: 'ai-generated',
        timestamp: new Date()
      }
    });

    // Update last note time
    lastAiNoteTime.set(sessionId, timeIntoCall);

    console.log('[AI Notes] Note created:', noteContent);

  } catch (error) {
    console.error('[AI Notes] Failed to generate note:', error);
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

      // Clean up AI notes tracking
      lastAiNoteTime.delete(sessionId);
      
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

      // Clean up AI notes tracking
      lastAiNoteTime.delete(sessionId);

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
