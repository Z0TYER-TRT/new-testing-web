(function() {
    'use strict';

    // UI Elements
    const loader = document.getElementById('loader');
    const checkMark = document.getElementById('checkMark');
    const crossMark = document.getElementById('crossMark');
    const title = document.getElementById('title');
    const message = document.getElementById('message');
    const statusMessage = document.getElementById('status-message');
    const progressBar = document.getElementById('progress');
    const countdownEl = document.getElementById('countdown');
    const iframe = document.getElementById('cloaked-frame');
    const manualBtn = document.getElementById('manualRedirect');

    // Get Session ID from URL
    const sessionId = window.location.pathname.split('/').pop();

    // Store the final redirect URL for the manual button
    let finalRedirectUrl = '';

    function showSuccess() {
        if(loader) loader.style.display = 'none';
        if(checkMark) checkMark.style.display = 'block';
        if(crossMark) crossMark.style.display = 'none';
    }

    function showError(msg) {
        if(loader) loader.style.display = 'none';
        if(crossMark) crossMark.style.display = 'block';
        if(checkMark) checkMark.style.display = 'none';
        if(title) title.textContent = 'Error';
        if(message) message.textContent = msg;
        if(statusMessage) statusMessage.style.display = 'none';
        
        // Show manual button on error
        if(manualBtn) {
            manualBtn.style.display = 'inline-block';
            manualBtn.textContent = "Try Manually";
        }
    }

    async function processVerification() {
        // 1. Start Animation (Reset Progress)
        if(progressBar) {
            progressBar.style.transition = 'none';
            progressBar.style.width = '0%';
            void progressBar.offsetWidth; 
            progressBar.style.transition = 'width 3s linear';
            progressBar.style.width = '100%';
        }

        // 2. Countdown Logic (3 Seconds)
        let timeLeft = 3;
        if(countdownEl) countdownEl.textContent = timeLeft;
        
        if(statusMessage) statusMessage.textContent = "Verifying integrity...";

        const timer = setInterval(() => {
            timeLeft--;
            if(countdownEl) countdownEl.textContent = timeLeft;
            
            if (timeLeft <= 0) {
                clearInterval(timer);
                fetchSession();
            }
        }, 1000);
    }

    async function fetchSession() {
        if(statusMessage) statusMessage.textContent = "Connecting to secure server...";
        
        try {
            const res = await fetch(`/api/process-session/${sessionId}`);
            const data = await res.json();

            if (data.success && data.redirect_path) {
                // ✅ CRITICAL: redirect_path is /go/:sessionId
                // The shortener URL is NEVER sent to the client!
                // Server will handle it when we load /go/:sessionId
                
                const serverRedirectPath = data.redirect_path; // e.g., /go/abc123
                finalRedirectUrl = window.location.origin + serverRedirectPath;

                showSuccess();
                if(title) title.textContent = "Access Granted";
                if(message) message.textContent = "Redirecting...";
                
                // 3. ENHANCED CLOAKING: Use iframe OR direct redirect based on browser
                setTimeout(() => {
                    // Try iframe approach first for seamless experience
                    if (iframe && canUseIframe()) {
                        // Hide verification UI
                        document.querySelector('.container').style.display = 'none';
                        
                        // Show iframe
                        iframe.style.display = 'block';
                        
                        // ✅ Load the SERVER redirect endpoint in iframe
                        // Server fetches shortener URL invisibly
                        iframe.src = serverRedirectPath;
                        
                        // Setup fallback button
                        setupManualButton(finalRedirectUrl);
                        
                        // ✅ Listen for iframe navigation to detect completion
                        // When shortener redirects to Telegram, break out of iframe
                        iframe.addEventListener('load', () => {
                            try {
                                // If iframe loads Telegram or external site, redirect parent
                                const iframeUrl = iframe.contentWindow.location.href;
                                
                                // If it's a telegram:// or t.me link, redirect parent window
                                if (iframeUrl.includes('t.me') || iframeUrl.includes('telegram')) {
                                    window.location.href = iframeUrl;
                                }
                            } catch (e) {
                                // Cross-origin error means iframe loaded external site
                                // This is expected when shortener redirects to Telegram
                                // Try to redirect parent window
                                console.log('External redirect detected, redirecting parent...');
                                
                                // After 2 seconds, if still here, show manual button
                                setTimeout(() => {
                                    if (manualBtn) {
                                        manualBtn.style.display = 'block';
                                        manualBtn.textContent = 'Click to Continue to Telegram';
                                    }
                                }, 2000);
                            }
                        });
                        
                    } else {
                        // Fallback: Direct redirect (no iframe)
                        // This still keeps shortener URL invisible!
                        window.location.href = serverRedirectPath;
                    }

                }, 1000);

            } else {
                showError(data.message || 'Invalid Session');
            }

        } catch (error) {
            console.error(error);
            showError("Connection Failed");
        }
    }

    function canUseIframe() {
        // Check if browser allows iframe embedding
        // Some mobile browsers restrict iframe usage
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        
        // On mobile, direct redirect is often better
        // On desktop, iframe provides smoother experience
        return !isMobile;
    }

    function setupManualButton(url) {
        if (manualBtn) {
            manualBtn.style.display = 'block';
            manualBtn.textContent = "Open in New Tab";
            manualBtn.onclick = () => {
                window.open(url, '_blank');
                // Also try direct navigation
                setTimeout(() => window.location.href = url, 500);
            };
            
            // Position button over iframe
            manualBtn.style.position = 'fixed';
            manualBtn.style.bottom = '20px';
            manualBtn.style.right = '20px';
            manualBtn.style.zIndex = '10000';
            manualBtn.style.display = 'none'; // Hidden initially, shown if needed
            document.body.appendChild(manualBtn);
        }
    }

    // ✅ ANTI-DEBUGGING PROTECTION
    // Prevent users from inspecting iframe src
    const antiDebug = setInterval(() => {
        if (window.outerHeight - window.innerHeight > 160 || 
            window.outerWidth - window.innerWidth > 160) {
            // DevTools detected - redirect immediately to prevent inspection
            if (finalRedirectUrl) {
                window.location.href = finalRedirectUrl;
            }
        }
    }, 500);

    // ✅ DISABLE CONTEXT MENU (prevent inspect element)
    document.addEventListener('contextmenu', e => e.preventDefault());
    
    // ✅ DISABLE KEYBOARD SHORTCUTS (F12, Ctrl+Shift+I, etc.)
    document.addEventListener('keydown', e => {
        // F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
        if (e.keyCode === 123 || 
            (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) ||
            (e.ctrlKey && e.keyCode === 85)) {
            e.preventDefault();
            return false;
        }
    });

    // Start everything if session exists
    if (sessionId && sessionId !== 'access' && sessionId !== '') {
        processVerification();
    } else {
        showError("Missing Session ID");
    }

})();
            
