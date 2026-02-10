// Anti-copy protection - prevent users from copying the URL
document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('keydown', function(e) {
    // Prevent common copy shortcuts
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C' || e.key === 'a' || e.key === 'A' || e.key === 'u' || e.key === 'U')) {
        e.preventDefault();
    }
});
document.addEventListener('selectstart', e => e.preventDefault());

// Get session ID from URL path (not query parameters)
const pathParts = window.location.pathname.split('/');
const sessionId = pathParts[pathParts.length - 1];
const countdownElement = document.getElementById('countdown');
const progressBar = document.querySelector('.progress');
const manualRedirectBtn = document.getElementById('manualRedirect');
const statusMessage = document.querySelector('p:nth-child(3)'); // Status message element

let countdown = 3;

// Function to redirect via server-side verification
async function redirectToDestination() {
    if (sessionId && sessionId !== 'access') {
        try {
            // Show processing message
            if (statusMessage) {
                statusMessage.innerHTML = 'Verifying your access...';
            }
            
            // Call server API to get redirect URL and verify session
            const response = await fetch(`/api/process-session/${sessionId}`);
            const data = await response.json();
            
            if (data.success && data.redirect_url) {
                // Update progress bar
                if (progressBar) {
                    progressBar.style.width = '100%';
                }
                
                // Show success message
                if (statusMessage) {
                    statusMessage.innerHTML = '<span style="color: #27ae60; font-weight: bold;">Verified! Redirecting...</span>';
                }
                
                // Redirect after a short delay to allow visual feedback
                setTimeout(() => {
                    window.location.href = data.redirect_url;
                }, 500);
            } else {
                // Show error if session invalid
                showError(data.message || 'Invalid or expired session. Please request a new link from the bot.');
            }
        } catch (error) {
            // Show error if network issue
            showError('Connection error. Please try again.');
            console.error('Redirect error:', error);
        }
    } else {
        // Show error if no session ID
        showError('No session ID provided. Please go back to the bot and try again.');
    }
}

// Function to show error messages
function showError(message) {
    const heading = document.querySelector('h1') || document.querySelector('h2');
    if (heading) {
        heading.textContent = 'Access Denied';
    }
    
    const messageElement = document.querySelector('p');
    if (messageElement) {
        messageElement.innerHTML = `${message}<br>Please contact support.`;
    }
    
    // Hide countdown and progress bar
    const countdownDisplay = document.querySelector('.countdown');
    if (countdownDisplay) {
        countdownDisplay.style.display = 'none';
    }
    
    if (progressBar) {
        progressBar.parentElement.style.display = 'none';
    }
    
    // Show manual redirect button with error message
    if (manualRedirectBtn) {
        manualRedirectBtn.style.display = 'inline-block';
        manualRedirectBtn.textContent = 'Request New Link';
        manualRedirectBtn.onclick = () => {
            alert('Please go back to the Telegram bot and request a new link.');
        };
    }
}

// Manual redirect button
if (manualRedirectBtn) {
    manualRedirectBtn.addEventListener('click', redirectToDestination);
}

// Auto redirect with countdown
if (sessionId && sessionId !== 'access') {
    // Start progress bar animation
    if (progressBar) {
        progressBar.style.width = '100%';
    }
    
    // Update countdown
    const countdownInterval = setInterval(() => {
        countdown--;
        if (countdownElement) {
            countdownElement.textContent = countdown;
        }
        
        if (countdown <= 0) {
            clearInterval(countdownInterval);
            redirectToDestination();
        }
    }, 1000);
    
    // Show status message
    if (statusMessage) {
        statusMessage.innerHTML = 'Preparing your link...';
    }
} else {
    // Hide countdown if no session ID
    const countdownDisplay = document.querySelector('.countdown');
    if (countdownDisplay) {
        countdownDisplay.style.display = 'none';
    }
    
    if (progressBar) {
        progressBar.parentElement.style.display = 'none';
    }
    
    showError('Invalid request. No session ID found.');
}

// Fallback for browsers that don't support some features
document.addEventListener('DOMContentLoaded', function() {
    // Ensure the page looks good even if JS fails
    document.body.style.backgroundColor = '#667eea';
});
