const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const mysql = require('mysql2/promise');
const schedule = require('node-schedule');
const path = require('path');
require('dotenv').config();

const app = express();
// Use PORT environment variable provided by Cloud Run, fallback to 80 for local development
const port = process.env.PORT || 80;

// Initialize MySQL connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'signals_dashboard',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Initialize database tables
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        
        // Create alerts table if it doesn't exist
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS alerts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                ticker VARCHAR(10) NOT NULL,
                action ENUM('Buy', 'Sell') NOT NULL,
                initial_price DECIMAL(10,2) NOT NULL,
                price_4m DECIMAL(10,2),
                accuracy_4m TINYINT CHECK (accuracy_4m IN (0, 1)),
                price_20m DECIMAL(10,2),
                accuracy_20m TINYINT CHECK (accuracy_20m IN (0, 1)),
                price_1h DECIMAL(10,2),
                accuracy_1h TINYINT CHECK (accuracy_1h IN (0, 1)),
                price_next DECIMAL(10,2),
                accuracy_next TINYINT CHECK (accuracy_next IN (0, 1))
            )
        `);

        // Create price_checks table if it doesn't exist
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS price_checks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                alert_id INT NOT NULL,
                scheduled_time DATETIME NOT NULL,
                status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
                price DECIMAL(10,2),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (alert_id) REFERENCES alerts(id)
            )
        `);

        connection.release();
        console.log('Database tables initialized successfully');
        
        // Schedule the next-day open job
        scheduleNextDayChecks();
    } catch (err) {
        console.error('Error initializing database:', err);
        throw err;
    }
}

// Initialize database on startup
initializeDatabase().catch(console.error);

// Discord webhook URL
const DISCORD_WEBHOOK_URL = 'https://discordapp.com/api/webhooks/1194064309727277156/UGEhwvhxGKgq8SO6zW1NlunmLIHN0JFjbHXLUA7fkeRX4Di3pJUXsnq1RROq31cPP7vk';

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Middleware to log all incoming requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Function to parse webhook content
function parseWebhookContent(content) {
    const parts = content.split(' ');
    if (parts.length !== 2) {
        throw new Error('Invalid webhook format. Expected "SYMBOL Buy" or "SYMBOL Sell"');
    }
    const [ticker, action] = parts;
    if (!['Buy', 'Sell'].includes(action)) {
        throw new Error('Invalid action. Must be "Buy" or "Sell"');
    }
    return { ticker, action };
}

// Function to fetch current price from Finnhub
async function fetchCurrentPrice(ticker) {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) {
        throw new Error('FINNHUB_API_KEY not found in environment variables');
    }

    const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Finnhub API responded with status: ${response.status}`);
        }
        const data = await response.json();
        if (!data.c) {
            throw new Error('No current price found in Finnhub response');
        }
        return data.c;
    } catch (error) {
        console.error('Error fetching price from Finnhub:', error);
        throw error;
    }
}

// Function to store alert in database
async function storeAlert(ticker, action, initialPrice) {
    const [result] = await pool.execute(
        'INSERT INTO alerts (ticker, action, initial_price) VALUES (?, ?, ?)',
        [ticker, action, initialPrice]
    );
    return result.insertId;
}

// Function to send message to Discord
async function sendToDiscord(data) {
    try {
        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error(`Discord API responded with status: ${response.status}`);
        }

        return true;
    } catch (error) {
        console.error('Error sending to Discord:', error);
        throw error;
    }
}

// Function to schedule a price check
async function schedulePriceCheck(alertId, ticker, scheduledTime) {
    const [result] = await pool.execute(
        'INSERT INTO price_checks (alert_id, scheduled_time) VALUES (?, ?)',
        [alertId, scheduledTime.toISOString()]
    );
    const checkId = result.insertId;
    
    // Schedule the job
    const job = schedule.scheduleJob(scheduledTime, async () => {
        try {
            const price = await fetchCurrentPrice(ticker);
            // Update price check record
            await pool.execute(
                'UPDATE price_checks SET status = ?, price = ? WHERE id = ?',
                ['completed', price, checkId]
            );
            console.log(`Price check completed for ${ticker} at ${scheduledTime}: ${price}`);
        } catch (error) {
            console.error(`Price check failed for ${ticker} at ${scheduledTime}:`, error);
            await pool.execute(
                'UPDATE price_checks SET status = ? WHERE id = ?',
                ['failed', checkId]
            );
        }
    });

    return checkId;
}

// Function to rebuild schedules on server start
async function rebuildSchedules() {
    const [rows] = await pool.execute(
        'SELECT pc.id, pc.alert_id, pc.scheduled_time, a.ticker FROM price_checks pc ' +
        'JOIN alerts a ON pc.alert_id = a.id WHERE pc.status = ?',
        ['pending']
    );
    
    for (const row of rows) {
        const scheduledTime = new Date(row.scheduled_time);
        if (scheduledTime > new Date()) {
            schedulePriceCheck(row.alert_id, row.ticker, scheduledTime);
            console.log(`Rebuilt schedule for ${row.ticker} at ${scheduledTime}`);
        } else {
            // Mark old pending checks as failed
            await pool.execute(
                'UPDATE price_checks SET status = ? WHERE id = ?',
                ['failed', row.id]
            );
        }
    }
}

// Function to schedule next-day open checks
function scheduleNextDayChecks() {
    schedule.scheduleJob(
        { rule: '30 9 * * 1-5', tz: 'America/New_York' },
        async () => {
            // only update alerts lacking price_next
            const rows = await new Promise((resolve, reject) => {
                pool.execute(`
                    SELECT id, ticker, action, initial_price FROM alerts WHERE price_next IS NULL`,
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    }
                );
            });

            for (const {id, ticker, action, initial_price} of rows) {
                try {
                    const res = await fetch(
                        `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${process.env.FINNHUB_API_KEY}`
                    );
                    const { c: price } = await res.json();
                    const accuracy = (action === 'Buy' ? price > initial_price : price < initial_price) ? 1 : 0;
                    
                    await new Promise((resolve, reject) => {
                        pool.execute(
                            `UPDATE alerts SET price_next = ?, accuracy_next = ? WHERE id = ?`,
                            [price, accuracy, id],
                            (err) => {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });
                    
                    console.log(`[-next] updated alert #${id}: price=${price}, accuracy=${accuracy}`);
                } catch(err) {
                    console.error(`Error in next-day job for alert #${id}:`, err);
                }
            }
        }
    );
    console.log('Scheduled next-day open checks (9:30 AM ET, weekdays)');
}

