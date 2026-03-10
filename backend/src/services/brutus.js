const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const { deductTokens } = require('../lib/tokens');

let _anthropic = null;
const getAnthropic = () => {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
};

// ==================== BRUTUS SYSTEM PROMPT ====================

const BRUTUS_SYSTEM_PROMPT = `You are Brutus, an elite sales coach. Your entire purpose is to make this rep more money. You're in their corner — always. That's exactly why you don't sugarcoat anything. Coddling someone who needs to close deals to pay their bills isn't kindness, it's negligence. You're hard on them because you respect them and you know what they're capable of.
You are not better than them. You're their edge.

Personality:
- Direct, sharp, performance-obsessed
- Lowercase casual tone — you're not a corporate tool
- Short punchy sentences
- Occasional dark humor that punches with them, never at them
- You celebrate wins genuinely, not sarcastically
- You're trained in NEPQ methodology and you enforce it

Feedback style:
- Only speak when something is worth saying — silence is better than filler feedback
- Point out specific problems with specific examples from the transcript
- Always explain WHY it's costing them money or deals
- Give them the exact words to use in the moment when possible
- Acknowledge improvements genuinely — progress deserves recognition
- Rate talk ratio, scores, and metrics when relevant

What you watch for:
- Talk ratio (they talk 40%, prospect 60%)
- Interruptions
- Feature dumping without understanding needs
- Weak questions ("does that make sense?" kills deals)
- Filler words
- Not listening, answering their own questions
- Skipping discovery and jumping to pitch
- Unhandled objections
- Weak rapport building
- Missed closing opportunities
- Silence — let it breathe, it does the work

NEPQ principles you enforce:
- Questions are problem-focused, never solution-focused
- Help the prospect discover their own pain
- Never pitch before understanding their situation fully
- Emotional connection before logical features
- Silence is a weapon — teach them to use it

The rule: Every single piece of feedback exists to help them close more deals and make more money. If it doesn't serve that, don't say it.`;

// ==================== ANALYZE FULL CALL ====================

async function analyzeCall(userId, transcript, duration) {
  try {
    // Get user context
    const userProfile = await prisma.userProfile.findUnique({
      where: { userId }
    });
    
    const contextPrompt = userProfile ? `
USER CONTEXT:
- Total calls analyzed: ${userProfile.totalCallsAnalyzed}
- Close rate: ${parseFloat(userProfile.closeRate || 0).toFixed(1)}%
- Average talk ratio: ${parseFloat(userProfile.talkRatioAvg || 0).toFixed(1)}%
- Known bad habits: ${JSON.stringify(userProfile.badHabits)}
- Strengths: ${JSON.stringify(userProfile.strengths)}
- Areas they're working on: ${JSON.stringify(userProfile.areasImproving)}
- Previous summary: ${userProfile.summary}
` : 'NEW USER - First call being analyzed.';

    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: BRUTUS_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `${contextPrompt}

CALL TRANSCRIPT (${Math.floor(duration / 60)} minutes):
${transcript}

Analyze this sales call and provide:
1. Overall score (0-100)
2. Talk ratio estimate (what % was the salesperson talking)
3. Number of interruptions you detected
4. Top 3 things they did wrong (with specific examples from transcript)
5. 1-2 things they did right (if any)
6. Specific actionable advice for next call
7. Any patterns you notice compared to their history (if available)

Format your response as JSON:
{
  "overallScore": number,
  "talkRatio": number,
  "interruptionCount": number,
  "feedback": [
    {"type": "critical|warning|insight", "text": "..."},
    ...
  ],
  "badMoments": [
    {"timestamp": "approximate time or quote", "issue": "...", "suggestion": "..."},
    ...
  ],
  "goodMoments": [
    {"timestamp": "approximate time or quote", "praise": "..."},
    ...
  ],
  "actionItems": ["...", "..."],
  "overallRoast": "A 2-3 sentence brutally honest summary of this call"
}`
        }
      ]
    });

    deductTokens(userId, response.usage).catch(console.error);

    // Parse the response
    const content = response.content[0].text;

    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }

    const analysis = JSON.parse(jsonStr);
    return analysis;

  } catch (error) {
    console.error('Brutus analysis error:', error);
    throw new Error('Failed to analyze call: ' + error.message);
  }
}

// ==================== REAL-TIME FEEDBACK ====================

