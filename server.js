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

// ✅ FIX: Vercel-compatible directory resolution
// Using process.cwd() ensures __dirname resolves to the root folder in both local and Vercel environments
const __dirname = process.cwd();

// ==========================================
// 🔐 CONFIGURATION
// ==========================================

// ⚠️ SECURITY WARNING: Move these to Environment Variables in Vercel Dashboard!
const API_SECRET_KEY = "Aniketsexvideo69";

const BLOCKED_USER_AGENTS = ['curl', 'wget', 'python-requests', 'scrapy', 'bot', 'crawler', 'spider'];
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_IP = 100;

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
    contentSecurityPolicy: false, // Disabled to allow iframes/embeds if needed
    frameguard: false
}));

app.use(cors({
    origin: true, // Allow all origins
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'x-api-key']
}));

// In-memory Rate Limiter
const ipRequestCounts = new Map();

function rateLimiter(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
               req.headers['x-real-ip'] ||
               req.connection.remoteAddress || 
               'unknown';
    const now = Date.now();

    // Periodic cleanup of old entries (5% chance per request)
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
        console.log(`⛔ Rate limit exceeded: ${ip}`);
        return res.status(429).json({ success: false, message: 'Too many requests. Please wait.' });
    }
    next();
}

// Simple Bot Guard
function botGuard(req, res, next) {
    const userAgent = (req.get('User-Agent') || '').toLowerCase();
    
    // Allow empty user-agent (common for some mobile views/iframe tests)
    if (!userAgent && req.path.includes('/go/')) {
        return next();
    }
    
    if (BLOCKED_USER_AGENTS.some(bot => userAgent.includes(bot))) {
        return res.status(403).json({ success: false, message: 'Access Denied' });
    }
    next();
}

function isValidUrl(string) {
    try { 
        new URL(string); 
        return true; 
    } catch (_) { 
        return false; 
    }
}

// ==========================================
// 🗄️ DATABASE LOGIC (SHARDING)
// ==========================================

function getShardIndex(sessionId) {
    if (!sessionId) return 0;
    const hash = crypto.createHash('md5').update(sessionId).digest('hex');
    return parseInt(hash.substring(0, 8), 16) % DB_SHARDS.length;
}

async function getDatabase(index) {
    // Return cached connection if available
    if (collections[index]) return collections[index];
    if (connectionPromises[index]) return connectionPromises[index];

    // Create new connection promise
    connectionPromises[index] = (async () => {
        try {
            const client = new MongoClient(DB_SHARDS[index], {
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 5000,
                socketTimeoutMS: 5000,
                maxPoolSize: 1,
                minPoolSize: 0,
                maxIdleTimeMS: 10000
            });

            await client.connect();
            const db = client.db('redirect_service');
            const col = db.collection('sessions');

            // Create indexes (fire and forget)
            col.createIndex({ "session_id": 1 }, { unique: true }).catch(() => {});
            col.createIndex({ "created_at": 1 }, { expireAfterSeconds: 1800 }).catch(() => {});

            clients[index] = client;
            collections[index] = col;
            console.log(`✅ Shard #${index + 1} connected`);
            return col;
        } catch (error) {
            console.error(`❌ Shard #${index + 1} connection failed:`, error.message);
            connectionPromises[index] = null; // Reset promise on failure
            throw error;
        }
    })();

    return connectionPromises[index];
}

// ==========================================
// 🚀 SERVER CONFIG
// ==========================================

app.use(compression());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// Apply Bot Guard specifically to session creation
app.use('/api/store-session', botGuard);

// ==========================================
// ⚡ ROUTES
// ==========================================

