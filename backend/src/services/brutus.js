const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ==================== BRUTUS SYSTEM PROMPT ====================

const BRUTUS_SYSTEM_PROMPT = `You are Brutus, an AI sales coach known for brutal honesty. You analyze sales calls and provide direct, no-nonsense feedback.

Your personality:
- Brutally honest but constructive
- Use lowercase for casual, direct tone
- Short, punchy sentences
- Occasional dark humor
- You genuinely want to help salespeople improve, but you don't sugarcoat anything
- You're trained in NEPQ (Neuro-Emotional Persuasion Questioning) methodology

Your feedback style:
- Point out specific problems with specific examples from the transcript
- Always explain WHY something is a problem
- Give actionable, constructive suggestions - not just criticism
- Proactively suggest what they should say or ask in the moment
- Acknowledge improvements when you see them (occasionally be nice)
- Rate things on a scale when relevant (talk ratio, score out of 100, etc.)
- Balance roasting with real help - every critique should include how to fix it

Things you watch for:
- Talk ratio (salesperson should talk ~40%, prospect ~60%)
- Interruptions
- Feature dumping (listing features without understanding needs)
- Weak questions ("does that make sense?" instead of powerful questions)
- Filler words (um, like, you know)
- Not listening / answering their own questions
- Skipping discovery and jumping to pitch
- Not addressing objections properly
- Poor opening / rapport building
- Weak closing attempts

NEPQ principles you enforce:
- Questions should be problem-focused, not solution-focused
- Help prospects discover their own pain
- Never pitch before understanding their situation
- Emotional connection before logical features
- Let silence do the heavy lifting

Remember: You're not mean for the sake of being mean. You're honest because you want these salespeople to actually get better. Every roast should teach something.`;

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
- Average talk ratio: ${userProfile.talkRatioAvg}%
- Known bad habits: ${JSON.stringify(userProfile.badHabits)}
- Areas they're working on: ${JSON.stringify(userProfile.areasImproving)}
- Previous summary: ${userProfile.summary}
` : 'NEW USER - First call being analyzed.';

    const response = await anthropic.messages.create({
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

async function getRealTimeFeedback(userId, transcriptChunk, sessionContext, screenshot = null) {
  try {
    // Get user profile for context
    const userProfile = await prisma.userProfile.findUnique({
      where: { userId }
    });

    const badHabits = userProfile?.badHabits || [];

    // Build the message content - add screenshot if available
    const messageContent = [];

    // Add the text prompt
    let textPrompt = `RECENT TRANSCRIPT CHUNK:
"${transcriptChunk}"

FEEDBACK ALREADY GIVEN THIS SESSION:
${sessionContext.feedbackGiven?.map(f => `- ${f.text}`).join('\n') || 'None yet'}

TIME INTO CALL: ${sessionContext.timeIntoCall || 0} seconds`;

    // If screenshot is provided, add context about it
    if (screenshot) {
      textPrompt += `\n\nSCREENSHOT CONTEXT:
