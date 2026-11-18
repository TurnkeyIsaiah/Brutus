// Live coaching overlay UI. The session lifecycle (consent → pick → start →
// live → stop, the socket, recording and delivery) lives in
// capture/capture-session.js; this file only draws it and wires the controls.
(function () {
  'use strict';

  const brutus = window.brutus;
  const $ = (id) => document.getElementById(id);

  const TALK_SILENCE_THRESHOLD = 15;
  const KEEP_VISIBLE_REASONS = new Set(['billing', 'signed_out', 'session_not_active']);

  let feedbackItems = [];
  let repTalkingFrames = 0;
  let totalFrames = 0;
  let currentAnalyser = null;
  let durationTimer = null;
  let liveStartedAt = null;

  let ttsEnabled = false;
  let headphonesConnected = false;
  let savedTtsVoice = '';
  let flashDismissTimer = null;

  // ==================== AUDIO HELPERS ====================

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      if (!blob) { resolve(null); return; }
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result.split(',')[1] : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  async function captureScreenshot(stream) {
    try {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('video metadata timeout')), 5000);
        video.onloadedmetadata = () => { clearTimeout(timeout); video.play().then(resolve, resolve); };
      });
      const MAX_W = 960;
      const MAX_H = 540;
      const scale = Math.min(MAX_W / video.videoWidth, MAX_H / video.videoHeight, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      video.srcObject = null;
      return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
    } catch (err) {
      console.warn('[Screenshot] Failed:', err.message);
      return null;
    }
  }

  // ==================== FLASH / FEEDBACK ====================

  function showFlash(type, text) {
    const flash = $('feedback-flash');
    const flashText = $('flash-text');
    if (flashDismissTimer) {
      clearTimeout(flashDismissTimer);
      flashDismissTimer = null;
    }
    flash.className = 'feedback-flash';
    flash.classList.add(`flash-${type}`);
    flashText.textContent = text;
    flash.classList.add('show');
    flashDismissTimer = setTimeout(() => {
      flash.classList.remove('show');
      flashDismissTimer = null;
    }, 6000);
  }

  function hideEmptyState() {
    const emptyState = $('empty-state');
    if (emptyState) emptyState.style.display = 'none';
  }

  function feedTime(date) {
    return (date || new Date()).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }

  // One feed entry: a label row (type + time) over its body, newest first,
  // keeping the last 10.
  function pushFeedItem(type, label, timeStr, body) {
    hideEmptyState();
    const visualizer = $('audio-visualizer');
    if (visualizer) visualizer.classList.remove('is-listening');
    const container = $('feedback-container');

    const item = document.createElement('div');
    item.className = 'feedback-item p-settle';
    const header = document.createElement('div');
    header.className = 'feedback-header';
    header.appendChild(label);
    const timeSpan = document.createElement('span');
    timeSpan.className = 'feedback-time';
    timeSpan.textContent = timeStr;
    header.appendChild(timeSpan);
    item.appendChild(header);
    body.forEach((el) => item.appendChild(el));
    container.insertBefore(item, container.firstChild);

    feedbackItems.unshift({ type, time: timeStr });
    if (feedbackItems.length > 10) {
      feedbackItems.pop();
      if (container.children.length > 10) container.removeChild(container.lastChild);
    }
  }

  function addFeedback(type, text, short) {
    if (short) {
      showFlash(type, short);
      if (ttsEnabled && headphonesConnected) speakFeedback(short);
    }
    const typeSpan = document.createElement('span');
    typeSpan.className = `feedback-type type-${type}`;
    typeSpan.textContent = type === 'brutus' ? 'Brutus' : type;
    const textDiv = document.createElement('div');
    textDiv.className = 'feedback-text';
    textDiv.textContent = text;
    pushFeedItem(type, typeSpan, feedTime(), [textDiv]);
  }

  // A "say this" line that a newer card replaced stays readable in the feed.
  function addSayThisToFeed(card, shownAt) {
    const label = document.createElement('span');
    label.className = 'feedback-type type-say-this';
    const dot = document.createElement('span');
    dot.className = 'say-this-feed-dot';
    dot.setAttribute('aria-hidden', 'true');
    label.appendChild(dot);
    label.appendChild(document.createTextNode('Say this'));
    const line = document.createElement('div');
    line.className = 'feedback-text';
    line.textContent = card.line.trim();
    const body = [line];
    const reason = typeof card.why === 'string' ? card.why.trim() : '';
    if (reason) {
      const why = document.createElement('div');
      why.className = 'feedback-why';
      why.textContent = `why: ${reason}`;
      body.push(why);
    }
    pushFeedItem('say-this', label, feedTime(shownAt ? new Date(shownAt) : null), body);
  }

  function addChatMessage(sender, text) {
    hideEmptyState();
    const container = $('feedback-container');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;
    const label = document.createElement('div');
    label.className = 'chat-label';
    label.textContent = sender === 'user' ? 'you' : 'Brutus';
    messageDiv.appendChild(label);
    messageDiv.appendChild(document.createTextNode(text));
    container.insertBefore(messageDiv, container.firstChild);
    const messages = container.querySelectorAll('.chat-message, .feedback-item');
    if (messages.length > 15) container.removeChild(messages[messages.length - 1]);
  }

  function showPostCallSummary(analysis) {
    const score = analysis.overallScore || 0;
    const scoreClass = score >= 70 ? 'good' : score >= 50 ? 'warning' : 'bad';
    hideEmptyState();
    const visualizer = $('audio-visualizer');
    if (visualizer) visualizer.classList.remove('is-listening');
    const container = $('feedback-container');
    const item = document.createElement('div');
    item.className = 'feedback-item p-settle';
    const header = document.createElement('div');
    header.className = 'feedback-header';
    const typeSpan = document.createElement('span');
    typeSpan.className = 'feedback-type type-brutus';
    typeSpan.textContent = 'call complete';
    const scoreSpan = document.createElement('span');
    scoreSpan.className = `metric-value ${scoreClass}`;
    scoreSpan.textContent = `${score}/100`;
    header.appendChild(typeSpan);
    header.appendChild(scoreSpan);
    const roastDiv = document.createElement('div');
    roastDiv.className = 'feedback-text';
    roastDiv.textContent = analysis.overallRoast || 'call complete.';
    item.appendChild(header);
    item.appendChild(roastDiv);
    if (Array.isArray(analysis.actionItems) && analysis.actionItems.length) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'feedback-actions';
      actionsDiv.textContent = 'next: ' + analysis.actionItems.slice(0, 2).join(' · ');
      item.appendChild(actionsDiv);
    }
    container.insertBefore(item, container.firstChild);
  }

  // ==================== METRICS ====================

  function initAudioBars() {
    const visualizer = $('audio-visualizer');
    visualizer.innerHTML = '';
    visualizer.classList.add('is-listening');
    for (let i = 0; i < 32; i++) {
      const bar = document.createElement('div');
      bar.className = 'audio-bar';
      visualizer.appendChild(bar);
    }
  }

  function updateAudioBars(dataArray) {
    const bars = document.querySelectorAll('.audio-bar');
    let loud = false;
    bars.forEach((bar, i) => {
      const value = (dataArray && dataArray[i]) || 0;
      if (value > 8) loud = true;
      bar.style.height = Math.max(4, (value / 255) * 35) + 'px';
    });
    const visualizer = $('audio-visualizer');
    if (visualizer && !document.querySelector('.feedback-item')) {
      visualizer.classList.toggle('is-listening', !loud);
    }
  }

  function updateTalkRatio(ratio) {
    const el = $('talk-ratio');
    el.textContent = `${Math.round(ratio)}%`;
    el.className = 'metric-value ' + (ratio > 60 ? 'bad' : ratio > 45 ? 'warning' : 'good');
  }

  function updateInterrupts(count) {
    const el = $('interrupt-count');
    el.textContent = String(count);
    el.className = 'metric-value ' + (count > 3 ? 'bad' : count > 1 ? 'warning' : 'good');
  }

  function updateDuration() {
    if (!liveStartedAt) return;
    const elapsed = Math.floor((Date.now() - liveStartedAt) / 1000);
    $('duration').textContent =
      `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  }

  function startVisualization(analyser) {
    currentAnalyser = analyser;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frames = 0;
    const tick = () => {
      if (currentAnalyser !== analyser) return;
      analyser.getByteFrequencyData(data);
      updateAudioBars(data);
      const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
      if (avg > TALK_SILENCE_THRESHOLD) repTalkingFrames++;
      totalFrames++;
      if (++frames >= 300) {
        frames = 0;
        updateTalkRatio(Math.round((repTalkingFrames / totalFrames) * 100));
      }
      requestAnimationFrame(tick);
    };
    tick();
  }

  function stopVisualization() {
    currentAnalyser = null;
    updateAudioBars(null);
    if (durationTimer) { clearInterval(durationTimer); durationTimer = null; }
    liveStartedAt = null;
  }

  function resetMetrics() {
    feedbackItems = [];
    repTalkingFrames = 0;
    totalFrames = 0;
    $('talk-ratio').textContent = '--%';
    $('talk-ratio').className = 'metric-value';
    updateInterrupts(0);
    $('duration').textContent = '00:00';
    $('feedback-container').innerHTML =
      '<div class="empty-state" id="empty-state"><div class="empty-state-text">listening for your sales call...</div></div>';
  }

  // ==================== CONNECTION STATUS ====================

  function showConnection(state, stats) {
    const el = $('conn-status');
    const pending = stats ? stats.pending : 0;
    const lost = stats ? stats.lost : 0;
    let text = '';
    if (session.state === 'live' || session.state === 'stopping') {
      if (state === 'reconnecting') text = pending ? `reconnecting... ${pending} unsent` : 'reconnecting...';
      else if (state === 'offline') text = 'offline';
      else if (pending > 3) text = `sending ${pending}...`;
      if (lost) text += (text ? ' · ' : '') + `${lost} lost`;
    }
    el.textContent = text;
    el.hidden = !text;
  }

  // ==================== TTS ====================

  function updateTtsBtn() {
    const ttsBtn = $('tts-btn');
    ttsBtn.classList.toggle('locked', !headphonesConnected);
    ttsBtn.classList.toggle('active', ttsEnabled && headphonesConnected);
    ttsBtn.textContent = 'Enable Brutus speech';
  }

  async function checkHeadphonesConnected() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const keywords = ['headphone', 'headset', 'earbud', 'airpod', 'bud', 'earphone', 'wh-', 'wf-', 'wireless', 'bluetooth'];
      const found = devices
        .filter((d) => d.kind === 'audiooutput')
        .some((d) => keywords.some((k) => d.label.toLowerCase().includes(k)));
      const changed = found !== headphonesConnected;
      headphonesConnected = found;
      if (changed && !found && ttsEnabled) {
        ttsEnabled = false;
        showFlash('warning', 'headphones disconnected — audio off');
      }
      updateTtsBtn();
    } catch (err) {
      console.warn('[TTS] Could not enumerate devices:', err.message);
    }
  }

  let ttsCtxAudio = null;
  async function speakFeedback(text) {
    if (!savedTtsVoice || !session.sessionId) return;
    try {
      const response = await session.post('/tts', { text, voiceId: savedTtsVoice });
      if (!response.ok) return;
      const url = URL.createObjectURL(await response.blob());
      if (ttsCtxAudio) ttsCtxAudio.pause();
      ttsCtxAudio = new Audio(url);
      ttsCtxAudio.onended = () => URL.revokeObjectURL(url);
      ttsCtxAudio.play().catch(() => URL.revokeObjectURL(url));
    } catch (err) {
      console.warn('[TTS] Failed:', err.message);
    }
  }

  // One context for the whole window; a new one per ping leaks audio resources.
  let pingCtx = null;
  function playFeedbackPing() {
    try {
      if (!pingCtx || pingCtx.state === 'closed') pingCtx = new AudioContext();
      if (pingCtx.state === 'suspended') pingCtx.resume().catch(() => {});
      const osc = pingCtx.createOscillator();
      const gain = pingCtx.createGain();
      osc.connect(gain);
      gain.connect(pingCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, pingCtx.currentTime);
      gain.gain.setValueAtTime(0.08, pingCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, pingCtx.currentTime + 0.2);
      osc.start(pingCtx.currentTime);
      osc.stop(pingCtx.currentTime + 0.2);
    } catch (_) { /* audio output unavailable */ }
  }

  // ==================== CONSENT + SOURCE PICKER ====================

  let pendingConsent = null;
  let pendingPicker = null;

  // Recording-consent disclosure (audit BR-03): the call records a real third
  // party, so this runs before every session. Resolves false, or on "i have
  // consent" a record of what was accepted, which capture-session sends with
  // /live/start and the server keeps as consent evidence
  // (backend lib/consentRecords.js).
  // The notice says what this call will keep: a recording with video, an
  // audio-only recording, or (recording off) nothing beyond the transcript.
  //
  // Bump DISCLOSURE_VERSION whenever this wording or the notice in
  // overlay.html changes; test/consentNotice.test.js fails until you do.
  const DISCLOSURE_VERSION = 'REC-2026-11-12';
  let consentVariant = null;
  const CONSENT_COPY = {
    video: {
      body: 'brutus records and transcribes <strong>both sides</strong> of this call and saves the recording ' +
        'to your brutus account so you can watch it back. if you share a window, <strong>everything ' +
        'visible in that window is recorded too</strong>. at the start of the call, tell the other person ' +
        "they're being recorded and get their consent to continue.",
      note: 'recording starts when you continue. press record in the overlay to stop or restart it at any point. recordings are kept until you delete them.',
      picker: 'Brutus watches only this window, and the call recording includes what it shows. The call audio playing on this computer is recorded either way.'
    },
    audio: {
      body: 'brutus records and transcribes <strong>both sides</strong> of this call and saves an audio ' +
        'recording to your brutus account so you can listen back. the window you share is not recorded. ' +
        "at the start of the call, tell the other person they're being recorded and get their consent to continue.",
      note: 'recording starts when you continue. press record in the overlay to stop or restart it at any point. recordings are kept until you delete them.',
      picker: 'Brutus watches only this window; it is not recorded. The call audio playing on this computer is recorded either way.'
    },
    off: {
      body: 'brutus records and transcribes <strong>both sides</strong> of this call. at the start of ' +
        "the call, tell the other person they're being recorded and get their consent to continue.",
      note: 'call recording is off in settings: only the transcript is saved. press record in the overlay to record this call.',
      picker: 'Brutus watches only this window. The call audio playing on this computer is recorded either way.'
    }
  };

  function applyConsentCopy(settings) {
    const s = settings || {};
    const variant = s.recordCalls === false ? 'off' : (s.recordVideo === false ? 'audio' : 'video');
    const copy = CONSENT_COPY[variant];
    const body = $('consent-body');
    const note = $('consent-note');
    const picker = $('source-picker-subtitle');
    if (body) body.innerHTML = copy.body; // fixed strings above, never user data
    if (note) note.textContent = copy.note;
    if (picker) picker.textContent = copy.picker;
    consentVariant = variant;
  }

  const oneLine = (el) => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();

  // The notice exactly as the rep sees it at the click: label, title, body,
  // warning and note, one per line. The buttons go in `action`.
  function consentNoticeText() {
    const modal = $('consent-notice');
    if (!modal) return '';
    return Array.from(modal.children)
      .filter((el) => !el.classList.contains('consent-actions'))
      .map(oneLine)
      .filter(Boolean)
      .join('\n');
  }

  function consentEvidence(shownAt) {
    return {
      accepted: true,
      version: DISCLOSURE_VERSION,
      // 'default' if the click beat the settings load: the notice in
      // overlay.html, which matches the video wording.
      variant: consentVariant || 'default',
      text: consentNoticeText(),
      action: oneLine($('consent-accept')),
      shownAt,
      acceptedAt: new Date().toISOString()
    };
  }

  function showConsentNotice() {
    consentVariant = null;
    brutus.getSettings().then(applyConsentCopy).catch(() => {});
    return new Promise((resolve) => {
      const modal = $('consent-notice');
      const shownAt = new Date().toISOString();
      const finish = (value) => {
        modal.classList.remove('active');
        $('consent-accept').onclick = null;
        $('consent-decline').onclick = null;
        pendingConsent = null;
        resolve(value);
      };
      pendingConsent = finish;
      $('consent-accept').onclick = () => finish(consentEvidence(shownAt));
      $('consent-decline').onclick = () => finish(false);
      modal.classList.add('active');
    });
  }

  // Resolves the picked window's source id, or null for "call audio only".
  function showSourcePicker() {
    return new Promise((resolve) => {
      const modal = $('source-picker');
      const grid = $('source-picker-grid');
      const finish = (value) => {
        modal.classList.remove('active');
        $('source-picker-skip').onclick = null;
        pendingPicker = null;
        resolve(value);
      };
      pendingPicker = finish;
      $('source-picker-skip').onclick = () => finish(null);
      modal.classList.add('active');
      grid.innerHTML = '<div class="source-picker-loading">loading windows...</div>';

      brutus.getScreenSources().then((sources) => {
        if (pendingPicker !== finish) return;
        if (!Array.isArray(sources) || sources.length === 0) { finish(null); return; }
        grid.innerHTML = '';
        sources.forEach((source) => {
          const item = document.createElement('div');
          item.className = 'source-item';
          const img = document.createElement('img');
          img.src = source.thumbnail;
          img.alt = source.name;
          const label = document.createElement('div');
          label.className = 'source-item-name';
          label.textContent = source.name;
          item.appendChild(img);
          item.appendChild(label);
          item.addEventListener('click', () => finish(source.id));
          grid.appendChild(item);
        });
      }).catch((err) => {
        console.error('[SourcePicker] Failed:', err);
        if (pendingPicker === finish) finish(null);
      });
    });
  }

  function cancelPrompts() {
    if (pendingConsent) pendingConsent(false);
    if (pendingPicker) pendingPicker(null);
  }

  // ==================== SAY THIS CARD ====================

  const SAY_THIS_REVEAL_MS = 300; // the line streams in word by word over this
  const SAY_THIS_REVEAL_START_MS = 120; // once the card has mostly dropped in

  function renderSayThis(card) {
    const el = $('say-this-card');
    const line = $('say-this-line');
    const why = $('say-this-why');
    const words = card.line.trim().split(/\s+/);
    const step = words.length > 1 ? SAY_THIS_REVEAL_MS / (words.length - 1) : 0;
    line.textContent = '';
    words.forEach((word, i) => {
      if (i) line.appendChild(document.createTextNode(' '));
      const span = document.createElement('span');
      span.className = 'say-this-word';
      span.style.animationDelay = `${SAY_THIS_REVEAL_START_MS + Math.round(i * step)}ms`;
      span.textContent = word;
      line.appendChild(span);
    });
    const reason = typeof card.why === 'string' ? card.why.trim() : '';
    why.textContent = reason ? `why: ${reason}` : '';
    why.hidden = !reason;
    // Restart the entrance when a newer card replaces the one on screen.
    el.hidden = false;
    el.scrollTop = 0;
    el.classList.remove('is-entering');
    void el.offsetWidth;
    el.classList.add('is-entering');
  }

  function hideSayThis() {
    const el = $('say-this-card');
    el.hidden = true;
    el.classList.remove('is-entering');
  }

  const sayThisCard = window.BrutusSayThisCard.createSayThisCard({
    view: { show: renderSayThis, hide: hideSayThis, archive: addSayThisToFeed },
    post: (path, body) => session.post(path, body),
    sessionId: () => session.sessionId,
    ping: playFeedbackPing,
    log: (...args) => console.warn('[say-this]', ...args)
  });

  // ==================== SESSION ====================

  const session = window.BrutusCaptureSession.createCaptureSession({
    ipc: {
      getAuth: () => brutus.getAuth(),
      getSettings: () => brutus.getSettings(),
      setCaptureIntent: (intent) => brutus.setCaptureIntent(intent),
      recordingBegin: brutus.recordingBegin ? (request) => brutus.recordingBegin(request) : undefined,
      recordingData: (payload) => brutus.recordingData(payload),
      recordingEnd: (payload) => brutus.recordingEnd(payload),
      reportCaptureState: (state) => brutus.reportCaptureState(state),
      overlayStopped: (info) => brutus.overlayStopped(info),
      stopMonitoring: () => { brutus.stopMonitoring(); }
    },
    fetch: (url, init) => window.fetch(url, init),
    createWebSocket: (url) => new WebSocket(url),
    log: (...args) => console.log('[capture]', ...args),
    media: {
      getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
      getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
      createRecorder: (stream, mimeType, options) => new MediaRecorder(stream, Object.assign({ mimeType }, options || {})),
      createStream: (tracks) => new MediaStream(tracks),
      createBlob: (parts, type) => new Blob(parts, { type }),
      createAudioContext: () => new (window.AudioContext || window.webkitAudioContext)(),
      blobToBase64,
      captureScreenshot
    },
    ui: {
      consent: showConsentNotice,
      pickSource: showSourcePicker,
      // Called as a stop begins: the card goes with the consent and picker.
      cancelPrompts: () => {
        cancelPrompts();
        sayThisCard.clear();
      },
      resetMetrics,
      recording: showRecording,
      feedback: (type, text, short) => {
        addFeedback(type, text, short || null);
        if (type === 'brutus') playFeedbackPing();
      },
      chat: (sender, text) => {
        addChatMessage(sender, text);
        $('chat-send-btn').disabled = false;
      },
      connection: showConnection,
      // "say this" events, logged with their timing.
      onSayThis: (card, timing) => {
        console.log('[say-this] say_this', `${timing.sinceChunkMs}ms after its chunk was sent`, card);
        if (session.state === 'live') sayThisCard.show(card);
      },
      // Logged only: the card stays up until replaced, dismissed or stopped.
      onSayThisResolved: (info, timing) =>
        console.log('[say-this] say_this_resolved', `${timing.sinceChunkMs}ms after the latest chunk was sent`, info),
      onAwaitingRepReply: (info, timing) =>
        console.log('[say-this] awaiting_rep_reply', `${timing.sinceChunkMs}ms after its chunk was sent`, info),
      live: ({ analyser, screen, startedAt }) => {
        $('screen-capture-toggle').checked = !!screen;
        $('record-toggle').disabled = false;
        liveStartedAt = startedAt || Date.now();
        if (durationTimer) clearInterval(durationTimer);
        durationTimer = setInterval(updateDuration, 1000);
        startVisualization(analyser);
        addFeedback('insight', "monitoring started. let's see what you've got.");
      },
      stopped: (result) => {
        sayThisCard.clear();
        resetRecordToggle();
        stopVisualization();
        setStopping(false);
        showConnection('offline', null);
        const analysis = result && result.data && result.data.analysis;
        if (result && !result.ok) {
          addFeedback('critical', result.message || "Brutus couldn't save the call.");
        } else if (analysis) {
          showPostCallSummary(analysis);
          if (typeof analysis.talkRatio === 'number') updateTalkRatio(analysis.talkRatio);
          updateInterrupts(analysis.interruptionCount || 0);
        } else if (result && result.sessionId && !result.cancelled) {
          addFeedback('insight', 'session ended. review your results in the dashboard.');
        }
        const keepVisible = !result || !result.ok || KEEP_VISIBLE_REASONS.has(result.reason);
        if (!keepVisible) brutus.hideOverlay();
      }
    }
  });

  // ==================== RECORD BUTTON ====================
  // Each call starts recorded (when "Record calls" is on in Settings); the
  // rep can switch it off and on again at any point in the call. Off means the
  // rest of the call is not recorded until it is switched back on.

  const RECORDING_REFUSED = {
    off: 'recording is off in settings. press record to record this call.',
    disk: "not recording: this computer is almost out of disk space.",
    signed_out: "not recording: you're signed out.",
    error: "couldn't start the recording. press record to try again."
  };

  function setRecordToggle(on, opts) {
    const o = opts || {};
    const wrap = $('record-toggle-wrap');
    const box = $('record-toggle');
    // A server or build without recordings: no button at all.
    wrap.hidden = !!o.hide;
    box.checked = !!on;
    wrap.classList.toggle('is-blocked', !!o.blocked);
    const title = on
      ? 'recording this call. click to stop recording.'
      : (o.blocked ? o.blocked : 'not recording. click to record the rest of this call.');
    wrap.title = title;
    box.setAttribute('aria-label', on ? 'Recording this call. Stop recording' : 'Not recording. Record this call');
  }

  function resetRecordToggle() {
    const wrap = $('record-toggle-wrap');
    wrap.classList.remove('is-busy');
    $('record-toggle').disabled = true;
    setRecordToggle(false, { hide: true });
  }

  function showRecording(info) {
    const i = info || {};
    if (i.on) {
      setRecordToggle(true);
      if (i.toggled) addFeedback('insight', 'recording again.');
      else if (i.manual) addFeedback('insight', i.video ? 'recording the rest of this call (video of the shared window + audio).' : 'recording the rest of this call (audio only).');
      else addFeedback('insight', i.video ? 'recording this call (video of the shared window + audio).' : 'recording this call (audio only).');
      return;
    }
    if (i.toggled) {
      setRecordToggle(false);
      addFeedback('insight', "recording off. the rest of this call isn't recorded until you press record again.");
      return;
    }
    if (i.reason === 'unavailable' || i.reason === 'unsupported' || i.reason === 'invalid' || i.reason === 'refused') {
      setRecordToggle(false, { hide: true });
      return;
    }
    const text = RECORDING_REFUSED[i.reason] || RECORDING_REFUSED.error;
    setRecordToggle(false, { blocked: i.reason === 'off' ? null : text });
    addFeedback(i.reason === 'off' ? 'insight' : 'warning', text);
  }

  function setStopping(on) {
    $('close-btn').disabled = on;
    $('close-btn').classList.toggle('is-busy', on);
    $('hide-overlay-btn').disabled = on;
  }

  // ==================== CONTROLS ====================

  function wireControls() {
    $('say-this-close').addEventListener('click', () => { sayThisCard.dismiss(); });

    $('tts-btn').addEventListener('click', () => {
      if (!headphonesConnected) {
        showFlash('warning', 'connect headphones first');
        return;
      }
      ttsEnabled = !ttsEnabled;
      updateTtsBtn();
    });
    navigator.mediaDevices.addEventListener('devicechange', checkHeadphonesConnected);

    const recordToggle = $('record-toggle');
    recordToggle.addEventListener('change', async () => {
      const want = recordToggle.checked;
      if (session.state !== 'live') { recordToggle.checked = !want; return; }
      const wrap = $('record-toggle-wrap');
      recordToggle.disabled = true;
      wrap.classList.add('is-busy');
      try {
        recordToggle.checked = await session.setRecording(want);
      } finally {
        wrap.classList.remove('is-busy');
        recordToggle.disabled = session.state !== 'live';
      }
    });

    const screenToggle = $('screen-capture-toggle');
    screenToggle.addEventListener('change', async () => {
      if (session.state !== 'live') return; // takes effect at the next start
      screenToggle.disabled = true;
      try {
        screenToggle.checked = await session.setScreen(screenToggle.checked);
      } finally {
        screenToggle.disabled = false;
      }
    });

    $('ai-notes-toggle').addEventListener('change', (e) => {
      session.setAiNotes(e.target.checked);
      if (session.state === 'live') {
        addFeedback('insight', e.target.checked ? 'ai note-taking enabled' : 'ai note-taking disabled');
      }
    });

    const noteBtn = $('note-btn');
    const researchBtn = $('research-btn');
    const noteBox = $('note-input-container');
    const researchBox = $('research-input-container');
    const noteInput = $('note-input');
    const researchInput = $('research-input');

    noteBtn.addEventListener('click', () => {
      const opening = noteBox.classList.contains('hidden');
      researchBox.classList.add('hidden');
      researchBtn.classList.remove('active');
      noteBox.classList.toggle('hidden', !opening);
      noteBtn.classList.toggle('active', opening);
      if (opening) noteInput.focus();
    });

    researchBtn.addEventListener('click', () => {
      const opening = researchBox.classList.contains('hidden');
      noteBox.classList.add('hidden');
      noteBtn.classList.remove('active');
      researchBox.classList.toggle('hidden', !opening);
      researchBtn.classList.toggle('active', opening);
      if (opening) researchInput.focus();
    });

    async function sendNote() {
      const text = noteInput.value.trim();
      const sessionId = session.sessionId;
      if (!text || !sessionId) return;
      $('note-send-btn').disabled = true;
      try {
        const res = await session.post('/notes', { sessionId, content: text, type: 'manual', timestamp: Date.now() });
        if (!res.ok) throw new Error(`notes failed (${res.status})`);
        noteInput.value = '';
        noteBox.classList.add('hidden');
        noteBtn.classList.remove('active');
        addFeedback('good', 'note saved');
      } catch (err) {
        console.error('Failed to save note:', err);
        addFeedback('warning', 'failed to save note');
      } finally {
        $('note-send-btn').disabled = false;
      }
    }

    async function sendResearch() {
      const query = researchInput.value.trim();
      const sessionId = session.sessionId;
      if (!query || !sessionId) return;
      $('research-send-btn').disabled = true;
      try {
        const res = await session.post('/research', { sessionId, query, requestedAt: Date.now() });
        if (!res.ok) throw new Error(`research failed (${res.status})`);
        researchInput.value = '';
        researchBox.classList.add('hidden');
        researchBtn.classList.remove('active');
        addFeedback('insight', `researching "${query}"... results will appear in dashboard`);
      } catch (err) {
        console.error('Failed to request research:', err);
        addFeedback('warning', 'failed to request research');
      } finally {
        $('research-send-btn').disabled = false;
      }
    }

    $('note-send-btn').addEventListener('click', sendNote);
    noteInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendNote(); });
    $('research-send-btn').addEventListener('click', sendResearch);
    researchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendResearch(); });

    const chatInput = $('chat-input');
    const chatSendBtn = $('chat-send-btn');
    function sendChat() {
      const message = chatInput.value.trim();
      if (!message) return;
      chatInput.value = '';
      addChatMessage('user', message);
      if (session.sendChat(message)) {
        chatSendBtn.disabled = true;
      } else {
        addFeedback('warning', 'not connected to Brutus. try again in a moment.');
      }
    }
    chatSendBtn.addEventListener('click', sendChat);
    chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });

    $('hide-overlay-btn').addEventListener('click', () => {
      if (session.state === 'stopping') return;
      brutus.hideOverlay();
    });

    // X ends the session (if any) and closes the overlay.
    $('close-btn').addEventListener('click', () => {
      if (session.state === 'stopping') return;
      if (session.state === 'idle') {
        brutus.hideOverlay();
        return;
      }
      setStopping(true);
      brutus.stopMonitoring();
    });

    wireGestures();
  }

  // Frameless window with GPU acceleration off: -webkit-app-region drag does
  // not move the window. The header and edges start a main-process cursor
  // follow that calls setPosition / setBounds until the button is released.
  function wireGestures() {
    let gesturing = false;
    let moved = false;
    let origin = null;

    const begin = (mode, edge) => {
      gesturing = true;
      moved = false;
      brutus.beginOverlayGesture(mode, edge || '');
    };
    const end = () => {
      if (!gesturing) return;
      gesturing = false;
      brutus.endOverlayGesture();
    };

    const header = document.querySelector('.overlay-header');
    if (header) {
      header.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.target.closest('button, a, input, label, select, textarea')) return;
        event.preventDefault();
        origin = { x: event.screenX, y: event.screenY };
        begin('move');
      });
    }

    document.querySelectorAll('[data-edge]').forEach((el) => {
      el.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        origin = { x: event.screenX, y: event.screenY };
        begin('resize', el.getAttribute('data-edge'));
      });
    });

    document.addEventListener('pointermove', (event) => {
      if (!gesturing || !origin) return;
      const dx = event.screenX - origin.x;
      const dy = event.screenY - origin.y;
      if ((dx * dx) + (dy * dy) > 9) moved = true;
    });

    document.addEventListener('pointerup', (event) => {
      if (event.button !== 0) return;
      const wasMoved = moved;
      end();
      origin = null;
      if (!wasMoved) return;
      const blockClick = (clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        document.removeEventListener('click', blockClick, true);
      };
      document.addEventListener('click', blockClick, true);
      setTimeout(() => {
        moved = false;
        document.removeEventListener('click', blockClick, true);
      }, 0);
    });

    document.addEventListener('mouseup', (event) => {
      if (event.button !== 0) return;
      end();
      origin = null;
    });
  }

  // ==================== INIT ====================

  async function refreshVoice() {
    try {
      const settings = await brutus.getSettings();
      savedTtsVoice = (settings && settings.ttsVoice) || '';
    } catch (_) { /* keep the previous voice */ }
  }

  function init() {
    initAudioBars();
    wireControls();
    updateTtsBtn();

    // Listeners first, then tell main we're ready, so a Start requested while
    // this page was loading is delivered exactly once.
    brutus.onMonitoringStarted(() => {
      refreshVoice();
      checkHeadphonesConnected();
      session.start({ screen: $('screen-capture-toggle').checked });
    });
    brutus.onMonitoringStopped((payload) => {
      if (session.state === 'live') setStopping(true);
      session.stop({ mode: payload && payload.mode, reason: payload && payload.reason });
    });
    brutus.overlayReady();

    refreshVoice();
    checkHeadphonesConnected();
  }

  init();
})();
