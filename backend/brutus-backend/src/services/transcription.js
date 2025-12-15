const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ==================== TRANSCRIBE AUDIO FILE ====================

async function transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
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
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment']
      });
      
      return {
        text: transcription.text,
        segments: transcription.segments?.map(seg => ({
          start: seg.start,
          end: seg.end,
          text: seg.text
        })) || [],
        duration: transcription.duration || 0
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

async function transcribeChunk(audioBuffer, mimeType = 'audio/webm') {
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
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
        response_format: 'text'
      });
      
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
