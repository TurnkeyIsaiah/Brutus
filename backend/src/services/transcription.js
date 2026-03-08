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
  try {
    // For smaller chunks, we use a simpler approach
    const tempDir = path.join(__dirname, '../../temp');
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const extensions = {
      'audio/webm': 'webm',
      'audio/wav': 'wav',
      'audio/mp3': 'mp3',
      'audio/mpeg': 'mp3'
    };
    
    const ext = extensions[mimeType] || 'webm';
    const tempFilePath = path.join(tempDir, `chunk_${uuidv4()}.${ext}`);
    
    fs.writeFileSync(tempFilePath, audioBuffer);
    
    try {
      const transcription = await getOpenAI().audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
        response_format: 'text'
      });

      // Chunks are ~30 seconds — deduct flat cost
      if (userId) {
        deductFlat(userId, 30 * WHISPER_CENTS_PER_SECOND).catch(console.error);
      }

      return transcription;
      
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
    
  } catch (error) {
    console.error('Chunk transcription error:', error);
    return null;
  }
}

module.exports = {
  transcribeAudio,
  transcribeChunk
};
