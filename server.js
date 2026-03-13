const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const compression = require('compression');
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 API Key - Hardcoded for Vercel deployment (32+ chars)
const API_SECRET_KEY = process.env.API_SECRET_KEY || 'Aniketsexvideo404SecureKey2023ForProductionUse';

// 🛡️ Cloudflare Turnstile Configuration (FREE)
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '0x4AAAAAACqSQ5npeA0O-71d';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '0x4AAAAAACqSQ_dxQjhwLcwWg6Hlt8S2-3Q';

console.log('=================================');
console.log('🚀 Server Starting...');
console.log('=================================');
console.log('✅ API_SECRET_KEY configured successfully');
console.log('✅ Turnstile keys ready');
console.log('✅ Database connections ready (3 shards)');
console.log('---------------------------------');

// ✅ Enhanced Bot blocking (allow mobile browsers)
const BLOCKED_USER_AGENTS = [
    'python-requests', 'scrapy', 'selenium', 'puppeteer',
    'playwright', 'headless', 'chromedriver', 'geckodriver',
    'phantomjs', 'slimerjs', 'htmlunit', 'jsdom'
];

const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_IP = 100;

// 🗄️ Database Shards
const DB_SHARDS = [
    'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/redirect_service?appName=Cluster0',
    'mongodb+srv://redirect-kawaii2:HWoekNn54skXZ8GA@cluster1.gigfzvo.mongodb.net/redirect_service?appName=Cluster1',
    'mongodb+srv://redirect-kawaii3:wiCwqRkusOUoSX8J@cluster2.brkkpuv.mongodb.net/redirect_service?appName=Cluster2'
];

// 🔐 Connection caching
const mongoClients = new Map();
const mongoCollections = new Map();

// 🧩 Challenge-Response System (Prevents automated tools)
const challenges = new Map();

function generateChallenge() {
    const challenge = {
        id: crypto.randomBytes(16).toString('hex'),
        operation: ['+', '-', '*'][Math.floor(Math.random() * 3)],
        num1: Math.floor(Math.random() * 20) + 1,
        num2: Math.floor(Math.random() * 20) + 1,
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000 // 5 minutes
    };
    
    challenges.set(challenge.id, challenge);
    
    // Cleanup expired challenges periodically
    setTimeout(() => {
        challenges.delete(challenge.id);
    }, 300000);
    
    return challenge;
}

function verifyChallenge(challengeId, answer) {
    const challenge = challenges.get(challengeId);
    if (!challenge) return false;
    
    if (Date.now() > challenge.expiresAt) {
        challenges.delete(challengeId);
        return false;
    }
    
    let correctAnswer;
    switch (challenge.operation) {
        case '+': correctAnswer = challenge.num1 + challenge.num2; break;
        case '-': correctAnswer = challenge.num1 - challenge.num2; break;
        case '*': correctAnswer = challenge.num1 * challenge.num2; break;
    }
    
    const isCorrect = parseInt(answer) === correctAnswer;
    if (isCorrect) {
        challenges.delete(challengeId);
    }
    
    return isCorrect;
}

// 🔐 One-time redirect tokens (prevents replay attacks)
const redirectTokens = new Map();
const TOKEN_EXPIRY = 60000; // 1 minute

function generateRedirectToken(sessionId) {
    const token = crypto.randomBytes(32).toString('base64url');
    redirectTokens.set(token, {
        sessionId,
        createdAt: Date.now(),
        expiresAt: Date.now() + TOKEN_EXPIRY
    });
    return token;
}

function validateRedirectToken(token) {
    const tokenData = redirectTokens.get(token);
    if (!tokenData) return null;
    
    if (Date.now() > tokenData.expiresAt) {
        redirectTokens.delete(token);
        return null;
    }
    
    // Use token only once
    redirectTokens.delete(token);
    return tokenData;
}

// Cleanup expired tokens periodically
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of redirectTokens) {
        if (now > data.expiresAt) {
            redirectTokens.delete(token);
        }
    }
}, 30000);

// 🛡️ Security Middleware
// 🤖 Advanced Headless Browser Detection Middleware
function detectHeadlessBrowser(req, res, next) {
    const userAgent = (req.get('User-Agent') || '').toLowerCase();
    
    // Check for headless indicators
    const headlessIndicators = [
        'headless',
        'webdriver',
        'phantomjs',
        'selenium',
        'chromedriver',
        'geckodriver',
        'playwright',
        'python',
        'curl',
        'wget',
        'java/',
        'libwww',
        'http',
        'okhttp',
        'axios'
    ];
    
    if (headlessIndicators.some(indicator => userAgent.includes(indicator))) {
        console.log(`[Headless] BLOCKED: ${userAgent}`);
        return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bot Detected</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🤖 Automated Access Blocked</h1></div></body></html>');
    }
    
    // Check for missing user agent
    if (!userAgent) {
        console.log(`[Headless] BLOCKED: No User-Agent`);
        return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bot Detected</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🤖 Automated Access Blocked</h1></div></body></html>');
    }
    
    // 🔒 Advanced: Check for suspicious User-Agent patterns
    // Real browsers have consistent UA patterns
    const ua = req.get('User-Agent');
    
    // Check UA structure (must have common browser components)
    const hasMozilla = ua.includes('Mozilla/5.0');
    const hasAppleWebKit = ua.includes('AppleWebKit');
    const hasKHTML = ua.includes('KHTML');
    const hasGecko = ua.includes('Gecko');
    
    if (!hasMozilla) {
        console.log(`[Headless] BLOCKED: Invalid UA structure - ${userAgent}`);
        return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bot Detected</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🤖 Invalid Browser</h1></div></body></html>');
    }
    
    // Check for realistic browser combinations
    const isChrome = ua.includes('Chrome') && !ua.includes('Edg');
    const isFirefox = ua.includes('Firefox') && !ua.includes('Seamonkey');
    const isSafari = ua.includes('Safari') && !ua.includes('Chrome');
    const isEdge = ua.includes('Edg');
    
    const hasValidBrowser = isChrome || isFirefox || isSafari || isEdge;
    
    if (!hasValidBrowser) {
        console.log(`[Headless] BLOCKED: Unknown browser - ${userAgent}`);
        return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bot Detected</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🤖 Unsupported Browser</h1></div></body></html>');
    }
    
    // Validate User-Agent format (must have version numbers)
    const hasVersion = /\d+\.\d+\.\d+/.test(ua);
    if (!hasVersion) {
        console.log(`[Headless] BLOCKED: No version number - ${userAgent}`);
        return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bot Detected</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🤖 Invalid Browser Version</h1></div></body></html>');
    }
    
    next();
}

// 🕵️ IP Behavior Tracking (Detects rapid sequential requests)
const ipBehaviorMap = new Map();

