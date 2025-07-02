const { fetchFinnhubPrice } = require('./finnhub');
const db = require('../db/database');
const AlertScheduler = require('./scheduler');
const cache = require('./cache');

class BatchProcessor {
  static async processBatchUpdate(alerts) {
    if (alerts.length === 0) return;
    
    console.log(`[BatchProcessor] Processing ${alerts.length} alerts in batch`);
    
    // Group alerts by symbol to reduce API calls
    const symbolGroups = {};
    alerts.forEach(alert => {
      if (!symbolGroups[alert.symbol]) {
        symbolGroups[alert.symbol] = [];
      }
      symbolGroups[alert.symbol].push(alert);
    });
    
    // Fetch prices for each symbol once
    const priceCache = {};
    for (const symbol of Object.keys(symbolGroups)) {
      try {
        const price = await fetchFinnhubPrice(symbol);
        priceCache[symbol] = price;
        console.log(`[BatchProcessor] Fetched price for ${symbol}: $${price}`);
      } catch (err) {
        console.error(`[BatchProcessor] Error fetching price for ${symbol}:`, err);
        priceCache[symbol] = null;
      }
    }
    
    // Process each alert with cached prices
    const updates = [];
    for (const alert of alerts) {
      const price = priceCache[alert.symbol];
      if (price === null) continue;
      
      const update = await this.processSingleAlert(alert, price);
      if (update) {
        updates.push(update);
      }
    }
    
    // Batch database updates
    if (updates.length > 0) {
      await this.batchDatabaseUpdate(updates);
      
      // Invalidate relevant caches after updates
      cache.invalidate('alerts:all');
      cache.invalidate('alerts:due');
      cache.invalidate(/^alerts:/);
      cache.invalidate(/^health:/);
    }
    
    console.log(`[BatchProcessor] Completed batch processing. Updated ${updates.length} alerts.`);
  }
  
  static async processSingleAlert(alert, currentPrice) {
    const now = new Date();
    const alertTime = new Date(alert.timestamp);
    const diffMs = now - alertTime;
    const diffMinutes = diffMs / (1000 * 60);
    const next930 = AlertScheduler.getNextTradingDay930(alertTime);
    
    // Get all interval keys from centralized configuration
    const allIntervalKeys = AlertScheduler.getAllIntervalKeys();
    
    // Determine which intervals need updating
    const intervals = [
      // Regular intervals from configuration
      ...AlertScheduler.getIntervalsConfig().map(interval => ({
        key: interval.key,
        ready: diffMinutes >= interval.minutes && alert[`price_${interval.key}`] == null
      })),
      // Special intervals - check if they're due and not already updated
      { key: 'next', ready: now >= next930 && alert.price_next == null },
      { key: 'next_4h', ready: now >= new Date(next930.getTime() + 4 * 60 * 60 * 1000) && alert.price_next_4h == null }
    ];
    
    let update = { id: alert.id };
    let updated = false;
    const pricePoints = [alert.price_1h, alert.price_4h, alert.price_1d, alert.price_next];
    
    for (const { key, ready } of intervals) {
      if (ready) {
        update[`price_${key}`] = currentPrice;
        const accuracy = (alert.signal === 'Buy' && currentPrice > alert.price) || (alert.signal === 'Sell' && currentPrice < alert.price) ? 1 : 0;
        update[`accuracy_${key}`] = accuracy;
        updated = true;
        pricePoints.push(currentPrice);
      }
    }
    
    // Calculate MFE/MAE
    if (pricePoints.length > 0 && alert.price != null) {
      let mfe = null, mae = null;
      if (alert.signal === 'Buy') {
        mfe = Math.max(...pricePoints.filter(p => p != null).map(p => p - alert.price));
        mae = Math.min(...pricePoints.filter(p => p != null).map(p => p - alert.price));
      } else if (alert.signal === 'Sell') {
        mfe = Math.min(...pricePoints.filter(p => p != null).map(p => alert.price - p));
        mae = Math.max(...pricePoints.filter(p => p != null).map(p => alert.price - p));
      }
      update.mfe = mfe;
      update.mae = mae;
      
      // Grading logic
      let grade = '❌ Failed';
      if (mfe != null && mfe > 0.01 * alert.price) grade = '✅ Accurate';
      else if (mfe != null && mfe > 0) grade = '⚠️ Weak';
      update.grade = grade;
    }
    
    // Calculate next update time
    const nextUpdate = AlertScheduler.getNextUpdateTime(alert.timestamp);
    update.next_update_time = nextUpdate ? nextUpdate.nextTime.toISOString() : null;
    
    return updated || update.mfe !== undefined || update.mae !== undefined || update.grade !== undefined ? update : null;
  }
  
  static async batchDatabaseUpdate(updates) {
    if (updates.length === 0) return;
    
    // Use a transaction for batch updates
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      for (const update of updates) {
        const { id, ...fields } = update;
        const fieldNames = Object.keys(fields);
        const fieldValues = Object.values(fields);
        
        if (fieldNames.length > 0) {
          const setClause = fieldNames.map((field, index) => `${field} = $${index + 2}`).join(', ');
          const sql = `UPDATE alerts SET ${setClause} WHERE id = $1`;
          await client.query(sql, [id, ...fieldValues]);
        }
      }
      
      await client.query('COMMIT');
      console.log(`[BatchProcessor] Successfully updated ${updates.length} alerts in transaction`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[BatchProcessor] Error in batch update:', err);
      throw err;
    } finally {
      client.release();
    }
  }
  
  static async getAlertsDueForUpdate() {
    // Check cache first
    const cacheKey = 'alerts:due';
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('[Cache] Alerts due hit - serving from cache');
      return cached;
    }

    // Cache miss - query database
    console.log('[Cache] Alerts due miss - querying database');
    
    const now = new Date();
    // Query for alerts that are due for updates, including those that are past due
    // Also include alerts that might have missed their next trading day updates
    const sql = `
      SELECT * FROM alerts 
      WHERE status = 'active' 
      AND (
        (next_update_time IS NOT NULL AND next_update_time <= $1)
        OR 
        (next_update_time IS NULL AND timestamp::timestamp < $2)
      )
      ORDER BY COALESCE(next_update_time, timestamp::timestamp) ASC
      LIMIT 50
    `;
    
    // $1 is now, $2 is 24 hours ago to catch alerts that might have missed updates
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const alerts = await db.query(sql, [now.toISOString(), twentyFourHoursAgo.toISOString()]);
    
    // Cache the result for 10 seconds (shorter TTL for this data)
    cache.set(cacheKey, alerts, 10000);
    
    return alerts;
  }
}

module.exports = BatchProcessor; 