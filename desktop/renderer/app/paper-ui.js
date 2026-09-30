/* ==========================================================================
   paper-ui.js — Paper design glue layer.
   Part 1: pure template functions merged from the .paper-build lanes
   (home.js, calls.js, calldetail.js, brutus.js, roleplay.js, research.js).
   app.js will be wired to call them in a later step.
   Part 2 (bottom): the small wiring layer the design needs and app.js
   does not provide. No styling, no data fetching, no API calls.
   ========================================================================== */

/* ======================== merged from .paper-build/home.js ======================== */

/* ==========================================================================
   Home dashboard — pure template functions.
   Transcribed from docs/paper-extract/01-home-dashboard.jsx.
   No side effects, no DOM queries, no event listeners.
   ========================================================================== */

/* Escapes text for interpolation into an HTML string. */
function paperEscape(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* Formats the meta line of a recent-call row exactly as the JSX shows it:
   `Today, 2:18 PM · 28 min · talk ratio 43%` (Yesterday / "Sep 21" for
   older calls, which the JSX artboard does not show). */
function paperCallMeta(call) {
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(call.createdAt);
    let when = 'unknown';
    if (!isNaN(d.getTime())) {
        const now = new Date();
        const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
        const dayDiff = Math.round((midnight(now) - midnight(d)) / 86400000);
        const dayLabel = dayDiff === 0 ? 'Today'
            : dayDiff === 1 ? 'Yesterday'
            : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
        let hours = d.getHours();
        const mins = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        when = `${dayLabel}, ${hours}:${mins} ${ampm}`;
    }
    const minutes = Math.round((call.durationSeconds || 0) / 60);
    const ratio = Math.round(parseFloat(call.talkRatio) || 0);
    return `${when} · ${minutes} min · talk ratio ${ratio}%`;
}

/* One row of the Recent calls list — transcribes the JSX 62px row:
   44px score cell (25px/30), name 14px/18 cream, meta 12px/16 #8E837D,
   right-hand outcome pill (follow up / closed / not logged). */
function paperActivityRow(call) {
    const name = call.contactName || call.prospectName || 'Call';
    const score = call.overallScore != null ? call.overallScore : '—';

    // Pill: .p-tag neutral outcome, .p-tag-orange closed, .p-tag-muted unlogged.
    let pillClass = 'p-tag p-tag-muted';
    let pillText = 'not logged';
    if (call.outcome === 'closed') {
        pillClass = 'p-tag p-tag-orange';
        pillText = 'closed';
    } else if (call.outcome) {
        pillClass = 'p-tag';
        pillText = String(call.outcome).replace(/_/g, ' ');
    }

    return `
        <button type="button" class="p-row" data-action="open-call" data-id="${paperEscape(call.id)}">
            <span class="p-row-score p-t-25">${paperEscape(score)}</span>
            <span class="p-row-body">
                <span class="p-t-14 p-c-cream">${paperEscape(name)}</span>
                <span class="p-t-12 p-c-3">${paperEscape(paperCallMeta(call))}</span>
            </span>
            <span class="${pillClass}">${paperEscape(pillText)}</span>
        </button>
    `;
}

/* The Weekly performance columns — transcribes the JSX chart: filled bars
   whose height is the score %, background/label colours escalating with the
   value (#241C19/#8E837D → #291F1C/#A9A09A → #2D211E/#A9A09A →
   #31231F/#D8CEC6 → #3A2723/#D8CEC6), the most recent real bar as
   .p-bar-peak (orange, black label), and a 20%-tall dashed .p-bar-empty
   placeholder for days with no score.
   `points` is an array of numbers, { score } objects, or null per day. */
function paperWeeklyChart(points) {
    const scores = (points || []).map((p) =>
        p != null && typeof p === 'object' ? p.score : p
    );
    let lastRealIdx = -1;
    scores.forEach((s, i) => {
        if (s != null && isFinite(s)) lastRealIdx = i;
    });

    return scores.map((raw, i) => {
        if (raw == null || !isFinite(raw)) {
            return '<div class="p-bar p-bar-empty" style="height:20%" aria-hidden="true"></div>';
        }
        const s = Math.round(raw);
        if (i === lastRealIdx) {
            return `<div class="p-bar p-bar-peak" style="height:${s}%">${s}</div>`;
        }
        // Threshold escalation reproducing the JSX bars 68/70/73/76/82.
        const bg = s >= 80 ? '#3A2723'
            : s >= 75 ? '#31231F'
            : s >= 72 ? '#2D211E'
            : s >= 70 ? '#291F1C'
            : '#241C19';
        const label = s >= 75 ? '#D8CEC6'
            : s >= 70 ? '#A9A09A'
            : '#8E837D';
        return `<div class="p-bar" style="height:${s}%;background-color:${bg};color:${label}">${s}</div>`;
    }).join('');
}

/* ======================== merged from .paper-build/calls.js ======================== */

/* =========================================================================
 * calls.js — pure template functions for the Calls library.
 * Transcribed from docs/paper-extract/02-calls-library.jsx (78px rows, day
 * dividers, outcome pills); divider grouping labels confirmed against
 * 14-calls-page-2.jsx ("SEPTEMBER 16 · 5 CALLS").
 *
 * Pure templates only: no DOM queries, no event listeners, no IIFE.
 * Depends on the global esc() HTML-escaping helper provided by app.js.
 *
 * Expected call shape:
 *   {
 *     id, score, name,
 *     time: '2:18 PM', durationMin: 28, interruptions: 2, tags: ['pricing'],
 *     talkRatio: 43,
 *     outcome: 'closed' | 'lost' | 'follow_up' | 'no_show' | null,
 *     dayLabel: 'TODAY' | 'YESTERDAY' | 'SEPTEMBER 16' | …
 *   }
 * ========================================================================= */

/* Outcome pill per 02-calls-library.jsx:
 *   follow up  -> neutral pill (#4A3A35 border, cream text)
 *   closed     -> orange-tinted pill (#2A1714 bg, #623B34 border, #FF8A78)
 *   lost       -> muted pill (#3A302C border, #8E837D text)
 *   not logged -> muted pill (same treatment as lost in the JSX)
 * no_show does not appear in 02; it takes the muted treatment the JSX gives
 * the other terminal outcome (lost). */
function paperCallOutcomePill(outcome) {
  if (outcome === 'closed') return '<span class="p-outcome p-outcome-closed">closed</span>';
  if (outcome === 'follow_up') return '<span class="p-outcome">follow up</span>';
  if (outcome === 'lost') return '<span class="p-outcome p-outcome-none">lost</span>';
  if (outcome === 'no_show') return '<span class="p-outcome p-outcome-none">no show</span>';
  return '<span class="p-outcome p-outcome-none">not logged</span>';
}

/* One 78px table row (02 lines 167–195).
 * Columns: 74px score cell (42px box, 25px/30 number) / flexible call cell
 * (name 15px/18 cream + meta 12px/16 #8E837D) / 122px talk cell (14px/18,
 * orange at >= 50% — 51% and 56% are orange in the JSX, 38–43% cream) /
 * 130px outcome cell / 28px › chevron.
 * Meta line mirrors the JSX shape:
 *   "2:18 PM · 28 min · 2 interruptions · pricing, discovery"
 * ("1 interruption" is singular in the JSX — Andre's row). */
function paperCallRow(call) {
  const metaParts = [];
  if (call.time) metaParts.push(esc(call.time));
  if (call.durationMin != null) metaParts.push(`${esc(String(call.durationMin))} min`);
  if (call.interruptions != null) {
    metaParts.push(`${esc(String(call.interruptions))} interruption${call.interruptions === 1 ? '' : 's'}`);
  }
  if (call.tags && call.tags.length) metaParts.push(call.tags.map((t) => esc(t)).join(', '));

  const talk = Math.round(call.talkRatio || 0);
  const talkCls = talk >= 50 ? ' p-talk-high' : '';

  return `
    <div class="p-trow" data-action="open-call" data-id="${esc(String(call.id))}"
         role="button" tabindex="0"
         aria-label="Open call${call.name ? ': ' + esc(call.name) : ''}">
      <div class="p-col-score"><div class="p-trow-score">${esc(String(call.score ?? ''))}</div></div>
      <div class="p-col-call">
        <div class="p-t-15 p-c-cream">${esc(call.name || '')}</div>
        <div class="p-t-12 p-c-3">${metaParts.join(' · ')}</div>
      </div>
      <div class="p-col-talk${talkCls}">${talk}%</div>
      <div class="p-col-outcome">${paperCallOutcomePill(call.outcome)}</div>
      <div class="p-col-chev" aria-hidden="true">›</div>
    </div>`;
}

/* Day separator (02 lines 163–165 and 226–230).
 * Today: "TODAY · 2 CALLS" in #FF8A78, 28px tall, centred, no top border.
 * Older: "YESTERDAY · 3 CALLS" in #A9A09A, top hairline, bottom-aligned with
 * 4px bottom padding. Both classes live in paper.css. */
function paperCallDayDivider(label, isToday) {
  return `<div class="p-day-divider${isToday ? ' p-day-divider-today' : ''}">${esc(label)}</div>`;
}

/* Groups consecutive calls by dayLabel and interleaves dividers and rows.
 * Divider copy per the JSX: "<LABEL> · <N> CALLS" (singular "CALL" for one —
 * the JSX only shows plural counts). isToday when the label is TODAY. */
function paperCallsList(calls) {
  const groups = [];
  for (const call of calls) {
    const label = call.dayLabel || '';
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.calls.push(call);
    } else {
      groups.push({ label, calls: [call] });
    }
  }
  return groups
    .map((g) => {
      const divider = g.label
        ? paperCallDayDivider(
            `${g.label} · ${g.calls.length} CALL${g.calls.length === 1 ? '' : 'S'}`,
            g.label === 'TODAY'
          )
        : '';
      return divider + g.calls.map(paperCallRow).join('');
    })
    .join('');
}

/* ======================== merged from .paper-build/calldetail.js ======================== */

