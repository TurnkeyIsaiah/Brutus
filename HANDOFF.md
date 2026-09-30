# Brutus redesign handoff

Read this file first. It is the live redesign handoff for Astra 6. Update it at the end of every task.

## For Astra 6

This file is the review handoff. Astra 6 reviews this redesign: the web app and the desktop app. Astra 6 will not use Claude Code for that review. Claude is reserved for a later motion-design demo video of the marketing site. That video is not part of this app review. The website design is still unfinished in Paper, and `website/` stays out of scope until that design is done. Do not start the video.

Isaiah asked for this redesign to go live on September 30, 2026. The web app and the API changes it needs are committed on `main` in `Brutus-private` and deploy from that branch. The desktop app is release `v1.4.0`. The marketing site in `website/` was not part of that ship. Do not commit further work unless Isaiah asks.

## How to use this doc

Astra 6 reads this file first, in either repo, before the review. Coding agents read it before changing code.

Isaiah is not an engineer. Run the tests. Click through the app. Find bugs. Do not ask him to explain this file.

Do not commit unless Isaiah asks. Do not push. Do not revert product code unless he asks.

Do not touch `website/`.

After every task, add a dated line to the Changelog at the bottom of this file.

## Two repos

The files have diverged. Never copy one `app.js` or `paper.css` over the other. Edit each copy in place.

Web and backend: `C:\Users\isaia\Projects\Brutus-private`. Branch `main`, commit `47745bd`, tracking `origin/main`.

Desktop: `C:\Users\isaia\Downloads\brutus`. Branch `main`, commit `3c36d2e`, tracking `origin/main`.

The desktop main window loads `desktop/renderer/app/index.html` with `loadFile` (`desktop/src/main.js`). It must not load `https://app.brutusai.coach`. That URL is only for the external dashboard (`shell.openExternal`) and a stored `appUrl` setting. The window does not use it.

`C:\Users\isaia\Projects\Brutus-private\HANDOFF.md` is a different, committed build log for a finished feature (archive cold calls, notes transcripts). It was left in place. It is not this redesign handoff. Do not overwrite it.

## What this rebuild is

The design is the Paper file Noble lemon. Extracts live in `C:\Users\isaia\Projects\Brutus-private\docs\paper-extract`. Slice notes live in `docs/redesign-agent-prompts.md`.

Typeface: Gideon Roman.

Colors: `#000000`, `#0B0A0A`, `#171414`, `#FF6550`, `#FF8A78`, `#FFF8EF`.

Google and Apple buttons stay visual. `#oauth-google` and `#oauth-apple` have no click handler. No OAuth backend.

No new prices. Starter is the existing $10/month plan, 500,000 tokens.

## How to run

Web preview: from `C:\Users\isaia\Projects\Brutus-private`, run `node frontend/preview-proxy.mjs`. Open `http://127.0.0.1:4174/index.html`.

The proxy serves `frontend/` and proxies API calls to `https://api.brutusai.coach`. It rewrites `Origin` to `https://app.brutusai.coach`.

On port 4174, `frontend/config.js` sets `window.BRUTUS_API_URL` to `window.location.origin`. Do not point 4174 at `localhost:3001`.

`frontend/app.js` and `desktop/renderer/app/app.js` keep a set API URL, including an empty string: `(window.BRUTUS_API_URL != null) ? window.BRUTUS_API_URL : 'https://api.brutusai.coach'`. Do not use `window.BRUTUS_API_URL || production`. An empty string must stay empty.

Desktop: quit the old window first. The app has a single-instance lock. Then, in `C:\Users\isaia\Downloads\brutus\desktop`, run `npm start`.

Tests: from `C:\Users\isaia\Projects\Brutus-private`, run `node --test frontend/test/*.test.js`.

## Rollback

Nothing in this redesign is committed on `main`. There is no redesign commit to reset to. Uncommitted work is the only copy of the redesign.

