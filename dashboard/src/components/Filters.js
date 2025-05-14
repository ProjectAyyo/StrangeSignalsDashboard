import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

export default function Filters({ tickers, onFilterChange }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <select name="ticker" onChange={onFilterChange}>
        <option value="">All Symbols</option>
        {tickers.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <select name="action" onChange={onFilterChange} style={{ marginLeft: 10 }}>
        <option value="">All Actions</option>
        <option value="Buy">Buy</option>
        <option value="Sell">Sell</option>
      </select>
      <label style={{ marginLeft: 10 }}>
        From: <DatePicker selected={null} onChange={date => onFilterChange({ target:{ name:'from', value: date }})} />
      </label>
      <label style={{ marginLeft: 10 }}>
        To:   <DatePicker selected={null} onChange={date => onFilterChange({ target:{ name:'to', value: date }})} />
      </label>
    </div>
  );
} 