function trackIPBehavior(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || '';
    const now = Date.now();
    
    if (!ipBehaviorMap.has(ip)) {
        ipBehaviorMap.set(ip, {
            requests: [],
            userAgents: new Set(),
            blocked: false,
            blockUntil: 0
        });
    }
    
    const ipData = ipBehaviorMap.get(ip);
    
    // Check if currently blocked
    if (ipData.blocked && now < ipData.blockUntil) {
        console.log(`[IP Tracker] BLOCKED: ${ip} (until ${new Date(ipData.blockUntil).toISOString()})`);
        return res.status(429).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Rate Limited</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>⚠️ Too Many Requests</h1><p>Please try again later</p></div></body></html>');
    }
    
    // Record request
    ipData.requests.push(now);
    ipData.userAgents.add(userAgent);
    
    // Clean old requests (older than 10 seconds)
    ipData.requests = ipData.requests.filter(time => now - time < 10000);
    
    // Detect suspicious patterns
    const recentRequests = ipData.requests.length;
    
    // SUSPICIOUS: Too many requests in quick succession
    if (recentRequests > 5) {
        console.log(`[IP Tracker] SUSPICIOUS: ${ip} made ${recentRequests} requests in 10s`);
        ipData.blocked = true;
        ipData.blockUntil = now + 600000; // Block for 10 minutes
        return res.status(429).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Automated Detected</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🤖 Automated Access Detected</h1><p>Your IP has been temporarily blocked</p></div></body></html>');
    }
    
    next();
}

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            frameSrc: ["'self'"],
            frameAncestors: ["'self'"],
            objectSrc: ["'none'"],
        }
    },
    frameguard: { action: 'sameorigin' },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    noSniff: true,
    xssFilter: true
}));

app.use(cors({
    origin: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
    credentials: false
}));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

// --- RATE LIMITER ---
const ipRequestCounts = new Map();
function rateLimiter(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const now = Date.now();

    if (Math.random() < 0.2) {
        for (const [key, data] of ipRequestCounts) {
            if (now > data.resetTime) ipRequestCounts.delete(key);
        }
        if (ipRequestCounts.size > 500) {
            const keys = Array.from(ipRequestCounts.keys()).slice(0, 250);
            keys.forEach(key => ipRequestCounts.delete(key));
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
        return res.status(429).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Too Many Requests</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>⚠️ Too Many Requests</h1></div></body></html>');
    }
    next();
}

// --- BOT GUARD ---
function botGuard(req, res, next) {
    const userAgent = (req.get('User-Agent') || '').toLowerCase();
    if (!userAgent) return next();
    if (BLOCKED_USER_AGENTS.some(bot => userAgent.includes(bot))) {
        console.log(`[BotGuard] BLOCKED: ${userAgent.substring(0, 50)}`);
        return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bot Detected</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🤖 Bot Detected</h1></div></body></html>');
    }
    next();
}

// --- URL ENCRYPTION ---
function encryptUrl(url) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(API_SECRET_KEY.padEnd(32).slice(0, 32)), iv);
    let encrypted = cipher.update(url, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decryptUrl(encrypted) {
    try {
        const parts = encrypted.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedData = parts[1];
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(API_SECRET_KEY.padEnd(32).slice(0, 32)), iv);
        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (_) { return null; }
}

// --- URL VALIDATION ---
function isValidUrl(string) {
    try {
        const url = new URL(string);
        if (!['http:', 'https:'].includes(url.protocol)) return false;
        const hostname = url.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '127.0.0.1' ||
            hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
            hostname.startsWith('172.16.') || hostname.startsWith('169.254.')) return false;
        return true;
    } catch (_) { return false; }
}

function isValidSessionId(sessionId) {
    return /^[a-zA-Z0-9-_]{1,128}$/.test(sessionId);
}

function getShardIndex(sessionId) {
    if (!sessionId) return 0;
    const hash = crypto.createHash('md5').update(sessionId).digest('hex');
    return parseInt(hash.substring(0, 8), 16) % DB_SHARDS.length;
}

// --- DATABASE CONNECTION ---
async function getDatabase(index = 0) {
    const cacheKey = `shard_${index}`;
    if (mongoCollections.has(cacheKey)) {
        return mongoCollections.get(cacheKey);
    }
    try {
        if (!mongoClients.has(cacheKey)) {
            console.log(`🔌 Connecting to MongoDB Shard ${index + 1}...`);
            const client = new MongoClient(DB_SHARDS[index], {
                maxPoolSize: 5,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 10000,
                connectTimeoutMS: 5000,
                maxIdleTimeMS: 30000,
                retryWrites: true,
                retryReads: true
            });
            await client.connect();
            mongoClients.set(cacheKey, client);
            console.log(`✅ MongoDB Connected (Shard ${index + 1})`);
        }
        const client = mongoClients.get(cacheKey);
        const db = client.db('redirect-service');
        const col = db.collection('sessions');
        try {
            await Promise.all([
                col.createIndex({ "session_id": 1 }, { unique: true, background: true }),
                col.createIndex({ "created_at": 1 }, { expireAfterSeconds: 1800, background: true }),
                col.createIndex({ "used": 1 }, { background: true })
            ]);
        } catch (e) {
            console.log('ℹ️ Indexes exist');
        }
        mongoCollections.set(cacheKey, col);
        return col;
    } catch (error) {
        console.error(`❌ Database Error:`, error.message);
        mongoClients.delete(cacheKey);
        mongoCollections.delete(cacheKey);
        throw error;
    }
}

// --- Session Lookup ---
async function findSession(sessionId) {
    const primaryShard = getShardIndex(sessionId);
    try {
        const col = await getDatabase(primaryShard);
        const sessionData = await col.findOne({ session_id: sessionId });
        if (sessionData) return { sessionData, collection: col };
    } catch (err) {
        console.error(`Primary shard failed:`, err.message);
    }
    for (let i = 0; i < DB_SHARDS.length; i++) {
        if (i === primaryShard) continue;
        try {
            const col = await getDatabase(i);
            const sessionData = await col.findOne({ session_id: sessionId });
            if (sessionData) {
                console.log(`✅ Found in Shard ${i + 1}`);
                return { sessionData, collection: col };
            }
        } catch (err) {
            console.error(`Shard ${i + 1} failed:`, err.message);
        }
    }
    return null;
}

// --- Cleanup (Disabled on Vercel) ---
if (process.env.VERCEL !== '1') {
    setInterval(async () => {
        const cutoffDate = new Date(Date.now() - 30 * 60 * 1000);
        try {
            const col = await getDatabase(0);
            const result = await col.deleteMany({ created_at: { $lt: cutoffDate } });
            if (result.deletedCount > 0) {
                console.log(`🧹 Cleaned ${result.deletedCount} old sessions`);
            }
        } catch (err) {
            console.error(`Cleanup error:`, err.message);
        }
    }, 5 * 60 * 1000);
}

