const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const compression = require('compression');
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 API Key
const API_SECRET_KEY = process.env.API_SECRET_KEY || "testing-Nazki";

// ✅ Bot blocking (allow mobile browsers)
const BLOCKED_USER_AGENTS = [
    'python-requests', 'scrapy', 'selenium', 'puppeteer',
    'playwright', 'headless'
];

const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_IP = 100;

// 🗄️ Database Shards
const DB_SHARDS = [
    'mongodb+srv://testing-web:V9EybCvxkH9tBAUW@cluster4.wt2x19f.mongodb.net/redirect-service?appName=Cluster4',
    'mongodb+srv://redirect-kawaii2:HWoekNn54skXZ8GA@cluster1.gigfzvo.mongodb.net/redirect_service?appName=Cluster1',
    'mongodb+srv://redirect-kawaii3:wiCwqRkusOUoSX8J@cluster2.brkkpuv.mongodb.net/redirect_service?appName=Cluster2'
];

// ✅ Connection caching
const mongoClients = new Map();
const mongoCollections = new Map();

// 🛡️ Security Middleware
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
// 🔒 OPTIMIZED ANTI-BYPASS JAVASCRIPT
// ==========================================
const ANTI_BYPASS_JS = `
(function(){
'use strict';
const checkAutomation = () => {
    const signals = ['webdriver', '__selenium', '__cdp', '__playwright'];
    for (const signal of signals) {
        if (navigator[signal] || window[signal]) {
            window.location.href = '/blocked';
            return;
        }
    }
    if (navigator.webdriver === true) window.location.href = '/blocked';
};
checkAutomation();
document.addEventListener('contextmenu', (e) => { e.preventDefault(); });
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'u' || e.key === 's' || e.key === 'i' || e.key === 'j' || e.key === 'c')) {
        e.preventDefault();
    }
    if (e.key === 'F12') { e.preventDefault(); }
});
})();
`;

// ==========================================
// 1. GO PATH (ENHANCED UI)
// ==========================================
app.get('/go/:sessionId', rateLimiter, async (req, res) => {
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
        const linkUrl = `https://${host}/link/${sessionId}`;

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#1a1a2e">
<title>🔐 Click to Continue</title>
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
    }, 2500);
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
// 2. LINK PATH (ENHANCED UI)
// ==========================================
app.get('/link/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;
    const requestStartTime = Date.now();
    console.log(`[/link] Request: ${sessionId}`);

    if (!isValidSessionId(sessionId)) {
        return res.status(400).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>❌ Invalid Link</h1></div></body></html>');
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
        const dest = sessionData.short_url;
        console.log(`[/link] Final: ${sessionId} -> ${dest}`);

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
const dest = '${dest}';
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

fadeText(statusMessage, 'Verifying session...', 0);
fadeText(statusMessage, 'Opening destination...', 400);

setTimeout(() => {
    window.location.href = dest;
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
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

if (require.main === module) {
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

module.exports = app;
