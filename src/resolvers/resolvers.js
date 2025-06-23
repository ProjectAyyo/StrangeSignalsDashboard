const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { PubSub } = require('graphql-subscriptions');
const { fetchFinnhubPrice } = require('../utils/finnhub');
const AlertScheduler = require('../utils/scheduler');
const cache = require('../utils/cache');

const pubsub = new PubSub();

const resolvers = {
  Query: {
    alerts: async () => {
      try {
        // Check cache first
        const cached = cache.get('alerts:all');
        if (cached) {
          console.log('[Cache] Alerts hit - serving from cache');
          return cached;
        }

        // Cache miss - query database
        console.log('[Cache] Alerts miss - querying database');
        const result = await db.query('SELECT * FROM alerts ORDER BY timestamp DESC');
        console.log('[DB] Query result:', result);
        if (!Array.isArray(result)) {
          console.error('[DB] Query did not return an array:', result);
          return [];
        }
        // Cache the result for 30 seconds
        cache.set('alerts:all', result, 30000);
        return result;
      } catch (err) {
        console.error('[Resolver] Error in alerts resolver:', err);
        return [];
      }
    },
    alert: async (_, { id }) => {
      // Check cache first
      const cacheKey = `alert:${id}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        console.log(`[Cache] Alert ${id} hit - serving from cache`);
        return cached;
      }

      // Cache miss - query database
      console.log(`[Cache] Alert ${id} miss - querying database`);
      const result = await db.getOne('SELECT * FROM alerts WHERE id = $1', [id]);
      
      if (result) {
        // Cache the result for 30 seconds
        cache.set(cacheKey, result, 30000);
      }
      
      return result;
    },
    alertsBySymbol: async (_, { symbol }) => {
      // For symbol-specific queries, we'll query the database
      // Could implement more sophisticated caching here if needed
      return db.query('SELECT * FROM alerts WHERE symbol = $1 ORDER BY timestamp DESC', [symbol]);
    }
  },

  Mutation: {
    createAlert: async (_, { input }) => {
      const id = uuidv4();
      const timestamp = new Date().toISOString();
      let price = input.price;
      if (price == null) {
        try {
          price = await fetchFinnhubPrice(input.symbol);
        } catch (err) {
          throw new Error('Failed to fetch price from Finnhub: ' + err.message);
        }
      }
      
      // Calculate scheduling information
      const updateIntervals = AlertScheduler.calculateAllUpdateTimes(timestamp);
      const nextUpdate = AlertScheduler.getNextUpdateTime(timestamp);
      const nextUpdateTime = nextUpdate ? nextUpdate.nextTime.toISOString() : null;
      
      const alert = {
        id,
        ...input,
        price,
        timestamp,
        status: 'active',
        next_update_time: nextUpdateTime,
        update_intervals: updateIntervals
      };

      await db.runQuery(
        'INSERT INTO alerts (id, symbol, signal, price, timestamp, status, notes, next_update_time, update_intervals) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [id, input.symbol, input.signal, price, timestamp, 'active', input.notes, nextUpdateTime, JSON.stringify(updateIntervals)]
      );

      // Invalidate relevant caches
      cache.invalidate('alerts:all');
      cache.invalidate(/^alerts:/); // Invalidate all alerts-related cache
      cache.invalidate(/^health:/); // Invalidate health cache

      pubsub.publish('ALERT_CREATED', { alertCreated: alert });
      return alert;
    },

    updateAlertStatus: async (_, { id, status }) => {
      const alert = await db.getOne('SELECT * FROM alerts WHERE id = $1', [id]);
      if (!alert) throw new Error('Alert not found');

      await db.runQuery('UPDATE alerts SET status = $1 WHERE id = $2', [status, id]);
      const updatedAlert = { ...alert, status };
      
      // Invalidate relevant caches
      cache.invalidate('alerts:all');
      cache.invalidate(`alert:${id}`);
      cache.invalidate(/^alerts:/);
      cache.invalidate(/^health:/);
      
      pubsub.publish('ALERT_UPDATED', { alertUpdated: updatedAlert });
      return updatedAlert;
    },

    deleteAlert: async (_, { id }) => {
      const result = await db.runQuery('DELETE FROM alerts WHERE id = $1', [id]);
      
      // Invalidate relevant caches
      cache.invalidate('alerts:all');
      cache.invalidate(`alert:${id}`);
      cache.invalidate(/^alerts:/);
      cache.invalidate(/^health:/);
      
      return result.rowCount > 0;
    }
  },

  Subscription: {
    alertCreated: {
      subscribe: () => pubsub.asyncIterator(['ALERT_CREATED'])
    },
    alertUpdated: {
      subscribe: () => pubsub.asyncIterator(['ALERT_UPDATED'])
    }
  }
};

module.exports = resolvers; 