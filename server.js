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
const API_SECRET_KEY = "redirect_kawaii_secure_key_2025"; 

// 🛡️ ANTI-HACKER SETTINGS
const BLOCKED_USER_AGENTS = ['curl', 'wget', 'python-requests', 'scrapy', 'bot', 'crawler', 'spider'];
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_IP = 60;  // Limit: 60 requests/min per IP

// 🗄️ DATABASE SHARDS (SCENARIO B)
const DB_SHARDS = [
    'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/redirect_service?appName=Cluster0', // Shard 1
    'mongodb+srv://redirect-kawaii2:HWoekNn54skXZ8GA@cluster1.gigfzvo.mongodb.net/redirect_service?appName=Cluster1', // Shard 2
    'mongodb+srv://redirect-kawaii3:wiCwqRkusOUoSX8J@cluster2.brkkpuv.mongodb.net/redirect_service?appName=Cluster2'  // Shard 3
];
// ==========================================

// Connection State
const clients = [null, null, null];
const collections = [null, null, null];
const connectionPromises = [null, null, null];

// ------------------------------------------------------------------
// 🛡️ SECURITY MIDDLEWARE
// ------------------------------------------------------------------

// 1. Helmet (Secure HTTP Headers)
app.use(helmet({
    contentSecurityPolicy: false, // Disabled briefly to allow inline scripts if needed, enable if strict
}));

// 2. CORS (Cross-Origin Resource Sharing)
app.use(cors({
    origin: true, // Allow all valid origins (or set to specific domain like 'https://myapp.vercel.app')
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'x-api-key']
}));

// 3. Rate Limiter (Memory Efficient)
const ipRequestCounts = new Map();
function rateLimiter(req, res, next) {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    // Garbage collection (10% chance to run)
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

// 4. Anti-Bot/Scraper Guard
function botGuard(req, res, next) {
    const userAgent = (req.get('User-Agent') || '').toLowerCase();
    if (!userAgent) return res.status(403).send('Access Denied');
    
    if (BLOCKED_USER_AGENTS.some(bot => userAgent.includes(bot))) {
        return res.status(403).json({ success: false, message: 'Access Denied: Automated access detected' });
    }
    next();
}

// 5. Input Validator Helper
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// ------------------------------------------------------------------
// 🗄️ DATABASE LOGIC
// ------------------------------------------------------------------

function getShardIndex(sessionId) {
    if (!sessionId) return 0;
    const hash = crypto.createHash('md5').update(sessionId).digest('hex');
    const val = parseInt(hash.substring(0, 8), 16);
    return val % DB_SHARDS.length;
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

// ------------------------------------------------------------------
// 🧹 AUTOMATIC CLEANUP SYSTEM
// ------------------------------------------------------------------
async function cleanupOldSessions() {
    console.log('🧹 Starting cleanup task...');
    const cutoffDate = new Date(Date.now() - 30 * 60 * 1000); 
    
    for (let i = 0; i < DB_SHARDS.length; i++) {
        try {
            const col = await getDatabase(i);
            if (col) {
                const result = await col.deleteMany({ created_at: { $lt: cutoffDate } });
                if (result.deletedCount > 0) {
                    console.log(`Shard #${i+1}: Cleaned ${result.deletedCount} sessions`);
                }
            }
        } catch (err) {
            console.error(`Shard #${i+1} Cleanup Error:`, err.message);
        }
    }
}

setInterval(cleanupOldSessions, 5 * 60 * 1000);
DB_SHARDS.forEach((_, i) => getDatabase(i).catch(() => {}));

// ------------------------------------------------------------------
// 🚀 SERVER CONFIG
// ------------------------------------------------------------------

app.use(compression());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// Apply Security Middleware
app.use(botGuard);

// ------------------------------------------------------------------
// ⚡ ENDPOINTS
// ------------------------------------------------------------------

// 1. Process Session (Public) -> Rate Limited + Input Validated
app.get('/api/process-session/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;
    
    // STRICT VALIDATION: Only allow Alphanumeric + Dash + Underscore
    if (!/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
        return res.status(400).json({ success: false, message: 'Invalid session ID format.' });
    }

    const now = new Date();

    try {
        const shardIndex = getShardIndex(sessionId);
        const collection = await getDatabase(shardIndex);

        const result = await collection.findOneAndUpdate(
            { session_id: sessionId, used: false },
            { $set: { used: true, used_at: now } },
            { returnDocument: 'after', includeResultMetadata: true }
        );

        const sessionData = result.value || result;

        if (sessionData && sessionData.short_url) {
            const ageSeconds = Math.floor((now.getTime() - new Date(sessionData.created_at).getTime()) / 1000);
            if (ageSeconds > 900) {
                return res.json({ success: false, message: 'Link expired. Please request a new one.' });
            }
            return res.json({ success: true, redirect_url: sessionData.short_url });
        }

        const checkSession = await collection.findOne({ session_id: sessionId });
        if (!checkSession) return res.json({ success: false, message: 'Invalid or missing session.' });
        if (checkSession.used) return res.json({ success: false, message: 'Link already used.' });

        return res.json({ success: false, message: 'Unknown error.' });

    } catch (error) {
        console.error('Processing Error:', error.message);
        res.json({ success: false, message: 'Server busy. Please click again.' });
    }
});

// 2. Store Session (Private) -> API Key + Input Validated
app.post('/api/store-session', async (req, res) => {
    const clientKey = req.headers['x-api-key'];
    if (clientKey !== API_SECRET_KEY) {
        return res.status(403).json({ success: false, message: 'Access Denied' });
    }

    const { session_id, short_url, user_id } = req.body;

    // VALIDATION 1: Check existence
    if (!session_id || !short_url) {
        return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    // VALIDATION 2: Strict Session ID characters
    if (!/^[a-zA-Z0-9-_]+$/.test(session_id)) {
        return res.status(400).json({ success: false, message: 'Invalid Session ID characters' });
    }

    // VALIDATION 3: Strict URL check
    if (!isValidUrl(short_url)) {
        return res.status(400).json({ success: false, message: 'Invalid URL format' });
    }

    try {
        const shardIndex = getShardIndex(session_id);
        const collection = await getDatabase(shardIndex);

        await collection.updateOne(
            { session_id: session_id },
            { 
                $set: { 
                    session_id, short_url, user_id, 
                    created_at: new Date(), 
                    used: false 
                } 
            },
            { upsert: true }
        );

        res.json({ success: true, message: 'Stored' });
    } catch (error) {
        console.error('Storage Error:', error.message);
        res.status(500).json({ success: false });
    }
});

// 3. Static Routes
app.get('/access/:sessionId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.json({ status: 'OK', active_shards: collections.filter(c => c).length }));

// 4. 404 Handler
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
    app.listen(PORT, () => console.log(`🚀 Secure Server running on port ${PORT}`));
}

module.exports = app;
