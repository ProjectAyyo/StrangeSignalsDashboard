const db = require('../db/database');
const AlertScheduler = require('./scheduler');
const { fetchFinnhubPrice } = require('./finnhub');

(async function migrateAndUpdateLegacyAlerts() {
  await db.init();
  console.log('[Migration] Starting migration and update of legacy alerts...');

  // Find legacy alerts
  const legacyAlerts = await db.query(`
    SELECT * FROM alerts 
    WHERE status = 'active' 
      AND (next_update_time IS NULL OR update_intervals IS NULL
        OR price_next_4h IS NULL OR price_2d IS NULL OR price_1w IS NULL
        OR price_14d IS NULL OR price_1m IS NULL OR price_3m IS NULL)
    ORDER BY timestamp ASC
  `);

  if (legacyAlerts.length === 0) {
    console.log('[Migration] No legacy alerts found.');
    process.exit(0);
  }

  for (const alert of legacyAlerts) {
    try {
      // Recalculate scheduling info
      const updateIntervals = AlertScheduler.calculateAllUpdateTimes(alert.timestamp);
      const nextUpdate = AlertScheduler.getNextUpdateTime(alert.timestamp);
      const nextUpdateTime = nextUpdate ? nextUpdate.nextTime.toISOString() : null;

      // Prepare update object
      let updateFields = {
        update_intervals: updateIntervals,
        next_update_time: nextUpdateTime
      };

      // For each interval, if overdue and still NULL, update with latest price
      const now = new Date();
      const intervals = [
        { key: 'next_4h', field: 'price_next_4h' },
        { key: '2d', field: 'price_2d' },
        { key: '1w', field: 'price_1w' },
        { key: '14d', field: 'price_14d' },
        { key: '1m', field: 'price_1m' },
        { key: '3m', field: 'price_3m' }
      ];
      for (const { key, field } of intervals) {
        const dueTime = new Date(updateIntervals[key]);
        if (now >= dueTime && (alert[field] == null)) {
          try {
            const price = await fetchFinnhubPrice(alert.symbol);
            updateFields[field] = price;
            // Optionally, update accuracy as well
            const accuracy = (alert.signal === 'Buy' && price > alert.price) || (alert.signal === 'Sell' && price < alert.price) ? 1 : 0;
            updateFields[`accuracy_${key}`] = accuracy;
            console.log(`[Migration] Updated ${field} for alert ${alert.id} (${alert.symbol}) to $${price}`);
          } catch (err) {
            console.error(`[Migration] Failed to fetch price for ${alert.symbol} at ${key}:`, err.message);
          }
        }
      }

      // Update the alert in the database
      const setClause = Object.keys(updateFields).map((k, i) => `${k} = $${i + 1}`).join(', ');
      const values = Object.values(updateFields);
      values.push(alert.id);
      await db.runQuery(`UPDATE alerts SET ${setClause} WHERE id = $${values.length}` , values);
      console.log(`[Migration] Alert ${alert.id} (${alert.symbol}) updated.`);
    } catch (err) {
      console.error(`[Migration] Error updating alert ${alert.id}:`, err.message);
    }
  }

  console.log('[Migration] Migration and update completed.');
  process.exit(0);
})(); 