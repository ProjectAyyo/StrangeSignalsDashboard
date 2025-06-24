const { fetchFinnhubPrice } = require('./finnhub');
const { DateTime } = require('luxon');

// Centralized intervals configuration
const INTERVALS_CONFIG = [
  { key: '5m', minutes: 5, label: '5 minutes' },
  { key: '1h', minutes: 60, label: '1 hour' },
  { key: '4h', minutes: 240, label: '4 hours' },
  { key: '2d', minutes: 2 * 1440, label: '2 days' },
  { key: '1w', minutes: 7 * 1440, label: '1 week' },
  { key: '14d', minutes: 14 * 1440, label: '14 days' },
  { key: '1m', minutes: 30 * 1440, label: '1 month' },
  { key: '3m', minutes: 90 * 1440, label: '3 months' }
];

class AlertScheduler {
  static getNextUpdateTime(alertTime) {
    const now = new Date();
    const alertDate = new Date(alertTime);
    const diffMs = now - alertDate;
    const diffMinutes = diffMs / (1000 * 60);
    
    // Find the next interval that needs updating
    for (const interval of INTERVALS_CONFIG) {
      if (diffMinutes < interval.minutes) {
        const nextTime = new Date(alertDate);
        nextTime.setMinutes(nextTime.getMinutes() + interval.minutes);
        return { nextTime, interval: interval.key };
      }
    }
    
    // If all intervals are past, check for next trading day
    const nextTradingDay = this.getNextTradingDay930(alertDate);
    if (now < nextTradingDay) {
      return { nextTime: nextTradingDay, interval: 'next' };
    }
    
    const nextTradingDay4h = new Date(nextTradingDay);
    nextTradingDay4h.setHours(nextTradingDay4h.getHours() + 4);
    
    if (now < nextTradingDay4h) {
      return { nextTime: nextTradingDay4h, interval: 'next_4h' };
    }
    
    // All updates are complete
    return null;
  }
  
  static getNextTradingDay930(alertTime) {
    // Use luxon to handle timezones
    let dt = DateTime.fromISO(alertTime, { zone: 'utc' }).setZone('America/New_York');
    // Move to next day
    dt = dt.plus({ days: 1 }).set({ hour: 9, minute: 30, second: 0, millisecond: 0 });
    // Skip weekends
    while (dt.weekday === 6 || dt.weekday === 7) { // 6 = Saturday, 7 = Sunday
      dt = dt.plus({ days: 1 });
    }
    // Convert back to UTC for storage/calculation
    return dt.setZone('utc').toJSDate();
  }
  
  static isMarketOpen(now) {
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday
    const hour = now.getHours();
    const minute = now.getMinutes();
    // Market open: Mon-Fri, 9:30am to 5:00pm
    if (day === 0 || day === 6) return false;
    if (hour < 9 || (hour === 9 && minute < 30)) return false;
    if (hour > 17 || (hour === 17 && minute > 0)) return false;
    return true;
  }
  
  static calculateAllUpdateTimes(alertTime) {
    const alertDate = new Date(alertTime);
    const updateTimes = {};
    
    // Regular intervals
    INTERVALS_CONFIG.forEach(interval => {
      const time = new Date(alertDate);
      time.setMinutes(time.getMinutes() + interval.minutes);
      updateTimes[interval.key] = time.toISOString();
    });
    
    // Next trading day intervals
    const nextTradingDay = this.getNextTradingDay930(alertDate);
    updateTimes.next = nextTradingDay.toISOString();
    
    const nextTradingDay4h = new Date(nextTradingDay);
    nextTradingDay4h.setHours(nextTradingDay4h.getHours() + 4);
    updateTimes.next_4h = nextTradingDay4h.toISOString();
    
    return updateTimes;
  }
  
  static shouldUpdateNow(alert) {
    if (!alert.next_update_time) return false;
    
    const now = new Date();
    const nextUpdate = new Date(alert.next_update_time);
    
    // Only update if it's time and market is open
    return now >= nextUpdate && this.isMarketOpen(now);
  }

  // Get all interval keys (including special ones)
  static getAllIntervalKeys() {
    return [
      ...INTERVALS_CONFIG.map(interval => interval.key),
      'next',
      'next_4h'
    ];
  }

  // Get regular interval keys (excluding special ones)
  static getRegularIntervalKeys() {
    return INTERVALS_CONFIG.map(interval => interval.key);
  }

  // Get interval configuration
  static getIntervalsConfig() {
    return INTERVALS_CONFIG;
  }
}

module.exports = AlertScheduler; 