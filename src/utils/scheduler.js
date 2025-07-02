const { fetchFinnhubPrice } = require('./finnhub');
const { DateTime } = require('luxon');

// Centralized intervals configuration
const INTERVALS_CONFIG = [
  { key: '5m', minutes: 5, label: '5 minutes' },
  { key: '1h', minutes: 60, label: '1 hour' },
  { key: '2h', minutes: 120, label: '2 hours' },
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
    
    // Calculate all possible next update times
    const possibleUpdates = [];
    
    // Regular intervals
    for (const interval of INTERVALS_CONFIG) {
      if (diffMinutes < interval.minutes) {
        const nextTime = new Date(alertDate);
        nextTime.setMinutes(nextTime.getMinutes() + interval.minutes);
        possibleUpdates.push({ nextTime, interval: interval.key });
      }
    }
    
    // Next trading day intervals
    const nextTradingDay = this.getNextTradingDay930(alertDate);
    if (nextTradingDay) {
      // Check if next trading day update is due (either past due or current)
      if (now >= nextTradingDay) {
        // If it's past due, set it to now to trigger immediate update
        possibleUpdates.push({ nextTime: now, interval: 'next' });
      } else {
        // If it's in the future, schedule it normally
        possibleUpdates.push({ nextTime: nextTradingDay, interval: 'next' });
      }
      
      // Check next trading day + 4h
      const nextTradingDay4h = new Date(nextTradingDay);
      nextTradingDay4h.setHours(nextTradingDay4h.getHours() + 4);
      
      if (now >= nextTradingDay4h) {
        // If it's past due, set it to now to trigger immediate update
        possibleUpdates.push({ nextTime: now, interval: 'next_4h' });
      } else {
        // If it's in the future, schedule it normally
        possibleUpdates.push({ nextTime: nextTradingDay4h, interval: 'next_4h' });
      }
    }
    
    // Return the earliest update time
    if (possibleUpdates.length > 0) {
      // Prioritize immediate updates (when nextTime is now) over future updates
      const immediateUpdates = possibleUpdates.filter(update => update.nextTime.getTime() === now.getTime());
      if (immediateUpdates.length > 0) {
        // If there are immediate updates, return the first one
        return immediateUpdates[0];
      }
      // Otherwise, sort by time and return the earliest
      possibleUpdates.sort((a, b) => a.nextTime.getTime() - b.nextTime.getTime());
      return possibleUpdates[0];
    }
    
    // All updates are complete
    return null;
  }
  
  static getNextTradingDay930(alertTime) {
    // Use luxon to handle timezones
    let dt = DateTime.fromISO(alertTime, { zone: 'utc' }).setZone('America/New_York');
    // If the input is a weekend, move to the next Monday
    while (dt.weekday === 6 || dt.weekday === 7) { // 6 = Saturday, 7 = Sunday
      dt = dt.plus({ days: 1 });
    }
    // If the time is after or at 9:30am, move to the next day
    if (dt.hour > 9 || (dt.hour === 9 && dt.minute >= 30)) {
      dt = dt.plus({ days: 1 });
      // Skip weekends again
      while (dt.weekday === 6 || dt.weekday === 7) {
        dt = dt.plus({ days: 1 });
      }
    }
    // Set to 9:30am
    dt = dt.set({ hour: 9, minute: 30, second: 0, millisecond: 0 });
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
    console.log('[calculateAllUpdateTimes] Received alertTime:', alertTime);
    let alertDate = new Date(alertTime);
    console.log('[calculateAllUpdateTimes] Parsed alertDate:', alertDate);
    if (!alertTime || isNaN(alertDate.getTime())) {
      alertDate = new Date();
      console.log('[calculateAllUpdateTimes] Fallback to current date:', alertDate);
    }
    const updateTimes = {};
    
    // Regular intervals
    INTERVALS_CONFIG.forEach(interval => {
      const time = new Date(alertDate);
      time.setMinutes(time.getMinutes() + interval.minutes);
      updateTimes[interval.key] = time.toISOString();
    });
    
    // Next trading day intervals
    const nextTradingDay = this.getNextTradingDay930(alertDate);
    if (nextTradingDay && !isNaN(nextTradingDay.getTime())) {
      updateTimes.next = nextTradingDay.toISOString();
      const nextTradingDay4h = new Date(nextTradingDay);
      nextTradingDay4h.setHours(nextTradingDay4h.getHours() + 4);
      if (!isNaN(nextTradingDay4h.getTime())) {
        updateTimes.next_4h = nextTradingDay4h.toISOString();
      } else {
        updateTimes.next_4h = null;
      }
    } else {
      updateTimes.next = null;
      updateTimes.next_4h = null;
    }
    
    return updateTimes;
  }
  
  static shouldUpdateNow(alert) {
    if (!alert.next_update_time) return false;
    
    const now = new Date();
    const nextUpdate = new Date(alert.next_update_time);
    
    // Update if it's time (including past due) and market is open
    // For past due updates, we still want to process them even if market is closed
    // to catch up on missed updates
    if (now >= nextUpdate) {
      // If the update is more than 1 hour past due, process it regardless of market status
      const hoursPastDue = (now - nextUpdate) / (1000 * 60 * 60);
      if (hoursPastDue > 1) {
        return true;
      }
      // Otherwise, only update if market is open
      return this.isMarketOpen(now);
    }
    
    return false;
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