You're also seeing what's on the salesperson's screen right now. Analyze:
- What they're showing (slides, demo, document, etc.)
- Whether the visual content matches what they're saying
- If they're using visual aids effectively
- Any missed opportunities with what's on screen`;

      // Add the screenshot image first
      messageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: screenshot
        }
      });
    }

    // Add the text prompt
    messageContent.push({
      type: 'text',
      text: `${textPrompt}

IMPORTANT: Be VERY selective. This is a LIVE call - only interrupt if absolutely necessary.

You can provide TWO types of responses:
1. REACTIVE feedback (pointing out mistakes): {"type": "critical|warning", "text": "what they did wrong"}
2. PROACTIVE suggestions (what to say next): {"type": "suggestion", "text": "what they should say/ask right now"}
3. POSITIVE reinforcement: {"type": "good|insight", "text": "encouragement or observation"}

Examples of good suggestions:
- "ask them: 'what's the biggest challenge with your current solution?'"
- "pivot back to discovery. try: 'before I show you anything, help me understand...'"
- "address the price objection with: 'I hear you. what would solving this problem be worth to your team?'"
- "silence here could be powerful. let them process."

If this chunk is normal/fine/not urgent, respond with:
{"skip": true}

Remember: Be helpful, not just critical. Mix constructive corrections with proactive guidance.`
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: `${BRUTUS_SYSTEM_PROMPT}

You're monitoring a LIVE sales call. Give brief, real-time feedback.
User's known bad habits to watch for: ${JSON.stringify(badHabits)}

Rules for live feedback:
- Keep it SHORT (1-2 sentences max)
- BE VERY SELECTIVE - only speak up for CRITICAL or HIGHLY NOTABLE moments
- Default to {"skip": true} - silence is better than noise during a live call
- Only give feedback if:
  * Something CRITICAL is happening (major mistake, big opportunity)
  * A known bad habit is occurring right now
  * An immediate action could change the outcome
  * Visual content is seriously misaligned with what's being said
- DON'T comment on:
  * Minor phrasing issues
  * Normal conversation flow
  * Things that are "just okay"
  * Screenshots showing normal activity (browser, slides being used properly, etc.)
- Don't repeat the same feedback within a session
- Remember: interrupting a live pitch is annoying, so make it count`,
      messages: [
        {
          role: 'user',
          content: messageContent
        }
      ]
    });

    const content = response.content[0].text;
    
    // Parse response
    let jsonStr = content;
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }
    
    const feedback = JSON.parse(jsonStr);
    
    if (feedback.skip) {
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
    // Get recent calls
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
    
    if (recentCalls.length === 0) {
      return;
    }
    
    const profile = await prisma.userProfile.findUnique({
      where: { userId }
    });
    
    // Calculate averages
    const avgScore = recentCalls.reduce((sum, c) => sum + c.overallScore, 0) / recentCalls.length;
    const avgTalkRatio = recentCalls.reduce((sum, c) => sum + parseFloat(c.talkRatio), 0) / recentCalls.length;
    
    // Generate new summary using Brutus
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: BRUTUS_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Based on these recent calls, update this user's profile summary:

RECENT CALL DATA (last ${recentCalls.length} calls):
${recentCalls.map((c, i) => `
Call ${i + 1}:
- Score: ${c.overallScore}/100
- Talk ratio: ${c.talkRatio}%
- Interruptions: ${c.interruptionCount}
- Feedback highlights: ${JSON.stringify(c.brutusFeedback?.slice(0, 3) || [])}
`).join('\n')}

PREVIOUS PROFILE:
- Bad habits: ${JSON.stringify(profile?.badHabits || [])}
- Strengths: ${JSON.stringify(profile?.strengths || [])}
- Areas improving: ${JSON.stringify(profile?.areasImproving || [])}
- Previous summary: ${profile?.summary || 'New user'}

Generate an updated profile in JSON format:
{
  "badHabits": ["...", "..."],
  "strengths": ["...", "..."],
  "areasImproving": ["...", "..."],
  "summary": "2-3 sentence brutus-style summary of this salesperson's current state and what they need to work on"
}`
        }
      ]
    });

    const content = response.content[0].text;
    let jsonStr = content;
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }
    
    const updates = JSON.parse(jsonStr);
    
    // Update profile
    await prisma.userProfile.update({
      where: { userId },
      data: {
        talkRatioAvg: avgTalkRatio,
        badHabits: updates.badHabits,
        strengths: updates.strengths,
        areasImproving: updates.areasImproving,
        summary: updates.summary,
        totalCallsAnalyzed: { increment: 0 } // Just trigger updatedAt
      }
    });
    
    console.log(`Updated profile summary for user ${userId}`);
    
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
      take: 3,
      select: {
        overallScore: true,
        talkRatio: true,
        brutusFeedback: true,
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

RECENT CALLS:
${recentCalls.map((c, i) => `Call ${i + 1}: Score ${c.overallScore}/100, Talk ratio ${c.talkRatio}%`).join('\n') || 'No calls yet'}
`;

    const response = await anthropic.messages.create({
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
