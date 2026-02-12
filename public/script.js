// Enhanced anti-debugging and anti-bypass protection
(function() {
    'use strict';
    
    // Advanced anti-debugging
    const devtools = {
        open: false,
        orientation: null
    };
    
    const threshold = 160;
    
    setInterval(() => {
        if (window.outerHeight - window.innerHeight > threshold || 
            window.outerWidth - window.innerWidth > threshold) {
            if (!devtools.open) {
                devtools.open = true;
                // Disrupt page functionality
                document.body.innerHTML = '<h1>Security Error: Developer tools detected</h1>';
                setTimeout(() => {
                    window.location.href = 'about:blank';
                }, 1000);
            }
        } else {
            devtools.open = false;
        }
    }, 500);
    
    // Disable common developer tools shortcuts
    document.addEventListener('keydown', function(e) {
        // Block F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U, etc.
        if (e.keyCode === 123 || // F12
            (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) || // Ctrl+Shift+I/J
            (e.ctrlKey && e.keyCode === 85) || // Ctrl+U
            (e.ctrlKey && e.shiftKey && e.keyCode === 67) || // Ctrl+Shift+C
            (e.keyCode === 116) // F5
        ) {
            e.preventDefault();
            return false;
        }
        
        // Block common copy/cut/select shortcuts
        if ((e.ctrlKey && ['c', 'C', 'a', 'A', 'x', 'X', 's', 'S', 'v', 'V'].includes(e.key)) ||
            (e.metaKey && ['c', 'C', 'a', 'A', 'x', 'X', 's', 'S', 'v', 'V'].includes(e.key))) {
            e.preventDefault();
            return false;
        }
    });
    
    // Block right-click and context menu
    document.addEventListener('contextmenu', event => {
        event.preventDefault();
        return false;
    });
    
    // Block text selection
    document.addEventListener('selectstart', e => {
        e.preventDefault();
        return false;
    });
    
    // Block drag and drop
    document.addEventListener('dragstart', e => {
        e.preventDefault();
        return false;
    });
    
    // Additional protection against console access
    setInterval(() => {
        if (console.clear) {
            console.clear();
        }
        // Override console methods to detect usage
        const originalConsole = {...console};
        Object.keys(console).forEach(method => {
            if (typeof console[method] === 'function') {
                console[method] = function() {
                    // Detect console usage
                    document.body.innerHTML = '<h1>Security Error: Console access detected</h1>';
                    setTimeout(() => {
                        window.location.href = 'about:blank';
                    }, 500);
                };
            }
        });
    }, 1000);
    
    // Get DOM elements
    const pathParts = window.location.pathname.split('/');
    const sessionId = pathParts[pathParts.length - 1];
    
    // Delay element access until DOM is ready
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
    
    let countdown = 3;
    let countdownInterval = null;
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
    
    // Enhanced verification function with obfuscation
    async function processVerificationAndRedirect() {
        if (verificationStarted) return; // Prevent double execution
        verificationStarted = true;
        
        console.log('=== STARTING VERIFICATION PROCESS ===');
        
        if (sessionId && sessionId !== 'access') {
            try {
                // Update UI for processing
                showLoader();
                if (statusMessage) {
                    statusMessage.innerHTML = 'Verifying your access...';
                }
                
                // Show loading state
                document.body.style.cursor = 'wait';
                
                // Obfuscated API call to prevent easy inspection
                const apiUrl = btoa('/api/process-session/' + sessionId).split('').reverse().join('');
                const decodedUrl = atob(apiUrl.split('').reverse().join(''));
                
                // Add random delay to prevent timing attacks
                await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));
                
                // Call server API with additional security headers
                const response = await fetch(decodedUrl, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Verification-Token': btoa(Date.now().toString()),
                        'X-Session-Key': sessionId.slice(0, 8)
                    },
                    credentials: 'same-origin'
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.success && data.redirect_url) {
                    // Show success state
                    showCheckMark();
                    if (progressBar) {
                        progressBar.style.width = '100%';
                    }
                    
                    if (statusMessage) {
                        statusMessage.innerHTML = '<span class="success">Verified! Redirecting...</span>';
                    }
                    
                    if (title) {
                        title.textContent = '✅ Access Granted';
                    }
                    
                    if (message) {
                        message.textContent = 'You will be redirected shortly...';
                    }
                    
                    // Reset cursor
                    document.body.style.cursor = 'default';
                    
                    // Final redirect with additional security
                    setTimeout(() => {
                        // Create a form submission to mask the redirect
                        const form = document.createElement('form');
                        form.method = 'POST';
                        form.action = data.redirect_url;
                        form.style.display = 'none';
                        document.body.appendChild(form);
                        form.submit();
                    }, 2000);
                } else {
                    // Reset cursor
                    document.body.style.cursor = 'default';
                    showError(data.message || 'Invalid or expired session. Please request a new link from the bot.');
                }
            } catch (error) {
                // Reset cursor
                document.body.style.cursor = 'default';
                showError('Connection error. Please try again. Error: ' + error.message);
            }
        } else {
            showError('No session ID provided. Please go back to the bot and try again.');
        }
    }
    
    function showError(errorMessage) {
        // Show error state
        showCrossMark();
        
        if (title) {
            title.textContent = '❌ Access Denied';
            title.style.color = '#e74c3c';
        }
        
        if (message) {
            message.innerHTML = `${errorMessage}<br>Please contact support.`;
            message.style.color = '#e74c3c';
        }
        
        const countdownDisplay = document.querySelector('.countdown');
        if (countdownDisplay) {
            countdownDisplay.style.display = 'none';
        }
        
        if (progressBar && progressBar.parentElement) {
            progressBar.parentElement.style.display = 'none';
        }
        
        if (manualRedirectBtn) {
            manualRedirectBtn.style.display = 'inline-block';
            manualRedirectBtn.textContent = 'Request New Link';
            manualRedirectBtn.onclick = () => {
                alert('Please go back to the Telegram bot and request a new link.');
            };
        }
        
        if (statusMessage) {
            statusMessage.innerHTML = '<span class="error">Error occurred</span>';
        }
        
        // Clear any existing timers
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }
    
    // Manual redirect button event listener
    function setupManualRedirect() {
        if (manualRedirectBtn) {
            manualRedirectBtn.addEventListener('click', processVerificationAndRedirect);
        }
    }
    
    // MAIN FUNCTION - Auto redirect with countdown
    function startHumanVerification() {
        if (verificationStarted) return; // Prevent if already started
        
        if (sessionId && sessionId !== 'access') {
            // Update UI for verification
            if (title) {
                title.textContent = '🔗 Human Verification';
            }
            
            if (message) {
                message.textContent = 'Please wait while we verify you are human...';
            }
            
            if (statusMessage) {
                statusMessage.innerHTML = 'Verification in progress...';
            }
            
            // Initialize progress bar
            if (progressBar) {
                progressBar.style.width = '0%';
                // Animate progress bar over 3 seconds
                setTimeout(() => {
                    progressBar.style.transition = 'width 3s cubic-bezier(0.4, 0, 0.2, 1)';
                    progressBar.style.width = '100%';
                }, 100);
            }
            
            // Start the 3-second countdown
            countdownInterval = setInterval(() => {
                if (countdownElement) {
                    countdownElement.textContent = countdown;
                }
                
                countdown--;
                
                if (countdown < 0) {
                    clearInterval(countdownInterval);
                    countdownInterval = null;
                    processVerificationAndRedirect();
                }
            }, 1000);
            
        } else {
            const countdownDisplay = document.querySelector('.countdown');
            if (countdownDisplay) {
                countdownDisplay.style.display = 'none';
            }
            
            if (progressBar && progressBar.parentElement) {
                progressBar.parentElement.style.display = 'none';
            }
            
            showError('Invalid request. No session ID found.');
        }
    }
    
    // Enhanced DOM ready handling
    function domReadyHandler() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initializeApp);
        } else {
            initializeApp();
        }
    }
    
    function initializeApp() {
        try {
            // Initialize elements
            initializeElements();
            
            // Set background
            document.body.style.backgroundColor = '#667eea';
            
            // Initialize with loader visible
            showLoader();
            
            // Setup manual redirect button
            setupManualRedirect();
            
            // Start human verification after a brief delay
            setTimeout(() => {
                startHumanVerification();
            }, 800);
            
        } catch (error) {
            console.error('Initialization error:', error);
        }
    }
    
    // Start the application
    domReadyHandler();
    
    // Additional security measures
    window.onblur = function() {
        // Optionally pause verification when window loses focus
    };
    
    // Prevent frame embedding
    if (window.self !== window.top) {
        window.top.location = window.self.location;
    }
    
})();
