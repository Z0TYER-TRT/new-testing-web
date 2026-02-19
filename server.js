const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const compression = require('compression');
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 API Key (⚠️ MOVE TO ENVIRONMENT VARIABLES IN PRODUCTION)
const API_SECRET_KEY = process.env.API_SECRET_KEY || "Aniketsexvideo69";

const BLOCKED_USER_AGENTS = ['curl', 'wget', 'python-requests', 'scrapy', 'bot', 'crawler', 'spider', 'selenium', 'puppeteer', 'playwright'];
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_IP = 60;

// 🗄️ Database Shards (⚠️ MOVE TO ENVIRONMENT VARIABLES IN PRODUCTION)
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
            upgradeInsecureRequests: [],
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
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

// --- RATE LIMITER (Enhanced) ---
const ipRequestCounts = new Map();
function rateLimiter(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    if (Math.random() < 0.1) {
        for (const [key, data] of ipRequestCounts) if (now > data.resetTime) ipRequestCounts.delete(key);
    }
    const data = ipRequestCounts.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
    if (now > data.resetTime) { data.count = 0; data.resetTime = now + RATE_LIMIT_WINDOW; }
    data.count++;
    ipRequestCounts.set(ip, data);
    if (data.count > MAX_REQUESTS_PER_IP) return res.status(429).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Too Many Requests</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>⚠️ Too Many Requests</h1><p>Please wait before trying again.</p></div></body></html>');
    next();
}

// --- BOT GUARD (Enhanced) ---
function botGuard(req, res, next) {
    const userAgent = (req.get('User-Agent') || '').toLowerCase();
    const referer = req.get('Referer') || '';
    
    if (!userAgent) return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Access Denied</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🚫 Access Denied</h1><p>Invalid request.</p></div></body></html>');
    if (BLOCKED_USER_AGENTS.some(bot => userAgent.includes(bot))) return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bot Detected</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🤖 Bot Detected</h1><p>Automated access is not allowed.</p></div></body></html>');
    
    next();
}

