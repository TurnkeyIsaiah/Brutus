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

// ==================== TRANSCRIBE AUDIO FILE ====================

async function transcribeAudio(audioBuffer, mimeType = 'audio/webm', userId = null) {
  try {
    // Create a temporary file (Whisper API requires a file)
    const tempDir = path.join(__dirname, '../../temp');
    
    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Determine file extension from mime type
    const extensions = {
      'audio/webm': 'webm',
      'audio/wav': 'wav',
      'audio/mp3': 'mp3',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'mp4',
      'audio/m4a': 'm4a',
      'audio/ogg': 'ogg'
    };
    
    const ext = extensions[mimeType] || 'webm';
    const tempFilePath = path.join(tempDir, `${uuidv4()}.${ext}`);
    
    // Write buffer to temp file
    fs.writeFileSync(tempFilePath, audioBuffer);
    
    try {
      // Transcribe using Whisper
      const transcription = await getOpenAI().audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment']
      });
      
      const duration = transcription.duration || 0;
      if (userId && duration > 0) {
        deductFlat(userId, duration * WHISPER_CENTS_PER_SECOND).catch(console.error);
      }

      return {
        text: transcription.text,
        segments: transcription.segments?.map(seg => ({
          start: seg.start,
          end: seg.end,
          text: seg.text
        })) || [],
        duration
      };
      
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
    
  } catch (error) {
    console.error('Transcription error:', error);
    throw new Error('Failed to transcribe audio: ' + error.message);
  }
}

// ==================== TRANSCRIBE AUDIO CHUNK (for real-time) ====================

async function transcribeChunk(audioBuffer, mimeType = 'audio/webm', userId = null) {
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const extensions = { 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/mp3': 'mp3', 'audio/mpeg': 'mp3' };
  const ext = extensions[mimeType] || 'webm';
  const tempFilePath = path.join(tempDir, `chunk_${uuidv4()}.${ext}`);
  fs.writeFileSync(tempFilePath, audioBuffer);

  const maxAttempts = 3;
  let lastError;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const transcription = await getOpenAI().audio.transcriptions.create({
          file: fs.createReadStream(tempFilePath),
          model: 'whisper-1',
          response_format: 'text'
        });

        if (userId) {
          deductFlat(userId, 30 * WHISPER_CENTS_PER_SECOND).catch(console.error);
        }
        return transcription;

      } catch (error) {
        lastError = error;
        const status = error?.status;
        console.error(`[Transcription] Attempt ${attempt}/${maxAttempts} failed — status: ${status ?? 'network'}, code: ${error?.code ?? error?.cause?.code ?? 'unknown'}, message: ${error?.message}`);

        if (status === 401 || status === 403) {
          console.error('[Transcription] Auth error — check OPENAI_API_KEY in Railway variables');
          break; // No point retrying auth failures
        }

        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
    }

    console.error('[Transcription] All attempts failed:', lastError?.message);
    return null;

  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

module.exports = {
  transcribeAudio,
  transcribeChunk
};
