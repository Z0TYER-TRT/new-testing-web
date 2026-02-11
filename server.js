const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting configuration
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests from this IP, please try again later',
  headers: true,
});

// MongoDB connection
let db;
let sessionsCollection;
let mongoClient;

// Initialize MongoDB connection with better error handling
async function initDatabase() {
  try {
    console.log('🔄 Attempting MongoDB connection...');
    
    const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/redirect_service?appName=Cluster0';
    
    console.log('🔗 Connecting to:', mongoUri.split('@')[1]);
    
    const client = new MongoClient(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 3,
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 10000,
      retryWrites: true,
      retryReads: true
    });
    
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('MongoDB connection timeout')), 15000)
      )
    ]);
    
    mongoClient = client;
    db = client.db('redirect_service');
    sessionsCollection = db.collection('sessions');
    
    await db.command({ ping: 1 });
    console.log('✅ MongoDB connected successfully');
    
    // Create indexes
    await sessionsCollection.createIndex({ "session_id": 1 }, { unique: true });
    await sessionsCollection.createIndex({ "created_at": 1 }, { expireAfterSeconds: 1800 });
    await sessionsCollection.createIndex({ "used_at": 1 }, { expireAfterSeconds: 300 });
    
    console.log('📚 MongoDB indexes created successfully');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    db = null;
    sessionsCollection = null;
    mongoClient = null;
  }
}

// Retry connection every 30 seconds
setInterval(async () => {
  if (!db) {
    console.log('🔁 Retrying MongoDB connection...');
    await initDatabase();
  }
}, 30000);

// Initialize database
initDatabase();

// In-memory storage for fallback
const fallbackSessions = new Map();
const suspiciousIPs = new Set();
const ipRequestHistory = new Map();

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
      
      console.log(`🧹 MongoDB cleanup: ${result1.deletedCount} old, ${result2.deletedCount} used`);
      return result1.deletedCount + result2.deletedCount;
    } catch (error) {
      console.error('❌ MongoDB cleanup error:', error.message);
      return 0;
    }
  } else {
    const now = Date.now();
    let cleaned = 0;
    for (const [sessionId, session] of fallbackSessions) {
      if (now - session.created_at.getTime() > 30 * 60 * 1000) {
        fallbackSessions.delete(sessionId);
        cleaned++;
      }
    }
    console.log(`🧹 Fallback cleanup: ${cleaned} sessions`);
    return cleaned;
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupOldSessions, 5 * 60 * 1000);

// Advanced security middleware
function trackRequest(ip) {
  if (suspiciousIPs.has(ip)) {
    return true;
  }

  if (!ipRequestHistory.has(ip)) {
    ipRequestHistory.set(ip, {
      count: 0,
      lastRequest: Date.now(),
      suspicious: false
    });
    return false;
  }

  const history = ipRequestHistory.get(ip);
  history.count++;
  history.lastRequest = Date.now();

  // Check for suspicious activity
  if (history.count > 50 && Date.now() - history.lastRequest < 60000) {
    history.suspicious = true;
    suspiciousIPs.add(ip);
    console.log(`⚠️ Suspicious IP detected: ${ip}`);
    return true;
  }

  return false;
}

// Security middleware
app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  
  // Block suspicious IPs
  if (suspiciousIPs.has(ip)) {
    console.log(`❌ Blocked request from suspicious IP: ${ip}`);
    return res.status(403).send('Access denied');
  }

  // Track request and check for suspicious activity
  if (trackRequest(ip)) {
    return res.status(403).send('Access denied');
  }

  next();
});

// Apply rate limiting to API endpoints
app.use('/api/', apiLimiter);

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

console.log('📦 Static files middleware loaded');

// Session storage functions
async function storeSession(sessionId, sessionData) {
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
      console.log(`💾 MongoDB session stored: ${sessionId}`);
      return true;
    } catch (error) {
      console.error('❌ MongoDB store error:', error.message);
      return false;
    }
  } else {
    fallbackSessions.set(sessionId, {
      ...sessionData,
      session_id: sessionId,
      created_at: new Date()
    });
    console.log(`💾 Fallback session stored: ${sessionId}`);
    return true;
  }
}

