// Enhanced anti-debugging and anti-bypass protection
(function() {
    'use strict';
    
    // --- Anti-Debugging Logic (unchanged from your snippet) ---
    const devtools = { open: false, orientation: null };
    const threshold = 160;
    
    setInterval(() => {
        if (window.outerHeight - window.innerHeight > threshold || 
            window.outerWidth - window.innerWidth > threshold) {
            if (!devtools.open) {
                devtools.open = true;
                document.body.innerHTML = '<h1>Security Error: Developer tools detected</h1>';
                setTimeout(() => { window.location.href = 'about:blank'; }, 1000);
            }
        } else {
            devtools.open = false;
        }
    }, 500);
    
    document.addEventListener('keydown', function(e) {
        if (e.keyCode === 123 || (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) || 
            (e.ctrlKey && e.keyCode === 85) || (e.ctrlKey && e.shiftKey && e.keyCode === 67) || (e.keyCode === 116)) {
            e.preventDefault(); return false;
        }
        if ((e.ctrlKey && ['c', 'C', 'a', 'A', 'x', 'X', 's', 'S', 'v', 'V'].includes(e.key)) ||
            (e.metaKey && ['c', 'C', 'a', 'A', 'x', 'X', 's', 'S', 'v', 'V'].includes(e.key))) {
            e.preventDefault(); return false;
        }
    });
    
    document.addEventListener('contextmenu', event => { event.preventDefault(); return false; });
    document.addEventListener('selectstart', e => { e.preventDefault(); return false; });
    document.addEventListener('dragstart', e => { e.preventDefault(); return false; });
    
    // --- Main Logic ---

    // Get DOM elements
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
    
    // Function to show different icons
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
    
    // ✅ NEW: Detect if user is in Telegram WebView
    function isTelegramBrowser() {
        const userAgent = navigator.userAgent || navigator.vendor || window.opera;
        // Telegram's in-app browser includes "Telegram" in user agent
        return /Telegram/i.test(userAgent);
    }
    
    // Core Verification Function
    async function processVerificationAndRedirect(sessionId) {
        if (verificationStarted) return; 
        verificationStarted = true;
        
        console.log('=== PROCESSING SERVER VERIFICATION ===');
        console.log('User Agent:', navigator.userAgent);
        console.log('Is Telegram Browser:', isTelegramBrowser());
        
        try {
            // Update UI to show we are now contacting server
            if (statusMessage) statusMessage.innerHTML = 'Validating session...';
            document.body.style.cursor = 'wait';
            
            // Call server API
            const response = await fetch(`/api/process-session/${sessionId}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const data = await response.json();
            console.log('Server response:', data);
            
            if (data.success && data.redirect_url) {
                // Success State
                showCheckMark();
                if (title) title.textContent = '✅ Access Granted';
                if (statusMessage) statusMessage.innerHTML = '<span class="success">Success!</span>';
                
                // ✅ NEW: Determine redirect URL based on browser type
                let finalRedirectUrl = data.redirect_url;
                let redirectMessage = 'Redirecting you now...';
                
                // If user is in Telegram browser and we have telegram_return_url, use that
                if (isTelegramBrowser() && data.telegram_return_url) {
                    console.log('✅ Telegram browser detected - using telegram_return_url');
                    finalRedirectUrl = data.telegram_return_url;
                    redirectMessage = 'Returning to Telegram bot...';
                } else if (isTelegramBrowser()) {
                    console.log('⚠️ Telegram browser detected but no telegram_return_url available');
                    // Fallback: still use redirect_url (shortener link)
                } else {
                    console.log('🌐 Regular browser - using redirect_url (shortener)');
                }
                
                if (message) message.textContent = redirectMessage;
                console.log('Final redirect URL:', finalRedirectUrl);
                
                // Final redirect
                setTimeout(() => {
                    window.location.href = finalRedirectUrl;
                }, 1000); // 1 second delay to see the checkmark
            } else {
                // Server returned logical error (e.g. expired)
                showError(data.message || 'Invalid session.');
            }
        } catch (error) {
            console.error('Fetch error:', error);
            showError('Connection error. Please try again.');
        }
    }
    
    function showError(errorMessage) {
        showCrossMark();
        document.body.style.cursor = 'default';
        
        if (title) {
            title.textContent = '❌ Access Denied';
            title.style.color = '#e74c3c';
        }
        
        if (message) {
            message.innerHTML = `${errorMessage}`;
            message.style.color = '#e74c3c';
        }
        
        // Hide progress UI
        if (document.querySelector('.countdown')) 
            document.querySelector('.countdown').style.display = 'none';
        if (progressBar && progressBar.parentElement) 
            progressBar.parentElement.style.display = 'none';
        
        // Show manual button
        if (manualRedirectBtn) {
            manualRedirectBtn.style.display = 'inline-block';
            manualRedirectBtn.textContent = 'Try Again';
            manualRedirectBtn.onclick = () => location.reload();
        }
        
        if (statusMessage) statusMessage.innerHTML = '<span class="error">Error</span>';
    }
    
    // Get session ID from URL
    const pathParts = window.location.pathname.split('/');
    const sessionId = pathParts[pathParts.length - 1];
    
    // Main Orchestrator
    function startSequence() {
        if (!sessionId || sessionId === 'access') {
            showError('Invalid session ID.');
            return;
        }

        console.log('Starting 3s Human Verification Timer...');
        
        // 1. Initial UI State
        if (title) title.textContent = '🔗 Human Verification';
        if (message) message.textContent = 'Verifying you are human...';
        if (statusMessage) statusMessage.innerHTML = 'Please wait...';
        
        // 2. Animate Progress Bar (Visual 3s)
        if (progressBar) {
            progressBar.style.width = '0%';
            setTimeout(() => {
                progressBar.style.transition = 'width 3s linear';
                progressBar.style.width = '100%';
            }, 100);
        }
        
        // 3. Start Countdown Logic
        let timeLeft = 3;
        if (countdownElement) countdownElement.textContent = timeLeft;
        
        const timer = setInterval(() => {
            timeLeft--;
            if (countdownElement) countdownElement.textContent = timeLeft;
            
            if (timeLeft <= 0) {
                clearInterval(timer);
                // 4. Countdown finished -> Call Server
                processVerificationAndRedirect(sessionId);
            }
        }, 1000);
    }
    
    // Initialize App
    function initializeApp() {
        try {
            initializeElements();
            document.body.style.backgroundColor = '#667eea';
            showLoader();
            
            // Start the flow
            setTimeout(startSequence, 500); // Small buffer for DOM painting
            
        } catch (error) {
            console.error('Init error:', error);
        }
    }
    
    // Bootstrapper
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeApp);
    } else {
        initializeApp();
    }
    
})();
