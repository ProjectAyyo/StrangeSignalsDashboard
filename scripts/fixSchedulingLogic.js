const db = require('../src/db/database');
const AlertScheduler = require('../src/utils/scheduler');

// Set environment variables for Cloud SQL connection
process.env.PGHOST = '/cloudsql/strange-signals-dashboard:us-central1:signals-postgres';
process.env.PGUSER = 'signalsuser';
process.env.PGPASSWORD = 'G7kz2pQw8rTnLx5vZs1bJm4eYq9XcVw';
process.env.PGDATABASE = 'signalsdb';
process.env.PGPORT = '5432';

async function fixSchedulingLogic() {
  try {
    await db.init();
    console.log('[FixScheduling] Starting scheduling logic fix...');

    // Get all active alerts
    const alerts = await db.query(`
      SELECT * FROM alerts 
      WHERE status = 'active' 
      ORDER BY timestamp DESC
    `);

    if (alerts.length === 0) {
      console.log('[FixScheduling] No alerts found.');
      return;
    }

    console.log(`[FixScheduling] Found ${alerts.length} alerts to fix`);

    let fixedCount = 0;
    for (const alert of alerts) {
      try {
        // Recalculate scheduling information with the new logic
        const updateIntervals = AlertScheduler.calculateAllUpdateTimes(alert.timestamp);
        const nextUpdate = AlertScheduler.getNextUpdateTime(alert.timestamp);
        const nextUpdateTime = nextUpdate ? nextUpdate.nextTime.toISOString() : null;

        // Update the alert with corrected scheduling information
        await db.runQuery(
          'UPDATE alerts SET next_update_time = $1, update_intervals = $2 WHERE id = $3',
          [nextUpdateTime, JSON.stringify(updateIntervals), alert.id]
        );

        console.log(`[FixScheduling] Fixed alert ${alert.id} (${alert.symbol}) - next_update_time: ${nextUpdateTime}`);
        fixedCount++;
      } catch (err) {
        console.error(`[FixScheduling] Error fixing alert ${alert.id}:`, err);
      }
    }

    console.log(`[FixScheduling] Completed! Fixed ${fixedCount} alerts.`);
  } catch (err) {
    console.error('[FixScheduling] Failed:', err);
  } finally {
    await db.close();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  fixSchedulingLogic().then(() => {
    console.log('Fix script completed');
    process.exit(0);
  }).catch(err => {
    console.error('Fix script failed:', err);
    process.exit(1);
  });
}

module.exports = { fixSchedulingLogic }; 