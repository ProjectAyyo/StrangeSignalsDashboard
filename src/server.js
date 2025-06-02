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

// Set up WebSocket server
useServer({ schema }, wsServer);

// Create Apollo Server
const server = new ApolloServer({
  schema,
});

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Helper function to extract signal data from webhook content
function extractSignalData(content) {
  let symbol, signal, price, notes;
  
  if (typeof content === 'string') {
    // Try to parse content string format: "SYMBOL Buy/Sell [at price] [- notes]"
    const match = content.match(/^(\w+)\s+(Buy|Sell)(?:\s+at\s+(\d+(?:\.\d+)?))?\s*(?:-\s*(.+))?$/i);
    if (match) {
      [, symbol, signal, price, notes] = match;
      symbol = symbol.toUpperCase();
      signal = signal.charAt(0).toUpperCase() + signal.slice(1).toLowerCase();
      if (price) price = parseFloat(price);
    }
  } else if (typeof content === 'object') {
    // Extract from object format
    ({ symbol, signal, price, notes } = content);
    if (symbol) symbol = symbol.toUpperCase();
    if (signal) signal = signal.charAt(0).toUpperCase() + signal.slice(1).toLowerCase();
    if (typeof price === 'string') price = parseFloat(price);
  }
  
  return { symbol, signal, price, notes };
}

