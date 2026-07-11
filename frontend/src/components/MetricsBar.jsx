import { DollarSign, Percent, Briefcase, Activity } from 'lucide-react';

export default function MetricsBar({ metrics }) {
  const realizedPnL = metrics.realized_pnl || 0.0;
  const unrealizedPnL = metrics.unrealized_pnl || 0.0;
  const totalPnL = realizedPnL + unrealizedPnL;
  const winRate = metrics.win_rate || 0.0;
  
  const isPnlPositive = totalPnL >= 0;
  const isRealizedPositive = realizedPnL >= 0;
  
  return (
    <div className="metrics-container">
      {/* Total Net Profit */}
      <div className={`glass-card metric-card ${isPnlPositive ? 'pnl-plus' : 'pnl-minus'}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="metric-label">Net Profit &amp; Loss</span>
          <DollarSign size={16} style={{ color: isPnlPositive ? 'var(--accent-green)' : 'var(--accent-red)' }} />
        </div>
        <span className={`metric-value ${isPnlPositive ? 'up-val' : 'down-val'}`} style={{ textShadow: `0 0 10px ${isPnlPositive ? 'var(--accent-green-glow)' : 'var(--accent-red-glow)'}` }}>
          {isPnlPositive ? '+' : ''}₹{totalPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </span>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
          <span style={{ color: 'var(--text-dark)' }}>Realized: <span className={isRealizedPositive ? 'up-val' : 'down-val'}>₹{realizedPnL.toFixed(2)}</span></span>
          <span style={{ color: 'var(--text-dark)' }}>Unrealized: <span className={unrealizedPnL >= 0 ? 'up-val' : 'down-val'}>₹{unrealizedPnL.toFixed(2)}</span></span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginTop: '4px', borderTop: '1px solid var(--border-color)', paddingTop: '4px' }}>
          <span style={{ color: 'var(--text-dark)' }}>Gross Wins: <span className="up-val" style={{ fontWeight: 700 }}>+₹{(metrics.gross_profit || 0.0).toFixed(2)}</span></span>
          <span style={{ color: 'var(--text-dark)' }}>Gross Losses: <span className="down-val" style={{ fontWeight: 700 }}>₹{(metrics.gross_loss || 0.0).toFixed(2)}</span></span>
        </div>
      </div>

      {/* Account Cash / Net Asset Value */}
      <div className="glass-card metric-card blue-metric">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="metric-label">Account Value (NAV)</span>
          <Briefcase size={16} style={{ color: 'var(--accent-blue)' }} />
        </div>
        <span className="metric-value" style={{ color: 'var(--text-main)' }}>
          ₹{(metrics.nav || 100000.0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </span>
        <span className="metric-sub">Cash Balance: ₹{(metrics.balance || 100000.0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>

      {/* Win Rate */}
      <div className="glass-card metric-card gold-metric">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="metric-label">Win Rate</span>
          <Percent size={16} style={{ color: 'var(--accent-gold)' }} />
        </div>
        <span className="metric-value" style={{ color: 'var(--accent-gold)' }}>
          {winRate}%
        </span>
        
        {/* Simple Win Rate Progress Bar */}
        <div style={{
          width: '100%',
          height: '4px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '2px',
          overflow: 'hidden',
          marginTop: '2px'
        }}>
          <div style={{
            width: `${winRate}%`,
            height: '100%',
            background: 'var(--accent-gold)',
            borderRadius: '2px',
            boxShadow: '0 0 8px var(--accent-gold-glow)'
          }} />
        </div>
      </div>

      {/* Active Position */}
      <div className="glass-card metric-card blue-metric">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="metric-label">Active Position</span>
          <Activity size={16} style={{ color: 'var(--accent-blue)' }} />
        </div>
        <span className="metric-value" style={{
          fontSize: '1rem',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: metrics.active_qty !== 0 ? (metrics.active_qty > 0 ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--text-dark)'
        }}>
          {metrics.active_position_desc || 'FLAT'}
        </span>
        <span className="metric-sub">Total Trades: {metrics.total_trades || 0} | Drawdown: {metrics.max_drawdown || 0.0}%</span>
      </div>
    </div>
  );
}
