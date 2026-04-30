const prisma = require('./prisma');

const RESEARCH_RETENTION_DAYS = 90;
const TRANSCRIPT_RETENTION_DAYS = 90;
const SESSION_RETENTION_DAYS = 90;
const AUDIT_LOG_RETENTION_DAYS = 365;
const ABANDONED_SESSION_HOURS = 24;

async function runRetentionCleanup() {
  const now = new Date();

  const researchCutoff   = new Date(now - RESEARCH_RETENTION_DAYS   * 24 * 60 * 60 * 1000);
  const transcriptCutoff = new Date(now - TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const sessionCutoff    = new Date(now - SESSION_RETENTION_DAYS    * 24 * 60 * 60 * 1000);
  const auditCutoff      = new Date(now - AUDIT_LOG_RETENTION_DAYS  * 24 * 60 * 60 * 1000);
  const abandonedCutoff  = new Date(now - ABANDONED_SESSION_HOURS   * 60 * 60 * 1000);

  try {
    // Mark sessions that were never ended as cancelled (abandoned mid-call or crashed)
    // so the session cleanup below can collect them after SESSION_RETENTION_DAYS
    const { count: sessionsAbandoned } = await prisma.session.updateMany({
      where: {
        status: 'active',
        startedAt: { lt: abandonedCutoff }
      },
      data: { status: 'cancelled', endedAt: now }
    });

    // Delete research records older than 90 days — prospect names are transient data
    const { count: researchDeleted } = await prisma.research.deleteMany({
      where: { requestedAt: { lt: researchCutoff } }
    });

    // Null out call transcripts older than 90 days — keep metrics, purge conversation content
    const { count: transcriptsCleared } = await prisma.call.updateMany({
      where: {
        createdAt: { lt: transcriptCutoff },
        transcript: { not: '' }
      },
      data: { transcript: '' }
    });

    // Delete completed/cancelled sessions older than 90 days — real-time state, not long-term data
    const { count: sessionsDeleted } = await prisma.session.deleteMany({
      where: {
        status: { in: ['completed', 'cancelled'] },
        endedAt: { lt: sessionCutoff }
      }
    });

    // Delete audit log entries older than 1 year — legal hold period
    const { count: auditDeleted } = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: auditCutoff } }
    });

    console.log(
      `[Retention] sessions abandoned: ${sessionsAbandoned}, research deleted: ${researchDeleted}, ` +
      `transcripts cleared: ${transcriptsCleared}, sessions deleted: ${sessionsDeleted}, ` +
      `audit logs deleted: ${auditDeleted}`
    );
  } catch (err) {
    console.error('[Retention] Cleanup failed:', err.message);
  }
}

module.exports = { runRetentionCleanup };
