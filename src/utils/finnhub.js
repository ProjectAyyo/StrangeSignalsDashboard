const fetch = require('node-fetch');

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

async function fetchFinnhubPrice(symbol) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub API error: ${res.statusText}`);
    const data = await res.json();
    console.log(`[fetchFinnhubPrice] Symbol: ${symbol}, Price: ${data.c}, Raw:`, data);
    return data.c; // current price
  } catch (err) {
    console.error(`[fetchFinnhubPrice] Error fetching price for ${symbol}:`, err);
    throw err;
  }
}

module.exports = { fetchFinnhubPrice }; 