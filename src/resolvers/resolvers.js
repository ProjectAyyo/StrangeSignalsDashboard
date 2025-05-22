const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { PubSub } = require('graphql-subscriptions');

const pubsub = new PubSub();

const resolvers = {
  Query: {
    alerts: async () => {
      // console.log('[DEBUG] DB path:', db.dbPath);
      const result = await db.all('SELECT * FROM alerts ORDER BY timestamp DESC');
      // console.log('[DEBUG] alerts query result:', result);
      return result;
    },
    alert: async (_, { id }) => {
      return db.getOne('SELECT * FROM alerts WHERE id = ?', [id]);
    },
    alertsBySymbol: async (_, { symbol }) => {
      return db.all('SELECT * FROM alerts WHERE symbol = ? ORDER BY timestamp DESC', [symbol]);
    }
  },

  Mutation: {
    createAlert: async (_, { input }) => {
      const id = uuidv4();
      const timestamp = new Date().toISOString();
      const alert = {
        id,
        ...input,
        timestamp,
        status: 'active'
      };

      await db.runQuery(
        'INSERT INTO alerts (id, symbol, signal, price, timestamp, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, input.symbol, input.signal, input.price, timestamp, 'active', input.notes]
      );

      pubsub.publish('ALERT_CREATED', { alertCreated: alert });
      return alert;
    },

    updateAlertStatus: async (_, { id, status }) => {
      const alert = await db.getOne('SELECT * FROM alerts WHERE id = ?', [id]);
      if (!alert) throw new Error('Alert not found');

      await db.runQuery('UPDATE alerts SET status = ? WHERE id = ?', [status, id]);
      const updatedAlert = { ...alert, status };
      
      pubsub.publish('ALERT_UPDATED', { alertUpdated: updatedAlert });
      return updatedAlert;
    },

    deleteAlert: async (_, { id }) => {
      const result = await db.runQuery('DELETE FROM alerts WHERE id = ?', [id]);
      return result.changes > 0;
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