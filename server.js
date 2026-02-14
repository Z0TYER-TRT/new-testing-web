const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const compression = require('compression');
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');
const axios = require('axios');

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

app.use(helmet({ 
    contentSecurityPolicy: false,
    frameguard: false // Allow iframe embedding for seamless transition
}));

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
 * ✅ ENHANCED: Server-Side Redirect with Complete URL Hiding
 * 
 * This endpoint processes shortener links completely server-side.
 * The shortener URL is NEVER exposed to the client at any point.
 * 
 * Multiple detection methods ensure compatibility with various shortener services.
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

        // Mark as used immediately to prevent reuse
        await collection.updateOne(
            { session_id: sessionId },
            { $set: { used: true, used_at: new Date() } }
        );

        const shortenerUrl = sessionData.short_url;
        console.log(`[Invisible Redirect] 🔒 Processing: ${shortenerUrl}`);

        // ✅ STEP 1: Fetch shortener page with proper headers
        const shortenerResponse = await axios.get(shortenerUrl, {
            headers: {
                'User-Agent': req.get('User-Agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.google.com/',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none'
            },
            maxRedirects: 10,
            validateStatus: (status) => status < 500,
            timeout: 20000,
            decompress: true
        });

        let finalUrl = null;

        // ✅ METHOD 1: Check if shortener directly redirected
        if (shortenerResponse.request && shortenerResponse.request.res && 
            shortenerResponse.request.res.responseUrl && 
            shortenerResponse.request.res.responseUrl !== shortenerUrl) {
            finalUrl = shortenerResponse.request.res.responseUrl;
            console.log(`[Invisible Redirect] ✅ Method 1 (Direct Redirect): ${finalUrl}`);
        }

        // ✅ METHOD 2: Parse HTML for various redirect patterns
        if (!finalUrl && shortenerResponse.data) {
            const html = shortenerResponse.data;
            
            // Meta refresh tag
            const metaRefreshMatch = html.match(/<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["']?\d+;\s*url=([^"'>\s]+)/i);
            if (metaRefreshMatch && metaRefreshMatch[1]) {
                finalUrl = metaRefreshMatch[1];
                console.log(`[Invisible Redirect] ✅ Method 2a (Meta Refresh): ${finalUrl}`);
            }

            // JavaScript window.location patterns
            if (!finalUrl) {
                const jsPatterns = [
                    /window\.location\.href\s*=\s*["']([^"']+)["']/i,
                    /window\.location\s*=\s*["']([^"']+)["']/i,
                    /location\.href\s*=\s*["']([^"']+)["']/i,
                    /location\.replace\(["']([^"']+)["']\)/i,
                    /window\.location\.replace\(["']([^"']+)["']\)/i,
                ];
                
                for (const pattern of jsPatterns) {
                    const match = html.match(pattern);
                    if (match && match[1]) {
                        finalUrl = match[1];
                        console.log(`[Invisible Redirect] ✅ Method 2b (JS Redirect): ${finalUrl}`);
                        break;
                    }
                }
            }

            // Common shortener variable patterns
            if (!finalUrl) {
                const varPatterns = [
                    /var\s+url\s*=\s*["']([^"']+)["']/i,
                    /var\s+destination\s*=\s*["']([^"']+)["']/i,
                    /var\s+redirect_url\s*=\s*["']([^"']+)["']/i,
                    /const\s+url\s*=\s*["']([^"']+)["']/i,
                    /let\s+url\s*=\s*["']([^"']+)["']/i,
                    /"url"\s*:\s*"([^"]+)"/i,
                    /'url'\s*:\s*'([^']+)'/i,
                ];
                
                for (const pattern of varPatterns) {
                    const match = html.match(pattern);
                    if (match && match[1]) {
                        // Validate it's a proper URL
                        if (match[1].startsWith('http://') || match[1].startsWith('https://')) {
                            finalUrl = match[1];
                            console.log(`[Invisible Redirect] ✅ Method 2c (Variable): ${finalUrl}`);
                            break;
                        }
                    }
                }
            }

            // Data attributes in HTML
            if (!finalUrl) {
                const dataAttrMatch = html.match(/data-url=["']([^"']+)["']/i);
                if (dataAttrMatch && dataAttrMatch[1]) {
                    finalUrl = dataAttrMatch[1];
                    console.log(`[Invisible Redirect] ✅ Method 2d (Data Attr): ${finalUrl}`);
                }
            }
        }

        // ✅ METHOD 3: Fallback to Telegram deep link
        if (!finalUrl && sessionData.main_id && sessionData.bot_username) {
            finalUrl = `https://t.me/${sessionData.bot_username}?start=${sessionData.main_id}`;
            console.log(`[Invisible Redirect] ⚠️ Using Telegram fallback: ${finalUrl}`);
        }

        if (!finalUrl) {
            console.error(`[Invisible Redirect] ❌ All methods failed for: ${shortenerUrl}`);
            return res.status(500).send('Unable to process redirect. Please try again.');
        }

        // Validate final URL
        if (!isValidUrl(finalUrl)) {
            console.error(`[Invisible Redirect] ❌ Invalid final URL: ${finalUrl}`);
            if (sessionData.main_id && sessionData.bot_username) {
                finalUrl = `https://t.me/${sessionData.bot_username}?start=${sessionData.main_id}`;
            } else {
                return res.status(500).send('Invalid destination URL.');
            }
        }

        console.log(`[Invisible Redirect] ✅ Final destination: ${finalUrl}`);
        console.log(`[Invisible Redirect] 🔒 Shortener URL was NEVER visible to client`);

        // ✅ STEP 4: Server-side redirect (shortener URL never exposed)
        res.redirect(302, finalUrl);

    } catch (error) {
        console.error('[Invisible Redirect] ❌ Error:', error.message);
        
        // Emergency fallback to Telegram
        try {
            const shardIndex = getShardIndex(sessionId);
            const collection = await getDatabase(shardIndex);
            const sessionData = await collection.findOne({ session_id: sessionId });
            
            if (sessionData && sessionData.main_id && sessionData.bot_username) {
                const fallbackUrl = `https://t.me/${sessionData.bot_username}?start=${sessionData.main_id}`;
                console.log(`[Invisible Redirect] 🆘 Emergency fallback: ${fallbackUrl}`);
                return res.redirect(302, fallbackUrl);
            }
        } catch (fallbackError) {
            console.error('[Invisible Redirect] ❌ Fallback failed:', fallbackError.message);
        }
        
        res.status(500).send('Redirect failed. Please try again or contact support.');
    }
});

