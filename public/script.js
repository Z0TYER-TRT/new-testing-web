// Ultra-secure anti-bypass protection with INVISIBLE redirect
(function() {
    'use strict';
    
    // ==========================================
    // 🔒 SECURITY LAYER 1: Anti-Debugging
    // ==========================================
    const devtools = { open: false };
    const threshold = 160;
    
    setInterval(() => {
        if (window.outerHeight - window.innerHeight > threshold || 
            window.outerWidth - window.innerWidth > threshold) {
            if (!devtools.open) {
                devtools.open = true;
                document.body.innerHTML = '';
                window.location.href = 'about:blank';
            }
        } else {
            devtools.open = false;
        }
    }, 500);
    
    // Block ALL keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if (e.keyCode === 123 || (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) || 
            (e.ctrlKey && e.keyCode === 85) || (e.ctrlKey && e.shiftKey && e.keyCode === 67) || 
            (e.keyCode === 116) || (e.keyCode === 122)) {
            e.preventDefault(); 
            e.stopPropagation();
            return false;
        }
        if ((e.ctrlKey && ['c', 'C', 'a', 'A', 'x', 'X', 's', 'S', 'v', 'V'].includes(e.key)) ||
            (e.metaKey && ['c', 'C', 'a', 'A', 'x', 'X', 's', 'S', 'v', 'V'].includes(e.key))) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }, true);
    
    document.addEventListener('contextmenu', e => { e.preventDefault(); return false; }, true);
    document.addEventListener('selectstart', e => { e.preventDefault(); return false; }, true);
    document.addEventListener('dragstart', e => { e.preventDefault(); return false; }, true);
    document.addEventListener('copy', e => { e.preventDefault(); return false; }, true);
    
    // ==========================================
    // 🔒 SECURITY LAYER 2: Anti-Bot Detection
    // ==========================================
    function detectAutomation() {
        if (navigator.webdriver) return true;
        if (window.callPhantom || window._phantom || window.__nightmare) return true;
        if (/HeadlessChrome|PhantomJS|Selenium/i.test(navigator.userAgent)) return true;
        return false;
    }
    
    if (detectAutomation()) {
        document.body.innerHTML = '';
        window.location.href = 'about:blank';
        throw new Error('Access Denied');
    }
    
    // ==========================================
    // 🔒 SECURITY LAYER 3: Hide All Logs
    // ==========================================
    const noop = () => {};
    ['log', 'debug', 'info', 'warn', 'error', 'dir', 'trace', 'table'].forEach(method => {
        console[method] = noop;
    });
    
    // ==========================================
    // 🎯 MAIN LOGIC - HIDDEN REDIRECT
    // ==========================================
    
    let loader, checkMark, crossMark, title, message, countdownElement, 
        progressBar, manualRedirectBtn, statusMessage;
    
    function initializeElements() {
        loader = document.getElementById('loader');
        checkMark = document.getElementById('checkMark');
        crossMark = document.getElementById('crossMark');
        title = document.getElementById('title');
        message = document.getElementById('message');
        countdownElement = document.getElementById('countdown');
        progressBar = document.getElementById('progress');
        manualRedirectBtn = document.getElementById('manualRedirect');
        statusMessage = document.getElementById('status-message');
    }
    
    let verificationStarted = false;
    let hiddenRedirectUrl = null; // ✅ COMPLETELY HIDDEN - Never exposed
    
    function showLoader() {
        if (loader) loader.style.display = 'block';
        if (checkMark) checkMark.style.display = 'none';
        if (crossMark) crossMark.style.display = 'none';
    }
    
    function showCheckMark() {
        if (loader) loader.style.display = 'none';
        if (checkMark) checkMark.style.display = 'block';
        if (crossMark) crossMark.style.display = 'none';
    }
    
    function showCrossMark() {
        if (loader) loader.style.display = 'none';
        if (checkMark) checkMark.style.display = 'none';
        if (crossMark) crossMark.style.display = 'block';
    }
    
    // ✅ SECURE INVISIBLE REDIRECT - URL NEVER SHOWN
    async function processVerificationAndRedirect(sessionId) {
        if (verificationStarted) return; 
        verificationStarted = true;
        
        try {
            if (statusMessage) statusMessage.innerHTML = 'Validating...';
            document.body.style.cursor = 'wait';
            
            // Fetch URL from server (stored in memory only, NEVER displayed)
            const response = await fetch(`/api/process-session/${sessionId}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const data = await response.json();
            
            if (data.success && data.redirect_url) {
                
                // ✅ ALL users (including Telegram) go through shortener
                // Store URL in closure - INACCESSIBLE from outside
                hiddenRedirectUrl = data.redirect_url;
                
                // Show success (NO URL visible anywhere)
                showCheckMark();
                if (title) title.textContent = '✅ Verified';
                if (message) message.textContent = 'Please wait...';
                if (statusMessage) statusMessage.innerHTML = '<span class="success">Access Granted</span>';
                
                // ✅ INVISIBLE INSTANT REDIRECT
                setTimeout(() => {
                    // Clear entire page (prevent screenshot/inspection)
                    document.body.innerHTML = '';
                    document.body.style.backgroundColor = '#667eea';
                    
                    // REDIRECT - URL never visible in UI
                    window.location.replace(hiddenRedirectUrl);
                    
                }, 600); // Minimal delay (just enough for success icon)
                
            } else {
                showError(data.message || 'Invalid session.');
            }
        } catch (error) {
            showError('Connection error. Try again.');
        }
    }
    
    function showError(errorMessage) {
        showCrossMark();
        document.body.style.cursor = 'default';
        
        if (title) {
            title.textContent = '❌ Error';
            title.style.color = '#e74c3c';
        }
        
        if (message) {
            message.innerHTML = errorMessage;
            message.style.color = '#e74c3c';
        }
        
        if (document.querySelector('.countdown')) 
            document.querySelector('.countdown').style.display = 'none';
        if (progressBar && progressBar.parentElement) 
            progressBar.parentElement.style.display = 'none';
        
        if (manualRedirectBtn) {
            manualRedirectBtn.style.display = 'inline-block';
            manualRedirectBtn.textContent = 'Retry';
            manualRedirectBtn.onclick = () => location.reload();
        }
        
        if (statusMessage) statusMessage.innerHTML = '<span class="error">Failed</span>';
    }
    
    const pathParts = window.location.pathname.split('/');
    const sessionId = pathParts[pathParts.length - 1];
    
    // ✅ NO COUNTDOWN - Instant verification
    function startSequence() {
        if (!sessionId || sessionId === 'access') {
            showError('Invalid session.');
            return;
        }
        
        if (title) title.textContent = '🔐 Verifying Access';
        if (message) message.textContent = 'Checking your session...';
        if (statusMessage) statusMessage.innerHTML = 'Please wait...';
        
        // HIDE countdown element completely
        if (countdownElement && countdownElement.parentElement) {
            countdownElement.parentElement.style.display = 'none';
        }
        
        // Progress bar (cosmetic only)
        if (progressBar) {
            progressBar.style.width = '0%';
            setTimeout(() => {
                progressBar.style.transition = 'width 1s linear';
                progressBar.style.width = '100%';
            }, 100);
        }
        
        // ✅ START IMMEDIATELY - No 3 second wait
        setTimeout(() => {
            processVerificationAndRedirect(sessionId);
        }, 800); // Just enough for smooth UI
    }
    
    function initializeApp() {
        try {
            initializeElements();
            document.body.style.backgroundColor = '#667eea';
            showLoader();
            
            // Clean URL bar
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, '', window.location.pathname);
            }
            
            setTimeout(startSequence, 200);
            
        } catch (error) {
            document.body.innerHTML = '';
            window.location.href = 'about:blank';
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeApp);
    } else {
        initializeApp();
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
    
    // Prevent visibility when tab hidden (anti-screenshot)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && hiddenRedirectUrl) {
            document.body.innerHTML = '<div style="background:#667eea;height:100vh;width:100vw;"></div>';
        }
    });
    
    // Prevent frame embedding (anti-iframe bypass)
    if (window.top !== window.self) {
        window.top.location = window.self.location;
    }
    
})();
