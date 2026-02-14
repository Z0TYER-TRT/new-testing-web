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
        
        // Show manual button on error
        if(manualBtn) {
            manualBtn.style.display = 'inline-block';
            manualBtn.textContent = "Try Manually";
        }
    }

    async function processVerification() {
        // 1. Start Animation (Reset Progress)
        if(progressBar) {
            progressBar.style.transition = 'none'; // Disable transition for instant reset
            progressBar.style.width = '0%';
            
            // Force browser reflow so the reset registers
            void progressBar.offsetWidth; 

            // Re-enable transition and set to 100% to trigger the 3s animation
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
                if(message) message.textContent = "Redirecting...";
                
                // 3. REDIRECT LOGIC
                // Instead of an iframe, we redirect the main window to the internal /go/ path
                // This hides the actual shortener URL stored in the database.
                setTimeout(() => {
                    window.location.href = data.redirect_path; 
                }, 1000);

            } else {
                showError(data.message || 'Invalid Session');
            }

        } catch (error) {
            console.error(error);
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