async function getRealTimeFeedback(userId, transcriptChunk, sessionContext) {
  try {
    // Get user profile for context
    const userProfile = await prisma.userProfile.findUnique({
      where: { userId }
    });

    const badHabits = userProfile?.badHabits || [];

    // Build text-only prompt — Sonnet never receives image tokens
    const visualLine = sessionContext.visualSummary
      ? `VISUAL CONTEXT (screen analysis):\n${sessionContext.visualSummary}\n\n`
      : '';

    const userMessage = `CALL SUMMARY SO FAR:
${sessionContext.runningSummary || 'Call just started — no summary yet.'}

${visualLine}RECENT TRANSCRIPT (last 60 seconds):
"${transcriptChunk}"

FEEDBACK ALREADY GIVEN (last 5):
${sessionContext.feedbackGiven?.slice(-5).map(f => `- ${f.feedback || f.text}`).join('\n') || 'None yet'}

TIME INTO CALL: ${sessionContext.timeIntoCall || 0} seconds

Triage this silently. If nothing coachable happened, respond with {"coach": false}.
Only respond with {"coach": true, "feedback": "..."} if one of the triggers below fired.`;

    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: `${BRUTUS_SYSTEM_PROMPT}

You're triaging a LIVE sales call every 30 seconds. Default is complete silence.

TRIGGERS — only fire when one of these is detected:

OBJECTION & RESISTANCE:
- Prospect stalls: "need to think about it", "let me talk to my team", any delay/deflection
- Price objection left unhandled: "too expensive", "no budget"
- Feature-gap objection not addressed

DISCOVERY FAILURES:
- Rep pitches features/benefits before understanding the prospect's situation
- No discovery questions in the last 2+ minutes
- Rep answers their own questions without waiting for prospect to respond

MONOLOGUE & TALK RATIO:
- Rep speaking continuously for 60+ seconds
- Rep interrupts the prospect mid-sentence
- Prospect hasn't spoken in 90+ seconds

MISSED SIGNALS:
- Prospect shows buying intent or excitement and rep doesn't capitalize
- Prospect mentions a pain point and rep immediately pivots to features
- Prospect asks a closing question ("how long is onboarding?") and rep gives facts instead of closing

WEAK LANGUAGE & HABITS:
- "does that make sense?" or "does that resonate?"
- Filler words (um, uh, like, you know) — multiple in same sentence
- Apologizing for price or using "only", "just", "it's only X"
- "I think" or "I believe" instead of speaking with authority
- Weak closes ("I'd love to work with you") instead of a direct ask

CLOSING:
- Clear buying signal with no close attempt
- Prospect asks about next steps and rep fumbles or over-explains
- Multiple buying signals have occurred with no close attempted

VISUAL (if visual context provided):
- Prospect distracted, on phone, or looking away during key moments
- Competing solutions or research visible on screen
- Visible disengagement (body language, crossed arms)

User's known bad habits to watch for extra closely: ${JSON.stringify(badHabits)}

Response format — choose one:
{"coach": true, "feedback": "1-2 sentences max. direct. give exact words when possible."}
{"coach": false}

Do NOT repeat feedback already given this session. If nothing triggered — {"coach": false}.`,
      messages: [{ role: 'user', content: userMessage }]
    });

    deductTokens(userId, response.usage).catch(console.error);

    const content = response.content[0].text;

    // Parse response
    let jsonStr = content;
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }

    const feedback = JSON.parse(jsonStr);

    if (!feedback.coach) {
      return null;
    }

    return feedback;
    
  } catch (error) {
    console.error('Real-time feedback error:', error);
    return null;
  }
}

// ==================== UPDATE USER SUMMARY ====================

async function updateUserSummary(userId) {
  try {
    // Get recent calls with outcome and rating data
    const recentCalls = await prisma.call.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        overallScore: true,
        talkRatio: true,
        interruptionCount: true,
        brutusFeedback: true,
        feedbackRatings: true,
        outcome: true,
        tags: true,
        createdAt: true
      }
    });

    if (recentCalls.length === 0) return;

    const profile = await prisma.userProfile.findUnique({ where: { userId } });

    // Calculate averages
    const avgTalkRatio = recentCalls.reduce((sum, c) => sum + parseFloat(c.talkRatio), 0) / recentCalls.length;

    // Recompute close rate from all calls with an outcome
    const allOutcomeCalls = await prisma.call.findMany({
      where: { userId, outcome: { not: null } },
      select: { outcome: true }
    });
    const closeRate = allOutcomeCalls.length > 0
      ? (allOutcomeCalls.filter(c => c.outcome === 'closed').length / allOutcomeCalls.length) * 100
      : 0;

    // Pull live session coaching patterns (last 5 completed sessions)
    const recentSessions = await prisma.session.findMany({
      where: { userId, status: 'completed' },
      orderBy: { endedAt: 'desc' },
      take: 5,
      select: { feedbackGiven: true, endedAt: true }
    });

    // Build call data summary — fixing the brutusFeedback?.slice() bug
    const callSummaries = recentCalls.map((c, i) => {
      const fb = c.brutusFeedback;
      const feedbackItems = Array.isArray(fb) ? fb : (fb?.feedback || []);
      const ratings = c.feedbackRatings || {};
      const ratedUseful = feedbackItems.filter((_, idx) => ratings[idx] === 'up').map(f => f.text);
      const badReads = feedbackItems.filter((_, idx) => ratings[idx] === 'down').map(f => f.text);

      return `Call ${i + 1} (${new Date(c.createdAt).toLocaleDateString()}):
- Score: ${c.overallScore}/100
- Talk ratio: ${c.talkRatio}%
- Interruptions: ${c.interruptionCount}
- Outcome: ${c.outcome || 'not logged'}
- Key feedback: ${JSON.stringify(feedbackItems.slice(0, 3).map(f => f.text))}
${ratedUseful.length ? `- Rep confirmed useful: ${JSON.stringify(ratedUseful)}` : ''}
${badReads.length ? `- Rep flagged as bad reads: ${JSON.stringify(badReads)}` : ''}`;
    }).join('\n\n');

    // Build live session patterns
    const sessionPatterns = recentSessions.length > 0
      ? `\nLIVE COACHING PATTERNS (from ${recentSessions.length} recent sessions):\n` +
        recentSessions.map(s => {
          const items = Array.isArray(s.feedbackGiven) ? s.feedbackGiven : [];
          const topics = items.slice(0, 4).map(f => f.feedback || f.text || '').filter(Boolean);
          return `- ${new Date(s.endedAt).toLocaleDateString()}: ${items.length} tips given${topics.length ? ' — ' + topics.join(' | ') : ''}`;
        }).join('\n')
      : '';

    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: BRUTUS_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Update this rep's coaching profile based on their recent data.

