const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection
let db;
let sessionsCollection;
let mongoClient;

// Initialize MongoDB connection with better error handling
async function initDatabase() {
  try {
    console.log('🔄 Attempting MongoDB connection...');
    
    // Use environment variable, fallback to hardcoded for testing
    const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/redirect_service?appName=Cluster0';
    
    console.log('🔗 Connecting to:', mongoUri.split('@')[1]); // Log without credentials
    
    const client = new MongoClient(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 3,
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 10000,
      retryWrites: true,
      retryReads: true
    });
    
    // Connect with timeout
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('MongoDB connection timeout')), 15000)
      )
    ]);
    
    mongoClient = client;
    db = client.db('redirect_service');
    sessionsCollection = db.collection('sessions');
    
    // Test the connection
    await db.command({ ping: 1 });
    console.log('✅ MongoDB connected successfully');
    
    // Create indexes for better performance and automatic cleanup
    try {
      await sessionsCollection.createIndex({ "session_id": 1 }, { unique: true });
      await sessionsCollection.createIndex({ "created_at": 1 }, { expireAfterSeconds: 1800 }); // 30 minutes TTL
      await sessionsCollection.createIndex({ "used_at": 1 }, { expireAfterSeconds: 300 }); // 5 minutes for used sessions
      console.log('📚 MongoDB indexes created successfully');
    } catch (indexError) {
      console.log('⚠️ Index creation warning (may already exist):', indexError.message);
    }
    
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.error('🔧 Troubleshooting tips:');
    console.error('   1. Check MongoDB Atlas connection string');
    console.error('   2. Verify IP whitelist in MongoDB Atlas');
    console.error('   3. Check username/password credentials');
    console.error('   4. Ensure MongoDB cluster is running');
    
    db = null;
    sessionsCollection = null;
    mongoClient = null;
  }
}

// Retry connection every 30 seconds if it fails
setInterval(async () => {
  if (!db) {
    console.log('🔁 Retrying MongoDB connection...');
    await initDatabase();
  }
}, 30000);

// Initialize database on startup
initDatabase();

// Fallback session storage (in-memory) when MongoDB fails
const fallbackSessions = new Map();

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
  } else if (fallbackSessions.size > 0) {
    // Cleanup fallback sessions
    const now = Date.now();
    let cleaned = 0;
    for (const [sessionId, session] of fallbackSessions) {
      if (now - session.created_at.getTime() > 30 * 60 * 1000) { // 30 minutes
        fallbackSessions.delete(sessionId);
        cleaned++;
      }
    }
    console.log(`🧹 Fallback cleanup: ${cleaned} sessions`);
    return cleaned;
  }
  return 0;
}

// Run cleanup every 5 minutes
setInterval(cleanupOldSessions, 5 * 60 * 1000);

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

console.log('📦 Static files middleware loaded');

// Session storage functions with fallback
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
    // Fallback to in-memory storage
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
    // Fallback to in-memory storage
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
    // Fallback to in-memory storage
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

// Rate limiting
const requestCounts = new Map();
const RATE_LIMIT = 100;
const TIME_WINDOW = 60000;

function checkRateLimit(ip) {
  const now = Date.now();
  const requestData = requestCounts.get(ip) || { count: 0, resetTime: 0 };
  
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
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    console.log('🚨 Rate limit exceeded for IP:', ip);
    return res.status(429).json({ 
      success: false, 
      message: 'Rate limit exceeded. Please try again later.' 
    });
  }
  next();
});

// DEBUG ENDPOINTS
app.get('/debug/session/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  console.log('🔍 Debug session request:', sessionId);
  
  if (sessionsCollection) {
    try {
      const session = await sessionsCollection.findOne({ session_id: sessionId });
      res.json({
        session: session,
        found: !!session,
        storage: 'mongodb',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.json({ error: error.message, storage: 'mongodb' });
    }
  } else {
    const session = fallbackSessions.get(sessionId);
    res.json({
      session: session,
      found: !!session,
      storage: 'fallback',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/debug/status', async (req, res) => {
  const status = {
    database: db ? 'connected' : 'disconnected',
    sessions: sessionsCollection ? 'mongodb' : 'fallback',
    fallbackCount: fallbackSessions.size,
    timestamp: new Date().toISOString()
  };
  
  if (sessionsCollection) {
    try {
      status.sessionCount = await sessionsCollection.countDocuments();
    } catch (error) {
      status.sessionCount = 'error';
    }
  }
  
  res.json(status);
});

// API endpoint - RECEIVE session data from bot
app.post('/api/store-session', async (req, res) => {
  const { session_id, short_url, user_id } = req.body;
  
  console.log('📥 === STORING NEW SESSION ===');
  console.log('Session ID:', session_id);
  console.log('Database status:', db ? 'connected' : 'disconnected');
  
  if (!session_id || !short_url) {
    console.log('❌ Missing required fields');
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required fields: session_id and short_url' 
    });
  }
  
  const sessionData = {
    short_url: short_url,
    created_at: new Date(),
    used: false
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
  const sessionId = req.params.sessionId;
  console.log('🔄 === PROCESSING SESSION REQUEST ===');
  console.log('Session ID:', sessionId);
  console.log('Database status:', db ? 'connected' : 'disconnected');
  
  try {
    const sessionData = await getSession(sessionId);
    console.log('🔍 Session found:', !!sessionData);
    
    if (!sessionData) {
      console.log('❌ Session not found:', sessionId);
      return res.json({
        success: false,
        message: 'Session not found or expired. Please request a new link from the bot.'
      });
    }
    
    const sessionAgeMinutes = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 60000);
    console.log('🕒 Session age:', sessionAgeMinutes, 'minutes');
    
    if (sessionAgeMinutes > 30) {
      console.log('⏰ Session expired');
      return res.json({
        success: false,
        message: 'Session expired. Please request a new link from the bot.'
      });
    }
    
    if (sessionData.used) {
      console.log('🚫 Session already used');
      return res.json({
        success: false,
        message: 'This link has already been used. Please request a new one from the bot.'
      });
    }
    
    const usedSession = await useSession(sessionId);
    
    if (usedSession) {
      console.log('✅ Session processed successfully');
      res.json({
        success: true,
        redirect_url: sessionData.short_url,
        message: 'Redirecting to destination...'
      });
    } else {
      console.log('❌ Failed to mark session as used');
      res.json({
        success: false,
        message: 'Session processing failed. Please try again.'
      });
    }
  } catch (error) {
    console.error('💥 Session processing error:', error.message);
    res.json({
      success: false,
      message: 'Session processing failed. Please try again.'
    });
  }
});

// Access route for session pages
app.get('/access/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  console.log('🌐 Access page requested:', sessionId);
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
    storage: sessionsCollection ? 'mongodb' : 'fallback',
    fallbackSessions: fallbackSessions.size,
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
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error' 
  });
});

// Export for Vercel
module.exports = app;

// Start server if running locally
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  });
}
