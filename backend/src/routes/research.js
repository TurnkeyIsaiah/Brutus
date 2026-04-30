const express = require('express');
const { PrismaClient } = require('@prisma/client');
const Anthropic = require('@anthropic-ai/sdk');
const { authenticate } = require('../middleware/auth');
const { deductTokens } = require('../lib/tokens');
const { braveSearch, formatSearchResults } = require('../services/brave');

const router = express.Router();
const prisma = new PrismaClient();
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ==================== CREATE RESEARCH REQUEST ====================

router.post('/', authenticate, async (req, res) => {
  try {
    const { sessionId, query, requestedAt } = req.body;
    const userId = req.user.id;

    // sessionId is optional — web frontend requests won't have one
    const data = {
      userId,
      query,
      status: 'pending',
      requestedAt: requestedAt ? new Date(requestedAt) : new Date()
    };
    if (sessionId) data.sessionId = sessionId;

    const research = await prisma.research.create({ data });

    // Process research in background (don't wait for it)
    processResearch(research.id, userId, query, sessionId || null).catch(err => {
      console.error('Failed to process research:', err);
    });

    res.json({ research });
  } catch (error) {
    console.error('Failed to create research request:', error);
    res.status(500).json({ error: { message: 'Failed to create research request' } });
  }
});

// ==================== GET RESEARCH ====================

router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId, status } = req.query;

    const where = { userId };
    if (sessionId) {
      where.sessionId = sessionId;
    }
    if (status) {
      where.status = status;
    }

    const research = await prisma.research.findMany({
      where,
      include: {
        session: {
          select: {
            id: true,
            startedAt: true,
            endedAt: true
          }
        }
      },
      orderBy: {
        requestedAt: 'desc'
      }
    });

    res.json({ research });
  } catch (error) {
    console.error('Failed to get research:', error);
    res.status(500).json({ error: { message: 'Failed to get research' } });
  }
});

// ==================== GET RESEARCH BY SESSION ====================

router.get('/session/:sessionId', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;

    const research = await prisma.research.findMany({
      where: {
        sessionId,
        userId
      },
      orderBy: {
        requestedAt: 'asc'
      }
    });

    res.json({ research });
  } catch (error) {
    console.error('Failed to get session research:', error);
    res.status(500).json({ error: { message: 'Failed to get session research' } });
  }
});

// ==================== DELETE RESEARCH ====================

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Make sure research belongs to user
    const research = await prisma.research.findFirst({
      where: {
        id,
        userId
      }
    });

    if (!research) {
      return res.status(404).json({ error: { message: 'Research not found' } });
    }

    await prisma.research.delete({
      where: { id }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete research:', error);
    res.status(500).json({ error: { message: 'Failed to delete research' } });
  }
});

// ==================== BACKGROUND RESEARCH PROCESSOR ====================

async function processResearch(researchId, userId, query, sessionId) {
  try {
    console.log(`[Research] Processing: "${query}"`);

    // Pull call transcript from DB if there's an active session
    let transcriptContext = '';
    if (sessionId) {
      const session = await prisma.session.findFirst({
        where: { id: sessionId, userId },
        select: { transcriptSoFar: true }
      });
      if (session?.transcriptSoFar?.trim().length > 50) {
        transcriptContext = `\n\nCALL TRANSCRIPT CONTEXT (what the prospect has said so far on this call):\n"""\n${session.transcriptSoFar.slice(-2000)}\n"""\nUse any details from this transcript — company name, role, pain points, team size, budget, goals — to make the brief more specific and accurate.`;
      }
    }

    // Brave search for live web data
    let searchContext = '';
    try {
      const searchResults = await braveSearch(userId, query, 5);
      if (searchResults.length > 0) {
        searchContext = `\n\nLIVE WEB SEARCH RESULTS for "${query}":\n${formatSearchResults(searchResults)}\n\nUse these search results as your primary source of factual, current information.`;
      }
    } catch (err) {
      console.error('[Research] Brave search failed:', err.message);
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: `You are a sales research assistant. Research this company or prospect for an active sales rep: "${query}"${searchContext}${transcriptContext}

Provide a concise sales research brief covering:
1. Company overview — industry, size, what they do
2. Likely pain points and business needs
3. Potential objections and how to handle them
4. Best angle for this sales rep to take
5. Key questions to ask on the call

Be direct and actionable. Cite specific details from the search results where available. Skip sections where you have no useful information.`
        }
      ]
    });

    deductTokens(userId, response.usage).catch(console.error);

    const results = response.content[0].text;

    await prisma.research.update({
      where: { id: researchId },
      data: { results, status: 'completed', completedAt: new Date() }
    });

    console.log(`[Research] Completed: "${query}"`);
  } catch (error) {
    console.error(`[Research] Failed: "${query}"`, error);
    await prisma.research.update({
      where: { id: researchId },
      data: { status: 'failed', results: `Research failed: ${error.message}` }
    });
  }
}

module.exports = router;