/* =========================================================================
 * calldetail.js — pure template functions for the call-detail screen.
 *
 * Sources:
 *   paperCallOverview .... docs/paper-extract/03-call-overview.jsx
 *   paperCallCoaching .... docs/paper-extract/04-call-coaching.jsx
 *   paperCallTranscript .. docs/paper-extract/05-call-transcript.jsx
 *   paperCallNotes ....... docs/paper-extract/06-call-notes.jsx
 *   paperCallRecording ... docs/paper-extract/07-call-recording.jsx
 *
 * Pure templates only: no DOM queries, no event listeners, no IIFE.
 * Depends on the global esc() HTML-escaping helper provided by app.js.
 *
 * Expected call shape (app.js fields plus optional extensions; sections
 * whose data is absent render their chrome without rows):
 *   {
 *     id, name, overallScore, talkRatio (0–100), interruptions,
 *     durationSeconds, tags: [],
 *     outcome: 'closed'|'lost'|'follow_up'|'no_show'|null,
 *     brutusFeedback: {
 *       overallRoast,
 *       actionItems: [],
 *       feedback: [{ type: 'critical'|'warning'|'insight'|'good', text,
 *                    quote?, time?, category? }]
 *     },
 *     feedbackRatings: { [index]: 'up'|'down' },
 *     pattern?: { title, detail },
 *     nextCall?: { headline, detail },
 *     transcript?: [{ speaker: 'rep'|'prospect', text, time?, hotText?,
 *                     flag? }],
 *     transcriptQuery?: { query, matches: [{ speaker, text }] },
 *     notes?: [{ source: 'ai'|'manual', time, text }],
 *     aiSummary?, keyFollowUp?,
 *     recording?: { when: 'Today, 2:18 PM',
 *                   meta: '28:04 | uploaded call | pricing',
 *                   position: '10:42', duration: '28:04', progressPct: 38 }
 *   }
 * ========================================================================= */

/* Feedback kind map. Colours per 03 (reads) and 04 (timeline):
 * CRITICAL #FF8A78, WARNING #C9A989, INSIGHT #A9A09A, GOOD #D8CEC6.
 * 04 folds kinds into NEEDS WORK / GOOD READ timeline labels. */
const PAPER_CD_KINDS = {
  critical: { read: 'CRITICAL', moment: 'NEEDS WORK', cls: 'p-kind-critical' },
  warning: { read: 'WARNING', moment: 'NEEDS WORK', cls: 'p-kind-warning' },
  insight: { read: 'INSIGHT', moment: 'GOOD READ', cls: 'p-kind-insight' },
  good: { read: 'GOOD', moment: 'GOOD READ', cls: 'p-kind-good' }
};

const PAPER_CD_OUTCOMES = [
  { value: 'closed', label: 'Closed' },
  { value: 'lost', label: 'Lost' },
  { value: 'follow_up', label: 'Follow up' },
  { value: 'no_show', label: 'No show' }
];

const PAPER_CD_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/* Normalized facts shared by the panels. */
function paperCdFacts(call) {
  const raw = call.brutusFeedback;
  const full = raw && !Array.isArray(raw) && raw.feedback;
  const feedback = full ? raw.feedback || [] : Array.isArray(raw) ? raw : [];
  return {
    id: call.id,
    name: call.name || '',
    score: call.overallScore ?? '',
    talk: Math.round(call.talkRatio || 0),
    interruptions: call.interruptions,
    mins: Math.floor((call.durationSeconds || 0) / 60),
    tags: call.tags || [],
    outcome: call.outcome || null,
    verdict: full ? raw.overallRoast || '' : '',
    actionItems: full ? raw.actionItems || [] : [],
    feedback,
    ratings:
      call.feedbackRatings && typeof call.feedbackRatings === 'object'
        ? call.feedbackRatings
        : {}
  };
}

function paperCdKind(type) {
  return PAPER_CD_KINDS[type] || PAPER_CD_KINDS.insight;
}

/* "Helpful?  Yes  No" rating row (03 right rail). Keeps the app.js
 * delegation contract: .rating-btn + data-action="rate-feedback",
 * data-call-id, data-index, data-rating, wrapped in .rating-btns. */
function paperCdRatingRow(callId, index, rating) {
  return `
    <div class="p-cd-helpful">
      <span class="p-cd-helpful-label">Helpful?</span>
      <span class="rating-btns">
        <button type="button" class="rating-btn${rating === 'up' ? ' active' : ''}"
          data-action="rate-feedback" data-call-id="${esc(String(callId))}"
          data-index="${Number(index)}" data-rating="up">Yes</button>
        <button type="button" class="rating-btn${rating === 'down' ? ' active' : ''}"
          data-action="rate-feedback" data-call-id="${esc(String(callId))}"
          data-index="${Number(index)}" data-rating="down">No</button>
      </span>
    </div>`;
}

/* Left rail from 03 (also used by 04/05 with modifier classes): kicker,
 * optional score/metrics/tags block, note, "Show call recording". */
function paperCdShowRecBtn() {
  return '<button type="button" class="p-cd-showrec" data-action="show-recording">Show call recording</button>';
}

/* ------------------------------------------------------------------------
 * Overview tab — 03-call-overview.jsx
 * (244px left rail, verdict column, coaching-reads right rail, footer bar)
 * ---------------------------------------------------------------------- */
function paperCallOverview(call) {
  const f = paperCdFacts(call);

  const tags = f.tags.map((t) => `<span class="p-cd-tag">${esc(t)}</span>`).join('');

  const actionItems = f.actionItems
    .map(
      (a, i) => `
        <div class="p-ov-item">
          <div class="p-ov-numeral">${PAPER_CD_ROMAN[i] || i + 1}</div>
          <div class="p-ov-item-text">${esc(a)}</div>
        </div>`
    )
    .join('');

  const outcomeBtns = PAPER_CD_OUTCOMES.map(
    (o) => `
      <button type="button" class="outcome-btn${f.outcome === o.value ? ' ' + o.value : ''}"
        id="outcome-btn-${o.value}"
        data-action="set-outcome" data-call-id="${esc(String(f.id))}" data-outcome="${o.value}">${o.label}</button>`
  ).join('');

  /* Top coaching reads: the JSX shows the Helpful? row on the critical and
   * warning reads but not on the insight read. */
  const reads = f.feedback
    .map((item, i) => {
      const kind = paperCdKind(item.type);
      const rating = f.ratings[i];
      const helpful =
        item.type === 'critical' || item.type === 'warning'
          ? paperCdRatingRow(f.id, i, rating)
          : '';
      return `
        <div class="p-cd-read">
          <div class="p-cd-read-kicker ${kind.cls}">${kind.read}</div>
          <div class="p-cd-read-text">${esc(item.text || '')}</div>
          ${helpful}
        </div>`;
    })
    .join('');

  return `
    <div class="p-cd-cols">
      <div class="p-cd-rail">
        <div class="p-cd-kicker">CALL CONTEXT</div>
        <div class="p-cd-scoreblock">
          <div class="p-cd-score">${esc(String(f.score))}</div>
          <div class="p-cd-score-sub">Overall score</div>
        </div>
        <div class="p-rule"></div>
        <div class="p-cd-metrics">
          <div class="p-cd-metric"><span class="p-cd-metric-k">Talk ratio</span><span class="p-cd-metric-v">${f.talk}%</span></div>
          <div class="p-cd-metric"><span class="p-cd-metric-k">Interruptions</span><span class="p-cd-metric-v">${f.interruptions != null ? esc(String(f.interruptions)) : ''}</span></div>
          <div class="p-cd-metric"><span class="p-cd-metric-k">Duration</span><span class="p-cd-metric-v">${f.mins} min</span></div>
        </div>
        <div class="p-rule"></div>
        <div class="p-cd-tagwrap">${tags}</div>
        <div class="p-spacer"></div>
        <div class="p-cd-rail-note">Recording opens in the shared player for this call.</div>
        ${paperCdShowRecBtn()}
      </div>
      <div class="p-cd-main">
        <div class="p-cd-kicker p-cd-kicker--orange">BRUTUS VERDICT</div>
        <div class="p-ov-verdict">${esc(f.verdict)}</div>
        <div class="p-rule"></div>
        <div class="p-cd-h17">Action items for the next call</div>
        <div class="p-ov-items">${actionItems}</div>
        <div class="p-rule"></div>
        <div class="p-cd-h17">How did it go?</div>
        <div class="outcome-btns">${outcomeBtns}</div>
      </div>
      <div class="p-cd-right">
        <div class="p-cd-h17">Top coaching reads</div>
        ${reads}
      </div>
    </div>
    <div class="p-cd-footbar">
      <div class="p-cd-foot-score">${esc(String(f.score))} / 100</div>
      <div class="p-cd-foot-item">${f.mins} min</div>
      <div class="p-cd-foot-item">${f.talk}% talk ratio</div>
      <div class="p-cd-foot-item">${f.interruptions != null ? esc(String(f.interruptions)) + ' interruptions' : ''}</div>
      <div class="p-spacer"></div>
      <div class="p-cd-foot-item">Recording available in shared player</div>
    </div>`;
}

/* ------------------------------------------------------------------------
 * Coaching tab — 04-call-coaching.jsx
 * (246px key-moments rail, moment timeline, NEXT CALL right rail).
 * The JSX timeline carries no rating UI; the Helpful? row from 03 is added
 * to each moment to keep the rate-feedback delegation contract available
 * on this tab.
 * ---------------------------------------------------------------------- */
