const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 🔐 SECURITY CONFIGURATION
// ==========================================
// CHANGE THIS to your own secret password!
const API_SECRET_KEY = "redirect_kawaii_secure_key_2025"; 
// ==========================================

// MongoDB connection
let db;
let sessionsCollection;
let mongoClient;

// In-memory cache for high-performance access
const sessionCache = new Map();
const CACHE_TTL = 300000; // 5 minutes cache

// Performance optimization flags
const ENABLE_CACHE = true;
const ENABLE_COMPRESSION = true;
const HIGH_PERFORMANCE_MODE = true;

// Initialize MongoDB connection with high-performance settings
async function initDatabase() {
  try {
    console.log('🔄 Attempting MongoDB connection...');
    
    // Use environment variable, fallback to hardcoded for testing
    const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/redirect_service?appName=Cluster0';
    
    console.log('🔗 Connecting to MongoDB...');
    
    const client = new MongoClient(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 50,              // Increased pool size for high concurrency
      minPoolSize: 10,              // Maintain minimum connections
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 8000,
      retryWrites: true,
      retryReads: true,
      maxIdleTimeMS: 30000,         // Close idle connections after 30s
      waitQueueTimeoutMS: 2000      // Queue timeout
    });
    
    // Connect with timeout
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('MongoDB connection timeout')), 10000)
      )
    ]);
    
    mongoClient = client;
    db = client.db('redirect_service');
    sessionsCollection = db.collection('sessions');
    
    // Test the connection
    await db.command({ ping: 1 });
    console.log('✅ MongoDB connected successfully');
    
    // Create optimized indexes
    try {
      await sessionsCollection.createIndex({ "session_id": 1 }, { unique: true });
      await sessionsCollection.createIndex({ "created_at": 1 }, { expireAfterSeconds: 1800 }); // 30 minutes TTL
      await sessionsCollection.createIndex({ "used_at": 1 }, { expireAfterSeconds: 300 }); // 5 minutes for used sessions
      await sessionsCollection.createIndex({ "used": 1, "created_at": -1 }); // For query optimization
      console.log('📚 MongoDB indexes created successfully');
    } catch (indexError) {
      console.log('⚠️ Index creation warning:', indexError.message);
    }
    
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    db = null;
    sessionsCollection = null;
    mongoClient = null;
  }
}

// Retry connection every 15 seconds if it fails
setInterval(async () => {
  if (!db) {
    console.log('🔁 Retrying MongoDB connection...');
    await initDatabase();
  }
}, 15000);

// Initialize database on startup
initDatabase();

// Cache cleanup function
function cleanupCache() {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of sessionCache) {
    if (now - value.timestamp > CACHE_TTL) {
      sessionCache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`🧹 Cache cleanup: ${cleaned} entries removed`);
  }
}

// Run cache cleanup every 2 minutes
setInterval(cleanupCache, 120000);

// Manual cleanup function for old sessions
async function cleanupOldSessions() {
  if (sessionsCollection) {
    try {
      const cutoffDate = new Date(Date.now() - 30 * 60 * 1000);
      const result1 = await sessionsCollection.deleteMany({
        created_at: { $lt: cutoffDate }
      });
      
      const usedCutoff = new Date(Date.now() - 5 * 60 * 1000);
      const result2 = await sessionsCollection.deleteMany({
        used: true,
        used_at: { $lt: usedCutoff }
      });
      
      if (result1.deletedCount > 0 || result2.deletedCount > 0) {
        console.log(`🧹 MongoDB cleanup: ${result1.deletedCount} old, ${result2.deletedCount} used`);
      }
      return result1.deletedCount + result2.deletedCount;
    } catch (error) {
      console.error('❌ MongoDB cleanup error:', error.message);
      return 0;
    }
  }
  return 0;
}

// Run cleanup every 3 minutes
setInterval(cleanupOldSessions, 180000);

// Middleware with performance optimizations
if (ENABLE_COMPRESSION) {
  app.use(require('compression')());
}

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',           // Cache static assets for 1 hour
  etag: true,
  lastModified: true
}));

app.use(express.json({ 
  limit: '1mb',           // Reduced limit for better performance
  strict: true 
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '1mb'            // Reduced limit for better performance
}));

// High-performance rate limiting
const requestCounts = new Map();
const RATE_LIMIT = 5000;    // Increased to 5K requests per IP per minute
const TIME_WINDOW = 60000;
const IP_MEMORY_LIMIT = 10000; // Limit stored IPs to prevent memory issues

function checkRateLimit(ip) {
  // Clean up old IPs periodically to prevent memory leaks
  if (requestCounts.size > IP_MEMORY_LIMIT) {
    const now = Date.now();
    for (const [storedIp, data] of requestCounts) {
      if (now - data.lastAccess > 300000) { // Remove IPs not accessed in 5 minutes
        requestCounts.delete(storedIp);
      }
    }
  }

  const now = Date.now();
  const requestData = requestCounts.get(ip) || { 
    count: 0, 
    resetTime: 0, 
    lastAccess: now 
  };
  
  requestData.lastAccess = now;
  
  if (now > requestData.resetTime) {
    requestData.count = 0;
    requestData.resetTime = now + TIME_WINDOW;
  }
  
  requestData.count++;
  requestCounts.set(ip, requestData);
  
  return requestData.count <= RATE_LIMIT;
}

