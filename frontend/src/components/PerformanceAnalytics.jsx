import { useEffect, useRef } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';
import { TrendingUp, BarChart2, Award, AlertCircle } from 'lucide-react';

const themeColors = {
  'oceanic': {
    text: '#94a3b8',
    border: 'rgba(255, 255, 255, 0.06)',
    grid: 'rgba(255, 255, 255, 0.02)',
    line: '#f59e0b',
  },
  'midnight': {
    text: '#9ca3af',
    border: 'rgba(255, 255, 255, 0.08)',
    grid: 'rgba(255, 255, 255, 0.03)',
    line: '#fbbf24',
  },
  'obsidian': {
    text: '#a3a3a3',
    border: 'rgba(255, 255, 255, 0.06)',
    grid: 'rgba(255, 255, 255, 0.02)',
    line: '#ffd700',
  },
  'forest': {
    text: '#a7f3d0',
    border: 'rgba(255, 255, 255, 0.07)',
    grid: 'rgba(255, 255, 255, 0.02)',
    line: '#fbbf24',
  },
  'tradingview-light': {
    text: '#6a6d78',
    border: '#e0e3eb',
    grid: '#f0f3fa',
    line: '#ff9800',
  }
};

export default function PerformanceAnalytics({ metrics, orders, theme = 'oceanic' }) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const lineSeriesRef = useRef(null);

  const realizedPnL = metrics.realized_pnl || 0.0;
  const unrealizedPnL = metrics.unrealized_pnl || 0.0;
  const totalPnL = realizedPnL + unrealizedPnL;
  const isPnlPositive = totalPnL >= 0;

  // 1. Calculate Profit Factor
  const grossProfit = metrics.gross_profit || 0.0;
  const grossLoss = Math.abs(metrics.gross_loss || 0.0);
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? '∞' : '1.00';

  // 2. Calculate Sharpe Ratio
  const closedTrades = orders.filter((o) => o.realized_pnl !== 0);
  let sharpeRatio = '0.00';
  if (closedTrades.length > 1) {
    const pnls = closedTrades.map((o) => o.realized_pnl);
    const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const variance = pnls.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (pnls.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      // Annualized Sharpe Ratio approximation (assuming roughly 252 trading blocks/days)
      sharpeRatio = ((mean / stdDev) * Math.sqrt(252)).toFixed(2);
    }
  }

  // 3. Calculate CE / PE Ratio
  const ceCount = orders.filter((o) => o.type === 'ENTRY' && o.side === 'BUY').length;
  const peCount = orders.filter((o) => o.type === 'ENTRY' && o.side === 'SELL').length;
  const cePeRatio = peCount > 0 ? (ceCount / peCount).toFixed(2) : ceCount > 0 ? 'CE Only' : '1.00';

  const activeColors = themeColors[theme] || themeColors['midnight'];
  const { border, grid, line, text } = activeColors;

  // 4. Draw Equity Curve using lightweight-charts
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: text,
        fontSize: 10,
        fontFamily: 'Outfit, sans-serif',
      },
      grid: {
        vertLines: { color: grid },
        horzLines: { color: grid },
      },
      rightPriceScale: {
        borderColor: border,
        visible: true,
      },
      timeScale: {
        borderColor: border,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: border, width: 1, style: 1 },
        horzLine: { color: border, width: 1, style: 1 },
      },
      handleScroll: true,
      handleScale: true,
    });

    chartRef.current = chart;

    const lineSeries = chart.addSeries(LineSeries, {
      color: line,
      lineWidth: 2.5,
      title: 'Equity Curve',
    });
    lineSeriesRef.current = lineSeries;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);
    handleResize();

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [border, grid, line, text]);

  // Update chart data when orders change
  useEffect(() => {
    if (!lineSeriesRef.current || !chartRef.current) return;

    let balance = 100000.0;
    const dataPoints = [{ time: Math.floor(Date.now() / 1000) - 86400, value: balance }];

    const sortedOrders = [...orders].sort((a, b) => a.timestamp - b.timestamp);
    const timeTracker = new Set();

    sortedOrders.forEach((o) => {
      // Lightweight charts requires strictly increasing timestamps
      let ts = o.timestamp;
      while (timeTracker.has(ts)) {
        ts += 1;
      }
      timeTracker.add(ts);

      dataPoints.push({
        time: ts,
        value: o.cash_balance,
      });
    });

    // Sort again just in case
    dataPoints.sort((a, b) => a.time - b.time);

    try {
      lineSeriesRef.current.setData(dataPoints);
      chartRef.current.timeScale().fitContent();
    } catch (e) {
      console.warn('Error rendering equity curve data:', e);
    }
  }, [orders]);
  return (
    <div className="perf-tab-container" style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '20px', height: '100%', minHeight: '0', padding: '10px' }}>
      
      {/* Metrics Ledger Grid */}
      <div className="perf-metrics-ledger" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
        
        {/* Sharpe Ratio */}
        <div className="glass-card perf-metric-box">
          <div className="perf-label-row">
            <span>Sharpe Ratio</span>
            <Award size={14} style={{ color: 'var(--accent-gold)' }} />
          </div>
          <div className="perf-val" style={{ color: 'var(--accent-gold)', textShadow: '0 0 8px var(--accent-gold-glow)' }}>
            {sharpeRatio}
          </div>
          <span className="perf-sub-desc">Annualized risk-adjusted return</span>
        </div>

        {/* Profit Factor */}
        <div className="glass-card perf-metric-box">
          <div className="perf-label-row">
            <span>Profit Factor</span>
            <TrendingUp size={14} style={{ color: '#10b981' }} />
          </div>
          <div className="perf-val" style={{ color: '#10b981', textShadow: '0 0 8px rgba(16,185,129,0.2)' }}>
            {profitFactor}
          </div>
          <span className="perf-sub-desc">Gross Profit / Gross Loss</span>
        </div>

        {/* CE / PE Ratio */}
        <div className="glass-card perf-metric-box">
          <div className="perf-label-row">
            <span>CE / PE Ratio</span>
            <BarChart2 size={14} style={{ color: 'var(--accent-blue)' }} />
          </div>
          <div className="perf-val" style={{ color: 'var(--accent-blue)', textShadow: '0 0 8px rgba(59,130,246,0.2)' }}>
            {cePeRatio}
          </div>
          <span className="perf-sub-desc">Ratio of Call to Put entries</span>
        </div>

        {/* Max Drawdown */}
        <div className="glass-card perf-metric-box">
          <div className="perf-label-row">
            <span>Max Drawdown</span>
            <AlertCircle size={14} style={{ color: 'var(--accent-red)' }} />
          </div>
          <div className="perf-val" style={{ color: 'var(--accent-red)', textShadow: '0 0 8px var(--accent-red-glow)' }}>
            {metrics.max_drawdown}%
          </div>
          <span className="perf-sub-desc">Peak-to-trough decline</span>
        </div>

        {/* Win Rate */}
        <div className="glass-card perf-metric-box" style={{ gridColumn: 'span 2' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
            <span>Win Rate: <strong>{metrics.win_rate}%</strong> ({metrics.total_trades} closed trades)</span>
            <span>Net Profit: <strong className={isPnlPositive ? 'up-val' : 'down-val'}>₹{totalPnL.toFixed(2)}</strong></span>
          </div>
          <div style={{ width: '100%', height: '6px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: `${metrics.win_rate}%`, height: '100%', background: 'var(--accent-gold)', borderRadius: '3px', boxShadow: '0 0 8px var(--accent-gold-glow)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-dark)', marginTop: '6px' }}>
            <span>Wins: <strong className="up-val">₹{grossProfit.toFixed(1)}</strong></span>
            <span>Losses: <strong className="down-val">₹{grossLoss.toFixed(1)}</strong></span>
            <span>Unrealized PnL: <strong className={unrealizedPnL >= 0 ? 'up-val' : 'down-val'}>₹{unrealizedPnL.toFixed(1)}</strong></span>
          </div>
        </div>

      </div>

      {/* Equity Curve Chart */}
      <div className="glass-card perf-chart-box" style={{ display: 'flex', flexDirection: 'column', padding: '12px' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
          📈 Real-Time Account Equity Curve (Cash Balance)
        </div>
        <div style={{ flexGrow: 1, position: 'relative', minHeight: '0' }}>
          <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
        </div>
      </div>

    </div>
  );
}