function paperCallCoaching(call) {
  const f = paperCdFacts(call);

  const needsWork = f.feedback.filter((x) => paperCdKind(x.type).moment === 'NEEDS WORK').length;
  const goodReads = f.feedback.length - needsWork;

  const pattern = call.pattern
    ? `
      <div class="p-co-pattern-label">Pattern this call</div>
      <div class="p-co-pattern">${esc(call.pattern.title || '')}</div>
      <div class="p-co-pattern-sub">${esc(call.pattern.detail || '')}</div>`
    : '';

  const moments = f.feedback
    .map((item, i) => {
      const kind = paperCdKind(item.type);
      const kicker = `${kind.moment}${item.category ? ' · ' + esc(String(item.category).toUpperCase()) : ''}`;
      const quote = item.quote ? `<div class="p-co-quote">\u201C${esc(item.quote)}\u201D</div>` : '';
      const bucket = kind.moment === 'NEEDS WORK' ? 'needs' : 'good';
      return `
        <div class="p-co-moment" data-moment="${bucket}" role="button" tabindex="0">
          <div class="p-co-time ${kind.cls}">${item.time ? esc(item.time) : ''}</div>
          <div class="p-co-moment-body">
            <div class="p-co-kicker ${kind.cls}">${kicker}</div>
            ${quote}
            <div class="p-co-note">${esc(item.text || '')}</div>
            ${paperCdRatingRow(f.id, i, f.ratings[i])}
          </div>
        </div>`;
    })
    .join('');

  const nextCall = call.nextCall
    ? `
      <div class="p-co-next-title">${esc(call.nextCall.headline || '')}</div>
      <div class="p-co-next-sub">${esc(call.nextCall.detail || '')}</div>`
    : '';

  const plan = f.actionItems
    .map(
      (a, i) => `
        <div class="p-co-plan-item">
          <div class="p-co-plan-numeral">${PAPER_CD_ROMAN[i] || i + 1}.</div>
          <div class="p-co-plan-text">${esc(a)}</div>
        </div>`
    )
    .join('');

  return `
    <div class="p-cd-cols">
      <div class="p-cd-rail p-cd-rail--coaching">
        <div class="p-cd-kicker">KEY MOMENTS</div>
        <button type="button" class="p-co-filter active" data-moments="all">All moments · ${f.feedback.length}</button>
        <button type="button" class="p-co-filter" data-moments="needs">Needs work · ${needsWork}</button>
        <button type="button" class="p-co-filter" data-moments="good">Good reads · ${goodReads}</button>
        <div class="p-rule"></div>
        ${pattern}
        <div class="p-spacer"></div>
        <div class="p-cd-rail-note">Moment labels come from saved badMoments and goodMoments analysis.</div>
        ${paperCdShowRecBtn()}
      </div>
      <div class="p-cd-main p-cd-main--coaching">
        <div class="p-co-head">
          <div class="p-co-head-title">Moment timeline</div>
          <div class="p-co-head-count">${f.feedback.length} moments</div>
        </div>
        ${moments}
      </div>
      <div class="p-cd-right p-cd-right--coaching">
        <div class="p-cd-kicker p-cd-kicker--orange">NEXT CALL</div>
        ${nextCall}
        <div class="p-rule"></div>
        <div class="p-co-plan-title">Action plan</div>
        ${plan}
        <div class="p-spacer"></div>
        <button type="button" class="p-co-practice" data-action="practice-roleplay">Practice this in roleplay</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------------
 * Transcript tab — 05-call-transcript.jsx
 * (236px speakers rail, turn list, search-results right rail)
 *
 * Playback offsets come only from data already on the turn or the call:
 * time / start / startMs / timestamp, a clock prefix in the transcript
 * text, Whisper-style segments or words, or a call moment whose chunk
 * equals that turn. Missing timing stays missing.
 * ---------------------------------------------------------------------- */
const PAPER_CLOCK_RE = /^(?:\[|\()?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d+))?(?:\]|\))?$/;
const PAPER_STAMP_TOKEN = '\\[(?:\\d{1,2}:)?\\d{1,2}:\\d{2}(?:\\.\\d+)?\\]|\\((?:\\d{1,2}:)?\\d{1,2}:\\d{2}(?:\\.\\d+)?\\)|(?:\\d{1,2}:)?\\d{1,2}:\\d{2}(?:\\.\\d+)?';

function paperOffsetFromValue(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null;
  const match = PAPER_CLOCK_RE.exec(trimmed);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  const fraction = match[4] ? Number('0.' + match[4]) : 0;
  return hours * 3600 + minutes * 60 + seconds + fraction;
}

function paperTurnOffsetSeconds(turn) {
  if (!turn || typeof turn !== 'object') return null;
  if (typeof turn.startMs === 'number' && Number.isFinite(turn.startMs) && turn.startMs >= 0) {
    return turn.startMs / 1000;
  }
  if (typeof turn.offsetSec === 'number' && Number.isFinite(turn.offsetSec) && turn.offsetSec >= 0) {
    return turn.offsetSec;
  }
  const keys = ['start', 'time', 'timestamp'];
  for (let i = 0; i < keys.length; i++) {
    const offset = paperOffsetFromValue(turn[keys[i]]);
    if (offset != null) return offset;
  }
  return null;
}

function paperFormatOffset(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (hours) return hours + ':' + pad(minutes) + ':' + pad(secs);
  return minutes + ':' + pad(secs);
}

function paperLeadingStamp(text) {
  const match = new RegExp('^(' + PAPER_STAMP_TOKEN + ')\\s+([\\s\\S]+)$').exec(text);
  if (!match) return null;
  const offset = paperOffsetFromValue(match[1]);
  if (offset == null) return null;
  return { offset: offset, text: match[2] };
}

function paperTimingList(call, key) {
  const raw = call && call.transcript;
  const lists = [call && call[key], raw && typeof raw === 'object' ? raw[key] : null];
  for (let i = 0; i < lists.length; i++) {
    if (Array.isArray(lists[i])) return lists[i];
  }
  return [];
}

function paperNormText(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function paperResolveSeconds(call, turn, segments, usedSeg, words, wordCursor, moments, usedMoments) {
  const direct = paperTurnOffsetSeconds(turn);
  if (direct != null) return direct;
  const wanted = paperNormText(turn && turn.text);
  if (!wanted) return null;
  for (let i = 0; i < segments.length; i++) {
    if (usedSeg.has(i)) continue;
    const seg = segments[i];
    if (!seg || paperNormText(seg.text) !== wanted) continue;
    const offset = typeof seg.startMs === 'number' ? seg.startMs / 1000 : paperOffsetFromValue(seg.start);
    if (offset == null) continue;
    usedSeg.add(i);
    return offset;
  }
  if (words.length && wordCursor.index < words.length) {
    const tokens = wanted.split(' ');
    if (wordCursor.index + tokens.length <= words.length) {
      let aligned = true;
      for (let i = 0; i < tokens.length; i++) {
        const word = words[wordCursor.index + i];
        const token = paperNormText(word && (word.word || word.text));
        if (token !== tokens[i]) {
          aligned = false;
          break;
        }
      }
      if (aligned) {
        const first = words[wordCursor.index];
        const offset = typeof first.startMs === 'number' ? first.startMs / 1000 : paperOffsetFromValue(first.start);
        if (offset != null) {
          wordCursor.index += tokens.length;
          return offset;
        }
      }
    }
  }
  for (let i = 0; i < moments.length; i++) {
    if (usedMoments.has(i)) continue;
    const moment = moments[i];
    if (!moment || paperNormText(moment.transcriptChunk) !== wanted) continue;
    const offset = paperOffsetFromValue(moment.timestampInCall);
    if (offset == null) continue;
    usedMoments.add(i);
    return offset;
  }
  return null;
}

function paperAnnotateTurns(call, turns) {
  const segments = paperTimingList(call, 'segments');
  const words = paperTimingList(call, 'words');
  const moments = Array.isArray(call && call.moments) ? call.moments : [];
  const usedSeg = new Set();
  const usedMoments = new Set();
  const wordCursor = { index: 0 };
  return turns.map((turn) => ({
    turn: turn,
    seconds: paperResolveSeconds(call, turn, segments, usedSeg, words, wordCursor, moments, usedMoments)
  }));
}

function paperTranscriptTurns(call) {
  const raw = call && call.transcript;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.turns)) return raw.turns;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const parsed = [];
  let labeledCount = 0;
  const speakerRe = new RegExp(
    '^(rep|prospect|you|them|agent|customer)(?:\\s+(' + PAPER_STAMP_TOKEN + '))?\\s*[:\\-]\\s*([\\s\\S]*)$',
    'i'
  );
  raw.split(/\n+/).forEach((line) => {
    const text = line.trim();
    if (!text) return;
    const stamped = paperLeadingStamp(text);
    const body = stamped ? stamped.text : text;
    const labeled = speakerRe.exec(body);
    if (!labeled) return;
    labeledCount += 1;
    const speaker = /rep|you|agent/i.test(labeled[1]) ? 'rep' : 'prospect';
    const inline = paperOffsetFromValue(labeled[2]);
    const uttered = paperLeadingStamp(labeled[3].trim());
    const turn = { speaker: speaker, text: uttered ? uttered.text : labeled[3] };
    const offset = stamped ? stamped.offset : inline != null ? inline : uttered ? uttered.offset : null;
    if (offset != null) turn.offsetSec = offset;
    parsed.push(turn);
  });
  if (labeledCount) return parsed;
  const whole = paperLeadingStamp(raw.trim());
  if (whole) return [{ speaker: 'rep', text: whole.text, offsetSec: whole.offset }];
  return [{ speaker: 'rep', text: raw.trim() }];
}

function paperCallTranscript(call) {
  const f = paperCdFacts(call);
  const turns = paperAnnotateTurns(call, paperTranscriptTurns(call));

  const turnRows = turns
    .map((row) => {
      const t = row.turn;
      const isRep = t.speaker === 'rep';
      const jump = row.seconds == null
        ? ''
        : `<button type="button" class="p-ts-jump" data-seek-sec="${row.seconds}">${esc(paperFormatOffset(row.seconds))}</button>`;
      return `
        <div class="p-ts-turn p-ts-turn--${isRep ? 'rep' : 'prospect'}${t.flag ? ' p-ts-turn--flag' : ''}" data-speaker="${isRep ? 'rep' : 'prospect'}">
          <div class="p-ts-label"><span>${isRep ? 'REP' : 'PROSPECT'}</span>${jump}</div>
          <div class="p-ts-text">${esc(t.text || '')}</div>
        </div>`;
    })
    .join('');

  const q = call.transcriptQuery;
  const queryLine = q
    ? `<div class="p-ts-query">Query: \u201C${esc(q.query || '')}\u201D · ${(q.matches || []).length} matches</div>`
    : '';
  const matches = q
    ? (q.matches || [])
        .map((m, i) => {
          const isRep = m.speaker === 'rep';
          return `
            <div class="p-ts-match p-ts-match--${isRep ? 'rep' : 'prospect'}">
              <div class="p-ts-match-label">${isRep ? 'REP' : 'PROSPECT'} · MATCH ${i + 1}</div>
              <div class="p-ts-match-text">\u201C${esc(m.text || '')}\u201D</div>
            </div>`;
        })
        .join('')
    : '';

  return `
    <div class="p-cd-cols">
      <div class="p-cd-rail p-cd-rail--transcript">
        <div class="p-cd-kicker">SPEAKERS</div>
        <button type="button" class="p-ts-speaker active" data-speaker="all">
          <span class="p-ts-dot"></span>
          <span class="p-ts-speaker-name">All speakers</span>
          <span class="p-ts-speaker-count">${turns.length}</span>
        </button>
        <button type="button" class="p-ts-speaker" data-speaker="rep">
          <span class="p-ts-dot"></span>
          <span class="p-ts-speaker-name">Rep</span>
          <span class="p-ts-speaker-count">${f.talk}%</span>
        </button>
        <button type="button" class="p-ts-speaker" data-speaker="prospect">
          <span class="p-ts-dot"></span>
          <span class="p-ts-speaker-name">Prospect</span>
          <span class="p-ts-speaker-count">${100 - f.talk}%</span>
        </button>
        <div class="p-rule"></div>
        <div class="p-ts-rail-note">Uploaded calls can be unlabeled. Brutus does not invent speaker names when the source is ambiguous.</div>
        <div class="p-ts-rail-end">${paperCdShowRecBtn()}</div>
      </div>
      <div class="p-cd-main p-cd-main--transcript">
        <div class="p-ts-head">
          <div class="p-cd-h17">${turns.length} transcript turns</div>
          <div class="p-ts-head-note">Exact transcript text</div>
        </div>
        ${turnRows}
      </div>
      <div class="p-cd-right p-cd-right--transcript">
        <div class="p-ts-speaker-detail" hidden></div>
        <div class="p-cd-h17">Search results</div>
        ${queryLine}
        ${matches}
        <div class="p-spacer"></div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------------
 * Notes tab — 06-call-notes.jsx (alpha-cream token generation)
 * (244px context rail, notes column, AI-summary right column)
 * ---------------------------------------------------------------------- */
function paperNoteSource(note) {
  if (note.source === 'ai' || note.type === 'ai' || note.type === 'ai-generated') return 'ai';
  if (note.source === 'manual' || note.type === 'manual') return 'manual';
  return '';
}

function paperNoteTime(note) {
  if (note.time) return String(note.time);
  if (!note.timestamp) return '';
  const parsed = new Date(note.timestamp);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function paperCallNotes(call) {
  const f = paperCdFacts(call);
  const rawFeedback = call.brutusFeedback;
  const fullFeedback = rawFeedback && !Array.isArray(rawFeedback) ? rawFeedback : null;
  const notes = (Array.isArray(call.notes) ? call.notes : [])
    .map((n) => ({
      source: paperNoteSource(n),
      time: paperNoteTime(n),
      text: n.text || n.content || ''
    }))
    .filter((n) => n.text);
  const aiCount = notes.filter((n) => n.source === 'ai').length;
  const actionItems = Array.isArray(call.keyFollowUp)
    ? call.keyFollowUp
    : Array.isArray(fullFeedback && fullFeedback.actionItems)
      ? fullFeedback.actionItems
      : [];
  const keyFollowUp = typeof call.keyFollowUp === 'string'
    ? call.keyFollowUp
    : actionItems.filter((item) => typeof item === 'string' && item.trim()).join(' | ');
  const aiSummary = call.aiSummary || call.summary
    || (fullFeedback && typeof fullFeedback.overallRoast === 'string' ? fullFeedback.overallRoast : '')
    || '';

  const tags = f.tags.map((t) => `<span class="p-nt-tagpill">${esc(t)}</span>`).join('');

  const noteRows = notes
    .map((n) => {
      const label = [n.source === 'ai' ? 'AI' : n.source === 'manual' ? 'MANUAL' : '', n.time]
        .filter(Boolean)
        .join(' | ');
      const tag = label
        ? `<div class="p-nt-tag p-nt-tag--${n.source === 'ai' ? 'ai' : 'manual'}">${esc(label)}</div>`
        : '';
      return `
        <div class="p-nt-row">
          ${tag}
          <div class="p-nt-text">${esc(n.text)}</div>
        </div>`;
    })
    .join('');

  return `
    <div class="p-cd-cols">
      <div class="p-cd-rail p-cd-rail--notes">
        <div class="p-cd-kicker">CALL CONTEXT</div>
        <div class="p-nt-score">${esc(String(f.score))}</div>
        <div class="p-nt-score-sub">Overall score</div>
        <div class="p-rule"></div>
        <div class="p-nt-metric"><span>Talk ratio</span><span>${f.talk}%</span></div>
        <div class="p-nt-metric"><span>Interruptions</span><span>${f.interruptions != null ? esc(String(f.interruptions)) : ''}</span></div>
        <div class="p-nt-metric"><span>Duration</span><span>${f.mins} min</span></div>
        <div class="p-nt-tagwrap">${tags}</div>
        <div class="p-spacer"></div>
        <div class="p-nt-railnote">${esc(f.name)}'s recording opens in the shared player for this call.</div>
        ${paperCdShowRecBtn()}
      </div>
      <div class="p-nt-main">
        <div class="p-nt-head">
          <div class="p-nt-title">${esc(f.name)}'s notes</div>
          <button type="button" class="p-nt-showts" data-calltab-link="transcript">Show transcript</button>
        </div>
        <div class="p-nt-counts">${notes.length} notes | ${aiCount} AI | chronological</div>
        <div class="p-nt-rule"></div>
        ${noteRows}
      </div>
      <div class="p-cd-right p-cd-right--notes">
        <div class="p-nt-sumhead">
          <div class="p-nt-sumtitle">AI summary</div>
          ${aiSummary ? '<div class="p-nt-ready">READY</div>' : ''}
        </div>
        <div class="p-nt-summary">${esc(aiSummary)}</div>
        <div class="p-nt-rule"></div>
        <div class="p-nt-kf-title">Key follow-up</div>
        <div class="p-nt-kf">${esc(keyFollowUp)}</div>
        <div class="p-spacer"></div>
        <div class="p-nt-note">Summary is generated once, persisted on ${esc(f.name)}'s call, and reused without another token charge.</div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------------
 * Recording / player block — 07-call-recording.jsx
 * The 74-bar waveform reproduces the JSX sequence exactly: heights run
 * 16 + ((7 * (i + 1)) % 52) px and every 9th bar (i % 9 === 8) is #FF6550.
 * ---------------------------------------------------------------------- */
function paperCallRecording(call) {
  const f = paperCdFacts(call);
  const rec = call.recording || {};
  const turns = paperTranscriptTurns(call);

  let bars = '';
  for (let i = 0; i < 74; i++) {
    const h = 16 + ((7 * (i + 1)) % 52);
    bars += `<div class="p-rec-bar${i % 9 === 8 ? ' p-rec-bar--hot' : ''}" style="height:${h}px"></div>`;
  }

  const progress = Math.max(0, Math.min(100, Number(rec.progressPct) || 0));
  const audioSrc = rec.src || rec.url || call.audioUrl || call.recordingUrl || '';
  const audio = `<audio class="p-rec-audio" preload="metadata" data-duration="${Number(call.durationSeconds) || 0}"${audioSrc ? ` src="${esc(audioSrc)}"` : ''}></audio>`;

  const turnRows = turns
    .map((t) => {
      const speaker = t.speaker === 'rep' ? 'REP' : 'PROSPECT';
      const label = t.flag && t.time ? `${speaker}\n${esc(t.time)}` : speaker;
      const text = t.flag && t.hotText
        ? `<div>${esc(t.text || '')} </div><div class="p-rec-hot">${esc(t.hotText)}</div>`
        : esc(t.text || '');
      return `
        <div class="p-rec-turn${t.flag ? ' p-rec-turn--flag' : ''}">
          <div class="p-rec-speaker">${label}</div>
          <div class="p-rec-text">${text}</div>
        </div>`;
    })
    .join('');

  return `
    <div class="p-rec">
      <div class="p-rec-head">
        <div>
          <div class="p-rec-kicker">CALL RECORDING</div>
          <div class="p-rec-title-wrap">
            <div class="p-rec-title">${esc(f.name)}${rec.when ? ' | ' + esc(rec.when) : ''}</div>
          </div>
        </div>
        <div class="p-rec-meta">${esc(rec.meta || '')}</div>
      </div>
      <div class="p-rec-wave" role="img" aria-label="Audio waveform">${bars}</div>
      ${audio}
      <div class="p-rec-controls">
        <button type="button" class="p-rec-play" aria-label="Play recording">
          <svg width="15" height="17" viewBox="0 0 15 17" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <path d="M2 1L14 8.5L2 16Z" fill="#FF6550"/>
          </svg>
        </button>
        <div class="p-rec-track-wrap">
          <div class="p-rec-track">
            <div class="p-rec-fill" style="width:${progress}%"></div>
            <div class="p-rec-knob"></div>
          </div>
          <div class="p-rec-times">
            <div>${esc(rec.position || '')}</div>
            <div>${esc(rec.duration || '')}</div>
          </div>
        </div>
      </div>
      <div class="p-rec-rule"></div>
      <div class="p-rec-ts-head">
        <div class="p-rec-ts-title">Transcript</div>
        <div class="p-rec-ts-hint">scroll to read the full call</div>
      </div>
      <div class="p-rec-turns">${turnRows}</div>
    </div>`;
}

/* ------------------------------------------------------------------------
 * Full #call-modal-body contents: the four tab panels plus the hidden
 * recording block. Inactive panels carry the `hidden` attribute.
 * ---------------------------------------------------------------------- */
function paperCallDetail(call) {
  return `
    <div class="p-cd-panel" id="calltab-overview" role="tabpanel" aria-label="Overview">${paperCallOverview(call)}</div>
    <div class="p-cd-panel" id="calltab-coaching" role="tabpanel" aria-label="Coaching" hidden>${paperCallCoaching(call)}</div>
    <div class="p-cd-panel" id="calltab-transcript" role="tabpanel" aria-label="Transcript" hidden>${paperCallTranscript(call)}</div>
    <div class="p-cd-panel" id="calltab-notes" role="tabpanel" aria-label="Notes" hidden>${paperCallNotes(call)}</div>
    <div class="p-cd-panel" id="call-recording-panel" aria-label="Call recording" hidden>${paperCallRecording(call)}</div>`;
}

/* ======================== merged from .paper-build/brutus.js ======================== */

/* ==========================================================================
   Brutus chat — pure template functions.
   Transcribed from docs/paper-extract/09-brutus-chat.jsx and
   11-brutus-conversations.jsx. No side effects, no DOM queries, no
   event listeners.

   Dependency: a global esc() HTML-escaping helper must exist before these
   run (the equivalent of escapeHtml in app.js / paperEscape in home.js).
   ========================================================================== */

/* One message row — 09-brutus-chat.jsx, the two blocks inside the 1024px
   message column (gap 26).
   - role 'user'  → the right-aligned block: row justified to the end,
     460px right-aligned text, 18px/26 cream. No bubble: the JSX draws
     bare text with no background, border, radius, or padding.
   - role 'brutus' → the left column (gap 10) with the 700px main text,
     18px/27 cream. The JSX reply's second, quoted paragraph (17px/26
     #FFF8EFB8, padding-top 2) has no slot in (role, text); use the
     .p-msg-brutus-quote class in brutus.css to transcribe it. */
function paperChatMessage(role, text) {
    if (role === 'user') {
        return `
            <div class="p-msg-user">
                <div class="p-msg-user-text">${esc(text)}</div>
            </div>
        `;
    }
    return `
        <div class="p-msg-brutus">
            <div class="p-msg-brutus-text">${esc(text)}</div>
        </div>
    `;
}

/* Pending indicator. Neither 09 nor 16 draws a typing/pending state, so
   this is the simplest thing consistent with the JSX: a Brutus-treatment
   row (same container and 18px/27 text block as a reply) holding "…".
   .p-chat-typing is an identification hook only — no styles attach to it. */
function paperChatTyping() {
    return `
        <div class="p-msg-brutus p-chat-typing">
            <div class="p-msg-brutus-text">…</div>
        </div>
    `;
}

/* One conversation row — 11-brutus-conversations.jsx, the 42px rows in the
   256px rail: padding-inline 12, 14px/18 #FFF8EFB8; the active row gets
   bg #211A17, 1px #3B2D29 border, radius 8, cream text (.active).
   Expects { id, title, active } — title falls back to name. */
function paperConversationRow(conversation) {
    const c = conversation || {};
    return `
        <button type="button" class="p-convo-row${c.active ? ' active' : ''}" data-conversation-id="${esc(c.id)}">${esc(c.title || c.name)}</button>
    `;
}

/* ======================== merged from .paper-build/roleplay.js ======================== */

/* ==========================================================================
   Roleplay lane — pure template functions.
   Transcribed from docs/paper-extract/07-roleplay-setup.jsx (session rows),
   18-roleplay-active.jsx (transcript lines), and
   19-roleplay-results.jsx (results body).
   No side effects, no DOM queries, no event listeners.

   DEPENDENCY: relies on a global esc() helper to escape user text before
   it is interpolated into HTML.
   ========================================================================== */

/* "Today" / "Yesterday" / "Sep 19" — the date words the 07 session rows
   show ("Today · 14 turns · 8 drill turns", "Sep 19 · 11 turns · …"). */
function paperRoleplayDay(dateLike) {
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(dateLike);
    if (isNaN(d.getTime())) return 'unknown';
    const now = new Date();
    const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dayDiff = Math.round((midnight(now) - midnight(d)) / 86400000);
    if (dayDiff === 0) return 'Today';
    if (dayDiff === 1) return 'Yesterday';
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/* One past-session row — transcribes the 07 "Recent sessions" 72px row:
   52x42 turns pill (orange #623B34/#FF8A78 for drilled sessions — the
   artboard's 8-drill-turn row — muted #3A302C/#A9A09A otherwise, matching
   app.js's >=8 "solid drill" threshold), persona 14/18 cream, meta 12/16
   #8E837D ("Today · 14 turns · 8 drill turns"), duration 12/16 #A9A09A
   in a 120px column ("6 min 24 sec"), 30px ›.
   `session` comes from /roleplay/sessions: { id, persona, totalTurns,
   drillTurns, drillDurationSec, endedAt, startedAt }. */
function paperRoleplaySessionRow(session) {
    const s = session || {};
    const totalTurns = s.totalTurns || 0;
    const drillTurns = s.drillTurns || 0;
    const persona = s.persona || '(no persona — setup only)';
    const day = paperRoleplayDay(s.endedAt || s.startedAt);
    const meta = `${day} · ${totalTurns} turns · ${drillTurns} drill turns`;

    /* "6 min 24 sec" per the JSX duration column. */
    const sec = Math.max(0, Math.floor(s.drillDurationSec || 0));
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    const duration = m > 0 ? `${m} min ${r} sec` : `${r} sec`;

    const pillClass = drillTurns >= 8
        ? 'p-rp-session-pill p-rp-session-pill-drilled'
        : 'p-rp-session-pill';

    return `
        <button type="button" class="p-rp-session" data-action="open-roleplay-session" data-id="${esc(s.id)}">
            <span class="${pillClass}">${esc(totalTurns)}</span>
            <span class="p-rp-session-body">
                <span class="p-t-14 p-c-cream">${esc(persona)}</span>
                <span class="p-t-12 p-c-3">${esc(meta)}</span>
            </span>
            <span class="p-rp-session-dur">${esc(duration)}</span>
            <span class="p-rp-session-chev" aria-hidden="true">›</span>
        </button>
    `;
}

/* One live-transcript line — transcribes 18's transcript treatment:
   a 12/16 tracked #FFF8EF70 label over 19/28 cream text; Brutus lines
   are 640px left-aligned, rep lines 580px right-aligned. The markup
   matches what app.js's rpAppendMessage builds (label span + text node
   inside .rp-msg), so both share the same CSS. `role` is 'rep',
   'brutus', or 'coach' (18-roleplay-active.jsx: YOU / BRUTUS / BRUTUS · COACH). */
function paperRoleplayTranscriptLine(role, text) {
    const isRep = role === 'rep';
    const isCoach = role === 'coach';
    const cls = isRep ? 'rp-msg rp-msg-rep' : isCoach ? 'rp-msg rp-msg-coach' : 'rp-msg rp-msg-brutus';
    const label = isRep ? 'YOU' : isCoach ? 'BRUTUS · COACH' : 'BRUTUS';
    return `<div class="${cls}"><span class="rp-msg-label">${label}</span>${esc(text)}</div>`;
}

/* I / II / III … — the numbering the 19 action items use
   ("I. Ask one impact question before explaining."). */
function paperRoleplayRoman(n) {
    const TABLE = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    let v = Math.max(1, Math.floor(n));
    TABLE.forEach(([val, sym]) => {
        while (v >= val) { out += sym; v -= val; }
    });
    return out;
}

/* The results body — transcribes 19-roleplay-results.jsx's three columns:
   1. persona rail (280px): PERSONA label, persona 24/31, scenario 14/22,
      hairline, stat rows (Total turns / Drill turns / Coach pauses /
      Drill duration).
   2. main (500px): OVERALL label, roast 27/36, hairline, "Weakness
      exposure" cards (hot = #211A17 bg + #FF6550 left border, else bare
      + #FFF8EF66), "Action items" as Roman-numeral lines.
   3. transcript (flex): TURN-BY-TURN TRANSCRIPT label, turn cards with a
      3px left border (#FF6550 Brutus/coach, #FFF8EF8F rep), label like
      "BRUTUS · DRILL · #7", text 14/21.
   (The artboard's bottom note "Opening a recent roleplay session returns
   this persisted summary…" is a spec annotation and is not rendered.)

   `results` shape:
   { persona, scenario, totalTurns, drillTurns, coachPauses,
     drillDurationSec, overall, weaknesses: [{ title, status, handled }],
     actionItems: [string], transcript: [{ role: 'rep'|'brutus'|'coach',
     turn, text }] } */
function paperRoleplayResults(results) {
    const r = results || {};

    /* "6:24" per the JSX Drill duration stat. */
    const sec = Math.max(0, Math.floor(r.drillDurationSec || 0));
    const duration = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

    const stats = [
        ['Total turns', r.totalTurns || 0],
        ['Drill turns', r.drillTurns || 0],
        ['Coach pauses', r.coachPauses || 0],
        ['Drill duration', duration]
    ].map(([label, value]) => `
        <div class="p-rp-res-stat"><span>${esc(label)}</span><span>${esc(value)}</span></div>
    `).join('');

    const weaknesses = (r.weaknesses || []).map((w) => `
        <div class="p-rp-weakness${w.handled ? ' p-rp-weakness-hot' : ''}">
            <div class="p-rp-weakness-t">${esc(w.title)}</div>
            <div class="p-rp-weakness-s">${esc(w.status)}</div>
        </div>
    `).join('');

    const actions = (r.actionItems || [])
        .map((item, i) => `${paperRoleplayRoman(i + 1)}. ${esc(item)}`)
        .join('<br>');

    const turns = (r.transcript || []).map((t) => {
        const isRep = t.role === 'rep';
        const who = isRep ? 'YOU' : 'BRUTUS';
        const kind = t.role === 'coach' ? 'COACH PAUSE' : 'DRILL';
        const num = t.turn != null ? ` · #${esc(t.turn)}` : '';
        return `
        <div class="p-rp-turn${isRep ? ' p-rp-turn-rep' : ''}">
            <div class="p-rp-turn-label">${who} · ${kind}${num}</div>
            <div class="p-rp-turn-text">${esc(t.text)}</div>
        </div>
        `;
    }).join('');

    return `
        <div class="p-rp-res-rail">
            <div class="p-rp-overlay-label">PERSONA</div>
            <div class="p-rp-res-persona">${esc(r.persona)}</div>
            <div class="p-rp-res-sub">${esc(r.scenario)}</div>
            <div class="p-rp-res-rule"></div>
            ${stats}
        </div>
        <div class="p-rp-res-main">
            <div class="p-rp-overlay-label">OVERALL</div>
            <div class="p-rp-res-roast">${esc(r.overall)}</div>
            <div class="p-rp-res-rule"></div>
            <div class="p-rp-res-h">Weakness exposure</div>
            ${weaknesses}
            <div class="p-rp-res-h">Action items</div>
            <div class="p-rp-res-actions">${actions}</div>
        </div>
        <div class="p-rp-res-transcript">
            <div class="p-rp-overlay-label">TURN-BY-TURN TRANSCRIPT</div>
            ${turns}
        </div>
    `;
}

