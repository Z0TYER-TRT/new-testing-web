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
    const manualBtn = document.getElementById('manualRedirect');

    // Get Session ID from URL
    const sessionId = window.location.pathname.split('/').pop();

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
            // Added AbortController for 5 second timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const res = await fetch(`/api/process-session/${sessionId}`, { 
                signal: controller.signal 
            });
            
            clearTimeout(timeoutId);
            const data = await res.json();

            if (data.success) {
                showSuccess();
                if(title) title.textContent = "Access Granted";
                if(message) message.textContent = "Redirecting...";
                
                // 3. REDIRECT LOGIC
                setTimeout(() => {
                    window.location.href = `/go/${sessionId}`; 
                }, 1000);

            } else {
                showError(data.message || 'Invalid Session');
            }

        } catch (error) {
            console.error(error);
            // If fetch failed or timed out, force redirect anyway to avoid being stuck
            console.warn("Fetch failed/timed out, forcing redirect to /go/");
            if(title) title.textContent = "Proceeding...";
            if(message) message.textContent = "Please wait...";
            setTimeout(() => {
                window.location.href = `/go/${sessionId}`; 
            }, 1000);
        }
    }

    if (sessionId && sessionId !== 'access') {
        processVerification();
    } else {
        showError("Missing Session ID");
    }

})();
