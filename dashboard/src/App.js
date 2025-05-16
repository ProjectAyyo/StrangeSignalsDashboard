import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Filters from './components/Filters';
import AlertsTable from './components/AlertsTable';
import AccuracyPie from './components/AccuracyPie';
import AccuracyBar from './components/AccuracyBar';

const GRAPHQL_ENDPOINT = '/graphql';

function App() {
  const [alerts, setAlerts] = useState([]);
  const [filters, setFilters] = useState({ ticker: '', action: '', from: null, to: null });

  const handleFilterChange = e => {
    const { name, value } = e.target;
    setFilters(f => ({ ...f, [name]: value }));
  };

  // Move filteredAlerts calculation into useMemo
  const filteredAlerts = useMemo(() => {
    return alerts.filter(a => {
      if (filters.ticker && a.ticker !== filters.ticker) return false;
      if (filters.action && a.action !== filters.action) return false;
      const t = new Date(a.timestamp);
      if (filters.from && t < filters.from) return false;
      if (filters.to   && t > filters.to)   return false;
      return true;
    });
  }, [alerts, filters]);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const res = await axios.post(GRAPHQL_ENDPOINT, {
          query: `{
            alerts {
              id
              symbol
              signal
              price
              timestamp
              status
              notes
              price_4m
              price_20m
              price_1h
              price_next
              accuracy_4m
              accuracy_20m
              accuracy_1h
              accuracy_next
            }
          }`
        }, {
          headers: { 'Content-Type': 'application/json' }
        });
        // Map GraphQL fields to dashboard fields
        const mapped = res.data.data.alerts.map(a => ({
          id: a.id,
          ticker: a.symbol,
          action: a.signal,
          initial_price: a.price,
          timestamp: a.timestamp,
          price_4m: a.price_4m,
          price_20m: a.price_20m,
          price_1h: a.price_1h,
          price_next: a.price_next,
          accuracy_4m: a.accuracy_4m,
          accuracy_20m: a.accuracy_20m,
          accuracy_1h: a.accuracy_1h,
          accuracy_next: a.accuracy_next,
          notes: a.notes,
        }));
        setAlerts(mapped);
      } catch (err) {
        console.error('Error fetching alerts:', err);
      }
    };

    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Debug logging
  useEffect(() => {
    console.log('Current alerts:', alerts);
    console.log('Filtered alerts:', filteredAlerts);
  }, [alerts, filteredAlerts]);

  return (
    <div style={{ padding: 20 }}>
      <h1>Signals Dashboard</h1>
      <Filters
        tickers={[...new Set(alerts.map(a => a.ticker))]}
        onFilterChange={handleFilterChange}
      />
      <AlertsTable data={filteredAlerts} />
      <div style={{ display: 'flex', marginTop: 40, justifyContent: 'space-around' }}>
        <AccuracyPie alerts={filteredAlerts} />
        <AccuracyBar alerts={filteredAlerts} />
      </div>
    </div>
  );
}

export default App; 