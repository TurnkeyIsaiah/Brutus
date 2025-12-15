const express = require('express');
const { PrismaClient } = require('@prisma/client');
const Anthropic = require('@anthropic-ai/sdk');
const { authenticate } = require('../middleware/auth');

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

    // Create research request
    const research = await prisma.research.create({
      data: {
        sessionId,
        userId,
        query,
        status: 'pending',
        requestedAt: requestedAt ? new Date(requestedAt) : new Date()
      }
    });

    // Process research in background (don't wait for it)
    processResearch(research.id, query).catch(err => {
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

async function processResearch(researchId, query) {
  try {
    console.log(`[Research] Processing: "${query}"`);

    // Use Claude to research the company/prospect
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `You are a sales research assistant. Research this company or prospect: "${query}"

Provide a comprehensive sales research brief including:
1. Company overview (if applicable)
2. Industry and market position
3. Key decision makers (if known)
4. Recent news or developments
5. Potential pain points or needs
6. Competitor landscape
7. Best approach for sales outreach

Format your response in clear, actionable sections. Be concise but thorough.

Note: You don't have access to real-time web search, so provide the best analysis you can based on your knowledge. Mention if information might be outdated.`
        }
      ]
    });

    const results = response.content[0].text;

    // Update research with results
    await prisma.research.update({
      where: { id: researchId },
      data: {
        results,
        status: 'completed',
        completedAt: new Date()
      }
    });

    console.log(`[Research] Completed: "${query}"`);
  } catch (error) {
    console.error(`[Research] Failed: "${query}"`, error);

    // Mark as failed
    await prisma.research.update({
      where: { id: researchId },
      data: {
        status: 'failed',
        results: `Research failed: ${error.message}`
      }
    });
  }
}

module.exports = router;
