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
                // Construct the full URL for the iframe
                const iframeSrc = data.redirect_path; // This is relative /go/xyz
                // Construct absolute URL for manual button
                finalRedirectUrl = window.location.origin + iframeSrc;

                // SUCCESS
                showSuccess();
                if(title) title.textContent = "Access Granted";
                if(message) message.textContent = "Redirecting...";
                
                // 3. CLOAKING MAGIC
                setTimeout(() => {
                    // Hide the verification UI
                    document.querySelector('.container').style.display = 'none';
                    
                    // Show the iframe
                    iframe.style.display = 'block';
                    
                    // Load the shortener URL inside the iframe
                    iframe.src = iframeSrc; 

                    // Setup Manual Button as a fallback (in case of iframe block)
                    if(manualBtn) {
                        manualBtn.style.display = 'block';
                        manualBtn.textContent = "Open Content in New Tab";
                        manualBtn.onclick = () => window.open(finalRedirectUrl, '_blank');
                        
                        // Move button to top right or keep it? 
                        // Let's keep it hidden by default but available if needed.
                        // For this design, we'll float it or just leave it accessible if the user goes back.
                        // Better yet, append it to body so it floats over the iframe if needed.
                        manualBtn.style.position = 'fixed';
                        manualBtn.style.bottom = '20px';
                        manualBtn.style.right = '20px';
                        manualBtn.style.zIndex = '10000';
                        document.body.appendChild(manualBtn);
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

    // Start everything if session exists
    if (sessionId && sessionId !== 'access') {
        processVerification();
    } else {
        showError("Missing Session ID");
    }

})();(function() {
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
                // Construct the full URL for the iframe
                const iframeSrc = data.redirect_path; // This is relative /go/xyz
                // Construct absolute URL for manual button
                finalRedirectUrl = window.location.origin + iframeSrc;

                // SUCCESS
                showSuccess();
                if(title) title.textContent = "Access Granted";
                if(message) message.textContent = "Redirecting...";
                
                // 3. CLOAKING MAGIC
                setTimeout(() => {
                    // Hide the verification UI
                    document.querySelector('.container').style.display = 'none';
                    
                    // Show the iframe
                    iframe.style.display = 'block';
                    
                    // Load the shortener URL inside the iframe
                    iframe.src = iframeSrc; 

                    // Setup Manual Button as a fallback (in case of iframe block)
                    if(manualBtn) {
                        manualBtn.style.display = 'block';
                        manualBtn.textContent = "Open Content in New Tab";
                        manualBtn.onclick = () => window.open(finalRedirectUrl, '_blank');
                        
                        // Move button to top right or keep it? 
                        // Let's keep it hidden by default but available if needed.
                        // For this design, we'll float it or just leave it accessible if the user goes back.
                        // Better yet, append it to body so it floats over the iframe if needed.
                        manualBtn.style.position = 'fixed';
                        manualBtn.style.bottom = '20px';
                        manualBtn.style.right = '20px';
                        manualBtn.style.zIndex = '10000';
                        document.body.appendChild(manualBtn);
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

    // Start everything if session exists
    if (sessionId && sessionId !== 'access') {
        processVerification();
    } else {
        showError("Missing Session ID");
    }

})();