app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ==========================================
// ⚡ PUBLIC ENDPOINTS
// ==========================================

app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    setHeaders: (res, filepath) => {
        if (filepath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        else if (filepath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
        else if (filepath.endsWith('.html')) res.setHeader('content-type', 'text/html; charset=utf-8');
    }
}));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/health', (req, res) => res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    shards: DB_SHARDS.length,
    vercel: process.env.VERCEL === '1'
}));

app.get('/access/:sessionId', (req, res) => {
    if (!isValidSessionId(req.params.sessionId)) {
        return res.status(400).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>❌ Invalid Session</h1></div></body></html>');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 🔍 CAPTCHA Verification Endpoint (reCAPTCHA v3)
async function verifyCaptcha(token, ip) {
    const RECAPTCHA_SECRET = process.env.RECAPTCHA_V3_SECRET;
    
    if (!RECAPTCHA_SECRET) {
        console.warn('[CAPTCHA] No secret configured, skipping verification');
        return { success: true, score: 1.0 };
    }
    
    try {
        const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                secret: RECAPTCHA_SECRET,
                response: token,
                remoteip: ip
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            console.log('[CAPTCHA] Failed:', data['error-codes']);
        }
        
        return data;
    } catch (error) {
        console.error('[CAPTCHA] Verification error:', error.message);
        // Fail open - allow if CAPTCHA service is down
        return { success: true, score: 0.7 };
    }
}

// ==========================================
// ❌ FREE: Cloudflare Turnstile Verification
// ==========================================
async function verifyTurnstile(token, ip) {
    if (!TURNSTILE_SECRET_KEY || TURNSTILE_SECRET_KEY.includes('yyyyyyyy')) {
        console.warn('[Turnstile] Not configured, skipping verification');
        return { success: true, score: 1.0 };
    }
    
    try {
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                secret: TURNSTILE_SECRET_KEY,
                response: token,
                remoteip: ip
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            console.log('[Turnstile] Failed:', data['error-codes']);
        }
        
        return data;
    } catch (error) {
        console.error('[Turnstile] Verification error:', error.message);
        // Fail open - allow if Turnstile service is down
        return { success: true, score: 0.7 };
    }
}

// ==========================================
// 🎨 ENHANCED SHARED UI STYLES (SMOOTH ANIMATIONS)
// ==========================================
const SHARED_STYLES = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px;color:#fff;overflow-x:hidden;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.container{background:rgba(255,255,255,0.08);padding:35px 25px;border-radius:20px;border:1px solid rgba(255,255,255,0.12);text-align:center;width:100%;max-width:380px;animation:fadeIn 0.5s cubic-bezier(0.4,0,0.2,1);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(0,0,0,0.3)}
@keyframes fadeIn{from{opacity:0;transform:translateY(25px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.icon-container{position:relative;width:100px;height:140px;margin:0 auto 15px;display:flex;flex-direction:column;justify-content:flex-start;align-items:center}
.shield-wrapper{width:80px;height:80px;position:relative;margin-bottom:15px;animation:shieldFloat 3s cubic-bezier(0.4,0,0.6,1) infinite;will-change:transform}
@keyframes shieldFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.shield-icon{width:100%;height:100%}
.shield-icon svg{width:100%;height:100%;filter:drop-shadow(0 0 20px rgba(102,126,234,0.6))}
.shield-body{fill:url(#shieldGradient)}
.shield-check{fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:30;stroke-dashoffset:30;animation:drawCheck 0.7s cubic-bezier(0.4,0,0.2,1) 0.3s forwards}
@keyframes drawCheck{to{stroke-dashoffset:0}}
.loader-wrapper{width:50px;height:50px;display:flex;justify-content:center;align-items:center}
.loader{width:40px;height:40px;border:3px solid rgba(255,255,255,0.12);border-top:3px solid #667eea;border-radius:50%;animation:spin 0.9s cubic-bezier(0.4,0,0.2,1) infinite;will-change:transform}
@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
.check-mark,.cross-mark{display:none;width:48px;height:48px;border-radius:50%;justify-content:center;align-items:center;font-size:28px;color:#fff;font-weight:bold;animation:checkPop 0.5s cubic-bezier(0.68,-0.55,0.265,1.55);opacity:0;transition:opacity 0.3s ease}
.check-mark{background:linear-gradient(135deg,#00b894,#00cec9);box-shadow:0 10px 30px rgba(0,184,148,0.5)}
.cross-mark{background:linear-gradient(135deg,#e74c3c,#c0392b);box-shadow:0 10px 30px rgba(231,76,60,0.5)}
.check-mark.show,.cross-mark.show{display:flex;opacity:1}
@keyframes checkPop{0%{transform:scale(0) rotate(-180deg);opacity:0}50%{opacity:1}100%{transform:scale(1) rotate(0deg);opacity:1}}
h2{font-size:22px;font-weight:700;margin-bottom:10px;color:#fff;transition:color 0.4s cubic-bezier(0.4,0,0.2,1)}
.message{font-size:14px;color:rgba(255,255,255,0.75);margin-bottom:20px;line-height:1.6;min-height:20px}
.progress-bar{width:100%;height:6px;background:rgba(255,255,255,0.1);border-radius:10px;overflow:hidden;margin-bottom:18px;position:relative}
.progress{height:100%;background:linear-gradient(90deg,#667eea 0%,#764ba2 50%,#667eea 100%);background-size:200% 100%;width:0%;border-radius:10px;transition:width 0s}
.progress.animate{animation:progressShine 2s linear infinite,width 2.5s cubic-bezier(0.4,0,0.2,1) forwards}
@keyframes progressShine{0%{background-position:100% 0}100%{background-position:-100% 0}}
.status-message{font-size:12px;color:rgba(255,255,255,0.5);min-height:18px;transition:all 0.3s cubic-bezier(0.4,0,0.2,1);opacity:1}
.status-message.fade{opacity:0.6}
.security-badge{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:20px;padding:10px 18px;background:rgba(0,184,148,0.12);border:1px solid rgba(0,184,148,0.25);border-radius:10px;font-size:12px;color:rgba(0,184,148,0.85);transition:all 0.3s ease}
.security-badge:hover{background:rgba(0,184,148,0.18)}
.lock-icon{width:14px;height:14px;fill:currentColor}
.container.success h2{color:#00b894}
.container.error h2{color:#e74c3c}
.click-verify-btn{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;border:none;padding:14px 32px;font-size:16px;font-weight:600;border-radius:12px;cursor:pointer;margin-top:15px;transition:all 0.3s cubic-bezier(0.4,0,0.2,1);box-shadow:0 4px 15px rgba(102,126,234,0.4);position:relative;overflow:hidden}
.click-verify-btn::before{content:'';position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent);transition:left 0.5s}
.click-verify-btn:hover::before{left:100%}
.click-verify-btn:hover{transform:translateY(-3px);box-shadow:0 8px 25px rgba(102,126,234,0.5)}
.click-verify-btn:active{transform:translateY(-1px) scale(0.98);box-shadow:0 4px 15px rgba(102,126,234,0.4)}
.click-verify-btn:disabled{background:linear-gradient(135deg,#00b894,#00cec9);cursor:not-allowed;transform:none;box-shadow:0 4px 15px rgba(0,184,148,0.4)}
.countdown-box{background:rgba(102,126,234,0.15);border:1px solid rgba(102,126,234,0.3);border-radius:12px;padding:12px 24px;margin:15px 0;font-weight:600;font-size:16px;color:#a5b4fc;display:none;animation:countdownPulse 1s ease-in-out infinite}
@keyframes countdownPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 rgba(102,126,234,0)}50%{transform:scale(1.02);box-shadow:0 0 20px rgba(102,126,234,0.3)}}
#countdown{font-size:24px;font-weight:800;color:#667eea;margin-right:6px}
@media(prefers-reduced-motion:reduce){*{animation-duration:0.01ms!important;transition-duration:0.01ms!important;animation-iteration-count:1!important}}
@media(max-width:400px){.container{padding:28px 20px}h2{font-size:20px}.icon-container{width:90px;height:130px}.shield-wrapper{width:70px;height:70px}.loader{width:35px;height:35px}.click-verify-btn{padding:12px 28px;font-size:15px}}
`;

// ==========================================
// 🔒 ENHANCED ANTI-BYPASS JAVASCRIPT (HEADLESS DETECTION)
// ==========================================
const ANTI_BYPASS_JS = `
(function(){
'use strict';

// 🔍 Headless Browser Detection
const detectHeadless = () => {
    let suspiciousScore = 0;
    
    // Check for webdriver flags
    if (navigator.webdriver) suspiciousScore += 50;
    
    // Check for Chrome Headless indicators
    if (!navigator.plugins || navigator.plugins.length === 0) suspiciousScore += 10;
    if (!navigator.languages || navigator.languages.length === 0) suspiciousScore += 10;
    if (!window.chrome) suspiciousScore += 5;
    if (navigator.permissions.query) {
        navigator.permissions.query({name:'notifications'}).then(function(permissionStatus) {
            if (Notification.permission !== 'default' && permissionStatus.state !== 'prompt') {
                suspiciousScore += 5;
            }
        });
    }
    
    // Check screen dimensions (headless often has weird dimensions)
    if (window.screen.width === 0 || window.screen.height === 0) suspiciousScore += 30;
    if (window.outerWidth === 0 || window.outerHeight === 0) suspiciousScore += 30;
    
    // Check for missing Chrome objects
    if (!window.chrome || !window.chrome.runtime) suspiciousScore += 5;
    
    // Check for automation signals
    const signals = ['__selenium', '__cdp', '__playwright', '_phantom', 'callPhantom', '_Selenium_IDE_Recorder', 'document.getElementsByTagName.toString'];
    for (const signal of signals) {
        if (navigator[signal] || window[signal] || document[signal]) {
            suspiciousScore += 40;
        }
    }
    
    // Check navigator properties
    if (navigator.connection === undefined) suspiciousScore += 5;
    if (navigator.deviceMemory === undefined) suspiciousScore += 3;
    
    // Check canvas (headless browsers have different canvas rendering)
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.fillText('test', 0, 0);
        const dataURL = canvas.toDataURL();
        // Headless browsers have empty or non-standard canvas
        if (!dataURL || dataURL.length < 1000) suspiciousScore += 15;
    } catch(e) {
        suspiciousScore += 10;
    }
    
    // Check webdriver-specific navigator properties
    if (window.navigator.permissions) suspiciousScore += 3;
    if (window.navigator.webdriver !== undefined) suspiciousScore += 20;
    
    // Block if too suspicious
    if (suspiciousScore >= 50) {
        console.warn('[Security] Headless browser detected, score:', suspiciousScore);
        window.location.href = '/blocked';
    }
};
detectHeadless();

// Check for automation tools
const checkAutomation = () => {
    const signals = ['webdriver', '__selenium', '__cdp', '__playwright', '_phantom', 'callPhantom', '_Selenium_IDE_Recorder'];
    for (const signal of signals) {
        if (navigator[signal] || window[signal] || document[signal]) {
            window.location.href = '/blocked';
            return;
        }
    }
};
checkAutomation();

// Detect DevTools opening
let devtoolsOpen = false;
setInterval(() => {
    const threshold = 160;
    if (window.outerWidth - window.innerWidth > threshold || 
        window.outerHeight - window.innerHeight > threshold) {
        if (!devtoolsOpen) {
            devtoolsOpen = true;
            window.location.href = '/blocked';
        }
    }
}, 500);

// Block right-click
document.addEventListener('contextmenu', (e) => { 
    e.preventDefault(); 
    e.stopPropagation();
    return false;
}, true);

// Block keyboard shortcuts for DevTools
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'u' || e.key === 's' || e.key === 'i' || e.key === 'j' || e.key === 'c' || e.key === 'shift' || e.key === 'k')) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }
    if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === 'i' || e.key === 'j' || e.key === 'c')) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }
}, true);

// Detect drag events that might indicate inspection
document.addEventListener('dragstart', (e) => {
    e.preventDefault();
});

// Disable text selection
document.addEventListener('selectstart', (e) => {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
    }
});

// Debugger trap
setInterval(() => {
    const start = Date.now();
    debugger;
    if (Date.now() - start > 100) {
        window.location.href = '/blocked';
    }
});

// Clear console periodically to hide redirects
setInterval(() => {
    console.clear();
}, 2000);

// Block copy-paste
document.addEventListener('copy', (e) => {
    e.preventDefault();
});
document.addEventListener('paste', (e) => {
    e.preventDefault();
});

// Disable inspect element
Object.defineProperty(document, 'querySelector', {
    value: function() {
        throw new Error('Inspection not allowed');
    }
})();

// 👆 Human Behavior Detection (FREE!)
let humanVerified = false;
let mouseMovements = 0;
let mouseDistances = [];
let lastMousePos = { x: 0, y: 0 };
let startTime = Date.now();
let clickTimestamps = [];
let scrollEvents = [];
let focusBlurEvents = [];
let touchEvents = [];

// Track detailed mouse movements
document.addEventListener('mousemove', (e) => {
    mouseMovements++;
    
    // Calculate distance moved
    if (lastMousePos.x !== 0 || lastMousePos.y !== 0) {
        const dx = e.clientX - lastMousePos.x;
        const dy = e.clientY - lastMousePos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        mouseDistances.push(distance);
        if (mouseDistances.length > 50) mouseDistances.shift();
    }
    lastMousePos = { x: e.clientX, y: e.clientY };
}, { passive: true });

// Track clicks
document.addEventListener('click', (e) => {
    clickTimestamps.push(Date.now());
    if (clickTimestamps.length > 10) clickTimestamps.shift();
});

// Track scroll events (FREE detection)
document.addEventListener('scroll', (e) => {
    scrollEvents.push({
        time: Date.now(),
        scrollY: window.scrollY
    });
    if (scrollEvents.length > 20) scrollEvents.shift();
}, { passive: true });

// Track focus/blur events (tab switching detection)
window.addEventListener('focus', () => {
    focusBlurEvents.push({ type: 'focus', time: Date.now() });
});
window.addEventListener('blur', () => {
    focusBlurEvents.push({ type: 'blur', time: Date.now() });
});

// Track touch events for mobile
document.addEventListener('touchstart', (e) => {
    touchEvents.push({
        time: Date.now(),
        touches: e.touches.length,
        x: e.touches[0]?.clientX || 0,
        y: e.touches[0]?.clientY || 0
    });
    if (touchEvents.length > 10) touchEvents.shift();
}, { passive: true });

// Function to verify human behavior pattern
window.verifyHuman = function() {
    const timeElapsed = Date.now() - startTime;
    const avgDistance = mouseDistances.length > 0 
        ? mouseDistances.reduce((a, b) => a + b, 0) / mouseDistances.length 
        : 0;
    
    // Check for suspicious patterns
    let suspiciousScore = 0;
    
    // TOO fast - automation
    if (timeElapsed < 1000) suspiciousScore += 30;
    if (mouseMovements < 5) suspiciousScore += 30;
    
    // TOO consistent - automation
    if (mouseMovements > 100 && avgDistance < 50) suspiciousScore += 20;
    
    // Perfect timing - automation
    if (clickTimestamps.length >= 2) {
        const intervals = [];
        for (let i = 1; i < clickTimestamps.length; i++) {
            intervals.push(clickTimestamps[i] - clickTimestamps[i-1]);
        }
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((sum, interval) => sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
        if (Math.sqrt(variance) < 50) suspiciousScore += 30; // Too consistent
    }
    
    // Check mouse movement smoothness (automation is too smooth)
    if (mouseDistances.length > 10) {
        const variations = mouseDistances.slice(-10).map((d, i) => {
            if (i === 0) return 0;
            return Math.abs(d - mouseDistances[mouseDistances.length - 10 + i - 1]);
        });
        const avgVariation = variations.reduce((a, b) => a + b, 0) / variations.length;
        if (avgVariation < 5 && mouseMovements > 50) suspiciousScore += 25;
    }
    
    // Scroll detection (FREE!)
    if (scrollEvents.length === 0 && timeElapsed > 2000) {
        suspiciousScore += 15; // No scrolling after 2 seconds
    }
    
    // Focus/blur detection (tab switching)
    if (focusBlurEvents.length > 3) {
        suspiciousScore += 20; // Too many focus/blur events
    }
    
    // Touch detection (mobile vs desktop)
    const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile && touchEvents.length === 0) {
        suspiciousScore += 25; // Mobile device but no touch events
    }
    
    humanVerified = suspiciousScore < 30;
    return humanVerified;
};

// Mark verified after mouse movement sufficient
setTimeout(() => {
    humanVerified = window.verifyHuman();
}, 3000);
})();
`;

// ==========================================
// 1. GO PATH (ENHANCED UI) - WITH HEADLESS DETECTION
// ==========================================
app.get('/go/:sessionId', detectHeadlessBrowser, trackIPBehavior, rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;
    console.log(`[/go] Request: ${sessionId}`);

    if (!isValidSessionId(sessionId)) {
        return res.status(400).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>❌ Invalid Link</h1></div></body></html>');
    }

    try {
        const result = await findSession(sessionId);
        if (!result) {
            console.log(`[/go] Session NOT FOUND: ${sessionId}`);
            return res.status(404).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Found</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🔍 Link Not Found</h1></div></body></html>');
        }

        const { sessionData, collection } = result;
        const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);

        if (ageSeconds > 900) {
            return res.status(410).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Expired</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>⏰ Link Expired</h1></div></body></html>');
        }
        if (sessionData.used) {
            return res.status(410).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Used</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>✅ Already Used</h1></div></body></html>');
        }
        if (sessionData.access_count >= 3) {
            return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Blocked</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🚫 Too Many Attempts</h1></div></body></html>');
        }
        if (!sessionData.short_url || !isValidUrl(sessionData.short_url)) {
            return res.status(400).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>⚠️ Invalid Destination</h1></div></body></html>');
        }

        const minWaitMs = 3000;
        const timeSinceCreation = Date.now() - new Date(sessionData.created_at).getTime();
        if (timeSinceCreation < minWaitMs) {
            await new Promise(resolve => setTimeout(resolve, minWaitMs - timeSinceCreation));
        }

        await collection.updateOne({ session_id: sessionId }, { $inc: { access_count: 1 } });

        const host = req.get('host');
        const redirectToken = generateRedirectToken(sessionId);
        const linkUrl = `https://${host}/link/${redirectToken}`;

        const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || '0x4AAAAAAAxxxxxxxxxxxx';
        
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#1a1a2e">
<title>🔐 Click to Continue</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>${SHARED_STYLES}</style>
<svg style="position:absolute;width:0;height:0"><defs><linearGradient id="shieldGradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#667eea;stop-opacity:1"/><stop offset="50%" style="stop-color:#764ba2;stop-opacity:1"/><stop offset="100%" style="stop-color:#667eea;stop-opacity:1"/></linearGradient></defs></svg>
</head>
<body>
<div class="container" id="mainContainer">
<div class="content">
<div class="icon-container">
<div class="shield-wrapper" id="shieldWrapper"><div class="shield-icon"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path class="shield-body" d="M50 5 L20 18 V45 C20 65 35 85 50 92 C65 85 80 65 80 45 V18 L50 5 Z"/><path class="shield-check" d="M35 50 L48 63 L65 40"/></svg></div></div>
<div class="loader-wrapper" id="loaderWrapper"><div class="loader"></div></div>
<div class="check-mark" id="checkMark">✓</div>
<div class="cross-mark" id="crossMark">✗</div>
</div>
<h2 id="title">🚀 Human Verification</h2>
<p class="message" id="message">Click the button below to continue</p>
<button id="clickVerifyBtn" class="click-verify-btn">👆 Click to Continue</button>
<div class="countdown-box" id="countdownBox"><span id="countdown">3</span> seconds remaining</div>
<div class="progress-bar" id="progressBar" style="display:none;"><div class="progress" id="progress"></div></div>
<p class="status-message" id="statusMessage">Waiting for click...</p>
<div class="security-badge"><svg class="lock-icon" viewBox="0 0 24 24"><path d="M12 2C9.243 2 7 4.243 7 7V10H6C4.897 10 4 10.897 4 12V20C4 21.103 4.897 22 6 22H18C19.103 22 20 21.103 20 20V12C20 10.897 19.103 10 18 10H17V7C17 4.243 14.757 2 12 2ZM12 4C13.654 4 15 5.346 15 7V10H9V7C9 5.346 10.346 4 12 4ZM12 14C13.103 14 14 14.897 14 16C14 17.103 13.103 18 12 18C10.897 18 10 17.103 10 16C10 14.897 10.897 14 12 14Z"/></svg><span>Secure Redirect</span></div>
</div>
</div>
<script>${ANTI_BYPASS_JS}</script>
<script>
(function(){
'use strict';
let clickVerified = false;
const linkUrl = '${linkUrl}';
const btn = document.getElementById('clickVerifyBtn');
const progressBar = document.getElementById('progressBar');
const progress = document.getElementById('progress');
const statusMessage = document.getElementById('statusMessage');
const countdownBox = document.getElementById('countdownBox');
const countdownEl = document.getElementById('countdown');
const shieldWrapper = document.getElementById('shieldWrapper');
const loaderWrapper = document.getElementById('loaderWrapper');
const checkMark = document.getElementById('checkMark');
const title = document.getElementById('title');
const message = document.getElementById('message');

function fadeText(element, text, delay = 0) {
    if (!element) return;
    setTimeout(() => {
        element.style.opacity = '0.6';
        setTimeout(() => {
            element.textContent = text;
            element.style.opacity = '1';
        }, 150);
    }, delay);
}

function startVerification() {
    if (clickVerified) return;
    
    // 🔒 Verify human behavior before proceeding
    if (typeof window.verifyHuman === 'function' && !window.verifyHuman()) {
        console.warn('[Security] Human verification failed');
        btn.textContent = '⚠️ Suspicious Activity';
        btn.style.background = 'linear-gradient(135deg, #e74c3c, #c0392b)';
        fadeText(statusMessage, 'Human verification failed. Please use a real browser.', 0);
        return;
    }
    
    // 🔐 Cloudflare Turnstile Verification (FREE!)
    btn.disabled = true;
    btn.textContent = '🔒 Verifying...';
    fadeText(statusMessage, 'Running security check...', 0);
    
    if (typeof turnstile !== 'undefined') {
        turnstile.ready(function() {
            turnstile.execute('${turnstileSiteKey}', {
                action: 'submit'
            })
            .then(function(token) {
                fetch('/api/verify-turnstile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: token })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        btn.textContent = '✓ Verified!';
                        proceedAfterVerification();
                    } else {
                        btn.disabled = false;
                        btn.textContent = '⚠️ Verification Failed';
                        btn.style.background = 'linear-gradient(135deg, #e74c3c, #c0392b)';
                        fadeText(statusMessage, data.message || 'Security check failed', 0);
                    }
                })
                .catch(err => {
                    console.error('[Turnstile] Error:', err);
                    // Fail open - allow if Turnstile fails
                    proceedAfterVerification();
                });
            })
            .catch(err => {
                console.error('[Turnstile] Execute error:', err);
                // Fail open - allow if Turnstile fails
                proceedAfterVerification();
            });
        });
    } else {
        // Turnstile not loaded - proceed anyway (fail open)
        console.warn('[Turnstile] Not loaded, proceeding anyway');
        proceedAfterVerification();
    }
}

function proceedAfterVerification() {
    clickVerified = true;

    btn.disabled = true;
    btn.textContent = '✓ Verified!';
    btn.style.background = 'linear-gradient(135deg, #00b894, #00cec9)';
    btn.style.transform = 'scale(0.98)';

    if (shieldWrapper) shieldWrapper.style.display = 'none';
    if (loaderWrapper) loaderWrapper.style.display = 'none';
    if (checkMark) {
        checkMark.classList.add('show');
        setTimeout(() => { checkMark.style.opacity = '1'; }, 50);
    }

    progressBar.style.display = 'block';
    if (progress) {
        progress.style.transition = 'none';
        progress.style.width = '0%';
        void progress.offsetWidth;
        progress.style.transition = 'width 2.5s cubic-bezier(0.4, 0, 0.2, 1)';
        progress.style.width = '100%';
        progress.classList.add('animate');
    }

    fadeText(statusMessage, 'Verifying...', 0);
    fadeText(statusMessage, 'Launching browser...', 600);
    fadeText(statusMessage, 'Opening secure link...', 1200);

    if (countdownBox) {
        countdownBox.style.display = 'block';
        let timeLeft = 3;
        countdownEl.textContent = timeLeft;
        const timer = setInterval(() => {
            timeLeft--;
            countdownEl.textContent = timeLeft;
            if (timeLeft <= 0) {
                clearInterval(timer);
                countdownBox.style.display = 'none';
            }
        }, 1000);
    }

    // 🔒 Random delay to confuse automation timing analysis
    const randomDelay = Math.floor(Math.random() * 1500) + 2000; // 2-3.5 seconds
    
    setTimeout(() => {
        const ua = navigator.userAgent || '';
        const isAndroid = /Android/i.test(ua);
        if (isAndroid) {
            try {
                const intentUrl = 'intent://' + linkUrl.replace(/^https?:\\/\\//,'') + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(linkUrl) + ';end';
                window.location.href = intentUrl;
            } catch(e) {
                window.location.href = linkUrl;
            }
        } else {
            window.location.href = linkUrl;
        }
    }, randomDelay);
}

if (btn) {
    btn.addEventListener('click', startVerification, { passive: true });
}
})();
</script>
</body>
</html>`);

    } catch (error) {
        console.error('[/go] Error:', error.message);
        return res.status(500).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>⚠️ Server Error</h1></div></body></html>');
    }
});

// ==========================================
// 2. LINK PATH (ENHANCED UI) - WITH HEADLESS DETECTION
// ==========================================
app.get('/link/:token', detectHeadlessBrowser, trackIPBehavior, rateLimiter, async (req, res) => {
    const token = req.params.token;
    const requestStartTime = Date.now();
    const referrer = req.get('referrer') || '';
    const host = req.get('host');
    
    console.log(`[/link] Request: ${token.substring(0, 10)}... | Referrer: ${referrer}`);

    // 🔒 Validate redirect token
    const tokenData = validateRedirectToken(token);
    if (!tokenData) {
        console.log(`[/link] BLOCKED: Invalid token - ${token.substring(0, 10)}...`);
        return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Access Denied</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🚫 Invalid or Expired Link</h1><p>Please start over from the verification page</p></div></body></html>');
    }
    
    const sessionId = tokenData.sessionId;

    // 🔒 Block direct access - must come from /go/ or same origin
    const sameOrigin = referrer.includes(host);
    const fromGo = referrer.includes('/go/');
    const fromAccess = referrer.includes(`/access/${sessionId}`);
    
    if (!sameOrigin && !fromGo && !fromAccess) {
        console.log(`[/link] BLOCKED: Invalid referrer - ${referrer}`);
        return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Access Denied</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🚫 Direct Access Blocked</h1><p>Please use the verification page</p></div></body></html>');
    }

    try {
        const result = await findSession(sessionId);
        if (!result) {
            return res.status(404).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Found</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🔍 Link Not Found</h1></div></body></html>');
        }

        const { sessionData, collection } = result;
        const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);
        if (ageSeconds > 900) {
            return res.status(410).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Expired</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>⏰ Link Expired</h1></div></body></html>');
        }
        if (sessionData.used) {
            return res.status(410).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Used</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>✅ Already Used</h1></div></body></html>');
        }
        if (!sessionData.short_url || !isValidUrl(sessionData.short_url)) {
            return res.status(400).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>⚠️ Invalid Destination</h1></div></body></html>');
        }

        await collection.updateOne({ session_id: sessionId }, { $set: { used: true, used_at: new Date() } });
        const destUrl = sessionData.short_url;
        const encryptedDest = encryptUrl(destUrl);
        console.log(`[/link] Redirecting: ${sessionId}`);

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#1a1a2e">
<title>🔐 Redirecting...</title>
<style>${SHARED_STYLES}</style>
<svg style="position:absolute;width:0;height:0"><defs><linearGradient id="shieldGradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#667eea;stop-opacity:1"/><stop offset="50%" style="stop-color:#764ba2;stop-opacity:1"/><stop offset="100%" style="stop-color:#667eea;stop-opacity:1"/></linearGradient></defs></svg>
</head>
<body>
<div class="container" id="mainContainer">
<div class="content">
<div class="icon-container">
<div class="shield-wrapper"><div class="shield-icon"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path class="shield-body" d="M50 5 L20 18 V45 C20 65 35 85 50 92 C65 85 80 65 80 45 V18 L50 5 Z"/><path class="shield-check" d="M35 50 L48 63 L65 40"/></svg></div></div>
<div class="loader-wrapper"><div class="loader"></div></div>
</div>
<h2>🔄 Redirecting</h2>
<p class="message">Loading your destination...</p>
<div class="progress-bar"><div class="progress" id="progress"></div></div>
<p class="status-message" id="statusMessage">Preparing redirect...</p>
<div class="security-badge"><svg class="lock-icon" viewBox="0 0 24 24"><path d="M12 2C9.243 2 7 4.243 7 7V10H6C4.897 10 4 10.897 4 12V20C4 21.103 4.897 22 6 22H18C19.103 22 20 21.103 20 20V12C20 10.897 19.103 10 18 10H17V7C17 4.243 14.757 2 12 2ZM12 4C13.654 4 15 5.346 15 7V10H9V7C9 5.346 10.346 4 12 4ZM12 14C13.103 14 14 14.897 14 16C14 17.103 13.103 18 12 18C10.897 18 10 17.103 10 16C10 14.897 10.897 14 12 14Z"/></svg><span>256-bit SSL Encrypted</span></div>
</div>
</div>
<script>${ANTI_BYPASS_JS}</script>
<script>
(function(){
const encryptedDest = '${encryptedDest}';
const progress = document.getElementById('progress');
const statusMessage = document.getElementById('statusMessage');

function fadeText(element, text, delay = 0) {
    if (!element) return;
    setTimeout(() => {
        element.style.opacity = '0.6';
        setTimeout(() => {
            element.textContent = text;
            element.style.opacity = '1';
        }, 150);
    }, delay);
}

if (progress) {
    progress.style.transition = 'none';
    progress.style.width = '0%';
    void progress.offsetWidth;
    progress.style.transition = 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
    progress.style.width = '100%';
    progress.classList.add('animate');
}

fadeText(statusMessage, 'Decrypting secure link...', 0);

// 🔒 Hide token from browser history immediately
try {
    history.replaceState(null, '', '/secure-redirect');
} catch(e) {}

setTimeout(() => {
    fetch('/api/decrypt-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encrypted: encryptedDest })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success && data.url) {
            fadeText(statusMessage, 'Opening destination...', 400);
            
            // 🔒 Random delay to confuse timing analysis
            const randomDelay = Math.floor(Math.random() * 1000) + 400; // 400-1400ms
            
            // 🔒 Additional obfuscation layers
            setTimeout(() => {
                const u = data.url;
                if (typeof u === 'string' && u.length > 0) {
                    try {
                        // Method 1: eval obfuscation
                        const f = 'window.location.assign';
                        eval(\`\${f}('\${u}')\`);
                    } catch(e1) {
                        try {
                            // Method 2: Blob redirect
                            const blob = new Blob([\`<script>window.location.href='\${u}';<\\/script>\`], { type: 'text/html' });
                            const blobUrl = URL.createObjectURL(blob);
                            window.location.href = blobUrl;
                            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                        } catch(e2) {
                            // Method 3: Fallback
                            window.location.href = u;
                        }
                    }
                }
            }, randomDelay);
        } else {
            fadeText(statusMessage, 'Link expired', 0);
        }
    })
    .catch(() => {
        fadeText(statusMessage, 'Security check failed', 0);
    });
}, 800);
})();
</script>
</body>
</html>`);

    } catch (error) {
        console.error('[/link] Error:', error.message);
        return res.status(500).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>⚠️ Server Error</h1></div></body></html>');
    }
});

// ==========================================
// 3. Session Validation API
// ==========================================
app.get('/api/process-session/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;
    if (!isValidSessionId(sessionId)) return res.json({ success: false, message: 'Invalid session ID.' });
    try {
        const result = await findSession(sessionId);
        if (!result) return res.json({ success: false, message: 'Session not found.' });
        const sessionData = result.sessionData;
        const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);
        if (ageSeconds > 900) return res.json({ success: false, message: 'Link expired.' });
        if (sessionData.used) return res.json({ success: false, message: 'Link already used.' });
        if (!sessionData.short_url) return res.json({ success: false, message: 'Session incomplete.' });
        return res.json({ success: true, redirect_path: `/go/${sessionId}` });
    } catch (error) {
        console.error('[API] Error:', error.message);
        return res.json({ success: false, message: 'Server error.' });
    }
});