// 1. Main Redirect Endpoint
app.get('/go/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;

    if (!/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
        return res.status(400).send('Invalid session ID');
    }

    try {
        const shardIndex = getShardIndex(sessionId);
        const collection = await getDatabase(shardIndex);
        const sessionData = await collection.findOne({ session_id: sessionId });

        if (!sessionData || !sessionData.short_url) {
            return res.status(404).send('Session not found');
        }

        if (sessionData.used) {
            return res.status(410).send('Link already used');
        }

        // Mark as used immediately
        await collection.updateOne(
            { session_id: sessionId },
            { $set: { used: true, used_at: new Date() } }
        );

        const shortenerUrl = sessionData.short_url;
        console.log(`[Redirect] Processing: ${shortenerUrl}`);

        let finalUrl = null;

        try {
            // Fetch the short URL to resolve it
            const shortenerResponse = await axios.get(shortenerUrl, {
                headers: {
                    'User-Agent': req.get('User-Agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                maxRedirects: 5,
                timeout: 8000,
                validateStatus: (status) => status < 500
            });

            // Method 1: Check headers (Response URL after redirects)
            if (shortenerResponse.request?.res?.responseUrl && 
                shortenerResponse.request.res.responseUrl !== shortenerUrl) {
                finalUrl = shortenerResponse.request.res.responseUrl;
            }

            // Method 2: Parse HTML for JS/Meta redirects if Method 1 failed
            if (!finalUrl && shortenerResponse.data) {
                const html = shortenerResponse.data;
                
                // Meta refresh
                const metaMatch = html.match(/<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["']?\d+;\s*url=([^"'>\s]+)/i);
                if (metaMatch?.[1]) {
                    finalUrl = metaMatch[1];
                }

                // JavaScript redirects
                if (!finalUrl) {
                    const jsPatterns = [
                        /window\.location\.href\s*=\s*["']([^"']+)["']/i,
                        /window\.location\s*=\s*["']([^"']+)["']/i,
                        /location\.href\s*=\s*["']([^"']+)["']/i,
                        /location\.replace\(["']([^"']+)["']\)/i,
                    ];
                    
                    for (const pattern of jsPatterns) {
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
                        /"url"\s*:\s*"([^"]+)"/i,
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

        // Fallback to Telegram deep link if scraping failed
        if (!finalUrl && sessionData.main_id && sessionData.bot_username) {
            finalUrl = `https://t.me/${sessionData.bot_username}?start=${sessionData.main_id}`;
            console.log(`[Redirect] Using fallback: ${finalUrl}`);
        }

        if (!finalUrl || !isValidUrl(finalUrl)) {
            console.error('[Redirect] No valid URL found');
            return res.status(500).send('Redirect failed');
        }

        console.log(`[Redirect] ✅ Destination: ${finalUrl}`);
        return res.redirect(302, finalUrl);

    } catch (error) {
        console.error('[Redirect] Critical Error:', error.message);
        
        // Emergency fallback: Try fetching data one last time to redirect to Telegram
        try {
            const shardIndex = getShardIndex(sessionId);
            const collection = await getDatabase(shardIndex);
            const sessionData = await collection.findOne({ session_id: sessionId });
            
            if (sessionData?.main_id && sessionData?.bot_username) {
                const fallbackUrl = `https://t.me/${sessionData.bot_username}?start=${sessionData.main_id}`;
                return res.redirect(302, fallbackUrl);
            }
        } catch (fallbackError) {
            console.error('[Redirect] Fallback error:', fallbackError.message);
        }
        
        res.status(500).send('Service temporarily unavailable');
    }
});

// 2. Session Verification Endpoint
app.get('/api/process-session/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;

    if (!/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
        return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    try {
        const shardIndex = getShardIndex(sessionId);
        const collection = await getDatabase(shardIndex);
        const sessionData = await collection.findOne({ session_id: sessionId });

        if (!sessionData) {
            return res.json({ success: false, message: 'Session not found' });
        }

        // Check age (15 min = 900 sec)
        const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);
        if (ageSeconds > 900) {
            return res.json({ success: false, message: 'Session expired' });
        }

        if (!sessionData.short_url) {
            return res.json({ success: false, message: 'Invalid session data' });
        }

        return res.json({
            success: true,
            redirect_path: `/go/${sessionId}`,
            message: 'Session verified'
        });

    } catch (error) {
        console.error('[Session] Error:', error.message);
        res.json({ success: false, message: 'Server error' });
    }
});

// 3. Store Session Endpoint
app.post('/api/store-session', async (req, res) => {
    const clientKey = req.headers['x-api-key'];
    if (clientKey !== API_SECRET_KEY) {
        return res.status(403).json({ success: false, message: 'Access Denied' });
    }

    const { session_id, short_url, user_id, main_id, bot_username } = req.body;

    if (!session_id || !short_url) {
        return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(session_id)) {
        return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    if (!isValidUrl(short_url)) {
        return res.status(400).json({ success: false, message: 'Invalid URL' });
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

        console.log(`[Store] ✅ ${session_id}`);
        res.json({ success: true, message: 'Stored' });

    } catch (error) {
        console.error('[Store] Error:', error.message);
        res.status(500).json({ success: false, message: 'Storage error' });
    }
});

// 4. Frontend Routes
app.get('/access/:sessionId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: Date.now() }));

// 404 Handler
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

// ==========================================
// ✅ VERCEL & LOCAL EXPORT
// ==========================================

module.exports = app;

// Only listen if running locally (not on Vercel)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Server running locally on port ${PORT}`);
    });
}
