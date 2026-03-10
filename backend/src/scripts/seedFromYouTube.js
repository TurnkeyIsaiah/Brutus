'use strict';

// Load .env from backend root (three levels up from src/scripts/)
require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { PrismaClient } = require('@prisma/client');

// ── Clients ───────────────────────────────────────────────────────────────────
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Paths ─────────────────────────────────────────────────────────────────────
const DATA_DIR       = path.join(__dirname, 'data');
const TMP_DIR        = path.join(__dirname, '../../../tmp');
const AUDIO_DIR      = path.join(TMP_DIR, 'audio');
const TRANSCRIPT_DIR = path.join(TMP_DIR, 'transcripts');
const URLS_FILE      = path.join(DATA_DIR, 'youtube_urls.json');
const PROGRESS_FILE  = path.join(DATA_DIR, 'progress.json');
const SUMMARY_FILE   = path.join(DATA_DIR, 'seeding_summary.json');

// ── Config ────────────────────────────────────────────────────────────────────
const YOUTUBE_API_KEY  = process.env.YOUTUBE_API_KEY;
const MIN_DURATION_SEC = 15 * 60;   // 15 minutes
const TARGET_VIDEOS    = 90;
const DOWNLOAD_BATCH   = 5;
const HAIKU_BATCH      = 20;
const HAIKU_DELAY_MS   = 1000;
const CHUNK_WINDOW_SEC = 30;
const CHUNK_MIN_CHARS  = 100;
const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // 24MB safety margin (Whisper limit is 25MB)

const VALID_MOMENT_TYPES = ['objection', 'pricing', 'discovery', 'closing', 'introduction', 'rapport', 'negotiation', 'other'];

const SEARCH_QUERIES = [
  'sales objection handling real call recording',
  'cold calling live sales call full',
  'NEPQ sales methodology live call',
  'discovery call sales techniques full recording',
  'closing the deal sales call recording',
  'sales negotiation live call full',
  'B2B SaaS cold call live recording',
  'insurance sales call full recording close',
  'sales call objection rejection handling real',
  'high ticket sales call close recording'
];

// ── Cost tracking ─────────────────────────────────────────────────────────────
const costs = { whisperMinutes: 0, haikuInputTokens: 0, haikuOutputTokens: 0, embeddingTokens: 0 };

// ── Startup checks ────────────────────────────────────────────────────────────
function checkDependencies() {
  if (!YOUTUBE_API_KEY) {
    console.error('❌ YOUTUBE_API_KEY not set in .env');
    console.error('   Get a key at https://console.cloud.google.com and enable YouTube Data API v3');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set in .env');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set in .env');
    process.exit(1);
  }
  try {
    execSync('yt-dlp --version', { stdio: 'ignore' });
  } catch {
    console.error('❌ yt-dlp not found on PATH');
    console.error('   Install with: pip install yt-dlp');
    console.error('   Or on Windows: winget install yt-dlp');
    process.exit(1);
  }
}

