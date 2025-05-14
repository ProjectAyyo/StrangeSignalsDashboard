const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();
const schedule = require('node-schedule');
const path = require('path');
require('dotenv').config();

const app = express();
// Use PORT environment variable provided by Cloud Run, fallback to 80 for local development
const port = process.env.PORT || 80;

// Initialize SQLite database
const db = new sqlite3.Database(path.join(__dirname, 'alerts.db'), (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        
        // First, check if we need to migrate the table
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='alerts'", (err, table) => {
            if (err) {
                console.error('Error checking table:', err);
                return;
            }

            if (table) {
                // Table exists, check if it needs migration
                db.get("PRAGMA table_info(alerts)", (err, columns) => {
                    if (err) {
                        console.error('Error checking columns:', err);
                        return;
                    }

                    // Convert columns to array and check if initial_price exists
                    const columnsArray = Array.isArray(columns) ? columns : [columns];
                    if (!columnsArray.some(col => col && col.name === 'initial_price')) {
                        console.log('Migrating alerts table to new schema...');
                        
                        // Create new table with updated schema
                        db.serialize(() => {
                            // Begin transaction
                            db.run('BEGIN TRANSACTION');

                            // Create new table with updated schema
                            db.run(`
                                CREATE TABLE alerts_new (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                                    ticker TEXT NOT NULL,
                                    action TEXT NOT NULL CHECK(action IN ('Buy', 'Sell')),
                                    initial_price REAL NOT NULL,
                                    price_4m REAL,
                                    accuracy_4m INTEGER CHECK(accuracy_4m IN (0, 1)),
                                    price_20m REAL,
                                    accuracy_20m INTEGER CHECK(accuracy_20m IN (0, 1)),
                                    price_1h REAL,
                                    accuracy_1h INTEGER CHECK(accuracy_1h IN (0, 1)),
                                    price_next REAL,
                                    accuracy_next INTEGER CHECK(accuracy_next IN (0, 1))
                                )
                            `);

                            // Copy data from old table to new table
                            db.run(`
                                INSERT INTO alerts_new (id, timestamp, ticker, action, initial_price)
                                SELECT id, timestamp, ticker, action, 0.0
                                FROM alerts
                            `);

                            // Drop old table
                            db.run('DROP TABLE alerts');

                            // Rename new table to old name
                            db.run('ALTER TABLE alerts_new RENAME TO alerts');

                            // Commit transaction
                            db.run('COMMIT', (err) => {
                                if (err) {
                                    console.error('Error during migration:', err);
                                    db.run('ROLLBACK');
                                } else {
                                    console.log('Migration completed successfully');
                                    // Schedule the next-day open job after migration
                                    scheduleNextDayChecks();
                                }
                            });
                        });
                    } else {
                        console.log('Alerts table is up to date');
                        // Schedule the next-day open job
                        scheduleNextDayChecks();
                    }
                });
            } else {
                // Table doesn't exist, create it with new schema
                db.run(`
                    CREATE TABLE alerts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        ticker TEXT NOT NULL,
                        action TEXT NOT NULL CHECK(action IN ('Buy', 'Sell')),
                        initial_price REAL NOT NULL,
                        price_4m REAL,
                        accuracy_4m INTEGER CHECK(accuracy_4m IN (0, 1)),
                        price_20m REAL,
                        accuracy_20m INTEGER CHECK(accuracy_20m IN (0, 1)),
                        price_1h REAL,
                        accuracy_1h INTEGER CHECK(accuracy_1h IN (0, 1)),
                        price_next REAL,
                        accuracy_next INTEGER CHECK(accuracy_next IN (0, 1))
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating table:', err);
                    } else {
                        console.log('Alerts table created successfully');
                        // Schedule the next-day open job
                        scheduleNextDayChecks();
                    }
                });
            }
        });

        // Add price_checks table
        db.run(`
            CREATE TABLE IF NOT EXISTS price_checks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_id INTEGER NOT NULL,
                scheduled_time DATETIME NOT NULL,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
                price REAL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (alert_id) REFERENCES alerts(id)
            )
        `, (err) => {
            if (err) {
                console.error('Error creating price_checks table:', err);
            } else {
                console.log('Price checks table ready');
                // Rebuild schedules for pending checks on server start
                rebuildSchedules();
            }
        });
    }
});

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
function storeAlert(ticker, action, initialPrice) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO alerts (ticker, action, initial_price) VALUES (?, ?, ?)',
            [ticker, action, initialPrice],
            function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            }
        );
    });
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
function schedulePriceCheck(alertId, ticker, scheduledTime) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO price_checks (alert_id, scheduled_time) VALUES (?, ?)',
            [alertId, scheduledTime.toISOString()],
            function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                const checkId = this.lastID;
                
                // Schedule the job
                const job = schedule.scheduleJob(scheduledTime, async () => {
                    try {
                        const price = await fetchCurrentPrice(ticker);
                        // Update price check record
                        db.run(
                            'UPDATE price_checks SET status = ?, price = ? WHERE id = ?',
                            ['completed', price, checkId]
                        );
                        console.log(`Price check completed for ${ticker} at ${scheduledTime}: ${price}`);
                    } catch (error) {
                        console.error(`Price check failed for ${ticker} at ${scheduledTime}:`, error);
                        db.run(
                            'UPDATE price_checks SET status = ? WHERE id = ?',
                            ['failed', checkId]
                        );
                    }
                });

                resolve(checkId);
            }
        );
    });
}

// Function to rebuild schedules on server start
function rebuildSchedules() {
    db.all(
        'SELECT pc.id, pc.alert_id, pc.scheduled_time, a.ticker FROM price_checks pc ' +
        'JOIN alerts a ON pc.alert_id = a.id WHERE pc.status = ?',
        ['pending'],
        (err, rows) => {
            if (err) {
                console.error('Error rebuilding schedules:', err);
                return;
            }
            rows.forEach(row => {
                const scheduledTime = new Date(row.scheduled_time);
                if (scheduledTime > new Date()) {
                    schedulePriceCheck(row.alert_id, row.ticker, scheduledTime);
                    console.log(`Rebuilt schedule for ${row.ticker} at ${scheduledTime}`);
                } else {
                    // Mark old pending checks as failed
                    db.run(
                        'UPDATE price_checks SET status = ? WHERE id = ?',
                        ['failed', row.id]
                    );
                }
            });
        }
    );
}

// Function to schedule next-day open checks
function scheduleNextDayChecks() {
    schedule.scheduleJob(
        { rule: '30 9 * * 1-5', tz: 'America/New_York' },
        async () => {
            // only update alerts lacking price_next
            const rows = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT id, ticker, action, initial_price FROM alerts WHERE price_next IS NULL`,
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
                        db.run(
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
                    db.run(
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
    res.status(200).json({ status: 'ok' });
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
        const rows = await new Promise((resolve, reject) => {
            db.all(`
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
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
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
        const alertId = await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO alerts (ticker, action, initial_price) VALUES (?, ?, ?)',
                [ticker, action, currentPrice],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

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
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Webhook endpoint: http://localhost:${port}/webhook`);
    console.log('Database path:', path.join(__dirname, 'alerts.db'));
}); 