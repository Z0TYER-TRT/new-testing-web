// Ultra-secure invisible redirect - URL handled by server
(function() {
    'use strict';
    
    // Anti-debugging
    const devtools = { open: false };
    setInterval(() => {
        if (window.outerHeight - window.innerHeight > 160 || window.outerWidth - window.innerWidth > 160) {
            if (!devtools.open) {
                devtools.open = true;
                document.body.innerHTML = '';
                window.location.href = 'about:blank';
            }
        } else {
            devtools.open = false;
        }
    }, 500);
    
    // Block keyboard
    document.addEventListener('keydown', function(e) {
        if (e.keyCode === 123 || (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) || 
            (e.ctrlKey && e.keyCode === 85) || (e.ctrlKey && e.shiftKey && e.keyCode === 67) || 
            (e.keyCode === 116)) {
            e.preventDefault(); 
            return false;
        }
        if ((e.ctrlKey && ['c', 'C', 'a', 'A', 'x', 'X', 's', 'S', 'v', 'V'].includes(e.key)) ||
            (e.metaKey && ['c', 'C', 'a', 'A', 'x', 'X', 's', 'S', 'v', 'V'].includes(e.key))) {
            e.preventDefault();
            return false;
        }
    }, true);
    
    document.addEventListener('contextmenu', e => { e.preventDefault(); return false; }, true);
    document.addEventListener('selectstart', e => { e.preventDefault(); return false; }, true);
    document.addEventListener('copy', e => { e.preventDefault(); return false; }, true);
    
    // Detect automation
    if (navigator.webdriver || window.callPhantom || window._phantom || window.__nightmare) {
        document.body.innerHTML = '';
        window.location.href = 'about:blank';
        throw new Error('Access Denied');
    }
    
    // Disable console
    const noop = () => {};
    ['log', 'debug', 'info', 'warn', 'error'].forEach(m => { console[m] = noop; });
    
    // DOM elements
    let loader, checkMark, crossMark, title, message, statusMessage, progressBar;
    
    function init() {
        loader = document.getElementById('loader');
        checkMark = document.getElementById('checkMark');
        crossMark = document.getElementById('crossMark');
        title = document.getElementById('title');
        message = document.getElementById('message');
        statusMessage = document.getElementById('status-message');
        progressBar = document.getElementById('progress');
        
        const countdown = document.getElementById('countdown');
        if (countdown && countdown.parentElement) {
            countdown.parentElement.style.display = 'none';
        }
    }
    
    function showLoader() {
        if (loader) loader.style.display = 'block';
        if (checkMark) checkMark.style.display = 'none';
        if (crossMark) crossMark.style.display = 'none';
    }
    
    function showCheck() {
        if (loader) loader.style.display = 'none';
        if (checkMark) checkMark.style.display = 'block';
        if (crossMark) crossMark.style.display = 'none';
    }
    
    function showCross() {
        if (loader) loader.style.display = 'none';
        if (checkMark) checkMark.style.display = 'none';
        if (crossMark) crossMark.style.display = 'block';
    }
    
    let started = false;
    
    // ✅ UPDATED: Navigate to server redirect endpoint (/go/:sessionId)
    // Server handles shortener fetching and extraction completely invisibly
    async function verify(sessionId) {
        if (started) return;
        started = true;
        
        try {
            if (statusMessage) statusMessage.innerHTML = 'Validating...';
            
            const res = await fetch(`/api/process-session/${sessionId}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!res.ok) throw new Error('HTTP error');
            
            const data = await res.json();
            
            if (data.success && data.redirect_path) {
                showCheck();
                if (title) title.textContent = '✅ Verified';
                if (message) message.textContent = 'Redirecting...';
                if (statusMessage) statusMessage.innerHTML = '<span class="success">Success</span>';
                
                // ✅ CRITICAL: Navigate to server redirect endpoint
                // Server handles the shortener URL - NEVER visible in browser
                // User goes: /access/:id → /go/:id → server fetches shortener → final destination
                setTimeout(() => {
                    window.location.href = data.redirect_path; // Goes to /go/:sessionId
                }, 600);
                
            } else {
                showError(data.message || 'Invalid session');
            }
        } catch (err) {
            showError('Connection error');
        }
    }
    
    function showError(msg) {
        showCross();
        if (title) {
            title.textContent = '❌ Error';
            title.style.color = '#e74c3c';
        }
        if (message) {
            message.innerHTML = msg;
            message.style.color = '#e74c3c';
        }
        if (statusMessage) statusMessage.innerHTML = '<span class="error">Failed</span>';
        
        const retryBtn = document.getElementById('manualRedirect');
        if (retryBtn) {
            retryBtn.style.display = 'block';
            retryBtn.onclick = () => window.location.reload();
        }
    }
    
    // Start when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            init();
            const path = window.location.pathname;
            const sessionId = path.split('/').pop();
            
            if (sessionId && sessionId !== 'index.html' && sessionId !== '') {
                showLoader();
                setTimeout(() => verify(sessionId), 800);
            } else {
                showError('No session ID found');
            }
        });
    } else {
        init();
        const path = window.location.pathname;
        const sessionId = path.split('/').pop();
        
        if (sessionId && sessionId !== 'index.html' && sessionId !== '') {
            showLoader();
            setTimeout(() => verify(sessionId), 800);
        } else {
            showError('No session ID found');
        }
    }
    
})();
                           
