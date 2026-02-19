(function() {
    'use strict';

    // UI Elements
    const mainContainer = document.getElementById('mainContainer');
    const shieldWrapper = document.getElementById('shieldWrapper');
    const shieldIcon = document.getElementById('shieldIcon');
    const loaderWrapper = document.getElementById('loaderWrapper');
    const loader = document.getElementById('loader');
    const checkMark = document.getElementById('checkMark');
    const crossMark = document.getElementById('crossMark');
    const title = document.getElementById('title');
    const message = document.getElementById('message');
    const statusMessage = document.getElementById('status-message');
    const progressBar = document.getElementById('progressBar');
    const progress = document.getElementById('progress');
    const countdownEl = document.getElementById('countdown');
    const countdownBox = document.getElementById('countdownBox');

    // Session ID Extraction
    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    let sessionId = null;
    
    if (pathSegments[0] === 'access' && pathSegments[1]) {
        sessionId = pathSegments[1];
    } else if (pathSegments.length > 0) {
        sessionId = pathSegments[pathSegments.length - 1];
    }

    // Browser Detection (Lightweight)
    function detectBrowser() {
        const ua = navigator.userAgent || '';
        return {
            isAndroid: /android/i.test(ua),
            isIOS: /iphone|ipad|ipod/i.test(ua),
            isTelegram: /telegram|tgbot/i.test(ua)
        };
    }

    // UI State Functions (Fixed Layout)
    function showSuccess(msg) {
        // Hide loader
        if(loaderWrapper) loaderWrapper.style.display = 'none';
        if(loader) loader.style.display = 'none';
        
        // Hide shield
        if(shieldWrapper) shieldWrapper.style.display = 'none';
        if(shieldIcon) shieldIcon.style.display = 'none';
        
        // Show check mark in loader position
        if(checkMark) checkMark.classList.add('show');
        if(crossMark) crossMark.classList.remove('show');
        
        // Update text
        if(title) title.textContent = '✅ Access Granted';
        if(message) message.textContent = msg || 'Redirecting...';
        if(statusMessage) {
            statusMessage.textContent = 'Opening secure browser...';
            statusMessage.style.color = '#00b894';
        }
        if(countdownBox) countdownBox.style.display = 'none';
        if(mainContainer) mainContainer.classList.add('success');
    }

    function showError(msg) {
        // Hide loader
        if(loaderWrapper) loaderWrapper.style.display = 'none';
        if(loader) loader.style.display = 'none';
        
        // Hide shield
        if(shieldWrapper) shieldWrapper.style.display = 'none';
        if(shieldIcon) shieldIcon.style.display = 'none';
        
        // Show cross mark in loader position
        if(crossMark) crossMark.classList.add('show');
        if(checkMark) checkMark.classList.remove('show');
        
        // Update text
        if(title) title.textContent = '❌ Access Denied';
        if(message) message.textContent = msg || 'Error';
        if(statusMessage) {
            statusMessage.textContent = 'Please try again';
            statusMessage.style.color = '#e74c3c';
        }
        if(countdownBox) countdownBox.style.display = 'none';
        if(progressBar) progressBar.style.display = 'none';
        if(mainContainer) mainContainer.classList.add('error');
    }

    function updateStatus(msg, color) {
        if(statusMessage) {
            statusMessage.textContent = msg;
            statusMessage.style.color = color || 'rgba(255,255,255,0.5)';
        }
    }

    // Progress Animation
    function animateProgress() {
        if (!progressBar || !progress) return;
        
        progressBar.style.display = 'block';
        
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        
        if (prefersReducedMotion) {
            progress.style.width = '100%';
        } else {
            progress.style.transition = 'none';
            progress.style.width = '0%';
            void progress.offsetWidth;
            progress.style.transition = 'width 3s linear';
            progress.style.width = '100%';
        }
    }

    // Fetch Session
    async function fetchSession() {
        updateStatus('Connecting...', '#667eea');
        
        try {
            const url = `/api/process-session/${encodeURIComponent(sessionId)}`;
            
            const res = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();

            if (data.success && data.redirect_path) {
                const path = data.redirect_path;
                if (!path.startsWith('/go/')) throw new Error('Invalid path');

                showSuccess('Verification complete!');
                
                setTimeout(() => handleRedirect(path), 1200);

            } else {
                showError(data.message || 'Session invalid');
            }

        } catch (error) {
            showError('Connection failed');
            console.error('Fetch error:', error.message);
        }
    }

    // Handle Redirect
    function handleRedirect(redirectPath) {
        const host = window.location.host;
        const protocol = window.location.protocol;
        const fullUrl = `${protocol}//${host}${redirectPath}`;

        updateStatus('Opening...', '#667eea');
        
        setTimeout(() => {
            window.location.href = fullUrl;
        }, 400);
    }

    // Initialize
    function init() {
        if (!sessionId || !/^[a-zA-Z0-9-_]{1,128}$/.test(sessionId)) {
            showError('Invalid Session ID');
            return;
        }

        const browser = detectBrowser();
        console.log('Browser:', browser);

        animateProgress();
        
        let timeLeft = 3;
        if(countdownEl) countdownEl.textContent = timeLeft;
        
        const timer = setInterval(() => {
            timeLeft--;
            if(countdownEl) countdownEl.textContent = timeLeft;
            
            if (timeLeft === 2) updateStatus('Analyzing...', '#667eea');
            else if (timeLeft === 1) updateStatus('Finalizing...', '#667eea');
            
            if (timeLeft <= 0) {
                clearInterval(timer);
                if(countdownBox) countdownBox.style.display = 'none';
                updateStatus('Verifying...', '#667eea');
                fetchSession();
            }
        }, 1000);
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
