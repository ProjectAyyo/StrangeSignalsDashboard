import React, { useState } from 'react';
import { DateTime } from 'luxon';

// Interval groups for tabbed column grouping
const INTERVAL_GROUPS = [
  {
    key: 'short',
    label: 'Short-term',
    intervals: [
      { key: '5m', label: 'Δ@5m' },
      { key: '1h', label: 'Δ@1h' },
      { key: '2h', label: 'Δ@2h' },
      { key: '4h', label: 'Δ@4h' },
      { key: 'next', label: 'Δ@next' },
      { key: 'next_4h', label: 'Δ@next+4h' }
    ]
  },
  {
    key: 'mid',
    label: 'Mid-term',
    intervals: [
      { key: '2d', label: 'Δ@2d' },
      { key: '1w', label: 'Δ@1w' },
      { key: '14d', label: 'Δ@14d' }
    ]
  },
  {
    key: 'long',
    label: 'Long-term',
    intervals: [
      { key: '1m', label: 'Δ@1m' },
      { key: '3m', label: 'Δ@3m' }
    ]
  }
];

const fmtDiff = (price, initial) => {
  if (price === null || price === undefined) return 'pending';
  const diff = price - initial;
  const pct = initial ? ((diff / initial) * 100).toFixed(2) : '0.00';
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  return `${sign}$${Math.abs(diff).toFixed(2)} (${sign}${Math.abs(pct)}%)`;
};

const getColor = (accuracy) => {
  if (accuracy === 1) return 'green';
  if (accuracy === 0) return 'red';
  return 'inherit';
};

const SortableHeader = ({ label, sortKey, currentSort, onSort }) => {
  const isActive = currentSort.key === sortKey;
  const direction = isActive ? currentSort.direction : null;
  
  const getArrow = () => {
    if (!isActive) return '↕️';
    return direction === 'asc' ? '↑' : '↓';
  };

  return (
    <th 
      style={{ 
        borderBottom: '1px solid #ccc', 
        padding: 8, 
        cursor: 'pointer',
        userSelect: 'none',
        backgroundColor: isActive ? '#f0f0f0' : 'transparent'
      }}
      onClick={() => onSort(sortKey)}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span style={{ fontSize: '12px', marginLeft: '4px' }}>{getArrow()}</span>
      </div>
    </th>
  );
};

export default function AlertsTable({ data, sortConfig, onSort }) {
  const [selectedGroup, setSelectedGroup] = useState('short');
  const group = INTERVAL_GROUPS.find(g => g.key === selectedGroup) || INTERVAL_GROUPS[0];

  const headers = [
    { label: 'Time', key: 'timestamp' },
    { label: 'Symbol', key: 'ticker' },
    { label: 'Action', key: 'action' },
    { label: 'Init Price', key: 'initial_price' },
    ...group.intervals.flatMap(i => [
      { label: i.label, key: `price_${i.key}` },
      { label: 'Acc', key: `accuracy_${i.key}` }
    ]),
    { label: 'MFE', key: 'mfe' },
    { label: 'MAE', key: 'mae' },
    { label: 'Grade', key: 'grade' },
    { label: 'Frame', key: 'frame' }
  ];

  return (
    <div>
      {/* Tabs for interval groups */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
        {INTERVAL_GROUPS.map(g => (
          <button
            key={g.key}
            onClick={() => setSelectedGroup(g.key)}
            style={{
              padding: '6px 16px',
              borderRadius: 6,
              border: '1px solid #ccc',
              background: selectedGroup === g.key ? '#1e3a8a' : '#f8f9fa',
              color: selectedGroup === g.key ? 'white' : '#1e3a8a',
              fontWeight: selectedGroup === g.key ? 'bold' : 'normal',
              cursor: 'pointer',
              outline: 'none',
              transition: 'background 0.2s, color 0.2s'
            }}
          >
            {g.label}
          </button>
        ))}
      </div>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
            {headers.map(header => (
              <SortableHeader
                key={header.key}
                label={header.label}
                sortKey={header.key}
                currentSort={sortConfig}
                onSort={onSort}
              />
            ))}
        </tr>
      </thead>
      <tbody>
        {data.map(row => (
          <tr key={row.id}>
            <td style={{ padding: 6 }}>{DateTime.fromISO(row.timestamp, { zone: 'utc' }).toLocal().toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS)}</td>
            <td style={{ padding: 6 }}>{row.ticker}</td>
            <td style={{ padding: 6 }}>{row.action}</td>
            <td style={{ padding: 6 }}>{row.initial_price.toFixed(2)}</td>
              {group.intervals.map(({ key }) => (
              <React.Fragment key={key}>
                  <td style={{ padding: 6, color: getColor(row[`accuracy_${key}`]) }}>
                    {row[`price_${key}`] !== undefined && row[`price_${key}`] !== null
                      ? `$${row[`price_${key}`].toFixed(2)} ${fmtDiff(row[`price_${key}`], row.initial_price)}`
                      : 'pending'}
                  </td>
                  <td style={{ padding: 6 }}>{row[`accuracy_${key}`] === 1 ? '✅' : row[`accuracy_${key}`] === 0 ? '❌' : ''}</td>
              </React.Fragment>
            ))}
            <td style={{ padding: 6 }}>{row.mfe !== undefined && row.mfe !== null ? row.mfe.toFixed(2) : '--'}</td>
            <td style={{ padding: 6 }}>{row.mae !== undefined && row.mae !== null ? row.mae.toFixed(2) : '--'}</td>
            <td style={{ padding: 6 }}>{row.grade || '--'}</td>
              <td style={{ padding: 6 }}>{row.frame || '--'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
} 