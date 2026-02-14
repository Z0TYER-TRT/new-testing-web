const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const axios = require('axios');

const app = express();

// ==========================================
// 🔐 HARDCODED CONFIGURATION (NO ENV VARS)
// ==========================================
const API_SECRET_KEY = "Aniketsexvideo69";

const DB_SHARDS = [
    'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/redirect_service?appName=Cluster0',
    'mongodb+srv://redirect-kawaii2:HWoekNn54skXZ8GA@cluster1.gigfzvo.mongodb.net/redirect_service?appName=Cluster1',
    'mongodb+srv://redirect-kawaii3:wiCwqRkusOUoSX8J@cluster2.brkkpuv.mongodb.net/redirect_service?appName=Cluster2'
];

// Database cache
let dbConnections = {};

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// DATABASE CONNECTION
// ==========================================
async function getDB(sessionId) {
    const shardIndex = parseInt(sessionId.charCodeAt(0)) % DB_SHARDS.length;
    
    if (dbConnections[shardIndex]) {
        return dbConnections[shardIndex];
    }
    
    const client = new MongoClient(DB_SHARDS[shardIndex], {
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 5000
    });
    
    await client.connect();
    const db = client.db('redirect_service');
    const collection = db.collection('sessions');
    
    // Create indexes (fire and forget)
    collection.createIndex({ session_id: 1 }, { unique: true }).catch(() => {});
    collection.createIndex({ created_at: 1 }, { expireAfterSeconds: 1800 }).catch(() => {});
    
    dbConnections[shardIndex] = collection;
    return collection;
}

// ==========================================
// ROUTES
// ==========================================

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', time: Date.now() });
});

// Access page
app.get('/access/:sessionId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Process session (returns redirect path, NOT shortener URL)
app.get('/api/process-session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        if (!/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
            return res.json({ success: false, message: 'Invalid session ID' });
        }
        
        const collection = await getDB(sessionId);
        const session = await collection.findOne({ session_id: sessionId });
        
        if (!session) {
            return res.json({ success: false, message: 'Session not found' });
        }
        
        // Check age (15 minutes)
        const age = (Date.now() - new Date(session.created_at).getTime()) / 1000;
        if (age > 900) {
            return res.json({ success: false, message: 'Session expired' });
        }
        
        // Return server redirect path (shortener URL stays hidden)
        res.json({
            success: true,
            redirect_path: `/go/${sessionId}`
        });
    } catch (error) {
        console.error('[Process Session]', error.message);
        res.json({ success: false, message: 'Server error' });
    }
});

// Server-side redirect (fetches shortener URL invisibly)
app.get('/go/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        if (!/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
            return res.status(400).send('Invalid session');
        }
        
        const collection = await getDB(sessionId);
        const session = await collection.findOne({ session_id: sessionId });
        
        if (!session || !session.short_url) {
            return res.status(404).send('Session not found');
        }
        
        if (session.used) {
            return res.status(410).send('Link already used');
        }
        
        // Mark as used
        await collection.updateOne(
            { session_id: sessionId },
            { $set: { used: true, used_at: new Date() } }
        );
        
        const shortenerUrl = session.short_url;
        console.log(`[Redirect] Processing: ${shortenerUrl}`);
        
        let finalUrl = null;
        
        // Try to fetch shortener page (server-side, invisible to user)
        try {
            const response = await axios.get(shortenerUrl, {
                timeout: 7000,
                maxRedirects: 5,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                validateStatus: (status) => status < 500
            });
            
            // Method 1: Direct redirect
            if (response.request?.res?.responseUrl && response.request.res.responseUrl !== shortenerUrl) {
                finalUrl = response.request.res.responseUrl;
            }
            
            // Method 2: Parse HTML
            if (!finalUrl && response.data) {
                const html = response.data;
                
                // Meta refresh
                const metaMatch = html.match(/<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["']?\d+;\s*url=([^"'>\s]+)/i);
                if (metaMatch?.[1]) {
                    finalUrl = metaMatch[1];
                }
                
                // JavaScript redirects
                if (!finalUrl) {
                    const patterns = [
                        /window\.location\.href\s*=\s*["']([^"']+)["']/i,
                        /window\.location\s*=\s*["']([^"']+)["']/i,
                        /location\.href\s*=\s*["']([^"']+)["']/i,
                        /location\.replace\(["']([^"']+)["']\)/i
                    ];
                    
                    for (const pattern of patterns) {
                        const match = html.match(pattern);
                        if (match?.[1]) {
                            finalUrl = match[1];
                            break;
                        }
                    }
                }
                
                // Variable patterns
                if (!finalUrl) {
                    const varPatterns = [
                        /var\s+url\s*=\s*["']([^"']+)["']/i,
                        /const\s+url\s*=\s*["']([^"']+)["']/i,
                        /"url"\s*:\s*"([^"]+)"/i
                    ];
                    
                    for (const pattern of varPatterns) {
                        const match = html.match(pattern);
                        if (match?.[1]?.startsWith('http')) {
                            finalUrl = match[1];
                            break;
                        }
                    }
                }
            }
        } catch (axiosError) {
            console.error('[Redirect] Axios error:', axiosError.message);
        }
        
        // Fallback to Telegram deep link
        if (!finalUrl && session.main_id && session.bot_username) {
            finalUrl = `https://t.me/${session.bot_username}?start=${session.main_id}`;
            console.log(`[Redirect] Using Telegram fallback`);
        }
        
        if (!finalUrl) {
            return res.status(500).send('Redirect failed');
        }
        
        console.log(`[Redirect] ✅ Final: ${finalUrl}`);
        res.redirect(302, finalUrl);
        
    } catch (error) {
        console.error('[Redirect] Error:', error.message);
        
        // Emergency fallback
        try {
            const collection = await getDB(req.params.sessionId);
            const session = await collection.findOne({ session_id: req.params.sessionId });
            
            if (session?.main_id && session?.bot_username) {
                return res.redirect(302, `https://t.me/${session.bot_username}?start=${session.main_id}`);
            }
        } catch (e) {
            console.error('[Redirect] Fallback error:', e.message);
        }
        
        res.status(500).send('Server error');
    }
});

// Store session (called by bot)
app.post('/api/store-session', async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];
        
        if (apiKey !== API_SECRET_KEY) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        
        const { session_id, short_url, user_id, main_id, bot_username } = req.body;
        
        if (!session_id || !short_url) {
            return res.status(400).json({ success: false, message: 'Missing fields' });
        }
        
        if (!/^[a-zA-Z0-9-_]+$/.test(session_id)) {
            return res.status(400).json({ success: false, message: 'Invalid session ID' });
        }
        
        const collection = await getDB(session_id);
        await collection.updateOne(
            { session_id },
            {
                $set: {
                    session_id,
                    short_url,
                    user_id,
                    main_id: main_id || null,
                    bot_username: bot_username || null,
                    created_at: new Date(),
                    used: false
                }
            },
            { upsert: true }
        );
        
        console.log(`[Store] ✅ ${session_id}`);
        res.json({ success: true, message: 'Stored' });
        
    } catch (error) {
        console.error('[Store] Error:', error.message);
        res.status(500).json({ success: false, message: 'Storage error' });
    }
});

// Home page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('Not found');
});

// Export for Vercel
module.exports = app;

// Local development
if (require.main === module) {
    const PORT = 3000;
    app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
}
