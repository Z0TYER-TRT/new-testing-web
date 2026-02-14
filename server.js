const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const compression = require('compression');
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 API Key for storing sessions
const API_SECRET_KEY = "Aniketsexvideo69";

const BLOCKED_USER_AGENTS = ['curl', 'wget', 'python-requests', 'scrapy', 'bot', 'crawler', 'spider'];
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_IP = 60;

// 🗄️ Database Shards (Hardcoded as requested)
const DB_SHARDS = [
    'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/redirect_service?appName=Cluster0',
    'mongodb+srv://redirect-kawaii2:HWoekNn54skXZ8GA@cluster1.gigfzvo.mongodb.net/redirect_service?appName=Cluster1',
    'mongodb+srv://redirect-kawaii3:wiCwqRkusOUoSX8J@cluster2.brkkpuv.mongodb.net/redirect_service?appName=Cluster2'
];

const clients = [null, null, null];
const collections = [null, null, null];
const connectionPromises = [null, null, null];

// 🛡️ Security Middleware
app.use(helmet({ 
    contentSecurityPolicy: false,
    frameguard: false 
}));

app.use(cors({ origin: true, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'x-api-key'] }));

// --- RATE LIMITER ---
const ipRequestCounts = new Map();
function rateLimiter(req, res, next) {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    if (Math.random() < 0.1) {
        for (const [key, data] of ipRequestCounts) {
            if (now > data.resetTime) ipRequestCounts.delete(key);
        }
    }

    const data = ipRequestCounts.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
    if (now > data.resetTime) {
        data.count = 0;
        data.resetTime = now + RATE_LIMIT_WINDOW;
    }

    data.count++;
    ipRequestCounts.set(ip, data);

    if (data.count > MAX_REQUESTS_PER_IP) {
        return res.status(429).json({ success: false, message: 'Too many requests.' });
    }
    next();
}

// --- BOT GUARD ---
function botGuard(req, res, next) {
    const userAgent = (req.get('User-Agent') || '').toLowerCase();
    if (!userAgent) return res.status(403).send('Access Denied');
    if (BLOCKED_USER_AGENTS.some(bot => userAgent.includes(bot))) {
        return res.status(403).json({ success: false, message: 'Automated access detected' });
    }
    next();
}

// --- UTILS ---
function isValidUrl(string) {
    try { new URL(string); return true; } catch (_) { return false; }
}

function getShardIndex(sessionId) {
    if (!sessionId) return 0;
    const hash = crypto.createHash('md5').update(sessionId).digest('hex');
    return parseInt(hash.substring(0, 8), 16) % DB_SHARDS.length;
}

// --- DATABASE CONNECTION ---
async function getDatabase(index) {
    if (collections[index]) return collections[index];
    if (connectionPromises[index]) return connectionPromises[index];

    console.log(`[DB] Connecting to Shard #${index + 1}...`);

    connectionPromises[index] = (async () => {
        try {
            const client = new MongoClient(DB_SHARDS[index], {
                maxPoolSize: 1,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
            });

            await client.connect();
            const db = client.db('redirect_service');
            const col = db.collection('sessions');

            col.createIndex({ "session_id": 1 }, { unique: true }).catch(() => {});
            col.createIndex({ "created_at": 1 }, { expireAfterSeconds: 1800 }).catch(() => {});

            clients[index] = client;
            collections[index] = col;
            console.log(`[DB] ✅ Shard #${index + 1} Connected`);
            return col;
        } catch (error) {
            console.error(`[DB] ❌ Shard #${index + 1} Failed:`, error.message);
            connectionPromises[index] = null;
            throw error;
        }
    })();

    return connectionPromises[index];
}

async function cleanupOldSessions() {
    const cutoffDate = new Date(Date.now() - 30 * 60 * 1000);
    for (let i = 0; i < DB_SHARDS.length; i++) {
        try {
            const col = await getDatabase(i);
            if (col) {
                const result = await col.deleteMany({ created_at: { $lt: cutoffDate } });
                if(result.deletedCount > 0) console.log(`[DB] Cleaned ${result.deletedCount} old sessions from Shard #${i+1}`);
            }
        } catch (err) {}
    }
}

