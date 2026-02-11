const sessions = new Map(); // In-memory storage

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { session_id, short_url, user_id } = req.body;
    
    if (!session_id || !short_url) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }
    
    sessions.set(session_id, {
      short_url: short_url,
      user_id: user_id || null,
      created_at: new Date(),
      used: false
    });
    
    console.log('Session stored:', session_id);
    res.json({ success: true, message: 'Session stored successfully' });
  } else if (req.method === 'GET') {
    // Process session endpoint
    const sessionId = req.query.sessionId;
    const sessionData = sessions.get(sessionId);
    
    if (!sessionData) {
      return res.json({
        success: false,
        message: 'Session not found'
      });
    }
    
    if (sessionData.used) {
      return res.json({
        success: false,
        message: 'Session already used'
      });
    }
    
    sessionData.used = true;
    sessions.set(sessionId, sessionData);
    
    res.json({
      success: true,
      redirect_url: sessionData.short_url
    });
  }
}