// Add this after app and before startServer()
app.post('/webhook', express.json(), async (req, res) => {
  // console.log('=== Webhook Request Received ===');

  try {
    const { content } = req.body;
    // Extract signal data
    let { symbol, signal, price, notes } = extractSignalData(content);
    // Validate required fields (price is now optional)
    if (!symbol || !signal) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        received: { symbol, signal, price, notes, content }
      });
    }
    // If price is not provided, fetch from Finnhub
    if (price == null) {
      try {
        price = await fetchFinnhubPrice(symbol);
      } catch (fetchErr) {
        return res.status(500).json({
          error: 'Failed to fetch price from Finnhub',
          details: fetchErr.message,
          received: { symbol, signal, price, notes, content }
        });
      }
    }
    // console.log('Creating alert with data:', { symbol, signal, price, notes });
    // 1. Store in alerts.db
    let alert, savedAlert;
    try {
      alert = await resolvers.Mutation.createAlert(null, { 
        input: { symbol, signal, price, notes } 
      });
      // console.log('Alert created successfully:', alert);
      // Verify alert was saved
      savedAlert = await resolvers.Query.alert(null, { id: alert.id });
      if (!savedAlert) {
        throw new Error('Alert was created but could not be retrieved');
      }
      // console.log('Alert verified in database:', savedAlert);
    } catch (dbErr) {
      // console.error('Failed to create or verify alert in DB:', dbErr);
      return res.status(500).json({ 
        error: 'Failed to create or verify alert in DB',
        details: dbErr.message,
        stack: dbErr.stack,
        received: { symbol, signal, price, notes, content }
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
    res.json({ status: 'ok', alert: savedAlert });
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

function isMarketOpen(now) {
  const day = now.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = now.getHours();
  const minute = now.getMinutes();
  // Market open: Mon-Fri, 9:30am to 5:00pm
  if (day === 0 || day === 6) return false;
  if (hour < 9 || (hour === 9 && minute < 30)) return false;
  if (hour > 17 || (hour === 17 && minute > 0)) return false;
  return true;
}

function getNextTradingDay930(alertTime) {
  // Find the next weekday after alertTime, set to 9:30am
  let next = new Date(alertTime);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 30, 0, 0);
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

async function updateAlertPrices(alert, now) {
  const alertTime = new Date(alert.timestamp);
  const diffMs = now - alertTime;
  const diffMinutes = diffMs / (1000 * 60);
  const next930 = getNextTradingDay930(alertTime);
  const intervals = [
    { key: '5m',   ready: diffMinutes >= 5 && alert.price_5m == null },
    { key: '1h',   ready: diffMinutes >= 60 && alert.price_1h == null },
    { key: '4h',   ready: diffMinutes >= 240 && alert.price_4h == null },
    { key: 'next', ready: now >= next930 && alert.price_next == null },
    { key: 'next_4h', ready: now >= next930 + 4 * 60 * 60 * 1000 && alert.price_next_4h == null },
    { key: '2d',   ready: diffMinutes >= 2 * 1440 && alert.price_2d == null },
    { key: '1w',   ready: diffMinutes >= 7 * 1440 && alert.price_1w == null }
  ];
  let update = {};
  let updated = false;
  const pricePoints = [alert.price_1h, alert.price_4h, alert.price_1d, alert.price_next];
  for (const { key, ready } of intervals) {
    if (ready) {
      try {
        const price = await fetchFinnhubPrice(alert.symbol);
        console.log(`[updateAlertPrices] Alert ID: ${alert.id}, Symbol: ${alert.symbol}, Interval: ${key}, Price: ${price}, Init Price: ${alert.price}`);
        update[`price_${key}`] = price;
        const accuracy = (alert.signal === 'Buy' && price > alert.price) || (alert.signal === 'Sell' && price < alert.price) ? 1 : 0;
        update[`accuracy_${key}`] = accuracy;
        updated = true;
        pricePoints.push(price);
      } catch (err) {
        console.error(`[updateAlertPrices] Error updating alert ${alert.id} (${alert.symbol}) at interval ${key}:`, err);
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
    if (update.price_5m !== undefined) { fields.push('price_5m = $' + (params.length + 1)); params.push(update.price_5m); }
    if (update.price_1h !== undefined) { fields.push('price_1h = $' + (params.length + 1)); params.push(update.price_1h); }
    if (update.price_4h !== undefined) { fields.push('price_4h = $' + (params.length + 1)); params.push(update.price_4h); }
    if (update.price_next !== undefined) { fields.push('price_next = $' + (params.length + 1)); params.push(update.price_next); }
    if (update.price_next_4h !== undefined) { fields.push('price_next_4h = $' + (params.length + 1)); params.push(update.price_next_4h); }
    if (update.price_2d !== undefined) { fields.push('price_2d = $' + (params.length + 1)); params.push(update.price_2d); }
    if (update.price_1w !== undefined) { fields.push('price_1w = $' + (params.length + 1)); params.push(update.price_1w); }
    if (update.accuracy_5m !== undefined) { fields.push('accuracy_5m = $' + (params.length + 1)); params.push(update.accuracy_5m); }
    if (update.accuracy_1h !== undefined) { fields.push('accuracy_1h = $' + (params.length + 1)); params.push(update.accuracy_1h); }
    if (update.accuracy_4h !== undefined) { fields.push('accuracy_4h = $' + (params.length + 1)); params.push(update.accuracy_4h); }
    if (update.accuracy_next !== undefined) { fields.push('accuracy_next = $' + (params.length + 1)); params.push(update.accuracy_next); }
    if (update.accuracy_next_4h !== undefined) { fields.push('accuracy_next_4h = $' + (params.length + 1)); params.push(update.accuracy_next_4h); }
    if (update.accuracy_2d !== undefined) { fields.push('accuracy_2d = $' + (params.length + 1)); params.push(update.accuracy_2d); }
    if (update.accuracy_1w !== undefined) { fields.push('accuracy_1w = $' + (params.length + 1)); params.push(update.accuracy_1w); }
    if (update.mfe !== undefined) { fields.push('mfe = $' + (params.length + 1)); params.push(update.mfe); }
    if (update.mae !== undefined) { fields.push('mae = $' + (params.length + 1)); params.push(update.mae); }
    if (update.grade !== undefined) { fields.push('grade = $' + (params.length + 1)); params.push(update.grade); }
    if (fields.length > 0) {
      const sql = `UPDATE alerts SET ${fields.join(', ')} WHERE id = $${params.length + 1}`;
      params.push(alert.id);
      await db.runQuery(sql, params);
      console.log(`Updated alert ${alert.id} (${alert.symbol}) with new prices/accuracy/mfe/mae/grade.`);
    }
  }
}

async function runWorker() {
  if (!FINNHUB_API_KEY) return;
  const now = new Date();
  if (!isMarketOpen(now)) return;
  const sql = "SELECT * FROM alerts WHERE status = 'active'";
  const alerts = await db.query(sql);
  for (const alert of alerts) {
    await updateAlertPrices(alert, now);
  }
}

setInterval(runWorker, 5 * 60 * 1000);
runWorker().catch(err => { console.error('Worker error:', err); });
// --- End worker logic ---

// Add this before startServer()
app.get('/health', async (req, res) => {
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
    // Test database connection
    const dbResult = await db.query("SELECT COUNT(*) as count FROM alerts");
    health.components.database = 'connected';
    health.database = {
      alertCount: dbResult[0].count,
      lastAlert: (await db.query("SELECT timestamp FROM alerts ORDER BY timestamp DESC LIMIT 1"))[0]?.timestamp
    };
  } catch (err) {
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
    await startServer();
  } catch (err) {
    // console.error('[BOOT] Fatal error during database initialization. Server will not start:', err);
    process.exit(1);
  }
})();