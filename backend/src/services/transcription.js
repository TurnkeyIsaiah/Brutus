const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { deductFlat } = require('../lib/tokens');

// Whisper pricing: $0.006/minute = 0.6 cents/minute
const WHISPER_CENTS_PER_SECOND = 0.6 / 60;

let _openai = null;
const getOpenAI = () => {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
};

// ==================== WHISPER VIA NATIVE FETCH ====================
// Uses native fetch directly to avoid node-fetch TLS issues in the OpenAI SDK

async function whisperRequest(filePath, responseFormat = 'text') {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer]), fileName);
  formData.append('model', 'whisper-1');
  formData.append('response_format', responseFormat);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: formData
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`Whisper API error ${res.status}: ${text}`), { status: res.status });
  }

  if (responseFormat === 'text') {
    return res.text();
  }
  return res.json();
}

// ==================== TRANSCRIBE AUDIO FILE ====================

async function transcribeAudio(audioBuffer, mimeType = 'audio/webm', userId = null) {
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const extensions = {
    'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3', 'audio/mp4': 'mp4', 'audio/m4a': 'm4a', 'audio/ogg': 'ogg'
  };
  const ext = extensions[mimeType] || 'webm';
  const tempFilePath = path.join(tempDir, `${uuidv4()}.${ext}`);
  fs.writeFileSync(tempFilePath, audioBuffer);

  try {
    const transcription = await whisperRequest(tempFilePath, 'verbose_json');
    const duration = transcription.duration || 0;
    if (userId && duration > 0) {
      deductFlat(userId, duration * WHISPER_CENTS_PER_SECOND).catch(console.error);
    }
    return {
      text: transcription.text,
      segments: transcription.segments?.map(seg => ({ start: seg.start, end: seg.end, text: seg.text })) || [],
      duration
    };
  } catch (error) {
    console.error('Transcription error:', error);
    throw new Error('Failed to transcribe audio: ' + error.message);
  } finally {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }
}

// ==================== TRANSCRIBE AUDIO CHUNK (for real-time) ====================

async function transcribeChunk(audioBuffer, mimeType = 'audio/webm', userId = null) {
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const extensions = { 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/mp3': 'mp3', 'audio/mpeg': 'mp3' };
  const ext = extensions[mimeType] || 'webm';
  const tempFilePath = path.join(tempDir, `chunk_${uuidv4()}.${ext}`);
  fs.writeFileSync(tempFilePath, audioBuffer);

  const maxAttempts = 3;
  let lastError;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const text = await whisperRequest(tempFilePath, 'text');
        if (userId) {
          deductFlat(userId, 30 * WHISPER_CENTS_PER_SECOND).catch(console.error);
        }
        console.log(`[Transcription] Success on attempt ${attempt}`);
        return text;
      } catch (error) {
        lastError = error;
        const status = error?.status;
        console.error(`[Transcription] Attempt ${attempt}/${maxAttempts} failed — status: ${status ?? 'network'}, message: ${error?.message}`);

        if (status === 401 || status === 403) {
          console.error('[Transcription] Auth error — check OPENAI_API_KEY in Railway variables');
          break;
        }

        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
    }

    console.error('[Transcription] All attempts failed:', lastError?.message);
    return null;
  } finally {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }
}

module.exports = { transcribeAudio, transcribeChunk };
