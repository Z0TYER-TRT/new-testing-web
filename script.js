// Get the redirect URL from query parameters
const urlParams = new URLSearchParams(window.location.search);
const redirectUrl = urlParams.get('redirect');
const countdownElement = document.getElementById('countdown');
const progressBar = document.querySelector('.progress');
const manualRedirectBtn = document.getElementById('manualRedirect');

let countdown = 3;

// Function to redirect
function redirectToDestination() {
    if (redirectUrl) {
        // Update progress bar
        progressBar.style.width = '100%';
        
        // Redirect after a short delay to allow visual feedback
        setTimeout(() => {
            window.location.href = redirectUrl;
        }, 500);
    } else {
        // If no redirect URL, show error
        document.querySelector('h1').textContent = 'Invalid Request';
        document.querySelector('p').innerHTML = 'No redirect URL provided.<br>Please contact support.';
        document.querySelector('.countdown').style.display = 'none';
        progressBar.style.display = 'none';
    }
}

// Manual redirect button
if (manualRedirectBtn) {
    manualRedirectBtn.addEventListener('click', redirectToDestination);
}

// Auto redirect with countdown
if (redirectUrl) {
    // Start progress bar animation
    progressBar.style.width = '100%';
    
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
} else {
    // Hide countdown if no redirect URL
    document.querySelector('.countdown').style.display = 'none';
    progressBar.style.display = 'none';
}

// Fallback for browsers that don't support some features
document.addEventListener('DOMContentLoaded', function() {
    // Ensure the page looks good even if JS fails
    document.body.style.backgroundColor = '#667eea';
});