Desktop HEAD is `3c36d2e` (Bump release workflow to Node 22). Web HEAD is `47745bd` (Merge pull request #42 from TurnkeyIsaiah/cursor/posthog-conversion-funnel-instrumentation-ada9).

To see what a checkout would discard: `git diff --stat`.

To undo one tracked file: `git checkout -- path`. That discards uncommitted work in that file.

`git checkout` does not delete untracked files. The new Paper UI is mostly untracked. Deleting those paths is a separate step. Do not delete them unless Isaiah asks.

Desktop status, run Saturday, Sep 26, 2026:

```
## main...origin/main
 M desktop/assets/Brutus icon.png
 M desktop/assets/Brutus tray-icon.png
 M desktop/assets/icon.ico
 M desktop/assets/icon.png
 M desktop/assets/tray-icon.png
 M desktop/renderer/main.html
 M desktop/renderer/overlay.html
 M desktop/src/main.js
 M desktop/src/preload.js
?? HANDOFF.md
?? desktop/assets/icon.icns
?? desktop/renderer/app/
```

Tracked diff: 9 files, 1304 insertions, 2190 deletions. `desktop/renderer/app/` is untracked. That folder is the bundled Paper UI.

Web status, same day:

```
## main...origin/main
 M backend/src/routes/calls.js
 M backend/src/routes/user.js
 M frontend/app.js
 M frontend/config.js
 M frontend/index.html
?? docs/paper-extract/
?? docs/redesign-agent-prompts.md
?? frontend/brutus-mascot.jpg
?? frontend/brutus-mascot.png
?? frontend/favicon.ico
?? frontend/favicon.png
?? frontend/paper-ui.js
?? frontend/paper.css
?? frontend/preview-proxy.mjs
?? frontend/test/
```

Tracked diff: 5 files, 2430 insertions, 3866 deletions. `paper.css`, `paper-ui.js`, the preview proxy, and `frontend/test/` are untracked.

## Done in this session

Paper screens are in the page and wired to the existing API handlers in `frontend/` and in `desktop/renderer/app/`. They were not fully click-verified while signed in.

A sidebar click while a call is open calls `closeCallModal()` (`app.js`, when the click is inside `.p-sidebar`).

The Notes tab UI reads `notes`, `aiSummary`, and `keyFollowUp`. The uncommitted `backend/src/routes/calls.js` sends those fields. The live API does not, until that file is on `main` and production deploys. Production is the VPS workflow `.github/workflows/deploy-production.yml`. It is not Railway. That deploy was not done.

Transcript click-to-seek runs only when a turn has a real time (`paperOffsetFromValue`, button `.p-ts-jump`). A plain transcript string with no time does not jump.

Desktop overlay: drag from the header (`.overlay-header`). Resize from the edge handles (`[data-edge]`). Opacity is the in-app slider `#desktop-overlay-opacity`.

Settings is an in-app page, `#settings-view`, above Profile.

Desktop nav `#nav-settings` starts hidden and is shown when `window.brutus` exists. The page has API URL, launch on startup, overlay opacity, audio feedback, minimum feedback interval, TTS voice, and invert background color. Invert is stored in electron-store as `settings.whiteBackground`, not in localStorage. The tray Settings item calls `openInAppSettings()` and clicks `#nav-settings`. `show-settings` still opens the old `desktop/renderer/main.html` popup. Nothing in the renderer calls it.

Web Settings is invert background color only (`#white-background`). The class is `html.p-white-bg`. The flag is `localStorage` key `brutusWhiteBackground` (`1` on, anything else off). `frontend/index.html` applies the class before paint.

The homepage date is the local clock (`new Date().toLocaleDateString` in `app.js`).

The homepage scrolls as a page (`.view.active` is `overflow-y: auto`, `.p-home-main` is `flex: 0 0 auto`). Recent calls (`.p-home-rows`) and Ask Brutus (`.p-rail`) each have their own scrollbar.

White mode class is `p-white-bg`. In that mode, Start roleplay (`.p-rp-start`) stays orange (`#FF6550` on `#FFF8EF`). Plan with Brutus bubbles (`.p-rp-plan-messages .message-content`) are white (`#FFFFFF`, ink `#161311`).

Invert background should be the homepage search-bar beige, not pure white. Pure white makes Lil Brutus look wrong. That beige is `#F4EFE8`. It is already in the working tree: `html.p-white-bg` and `html.p-white-bg body` set `background-color: #F4EFE8` in both `frontend/paper.css` and `desktop/renderer/app/paper.css`, the same fill as `html.p-white-bg .p-search`. Dark mode stays black.

Desktop icons are the Paper bust: coral field, white engraved head with a laurel. Changed files: `desktop/assets/icon.png`, `icon.ico`, `tray-icon.png`, `Brutus icon.png`, `Brutus tray-icon.png`, and untracked `icon.icns`.

Chat mascot swap has landed. `.p-chat-decal` uses `url("brutus-mascot.png")` in both `frontend/paper.css` and `desktop/renderer/app/paper.css`. The PNG is `frontend/brutus-mascot.png` and `desktop/renderer/app/brutus-mascot.png`. White mode sets `mix-blend-mode: multiply` on that decal. It is a still image. It is not animated.

## Later, do not build during the redesign

Do not build a new call-recording product during this pass.

"Show call recording" is already wired. The click handler in `paper-ui.js` unhides `#call-recording-panel` and tries to play audio when a URL is present (`rec.src`, `rec.url`, `call.audioUrl`, or `call.recordingUrl`). `docs/redesign-agent-prompts.md` still says the button does nothing. That line is behind the code. Do not extend the panel until the redesign works end to end.

Do not animate the colored chat mascot until the redesign works. When that animation is built, it will use anime.js. Isaiah installed it. It is not wired, and `desktop/package.json` does not list it. Stills are already saved in `frontend/` and `desktop/renderer/app/`, and they are not wired: `brutus-mascot.png` (colored bust on screen), `brutus-mascot-laptop.png` (sitting, headphones, laptop), `brutus-mascot-notes.png` (standing, grumpy, notepad), `brutus-mascot-shadowbox.png` (shadowboxing). Animation waits until the redesign is done.

## Known gaps for the test pass

Signed-in click-through was not finished. The agents had no password, so live API data was not clicked through.

Electron mic and a real live session were not run. Consent can show before audio. `POST /live/start` was not exercised.

The notes list stays empty on the live API until `backend/src/routes/calls.js` ships through `.github/workflows/deploy-production.yml`.

Calls saved as plain transcript text cannot jump to a time. Seek needs a real offset on the turn.

`frontend/login.js`, `signup.js`, `forgot-password.js`, `reset-password.js`, and `verify-email.js` still use `window.BRUTUS_API_URL || 'https://api.brutusai.coach'`. A blank API URL on those pages becomes production. `desktop/renderer/app/forgot-password.js` does the same. `app.js` does not.

Home outcome pills read `call.outcome` in `paperActivityRow`. Uncommitted `backend/src/routes/user.js` adds `outcome` and `interruptionCount` to `GET /user/dashboard` recent calls. That change is not deployed. On the live API the pills stay "not logged". The same select has no contact name, so the row name falls back to "Call".

The desktop bundle does not ship `login.html`, `verify-email.html`, `reset-password.html`, or `credits-success.html`. It does ship `desktop/renderer/app/forgot-password.html`. Verification links, password-reset links, and Stripe return URLs still land on the website if the backend builds those URLs.

Homepage stat boxes (average score, close rate, average talk ratio, calls analyzed) are the Noble Lemon Home iPhone cards from Paper page "Brutus Mobile App — Core Flow" (Home App Shell / Home iPhone). Both `frontend/paper.css` (Brutus-private) and `desktop/renderer/app/paper.css` use them. Fill `#F2EEE514`, radius 16px, padding 13px 12px, no stroke. Row gap 9px. Selectors: `.p-stat-strip`, `.p-stat`, `.p-home-chartblock`, `.p-home-recent`, `.p-rail`, and homepage-only `.p-main:has(#dashboard-view.active) > .p-topbar` so the line under the search bar is gone only while Home is active. The line between Ask Brutus (`.p-rail`) and weekly performance is gone (left border 0). White mode: those boxes use `#FFFFFF` with dark text (score black, label `#403832`, close rate `#C63B2A`), still no borders. The PID 4064 restart should already include those homepage cards and the beige invert background, pending Isaiah looking at the window.

Sunday, Sep 27, 2026: Desktop Spawn Lil Brutus click was already wired. The window was created behind the focused main window, and a transparent window never painted because the GPU is off. It now opens an opaque always-on-top 168×95 window and raises it above the main window. Files: `desktop/src/main.js`, `desktop/renderer/lil-brutus.html`. Last running Electron PID 4064. Log: `[lil-brutus] toggle true fromMain true` and `window shown {"x":1340,"y":578,"width":168,"height":98}`. Click again hides it. Do not claim a later user retest; Isaiah has not confirmed yet.

## Open questions

`appUrl` is still saved in electron-store and still edited in `desktop/renderer/main.html`. The main window always `loadFile`s `desktop/renderer/app/index.html`. It is unclear whether `appUrl` should stay, drive only the external dashboard, or be removed.

Start Monitoring clears `sessionMode` (`setSessionMode(null)` in `paper-ui.js`, and `store.delete('sessionMode')` in `main.js`) so a leftover flag cannot open the overlay in cold-call or roleplay. Roleplay runs in the main window. Nothing in the Paper UI sets overlay session mode.

## Standing rules

Do not invent screens or copy. Use `docs/paper-extract` and the text already in the page.

Do not commit unless Isaiah asks. Do not push. Do not deploy.

Do not touch `website/`. The marketing site design is still unfinished in Paper. Claude's motion-design demo video of that site waits until the design is done. Do not start the video.

After every change, add a dated line to the Changelog below.

## Changelog

- Saturday, Sep 26, 2026: Handoff created from the uncommitted redesign.
- Saturday, Sep 26, 2026: Spawn Lil Brutus toggles the chat mascot and sits above Tokens and Settings.
- Saturday, Sep 26, 2026: Discipline section text now comes from the user's coaching data when the API has it.
- Saturday, Sep 26, 2026: Brutus chat, roleplay plan/start, and live coaching feedback now call the existing API. A 403 opens the credits screen with the API message.
- Sunday, Sep 27, 2026: chat mascot sized back to the Paper decal.
- Sunday, Sep 27, 2026: Lil Brutus stays across pages and, on desktop, can be dragged outside the window.
- Sunday, Sep 27, 2026: Floating Lil Brutus. Web: one `#lil-brutus`, `position: fixed`, 168×95; `localStorage` `brutusLilBrutus` (1 shown, 0 hidden, missing = shown) and `brutusLilBrutusPos` `{x,y}`; cannot leave the browser; white mode uses `mix-blend-mode: multiply` only under `html.p-white-bg`. Desktop: Spawn opens a small always-on-top frameless window of `brutus-mascot.png` (no color invert); drag uses the overlay cursor-follow loop in `desktop/src/main.js` because GPU is disabled; position is electron-store `settings.lilBrutusPos`. Spawn off hides the window. Hiding or closing the main window hides him. Quitting closes him. The chat page does not draw a second `.p-chat-decal`.
- Sunday, Sep 27, 2026: Spawn Lil Brutus stays clickable when the discipline line is long (the footer no longer gets clipped), and the desktop show/hide choice is stored in electron-store `settings.lilBrutusVisible`.
- Sunday, Sep 27, 2026: Homepage sections are Home iPhone cards (16px radius, fill `#F2EEE514`, no stroke) on web and desktop. Stats, weekly performance, recent calls, and Ask Brutus. The rule under the search bar is gone on the homepage only. White mode uses a white fill.
- Sunday, Sep 27, 2026: Spawn Lil Brutus opens an opaque window above the main window. It was being created and toggled, but it stayed behind the focused window, so the click looked dead.
- Sunday, Sep 27, 2026: Inverted page background is the homepage search-bar beige (#F4EFE8) instead of pure white, in the web app and the desktop renderer. Dark mode stays black.
- Sunday, Sep 27, 2026: Review audience is Astra 6 for the web app and the desktop app. Claude Code is not the reviewer. Claude is reserved for a later motion-design demo video of the marketing site. The website design is still unfinished in Paper, so `website/` stays out of scope and the video has not been started. Nothing in this redesign is committed. Rollback is `git checkout` of uncommitted files. Do not commit unless Isaiah asks.
- Sunday, Sep 27, 2026: Lil Brutus animation will use anime.js (Isaiah installed it). Stills are saved and not wired, in `frontend/` and `desktop/renderer/app/`: `brutus-mascot.png` (colored bust on screen), `brutus-mascot-laptop.png` (sitting, headphones, laptop), `brutus-mascot-notes.png` (standing, grumpy, notepad), `brutus-mascot-shadowbox.png` (shadowboxing). Animation waits until the redesign is done. `desktop/package.json` does not list anime.js.
- Sunday, Sep 27, 2026: Homepage stat boxes (average score, close rate, average talk ratio, calls analyzed) should be colored rounded cards like the Noble Lemon mobile Paper design, with no divider lines. Also remove the line under the search bar and the line between Ask Brutus and weekly performance. Requested earlier the same day, when both `paper.css` files still used the divider strip. That note is superseded: the cards are now in both stylesheets.
- Sunday, Sep 27, 2026: Homepage cards are now in both stylesheets (`frontend/paper.css` and `desktop/renderer/app/paper.css`).
- Sunday, Sep 27, 2026: Corrected the Spawn note and the homepage restart note. The click was already wired; PID 4064 raises an opaque always-on-top window. Isaiah has not confirmed. That restart already includes the homepage cards and the beige invert background.
- Sunday, Sep 27, 2026: Sidebar footer stays on screen. A long discipline line was pushing Spawn, Tokens, Settings, and Profile past the viewport, and `.p-app { overflow: clip }` hid them with no scrollbar. The discipline block scrolls first; the nav scrolls only if the window is still short. Same rules in both `paper.css` files. Homepage cards unchanged.
- Sunday, Sep 27, 2026: Calls list uses the homepage cards (16px radius, fill `#F2EEE514`, no stroke, 9px row gap) on web and desktop. Filter row and each call row. Day-divider lines are gone. White mode uses a white fill. Call detail, home, and the search-bar rule are unchanged.
- Sunday, Sep 27, 2026: Lil Brutus no longer grows while dragged, and the flat plate behind him is gone. Drag only changes x,y; width and height stay the Paper box. White mode no longer uses mix-blend-mode multiply, so the costume is fully opaque on the web and desktop. Desktop window stays visible and always on top. PID 26584. Log: `[lil-brutus] window shown {"x":856,"y":472,"width":168,"height":96}`.
- Sunday, Sep 27, 2026: Two Lil Brutus figures on screen are the web page's one draggable `#lil-brutus` and the desktop always-on-top window (PID 26584). The chat view has no second image, and the desktop page has no in-app mascot. Nothing was deleted.
- Sunday, Sep 27, 2026: Removed the stuck web-page Lil Brutus. Dragging that figure selected the text underneath and it stayed put. Spawn on the web preview is off. The desktop always-on-top window is the one that remains; a drag moved it with the cursor. No code change. PID 26584.
- Sunday, Sep 27, 2026: The visual redesign is accepted. anime.js motion has started. Lil Brutus changes pose from a click, roleplay start, monitoring start, and a slow timer, with stand-up / sit-down transitions, not from navigation. The sidebar slides when it collapses or expands.
- Monday, Sep 28, 2026: Ask Brutus (`.p-rail`) stretches to the bottom of the homepage row on web and desktop. `max-height: 400px` is now `height: 0; min-height: 100%`. The card scroll, recent-calls scroll, and page scroll stay. Preview height was 566px with no gap below the card. Desktop restarted, PID 25952.
- Monday, Sep 28, 2026: Lil Brutus stays where he is dropped. The idle bob is a reversing translateY inside the window (web: `#lil-brutus` `.p-lil-bob`; desktop: the mascot canvas), so it no longer writes screen y or `settings.lilBrutusPos` / `brutusLilBrutusPos`. Clip no longer logs every frame. A broken launch console (EPIPE on stdout/stderr) does not open an Electron error dialog.
- Monday, Sep 28, 2026: While Lil Brutus is shadowboxing he throws punches on a loop (guard, left jab, guard, right cross) with anime.js, on the web app and the desktop app. Stills are `mascot-frames/punch-jab.png` and `mascot-frames/punch-cross.png`; the existing shadow still is the guard. The loop stops when a pose transition starts. Desktop restarted, PID 7724. On http://127.0.0.1:4174 the image src cycled `shadow.png`, `punch-jab.png`, `shadow.png`, `punch-cross.png`, then back to `shadow.png`.
- Monday, Sep 28, 2026: Shadowboxing cross redrawn as a left cross. The old `punch-cross.png` stuck the rear arm out to the side. The new fist travels across the chest and ends in front of the center of the body, other hand in guard. `punch-jab.png` unchanged. Both mascot-frames copies replaced. Desktop restarted, PID 21720.
- Monday, Sep 28, 2026: Chat/roleplay 403 `SUBSCRIPTION_REQUIRED` no longer opens the token balance page. Only real `OUT_OF_TOKENS` with balance ≤ 0 does. Subscription refusals stay on chat and show the API message. Desktop restarted, PID 29852.
- Monday, Sep 28, 2026: Rule restored — subscription required for chat (and same gate for roleplay/live). Exception only for canceled/cancelled with unused tokens (>0). Server `getSpendGate` / `checkTokenBalance`. Client credits redirect for SUBSCRIPTION_REQUIRED unchanged. Preview still hits production API until Isaiah deploys. Desktop restarted, PID 14052.
- Monday, Sep 28, 2026: Profile Log out moved to the bottom of profile content (after Your data) on web and desktop. Still `#account-logout-btn` → hidden `#logout-btn`. Confirmed on 4174. Wiring probe accidentally signed Isaiah out of the web preview; desktop auth untouched. Desktop restarted, PID 22236.
- Monday, Sep 28, 2026: verify-email banner text contrast fixed on dark and white mode (`.p-verify-banner` / `.p-verify-banner .p-c-bright`). Dark: cream `#FFF8EF` on raised `#0B0A0A`. White: `#161311` on `#FFFFFF`. Web and desktop paper.css edited in place. Desktop restarted, PID 26944.
- Monday, Sep 28, 2026: Removed the sidebar Tokens row (label + balance count) from web and desktop. Tokens `p-acct-ghost` button added on Profile (left column, after the account note, before Danger zone) and on Billing/`#credits-view` (under TOKEN BALANCE head). Opens the existing credits view via `data-action="switch-credits"`. Log out unchanged. Confirmed on 4174 and desktop. Desktop restarted, PID 25672.
- Tuesday, Sep 29, 2026: Web Lil Brutus looked still because Spawn was off (`brutusLilBrutus=0`), not because anime.js was missing. Wiring was already in place (`anime.umd.min.js`, `lil-brutus-motion.js`, `paper-ui.js` → `#lil-brutus`). Turned Spawn on and left it on. At http://127.0.0.1:4174: one `#lil-brutus`, click ran multi-frame transitions (e.g. bust→lap-behind→lap-stand→lap-close→laptop), shadowbox punched `shadow`/`punch-jab`/`punch-cross`, roleplay open→shadow / close→bust, idle bob on `.p-lil-bob` only. No code change. Isaiah stayed signed in.
- Tuesday, Sep 29, 2026: Lil Brutus costume is fully opaque on the beige invert background. Frame PNGs in both `mascot-frames/` folders had soft alpha (about 247–253), so the page showed through. Those pixels are now 0 or 255. The web mascot is a canvas that snaps alpha after scaling, so the figure blocks the page and the empty plate stays clear.
- Tuesday, Sep 29, 2026: Beige invert still showed through Lil Brutus. Scaling the solid frames left a lot of partial coverage, and a 128 alpha cutoff threw that away as holes. Web `paintSolidFrame` and the desktop mascot window now turn coverage above a faint fringe into solid ink. The empty plate stays clear.
- Tuesday, Sep 29, 2026: Empty Recent calls on the homepage was only as tall as its heading, which clipped Ask Brutus. `.p-home-main` fills the page under the stats, and `.p-home-recent` / `.p-home-rows` grow into the space under the chart on web and desktop. The list still scrolls inside the card when it has calls.
- Tuesday, Sep 29, 2026: Removed the arrow from the homepage Ask Brutus heading on web and desktop. The heading is now “Ask Brutus”.
- Tuesday, Sep 29, 2026: Brutus chat fills the window on web and desktop. Messages, composer, and the empty-state line were locked at 1024px (768px with conversations open), so a larger monitor left the page at the Paper artboard width. Those widths are now 100% of the chat column. Side padding shrinks on a small window (`clamp(20px, 4vw, 96px)`). Opening conversations still takes 256px and the rest of the column grows or shrinks with the window. Checked on http://127.0.0.1:4174 at 2560×1440 (composer 2144px, no sideways scroll) and at 1100×800 with the rail open (composer 532px, still inside the window). Desktop `paper.css` matches; restart the desktop app to see it.
- Wednesday, Sep 30, 2026: Isaiah asked for the redesign to go live. Web app and the API it needs ship from `Brutus-private` `main` (VPS deploy). Desktop ships as `v1.4.0`. Marketing site stays off this release. Anime.js for the web app is `frontend/vendor/anime.umd.min.js` so production does not depend on `node_modules`. Grind, Closer, and Team checkout returns “not configured” until those Stripe price IDs are on the server. Starter stays the existing $10 plan.
- Wednesday, Sep 30, 2026: Mac installers failed because electron-builder 24 unlocks the signing keychain with the certificate password. macOS 26 rejects that. The release workflow now imports the certificate itself and then builds. That part works. Notarization then stops with Apple HTTP 401: the GitHub secret `APPLE_ID_PASSWORD` is not a valid app-specific password. Windows 1.4.0 was already published. The web server deploy is still waiting on the stuck transaction.
