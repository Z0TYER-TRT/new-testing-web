const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const axios = require('axios');

const app = express();

// Configuration
const API_SECRET_KEY = process.env.API_SECRET_KEY || "Aniketsexvideo69";
const DB_SHARDS = [
    'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/redirect_service?appName=Cluster0',
    'mongodb+srv://redirect-kawaii2:HWoekNn54skXZ8GA@cluster1.gigfzvo.mongodb.net/redirect_service?appName=Cluster1',
    'mongodb+srv://redirect-kawaii3:wiCwqRkusOUoSX8J@cluster2.brkkpuv.mongodb.net/redirect_service?appName=Cluster2'
];

// Database cache
let dbConnections = {};

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Get database connection
async function getDB(sessionId) {
    const shardIndex = parseInt(sessionId.charCodeAt(0)) % DB_SHARDS.length;
    
    if (dbConnections[shardIndex]) {
        return dbConnections[shardIndex];
    }
    
    const client = new MongoClient(DB_SHARDS[shardIndex], {
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 5000
    });
    
    await client.connect();
    const db = client.db('redirect_service');
    const collection = db.collection('sessions');
    
    // Create indexes
    collection.createIndex({ session_id: 1 }, { unique: true }).catch(() => {});
    collection.createIndex({ created_at: 1 }, { expireAfterSeconds: 1800 }).catch(() => {});
    
    dbConnections[shardIndex] = collection;
    return collection;
}

// Routes
app.get('/health', (req, res) => {
    res.json({ status: 'OK', time: Date.now() });
});

app.get('/access/:sessionId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/process-session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const collection = await getDB(sessionId);
        const session = await collection.findOne({ session_id: sessionId });
        
        if (!session) {
            return res.json({ success: false, message: 'Session not found' });
        }
        
        const age = (Date.now() - new Date(session.created_at).getTime()) / 1000;
        if (age > 900) {
            return res.json({ success: false, message: 'Session expired' });
        }
        
        res.json({
            success: true,
            redirect_path: `/go/${sessionId}`
        });
    } catch (error) {
        res.json({ success: false, message: 'Server error' });
    }
});

app.get('/go/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const collection = await getDB(sessionId);
        const session = await collection.findOne({ session_id: sessionId });
        
        if (!session || session.used) {
            return res.status(404).send('Session not found or expired');
        }
        
        // Mark as used
        await collection.updateOne(
            { session_id: sessionId },
            { $set: { used: true, used_at: new Date() } }
        );
        
        const shortenerUrl = session.short_url;
        let finalUrl = null;
        
        // Try to fetch and extract destination
        try {
            const response = await axios.get(shortenerUrl, {
                timeout: 7000,
                maxRedirects: 5,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            // Check for redirect
            if (response.request?.res?.responseUrl !== shortenerUrl) {
                finalUrl = response.request.res.responseUrl;
            }
            
            // Parse HTML for redirect
            if (!finalUrl) {
                const html = response.data;
                const patterns = [
                    /window\.location\.href\s*=\s*["']([^"']+)["']/i,
                    /location\.href\s*=\s*["']([^"']+)["']/i,
                    /<meta[^>]*content=["']?\d+;\s*url=([^"'>\s]+)/i
                ];
                
                for (const pattern of patterns) {
                    const match = html.match(pattern);
                    if (match?.[1]) {
                        finalUrl = match[1];
                        break;
                    }
                }
            }
        } catch (err) {
            console.log('Fetch error:', err.message);
        }
        
        // Fallback to Telegram
        if (!finalUrl && session.main_id && session.bot_username) {
            finalUrl = `https://t.me/${session.bot_username}?start=${session.main_id}`;
        }
        
        if (!finalUrl) {
            return res.status(500).send('Redirect failed');
        }
        
        res.redirect(302, finalUrl);
    } catch (error) {
        res.status(500).send('Server error');
    }
});

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
        
        res.json({ success: true, message: 'Stored' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Storage error' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
    res.status(404).send('Not found');
});

// Export for Vercel
module.exports = app;

// Local server
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server on port ${PORT}`));
    }
                 
