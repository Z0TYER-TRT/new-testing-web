const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const compression = require('compression');
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const API_SECRET_KEY = "Aniketsexvideo69";
const BLOCKED_USER_AGENTS = ['curl', 'wget', 'python-requests', 'scrapy', 'bot', 'crawler', 'spider'];
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_IP = 60;

const DB_SHARDS = [
    'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/redirect_service?appName=Cluster0',
    'mongodb+srv://redirect-kawaii2:HWoekNn54skXZ8GA@cluster1.gigfzvo.mongodb.net/redirect_service?appName=Cluster1',
    'mongodb+srv://redirect-kawaii3:wiCwqRkusOUoSX8J@cluster2.brkkpuv.mongodb.net/redirect_service?appName=Cluster2'
];

const clients = [null, null, null];
const collections = [null, null, null];
const connectionPromises = [null, null, null];

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'x-api-key'] }));

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

function botGuard(req, res, next) {
    const userAgent = (req.get('User-Agent') || '').toLowerCase();
    if (!userAgent) return res.status(403).send('Access Denied');
    if (BLOCKED_USER_AGENTS.some(bot => userAgent.includes(bot))) {
        return res.status(403).json({ success: false, message: 'Automated access detected' });
    }
    next();
}

function isValidUrl(string) {
    try { new URL(string); return true; } catch (_) { return false; }
}

function getShardIndex(sessionId) {
    if (!sessionId) return 0;
    const hash = crypto.createHash('md5').update(sessionId).digest('hex');
    return parseInt(hash.substring(0, 8), 16) % DB_SHARDS.length;
}

async function getDatabase(index) {
    if (collections[index]) return collections[index];
    if (connectionPromises[index]) return connectionPromises[index];

    connectionPromises[index] = (async () => {
        try {
            const client = new MongoClient(DB_SHARDS[index], {
                useNewUrlParser: true,
                useUnifiedTopology: true,
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
            console.log(`✅ Shard #${index + 1} Connected`);
            return col;
        } catch (error) {
            console.error(`❌ Shard #${index + 1} Failed:`, error.message);
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
                await col.deleteMany({ created_at: { $lt: cutoffDate } });
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
// ⚡ CRITICAL: DEFINE PUBLIC ENDPOINTS BEFORE botGuard
// ==========================================

// Static files (public directory)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ✅ Server-side redirect endpoint - MUST be BEFORE botGuard
app.get('/go/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;

    if (!/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
        return res.status(400).send('<h1>Invalid Link</h1>');
    }

    try {
        const shardIndex = getShardIndex(sessionId);
        const collection = await getDatabase(shardIndex);
        const sessionData = await collection.findOne({ session_id: sessionId });

        if (!sessionData || !sessionData.short_url) {
            console.log(`[/go] Session not found: ${sessionId}`);
            return res.status(404).send('<h1>Link Not Found</h1><p>Please try clicking the download button again.</p>');
        }

        const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);
        if (ageSeconds > 900) {
            console.log(`[/go] Session expired: ${sessionId}`);
            return res.status(410).send('<h1>Link Expired</h1><p>Please request a new link from the bot.</p>');
        }

        // Mark as used
        await collection.updateOne(
            { session_id: sessionId },
            { $set: { used: true, used_at: new Date() } }
        );

        console.log(`[/go] ✅ Redirecting ${sessionId} → ${sessionData.short_url}`);

        // ✅ SERVER-SIDE REDIRECT
        return res.redirect(302, sessionData.short_url);

    } catch (error) {
        console.error('[/go] Error:', error.message);
        return res.status(500).send('<h1>Server Error</h1><p>Please try again.</p>');
    }
});

// ✅ API endpoint to validate session - MUST be BEFORE botGuard
app.get('/api/process-session/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;

    console.log(`[API] Processing session: ${sessionId}`);

    if (!/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
        return res.json({ success: false, message: 'Invalid session ID.' });
    }

    try {
        const shardIndex = getShardIndex(sessionId);
        const collection = await getDatabase(shardIndex);
        const sessionData = await collection.findOne({ session_id: sessionId });

        if (!sessionData) {
            console.log(`[API] Session not found: ${sessionId}`);
            return res.json({ success: false, message: 'Session not found. Please try again.' });
        }

        const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);
        if (ageSeconds > 900) {
            console.log(`[API] Session expired: ${sessionId}`);
            return res.json({ success: false, message: 'Link expired.' });
        }

        if (!sessionData.short_url) {
            console.log(`[API] Session incomplete: ${sessionId}`);
            return res.json({ success: false, message: 'Session incomplete.' });
        }

        console.log(`[API] ✅ Session valid: ${sessionId}`);

        // ✅ Return success with redirect path
        return res.json({
            success: true,
            redirect_path: `/go/${sessionId}`
        });

    } catch (error) {
        console.error('[API] Error:', error.message);
        return res.json({ success: false, message: 'Server error.' });
    }
});

// ==========================================
// 🛡️ NOW APPLY botGuard TO ALL OTHER ROUTES
// ==========================================
app.use(botGuard);

// ==========================================
// ⚡ PROTECTED ENDPOINTS (AFTER botGuard)
// ==========================================

// Store session endpoint (protected by API key)
app.post('/api/store-session', async (req, res) => {
    const clientKey = req.headers['x-api-key'];
    if (clientKey !== API_SECRET_KEY) {
        console.log('[Store] ❌ Invalid API key');
        return res.status(403).json({ success: false, message: 'Access Denied' });
    }

    const { session_id, short_url, user_id, main_id, bot_username } = req.body;

    console.log(`[Store] Received: session=${session_id}, main_id=${main_id}, bot=${bot_username}`);

    if (!session_id || !short_url) {
        return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(session_id) || !isValidUrl(short_url)) {
        return res.status(400).json({ success: false, message: 'Invalid data' });
    }

    try {
        const shardIndex = getShardIndex(session_id);
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

        console.log(`[Store] ✅ Stored session=${session_id}`);
        return res.json({ success: true });

    } catch (error) {
        console.error('[Store] Error:', error.message);
        return res.status(500).json({ success: false });
    }
});

// Static routes
app.get('/access/:sessionId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.json({ status: 'OK', shards: collections.filter(c => c).length }));

// 404 Handler
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

module.exports = app;
