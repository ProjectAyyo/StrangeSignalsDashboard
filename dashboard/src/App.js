import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { createClient } from 'graphql-ws';
import Filters from './components/Filters';
import AlertsTable from './components/AlertsTable';
import AccuracyPie from './components/AccuracyPie';
import AccuracyBar from './components/AccuracyBar';

const GRAPHQL_ENDPOINT = '/graphql';

function App() {
  const [alerts, setAlerts] = useState([]);
  const [filters, setFilters] = useState({ ticker: '', action: '', from: null, to: null });
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [sortConfig, setSortConfig] = useState({ key: 'timestamp', direction: 'desc' });

  const handleFilterChange = e => {
    const { name, value } = e.target;
    setFilters(f => ({ ...f, [name]: value }));
  };

  const handleSort = (key) => {
    setSortConfig(prevConfig => ({
      key,
      direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
    }));
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

  // Sort the filtered alerts
  const sortedAlerts = useMemo(() => {
    const sorted = [...filteredAlerts].sort((a, b) => {
      let aValue = a[sortConfig.key];
      let bValue = b[sortConfig.key];
      
      // Handle special cases
      if (sortConfig.key === 'timestamp') {
        aValue = new Date(aValue);
        bValue = new Date(bValue);
      } else if (sortConfig.key === 'initial_price' || sortConfig.key.startsWith('price_') || sortConfig.key === 'mfe' || sortConfig.key === 'mae') {
        aValue = parseFloat(aValue) || 0;
        bValue = parseFloat(bValue) || 0;
      } else if (sortConfig.key.startsWith('accuracy_')) {
        aValue = aValue === null ? -1 : aValue;
        bValue = bValue === null ? -1 : bValue;
      }
      
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    
    return sorted;
  }, [filteredAlerts, sortConfig]);

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
            price_5m
            price_1h
            price_4h
            price_next
            price_next_4h
            price_2d
            price_1w
            accuracy_5m
            accuracy_1h
            accuracy_4h
            accuracy_next
            accuracy_next_4h
            accuracy_2d
            accuracy_1w
            mfe
            mae
            grade
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
        price_5m: a.price_5m,
        price_1h: a.price_1h,
        price_4h: a.price_4h,
        price_next: a.price_next,
        price_next_4h: a.price_next_4h,
        price_2d: a.price_2d,
        price_1w: a.price_1w,
        accuracy_5m: a.accuracy_5m,
        accuracy_1h: a.accuracy_1h,
        accuracy_4h: a.accuracy_4h,
        accuracy_next: a.accuracy_next,
        accuracy_next_4h: a.accuracy_next_4h,
        accuracy_2d: a.accuracy_2d,
        accuracy_1w: a.accuracy_1w,
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

  useEffect(() => {
    // Initial fetch
    fetchAlerts();
    
    let fallbackInterval = null;
    
    // Set up GraphQL WebSocket client
    const setupWebSocket = () => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const client = createClient({
          url: `${protocol}//${window.location.host}/graphql`,
        });
        
        console.log('GraphQL WebSocket client created');
        
        // Subscribe to alertCreated
        const unsubscribe1 = client.subscribe(
          {
            query: `
              subscription {
                alertCreated {
                  id
                  symbol
                  signal
                  price
                  timestamp
                  status
                  notes
                  price_5m
                  price_1h
                  price_4h
                  price_next
                  price_next_4h
                  price_2d
                  price_1w
                  accuracy_5m
                  accuracy_1h
                  accuracy_4h
                  accuracy_next
                  accuracy_next_4h
                  accuracy_2d
                  accuracy_1w
                  mfe
                  mae
                  grade
                }
              }
            `
          },
          {
            next: (data) => {
              console.log('[WebSocket] Received alertCreated:', data);
              fetchAlerts(); // Refresh data when new alert is created
            },
            error: (err) => {
              console.error('[WebSocket] alertCreated error:', err);
              setConnectionStatus('polling');
              if (!fallbackInterval) {
                console.log('Starting fallback polling (5-minute interval)');
                fallbackInterval = setInterval(fetchAlerts, 5 * 60 * 1000);
              }
            },
            complete: () => {
              console.log('[WebSocket] alertCreated subscription completed');
            }
          }
        );
        
        // Subscribe to alertUpdated
        const unsubscribe2 = client.subscribe(
          {
            query: `
              subscription {
                alertUpdated {
                  id
                  symbol
                  signal
                  price
                  timestamp
                  status
                  notes
                  price_5m
                  price_1h
                  price_4h
                  price_next
                  price_next_4h
                  price_2d
                  price_1w
                  accuracy_5m
                  accuracy_1h
                  accuracy_4h
                  accuracy_next
                  accuracy_next_4h
                  accuracy_2d
                  accuracy_1w
                  mfe
                  mae
                  grade
                }
              }
            `
          },
          {
            next: (data) => {
              console.log('[WebSocket] Received alertUpdated:', data);
              fetchAlerts(); // Refresh data when alert is updated
            },
            error: (err) => {
              console.error('[WebSocket] alertUpdated error:', err);
              setConnectionStatus('polling');
              if (!fallbackInterval) {
                console.log('Starting fallback polling (5-minute interval)');
                fallbackInterval = setInterval(fetchAlerts, 5 * 60 * 1000);
              }
            },
            complete: () => {
              console.log('[WebSocket] alertUpdated subscription completed');
            }
          }
        );
        
        // Set connection status to real-time
        setConnectionStatus('realtime');
        console.log('WebSocket subscriptions established');
        
        // Cleanup function
        return () => {
          unsubscribe1();
          unsubscribe2();
          client.dispose();
        };
      } catch (err) {
        console.error('Failed to setup WebSocket:', err);
        setConnectionStatus('polling');
        if (!fallbackInterval) {
          console.log('Starting fallback polling (5-minute interval)');
          fallbackInterval = setInterval(fetchAlerts, 5 * 60 * 1000);
        }
      }
    };
    
    // Try to setup WebSocket
    const cleanup = setupWebSocket();
    
    // Cleanup on unmount
    return () => {
      if (cleanup) cleanup();
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
    };
  }, []);

  // Debug logging
  useEffect(() => {
    console.log('Current alerts:', alerts);
    console.log('Filtered alerts:', filteredAlerts);
  }, [alerts, filteredAlerts]);

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1>Signals Dashboard</h1>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '6px',
          fontSize: '14px',
          color: connectionStatus === 'realtime' ? '#059669' : connectionStatus === 'polling' ? '#d97706' : '#6b7280'
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: connectionStatus === 'realtime' ? '#059669' : connectionStatus === 'polling' ? '#d97706' : '#6b7280'
          }}></div>
          {connectionStatus === 'realtime' ? 'Real-time' : connectionStatus === 'polling' ? 'Polling (5min)' : 'Connecting...'}
        </div>
      </div>
      <Filters
        tickers={[...new Set(alerts.map(a => a.ticker))]}
        onFilterChange={handleFilterChange}
      />
      <AlertsTable 
        data={sortedAlerts} 
        sortConfig={sortConfig}
        onSort={handleSort}
      />
      <div style={{ display: 'flex', marginTop: 40, justifyContent: 'space-around' }}>
        <AccuracyPie alerts={sortedAlerts} />
        <AccuracyBar alerts={sortedAlerts} />
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