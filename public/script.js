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
            manualBtn.onclick = () => {
                // Fallback: if API failed, try going to /go/ just in case
                window.location.href = `/go/${sessionId}`;
            };
            manualBtn.textContent = "Try Manually";
        }
    }

    async function processVerification() {
        // 1. Start Animation (Reset Progress)
        if(progressBar) {
            progressBar.style.transition = 'none';
            progressBar.style.width = '0%';
            void progressBar.offsetWidth; // Trigger reflow
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
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const res = await fetch(`/api/process-session/${sessionId}`, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            const data = await res.json();

            if (data.success && data.target_url) {
                showSuccess();
                if(title) title.textContent = "Access Granted";
                if(message) message.textContent = "Redirecting...";
                
                // REDIRECT LOGIC: Go directly to the shortener URL
                setTimeout(() => {
                    window.location.href = data.target_url;
                }, 500); // Small 0.5s delay for UI update (optional, can be 0)

            } else {
                // Session not found or expired
                showError(data.message || 'Invalid Session');
            }

        } catch (error) {
            console.error("Fetch error:", error);
            // If fetch failed, show error, but allow manual button
            showError("Connection timed out. Please try manually.");
        }
    }

    if (sessionId && sessionId !== 'access') {
        processVerification();
    } else {
        showError("Missing Session ID");
    }
})();
