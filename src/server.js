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

async function fetchFinnhubPrice(symbol) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub API error: ${res.statusText}`);
  const data = await res.json();
  return data.c; // current price
}

async function updateAlertPrices(alert, now) {
  const alertTime = new Date(alert.timestamp);
  const diffMs = now - alertTime;
  const diffMinutes = diffMs / (1000 * 60);
  const intervals = [
    { key: '4h', minutes: 240 },
    { key: '12h', minutes: 720 },
    { key: '1d', minutes: 1440 },
    { key: 'next', minutes: 2880 } // 2 days as a placeholder for next trading day
  ];
  let update = {};
  let updated = false;
  // Collect all interval prices for MFE/MAE calculation
  const pricePoints = [alert.price_4h, alert.price_12h, alert.price_1d, alert.price_next];
  for (const { key, minutes } of intervals) {
    if (diffMinutes >= minutes && alert[`price_${key}`] == null) {
      try {
        const price = await fetchFinnhubPrice(alert.symbol);
        update[`price_${key}`] = price;
        const accuracy = (alert.signal === 'Buy' && price > alert.price) || (alert.signal === 'Sell' && price < alert.price) ? 1 : 0;
        update[`accuracy_${key}`] = accuracy;
        updated = true;
        pricePoints.push(price);
      } catch (err) {
        // console.error(`Error fetching price for alert ${alert.id} (${alert.symbol}) at interval ${key}:`, err);
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
    const sql = `
      UPDATE alerts
      SET price_4h = COALESCE(?, price_4h),
          price_12h = COALESCE(?, price_12h),
          price_1d = COALESCE(?, price_1d),
          price_next = COALESCE(?, price_next),
          accuracy_4h = COALESCE(?, accuracy_4h),
          accuracy_12h = COALESCE(?, accuracy_12h),
          accuracy_1d = COALESCE(?, accuracy_1d),
          accuracy_next = COALESCE(?, accuracy_next),
          mfe = COALESCE(?, mfe),
          mae = COALESCE(?, mae),
          grade = COALESCE(?, grade)
      WHERE id = ?
    `;
    const params = [
      update.price_4h, update.price_12h, update.price_1d, update.price_next,
      update.accuracy_4h, update.accuracy_12h, update.accuracy_1d, update.accuracy_next,
      update.mfe, update.mae, update.grade,
      alert.id
    ];
    await db.runQuery(sql, params);
    console.log(`Updated alert ${alert.id} (${alert.symbol}) with new prices/accuracy/mfe/mae/grade.`);
  }
}

async function runWorker() {
  if (!FINNHUB_API_KEY) return;
  // console.log('Worker running at', new Date().toISOString());
  const now = new Date();
  const sql = "SELECT * FROM alerts WHERE status = 'active' AND datetime(timestamp) >= datetime('now', '-2 hours')";
  const alerts = await db.query(sql);
  for (const alert of alerts) {
    await updateAlertPrices(alert, now);
  }
}

setInterval(runWorker, 60 * 1000);
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

module.exports = { fetchFinnhubPrice };