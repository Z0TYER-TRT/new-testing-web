const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 🔐 SECURITY CONFIGURATION
// ==========================================
const API_SECRET_KEY = "redirect_kawaii_secure_key_2025"; 
// ==========================================

// MongoDB connection
let db;
let sessionsCollection;
let connectionPromise = null;

// Initialize MongoDB connection
async function getDatabase() {
  if (db && sessionsCollection) return { db, sessionsCollection };
  
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      console.log('🔄 Connecting to MongoDB...');
      const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://redirect-kawaii:6pYMr5v6WznRduAL@cluster0.cqnnbgi.mongodb.net/redirect_service?appName=Cluster0';
      
      const client = new MongoClient(mongoUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 1, // Optimized for serverless
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
      });

      await client.connect();
      db = client.db('redirect_service');
      sessionsCollection = db.collection('sessions');
      
      // Ensure indexes exist (background operation)
      sessionsCollection.createIndex({ "session_id": 1 }, { unique: true }).catch(() => {});
      sessionsCollection.createIndex({ "created_at": 1 }, { expireAfterSeconds: 1800 }).catch(() => {});
      
      console.log('✅ MongoDB connected');
      return { db, sessionsCollection };
    } catch (error) {
      console.error('❌ MongoDB Connection Error:', error.message);
      connectionPromise = null;
      throw error;
    }
  })();

  return connectionPromise;
}

// Initialize on start
getDatabase().catch(console.error);

// Middleware
app.use(compression());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ------------------------------------------------------------------
// 🚀 OPTIMIZED REDIRECT ENDPOINT (Single Query)
// ------------------------------------------------------------------
app.get('/api/process-session/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  const now = new Date();

  try {
    const { sessionsCollection } = await getDatabase();

    // PERFORMANCE FIX: Find and Update in ONE shot.
    // This is much faster than find() then update().
    const result = await sessionsCollection.findOneAndUpdate(
      { session_id: sessionId, used: false },
      { $set: { used: true, used_at: now } },
      { returnDocument: 'after', includeResultMetadata: true } 
    );

    const sessionData = result.value || result;

    // 1. HAPPY PATH
    if (sessionData && sessionData.short_url) {
        
        // Check Expiry (15 mins = 900 seconds)
        const ageSeconds = Math.floor((now.getTime() - new Date(sessionData.created_at).getTime()) / 1000);
        
        if (ageSeconds > 900) {
            return res.json({
                success: false,
                message: 'Session expired. Please request a new link.'
            });
        }

        // Return immediately
        return res.json({
            success: true,
            redirect_url: sessionData.short_url,
            message: 'Redirecting...'
        });
    }

    // 2. ERROR PATH (Only runs if happy path failed)
    // Find out why it failed to give a good error message
    const checkSession = await sessionsCollection.findOne({ session_id: sessionId });

    if (!checkSession) {
        return res.json({
            success: false,
            message: 'Invalid session. Please get a new link.'
        });
    }

    if (checkSession.used) {
        return res.json({
            success: false,
            message: 'Link already used.'
        });
    }

    return res.json({ success: false, message: 'Unknown error.' });

  } catch (error) {
    console.error('💥 Error:', error.message);
    res.json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ------------------------------------------------------------------
// STORE SESSION (With Security Check)
// ------------------------------------------------------------------
app.post('/api/store-session', async (req, res) => {
  const clientKey = req.headers['x-api-key'];
  if (clientKey !== API_SECRET_KEY) {
    return res.status(403).json({ success: false, message: 'Access Denied' });
  }

  const { session_id, short_url, user_id } = req.body;

  if (!session_id || !short_url) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  try {
    const { sessionsCollection } = await getDatabase();
    
    // Fire and forget - don't wait for write confirmation to speed up bot response
    // (Upsert ensures it creates if not exists)
    await sessionsCollection.updateOne(
        { session_id: session_id },
        { 
          $set: {
            session_id: session_id,
            short_url: short_url,
            user_id: user_id,
            created_at: new Date(),
            used: false
          }
        },
        { upsert: true }
    );
    
    res.json({ success: true, message: 'Stored' });

  } catch (error) {
    console.error('Store Error:', error.message);
    res.status(500).json({ success: false, message: 'Storage failed' });
  }
});

// ------------------------------------------------------------------
// ROUTES
// ------------------------------------------------------------------

// Access Page
app.get('/access/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

module.exports = app;
