class Cache {
  constructor() {
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0
    };
  }

  set(key, value, ttlMs = 30000) { // Default 30 seconds
    const expiry = Date.now() + ttlMs;
    this.cache.set(key, { value, expiry });
    this.stats.sets++;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return item.value;
  }

  invalidate(pattern) {
    if (typeof pattern === 'string') {
      // Exact match
      if (this.cache.delete(pattern)) {
        this.stats.invalidations++;
      }
    } else if (pattern instanceof RegExp) {
      // Pattern match
      for (const key of this.cache.keys()) {
        if (pattern.test(key)) {
          this.cache.delete(key);
          this.stats.invalidations++;
        }
      }
    }
  }

  clear() {
    this.cache.clear();
    this.stats.invalidations++;
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0;
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  // Cache keys for different types of data
  static keys = {
    alerts: 'alerts:all',
    health: 'health:status',
    price: (symbol) => `price:${symbol}`,
    alertsDue: 'alerts:due',
    alertById: (id) => `alert:${id}`
  };
}

// Global cache instance
const cache = new Cache();

module.exports = cache; 