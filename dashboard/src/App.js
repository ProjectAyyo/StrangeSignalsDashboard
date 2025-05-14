import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Filters from './components/Filters';
import AlertsTable from './components/AlertsTable';
import AccuracyPie from './components/AccuracyPie';
import AccuracyBar from './components/AccuracyBar';

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
        const res = await axios.get('/api/alerts');
        console.log('Fetched alerts:', res.data);
        setAlerts(res.data);
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