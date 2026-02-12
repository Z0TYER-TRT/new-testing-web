const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const compression = require('compression');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 🔐 SECURITY CONFIGURATION
// ==========================================
const API_SECRET_KEY = "redirect_kawaii_secure_key_2025"; 

// 🛡️ ANTI-SCRAPER SETTINGS
const BLOCKED_USER_AGENTS = ['curl', 'wget', 'python-requests', 'scrapy', 'bot', 'crawler', 'spider'];
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_IP = 60;  // Strict limit for public endpoints

// 🗄️ DATABASE SHARDS (SCENARIO B)
// You must use 3 DIFFERENT Clusters for this to work effectively.
// If you use the same string 3 times, you get no performance benefit.
const DB_SHARDS = [
    'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/?appName=Cluster0', // Shard 1
    'mongodb+srv://redirect-kawaii2:HWoekNn54skXZ8GA@cluster1.gigfzvo.mongodb.net/?appName=Cluster1', // Shard 2 (Change this to Cluster1)
    'mongodb+srv://redirect-kawaii3:wiCwqRkusOUoSX8J@cluster2.brkkpuv.mongodb.net/?appName=Cluster2'  // Shard 3 (Change this to Cluster2)
];
// ==========================================

// Connection State Management
const clients = [null, null, null];
const collections = [null, null, null];
const connectionPromises = [null, null, null];

// ------------------------------------------------------------------
// 🛡️ SECURITY MIDDLEWARE
// ------------------------------------------------------------------

// 1. Memory-efficient Rate Limiter
const ipRequestCounts = new Map();
function rateLimiter(req, res, next) {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    // Clean up old entries periodically
    if (Math.random() < 0.05) { 
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
        console.log(`⛔ Blocked IP: ${ip} (Rate Limit Exceeded)`);
        return res.status(429).json({ success: false, message: 'Too many requests. Please wait.' });
    }
    next();
}

// 2. Anti-Bot/Scraper Guard
function botGuard(req, res, next) {
    const userAgent = (req.get('User-Agent') || '').toLowerCase();
    
    // Block no User-Agent
    if (!userAgent) return res.status(403).send('Access Denied');

    // Block known bots
    if (BLOCKED_USER_AGENTS.some(bot => userAgent.includes(bot))) {
        console.log(`🤖 Blocked Bot: ${userAgent}`);
        return res.status(403).json({ success: false, message: 'Access Denied: Automated access detected' });
    }
    next();
}

// ------------------------------------------------------------------
// 🗄️ DATABASE SHARDING LOGIC
// ------------------------------------------------------------------

// Determine which DB to use based on Session ID
function getShardIndex(sessionId) {
    if (!sessionId) return 0;
    // MD5 Hash ensures the same session ID always goes to the same database
    const hash = crypto.createHash('md5').update(sessionId).digest('hex');
    const val = parseInt(hash.substring(0, 8), 16);
    return val % DB_SHARDS.length;
}

// Connect to a specific shard
async function getDatabase(index) {
    if (collections[index]) return collections[index];
    if (connectionPromises[index]) return connectionPromises[index];

    connectionPromises[index] = (async () => {
        try {
            console.log(`🔌 Connecting to Shard #${index + 1}...`);
            const client = new MongoClient(DB_SHARDS[index], {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                maxPoolSize: 1, // Keep low for Vercel
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
            });

            await client.connect();
            const db = client.db('redirect_service');
            const col = db.collection('sessions');

            // Background index creation
            col.createIndex({ "session_id": 1 }, { unique: true }).catch(() => {});
            col.createIndex({ "created_at": 1 }, { expireAfterSeconds: 1800 }).catch(() => {});

            clients[index] = client;
            collections[index] = col;
            console.log(`✅ Shard #${index + 1} Connected`);
            return col;
        } catch (error) {
            console.error(`❌ Shard #${index + 1} Failed:`, error.message);
            connectionPromises[index] = null; // Reset on failure
            throw error;
        }
    })();

    return connectionPromises[index];
}

// Pre-warm connections (optional)
DB_SHARDS.forEach((_, i) => getDatabase(i).catch(() => {}));

// ------------------------------------------------------------------
// 🚀 SERVER CONFIG
// ------------------------------------------------------------------

app.use(compression()); // Gzip compression
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.json({ limit: '50kb' })); // Limit body size to prevent overload
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// Apply Anti-Bot Guard globally
app.use(botGuard);

// ------------------------------------------------------------------
// ⚡ OPTIMIZED ENDPOINTS
// ------------------------------------------------------------------

// 1. Process Session (Public Endpoint) -> Rate Limited
app.get('/api/process-session/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;
    
    // Input Sanitization (Alphanumeric + dashes only)
    if (!/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
        return res.json({ success: false, message: 'Invalid session format.' });
    }

    const now = new Date();

    try {
        // 1. Find correct database shard
        const shardIndex = getShardIndex(sessionId);
        const collection = await getDatabase(shardIndex);

        // 2. Atomic Check & Update (Single Query)
        const result = await collection.findOneAndUpdate(
            { session_id: sessionId, used: false },
            { $set: { used: true, used_at: now } },
            { returnDocument: 'after', includeResultMetadata: true }
        );

        const sessionData = result.value || result;

        // 3. Logic
        if (sessionData && sessionData.short_url) {
            // Check Age (15 mins)
            const ageSeconds = Math.floor((now.getTime() - new Date(sessionData.created_at).getTime()) / 1000);
            if (ageSeconds > 900) {
                return res.json({ success: false, message: 'Link expired. Please request a new one.' });
            }
            return res.json({ success: true, redirect_url: sessionData.short_url });
        }

        // 4. Error Handling (Secondary Read)
        const checkSession = await collection.findOne({ session_id: sessionId });
        if (!checkSession) return res.json({ success: false, message: 'Invalid or missing session.' });
        if (checkSession.used) return res.json({ success: false, message: 'Link already used.' });

        return res.json({ success: false, message: 'Unknown error.' });

    } catch (error) {
        console.error('Processing Error:', error.message);
        res.json({ success: false, message: 'Server busy. Please click again.' });
    }
});

// 2. Store Session (Private Endpoint) -> API Key Protected
app.post('/api/store-session', async (req, res) => {
    // Strict API Key Check
    const clientKey = req.headers['x-api-key'];
    if (clientKey !== API_SECRET_KEY) {
        return res.status(403).json({ success: false, message: 'Access Denied' });
    }

    const { session_id, short_url, user_id } = req.body;
    if (!session_id || !short_url) return res.status(400).json({ success: false });

    try {
        // 1. Find correct database shard
        const shardIndex = getShardIndex(session_id);
        const collection = await getDatabase(shardIndex);

        // 2. Save
        await collection.updateOne(
            { session_id: session_id },
            { 
                $set: { 
                    session_id, 
                    short_url, 
                    user_id, 
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
app.get('/health', (req, res) => res.json({ status: 'OK', shards_active: collections.filter(c => c !== null).length }));

// 4. 404 Handler
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

// Start Server
if (require.main === module) {
    app.listen(PORT, () => console.log(`🚀 Secure Server running on port ${PORT}`));
}

module.exports = app;