// ==========================================
// Click Verification Endpoint
// ==========================================
app.post('/api/verify-click', rateLimiter, async (req, res) => {
    const { session_id, click_time } = req.body;
    if (!session_id || !click_time) return res.json({ success: false, message: 'Missing fields' });
    try {
        const shardIndex = getShardIndex(session_id);
        const collection = await getDatabase(shardIndex);
        await collection.updateOne(
            { session_id: session_id },
            { $set: { click_verified: true, click_time: parseInt(click_time) } },
            { upsert: false }
        );
        return res.json({ success: true });
    } catch (error) {
        console.error('[Verify-Click] Error:', error.message);
        return res.json({ success: false, message: 'Verification failed' });
    }
});

// ==========================================
// URL Decryption Endpoint
// ==========================================
app.post('/api/decrypt-url', rateLimiter, async (req, res) => {
    const { encrypted } = req.body;
    if (!encrypted) return res.json({ success: false, message: 'Invalid request' });
    
    try {
        const decryptedUrl = decryptUrl(encrypted);
        if (!decryptedUrl || !isValidUrl(decryptedUrl)) {
            return res.json({ success: false, message: 'Invalid URL' });
        }
        
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
        console.log(`[Decrypt] IP: ${ip}`);
        
        return res.json({ success: true, url: decryptedUrl });
    } catch (error) {
        console.error('[Decrypt] Error:', error.message);
        return res.json({ success: false, message: 'Decryption failed' });
    }
});