RECENT CALL DATA (last ${recentCalls.length} calls):
${callSummaries}
${sessionPatterns}

CURRENT CLOSE RATE: ${closeRate.toFixed(1)}% (${allOutcomeCalls.length} calls with logged outcomes)

PREVIOUS PROFILE:
- Bad habits: ${JSON.stringify(profile?.badHabits || [])}
- Strengths: ${JSON.stringify(profile?.strengths || [])}
- Areas improving: ${JSON.stringify(profile?.areasImproving || [])}
- Previous summary: ${profile?.summary || 'New user'}

Instructions:
- Treat "rep confirmed useful" feedback as patterns worth reinforcing
- Treat "rep flagged as bad reads" as areas where your coaching missed — adjust
- Weight outcomes heavily: closed calls reveal what works, lost calls reveal what doesn't
- Track habits that appear across multiple calls, not one-offs

Generate an updated profile in JSON:
{
  "badHabits": ["habit that keeps appearing across calls", "..."],
  "strengths": ["genuine strength shown across multiple calls", "..."],
  "areasImproving": ["something getting measurably better", "..."],
  "summary": "2-3 sentence brutus-style summary of where they're at and what to fix next"
}`
        }
      ]
    });

    deductTokens(userId, response.usage).catch(console.error);

    const content = response.content[0].text;
    let jsonStr = content;
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[1] || jsonMatch[0];

    const updates = JSON.parse(jsonStr);

    await prisma.userProfile.update({
      where: { userId },
      data: {
        talkRatioAvg: avgTalkRatio,
        closeRate,
        badHabits: updates.badHabits,
        strengths: updates.strengths,
        areasImproving: updates.areasImproving,
        summary: updates.summary
      }
    });

    console.log(`[Brutus] Profile updated for user ${userId} — close rate ${closeRate.toFixed(1)}%`);

  } catch (error) {
    console.error('Failed to update user summary:', error);
  }
}

// ==================== CHAT WITH BRUTUS ====================

async function chatWithBrutus(userId, message) {
  try {
    const userProfile = await prisma.userProfile.findUnique({
      where: { userId }
    });
    
    const recentCalls = await prisma.call.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        overallScore: true,
        talkRatio: true,
        interruptionCount: true,
        brutusFeedback: true,
        tags: true,
        createdAt: true
      }
    });
    
    const contextPrompt = `
USER PROFILE:
- Total calls: ${userProfile?.totalCallsAnalyzed || 0}
- Talk ratio avg: ${userProfile?.talkRatioAvg || 'N/A'}%
- Close rate: ${userProfile?.closeRate || 'N/A'}%
- Bad habits: ${JSON.stringify(userProfile?.badHabits || [])}
- Strengths: ${JSON.stringify(userProfile?.strengths || [])}
- Summary: ${userProfile?.summary || 'New user'}

RECENT CALLS (last ${recentCalls.length}):
${recentCalls.map((c, i) => `Call ${i + 1}: Score ${c.overallScore}/100, Talk ratio ${c.talkRatio}%, Interruptions ${c.interruptionCount || 0}, Tags: ${(c.tags || []).join(', ') || 'none'}, Date: ${new Date(c.createdAt).toLocaleDateString()}`).join('\n') || 'No calls yet'}
`;

    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: `${BRUTUS_SYSTEM_PROMPT}

You're chatting with a user who wants sales coaching advice. Use their profile data to give personalized, relevant advice. Stay in character as Brutus - direct, honest, helpful.`,
      messages: [
        {
          role: 'user',
          content: `${contextPrompt}

USER MESSAGE: "${message}"

Respond as Brutus. Keep it conversational but valuable. 2-4 sentences usually.`
        }
      ]
    });

    deductTokens(userId, response.usage).catch(console.error);

    return response.content[0].text;

  } catch (error) {
    console.error('Chat error:', error);
    return "something went wrong on my end. try again, and maybe this time i'll actually be able to roast you properly.";
  }
}

module.exports = {
  analyzeCall,
  getRealTimeFeedback,
  updateUserSummary,
  chatWithBrutus
};
