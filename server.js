const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

console.log('Server starting...');

// Serve static files with explicit routes for CSS and JS
app.get('/style.css', (req, res) => {
    console.log('Serving style.css');
    res.sendFile(path.join(__dirname, 'public', 'style.css'));
});

app.get('/script.js', (req, res) => {
    console.log('Serving script.js');
    res.sendFile(path.join(__dirname, 'public', 'script.js'));
});

// Serve other static assets (images, fonts, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

console.log('Static files middleware loaded');

// In-memory storage for sessions with cleanup
const activeSessions = new Map();

// Cleanup old sessions every 5 minutes
setInterval(() => {
    const now = Date.now();
    const expiredSessions = [];
    
    activeSessions.forEach((session, sessionId) => {
        // Remove sessions older than 1 hour
        if (now - new Date(session.created_at).getTime() > 3600000) {
            expiredSessions.push(sessionId);
        }
    });
    
    expiredSessions.forEach(sessionId => {
        activeSessions.delete(sessionId);
        console.log('Cleaned up expired session:', sessionId);
    });
    
    console.log(`Cleaned up ${expiredSessions.length} expired sessions`);
}, 300000); // 5 minutes

// API endpoint - RECEIVE session data from bot
app.post('/api/store-session', (req, res) => {
    const { session_id, short_url, user_id } = req.body;
    
    console.log('=== STORING NEW SESSION ===');
    console.log('Session ID:', session_id);
    console.log('Short URL:', short_url);
    console.log('User ID:', user_id);
    
    if (!session_id || !short_url) {
        console.log('❌ Missing required fields');
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
    
    console.log('✅ Session stored successfully:', session_id);
    console.log('Total active sessions:', activeSessions.size);
    res.json({ success: true, message: 'Session stored successfully' });
});

// API endpoint - PROCESS session for redirect
app.get('/api/process-session/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    console.log('=== PROCESSING SESSION REQUEST ===');
    console.log('Requested Session ID:', sessionId);
    console.log('Active sessions count:', activeSessions.size);
    
    try {
        // List all available session IDs for debugging
        console.log('Available session IDs:', Array.from(activeSessions.keys()).slice(0, 10)); // Show first 10
        
        const sessionData = activeSessions.get(sessionId);
        console.log('Session data found:', sessionData ? 'YES' : 'NO');
        
        if (!sessionData) {
            console.log('❌ Session not found:', sessionId);
            return res.json({
                success: false,
                message: 'Session not found or expired. Please request a new link from the bot.'
            });
        }
        
        console.log('Session details:', {
            short_url: sessionData.short_url ? sessionData.short_url.substring(0, 50) + '...' : 'NONE',
            used: sessionData.used,
            created_at: sessionData.created_at
        });
        
        // Check if session is already used
        if (sessionData.used) {
            console.log('❌ Session already used:', sessionId);
            return res.json({
                success: false,
                message: 'This link has already been used. Please request a new one from the bot.'
            });
        }
        
        // Mark session as used
        sessionData.used = true;
        activeSessions.set(sessionId, sessionData);
        
        console.log('✅ Session processed successfully:', sessionId);
        console.log('✅ Redirecting to:', sessionData.short_url.substring(0, 50) + '...');
        
        res.json({
            success: true,
            redirect_url: sessionData.short_url,
            message: 'Redirecting to destination...'
        });
    } catch (error) {
        console.error('❌ Session processing error:', error);
        res.json({
            success: false,
            message: 'Session processing failed. Please try again.'
        });
    }
});

// Access route for session pages
app.get('/access/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    console.log('=== ACCESS PAGE REQUESTED ===');
    console.log('Session ID:', sessionId);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Root route
app.get('/', (req, res) => {
    console.log('Root page requested');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        active_sessions: activeSessions.size,
        uptime: process.uptime()
    });
});

// 404 handler for any other routes
app.use((req, res) => {
    console.log('404 - Not found:', req.url);
    res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        success: false, 
        message: 'Internal server error' 
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});
