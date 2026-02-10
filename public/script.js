// Anti-copy protection
document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C' || e.key === 'a' || e.key === 'A' || e.key === 'u' || e.key === 'U')) {
        e.preventDefault();
    }
});
document.addEventListener('selectstart', e => e.preventDefault());

// Get session ID from URL path
const pathParts = window.location.pathname.split('/');
const sessionId = pathParts[pathParts.length - 1];
const countdownElement = document.getElementById('countdown');
const progressBar = document.querySelector('.progress');
const manualRedirectBtn = document.getElementById('manualRedirect');
const statusMessage = document.querySelector('.content p:nth-child(3)');

let countdown = 3;

// Function to redirect via server-side verification
async function redirectToDestination() {
    if (sessionId && sessionId !== 'access') {
        try {
            if (statusMessage) {
                statusMessage.innerHTML = 'Verifying your access...';
            }
            
            // Call server API to get redirect URL and verify session
            const response = await fetch(`/api/process-session/${sessionId}`);
            const data = await response.json();
            
            if (data.success && data.redirect_url) {
                if (progressBar) {
                    progressBar.style.width = '100%';
                }
                
                if (statusMessage) {
                    statusMessage.innerHTML = '<span class="success">Verified! Redirecting...</span>';
                }
                
                setTimeout(() => {
                    window.location.href = data.redirect_url;
                }, 500);
            } else {
                showError(data.message || 'Invalid or expired session. Please request a new link from the bot.');
            }
        } catch (error) {
            showError('Connection error. Please try again.');
            console.error('Redirect error:', error);
        }
    } else {
        showError('No session ID provided. Please go back to the bot and try again.');
    }
}

function showError(message) {
    const heading = document.querySelector('h1') || document.querySelector('h2');
    if (heading) {
        heading.textContent = 'Access Denied';
    }
    
    const messageElement = document.querySelector('p');
    if (messageElement) {
        messageElement.innerHTML = `${message}<br>Please contact support.`;
    }
    
    const countdownDisplay = document.querySelector('.countdown');
    if (countdownDisplay) {
        countdownDisplay.style.display = 'none';
    }
    
    if (progressBar) {
        progressBar.parentElement.style.display = 'none';
    }
    
    if (manualRedirectBtn) {
        manualRedirectBtn.style.display = 'inline-block';
        manualRedirectBtn.textContent = 'Request New Link';
        manualRedirectBtn.onclick = () => {
            alert('Please go back to the Telegram bot and request a new link.');
        };
    }
}

if (manualRedirectBtn) {
    manualRedirectBtn.addEventListener('click', redirectToDestination);
}

if (sessionId && sessionId !== 'access') {
    if (progressBar) {
        progressBar.style.width = '100%';
    }
    
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
    
    if (statusMessage) {
        statusMessage.innerHTML = 'Preparing your link...';
    }
} else {
    const countdownDisplay = document.querySelector('.countdown');
    if (countdownDisplay) {
        countdownDisplay.style.display = 'none';
    }
    
    if (progressBar) {
        progressBar.parentElement.style.display = 'none';
    }
    
    showError('Invalid request. No session ID found.');
}

document.addEventListener('DOMContentLoaded', function() {
    document.body.style.backgroundColor = '#667eea';
});
