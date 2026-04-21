// 🔒 MINIMAL FRONTEND - All animations preserved
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
const ALLOWED_DOMAINS = ['t.me', 'telegram.org', 'telegram.me'];

// Challenge token storage
let challengeToken = null;
let countdownInterval = null;

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

// Server commands (map short codes to handlers)
const cmds = {
  // Init: Hide loader, show button
  i: () => {
    hide(ui.loaderWrapper);
    hide(ui.shieldWrapper);
    if (ui.clickVerifyBtn) ui.clickVerifyBtn.style.display = 'inline-block';
    if (ui.statusMessage) ui.statusMessage.textContent = 'Click the button to continue';
  },

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
    // Clear countdown if error
    if (countdownInterval) clearInterval(countdownInterval);
  },

// Short codes for countdown and redirect
cd: (seconds) => cmds.countdown(seconds),
rd: (url) => cmds.redirect(url),
r: (url) => cmds.redirect(url), // Alias for redirect (used by /api/c case 'r')

  // Short code for error
  e: (msg) => cmds.error(msg),

  // Start countdown
  countdown: (seconds) => {
    if (!seconds || seconds < 1) seconds = 3;
    let remaining = seconds;

    console.log('Starting countdown:', seconds, 'seconds');

    // Show countdown box
    if (ui.countdownBox) ui.countdownBox.style.display = 'block';
    if (ui.countdown) ui.countdown.textContent = remaining;

    // Animate progress bar
    if (ui.progressBar) ui.progressBar.style.display = 'block';
    if (ui.progress) {
      ui.progress.style.width = '0%';
      ui.progress.style.transition = `width ${seconds}s linear`;
      setTimeout(() => { ui.progress.style.width = '100%'; }, 50);
    }

    // Update countdown
    countdownInterval = setInterval(() => {
      remaining--;
      if (ui.countdown) ui.countdown.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        console.log('Countdown complete, requesting redirect...');
        // Request redirect
        send('r');
      }
    }, 1000);
  },

// Redirect (with domain whitelist validation for external URLs, allow internal paths)
redirect: (url) => {
  // Clear any running countdown
  if (countdownInterval) clearInterval(countdownInterval);

  console.log('Redirect command received, URL:', url);

  // Allow internal paths (starting with /) without validation
  if (url.startsWith('/')) {
    console.log('Redirecting to internal path:', url);
    window.location.href = url;
    return;
  }

  // Validate external URLs
  if (!isAllowedRedirect(url)) {
    console.error('Redirect URL not allowed:', url);
    cmds.error('Invalid redirect destination');
    return;
  }
  const isAndroid = /Android/i.test(navigator.userAgent);
  if (isAndroid) {
    try {
      console.log('Android detected, using intent URL');
      window.location.href = 'intent://' + url.replace(/^https?:\/\//, '') +
      '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' +
      encodeURIComponent(url) + ';end';
    } catch (e) {
      console.error('Intent URL failed, falling back to direct redirect:', e);
      window.location.href = url;
    }
  } else {
    console.log('Redirecting to:', url);
    window.location.href = url;
  }
};

const sid = location.pathname.split('/').pop();

async function send(action) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch('/api/c', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ a: action, s: sid, t: Date.now() }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      console.error('API Error:', res.status, text);
      cmds.error(`Server error: ${res.status}`);
      return;
    }

    const data = await res.json();

    // Store challenge token if provided
    if (data.k) {
      challengeToken = data.k;
    }

// Execute commands
if (data.c) {
  console.log('Executing commands:', data.c);
  data.c.forEach(cmd => {
    console.log('Command:', cmd.t, 'Data:', cmd.d);
    if (cmds[cmd.t]) {
      cmds[cmd.t](cmd.d);
    } else {
      console.warn('Unknown command:', cmd.t);
    }
  });
}
  } catch (e) {
    if (e.name === 'AbortError') {
      cmds.error('Request timeout - please refresh');
    } else {
      console.error('Fetch error:', e);
      cmds.error('Connection failed - check console');
    }
  }
}

// Setup click handler
if (ui.clickVerifyBtn) {
  ui.clickVerifyBtn.onclick = () => {
    ui.clickVerifyBtn.disabled = true;
    ui.clickVerifyBtn.textContent = 'Verifying...';
    send('c');
  };
}

// Auto-start initialization
send('i');
})();
