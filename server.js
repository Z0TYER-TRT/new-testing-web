const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection
let db;
let sessionsCollection;

// Initialize MongoDB connection
async function initDatabase() {
  try {
    // Use environment variable in production, fallback for local development
    const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/redirect_service?appName=Cluster0';
    
    const client = new MongoClient(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 10000, // Increased timeout
    });
    
    await client.connect();
    db = client.db('redirect_service');
    sessionsCollection = db.collection('sessions');
    
    // Create indexes for better performance and automatic cleanup
    await sessionsCollection.createIndex({ "session_id": 1 }, { unique: true });
    await sessionsCollection.createIndex({ "created_at": 1 }, { expireAfterSeconds: 1800 }); // 30 minutes TTL
    await sessionsCollection.createIndex({ "used_at": 1 }, { expireAfterSeconds: 300 }); // 5 minutes for used sessions
    
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    db = null;
    sessionsCollection = null;
  }
}

// Initialize database on startup
initDatabase();

// Manual cleanup function for old sessions
async function cleanupOldSessions() {
  if (sessionsCollection) {
    try {
      // Delete sessions older than 30 minutes
      const cutoffDate = new Date(Date.now() - 30 * 60 * 1000);
      const result1 = await sessionsCollection.deleteMany({
        created_at: { $lt: cutoffDate }
      });
      
      // Delete used sessions older than 5 minutes
      const usedCutoff = new Date(Date.now() - 5 * 60 * 1000);
      const result2 = await sessionsCollection.deleteMany({
        used: true,
        used_at: { $lt: usedCutoff }
      });
      
      // Limit total sessions to prevent database overload
      const totalSessions = await sessionsCollection.countDocuments();
      let result3 = { deletedCount: 0 };
      if (totalSessions > 5000) { // Limit to 5000 sessions
        const excessCount = totalSessions - 5000;
        // Delete oldest sessions if we exceed limit
        const oldestSessions = await sessionsCollection.find({}).sort({ created_at: 1 }).limit(excessCount).toArray();
        if (oldestSessions.length > 0) {
          const sessionIds = oldestSessions.map(s => s.session_id);
          result3 = await sessionsCollection.deleteMany({
            session_id: { $in: sessionIds }
          });
        }
      }
      
      console.log(`🧹 Cleaned up ${result1.deletedCount} old sessions, ${result2.deletedCount} used sessions, ${result3.deletedCount} excess sessions`);
      return result1.deletedCount + result2.deletedCount + result3.deletedCount;
    } catch (error) {
      console.error('❌ Cleanup error:', error);
      return 0;
    }
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

// Session storage functions with MongoDB
async function storeSession(sessionId, sessionData) {
  if (sessionsCollection) {
    try {
      // Check session count and cleanup if needed
      const sessionCount = await sessionsCollection.countDocuments();
      if (sessionCount > 4000) {
        console.log('⚠️ Session count high, triggering cleanup');
        await cleanupOldSessions();
      }
      
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
      
      console.log(`💾 Session stored - Modified: ${result.modifiedCount}, Upserted: ${result.upsertedCount}`);
      return true;
    } catch (error) {
      console.error('❌ MongoDB store error:', error);
      return false;
    }
  }
  console.log('❌ No database connection for storing session');
  return false;
}

async function getSession(sessionId) {
  if (sessionsCollection) {
    try {
      const session = await sessionsCollection.findOne({ session_id: sessionId });
      return session;
    } catch (error) {
      console.error('❌ MongoDB get error:', error);
      return null;
    }
  }
  console.log('❌ No database connection for getting session');
  return null;
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
      console.error('❌ MongoDB use error:', error);
      return null;
    }
  }
  console.log('❌ No database connection for using session');
  return null;
}

// Rate limiting (simple in-memory for Vercel free tier)
const requestCounts = new Map();
const RATE_LIMIT = 100; // Increased limit
const TIME_WINDOW = 60000; // 1 minute

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

