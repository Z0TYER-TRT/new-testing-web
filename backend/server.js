const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const compression = require('compression');
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 API Key - Must be set via environment variable
const API_SECRET_KEY = process.env.API_SECRET_KEY;
if (!API_SECRET_KEY) {
  console.error('❌ FATAL: API_SECRET_KEY environment variable is not set');
  console.error('   Set it with: export API_SECRET_KEY=your_secure_key_here');
  process.exit(1);
}

// 🎫 Token storage for secure redirect flow
const redirectTokens = new Map();
const TOKEN_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes

// Anti-replay: Track used nonces
const usedNonces = new Set();
const NONCE_WINDOW_MS = 30000; // 30 seconds - reduced from 60s

// Suspicious patterns in URL/query
const SUSPICIOUS_PATTERNS = [
  /extractor/i, /bypass/i, /scrap(er)?/i, /crawl(er)?/i,
  /bot/i, /automation/i, /script/i, /tool/i, /hack/i,
  /termux/i, /curl/i, /wget/i
];

// Allowed referers (must come from our domain)
// Support multiple Vercel domains - use VERCEL_URL env var if available
const ALLOWED_REFERERS = [
  'redirect-kawaii.vercel.app',
  'new-testing-web-backend.vercel.app'
];

// Build allowed origins from env or use defaults
const ALLOWED_ORIGINS = [
  /^https?:\/\/[^\/]*redirect-kawaii\.vercel\.app$/,
  /^https?:\/\/[^\/]*new-testing-web-backend\.vercel\.app$/,
  /^https?:\/\/[^\/]*-zxcs-projects-b70044f5\.vercel\.app$/, // Vercel preview URLs
  /^https?:\/\/[^\/]*\.vercel\.app$/,  // Any Vercel app (for flexibility)
  /^https?:\/\/localhost:\d+$/ // Only for local development
];

// Debug flag for logging
const DEBUG = process.env.NODE_ENV !== 'production';

// Clean up expired tokens periodically
setInterval(() => {
  const now = Date.now();

  // Clean expired redirect tokens
  for (const [token, data] of redirectTokens) {
    if (now > data.expiresAt) {
      redirectTokens.delete(token);
    }
  }

  // Clean expired client sessions (5 minute TTL)
  const SESSION_TTL = 5 * 60 * 1000;
  for (const [key, session] of clientSessions) {
    if (now - session.timestamp > SESSION_TTL) {
      clientSessions.delete(key);
    }
  }

  // Clean old nonces
  if (usedNonces.size > 50000) {
    usedNonces.clear();
  }
}, 60 * 1000);

// Generate secure random token
function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Generate nonce for request signing
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

// Validate request signature
function validateRequestSignature(req) {
  const signature = req.headers['x-request-signature'];
  const timestamp = req.headers['x-request-timestamp'];
  const nonce = req.headers['x-request-nonce'];
  
  if (!signature || !timestamp || !nonce) {
    return false;
  }
  
  // Check timestamp is within window
  const requestTime = parseInt(timestamp);
  if (isNaN(requestTime) || Math.abs(Date.now() - requestTime) > NONCE_WINDOW_MS) {
    return false;
  }
  
  // Check nonce not reused
  if (usedNonces.has(nonce)) {
    return false;
  }
  
  // Mark nonce as used
  usedNonces.add(nonce);
  
  return true;
}

// ✅ Bot blocking (allow mobile browsers)
const BLOCKED_USER_AGENTS = [
    'python-requests', 'scrapy', 'selenium', 'puppeteer',
    'playwright', 'headless'
];

const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_IP = 100;

