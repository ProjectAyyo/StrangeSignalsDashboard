require('dotenv').config();
const express = require('express');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const { useServer } = require('graphql-ws/lib/use/ws');
const cors = require('cors');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const fetch = require('node-fetch');
const path = require('path');
const db = require('./db/database');
const { fetchFinnhubPrice } = require('./utils/finnhub');
const AlertScheduler = require('./utils/scheduler');
const { migrateExistingAlerts } = require('./utils/migrateExistingAlerts');
const BatchProcessor = require('./utils/batchProcessor');
const cache = require('./utils/cache');

const typeDefs = require('./schema/typeDefs');
const resolvers = require('./resolvers/resolvers');

const app = express();
const httpServer = createServer(app);

// Serve static files from public (for landing page and assets)
app.use(express.static(path.join(__dirname, '../public')));

// Serve landing page at /
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Serve dashboard static files
app.use('/dashboard', express.static(path.join(__dirname, '../dashboard/build')));

// Serve React dashboard for all /dashboard/* routes (for React Router)
app.get('/dashboard/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/build/index.html'));
});

// Create schema
const schema = makeExecutableSchema({ typeDefs, resolvers });

// Create WebSocket server
const wsServer = new WebSocketServer({
  server: httpServer,
  path: '/graphql',
});

// Add WebSocket debugging
wsServer.on('connection', (socket, request) => {
  console.log('[WebSocket] New connection established');
  
  socket.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('[WebSocket] Received message:', data);
    } catch (err) {
      console.log('[WebSocket] Received non-JSON message:', message.toString());
    }
  });
  
  socket.on('close', (code, reason) => {
    console.log('[WebSocket] Connection closed:', { code, reason: reason.toString() });
  });
  
  socket.on('error', (error) => {
    console.error('[WebSocket] Error:', error);
  });
});

// Set up WebSocket server
useServer({ schema }, wsServer);

// Create Apollo Server
const server = new ApolloServer({
  schema,
});

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Helper function to extract signal data from webhook content
function extractSignalData(content) {
  let symbol, signal, frame, notes;
  if (typeof content === 'string') {
    const parts = content.trim().split(/\s+/);
    symbol = parts[0]?.toUpperCase();
    signal = parts[1]?.charAt(0).toUpperCase() + parts[1]?.slice(1).toLowerCase();
    frame = parts[2] || null;
    notes = parts.slice(3).join(' ');
  } else if (typeof content === 'object') {
    ({ symbol, signal, frame, notes } = content);
    if (symbol) symbol = symbol.toUpperCase();
    if (signal) signal = signal.charAt(0).toUpperCase() + signal.slice(1).toLowerCase();
  }
  return { symbol, signal, frame, notes };
}

// Add this after app and before startServer()
app.post('/webhook', express.json(), async (req, res) => {
  // console.log('=== Webhook Request Received ===');

  try {
    const { content } = req.body;
    // Extract signal data
    let { symbol, signal, frame, notes } = extractSignalData(content);
    // Validate required fields (only symbol and signal are required)
    if (!symbol || !signal) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        received: { symbol, signal, frame, notes, content }
      });
    }
    // If price is not provided, fetch from Finnhub
    let price = null;
    try {
      price = await fetchFinnhubPrice(symbol);
    } catch (fetchErr) {
      return res.status(500).json({
        error: 'Failed to fetch price from Finnhub',
        details: fetchErr.message,
        received: { symbol, signal, frame, notes, content }
      });
    }
    // console.log('Creating alert with data:', { symbol, signal, price, notes });
    // 1. Store in alerts.db
    let alert;
    try {
      alert = await resolvers.Mutation.createAlert(null, { 
        input: { symbol, signal, frame, price, notes } 
      });
      // console.log('Alert created successfully:', alert);
    } catch (dbErr) {
      // console.error('Failed to create alert in DB:', dbErr);
      return res.status(500).json({ 
        error: 'Failed to create alert in DB',
        details: dbErr.message,
        stack: dbErr.stack,
        received: { symbol, signal, frame, notes, content }
      });
    }
    // 3. Forward to Discord
    if (DISCORD_WEBHOOK_URL) {
      // console.log('Forwarding to Discord webhook:', DISCORD_WEBHOOK_URL);
      const discordMessage = `${symbol} ${signal} $${price}${notes ? ' - ' + notes : ''}`;
      // console.log('Discord message:', discordMessage);
      try {
        const discordResponse = await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: discordMessage })
        });
        // console.log('Discord response status:', discordResponse.status);
        if (!discordResponse.ok) {
          // console.error('Discord webhook error:', await discordResponse.text());
        }
      } catch (discordErr) {
        // console.error('Discord webhook error:', discordErr);
        // Do not fail the webhook if Discord fails
      }
    } else {
      // console.log('Discord webhook URL not configured');
    }
    // 4. Respond to webhook
    // console.log('Webhook request completed successfully');
    res.json({ status: 'ok', alert: alert });
  } catch (err) {
    // console.error('Webhook general error:', err);
    // console.error('Webhook error stack:', err.stack);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: err.message,
      stack: err.stack,
      received: req.body
    });
  }
});

