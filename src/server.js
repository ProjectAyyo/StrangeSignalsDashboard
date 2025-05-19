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

// Add this after app and before startServer()
app.post('/webhook', express.json(), async (req, res) => {
  console.log('=== Webhook Request Received ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  try {
    let { symbol, signal, price, notes, content } = req.body;
    console.log('Parsed request data:', { symbol, signal, price, notes, content });

    // If symbol/signal are missing but content is present, parse content
    if ((!symbol || !signal) && content) {
      console.log('Attempting to parse content:', content);
      const match = content.match(/^(\w+)\s+(Buy|Sell)$/i);
      if (match) {
        symbol = match[1].toUpperCase();
        signal = match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase();
        console.log('Parsed from content:', { symbol, signal });
      }
    }

    // Validate required fields
    if (!symbol || !signal) {
      console.error('Validation failed: Missing required fields', { symbol, signal });
      return res.status(400).json({ 
        error: 'Missing required fields: symbol, signal',
        received: { symbol, signal, price, notes, content }
      });
    }

    // Handle price
    if (typeof price !== 'number') {
      console.log('Price validation:', { 
        receivedPrice: price, 
        type: typeof price,
        hasFinnhubKey: !!FINNHUB_API_KEY 
      });
      
      if (!FINNHUB_API_KEY) {
        console.error('Price missing and FINNHUB_API_KEY not set');
        return res.status(400).json({ 
          error: 'Price missing and FINNHUB_API_KEY not set',
          received: { symbol, signal, price, notes, content }
        });
      }

      try {
        console.log('Fetching price from Finnhub for symbol:', symbol);
        price = await fetchFinnhubPrice(symbol);
        console.log('Finnhub price received:', price);
      } catch (err) {
        console.error('Finnhub price fetch error:', err);
        return res.status(500).json({ 
          error: 'Failed to fetch price from Finnhub', 
          details: err.message,
          received: { symbol, signal, price, notes, content }
        });
      }
    }

    // Create alert
    console.log('Attempting to create alert with data:', { symbol, signal, price, notes });
    try {
      const alert = await resolvers.Mutation.createAlert(null, { 
        input: { symbol, signal, price, notes } 
      });
      console.log('Alert created successfully:', alert);

      // Forward to Discord
      if (DISCORD_WEBHOOK_URL) {
        console.log('Forwarding to Discord webhook:', DISCORD_WEBHOOK_URL);
        const discordMessage = `${symbol} ${signal} $${price}${notes ? ' - ' + notes : ''}`;
        console.log('Discord message:', discordMessage);
        
        try {
          const discordResponse = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: discordMessage })
          });
          console.log('Discord response status:', discordResponse.status);
          if (!discordResponse.ok) {
            console.error('Discord webhook error:', await discordResponse.text());
          }
        } catch (discordErr) {
          console.error('Discord webhook error:', discordErr);
        }
      } else {
        console.log('Discord webhook URL not configured');
      }

      console.log('Webhook request completed successfully');
      res.json({ status: 'ok', alert });
    } catch (alertErr) {
      console.error('Alert creation error:', alertErr);
      console.error('Alert creation error stack:', alertErr.stack);
      res.status(500).json({ 
        error: 'Failed to create alert', 
        details: alertErr.message,
        stack: alertErr.stack,
        received: { symbol, signal, price, notes, content }
      });
    }
  } catch (err) {
    console.error('Webhook general error:', err);
    console.error('Webhook error stack:', err.stack);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: err.message,
      stack: err.stack,
      received: req.body
    });
  }
});

app.delete('/webhook/:id', async (req, res) => {
  console.log('=== Delete Alert Request ===');
  console.log('Alert ID:', req.params.id);
  
  try {
    const sql = 'DELETE FROM alerts WHERE id = ?';
    await db.runQuery(sql, [req.params.id]);
    console.log('Alert deleted successfully');
    res.json({ status: 'ok', message: 'Alert deleted' });
  } catch (err) {
    console.error('Delete alert error:', err);
    res.status(500).json({ 
      error: 'Failed to delete alert', 
      details: err.message 
    });
  }
});

app.use(
  '/dashboard',
  express.static(path.join(__dirname, '../dashboard/build'))
);

// Optionally, serve index.html for all /dashboard/* routes (for React Router)
app.get('/dashboard/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/build/index.html'));
});

// Serve the landing page at '/'
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(express.static(path.join(__dirname, '../public')));

// --- Worker logic for price/accuracy updates ---
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
if (!FINNHUB_API_KEY) {
  console.error('FINNHUB_API_KEY not set in .env. Price/accuracy worker will not run.');
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
    { key: '4m', minutes: 4 },
    { key: '20m', minutes: 20 },
    { key: '1h', minutes: 60 },
    { key: 'next', minutes: 120 }
  ];
  let update = {};
  let updated = false;
  for (const { key, minutes } of intervals) {
    if (diffMinutes >= minutes && alert[`price_${key}`] == null) {
      try {
        const price = await fetchFinnhubPrice(alert.symbol);
        update[`price_${key}`] = price;
        const accuracy = (alert.signal === 'Buy' && price > alert.price) || (alert.signal === 'Sell' && price < alert.price) ? 1 : 0;
        update[`accuracy_${key}`] = accuracy;
        updated = true;
      } catch (err) {
        console.error(`Error fetching price for alert ${alert.id} (${alert.symbol}) at interval ${key}:`, err);
      }
    }
  }
  if (updated) {
    const sql = `
      UPDATE alerts
      SET price_4m = COALESCE(?, price_4m),
          price_20m = COALESCE(?, price_20m),
          price_1h = COALESCE(?, price_1h),
          price_next = COALESCE(?, price_next),
          accuracy_4m = COALESCE(?, accuracy_4m),
          accuracy_20m = COALESCE(?, accuracy_20m),
          accuracy_1h = COALESCE(?, accuracy_1h),
          accuracy_next = COALESCE(?, accuracy_next)
      WHERE id = ?
    `;
    const params = [
      update.price_4m, update.price_20m, update.price_1h, update.price_next,
      update.accuracy_4m, update.accuracy_20m, update.accuracy_1h, update.accuracy_next,
      alert.id
    ];
    await db.runQuery(sql, params);
    console.log(`Updated alert ${alert.id} (${alert.symbol}) with new prices/accuracy.`);
  }
}

async function runWorker() {
  if (!FINNHUB_API_KEY) return;
  console.log('Worker running at', new Date().toISOString());
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
    console.log(`🚀 Server ready at http://localhost:${PORT}/graphql`);
    console.log(`🚀 Subscriptions ready at ws://localhost:${PORT}/graphql`);
  });
}

startServer().catch((err) => {
  console.error('Error starting server:', err);
  process.exit(1);
});