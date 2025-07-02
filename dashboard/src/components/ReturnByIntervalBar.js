import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

function computeReturns(alerts) {
  const intervals = ['5m', '1h', '2h', '4h', 'next', 'next_4h', '2d', '1w', '14d', '1m', '3m'];
  return intervals.map(key => {
    const returns = alerts
      .map(a => {
        const price = a[`price_${key}`];
        if (price === null || price === undefined || a.initial_price === null || a.initial_price === undefined) return null;
        if (a.action === 'Buy') {
          return ((price - a.initial_price) / a.initial_price) * 100;
        } else if (a.action === 'Sell') {
          return ((a.initial_price - price) / a.initial_price) * 100;
        } else {
          return null;
        }
      })
      .filter(v => v !== null && !isNaN(v));
    const avg = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const max = returns.length ? Math.max(...returns) : 0;
    return {
      interval: key,
      avgReturn: avg,
      maxReturn: max,
      count: returns.length
    };
  });
}

// Custom Tooltip for correct labeling
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: '#fff', border: '1px solid #ccc', padding: 10 }}>
        <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{label}</div>
        <div style={{ color: '#1e3a8a' }}>
          Avg % Return : {payload.find(p => p.dataKey === 'avgReturn')?.value.toFixed(2)}%
        </div>
        <div style={{ color: '#60a5fa' }}>
          Max % Return : {payload.find(p => p.dataKey === 'maxReturn')?.value.toFixed(2)}%
        </div>
      </div>
    );
  }
  return null;
};

export default function ReturnByIntervalBar({ alerts }) {
  const data = computeReturns(alerts);
  return (
    <div style={{ width: '100%', height: 350 }}>
      <h3 style={{ marginBottom: 8 }}>Return by Interval (Average & Max %)</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="interval" />
          <YAxis unit="%" />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Bar dataKey="avgReturn" name="Avg % Return" fill="#1e3a8a" />
          <Bar dataKey="maxReturn" name="Max % Return" fill="#60a5fa" opacity={0.5} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
} 