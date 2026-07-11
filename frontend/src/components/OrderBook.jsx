import { ShoppingBag } from 'lucide-react';

export default function OrderBook({ orders, hideHeader = false }) {
  // Format Unix timestamp to Date & Time
  const formatDateTime = (ts) => {
    const d = new Date(ts * 1000);
    const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const timeStr = d.toLocaleTimeString('en-IN', { hour12: false });
    return `${dateStr} ${timeStr}`;
  };

  return (
    <div className={hideHeader ? "panel-content-scroll" : "glass-card bottom-panel-card"}>
      {!hideHeader && (
        <div className="panel-header">
          <h3>
            <ShoppingBag size={14} style={{ color: 'var(--accent-blue)' }} />
            Simulated Orders History
          </h3>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-dark)' }}>
            {orders.length} Executed
          </span>
        </div>
      )}

      <div className={hideHeader ? "" : "panel-content-scroll"}>
        {orders.length === 0 ? (
          <div className="no-data-msg">
            No orders executed yet. Waiting for strategy signals or manual actions...
          </div>
        ) : (
          <table className="orders-table">
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Ticker</th>
                <th>Action</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Type</th>
                <th>Realized PnL</th>
              </tr>
            </thead>
            <tbody>
              {/* Show newest orders first */}
              {[...orders].reverse().map((o, idx) => {
                const isBuy = o.side === 'BUY';
                const pnl = o.realized_pnl || 0.0;
                
                return (
                  <tr key={o.order_id ? `${o.order_id}-${idx}` : idx}>
                    <td style={{ color: 'var(--text-dark)', fontFamily: 'monospace' }}>
                      {formatDateTime(o.timestamp)}
                    </td>
                    <td style={{ fontWeight: 700 }}>
                      {o.scrip}
                    </td>
                    <td>
                      <span className={`order-badge ${isBuy ? 'buy' : 'sell'}`}>
                        {o.side}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace' }}>
                      {o.qty}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      ₹{o.price.toFixed(2)}
                    </td>
                    <td style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {o.type}
                    </td>
                    <td className={pnl > 0 ? 'up-val' : (pnl < 0 ? 'down-val' : '')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                      {pnl > 0 ? '+' : ''}{pnl !== 0 ? `₹${pnl.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
