const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { promisify } = require('util');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');

class Database {
  constructor() {
    // Use /tmp in production, local data directory in development
    this.dbPath = process.env.NODE_ENV === 'production' 
      ? '/tmp/alerts.db'
      : path.join(__dirname, '../../data/alerts.db');
    this.gcsBucket = process.env.GCS_BUCKET;
    this.gcsFile = process.env.GCS_DB_FILE || 'alerts.db';
    this.storage = null;
    this.gcsReady = false;
    this.initialized = false;
    this.initRetries = 0;
    this.maxRetries = 3;
    
    if (process.env.NODE_ENV === 'production' && this.gcsBucket) {
      this.storage = new Storage();
      this.gcsReady = true;
      // More frequent backup every 5 minutes
      setInterval(async () => {
         if (!this.initialized) {
           console.log('[GCS] Skipping periodic backup - database not initialized');
           return;
         }
         try {
           console.log('[GCS] Periodic backup: uploading DB to GCS...');
           await this.uploadDbToGCS();
         } catch (err) {
           console.error('[GCS] Periodic backup error:', err);
           // Attempt to reinitialize on backup failure
           await this.attemptReinitialize();
         }
      }, 5 * 60 * 1000); // 5 minutes
    }
  }

  async attemptReinitialize() {
    if (this.initRetries >= this.maxRetries) {
      console.error('[DB] Max retries reached, giving up on reinitialization');
      return;
    }
    this.initRetries++;
    console.log(`[DB] Attempting reinitialization (attempt ${this.initRetries}/${this.maxRetries})...`);
    try {
      await this.init();
      this.initRetries = 0; // Reset retry counter on success
    } catch (err) {
      console.error('[DB] Reinitialization failed:', err);
      // Schedule another retry
      setTimeout(() => this.attemptReinitialize(), 5000); // Wait 5 seconds before retry
    }
  }

  async init() {
    if (this.initialized) {
      console.log('[DB] Already initialized, skipping');
      return;
    }

    try {
      // Download DB from GCS if in production and bucket is set
      if (this.gcsReady) {
        console.log('[GCS] Attempting to download DB from GCS...');
        await this.downloadDbFromGCS();
      }

      // Ensure the directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Open the database
      this.db = new sqlite3.Database(this.dbPath);
      this.run = promisify(this.db.run.bind(this.db));
      this.get = promisify(this.db.get.bind(this.db));
      this.all = promisify(this.db.all.bind(this.db));
      
      // Initialize schema
      await this.initialize();
      console.log(`[DB] Initialized at ${this.dbPath}`);
      
      // Mark as initialized before attempting backup
      this.initialized = true;
      
      // Trigger an immediate backup if in production
      if (this.gcsReady) {
        try {
          // Wait a short time to ensure database is fully initialized
          await new Promise(resolve => setTimeout(resolve, 1000));
          console.log('[GCS] Immediate backup (on startup) uploading DB to GCS...');
          await this.uploadDbToGCS();
        } catch (err) {
          console.error('[GCS] Immediate backup (on startup) error:', err);
          // Don't throw here, we want to continue even if backup fails
        }
      }
    } catch (err) {
      console.error('[DB] Initialization failed:', err);
      if (this.db) {
        try {
          await this.close();
        } catch (closeErr) {
          console.error('[DB] Error closing database during failed init:', closeErr);
        }
        this.db = null;
      }
      this.initialized = false;
      throw err;
    }
  }

  async downloadDbFromGCS() {
    try {
      const file = this.storage.bucket(this.gcsBucket).file(this.gcsFile);
      const exists = (await file.exists())[0];
      if (exists) {
        console.log(`[GCS] Found DB file in bucket ${this.gcsBucket}/${this.gcsFile}`);
        // Create a temporary file for download
        const tempPath = `${this.dbPath}.download`;
        
        // Remove any existing temp file
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        
        // Remove any existing database file
        if (fs.existsSync(this.dbPath)) {
          fs.unlinkSync(this.dbPath);
        }
        
        await file.download({ destination: tempPath });
        
        // Verify the downloaded file is a valid SQLite database
        try {
          const testDb = new sqlite3.Database(tempPath);
          await new Promise((resolve, reject) => {
            testDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='alerts'", (err, row) => {
              testDb.close();
              if (err) {
                reject(err);
              } else if (!row) {
                reject(new Error('Downloaded file is not a valid alerts database'));
              } else {
                resolve();
              }
            });
          });
          
          // Move the temp file to the actual DB path
          fs.renameSync(tempPath, this.dbPath);
          console.log('[GCS] Successfully downloaded and verified DB from GCS');
        } catch (verifyErr) {
          // Clean up temp file if verification fails
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
          throw new Error(`Downloaded file is not a valid SQLite database: ${verifyErr.message}`);
        }
      } else {
        console.log('[GCS] No DB file found in GCS, starting fresh');
      }
    } catch (err) {
      console.error('[GCS] Error downloading DB from GCS:', err);
      throw err;
    }
  }

  async uploadDbToGCS() {
    if (!this.initialized) {
      throw new Error('Cannot upload - database not initialized');
    }
    try {
      if (fs.existsSync(this.dbPath)) {
        // Create a temporary copy for upload
        const tempPath = `${this.dbPath}.upload`;
        fs.copyFileSync(this.dbPath, tempPath);
        
        console.log(`[GCS] Starting upload to ${this.gcsBucket}/${this.gcsFile}`);
        await this.storage.bucket(this.gcsBucket).upload(tempPath, { 
          destination: this.gcsFile,
          metadata: {
            contentType: 'application/x-sqlite3',
            cacheControl: 'no-cache'
          }
        });
        // Clean up temp file
        fs.unlinkSync(tempPath);
        console.log('[GCS] Successfully uploaded DB to GCS');
      } else {
        console.error('[GCS] DB file not found for upload:', this.dbPath);
        throw new Error('Database file not found');
      }
    } catch (err) {
      console.error('[GCS] Error uploading DB to GCS:', err);
      throw err;
    }
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
        
        this.db.run('ALTER TABLE alerts ADD COLUMN price_4h REAL', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN price_12h REAL', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN price_1d REAL', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN accuracy_4h INTEGER', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN accuracy_12h INTEGER', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN accuracy_1d INTEGER', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN mfe REAL', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN mae REAL', err => {});
        this.db.run('ALTER TABLE alerts ADD COLUMN grade TEXT', err => {});
        
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

  async close() {
    if (!this.initialized) {
      console.log('[DB] Not initialized, nothing to close');
      return;
    }
    return new Promise((resolve, reject) => {
      this.db.close(async (err) => {
        if (err) {
          console.error('[DB] Error closing database:', err);
          reject(err);
        } else {
          if (this.gcsReady) {
            try {
              await this.uploadDbToGCS();
            } catch (uploadErr) {
              console.error('[DB] Error during final GCS upload:', uploadErr);
              // Don't reject here, we still want to close the DB
            }
          }
          this.initialized = false;
          resolve();
        }
      });
    });
  }
}

// Create the database instance but don't initialize it immediately
const db = new Database();

// Export a function to initialize the database
async function initializeDatabase() {
  try {
    await db.init();
  } catch (err) {
    console.error('[DB] Failed to initialize database:', err);
    // Start retry process
    await db.attemptReinitialize();
  }
}

// Initialize the database
initializeDatabase().catch(err => {
  console.error('[DB] Fatal error during database initialization:', err);
  process.exit(1);
});

module.exports = db; 