app.delete('/webhook/:id', async (req, res) => {
  // console.log('=== Delete Alert Request ===');
  // console.log('Alert ID:', req.params.id);
  
  try {
    const sql = 'DELETE FROM alerts WHERE id = ?';
    await db.runQuery(sql, [req.params.id]);
    // console.log('Alert deleted successfully');
    res.json({ status: 'ok', message: 'Alert deleted' });
  } catch (err) {
    // console.error('Delete alert error:', err);
    res.status(500).json({ 
      error: 'Failed to delete alert', 
      details: err.message 
    });
  }
});

// --- Worker logic for price/accuracy updates ---
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
if (!FINNHUB_API_KEY) {
  // console.error('FINNHUB_API_KEY not set in .env. Price/accuracy worker will not run.');
}

// Add this before startServer()
app.get('/health', async (req, res) => {
  // Check cache first
  const cacheKey = 'health:status';
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('[Cache] Health hit - serving from cache');
    return res.status(200).json(cached);
  }

  // Cache miss - build health response
  console.log('[Cache] Health miss - building response');
  
  const health = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    status: 'healthy',
    components: {
      database: 'unknown',
      discord: 'unknown',
      system: 'healthy'
    }
  };

  try {
    // Test database connection with a single optimized query
    const dbResult = await db.query(`
      SELECT 
        COUNT(*) as count,
        MAX(timestamp) as last_alert_timestamp
      FROM alerts
    `);
    console.log('[Health] DB query result:', dbResult);
    health.components.database = 'connected';
    health.database = {
      alertCount: (dbResult && dbResult[0] && dbResult[0].count) ? dbResult[0].count : 0,
      lastAlert: (dbResult && dbResult[0] && dbResult[0].last_alert_timestamp) ? dbResult[0].last_alert_timestamp : null
    };
    console.log('[Health] Processed DB result:', health.database);
  } catch (err) {
    console.error('[Health] Database error:', err);
    health.components.database = 'error';
    health.database = { error: err.message };
    health.status = 'degraded';
  }

  try {
    // Test Discord webhook
    if (DISCORD_WEBHOOK_URL) {
      const testResult = await fetch(DISCORD_WEBHOOK_URL, {
        method: 'HEAD'
      });
      health.components.discord = testResult.ok ? 'connected' : 'error';
    } else {
      health.components.discord = 'not_configured';
    }
  } catch (err) {
    health.components.discord = 'error';
    health.discord = { error: err.message };
    health.status = 'degraded';
  }

  // Add system metrics
  health.system = {
    memory: process.memoryUsage(),
    nodeVersion: process.version,
    environment: process.env.NODE_ENV
  };

  // Add cache stats
  health.cache = cache.getStats();

  // Cache the health response for 30 seconds
  cache.set(cacheKey, health, 30000);

  // Set appropriate status code
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Debug endpoint to inspect DB path and contents
app.get('/debug/db', async (req, res) => {
  try {
    const alerts = await db.query('SELECT * FROM alerts ORDER BY timestamp DESC');
    res.json({ dbPath: db.dbPath, alerts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  await server.start();

  app.use(
    '/graphql',
    cors(),
    express.json(),
    expressMiddleware(server)
  );

  const PORT = process.env.PORT || 8080;
  httpServer.listen(PORT, () => {
    // console.log(`🚀 Server ready at http://localhost:${PORT}/graphql`);
    // console.log(`🚀 Subscriptions ready at ws://localhost:${PORT}/graphql`);
  });
}

(async () => {
  try {
    // console.log('[BOOT] Initializing database (including GCS download)...');
    await db.init();
    // console.log('[BOOT] Database initialized. Starting server...');
    
    // Run migration for existing alerts
    await migrateExistingAlerts();
    
    await startServer();
  } catch (err) {
    // console.error('[BOOT] Fatal error during database initialization. Server will not start:', err);
  process.exit(1);
  }
})();

async function smartUpdateAlert(alert) {
  const now = new Date();
  const alertTime = new Date(alert.timestamp);
  const diffMs = now - alertTime;
  const diffMinutes = diffMs / (1000 * 60);
  const next930 = AlertScheduler.getNextTradingDay930(alertTime);
  
  // Get all interval keys from centralized configuration
  const allIntervalKeys = AlertScheduler.getAllIntervalKeys();
  
  // Determine which intervals need updating
  const intervals = [
    // Regular intervals from configuration
    ...AlertScheduler.getIntervalsConfig().map(interval => ({
      key: interval.key,
      ready: diffMinutes >= interval.minutes && alert[`price_${interval.key}`] == null
    })),
    // Special intervals - check if they're due and not already updated
    { key: 'next', ready: now >= next930 && alert.price_next == null },
    { key: 'next_4h', ready: now >= new Date(next930.getTime() + 4 * 60 * 60 * 1000) && alert.price_next_4h == null }
  ];
  
  let update = {};
  let updated = false;
  const pricePoints = [alert.price_1h, alert.price_4h, alert.price_1d, alert.price_next];
  
  for (const { key, ready } of intervals) {
    if (ready) {
      try {
        const price = await fetchFinnhubPrice(alert.symbol);
        console.log(`[smartUpdateAlert] Alert ID: ${alert.id}, Symbol: ${alert.symbol}, Interval: ${key}, Price: ${price}, Init Price: ${alert.price}`);
        update[`price_${key}`] = price;
        const accuracy = (alert.signal === 'Buy' && price > alert.price) || (alert.signal === 'Sell' && price < alert.price) ? 1 : 0;
        update[`accuracy_${key}`] = accuracy;
        updated = true;
        pricePoints.push(price);
      } catch (err) {
        console.error(`[smartUpdateAlert] Error updating alert ${alert.id} (${alert.symbol}) at interval ${key}:`, err);
      }
    }
  }
  
  // Calculate MFE/MAE
  if (pricePoints.length > 0 && alert.price != null) {
    let mfe = null, mae = null;
    if (alert.signal === 'Buy') {
      mfe = Math.max(...pricePoints.filter(p => p != null).map(p => p - alert.price));
      mae = Math.min(...pricePoints.filter(p => p != null).map(p => p - alert.price));
    } else if (alert.signal === 'Sell') {
      mfe = Math.min(...pricePoints.filter(p => p != null).map(p => alert.price - p));
      mae = Math.max(...pricePoints.filter(p => p != null).map(p => alert.price - p));
    }
    update.mfe = mfe;
    update.mae = mae;
    // Grading logic
    let grade = '❌ Failed';
    if (mfe != null && mfe > 0.01 * alert.price) grade = '✅ Accurate';
    else if (mfe != null && mfe > 0) grade = '⚠️ Weak';
    update.grade = grade;
  }
  
  if (updated || update.mfe !== undefined || update.mae !== undefined || update.grade !== undefined) {
    // Build dynamic SQL for only the fields that are being updated
    const fields = [];
    const params = [];
    
    // Add all possible price and accuracy fields dynamically
    for (const key of allIntervalKeys) {
      if (update[`price_${key}`] !== undefined) { 
        fields.push(`price_${key} = $${params.length + 1}`); 
        params.push(update[`price_${key}`]); 
      }
      if (update[`accuracy_${key}`] !== undefined) { 
        fields.push(`accuracy_${key} = $${params.length + 1}`); 
        params.push(update[`accuracy_${key}`]); 
      }
    }
    
    if (update.mfe !== undefined) { fields.push('mfe = $' + (params.length + 1)); params.push(update.mfe); }
    if (update.mae !== undefined) { fields.push('mae = $' + (params.length + 1)); params.push(update.mae); }
    if (update.grade !== undefined) { fields.push('grade = $' + (params.length + 1)); params.push(update.grade); }
    
    // Calculate next update time
    const nextUpdate = AlertScheduler.getNextUpdateTime(alert.timestamp);
    if (nextUpdate) {
      fields.push('next_update_time = $' + (params.length + 1));
      params.push(nextUpdate.nextTime.toISOString());
    } else {
      fields.push('next_update_time = NULL');
    }
    
    if (fields.length > 0) {
      const sql = `UPDATE alerts SET ${fields.join(', ')} WHERE id = $${params.length + 1}`;
      params.push(alert.id);
      await db.runQuery(sql, params);
      console.log(`Updated alert ${alert.id} (${alert.symbol}) with new prices/accuracy/mfe/mae/grade and next update time.`);
    }
  }
}

async function runSmartWorker() {
  if (!FINNHUB_API_KEY) return;
  
  const now = new Date();
  // REMOVED: Market hour restriction
  // if (!AlertScheduler.isMarketOpen(now)) {
  //   console.log('[SmartWorker] Market is closed, skipping updates');
  //   return;
  // }
  
  try {
    // Only query alerts that are due for updates
    const sql = `
      SELECT * FROM alerts 
      WHERE status = 'active' 
      AND next_update_time IS NOT NULL 
      AND next_update_time <= $1
      ORDER BY next_update_time ASC
    `;
    
    const alerts = await db.query(sql, [now.toISOString()]);
    
    if (alerts.length === 0) {
      console.log('[SmartWorker] No alerts due for updates');
      return;
    }
    
    console.log(`[SmartWorker] Processing ${alerts.length} alerts due for updates`);
    
    for (const alert of alerts) {
      await smartUpdateAlert(alert);
    }
    
    console.log(`[SmartWorker] Completed processing ${alerts.length} alerts`);
  } catch (err) {
    console.error('[SmartWorker] Error:', err);
  }
}

// Run smart worker every 5 minutes, but it will only process alerts that need updates
// DISABLED: Now using Cloud Scheduler for event-driven updates
// setInterval(runSmartWorker, 5 * 60 * 1000);
// runSmartWorker().catch(err => { console.error('Smart worker error:', err); });

// Cloud Scheduler endpoint for event-driven updates
app.post('/scheduler/update-alerts', async (req, res) => {
  try {
    console.log('[CloudScheduler] Received update request');
    
    const now = new Date();
    // REMOVED: Market hour restriction
    // if (!AlertScheduler.isMarketOpen(now)) {
    //   console.log('[CloudScheduler] Market is closed, skipping updates');
    //   return res.status(200).json({ status: 'skipped', reason: 'market_closed' });
    // }
    
    const alerts = await BatchProcessor.getAlertsDueForUpdate();
    
    if (alerts.length === 0) {
      console.log('[CloudScheduler] No alerts due for updates');
      return res.status(200).json({ status: 'no_updates', count: 0 });
    }
    
    console.log(`[CloudScheduler] Processing ${alerts.length} alerts`);
    await BatchProcessor.processBatchUpdate(alerts);
    
    res.status(200).json({ 
      status: 'success', 
      processed: alerts.length,
      timestamp: now.toISOString()
    });
  } catch (err) {
    console.error('[CloudScheduler] Error:', err);
    res.status(500).json({ 
      status: 'error', 
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint for Cloud Scheduler
app.get('/scheduler/health', async (req, res) => {
  try {
    const alerts = await BatchProcessor.getAlertsDueForUpdate();
    const now = new Date();
    const marketOpen = AlertScheduler.isMarketOpen(now);
    
    res.status(200).json({
      status: 'healthy',
      market_open: marketOpen,
      alerts_due: alerts.length,
      timestamp: now.toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Cache management endpoint
app.get('/cache/stats', (req, res) => {
  res.json(cache.getStats());
});

app.post('/cache/clear', (req, res) => {
  cache.clear();
  res.json({ status: 'cleared', timestamp: new Date().toISOString() });
});