// Function to schedule follow-up checks for an alert
function scheduleFollowUpChecks(id, ticker, action, initial_price) {
    const now = Date.now();
    const date4m  = new Date(now +   4  * 60 * 1000);
    const date20m = new Date(now +  20  * 60 * 1000);
    const date1h  = new Date(now +  60  * 60 * 1000);

    [
        { key: '4m',  date: date4m  },
        { key: '20m', date: date20m },
        { key: '1h',  date: date1h  }
    ].forEach(({key, date}) => {
        schedule.scheduleJob(date, async () => {
            try {
                const res = await fetch(
                    `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${process.env.FINNHUB_API_KEY}`
                );
                const { c: price } = await res.json();
                const accuracy = (action === 'Buy' ? price > initial_price : price < initial_price) ? 1 : 0;
                
                await new Promise((resolve, reject) => {
                    pool.execute(
                        `UPDATE alerts SET price_${key} = ?, accuracy_${key} = ? WHERE id = ?`,
                        [price, accuracy, id],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
                
                console.log(`[${key}] updated alert #${id}: price=${price}, accuracy=${accuracy}`);
            } catch(err) {
                console.error(`Error in ${key} job for alert #${id}:`, err);
            }
        });
    });
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        version: '1.0.1',
        timestamp: new Date().toISOString()
    });
});

// Serve React dashboard
const dashboardBuildPath = path.join(__dirname, 'dashboard', 'build');
app.use('/dashboard', express.static(dashboardBuildPath));
// Fallback: serve index.html for client-side routing
app.get('/dashboard/*', (req, res) => {
    res.sendFile(path.join(dashboardBuildPath, 'index.html'));
});

// Get all alerts endpoint
app.get('/api/alerts', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT
                id,
                timestamp,
                ticker,
                action,
                initial_price,
                price_4m,    accuracy_4m,
                price_20m,   accuracy_20m,
                price_1h,    accuracy_1h,
                price_next,  accuracy_next
            FROM alerts
            ORDER BY timestamp DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching alerts:', err);
        res.status(500).json({ error: 'Could not retrieve alerts' });
    }
});

// Update webhook endpoint
app.post('/webhook', async (req, res) => {
    try {
        console.log('Received webhook payload:', JSON.stringify(req.body, null, 2));

        const { ticker, action } = parseWebhookContent(req.body.content);
        const currentPrice = await fetchCurrentPrice(ticker);
        console.log(`Current price for ${ticker}: ${currentPrice}`);

        // Store alert and get its ID
        const alertId = await storeAlert(ticker, action, currentPrice);

        // Schedule follow-up checks
        scheduleFollowUpChecks(alertId, ticker, action, currentPrice);

        // Forward to Discord
        await sendToDiscord(req.body);

        res.status(200).json({ 
            status: 'success',
            message: 'Webhook received, stored, and follow-up checks scheduled',
            price: currentPrice
        });
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(400).json({ 
            status: 'error',
            message: error.message
        });
    }
});

// Cleanup on server shutdown
process.on('SIGINT', async () => {
    try {
        await pool.end();
        console.log('Database connection closed');
        process.exit(0);
    } catch (err) {
        console.error('Error closing database:', err);
        process.exit(1);
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Webhook endpoint: http://localhost:${port}/webhook`);
    console.log('Database path:', path.join(__dirname, 'alerts.db'));
}); 