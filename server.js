const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

console.log('Server starting...');

// Middleware - Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
console.log('Static files middleware loaded');

// In-memory storage for sessions
const activeSessions = new Map();

// API endpoint - RECEIVE session data from bot
app.post('/api/store-session', (req, res) => {
    const { session_id, short_url, user_id } = req.body;
    
    console.log('Storing session:', session_id);
    
    if (!session_id || !short_url) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required fields: session_id and short_url' 
        });
    }
    
    // Store session data in memory
    activeSessions.set(session_id, {
        short_url: short_url,
        user_id: user_id || null,
        created_at: new Date(),
        used: false
    });
    
    console.log('Session stored successfully:', session_id);
    res.json({ success: true, message: 'Session stored successfully' });
});

// API endpoint - PROCESS session for redirect
app.get('/api/process-session/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    console.log('Processing session:', sessionId);
    
    try {
        const sessionData = activeSessions.get(sessionId);
        
        if (!sessionData) {
            console.log('Session not found:', sessionId);
            return res.json({
                success: false,
                message: 'Session not found or expired. Please request a new link.'
            });
        }
        
        // Check if session is already used
        if (sessionData.used) {
            console.log('Session already used:', sessionId);
            return res.json({
                success: false,
                message: 'This link has already been used. Please request a new one.'
            });
        }
        
        // Mark session as used
        sessionData.used = true;
        activeSessions.set(sessionId, sessionData);
        
        console.log('Session processed successfully:', sessionId);
        res.json({
            success: true,
            redirect_url: sessionData.short_url,
            message: 'Redirecting to destination...'
        });
    } catch (error) {
        console.error('Session processing error:', error);
        res.json({
            success: false,
            message: 'Session processing failed. Please try again.'
        });
    }
});

// SPECIFIC route for access pages - Only match valid session IDs
app.get('/access/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    console.log('Access page requested for session:', sessionId);
    
    // Check if this looks like a file extension request (static file)
    if (sessionId.includes('.') && !sessionId.match(/^[A-Za-z0-9_-]+$/)) {
        // This looks like a static file request, redirect to home or serve index
        return res.redirect('/');
    }
    
    // Serve the main HTML page
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        active_sessions: activeSessions.size
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
