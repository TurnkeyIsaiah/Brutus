'use strict';

// The recording notice's wording is saved with every "i have consent" as
// evidence, under DISCLOSURE_VERSION (renderer/overlay.js). These tests make a
// wording change impossible to ship without a new version.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const plain = (html) => squash(html.replace(/<[^>]+>/g, ''));

const overlayJs = read('renderer/overlay.js');
const overlayHtml = read('renderer/overlay.html');

function copyBlock() {
  const start = overlayJs.indexOf('const CONSENT_COPY = {');
  const end = overlayJs.indexOf('function applyConsentCopy');
  assert.ok(start > 0 && end > start, 'CONSENT_COPY moved: update this test');
  return overlayJs.slice(start, end);
}

function noticeHtml() {
  const start = overlayHtml.indexOf('<div class="consent-overlay"');
  const end = overlayHtml.indexOf('<!-- Source Picker Modal');
  assert.ok(start > 0 && end > start, 'the consent notice moved: update this test');
  return overlayHtml.slice(start, end);
}

// Pinned fingerprint of the wording for the current version. When you change
// the notice: bump DISCLOSURE_VERSION in overlay.js, then copy the new
// version and fingerprint from the failure message into PINNED.
const PINNED = { version: 'REC-2026-11-12', fingerprint: '040e9fb8e115a498' };

test('changing the recording notice wording needs a new DISCLOSURE_VERSION', () => {
  const version = (/const DISCLOSURE_VERSION = '([^']+)'/.exec(overlayJs) || [])[1];
  const fingerprint = crypto.createHash('sha256')
    .update(squash(copyBlock()) + '\n' + squash(noticeHtml()))
    .digest('hex').slice(0, 16);
  assert.deepEqual({ version, fingerprint }, PINNED,
    'the recording notice changed: bump DISCLOSURE_VERSION in renderer/overlay.js, then set PINNED to ' +
    JSON.stringify({ version, fingerprint }));
});

test('the notice before settings load is the video wording, so either variant is accurate', () => {
  const literal = copyBlock().replace(/^const CONSENT_COPY = /, '').trim().replace(/;$/, '');
  const copy = new Function(`return (${literal});`)(); // our own source file
  const html = noticeHtml();
  const body = /<div class="consent-body" id="consent-body">([\s\S]*?)<\/div>/.exec(html)[1];
  const note = /<div class="consent-note" id="consent-note">([\s\S]*?)<\/div>/.exec(html)[1];
  assert.equal(plain(body), plain(copy.video.body));
  assert.equal(plain(note), plain(copy.video.note));
});