/* ======================== merged from .paper-build/research.js ======================== */

/* =========================================================================
 * research.js — pure template functions for the Research screen.
 * Transcribed from docs/paper-extract/08-research.jsx (right column,
 * lines 431–499: the saved-brief detail with its DONE pill, hairline
 * dividers, two-up labelled sections, and QUESTIONS TO ASK block).
 *
 * The JSX draws no list rows — its right column is one expanded brief.
 * paperResearchRow therefore reuses the design system's hairline row
 * treatment (.p-row from 01-home-dashboard.jsx) as the collapsed header
 * of a card, with the brief's own status pill; app.js's existing
 * toggle-card delegation toggles .expanded on the card to reveal the
 * detail (paperResearchDetail) inside.
 *
 * Pure templates only: no DOM queries, no event listeners, no IIFE.
 * Depends on the global esc() HTML-escaping helper provided by app.js.
 *
 * Expected item shape (from GET /research, pre-formatted by the caller):
 *   {
 *     id,                     // unique per item (index is fine)
 *     query,                  // 'Maya Chen · Northstar Labs' or raw query
 *     status,                 // 'completed' | 'pending' | 'failed'
 *     dateLabel,              // 'Completed today at 3:28 PM'
 *     results,                // string | null (raw brief text)
 *     sections?,              // [{ label: 'COMPANY OVERVIEW', body: '…' }]
 *     questions?              // ['1. Where does…', …]
 *   }
 * ========================================================================= */

