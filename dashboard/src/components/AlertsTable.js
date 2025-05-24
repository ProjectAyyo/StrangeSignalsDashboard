import React from 'react';

const intervals = [
  { key: '1h', label: 'Δ@1h' },
  { key: '4h', label: 'Δ@4h' },
  { key: '1d', label: 'Δ@1d' },
  { key: 'next', label: 'Δ@next' }
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

export default function AlertsTable({ data }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {['Time','Symbol','Action','Init Price',...intervals.flatMap(i => [i.label,'Acc']),'MFE','MAE','Grade']
            .map(h => <th key={h} style={{ borderBottom: '1px solid #ccc', padding: 8 }}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {data.map(row => (
          <tr key={row.id}>
            <td style={{ padding: 6 }}>{new Date(row.timestamp).toLocaleString()}</td>
            <td style={{ padding: 6 }}>{row.ticker}</td>
            <td style={{ padding: 6 }}>{row.action}</td>
            <td style={{ padding: 6 }}>{row.initial_price.toFixed(2)}</td>
            {intervals.map(({ key }) => (
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
          </tr>
        ))}
      </tbody>
    </table>
  );
} 