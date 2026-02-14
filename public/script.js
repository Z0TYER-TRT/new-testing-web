// Ultra-secure redirect system - works with existing server
(function() {
    'use strict';
    
    // ==========================================
    // 🔒 SECURITY LAYER: Anti-Debugging
    // ==========================================
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
    
    // ==========================================
    // 🎯 MAIN LOGIC
    // ==========================================
    
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
    let hiddenUrl = null; // URL stored in memory only
    
    // ✅ Main verification function
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
            
            if (data.success && data.redirect_url) {
                
                // ✅ Store URL in memory (never display it)
                hiddenUrl = data.redirect_url;
                
                showCheck();
                if (title) title.textContent = '✅ Verified';
                if (message) message.textContent = 'Redirecting...';
                if (statusMessage) statusMessage.innerHTML = '<span class="success">Success</span>';
                
                // ✅ Clear page and redirect
                setTimeout(() => {
                    // Clear entire page (anti-screenshot)
                    document.body.innerHTML = '';
                    document.body.style.backgroundColor = '#667eea';
                    
                    // Redirect (URL appears for minimal time)
                    window.location.replace(hiddenUrl);
                }, 500); // Very short delay
                
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
        
        const pb = document.querySelector('.progress-bar');
        if (pb) pb.style.display = 'none';
        
        const btn = document.getElementById('manualRedirect');
        if (btn) {
            btn.style.display = 'inline-block';
            btn.textContent = 'Retry';
            btn.onclick = () => location.reload();
        }
    }
    
    const sessionId = window.location.pathname.split('/').pop();
    
    function start() {
        if (!sessionId || sessionId === 'access') {
            showError('Invalid session');
            return;
        }
        
        if (title) title.textContent = '🔐 Verifying';
        if (message) message.textContent = 'Please wait...';
        if (statusMessage) statusMessage.innerHTML = 'Checking...';
        
        if (progressBar) {
            progressBar.style.width = '0%';
            setTimeout(() => {
                progressBar.style.transition = 'width 0.8s linear';
                progressBar.style.width = '100%';
            }, 100);
        }
        
        // Start verification after 0.8s
        setTimeout(() => verify(sessionId), 800);
    }
    
    function bootstrap() {
        try {
            init();
            document.body.style.backgroundColor = '#667eea';
            showLoader();
            setTimeout(start, 200);
        } catch (e) {
            document.body.innerHTML = '';
            window.location.href = 'about:blank';
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
    
    // ==========================================
    // 🔒 ADDITIONAL PROTECTION
    // ==========================================
    
    // Clear clipboard
    setInterval(() => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText('').catch(() => {});
        }
    }, 1000);
    
    // Anti-iframe
    if (window.top !== window.self) {
        window.top.location = window.self.location;
    }
    
})();