/* Status pill (08 lines 441–445). The JSX draws exactly one status — DONE:
 * a 26px pill, #623B34 border, #FF8A78 11/14 text. RESEARCHING and FAILED
 * are not drawn; they take the same pill with the neutral chip colours the
 * JSX uses for its context chips (#3A302C border, #A9A09A text). */
function paperResearchStatusPill(status) {
  if (status === 'completed') return '<span class="p-rbrief-pill">DONE</span>';
  if (status === 'pending') return '<span class="p-rbrief-pill p-rbrief-pill--muted">RESEARCHING</span>';
  return '<span class="p-rbrief-pill p-rbrief-pill--muted">FAILED</span>';
}

/* One saved-research card: a collapsed .p-row header (title 15/18 cream +
 * meta 12/16 #8E837D, from the design system's hairline row treatment)
 * with the brief's status pill and a ⌄ affordance, plus a hidden body
 * holding the full brief. app.js's data-action="toggle-card" delegation
 * toggles .expanded on #research-card-<id>. */
function paperResearchRow(item) {
  const id = `research-card-${esc(String(item.id))}`;
  return `
    <div class="p-rcard" id="${id}">
      <div class="p-row p-rrow" data-action="toggle-card" data-target="${id}"
           role="button" tabindex="0" aria-expanded="false"
           aria-label="Toggle research brief: ${esc(item.query || '')}">
        <div class="p-row-body">
          <div class="p-t-15 p-c-cream">${esc(item.query || '')}</div>
          <div class="p-t-12 p-c-3">${esc(item.dateLabel || '')}</div>
        </div>
        ${paperResearchStatusPill(item.status)}
        <div class="p-col-chev" aria-hidden="true">⌄</div>
      </div>
      <div class="p-rcard-body">
        ${paperResearchDetail(item)}
      </div>
    </div>`;
}

