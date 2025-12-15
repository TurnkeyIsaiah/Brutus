const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ==================== CREATE NOTE ====================

router.post('/', authenticate, async (req, res) => {
  try {
    const { sessionId, content, type, timestamp } = req.body;
    const userId = req.user.id;

    // Create note
    const note = await prisma.note.create({
      data: {
        sessionId,
        userId,
        content,
        type: type || 'manual',
        timestamp: timestamp ? new Date(timestamp) : new Date()
      }
    });

    res.json({ note });
  } catch (error) {
    console.error('Failed to create note:', error);
    res.status(500).json({ error: { message: 'Failed to create note' } });
  }
});

// ==================== GET NOTES ====================

router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.query;

    const where = { userId };
    if (sessionId) {
      where.sessionId = sessionId;
    }

    const notes = await prisma.note.findMany({
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
        timestamp: 'desc'
      }
    });

    res.json({ notes });
  } catch (error) {
    console.error('Failed to get notes:', error);
    res.status(500).json({ error: { message: 'Failed to get notes' } });
  }
});

// ==================== GET NOTES BY SESSION ====================

router.get('/session/:sessionId', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;

    const notes = await prisma.note.findMany({
      where: {
        sessionId,
        userId
      },
      orderBy: {
        timestamp: 'asc'
      }
    });

    res.json({ notes });
  } catch (error) {
    console.error('Failed to get session notes:', error);
    res.status(500).json({ error: { message: 'Failed to get session notes' } });
  }
});

// ==================== DELETE NOTE ====================

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Make sure note belongs to user
    const note = await prisma.note.findFirst({
      where: {
        id,
        userId
      }
    });

    if (!note) {
      return res.status(404).json({ error: { message: 'Note not found' } });
    }

    await prisma.note.delete({
      where: { id }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete note:', error);
    res.status(500).json({ error: { message: 'Failed to delete note' } });
  }
});

module.exports = router;