// DEBUG ENDPOINT - Remove in production!
app.get('/debug/session/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  console.log('🔍 Debug session request:', sessionId);
  
  if (!sessionsCollection) {
    return res.json({ error: 'No database connection' });
  }
  
  try {
    const session = await sessionsCollection.findOne({ session_id: sessionId });
    res.json({
      session: session,
      found: !!session,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// DEBUG ENDPOINT - Remove in production!
app.get('/debug/sessions', async (req, res) => {
  if (!sessionsCollection) {
    return res.json({ error: 'No database connection' });
  }
  
  try {
    const sessions = await sessionsCollection
      .find({})
      .sort({ created_at: -1 })
      .limit(20)
      .toArray();
    
    res.json({
      sessions: sessions.map(s => ({
        session_id: s.session_id,
        used: s.used,
        created_at: s.created_at,
        age_minutes: Math.floor((Date.now() - new Date(s.created_at).getTime()) / 60000)
      })),
      count: sessions.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// API endpoint - RECEIVE session data from bot
app.post('/api/store-session', async (req, res) => {
  const { session_id, short_url, user_id } = req.body;
  
  console.log('📥 === STORING NEW SESSION ===');
  console.log('Session ID:', session_id);
  console.log('Short URL:', short_url ? short_url.substring(0, 50) + '...' : 'NONE');
  console.log('User ID:', user_id);
  console.log('Timestamp:', new Date().toISOString());
  
  if (!session_id || !short_url) {
    console.log('❌ Missing required fields');
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required fields: session_id and short_url' 
    });
  }
  
  if (!sessionsCollection) {
    console.log('❌ No database connection');
    return res.status(500).json({ 
      success: false, 
      message: 'Database not connected' 
    });
  }
  
  // Optimized session data - minimal storage
  const sessionData = {
    short_url: short_url,
    created_at: new Date(),
    used: false
  };
  
  const stored = await storeSession(session_id, sessionData);
  
  if (stored) {
    console.log('✅ Session stored successfully in MongoDB:', session_id);
    // Verify storage
    const verifySession = await getSession(session_id);
    console.log('🔍 Verification - Session found:', !!verifySession);
    res.json({ success: true, message: 'Session stored successfully' });
  } else {
    console.log('❌ Failed to store session in MongoDB');
    res.status(500).json({ success: false, message: 'Failed to store session' });
  }
});

// API endpoint - PROCESS session for redirect
app.get('/api/process-session/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  console.log('🔄 === PROCESSING SESSION REQUEST ===');
  console.log('Requested Session ID:', sessionId);
  console.log('Timestamp:', new Date().toISOString());
  
  if (!sessionsCollection) {
    console.log('❌ No database connection');
    return res.json({
      success: false,
      message: 'Database not connected. Please try again.'
    });
  }
  
  try {
    // Log database status
    const totalSessions = await sessionsCollection.countDocuments();
    console.log('📊 Total sessions in database:', totalSessions);
    
    const sessionData = await getSession(sessionId);
    console.log('🔍 Session data found:', sessionData ? 'YES' : 'NO');
    
    if (!sessionData) {
      console.log('❌ Session not found:', sessionId);
      // Additional debugging - check similar session IDs
      const regexPattern = sessionId.replace(/[^a-zA-Z0-9]/g, '');
      console.log('🔎 Searching with regex pattern:', regexPattern.substring(0, 10) + '...');
      
      return res.json({
        success: false,
        message: 'Session not found or expired. Please request a new link from the bot.'
      });
    }
    
    // Log session details
    const sessionAgeMinutes = Math.floor((Date.now() - new Date(sessionData.created_at).getTime()) / 60000);
    console.log('🕒 Session age (minutes):', sessionAgeMinutes);
    console.log('🔗 Short URL preview:', sessionData.short_url.substring(0, 50) + '...');
    console.log('✅ Used status:', sessionData.used);
    
    // Check if session is too old (more than 30 minutes)
    if (sessionAgeMinutes > 30) {
      console.log('⏰ Session expired (age:', sessionAgeMinutes, 'minutes)');
      return res.json({
        success: false,
        message: 'Session expired. Please request a new link from the bot.'
      });
    }
    
    if (sessionData.used) {
      console.log('🚫 Session already used:', sessionId);
      return res.json({
        success: false,
        message: 'This link has already been used. Please request a new one from the bot.'
      });
    }
    
    // Mark session as used
    const usedSession = await useSession(sessionId);
    
    if (usedSession) {
      console.log('✅ Session processed successfully:', sessionId);
      console.log('➡️ Redirecting to:', sessionData.short_url.substring(0, 50) + '...');
      
      res.json({
        success: true,
        redirect_url: sessionData.short_url,
        message: 'Redirecting to destination...'
      });
    } else {
      console.log('❌ Failed to mark session as used:', sessionId);
      res.json({
        success: false,
        message: 'Session processing failed. Please try again.'
      });
    }
  } catch (error) {
    console.error('💥 Session processing error:', error);
    res.json({
      success: false,
      message: 'Session processing failed. Please try again.'
    });
  }
});

// Access route for session pages
app.get('/access/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  console.log('🌐 === ACCESS PAGE REQUESTED ===');
  console.log('Session ID:', sessionId);
  console.log('User Agent:', req.get('User-Agent')?.substring(0, 50) + '...');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Root route
app.get('/', (req, res) => {
  console.log('🏠 Root page requested');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', async (req, res) => {
  let dbStatus = 'unknown';
  let sessionCount = 0;
  if (sessionsCollection) {
    try {
      await sessionsCollection.findOne({});
      dbStatus = 'connected';
      sessionCount = await sessionsCollection.countDocuments();
    } catch (error) {
      dbStatus = 'disconnected';
    }
  }
  
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    db: dbStatus,
    sessions: sessionCount,
    uptime: process.uptime()
  });
});

// Admin endpoint to check database stats
app.get('/admin/stats', async (req, res) => {
  if (sessionsCollection) {
    try {
      const totalSessions = await sessionsCollection.countDocuments();
      const usedSessions = await sessionsCollection.countDocuments({ used: true });
      const unusedSessions = await sessionsCollection.countDocuments({ used: false });
      const recentCutoff = new Date(Date.now() - 5 * 60 * 1000); // Last 5 minutes
      const recentSessions = await sessionsCollection.countDocuments({
        created_at: { $gte: recentCutoff }
      });
      
      res.json({
        sessions: {
          total: totalSessions,
          used: usedSessions,
          unused: unusedSessions,
          recent: recentSessions
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  } else {
    res.json({ error: 'Database not connected' });
  }
});

// Manual cleanup endpoint
app.post('/admin/cleanup', async (req, res) => {
  const deleted = await cleanupOldSessions();
  res.json({ 
    message: `Cleaned up ${deleted} sessions`,
    timestamp: new Date().toISOString()
  });
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
