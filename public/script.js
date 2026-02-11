// Anti-copy protection
console.log('=== SCRIPT LOADING ===');

document.addEventListener('contextmenu', event => {
    event.preventDefault();
});

document.addEventListener('keydown', function(e) {
    // Prevent common copy shortcuts
    if (e.ctrlKey && ['c', 'C', 'a', 'A', 'u', 'U'].includes(e.key)) {
        e.preventDefault();
    }
});

document.addEventListener('selectstart', e => {
    e.preventDefault();
});

// Get DOM elements
const pathParts = window.location.pathname.split('/');
const sessionId = pathParts[pathParts.length - 1];

const loader = document.getElementById('loader');
const checkMark = document.getElementById('checkMark');
const crossMark = document.getElementById('crossMark');
const title = document.getElementById('title');
const message = document.getElementById('message');
const countdownElement = document.getElementById('countdown');
const progressBar = document.getElementById('progress');
const manualRedirectBtn = document.getElementById('manualRedirect');
const statusMessage = document.getElementById('status-message');

let countdown = 3;

// Function to show different icons
function showLoader() {
    loader.style.display = 'block';
    checkMark.style.display = 'none';
    crossMark.style.display = 'none';
}

function showCheckMark() {
    loader.style.display = 'none';
    checkMark.style.display = 'block';
    crossMark.style.display = 'none';
}

function showCrossMark() {
    loader.style.display = 'none';
    checkMark.style.display = 'none';
    crossMark.style.display = 'block';
}

// Function to redirect via server-side verification
async function redirectToDestination() {
    console.log('=== STARTING REDIRECT PROCESS ===');
    console.log('Session ID:', sessionId);
    
    if (sessionId && sessionId !== 'access') {
        try {
            // Update UI for processing
            showLoader();
            if (statusMessage) {
                statusMessage.innerHTML = 'Verifying your access...';
            }
            
            // Show loading state
            document.body.style.cursor = 'wait';
            
            // Call server API to get redirect URL and verify session
            const response = await fetch(`/api/process-session/${sessionId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('API Response status:', response.status);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('API Response data:', data);
            
            if (data.success && data.redirect_url) {
                console.log('✅ SUCCESS: Redirecting to', data.redirect_url);
                
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
                
                // Redirect after a short delay to allow visual feedback
                setTimeout(() => {
                    console.log('WINDOW LOCATION CHANGE:', data.redirect_url);
                    window.location.href = data.redirect_url;
                }, 1500);
            } else {
                console.log('❌ API ERROR:', data.message);
                // Reset cursor
                document.body.style.cursor = 'default';
                showError(data.message || 'Invalid or expired session. Please request a new link from the bot.');
            }
        } catch (error) {
            console.error('❌ FETCH ERROR:', error);
            // Reset cursor
            document.body.style.cursor = 'default';
            showError('Connection error. Please try again. Error: ' + error.message);
        }
    } else {
        console.log('❌ INVALID SESSION ID');
        showError('No session ID provided. Please go back to the bot and try again.');
    }
}

function showError(errorMessage) {
    console.log('SHOWING ERROR:', errorMessage);
    
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
}

// Manual redirect button event listener
if (manualRedirectBtn) {
    manualRedirectBtn.addEventListener('click', redirectToDestination);
}

// Auto redirect with countdown
if (sessionId && sessionId !== 'access') {
    console.log('Starting auto-redirect countdown...');
    
    if (progressBar) {
        progressBar.style.width = '100%';
        // Animate progress bar
        setTimeout(() => {
            progressBar.style.transition = 'width 3s ease';
            progressBar.style.width = '0%';
        }, 100);
    }
    
    const countdownInterval = setInterval(() => {
        countdown--;
        if (countdownElement) {
            countdownElement.textContent = countdown;
        }
        
        if (countdown <= 0) {
            clearInterval(countdownInterval);
            console.log('Countdown finished, starting redirect...');
            redirectToDestination();
        }
    }, 1000);
    
    if (statusMessage) {
        statusMessage.innerHTML = 'Preparing your link...';
    }
} else {
    console.log('Invalid session ID, showing error');
    const countdownDisplay = document.querySelector('.countdown');
    if (countdownDisplay) {
        countdownDisplay.style.display = 'none';
    }
    
    if (progressBar && progressBar.parentElement) {
        progressBar.parentElement.style.display = 'none';
    }
    
    showError('Invalid request. No session ID found.');
}

// DOM ready event
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM fully loaded and parsed');
    document.body.style.backgroundColor = '#667eea';
    
    // Initialize with loader visible
    showLoader();
});

// Window load event
window.addEventListener('load', function() {
    console.log('Window fully loaded');
});
