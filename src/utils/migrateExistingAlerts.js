const db = require('../db/database');
const AlertScheduler = require('./scheduler');

async function migrateExistingAlerts() {
  try {
    console.log('[Migration] Starting migration of existing alerts...');
    
    // Get all active alerts that don't have next_update_time set
    const alerts = await db.query(`
      SELECT * FROM alerts 
      WHERE status = 'active' 
      AND (next_update_time IS NULL OR update_intervals IS NULL)
      ORDER BY timestamp DESC
    `);
    
    if (alerts.length === 0) {
      console.log('[Migration] No alerts need migration');
      return;
    }
    
    console.log(`[Migration] Found ${alerts.length} alerts to migrate`);
    
    for (const alert of alerts) {
      try {
        // Calculate scheduling information
        const updateIntervals = AlertScheduler.calculateAllUpdateTimes(alert.timestamp);
        const nextUpdate = AlertScheduler.getNextUpdateTime(alert.timestamp);
        const nextUpdateTime = nextUpdate ? nextUpdate.nextTime.toISOString() : null;
        
        // Update the alert with scheduling information
        await db.runQuery(
          'UPDATE alerts SET next_update_time = $1, update_intervals = $2 WHERE id = $3',
          [nextUpdateTime, JSON.stringify(updateIntervals), alert.id]
        );
        
        console.log(`[Migration] Updated alert ${alert.id} (${alert.symbol}) with scheduling info`);
      } catch (err) {
        console.error(`[Migration] Error updating alert ${alert.id}:`, err);
      }
    }
    
    console.log('[Migration] Migration completed successfully');
  } catch (err) {
    console.error('[Migration] Migration failed:', err);
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateExistingAlerts().then(() => {
    console.log('[Migration] Migration script completed');
    process.exit(0);
  }).catch(err => {
    console.error('[Migration] Migration script failed:', err);
    process.exit(1);
  });
}

module.exports = { migrateExistingAlerts }; 