// --- URL VALIDATION ---
function isValidUrl(string) {
    try { 
        const url = new URL(string);
        const allowedProtocols = ['http:', 'https:'];
        if (!allowedProtocols.includes(url.protocol)) return false;
        const hostname = url.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '127.0.0.1' ||
            hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
            hostname.startsWith('172.16.') || hostname.startsWith('172.17.') || hostname.startsWith('172.18.') || hostname.startsWith('172.19.') || hostname.startsWith('169.254.')) return false;
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

// --- Generate Security Token ---
function generateToken(sessionId) {
    const timestamp = Date.now();
    const hash = crypto.createHmac('sha256', API_SECRET_KEY)
        .update(`${sessionId}:${timestamp}`)
        .digest('hex');
    return `${timestamp}:${hash}`;
}

// --- Verify Security Token ---
function verifyToken(sessionId, token) {
    try {
        const [timestamp, hash] = token.split(':');
        if (!timestamp || !hash) return false;
        
        const expectedHash = crypto.createHmac('sha256', API_SECRET_KEY)
            .update(`${sessionId}:${timestamp}`)
            .digest('hex');
        
        if (hash !== expectedHash) return false;
        
        const age = Date.now() - parseInt(timestamp);
        if (age > 30000) return false; // Token valid for 30 seconds
        
        return true;
    } catch (_) {
        return false;
    }
}

// --- DATABASE CONNECTION ---
async function getDatabase(index) {
    if (collections[index]) return collections[index];
    if (connectionPromises[index]) return connectionPromises[index];

    connectionPromises[index] = (async () => {
        try {
            const client = new MongoClient(DB_SHARDS[index], {
                maxPoolSize: 1,
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
            });
            await client.connect();
            const db = client.db('redirect-service');
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
            if (col) await col.deleteMany({ created_at: { $lt: cutoffDate } });
        } catch (err) { console.error(`Cleanup error on shard ${i}:`, err.message); }
    }
}

setInterval(cleanupOldSessions, 5 * 60 * 1000);

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

// ==========================================
// 🎨 SHARED UI STYLES (Consistent Design)
// ==========================================
const SHARED_STYLES = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px;color:#fff}
.container{background:rgba(255,255,255,0.08);padding:35px 25px;border-radius:20px;border:1px solid rgba(255,255,255,0.1);text-align:center;width:100%;max-width:380px;animation:fadeIn 0.4s ease-out}
@keyframes fadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.icon-container{position:relative;width:100px;height:140px;margin:0 auto 15px;display:flex;flex-direction:column;justify-content:flex-start;align-items:center}
.shield-wrapper{width:80px;height:80px;position:relative;margin-bottom:15px;animation:shieldFloat 3s ease-in-out infinite}
@keyframes shieldFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
.shield-icon{width:100%;height:100%}
.shield-icon svg{width:100%;height:100%;filter:drop-shadow(0 0 20px rgba(102,126,234,0.6))}
.shield-body{fill:url(#shieldGradient)}
.shield-check{fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:30;stroke-dashoffset:30;animation:drawCheck 0.6s ease-out 0.3s forwards}
@keyframes drawCheck{to{stroke-dashoffset:0}}
.loader-wrapper{width:50px;height:50px;display:flex;justify-content:center;align-items:center}
.loader{width:40px;height:40px;border:3px solid rgba(255,255,255,0.15);border-top:3px solid #667eea;border-radius:50%;animation:spin 0.8s linear infinite}
@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
.check-mark,.cross-mark{display:none;width:45px;height:45px;border-radius:50%;justify-content:center;align-items:center;font-size:28px;color:#fff;font-weight:bold;animation:checkPop 0.5s cubic-bezier(0.68,-0.55,0.265,1.55)}
.check-mark{background:linear-gradient(135deg,#00b894,#00cec9);box-shadow:0 10px 30px rgba(0,184,148,0.5)}
.cross-mark{background:linear-gradient(135deg,#e74c3c,#c0392b);box-shadow:0 10px 30px rgba(231,76,60,0.5)}
.check-mark.show,.cross-mark.show{display:flex}
@keyframes checkPop{0%{transform:scale(0) rotate(-180deg);opacity:0}100%{transform:scale(1) rotate(0deg);opacity:1}}
h2{font-size:22px;font-weight:700;margin-bottom:10px;color:#fff}
.message{font-size:14px;color:rgba(255,255,255,0.75);margin-bottom:20px;line-height:1.5;min-height:20px}
.progress-bar{width:100%;height:5px;background:rgba(255,255,255,0.1);border-radius:8px;overflow:hidden;margin-bottom:18px}
.progress{height:100%;background:linear-gradient(90deg,#667eea 0%,#764ba2 100%);width:0%;border-radius:8px}
.status-message{font-size:12px;color:rgba(255,255,255,0.5);min-height:18px}
.security-badge{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:20px;padding:10px 18px;background:rgba(0,184,148,0.15);border:1px solid rgba(0,184,148,0.25);border-radius:10px;font-size:12px;color:rgba(0,184,148,0.85)}
.lock-icon{width:14px;height:14px;fill:currentColor}
.container.success h2{color:#00b894}
.container.error h2{color:#e74c3c}
@media(prefers-reduced-motion:reduce){*{animation-duration:0.01ms!important;transition-duration:0.01ms!important}}
@media(max-width:400px){.container{padding:28px 20px}h2{font-size:20px}.icon-container{width:90px;height:130px}.shield-wrapper{width:70px;height:70px}.loader{width:35px;height:35px}}
`;

// ==========================================
// 🔒 ANTI-BYPASS JAVASCRIPT (Obfuscated)
// ==========================================
const ANTI_BYPASS_JS = `
(function(){
    'use strict';
    
    // Anti-DevTools Detection
    let devtoolsOpen = false;
    const checkDevTools = () => {
        const threshold = 160;
        const widthDiff = window.outerWidth - window.innerWidth;
        const heightDiff = window.outerHeight - window.innerHeight;
        if (widthDiff > threshold || heightDiff > threshold) {
            devtoolsOpen = true;
            console.log('%c⚠️ DevTools Detected', 'color:red;font-size:20px;font-weight:bold;');
        }
        setTimeout(checkDevTools, 500);
    };
    checkDevTools();
    
    // Anti-Automation Detection
    const automationSignals = [
        'webdriver', '__selenium', '__cdp', '__playwright',
        'callSelenium', 'selenium', 'phantom', 'headless'
    ];
    
    const checkAutomation = () => {
        for (const signal of automationSignals) {
            if (navigator[signal] || window[signal]) {
                window.location.href = '/blocked';
                return;
            }
        }
        if (navigator.webdriver === true) {
            window.location.href = '/blocked';
        }
    };
    checkAutomation();
    
    // Anti-Time-Skip Detection
    let lastTime = Date.now();
    let timeSkips = 0;
    setInterval(() => {
        const now = Date.now();
        const diff = now - lastTime;
        if (diff > 2000) {
            timeSkips++;
            if (timeSkips > 3) {
                window.location.href = '/blocked';
            }
        }
        lastTime = now;
    }, 500);
    
    // Anti-Console Clear
    const originalClear = console.clear;
    console.clear = function() {
        devtoolsOpen = true;
        originalClear.apply(console, arguments);
    };
    
    // Anti-Debugger
    setInterval(() => {
        const start = performance.now();
        debugger;
        const end = performance.now();
        if (end - start > 100) {
            devtoolsOpen = true;
        }
    }, 2000);
    
    // Prevent Right Click
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        return false;
    });
    
    // Prevent Key Combinations
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && (e.key === 'u' || e.key === 's' || e.key === 'i' || e.key === 'j' || e.key === 'c')) {
            e.preventDefault();
            return false;
        }
        if (e.key === 'F12') {
            e.preventDefault();
            return false;
        }
    });
    
    // Prevent Selection
    document.addEventListener('selectstart', (e) => {
        e.preventDefault();
        return false;
    });
    
    // Visibility Check
    let hiddenCount = 0;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            hiddenCount++;
            if (hiddenCount > 5) {
                window.location.href = '/blocked';
            }
        }
    });
    
})();
`;

// ==========================================
// 1. GO PATH - Enhanced Security + UI
// ==========================================
app.get('/go/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;
    if (!isValidSessionId(sessionId)) return res.status(400).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid Link</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>❌ Invalid Link</h1></div></body></html>');

    try {
        const shardIndex = getShardIndex(sessionId);
        const collection = await getDatabase(shardIndex);
        const sessionData = await collection.findOne({ session_id: sessionId });

        if (!sessionData || !sessionData.short_url) return res.status(404).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Found</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🔍 Link Not Found</h1></div></body></html>');

        const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);
        if (ageSeconds > 900) return res.status(410).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Expired</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>⏰ Link Expired</h1></div></body></html>');

        if (sessionData.used) return res.status(410).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Already Used</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>✅ Already Used</h1></div></body></html>');

        if (!isValidUrl(sessionData.short_url)) return res.status(400).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>⚠️ Invalid Destination</h1></div></body></html>');

        console.log(`[/go] Opening: ${sessionId}`);

        const host = req.get('host');
        const linkUrl = `https://${host}/link/${sessionId}`;
        const token = generateToken(sessionId);
        
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
    <meta name="referrer" content="no-referrer">
    <meta name="theme-color" content="#1a1a2e">
    <title>🔐 Opening...</title>
    <style>${SHARED_STYLES}</style>
    <svg style="position:absolute;width:0;height:0">
        <defs>
            <linearGradient id="shieldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#667eea;stop-opacity:1"/>
                <stop offset="50%" style="stop-color:#764ba2;stop-opacity:1"/>
                <stop offset="100%" style="stop-color:#667eea;stop-opacity:1"/>
            </linearGradient>
        </defs>
    </svg>
</head>
<body>
    <div class="container" id="mainContainer">
        <div class="content">
            <div class="icon-container">
                <div class="shield-wrapper">
                    <div class="shield-icon">
                        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                            <path class="shield-body" d="M50 5 L20 18 V45 C20 65 35 85 50 92 C65 85 80 65 80 45 V18 L50 5 Z"/>
                            <path class="shield-check" d="M35 50 L48 63 L65 40"/>
                        </svg>
                    </div>
                </div>
                <div class="loader-wrapper">
                    <div class="loader"></div>
                </div>
            </div>
            <h2>🚀 Opening Browser</h2>
            <p class="message">Please wait while we open your link...</p>
            <div class="progress-bar"><div class="progress" id="progress"></div></div>
            <p class="status-message" id="statusMessage">Initializing...</p>
            <div class="security-badge">
                <svg class="lock-icon" viewBox="0 0 24 24"><path d="M12 2C9.243 2 7 4.243 7 7V10H6C4.897 10 4 10.897 4 12V20C4 21.103 4.897 22 6 22H18C19.103 22 20 21.103 20 20V12C20 10.897 19.103 10 18 10H17V7C17 4.243 14.757 2 12 2ZM12 4C13.654 4 15 5.346 15 7V10H9V7C9 5.346 10.346 4 12 4ZM12 14C13.103 14 14 14.897 14 16C14 17.103 13.103 18 12 18C10.897 18 10 17.103 10 16C10 14.897 10.897 14 12 14Z"/></svg>
                <span>Secure Redirect</span>
            </div>
        </div>
    </div>
    <script>
        ${ANTI_BYPASS_JS}
        
        (function(){
            const linkUrl = '${linkUrl}';
            const token = '${token}';
            const progress = document.getElementById('progress');
            const statusMessage = document.getElementById('statusMessage');
            
            // Animate progress
            if(progress) {
                progress.style.transition = 'none';
                progress.style.width = '0%';
                void progress.offsetWidth;
                progress.style.transition = 'width 2s linear';
                progress.style.width = '100%';
            }
            
            // Update status
            if(statusMessage) {
                setTimeout(() => statusMessage.textContent = 'Launching browser...', 500);
                setTimeout(() => statusMessage.textContent = 'Opening secure link...', 1000);
            }
            
            // Redirect with token validation
            setTimeout(() => {
                const ua = navigator.userAgent || '';
                const isAndroid = /Android/i.test(ua);
                
                if(isAndroid) {
                    try {
                        const intentUrl = 'intent://' + linkUrl.replace(/^https?:\\/\\//,'') + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(linkUrl) + ';end';
                        window.location.href = intentUrl;
                    } catch(e) {
                        window.location.href = linkUrl + '?token=' + token;
                    }
                } else {
                    window.location.href = linkUrl + '?token=' + token;
                }
            }, 1800);
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
// 2. LINK PATH - Enhanced Security + UI
// ==========================================
app.get('/link/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;
    const clientToken = req.query.token;
    const requestStartTime = Date.now();
    
    console.log(`[/link] Request: ${sessionId}`);

    if (!isValidSessionId(sessionId)) {
        return res.status(400).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>❌ Invalid Link</h1></div></body></html>');
    }

    // ✅ Verify security token
    if (clientToken && !verifyToken(sessionId, clientToken)) {
        console.log(`[/link] Token verification failed: ${sessionId}`);
        return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Forbidden</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🚫 Invalid Token</h1><p>Request cannot be verified.</p></div></body></html>');
    }

    try {
        const shardIndex = getShardIndex(sessionId);
        const collection = await getDatabase(shardIndex);
        const sessionData = await collection.findOne({ session_id: sessionId });

        if (!sessionData) return res.status(404).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Found</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🔍 Link Not Found</h1></div></body></html>');

        const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);
        if (ageSeconds > 900) return res.status(410).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Expired</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>⏰ Link Expired</h1></div></body></html>');

        if (sessionData.used) {
            return res.status(410).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Used</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>✅ Already Used</h1></div></body></html>');
        }

        if (!isValidUrl(sessionData.short_url)) return res.status(400).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>⚠️ Invalid Destination</h1></div></body></html>');

        // Mark as used BEFORE redirect
        await collection.updateOne(
            { session_id: sessionId },
            { $set: { used: true, used_at: new Date() } }
        );

        const dest = sessionData.short_url;
        const redirectDelay = 500; // Minimum 500ms delay (cannot be bypassed)
        
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
    <svg style="position:absolute;width:0;height:0">
        <defs>
            <linearGradient id="shieldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#667eea;stop-opacity:1"/>
                <stop offset="50%" style="stop-color:#764ba2;stop-opacity:1"/>
                <stop offset="100%" style="stop-color:#667eea;stop-opacity:1"/>
            </linearGradient>
        </defs>
    </svg>
</head>
<body>
    <div class="container" id="mainContainer">
        <div class="content">
            <div class="icon-container">
                <div class="shield-wrapper">
                    <div class="shield-icon">
                        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                            <path class="shield-body" d="M50 5 L20 18 V45 C20 65 35 85 50 92 C65 85 80 65 80 45 V18 L50 5 Z"/>
                            <path class="shield-check" d="M35 50 L48 63 L65 40"/>
                        </svg>
                    </div>
                </div>
                <div class="loader-wrapper">
                    <div class="loader"></div>
                </div>
            </div>
            <h2>🔮 Redirecting</h2>
            <p class="message">Loading your destination...</p>
            <div class="progress-bar"><div class="progress" id="progress"></div></div>
            <p class="status-message" id="statusMessage">Preparing redirect...</p>
            <div class="security-badge">
                <svg class="lock-icon" viewBox="0 0 24 24"><path d="M12 2C9.243 2 7 4.243 7 7V10H6C4.897 10 4 10.897 4 12V20C4 21.103 4.897 22 6 22H18C19.103 22 20 21.103 20 20V12C20 10.897 19.103 10 18 10H17V7C17 4.243 14.757 2 12 2ZM12 4C13.654 4 15 5.346 15 7V10H9V7C9 5.346 10.346 4 12 4ZM12 14C13.103 14 14 14.897 14 16C14 17.103 13.103 18 12 18C10.897 18 10 17.103 10 16C10 14.897 10.897 14 12 14Z"/></svg>
                <span>256-bit SSL Encrypted</span>
            </div>
        </div>
    </div>
    <script>
        ${ANTI_BYPASS_JS}
        
        (function(){
            const dest = '${dest}';
            const redirectDelay = ${redirectDelay};
            const startTime = ${requestStartTime};
            const progress = document.getElementById('progress');
            const statusMessage = document.getElementById('statusMessage');
            
            // Animate progress
            if(progress) {
                progress.style.transition = 'none';
                progress.style.width = '0%';
                void progress.offsetWidth;
                progress.style.transition = 'width ' + (redirectDelay/1000) + 's linear';
                progress.style.width = '100%';
            }
            
            // Update status messages
            if(statusMessage) {
                setTimeout(() => statusMessage.textContent = 'Verifying session...', 300);
                setTimeout(() => statusMessage.textContent = 'Opening destination...', 600);
            }
            
            // Server-enforced minimum delay (cannot be bypassed by client)
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, redirectDelay - elapsed);
            
            setTimeout(() => {
                window.location.href = dest;
            }, remaining);
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
// 3. Session Validation API (Enhanced Security)
// ==========================================
app.get('/api/process-session/:sessionId', rateLimiter, async (req, res) => {
    const sessionId = req.params.sessionId;
    if (!isValidSessionId(sessionId)) return res.json({ success: false, message: 'Invalid session ID.' });

    try {
        const shardIndex = getShardIndex(sessionId);
        const collection = await getDatabase(shardIndex);
        const sessionData = await collection.findOne({ session_id: sessionId });

        if (!sessionData) return res.json({ success: false, message: 'Session not found.' });

        const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);
        if (ageSeconds > 900) return res.json({ success: false, message: 'Link expired.' });
        if (sessionData.used) return res.json({ success: false, message: 'Link already used.' });
        if (!sessionData.short_url) return res.json({ success: false, message: 'Session incomplete.' });

        // Generate secure token for redirect validation
        const token = generateToken(sessionId);

        return res.json({ 
            success: true, 
            redirect_path: `/go/${sessionId}`,
            token: token
        });

    } catch (error) {
        console.error('[API] Error:', error.message);
        return res.json({ success: false, message: 'Server error.' });
    }
});

// ==========================================
// 🛡️ PROTECTED ENDPOINTS
// ==========================================
app.use(botGuard);

// Blocked Page (for detected bots/automation)
app.get('/blocked', (req, res) => {
    res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Blocked</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🚫 Access Blocked</h1><p>Suspicious activity detected.</p></div></body></html>');
});

app.post('/api/store-session', async (req, res) => {
    const clientKey = req.headers['x-api-key'];
    
    if (API_SECRET_KEY !== clientKey) {
        return res.status(403).json({ success: false, message: 'Access Denied' });
    }

    const { session_id, short_url, user_id, main_id, bot_username } = req.body;
    if (!session_id || !short_url) return res.status(400).json({ success: false, message: 'Missing required fields' });
    if (!isValidSessionId(session_id)) return res.status(400).json({ success: false, message: 'Invalid session ID format' });
    if (!isValidUrl(short_url)) return res.status(400).json({ success: false, message: 'Invalid URL' });

    const sanitizedUserId = user_id ? String(user_id).substring(0, 100) : null;
    const sanitizedMainId = main_id ? String(main_id).substring(0, 100) : null;
    const sanitizedBotUsername = bot_username ? String(bot_username).substring(0, 100) : null;

    try {
        const shardIndex = getShardIndex(session_id);
        const collection = await getDatabase(shardIndex);

        await collection.updateOne(
            { session_id: session_id },
            {
                $set: {
                    session_id,
                    short_url,
                    user_id: sanitizedUserId,
                    main_id: sanitizedMainId,
                    bot_username: sanitizedBotUsername,
                    created_at: new Date(),
                    used: false
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

app.get('/access/:sessionId', (req, res) => {
    if (!isValidSessionId(req.params.sessionId)) return res.status(400).send('<h1>Invalid Session</h1>');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

if (require.main === module) {
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

module.exports = app;
