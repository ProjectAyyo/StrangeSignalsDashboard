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
              price_1h
              price_4h
              price_1d
              price_next
              accuracy_1h
              accuracy_4h
              accuracy_1d
              accuracy_next
              mfe
              mae
              grade
            }
          }`
        }, {
          headers: { 'Content-Type': 'application/json' }
        });
        // Debug log: print raw GraphQL response
        console.log('Raw GraphQL response:', res.data);
        // Map GraphQL fields to dashboard fields
        const mapped = res.data.data.alerts.map(a => ({
          id: a.id,
          ticker: a.symbol,
          action: a.signal,
          initial_price: a.price,
          timestamp: a.timestamp,
          price_1h: a.price_1h,
          price_4h: a.price_4h,
          price_1d: a.price_1d,
          price_next: a.price_next,
          accuracy_1h: a.accuracy_1h,
          accuracy_4h: a.accuracy_4h,
          accuracy_1d: a.accuracy_1d,
          accuracy_next: a.accuracy_next,
          mfe: a.mfe,
          mae: a.mae,
          grade: a.grade,
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
      <div style={{ 
        textAlign: 'center', 
        marginTop: 40, 
        padding: 20, 
        backgroundColor: '#f8f9fa', 
        borderRadius: 8,
        border: '1px solid #e9ecef'
      }}>
        <h2 style={{ color: '#1e3a8a', marginBottom: 16 }}>Want Real-Time Trading Signals?</h2>
        <p style={{ marginBottom: 20, fontSize: '1.1rem' }}>
          Get access to our premium trading signals and join our community of successful traders.
        </p>
        <a 
          href="https://www.launchpass.com/strangecapital/subscriber" 
          target="_blank" 
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            padding: '12px 24px',
            backgroundColor: '#1e3a8a',
            color: 'white',
            textDecoration: 'none',
            borderRadius: 6,
            fontWeight: 'bold',
            transition: 'background-color 0.2s'
          }}
          onMouseOver={e => e.target.style.backgroundColor = '#d7263d'}
          onMouseOut={e => e.target.style.backgroundColor = '#1e3a8a'}
        >
          Subscribe to Signals
        </a>
      </div>
    </div>
  );
}

export default App; 