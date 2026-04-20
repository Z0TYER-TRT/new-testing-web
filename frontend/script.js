(function() {
  'use strict';

  const ui = {};
  ['mainContainer', 'title', 'message', 'status-message', 'clickVerifyBtn',
   'shieldWrapper', 'loaderWrapper', 'checkMark', 'crossMark', 'progressBar', 'progress',
   'countdownBox', 'countdown'
  ].forEach(id => ui[id] = document.getElementById(id));

  // Helper: add class for CSS animations
  function addClass(el, name) {
    if (el) el.classList.add(name);
  }

  // Helper: hide element
  function hide(el) {
    if (el) el.style.display = 'none';
  }

  // Helper: show element
  function show(el, display = 'flex') {
    if (el) el.style.display = display;
  }

// Allowed redirect domains (whitelist)
const ALLOWED_DOMAINS = ['t.me', 'telegram.org'];

function isAllowedRedirect(url) {
  try {
    if (!url || typeof url !== 'string') return false;
    if (!url.startsWith('https://')) return false;

    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Check against whitelist
    return ALLOWED_DOMAINS.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch (e) {
    return false;
  }
}

// Server commands
const cmds = {
  // UI updates with proper animations
  ui: (d) => {
    const el = ui[d.id];
    if (!el) return;

    // Handle text updates with fade
    if (d.text !== undefined) {
      el.style.opacity = '0.6';
      setTimeout(() => {
        el.textContent = d.text;
        el.style.opacity = '1';
      }, 150);
    }

    // Handle class additions
    if (d.class) addClass(el, d.class);

    // Handle display changes
    if (d.display === 'none') hide(el);
    if (d.display) show(el, d.display);

    // Handle inline styles
    if (d.styles) Object.assign(el.style, d.styles);
  },

  // Show checkmark with animation
  check: () => {
    hide(ui.shieldWrapper);
    hide(ui.loaderWrapper);
    addClass(ui.checkMark, 'show');
    addClass(ui.mainContainer, 'success');
  },

  // Show error with animation
  error: (msg) => {
    hide(ui.loaderWrapper);
    hide(ui.shieldWrapper);
    addClass(ui.crossMark, 'show');
    if (ui.title) {
      ui.title.style.opacity = '0.6';
      setTimeout(() => { ui.title.textContent = '❌ Access Denied'; ui.title.style.opacity = '1'; }, 150);
    }
    if (ui.message) {
      ui.message.style.opacity = '0.6';
      setTimeout(() => { ui.message.textContent = msg; ui.message.style.opacity = '1'; }, 150);
    }
    addClass(ui.mainContainer, 'error');
  },

  // Redirect (with domain whitelist validation)
  redirect: (url) => {
    if (!isAllowedRedirect(url)) {
      cmds.error('Invalid redirect destination');
      return;
    }
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid) {
      try {
        window.location.href = 'intent://' + url.replace(/^https?:\/\//, '') +
          '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' +
          encodeURIComponent(url) + ';end';
      } catch (e) { window.location.href = url; }
    } else { window.location.href = url; }
  }
};

  const sid = location.pathname.split('/').pop();

  async function send(a) {
    try {
      const res = await fetch('/api/c', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ a: a, s: sid, t: Date.now() })
      });
      const data = await res.json();
      if (data.c) data.c.forEach(cmd => cmds[cmd.t] && cmds[cmd.t](cmd.d));
    } catch (e) { cmds.error('Connection failed'); }
  }

  if (ui.clickVerifyBtn) ui.clickVerifyBtn.onclick = () => send('c');
  
  // Auto-start
  send('i');
})();
