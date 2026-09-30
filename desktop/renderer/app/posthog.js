// PostHog product analytics for the Brutus web app (app.brutusai.coach).
// Project API key is a public, client-side key by design — safe to ship in the browser.
// US Cloud: ingestion at us.i.posthog.com, static assets at us-assets.i.posthog.com.
// NOTE: vercel.json's CSP must allow these hosts (script-src + connect-src).
//
// The cookie is written to .brutusai.coach (posthog-js's default for this
// domain), so a visitor arriving from www.brutusai.coach keeps the same distinct
// ID here. Calling brutusIdentify() after auth then attaches that whole
// pre-account history — marketing pageviews included — to the real user.
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

(function () {
  'use strict';

  var host = window.location.hostname;
  var isInternal = host === 'localhost' || host === '127.0.0.1' || host === '' ||
    window.location.protocol === 'file:' || /\.vercel\.app$/.test(host);

  posthog.init('phc_s84jHnTbwgcoLE3udWZdziuqvMe2SCxDqAB2zKHCzckw', {
    api_host: 'https://us.i.posthog.com',
    defaults: '2025-05-24',
    // Matches the marketing site. Visitors browse /login.html and /signup.html
    // before they have an account, and those visits are the top of the funnel,
    // so they need person profiles to be analysable.
    person_profiles: 'always'
  });

  // Tag every event with the surface so web vs desktop vs marketing can be split.
  posthog.register({ app: 'web', surface: 'web' });
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
