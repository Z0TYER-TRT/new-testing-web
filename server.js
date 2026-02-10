const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

console.log('Server starting...');

// Serve static files from public directory
app.use(express.static('public'));
console.log('Static files middleware loaded');

// API endpoint to process session
app.get('/api/process-session/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    console.log('API called with session:', sessionId);
    
    try {
        res.json({
            success: true,
            redirect_url: "https://example-shortener.com/abc123",
            message: 'Redirecting to destination...'
        });
    } catch (error) {
        res.json({
            success: false,
            message: 'Session not found or expired'
        });
    }
});

// Handle the /access/:sessionId route
app.get('/access/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    console.log('Access route called with session:', sessionId);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