// Middleware for rate limiting
app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  
  // Skip rate limiting for health checks and debug endpoints
  if (req.path === '/health' || req.path.startsWith('/debug')) {
    return next();
  }
  
  if (!checkRateLimit(ip)) {
    console.log(`🚨 Rate limit exceeded for IP: ${ip.substring(0, 20)}`);
    return res.status(429).json({ 
      success: false, 
      message: 'Rate limit exceeded. Please try again later.' 
    });
  }
  next();
});

// Enhanced cache functions
function cacheSession(sessionId, sessionData) {
  if (ENABLE_CACHE) {
    sessionCache.set(sessionId, {
      data: sessionData,
      timestamp: Date.now()
    });
  }
}

function getCachedSession(sessionId) {
  if (!ENABLE_CACHE) return null;
  
  const cached = sessionCache.get(sessionId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function invalidateCache(sessionId) {
  if (ENABLE_CACHE) {
    sessionCache.delete(sessionId);
  }
}

// Optimized session storage functions
async function storeSession(sessionId, sessionData) {
  // Always cache first for fast access
  cacheSession(sessionId, sessionData);
  
  if (sessionsCollection) {
    try {
      const result = await sessionsCollection.updateOne(
        { session_id: sessionId },
        { 
          $set: {
            session_id: sessionId,
            ...sessionData,
            created_at: new Date()
          }
        },
        { upsert: true }
      );
      return true;
    } catch (error) {
      console.error('❌ MongoDB store error:', error.message);
      return true; // Still return true since cache succeeded
    }
  }
  return true; // Cache-only storage
}

async function getSession(sessionId) {
  // First check cache
  const cached = getCachedSession(sessionId);
  if (cached) {
    return cached;
  }
  
  // Then check database
  if (sessionsCollection) {
    try {
      const session = await sessionsCollection.findOne({ session_id: sessionId });
      if (session) {
        cacheSession(sessionId, session); // Cache for next access
        return session;
      }
    } catch (error) {
      console.error('❌ MongoDB get error:', error.message);
    }
  }
  
  return null;
}

async function useSession(sessionId) {
  // Invalidate cache immediately
  invalidateCache(sessionId);
  
  if (sessionsCollection) {
    try {
      const result = await sessionsCollection.findOneAndUpdate(
        { session_id: sessionId, used: false },
        { $set: { used: true, used_at: new Date() } },
        { returnDocument: 'after' }
      );
      return result.value;
    } catch (error) {
      console.error('❌ MongoDB use error:', error.message);
      return null;
    }
  }
  return null;
}

// DEBUG ENDPOINTS (Limited logging for performance)
app.get('/debug/status', async (req, res) => {
  const status = {
    status: 'OK',
    database: db ? 'connected' : 'disconnected',
    cacheSize: sessionCache.size,
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage()
  };
  
  res.json(status);
});

// API endpoint - RECEIVE session data from bot (HIGH PERFORMANCE)
app.post('/api/store-session', async (req, res) => {
  // Security check (minimal logging for performance)
  const clientKey = req.headers['x-api-key'];
  if (clientKey !== API_SECRET_KEY) {
    return res.status(403).json({ 
      success: false, 
      message: 'Access Denied: Invalid API Key' 
    });
  }

  const { session_id, short_url, user_id } = req.body;
  
  if (!session_id || !short_url) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required fields' 
    });
  }
  
  const sessionData = {
    short_url: short_url,
    created_at: new Date(),
    used: false,
    user_id: user_id || null
  };
  
  try {
    const stored = await storeSession(session_id, sessionData);
    if (stored) {
      res.json({ success: true, message: 'Session stored' });
    } else {
      res.status(500).json({ success: false, message: 'Failed to store' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Storage error' });
  }
});

// API endpoint - PROCESS session for redirect (OPTIMIZED)
app.get('/api/process-session/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  
  try {
    // Fast path: check cache first
    let sessionData = getCachedSession(sessionId);
    
    // If not in cache, get from database
    if (!sessionData) {
      sessionData = await getSession(sessionId);
    }
    
    if (!sessionData) {
      return res.json({
        success: false,
        message: 'Session not found. Please try again.'
      });
    }
    
    // Check session age (15 minutes)
    const sessionAgeSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);
    if (sessionAgeSeconds > 900) {
      return res.json({
        success: false,
        message: 'Session expired. Request new link.'
      });
    }
    
    if (sessionData.used) {
      return res.json({
        success: false,
        message: 'Link already used. Request new one.'
      });
    }
    
    // Mark as used and redirect immediately
    const usedSession = await useSession(sessionId);
    
    if (usedSession || sessionData) { // Accept either cached or DB result
      res.json({
        success: true,
        redirect_url: sessionData.short_url,
        message: 'Redirecting...'
      });
    } else {
      res.json({
        success: false,
        message: 'Processing failed. Try again.'
      });
    }
  } catch (error) {
    res.json({
      success: false,
      message: 'Processing error'
    });
  }
});

// Access route for session pages
app.get('/access/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check (minimal processing)
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: Date.now(),
    database: db ? 'connected' : 'disconnected'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling (minimal logging)
app.use((err, req, res, next) => {
  res.status(500).json({ 
    success: false, 
    message: 'Internal error' 
  });
});

// Export for Vercel
module.exports = app;

// Start server if running locally
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  });
}