function ensureDirs() {
  for (const dir of [DATA_DIR, AUDIO_DIR, TRANSCRIPT_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// ── Progress tracking ─────────────────────────────────────────────────────────
function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return { downloaded: [], transcribed: [], processed: [] };
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return { downloaded: [], transcribed: [], processed: [] };
  }
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ── Phase 1: YouTube Search ───────────────────────────────────────────────────
function parseIsoDuration(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

async function youtubeSearchPage(query, pageToken) {
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    videoDuration: 'long', // >20 min — we re-filter at 15 min with contentDetails
    maxResults: 50,
    key: YOUTUBE_API_KEY,
    ...(pageToken ? { pageToken } : {})
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getVideoDetails(videoIds) {
  const params = new URLSearchParams({
    part: 'contentDetails,snippet',
    id: videoIds.join(','),
    key: YOUTUBE_API_KEY
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  if (!res.ok) {
    throw new Error(`Video details failed (${res.status})`);
  }
  return res.json();
}

async function collectVideos() {
  console.log('[Phase 1] Searching YouTube for sales call videos...');
  const seen = new Set();
  const candidates = []; // { videoId, title, channelTitle }

  for (const query of SEARCH_QUERIES) {
    if (candidates.length >= TARGET_VIDEOS * 1.5) break; // over-collect for filtering headroom
    console.log(`  Query: "${query}"`);
    let pageToken = null;
    let pages = 0;

    do {
      try {
        const data = await youtubeSearchPage(query, pageToken);
        for (const item of data.items || []) {
          const vid = item.id?.videoId;
          if (!vid || seen.has(vid)) continue;
          seen.add(vid);
          candidates.push({ videoId: vid, title: item.snippet?.title || '', channelTitle: item.snippet?.channelTitle || '' });
        }
        pageToken = data.nextPageToken || null;
        pages++;
      } catch (err) {
        console.warn(`  Search error for "${query}":`, err.message);
        break;
      }
    } while (pageToken && pages < 2 && candidates.length < TARGET_VIDEOS * 1.5);
  }

  console.log(`  ${candidates.length} candidate videos found. Fetching durations...`);

  // Batch fetch duration details (50 IDs per call)
  const videos = [];
  for (let i = 0; i < candidates.length; i += 50) {
    const batch = candidates.slice(i, i + 50);
    try {
      const data = await getVideoDetails(batch.map(v => v.videoId));
      for (const item of data.items || []) {
        const duration = parseIsoDuration(item.contentDetails?.duration);
        if (duration >= MIN_DURATION_SEC) {
          const candidate = batch.find(v => v.videoId === item.id);
          if (candidate) {
            videos.push({ ...candidate, durationSeconds: duration });
          }
        }
      }
    } catch (err) {
      console.warn('  Duration fetch error:', err.message);
    }
  }

  // Shuffle and trim to target
  const shuffled = videos.sort(() => Math.random() - 0.5).slice(0, TARGET_VIDEOS);
  console.log(`  ${shuffled.length} videos pass duration filter (≥15 min)`);
  return shuffled;
}

// ── Phase 2: Download ─────────────────────────────────────────────────────────
function downloadAudio(video) {
  const outputPath = path.join(AUDIO_DIR, `${video.videoId}.mp3`);
  if (fs.existsSync(outputPath)) return Promise.resolve(outputPath);

  return new Promise((resolve, reject) => {
    const args = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '5',  // 128kbps — good for speech, ~1MB/min
      '--no-playlist',
      '--no-warnings',
      '-o', outputPath,
      `https://www.youtube.com/watch?v=${video.videoId}`
    ];

    const proc = spawn('yt-dlp', args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(`yt-dlp exit ${code}: ${stderr.slice(-300)}`));
      }
    });
    proc.on('error', err => reject(new Error(`yt-dlp spawn failed: ${err.message}`)));

    // 6-minute hard timeout
    setTimeout(() => { proc.kill(); reject(new Error('yt-dlp timeout (6 min)')); }, 360_000);
  });
}

async function downloadBatch(videos, progress) {
  const toDownload = videos.filter(v => !progress.downloaded.includes(v.videoId));
  console.log(`[Phase 2] Downloading ${toDownload.length} videos (${videos.length - toDownload.length} already done)...`);

  for (let i = 0; i < toDownload.length; i += DOWNLOAD_BATCH) {
    const batch = toDownload.slice(i, i + DOWNLOAD_BATCH);
    const results = await Promise.allSettled(
      batch.map(async (video) => {
        await downloadAudio(video);
        progress.downloaded.push(video.videoId);
        saveProgress(progress);
      })
    );
    results.forEach((r, j) => {
      const vid = batch[j].videoId;
      if (r.status === 'fulfilled') {
        console.log(`  ✓ ${vid} (${i + j + 1}/${toDownload.length})`);
      } else {
        console.warn(`  ✗ ${vid} — ${r.reason?.message}`);
      }
    });
  }
}

// ── Phase 3: Transcribe ───────────────────────────────────────────────────────
async function transcribeVideo(videoId) {
  const mp3Path = path.join(AUDIO_DIR, `${videoId}.mp3`);
  const transcriptPath = path.join(TRANSCRIPT_DIR, `${videoId}.json`);

  if (fs.existsSync(transcriptPath)) {
    return JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  }
  if (!fs.existsSync(mp3Path)) throw new Error('MP3 not found — download may have failed');

  // Safety: skip files over 24MB (Whisper limit is 25MB)
  const { size } = fs.statSync(mp3Path);
  if (size > WHISPER_MAX_BYTES) {
    console.warn(`  ⚠ ${videoId} MP3 is ${(size / 1024 / 1024).toFixed(1)}MB — too large for Whisper, skipping`);
    fs.unlinkSync(mp3Path);
    return null;
  }

  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(mp3Path),
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment']
  });

  costs.whisperMinutes += (transcription.duration || 0) / 60;

  const result = {
    videoId,
    duration: transcription.duration || 0,
    segments: (transcription.segments || []).map(s => ({
      start: s.start,
      end: s.end,
      text: s.text.trim()
    }))
  };

  fs.writeFileSync(transcriptPath, JSON.stringify(result, null, 2));
  fs.unlinkSync(mp3Path); // free disk space immediately
  return result;
}