async function getSession(sessionId) {
  if (sessionsCollection) {
    try {
      const session = await sessionsCollection.findOne({ session_id: sessionId });
      return session;
    } catch (error) {
      console.error('❌ MongoDB get error:', error.message);
      return null;
    }
  } else {
    const session = fallbackSessions.get(sessionId);
    console.log(`💾 Fallback session retrieved: ${sessionId}, found: ${!!session}`);
    return session || null;
  }
}

async function useSession(sessionId) {
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
  } else {
    const session = fallbackSessions.get(sessionId);
    if (session && !session.used) {
      session.used = true;
      session.used_at = new Date();
      fallbackSessions.set(sessionId, session);
      console.log(`💾 Fallback session used: ${sessionId}`);
      return session;
    }
    return null;
  }
}

// API endpoint - STORE session
app.post('/api/store-session', async (req, res) => {
  const { session_id, short_url, user_id } = req.body;
  
  if (!session_id || !short_url) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required fields: session_id and short_url' 
    });
  }

  const sessionData = {
    short_url: short_url,
    created_at: new Date(),
    used: false,
    user_id: user_id || null
  };

  const stored = await storeSession(session_id, sessionData);
  
  if (stored) {
    console.log('✅ Session stored successfully:', session_id);
    res.json({ success: true, message: 'Session stored successfully' });
  } else {
    console.log('❌ Failed to store session');
    res.status(500).json({ success: false, message: 'Failed to store session' });
  }
});

// API endpoint - PROCESS session for redirect
app.get('/api/process-session/:sessionId', async (req, res) => {
  // Extract session ID from URL path only (ignoring query parameters)
  const sessionId = req.params.sessionId;
  console.log(`🔄 Processing session: ${sessionId} (URL: ${req.originalUrl})`);

  try {
    const sessionData = await getSession(sessionId);
    
    if (!sessionData) {
      console.log('❌ Session not found');
      
      // Check if this is likely a bypass attempt
      if (req.originalUrl.includes('&') || req.originalUrl.includes('?')) {
        console.log('⚠️ Possible bypass attempt detected');
      }
      
      return res.status(400).json({ message: 'Session not found' });
    }

    // Check session age (15 minutes)
    const sessionAgeSeconds = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 1000);
    if (sessionAgeSeconds > 900) {
      console.log('⏰ Session expired');
      return res.status(400).json({ message: 'Session expired' });
    }

    // Handle used session
    if (sessionData.used) {
      console.log('🚫 Session already used');
      return res.status(400).json({ message: 'Link already used' });
    }

    // Process session
    const usedSession = await useSession(sessionId);
    if (usedSession) {
      console.log('✅ Session processed successfully');
      return res.json({
        success: true,
        redirect_url: sessionData.short_url,
        message: 'Redirecting to destination...'
      });
    }

    console.log('❌ Failed to mark session as used');
    res.status(400).json({ message: 'Session processing failed' });
  } catch (error) {
    console.error('💥 Session processing error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Access route for session pages
app.get('/access/:sessionId', (req, res) => {
  // Always serve the index.html regardless of query parameters
  console.log('🌐 Access page requested:', req.params.sessionId);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Root route
app.get('/', (req, res) => {
  console.log('🏠 Root page requested');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', async (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: db ? 'connected' : 'disconnected',
    suspiciousIPs: suspiciousIPs.size,
    uptime: process.uptime()
  };

  if (sessionsCollection) {
    try {
      await sessionsCollection.findOne({});
      health.sessionQuery = 'working';
    } catch (error) {
      health.sessionQuery = 'failed';
    }
  }

  res.json(health);
});

// 404 handler
app.use((req, res) => {
  console.log('404 - Not found:', req.url);
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

// Export for Vercel
module.exports = app;

// Start server if running locally
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}
