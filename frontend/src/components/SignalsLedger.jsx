import { useState } from 'react';
import { Activity, ShieldAlert, Award, FileText, ChevronRight, X, TrendingUp, Info } from 'lucide-react';

export default function SignalsLedger({ signals }) {
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [selectedSignal, setSelectedSignal] = useState(null);

  const filterOptions = [
    { id: 'ALL', name: 'All Signals' },
    { id: 'NIFTY', name: 'Nifty 50' },
    { id: 'SENSEX', name: 'Sensex' },
    { id: 'BANK', name: 'Bank Nifty' },
    { id: 'FIN', name: 'Fin Nifty' },
    { id: 'OTHER', name: 'Others' }
  ];

  const getScripGroup = (contractName) => {
    if (!contractName) return 'OTHER';
    const upper = contractName.toUpperCase();
    if (upper.includes('NIFTY BANK') || upper.includes('BANKNIFTY') || upper.includes('BANK')) return 'BANK';
    if (upper.includes('FIN SERVICE') || upper.includes('FINNIFTY') || upper.includes('FIN')) return 'FIN';
    if (upper.includes('NIFTY 50') || upper.includes('NIFTY')) return 'NIFTY';
    if (upper.includes('SENSEX')) return 'SENSEX';
    return 'OTHER';
  };

  const getSourceBadge = (source) => {
    const src = (source || 'REALTIME').toUpperCase();
    if (src === 'LIVE' || src === 'REALTIME') {
      return {
        text: '⚡ LIVE MARKET',
        style: {
          backgroundColor: 'rgba(0, 255, 136, 0.12)',
          color: 'var(--accent-green)',
          border: '1px solid rgba(0, 255, 136, 0.25)',
        }
      };
    }
    if (src === 'SIMULATION' || src === 'MOCK') {
      return {
        text: '🧪 SIMULATION',
        style: {
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          color: 'var(--accent-gold)',
          border: '1px solid rgba(245, 158, 11, 0.25)',
        }
      };
    }
    return {
      text: '📊 BACKTEST',
      style: {
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
        color: 'var(--accent-blue)',
        border: '1px solid rgba(56, 189, 248, 0.25)',
      }
    };
  };

  // Sort signals newest-first
  const sortedSignals = [...signals].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // Apply filters
  const filteredSignals = sortedSignals.filter(sig => {
    const scripMatch = activeFilter === 'ALL' || getScripGroup(sig.contract_name) === activeFilter;
    const typeMatch = typeFilter === 'ALL' || (typeFilter === 'CE' && sig.signal_type === 'BULLISH') || (typeFilter === 'PE' && sig.signal_type === 'BEARISH');
    const sourceMatch = sourceFilter === 'ALL' || (sig.source || 'REALTIME').toUpperCase() === sourceFilter.toUpperCase();
    return scripMatch && typeMatch && sourceMatch;
  });

  // Calculate stats
  const totalCount = sortedSignals.length;
  const ceCount = sortedSignals.filter(s => s.signal_type === 'BULLISH').length;
  const peCount = sortedSignals.filter(s => s.signal_type === 'BEARISH').length;
  
  const avgScore = totalCount > 0 
    ? (sortedSignals.reduce((acc, curr) => acc + (curr.checklist_score || 0), 0) / totalCount).toFixed(1) 
    : '0.0';

  const freshCount = sortedSignals.filter(s => {
    const timeMs = s.timestamp ? s.timestamp * 1000 : 0;
    return Date.now() - timeMs < 5 * 60 * 1000;
  }).length;

  const counts = {
    ALL: sortedSignals.length,
    NIFTY: sortedSignals.filter(s => getScripGroup(s.contract_name) === 'NIFTY').length,
    SENSEX: sortedSignals.filter(s => getScripGroup(s.contract_name) === 'SENSEX').length,
    BANK: sortedSignals.filter(s => getScripGroup(s.contract_name) === 'BANK').length,
    FIN: sortedSignals.filter(s => getScripGroup(s.contract_name) === 'FIN').length,
    OTHER: sortedSignals.filter(s => getScripGroup(s.contract_name) === 'OTHER').length,
  };

  const handleRowClick = (sig) => {
    setSelectedSignal(sig);
  };

  return (
    <div className="ledger-page-container">
      {/* Styles local to the ledger component */}
      <style>{`
        .ledger-page-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          gap: 16px;
          padding: 16px;
          overflow: hidden;
          background: var(--bg-primary);
        }
        .ledger-stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 12px;
        }
        .ledger-stat-card {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 16px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          position: relative;
          overflow: hidden;
        }
        .ledger-stat-card::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 4px;
          height: 100%;
          background: var(--border-highlight);
        }
        .ledger-stat-card.gold::after { background: var(--accent-gold); }
        .ledger-stat-card.green::after { background: var(--accent-green); }
        .ledger-stat-card.blue::after { background: var(--accent-blue); }
        .ledger-stat-card.red::after { background: var(--accent-red); }

        .ledger-stat-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .ledger-stat-icon.gold { color: var(--accent-gold); background: rgba(245, 158, 11, 0.05); }
        .ledger-stat-icon.green { color: var(--accent-green); background: rgba(16, 185, 129, 0.05); }
        .ledger-stat-icon.blue { color: var(--accent-blue); background: rgba(59, 130, 246, 0.05); }
        .ledger-stat-icon.red { color: var(--accent-red); background: rgba(239, 68, 68, 0.05); }

        .ledger-stat-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .ledger-stat-label {
          font-size: 0.72rem;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .ledger-stat-value {
          font-size: 1.4rem;
          font-weight: 800;
          color: var(--text-main);
          line-height: 1;
        }
        
        .ledger-main-section {
          display: flex;
          flex-grow: 1;
          gap: 16px;
          min-height: 0;
          overflow: hidden;
        }
        
        .ledger-table-container {
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          overflow: hidden;
          min-width: 0;
        }

        .ledger-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: rgba(0, 0, 0, 0.1);
          border-bottom: 1px solid var(--border-color);
          flex-wrap: wrap;
        }

        .ledger-filters {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .ledger-filters::-webkit-scrollbar { display: none; }
        
        .ledger-filter-pill {
          padding: 5px 12px;
          border-radius: 8px;
          font-size: 0.74rem;
          font-weight: 700;
          background: rgba(255, 255, 255, 0.02);
          color: var(--text-muted);
          border: 1px solid var(--border-color);
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .ledger-filter-pill:hover {
          color: var(--text-main);
          background: rgba(255, 255, 255, 0.04);
          border-color: var(--border-highlight);
        }
        .ledger-filter-pill.active {
          background: rgba(245, 158, 11, 0.1);
          color: var(--accent-gold);
          border-color: var(--accent-gold);
        }

        .ledger-selects {
          display: flex;
          gap: 8px;
        }
        .ledger-select {
          background: var(--bg-primary);
          color: var(--text-main);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 0.74rem;
          font-weight: 600;
          outline: none;
          cursor: pointer;
        }
        .ledger-select:hover {
          border-color: var(--border-highlight);
        }

        .ledger-scrollable-table {
          flex-grow: 1;
          overflow-y: auto;
        }
        .ledger-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.82rem;
        }
        .ledger-table th {
          position: sticky;
          top: 0;
          background: var(--bg-tertiary);
          padding: 12px 10px;
          font-weight: 800;
          color: var(--text-muted);
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 1px solid var(--border-color);
          z-index: 10;
        }
        .ledger-table tr {
          border-bottom: 1px solid var(--border-color);
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .ledger-table tr:hover {
          background: rgba(255, 255, 255, 0.02);
        }
        .ledger-table tr.selected {
          background: rgba(245, 158, 11, 0.04);
        }
        .ledger-table td {
          padding: 10px;
          color: var(--text-main);
          font-weight: 500;
        }
        .monospace-font {
          font-family: monospace;
          font-weight: 600;
        }

        /* Slide-out Inspector Panel */
        .ledger-inspector {
          width: 320px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: -4px 0 16px rgba(0, 0, 0, 0.2);
          animation: slideIn 0.25s ease-out;
        }
        @keyframes slideIn {
          from { transform: translateX(50px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }

        .inspector-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: rgba(0, 0, 0, 0.15);
          border-bottom: 1px solid var(--border-color);
        }
        .inspector-body {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          overflow-y: auto;
          flex-grow: 1;
        }

        .inspector-title-row {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .inspector-contract-name {
          font-size: 1.1rem;
          font-weight: 800;
          color: var(--text-main);
        }
        .inspector-meta-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.72rem;
          color: var(--text-muted);
        }

        .inspector-metrics-card {
          background: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: 10px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .inspector-metric-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.8rem;
        }
        .inspector-metric-label {
          color: var(--text-muted);
          font-weight: 600;
        }
        .inspector-metric-val {
          font-weight: 700;
          color: var(--text-main);
        }

        .inspector-checklist-box {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .inspector-checklist-title {
          font-size: 0.76rem;
          font-weight: 800;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .inspector-checklist-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 0.78rem;
          padding: 6px 8px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.01);
          border: 1px solid rgba(255, 255, 255, 0.02);
        }
        .inspector-checklist-item.passed {
          border-color: rgba(16, 185, 129, 0.15);
          background: rgba(16, 185, 129, 0.02);
        }
        .inspector-checklist-item.failed {
          border-color: rgba(239, 68, 68, 0.1);
          background: rgba(239, 68, 68, 0.01);
        }
        .inspector-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .inspector-dot.passed { background: var(--accent-green); box-shadow: 0 0 6px var(--accent-green); }
        .inspector-dot.failed { background: var(--accent-red); }

        .rr-track {
          height: 6px;
          border-radius: 3px;
          background: var(--border-color);
          position: relative;
          margin-top: 8px;
          overflow: hidden;
        }
        .rr-fill {
          height: 100%;
          background: linear-gradient(to right, var(--accent-red) 37.5%, var(--accent-green) 100%);
          width: 100%;
        }
        .rr-pin {
          position: absolute;
          top: 50%;
          left: 37.5%;
          transform: translate(-50%, -50%);
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #ffffff;
          border: 2px solid var(--bg-tertiary);
        }
      `}</style>

      {/* Metrics Cards */}
      <div className="ledger-stats-grid">
        <div className="ledger-stat-card gold">
          <div className="ledger-stat-icon gold"><Activity size={18} /></div>
          <div className="ledger-stat-info">
            <span className="ledger-stat-label">Total Recommendations</span>
            <span className="ledger-stat-value">{totalCount}</span>
          </div>
        </div>

        <div className="ledger-stat-card green">
          <div className="ledger-stat-icon green"><TrendingUp size={18} /></div>
          <div className="ledger-stat-info">
            <span className="ledger-stat-label">Call Options (CE)</span>
            <span className="ledger-stat-value">{ceCount}</span>
          </div>
        </div>

        <div className="ledger-stat-card red">
          <div className="ledger-stat-icon red"><ShieldAlert size={18} /></div>
          <div className="ledger-stat-info">
            <span className="ledger-stat-label">Put Options (PE)</span>
            <span className="ledger-stat-value">{peCount}</span>
          </div>
        </div>

        <div className="ledger-stat-card blue">
          <div className="ledger-stat-icon blue"><Award size={18} /></div>
          <div className="ledger-stat-info">
            <span className="ledger-stat-label">Avg Checklist Score</span>
            <span className="ledger-stat-value">{avgScore}/7</span>
          </div>
        </div>

        <div className="ledger-stat-card green">
          <div className="ledger-stat-icon green"><Info size={18} /></div>
          <div className="ledger-stat-info">
            <span className="ledger-stat-label">Fresh Signals (<span style={{ fontSize: '0.62rem', fontWeight: 'bold' }}>5m</span>)</span>
            <span className="ledger-stat-value">{freshCount}</span>
          </div>
        </div>
      </div>

      {/* Main Table + Inspector Section */}
      <div className="ledger-main-section">
        
        {/* Table Column */}
        <div className="ledger-table-container">
          <div className="ledger-toolbar">
            
            {/* Scrip Group Filters */}
            <div className="ledger-filters">
              {filterOptions.map(opt => {
                const count = counts[opt.id];
                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setActiveFilter(opt.id);
                      setSelectedSignal(null);
                    }}
                    className={`ledger-filter-pill ${activeFilter === opt.id ? 'active' : ''}`}
                  >
                    {opt.name}
                    <span className="signals-count-badge" style={{ 
                      background: activeFilter === opt.id ? 'var(--accent-gold)' : 'rgba(255, 255, 255, 0.08)',
                      color: activeFilter === opt.id ? '#000000' : 'var(--text-muted)'
                    }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Other Select Filters */}
            <div className="ledger-selects">
              <select 
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setSelectedSignal(null);
                }}
                className="ledger-select"
              >
                <option value="ALL">All Types (CE/PE)</option>
                <option value="CE">Call Option (CE)</option>
                <option value="PE">Put Option (PE)</option>
              </select>

              <select 
                value={sourceFilter}
                onChange={(e) => {
                  setSourceFilter(e.target.value);
                  setSelectedSignal(null);
                }}
                className="ledger-select"
              >
                <option value="ALL">All Sources</option>
                <option value="LIVE">⚡ Live Market</option>
                <option value="SIMULATION">🧪 Simulation</option>
                <option value="BACKTEST">📊 Backtest</option>
              </select>
            </div>

          </div>

          {/* Scrollable Table grid */}
          <div className="ledger-scrollable-table">
            {signals.length === 0 ? (
              <div className="no-data-msg" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dark)' }}>
                No option recommendation signals generated yet in this session.
              </div>
            ) : filteredSignals.length === 0 ? (
              <div className="no-data-msg" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dark)' }}>
                No matching recommendation signals found. Try adjusting filters.
              </div>
            ) : (
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Date &amp; Time</th>
                    <th>Contract</th>
                    <th>Expiry</th>
                    <th>Type</th>
                    <th>Spot Price</th>
                    <th>Est. Premium</th>
                    <th>Target</th>
                    <th>Stop Loss</th>
                    <th>Checklist</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSignals.map((sig, idx) => {
                    const isBull = sig.signal_type === 'BULLISH';
                    const isSelected = selectedSignal && selectedSignal.time === sig.time && selectedSignal.contract_name === sig.contract_name && selectedSignal.date === sig.date;
                    const dateStr = sig.date || new Date().toISOString().split('T')[0];
                    const timeStr = sig.time;

                    // Date & Time formatting
                    let formattedDateTime = `${dateStr} ${timeStr}`;
                    if (sig.timestamp) {
                      try {
                        const d = new Date(sig.timestamp * 1000);
                        formattedDateTime = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                      } catch {}
                    } else {
                      try {
                        const d = new Date(`${dateStr}T${timeStr}`);
                        if (!isNaN(d.getTime())) {
                          formattedDateTime = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + timeStr;
                        }
                      } catch {}
                    }

                    return (
                      <tr 
                        key={idx} 
                        className={isSelected ? "selected" : ""} 
                        onClick={() => handleRowClick(sig)}
                      >
                        <td>
                          {(() => {
                            const badge = getSourceBadge(sig.source);
                            return (
                              <span style={{
                                padding: '3px 6px',
                                borderRadius: '4px',
                                fontSize: '0.65rem',
                                fontWeight: '800',
                                whiteSpace: 'nowrap',
                                ...badge.style
                              }}>
                                {badge.text.split(' ')[1] || badge.text}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="monospace-font" style={{ whiteSpace: 'nowrap' }}>{formattedDateTime}</td>
                        <td style={{ fontWeight: '600' }}>{sig.contract_name}</td>
                        <td className="monospace-font" style={{ whiteSpace: 'nowrap' }}>{sig.expiry || '—'}</td>
                        <td>
                          <span className={`order-badge ${isBull ? 'buy' : 'sell'}`} style={{ fontSize: '0.68rem', padding: '2px 5px', fontWeight: '800' }}>
                            {isBull ? 'CE' : 'PE'}
                          </span>
                        </td>
                        <td className="monospace-font">₹{sig.spot_price.toLocaleString('en-IN', { minimumFractionDigits: 1 })}</td>
                        <td className="monospace-font">₹{sig.opt_entry.toFixed(1)}</td>
                        <td className="monospace-font" style={{ color: 'var(--accent-green)' }}>₹{sig.opt_tp.toFixed(1)}</td>
                        <td className="monospace-font" style={{ color: 'var(--accent-red)' }}>₹{sig.opt_sl.toFixed(1)}</td>
                        <td>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: sig.checklist_score >= 4 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: sig.checklist_score >= 4 ? 'var(--accent-green)' : 'var(--accent-red)',
                            fontSize: '0.72rem',
                            fontWeight: '800',
                            border: `1px solid ${sig.checklist_score >= 4 ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`
                          }}>
                            {sig.checklist_score || 0}/7
                          </span>
                        </td>
                        <td><ChevronRight size={14} style={{ opacity: 0.3 }} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Slide-out Analytical Inspector */}
        {selectedSignal && (
          <div className="ledger-inspector">
            <div className="inspector-header">
              <span style={{ fontSize: '0.72rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '5px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                <FileText size={13} style={{ color: 'var(--accent-gold)' }} />
                Signal Inspector
              </span>
              <button 
                onClick={() => setSelectedSignal(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="inspector-body">
              {/* Contract description */}
              <div className="inspector-title-row">
                <span className="inspector-contract-name">{selectedSignal.contract_name}</span>
                <div className="inspector-meta-row">
                  <span style={{ fontWeight: 'bold' }}>
                    {selectedSignal.signal_type === 'BULLISH' ? '🟢 CALL BUY (CE)' : '🔴 PUT BUY (PE)'}
                  </span>
                  <span>
                    {selectedSignal.timestamp ? 
                      new Date(selectedSignal.timestamp * 1000).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                      }) : 
                      `${selectedSignal.date} ${selectedSignal.time}`
                    }
                  </span>
                </div>
              </div>

              {/* Option prices */}
              <div className="inspector-checklist-title">Option Premium Pricing</div>
              <div className="inspector-metrics-card" style={{ borderLeft: `3px solid ${selectedSignal.signal_type === 'BULLISH' ? 'var(--accent-green)' : 'var(--accent-red)'}` }}>
                <div className="inspector-metric-row">
                  <span className="inspector-metric-label">Estimated Entry</span>
                  <span className="inspector-metric-val" style={{ fontSize: '1rem' }}>₹{selectedSignal.opt_entry.toFixed(1)}</span>
                </div>
                <div className="inspector-metric-row">
                  <span className="inspector-metric-label">Stop Loss</span>
                  <span className="inspector-metric-val red-val">₹{selectedSignal.opt_sl.toFixed(1)}</span>
                </div>
                <div className="inspector-metric-row">
                  <span className="inspector-metric-label">Target (TP)</span>
                  <span className="inspector-metric-val green-val">₹{selectedSignal.opt_tp.toFixed(1)}</span>
                </div>
              </div>

              {/* Spot prices */}
              <div className="inspector-checklist-title">Spot Index Reference</div>
              <div className="inspector-metrics-card">
                <div className="inspector-metric-row">
                  <span className="inspector-metric-label">Spot Price at Trigger</span>
                  <span className="inspector-metric-val">₹{selectedSignal.spot_price.toLocaleString('en-IN', { minimumFractionDigits: 1 })}</span>
                </div>
                <div className="inspector-metric-row">
                  <span className="inspector-metric-label">Spot Stop Loss</span>
                  <span className="inspector-metric-val">₹{selectedSignal.spot_sl.toLocaleString('en-IN', { minimumFractionDigits: 1 })}</span>
                </div>
                <div className="inspector-metric-row">
                  <span className="inspector-metric-label">Spot Target</span>
                  <span className="inspector-metric-val">₹{selectedSignal.spot_tp.toLocaleString('en-IN', { minimumFractionDigits: 1 })}</span>
                </div>
                <div className="inspector-metric-row" style={{ fontSize: '0.72rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px', marginTop: '2px' }}>
                  <span className="inspector-metric-label">ATR (14-period)</span>
                  <span className="inspector-metric-val">₹{selectedSignal.atr ? selectedSignal.atr.toFixed(1) : '—'}</span>
                </div>
              </div>

              {/* Risk Reward Visual bar */}
              <div className="inspector-checklist-box">
                <span className="inspector-checklist-title">Risk-Reward Analysis (1 : 1.67)</span>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  SL: 1.5x ATR | Target: 2.5x ATR
                </div>
                <div className="rr-track">
                  <div className="rr-fill"></div>
                  <div className="rr-pin"></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-dark)', marginTop: '2px', fontWeight: 'bold' }}>
                  <span>Risk (SL)</span>
                  <span>Entry</span>
                  <span>Reward (Target)</span>
                </div>
              </div>

              {/* Checklist details */}
              {selectedSignal.checklist_details && (
                <div className="inspector-checklist-box">
                  <div className="inspector-checklist-title">
                    Checklist Checklist ({selectedSignal.checklist_score}/7 Met):
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                    {Object.entries(selectedSignal.checklist_details).map(([condName, passed]) => (
                      <div 
                        key={condName} 
                        className={`inspector-checklist-item ${passed ? 'passed' : 'failed'}`}
                      >
                        <div className={`inspector-dot ${passed ? 'passed' : 'failed'}`}></div>
                        <span style={{ 
                          fontWeight: passed ? '600' : '500', 
                          color: passed ? 'var(--text-main)' : 'var(--text-dark)' 
                        }}>
                          {condName}
                        </span>
                        <span style={{ 
                          marginLeft: 'auto', 
                          fontSize: '0.65rem', 
                          fontWeight: '800', 
                          color: passed ? 'var(--accent-green)' : 'var(--accent-red)' 
                        }}>
                          {passed ? 'PASSED' : 'FAILED'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

      </div>
    </div>
  );
}
