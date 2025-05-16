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
          // The following are placeholders; update as needed
          price_4m: a.price,
          price_20m: a.price,
          price_1h: a.price,
          price_next: a.price,
          accuracy_4m: null,
          accuracy_20m: null,
          accuracy_1h: null,
          accuracy_next: null,
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