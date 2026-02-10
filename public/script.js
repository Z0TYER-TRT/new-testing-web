console.log('External JavaScript loaded successfully!');

// Simple test function
function testFunction() {
    console.log('Test function executed!');
}

// Run test on load
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM fully loaded and parsed');
    testFunction();
});
