const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const compression = require('compression');
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 🔐 SECURITY CONFIGURATION
// ==========================================
const API_SECRET_KEY = "Aniketsexvideo69";

const BLOCKED_USER_AGENTS = ['curl', 'wget', 'python-requests', 'scrapy', 'bot', 'crawler', 'spider'];
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_IP = 60;

const DB_SHARDS = [
    'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/redirect_service?appName=Cluster0',
    'mongodb+srv://redirect-kawaii2:HWoekNn54skXZ8GA@cluster1.gigfzvo.mongodb.net/redirect_service?appName=Cluster1',
    'mongodb+srv://redirect-kawaii3:wiCwqRkusOUoSX8J@cluster2.brkkpuv.mongodb.net/redirect_service?appName=Cluster2'
];

// Connection State
const clients = [null, null, null];
const collections = [null, null, null];
const connectionPromises = [null, null, null];

// ==========================================
// 🛡️ SECURITY MIDDLEWARE
// ==========================================

app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
    origin: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'x-api-key']
}));

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
        console.log(`⛔ Blocked IP: ${ip} (Rate Limit)`);
        return res.status(429).json({ success: false, message: 'Too many requests. Please wait.' });
    }
    next();
}

function botGuard(req, res, next) {
    const userAgent = (req.get('User-Agent') || '').toLowerCase();
    if (!userAgent) return res.status(403).send('Access Denied');
    if (BLOCKED_USER_AGENTS.some(bot => userAgent.includes(bot))) {
        return res.status(403).json({ success: false, message: 'Access Denied: Automated access detected' });
    }
    next();
}

function isValidUrl(string) {
    try { new URL(string); return true; } catch (_) { return false; }
}

// ==========================================
// 🗄️ DATABASE LOGIC
// ==========================================

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
            console.log(`🔌 Connecting to Shard #${index + 1}...`);
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

// ==========================================
// 🧹 AUTOMATIC CLEANUP
// ==========================================

async function cleanupOldSessions() {
    console.log('🧹 Starting cleanup task...');
    const cutoffDate = new Date(Date.now() - 30 * 60 * 1000);
    for (let i = 0; i < DB_SHARDS.length; i++) {
        try {
            const col = await getDatabase(i);
            if (col) {
                const result = await col.deleteMany({ created_at: { $lt: cutoffDate } });
                if (result.deletedCount > 0) {
                    console.log(`Shard #${i + 1}: Cleaned ${result.deletedCount} sessions`);
                }
            }
        } catch (err) {
            console.error(`Shard #${i + 1} Cleanup Error:`, err.message);
        }
    }
}

setInterval(cleanupOldSessions, 5 * 60 * 1000);
DB_SHARDS.forEach((_, i) => getDatabase(i).catch(() => {}));

// ==========================================
// 🚀 SERVER CONFIG
// ==========================================

app.use(compression());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(botGuard);

// ==========================================
// ⚡ ENDPOINTS
// ==========================================

/**
 * 1. Process Session (Public) — called by the frontend JS on the /access/:sessionId page
 *
 * ✅ UPDATED: Returns both shortener URL and Telegram deep link
 * Frontend will always use shortener URL, but we provide telegram_return_url
 * for reference (in case shortener needs to know where to redirect after)
 */
app.get('/api/process-session/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;

    if (!/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
        return res.status(400).json({ success: false, message: 'Invalid session ID format.' });
    }

    const now = new Date();

    try {
        const shardIndex = getShardIndex(sessionId);
        const collection = await getDatabase(shardIndex);

        const sessionData = await collection.findOne({ session_id: sessionId });

        if (!sessionData) {
            return res.json({ success: false, message: 'Invalid or missing session. Please click the bot link again.' });
        }

        // Check age (15 min max)
        const ageSeconds = Math.floor((now.getTime() - new Date(sessionData.created_at).getTime()) / 1000);
        if (ageSeconds > 900) {
            return res.json({ success: false, message: 'Link expired. Please request a new one from the bot.' });
        }

        if (!sessionData.short_url) {
            return res.json({ success: false, message: 'Session data incomplete. Please try again.' });
        }

        // ✅ Build the Telegram deep link using stored main_id + bot_username
        let telegram_return_url = null;
        if (sessionData.main_id && sessionData.bot_username) {
            telegram_return_url = `https://t.me/${sessionData.bot_username}?start=${sessionData.main_id}`;
        }

        // Mark session as used now
        await collection.updateOne(
            { session_id: sessionId },
            { $set: { used: true, used_at: now } }
        );

        console.log(`[Process Session] ✅ session=${sessionId}, short_url=${sessionData.short_url}, telegram_return=${telegram_return_url}`);

        return res.json({
            success: true,
            // The shortener URL - THIS is what frontend redirects to
            short_url: sessionData.short_url,
            // The Telegram deep link (for reference/future use)
            telegram_return_url: telegram_return_url,
            // Main redirect URL - ALWAYS the shortener
            redirect_url: sessionData.short_url,
            // Send back bot info in case frontend needs it
            main_id: sessionData.main_id,
            bot_username: sessionData.bot_username
        });

    } catch (error) {
        console.error('Processing Error:', error.message);
        res.json({ success: false, message: 'Server busy. Please click again.' });
    }
});

/**
 * 2. Store Session (Private) — called by the Python bot
 *
 * ✅ IMPORTANT: When creating the shortener URL in your Python bot,
 * make sure the shortener's DESTINATION URL is the Telegram deep link:
 * https://t.me/your_bot?start=main_id
 * 
 * That way, after shortener completes, it automatically returns to Telegram
 */
app.post('/api/store-session', async (req, res) => {
    const clientKey = req.headers['x-api-key'];
    if (clientKey !== API_SECRET_KEY) {
        return res.status(403).json({ success: false, message: 'Access Denied' });
    }

    const { session_id, short_url, user_id, main_id, bot_username } = req.body;

    if (!session_id || !short_url) {
        return res.status(400).json({ success: false, message: 'Missing required fields: session_id, short_url' });
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(session_id)) {
        return res.status(400).json({ success: false, message: 'Invalid Session ID characters' });
    }

    if (!isValidUrl(short_url)) {
        return res.status(400).json({ success: false, message: 'Invalid URL format for short_url' });
    }

    if (main_id && !/^[a-zA-Z0-9_-]+$/.test(main_id)) {
        return res.status(400).json({ success: false, message: 'Invalid main_id format' });
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

        console.log(`[Store Session] ✅ Stored session=${session_id}, main_id=${main_id}`);
        res.json({ success: true, message: 'Stored' });

    } catch (error) {
        console.error('Storage Error:', error.message);
        res.status(500).json({ success: false });
    }
});

// 3. Static Routes
app.get('/access/:sessionId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.json({
    status: 'OK',
    active_shards: collections.filter(c => c).length
}));

// 4. 404 Handler
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
    app.listen(PORT, () => console.log(`🚀 Secure Server running on port ${PORT}`));
}

module.exports = app;
