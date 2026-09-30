// PostHog product analytics for the Brutus desktop app (bundled main window).
// Project API key is a public, client-side key by design.
//
// The SDK is the local bundle array.full.no-external.js (loaded by the page
// before this file), and external dependency loading is off, so no analytics
// code is ever downloaded into this window. Only events go to us.i.posthog.com.
//
// Session replay and autocapture stay on, but every piece of on-screen text and
// every input is masked: call transcripts, notes and prospect names never leave
// the app through analytics.
(function () {
  'use strict';

  if (!window.posthog || typeof window.posthog.init !== 'function') return;
  var posthog = window.posthog;

  // Dev builds (npm start) are internal; installed builds are real users.
  var appInfo = (window.brutus && window.brutus.appInfo) || {};
  var isInternal = !appInfo.packaged;

  posthog.init('phc_s84jHnTbwgcoLE3udWZdziuqvMe2SCxDqAB2zKHCzckw', {
    api_host: 'https://us.i.posthog.com',
    defaults: '2025-05-24',
    person_profiles: 'always',
    disable_external_dependency_loading: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*'
    }
  });

  // Tag every event with the surface so web vs desktop vs marketing can be split.
  posthog.register({ app: 'desktop', surface: 'desktop', app_version: appInfo.version || null });
  if (isInternal) {
    posthog.register({ $internal_or_test_user: true });
    posthog.setPersonProperties({ $internal_or_test_user: true });
  }

  /**
   * Link the anonymous browser identity to a real user. Call after any response
   * that tells us who is signed in — signup, login, or session restore.
   *
   * Without this, server events (which use the internal user UUID) and browser
   * events (which use the anonymous cookie ID) describe two different people,
   * and every visit-to-signup funnel reports 0%.
   *
   * Only non-PII properties are sent: analytics identifies users by UUID, and
   * email and name deliberately stay out of the project.
   */
  window.brutusIdentify = function (user) {
    if (!user || !user.id) return;
    try {
      posthog.identify(String(user.id), {
        email_verified: user.emailVerified === true
      });
    } catch (err) {
      /* analytics is never load-bearing */
    }
  };

  /** Drop the identity on logout so a shared machine doesn't merge two people. */
  window.brutusReset = function () {
    try {
      posthog.reset();
    } catch (err) {
      /* analytics is never load-bearing */
    }
  };

  /**
   * The visitor's anonymous PostHog ID, or null once they are a known user.
   *
   * posthog-js seeds distinct_id from $device_id and only changes distinct_id on
   * identify(), so distinct_id === $device_id means "still anonymous".
   *
   * Sent with signup and login so the *server* performs the merge. The browser
   * also calls identify(), but that request can be cancelled by the redirect
   * that follows it, and a second identify() would be a no-op because the SDK
   * already considers itself identified — so the merge would be lost for good.
   * The server-side path cannot be cancelled by a navigation.
   */
  window.brutusAnonymousId = function () {
    try {
      var distinctId = posthog.get_distinct_id();
      var deviceId = posthog.get_property('$device_id');
      return distinctId && deviceId && distinctId === deviceId ? distinctId : null;
    } catch (err) {
      return null;
    }
  };

  window.brutusTrack = function (event, properties, options) {
    try {
      posthog.capture(event, properties || {}, options);
    } catch (err) {
      /* analytics is never load-bearing */
    }
  };

  // For events captured immediately before the page goes away — every checkout
  // in this app ends in `window.location.href = <Stripe URL>`. PostHog batches
  // over XHR and the browser cancels in-flight XHR when the document is torn
  // down, so a plain capture() before a redirect arrives only sometimes.
  // sendBeacon is the transport built to outlive the page.
  window.brutusTrackBeforeNavigate = function (event, properties) {
    window.brutusTrack(event, properties, {
      transport: 'sendBeacon',
      send_instantly: true
    });
  };
})();
