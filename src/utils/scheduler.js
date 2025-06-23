const { fetchFinnhubPrice } = require('./finnhub');

class AlertScheduler {
  static getNextUpdateTime(alertTime) {
    const now = new Date();
    const alertDate = new Date(alertTime);
    const diffMs = now - alertDate;
    const diffMinutes = diffMs / (1000 * 60);
    
    // Define update intervals in minutes
    const intervals = [
      { key: '5m', minutes: 5 },
      { key: '1h', minutes: 60 },
      { key: '4h', minutes: 240 },
      { key: '2d', minutes: 2 * 1440 },
      { key: '1w', minutes: 7 * 1440 }
    ];
    
    // Find the next interval that needs updating
    for (const interval of intervals) {
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
    let next = new Date(alertTime);
    next.setDate(next.getDate() + 1);
    next.setHours(9, 30, 0, 0);
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1);
    }
    return next;
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
    const intervals = [
      { key: '5m', minutes: 5 },
      { key: '1h', minutes: 60 },
      { key: '4h', minutes: 240 },
      { key: '2d', minutes: 2 * 1440 },
      { key: '1w', minutes: 7 * 1440 }
    ];
    
    intervals.forEach(interval => {
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
}

module.exports = AlertScheduler; 