// ── Phase 4: Chunk ────────────────────────────────────────────────────────────
function chunkTranscript(transcript, videoId, videoTitle) {
  const chunks = [];
  let windowStart = 0;

  while (windowStart < transcript.duration) {
    const windowEnd = windowStart + CHUNK_WINDOW_SEC;
    const segs = transcript.segments.filter(s => s.end > windowStart && s.start < windowEnd);
    if (segs.length > 0) {
      const text = segs.map(s => s.text).join(' ').trim();
      if (text.length >= CHUNK_MIN_CHARS) {
        chunks.push({ videoId, videoTitle, startTime: windowStart, endTime: Math.min(windowEnd, transcript.duration), text });
      }
    }
    windowStart = windowEnd;
  }

  return chunks;
}

// ── Phase 5: Haiku Annotation ─────────────────────────────────────────────────
async function annotateChunk(chunk) {
  const resp = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `You are analyzing a sales call transcript chunk for a sales coaching AI.

TRANSCRIPT CHUNK (${chunk.startTime}s-${chunk.endTime}s):
"${chunk.text.replace(/"/g, "'")}"

Respond with ONLY valid JSON, no markdown, no explanation:
{
  "skip": boolean,
  "momentType": "objection"|"pricing"|"discovery"|"closing"|"introduction"|"rapport"|"negotiation"|"other",
  "isPositive": boolean,
  "whatWentWrong": "string or null",
  "whatWentRight": "string or null",
  "idealResponse": "string or null",
  "coachingNote": "string or null"
}

Rules:
- skip=true if: not a real sales call, silence/filler, music, intro/outro, or coaching-irrelevant
- momentType must be exactly one of the 8 listed values
- isPositive=true if the rep handled this well; false if they made a mistake
- whatWentWrong: specific mistake (null if isPositive=true)
- whatWentRight: what was done well (null if isPositive=false)
- idealResponse: exactly what the rep SHOULD have said (required when isPositive=false)
- coachingNote: one sharp Brutus-style insight (required unless skip=true)`
    }]
  });

  costs.haikuInputTokens += resp.usage?.input_tokens || 0;
  costs.haikuOutputTokens += resp.usage?.output_tokens || 0;

  const raw = resp.content[0]?.text?.trim() || '';
  try {
    const parsed = JSON.parse(raw);
    if (!VALID_MOMENT_TYPES.includes(parsed.momentType)) parsed.momentType = 'other';
    return parsed;
  } catch {
    return { skip: true };
  }
}

async function annotateBatched(chunks) {
  const results = [];
  for (let i = 0; i < chunks.length; i += HAIKU_BATCH) {
    const batch = chunks.slice(i, i + HAIKU_BATCH);
    const batchResults = await Promise.allSettled(batch.map(annotateChunk));
    batchResults.forEach((r, j) => {
      results.push({
        chunk: batch[j],
        annotation: r.status === 'fulfilled' ? r.value : { skip: true }
      });
    });
    const done = Math.min(i + HAIKU_BATCH, chunks.length);
    process.stdout.write(`\r  Annotated ${done}/${chunks.length} chunks...`);
    if (done < chunks.length) await new Promise(r => setTimeout(r, HAIKU_DELAY_MS));
  }
  process.stdout.write('\n');
  return results;
}

