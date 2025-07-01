const { Pool } = require('pg');

class Database {
  constructor() {
    this.pool = new Pool({
      host: process.env.PGHOST,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      port: process.env.PGPORT || 5432,
      // Connection pooling optimization
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
      // For Cloud Run + Cloud SQL Auth Proxy
      // If using Unix socket, host should be '/cloudsql/INSTANCE_CONNECTION_NAME'
    });
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    // Ensure the alerts table exists (idempotent)
    await this.pool.query(`
          CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            frame TEXT,
            signal TEXT NOT NULL,
            price REAL NOT NULL,
            timestamp TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            notes TEXT,
            price_5m REAL,
            price_1h REAL,
            price_2h REAL,
            price_4h REAL,
            price_next REAL,
            price_next_4h REAL,
            price_2d REAL,
            price_1w REAL,
            price_14d REAL,
            price_1m REAL,
            price_3m REAL,
            accuracy_5m INTEGER,
            accuracy_1h INTEGER,
            accuracy_2h INTEGER,
            accuracy_4h INTEGER,
            accuracy_next INTEGER,
            accuracy_next_4h INTEGER,
            accuracy_2d INTEGER,
            accuracy_1w INTEGER,
            accuracy_14d INTEGER,
            accuracy_1m INTEGER,
            accuracy_3m INTEGER,
            mfe REAL,
            mae REAL,
            grade TEXT,
            next_update_time TIMESTAMP,
            update_intervals JSONB
      )
    `);
    
    // Add new columns if they don't exist (for existing databases)
    try {
      await this.pool.query('ALTER TABLE alerts ADD COLUMN IF NOT EXISTS frame TEXT');
    } catch (err) {
      // Column might already exist, ignore error
    }
    
    try {
      await this.pool.query('ALTER TABLE alerts ADD COLUMN IF NOT EXISTS next_update_time TIMESTAMP');
    } catch (err) {
      // Column might already exist, ignore error
    }
    
    try {
      await this.pool.query('ALTER TABLE alerts ADD COLUMN IF NOT EXISTS update_intervals JSONB');
    } catch (err) {
      // Column might already exist, ignore error
    }

    // Add new interval columns if they don't exist
    const newColumns = [
      'price_2h', 'price_14d', 'price_1m', 'price_3m',
      'accuracy_2h', 'accuracy_14d', 'accuracy_1m', 'accuracy_3m'
    ];
    
    for (const column of newColumns) {
      try {
        await this.pool.query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS ${column} REAL`);
      } catch (err) {
        // Column might already exist, ignore error
      }
    }
    
    this.initialized = true;
  }

  async query(sql, params = []) {
    const res = await this.pool.query(sql, params);
    return res.rows;
  }

  async getOne(sql, params = []) {
    const res = await this.pool.query(sql, params);
    return res.rows[0] || null;
  }

  async runQuery(sql, params = []) {
    const res = await this.pool.query(sql, params);
    return res;
  }

  async close() {
    await this.pool.end();
          this.initialized = false;
  }
}

const db = new Database();

async function initializeDatabase() {
  try {
    await db.init();
  } catch (err) {
    console.error('[DB] Failed to initialize database:', err);
    process.exit(1);
  }
}

initializeDatabase();

module.exports = db; 