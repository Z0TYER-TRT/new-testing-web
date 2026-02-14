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

    function showSuccess() {
        if(loader) loader.style.display = 'none';
        if(checkMark) checkMark.style.display = 'block';
    }

    function showError(msg) {
        if(loader) loader.style.display = 'none';
        if(crossMark) crossMark.style.display = 'block';
        if(title) title.textContent = 'Error';
        if(message) message.textContent = msg;
        if(statusMessage) statusMessage.style.display = 'none';
    }

    async function processVerification() {
        // 1. Start Animation
        if(progressBar) {
            progressBar.style.width = '0%';
            setTimeout(() => progressBar.style.width = '100%', 100);
        }

        // 2. Countdown Logic (3 Seconds)
        let timeLeft = 3;
        const timer = setInterval(() => {
            timeLeft--;
            if(countdownEl) countdownEl.textContent = timeLeft;
            
            if (timeLeft <= 0) {
                clearInterval(timer);
                fetchSession(); // Time is up, fetch the link
            }
        }, 1000);
    }

    async function fetchSession() {
        if(statusMessage) statusMessage.textContent = "Connecting to secure server...";
        
        try {
            // Fetch from your API
            const res = await fetch(`/api/process-session/${sessionId}`);
            const data = await res.json();

            if (data.success && data.redirect_path) {
                // SUCCESS
                showSuccess();
                if(title) title.textContent = "Access Granted";
                if(message) message.textContent = "Loading content...";
                
                // 3. CLOAKING MAGIC
                // Instead of window.location.href, we set the Iframe source
                setTimeout(() => {
                    // Hide the verification UI
                    document.querySelector('.container').style.display = 'none';
                    
                    // Show the iframe
                    iframe.style.display = 'block';
                    
                    // Load the shortener URL inside the iframe
                    // The server /go/ route redirects 302, iframe follows it.
                    iframe.src = data.redirect_path; 

                    // Fallback: If iframe is blocked by the target site
                    setTimeout(() => {
                        // If the screen stays white/blank for too long, show a button
                        // This detects if X-Frame-Options blocked the load
                        // (Note: We can't strictly detect the error, so we just use a timer)
                    }, 2000);

                }, 1000);

            } else {
                showError(data.message || 'Invalid Session');
            }

        } catch (error) {
            showError("Connection Failed");
        }
    }

    // Start everything if session exists
    if (sessionId && sessionId !== 'access') {
        processVerification();
    } else {
        showError("Missing Session ID");
    }

})();
