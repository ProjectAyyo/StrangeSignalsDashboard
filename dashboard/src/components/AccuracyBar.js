import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

export default function AccuracyBar({ alerts }) {
  const intervals = ['5m', '1h', '4h', 'next', 'next_4h', '2d', '1w'];
  const data = intervals.map(key => {
    const flags = alerts.map(a => a[`accuracy_${key}`]).filter(v => v != null);
    const total = flags.length;
    const correct = flags.filter(v => v === 1).length;
    return {
      interval: key,
      accuracy: total ? (correct / total) * 100 : 0
    };
  });

  return (
    <BarChart width={500} height={300} data={data}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="interval" />
      <YAxis unit="%" />
      <Tooltip formatter={val => `${val.toFixed(2)}%`} />
      <Legend />
      <Bar dataKey="accuracy" name="Accuracy (%)" />
    </BarChart>
  );
} 