/* The expanded brief detail (08 lines 432–499):
 *   head (23/28 title + 12/16 meta + status pill)
 *   ── hairline (#2A2320)
 *   two-up sections: 12/16 0.08em #FF8A78 label over 13/20 #D8CEC6 body,
 *   paired per row with a hairline between rows
 *   QUESTIONS TO ASK: label + 14/21 cream lines
 * Live data usually carries one raw text blob (item.results); it takes the
 * JSX's section-body treatment with line breaks preserved. Structured
 * sections/questions render the exact JSX grid when the caller provides
 * them. A pending item shows the legacy in-progress copy. */
function paperResearchDetail(item) {
  const head = `
    <div class="p-rbrief-head">
      <div class="p-rbrief-headtext">
        <div class="p-rbrief-title">${esc(item.query || '')}</div>
        <div class="p-t-12 p-c-3">${esc(item.dateLabel || '')}</div>
      </div>
      ${paperResearchStatusPill(item.status)}
    </div>`;

  let body = '';
  if (item.sections && item.sections.length) {
    // Chunk sections two per row, hairline between rows (08 lines 448–484).
    for (let i = 0; i < item.sections.length; i += 2) {
      const pair = item.sections.slice(i, i + 2).map((s) => `
        <div class="p-rbrief-sec">
          <div class="p-rbrief-k">${esc(s.label || '')}</div>
          <div class="p-rbrief-v">${esc(s.body || '')}</div>
        </div>`).join('');
      body += `<div class="p-rule"></div><div class="p-rbrief-grid">${pair}</div>`;
    }
    if (item.questions && item.questions.length) {
      body += `
        <div class="p-rule"></div>
        <div class="p-rbrief-qs">
          <div class="p-rbrief-k">QUESTIONS TO ASK</div>
          ${item.questions.map((q) => `<div class="p-rbrief-q">${esc(q)}</div>`).join('')}
        </div>`;
    }
  } else if (item.results) {
    body = `<div class="p-rule"></div><div class="p-rbrief-text">${esc(item.results)}</div>`;
  } else {
    // Legacy in-progress copy — the JSX has no pending-brief state.
    body = `<div class="p-rule"></div><div class="p-rbrief-v">research in progress...</div>`;
  }

  return `<article class="p-rbrief">${head}${body}</article>`;
}

/* ==========================================================================
   Glue — behaviour the Paper design needs that app.js does not provide.
   Everything below is wiring only: no styling, no data fetching, no API
   calls. Each block states why it exists and why app.js does not own it.
   ========================================================================== */

/* --- esc() -----------------------------------------------------------------
   The lane templates above call a global esc(). app.js already defines an
   identical global helper named escapeHtml() but no esc(), so alias it
   instead of duplicating the implementation. The fallback body only runs if
   app.js ever renames or drops escapeHtml. */
if (typeof window.esc !== 'function') {
    window.esc = typeof escapeHtml === 'function' ? escapeHtml : function (str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };
}