// ── Phase 6: Embed + Insert ───────────────────────────────────────────────────
async function embedAndInsert(chunk, annotation) {
  const embResp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: chunk.text,
    dimensions: 1536
  });

  costs.embeddingTokens += embResp.usage?.total_tokens || 0;

  const vectorStr = `[${embResp.data[0].embedding.join(',')}]`;
  const id = uuidv4();

  // Raw SQL insert — Prisma doesn't know about the vector column
  await prisma.$executeRaw`
    INSERT INTO training_moments (
      id, video_id, video_title, start_time, end_time,
      transcript_chunk, moment_type, is_positive,
      what_went_wrong, what_went_right, ideal_response, coaching_note,
      embedding, created_at
    ) VALUES (
      ${id}::uuid,
      ${chunk.videoId},
      ${chunk.videoTitle},
      ${chunk.startTime},
      ${chunk.endTime},
      ${chunk.text},
      ${annotation.momentType}::"MomentType",
      ${annotation.isPositive},
      ${annotation.whatWentWrong ?? null},
      ${annotation.whatWentRight ?? null},
      ${annotation.idealResponse ?? null},
      ${annotation.coachingNote ?? null},
      ${vectorStr}::vector,
      NOW()
    )
  `;
}

// ── Per-video processing ──────────────────────────────────────────────────────
async function processVideo(video, progress) {
  const { videoId, title: videoTitle = '' } = video;

  const transcriptPath = path.join(TRANSCRIPT_DIR, `${videoId}.json`);
  if (!fs.existsSync(transcriptPath)) return { videoId, chunks: 0, inserted: 0 };

  const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const chunks = chunkTranscript(transcript, videoId, videoTitle);
  if (chunks.length === 0) {
    progress.processed.push(videoId);
    saveProgress(progress);
    return { videoId, chunks: 0, inserted: 0 };
  }

  console.log(`  Processing ${videoId} — ${chunks.length} chunks`);

  const annotated = await annotateBatched(chunks);
  const toEmbed = annotated.filter(({ annotation }) => !annotation.skip);

  let inserted = 0;
  for (const { chunk, annotation } of toEmbed) {
    try {
      await embedAndInsert(chunk, annotation);
      inserted++;
    } catch (err) {
      console.error(`  Insert failed for chunk in ${videoId}:`, err.message);
    }
  }

  progress.processed.push(videoId);
  saveProgress(progress);
  console.log(`  ✓ ${videoId}: ${inserted}/${toEmbed.length} inserted (${chunks.length - toEmbed.length} skipped as low value)`);

  return { videoId, chunks: chunks.length, annotated: toEmbed.length, inserted };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   BRUTUS RAG SEEDING PIPELINE          ║');
  console.log('╚════════════════════════════════════════╝\n');

  checkDependencies();
  ensureDirs();

  const progress = loadProgress();
  const stats = { videos: 0, downloaded: 0, transcribed: 0, chunks: 0, annotated: 0, inserted: 0, errors: [] };

  // ── Phase 1: Collect video URLs ───────────────────────────────────────────
  let videos;
  if (fs.existsSync(URLS_FILE)) {
    console.log('[Phase 1] Loading cached youtube_urls.json...');
    videos = JSON.parse(fs.readFileSync(URLS_FILE, 'utf8'));
    console.log(`  ${videos.length} videos loaded from cache\n`);
  } else {
    videos = await collectVideos();
    fs.writeFileSync(URLS_FILE, JSON.stringify(videos, null, 2));
    console.log(`  Saved ${videos.length} videos to youtube_urls.json\n`);
  }
  stats.videos = videos.length;

  // ── Phase 2: Download audio ───────────────────────────────────────────────
  await downloadBatch(videos, progress);
  stats.downloaded = progress.downloaded.length;
  console.log(`\n[Phase 2] Complete — ${stats.downloaded}/${stats.videos} downloaded\n`);

  // ── Phase 3: Transcribe ───────────────────────────────────────────────────
  const toTranscribe = videos.filter(v =>
    progress.downloaded.includes(v.videoId) && !progress.transcribed.includes(v.videoId)
  );
  console.log(`[Phase 3] Transcribing ${toTranscribe.length} videos (${progress.transcribed.length} already done)...`);

  for (const video of toTranscribe) {
    try {
      const result = await transcribeVideo(video.videoId);
      if (result) {
        progress.transcribed.push(video.videoId);
        saveProgress(progress);
        stats.transcribed++;
        console.log(`  ✓ ${video.videoId} — ${result.segments.length} segments`);
      }
    } catch (err) {
      console.warn(`  ✗ ${video.videoId} — ${err.message}`);
      stats.errors.push({ phase: 'transcribe', videoId: video.videoId, error: err.message });
    }
  }
  stats.transcribed += progress.transcribed.length - toTranscribe.length; // add already-done count
  console.log(`\n[Phase 3] Complete — ${progress.transcribed.length} transcribed\n`);

  // ── Phases 4-6: Chunk + Annotate + Embed + Insert ─────────────────────────
  const toProcess = videos.filter(v =>
    progress.transcribed.includes(v.videoId) && !progress.processed.includes(v.videoId)
  );
  console.log(`[Phases 4-6] Processing ${toProcess.length} videos (${progress.processed.length} already done)...`);

  for (const video of toProcess) {
    try {
      const result = await processVideo(video, progress);
      stats.chunks += result.chunks;
      stats.annotated += result.annotated || 0;
      stats.inserted += result.inserted;
    } catch (err) {
      console.error(`  Error processing ${video.videoId}:`, err.message);
      stats.errors.push({ phase: 'process', videoId: video.videoId, error: err.message });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const whisperCost   = costs.whisperMinutes * 0.006;
  const haikuCost     = (costs.haikuInputTokens * 0.25 + costs.haikuOutputTokens * 1.25) / 1_000_000;
  const embeddingCost = costs.embeddingTokens * 0.02 / 1_000_000;
  const totalCost     = whisperCost + haikuCost + embeddingCost;

  const summary = {
    completedAt: new Date().toISOString(),
    videosCollected: stats.videos,
    videosDownloaded: stats.downloaded,
    videosTranscribed: progress.transcribed.length,
    chunksGenerated: stats.chunks,
    momentsInserted: stats.inserted,
    momentsSkippedLowValue: stats.annotated - stats.inserted,
    errors: stats.errors,
    estimatedCostUSD: {
      whisper: `$${whisperCost.toFixed(2)}`,
      haiku:   `$${haikuCost.toFixed(2)}`,
      embeddings: `$${embeddingCost.toFixed(3)}`,
      total:   `$${totalCost.toFixed(2)}`
    }
  };

  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   ✅ RAG SEEDING COMPLETE              ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`  Videos collected:  ${summary.videosCollected}`);
  console.log(`  Videos downloaded: ${summary.videosDownloaded}`);
  console.log(`  Videos transcribed:${summary.videosTranscribed}`);
  console.log(`  Chunks generated:  ${summary.chunksGenerated}`);
  console.log(`  Moments inserted:  ${summary.momentsInserted}`);
  console.log(`  Skipped (low val): ${summary.momentsSkippedLowValue}`);
  console.log(`  Errors:            ${summary.errors.length}`);
  console.log(`  Estimated cost:    ${summary.estimatedCostUSD.total}`);
  console.log(`    Whisper:         ${summary.estimatedCostUSD.whisper}`);
  console.log(`    Haiku:           ${summary.estimatedCostUSD.haiku}`);
  console.log(`    Embeddings:      ${summary.estimatedCostUSD.embeddings}`);
  console.log('\n  Verify in Supabase:');
  console.log('  SELECT COUNT(*), moment_type FROM training_moments GROUP BY moment_type;\n');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  await prisma.$disconnect();
  process.exit(1);
});
