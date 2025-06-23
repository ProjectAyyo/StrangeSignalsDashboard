const fetch = require('node-fetch');
const cache = require('./cache');

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

async function fetchFinnhubPrice(symbol) {
  if (!FINNHUB_API_KEY) {
    throw new Error('FINNHUB_API_KEY not set');
  }

  // Check cache first
  const cacheKey = `price:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[Cache] Price for ${symbol} hit - serving from cache: $${cached}`);
    return cached;
  }

  // Cache miss - fetch from API
  console.log(`[Cache] Price for ${symbol} miss - fetching from Finnhub`);
  
  try {
    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`);
    
    if (!response.ok) {
      throw new Error(`Finnhub API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(`Finnhub API error: ${data.error}`);
    }
    
    const price = data.c;
    
    if (!price || price === 0) {
      throw new Error(`Invalid price received for ${symbol}: ${price}`);
    }
    
    // Cache the price for 60 seconds (1 minute)
    cache.set(cacheKey, price, 60000);
    
    console.log(`[Cache] Cached price for ${symbol}: $${price}`);
    return price;
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error);
    throw error;
  }
}

module.exports = { fetchFinnhubPrice }; 