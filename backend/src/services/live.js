const prisma = require('../lib/prisma');
const { getRealTimeFeedback, updateUserSummary, analyzeCall } = require('./brutus');
const { transcribeChunk } = require('./transcription');
const { deductTokens, hasTokens } = require('../lib/tokens');
const { braveSearch, formatSearchResults } = require('./brave');
const { scrubPii } = require('../lib/scrub');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Track last AI note time per session
const lastAiNoteTime = new Map();

// Minimum seconds between Sonnet coaching calls per session
const MIN_COACHING_INTERVAL = 25;
const lastCoachingTime = new Map();

// Track what prospects have been auto-researched per session (prevent duplicates)
const sessionAutoResearched = new Map();

// In-memory session context (two-layer context system)
// Structure: { runningSummary, segments: [{text, timestamp}], lastSummaryUpdateAt }
const sessionContexts = new Map();

const SLIDING_WINDOW_SECONDS = 60;   // raw transcript window sent to Claude
const SUMMARY_UPDATE_INTERVAL = 180; // seconds between summary compressions (3 min)

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

    const session = await prisma.session.findFirst({
      where: { id: sessionId, userId, status: 'active' }
    });

    if (!session) {
      console.error('No active session found');
      return null;
    }

    const hasFunds = await hasTokens(userId);
    if (!hasFunds) {
      return { type: 'error', code: 'OUT_OF_TOKENS', text: "you're out of tokens. add credits to keep Brutus watching." };
    }

    let transcript = transcriptChunk;

    if (audioData && !transcriptChunk) {
      const audioBuffer = Buffer.from(audioData, 'base64');
      transcript = await transcribeChunk(audioBuffer, mimeType || 'audio/webm', userId);
      if (!transcript) return null;
    }

    if (!transcript || transcript.trim().length === 0) return null;
    transcript = scrubPii(transcript);

    const timestamp = timeIntoCall || 0;

    // ── Two-layer context ──────────────────────────────────────────────────────
    if (!sessionContexts.has(sessionId)) {
      sessionContexts.set(sessionId, {
        runningSummary: '',
        segments: [],          // all segments for this session
        lastSummaryUpdateAt: 0,
        lastVisualSummary: '' // Haiku visual analysis output (text only)
      });
    }
    const ctx = sessionContexts.get(sessionId);

    // Append new segment
    ctx.segments.push({ text: transcript, timestamp });

    // Sliding window: last 60 seconds of raw transcript
    const recentTranscript = ctx.segments
      .filter(s => s.timestamp >= timestamp - SLIDING_WINDOW_SECONDS)
      .map(s => s.text)
      .join('\n');

    // Persist full transcript to DB (needed by endSession for call analysis)
    const fullTranscript = ctx.segments.map(s => s.text).join('\n');
    await prisma.session.update({
      where: { id: sessionId },
      data: { transcriptSoFar: fullTranscript }
    });

    // Trigger background summary compression every 3 minutes (non-blocking)
    if (timestamp >= SUMMARY_UPDATE_INTERVAL &&
        timestamp - ctx.lastSummaryUpdateAt >= SUMMARY_UPDATE_INTERVAL) {
      ctx.lastSummaryUpdateAt = timestamp; // optimistic lock prevents double-fire
      updateRunningSummary(userId, sessionId, ctx).catch(console.error);
    }
    // ──────────────────────────────────────────────────────────────────────────

    // ── Haiku visual analysis (runs before Sonnet on screenshot chunks) ────────
    if (screenshot) {
      try {
        const visual = await analyzeScreenshot(userId, screenshot, recentTranscript);
        ctx.lastVisualSummary = visual.summary;
        console.log('[Visual] Haiku visual summary updated');

        // Auto-research: if Haiku spotted a prospect name/company not yet researched
        if (visual.prospect) {
          const researched = sessionAutoResearched.get(sessionId) || new Set();
          const key = visual.prospect.toLowerCase().trim();
          if (!researched.has(key)) {
            researched.add(key);
            sessionAutoResearched.set(sessionId, researched);
            triggerAutoResearch(userId, sessionId, visual.prospect).catch(console.error);
            console.log(`[AutoResearch] Triggered for: "${visual.prospect}"`);
          }
        }
      } catch (err) {
        console.error('[Visual] Haiku screenshot analysis failed:', err.message);
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    // Sonnet coaching — throttled to MIN_COACHING_INTERVAL seconds
    const lastCoached = lastCoachingTime.get(sessionId) || 0;
    if (timestamp - lastCoached < MIN_COACHING_INTERVAL) {
      return null;
    }
    lastCoachingTime.set(sessionId, timestamp);

    const feedback = await getRealTimeFeedback(
      userId,
      recentTranscript,
      {
        feedbackGiven: session.feedbackGiven,
        timeIntoCall: timestamp,
        runningSummary: ctx.runningSummary,
        visualSummary: ctx.lastVisualSummary  // 100-token Haiku text, not raw image
      }
    );

    if (feedback && feedback.coach === true) {
      await prisma.session.update({
        where: { id: sessionId },
        data: {
          feedbackGiven: [
            ...session.feedbackGiven,
            { feedback: feedback.feedback, timestamp, createdAt: new Date().toISOString() }
          ]
        }
      });
    }

    // Generate AI note independently — runs regardless of whether Brutus coached
    if (aiNotesEnabled && transcript.trim().length > 0) {
      generateAiNote(userId, sessionId, transcript, fullTranscript, timestamp).catch(console.error);
    }

    if (feedback && feedback.coach === true) {
      return { ...feedback, timestamp };
    }

    return null;

  } catch (error) {
    console.error('Handle transcript chunk error:', error);
    return null;
  }
}

