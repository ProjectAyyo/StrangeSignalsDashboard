const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { promisify } = require('util');

class Database {
  constructor() {
    // Use /tmp in production, local data directory in development
    const dbPath = process.env.NODE_ENV === 'production' 
      ? '/tmp/alerts.db'
      : path.join(__dirname, '../../data/alerts.db');
    
    console.log('Database path:', dbPath);
    this.db = new sqlite3.Database(dbPath);
    this.run = promisify(this.db.run.bind(this.db));
    this.get = promisify(this.db.get.bind(this.db));
    this.all = promisify(this.db.all.bind(this.db));
    this.initialize();
  }

  initialize() {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(`
          CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            signal TEXT NOT NULL,
            price REAL NOT NULL,
            timestamp TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            notes TEXT
          )
        `);

        this.db.run('CREATE INDEX IF NOT EXISTS idx_alerts_symbol ON alerts(symbol)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status)');
        
        this.db.run('ALTER TABLE alerts ADD COLUMN price_4m REAL', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN price_20m REAL', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN price_1h REAL', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN price_next REAL', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN accuracy_4m INTEGER', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN accuracy_20m INTEGER', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN accuracy_1h INTEGER', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN accuracy_next INTEGER', err => {});
        
        resolve();
      });
    });
  }

  async query(sql, params = []) {
    return this.all(sql, params);
  }

  async getOne(sql, params = []) {
    return this.get(sql, params);
  }

  async runQuery(sql, params = []) {
    return this.run(sql, params);
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

const db = new Database();
module.exports = db; 