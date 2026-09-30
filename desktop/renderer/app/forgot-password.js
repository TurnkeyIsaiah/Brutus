(function () {
  let API_URL = window.BRUTUS_API_URL || 'https://api.brutusai.coach';

  document.getElementById('forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (window.brutus && window.brutus.getSettings) {
      try {
        const settings = await window.brutus.getSettings();
        const apiUrl = settings && typeof settings.apiUrl === 'string' ? settings.apiUrl.trim() : '';
        if (apiUrl) API_URL = apiUrl.replace(/\/$/, '');
      } catch (_) {}
    }
    const btn = document.getElementById('submitBtn');
    const errorEl = document.getElementById('authError');
    const successEl = document.getElementById('authSuccess');
    errorEl.classList.remove('visible');
    successEl.classList.remove('visible');
    btn.disabled = true;
    btn.textContent = 'sending...';

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (window.brutus) headers['X-Brutus-Client'] = 'brutus-desktop';
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: document.getElementById('email').value.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        errorEl.textContent = data.error?.message || 'something went wrong. try again.';
        errorEl.classList.add('visible');
      } else {
        successEl.textContent = "if that email is registered, you'll get a reset link shortly. check your inbox.";
        successEl.classList.add('visible');
        document.getElementById('email').value = '';
      }
    } catch (err) {
      errorEl.textContent = 'something went wrong. try again.';
      errorEl.classList.add('visible');
    } finally {
      btn.disabled = false;
      btn.textContent = 'send reset link';
    }
  });
})();
