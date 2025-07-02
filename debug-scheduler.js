const AlertScheduler = require('./src/utils/scheduler');

// Test with one of the actual signals
const alertTime = '2025-07-01T19:30:09.593Z';
const now = new Date();

console.log('Current time:', now.toISOString());
console.log('Alert time:', alertTime);

const next930 = AlertScheduler.getNextTradingDay930(alertTime);
console.log('Next trading day 9:30 AM:', next930.toISOString());

const nextUpdate = AlertScheduler.getNextUpdateTime(alertTime);
console.log('Next update result:', nextUpdate);

// Test the processSingleAlert logic
const alert = {
  id: 'test',
  symbol: 'MSTR',
  signal: 'Sell',
  timestamp: alertTime,
  price: 378.37,
  price_next: null,
  price_next_4h: null,
  price_2d: null
};

const diffMs = now - new Date(alertTime);
const diffMinutes = diffMs / (1000 * 60);

console.log('\nTesting processSingleAlert logic:');
console.log('Time difference in minutes:', diffMinutes);
console.log('Is now >= next930?', now >= next930);
console.log('Is now >= next930 + 4h?', now >= new Date(next930.getTime() + 4 * 60 * 60 * 1000));

const intervals = [
  { key: 'next', ready: now >= next930 && alert.price_next == null },
  { key: 'next_4h', ready: now >= new Date(next930.getTime() + 4 * 60 * 60 * 1000) && alert.price_next_4h == null }
];

console.log('\nInterval readiness:');
intervals.forEach(interval => {
  console.log(`${interval.key}: ${interval.ready}`);
}); 