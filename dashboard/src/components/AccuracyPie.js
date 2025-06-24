import React from 'react';
import { PieChart, Pie, Tooltip, Cell, Legend } from 'recharts';

export default function AccuracyPie({ alerts }) {
  // Count each alert as accurate if any interval is accurate
  const allFlags = alerts.map(a =>
    [a.accuracy_5m, a.accuracy_1h, a.accuracy_4h, a.accuracy_next, a.accuracy_next_4h, a.accuracy_2d, a.accuracy_1w, a.accuracy_14d, a.accuracy_1m, a.accuracy_3m].some(v => v === 1) ? 1 : 0
  );
  const total = allFlags.length;
  const correct = allFlags.filter(v => v === 1).length;
  const data = [
    { name: 'Accurate', value: correct },
    { name: 'Inaccurate', value: total - correct }
  ];
  const COLORS = ['#0088FE', '#FF8042'];

  return (
    <PieChart width={300} height={300}>
      <Pie
        data={data}
        dataKey="value"
        nameKey="name"
        cx="50%"
        cy="50%"
        outerRadius={100}
        label
      >
        {data.map((entry, index) => (
          <Cell key={index} fill={COLORS[index % COLORS.length]} />
        ))}
      </Pie>
      <Tooltip />
      <Legend />
    </PieChart>
  );
} 