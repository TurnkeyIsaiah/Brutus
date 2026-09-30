        // ==================== CONFIG ====================
        let API_URL = (window.BRUTUS_API_URL != null) ? window.BRUTUS_API_URL : 'https://api.brutusai.coach';
        const FETCH_CREDENTIALS = window.BRUTUS_FETCH_CREDENTIALS || 'include';
        // Desktop app download CTAs are hidden until relaunch.
        // LAUNCH-TODO: controlled by BRUTUS_DOWNLOADS_ENABLED in config.js — flip it there to restore them.
        const DOWNLOADS_ENABLED = window.BRUTUS_DOWNLOADS_ENABLED === true;
        const DOWNLOAD_URLS = window.BRUTUS_DOWNLOAD_URLS || {};
        const MAC_REQUIREMENT = window.BRUTUS_MAC_REQUIREMENT || '';
        const MAC_DOWNLOAD_NOTE = MAC_REQUIREMENT
            ? `on an intel mac (2020 or older)? grab the intel build — the apple silicon one won't open. needs ${MAC_REQUIREMENT}.`
            : '';

        // Best-effort mac cpu sniff so the right build gets flagged as recommended.
        // The user agent always claims "Intel Mac OS X" even on Apple Silicon, so read
        // the GPU string instead. Stays null when the answer isn't clear — every mac CTA
        // lists both builds regardless, this only decides ordering and the label.
        function detectMacArch() {
            if (!/Mac/i.test(navigator.userAgent || '')) return null;
            try {
                const gl = document.createElement('canvas').getContext('webgl');
                const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
                const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
                if (/intel|amd|radeon|nvidia|geforce/i.test(renderer)) return 'intel';
                if (/apple/i.test(renderer)) return 'arm';
            } catch (_) {}
            return null;
        }

        let MAC_ARCH = detectMacArch();
        const macCtaPairs = [];

        // Chromium reports the real cpu family, but only behind an async call. Re-apply
        // the hints when it answers, since WebGL can be blocked or unavailable.
        (async function refineMacArch() {
            try {
                const uaData = navigator.userAgentData;
                if (!uaData || !uaData.getHighEntropyValues) return;
                const hints = await uaData.getHighEntropyValues(['architecture', 'platform']);
                if (!/mac/i.test(hints.platform || '')) return;
                const arch = /arm/i.test(hints.architecture) ? 'arm'
                    : /x86|amd64/i.test(hints.architecture) ? 'intel'
                    : null;
                if (arch && arch !== MAC_ARCH) {
                    MAC_ARCH = arch;
                    applyMacDownloadHints();
                }
            } catch (_) {}
        })();

        function macDownloadLabel(arch) {
            const base = arch === 'intel' ? 'download for mac (intel)' : 'download for mac (apple silicon)';
            return MAC_ARCH === arch ? `${base} — recommended` : base;
        }

        // Labels the two mac builds and floats the detected one to the top.
        function applyMacDownloadHints() {
            macCtaPairs.forEach(({ armEl, intelEl }) => {
                armEl.textContent = macDownloadLabel('arm');
                intelEl.textContent = macDownloadLabel('intel');
                const first = MAC_ARCH === 'intel' ? intelEl : armEl;
                const second = MAC_ARCH === 'intel' ? armEl : intelEl;
                if (first.parentNode) first.parentNode.insertBefore(first, second);
            });
        }

        function registerMacCtas(armEl, intelEl) {
            if (!armEl || !intelEl) return;
            if (!macCtaPairs.some(pair => pair.armEl === armEl)) macCtaPairs.push({ armEl, intelEl });
            applyMacDownloadHints();
        }

        // Credits view download CTAs (static markup, hidden by default in index.html).
        if (DOWNLOADS_ENABLED) {
            const creditsCtas = document.getElementById('credits-download-ctas');
            if (creditsCtas) {
                const armLink = document.getElementById('credits-download-mac');
                const intelLink = document.getElementById('credits-download-mac-intel');
                document.getElementById('credits-download-windows').href = DOWNLOAD_URLS.windows;
                armLink.href = DOWNLOAD_URLS.macArm;
                intelLink.href = DOWNLOAD_URLS.macIntel;
                registerMacCtas(armLink, intelLink);
                document.getElementById('credits-download-note').textContent = MAC_DOWNLOAD_NOTE;
                creditsCtas.classList.remove('hidden');
            }
        }
        
        // ==================== STATE ====================
        // In-memory only — browser auth uses HttpOnly cookie (BR-07). Token kept for WebSocket.
        let authToken = null;
        let currentUser = null;
        
        // ==================== NEURAL NETWORK ====================
        // The Paper auth screen has no #neural-canvas. A missing canvas must
        // not throw here — that abort used to run before the Sign in tab and
        // #login-form submit listeners were attached.
        const canvas = document.getElementById('neural-canvas');
        const ctx = canvas ? canvas.getContext('2d') : null;
        let nodes = [];
        
        function resizeCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            initNodes();
        }
        
        function initNodes() {
            nodes = [];
            const numNodes = 30;
            for (let i = 0; i < numNodes; i++) {
                nodes.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    vx: (Math.random() - 0.5) * 0.3,
                    vy: (Math.random() - 0.5) * 0.3,
                    radius: Math.random() * 2 + 1,
                    pulse: Math.random() * Math.PI * 2,
                    type: Math.random() > 0.8 ? 'active' : 'normal'
                });
            }
        }
        
        function drawNeuralNetwork() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const dx = nodes[i].x - nodes[j].x;
                    const dy = nodes[i].y - nodes[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    
                    if (dist < 200) {
                        const opacity = (1 - dist / 200) * 0.15;
                        ctx.beginPath();
                        ctx.moveTo(nodes[i].x, nodes[i].y);
                        ctx.lineTo(nodes[j].x, nodes[j].y);
                        ctx.strokeStyle = `rgba(255, 80, 80, ${opacity})`;
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                }
            }
            
            nodes.forEach(node => {
                node.pulse += 0.02;
                const pulseSize = Math.sin(node.pulse) * 0.5 + 1;
                
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius * pulseSize, 0, Math.PI * 2);
                
                if (node.type === 'active') {
                    ctx.fillStyle = 'rgba(255, 80, 80, 0.6)';
                } else {
                    ctx.fillStyle = 'rgba(100, 150, 255, 0.4)';
                }
                
                ctx.fill();
                
                node.x += node.vx;
                node.y += node.vy;
                
                if (node.x < 0 || node.x > canvas.width) node.vx *= -1;
                if (node.y < 0 || node.y > canvas.height) node.vy *= -1;
            });
            
            requestAnimationFrame(drawNeuralNetwork);
        }
        
        if (canvas && ctx) {
            window.addEventListener('resize', resizeCanvas);
            resizeCanvas();
            drawNeuralNetwork();
        }
        
        function authFetch(url, options = {}) {
            const headers = { ...(options.headers || {}) };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
            if (window.brutus && window.brutus.startMonitoring) headers['X-Brutus-Client'] = 'brutus-desktop';
            return fetch(url, { ...options, headers, credentials: FETCH_CREDENTIALS });
        }

        function persistDesktopSession() {
            if (window.brutus && window.brutus.setAuth && authToken) {
                window.brutus.setAuth({ token: authToken, user: currentUser });
            }
        }

        // ==================== API HELPERS ====================
        async function apiCall(endpoint, options = {}) {
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers
            };
            
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }
            
            const response = await authFetch(`${API_URL}${endpoint}`, {
                ...options,
                headers,
                credentials: FETCH_CREDENTIALS
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw billingAwareError(data, 'Request failed');
            }
            
            return data;
        }

        // Set by a 403 from checkTokenBalance. loadBalance paints it onto the
        // credits screen after the subscription copy, and clears it once the
        // account is no longer blocked for that reason.
        let pendingBillingGate = null;

        function billingAwareError(data, fallback) {
            const code = data?.error?.code;
            const message = data?.error?.message || fallback;
            if (code === 'OUT_OF_TOKENS') notifyOutOfTokens(message);
            else if (code === 'SUBSCRIPTION_REQUIRED') notifySubscriptionRequired(message);
            const error = new Error(message);
            error.code = code;
            return error;
        }

        function billingGateText(error) {
            if (!error) return '';
            if (error.code !== 'SUBSCRIPTION_REQUIRED' && error.code !== 'OUT_OF_TOKENS') return '';
            return error.message || '';
        }

        // Surface an out-of-tokens toast when a gated route rejects a spend.
        // Marks the 'out' tier so the next loadBalance poll won't double-fire.
        function notifyOutOfTokens(message) {
            const text = message || "you're out of tokens. add credits to keep Brutus working.";
            pendingBillingGate = { code: 'OUT_OF_TOKENS', message: text };
            if (lastNotifiedTier !== 'out') {
                lastNotifiedTier = 'out';
                showToast(text, 'out');
            }
            switchToCredits();
        }

        function notifySubscriptionRequired(message) {
            const text = message || 'a $10/month starter subscription is required to use Brutus.';
            pendingBillingGate = { code: 'SUBSCRIPTION_REQUIRED', message: text };
            showToast(text, 'critical');
            switchToCredits();
        }

        function paintBillingGate() {
            try {
                if (!pendingBillingGate || !pendingBillingGate.message) return;
                const copy = document.getElementById('subscription-banner-copy');
                if (copy) copy.textContent = pendingBillingGate.message;
                const warning = document.getElementById('credits-low-warning');
                if (warning) {
                    warning.textContent = pendingBillingGate.message;
                    warning.style.display = 'block';
                }
            } catch (_) {}
        }

        async function apiUpload(endpoint, file) {
            const formData = new FormData();
            formData.append('audio', file);
            
            const response = await authFetch(`${API_URL}${endpoint}`, {
                method: 'POST',
                headers: {
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                },
                credentials: FETCH_CREDENTIALS,
                body: formData
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw billingAwareError(data, 'Upload failed');
            }
            
            return data;
        }
        
        // ==================== AUTH ====================
        const authModal = document.getElementById('auth-modal');
        const mainContent = document.getElementById('main-content');
        const authError = document.getElementById('auth-error');
        const loginForm = document.getElementById('login-form');
        const signupForm = document.getElementById('signup-form');

        // Waitlist phase: hide the sign-up tab while signups are closed.
        // Controlled by BRUTUS_SIGNUPS_ENABLED in config.js (see LAUNCH-TODO there).
        if (window.BRUTUS_SIGNUPS_ENABLED !== true) {
            const signupTab = document.querySelector('.auth-tab[data-tab="signup"]');
            if (signupTab) signupTab.style.display = 'none';
        }

        // Password toggle
        document.getElementById('toggle-login-pw').addEventListener('click', () => {
            const pw = document.getElementById('login-password');
            const btn = document.getElementById('toggle-login-pw');
            if (pw.type === 'password') { pw.type = 'text'; btn.textContent = '👁'; }
            else { pw.type = 'password'; btn.textContent = '👁'; }
        });

        // Tab switching
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                if (tab.dataset.tab === 'login') {
                    loginForm.classList.remove('hidden');
                    signupForm.classList.add('hidden');
                } else {
                    loginForm.classList.add('hidden');
                    signupForm.classList.remove('hidden');
                }
                
                authError.classList.remove('visible');
            });
        });
        
        // Login
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            const btn = document.getElementById('login-btn');
            
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span>';
            authError.classList.remove('visible');
            
            try {
                const data = await apiCall('/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({
                        email, password,
                        posthogAnonymousId: window.brutusAnonymousId ? window.brutusAnonymousId() : null
                    })
                });
                
                authToken = data.token;
                currentUser = data.user;
                persistDesktopSession();
                rememberPreviewToken();
                
                showApp();
            } catch (error) {
                authError.textContent = error.message;
                authError.classList.add('visible');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Sign in';
            }
        });
        
        // Signup
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const name = document.getElementById('signup-name').value;
            const email = document.getElementById('signup-email').value;
            const password = document.getElementById('signup-password').value;
            const btn = document.getElementById('signup-btn');
            
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span>';
            authError.classList.remove('visible');
            
            try {
                const data = await apiCall('/auth/signup', {
                    method: 'POST',
                    body: JSON.stringify({
                        name, email, password,
                        posthogAnonymousId: window.brutusAnonymousId ? window.brutusAnonymousId() : null
                    })
                });
                
                authToken = data.token;
                currentUser = data.user;
                persistDesktopSession();
                rememberPreviewToken();
                
                // Browser-side twin of the server's user_signed_up, so signup can
                // be a Web Analytics conversion goal (see signup.js). No redirect
                // follows here, so a plain capture is fine.
                if (window.brutusIdentify) window.brutusIdentify(currentUser);
                if (window.brutusTrack) window.brutusTrack('signup_completed', { signup_method: 'password' });

                showApp();
            } catch (error) {
                authError.textContent = error.message;
                authError.classList.add('visible');
            } finally {
                btn.disabled = false;
                btn.textContent = 'create account';
            }
        });
        
        // Logout
        document.getElementById('logout-btn').addEventListener('click', async () => {
            let revoked = false;
            try {
                await apiCall('/auth/logout', { method: 'POST' });
                revoked = true;
            } catch (_) {
                console.warn('[Brutus] Server-side token revocation failed — session may still be active on other devices.');
            }
            authToken = null;
            currentUser = null;
            rememberPreviewToken();
            if (window.brutus && window.brutus.clearAuth) window.brutus.clearAuth();
            // Stop attributing to this user, so the next person on a shared
            // machine is not merged into their profile.
            if (window.brutusReset) window.brutusReset();
            resetNotesTranscriptState();
            stopVerifyBannerPoll();

            authModal.classList.remove('hidden');
            mainContent.classList.add('hidden');

            if (!revoked) {
                const warn = document.createElement('p');
                warn.style.cssText = 'color:#ff9800;font-size:12px;text-align:center;margin-top:8px;';
                warn.textContent = 'Signed out locally. Could not reach server — your session may still be active on other devices.';
                authModal.querySelector('form') && authModal.querySelector('form').prepend(warn);
                setTimeout(() => warn.remove(), 8000);
            }
        });
        
        // ==================== TOKEN BALANCE ====================
        // ── App-wide token toast ────────────────────────────────────────────────
        // Show a dismissible notification on any view. `level` drives styling:
        // 'low' | 'critical' | 'out'. Pass withAction to render an "add credits" link.
        function showToast(message, level = 'low', withAction = true) {
            const container = document.getElementById('token-toast-container');
            if (!container) return;
            const toast = document.createElement('div');
            toast.className = `token-toast ${level}`;
            toast.innerHTML = `
                <span class="token-toast-msg">${message}</span>
                ${withAction ? `<span class="token-toast-action">add credits →</span>` : ''}
                <button class="token-toast-close" title="dismiss">×</button>`;
            if (withAction) {
                toast.querySelector('.token-toast-action').onclick = () => { switchToCredits(); toast.remove(); };
            }
            toast.querySelector('.token-toast-close').onclick = () => toast.remove();
            container.appendChild(toast);
            // 'out' is blocking-ish and stays until dismissed; lower tiers auto-clear.
            if (level !== 'out') setTimeout(() => toast.remove(), 9000);
        }

        // Tier of the last toast we fired, so the periodic balance poll doesn't
        // re-spam the same warning. Resets when the user climbs back above a tier.
        let lastNotifiedTier = null;
        function notifyTokenTier(balance) {
            const tier = balance <= 0 ? 'out'
                : balance < 10000 ? 'critical'   // ≈ $0.20
                : balance < 50000 ? 'low'        // ≈ $1
                : null;
            if (tier === lastNotifiedTier) return; // already shown for this tier
            lastNotifiedTier = tier;
            if (tier === 'out') {
                showToast("you're out of tokens. Brutus is paused until you add credits.", 'out');
            } else if (tier === 'critical') {
                showToast('almost out of tokens — top up to keep Brutus running.', 'critical');
            } else if (tier === 'low') {
                showToast('running low on tokens — under $1 of credit left.', 'low');
            }
        }

        async function loadBalance() {
            try {
                const data = await apiCall('/billing/balance');
                const balance = parseInt(data.tokenBalance);
                const dollars = (balance / 50000).toFixed(2);
                const isLow = balance < 50000; // under $1 worth

                // Sidebar token badge was removed; keep optional ids safe if present.
                const badge = document.getElementById('token-badge');
                const badgeText = document.getElementById('token-badge-text');
                if (badgeText) badgeText.textContent = balance.toLocaleString() + ' tokens';
                if (badge) badge.classList.toggle('low', isLow);

                // Credits view display
                document.getElementById('credits-balance-display').textContent = balance.toLocaleString();
                document.getElementById('credits-balance-dollars').textContent = `≈ $${dollars} worth`;
                document.getElementById('credits-low-warning').style.display = isLow ? 'block' : 'none';

                const expiryEl = document.getElementById('credits-expiry-note');
                if (data.nextExpiry) {
                    const when = new Date(data.nextExpiry.at);
                    expiryEl.textContent = `next expiry ${when.toLocaleDateString()} · ${Number(data.nextExpiry.remaining).toLocaleString()} tokens`;
                } else {
                    expiryEl.textContent = 'tokens expire 45 days after they land';
                }

                const sub = data.subscription || {};
                const subBtn = document.getElementById('subscription-cta-btn');
                const subTitle = document.getElementById('subscription-banner-title');
                const subCopy = document.getElementById('subscription-banner-copy');
                if (sub.active) {
                    subTitle.textContent = 'starter — active';
                    const period = sub.currentPeriodEnd
                        ? ` current period through ${new Date(sub.currentPeriodEnd).toLocaleDateString()}.`
                        : '';
                    subCopy.textContent = `500,000 tokens each month.${period} extras below are add-ons.`;
                    subBtn.textContent = 'manage';
                    subBtn.dataset.action = 'manage-subscription';
                } else {
                    subTitle.textContent = 'starter — $10/month';
                    subCopy.textContent = 'required to use Brutus. 500,000 tokens every month. extras below are add-ons.';
                    subBtn.textContent = 'subscribe';
                    subBtn.dataset.action = 'subscribe';
                }

                // App-wide proactive notification (fires once per tier transition)
                notifyTokenTier(balance);

                // Auto top-up settings
                const at = data.autoTopUp;
                document.getElementById('auto-topup-toggle').checked = at.enabled;
                if (at.amountDollars) document.getElementById('auto-amount-input').value = at.amountDollars;
                if (at.thresholdDollars) document.getElementById('auto-threshold-input').value = at.thresholdDollars;
                document.getElementById('auto-topup-hint').style.display = data.hasSavedCard ? 'none' : 'block';

                if (pendingBillingGate) {
                    const stillBlocked = pendingBillingGate.code === 'OUT_OF_TOKENS'
                        ? !(balance > 0)
                        : !sub.active;
                    if (!stillBlocked) pendingBillingGate = null;
                }

                return data;
            } catch (e) {
                console.error('Failed to load balance:', e);
            }
        }

        // ---- Checkout analytics -------------------------------------------
        // Every checkout here hands off to Stripe, so "started" is the last
        // thing observable from this page. The matching "money arrived" event is
        // purchase_completed, written by the Stripe webhook — the gap between
        // the two is the payment leak.
        // Stripe and the billing portal are https pages. In the desktop app they
        // open in the system browser so the main window stays on the bundled UI.
        async function openExternalUrl(url) {
            if (window.brutus && typeof window.brutus.openExternal === 'function'
                && typeof url === 'string' && url.startsWith('https://')) {
                await window.brutus.openExternal(url);
                return true;
            }
            window.location.href = url;
            return false;
        }

        function trackCheckoutStarted(props) {
            if (window.brutusTrackBeforeNavigate) {
                window.brutusTrackBeforeNavigate('checkout_started', props);
            }
        }

        // Failures are worth a named reason: SUBSCRIPTION_REQUIRED means someone
        // tried to buy tokens without the starter plan, which is a funnel
        // ordering problem rather than a broken payment.
        function trackCheckoutFailed(props, err) {
            if (!window.brutusTrack) return;
            window.brutusTrack('checkout_failed', {
                ...props,
                reason: err?.code || err?.message || 'unknown'
            });
        }

        async function startSubscription() {
            const button = document.getElementById('subscription-cta-btn');
            const paywallBtn = document.getElementById('ob-paywall-cta');
            const paywallOpen = paywallBtn && paywallBtn.style.display !== 'none'
                && !document.getElementById('onboarding-overlay')?.classList.contains('hidden')
                && document.getElementById('ob-paywall')?.style.display === 'flex';
            if (button?.disabled && !paywallOpen) return;
            if (paywallOpen) {
                paywallBtn.disabled = true;
                paywallBtn.textContent = 'opening checkout...';
            } else if (button) {
                button.disabled = true;
                button.textContent = 'opening checkout...';
            }
            try {
                const data = await apiCall('/billing/subscribe', { method: 'POST' });
                // The conversion that matters: starter is required before any
                // token pack can be bought, so this is the gate everything else
                // sits behind. sendBeacon because the next line leaves the page.
                trackCheckoutStarted({ product: 'starter_subscription', price_usd: 10 });
                await openExternalUrl(data.url);
            } catch (e) {
                if (e.code === 'ALREADY_SUBSCRIBED' || e.code === 'SUBSCRIPTION_EXISTS') {
                    if (paywallOpen) {
                        document.getElementById('onboarding-overlay')?.classList.add('hidden');
                        showWalkthrough();
                    }
                    await openBillingPortal();
                    return;
                }
                trackCheckoutFailed({ product: 'starter_subscription' }, e);
                alert('Failed to start subscription: ' + e.message);
            } finally {
                if (paywallOpen && paywallBtn) {
                    paywallBtn.disabled = false;
                    paywallBtn.textContent = 'Continue';
                }
                if (button && !paywallOpen) {
                    button.disabled = false;
                    button.textContent = 'subscribe';
                }
            }
        }

        async function openBillingPortal() {
            try {
                const data = await apiCall('/billing/portal', { method: 'POST' });
                // Worth watching on its own: the portal is where people go to
                // cancel, so a rise here leads churn.
                if (window.brutusTrackBeforeNavigate) {
                    window.brutusTrackBeforeNavigate('billing_portal_opened', {});
                }
                await openExternalUrl(data.url);
            } catch (e) {
                alert('Failed to open billing portal: ' + e.message);
            }
        }

        async function buyPack(packId) {
            // Price comes from the card's own markup so it cannot drift from
            // TOKEN_PACKS in the backend the way a second hardcoded table would.
            const priceText = document.querySelector(`.pack-card[data-pack="${packId}"] .pack-price`)?.textContent || '';
            const priceUsd = parseFloat(priceText.replace(/[^0-9.]/g, '')) || null;
            try {
                const data = await apiCall('/billing/add-credits', {
                    method: 'POST',
                    body: JSON.stringify({ pack: packId })
                });
                trackCheckoutStarted({ product: 'token_pack', plan: packId, price_usd: priceUsd });
                await openExternalUrl(data.url);
            } catch (e) {
                trackCheckoutFailed({ product: 'token_pack', plan: packId, price_usd: priceUsd }, e);
                alert('Failed to start checkout: ' + e.message);
            }
        }

        async function customTopup() {
            const amount = parseFloat(document.getElementById('custom-amount-input').value);
            if (!amount || amount < 10) {
                alert('Minimum top-up is $10');
                return;
            }
            const btn = document.getElementById('custom-topup-btn');
            btn.disabled = true;
            btn.textContent = 'redirecting...';
            try {
                const data = await apiCall('/billing/custom-topup', {
                    method: 'POST',
                    body: JSON.stringify({ amountDollars: amount })
                });
                trackCheckoutStarted({ product: 'custom_topup', price_usd: amount });
                const openedOutside = await openExternalUrl(data.url);
                if (openedOutside) {
                    btn.disabled = false;
                    btn.textContent = 'top up';
                }
            } catch (e) {
                trackCheckoutFailed({ product: 'custom_topup', price_usd: amount }, e);
                alert('Failed to start checkout: ' + e.message);
                btn.disabled = false;
                btn.textContent = 'top up';
            }
        }

        async function saveAutoTopup() {
            const enabled = document.getElementById('auto-topup-toggle').checked;
            const amountDollars = parseFloat(document.getElementById('auto-amount-input').value);
            const thresholdDollars = parseFloat(document.getElementById('auto-threshold-input').value);

            if (enabled) {
                if (!amountDollars || amountDollars < 10) { alert('Auto top-up amount must be at least $10'); return; }
                if (!thresholdDollars || thresholdDollars < 1) { alert('Threshold must be at least $1'); return; }
            }

            const btn = document.getElementById('save-auto-topup-btn');
            btn.disabled = true;
            btn.textContent = 'saving...';

            try {
                await apiCall('/billing/auto-topup', {
                    method: 'PUT',
                    body: JSON.stringify({ enabled, amountDollars, thresholdDollars })
                });
                const msg = document.getElementById('auto-topup-success');
                msg.style.display = 'block';
                setTimeout(() => { msg.style.display = 'none'; }, 3000);
            } catch (e) {
                if (e.message.includes('NO_SAVED_CARD') || e.message.includes('saved payment')) {
                    alert('No saved card yet — make any purchase first and your card will be saved automatically.');
                } else {
                    alert('Failed to save: ' + e.message);
                }
            } finally {
                btn.disabled = false;
                btn.textContent = 'save settings';
            }
        }

        function switchToCredits() {
            try {
                switchToView('credits');
            } catch (_) {}
            try {
                const pending = loadBalance();
                if (pending && typeof pending.then === 'function') {
                    pending.then(() => paintBillingGate(), () => paintBillingGate());
                }
            } catch (_) {}
        }

        // Check existing token
        function rememberPreviewToken() {
            if (window.location.port !== '4174') return;
            try {
                if (authToken) sessionStorage.setItem('brutusPreviewToken', authToken);
                else sessionStorage.removeItem('brutusPreviewToken');
            } catch (_) {}
        }

        async function applyDesktopApiUrl() {
            if (!window.brutus || !window.brutus.getSettings) return;
            try {
                const settings = await window.brutus.getSettings();
                const apiUrl = settings && typeof settings.apiUrl === 'string' ? settings.apiUrl.trim() : '';
                if (apiUrl) API_URL = apiUrl.replace(/\/$/, '');
            } catch (_) {}
        }

        async function checkAuth() {
            await applyDesktopApiUrl();
            try {
                if (!authToken && window.location.port === '4174') {
                    try {
                        const saved = sessionStorage.getItem('brutusPreviewToken');
                        if (saved) authToken = saved;
                    } catch (_) {}
                }
                if (!authToken && window.brutus && window.brutus.getAuth) {
                    const saved = await window.brutus.getAuth();
                    if (saved && saved.token) {
                        authToken = saved.token;
                        currentUser = saved.user || null;
                    }
                }
                const data = await apiCall('/auth/me');
                currentUser = data.user;
                authToken = data.token || authToken;
                persistDesktopSession();
                rememberPreviewToken();
                showApp();
            } catch (error) {
                authToken = null;
                currentUser = null;
                rememberPreviewToken();
                authModal.classList.remove('hidden');
            }
        }
        
        function showApp() {
            // Every authenticated path (login, signup, restored session) lands
            // here, so this is the one place identity has to be attached. Server
            // events use the internal user UUID; without this the browser keeps
            // its anonymous cookie ID and the two never describe the same person.
            if (window.brutusIdentify) window.brutusIdentify(currentUser);
            authModal.classList.add('hidden');
            mainContent.classList.remove('hidden');
            const hour = new Date().getHours();
            const dayPart = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
            const firstName = (currentUser?.name || '').split(' ')[0];
            const greet = document.getElementById('dash-greeting');
            if (greet && firstName) greet.textContent = `Good ${dayPart}, ${firstName}.`;
            const sideName = document.getElementById('sidebar-user-name');
            if (sideName && currentUser?.name) sideName.textContent = currentUser.name;
            const sideAvatar = document.getElementById('sidebar-avatar');
            if (sideAvatar && firstName) sideAvatar.textContent = firstName.slice(0, 2).toUpperCase();
            loadDashboard();
            loadBalance();
            if (window.brutus && !window.__brutusRefreshBalanceOnFocus) {
                window.__brutusRefreshBalanceOnFocus = true;
                window.addEventListener('focus', () => {
                    if (authToken) loadBalance();
                });
            }
            updateVerifyBanner();
            if (!currentUser?.settings?.onboardingComplete) {
                showOnboardingModal();
            } else {
                showWalkthrough();
            }
        }

        // ==================== ONBOARDING ====================

        let obCurrentStep = 1;
        const OB_TOTAL = 6;

        function showOnboardingModal() {
            obCurrentStep = 1;
            const quiz = document.getElementById('ob-quiz');
            const paywall = document.getElementById('ob-paywall');
            if (quiz) quiz.style.display = '';
            if (paywall) paywall.style.display = 'none';
            updateObStep();
            document.getElementById('onboarding-overlay').classList.remove('hidden');
        }

        function showObPaywall() {
            const quiz = document.getElementById('ob-quiz');
            const paywall = document.getElementById('ob-paywall');
            if (quiz) quiz.style.display = 'none';
            // .p-ob-pay is display:none without !important, so inline flex wins
            // and the section stretches in the overlay the way #ob-quiz does.
            if (paywall) paywall.style.display = 'flex';
        }

        function updateObStep() {
            document.querySelectorAll('.ob-step').forEach(s => { s.style.display = 'none'; });
            const step = document.getElementById('ob-step-' + obCurrentStep);
            // .p-ob .ob-step { display:none } has no !important, so this inline
            // display reveals the Paper panel.
            if (step) step.style.display = 'block';
            const num = document.getElementById('ob-step-num');
            if (num) num.textContent = obCurrentStep;
            const bar = document.getElementById('ob-progress-bar');
            if (bar) bar.style.width = ((obCurrentStep / OB_TOTAL) * 100) + '%';
            const nextBtn = document.getElementById('ob-next-btn');
            if (nextBtn) nextBtn.textContent = obCurrentStep === OB_TOTAL ? 'finish' : 'next';
        }

        function onboardingNext() {
            if (obCurrentStep < OB_TOTAL) {
                obCurrentStep++;
                updateObStep();
            } else {
                submitOnboarding();
            }
        }

        // Paper radios use kebab values. Profile selects and
        // brutalHonestyMode (coachingStyle === 'Brutal') store the legacy strings.
        const OB_STORED_VALUES = {
            'less-than-1-year': 'Less than 1 year',
            '1-3-years': '1-3 years',
            '3-7-years': '3-7 years',
            '7-plus-years': '7+ years',
            'closing': 'Closing',
            'handling-objections': 'Handling objections',
            'building-rapport': 'Building rapport',
            'discovery-asking-questions': 'Discovery',
            'following-up': 'Following up',
            'talking-too-much': 'Talking too much',
            'under-10': 'Under 10%',
            '10-25': '10-25%',
            '25-50': '25-50%',
            'over-50': 'Over 50%',
            'not-sure': 'Not sure',
            'brutal': 'Brutal',
            'balanced': 'Balanced',
            'encouraging': 'Encouraging'
        };

        function obStoredValue(raw, fallback) {
            if (!raw) return fallback || '';
            return OB_STORED_VALUES[raw] || raw;
        }

        async function submitOnboarding() {
            const product = document.getElementById('ob-product').value.trim();
            const selfEmployed = document.getElementById('ob-selfemployed').checked;
            const company = selfEmployed ? 'Self-employed' : document.getElementById('ob-company').value.trim();
            const businessName = document.getElementById('ob-businessname').value.trim();
            const experience = obStoredValue(document.querySelector('input[name="ob-experience"]:checked')?.value);
            const challenge = obStoredValue(document.querySelector('input[name="ob-challenge"]:checked')?.value);
            const closeRate = obStoredValue(document.querySelector('input[name="ob-closerate"]:checked')?.value);
            const coachingStyle = obStoredValue(document.querySelector('input[name="ob-coaching"]:checked')?.value, 'Balanced');

            const nextBtn = document.getElementById('ob-next-btn');
            nextBtn.textContent = 'saving...';
            nextBtn.disabled = true;

            try {
                const data = await apiCall('/user/onboard', { method: 'POST', body: JSON.stringify({ product, company, businessName, experience, challenge, closeRate, coachingStyle }) });
                if (currentUser) currentUser.settings = data.settings;
                loadDashboard();
                let alreadySubscribed = false;
                try {
                    const balance = await apiCall('/billing/balance');
                    alreadySubscribed = !!balance?.subscription?.active;
                } catch (_) {}
                if (alreadySubscribed) {
                    document.getElementById('onboarding-overlay').classList.add('hidden');
                    showWalkthrough();
                } else {
                    showObPaywall();
                }
            } catch (e) {
                nextBtn.textContent = 'finish';
                nextBtn.disabled = false;
            }
        }

        async function skipOnboarding() {
            try {
                await apiCall('/user/settings', { method: 'PUT', body: JSON.stringify({ settings: { onboardingComplete: true } }) });
                if (currentUser?.settings) currentUser.settings.onboardingComplete = true;
            } catch (_) {}
            document.getElementById('onboarding-overlay').classList.add('hidden');
            showWalkthrough();
        }

        // ==================== WALKTHROUGH (one-shot, post-onboarding) ====================
        // Fires once after the user clears the onboarding gate. Gate combines two flags
        // so we never disturb a still-onboarding user, and never re-show after dismissal.
        function showWalkthrough() {
            if (!currentUser?.settings?.onboardingComplete) return;
            if (currentUser?.settings?.walkthroughShown) return;

            const overlay = document.getElementById('walkthrough-overlay');
            const closeBtn = document.getElementById('walkthrough-close');
            const ctaWinBtn = document.getElementById('walkthrough-cta-windows');
            const ctaMacBtn = document.getElementById('walkthrough-cta-mac');
            const ctaMacIntelBtn = document.getElementById('walkthrough-cta-mac-intel');
            const macNote = document.getElementById('walkthrough-download-note');
            const laterBtn = document.getElementById('walkthrough-later');

            const dismiss = () => {
                overlay.classList.add('hidden');
                markWalkthroughShown();
            };

            closeBtn.onclick = dismiss;
            laterBtn.onclick = dismiss;
            if (DOWNLOADS_ENABLED) {
                ctaWinBtn.onclick = () => {
                    window.open(DOWNLOAD_URLS.windows, '_blank');
                    dismiss();
                };
                ctaMacBtn.onclick = () => {
                    window.open(DOWNLOAD_URLS.macArm, '_blank');
                    dismiss();
                };
                ctaMacIntelBtn.onclick = () => {
                    window.open(DOWNLOAD_URLS.macIntel, '_blank');
                    dismiss();
                };
                registerMacCtas(ctaMacBtn, ctaMacIntelBtn);
                macNote.textContent = MAC_DOWNLOAD_NOTE;
            } else {
                ctaWinBtn.style.display = 'none';
                ctaMacBtn.style.display = 'none';
                ctaMacIntelBtn.style.display = 'none';
                macNote.style.display = 'none';
                laterBtn.textContent = 'got it';
                document.getElementById('walkthrough-step1-title').textContent = 'grab the desktop app at launch';
                document.getElementById('walkthrough-step1-body').textContent = "Brutus listens through your computer. the download lands here when we launch.";
            }

            overlay.classList.remove('hidden');
        }

        async function markWalkthroughShown() {
            try {
                await apiCall('/user/settings', { method: 'PUT', body: JSON.stringify({ settings: { walkthroughShown: true } }) });
                if (currentUser?.settings) currentUser.settings.walkthroughShown = true;
            } catch (_) {}
        }

        // ==================== VERIFY-EMAIL BANNER ====================
        // Shows in the dashboard until currentUser.emailVerified flips to true.
        // Polls /auth/me every 30s while visible so verification from another tab
        // (the verify-email.html page) is reflected automatically — no manual refresh.
        let _verifyBannerInterval = null;

        function updateVerifyBanner() {
            const banner = document.getElementById('verify-email-banner');
            if (!banner) return;

            const needsVerify = currentUser && currentUser.emailVerified === false;
            if (needsVerify) {
                const emailEl = document.getElementById('verify-banner-email');
                if (emailEl && currentUser.email) emailEl.textContent = currentUser.email;
                banner.classList.remove('hidden');
                startVerifyBannerPoll();
            } else {
                banner.classList.add('hidden');
                stopVerifyBannerPoll();
            }
        }

        function startVerifyBannerPoll() {
            if (_verifyBannerInterval) return;
            _verifyBannerInterval = setInterval(async () => {
                try {
                    const data = await apiCall('/auth/me');
                    if (currentUser && data.user) {
                        currentUser.emailVerified = data.user.emailVerified;
                        currentUser.tokenBalance = data.user.tokenBalance;
                    }
                    if (data.user?.emailVerified) {
                        loadBalance();
                        updateVerifyBanner();
                    }
                } catch (_) {}
            }, 30000);
        }

        function stopVerifyBannerPoll() {
            if (_verifyBannerInterval) {
                clearInterval(_verifyBannerInterval);
                _verifyBannerInterval = null;
            }
        }

        async function resendVerification() {
            const btn = document.getElementById('verify-resend-btn');
            if (!btn) return;
            const originalLabel = 'resend verification email';
            btn.disabled = true;
            btn.textContent = 'sending...';
            try {
                await apiCall('/auth/resend-verification', { method: 'POST' });
                btn.textContent = 'sent — check your inbox';
                // Cool down for 60s to discourage spamming the endpoint
                setTimeout(() => {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = originalLabel;
                    }
                }, 60000);
            } catch (e) {
                btn.disabled = false;
                btn.textContent = originalLabel;
                console.warn('resend verification failed:', e.message);
            }
        }

        // Attach listener inline — matches the existing pattern of script-level
        // getElementById+addEventListener (e.g. onboarding handlers).
        (() => {
            const btn = document.getElementById('verify-resend-btn');
            if (btn) btn.addEventListener('click', resendVerification);
        })();

        // ==================== DELETE ACCOUNT ====================
        function openDeleteAccountModal() {
            const overlay = document.getElementById('delete-account-overlay');
            const passwordInput = document.getElementById('delete-account-password');
            const errorEl = document.getElementById('delete-account-error');
            const confirmBtn = document.getElementById('delete-account-confirm');

            // Reset state every time
            passwordInput.value = '';
            errorEl.textContent = '';
            errorEl.classList.remove('visible');
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'delete forever';

            overlay.classList.remove('hidden');
            setTimeout(() => passwordInput.focus(), 50);
        }

        function closeDeleteAccountModal() {
            document.getElementById('delete-account-overlay').classList.add('hidden');
        }

        async function confirmDeleteAccount() {
            const passwordInput = document.getElementById('delete-account-password');
            const errorEl = document.getElementById('delete-account-error');
            const confirmBtn = document.getElementById('delete-account-confirm');
            const password = passwordInput.value;

            errorEl.classList.remove('visible');

            if (!password) {
                errorEl.textContent = 'password is required';
                errorEl.classList.add('visible');
                return;
            }

            confirmBtn.disabled = true;
            confirmBtn.textContent = 'deleting...';

            try {
                await apiCall('/user/account', {
                    method: 'DELETE',
                    body: JSON.stringify({ password })
                });

                // Account is gone server-side. Clear local auth and bounce to login.
                authToken = null;
                currentUser = null;
                if (window.brutusReset) window.brutusReset();
                stopVerifyBannerPoll();
                if (window.brutus && window.brutus.clearAuth) {
                    await window.brutus.clearAuth();
                    window.location.href = 'index.html';
                } else {
                    window.location.href = 'login.html?deleted=1';
                }
            } catch (err) {
                errorEl.textContent = err.message || 'something went wrong. try again.';
                errorEl.classList.add('visible');
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'delete forever';
            }
        }

        // ==================== PRE-DELETE RETENTION FLOW ====================
        // The "delete account" button now opens a survey modal first. Based on the
        // selected reason, the user is routed through one of two retention modals
        // (progress recap OR data export) before reaching the password confirm.
        // The "other" reason routes straight to password confirm — respect users
        // who just want out.
        let selectedDeleteReason = null;

        function closeAllDeleteModals() {
            ['delete-survey-overlay', 'delete-progress-overlay', 'delete-export-overlay', 'delete-account-overlay']
                .forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('hidden');
                });
        }

        function openDeleteSurveyModal() {
            selectedDeleteReason = null;
            // Reset radio selection
            document.querySelectorAll('input[name="delete-reason"]').forEach(r => { r.checked = false; });
            document.getElementById('delete-survey-overlay').classList.remove('hidden');
        }

        function continueDeleteSurvey() {
            const checked = document.querySelector('input[name="delete-reason"]:checked');
            selectedDeleteReason = checked ? checked.value : 'other';
            console.log('[delete] reason:', selectedDeleteReason);

            // Reason is captured for analytics, but every user walks through the
            // full retention sequence regardless: survey → progress → export → password.
            document.getElementById('delete-survey-overlay').classList.add('hidden');
            openDeleteProgressModal();
        }

        function proceedToExportModal() {
            document.getElementById('delete-progress-overlay').classList.add('hidden');
            openDeleteExportModal();
        }

        async function openDeleteProgressModal() {
            const overlay = document.getElementById('delete-progress-overlay');
            const grid = document.getElementById('delete-progress-stats');
            const copy = document.getElementById('delete-progress-copy');

            // Default: hide stats grid, show fallback copy until data loads
            grid.style.display = 'none';
            copy.textContent = "Brutus is still calibrating to your style. one real call is usually when it clicks.";
            overlay.classList.remove('hidden');

            // Pull fresh stats from the dashboard endpoint. If anything fails, the
            // fallback copy stays — modal still works.
            try {
                const data = await apiCall('/user/dashboard');
                const totalCalls = data?.profile?.totalCallsAnalyzed || 0;
                if (totalCalls > 0) {
                    document.getElementById('delete-stat-calls').textContent = totalCalls;

                    // Average score: prefer weekly scores (most engagement-relevant),
                    // fall back to recent calls if the user hasn't had calls this week.
                    const weeklyScores = data?.weeklyStats?.scores || [];
                    const recentCalls = data?.recentCalls || [];
                    let scoreSource = weeklyScores.map(s => s.score);
                    if (scoreSource.length === 0) scoreSource = recentCalls.map(c => c.overallScore);
                    const avgScore = scoreSource.length
                        ? Math.round(scoreSource.reduce((a, b) => a + b, 0) / scoreSource.length)
                        : '--';
                    document.getElementById('delete-stat-score').textContent = avgScore;

                    const talkRatio = data?.profile?.talkRatioAvg;
                    document.getElementById('delete-stat-talk').textContent = (talkRatio !== undefined && talkRatio !== null) ? `${parseFloat(talkRatio).toFixed(0)}%` : '--%';

                    const tokens = currentUser?.tokenBalance ? Number(currentUser.tokenBalance).toLocaleString() : '--';
                    document.getElementById('delete-stat-tokens').textContent = tokens;

                    grid.style.display = 'grid';
                    copy.textContent = "Brutus learned your style across these calls. that context goes away the second this account is gone. give it one more real call before you decide.";
                }
            } catch (_) {
                // Keep the fallback copy
            }
        }

        function openDeleteExportModal() {
            // Reset to initial button state every time
            const initialBtns = document.getElementById('delete-export-buttons-initial');
            const afterBtns = document.getElementById('delete-export-buttons-after');
            const successEl = document.getElementById('delete-export-success');
            const errorEl = document.getElementById('delete-export-error');
            const downloadBtn = document.getElementById('delete-export-download');

            initialBtns.style.display = 'flex';
            afterBtns.style.display = 'none';
            successEl.classList.remove('visible');
            errorEl.classList.remove('visible');
            errorEl.textContent = '';
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'download my data';

            document.getElementById('delete-export-overlay').classList.remove('hidden');
        }

        async function downloadUserExport(options = {}) {
            const downloadBtn = options.buttonEl || document.getElementById('delete-export-download');
            const errorEl = options.errorEl || document.getElementById('delete-export-error');
            const successEl = options.successEl || document.getElementById('delete-export-success');
            const initialBtns = options.initialBtnsEl || document.getElementById('delete-export-buttons-initial');
            const afterBtns = options.afterBtnsEl || document.getElementById('delete-export-buttons-after');
            const defaultLabel = options.defaultLabel || 'download my data';
            const isDeleteFlow = Boolean(initialBtns && afterBtns && successEl);

            if (errorEl) {
                errorEl.classList.remove('visible');
                errorEl.textContent = '';
            }
            if (downloadBtn) {
                downloadBtn.disabled = true;
                downloadBtn.textContent = 'preparing...';
            }

            try {
                const res = await authFetch(`${API_URL}/user/export`);
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error?.message || 'export failed — try again in a minute');
                }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'brutus-data-export.json';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                if (isDeleteFlow) {
                    initialBtns.style.display = 'none';
                    afterBtns.style.display = 'flex';
                    successEl.classList.add('visible');
                }
                if (options.onSuccess) options.onSuccess();
            } catch (err) {
                const message = err.message || 'something went wrong.';
                if (errorEl) {
                    errorEl.textContent = message;
                    errorEl.classList.add('visible');
                }
                if (options.onError) options.onError(message);
                if (downloadBtn) {
                    downloadBtn.disabled = false;
                    downloadBtn.textContent = defaultLabel;
                }
            }
        }

        function proceedToPasswordConfirm() {
            closeAllDeleteModals();
            openDeleteAccountModal();
        }

        // Wire up the retention-flow event listeners
        (() => {
            // Entry: profile page "delete account" button → survey (NOT password confirm directly)
            const trigger = document.getElementById('delete-account-btn');
            if (trigger) trigger.addEventListener('click', openDeleteSurveyModal);

            // Modal A — survey
            document.getElementById('delete-survey-close')?.addEventListener('click', closeAllDeleteModals);
            document.getElementById('delete-survey-cancel')?.addEventListener('click', closeAllDeleteModals);
            document.getElementById('delete-survey-continue')?.addEventListener('click', continueDeleteSurvey);

            // Modal B — progress recap
            document.getElementById('delete-progress-close')?.addEventListener('click', closeAllDeleteModals);
            document.getElementById('delete-progress-stay')?.addEventListener('click', closeAllDeleteModals);
            document.getElementById('delete-progress-continue')?.addEventListener('click', proceedToExportModal);

            // Modal C — export
            document.getElementById('delete-export-close')?.addEventListener('click', closeAllDeleteModals);
            document.getElementById('delete-export-cancel')?.addEventListener('click', closeAllDeleteModals);
            document.getElementById('delete-export-skip')?.addEventListener('click', proceedToPasswordConfirm);
            document.getElementById('delete-export-download')?.addEventListener('click', downloadUserExport);
            document.getElementById('delete-export-after-cancel')?.addEventListener('click', closeAllDeleteModals);
            document.getElementById('delete-export-after-continue')?.addEventListener('click', proceedToPasswordConfirm);

            // Existing password-confirm modal listeners (unchanged behavior)
            const closeBtn = document.getElementById('delete-account-close');
            if (closeBtn) closeBtn.addEventListener('click', closeDeleteAccountModal);

            const cancelBtn = document.getElementById('delete-account-cancel');
            if (cancelBtn) cancelBtn.addEventListener('click', closeDeleteAccountModal);

            const confirmBtn = document.getElementById('delete-account-confirm');
            if (confirmBtn) confirmBtn.addEventListener('click', confirmDeleteAccount);

            // Enter inside the password field submits
            const passwordInput = document.getElementById('delete-account-password');
            if (passwordInput) {
                passwordInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        confirmDeleteAccount();
                    }
                });
            }
        })();

        document.getElementById('ob-selfemployed').addEventListener('change', function() {
            document.getElementById('ob-businessname-wrap').style.display = this.checked ? 'block' : 'none';
            if (this.checked) document.getElementById('ob-company').value = 'Self-employed';
        });

        // ==================== PROFILE PAGE ====================

        async function loadProfilePage() {
            if (!currentUser) return;
            const s = currentUser.settings || {};
            const heading = document.getElementById('account-heading-name');
            if (heading) heading.textContent = currentUser.name || '';
            document.getElementById('profile-name').value = currentUser.name || '';
            document.getElementById('profile-email').value = currentUser.email || '';
            document.getElementById('profile-product').value = s.product || '';
            document.getElementById('profile-company').value = s.company === 'Self-employed' ? '' : (s.company || '');
            document.getElementById('profile-selfemployed').checked = s.company === 'Self-employed';
            document.getElementById('profile-businessname-wrap').style.display = s.company === 'Self-employed' ? 'block' : 'none';
            document.getElementById('profile-businessname').value = s.businessName || '';
            document.getElementById('profile-experience').value = s.experience || '';
            document.getElementById('profile-challenge').value = s.challenge || '';
            document.getElementById('profile-closerate').value = s.closeRate || '';
            document.getElementById('profile-coachingstyle').value = s.coachingStyle || 'Balanced';
            document.getElementById('toggle-brutal').checked = !!s.brutalHonestyMode;
            document.getElementById('toggle-interrupts').checked = !!s.realTimeInterrupts;
            document.getElementById('toggle-roast').checked = !!s.dailyRoastSummary;
            document.getElementById('toggle-alerts').checked = !!s.improvementAlerts;

            try {
                const data = await apiCall('/user/profile');
                const p = data.profile;
                document.getElementById('ai-profile-summary').textContent = p.summary || 'No coaching profile yet.';
                document.getElementById('ai-profile-stats').textContent =
                    `${p.totalCallsAnalyzed || 0} calls analyzed · talk ratio avg ${p.talkRatioAvg || 0}% · close rate ${p.closeRate || 0}%`;
            } catch (_) {
                document.getElementById('ai-profile-summary').textContent = 'Could not load coaching profile.';
                document.getElementById('ai-profile-stats').textContent = '';
            }
        }

        document.getElementById('profile-selfemployed').addEventListener('change', function() {
            document.getElementById('profile-businessname-wrap').style.display = this.checked ? 'block' : 'none';
        });

        document.getElementById('save-account-btn').addEventListener('click', async () => {
            const name = document.getElementById('profile-name').value.trim();
            const email = document.getElementById('profile-email').value.trim();
            const msg = document.getElementById('profile-account-msg');
            try {
                const data = await apiCall('/user/account', { method: 'PATCH', body: JSON.stringify({ name, email }) });
                if (currentUser) { currentUser.name = data.user.name; currentUser.email = data.user.email; }
                const heading = document.getElementById('account-heading-name');
                if (heading && data.user?.name) heading.textContent = data.user.name;
                const sideName = document.getElementById('sidebar-user-name');
                if (sideName && data.user?.name) sideName.textContent = data.user.name;
                msg.textContent = 'saved';
                msg.style.color = '#50ff80';
                msg.style.display = 'block';
                setTimeout(() => msg.style.display = 'none', 3000);
            } catch (e) {
                msg.textContent = e.message;
                msg.style.color = '#ff5050';
                msg.style.display = 'block';
            }
        });

        document.getElementById('save-sales-btn').addEventListener('click', async () => {
            const selfEmployed = document.getElementById('profile-selfemployed').checked;
            const settings = {
                product: document.getElementById('profile-product').value.trim(),
                company: selfEmployed ? 'Self-employed' : document.getElementById('profile-company').value.trim(),
                businessName: document.getElementById('profile-businessname').value.trim(),
                experience: document.getElementById('profile-experience').value,
                challenge: document.getElementById('profile-challenge').value,
                closeRate: document.getElementById('profile-closerate').value,
                coachingStyle: document.getElementById('profile-coachingstyle').value
            };
            const msg = document.getElementById('profile-sales-msg');
            try {
                const data = await apiCall('/user/settings', { method: 'PUT', body: JSON.stringify({ settings }) });
                if (currentUser) currentUser.settings = { ...currentUser.settings, ...data.settings };
                msg.textContent = 'saved';
                msg.style.color = '#50ff80';
                msg.style.display = 'block';
                setTimeout(() => msg.style.display = 'none', 3000);
            } catch (e) {
                msg.textContent = e.message;
                msg.style.color = '#ff5050';
                msg.style.display = 'block';
            }
        });

        document.querySelectorAll('.coaching-toggle').forEach(toggle => {
            toggle.addEventListener('change', async function() {
                const setting = this.dataset.setting;
                try {
                    const data = await apiCall('/user/settings', { method: 'PUT', body: JSON.stringify({ settings: { [setting]: this.checked } }) });
                    if (currentUser) currentUser.settings = { ...currentUser.settings, ...data.settings };
                } catch (_) {}
            });
        });

        document.getElementById('reset-ai-profile-btn').addEventListener('click', async () => {
            if (!confirm('Reset your AI coaching profile? Strengths, habits, and inferred stats will be cleared.')) return;
            const msg = document.getElementById('ai-profile-msg');
            try {
                await apiCall('/user/profile/reset', { method: 'POST' });
                msg.textContent = 'Coaching profile reset.';
                msg.style.display = 'block';
                loadProfilePage();
                setTimeout(() => { msg.style.display = 'none'; }, 3000);
            } catch (e) {
                msg.textContent = e.message;
                msg.style.color = '#ff5050';
                msg.style.display = 'block';
            }
        });

        document.getElementById('export-my-data-btn')?.addEventListener('click', () => {
            const btn = document.getElementById('export-my-data-btn');
            const msg = document.getElementById('profile-export-msg');
            if (msg) {
                msg.style.display = 'none';
                msg.style.color = '#50ff80';
            }
            downloadUserExport({
                buttonEl: btn,
                defaultLabel: 'download my data',
                onSuccess: () => {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = 'download my data';
                    }
                    if (msg) {
                        msg.textContent = 'Download started — check your downloads folder.';
                        msg.style.display = 'block';
                        setTimeout(() => { msg.style.display = 'none'; }, 4000);
                    }
                },
                onError: (message) => {
                    if (msg) {
                        msg.textContent = message;
                        msg.style.color = '#ff5050';
                        msg.style.display = 'block';
                    }
                }
            });
        });
        
        // ==================== DASHBOARD ====================
        async function loadDashboard() {
            try {
                const data = await apiCall('/user/dashboard');
                
                // Update stats
                if (data.profile) {
                    document.getElementById('close-rate').textContent = 
                        data.profile.closeRate ? `${data.profile.closeRate}%` : '--%';
                    
                    const talkRatio = data.profile.talkRatioAvg;
                    const talkRatioEl = document.getElementById('talk-ratio');
                    if (talkRatioEl) talkRatioEl.textContent = talkRatio ? `${Math.round(talkRatio)}%` : '--%';
                    
                    document.getElementById('calls-analyzed').textContent = data.profile.totalCallsAnalyzed || 0;
                    
                    const progressCalls = document.getElementById('progress-calls');
                    if (progressCalls) progressCalls.textContent = data.profile.totalCallsAnalyzed || 0;
                    const progressTalk = document.getElementById('progress-talk-ratio');
                    if (progressTalk) progressTalk.textContent = talkRatio ? `${Math.round(talkRatio)}%` : '--%';
                }
                
                // Update weekly stats
                if (data.weeklyStats) {
                    const progressWeek = document.getElementById('progress-calls-week');
                    if (progressWeek) progressWeek.textContent = `+${data.weeklyStats.callCount} this week`;
                    
                    // Build weekly chart
                    const scores = data.weeklyStats.scores || [];
                    buildWeeklyChart(scores);

                    // Calculate average score
                    if (scores.length > 0) {
                        const avgScore = Math.round(
                            scores.reduce((sum, s) => sum + s.score, 0) / scores.length
                        );
                        document.getElementById('overall-score').textContent = avgScore;
                        const progressScore = document.getElementById('progress-score');
                        if (progressScore) progressScore.textContent = avgScore;
                        const progressBar = document.getElementById('progress-score-bar');
                        if (progressBar) progressBar.style.width = `${avgScore}%`;
                    }
                }
                
                // Update recent activity
                const activityList = document.getElementById('activity-list');
                if (activityList) {
                    if (data.recentCalls && data.recentCalls.length > 0 && typeof paperActivityRow === 'function') {
                        activityList.innerHTML = data.recentCalls.slice(0, 4).map(paperActivityRow).join('');
                    } else if (!data.recentCalls || data.recentCalls.length === 0) {
                        activityList.innerHTML = '';
                    }
                }

                // Cold calls are archived: reveal the read-only history nav only for
                // users who actually have cold-call sessions.
                if (data.features && data.features.coldCallHistory) {
                    document.getElementById('nav-cold-calls')?.classList.remove('hidden');
                }
                // Same gate for roleplay — reveals the history nav AND the launcher
                // card in the roleplays-view header.
                if (data.features && data.features.roleplay) {
                    document.getElementById('nav-roleplays')?.classList.remove('hidden');
                    document.getElementById('rp-start-wrap')?.classList.remove('hidden');
                }

                applyDisciplineLine(data.recentCalls);

            } catch (error) {
                console.error('Failed to load dashboard:', error);
            }
        }

        // Sidebar DISCIPLINE copy. The newest recent call that already has
        // brutusFeedback.actionItems replaces the Paper sentence. No items yet
        // leaves that sentence as transcribed.
        function disciplineTextFromCalls(calls) {
            const list = Array.isArray(calls) ? calls : [];
            for (let i = 0; i < list.length; i++) {
                const raw = list[i] && list[i].brutusFeedback;
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
                const items = Array.isArray(raw.actionItems) ? raw.actionItems : [];
                const lines = [];
                for (let j = 0; j < items.length && lines.length < 3; j++) {
                    if (typeof items[j] !== 'string') continue;
                    const text = items[j].trim();
                    if (!text) continue;
                    lines.push(/[.!?]$/.test(text) ? text : text + '.');
                }
                if (lines.length) return lines.join(' ');
            }
            return '';
        }

        function applyDisciplineLine(calls) {
            const el = document.getElementById('discipline-line');
            if (!el) return;
            if (!('paper' in el.dataset)) el.dataset.paper = (el.textContent || '').trim();
            const next = disciplineTextFromCalls(calls);
            el.textContent = next || el.dataset.paper || '';
        }

        if (window.brutus && typeof window.brutus.onMonitoringStopped === 'function') {
            window.brutus.onMonitoringStopped(() => {
                // Overlay /live/end writes the call after this event. A fast
                // analysis lands on the first refresh; a slow one on the second.
                setTimeout(() => { loadDashboard(); }, 8000);
                setTimeout(() => { loadDashboard(); }, 20000);
            });
        }
        
        function escapeHtml(str) {
            if (str == null) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        function getTimeAgo(date) {
            const seconds = Math.floor((new Date() - date) / 1000);

            if (seconds < 60) return 'just now';
            if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
            if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
            if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
            return date.toLocaleDateString();
        }

        function formatDateTime(dateStr) {
            if (!dateStr) return 'unknown';
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return 'unknown';
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const month = months[d.getMonth()];
            const day = d.getDate();
            let hours = d.getHours();
            const mins = String(d.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            return `${month} ${day} · ${hours}:${mins} ${ampm}`;
        }

        function buildWeeklyChart(scores) {
            const chart = document.getElementById('performance-chart');
            if (!chart) return;

            const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            const today = new Date();
            const days = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(today.getDate() - i);
                days.push(d);
            }

            // Group scores by day
            const scoreByDay = {};
            scores.forEach(s => {
                const key = new Date(s.date).toDateString();
                if (!scoreByDay[key]) scoreByDay[key] = [];
                scoreByDay[key].push(s.score);
            });

            if (typeof paperWeeklyChart === 'function') {
                const points = days.map(day => {
                    const dayScores = scoreByDay[day.toDateString()] || [];
                    return dayScores.length
                        ? Math.round(dayScores.reduce((a, b) => a + b, 0) / dayScores.length)
                        : null;
                });
                chart.innerHTML = paperWeeklyChart(points);
                return;
            }

            chart.innerHTML = days.map(day => {
                const key = day.toDateString();
                const isToday = key === today.toDateString();
                const dayScores = scoreByDay[key] || [];
                const avgScore = dayScores.length
                    ? Math.round(dayScores.reduce((a, b) => a + b, 0) / dayScores.length)
                    : null;

                const barClass = avgScore !== null
                    ? (isToday ? 'chart-bar today' : 'chart-bar')
                    : 'chart-bar chart-bar-empty';
                const height = avgScore !== null ? `${avgScore}%` : '4px';

                return `
                    <div class="chart-col">
                        <div class="chart-score-label">${avgScore !== null ? avgScore : ''}</div>
                        <div class="chart-bar-wrap">
                            <div class="${barClass}" style="height: ${height}"></div>
                        </div>
                        <div class="chart-day-label${isToday ? ' today' : ''}">${DAY_NAMES[day.getDay()]}</div>
                    </div>
                `;
            }).join('');
        }

        // ==================== CALL HISTORY ====================
        let allCalls = [];

        async function loadCallHistory() {
            try {
                // Exclude cold-call aggregate rows from the standard call history —
                // those have their own "cold calls" + "roleplays" tabs with per-attempt drill-down.
                const data = await apiCall('/calls?limit=100&excludeTag=cold-call&excludeTag=roleplay');
                allCalls = data.calls || [];
                bindCallsControls();
                refreshCalls();
            } catch (error) {
                console.error('Failed to load call history:', error);
            }
        }

        function renderEmptyCallsCard() {
            const macCtas = [
                `<a href="${DOWNLOAD_URLS.macArm}" target="_blank" rel="noopener" class="empty-call-card-cta" style="margin-left: 8px;">${macDownloadLabel('arm')}</a>`,
                `<a href="${DOWNLOAD_URLS.macIntel}" target="_blank" rel="noopener" class="empty-call-card-cta" style="margin-left: 8px;">${macDownloadLabel('intel')}</a>`
            ];
            if (MAC_ARCH === 'intel') macCtas.reverse();
            const downloadCtas = DOWNLOADS_ENABLED ? `
                    <div>
                        <a href="${DOWNLOAD_URLS.windows}" target="_blank" rel="noopener" class="empty-call-card-cta">download for windows</a>
                        ${macCtas.join('\n                        ')}
                    </div>
                    <div class="empty-call-card-note">${MAC_DOWNLOAD_NOTE}</div>` : '';
            const stepOne = DOWNLOADS_ENABLED ? 'download the desktop app' : 'grab the desktop app at launch';
            return `
                <div class="empty-call-card">
                    <div class="empty-call-card-title">no calls yet.</div>
                    <div class="empty-call-card-sub">Brutus is bored.</div>
                    <ol class="empty-call-card-steps">
                        <li>${stepOne}</li>
                        <li>start a session before your next call</li>
                        <li>watch the panel light up</li>
                    </ol>${downloadCtas}
                </div>
            `;
        }

        let callsQuery = '';
        let callsOutcome = 'all';
        let callsTag = 'all';
        let callsScore = 'all';
        let callsLast30 = false;
        let callsPage = 0;
        const CALLS_PAGE_SIZE = 5;

        function filteredCalls() {
            const q = callsQuery.trim().toLowerCase();
            const cutoff = Date.now() - 30 * 86400000;
            return allCalls.filter(call => {
                if (callsOutcome !== 'all' && call.outcome !== callsOutcome) return false;
                if (callsTag !== 'all' && !(call.tags || []).includes(callsTag)) return false;
                const score = Number(call.overallScore);
                if (callsScore === 'high' && !(score >= 70)) return false;
                if (callsScore === 'mid' && !(score >= 50 && score < 70)) return false;
                if (callsScore === 'low' && !(score < 50)) return false;
                if (callsLast30) {
                    const t = new Date(call.createdAt).getTime();
                    if (isNaN(t) || t < cutoff) return false;
                }
                if (!q) return true;
                const name = (call.contactName || call.prospectName || '').toLowerCase();
                const blob = `${call.overallScore} ${formatDateTime(call.createdAt)} ${(call.tags || []).join(' ')} ${name}`.toLowerCase();
                return blob.includes(q);
            });
        }

        function refreshCalls() {
            const matches = filteredCalls();
            const pages = Math.max(1, Math.ceil(matches.length / CALLS_PAGE_SIZE));
            if (callsPage >= pages) callsPage = pages - 1;
            if (callsPage < 0) callsPage = 0;
            const start = callsPage * CALLS_PAGE_SIZE;
            const pageItems = matches.slice(start, start + CALLS_PAGE_SIZE);
            renderCallHistory(pageItems, matches.length);
        }

        function renderCallHistory(calls, matchCount) {
            const list = document.getElementById('call-history-list');
            if (!list) return;
            const total = matchCount == null ? calls.length : matchCount;

            const subline = document.getElementById('calls-count-subline');
            const logged = allCalls.filter(c => c.outcome).length;
            if (subline) {
                subline.textContent = `${allCalls.length} analyzed call${allCalls.length === 1 ? '' : 's'}. Outcomes logged on ${logged}.`;
            }
            const allChip = document.querySelector('.p-chip[data-filter="all"]');
            if (allChip) allChip.textContent = `All · ${allCalls.length}`;
            const pageMeta = document.getElementById('calls-page-meta');
            const from = total === 0 ? 0 : callsPage * CALLS_PAGE_SIZE + 1;
            const to = callsPage * CALLS_PAGE_SIZE + calls.length;
            if (pageMeta) pageMeta.textContent = `Showing ${from}–${to} of ${total} calls`;

            const prev = document.getElementById('calls-prev-btn');
            const next = document.getElementById('calls-next-btn');
            if (prev) prev.disabled = callsPage <= 0;
            if (next) next.disabled = to >= total;

            if (typeof paperCallsList !== 'function') return;
            list.innerHTML = paperCallsList(calls.map(toPaperCallRow));
        }

        function bindCallsControls() {
            const searchInput = document.getElementById('history-search');
            if (searchInput && !searchInput.dataset.bound) {
                searchInput.dataset.bound = '1';
                searchInput.addEventListener('input', (e) => {
                    callsQuery = e.target.value;
                    callsPage = 0;
                    refreshCalls();
                });
            }
            const row = document.querySelector('.p-chip-row');
            if (row && !row.dataset.bound) {
                row.dataset.bound = '1';
                row.addEventListener('click', (e) => {
                    const outcomeBtn = e.target.closest('[data-outcome]');
                    const clearBtn = e.target.closest('.p-filter-clear');
                    const chip = e.target.closest('.p-chip');
                    const dropdown = document.getElementById('calls-filter-dropdown');
                    if (clearBtn) {
                        callsOutcome = 'all';
                        callsTag = 'all';
                        callsScore = 'all';
                        callsLast30 = false;
                        callsPage = 0;
                        syncCallChips();
                        if (dropdown) dropdown.classList.add('hidden');
                        refreshCalls();
                        return;
                    }
                    if (outcomeBtn) {
                        callsOutcome = outcomeBtn.getAttribute('data-outcome') || 'all';
                        callsPage = 0;
                        syncCallChips();
                        if (dropdown) dropdown.classList.add('hidden');
                        refreshCalls();
                        return;
                    }
                    if (!chip) return;
                    const kind = chip.getAttribute('data-filter');
                    if (kind === 'outcome') {
                        if (dropdown) dropdown.classList.toggle('hidden');
                        chip.setAttribute('aria-expanded', dropdown && !dropdown.classList.contains('hidden') ? 'true' : 'false');
                        return;
                    }
                    if (kind === 'all') {
                        callsOutcome = 'all';
                        callsTag = 'all';
                        callsScore = 'all';
                        callsLast30 = false;
                        callsQuery = '';
                        if (searchInput) searchInput.value = '';
                    } else if (kind === 'tag') {
                        const tags = [...new Set(allCalls.flatMap(c => c.tags || []))];
                        const order = ['all', ...tags];
                        const idx = order.indexOf(callsTag);
                        callsTag = order[(idx + 1) % order.length] || 'all';
                    } else if (kind === 'score') {
                        const order = ['all', 'high', 'mid', 'low'];
                        callsScore = order[(order.indexOf(callsScore) + 1) % order.length];
                    } else if (kind === 'range') {
                        callsLast30 = !callsLast30;
                    }
                    callsPage = 0;
                    syncCallChips();
                    refreshCalls();
                });
            }
            const prev = document.getElementById('calls-prev-btn');
            const next = document.getElementById('calls-next-btn');
            if (prev && !prev.dataset.bound) {
                prev.dataset.bound = '1';
                prev.addEventListener('click', () => { callsPage -= 1; refreshCalls(); });
            }
            if (next && !next.dataset.bound) {
                next.dataset.bound = '1';
                next.addEventListener('click', () => { callsPage += 1; refreshCalls(); });
            }
        }

        function syncCallChips() {
            const scoreLabel = { all: 'Score: all', high: 'Score: 70+', mid: 'Score: 50–69', low: 'Score: under 50' };
            document.querySelectorAll('.p-chip').forEach(chip => {
                const kind = chip.getAttribute('data-filter');
                if (kind === 'outcome') {
                    const label = callsOutcome === 'all' ? 'all' : callsOutcome.replace('_', ' ');
                    chip.textContent = `Outcome: ${label}`;
                    chip.classList.toggle('active', callsOutcome !== 'all');
                } else if (kind === 'tag') {
                    chip.textContent = callsTag === 'all' ? 'Tag: all' : `Tag: ${callsTag}`;
                    chip.classList.toggle('active', callsTag !== 'all');
                } else if (kind === 'score') {
                    chip.textContent = scoreLabel[callsScore] || 'Score: all';
                    chip.classList.toggle('active', callsScore !== 'all');
                } else if (kind === 'range') {
                    chip.classList.toggle('active', callsLast30);
                } else if (kind === 'all') {
                    chip.classList.toggle('active', callsOutcome === 'all' && callsTag === 'all' && callsScore === 'all' && !callsLast30);
                }
            });
            document.querySelectorAll('.p-filter-option').forEach(opt => {
                opt.classList.toggle('active', opt.getAttribute('data-outcome') === callsOutcome);
            });
        }

        function toPaperCallRow(call) {
            const d = new Date(call.createdAt);
            const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
            const dayDiff = isNaN(d.getTime()) ? null : Math.round((midnight(new Date()) - midnight(d)) / 86400000);
            const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
            const dayLabel = dayDiff === 0 ? 'TODAY' : dayDiff === 1 ? 'YESTERDAY'
                : dayDiff == null ? '' : `${months[d.getMonth()]} ${d.getDate()}`;
            return {
                ...call,
                name: call.contactName || call.prospectName || 'Call',
                score: call.overallScore,
                time: isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                durationMin: Math.floor((call.durationSeconds || 0) / 60),
                dayLabel
            };
        }

        // ==================== COLD CALL SESSIONS ====================
        async function loadColdCallSessions() {
            const list = document.getElementById('cold-call-sessions-list');
            if (!list) return;
            list.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);margin-top:20px;">loading...</p>';
            try {
                const data = await apiCall('/coldcall/sessions?limit=50');
                const sessions = data.sessions || [];
                if (sessions.length === 0) {
                    list.innerHTML = `
                        <div class="empty-call-card">
                            <div class="empty-call-card-title">no cold call sessions.</div>
                            <div class="empty-call-card-sub">cold call mode is archived — this view only shows past sessions.</div>
                        </div>`;
                    return;
                }
                list.innerHTML = sessions.map(s => {
                    const totalMins = Math.floor((s.totalDurationSec || 0) / 60);
                    const duration = totalMins > 0 ? `${totalMins}m` : '<1m';
                    const connectPct = Math.round((s.connectRate || 0) * 100);
                    const rateClass = connectPct >= 15 ? 'good' : connectPct >= 5 ? 'warning' : 'bad';
                    return `
                        <div class="history-call-item" data-action="open-cold-call-session" data-id="${s.id}">
                            <div class="history-score ${rateClass}">${connectPct}%</div>
                            <div class="history-call-meta">
                                <div class="history-call-date">${formatDateTime(s.endedAt || s.startedAt)}</div>
                                <div class="history-call-stats">${s.totalDials || 0} dials · ${duration} · connect rate ${connectPct}%</div>
                            </div>
                        </div>
                    `;
                }).join('');
            } catch (err) {
                console.error('Failed to load cold call sessions:', err);
                list.innerHTML = '<p style="text-align:center;color:#ff5050;margin-top:20px;">failed to load — try again</p>';
            }
        }

        const OUTCOME_LABELS = {
            voicemail: 'voicemail',
            'no-answer': 'no answer',
            connect: 'connect',
            'wrong-number': 'wrong number',
            abandoned: 'abandoned',
            other: 'other'
        };
        const OUTCOME_CLASS = {
            voicemail: 'warning',
            'no-answer': 'bad',
            connect: 'good',
            'wrong-number': 'bad',
            abandoned: 'bad',
            other: 'warning'
        };

        async function openColdCallSessionModal(sessionId) {
            const overlay = document.getElementById('cold-call-modal-overlay');
            const body = document.getElementById('cold-call-modal-body');
            const meta = document.getElementById('cold-call-modal-meta');

            body.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.4);padding:40px 0;">loading...</p>';
            overlay.classList.remove('hidden');

            try {
                const data = await apiCall(`/coldcall/session/${sessionId}`);
                const { session, attempts, summary } = data;
                const counts = summary.counts || {};
                const total = summary.totalDials || 0;
                const connectPct = Math.round((summary.connectRate || 0) * 100);
                const totalMin = Math.floor((summary.totalDurationSec || 0) / 60);
                const avgConnect = summary.avgConnectSec || 0;
                const avgMin = Math.floor(avgConnect / 60);
                const avgSec = avgConnect % 60;

                meta.textContent = `${formatDateTime(session.endedAt || session.startedAt)} · ${total} dials · ${totalMin > 0 ? totalMin + 'm' : '<1m'}`;

                const summaryHtml = `
                    <div class="call-modal-section" style="margin-top:0;padding-top:0;border-top:none;">
                        <div class="call-modal-section-title">session summary</div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:13px;color:rgba(255,255,255,0.75);">
                            <div>dials <strong style="color:#fff;margin-left:6px;">${total}</strong></div>
                            <div>connects <strong style="color:#fff;margin-left:6px;">${counts.connect || 0}</strong></div>
                            <div>voicemails <strong style="color:#fff;margin-left:6px;">${counts.voicemail || 0}</strong></div>
                            <div>no-answer <strong style="color:#fff;margin-left:6px;">${counts['no-answer'] || 0}</strong></div>
                            <div>connect rate <strong style="color:#fff;margin-left:6px;">${connectPct}%</strong></div>
                            <div>avg connect <strong style="color:#fff;margin-left:6px;">${avgMin}:${String(avgSec).padStart(2,'0')}</strong></div>
                            <div>session time <strong style="color:#fff;margin-left:6px;">${totalMin} min</strong></div>
                            <div>other <strong style="color:#fff;margin-left:6px;">${(counts['wrong-number'] || 0) + (counts.abandoned || 0) + (counts.other || 0)}</strong></div>
                        </div>
                    </div>`;

                const top = Array.isArray(summary.topFeedback) ? summary.topFeedback : [];
                const topHtml = top.length ? `
                    <div class="call-modal-section">
                        <div class="call-modal-section-title">most-heard coaching</div>
                        ${top.map(t => `<div class="call-feedback-item insight"><div class="feedback-item-row"><span class="feedback-item-text">${escapeHtml(t.msg)} <span style="color:rgba(255,255,255,0.4);">×${t.count}</span></span></div></div>`).join('')}
                    </div>` : '';

                const attemptsHtml = (attempts || []).map(a => {
                    const oc = a.outcome || 'unknown';
                    const cls = OUTCOME_CLASS[oc] || 'warning';
                    const label = OUTCOME_LABELS[oc] || oc;
                    const dur = typeof a.durationSec === 'number' ? `${a.durationSec}s` : '—';
                    const fb = Array.isArray(a.feedback) ? a.feedback : [];
                    const transcript = (a.transcript || '').trim();
                    const fbHtml = fb.length ? fb.map(f => {
                        const text = (f && (f.feedback || f.short || f.message)) || '';
                        if (!text) return '';
                        return `<div class="call-feedback-item insight"><div class="feedback-item-row"><span class="feedback-item-text">${escapeHtml(text)}</span></div></div>`;
                    }).join('') : '<div style="color:rgba(255,255,255,0.3);font-size:12px;">no coaching fired</div>';
                    const transcriptId = `cc-transcript-${a.ordinal}`;
                    const transcriptToggle = transcript
                        ? `<button type="button" class="cc-transcript-toggle" data-action="toggle-cc-transcript" data-target="${transcriptId}">show transcript</button>
                           <div id="${transcriptId}" class="cc-transcript hidden">${escapeHtml(transcript)}</div>`
                        : '<div style="color:rgba(255,255,255,0.3);font-size:12px;">no transcript captured</div>';

                    return `
                        <div class="cc-attempt-row">
                            <div class="cc-attempt-head">
                                <div>
                                    <span class="history-score ${cls}" style="display:inline-block;width:32px;height:32px;font-size:11px;line-height:32px;">${a.ordinal}</span>
                                    <span style="margin-left:10px;font-weight:600;">${label}</span>
                                </div>
                                <div style="color:rgba(255,255,255,0.4);font-size:12px;">${dur}</div>
                            </div>
                            <div style="margin-top:10px;">${fbHtml}</div>
                            <div style="margin-top:8px;">${transcriptToggle}</div>
                        </div>
                    `;
                }).join('');

                body.innerHTML = `
                    ${summaryHtml}
                    ${topHtml}
                    <div class="call-modal-section">
                        <div class="call-modal-section-title">attempts</div>
                        ${attemptsHtml || '<p style="color:rgba(255,255,255,0.4);">no attempts</p>'}
                    </div>`;
            } catch (err) {
                console.error('Failed to load cold call session:', err);
                body.innerHTML = '<p style="text-align:center;color:#ff5050;padding:40px 0;">failed to load session</p>';
            }
        }

        function toggleColdCallTranscript(id, btn) {
            const el = document.getElementById(id);
            if (!el) return;
            const hidden = el.classList.toggle('hidden');
            btn.textContent = hidden ? 'show transcript' : 'hide transcript';
        }

        // ==================== ROLEPLAY SESSIONS ====================
        async function loadRoleplaySessions() {
            const list = document.getElementById('roleplay-sessions-list');
            if (!list) return;
            list.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);margin-top:20px;">loading...</p>';
            try {
                const data = await apiCall('/roleplay/sessions?limit=50');
                const sessions = data.sessions || [];
                if (sessions.length === 0) {
                    list.innerHTML = '<p class="p-t-14 p-c-3">no roleplay drills yet.</p><p class="p-t-12 p-c-4">launch a roleplay from the desktop app to drill your weaknesses.</p>';
                    return;
                }
                list.innerHTML = sessions.map(s => (
                    typeof paperRoleplaySessionRow === 'function'
                        ? paperRoleplaySessionRow(s)
                        : ''
                )).join('');
            } catch (err) {
                console.error('Failed to load roleplay sessions:', err);
                list.innerHTML = '<p style="text-align:center;color:#ff5050;margin-top:20px;">failed to load — try again</p>';
            }
        }

        function toPaperRoleplayResults(summary, turns, call) {
            const raw = (call && call.brutusFeedback) || {};
            const weakness = Array.isArray(raw.weaknessExposure) ? raw.weaknessExposure : [];
            return {
                persona: (summary && summary.persona) || raw.persona || '',
                scenario: (summary && summary.persona) || raw.persona || '',
                totalTurns: (summary && summary.totalTurns) || 0,
                drillTurns: (summary && summary.drillTurns) || 0,
                coachPauses: (summary && summary.coachPauseTurns) || 0,
                drillDurationSec: (summary && summary.drillDurationSec) || 0,
                overall: raw.overallRoast || (summary && summary.overallRoast) || '',
                weaknesses: weakness.map(w => ({
                    title: w.habit || '',
                    status: w.tested
                        ? `tested · ${w.handling || 'unknown'}${w.evidence ? ' · ' + w.evidence : ''}`
                        : 'not tested in this drill',
                    handled: w.handling === 'handled'
                })),
                actionItems: Array.isArray(raw.actionItems) ? raw.actionItems : [],
                transcript: (turns || []).map(t => ({
                    role: t.speaker === 'rep' ? 'rep' : (t.phase === 'coach-pause' ? 'coach' : 'brutus'),
                    turn: t.ordinal,
                    text: (t.text || '').trim() || '(empty)'
                }))
            };
        }

        function showPaperRoleplayResults(results, metaText) {
            const panel = document.getElementById('rp-results');
            const body = document.getElementById('rp-results-body');
            const meta = document.getElementById('rp-results-meta');
            if (!panel || !body || typeof paperRoleplayResults !== 'function') return false;
            if (meta && metaText) meta.textContent = metaText;
            body.innerHTML = paperRoleplayResults(results);
            panel.hidden = false;
            panel.scrollIntoView({ block: 'nearest' });
            return true;
        }

        async function openRoleplaySessionModal(sessionId) {
            const panel = document.getElementById('rp-results');
            const body = document.getElementById('rp-results-body');
            if (panel && body) {
                body.innerHTML = '<p class="p-t-14 p-c-3">loading...</p>';
                panel.hidden = false;
            }

            try {
                const data = await apiCall(`/roleplay/session/${sessionId}`);
                const { session, turns, summary, call } = data;
                const sec = (summary && summary.drillDurationSec) || 0;
                const day = typeof paperRoleplayDay === 'function'
                    ? paperRoleplayDay(session.endedAt || session.startedAt)
                    : formatDateTime(session.endedAt || session.startedAt);
                const metaText = `${day} · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} · ${summary.totalTurns || 0} turns`;
                const shown = showPaperRoleplayResults(toPaperRoleplayResults(summary, turns, call), metaText);
                if (!shown) throw new Error('roleplay results template missing');
            } catch (err) {
                console.error('Failed to load roleplay session:', err);
                if (body) body.innerHTML = '<p class="p-t-14 p-c-3">failed to load session</p>';
            }
        }

        // ==================== WEB ROLEPLAY DRILL ====================
        // Direct port of the desktop overlay roleplay flow, adapted for vanilla
        // browser: sessionStorage auth, single full-bleed modal, no Electron IPC.
        // All backend endpoints already exist (no server changes required).

        const RP_DEFAULT_VOICE = 'UgBBYS2sOqTuMpoF3BR0'; // Mark — backend default
        // Same curated allowlist as the desktop Settings picker. Backend /tts
        // re-validates against the same set, so an out-of-list id can't reach
        // ElevenLabs even if someone tampers with localStorage.
        const RP_BRUTUS_VOICES = [
            { name: 'Mark',        id: 'UgBBYS2sOqTuMpoF3BR0' },
            { name: 'Jarnathan',   id: 'c6SfcYrb2t09NHXiT80T' },
            { name: 'Spuds Oxley', id: 'NOpBlnGInO9m6vDvFkFC' },
            { name: 'Jon',         id: 'Cz0K1kOv9tD8l0b5Qu53' },
            { name: 'Donovan',     id: 'DMyrgzQFny3JI1Y1paM5' },
            { name: 'Boyd',        id: 'gfRt6Z3Z8aTbpLfexQ7N' },
        ];
        // VAD thresholds tuned to the 2026-05-22 ambient probe with AEC
        // enabled: user's actual setup produced p50=24.9 / p95=32.7 / max=32.8
        // at idle. The previous SPEECH=16 / SILENCE=8 values were below ambient,
        // so VAD treated the room as speech and silence-detect never fired
        // (recorder ran until the 25s max-cap on every turn).
        //
        // SILENCE must be above ambient p95 for the silence timer to ever fire
        // on real silence. SPEECH must be above SILENCE (hysteresis) and below
        // observed real-speech avg (~50+ in the 2026-05-22 trace) so actual
        // speech still triggers. Margins:
        //   SILENCE = p95 + ~2 = 35  (silence-detect fires when avg dips below ambient)
        //   SPEECH  = SILENCE + 5 = 40  (small hysteresis gap, well under real-speech avg)
        // If a future user's room is louder, the ambient probe at modal open
        // will surface it; tune from those numbers, do not guess.
        const RP_VAD_SPEECH_THRESHOLD = 40;
        const RP_VAD_SILENCE_THRESHOLD = 35;
        const RP_VAD_SILENCE_MS = 1200;
        const RP_VAD_MIN_SPEECH_MS = 250;
        const RP_VAD_MAX_RECORDING_MS = 25000;
        let rpSelectedVoiceId = (() => {
            try {
                const stored = localStorage.getItem('roleplayVoiceId');
                if (stored && RP_BRUTUS_VOICES.some(v => v.id === stored)) return stored;
            } catch (_) {}
            return RP_DEFAULT_VOICE;
        })();

        // Module-level roleplay state (rp* prefix to avoid colliding with rest of frontend).
        let rpSessionId = null;
        let rpPhase = 'setup';
        let rpPersona = null;
        let rpMicStream = null;
        let rpRepAudioCtx = null;
        let rpRepAnalyser = null;
        let rpRepBars = null;
        let rpRepAnimFrame = null;
        let rpRecorder = null;
        let rpChunks = [];
        let rpIsRepSpeaking = false;
        let rpSpeechStartedAt = null;
        let rpVadSilenceStartedAt = null;
        let rpVadEnabled = false;
        let rpIsPaused = false;
        let rpAwaitingReply = false;
        let rpTtsAudioCtx = null;
        let rpTtsAnalyser = null;
        let rpTtsAnimFrame = null;
        let rpBrutusBars = null;
        let rpTtsQueue = Promise.resolve();
        let rpTtsQueueDepth = 0;
        // True when rpStopRecorder was called by an explicit user action
        // (pause+coach, end session) rather than by VAD silence-detect. The
        // recorder onstop callback consults this and discards the blob
        // instead of submitting it via /respond — prevents the in-flight
        // blob from racing the coach-hint or end-session POST and tripping
        // the server-side P2002 ordinal collision.
        let rpPendingDiscardOnStop = false;
        // Incremented by rpFlushTtsQueue. Each in-flight rpPlayTtsChunk
        // captures the current generation at entry and bails out before
        // playback if it has been bumped — without this, a barge-in flush
        // only stops the currently-playing source, but chunks whose /tts
        // fetch was in flight will start playing as soon as their fetch
        // resolves (observed in the 2026-05-22 smoke test).
        let rpTtsCancelGeneration = 0;
        let rpTtsChunkCounter = 0;
        let rpCurrentTtsSource = null;
        let rpSessionStartedAt = 0;
        let rpHeadphoneWarnAcked = false;
        let rpIsActive = false;

        function rpTrace(...args) {
            const t = rpSessionStartedAt ? Date.now() - rpSessionStartedAt : 0;
            console.log(`[Roleplay][trace] +${t}ms`, ...args);
        }

        // Drop anything still queued in rpTtsQueue and stop a currently-playing
        // source. Used at drill-modal launch (defensive: nothing should be
        // queued, but a stale coach-hint from before drill phase would land
        // ahead of the first drill reply). Used as a hard reset on phase change.
        function rpFlushTtsQueue(reason) {
            const wasDepth = rpTtsQueueDepth;
            const hadSource = !!rpCurrentTtsSource;
            // Bump the generation BEFORE stopping the source so any in-flight
            // rpPlayTtsChunk that already passed its fetch-await but hasn't
            // started playback yet sees the new generation and bails.
            rpTtsCancelGeneration++;
            if (rpCurrentTtsSource) {
                try { rpCurrentTtsSource.stop(); } catch (_) {}
                rpCurrentTtsSource = null;
            }
            rpTtsQueue = Promise.resolve();
            rpTtsQueueDepth = 0;
            if (wasDepth > 0 || hadSource) {
                rpTrace('tts queue flushed', { reason, depthBefore: wasDepth, hadSource, generation: rpTtsCancelGeneration });
            }
        }

        // ---- Waveform bar init/update ----

        function rpInitBars(elementId, n) {
            const el = document.getElementById(elementId);
            if (!el) return null;
            if (el.children.length === 0) {
                for (let i = 0; i < n; i++) {
                    const bar = document.createElement('div');
                    bar.className = 'rp-bar';
                    el.appendChild(bar);
                }
            }
            return el.querySelectorAll('.rp-bar');
        }

        function rpUpdateBars(bars, dataArray) {
            if (!bars) return;
            bars.forEach((bar, i) => {
                const v = dataArray[i] || 0;
                bar.style.height = Math.max(4, (v / 255) * 35) + 'px';
            });
        }

        function rpZeroBars(bars) {
            if (!bars) return;
            bars.forEach(b => { b.style.height = '4px'; });
        }

        // ---- TTS playback via Web Audio (drives Brutus waveform) ----

        function rpSplitForTts(text, limit = 180) {
            const sentences = String(text).split(/(?<=[.!?])\s+/);
            const out = [];
            let cur = '';
            for (const s of sentences) {
                const candidate = cur ? `${cur} ${s}` : s;
                if (candidate.length <= limit) { cur = candidate; continue; }
                if (cur) { out.push(cur); cur = ''; }
                if (s.length <= limit) { cur = s; }
                else {
                    for (let i = 0; i < s.length; i += limit) out.push(s.slice(i, i + limit));
                }
            }
            if (cur) out.push(cur);
            return out.filter(Boolean);
        }

        async function rpPlayTts(text, voiceId) {
            if (!text || !text.trim()) return;
            // User-picked voice wins over the backend default for the drill prospect.
            // Coach-hint TTS (setup/coach-pause) also uses the same picked voice for
            // consistency; user can change it any time on the roleplay launch card.
            const effectiveVoiceId = rpSelectedVoiceId || voiceId || RP_DEFAULT_VOICE;
            const chunks = rpSplitForTts(text);
            rpTtsQueueDepth += chunks.length;
            rpTrace('rpPlayTts queued', { phase: rpPhase, textLen: text.length, chunkCount: chunks.length, queueDepth: rpTtsQueueDepth });
            rpTtsQueue = rpTtsQueue.then(async () => {
                for (const c of chunks) {
                    try {
                        await rpPlayTtsChunk(c, effectiveVoiceId);
                    } catch (err) {
                        console.error('[Roleplay] TTS chunk failed:', err.message);
                    } finally {
                        rpTtsQueueDepth = Math.max(0, rpTtsQueueDepth - 1);
                    }
                }
            });
            return rpTtsQueue;
        }

        // Eagerly create the TTS AudioContext from a user-gesture handler so
        // Chrome's autoplay policy lets it transition to 'running' before any
        // TTS chunk arrives. Without this the context stays 'suspended' on
        // first use; source.onended then never fires and the TTS queue hangs.
        async function rpEnsureTtsAudioContext() {
            if (!rpTtsAudioCtx || rpTtsAudioCtx.state === 'closed') {
                try {
                    rpTtsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
                } catch (err) {
                    console.error('[Roleplay] TTS AudioContext create failed:', err);
                    return null;
                }
            }
            if (rpTtsAudioCtx.state === 'suspended') {
                try { await rpTtsAudioCtx.resume(); } catch (err) {
                    console.warn('[Roleplay] TTS AudioContext resume failed (likely no user gesture):', err);
                }
            }
            return rpTtsAudioCtx;
        }

        async function rpPlayTtsChunk(text, voiceId) {
            // Capture the cancellation generation at entry. If rpFlushTtsQueue
            // bumps it before we reach source.start(), bail out without
            // playing — this is the barge-in fix: without it, a /tts fetch
            // already in flight when the user barges in resolves and plays
            // anyway, because rpFlushTtsQueue can only stop rpCurrentTtsSource,
            // not in-flight Promises.
            const myGen = rpTtsCancelGeneration;
            const chunkId = ++rpTtsChunkCounter;
            rpTrace('tts chunk fetch start', { chunkId, textLen: text.length, phase: rpPhase, generation: myGen });
            const res = await authFetch(`${API_URL}/tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify({ text, voiceId })
            });
            rpTrace('/tts status', { chunkId, status: res.status, textLen: text.length, voiceId });
            if (!res.ok) throw new Error(`tts ${res.status}`);
            if (myGen !== rpTtsCancelGeneration) {
                rpTrace('tts chunk cancelled after fetch', { chunkId, reason: 'flush during fetch' });
                return;
            }
            const buf = await res.arrayBuffer();
            const stateBefore = rpTtsAudioCtx?.state || '(none)';
            await rpEnsureTtsAudioContext();
            const stateAfter = rpTtsAudioCtx?.state || '(none)';
            rpTrace('tts audioCtx', { chunkId, stateBefore, stateAfter, bufBytes: buf.byteLength });
            if (!rpTtsAudioCtx) throw new Error('TTS AudioContext unavailable');
            if (myGen !== rpTtsCancelGeneration) {
                rpTrace('tts chunk cancelled before decode', { chunkId, reason: 'flush during audioCtx ensure' });
                return;
            }
            const audioBuf = await rpTtsAudioCtx.decodeAudioData(buf);
            if (myGen !== rpTtsCancelGeneration) {
                rpTrace('tts chunk cancelled before play', { chunkId, reason: 'flush during decode' });
                return;
            }
            const source = rpTtsAudioCtx.createBufferSource();
            source.buffer = audioBuf;
            const analyserLocal = rpTtsAudioCtx.createAnalyser();
            analyserLocal.fftSize = 64;
            source.connect(analyserLocal);
            analyserLocal.connect(rpTtsAudioCtx.destination);
            rpTtsAnalyser = analyserLocal;
            const dataArray = new Uint8Array(analyserLocal.frequencyBinCount);
            if (!rpBrutusBars) rpBrutusBars = rpInitBars('rp-active-brutus-viz', 32);
            function tick() {
                if (!rpTtsAnalyser) return;
                rpTtsAnalyser.getByteFrequencyData(dataArray);
                rpUpdateBars(rpBrutusBars, dataArray);
                rpTtsAnimFrame = requestAnimationFrame(tick);
            }
            tick();
            // source.onended doesn't always fire (suspended context, browser bugs,
            // or context-state churn around playback). Always race against a
            // duration-based safety timeout so the queue can never hang silently.
            const durationMs = Math.max(500, Math.ceil(audioBuf.duration * 1000) + 1500);
            rpCurrentTtsSource = source;
            const playbackStartedAt = Date.now();
            rpTrace('tts playback starting', { chunkId, durationS: audioBuf.duration.toFixed(2), audioCtxState: rpTtsAudioCtx.state });
            await new Promise((resolve) => {
                let done = false;
                const finish = (reason) => {
                    if (done) return;
                    done = true;
                    const elapsed = Date.now() - playbackStartedAt;
                    rpTrace('tts playback ended', { chunkId, reason, elapsedMs: elapsed, expectedDurationMs: durationMs });
                    if (rpTtsAnimFrame) { cancelAnimationFrame(rpTtsAnimFrame); rpTtsAnimFrame = null; }
                    rpTtsAnalyser = null;
                    rpZeroBars(rpBrutusBars);
                    if (rpCurrentTtsSource === source) rpCurrentTtsSource = null;
                    resolve();
                };
                source.onended = () => finish('ended');
                source.start();
                setTimeout(() => finish('timeout'), durationMs);
            });
        }

        // ---- Transcript rendering ----

        function rpAppendMessage(kind, text) {
            const container = document.getElementById('rp-active-transcript');
            if (!container) return;
            const empty = document.getElementById('rp-active-empty');
            if (empty) empty.remove();
            const role = kind === 'rep' ? 'rep' : kind === 'coach' ? 'coach' : 'brutus';
            if (typeof paperRoleplayTranscriptLine === 'function') {
                container.insertAdjacentHTML('beforeend', paperRoleplayTranscriptLine(role, text));
            } else {
                const msg = document.createElement('div');
                msg.className = role === 'rep' ? 'rp-msg rp-msg-rep' : role === 'coach' ? 'rp-msg rp-msg-coach' : 'rp-msg rp-msg-brutus';
                const label = document.createElement('span');
                label.className = 'rp-msg-label';
                label.textContent = role === 'rep' ? 'YOU' : role === 'coach' ? 'BRUTUS · COACH' : 'BRUTUS';
                msg.appendChild(label);
                msg.appendChild(document.createTextNode(text));
                container.appendChild(msg);
            }
            container.scrollTop = container.scrollHeight;
        }

        function rpSetStatus(text, isError) {
            const el = document.getElementById('rp-active-status');
            if (!el) return;
            el.textContent = text || '';
            el.classList.toggle('error', !!isError);
        }

        function rpUpdatePhaseChip() {
            const chip = document.getElementById('rp-active-phase');
            const personaEl = document.getElementById('rp-active-persona');
            if (chip) chip.textContent = rpPhase;
            if (personaEl) personaEl.textContent = rpPersona || (rpPhase === 'setup' ? 'pick a scenario with brutus' : '—');
        }

        // Reflects the truth of "is your voice being captured right now?" in a
        // badge next to the rep waveform. The waveform animates from raw mic
        // input regardless of VAD, so it's easy to assume you're recording
        // when you're not — this badge removes that ambiguity. Also gates the
        // pause+coach button: clicking it while a drill reply is still in
        // flight produces a stale coach hint because the rep turn hasn't been
        // committed yet on the server.
        function rpUpdateMicState() {
            const badge = document.getElementById('rp-mic-state');
            const pauseBtn = document.getElementById('rp-active-pause');
            if (!badge) return;
            let state, label;
            if (rpAwaitingReply) {
                state = 'rp-mic-thinking';
                label = 'brutus thinking';
            } else if (rpIsPaused) {
                state = 'rp-mic-muted';
                label = 'paused';
            } else if (!rpVadEnabled) {
                state = 'rp-mic-muted';
                label = 'muted';
            } else {
                state = 'rp-mic-live';
                label = 'live';
            }
            badge.classList.remove('rp-mic-live', 'rp-mic-muted', 'rp-mic-thinking');
            badge.classList.add(state);
            badge.textContent = label;
            if (pauseBtn && !rpIsPaused) {
                // Don't override the "coaching..." label set by rpRequestCoachHint
                // while a coach hint is actively being fetched/played.
                pauseBtn.disabled = !!rpAwaitingReply;
                pauseBtn.textContent = rpAwaitingReply ? 'wait — brutus is thinking' : 'pause + coach me';
            }
        }

        // ---- Turn submission ----

        function rpSubmitAudio(blob) {
            if (!blob || !rpSessionId) {
                rpTrace('submitAudio skipped', { hasBlob: !!blob, hasSession: !!rpSessionId });
                return;
            }
            rpTrace('submitAudio start', { phase: rpPhase, sessionId: rpSessionId, audioCtxState: rpTtsAudioCtx?.state || '(no ctx)', queueDepth: rpTtsQueueDepth });
            rpAwaitingReply = true;
            rpUpdateMicState();
            rpSetStatus('transcribing...');
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64 = (reader.result || '').split(',')[1];
                if (!base64) { rpAwaitingReply = false; rpSetStatus(''); console.log('[Roleplay][trace] submitAudio aborted — base64 empty'); return; }
                try {
                    const res = await authFetch(`${API_URL}/roleplay/respond`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                        body: JSON.stringify({ audio: base64, mimeType: 'audio/webm', phase: rpPhase, sessionId: rpSessionId })
                    });
                    const data = await res.json();
                    rpTrace('/roleplay/respond status', { status: res.status, textLen: data?.text?.length ?? null, voiceId: data?.voiceId, persona: data?.personaLabel });
                    if (!res.ok) {
                        // 400 = no transcribable speech. Most likely a too-short or too-quiet
                        // utterance that Whisper returned empty for. Surface it so the user
                        // knows to retry instead of staring at silence.
                        if (res.status === 400) {
                            console.warn('[Roleplay] no transcribable speech:', data && data.error);
                            rpSetStatus("didn't catch that — speak up or say a full sentence", true);
                            return;
                        }
                        // 409 = session no longer active. Either /live/end already fired for
                        // this session (close button on a prior attempt) or /live/start from
                        // somewhere else cancelled it. Recover gracefully: tear down the modal,
                        // reset plan state, force the user to plan a fresh scenario.
                        if (res.status === 409) {
                            console.warn('[Roleplay] session no longer active:', data && data.error);
                            rpVadEnabled = false;
                            rpStopRecorder({ discard: true });
                            rpStopMicAndViz();
                            rpSessionId = null;
                            rpIsActive = false;
                            rpPlanSessionId = null;
                            rpPlanPersona = null;
                            const startBtn = document.getElementById('rp-start-btn');
                            if (startBtn) startBtn.disabled = true;
                            document.getElementById('rp-plan-reset')?.classList.add('hidden');
                            document.getElementById('rp-active-overlay')?.classList.add('hidden');
                            rpSetStatus('');
                            alert('this roleplay session already ended. plan a new scenario in the chat to start a fresh drill.');
                            return;
                        }
                        throw billingAwareError(data, `roleplay failed (${res.status})`);
                    }
                    rpAppendMessage('rep', '(spoken)');
                    rpHandleReply(data);
                } catch (err) {
                    console.error('[Roleplay] submit audio failed:', err);
                    rpSetStatus(billingGateText(err) || 'voice send failed — try again', true);
                } finally {
                    rpAwaitingReply = false;
                    rpUpdateMicState();
                    setTimeout(() => rpSetStatus(''), 1500);
                }
            };
            reader.readAsDataURL(blob);
        }

        function rpHandleReply(data) {
            if (!data || !data.text) {
                console.warn('[Roleplay][trace] handleReply got empty/missing text — silent failure source. data:', data);
                return;
            }
            rpAppendMessage('brutus', data.text);
            if (data.suggestedPhaseChange === 'drill' && data.personaLabel) {
                rpTransitionToDrill(data.personaLabel);
            }
            rpTrace('handleReply → queuing TTS', { textLen: data.text.length, queueDepth: rpTtsQueueDepth });
            rpPlayTts(data.text, data.voiceId);
        }

        async function rpTransitionToDrill(personaLabel) {
            rpPhase = 'drill';
            rpPersona = personaLabel;
            rpUpdatePhaseChip();
            const btn = document.getElementById('rp-active-pause');
            if (btn) btn.classList.remove('hidden');
            try {
                await authFetch(`${API_URL}/roleplay/start-drill`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                    body: JSON.stringify({ personaLabel, sessionId: rpSessionId })
                });
            } catch (err) {
                console.error('[Roleplay] start-drill failed:', err);
            }
        }

        async function rpRequestCoachHint() {
            rpTrace('coach button clicked', { sessionId: !!rpSessionId, phase: rpPhase, awaitingReply: rpAwaitingReply, isPaused: rpIsPaused, queueDepth: rpTtsQueueDepth });
            if (!rpSessionId || rpPhase !== 'drill') return;
            // Block when a drill reply is in flight: the coach-hint server-side
            // reads turn history at request time, but /roleplay/respond may not
            // have committed the rep turn yet. Coach hint would then say "you
            // haven't said anything" and Brutus's real drill reply would land
            // behind it in the TTS queue. Just refuse with a clear status.
            if (rpAwaitingReply) {
                rpTrace('coach hint refused — awaiting reply');
                rpSetStatus('wait — brutus is thinking. try pause + coach after his reply.', true);
                setTimeout(() => rpSetStatus(''), 2500);
                return;
            }
            rpIsPaused = true;
            rpVadEnabled = false;
            rpStopRecorder({ discard: true });
            // Clear speech-state bookkeeping so the next VAD tick after VAD
            // re-enables does not see a stale rpSpeechStartedAt from before
            // the pause and immediately hit the max-recording cap with a
            // misleading "totalSpeechMs: 49052" trace.
            rpIsRepSpeaking = false;
            rpSpeechStartedAt = null;
            rpVadSilenceStartedAt = null;
            rpUpdateMicState();
            const btn = document.getElementById('rp-active-pause');
            if (btn) { btn.disabled = true; btn.textContent = 'coaching...'; }
            rpSetStatus('paused — brutus is coaching...');
            try {
                rpTrace('/roleplay/coach-hint fetch start');
                const res = await authFetch(`${API_URL}/roleplay/coach-hint`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                    body: JSON.stringify({ sessionId: rpSessionId })
                });
                const data = await res.json();
                rpTrace('/roleplay/coach-hint status', { status: res.status, textLen: data?.text?.length ?? null });
                if (!res.ok) throw billingAwareError(data, 'coach hint failed');
                if (data && data.text) {
                    rpAppendMessage('coach', data.text);
                    await rpPlayTts(data.text, data.voiceId);
                } else {
                    rpSetStatus('coach hint failed', true);
                }
            } catch (err) {
                console.error('[Roleplay] coach-hint failed:', err);
                const gate = billingGateText(err);
                if (gate) rpSetStatus(gate, true);
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'pause + coach me'; }
                rpVadEnabled = true;
                rpIsPaused = false;
                rpUpdateMicState();
                rpSetStatus('');
            }
        }

        // ---- VAD + per-turn MediaRecorder ----

        function rpStartRecorder() {
            if (!rpMicStream) { console.log('[Roleplay][trace] startRecorder skipped — no mic stream'); return; }
            if (rpRecorder && rpRecorder.state === 'recording') {
                console.log('[Roleplay][trace] startRecorder skipped — already recording');
                return;
            }
            try {
                rpChunks = [];
                rpRecorder = new MediaRecorder(rpMicStream, { mimeType: 'audio/webm;codecs=opus' });
                rpRecorder.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) rpChunks.push(e.data);
                };
                rpRecorder.onstop = () => {
                    const blob = new Blob(rpChunks, { type: 'audio/webm' });
                    rpChunks = [];
                    if (rpPendingDiscardOnStop) {
                        rpPendingDiscardOnStop = false;
                        rpTrace('recorder onstop discarded', { blobBytes: blob.size, reason: 'paused/coach/end' });
                        return;
                    }
                    rpTrace('recorder onstop', { blobBytes: blob.size, action: blob.size > 3000 ? 'submitting' : 'filtered' });
                    if (blob.size > 3000) rpSubmitAudio(blob);
                };
                rpRecorder.start();
                rpTrace('recorder started');
            } catch (err) {
                console.error('[Roleplay] recorder start failed:', err);
            }
        }

        // Pass { discard: true } when the stop is user-initiated (coach
        // pause, end session) so the onstop callback drops the in-flight
        // blob instead of POSTing it. VAD-silence-driven stops MUST leave
        // discard at default false so the captured speech still ships.
        function rpStopRecorder({ discard = false } = {}) {
            try {
                if (discard) rpPendingDiscardOnStop = true;
                if (rpRecorder && rpRecorder.state === 'recording') rpRecorder.stop();
            } catch (_) {}
        }

        function rpStopVAD() {
            rpVadEnabled = false;
            // Discard: this is the "tear down mic + VAD entirely" path
            // (called from rpStopMicAndViz on session end / modal dismiss /
            // 409 recovery). Any in-flight recording is moot — the session
            // is going away.
            rpStopRecorder({ discard: true });
            rpIsRepSpeaking = false;
            rpVadSilenceStartedAt = null;
            rpSpeechStartedAt = null;
        }

        function rpVadTick(dataArray) {
            // Barge-in design: the rep MUST be able to interrupt Brutus
            // mid-sentence by speaking. Browser AEC (enabled in
            // rpStartMicAndViz) cancels Brutus's TTS from the mic input,
            // so the VAD avg stays low during playback unless the rep
            // actually speaks. When rep speech is detected during TTS,
            // we flush the TTS queue to cut Brutus off immediately —
            // see the rpFlushTtsQueue call below.
            if (!rpVadEnabled || rpAwaitingReply || rpIsPaused) return;
            const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
            const now = performance.now();

            // Safety net: hard cap on continuous recording. If ambient noise
            // keeps avg above SILENCE_THRESHOLD for the entire turn and the
            // silence timer never fires, force-stop so the recording still
            // gets submitted. Without this, the recorder runs until the user
            // clicks pause+coach, which is the bug we're fixing.
            if (rpIsRepSpeaking && rpSpeechStartedAt && now - rpSpeechStartedAt >= RP_VAD_MAX_RECORDING_MS) {
                const totalSpeechMs = Math.round(now - rpSpeechStartedAt);
                rpTrace('VAD max-recording cap hit', { totalSpeechMs, avg: avg.toFixed(1) });
                rpIsRepSpeaking = false;
                rpVadSilenceStartedAt = null;
                rpSpeechStartedAt = null;
                rpStopRecorder();
                return;
            }

            if (avg > RP_VAD_SPEECH_THRESHOLD) {
                if (!rpIsRepSpeaking) {
                    rpIsRepSpeaking = true;
                    rpSpeechStartedAt = now;
                    // Barge-in: if Brutus is mid-TTS, cut him off so we
                    // don't talk over each other. rpFlushTtsQueue stops
                    // the current source and resets queueDepth so the
                    // Promise chain in rpPlayTts unwinds cleanly.
                    if (rpTtsQueueDepth > 0) {
                        rpTrace('VAD barge-in detected — flushing TTS', { avg: avg.toFixed(1), queueDepth: rpTtsQueueDepth });
                        rpFlushTtsQueue('barge-in');
                    }
                    rpStartRecorder();
                    rpTrace('VAD speech start', { avg: avg.toFixed(1) });
                }
                rpVadSilenceStartedAt = null;
            } else if (avg < RP_VAD_SILENCE_THRESHOLD && rpIsRepSpeaking) {
                if (rpVadSilenceStartedAt === null) rpVadSilenceStartedAt = now;
                if (now - rpVadSilenceStartedAt >= RP_VAD_SILENCE_MS) {
                    const totalSpeechMs = now - rpSpeechStartedAt;
                    rpTrace('VAD silence detected', { totalSpeechMs: Math.round(totalSpeechMs), avg: avg.toFixed(1) });
                    rpIsRepSpeaking = false;
                    rpVadSilenceStartedAt = null;
                    rpSpeechStartedAt = null;
                    if (totalSpeechMs >= RP_VAD_MIN_SPEECH_MS) {
                        rpStopRecorder();
                    } else {
                        // too short — discard
                        rpChunks = [];
                        try {
                            if (rpRecorder && rpRecorder.state === 'recording') {
                                const r = rpRecorder;
                                r.onstop = () => { rpChunks = []; };
                                r.stop();
                            }
                        } catch (_) {}
                    }
                }
            }
        }

        // ---- Mic + rep waveform RAF loop ----

        async function rpStartMicAndViz() {
            // AEC ON: browser subtracts speaker output from mic input so
            // Brutus's TTS playing through laptop speakers does not feed
            // back into the recorder. Without AEC the VAD avg jumps to
            // 70-105 the moment TTS ends (residual echo / room reverb),
            // triggering a runaway recorder loop on headphone-less setups.
            // Noise suppression OFF (kept disabled) preserves the raw
            // signal shape for Whisper transcription — AEC alone is the
            // load-bearing change. Auto-gain off for the same reason.
            // Desktop overlay (Downloads/brutus/desktop/renderer/overlay.html)
            // keeps echoCancellation:false intentionally for dual-voice
            // transcription — this constraint set is web-roleplay-only.
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: false,
                    autoGainControl: false,
                    sampleRate: 16000
                }
            });
            rpMicStream = stream;
            rpRepAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (rpRepAudioCtx.state === 'suspended') {
                try { await rpRepAudioCtx.resume(); } catch (_) {}
            }
            const micSource = rpRepAudioCtx.createMediaStreamSource(stream);
            rpRepAnalyser = rpRepAudioCtx.createAnalyser();
            rpRepAnalyser.fftSize = 64;
            micSource.connect(rpRepAnalyser);
            const dataArray = new Uint8Array(rpRepAnalyser.frequencyBinCount);
            if (!rpRepBars) rpRepBars = rpInitBars('rp-active-rep-viz', 32);

            // Ambient-floor probe: sample the mic for 2 seconds and log
            // p50/p95/max so we have data to tune SPEECH/SILENCE thresholds
            // for the user's actual setup. Runs concurrently with the
            // tick() loop below — does NOT block VAD startup. Pure logging,
            // no behavior change. The numbers from this probe inform
            // threshold tuning in a follow-up patch; the current 16/8
            // thresholds are kept unchanged until we have data.
            (function rpAmbientProbe() {
                rpTrace('ambient probe starting (2s)');
                const ambientSamples = [];
                const probeStart = performance.now();
                const probeBuf = new Uint8Array(rpRepAnalyser.frequencyBinCount);
                const probeInterval = setInterval(() => {
                    if (!rpRepAnalyser) { clearInterval(probeInterval); return; }
                    rpRepAnalyser.getByteFrequencyData(probeBuf);
                    const avg = probeBuf.reduce((s, v) => s + v, 0) / probeBuf.length;
                    ambientSamples.push(avg);
                    if (performance.now() - probeStart >= 2000) {
                        clearInterval(probeInterval);
                        if (ambientSamples.length === 0) return;
                        const sorted = [...ambientSamples].sort((a, b) => a - b);
                        const p50 = sorted[Math.floor(sorted.length / 2)];
                        const p95 = sorted[Math.floor(sorted.length * 0.95)];
                        const max = sorted[sorted.length - 1];
                        rpTrace('ambient probe complete', {
                            samples: ambientSamples.length,
                            p50: p50.toFixed(1),
                            p95: p95.toFixed(1),
                            max: max.toFixed(1),
                            currentSpeechThreshold: RP_VAD_SPEECH_THRESHOLD,
                            currentSilenceThreshold: RP_VAD_SILENCE_THRESHOLD
                        });
                    }
                }, 50);
            })();

            function tick() {
                if (!rpRepAnalyser) return;
                rpRepAnalyser.getByteFrequencyData(dataArray);
                rpUpdateBars(rpRepBars, dataArray);
                if (rpVadEnabled) rpVadTick(dataArray);
                rpRepAnimFrame = requestAnimationFrame(tick);
            }
            tick();
        }

        function rpStopMicAndViz() {
            rpStopVAD();
            if (rpRepAnimFrame) { cancelAnimationFrame(rpRepAnimFrame); rpRepAnimFrame = null; }
            rpRepAnalyser = null;
            if (rpTtsAnimFrame) { cancelAnimationFrame(rpTtsAnimFrame); rpTtsAnimFrame = null; }
            rpTtsAnalyser = null;
            try {
                if (rpMicStream) {
                    rpMicStream.getTracks().forEach(t => t.stop());
                }
            } catch (_) {}
            rpMicStream = null;
            try { if (rpRepAudioCtx) rpRepAudioCtx.close(); } catch (_) {}
            rpRepAudioCtx = null;
            try { if (rpTtsAudioCtx) rpTtsAudioCtx.close(); } catch (_) {}
            rpTtsAudioCtx = null;
        }

        // ---- Summary card on session end ----

        function rpFormatDuration(sec) {
            const s = Math.max(0, Math.floor(sec));
            const m = Math.floor(s / 60);
            const r = s % 60;
            return `${m}:${r.toString().padStart(2, '0')}`;
        }

        function rpRenderSummary(summary) {
            if (!summary) summary = {};
            const sec = summary.drillDurationSec || 0;
            const metaText = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} · ${summary.totalTurns || 0} turns`;
            showPaperRoleplayResults(toPaperRoleplayResults(summary, [], {
                brutusFeedback: {
                    overallRoast: summary.overallRoast || '',
                    persona: summary.persona || ''
                }
            }), metaText);
            // The results panel sits under the live stage. Leave the ending
            // line in the transcript so End still shows a result before Close.
            rpAppendMessage('brutus', summary.overallRoast || 'roleplay ended');
        }

        // ---- End session ----

        async function rpEndSession() {
            if (!rpIsActive) return;
            const endBtn = document.getElementById('rp-active-close');
            if (endBtn) { endBtn.disabled = true; endBtn.textContent = 'ending...'; }
            rpVadEnabled = false;
            rpStopRecorder({ discard: true });
            rpSetStatus('ending session...');
            const idToEnd = rpSessionId;
            try {
                if (idToEnd) {
                    const res = await authFetch(`${API_URL}/live/end`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                        body: JSON.stringify({ sessionId: idToEnd })
                    });
                    const endData = await res.json();
                    if (endData && endData.sessionMode === 'roleplay') {
                        rpRenderSummary(endData.summary);
                        loadDashboard();
                    }
                }
            } catch (err) {
                console.error('[Roleplay] end failed:', err);
                rpSetStatus('end failed — session may not have closed cleanly', true);
            }
            rpStopMicAndViz();
            rpSessionId = null;
            rpIsActive = false;
            // The drill consumed the planning session — clear it so the Start
            // button disables and a subsequent attempt forces a fresh plan-chat
            // (which lazy-creates a new active session via /live/start). Without
            // this, re-clicking Start would relaunch into the just-ended session
            // and the next drill turn would 409 with "session completed".
            rpPlanSessionId = null;
            rpPlanPersona = null;
            const startBtn = document.getElementById('rp-start-btn');
            if (startBtn) startBtn.disabled = true;
            document.getElementById('rp-plan-reset')?.classList.add('hidden');
            if (endBtn) { endBtn.disabled = false; endBtn.textContent = 'close'; }
            rpSetStatus('');
        }

        function rpDismissDrillOverlay() {
            // Tear down anything still live, then hide.
            rpStopMicAndViz();
            rpSessionId = null;
            rpIsActive = false;
            rpPhase = 'setup';
            rpPersona = null;
            rpUpdatePhaseChip();
            const closeBtn = document.getElementById('rp-active-close');
            if (closeBtn) { closeBtn.disabled = false; closeBtn.textContent = 'end roleplay'; }
            const pauseBtn = document.getElementById('rp-active-pause');
            if (pauseBtn) { pauseBtn.classList.add('hidden'); pauseBtn.disabled = false; pauseBtn.textContent = 'pause + coach me'; }
            // Clear transcript for next session
            const container = document.getElementById('rp-active-transcript');
            if (container) {
                container.innerHTML = '<div class="rp-active-empty" id="rp-active-empty">drill is live. speak when you\'re ready and brutus will respond in character.</div>';
            }
            document.getElementById('rp-active-overlay')?.classList.add('hidden');
            // Drill consumed the planning session. Reset the plan panel so the
            // next visit starts clean (button greyed out, persona unlocked).
            if (rpPlanSessionId || rpPlanPersona) {
                rpPlanSessionId = null;
                rpPlanPersona = null;
                rpPlanBusy = false;
                const planMessages = document.getElementById('rp-plan-messages');
                if (planMessages) {
                    planMessages.innerHTML = `
                        <div class="chat-message">
                            <div class="message-avatar brutus-avatar">B</div>
                            <div class="message-content">
                                <div class="message-text">want to plan a roleplay? tell me what you're trying to drill, or ask me to suggest a scenario based on your last calls. once we lock in a scenario, the start button on the left will activate.</div>
                                <div class="message-time">just now</div>
                            </div>
                        </div>
                    `;
                }
                document.getElementById('rp-plan-reset')?.classList.add('hidden');
                const startBtn = document.getElementById('rp-start-btn');
                if (startBtn) startBtn.disabled = true;
                const planInput = document.getElementById('rp-plan-input');
                const planSendBtn = document.getElementById('rp-plan-send-btn');
                if (planInput) { planInput.disabled = false; planInput.value = ''; }
                if (planSendBtn) planSendBtn.disabled = false;
            }
        }

        // ---- Plan chat (right-side panel on the roleplays page) ----
        // Drives the setup phase of an actual roleplay session. First message
        // lazy-creates a session via /live/start; subsequent messages go to
        // /roleplay/respond with phase='setup'. When the model emits a
        // [START_DRILL: persona] signal, the persona is locked via
        // /roleplay/start-drill and the start button activates. The drill
        // modal then opens directly in drill phase, reusing the same session.

        let rpPlanBusy = false;
        let rpPlanSessionId = null;
        let rpPlanPersona = null;
        let rpPendingLaunch = null;

        function rpPlanAddMessage(text, isUser) {
            const container = document.getElementById('rp-plan-messages');
            if (!container) return;
            const wrap = document.createElement('div');
            wrap.className = 'chat-message';
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            wrap.innerHTML = `
                <div class="message-avatar ${isUser ? 'user-avatar' : 'brutus-avatar'}">${isUser ? 'U' : 'B'}</div>
                <div class="message-content">
                    <div class="message-text">${escapeHtml(text)}</div>
                    <div class="message-time">${timeStr}</div>
                </div>
            `;
            container.appendChild(wrap);
            container.scrollTop = container.scrollHeight;
        }

        function rpParseStartDrillSignal(text) {
            if (!text) return { cleanText: text || '', persona: null };
            const match = text.match(/\[START_DRILL:\s*([^\]]+)\]/i);
            if (!match) return { cleanText: text, persona: null };
            const persona = match[1].trim();
            const cleanText = text.replace(match[0], '').trim();
            return { cleanText, persona };
        }

        function rpLockPersonaUI(persona) {
            rpPlanPersona = persona;
            const startBtn = document.getElementById('rp-start-btn');
            const resetBtn = document.getElementById('rp-plan-reset');
            if (startBtn) startBtn.disabled = false;
            if (resetBtn) resetBtn.classList.remove('hidden');
        }

        async function rpResetPlan() {
            const stale = rpPlanSessionId;
            rpPlanSessionId = null;
            rpPlanPersona = null;
            rpPlanBusy = false;
            // Reset the UI back to initial.
            const container = document.getElementById('rp-plan-messages');
            if (container) {
                container.innerHTML = `
                    <div class="chat-message">
                        <div class="message-avatar brutus-avatar">B</div>
                        <div class="message-content">
                            <div class="message-text">want to plan a roleplay? tell me what you're trying to drill, or ask me to suggest a scenario based on your last calls. once we lock in a scenario, the start button on the left will activate.</div>
                            <div class="message-time">just now</div>
                        </div>
                    </div>
                `;
            }
            document.getElementById('rp-plan-reset')?.classList.add('hidden');
            const startBtn = document.getElementById('rp-start-btn');
            if (startBtn) startBtn.disabled = true;
            const inputEl = document.getElementById('rp-plan-input');
            const sendBtn = document.getElementById('rp-plan-send-btn');
            if (inputEl) { inputEl.disabled = false; inputEl.value = ''; }
            if (sendBtn) sendBtn.disabled = false;
            // Best-effort cleanup of the abandoned planning session.
            if (stale) {
                try {
                    await authFetch(`${API_URL}/live/end`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                        body: JSON.stringify({ sessionId: stale })
                    });
                } catch (_) { /* retention will catch it */ }
            }
        }

        async function rpPlanSendMessage(seedText) {
            if (rpPlanBusy) return;
            const inputEl = document.getElementById('rp-plan-input');
            const sendBtn = document.getElementById('rp-plan-send-btn');
            const text = (seedText != null ? seedText : (inputEl ? inputEl.value.trim() : '')).trim();
            if (!text) return;
            if (inputEl && seedText == null) inputEl.value = '';
            rpPlanAddMessage(text, true);
            rpPlanBusy = true;
            if (sendBtn) sendBtn.disabled = true;
            if (inputEl) inputEl.disabled = true;

            try {
                // Lazy-create the session on first message.
                if (!rpPlanSessionId) {
                    const startRes = await authFetch(`${API_URL}/live/start`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                        body: JSON.stringify({ mode: 'roleplay' })
                    });
                    const startData = await startRes.json();
                    if (!startRes.ok) throw billingAwareError(startData, `session start failed (${startRes.status})`);
                    rpPlanSessionId = startData.session?.id;
                    if (!rpPlanSessionId) throw new Error('no session id returned');
                }

                const res = await authFetch(`${API_URL}/roleplay/respond`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                    body: JSON.stringify({ sessionId: rpPlanSessionId, phase: 'setup', text })
                });
                const data = await res.json();
                if (!res.ok) throw billingAwareError(data, `response failed (${res.status})`);

                // Backend already strips the [START_DRILL: ...] bracket from data.text
                // and surfaces the persona via data.personaLabel. Fall back to a
                // client-side regex parse in case the bracket wasn't trailing
                // (older response shape or model output the backend regex missed).
                const fallback = rpParseStartDrillSignal(data.text || '');
                const displayText = data.text != null ? data.text : fallback.cleanText;
                const persona = data.personaLabel || fallback.persona;
                if (displayText) rpPlanAddMessage(displayText, false);

                if (persona && !rpPlanPersona) {
                    rpPlanPersona = persona;
                    try {
                        await authFetch(`${API_URL}/roleplay/start-drill`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                            body: JSON.stringify({ sessionId: rpPlanSessionId, personaLabel: persona })
                        });
                    } catch (err) {
                        console.error('[Roleplay] start-drill failed:', err);
                    }
                    rpLockPersonaUI(persona);
                }
            } catch (err) {
                console.error('[Roleplay] plan send failed:', err);
                rpPlanAddMessage(billingGateText(err) || 'sorry, something went wrong. try again.', false);
            } finally {
                rpPlanBusy = false;
                if (sendBtn) sendBtn.disabled = false;
                if (inputEl) { inputEl.disabled = false; inputEl.focus(); }
            }
        }

        function rpWirePlanChat() {
            const sendBtn = document.getElementById('rp-plan-send-btn');
            const inputEl = document.getElementById('rp-plan-input');
            const resetBtn = document.getElementById('rp-plan-reset');
            if (sendBtn) sendBtn.addEventListener('click', () => rpPlanSendMessage());
            if (inputEl) inputEl.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    rpPlanSendMessage();
                }
            });
            document.querySelectorAll('.rp-plan-suggestion').forEach(btn => {
                btn.addEventListener('click', () => {
                    const msg = btn.dataset.msg;
                    if (msg) rpPlanSendMessage(msg);
                });
            });
            if (resetBtn) resetBtn.addEventListener('click', () => rpResetPlan());
            rpInitVoicePicker();
        }

        function rpInitVoicePicker() {
            const sel = document.getElementById('rp-voice-picker');
            if (!sel) return;
            sel.innerHTML = '';
            RP_BRUTUS_VOICES.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.id;
                opt.textContent = v.name;
                if (v.id === rpSelectedVoiceId) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.addEventListener('change', (e) => {
                const id = e.target.value;
                if (!RP_BRUTUS_VOICES.some(v => v.id === id)) return;
                rpSelectedVoiceId = id;
                try { localStorage.setItem('roleplayVoiceId', id); } catch (_) {}
            });
        }

        // ---- Launcher orchestrator ----

        async function rpStartWebRoleplay() {
            // A persona must be locked via the plan chat before launch.
            if (!rpPlanSessionId || !rpPlanPersona) return;
            // Pre-launch headphone warning (one-shot per tab session)
            if (!rpHeadphoneWarnAcked) {
                rpPendingLaunch = { existingSessionId: rpPlanSessionId, existingPersona: rpPlanPersona };
                document.getElementById('rp-headphone-overlay')?.classList.remove('hidden');
                return; // resumes via rp-headphone-go click
            }
            await rpStartWebRoleplayInner({ existingSessionId: rpPlanSessionId, existingPersona: rpPlanPersona });
        }

        async function rpStartWebRoleplayInner(opts = {}) {
            if (rpIsActive) return;
            const { existingSessionId, existingPersona } = opts;
            if (!existingSessionId) return; // guard: a planned session is required
            rpIsActive = true;
            rpSessionId = existingSessionId;
            rpPersona = existingPersona || null;
            rpPhase = 'drill';
            rpSessionStartedAt = Date.now();
            // Drop any TTS still queued from a previous drill in the same tab.
            // Nothing should be queued here normally, but a stale coach-hint or
            // an aborted prior session can leave a chunk in flight that would
            // play out of context as soon as audio output unlocks.
            rpFlushTtsQueue('drill-launch');
            rpTrace('drill modal opened', { sessionId: rpSessionId, persona: rpPersona });
            // Reveal modal immediately so the mic-permission prompt has visible context.
            document.getElementById('rp-active-overlay')?.classList.remove('hidden');
            document.getElementById('rp-active-pause')?.classList.remove('hidden');
            rpUpdatePhaseChip();
            // Pre-warm the TTS AudioContext from the launch click. Chrome's
            // autoplay policy will keep it 'suspended' if we wait until the
            // first /tts response arrives — by then the user gesture has
            // expired, source.onended never fires, and the queue hangs until
            // the next click (e.g. pause+coach) unsticks it.
            await rpEnsureTtsAudioContext();
            rpSetStatus('requesting microphone...');

            try {
                await rpStartMicAndViz();
            } catch (err) {
                console.error('[Roleplay] mic permission denied:', err);
                rpSetStatus('microphone access required for the drill — grant access and try again', true);
                rpVadEnabled = false;
                return; // voice-only drill; bail out so the user can grant access and reopen
            }

            rpVadEnabled = !!rpMicStream;
            rpUpdateMicState();
            rpSetStatus('');
        }

        // ---- Button wiring ----

        function rpWireButtons() {
            const startBtn = document.getElementById('rp-start-btn');
            const headphoneGo = document.getElementById('rp-headphone-go');
            const headphoneCancel = document.getElementById('rp-headphone-cancel');
            const pauseBtn = document.getElementById('rp-active-pause');
            const closeBtn = document.getElementById('rp-active-close');

            if (startBtn) startBtn.addEventListener('click', () => rpStartWebRoleplay());
            if (headphoneGo) headphoneGo.addEventListener('click', () => {
                rpHeadphoneWarnAcked = true;
                document.getElementById('rp-headphone-overlay')?.classList.add('hidden');
                const pending = rpPendingLaunch;
                rpPendingLaunch = null;
                if (pending) rpStartWebRoleplayInner(pending);
            });
            if (headphoneCancel) headphoneCancel.addEventListener('click', () => {
                rpPendingLaunch = null;
                document.getElementById('rp-headphone-overlay')?.classList.add('hidden');
            });
            if (pauseBtn) pauseBtn.addEventListener('click', () => rpRequestCoachHint());
            if (closeBtn) closeBtn.addEventListener('click', () => {
                if (rpIsActive) rpEndSession().then(() => { /* stay open so user can read summary */ });
                else rpDismissDrillOverlay();
            });
        }

        // Wire buttons once DOM is ready. Defer to after the rest of the script
        // initializes (other handlers expect things like authToken to be set first).
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => { rpWireButtons(); rpWirePlanChat(); });
        } else {
            rpWireButtons();
            rpWirePlanChat();
        }

        // ==================== CALL DETAIL MODAL ====================
        let openCallId = null;

        async function openCallModal(id) {
            const overlay = document.getElementById('call-modal-overlay');
            const body = document.getElementById('call-modal-body');
            const meta = document.getElementById('call-modal-meta');

            openCallId = id;
            document.getElementById('call-delete-overlay')?.classList.add('hidden');
            body.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.4);padding:40px 0;">loading...</p>';
            overlay.classList.remove('hidden');

            try {
                const data = await apiCall(`/calls/${id}`);
                const call = data.call;

                const scoreClass = call.overallScore >= 70 ? 'good' : call.overallScore >= 50 ? 'warning' : 'bad';
                const scoreColors = { good: '#4caf50', warning: '#ff9800', bad: '#ff5050' };
                const mins = Math.floor((call.durationSeconds || 0) / 60);

                // Handle both old format (array) and new format (full analysis object)
                const raw = call.brutusFeedback;
                const isFullAnalysis = raw && !Array.isArray(raw) && raw.feedback;
                const feedback = isFullAnalysis ? (raw.feedback || []) : (Array.isArray(raw) ? raw : []);
                const overallRoast = isFullAnalysis ? (raw.overallRoast || '') : '';
                const actionItems = isFullAnalysis ? (raw.actionItems || []) : [];
                const ratings = (call.feedbackRatings && typeof call.feedbackRatings === 'object')
                    ? call.feedbackRatings : {};

                const callName = call.contactName || call.prospectName || 'Call';
                const titleEl = document.getElementById('call-detail-title');
                const crumbEl = document.getElementById('call-detail-crumb-name');
                if (titleEl) titleEl.textContent = callName;
                if (crumbEl) crumbEl.textContent = callName;
                const deleteName = document.getElementById('call-delete-name');
                if (deleteName) deleteName.textContent = callName;
                const tagBit = (call.tags || []).slice(0, 2).join(', ');
                if (meta) meta.textContent = `${formatDateTime(call.createdAt)} | ${mins} min${tagBit ? ' | ' + tagBit : ''}`;

                if (typeof paperCallDetail === 'function') {
                    const followUp = call.keyFollowUp
                        || (actionItems.length ? actionItems.filter(item => typeof item === 'string' && item.trim()).join(' | ') : '');
                    body.innerHTML = paperCallDetail({
                        ...call,
                        name: callName,
                        interruptions: call.interruptions != null ? call.interruptions : call.interruptionCount,
                        notes: Array.isArray(call.notes) ? call.notes : [],
                        aiSummary: call.aiSummary || call.summary || overallRoast || '',
                        keyFollowUp: followUp
                    });
                    return;
                }

                // Helper: render a feedback item with thumbs up/down
                const VALID_FEEDBACK_TYPES = new Set(['critical', 'warning', 'insight', 'good']);
                function feedbackItemHtml(f, origIdx) {
                    const r = ratings[origIdx];
                    const safeType = VALID_FEEDBACK_TYPES.has(f.type) ? f.type : 'insight';
                    return `
                        <div class="call-feedback-item ${safeType}">
                            <div class="feedback-item-row">
                                <span class="feedback-item-text">${escapeHtml(f.text)}</span>
                                <div class="rating-btns">
                                    <button type="button" class="rating-btn ${r === 'up' ? 'active' : ''}"
                                        title="good read"
                                        data-action="rate-feedback" data-call-id="${call.id}" data-index="${origIdx}" data-rating="up">👍</button>
                                    <button type="button" class="rating-btn ${r === 'down' ? 'active' : ''}"
                                        title="bad read"
                                        data-action="rate-feedback" data-call-id="${call.id}" data-index="${origIdx}" data-rating="down">👎</button>
                                </div>
                            </div>
                        </div>`;
                }

                const criticals = feedback.map((f, i) => ({f, i})).filter(({f}) => f.type === 'critical');
                const warnings  = feedback.map((f, i) => ({f, i})).filter(({f}) => f.type === 'warning');
                const insights  = feedback.map((f, i) => ({f, i})).filter(({f}) => f.type === 'insight');
                const others    = feedback.map((f, i) => ({f, i})).filter(({f}) => !['critical','warning','insight'].includes(f.type));

                const outcomeLabels = { closed: '✓ closed', lost: '✗ lost', follow_up: '↩ follow up', no_show: '○ no show' };
                const currentOutcome = call.outcome || null;

                body.innerHTML = `
                    <div class="call-modal-section" style="margin-top: 0; padding-top: 0; border-top: none;">
                        <div class="call-modal-section-title">how did it go?</div>
                        <div class="outcome-btns">
                            ${['closed','lost','follow_up','no_show'].map(o => `
                                <button type="button" class="outcome-btn ${currentOutcome === o ? o : ''}"
                                    id="outcome-btn-${o}"
                                    data-action="set-outcome" data-call-id="${call.id}" data-outcome="${o}">
                                    ${outcomeLabels[o]}
                                </button>`).join('')}
                        </div>
                    </div>

                    <div class="call-modal-score">
                        <div class="call-modal-score-num" style="color:${scoreColors[scoreClass]}">${call.overallScore}</div>
                        <div class="call-modal-roast">${escapeHtml(overallRoast) || 'no summary available'}</div>
                    </div>

                    ${criticals.length ? `
                    <div class="call-modal-section">
                        <div class="call-modal-section-title">critical issues <span style="font-size:11px;color:rgba(255,255,255,0.3);font-weight:400;text-transform:none;letter-spacing:0;">— 👍 good read &nbsp;👎 missed the mark</span></div>
                        ${criticals.map(({f, i}) => feedbackItemHtml(f, i)).join('')}
                    </div>` : ''}

                    ${warnings.length ? `
                    <div class="call-modal-section">
                        <div class="call-modal-section-title">warnings</div>
                        ${warnings.map(({f, i}) => feedbackItemHtml(f, i)).join('')}
                    </div>` : ''}

                    ${insights.length ? `
                    <div class="call-modal-section">
                        <div class="call-modal-section-title">insights</div>
                        ${insights.map(({f, i}) => feedbackItemHtml(f, i)).join('')}
                    </div>` : ''}

                    ${others.length ? `
                    <div class="call-modal-section">
                        <div class="call-modal-section-title">feedback</div>
                        ${others.map(({f, i}) => feedbackItemHtml(f, i)).join('')}
                    </div>` : ''}

                    ${actionItems.length ? `
                    <div class="call-modal-section">
                        <div class="call-modal-section-title">action items</div>
                        ${actionItems.map(a => `<div class="call-action-item">${escapeHtml(a)}</div>`).join('')}
                    </div>` : ''}
                `;
            } catch (err) {
                body.innerHTML = `<p style="text-align:center;color:#ff5050;padding:40px 0;">${escapeHtml(err.message || 'failed to load call details')}</p>`;
            }
        }

        async function setCallOutcome(callId, outcome, clickedBtn) {
            // Toggle off if already active
            const isActive = clickedBtn.classList.contains(outcome);
            const newOutcome = isActive ? null : outcome;

            // Update button states optimistically
            document.querySelectorAll('.outcome-btn').forEach(b => b.className = 'outcome-btn');
            if (!isActive) clickedBtn.classList.add(outcome);

            try {
                if (newOutcome) {
                    await apiCall(`/calls/${callId}/outcome`, {
                        method: 'PATCH',
                        body: JSON.stringify({ outcome: newOutcome })
                    });
                }
                // Refresh call list to show updated badge
                allCalls = allCalls.map(c => c.id === callId ? { ...c, outcome: newOutcome } : c);
                refreshCalls();
            } catch (err) {
                console.error('Failed to set outcome:', err);
            }
        }

        async function rateCallFeedback(callId, index, rating, clickedBtn) {
            const siblings = clickedBtn.closest('.rating-btns').querySelectorAll('.rating-btn');
            const wasActive = clickedBtn.classList.contains('active');
            const newRating = wasActive ? null : rating;

            // Update UI optimistically
            siblings.forEach(b => b.classList.remove('active'));
            if (!wasActive) clickedBtn.classList.add('active');

            try {
                await apiCall(`/calls/${callId}/feedback-rating`, {
                    method: 'PATCH',
                    body: JSON.stringify({ index, rating: newRating })
                });
            } catch (err) {
                console.error('Failed to rate feedback:', err);
                // Revert on failure
                siblings.forEach(b => b.classList.remove('active'));
                if (wasActive) clickedBtn.classList.add('active');
            }
        }

        function closeCallModal() {
            document.getElementById('call-modal-overlay').classList.add('hidden');
            document.getElementById('call-delete-overlay')?.classList.add('hidden');
        }

        document.getElementById('call-modal-close').addEventListener('click', closeCallModal);

        document.getElementById('call-delete-btn')?.addEventListener('click', () => {
            document.getElementById('call-delete-overlay')?.classList.remove('hidden');
        });
        document.getElementById('call-delete-cancel')?.addEventListener('click', () => {
            document.getElementById('call-delete-overlay')?.classList.add('hidden');
        });
        document.getElementById('call-delete-confirm')?.addEventListener('click', async () => {
            if (!openCallId) return;
            const btn = document.getElementById('call-delete-confirm');
            if (btn) btn.disabled = true;
            try {
                const removed = openCallId;
                await apiCall(`/calls/${removed}`, { method: 'DELETE' });
                closeCallModal();
                allCalls = allCalls.filter(c => c.id !== removed);
                refreshCalls();
                loadDashboard();
            } catch (err) {
                console.error('Failed to delete call:', err);
            } finally {
                if (btn) btn.disabled = false;
            }
        });

        document.getElementById('call-modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeCallModal();
        });

        document.getElementById('cold-call-modal-close').addEventListener('click', () => {
            document.getElementById('cold-call-modal-overlay').classList.add('hidden');
        });

        document.getElementById('cold-call-modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                e.currentTarget.classList.add('hidden');
            }
        });

        document.getElementById('roleplay-modal-close').addEventListener('click', () => {
            document.getElementById('roleplay-modal-overlay').classList.add('hidden');
        });

        document.getElementById('rp-results-close')?.addEventListener('click', () => {
            const panel = document.getElementById('rp-results');
            if (panel) panel.hidden = true;
        });

        document.getElementById('roleplay-modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                e.currentTarget.classList.add('hidden');
            }
        });

        // ==================== NAVIGATION ====================
        document.querySelectorAll('.nav-item').forEach(item => {
            if (item.getAttribute('id') === 'nav-lil-brutus') return;
            item.addEventListener('click', () => {
                if (item.closest('.p-sidebar')) closeCallModal();
                document.querySelectorAll('.nav-item').forEach(i => {
                    if (i.getAttribute('id') === 'nav-lil-brutus') return;
                    i.classList.remove('active');
                });
                item.classList.add('active');
                
                const viewName = item.dataset.view;
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                
                const targetView = document.getElementById(viewName + '-view');
                if (targetView) {
                    targetView.classList.add('active');
                }

                if (viewName === 'notes') loadNotes();
                if (viewName === 'research') loadResearch();
                if (viewName === 'credits') loadBalance();
                if (viewName === 'progress') loadCallHistory();
                if (viewName === 'profile') loadProfilePage();
                if (viewName === 'settings' && typeof window.loadDesktopSettings === 'function') {
                    window.loadDesktopSettings();
                }
                if (viewName === 'cold-calls') loadColdCallSessions();
                if (viewName === 'roleplays') loadRoleplaySessions();
            });
        });
        
        // ==================== DRAGGABLE & RESIZABLE PANELS ====================
        let draggedPanel = null;
        let dragOffset = { x: 0, y: 0 };
        let resizingPanel = null;
        let resizeDir = null;
        let resizeStart = {};

        // Inject resize handles into every panel
        document.querySelectorAll('.floating-panel').forEach(panel => {
            ['s', 'e', 'se'].forEach(dir => {
                const handle = document.createElement('div');
                handle.className = `resize-handle resize-${dir}`;
                handle.dataset.dir = dir;
                panel.appendChild(handle);
            });
        });

        // Drag — ignore resize handles and interactive elements
        document.querySelectorAll('.floating-panel').forEach(panel => {
            panel.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.closest('.resize-handle') ||
                    e.target.classList.contains('chat-input') ||
                    e.target.classList.contains('chat-send-btn') ||
                    e.target.classList.contains('suggestion-btn') ||
                    e.target.classList.contains('history-call-item') ||
                    e.target.closest('.history-call-item')) return;

                draggedPanel = panel;
                draggedPanel.classList.add('dragging');

                const rect = panel.getBoundingClientRect();
                dragOffset.x = e.clientX - rect.left;
                dragOffset.y = e.clientY - rect.top;
            });
        });

        // Resize — mousedown on handles
        document.addEventListener('mousedown', (e) => {
            const handle = e.target.closest('.resize-handle');
            if (!handle) return;

            e.preventDefault();
            e.stopPropagation();

            resizingPanel = handle.closest('.floating-panel');
            resizeDir = handle.dataset.dir;
            resizingPanel.classList.add('resizing');

            const rect = resizingPanel.getBoundingClientRect();
            resizeStart = {
                x: e.clientX,
                y: e.clientY,
                w: rect.width,
                h: rect.height
            };

            // Lock dimensions so CSS width/height take over
            resizingPanel.style.width = rect.width + 'px';
            resizingPanel.style.height = rect.height + 'px';
        });

        document.addEventListener('mousemove', (e) => {
            if (draggedPanel) {
                draggedPanel.style.left = (e.clientX - dragOffset.x) + 'px';
                draggedPanel.style.top = (e.clientY - dragOffset.y) + 'px';
                draggedPanel.style.right = 'auto';
                draggedPanel.style.bottom = 'auto';
            }

            if (resizingPanel) {
                const dx = e.clientX - resizeStart.x;
                const dy = e.clientY - resizeStart.y;
                const MIN_W = 220, MIN_H = 120;

                if (resizeDir === 'e' || resizeDir === 'se') {
                    resizingPanel.style.width = Math.max(MIN_W, resizeStart.w + dx) + 'px';
                }
                if (resizeDir === 's' || resizeDir === 'se') {
                    resizingPanel.style.height = Math.max(MIN_H, resizeStart.h + dy) + 'px';
                }
            }
        });

        document.addEventListener('mouseup', () => {
            if (draggedPanel) {
                draggedPanel.classList.remove('dragging');
                draggedPanel = null;
            }
            if (resizingPanel) {
                resizingPanel.classList.remove('resizing');
                resizingPanel = null;
                resizeDir = null;
            }
        });
        
        // ==================== FILE UPLOAD ====================
        const uploadZone = document.getElementById('upload-zone');
        const fileInput = document.getElementById('file-input');
        const uploadText = document.getElementById('upload-text');
        
        uploadZone.addEventListener('click', () => fileInput.click());
        
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('uploading');
        });
        
        uploadZone.addEventListener('dragleave', () => {
            if (!fileInput.files?.length) uploadZone.classList.remove('uploading');
        });
        
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) {
                handleFileUpload(e.dataTransfer.files[0]);
            }
        });
        
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFileUpload(e.target.files[0]);
            }
        });
        
        async function handleFileUpload(file) {
            uploadZone.classList.add('uploading');
            uploadText.textContent = 'Analyzing… this may take a minute';
            
            try {
                const data = await apiUpload('/calls/analyze', file);
                
                // Refresh dashboard
                loadDashboard();

                // Reset upload zone
                uploadZone.classList.remove('uploading');
                uploadText.textContent = 'Drop your call recording here';

                switchToView('progress');
                await loadCallHistory();

                // Show the first-call feedback popup once per user — gates the call modal until dismissed.
                const showed = maybeShowFirstCallFeedback(data.call.id, data.isFirstCall);
                if (!showed) openCallModal(data.call.id);

            } catch (error) {
                const isTokenError = error.message.includes('tokens') || error.message.includes('OUT_OF_TOKENS');
                uploadText.textContent = isTokenError ? 'Out of tokens.' : error.message;

                setTimeout(() => {
                    uploadZone.classList.remove('uploading');
                    uploadText.textContent = 'Drop your call recording here';
                }, isTokenError ? 8000 : 3000);
            }
        }

        // ==================== FIRST-CALL FEEDBACK POPUP ====================
        // Returns true if the popup was shown (caller should defer opening the call modal).
        // Returns false if it was suppressed — caller should proceed normally.
        function maybeShowFirstCallFeedback(callId, isFirstCall) {
            if (!isFirstCall) return false;
            if (currentUser?.settings?.firstCallFeedbackShown) return false;

            const overlay = document.getElementById('first-call-feedback-overlay');
            const skipBtn = document.getElementById('first-call-feedback-skip');
            const submitBtn = document.getElementById('popup-submit-btn');
            const whatWorkedEl = document.getElementById('popup-what-worked');
            const whatDidntEl = document.getElementById('popup-what-didnt');
            const helpfulBtns = document.querySelectorAll('.popup-helpful-btn');

            // Reset state every time the popup opens
            let selectedHelpful = null;
            whatWorkedEl.value = '';
            whatDidntEl.value = '';
            helpfulBtns.forEach(b => b.classList.remove('selected'));
            submitBtn.disabled = false;
            submitBtn.textContent = 'send to Brutus';

            helpfulBtns.forEach(btn => {
                btn.onclick = () => {
                    helpfulBtns.forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    selectedHelpful = btn.dataset.value;
                };
            });

            const markShownLocally = () => {
                if (currentUser) {
                    currentUser.settings = { ...(currentUser.settings || {}), firstCallFeedbackShown: true };
                }
            };

            const closeAndOpenCall = () => {
                overlay.classList.add('hidden');
                openCallModal(callId);
            };

            submitBtn.onclick = async () => {
                submitBtn.disabled = true;
                submitBtn.textContent = 'sending...';
                try {
                    await apiCall(`/calls/${callId}/popup-feedback`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                            helpful: selectedHelpful,
                            whatWorked: whatWorkedEl.value.trim(),
                            whatDidnt: whatDidntEl.value.trim()
                        })
                    });
                    markShownLocally();
                } catch (err) {
                    console.warn('popup feedback save failed:', err.message);
                }
                closeAndOpenCall();
            };

            skipBtn.onclick = async () => {
                try {
                    await apiCall('/calls/popup-feedback/skip', { method: 'POST' });
                    markShownLocally();
                } catch (err) {
                    console.warn('popup skip failed:', err.message);
                }
                closeAndOpenCall();
            };

            overlay.classList.remove('hidden');
            return true;
        }

        // ==================== CHAT ====================
        const chatMessages = document.getElementById('chat-messages');
        const chatInput = document.getElementById('chat-input');
        const chatSendBtn = document.getElementById('chat-send-btn');
        
        function addChatMessage(text, isUser = false) {
            if (!chatMessages) return;
            if (typeof paperChatMessage === 'function') {
                const wrap = document.createElement('div');
                wrap.innerHTML = paperChatMessage(isUser ? 'user' : 'brutus', text);
                if (wrap.firstElementChild) chatMessages.appendChild(wrap.firstElementChild);
                chatMessages.scrollTop = chatMessages.scrollHeight;
                return;
            }
            const messageDiv = document.createElement('div');
            messageDiv.className = 'chat-message';
            
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            
            messageDiv.innerHTML = `
                <div class="message-avatar ${isUser ? 'user-avatar' : 'brutus-avatar'}">${isUser ? 'U' : 'B'}</div>
                <div class="message-content">
                    <div class="message-text">${escapeHtml(text)}</div>
                    <div class="message-time">${timeStr}</div>
                </div>
            `;
            
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        function switchToView(viewName) {
            document.querySelectorAll('.nav-item').forEach(i => {
                if (i.getAttribute('id') === 'nav-lil-brutus') return;
                i.classList.remove('active');
            });
            const navItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
            if (navItem) navItem.classList.add('active');
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            const targetView = document.getElementById(viewName + '-view');
            if (targetView) targetView.classList.add('active');
        }

        function toggleCard(id) {
            const card = document.getElementById(id);
            if (card) card.classList.toggle('expanded');
        }

        async function sendChatMessage() {
            const text = chatInput.value.trim();
            if (!text) return;

            // Intercept research intent
            const researchMatch = text.match(/^(?:research|look up|lookup|find|pull up|get info on|dig up|what do you know about)\s+(.+)/i);
            if (researchMatch) {
                const subject = researchMatch[1].trim();
                addChatMessage(text, true);
                chatInput.value = '';
                addChatMessage(`on it. pulling a brief on "${subject}" now — check the research tab in about a minute.`, false);
                switchToView('research');
                loadResearch();
                document.getElementById('research-name').value = subject;
                submitResearch();
                return;
            }

            addChatMessage(text, true);
            chatInput.value = '';
            chatSendBtn.disabled = true;

            try {
                const data = await apiCall('/calls/chat', {
                    method: 'POST',
                    body: JSON.stringify({ message: text })
                });

                addChatMessage(data.response, false);
            } catch (error) {
                addChatMessage(billingGateText(error) || 'sorry, something went wrong. try again.', false);
            } finally {
                chatSendBtn.disabled = false;
            }
        }
        
        chatSendBtn.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMessage();
        });
        
        document.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.id === 'chat-research-btn') {
                    switchToView('research');
                    loadResearch();
                    document.getElementById('research-name').focus();
                    return;
                }
                chatInput.value = btn.dataset.msg;
                sendChatMessage();
            });
        });
        
        // ==================== NOTES ====================
        let allNoteGroups = [];

        function renderNotes(groups) {
            const notesList = document.getElementById('notes-list');
            if (!notesList) return;

            if (groups.length === 0) {
                notesList.innerHTML = '<p style="text-align: center; color: rgba(255,255,255,0.5); margin-top: 20px;">no notes yet — they appear here automatically during live sessions</p>';
                return;
            }

            notesList.innerHTML = groups.map((group, i) => {
                const dt = formatDateTime(group.session.startedAt);
                const noteCount = group.notes.length;
                const aiCount = group.notes.filter(n => n.type !== 'manual').length;
                const meta = `${noteCount} note${noteCount !== 1 ? 's' : ''} · ${aiCount} ai`;

                const sid = group.session.id;
                // Panel ids derive from the session id (a UUID), not the map
                // index: filtering re-maps indexes to different sessions, so an
                // async callback re-querying an index-based id could write one
                // session's content into another's card.
                const tid = `note-transcript-${sid}`;
                const smid = `note-summary-${sid}`;
                // A session whose summary is already known (persisted server-side)
                // renders it directly and gets NO summarize button, so it can
                // never issue another POST / be charged again.
                const cachedSummary = noteSummaryCache.get(sid);
                const summarizeBtnHtml = cachedSummary === undefined ? `
                        <button type="button" class="auth-btn" style="width:auto;padding:8px 16px;font-size:12px;margin-left:8px;"
                                data-action="summarize-note-session"
                                data-session-id="${escapeHtml(sid)}" data-target="${escapeHtml(smid)}">summarize with AI</button>` : '';
                const transcriptHtml = `
                    <div style="margin-bottom: 14px;">
                        <button type="button" class="cc-transcript-toggle"
                                data-action="toggle-note-transcript"
                                data-session-id="${escapeHtml(sid)}" data-target="${escapeHtml(tid)}"
                                aria-expanded="false" aria-controls="${escapeHtml(tid)}">show transcript</button>${summarizeBtnHtml}
                        <div id="${escapeHtml(tid)}" class="cc-transcript hidden" role="region"
                             aria-label="session transcript" tabindex="-1"></div>
                        <div id="${escapeHtml(smid)}" class="note-summary${cachedSummary === undefined ? ' hidden' : ''}" role="region" aria-label="ai summary"
                             aria-live="polite" aria-busy="false">${cachedSummary !== undefined ? cachedSummary : ''}</div>
                    </div>
                `;

                const notesHtml = group.notes.map(note => {
                    const noteTime = new Date(note.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                    const typeColor = note.type === 'manual' ? 'rgba(80,150,255,0.35)' : 'rgba(255,80,80,0.35)';
                    const typeLabel = note.type === 'manual' ? '📝 manual' : '🤖 ai';
                    return `
                        <div style="background: rgba(255,255,255,0.03); border-left: 3px solid ${typeColor}; padding: 12px 14px; margin-bottom: 10px; border-radius: 8px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                                <span style="font-size: 11px; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.06em;">${typeLabel}</span>
                                <span style="font-size: 11px; color: rgba(255,255,255,0.35);">${noteTime}</span>
                            </div>
                            <p style="font-size: 14px; line-height: 1.65; color: rgba(255,255,255,0.85); margin: 0;">${escapeHtml(note.content)}</p>
                        </div>
                    `;
                }).join('');

                return `
                    <div class="history-card" id="notes-card-${i}">
                        <div class="history-card-header" data-action="toggle-card" data-target="notes-card-${i}">
                            <div class="history-card-title">session — ${dt}</div>
                            <div class="history-card-meta">${meta}</div>
                            <div class="history-card-chevron">▼</div>
                        </div>
                        <div class="history-card-body">
                            <div style="padding-top: 14px;">
                                ${transcriptHtml}
                                ${notesHtml}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        const noteTranscriptCache = new Map();   // sessionId -> rendered html
        const noteTranscriptInFlight = new Set();
        const noteSummaryCache = new Map();      // sessionId -> escaped summary html
        const noteSummaryInFlight = new Set();
        // Bumped on every logout so an in-flight response issued by the previous
        // account can never render into the next account's page.
        let authGeneration = 0;
        // Monotonic sequence for loadNotes(): of overlapping loads (rapid tab
        // switches, re-auth), only the most recently issued one may write state
        // or DOM. authGeneration alone cannot order same-account requests.
        let notesLoadSeq = 0;

        // Called from the logout handler: without a page reload, module state and
        // rendered notes would otherwise survive into the next account's session.
        function resetNotesTranscriptState() {
            authGeneration += 1;
            noteTranscriptCache.clear();
            noteTranscriptInFlight.clear();
            noteSummaryCache.clear();
            noteSummaryInFlight.clear();
            // Drop the grouped notes data too: the search handler re-renders
            // from allNoteGroups, so leaving it populated would let the previous
            // account's notes reappear after logout without any new fetch.
            allNoteGroups = [];
            const searchInput = document.getElementById('notes-search');
            if (searchInput) searchInput.value = '';
            const notesList = document.getElementById('notes-list');
            if (notesList) notesList.innerHTML = '';
        }

        function renderNoteTranscriptLines(data) {
            if (data.isEmpty || data.lineCount === 0 || !Array.isArray(data.lines) || data.lines.length === 0) {
                return '<div style="color:rgba(255,255,255,0.3);font-size:12px;">no transcript captured for this session</div>';
            }
            return data.lines.map(line => {
                const text = escapeHtml(line && line.text);
                if (data.speakerLabeled && line && line.speaker) {
                    const chipClass = line.speaker === 'prospect' ? 'note-speaker prospect' : 'note-speaker';
                    return `<div><span class="${chipClass}">${escapeHtml(line.speaker)}</span>${text}</div>`;
                }
                return `<div>${text}</div>`;
            }).join('');
        }

        async function toggleNoteTranscript(btn) {
            const sid = btn.dataset.sessionId;
            const panel = document.getElementById(btn.dataset.target);
            if (!sid || !panel) return;

            // Collapse — no fetch, just hide.
            if (btn.getAttribute('aria-expanded') === 'true') {
                panel.classList.add('hidden');
                btn.setAttribute('aria-expanded', 'false');
                btn.textContent = 'show transcript';
                return;
            }

            // Expand.
            btn.setAttribute('aria-expanded', 'true');
            panel.classList.remove('hidden');
            btn.textContent = 'hide transcript';

            // Re-expanding must never refetch.
            if (noteTranscriptCache.has(sid)) {
                panel.innerHTML = noteTranscriptCache.get(sid);
                return;
            }
            if (noteTranscriptInFlight.has(sid)) return;

            noteTranscriptInFlight.add(sid);
            btn.disabled = true;
            panel.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:12px;">loading transcript...</div>';
            const gen = authGeneration;
            try {
                const data = await apiCall(`/notes/session/${encodeURIComponent(sid)}/transcript`);
                if (gen !== authGeneration) return;
                const html = renderNoteTranscriptLines(data);
                // Cache before any DOM write: a search re-render mid-flight
                // replaces the notes list, so the cache — not this response's
                // DOM write — is what makes the next expand/render correct.
                noteTranscriptCache.set(sid, html);
                // The captured `panel` may be a detached node after a mid-flight
                // re-render; re-query the live DOM by the stable session-derived
                // id and skip the write if the panel is no longer mounted.
                const livePanel = document.getElementById(`note-transcript-${sid}`);
                if (livePanel) livePanel.innerHTML = html;
                applyPersistedNoteSummary(sid, data);
            } catch (error) {
                if (gen !== authGeneration) return;
                // apiCall already toasts billing errors; just show inline state.
                // Not cached, so the user can retry.
                console.error('Failed to load transcript:', error);
                const livePanel = document.getElementById(`note-transcript-${sid}`);
                if (livePanel) livePanel.innerHTML = '<div style="color:#ff5050;font-size:12px;">failed to load transcript</div>';
            } finally {
                // A superseded response's entry was already cleared on logout;
                // deleting here could wrongly cancel the next account's in-flight fetch.
                if (gen === authGeneration) {
                    noteTranscriptInFlight.delete(sid);
                    // Re-enable the currently mounted toggle, not the captured
                    // (possibly detached) one.
                    const liveToggle = document.querySelector(`[data-action="toggle-note-transcript"][data-session-id="${sid}"]`);
                    if (liveToggle) liveToggle.disabled = false;
                }
            }
        }

        // The only place summary text becomes html. Every path — POST success,
        // transcript GET, and the /notes payload seed — must route through it.
        function noteSummaryHtml(summary) {
            return escapeHtml(summary);
        }

        // The transcript GET also carries any persisted summary. Rendering it
        // here — and removing the summarize button — is what guarantees a
        // session that already has a summary never issues a POST (and is
        // therefore never charged twice).
        function applyPersistedNoteSummary(sid, data) {
            if (data.summaryStatus !== 'ready' && data.summary == null) return;
            const html = noteSummaryHtml(data.summary);
            // Cache before the DOM write so a re-render racing this call still
            // produces a card with the summary and no button.
            noteSummaryCache.set(sid, html);
            // Query by the stable session-derived id: the caller's captured
            // nodes may be detached if the list re-rendered mid-flight.
            const region = document.getElementById(`note-summary-${sid}`);
            if (region) {
                region.innerHTML = html;
                region.classList.remove('hidden', 'error');
                region.setAttribute('aria-busy', 'false');
            }
            const summarizeBtn = document.querySelector(`[data-action="summarize-note-session"][data-session-id="${sid}"]`);
            if (summarizeBtn) summarizeBtn.remove();
        }

        async function summarizeNoteSession(btn) {
            const sid = btn.dataset.sessionId;
            const region = document.getElementById(btn.dataset.target);
            if (!sid || !region) return;

            // Client half of the double-click guard; the backend's atomic DB
            // claim is the authoritative half.
            if (noteSummaryInFlight.has(sid)) return;

            noteSummaryInFlight.add(sid);
            btn.disabled = true;
            btn.textContent = 'summarizing...';
            region.classList.remove('hidden', 'error');
            region.setAttribute('aria-busy', 'true');
            region.textContent = 'generating summary...';

            const gen = authGeneration;
            try {
                const data = await apiCall(`/notes/session/${encodeURIComponent(sid)}/summary`, { method: 'POST' });
                if (gen !== authGeneration) return;
                if (data.status === 'ready') {
                    const html = noteSummaryHtml(data.summary);
                    // Cache before any DOM write: if the list re-rendered while
                    // the POST was in flight, the captured nodes are detached
                    // and the cache is what makes that (and every later) render
                    // show the summary with no summarize button.
                    noteSummaryCache.set(sid, html);
                    // Re-query the live DOM by the stable session-derived id;
                    // never write to the captured, possibly detached nodes. If
                    // the card is gone, skipping the write is correct — the
                    // cache already guarantees the next render is right.
                    const liveRegion = document.getElementById(`note-summary-${sid}`);
                    if (liveRegion) {
                        liveRegion.innerHTML = html;
                        liveRegion.classList.remove('hidden', 'error');
                        liveRegion.setAttribute('aria-busy', 'false');
                    }
                    // Persisted server-side; removing the currently mounted
                    // button (not the captured one) makes a second click (and a
                    // second POST) impossible.
                    const liveBtn = document.querySelector(`[data-action="summarize-note-session"][data-session-id="${sid}"]`);
                    if (liveBtn) liveBtn.remove();
                } else {
                    // 202 pending: another generation won the race. Not cached,
                    // so the user can retry to pick up the finished result.
                    const liveRegion = document.getElementById(`note-summary-${sid}`);
                    if (liveRegion) {
                        liveRegion.classList.remove('hidden');
                        liveRegion.textContent = 'another summary is already running — reopen this card in a moment';
                        liveRegion.setAttribute('aria-busy', 'false');
                    }
                    const liveBtn = document.querySelector(`[data-action="summarize-note-session"][data-session-id="${sid}"]`);
                    if (liveBtn) {
                        liveBtn.disabled = false;
                        liveBtn.textContent = 'summarize with AI';
                    }
                }
            } catch (error) {
                if (gen !== authGeneration) return;
                // apiCall already toasts billing codes; show the message inline
                // only. Not cached, so a failed summary is retryable.
                console.error('Failed to summarize session:', error);
                const liveRegion = document.getElementById(`note-summary-${sid}`);
                if (liveRegion) {
                    liveRegion.classList.remove('hidden');
                    liveRegion.classList.add('error');
                    liveRegion.textContent = error.message || 'failed to generate summary';
                    liveRegion.setAttribute('aria-busy', 'false');
                }
                const liveBtn = document.querySelector(`[data-action="summarize-note-session"][data-session-id="${sid}"]`);
                if (liveBtn) {
                    liveBtn.disabled = false;
                    liveBtn.textContent = 'summarize with AI';
                }
            } finally {
                // Same generation-guarded cleanup as the transcript fetch: a
                // superseded call must not clear the next account's in-flight state.
                if (gen === authGeneration) {
                    noteSummaryInFlight.delete(sid);
                }
            }
        }

        async function loadNotes() {
            // Capture both fences before the await, outside the try so the
            // catch path is guarded too: gen invalidates responses that
            // straddle a logout/account switch, seq invalidates an older
            // overlapping load racing a newer one for the same account.
            const gen = authGeneration;
            const seq = ++notesLoadSeq;
            try {
                const data = await apiCall('/notes');
                // A stale response — issued before a logout, or superseded by a
                // newer load — must not reseed the summary cache or notes list.
                if (gen !== authGeneration || seq !== notesLoadSeq) return;

                // Group notes by session
                const groupMap = {};
                (data.notes || []).forEach(note => {
                    if (!groupMap[note.sessionId]) {
                        groupMap[note.sessionId] = { session: note.session, notes: [] };
                    }
                    groupMap[note.sessionId].notes.push(note);
                });
                allNoteGroups = Object.values(groupMap);

                // Seed the summary cache from the persisted state already in the
                // /notes payload (raw Prisma field names on note.session), so a
                // page load renders an existing summary with no POST and no
                // summarize button. Only a genuinely present summary suppresses
                // the button: 'pending' and 'failed' with a null summary must
                // keep a live, retryable button.
                allNoteGroups.forEach(group => {
                    const session = group.session;
                    if (session && session.transcriptSummary != null) {
                        noteSummaryCache.set(session.id, noteSummaryHtml(session.transcriptSummary));
                    }
                });

                renderNotes(allNoteGroups);

                const searchInput = document.getElementById('notes-search');
                if (searchInput && !searchInput.dataset.bound) {
                    searchInput.dataset.bound = '1';
                    searchInput.addEventListener('input', (e) => {
                        const q = e.target.value.toLowerCase();
                        if (!q) { renderNotes(allNoteGroups); return; }
                        const filtered = allNoteGroups.map(group => ({
                            ...group,
                            notes: group.notes.filter(n =>
                                n.content.toLowerCase().includes(q) ||
                                formatDateTime(n.timestamp).toLowerCase().includes(q)
                            )
                        })).filter(g => g.notes.length > 0);
                        renderNotes(filtered);
                    });
                }
            } catch (error) {
                console.error('Failed to load notes:', error);
                // Same fences as the success path: a late failure from a
                // superseded or pre-logout request must not clobber the notes
                // UI that a newer load (or the next account) has rendered.
                if (gen !== authGeneration || seq !== notesLoadSeq) return;
                const notesList = document.getElementById('notes-list');
                if (notesList) notesList.innerHTML = '<p style="text-align: center; color: #ff5050; margin-top: 20px;">failed to load notes</p>';
            }
        }

        // Export notes to CSV
        document.getElementById('export-notes-btn').addEventListener('click', async () => {
            try {
                const data = await apiCall('/notes');

                if (!data.notes || data.notes.length === 0) {
                    alert('No notes to export');
                    return;
                }

                // Create CSV
                const csvHeader = 'Date,Time,Type,Content\n';
                const csvRows = data.notes.map(note => {
                    const date = new Date(note.timestamp).toLocaleDateString();
                    const time = new Date(note.timestamp).toLocaleTimeString();
                    // Escape double quotes, then neutralize leading formula characters (=, +, -, @)
                    // to prevent spreadsheet formula injection when opened in Excel/Sheets
                    const sanitizeCsvCell = (val) => {
                        let s = String(val ?? '').replace(/"/g, '""');
                        if (/^[=+\-@]/.test(s)) s = "'" + s;
                        return s;
                    };
                    return `"${sanitizeCsvCell(date)}","${sanitizeCsvCell(time)}","${sanitizeCsvCell(note.type)}","${sanitizeCsvCell(note.content)}"`;
                }).join('\n');

                const csv = csvHeader + csvRows;

                // Download
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `brutus-notes-${new Date().toISOString().split('T')[0]}.csv`;
                a.click();
                URL.revokeObjectURL(url);
            } catch (error) {
                console.error('Failed to export notes:', error);
                alert('Failed to export notes');
            }
        });

        // ==================== RESEARCH ====================
        let allResearch = [];

        function renderResearch(items) {
            const list = document.getElementById('research-list');
            if (!list) return;

            const foot = document.querySelector('.p-research-foot .p-t-12');
            if (foot) foot.textContent = `Research history: ${items.length} saved brief${items.length === 1 ? '' : 's'}`;

            if (typeof paperResearchRow === 'function') {
                list.innerHTML = items.map(item => paperResearchRow({
                    ...item,
                    dateLabel: item.requestedAt ? formatDateTime(item.requestedAt) : ''
                })).join('');
                return;
            }

            if (items.length === 0) {
                list.innerHTML = '';
                return;
            }

            list.innerHTML = items.map((item, i) => {
                const dt = formatDateTime(item.requestedAt);
                const statusColor = item.status === 'completed' ? '#50ff80' : item.status === 'pending' ? '#ffb050' : '#ff5050';
                const statusLabel = item.status === 'pending' ? '⏳ researching...' : item.status === 'completed' ? '✓ done' : '✗ failed';
                const shortQuery = item.query.length > 60 ? item.query.slice(0, 60) + '…' : item.query;
                const resultsHtml = item.results
                    ? `<div style="padding-top: 14px; white-space: pre-wrap; font-size: 14px; line-height: 1.75; color: rgba(255,255,255,0.82);">${escapeHtml(item.results)}</div>`
                    : `<p style="padding-top: 14px; color: rgba(255,255,255,0.4); font-style: italic;">research in progress...</p>`;

                return `
                    <div class="history-card" id="research-card-${i}">
                        <div class="history-card-header" data-action="toggle-card" data-target="research-card-${i}">
                            <div class="history-card-title">${escapeHtml(shortQuery)}</div>
                            <div class="history-card-meta">
                                <span style="color: ${statusColor}; margin-right: 12px;">${statusLabel}</span>${dt}
                            </div>
                            <div class="history-card-chevron">▼</div>
                        </div>
                        <div class="history-card-body">
                            ${resultsHtml}
                        </div>
                    </div>
                `;
            }).join('');
        }

        async function loadResearch() {
            try {
                const data = await apiCall('/research');
                allResearch = data.research || [];
                renderResearch(allResearch);

                const searchInput = document.getElementById('research-search');
                if (searchInput && !searchInput.dataset.bound) {
                    searchInput.dataset.bound = '1';
                    searchInput.addEventListener('input', (e) => {
                        const q = e.target.value.toLowerCase();
                        if (!q) { renderResearch(allResearch); return; }
                        renderResearch(allResearch.filter(item =>
                            item.query.toLowerCase().includes(q) ||
                            formatDateTime(item.requestedAt).toLowerCase().includes(q)
                        ));
                    });
                }
            } catch (error) {
                console.error('Failed to load research:', error);
                document.getElementById('research-list').innerHTML = '<p style="text-align: center; color: #ff5050; margin-top: 20px;">failed to load research</p>';
            }
        }

        // Submit research from web frontend
        async function submitResearch(prefillName) {
            const nameInput = document.getElementById('research-name');
            const locationInput = document.getElementById('research-location');
            const phoneInput = document.getElementById('research-phone');
            const emailInput = document.getElementById('research-email');
            const companyInput = document.getElementById('research-company');
            const roleInput = document.getElementById('research-role');
            const linkedinInput = document.getElementById('research-linkedin');
            const notesInput = document.getElementById('research-notes');
            const btn = document.getElementById('research-submit-btn');

            if (prefillName) nameInput.value = prefillName;

            const name = nameInput.value.trim();
            const location = locationInput.value.trim();
            const phone = phoneInput.value.trim();
            const email = emailInput.value.trim();
            const company = companyInput.value.trim();
            const role = roleInput.value.trim();
            const linkedin = linkedinInput.value.trim();
            const notes = notesInput.value.trim();

            if (!name) {
                nameInput.style.borderColor = 'rgba(255,80,80,0.6)';
                setTimeout(() => nameInput.style.borderColor = '', 1500);
                return false;
            }

            // Build a rich query string for the AI
            const parts = [];
            if (name && role && company) parts.push(`${name}, ${role} at ${company}`);
            else if (name && company) parts.push(`${name} at ${company}`);
            else parts.push(name);
            if (location) parts.push(`location: ${location}`);
            if (phone) parts.push(`phone: ${phone}`);
            if (email) parts.push(`email: ${email}`);
            if (role && !company) parts.push(`role: ${role}`);
            if (linkedin) parts.push(`social: ${linkedin}`);
            if (notes) parts.push(`context: ${notes}`);
            const query = parts.join(', ');

            btn.disabled = true;
            btn.textContent = 'researching...';

            try {
                await apiCall('/research', {
                    method: 'POST',
                    body: JSON.stringify({ query })
                });
                // Clear form
                nameInput.value = '';
                locationInput.value = '';
                phoneInput.value = '';
                emailInput.value = '';
                companyInput.value = '';
                roleInput.value = '';
                linkedinInput.value = '';
                notesInput.value = '';
                await loadResearch();
                return true;
            } catch (error) {
                console.error('Research request failed:', error);
                return false;
            } finally {
                btn.disabled = false;
                btn.textContent = 'research this prospect';
            }
        }

        document.getElementById('research-submit-btn').addEventListener('click', () => submitResearch());

        // Context hint chips — append to notes textarea
        document.querySelectorAll('.research-hint-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const notes = document.getElementById('research-notes');
                const current = notes.value.trim();
                notes.value = current ? current + ', ' + btn.dataset.hint : btn.dataset.hint;
                notes.focus();
            });
        });

        // Export research to PDF (simplified - creates downloadable text file)
        document.getElementById('export-research-btn').addEventListener('click', async () => {
            try {
                const data = await apiCall('/research');

                if (!data.research || data.research.length === 0) {
                    alert('No research to export');
                    return;
                }

                // Create formatted text document
                let content = 'BRUTUS.AI RESEARCH REPORT\n';
                content += '='.repeat(50) + '\n\n';

                data.research.forEach(item => {
                    const date = new Date(item.requestedAt).toLocaleString();
                    content += `QUERY: ${item.query}\n`;
                    content += `DATE: ${date}\n`;
                    content += `STATUS: ${item.status}\n`;
                    content += `-`.repeat(50) + '\n';
                    if (item.results) {
                        content += item.results + '\n';
                    } else {
                        content += 'Research pending or failed\n';
                    }
                    content += '\n' + '='.repeat(50) + '\n\n';
                });

                // Download
                const blob = new Blob([content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `brutus-research-${new Date().toISOString().split('T')[0]}.txt`;
                a.click();
                URL.revokeObjectURL(url);
            } catch (error) {
                console.error('Failed to export research:', error);
                alert('Failed to export research');
            }
        });

        function installClickDelegation() {
            document.addEventListener('click', (e) => {
                const jump = e.target.closest('.p-ts-jump');
                if (jump && typeof paperSeekRecording === 'function') {
                    paperSeekRecording(Number(jump.getAttribute('data-seek-sec')));
                    return;
                }
                const el = e.target.closest('[data-action]');
                if (!el) return;

                switch (el.dataset.action) {
                    case 'open-call':
                        openCallModal(el.dataset.id);
                        break;
                    case 'open-cold-call-session':
                        openColdCallSessionModal(el.dataset.id);
                        break;
                    case 'open-roleplay-session':
                        openRoleplaySessionModal(el.dataset.id);
                        break;
                    case 'toggle-card':
                        toggleCard(el.dataset.target);
                        break;
                    case 'toggle-cc-transcript':
                        toggleColdCallTranscript(el.dataset.target, el);
                        break;
                    case 'toggle-note-transcript':
                        toggleNoteTranscript(el);
                        break;
                    case 'summarize-note-session':
                        summarizeNoteSession(el);
                        break;
                    case 'rate-feedback':
                        rateCallFeedback(el.dataset.callId, Number(el.dataset.index), el.dataset.rating, el);
                        break;
                    case 'set-outcome':
                        setCallOutcome(el.dataset.callId, el.dataset.outcome, el);
                        break;
                    case 'switch-credits':
                        switchToCredits();
                        break;
                    case 'subscribe':
                        startSubscription();
                        break;
                    case 'manage-subscription':
                        openBillingPortal();
                        break;
                    case 'buy-pack':
                        buyPack(el.dataset.pack);
                        break;
                    case 'custom-topup':
                        customTopup();
                        break;
                    case 'save-auto-topup':
                        saveAutoTopup();
                        break;
                    case 'skip-onboarding':
                        skipOnboarding();
                        break;
                    case 'onboarding-next':
                        onboardingNext();
                        break;
                    default:
                        break;
                }
            });
        }

        function setDashDate() {
            const dateEl = document.getElementById('dash-date');
            if (dateEl) {
                dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
            }
        }

        // ==================== INIT ====================
        setDashDate();
        installClickDelegation();
        checkAuth();