// ==================== RUNNING SUMMARY (background, non-blocking) ====================

async function updateRunningSummary(userId, sessionId, ctx) {
  try {
    // Build transcript for the last 3-minute window
    const windowStart = ctx.lastSummaryUpdateAt - SUMMARY_UPDATE_INTERVAL;
    const recentText = ctx.segments
      .filter(s => s.timestamp > windowStart)
      .map(s => s.text)
      .join('\n');

    if (!recentText.trim()) return;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      messages: [{
        role: 'user',
        content: `Compress this sales call context into a brief factual summary under 300 tokens.

${ctx.runningSummary ? `Previous summary:\n${ctx.runningSummary}\n\n` : ''}New transcript (last 3 minutes):
"${recentText}"

Write one concise paragraph covering: topics discussed, prospect's situation/pain points, objections raised, rapport level, and where the call stands now. Facts only, no formatting or bullet points.`
      }]
    });

    deductTokens(userId, response.usage).catch(console.error);
    ctx.runningSummary = response.content[0].text.trim();
    console.log(`[Summary] Updated for session ${sessionId} at t=${ctx.lastSummaryUpdateAt}s`);

  } catch (error) {
    console.error('[Summary] Failed to update running summary:', error.message);
  }
}

// ==================== HAIKU VISUAL ANALYSIS ====================

async function analyzeScreenshot(userId, screenshot, recentTranscript) {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: screenshot }
        },
        {
          type: 'text',
          text: `Sales call screenshot. Recent speech: "${recentTranscript.slice(-300)}"

Respond with JSON only (no markdown):
{
  "summary": "<under 100 tokens: prospect engagement, attention signals, body language, notable on-screen content>",
  "prospect": "<full name or company name visible on screen (LinkedIn profile, email header, website, calendar invite), or null if none visible>"
}

For prospect: only extract if you can see a clear name/company on screen (e.g. LinkedIn profile page, email from/to field, company website header). Do not guess from speech.`
        }
      ]
    }]
  });

  deductTokens(userId, response.usage).catch(console.error);

  try {
    return JSON.parse(response.content[0].text.trim());
  } catch {
    // Fallback if Haiku doesn't return valid JSON
    return { summary: response.content[0].text.trim(), prospect: null };
  }
}

// ==================== AUTO RESEARCH ====================

async function triggerAutoResearch(userId, sessionId, prospect) {
  try {
    // Get session transcript for context
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { transcriptSoFar: true }
    });

    // Search Brave for live info
    const searchResults = await braveSearch(userId, prospect, 5);
    const searchContext = searchResults.length > 0
      ? `\n\nLIVE WEB SEARCH RESULTS:\n${formatSearchResults(searchResults)}`
      : '';

    const transcriptContext = session?.transcriptSoFar?.trim().length > 50
      ? `\n\nCALL TRANSCRIPT (so far):\n"""\n${session.transcriptSoFar.slice(-1500)}\n"""`
      : '';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are a sales research assistant. A sales rep just started a call and the prospect's name/company "${prospect}" appeared on screen. Research them quickly.${searchContext}${transcriptContext}

Give a punchy sales brief (5 bullets max):
• Who they are / what the company does
• Likely pain points
• Best angle to take
• Key objection to expect
• One sharp question to ask

Be specific and use search results where available. Skip any bullet you have nothing real to say about.`
      }]
    });

    deductTokens(userId, response.usage).catch(console.error);

    const results = response.content[0].text.trim();

    // Save to Research table so the overlay can surface it
    await prisma.research.create({
      data: {
        userId,
        sessionId,
        query: prospect,
        status: 'completed',
        results,
        requestedAt: new Date(),
        completedAt: new Date()
      }
    });

    console.log(`[AutoResearch] Completed for "${prospect}"`);
  } catch (err) {
    console.error(`[AutoResearch] Failed for "${prospect}":`, err.message);
  }
}

// ==================== GENERATE AI NOTE ====================

async function generateAiNote(userId, sessionId, recentTranscript, fullTranscript, timeIntoCall) {
  try {
    // Only generate notes every 30 seconds
    const lastNoteTime = lastAiNoteTime.get(sessionId) || 0;
    const timeSinceLastNote = timeIntoCall - lastNoteTime;
    const MIN_NOTE_INTERVAL = 60; // seconds

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
      model: 'claude-haiku-4-5-20251001',
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

    deductTokens(userId, response.usage).catch(console.error);

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
          brutusFeedback: analysis,
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

      // Clean up in-memory state
      lastAiNoteTime.delete(sessionId);
      lastCoachingTime.delete(sessionId);
      sessionContexts.delete(sessionId);
      sessionAutoResearched.delete(sessionId);

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

      // Clean up in-memory state
      lastAiNoteTime.delete(sessionId);
      lastCoachingTime.delete(sessionId);
      sessionContexts.delete(sessionId);
      sessionAutoResearched.delete(sessionId);

      return {
        callId: null,
        analysis: null,
        durationSeconds,
        message: 'Session too short to analyze'
      };
    }
    
  } catch (error) {
    console.error('End session error:', error);
    throw new Error('Failed to end session. Please try again.');
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
