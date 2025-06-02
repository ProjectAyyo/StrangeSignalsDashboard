const { Pool } = require('pg');

class Database {
  constructor() {
    this.pool = new Pool({
      host: process.env.PGHOST,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      port: process.env.PGPORT || 5432,
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
            signal TEXT NOT NULL,
            price REAL NOT NULL,
            timestamp TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            notes TEXT,
            price_5m REAL,
            price_1h REAL,
            price_4h REAL,
            price_next REAL,
            price_next_4h REAL,
            price_2d REAL,
            price_1w REAL,
            accuracy_5m INTEGER,
            accuracy_1h INTEGER,
            accuracy_4h INTEGER,
            accuracy_next INTEGER,
            accuracy_next_4h INTEGER,
            accuracy_2d INTEGER,
            accuracy_1w INTEGER,
            mfe REAL,
            mae REAL,
            grade TEXT
      )
    `);
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