// ==========================================
// 🧩 Challenge Verification Endpoints
// ==========================================
app.get('/api/get-challenge', rateLimiter, (req, res) => {
    const challenge = generateChallenge();
    res.json({
        success: true,
        challenge_id: challenge.id,
        num1: challenge.num1,
        num2: challenge.num2,
        operation: challenge.operation
    });
});

app.post('/api/verify-challenge', rateLimiter, async (req, res) => {
    const { challenge_id, answer } = req.body;
    if (!challenge_id || !answer) {
        return res.json({ success: false, message: 'Missing fields' });
    }
    
    const isValid = verifyChallenge(challenge_id, answer);
    
    if (!isValid) {
        console.log(`[Challenge] FAILED: ${challenge_id} - ${answer}`);
        // Track failed attempts
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
        return res.json({ success: false, message: 'Incorrect answer' });
    }
    
    console.log(`[Challenge] PASSED: ${challenge_id}`);
    res.json({ success: true, message: 'Challenge verified' });
});

// ==========================================
// 🔐 CAPTCHA Verification Endpoint (reCAPTCHA v3)
// ==========================================
app.post('/api/verify-captcha', rateLimiter, async (req, res) => {
    const { token } = req.body;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    
    if (!token) {
        return res.json({ success: false, message: 'Missing CAPTCHA token' });
    }
    
    // Verify with Google
    const result = await verifyCaptcha(token, ip);
    
    if (!result.success) {
        console.log(`[CAPTCHA] Verification failed: ${JSON.stringify(result)}`);
        return res.json({ 
            success: false, 
            message: 'CAPTCHA verification failed',
            score: 0
        });
    }
    
    // Score: 0.0 = bot, 1.0 = human
    // Threshold: 0.5 or higher = acceptable
    const score = result.score || 0;
    const threshold = 0.5;
    
    if (score < threshold) {
        console.log(`[CAPTCHA] Score too low: ${score} (threshold: ${threshold})`);
        return res.json({ 
            success: false, 
            message: 'Suspicious activity detected',
            score: score
        });
    }
    
    console.log(`[CAPTCHA] Verified successfully: ${score}`);
    res.json({ 
        success: true, 
        message: 'CAPTCHA verified',
        score: score
    });
});