setInterval(cleanupOldSessions, 5 * 60 * 1000);
DB_SHARDS.forEach((_, i) => getDatabase(i).catch(() => {}));

app.use(compression());
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// ==========================================
// ⚡ PUBLIC ENDPOINTS (No BotGuard)
// ==========================================

// Serve Static Files
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ✅ 1. Session Validation API
app.get('/api/process-session/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;
    console.log(`[API] Process Session Request: ${sessionId}`);

    if (!/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
        console.log(`[API] Invalid Session ID format: ${sessionId}`);
        return res.json({ success: false, message: 'Invalid session ID.' });
    }

    try {
        const shardIndex = getShardIndex(sessionId);
        console.log(`[API] Looking in Shard #${shardIndex + 1}`);
        const collection = await getDatabase(shardIndex);
        
        const sessionData = await collection.findOne({ session_id: sessionId });
        console.log(`[API] DB Result found: ${!!sessionData}`);

        if (!sessionData) {
            console.log(`[API] ❌ Session not found: ${sessionId}`);
            return res.json({ success: false, message: 'Session not found.' });
        }

        const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);
        if (ageSeconds > 900) {
            console.log(`[API] ❌ Session expired: ${sessionId}`);
            return res.json({ success: false, message: 'Link expired.' });
        }

        if (!sessionData.short_url) {
            return res.json({ success: false, message: 'Session incomplete.' });
        }

        console.log(`[API] ✅ Success. Returning URL.`);
        return res.json({
            success: true,
            target_url: sessionData.short_url
        });

    } catch (error) {
        console.error('[API] Error:', error.message);
        return res.json({ success: false, message: 'Server error.' });
    }
});

// ✅ 2. The Cloaking Page Route
app.get('/go/:sessionId', rateLimiter, (req, res) => {
    const sessionId = req.params.sessionId;
    console.log(`[Page] Loading /go/${sessionId}`);
    if (!/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
        return res.status(400).send('<h1>Invalid Link</h1>');
    }
    res.sendFile(path.join(__dirname, 'public', 'go.html'));
});

// ==========================================
// 🛡️ APPLY BOT GUARD TO ALL OTHER ROUTES
// ==========================================
app.use(botGuard);

// ==========================================
// ⚡ PROTECTED ENDPOINTS
// ==========================================

// Store Session (Protected by API Key)
app.post('/api/store-session', async (req, res) => {
    const clientKey = req.headers['x-api-key'];
    console.log(`[Store] Received request. API Key Match: ${clientKey === API_SECRET_KEY}`);
    
    if (clientKey !== API_SECRET_KEY) {
        console.log(`[Store] ❌ Access Denied`);
        return res.status(403).json({ success: false, message: 'Access Denied' });
    }

    const { session_id, short_url, user_id, main_id, bot_username } = req.body;
    console.log(`[Store] Storing Session: ${session_id}, URL: ${short_url}`);

    if (!session_id || !short_url || !/^[a-zA-Z0-9-_]+$/.test(session_id) || !isValidUrl(short_url)) {
        console.log(`[Store] ❌ Invalid Data`);
        return res.status(400).json({ success: false, message: 'Invalid data' });
    }

    try {
        const shardIndex = getShardIndex(session_id);
        console.log(`[Store] Writing to Shard #${shardIndex + 1}`);
        const collection = await getDatabase(shardIndex);

        await collection.updateOne(
            { session_id: session_id },
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

        console.log(`[Store] ✅ Success: ${session_id}`);
        return res.json({ success: true });

    } catch (error) {
        console.error('[Store] Error:', error.message);
        return res.status(500).json({ success: false });
    }
});

// Front-end Routes
app.get('/access/:sessionId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.json({ status: 'OK' }));

// 404
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

module.exports = app;