function paperSeekRecording(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return;
  const audio = document.querySelector('#call-recording-panel audio');
  const panel = document.getElementById('call-recording-panel');
  if (!audio || !panel) return;
  ['overview', 'coaching', 'transcript', 'notes'].forEach((name) => {
    const tabPanel = document.getElementById('calltab-' + name);
    if (tabPanel) tabPanel.hidden = true;
  });
  document.querySelectorAll('[data-calltab]').forEach((tab) => {
    tab.classList.remove('active');
    if (tab.hasAttribute('aria-selected')) tab.setAttribute('aria-selected', 'false');
  });
  panel.hidden = false;
  try { audio.currentTime = seconds; } catch (_) { /* media not seekable yet */ }
  const duration = Number(audio.duration) || Number(audio.getAttribute('data-duration')) || 0;
  const fill = panel.querySelector('.p-rec-fill');
  if (fill && duration > 0) fill.style.width = Math.min(100, (seconds / duration) * 100) + '%';
  const position = panel.querySelector('.p-rec-times div');
  if (position) position.textContent = paperFormatOffset(seconds);
  if (typeof audio.play === 'function') {
    const pending = audio.play();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', () => {

    /* Start monitoring exists only inside the desktop app. The website has no
       always-on-top overlay, so the button stays hidden unless the Electron
       preload is present. */
    const lilSession = { roleplay: false, monitoring: false };
    const pushLilSession = (kind) => {
        if (!window.brutus || !window.brutus.setLilBrutusSession) return;
        window.brutus.setLilBrutusSession({
            kind,
            on: kind === 'roleplay' ? lilSession.roleplay : lilSession.monitoring
        });
    };
    const monitorBtn = document.getElementById('start-monitoring-btn');
    if (monitorBtn && window.brutus && window.brutus.startMonitoring) {
        monitorBtn.classList.remove('hidden');
        const syncMonitor = async () => {
            const on = await window.brutus.isMonitoring();
            monitorBtn.textContent = on ? 'Stop monitoring' : 'Start monitoring';
            if (lilSession.monitoring === on) return;
            lilSession.monitoring = on;
            pushLilSession('monitoring');
        };
        monitorBtn.addEventListener('click', async () => {
            const on = await window.brutus.isMonitoring();
            if (on) await window.brutus.stopMonitoring();
            else await window.brutus.startMonitoring();
            syncMonitor();
        });
        window.brutus.onMonitoringStarted(syncMonitor);
        window.brutus.onMonitoringStopped(syncMonitor);
        syncMonitor();
    }

    const rpOverlay = document.getElementById('rp-active-overlay');
    if (rpOverlay) {
        let rpOpen = !rpOverlay.classList.contains('hidden');
        new MutationObserver(() => {
            const open = !rpOverlay.classList.contains('hidden');
            if (open === rpOpen) return;
            rpOpen = open;
            lilSession.roleplay = open;
            pushLilSession('roleplay');
        }).observe(rpOverlay, { attributes: true, attributeFilter: ['class'] });
    }

    const settingsNav = document.getElementById('nav-settings');
    if (settingsNav && window.brutus) {
        settingsNav.classList.remove('hidden');
    }

    const DESKTOP_VOICES = [
        'UgBBYS2sOqTuMpoF3BR0',
        'c6SfcYrb2t09NHXiT80T',
        'NOpBlnGInO9m6vDvFkFC',
        'Cz0K1kOv9tD8l0b5Qu53',
        'DMyrgzQFny3JI1Y1paM5',
        'gfRt6Z3Z8aTbpLfexQ7N'
    ];
    let desktopSettingsReady = false;
    let desktopSettingsLoad = Promise.resolve();
    let desktopLoadSeq = 0;
    let desktopLoadedApiUrl = '';
    let opacitySaveTimer = null;

    function showDesktopSettingsMsg(text, ok) {
        const msg = document.getElementById('desktop-settings-msg');
        if (!msg) return;
        msg.textContent = text;
        msg.style.color = ok ? '#50ff80' : '#ff5050';
        msg.style.display = 'block';
        if (ok) {
            setTimeout(() => {
                if (msg.textContent === text) msg.style.display = 'none';
            }, 3000);
        }
    }

    let whiteBgEpoch = 0;

    function applyDesktopWhiteBackground(on) {
        const enabled = !!on;
        if (!document.documentElement) return;
        document.documentElement.classList.toggle('p-white-bg', enabled);
        const btn = document.getElementById('desktop-white-background');
        if (!btn) return;
        btn.classList.toggle('active', enabled);
        btn.classList.toggle('p-btn-primary', enabled);
        btn.classList.toggle('p-btn-secondary', !enabled);
        btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }

    if (window.brutus && window.brutus.getSettings) {
        const epochAtFetch = whiteBgEpoch;
        window.brutus.getSettings().then((settings) => {
            if (epochAtFetch !== whiteBgEpoch) return;
            applyDesktopWhiteBackground(!!(settings && settings.whiteBackground));
        }).catch(() => {});
    }

    window.loadDesktopSettings = function loadDesktopSettings() {
        if (!window.brutus || !window.brutus.getSettings) return desktopSettingsLoad;
        const seq = ++desktopLoadSeq;
        desktopSettingsReady = false;
        clearTimeout(opacitySaveTimer);
        desktopSettingsLoad = (async () => {
            const epochAtLoad = whiteBgEpoch;
            try {
                const settings = await window.brutus.getSettings();
                if (seq !== desktopLoadSeq) return;
                const apiInput = document.getElementById('desktop-api-url');
                const autoStart = document.getElementById('desktop-auto-start');
                const opacity = document.getElementById('desktop-overlay-opacity');
                const opacityValue = document.getElementById('desktop-opacity-value');
                const audio = document.getElementById('desktop-audio-feedback');
                const interval = document.getElementById('desktop-min-feedback-interval');
                const voice = document.getElementById('desktop-tts-voice');
                const apiUrl = (settings && typeof settings.apiUrl === 'string' && settings.apiUrl.trim())
                    ? settings.apiUrl.trim()
                    : 'https://api.brutusai.coach';
                desktopLoadedApiUrl = apiUrl;
                if (apiInput) apiInput.value = apiUrl;
                if (autoStart) autoStart.checked = !!(settings && settings.autoStart);
                const pct = Math.round(((settings && settings.overlayOpacity) || 0.95) * 100);
                if (opacity) opacity.value = String(pct);
                if (opacityValue) opacityValue.textContent = pct + '%';
                if (audio) audio.checked = !!(settings && settings.audioFeedback);
                if (interval) interval.value = String((settings && settings.minFeedbackInterval) || 20);
                if (voice && settings && DESKTOP_VOICES.indexOf(settings.ttsVoice) !== -1) {
                    voice.value = settings.ttsVoice;
                }
                if (whiteBgEpoch === epochAtLoad) {
                    applyDesktopWhiteBackground(!!(settings && settings.whiteBackground));
                }
                desktopSettingsReady = true;
            } catch (err) {
                if (seq !== desktopLoadSeq) return;
                showDesktopSettingsMsg(err && err.message ? err.message : 'Could not load settings.', false);
            }
        })();
        return desktopSettingsLoad;
    };

    const whiteBgBtn = document.getElementById('desktop-white-background');
    if (whiteBgBtn && window.brutus && window.brutus.setSettings) {
        whiteBgBtn.addEventListener('click', async () => {
            const next = whiteBgBtn.getAttribute('aria-pressed') !== 'true';
            whiteBgEpoch += 1;
            applyDesktopWhiteBackground(next);
            try {
                await window.brutus.setSettings({ whiteBackground: next });
            } catch (err) {
                whiteBgEpoch += 1;
                applyDesktopWhiteBackground(!next);
                showDesktopSettingsMsg(err && err.message ? err.message : 'Could not save settings.', false);
            }
        });
    }

    const opacityInput = document.getElementById('desktop-overlay-opacity');
    if (opacityInput && window.brutus && window.brutus.setSettings) {
        opacityInput.addEventListener('input', (e) => {
            const pct = parseInt(e.target.value, 10);
            const opacityValue = document.getElementById('desktop-opacity-value');
            if (opacityValue && Number.isFinite(pct)) opacityValue.textContent = pct + '%';
            if (!desktopSettingsReady || !Number.isFinite(pct)) return;
            clearTimeout(opacitySaveTimer);
            opacitySaveTimer = setTimeout(() => {
                window.brutus.setSettings({ overlayOpacity: pct / 100 });
            }, 40);
        });
    }

    const saveSettingsBtn = document.getElementById('desktop-settings-save');
    if (saveSettingsBtn && window.brutus && window.brutus.setSettings) {
        saveSettingsBtn.addEventListener('click', async () => {
            await desktopSettingsLoad;
            if (!desktopSettingsReady) {
                showDesktopSettingsMsg('Could not load settings.', false);
                return;
            }
            const apiUrl = (document.getElementById('desktop-api-url').value || '').trim();
            try {
                new URL(apiUrl);
            } catch (_) {
                showDesktopSettingsMsg('Invalid API URL format. Please enter a valid URL (e.g., https://api.brutusai.coach)', false);
                return;
            }
            const pct = parseInt(document.getElementById('desktop-overlay-opacity').value, 10);
            const whiteBgBtn = document.getElementById('desktop-white-background');
            const settings = {
                apiUrl: apiUrl,
                autoStart: document.getElementById('desktop-auto-start').checked,
                overlayOpacity: (Number.isFinite(pct) ? pct : 95) / 100,
                audioFeedback: document.getElementById('desktop-audio-feedback').checked,
                minFeedbackInterval: parseInt(document.getElementById('desktop-min-feedback-interval').value, 10) || 20,
                ttsVoice: document.getElementById('desktop-tts-voice').value || '',
                whiteBackground: !!(whiteBgBtn && whiteBgBtn.getAttribute('aria-pressed') === 'true')
            };
            const apiChanged = apiUrl !== desktopLoadedApiUrl;
            saveSettingsBtn.disabled = true;
            try {
                await window.brutus.setSettings(settings);
                desktopLoadedApiUrl = apiUrl;
                if (apiChanged) {
                    window.location.reload();
                    return;
                }
                showDesktopSettingsMsg('saved', true);
            } catch (err) {
                showDesktopSettingsMsg(err && err.message ? err.message : 'Could not save settings.', false);
            } finally {
                saveSettingsBtn.disabled = false;
            }
        });
    }


    /* Key moments and speakers. The call body is rebuilt when a call opens,
       so the clicks are handled on the document. */
    document.addEventListener('click', (e) => {
        const jump = e.target.closest('.p-ts-jump');
        if (jump) {
            paperSeekRecording(Number(jump.getAttribute('data-seek-sec')));
            return;
        }

        const tabLink = e.target.closest('[data-calltab-link]');
        if (tabLink) {
            const tab = document.querySelector('[data-calltab="' + tabLink.getAttribute('data-calltab-link') + '"]');
            if (tab) tab.click();
            return;
        }

        const showRec = e.target.closest('[data-action="show-recording"]');
        if (showRec) {
            const panel = document.getElementById('call-recording-panel');
            const audio = panel && panel.querySelector('audio');
            if (panel) {
                ['overview', 'coaching', 'transcript', 'notes'].forEach((name) => {
                    const tabPanel = document.getElementById('calltab-' + name);
                    if (tabPanel) tabPanel.hidden = true;
                });
                document.querySelectorAll('[data-calltab]').forEach((tab) => {
                    tab.classList.remove('active');
                    if (tab.hasAttribute('aria-selected')) tab.setAttribute('aria-selected', 'false');
                });
                panel.hidden = false;
            }
            if (audio && typeof audio.play === 'function' && audio.paused) {
                const pending = audio.play();
                if (pending && typeof pending.catch === 'function') pending.catch(() => {});
            }
            return;
        }

        const play = e.target.closest('.p-rec-play');
        if (play) {
            const audio = document.querySelector('#call-recording-panel audio');
            if (!audio || typeof audio.play !== 'function') return;
            if (audio.paused) {
                const pending = audio.play();
                if (pending && typeof pending.catch === 'function') pending.catch(() => {});
            } else if (typeof audio.pause === 'function') {
                audio.pause();
            }
            return;
        }

        const filter = e.target.closest('.p-co-filter');
        if (filter) {
            const cols = filter.closest('.p-cd-cols');
            if (!cols) return;
            cols.querySelectorAll('.p-co-filter').forEach((btn) => btn.classList.toggle('active', btn === filter));
            const which = filter.getAttribute('data-moments');
            const moments = cols.querySelectorAll('.p-co-moment');
            let shown = 0;
            let first = null;
            moments.forEach((moment) => {
                const keep = which === 'all' || moment.getAttribute('data-moment') === which;
                moment.hidden = !keep;
                if (keep) {
                    shown += 1;
                    if (!first) first = moment;
                }
            });
            const count = cols.querySelector('.p-co-head-count');
            if (count) count.textContent = `${shown} moment${shown === 1 ? '' : 's'}`;
            if (first) first.scrollIntoView({ block: 'start', behavior: 'smooth' });
            return;
        }

        const moment = e.target.closest('.p-co-moment');
        if (moment && !e.target.closest('button')) {
            moment.parentElement.querySelectorAll('.p-co-moment.is-open').forEach((row) => row.classList.remove('is-open'));
            moment.classList.add('is-open');
            moment.scrollIntoView({ block: 'start', behavior: 'smooth' });
            return;
        }

        const speaker = e.target.closest('.p-ts-speaker');
        if (!speaker) return;
        const cols = speaker.closest('.p-cd-cols');
        if (!cols) return;
        cols.querySelectorAll('.p-ts-speaker').forEach((btn) => btn.classList.toggle('active', btn === speaker));
        const who = speaker.getAttribute('data-speaker');
        const turns = cols.querySelectorAll('.p-ts-turn');
        let shown = 0;
        let first = null;
        turns.forEach((turn) => {
            const keep = who === 'all' || turn.getAttribute('data-speaker') === who;
            turn.hidden = !keep;
            if (keep) {
                shown += 1;
                if (!first) first = turn;
            }
        });
        const head = cols.querySelector('.p-cd-main--transcript .p-cd-h17');
        const label = who === 'rep' ? 'Rep' : who === 'prospect' ? 'Prospect' : 'All speakers';
        if (head) head.textContent = who === 'all' ? `${shown} transcript turns` : `${label} · ${shown} turn${shown === 1 ? '' : 's'}`;
        const detail = cols.querySelector('.p-ts-speaker-detail');
        if (detail) {
            if (who === 'all') {
                detail.hidden = true;
                detail.textContent = '';
            } else {
                const share = speaker.querySelector('.p-ts-speaker-count');
                detail.hidden = false;
                detail.innerHTML = `<div class="p-cd-h17">${label}</div><div class="p-t-13 p-c-3">${shown} turns · ${share ? share.textContent : ''} of the call</div>`;
            }
        }
        if (first) first.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    /* --- sidebar collapse (10-home-collapsed-sidebar.jsx) -------------------
       #sidebar-toggle toggles .p-collapsed on #main-content; the
       .p-app.p-collapsed rules already live in paper.css. State persists in
       localStorage. app.js has no sidebar handling. */
    const mainContent = document.getElementById('main-content');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (mainContent && sidebarToggle) {
        const COLLAPSE_KEY = 'brutusSidebarCollapsed';
        try {
            if (localStorage.getItem(COLLAPSE_KEY) === '1') mainContent.classList.add('p-collapsed');
        } catch (_) { /* storage unavailable — collapse just won't persist */ }
        const sidebarMotionOff = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let sidebarAnim = null;
        let sidebarRun = 0;
        const sidebarPx = (collapsed) => {
            const raw = getComputedStyle(document.documentElement).getPropertyValue(
                collapsed ? '--p-sidebar-collapsed-w' : '--p-sidebar-w'
            );
            const n = parseFloat(raw);
            return Number.isFinite(n) ? n : (collapsed ? 72 : 224);
        };
        const animateSidebar = (collapsed) => {
            const sidebar = mainContent.querySelector('.p-sidebar');
            const detail = document.querySelector('.p-calldetail');
            if (!sidebar) return;
            const from = sidebar.getBoundingClientRect().width;
            const target = sidebarPx(collapsed);
            const run = ++sidebarRun;
            if (sidebarAnim) sidebarAnim.cancel();
            sidebarAnim = null;
            if (sidebarMotionOff() || !window.anime || typeof window.anime.animate !== 'function' || Math.abs(from - target) < 0.5) {
                sidebar.style.width = '';
                if (detail) detail.style.left = '';
                return;
            }
            sidebar.style.width = from + 'px';
            if (detail) detail.style.left = from + 'px';
            const state = { w: from };
            sidebarAnim = window.anime.animate(state, {
                w: target,
                duration: 240,
                ease: 'outCubic',
                onUpdate: () => {
                    if (run !== sidebarRun) return;
                    const px = state.w + 'px';
                    sidebar.style.width = px;
                    if (detail) detail.style.left = px;
                },
                onComplete: () => {
                    if (run !== sidebarRun) return;
                    sidebar.style.width = '';
                    if (detail) detail.style.left = '';
                    sidebarAnim = null;
                }
            });
        };
        sidebarToggle.addEventListener('click', () => {
            const sidebar = mainContent.querySelector('.p-sidebar');
            const detail = document.querySelector('.p-calldetail');
            if (sidebar && !sidebarMotionOff() && window.anime) {
                const from = sidebar.getBoundingClientRect().width;
                sidebar.style.width = from + 'px';
                if (detail) detail.style.left = from + 'px';
            }
            const collapsed = mainContent.classList.toggle('p-collapsed');
            try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (_) {}
            animateSidebar(collapsed);
        });
    }

    /* --- visible log-out button (bottom of profile content) -----------------
       app.js binds the hidden #logout-btn only; the profile page's visible
       #account-logout-btn proxies to it. */
    const accountLogout = document.getElementById('account-logout-btn');
    if (accountLogout) {
        accountLogout.addEventListener('click', () => {
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) logoutBtn.click();
        });
    }

    /* --- auth tab switching: intentionally NOT wired here -------------------
       app.js already binds every .auth-tab click (moves .active and swaps
       #signup-form / #login-form via the `hidden` class). Duplicating it here
       would double-toggle the forms. Note: app.js does not update
       #auth-heading / #auth-subheading on tab change, and the auth artboard
       (auth-signup-login.jsx) only draws the signup state, so there is no
       transcribed login-state heading copy to swap in anyway. */

    /* --- call-detail tabs (03/04/05/06-call-*.jsx) ---------------------------
       The tab chrome is static in the call-detail shell; app.js regenerates
       only the panels (#calltab-*) inside #call-modal-body, so binding the
       tabs once here is safe. Moves .active / aria-selected and toggles the
       hidden attribute so exactly the matching panel shows. */
    const callTabs = Array.from(document.querySelectorAll('[data-calltab]'));
    const CALLTAB_NAMES = ['overview', 'coaching', 'transcript', 'notes'];
    callTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const name = tab.getAttribute('data-calltab');
            callTabs.forEach((t) => {
                const isActive = t === tab;
                t.classList.toggle('active', isActive);
                if (t.hasAttribute('aria-selected')) t.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });
            CALLTAB_NAMES.forEach((n) => {
                const panel = document.getElementById('calltab-' + n);
                if (panel) panel.hidden = (n !== name);
            });
            const recording = document.getElementById('call-recording-panel');
            if (recording) {
                recording.hidden = true;
                const audio = recording.querySelector('audio');
                if (audio && typeof audio.pause === 'function') audio.pause();
            }
        });
    });

    /* --- dashboard Ask-Brutus composer (01-home-dashboard.jsx rail) ---------
       Forwards the text into #chat-input, switches to the Brutus view by
       clicking its nav item (app.js owns view switching), then triggers
       #chat-send-btn (app.js owns sending). */
    const dashInput = document.getElementById('dash-ask-input');
    const dashSend = document.getElementById('dash-ask-send');
    const forwardDashAsk = () => {
        if (!dashInput) return;
        const text = dashInput.value.trim();
        if (!text) return;
        const chatInput = document.getElementById('chat-input');
        const chatSend = document.getElementById('chat-send-btn');
        if (!chatInput || !chatSend) return;
        const brutusNav = document.querySelector('.nav-item[data-view="brutus"]');
        if (brutusNav) brutusNav.click();
        chatInput.value = text;
        dashInput.value = '';
        chatSend.click();
    };
    if (dashSend) dashSend.addEventListener('click', forwardDashAsk);
    if (dashInput) {
        dashInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') forwardDashAsk();
        });
    }

    /* --- conversations rail toggle (11-brutus-conversations.jsx) ------------
       The header hamburger slides #brutus-conversations open and closed
       with the same 240ms outCubic width move as the main sidebar.
       aria-expanded turns the hamburger stroke orange. */
    const convosToggle = document.getElementById('brutus-conversations-toggle');
    const convos = document.getElementById('brutus-conversations');
    if (convosToggle && convos) {
        const CONVO_W = 256;
        let convoAnim = null;
        let convoRun = 0;
        const convoMotionOff = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const clearConvoMotion = (show) => {
            const chat = convos.closest('.p-chat');
            convos.style.width = '';
            convos.style.minWidth = '';
            convos.style.maxWidth = '';
            convos.style.overflow = '';
            if (chat) chat.style.gridTemplateColumns = '';
            if (!show) convos.setAttribute('hidden', '');
        };
        const animateConvos = (show) => {
            const chat = convos.closest('.p-chat');
            const run = ++convoRun;
            if (convoAnim && typeof convoAnim.cancel === 'function') convoAnim.cancel();
            convoAnim = null;
            const measured = convos.getBoundingClientRect().width;
            const from = show ? 0 : (Number.isFinite(measured) && measured > 0 ? measured : CONVO_W);
            const target = show ? CONVO_W : 0;
            if (show) convos.removeAttribute('hidden');
            if (convoMotionOff() || !window.anime || typeof window.anime.animate !== 'function' || Math.abs(from - target) < 0.5) {
                clearConvoMotion(show);
                return;
            }
            const apply = (w) => {
                const px = w + 'px';
                if (chat) chat.style.gridTemplateColumns = px + ' minmax(0, 1fr)';
                convos.style.minWidth = '0';
                convos.style.maxWidth = px;
                convos.style.width = px;
                convos.style.overflow = 'hidden';
            };
            apply(from);
            const state = { w: from };
            convoAnim = window.anime.animate(state, {
                w: target,
                duration: 240,
                ease: 'outCubic',
                onUpdate: () => {
                    if (run !== convoRun) return;
                    apply(state.w);
                },
                onComplete: () => {
                    if (run !== convoRun) return;
                    convoAnim = null;
                    clearConvoMotion(show);
                }
            });
        };
        convosToggle.addEventListener('click', () => {
            const show = convos.hasAttribute('hidden');
            convosToggle.setAttribute('aria-expanded', show ? 'true' : 'false');
            animateConvos(show);
        });
    }

    /* Spawn Lil Brutus. Not a view: no data-view, and app.js skips
       #nav-lil-brutus when it clears .active, so other nav clicks leave
       this toggle alone. localStorage brutusLilBrutus is "1" shown, "0"
       hidden, and missing means shown. The mascot is his own always-on-top
       window, so the chat-page plate stays hidden. */
    const lilBrutusBtn = document.getElementById('nav-lil-brutus');
    const lilBrutusDecal = document.querySelector('.p-chat-decal');
    if (lilBrutusDecal) lilBrutusDecal.classList.add('is-off');
    /* electron-store settings.lilBrutusVisible is the copy that survives a
       restart. localStorage brutusLilBrutus mirrors it (1 shown, 0 hidden)
       and is the fallback when the desktop setting has never been written. */
    let lilBrutusPref = null;
    let lilBrutusEpoch = 0;
    const lilBrutusShown = () => {
        if (typeof lilBrutusPref === 'boolean') return lilBrutusPref;
        try { return localStorage.getItem('brutusLilBrutus') !== '0'; }
        catch (_) { return true; }
    };
    const paintLilBrutus = (shown) => {
        if (lilBrutusDecal) lilBrutusDecal.classList.add('is-off');
        if (lilBrutusBtn) {
            lilBrutusBtn.classList.toggle('active', shown);
            lilBrutusBtn.setAttribute('aria-pressed', shown ? 'true' : 'false');
        }
    };
    const applyLilBrutus = (shown) => {
        lilBrutusPref = !!shown;
        paintLilBrutus(lilBrutusPref);
        try { localStorage.setItem('brutusLilBrutus', lilBrutusPref ? '1' : '0'); }
        catch (_) { /* storage unavailable */ }
        if (window.brutus && window.brutus.setLilBrutusVisible) {
            window.brutus.setLilBrutusVisible(lilBrutusPref).catch(() => {});
        }
    };
    const bootLilBrutus = async () => {
        const epoch = ++lilBrutusEpoch;
        let shown = true;
        try { shown = localStorage.getItem('brutusLilBrutus') !== '0'; }
        catch (_) { /* keep shown */ }
        try {
            if (window.brutus && window.brutus.getSettings) {
                const settings = await window.brutus.getSettings();
                if (epoch !== lilBrutusEpoch) return;
                if (settings && typeof settings.lilBrutusVisible === 'boolean') {
                    shown = settings.lilBrutusVisible;
                }
            }
        } catch (_) { /* fall back to localStorage */ }
        if (epoch !== lilBrutusEpoch) return;
        applyLilBrutus(shown);
    };
    bootLilBrutus();
    if (lilBrutusBtn) {
        lilBrutusBtn.addEventListener('click', () => {
            lilBrutusEpoch += 1;
            applyLilBrutus(!lilBrutusShown());
        });
    }
});
