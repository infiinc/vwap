import { TrendingUp } from 'lucide-react';

const POPULAR_SCRIPS = [
  { id: 'NSE|NIFTY 50', name: 'Nifty 50 Index', desc: 'NSE Index' },
  { id: 'BSE|SENSEX', name: 'BSE Sensex Index', desc: 'BSE Index' },
  { id: 'NSE|NIFTY BANK', name: 'Nifty Bank Index', desc: 'NSE Index' },
  { id: 'NSE|NIFTY FIN SERVICE', name: 'Nifty Fin Service Index', desc: 'NSE Index' }
];

export default function WatchList({ activeScrip, onSelectScrip, prices, lastSignals }) {
  return (
    <div className="glass-card watchlist-container" style={{ flexGrow: 1 }}>
      <h3>
        <span>Watch List</span>
        <TrendingUp size={14} style={{ color: 'var(--accent-green)' }} />
      </h3>
      
      <div className="watchlist-items">
        {POPULAR_SCRIPS.map((scrip) => {
          const isActive = scrip.id === activeScrip;
          const livePrice = prices[scrip.id] || 0.0;
          
          // Generate a stable visual change based on price digits (mock percent)
          const baseSeed = scrip.id.length * 7.1;
          const mockPercent = (Math.sin(baseSeed) * 0.8).toFixed(2);
          const isUp = parseFloat(mockPercent) >= 0;
          
          // Get the active signal for this scrip
          const signal = lastSignals[scrip.id] || 'HOLD';
          
          return (
            <div
              key={scrip.id}
              onClick={() => onSelectScrip(scrip.id)}
              className={`watchlist-item ${isActive ? 'active' : ''}`}
            >
              <div className="watchlist-details">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="watchlist-ticker">{scrip.id.split('|')[1]}</span>
                  {signal !== 'HOLD' && (
                    <span style={{
                      fontSize: '0.6rem',
                      fontWeight: 800,
                      padding: '2px 4px',
                      borderRadius: '3px',
                      backgroundColor: signal === 'BUY' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: signal === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)',
                      border: `1px solid ${signal === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)'}`
                    }}>
                      {signal}
                    </span>
                  )}
                </div>
                <span className="watchlist-name">{scrip.name}</span>
              </div>
              
              <div className="watchlist-values">
                <span className="watchlist-price">
                  {livePrice > 0 ? `₹${livePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'Loading...'}
                </span>
                <span className={`watchlist-change ${isUp ? 'up-val' : 'down-val'}`}>
                  {isUp ? '+' : ''}{mockPercent}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
