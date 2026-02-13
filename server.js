const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const compression = require('compression');
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');
const axios = require('axios'); // ✅ NEW: For server-side shortener fetching

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
 * ✅ NEW: Server-Side Redirect Endpoint
 * This endpoint is NEVER exposed to the client - it handles the shortener invisibly
 * 
 * Flow:
 * 1. User lands on /access/:sessionId
 * 2. Frontend calls /api/process-session/:sessionId
 * 3. Frontend receives /go/:sessionId path (NOT the shortener URL)
 * 4. Frontend redirects to /go/:sessionId
 * 5. Server fetches shortener page, extracts final URL, redirects user
 * 
 * Result: Shortener URL is NEVER visible in browser
 */
app.get('/go/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;

    if (!/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
        return res.status(400).send('Invalid session ID format.');
    }

    try {
        const shardIndex = getShardIndex(sessionId);
        const collection = await getDatabase(shardIndex);

        const sessionData = await collection.findOne({ session_id: sessionId });

        if (!sessionData || !sessionData.short_url) {
            return res.status(404).send('Session not found or expired.');
        }

        // Check if already used
        if (sessionData.used) {
            return res.status(410).send('This link has already been used.');
        }

        // Mark as used immediately
        await collection.updateOne(
            { session_id: sessionId },
            { $set: { used: true, used_at: new Date() } }
        );

        const shortenerUrl = sessionData.short_url;
        console.log(`[Server Redirect] 🔄 Fetching shortener: ${shortenerUrl}`);

        // ✅ STEP 1: Fetch the shortener page
        const shortenerResponse = await axios.get(shortenerUrl, {
            headers: {
                'User-Agent': req.get('User-Agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.google.com/',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            maxRedirects: 5,
            validateStatus: (status) => status < 400, // Accept all non-error responses
            timeout: 15000
        });

        // ✅ STEP 2: Extract the final destination URL
        let finalUrl = null;

        // Method 1: Check if shortener directly redirected (most common)
        if (shortenerResponse.request.res.responseUrl && 
            shortenerResponse.request.res.responseUrl !== shortenerUrl) {
            finalUrl = shortenerResponse.request.res.responseUrl;
        }

        // Method 2: Parse HTML for meta refresh or JavaScript redirect
        if (!finalUrl) {
            const html = shortenerResponse.data;
            
            // Look for meta refresh
            const metaRefreshMatch = html.match(/<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["']?\d+;\s*url=([^"'>\s]+)/i);
            if (metaRefreshMatch) {
                finalUrl = metaRefreshMatch[1];
            }

            // Look for window.location in JavaScript
            if (!finalUrl) {
                const jsRedirectMatch = html.match(/(?:window\.location\.href|window\.location|location\.href)\s*=\s*["']([^"']+)["']/i);
                if (jsRedirectMatch) {
                    finalUrl = jsRedirectMatch[1];
                }
            }

            // Look for common shortener patterns
            if (!finalUrl) {
                const urlPatterns = [
                    /var\s+url\s*=\s*["']([^"']+)["']/i,
                    /destination\s*=\s*["']([^"']+)["']/i,
                    /redirect_url\s*=\s*["']([^"']+)["']/i,
                ];
                
                for (const pattern of urlPatterns) {
                    const match = html.match(pattern);
                    if (match) {
                        finalUrl = match[1];
                        break;
                    }
                }
            }
        }

        // ✅ STEP 3: Fallback to Telegram deep link if extraction failed
        if (!finalUrl && sessionData.main_id && sessionData.bot_username) {
            finalUrl = `https://t.me/${sessionData.bot_username}?start=${sessionData.main_id}`;
            console.log(`[Server Redirect] ⚠️ Could not extract URL, using Telegram fallback`);
        }

        if (!finalUrl) {
            console.error(`[Server Redirect] ❌ Failed to extract destination from shortener`);
            return res.status(500).send('Unable to process redirect. Please try again.');
        }

        console.log(`[Server Redirect] ✅ Redirecting to: ${finalUrl}`);

        // ✅ STEP 4: Redirect user to final destination
        // This happens server-side, so shortener URL is NEVER visible
        res.redirect(302, finalUrl);

    } catch (error) {
        console.error('[Server Redirect] Error:', error.message);
        
        // Try to use Telegram fallback on error
        try {
            const shardIndex = getShardIndex(sessionId);
            const collection = await getDatabase(shardIndex);
            const sessionData = await collection.findOne({ session_id: sessionId });
            
            if (sessionData && sessionData.main_id && sessionData.bot_username) {
                const fallbackUrl = `https://t.me/${sessionData.bot_username}?start=${sessionData.main_id}`;
                console.log(`[Server Redirect] Using error fallback: ${fallbackUrl}`);
                return res.redirect(302, fallbackUrl);
            }
        } catch (fallbackError) {
            console.error('[Server Redirect] Fallback failed:', fallbackError.message);
        }
        
        res.status(500).send('Redirect failed. Please try again.');
    }
});

/**
 * 1. Process Session (Public) — called by the frontend JS on the /access/:sessionId page
 * 
 * ✅ UPDATED: Returns only the server redirect path (/go/:sessionId)
 * Shortener URL is NEVER sent to the client
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

        console.log(`[Process Session] ✅ session=${sessionId}, will redirect via /go/${sessionId}`);

        // ✅ CRITICAL: Return server redirect path, NOT the shortener URL
        return res.json({
            success: true,
            // This path triggers server-side redirect handling
            redirect_path: `/go/${sessionId}`,
            // For display purposes only
            message: 'Session verified'
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
 * the shortener's DESTINATION URL should be the Telegram deep link:
 * https://t.me/your_bot?start=main_id
 * 
 * This way, after our server processes the shortener, it redirects to Telegram
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
    
