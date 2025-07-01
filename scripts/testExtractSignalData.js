const fs = require('fs');
const path = require('path');

// Copy the extractSignalData function from src/server.js
function extractSignalData(content) {
  let symbol, signal, frame, notes;

  if (typeof content === 'string') {
    // Split by spaces: first is symbol, second is signal, third is frame, rest is notes
    const parts = content.trim().split(/\s+/);
    symbol = parts[0]?.toUpperCase();
    signal = parts[1]?.charAt(0).toUpperCase() + parts[1]?.slice(1).toLowerCase();
    frame = parts[2] || null;
    notes = parts.slice(3).join(' ');
  } else if (typeof content === 'object') {
    ({ symbol, signal, frame, notes } = content);
    if (symbol) symbol = symbol.toUpperCase();
    if (signal) signal = signal.charAt(0).toUpperCase() + signal.slice(1).toLowerCase();
  }

  return { symbol, signal, frame, notes };
}

// Test cases
const testCases = [
  "MSTR Buy 4hr Long out extrinsic, take profits fast",
  "AAPL Sell 1d Watch for reversal",
  "TSLA Buy 12h Momentum play",
  "GOOG Sell 1w - high risk",
  "NFLX Buy 4hr",
  { symbol: "MSFT", signal: "Buy", frame: "1d", notes: "Earnings play" },
  "BADFORMAT",
  ""
];

testCases.forEach((test, idx) => {
  const result = extractSignalData(test);
  console.log(`Test case ${idx + 1}:`, test);
  console.log('Parsed:', result);
  console.log('---');
}); 