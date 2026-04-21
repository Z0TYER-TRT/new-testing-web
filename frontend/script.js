// 🔒 MINIMAL FRONTEND - All animations preserved
(function() {
  'use strict';

const ui = {};
const uiIds = ['mainContainer', 'title', 'message', 'status-message', 'clickVerifyBtn',
'shieldWrapper', 'loaderWrapper', 'checkMark', 'crossMark', 'progressBar', 'progress',
'countdownBox', 'countdown'];

uiIds.forEach(id => {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`Element #${id} not found!`);
  }
  ui[id] = el;
});

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
    console.log('Init command received');
    hide(ui.loaderWrapper);
    hide(ui.shieldWrapper);
    
    if (ui.clickVerifyBtn) {
      console.log('Showing click button');
      ui.clickVerifyBtn.style.display = 'inline-block';
      ui.clickVerifyBtn.style.opacity = '1';
      ui.clickVerifyBtn.style.visibility = 'visible';
      ui.clickVerifyBtn.style.pointerEvents = 'auto';
      ui.clickVerifyBtn.style.cursor = 'pointer';
    }
    
    if (ui.statusMessage) {
      ui.statusMessage.textContent = 'Click the button to continue';
    }
    
    if (ui.message) {
      ui.message.textContent = 'Human verification required';
    }
  },

// UI updates with proper animations
ui: (d) => {
  const el = ui[d.id];
  if (!el) {
    console.warn(`UI element not found: ${d.id}`);
    return;
  }

  console.log(`UI update: ${d.id}`, d);

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

    window.debugLog('Redirect command received, URL:', url);

    // Allow internal paths (starting with /) without validation
    if (url.startsWith('/')) {
      window.debugLog('Redirecting to internal path:', url);
      window.location.href = url;
      return;
    }

    // Validate external URLs
    if (!isAllowedRedirect(url)) {
      window.debugLog('Redirect URL not allowed:', url);
      cmds.error('Invalid redirect destination');
      return;
    }
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid) {
      try {
        window.debugLog('Android detected, using intent URL');
        window.location.href = 'intent://' + url.replace(/^https?:\/\//, '') +
        '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' +
        encodeURIComponent(url) + ';end';
      } catch (e) {
        window.debugLog('Intent URL failed, falling back to direct redirect:', e);
        window.location.href = url;
      }
} else {
      window.debugLog('Redirecting to:', url);
      window.location.href = url;
    }
  }
};

// Extract session ID from URL
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
  
  // Show button if it was hidden
  if (ui.clickVerifyBtn) {
    ui.clickVerifyBtn.disabled = false;
    ui.clickVerifyBtn.textContent = '👆 Click to Continue';
    ui.clickVerifyBtn.style.cursor = 'pointer';
  }
  
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
window.debugLog('DOM Content loaded, checking button...');
window.debugLog('UI elements:', Object.keys(ui));
window.debugLog('Button element:', ui.clickVerifyBtn);
window.debugLog('Button HTML:', ui.clickVerifyBtn ? ui.clickVerifyBtn.outerHTML : 'N/A');

if (ui.clickVerifyBtn) {
  window.debugLog('Click button found, attaching handler');
  
  // Ensure button is visible initially
  ui.clickVerifyBtn.style.display = 'inline-block';
  ui.clickVerifyBtn.style.opacity = '1';
  ui.clickVerifyBtn.style.visibility = 'visible';
  ui.clickVerifyBtn.style.pointerEvents = 'auto';
  ui.clickVerifyBtn.style.cursor = 'pointer';
  
  ui.clickVerifyBtn.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.debugLog('Button clicked! Event:', e);
    window.debugLog('Button state:', { disabled: this.disabled, tagName: this.tagName, className: this.className });
    
    // Prevent multiple clicks
    if (this.disabled) {
      window.debugLog('Button already clicked, ignoring');
      return;
    }
    
    this.disabled = true;
    this.textContent = 'Verifying...';
    this.style.cursor = 'wait';
    this.style.opacity = '0.7';
    
    // Update status message
    if (ui.statusMessage) {
      ui.statusMessage.textContent = 'Verifying your click...';
    }
    
    window.debugLog('Sending click verification...');
    send('c');
  }, { once: false, capture: true });
} else {
  window.debugLog('Click button NOT found in DOM!');
  window.debugLog('All elements in DOM:', document.querySelectorAll('*').length);
  window.debugLog('Buttons in DOM:', document.querySelectorAll('button').length);
}

// Create debug overlay (visible even without dev tools)
function createDebugOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'debug-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:150px;background:rgba(0,0,0,0.8);color:#0f0;font-family:monospace;font-size:12px;padding:10px;overflow-y:auto;z-index:999999;display:none;';
  overlay.innerHTML = '<div style="position:sticky;top:0;background:#000;padding:5px;font-weight:bold;">DEBUG LOG (click to close) ▼</div><div id="debug-logs"></div>';
  overlay.onclick = function() { this.style.display = 'none'; };
  document.body.appendChild(overlay);
  
  // Store reference
  window.debugOverlay = overlay;
  window.debugLogs = document.getElementById('debug-logs');
  
  // Override console.log to also show in overlay
  const originalLog = console.log;
  window.debugLog = function(msg) {
    originalLog.call(console, msg);
    if (window.debugLogs) {
      const line = document.createElement('div');
      line.textContent = '> ' + msg;
      window.debugLogs.appendChild(line);
      window.debugLogs.scrollTop = window.debugLogs.scrollHeight;
    }
  };
}

// Create overlay and start initialization
createDebugOverlay();
window.debugLog('Starting initialization...');
send('i');
})();