/**
 * Process Session - Returns only the server redirect path
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

        console.log(`[Session] ✅ Valid session: ${sessionId}`);
        console.log(`[Session] 🔒 Shortener URL: ${sessionData.short_url} (server-side only)`);

        // ✅ Return ONLY the server redirect path - shortener URL stays hidden
        return res.json({
            success: true,
            redirect_path: `/go/${sessionId}`,
            message: 'Session verified'
        });

    } catch (error) {
        console.error('[Session] ❌ Error:', error.message);
        res.json({ success: false, message: 'Server busy. Please click again.' });
    }
});

/**
 * Store Session - Called by bot
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

        console.log(`[Store] ✅ Session: ${session_id}`);
        console.log(`[Store] 🔒 Shortener: ${short_url} (will be processed server-side)`);
        console.log(`[Store] 📱 Return: https://t.me/${bot_username}?start=${main_id}`);
        
        res.json({ success: true, message: 'Stored' });

    } catch (error) {
        console.error('[Store] ❌ Error:', error.message);
        res.status(500).json({ success: false });
    }
});

// Static Routes
app.get('/access/:sessionId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.json({
    status: 'OK',
    active_shards: collections.filter(c => c).length,
    message: 'Invisible redirect system active - shortener URLs never exposed to clients'
}));

// 404 Handler
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Invisible Redirect Server running on port ${PORT}`);
        console.log(`🔒 Security: Shortener URLs processed server-side only`);
        console.log(`🎯 User experience: Completely seamless, no shortener exposure`);
    });
}

module.exports = app;
        