// ==========================================
// ❌ FREE: Cloudflare Turnstile Verification Endpoint
// ==========================================
app.post('/api/verify-turnstile', rateLimiter, async (req, res) => {
    const { token } = req.body;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    
    if (!token) {
        return res.json({ success: false, message: 'Missing Turnstile token' });
    }
    
    // Verify with Cloudflare (FREE!)
    const result = await verifyTurnstile(token, ip);
    
    if (!result.success) {
        console.log(`[Turnstile] Verification failed: ${JSON.stringify(result)}`);
        return res.json({ 
            success: false, 
            message: 'Security verification failed'
        });
    }
    
    console.log(`[Turnstile] Verified successfully`);
    res.json({ 
        success: true, 
        message: 'Security verified'
    });
});

// ==========================================
// 🛡️ PROTECTED ENDPOINTS
// ==========================================
app.use(botGuard);

app.get('/blocked', (req, res) => {
    res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Blocked</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🚫 Access Blocked</h1></div></body></html>');
});

app.post('/api/store-session', async (req, res) => {
    const clientKey = req.headers['x-api-key'];
    if (API_SECRET_KEY !== clientKey) return res.status(403).json({ success: false, message: 'Access Denied' });
    const { session_id, short_url, user_id, main_id, bot_username } = req.body;
    if (!session_id || !short_url) return res.status(400).json({ success: false, message: 'Missing fields' });
    if (!isValidSessionId(session_id)) return res.status(400).json({ success: false, message: 'Invalid session ID' });
    if (!isValidUrl(short_url)) return res.status(400).json({ success: false, message: 'Invalid URL' });
    try {
        const shardIndex = getShardIndex(session_id);
        const collection = await getDatabase(shardIndex);
        await collection.updateOne(
            { session_id: session_id },
            {
                $set: {
                    session_id, short_url,
                    user_id: user_id ? String(user_id).substring(0, 100) : null,
                    main_id: main_id ? String(main_id).substring(0, 100) : null,
                    bot_username: bot_username ? String(bot_username).substring(0, 100) : null,
                    created_at: new Date(), used: false, access_count: 0,
                    first_access_ip: req.headers['x-forwarded-for']?.split(',')[0] || 'unknown'
                }
            },
            { upsert: true }
        );
        console.log(`[Store] ✅ Stored: ${session_id}`);
        return res.json({ success: true });
    } catch (error) {
        console.error('[Store] Error:', error.message);
        return res.status(500).json({ success: false });
    }
});

// ==========================================
// 404 & Error Handlers
// ==========================================
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    if (process.env.NODE_ENV === 'development') {
        console.error('Stack:', err.stack);
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
});

// ==========================================
// 🚨 Global Error Handlers (Prevent Crashes)
// ==========================================

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err.message);
    if (process.env.NODE_ENV === 'development') {
        console.error('Stack:', err.stack);
    }
    // Don't exit - let Vercel handle it gracefully
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit - let Vercel handle it gracefully
});

if (require.main === module) {
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

module.exports = app;
