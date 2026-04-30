const prisma = require('./prisma');
const { sendDay1Email, sendDay3Email, sendDay7Email } = require('../services/email');

// Hourly cadence: small enough to feel responsive, large enough that retries are cheap.
// Per-run cap keeps us comfortably under Resend's free-tier ceilings (100/day, 3000/mo).
const PER_RUN_CAP = 50;

const DAY_3_MS = 3 * 24 * 60 * 60 * 1000;
const DAY_7_MS = 7 * 24 * 60 * 60 * 1000;

// Process one email send: insert the log row first (idempotent via unique constraint),
// then send. On send failure, mark the row as failed so we don't keep retrying.
async function processSend(user, type, sendFn) {
  // Insert log row first. If a concurrent process (or the verify-email handler for day1)
  // already inserted, P2002 fires and we skip — guaranteed exactly-once per (userId, type).
  let logId;
  try {
    const log = await prisma.emailLog.create({
      data: { userId: user.id, type, status: 'sent' }
    });
    logId = log.id;
  } catch (err) {
    if (err.code === 'P2002') return false; // already sent or in-flight
    throw err;
  }

  try {
    await sendFn(user);
    return true;
  } catch (sendErr) {
    // Send failed — mark the log row so we have a record but don't retry indefinitely.
    await prisma.emailLog.update({
      where: { id: logId },
      data: { status: 'failed', error: (sendErr.message || String(sendErr)).slice(0, 500) }
    }).catch(() => {});
    console.error(`[EmailSequence] ${type} send failed for user ${user.id}:`, sendErr.message);
    return false;
  }
}

async function runEmailSequenceScheduler() {
  try {
    const now = new Date();
    const day3Cutoff = new Date(now.getTime() - DAY_3_MS);
    const day7Cutoff = new Date(now.getTime() - DAY_7_MS);

    // ---- Day 1 candidates: verified users with no day1 log ----
    // Includes both new signups (verify-email handler tries to fire day1 directly,
    // but if that throws or the user verified before this code shipped, we catch them here)
    // and the grandfathered cohort the migration backfilled to verified=true.
    const day1Candidates = await prisma.user.findMany({
      where: {
        emailVerified: true,
        emailLogs: { none: { type: 'day1' } }
      },
      select: { id: true, email: true, name: true },
      take: PER_RUN_CAP
    });

    let day1Sent = 0;
    for (const u of day1Candidates) {
      if (await processSend(u, 'day1', sendDay1Email)) day1Sent++;
    }

    // ---- Day 3 candidates: have day1 log older than 3 days, no day3 log ----
    const day3Candidates = await prisma.user.findMany({
      where: {
        emailVerified: true,
        emailLogs: {
          some: { type: 'day1', sentAt: { lt: day3Cutoff } },
          none: { type: 'day3' }
        }
      },
      select: { id: true, email: true, name: true },
      take: PER_RUN_CAP
    });

    let day3Sent = 0;
    for (const u of day3Candidates) {
      if (await processSend(u, 'day3', sendDay3Email)) day3Sent++;
    }

    // ---- Day 7 candidates: have day1 log older than 7 days, no day7 log ----
    const day7Candidates = await prisma.user.findMany({
      where: {
        emailVerified: true,
        emailLogs: {
          some: { type: 'day1', sentAt: { lt: day7Cutoff } },
          none: { type: 'day7' }
        }
      },
      select: { id: true, email: true, name: true },
      take: PER_RUN_CAP
    });

    let day7Sent = 0;
    for (const u of day7Candidates) {
      if (await processSend(u, 'day7', sendDay7Email)) day7Sent++;
    }

    console.log(`[EmailSequence] day1 sent: ${day1Sent}, day3 sent: ${day3Sent}, day7 sent: ${day7Sent}`);
  } catch (err) {
    console.error('[EmailSequence] Scheduler failed:', err.message);
  }
}

module.exports = { runEmailSequenceScheduler };
