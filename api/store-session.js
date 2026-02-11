// Add this at the top to handle both GET and POST
export default async function handler(req, res) {
  // Enable CORS for all origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // In-memory storage (will reset on function cold starts)
  const sessions = global.sessions || new Map();
  global.sessions = sessions;

  if (req.method === 'POST') {
    // Store session endpoint
    const { session_id, short_url, user_id } = req.body;
    
    console.log('Storing session:', session_id);
    
    if (!session_id || !short_url) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: session_id and short_url' 
      });
    }
    
    sessions.set(session_id, {
      short_url: short_url,
      user_id: user_id || null,
      created_at: new Date(),
      used: false
    });
    
    console.log('Session stored successfully:', session_id);
    res.json({ success: true, message: 'Session stored successfully' });
    
  } else if (req.method === 'GET') {
    // Process session endpoint
    // Extract session ID from URL path or query
    const sessionId = req.query.sessionId || req.query.session_id || 
                     (req.url.match(/\/api\/process-session\/(.*)/) || [])[1];
    
    console.log('Processing session:', sessionId);
    console.log('Available sessions:', Array.from(sessions.keys()).slice(0, 5));
    
    if (!sessionId) {
      console.log('No session ID provided');
      return res.json({
        success: false,
        message: 'No session ID provided'
      });
    }
    
    const sessionData = sessions.get(sessionId);
    console.log('Session data:', sessionData ? 'FOUND' : 'NOT FOUND');
    
    if (!sessionData) {
      console.log('Session not found:', sessionId);
      return res.json({
        success: false,
        message: 'Session not found or expired. Please request a new link from the bot.'
      });
    }
    
    if (sessionData.used) {
      console.log('Session already used:', sessionId);
      return res.json({
        success: false,
        message: 'This link has already been used. Please request a new one from the bot.'
      });
    }
    
    // Mark session as used
    sessionData.used = true;
    sessions.set(sessionId, sessionData);
    
    console.log('Session processed successfully:', sessionId);
    res.json({
      success: true,
      redirect_url: sessionData.short_url,
      message: 'Redirecting to destination...'
    });
  } else {
    res.status(405).json({ success: false, message: 'Method not allowed' });
  }
}
