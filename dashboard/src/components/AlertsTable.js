import React from 'react';

export default function AlertsTable({ data }) {
  const fmtPct = (price, initial) =>
    initial ? (((price - initial) / initial) * 100).toFixed(2) + '%' : '--';

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {['Time','Symbol','Action','Init Price','Δ@4h','Acc','Δ@12h','Acc','Δ@1d','Acc','Δ@next','Acc','MFE','MAE','Grade']
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
            {['4h','12h','1d','next'].map(key => (
              <React.Fragment key={key}>
                <td style={{ padding: 6 }}>{fmtPct(row[`price_${key}`], row.initial_price)}</td>
                <td style={{ padding: 6 }}>{row[`accuracy_${key}`] === 1 ? '✅' : '❌'}</td>
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