const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const ttsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many TTS requests, slow down.' }
});

const ALLOWED_VOICE_IDS = new Set([
  'UgBBYS2sOqTuMpoF3BR0', // Mark
  'c6SfcYrb2t09NHXiT80T', // Jarnathan
  'NOpBlnGInO9m6vDvFkFC', // Spuds Oxley
  'Cz0K1kOv9tD8l0b5Qu53', // Jon
  'DMyrgzQFny3JI1Y1paM5', // Donovan
  'gfRt6Z3Z8aTbpLfexQ7N', // Boyd
]);

router.post('/', authenticate, ttsRateLimit, async (req, res) => {
  const { text, voiceId } = req.body;

  if (!text || typeof text !== 'string' || text.length > 200) {
    return res.status(400).json({ error: 'Invalid text' });
  }

  if (!voiceId || !ALLOWED_VOICE_IDS.has(voiceId)) {
    return res.status(400).json({ error: 'Invalid voice ID' });
  }

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0.35,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      console.error('[TTS] ElevenLabs error:', response.status, err);
      return res.status(502).json({ error: 'TTS service error' });
    }

    const audioBuffer = await response.arrayBuffer();
    res.set('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(audioBuffer));

  } catch (error) {
    console.error('[TTS] Error:', error.message);
    res.status(500).json({ error: 'TTS failed' });
  }
});

module.exports = router;
