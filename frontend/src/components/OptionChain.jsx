import { RefreshCw } from 'lucide-react';

export default function OptionChain({ 
  activeScrip, 
  chain = [], 
  spotPrice = 0, 
  mode = 'MOCK', 
  loading = false, 
  errorMsg = '', 
  onRefresh 
}) {

  // Determine ITM status
  // For CE: Strike < Spot is ITM
  // For PE: Strike > Spot is ITM
  const isItm = (strike, type) => {
    if (!spotPrice) return false;
    if (type === 'CE') return strike < spotPrice;
    if (type === 'PE') return strike > spotPrice;
    return false;
  };

  return (
    <div className="panel-content-scroll" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '4px 10px 10px 10px', minHeight: '0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: '800', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Option Chain: <span style={{ color: 'var(--accent-gold)' }}>{activeScrip.split('|')[1]}</span>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.02)', padding: '3px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Index Spot:</span>
            <strong style={{ fontSize: '0.72rem', color: 'var(--text-main)' }}>₹{spotPrice ? spotPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—'}</strong>
          </div>
          <span style={{ 
            fontSize: '0.6rem', 
            fontWeight: '800',
            padding: '2px 6px', 
            borderRadius: '4px',
            background: mode && mode.startsWith('LIVE') ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
            color: mode && mode.startsWith('LIVE') ? 'var(--accent-green)' : 'var(--accent-gold)',
            border: `1px solid ${mode && mode.startsWith('LIVE') ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`,
            letterSpacing: '0.3px'
          }}>
            {mode === 'LIVE' ? 'LIVE FYERS FEED' : (mode && mode.includes('FALLBACK') ? 'THEORETICAL FALLBACK' : 'THEORETICAL MOCK')}
          </span>
        </div>
        <button 
          onClick={onRefresh} 
          disabled={loading}
          style={{
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '6px',
            color: 'var(--accent-blue)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '0.65rem',
            fontWeight: 'bold',
            padding: '4px 10px',
            transition: 'all 0.2s'
          }}
          className="btn-secondary"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Force Sync
        </button>
      </div>

      {errorMsg && (
        <div style={{ color: 'var(--accent-red)', fontSize: '0.7rem', fontWeight: 600, marginBottom: '8px', background: 'rgba(239, 68, 68, 0.08)', padding: '5px 10px', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.15)', flexShrink: 0 }}>
          ⚠️ {errorMsg}
        </div>
      )}

      <div style={{ flexGrow: 1, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'rgba(0,0,0,0.15)' }}>
        <table className="orders-table option-chain-table-design" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 2, boxShadow: '0 1px 0 var(--border-color)' }}>
            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
              <th colSpan="3" style={{ borderRight: '1px solid var(--border-color)', padding: '6px 8px', color: 'var(--accent-green)', fontWeight: '800', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>CALLS (CE)</th>
              <th style={{ padding: '6px 8px', color: 'var(--text-main)', fontWeight: '800', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>STRIKE</th>
              <th colSpan="3" style={{ borderLeft: '1px solid var(--border-color)', padding: '6px 8px', color: 'var(--accent-gold)', fontWeight: '800', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>PUTS (PE)</th>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.01)', fontSize: '0.65rem' }}>
              <th style={{ padding: '6px 4px', fontWeight: '700', color: 'var(--text-muted)', width: '15%' }}>OI</th>
              <th style={{ padding: '6px 4px', fontWeight: '700', color: 'var(--text-muted)', width: '10%' }}>IV</th>
              <th style={{ padding: '6px 4px', fontWeight: '800', color: 'var(--text-main)', borderRight: '1px solid var(--border-color)', width: '15%' }}>LTP (CE)</th>
              <th style={{ padding: '6px 4px', fontWeight: '800', color: 'var(--accent-blue)', background: 'rgba(255,255,255,0.02)', width: '20%' }}>STRIKE PRICE</th>
              <th style={{ padding: '6px 4px', fontWeight: '800', color: 'var(--text-main)', borderLeft: '1px solid var(--border-color)', width: '15%' }}>LTP (PE)</th>
              <th style={{ padding: '6px 4px', fontWeight: '700', color: 'var(--text-muted)', width: '10%' }}>IV</th>
              <th style={{ padding: '6px 4px', fontWeight: '700', color: 'var(--text-muted)', width: '15%' }}>OI</th>
            </tr>
          </thead>
          <tbody style={{ fontSize: '0.72rem' }}>
            {chain.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ padding: '20px', color: 'var(--text-dark)' }}>
                  No option chain data available. Confirm broker credentials or server status.
                </td>
              </tr>
            ) : (
              chain.map(row => {
                const strike = row.strike_price;
                const isAtm = Math.abs(strike - spotPrice) <= 25; // Highlight ATM strike
                
                const ce = row.CE || {};
                const pe = row.PE || {};
                
                const ceLtp = ce.ltp !== undefined ? ce.ltp : '—';
                const peLtp = pe.ltp !== undefined ? pe.ltp : '—';
                const ceIv = ce.iv !== undefined ? ce.iv : '—';
                const peIv = pe.iv !== undefined ? pe.iv : '—';
                const ceOi = ce.oi !== undefined ? ce.oi : '—';
                const peOi = pe.oi !== undefined ? pe.oi : '—';

                // Shade In-The-Money (ITM) options a soft yellow/amber background color
                const ceBg = isItm(strike, 'CE') ? 'rgba(245, 158, 11, 0.035)' : 'transparent';
                const peBg = isItm(strike, 'PE') ? 'rgba(245, 158, 11, 0.035)' : 'transparent';
                const strikeBg = isAtm ? 'rgba(59, 130, 246, 0.16)' : 'rgba(255,255,255,0.015)';

                return (
                  <tr 
                    key={strike} 
                    style={{ 
                      borderBottom: '1px solid rgba(255,255,255,0.02)',
                      background: isAtm ? 'rgba(59, 130, 246, 0.05)' : 'transparent'
                    }}
                  >
                    {/* CE Side */}
                    <td style={{ padding: '6px 4px', background: ceBg, color: 'var(--text-muted)' }}>
                      {typeof ceOi === 'number' ? ceOi.toLocaleString('en-IN') : ceOi}
                    </td>
                    <td style={{ padding: '6px 4px', background: ceBg, color: 'var(--text-dark)' }}>
                      {typeof ceIv === 'number' ? `${ceIv.toFixed(1)}%` : ceIv}
                    </td>
                    <td style={{ padding: '6px 4px', background: ceBg, borderRight: '1px solid var(--border-color)', fontWeight: '800', color: 'var(--accent-green)' }}>
                      {typeof ceLtp === 'number' ? `₹${ceLtp.toFixed(2)}` : ceLtp}
                    </td>
                    
                    {/* Strike Price */}
                    <td style={{ 
                      padding: '6px 4px', 
                      fontWeight: '800', 
                      color: isAtm ? '#3b82f6' : 'var(--text-main)', 
                      background: strikeBg,
                      borderLeft: isAtm ? '2px solid #3b82f6' : 'none',
                      borderRight: isAtm ? '2px solid #3b82f6' : 'none'
                    }}>
                      {strike}
                    </td>

                    {/* PE Side */}
                    <td style={{ padding: '6px 4px', background: peBg, borderLeft: '1px solid var(--border-color)', fontWeight: '800', color: 'var(--accent-gold)' }}>
                      {typeof peLtp === 'number' ? `₹${peLtp.toFixed(2)}` : peLtp}
                    </td>
                    <td style={{ padding: '6px 4px', background: peBg, color: 'var(--text-dark)' }}>
                      {typeof peIv === 'number' ? `${peIv.toFixed(1)}%` : peIv}
                    </td>
                    <td style={{ padding: '6px 4px', background: peBg, color: 'var(--text-muted)' }}>
                      {typeof peOi === 'number' ? peOi.toLocaleString('en-IN') : peOi}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