// 🗄️ Database Shards
const DB_SHARDS = [
    'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/redirect_service?appName=Cluster0',
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
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);

    // Check if origin is allowed
    const isAllowed = ALLOWED_ORIGINS.some(pattern => pattern.test(origin));
    if (isAllowed) {
      callback(null, true);
    } else {
      if (DEBUG) console.log(`[CORS] Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'X-Requested-With'],
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
let lastRateLimitCleanup = Date.now();

function rateLimiter(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();

  // Deterministic cleanup every 60 seconds
  if (now - lastRateLimitCleanup > 60000) {
    lastRateLimitCleanup = now;
    for (const [key, data] of ipRequestCounts) {
      if (now > data.resetTime) ipRequestCounts.delete(key);
    }
    if (ipRequestCounts.size > 1000) {
      const keys = Array.from(ipRequestCounts.keys()).slice(0, 500);
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

// --- ENHANCED BOT GUARD ---
function botGuard(req, res, next) {
  const userAgent = (req.get('User-Agent') || '').toLowerCase();
  const referer = req.get('Referer') || '';
  const fullUrl = req.originalUrl || '';
  const clientIp = getClientIp(req);

  // Check for blocked user agents
  if (BLOCKED_USER_AGENTS.some(bot => userAgent.includes(bot))) {
    if (DEBUG) console.log(`[BotGuard] BLOCKED UA: ${userAgent.substring(0, 50)}`);
    return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bot Detected</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🤖 Bot Detected</h1></div></body></html>');
  }

  // Check for suspicious patterns in URL
  if (SUSPICIOUS_PATTERNS.some(pattern => pattern.test(fullUrl))) {
    if (DEBUG) console.log(`[BotGuard] SUSPICIOUS URL: ${fullUrl.substring(0, 100)}`);
    return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Access Blocked</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🚫 Access Blocked</h1></div></body></html>');
  }

  // Check for external referers (bypass tools often have none or external)
  if (referer) {
    try {
      const refererHost = new URL(referer).hostname;
      const isAllowed = ALLOWED_REFERERS.some(allowed => refererHost === allowed || refererHost.endsWith('.' + allowed));
      if (!isAllowed && !refererHost.includes('t.me') && !refererHost.includes('telegram')) {
        if (DEBUG) console.log(`[BotGuard] BLOCKED REFERER: ${refererHost}`);
        return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Access Blocked</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🚫 External Access Blocked</h1></div></body></html>');
      }
    } catch (e) {
      // Invalid referer, allow but log
      if (DEBUG) console.log(`[BotGuard] INVALID REFERER`);
    }
  }

  // Check for missing critical headers (common in scripts/tools)
  const acceptHeader = req.get('Accept') || '';
  const acceptLang = req.get('Accept-Language') || '';

  if (!acceptHeader && !acceptLang && !req.get('Sec-Fetch-Dest')) {
    // Suspicious - no standard browser headers
    if (DEBUG) console.log(`[BotGuard] MISSING HEADERS from ${clientIp}`);
  }

  next();
}

// --- STRICT API GUARD (for token endpoints) ---
function apiGuard(req, res, next) {
  const userAgent = (req.get('User-Agent') || '').toLowerCase();
  const referer = req.get('Referer') || '';
  const origin = req.get('Origin') || '';
  const host = req.get('Host') || '';
  const clientIp = getClientIp(req);

  // API must come from browser with valid referer
  if (!referer && !origin) {
    if (DEBUG) console.log(`[APIGuard] NO REFERER from ${clientIp}`);
    return res.status(403).json({ success: false, code: 'INVALID_ORIGIN' });
  }

  // Validate referer/origin with exact matching
  const source = referer || origin;
  const isValidSource = ALLOWED_ORIGINS.some(pattern => pattern.test(source)) ||
    ALLOWED_REFERERS.some(allowed => host === allowed || host.endsWith('.' + allowed));

  if (!isValidSource) {
    if (DEBUG) console.log(`[APIGuard] INVALID SOURCE`);
    return res.status(403).json({ success: false, code: 'INVALID_ORIGIN' });
  }

  // Check for automation
  if (BLOCKED_USER_AGENTS.some(bot => userAgent.includes(bot))) {
    return res.status(403).json({ success: false, code: 'AUTOMATION_DETECTED' });
  }

  // Check for missing XMLHttpRequest header (indicates direct curl/script access)
  const requestedWith = req.get('X-Requested-With') || '';
  if (!requestedWith.includes('XMLHttpRequest')) {
    // Allow but log suspicious requests
    if (DEBUG) console.log(`[APIGuard] NO XHR HEADER from ${clientIp}`);
  }

  next();
}

// --- IP EXTRACTION ---
const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.VERCEL === '1';

function getClientIp(req) {
  if (TRUST_PROXY) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection.remoteAddress || 'unknown';
  }
  return req.ip || req.connection.remoteAddress || 'unknown';
}

// --- FINGERPRINT VALIDATION ---
function generateFingerprint(req) {
  const ip = getClientIp(req);
  const ua = req.get('User-Agent') || '';
  const accept = req.get('Accept') || '';
  const acceptLang = req.get('Accept-Language') || '';
  return crypto.createHash('sha256').update(ip + ua + accept + acceptLang).digest('hex').substring(0, 16);
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
      if (DEBUG) console.log(`🔌 Connecting to MongoDB Shard ${index + 1}...`);
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
      if (DEBUG) console.log(`✅ MongoDB Connected (Shard ${index + 1})`);
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
      if (DEBUG) console.log('ℹ️ Indexes exist');
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
                if (DEBUG) console.log(`✅ Found in Shard ${i + 1}`);
                return { sessionData, collection: col };
            }
        } catch (err) {
            if (DEBUG) console.error(`Shard ${i + 1} failed:`, err.message);
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
                if (DEBUG) console.log(`🧹 Cleaned ${result.deletedCount} old sessions`);
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

app.use(express.static(path.join(__dirname, '..', 'frontend'), {
    maxAge: '1h',
    setHeaders: (res, filepath) => {
        if (filepath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        else if (filepath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
        else if (filepath.endsWith('.html')) res.setHeader('content-type', 'text/html; charset=utf-8');
    }
}));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

app.get('/health', (req, res) => res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    shards: DB_SHARDS.length,
    vercel: process.env.VERCEL === '1'
}));

// Redirect /access to /go for consistent token generation and validation
app.get('/access/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  if (!isValidSessionId(sessionId)) {
    return res.status(400).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>❌ Invalid Session</h1></div></body></html>');
  }
  // Redirect to /go for proper session validation and token generation
  res.redirect(307, `/go/${sessionId}`);
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
// 🔒 ENHANCED ANTI-BYPASS JAVASCRIPT
// ==========================================
const ANTI_BYPASS_JS = `
(function(){
  'use strict';
  
  // Bot/Automation Detection
  const detectBot = () => {
    const checks = [
      () => navigator.webdriver === true,
      () => !!window.__selenium,
      () => !!window.__webdriver_script_fn,
      () => !!window.callPhantom || !!window._phantom,
      () => !!window.callSelenium,
      () => !!window.cdc_adoQpoasnfa76pfcZLmcfl_Array,
      () => !!window.cdc_adoQpoasnfa76pfcZLmcfl_Promise,
      () => !!window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol,
      () => !!document.__selenium_evaluate,
      () => !!document.__webdriver_evaluate,
      () => navigator.userAgent.includes('HeadlessChrome'),
      () => navigator.userAgent.includes('PhantomJS'),
      () => navigator.userAgent.includes('Selenium'),
      () => navigator.userAgent.includes('WebDriver'),
      () => /bot|crawler|spider|crawling/i.test(navigator.userAgent),
      () => window.outerWidth === 0 && window.outerHeight === 0,
      () => window.screen.width === 0 || window.screen.height === 0,
      () => !navigator.plugins.length && navigator.userAgent.includes('Chrome'),
      () => navigator.languages === undefined || navigator.languages.length === 0,
      () => window.Notification && Notification.permission === 'default' && !('PushManager' in window),
      () => new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) { resolve(false); return; }
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (!debugInfo) { resolve(false); return; }
        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        resolve(vendor === 'Google Inc. (NVIDIA)' && renderer.includes('SwiftShader'));
      })
    ];
    
    return checks.some(check => {
      try {
        if (check instanceof Promise) return false;
        return check();
      } catch(e) { return false; }
    });
  };
  
  // Run detection
  if (detectBot()) {
    document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#1a1a2e;color:#fff;font-family:sans-serif;"><h1>🤖 Bot Detected</h1></div>';
    setTimeout(() => window.location.href = '/blocked', 100);
    return;
  }
  
  // Prevent DevTools
  const blockDevTools = () => {
    // Block right-click
    document.addEventListener('contextmenu', (e) => { 
      e.preventDefault(); 
      return false; 
    }, true);
    
    // Block keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const blocked = [
        e.key === 'F12',
        e.ctrlKey && ['u', 's', 'i', 'j', 'c', 'p', 'h', 'a'].includes(e.key.toLowerCase()),
        e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase()),
        e.metaKey && ['u', 's', 'i', 'j', 'c'].includes(e.key.toLowerCase()),
        e.key === 'F5' && e.ctrlKey,
        e.key === 'r' && e.ctrlKey
      ];
      if (blocked.some(Boolean)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }, true);
    
    // Detect DevTools open
    const threshold = 160;
    const checkDevTools = () => {
      const widthThreshold = window.outerWidth - window.innerWidth > threshold;
      const heightThreshold = window.outerHeight - window.innerHeight > threshold;
      if (widthThreshold || heightThreshold) {
        document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#1a1a2e;color:#fff;font-family:sans-serif;"><h1>🛡️ Developer Tools Blocked</h1></div>';
        setTimeout(() => window.location.href = '/blocked', 100);
      }
    };
    
    // Check periodically
    setInterval(checkDevTools, 500);
    
    // Disable console
    const noop = () => {};
    ['log', 'debug', 'info', 'warn', 'error', 'table', 'trace'].forEach(method => {
      console[method] = noop;
    });
    
    // Disable debugger
    setInterval(() => {
      Function.prototype.constructor = noop;
      debugger;
    }, 100);
  };
  
  blockDevTools();
  
  // Verify page integrity
  const verifyIntegrity = () => {
    if (document.documentElement.getAttribute('data-verified') !== 'true') {
      // Page was modified, reload
      window.location.reload();
    }
  };
  document.documentElement.setAttribute('data-verified', 'true');
  setInterval(verifyIntegrity, 2000);
  
})();
`;

// ==========================================
// 1. GO PATH (ENHANCED UI)
// ==========================================
app.get('/go/:sessionId', rateLimiter, async (req, res) => {
  const sessionId = req.params.sessionId;
  if (DEBUG) console.log(`[/go] Request: ${sessionId}`);

    if (!isValidSessionId(sessionId)) {
        return res.status(400).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>❌ Invalid Link</h1></div></body></html>');
    }

    try {
        const result = await findSession(sessionId);
        if (!result) {
            if (DEBUG) console.log(`[/go] Session NOT FOUND: ${sessionId}`);
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

  // Generate secure token for this session
  const redirectToken = generateSecureToken();
  redirectTokens.set(redirectToken, {
    sessionId: sessionId,
    shortUrl: sessionData.short_url,
    used: false,
    createdAt: Date.now(),
    expiresAt: Date.now() + TOKEN_EXPIRY_MS
  });

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
  <body data-verified="true">
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
  <script src="/script.js"></script>
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
// 🔐 SECURE REDIRECT API (Token-based, never exposes URL in source)
// ==========================================
app.post('/api/get-redirect-url', rateLimiter, apiGuard, async (req, res) => {
  const { token, session_id } = req.body;
  
  if (!token || !session_id) {
    return res.json({ success: false, message: 'Missing token or session ID' });
  }

  const tokenData = redirectTokens.get(token);
  
  if (!tokenData) {
    return res.json({ success: false, code: 'INVALID_TOKEN' });
  }

  if (tokenData.sessionId !== session_id) {
    return res.json({ success: false, code: 'SESSION_MISMATCH' });
  }

  if (tokenData.used) {
    return res.json({ success: false, code: 'TOKEN_USED' });
  }

  if (Date.now() > tokenData.expiresAt) {
    redirectTokens.delete(token);
    return res.json({ success: false, code: 'TOKEN_EXPIRED' });
  }

  // Verify click was completed for challenge tokens
  if (tokenData.isChallenge && !tokenData.verifiedAt) {
    return res.json({ success: false, code: 'CLICK_REQUIRED' });
  }

  // Mark token as used immediately
  tokenData.used = true;

  // Also mark session as used in database
  try {
    const shardIndex = getShardIndex(session_id);
    const collection = await getDatabase(shardIndex);
    await collection.updateOne(
      { session_id: session_id },
      { $set: { used: true, used_at: new Date() } }
    );
  } catch (err) {
    console.error('[Token] Failed to update session:', err.message);
  }

  // Return the URL - this is the ONLY way to get it
  res.json({ success: true, url: tokenData.shortUrl });
  
  // Clean up token after use
  setTimeout(() => redirectTokens.delete(token), 5000);
});

// ==========================================
// 2. LEGACY LINK PATH (DEPRECATED - BLOCKS DIRECT ACCESS)
// ==========================================
app.get('/link/:sessionId', rateLimiter, async (req, res) => {
  // Block direct access - only token-based access allowed
  res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Blocked</title></head><body style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h1>🚫 Direct Access Blocked</h1><p style="margin-top:10px;color:rgba(255,255,255,0.7)">Please use the verification page.</p></div></body></html>');
});

// ==========================================
// 3. Session Validation API (DEPRECATED - Protected)
// ==========================================
app.get('/api/process-session/:sessionId', rateLimiter, apiGuard, async (req, res) => {
  const sessionId = req.params.sessionId;
  if (!isValidSessionId(sessionId)) return res.json({ success: false, code: 'INVALID_SESSION' });
  try {
    const result = await findSession(sessionId);
    if (!result) return res.json({ success: false, code: 'NOT_FOUND' });
    const sessionData = result.sessionData;
    const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);
    if (ageSeconds > 900) return res.json({ success: false, code: 'EXPIRED' });
    if (sessionData.used) return res.json({ success: false, code: 'ALREADY_USED' });
    if (!sessionData.short_url) return res.json({ success: false, code: 'INCOMPLETE' });
    // Don't expose any path - just return success
    return res.json({ success: true, valid: true });
  } catch (error) {
    console.error('[API] Error:', error.message);
    return res.json({ success: false, code: 'SERVER_ERROR' });
  }
});

// ==========================================
// 🔒 SECURE: Frontend Session Init (No sensitive data exposed)
// ==========================================
app.post('/api/init-session', rateLimiter, apiGuard, async (req, res) => {
  const { session_id } = req.body;
  if (!isValidSessionId(session_id)) {
    return res.json({ success: false, code: 'INVALID_SESSION' });
  }
  
  try {
    const result = await findSession(session_id);
    if (!result) return res.json({ success: false, code: 'NOT_FOUND' });
    
    const sessionData = result.sessionData;
    const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);
    
    if (ageSeconds > 900) return res.json({ success: false, code: 'EXPIRED' });
    if (sessionData.used) return res.json({ success: false, code: 'ALREADY_USED' });
    if (sessionData.access_count >= 3) return res.json({ success: false, code: 'TOO_MANY_ATTEMPTS' });
    
    // Generate challenge token (not the redirect token)
    const challengeToken = generateSecureToken();
    redirectTokens.set(challengeToken, {
      sessionId: session_id,
      shortUrl: sessionData.short_url,
      used: false,
      createdAt: Date.now(),
      expiresAt: Date.now() + TOKEN_EXPIRY_MS,
      isChallenge: true
    });
    
    // Return only what's needed - NO URL exposed
    return res.json({
      success: true,
      challenge_token: challengeToken,
      requires_click: true,
      countdown_seconds: 3
    });
  } catch (error) {
    console.error('[Init-Session] Error:', error.message);
    return res.json({ success: false, code: 'SERVER_ERROR' });
  }
});

// ==========================================
// 🔒 SECURE: Click Verification with Human Behavior Validation
// ==========================================
app.post('/api/verify-click', rateLimiter, apiGuard, async (req, res) => {
  const { session_id, click_time, mouse_movements, challenge_token, screen_data } = req.body;
  
  // Validate required fields
  if (!session_id || !click_time || !challenge_token) {
    return res.json({ success: false, code: 'MISSING_FIELDS' });
  }
  
  // Validate challenge token
  const tokenData = redirectTokens.get(challengeToken);
  if (!tokenData) return res.json({ success: false, code: 'INVALID_TOKEN' });
  if (tokenData.sessionId !== session_id) return res.json({ success: false, code: 'SESSION_MISMATCH' });
  if (Date.now() > tokenData.expiresAt) {
    redirectTokens.delete(challengeToken);
    return res.json({ success: false, code: 'TOKEN_EXPIRED' });
  }
  
  // Human behavior validation (anti-bot)
  const timeSinceClick = Date.now() - parseInt(click_time);
  
  // Minimum human-like timing (100ms)
  if (timeSinceClick < 100) {
    return res.json({ success: false, code: 'BOT_DETECTED' });
  }
  
  // Must have some mouse movement
  if (!mouse_movements || mouse_movements < 1) {
    return res.json({ success: false, code: 'HUMAN_REQUIRED' });
  }
  
  // Screen data validation (basic bot detection)
  if (screen_data) {
    const { width, height, availWidth, availHeight } = screen_data;
    // Headless browsers often report 0 or unusual values
    if (!width || !height || width < 100 || height < 100) {
      return res.json({ success: false, code: 'BOT_DETECTED' });
    }
  }
  
  try {
    // Update session as click-verified
    const shardIndex = getShardIndex(session_id);
    const collection = await getDatabase(shardIndex);
    await collection.updateOne(
      { session_id: session_id },
      { 
        $set: { 
          click_verified: true, 
          click_time: parseInt(click_time),
          click_ip: req.headers['x-forwarded-for']?.split(',')[0] || 'unknown'
        },
        $inc: { access_count: 1 }
      },
      { upsert: false }
    );
    
    // Mark challenge token as verified (convert to redirect token)
    tokenData.isChallenge = false;
    tokenData.verifiedAt = Date.now();
    
    return res.json({ 
      success: true, 
      countdown_seconds: 3,
      message: 'Human verified'
    });
  } catch (error) {
    console.error('[Verify-Click] Error:', error.message);
    return res.json({ success: false, code: 'SERVER_ERROR' });
  }
});

// ==========================================
// 🔐 UNIFIED COMMAND ENDPOINT (All logic moved to backend)
// Frontend only sends commands, backend controls all logic
// ==========================================
const clientSessions = new Map();

app.post('/api/command', rateLimiter, apiGuard, async (req, res) => {
  // Support both short (a, s) and long (action, session_id) field names
  const action = req.body.action || req.body.a;
  const session_id = req.body.session_id || req.body.s;
  const clientIp = getClientIp(req);

  if (!action || !session_id) {
    return res.json({ success: false, error: 'Missing parameters' });
  }

  const commands = [];

  try {
    switch (action) {
      case 'init': {
        // Validate session
        if (!isValidSessionId(session_id)) {
          return res.json({ success: false, commands: [{ type: 'error', data: 'Invalid Session' }] });
        }

        const result = await findSession(session_id);
        if (!result) {
          return res.json({ success: false, commands: [{ type: 'error', data: 'Session not found' }] });
        }

        const sessionData = result.sessionData;
        const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);

        if (ageSeconds > 900) {
          return res.json({ success: false, commands: [{ type: 'error', data: 'Link expired' }] });
        }
        if (sessionData.used) {
          return res.json({ success: false, commands: [{ type: 'error', data: 'Link already used' }] });
        }
        if (sessionData.access_count >= 3) {
          return res.json({ success: false, commands: [{ type: 'error', data: 'Too many attempts' }] });
        }

        // Generate challenge token
        const challengeToken = generateSecureToken();
        redirectTokens.set(challengeToken, {
          sessionId: session_id,
          shortUrl: sessionData.short_url,
          used: false,
          createdAt: Date.now(),
          expiresAt: Date.now() + TOKEN_EXPIRY_MS,
          isChallenge: true,
          clientIp: clientIp,
          verifiedAt: null
        });

        // Store client session state (NOT the URL)
        clientSessions.set(clientIp + '_' + session_id, {
          sessionId: session_id,
          challengeToken: challengeToken,
          initialized: true,
          clicked: false,
          verified: false,
          timestamp: Date.now()
        });

        // Increment access count
        const { collection } = result;
        await collection.updateOne(
          { session_id: session_id },
          { $inc: { access_count: 1 } }
        );

        return res.json({
          success: true,
          commands: [{ type: 'init' }],
          challenge_token: challengeToken
        });
      }

      case 'click': {
        // Validate client session
        const clientSession = clientSessions.get(clientIp + '_' + session_id);
        if (!clientSession || !clientSession.challengeToken) {
          return res.json({ success: false, commands: [{ type: 'error', data: 'Session expired' }] });
        }

        const tokenData = redirectTokens.get(clientSession.challengeToken);
        if (!tokenData) {
          return res.json({ success: false, commands: [{ type: 'error', data: 'Invalid token' }] });
        }

        if (Date.now() > tokenData.expiresAt) {
          redirectTokens.delete(clientSession.challengeToken);
          return res.json({ success: false, commands: [{ type: 'error', data: 'Token expired' }] });
        }

        // Mark as clicked
        clientSession.clicked = true;
        clientSession.clickTime = Date.now();

        // Update token
        tokenData.verifiedAt = Date.now();
        tokenData.isChallenge = false;

        // Update database
        try {
          const shardIndex = getShardIndex(session_id);
          const collection = await getDatabase(shardIndex);
          await collection.updateOne(
            { session_id: session_id },
            {
              $set: {
                click_verified: true,
                click_time: new Date(),
                click_ip: clientIp
              }
            }
          );
        } catch (err) {
          console.error('[Command] Update error:', err.message);
        }

        return res.json({
          success: true,
          commands: [
            { type: 'verifying' },
            { type: 'success' },
            { type: 'countdown', data: 3 }
          ]
        });
      }

      case 'redirect': {
        // Validate client session
        const clientSession = clientSessions.get(clientIp + '_' + session_id);
        if (!clientSession || !clientSession.challengeToken) {
          return res.json({ success: false, commands: [{ type: 'error', data: 'Session expired' }] });
        }

        const tokenData = redirectTokens.get(clientSession.challengeToken);
        if (!tokenData) {
          return res.json({ success: false, commands: [{ type: 'error', data: 'Token expired' }] });
        }

        if (!tokenData.verifiedAt) {
          return res.json({ success: false, commands: [{ type: 'error', data: 'Verification required' }] });
        }

        if (tokenData.used) {
          return res.json({ success: false, commands: [{ type: 'error', data: 'Already used' }] });
        }

        // Get URL and mark as used
        const redirectUrl = tokenData.shortUrl;
        tokenData.used = true;

        // Update database
        try {
          const shardIndex = getShardIndex(session_id);
          const collection = await getDatabase(shardIndex);
          await collection.updateOne(
            { session_id: session_id },
            { $set: { used: true, used_at: new Date() } }
          );
        } catch (err) {
          console.error('[Command] Final update error:', err.message);
        }

        // Clean up
        setTimeout(() => {
          redirectTokens.delete(clientSession.challengeToken);
          clientSessions.delete(clientIp + '_' + session_id);
        }, 5000);

        // Return redirect command with URL
        return res.json({
          success: true,
          commands: [{ type: 'redirect', data: redirectUrl }]
        });
      }

      default:
        return res.json({ success: false, commands: [{ type: 'error', data: 'Unknown command' }] });
    }
  } catch (error) {
    console.error('[Command] Error:', error.message);
    return res.json({ success: false, commands: [{ type: 'error', data: 'Server error' }] });
  }
});

// Short alias for command endpoint (to obscure from bypass tools)
// Shares same logic as /api/command
app.post('/api/c', rateLimiter, apiGuard, async (req, res) => {
  // Support both short (a, s) and long (action, session_id) field names
  const action = req.body.action || req.body.a;
  const session_id = req.body.session_id || req.body.s;
  const clientIp = getClientIp(req);

  if (!action || !session_id) {
    return res.json({ success: false, error: 'Missing parameters' });
  }

  const commands = [];

  try {
    switch (action) {
      case 'i': { // init (shorter action code)
        // Validate session
        if (!isValidSessionId(session_id)) {
          return res.json({ success: false, commands: [{ t: 'e', d: 'Invalid Session' }] });
        }

        const result = await findSession(session_id);
        if (!result) {
          return res.json({ success: false, commands: [{ t: 'e', d: 'Session not found' }] });
        }

        const sessionData = result.sessionData;
        const ageSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);

        if (ageSeconds > 900) {
          return res.json({ success: false, commands: [{ t: 'e', d: 'Link expired' }] });
        }
        if (sessionData.used) {
          return res.json({ success: false, commands: [{ t: 'e', d: 'Link already used' }] });
        }
        if (sessionData.access_count >= 3) {
          return res.json({ success: false, commands: [{ t: 'e', d: 'Too many attempts' }] });
        }

        // Generate challenge token
        const challengeToken = generateSecureToken();
        redirectTokens.set(challengeToken, {
          sessionId: session_id,
          shortUrl: sessionData.short_url,
          used: false,
          createdAt: Date.now(),
          expiresAt: Date.now() + TOKEN_EXPIRY_MS,
          isChallenge: true,
          clientIp: clientIp,
          verifiedAt: null
        });

        // Store client session state
        clientSessions.set(clientIp + '_' + session_id, {
          sessionId: session_id,
          challengeToken: challengeToken,
          initialized: true,
          clicked: false,
          timestamp: Date.now()
        });

        // Increment access count
        const { collection } = result;
        await collection.updateOne(
          { session_id: session_id },
          { $inc: { access_count: 1 } }
        );

        return res.json({
          success: true,
          c: [{ t: 'ui', d: { id: 'btn', styles: { display: 'inline-block' } } }],
          k: challengeToken
        });
      }

      case 'c': { // click
        const clientSession = clientSessions.get(clientIp + '_' + session_id);
        if (!clientSession || !clientSession.challengeToken) {
          return res.json({ success: false, commands: [{ t: 'e', d: 'Session expired' }] });
        }

        const tokenData = redirectTokens.get(clientSession.challengeToken);
        if (!tokenData) {
          return res.json({ success: false, commands: [{ t: 'e', d: 'Invalid token' }] });
        }

        if (Date.now() > tokenData.expiresAt) {
          redirectTokens.delete(clientSession.challengeToken);
          return res.json({ success: false, commands: [{ t: 'e', d: 'Token expired' }] });
        }

        // Mark as clicked
        clientSession.clicked = true;
        clientSession.clickTime = Date.now();
        tokenData.verifiedAt = Date.now();
        tokenData.isChallenge = false;

        // Update database
        try {
          const shardIndex = getShardIndex(session_id);
          const collection = await getDatabase(shardIndex);
          await collection.updateOne(
            { session_id: session_id },
            {
              $set: {
                click_verified: true,
                click_time: new Date(),
                click_ip: clientIp
              }
            }
          );
        } catch (err) {
          console.error('[c] Update error:', err.message);
        }

        // Return countdown sequence
        return res.json({
          success: true,
          c: [
            { t: 'ui', d: { id: 'btn', styles: { disabled: true }, text: '✓ Verified' } },
            { t: 'ui', d: { id: 'shieldWrapper', styles: { display: 'none' } } },
            { t: 'ui', d: { id: 'loaderWrapper', styles: { display: 'none' } } },
            { t: 'ui', d: { id: 'checkMark', class: 'show' } },
            { t: 'ui', d: { id: 'title', text: '✅ Access Granted' } },
            { t: 'ui', d: { id: 'message', text: 'Redirecting...' } },
            { t: 'ui', d: { id: 'countdownBox', styles: { display: 'block' } } },
            { t: 'ui', d: { id: 'progressBar', styles: { display: 'block' } } },
            { t: 'ui', d: { id: 'progress', styles: { transition: 'width 3s linear', width: '100%' } } }
          ]
        });
      }

      case 'r': { // redirect
        const clientSession = clientSessions.get(clientIp + '_' + session_id);
        if (!clientSession || !clientSession.challengeToken) {
          return res.json({ success: false, commands: [{ t: 'e', d: 'Session expired' }] });
        }

        const tokenData = redirectTokens.get(clientSession.challengeToken);
        if (!tokenData) {
          return res.json({ success: false, commands: [{ t: 'e', d: 'Token expired' }] });
        }

        if (!tokenData.verifiedAt) {
          return res.json({ success: false, commands: [{ t: 'e', d: 'Verification required' }] });
        }

        if (tokenData.used) {
          return res.json({ success: false, commands: [{ t: 'e', d: 'Already used' }] });
        }

        // Get URL and mark as used
        const redirectUrl = tokenData.shortUrl;
        tokenData.used = true;

        // Update database
        try {
          const shardIndex = getShardIndex(session_id);
          const collection = await getDatabase(shardIndex);
          await collection.updateOne(
            { session_id: session_id },
            { $set: { used: true, used_at: new Date() } }
          );
        } catch (err) {
          console.error('[c] Final update error:', err.message);
        }

        // Clean up
        setTimeout(() => {
          redirectTokens.delete(clientSession.challengeToken);
          clientSessions.delete(clientIp + '_' + session_id);
        }, 5000);

        return res.json({
          success: true,
          c: [{ t: 'r', d: redirectUrl }]
        });
      }

      default:
        return res.json({ success: false, commands: [{ t: 'e', d: 'Unknown command' }] });
    }
  } catch (error) {
    console.error('[c] Error:', error.message);
    return res.json({ success: false, commands: [{ t: 'e', d: 'Server error' }] });
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
                    first_access_ip: getClientIp(req)
                }
            },
            { upsert: true }
        );
        if (DEBUG) console.log(`[Store] ✅ Stored: ${session_id}`);
        return res.json({ success: true });
    } catch (error) {
        console.error('[Store] Error:', error.message);
        return res.status(500).json({ success: false });
    }
});

// ==========================================
// 404 & Error Handlers
// ==========================================
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

if (require.main === module) {
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

module.exports = app;
