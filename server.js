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
    const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/?appName=Cluster0';
    const client = new MongoClient(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 5, // Limit connections for free tier
      serverSelectionTimeoutMS: 5000,
    });
    
    await client.connect();
    db = client.db('redirect_service'); // Change to your DB name
    sessionsCollection = db.collection('sessions');
    
    // Create indexes for better performance
    await sessionsCollection.createIndex({ "session_id": 1 }, { unique: true });
    await sessionsCollection.createIndex({ "created_at": 1 }, { expireAfterSeconds: 3600 }); // 1 hour auto-expiry
    
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    // Continue without database - fallback to in-memory
    db = null;
    sessionsCollection = null;
  }
}

// Initialize database on startup
initDatabase();

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

console.log('Static files middleware loaded');

// Session storage functions with MongoDB fallback
async function storeSession(sessionId, sessionData) {
  if (sessionsCollection) {
    try {
      await sessionsCollection.updateOne(
        { session_id: sessionId },
        { 
          $set: {
            session_id: sessionId,
            ...sessionData,
            created_at: new Date(),
            updated_at: new Date()
          }
        },
        { upsert: true }
      );
      console.log('✅ Session stored in MongoDB:', sessionId);
      return true;
    } catch (error) {
      console.error('❌ MongoDB store error:', error);
      return false;
    }
  }
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
  return null;
}

// Rate limiting (simple in-memory for Vercel free tier)
const requestCounts = new Map();
const RATE_LIMIT = 50; // 50 requests per minute per IP
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
    return res.status(429).json({ 
      success: false, 
      message: 'Rate limit exceeded. Please try again later.' 
    });
  }
  next();
});

// API endpoint - RECEIVE session data from bot
app.post('/api/store-session', async (req, res) => {
  const { session_id, short_url, user_id } = req.body;
  
  console.log('=== STORING NEW SESSION ===');
  console.log('Session ID:', session_id);
  
  if (!session_id || !short_url) {
    console.log('❌ Missing required fields');
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required fields: session_id and short_url' 
    });
  }
  
  const sessionData = {
    short_url: short_url,
    user_id: user_id || null,
    created_at: new Date(),
    used: false
  };
  
  const stored = await storeSession(session_id, sessionData);
  
  if (stored) {
    console.log('✅ Session stored successfully in MongoDB:', session_id);
    res.json({ success: true, message: 'Session stored successfully' });
  } else {
    console.log('❌ Failed to store session in MongoDB');
    res.status(500).json({ success: false, message: 'Failed to store session' });
  }
});

// API endpoint - PROCESS session for redirect
app.get('/api/process-session/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  console.log('=== PROCESSING SESSION REQUEST ===');
  console.log('Requested Session ID:', sessionId);
  
  try {
    const sessionData = await getSession(sessionId);
    console.log('Session data found:', sessionData ? 'YES' : 'NO');
    
    if (!sessionData) {
      console.log('❌ Session not found:', sessionId);
      return res.json({
        success: false,
        message: 'Session not found or expired. Please request a new link from the bot.'
      });
    }
    
    console.log('Session details:', {
      short_url: sessionData.short_url ? sessionData.short_url.substring(0, 50) + '...' : 'NONE',
      used: sessionData.used,
      created_at: sessionData.created_at
    });
    
    if (sessionData.used) {
      console.log('❌ Session already used:', sessionId);
      return res.json({
        success: false,
        message: 'This link has already been used. Please request a new one from the bot.'
      });
    }
    
    // Mark session as used
    const usedSession = await useSession(sessionId);
    
    if (usedSession) {
      console.log('✅ Session processed successfully:', sessionId);
      console.log('✅ Redirecting to:', sessionData.short_url.substring(0, 50) + '...');
      
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
    console.error('❌ Session processing error:', error);
    res.json({
      success: false,
      message: 'Session processing failed. Please try again.'
    });
  }
});

// Access route for session pages
app.get('/access/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  console.log('=== ACCESS PAGE REQUESTED ===');
  console.log('Session ID:', sessionId);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Root route
app.get('/', (req, res) => {
  console.log('Root page requested');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', async (req, res) => {
  let dbStatus = 'unknown';
  if (sessionsCollection) {
    try {
      await sessionsCollection.findOne({});
      dbStatus = 'connected';
    } catch (error) {
      dbStatus = 'disconnected';
    }
  }
  
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    db: dbStatus,
    uptime: process.uptime()
  });
});

// 404 handler
app.use((req, res) => {
  console.log('404 - Not found:', req.url);
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
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
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}
