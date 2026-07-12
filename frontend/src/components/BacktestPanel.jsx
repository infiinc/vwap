import { useState, useEffect, useRef } from 'react';
import { createChart, AreaSeries } from 'lightweight-charts';
import { Database, Play, BarChart2, TrendingUp, Award, Calendar, Key, AlertTriangle, ShieldCheck } from 'lucide-react';

const themeColors = {
  text: '#94a3b8',
  border: 'rgba(255, 255, 255, 0.06)',
  grid: 'rgba(255, 255, 255, 0.02)',
  line: 'var(--accent-gold, #f59e0b)',
};

const LOT_SIZES = {
  'NSE|NIFTY 50': 65,
  'NSE|NIFTY BANK': 30,
  'NSE|NIFTY FIN SERVICE': 60,
  'BSE|SENSEX': 20
};

const SCRIP_DISPLAY_NAMES = {
  'NSE|NIFTY 50': 'Nifty 50',
  'NSE|NIFTY BANK': 'Bank Nifty',
  'NSE|NIFTY FIN SERVICE': 'FINNIFTY',
  'BSE|SENSEX': 'BSE Sensex'
};

export default function BacktestPanel({ theme = 'oceanic', baseUrl = 'http://127.0.0.1:8000' }) {
  // Dhan Fetch Form State
  const [dhanCreds, setDhanCreds] = useState({
    clientId: '',
    accessToken: '',
    fromDate: '',
    toDate: '',
    outputName: 'historical_nifty.csv',
    securityId: '13',
    segment: 'IDX_I',
    instrument: 'INDEX'
  });

  const [lastActiveDate, setLastActiveDate] = useState('to'); // 'from' or 'to'
  
  // Backtest Config State
  const [backtestConfig, setBacktestConfig] = useState({
    csvFile: '',
    vix: 15.0,
    lots: 1,
    qty: 65,
    std: 2.0,
    interval: 5,
    scrip: 'NSE|NIFTY 50',
    min_checklist_score: 4
  });

  const [csvFiles, setCsvFiles] = useState([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchMessage, setFetchMessage] = useState({ type: '', text: '' });
  
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestResults, setBacktestResults] = useState(null);
  const [backtestError, setBacktestError] = useState('');

  const equityChartRef = useRef(null);
  const drawdownChartRef = useRef(null);
  const equityChartInstance = useRef(null);
  const drawdownChartInstance = useRef(null);

  // Load available CSV files from backend on mount
  useEffect(() => {
    fetchCsvFiles();
  }, []);

  const fetchCsvFiles = async () => {
    try {
      const res = await fetch(`${baseUrl}/api/backtest/csv_files`);
      const data = await res.json();
      if (res.ok && data.files) {
        setCsvFiles(data.files);
        if (data.files.length > 0 && !backtestConfig.csvFile) {
          setBacktestConfig(prev => ({ ...prev, csvFile: data.files[0] }));
        }
      }
    } catch (err) {
      console.error('Error fetching CSV files:', err);
    }
  };

  // Setup Equity & Drawdown Charts when results arrive
  useEffect(() => {
    if (!backtestResults) return;

    let equityChart = null;
    let drawdownChart = null;
    let resizeObserver = null;

    const timer = setTimeout(() => {
      if (!equityChartRef.current || !drawdownChartRef.current) return;

      const orders = backtestResults.orders || [];
      const initialBalance = 100000.0;
      const sortedOrders = [...orders].sort((a, b) => a.timestamp - b.timestamp);

      const equityData = [];
      const drawdownData = [];
      let peak = initialBalance;

      if (sortedOrders.length > 0) {
        equityData.push({
          time: sortedOrders[0].timestamp - 60,
          value: initialBalance
        });
        drawdownData.push({
          time: sortedOrders[0].timestamp - 60,
          value: 0
        });
      }

      let lastTime = sortedOrders.length > 0 ? sortedOrders[0].timestamp - 60 : 0;
      sortedOrders.forEach((o) => {
        let currentTime = o.timestamp;
        if (currentTime <= lastTime) {
          currentTime = lastTime + 1;
        }

        const bal = o.cash_balance;
        peak = Math.max(peak, bal);
        const dd = ((peak - bal) / peak) * 100.0;

        equityData.push({
          time: currentTime,
          value: bal
        });
        drawdownData.push({
          time: currentTime,
          value: dd
        });

        lastTime = currentTime;
      });

      if (equityData.length === 0) {
        equityData.push({ time: Math.floor(Date.now() / 1000) - 120, value: initialBalance });
        equityData.push({ time: Math.floor(Date.now() / 1000), value: initialBalance });
        drawdownData.push({ time: Math.floor(Date.now() / 1000) - 120, value: 0 });
        drawdownData.push({ time: Math.floor(Date.now() / 1000), value: 0 });
      }

      // Create Equity Chart
      try {
        equityChart = createChart(equityChartRef.current, {
          width: equityChartRef.current.clientWidth || 300,
          height: 180,
          layout: {
            background: { color: 'transparent' },
            textColor: themeColors.text,
            fontSize: 9,
            fontFamily: 'Outfit, sans-serif',
          },
          grid: {
            vertLines: { color: themeColors.grid },
            horzLines: { color: themeColors.grid },
          },
          rightPriceScale: { borderColor: themeColors.border },
          timeScale: { borderColor: themeColors.border, timeVisible: true },
        });
        const areaSeries = equityChart.addSeries(AreaSeries, {
          lineColor: '#f59e0b',
          topColor: 'rgba(245, 158, 11, 0.2)',
          bottomColor: 'rgba(245, 158, 11, 0.0)',
          lineWidth: 2,
        });
        areaSeries.setData(equityData);
        equityChart.timeScale().fitContent();
        equityChartInstance.current = equityChart;
      } catch (err) {
        console.error("Failed to render equity chart:", err);
      }

      // Create Drawdown Chart
      try {
        drawdownChart = createChart(drawdownChartRef.current, {
          width: drawdownChartRef.current.clientWidth || 300,
          height: 180,
          layout: {
            background: { color: 'transparent' },
            textColor: themeColors.text,
            fontSize: 9,
            fontFamily: 'Outfit, sans-serif',
          },
          grid: {
            vertLines: { color: themeColors.grid },
            horzLines: { color: themeColors.grid },
          },
          rightPriceScale: { borderColor: themeColors.border },
          timeScale: { borderColor: themeColors.border, timeVisible: true },
        });
        const areaSeries = drawdownChart.addSeries(AreaSeries, {
          lineColor: '#ef4444',
          topColor: 'rgba(239, 68, 68, 0.2)',
          bottomColor: 'rgba(239, 68, 68, 0.0)',
          lineWidth: 2,
        });
        areaSeries.setData(drawdownData);
        drawdownChart.timeScale().fitContent();
        drawdownChartInstance.current = drawdownChart;
      } catch (err) {
        console.error("Failed to render drawdown chart:", err);
      }

      // ResizeObserver to track container width updates dynamically
      resizeObserver = new ResizeObserver(() => {
        if (equityChart && equityChartRef.current) {
          equityChart.resize(equityChartRef.current.clientWidth, 180);
        }
        if (drawdownChart && drawdownChartRef.current) {
          drawdownChart.resize(drawdownChartRef.current.clientWidth, 180);
        }
      });

      if (equityChartRef.current) resizeObserver.observe(equityChartRef.current);
      if (drawdownChartRef.current) resizeObserver.observe(drawdownChartRef.current);

    }, 100);

    return () => {
      clearTimeout(timer);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (equityChart) {
        equityChart.remove();
      }
      if (drawdownChart) {
        drawdownChart.remove();
      }
    };
  }, [backtestResults]);

  // Fetch Dhan historical data
  const handleDhanFetch = async (e) => {
    e.preventDefault();
    setFetchLoading(true);
    setFetchMessage({ type: '', text: '' });

    if (!dhanCreds.clientId || !dhanCreds.accessToken || !dhanCreds.fromDate || !dhanCreds.toDate) {
      setFetchMessage({ type: 'error', text: 'All credentials and date fields are required.' });
      setFetchLoading(false);
      return;
    }

    try {
      const res = await fetch(`${baseUrl}/api/dhan/fetch_data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: dhanCreds.clientId,
          access_token: dhanCreds.accessToken,
          from_date: dhanCreds.fromDate,
          to_date: dhanCreds.toDate,
          security_id: dhanCreds.securityId,
          segment: dhanCreds.segment,
          instrument: dhanCreds.instrument,
          output_name: dhanCreds.outputName
        })
      });
      
      const data = await res.json();
      if (res.ok) {
        setFetchMessage({ type: 'success', text: `✓ Saved successfully as: ${dhanCreds.outputName}` });
        // Refresh csv dropdown list
        fetchCsvFiles();
      } else {
        setFetchMessage({ type: 'error', text: data.detail || 'Failed to download data from Dhan.' });
      }
    } catch (err) {
      console.error('Dhan fetch error:', err);
      setFetchMessage({ type: 'error', text: 'Network connection error.' });
    } finally {
      setFetchLoading(false);
    }
  };

  // Apply date preset relative to the last active date
  const applyDatePreset = (preset) => {
    let days = 7;
    if (preset === '3W') days = 21;
    else if (preset === '1M') days = 30;
    else if (preset === '3M (Max)') days = 90;

    const parseLocalDate = (dateStr) => {
      const parts = dateStr.split('-');
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    };

    const formatDate = (date) => {
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    if (lastActiveDate === 'from') {
      const targetFromDateStr = dhanCreds.fromDate || formatDate(new Date());
      const fromDateObj = parseLocalDate(targetFromDateStr);
      const toDateObj = new Date(fromDateObj.getTime() + days * 24 * 60 * 60 * 1000);
      const formattedTo = formatDate(toDateObj);

      setDhanCreds(prev => ({
        ...prev,
        fromDate: targetFromDateStr,
        toDate: formattedTo
      }));
    } else {
      const targetToDateStr = dhanCreds.toDate || formatDate(new Date());
      const toDateObj = parseLocalDate(targetToDateStr);
      const fromDateObj = new Date(toDateObj.getTime() - days * 24 * 60 * 60 * 1000);
      const formattedFrom = formatDate(fromDateObj);

      setDhanCreds(prev => ({
        ...prev,
        fromDate: formattedFrom,
        toDate: targetToDateStr
      }));
    }
  };

  // Run backtest
  const handleRunBacktest = async (e) => {
    e.preventDefault();
    if (!backtestConfig.csvFile) {
      setBacktestError('Please select or download a CSV file first.');
      return;
    }

    setBacktestLoading(true);
    setBacktestError('');
    setBacktestResults(null);

    try {
      const res = await fetch(`${baseUrl}/api/backtest/run_offline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv_path: backtestConfig.csvFile,
          scrip: backtestConfig.scrip,
          vix: backtestConfig.vix,
          qty: backtestConfig.qty,
          std: backtestConfig.std,
          interval: backtestConfig.interval,
          min_checklist_score: backtestConfig.min_checklist_score
        })
      });

      const data = await res.json();
      if (res.ok && data.data) {
        setBacktestResults(data.data);
      } else {
        setBacktestError(data.detail || 'Backtest execution failed.');
      }
    } catch (err) {
      console.error('Run backtest error:', err);
      setBacktestError('Network error executing backtest.');
    } finally {
      setBacktestLoading(false);
    }
  };



  const downloadTradeLogCSV = () => {
    if (!backtestResults || !backtestResults.orders) return;
    
    const headers = [
      'Time', 'Type', 'Side', 'Spot Price', 'Qty', 
      'Option Contract', 'Option LTP', 'Realized P&L', 'Account Bal'
    ];
    
    const rows = [...backtestResults.orders].reverse().map(o => {
      const formattedTime = new Date(o.timestamp * 1000).toLocaleString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }).replace(/,/g, '');
      
      const isExit = o.type === 'EXIT' || o.type === 'PARTIAL_EXIT' || o.type === 'REVERSAL';
      const realizedPnLStr = isExit ? o.realized_pnl.toFixed(2) : '-';
      const optionLTPStr = o.option_price ? o.option_price.toFixed(2) : 'N/A';
      
      return [
        formattedTime,
        o.type,
        o.side,
        o.price.toFixed(2),
        o.qty,
        o.contract_name || 'N/A',
        optionLTPStr,
        realizedPnLStr,
        o.cash_balance.toFixed(2)
      ];
    });
    
    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.map(val => `"${val}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const scripNameClean = backtestConfig.scrip ? backtestConfig.scrip.split('|')[1] || backtestConfig.scrip : 'report';
    link.setAttribute('download', `backtest_trade_log_${scripNameClean.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadPerformanceReport = () => {
    if (!backtestResults) return;
    const { metrics } = backtestResults;
    const s = getMetricsSummary();
    if (!s) return;
    
    const reportText = `==================================================
              BACKTEST PERFORMANCE REPORT
==================================================
Instrument:             ${backtestConfig.scrip}
CSV Dataset:            ${backtestConfig.csvFile}
Interval:               ${backtestConfig.interval} Minutes
India VIX:              ${backtestConfig.vix}
Standard Deviation:     ${backtestConfig.std}
Min Checklist Score:    ${backtestConfig.min_checklist_score || 4}/7
Lot Size / Quantity:    ${backtestConfig.qty} (${backtestConfig.lots} Lots)
--------------------------------------------------
Initial Balance:        Rs. 100,000.00
Ending Balance:         Rs. ${s.endingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
Net Realized PnL:       Rs. ${s.realizedPnL >= 0 ? '+' : ''}${s.realizedPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
Gross Profit:           Rs. ${(metrics.gross_profit || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
Gross Loss:             Rs. ${(metrics.gross_loss || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
Profit Factor:          ${s.profitFactor}
--------------------------------------------------
Total Closed Trades:    ${s.totalTrades}
Profitable Trades:      ${s.wins}
Losing Trades:          ${s.losses}
Win Rate:               ${s.winRate}%
Maximum Drawdown:       ${s.drawdown}%
==================================================`;
    
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const scripNameClean = backtestConfig.scrip ? backtestConfig.scrip.split('|')[1] || backtestConfig.scrip : 'report';
    link.setAttribute('download', `backtest_performance_report_${scripNameClean.replace(/\s+/g, '_')}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Calculations for display metrics
  const getMetricsSummary = () => {
    if (!backtestResults) return null;
    const { metrics, orders } = backtestResults;

    const realizedPnL = (metrics && metrics.realized_pnl) || 0.0;
    const isPnlPositive = realizedPnL >= 0;

    // Win/Loss trade counts
    const totalTrades = (metrics && metrics.total_trades) || 0;
    const wins = (metrics && typeof metrics.winning_trades === 'number')
      ? metrics.winning_trades
      : (orders || []).filter(o => 
          (o.type === 'EXIT' || o.type === 'PARTIAL_EXIT' || o.type === 'REVERSAL') && o.realized_pnl > 0
        ).length;
    const losses = Math.max(0, totalTrades - wins);

    // Profit Factor
    const grossProfit = (metrics && metrics.gross_profit) || 0.0;
    const grossLoss = Math.abs((metrics && metrics.gross_loss) || 0.0);
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? '∞' : '1.00';

    return {
      realizedPnL,
      isPnlPositive,
      totalTrades,
      wins,
      losses,
      profitFactor,
      winRate: (metrics && metrics.win_rate) || 0.0,
      drawdown: (metrics && metrics.max_drawdown) || 0.0,
      endingBalance: (metrics && metrics.balance) || 100000.0
    };
  };

  const summary = getMetricsSummary();

  // Setup performance and daily P&L calculation
  const setupStats = {
    "Setup A - VWAP Bounce": { trades: 0, wins: 0, pnl: 0.0, grossProfit: 0.0, grossLoss: 0.0 },
    "Setup B - VWAP Breakout": { trades: 0, wins: 0, pnl: 0.0, grossProfit: 0.0, grossLoss: 0.0 },
    "Setup C - Trend Pullback": { trades: 0, wins: 0, pnl: 0.0, grossProfit: 0.0, grossLoss: 0.0 },
    "N/A": { trades: 0, wins: 0, pnl: 0.0, grossProfit: 0.0, grossLoss: 0.0 }
  };

  const weekdayPnL = {
    "Monday": 0.0,
    "Tuesday": 0.0,
    "Wednesday": 0.0,
    "Thursday": 0.0,
    "Friday": 0.0
  };

  if (backtestResults && backtestResults.orders) {
    backtestResults.orders.forEach(o => {
      const isExit = o.type === 'EXIT' || o.type === 'PARTIAL_EXIT' || o.type === 'REVERSAL';
      if (isExit) {
        const setup = o.setup_type || "N/A";
        const pnl = o.realized_pnl || 0.0;
        
        if (setupStats[setup]) {
          setupStats[setup].trades += 1;
          setupStats[setup].pnl += pnl;
          if (pnl > 0) {
            setupStats[setup].wins += 1;
            setupStats[setup].grossProfit += pnl;
          } else {
            setupStats[setup].grossLoss += Math.abs(pnl);
          }
        }
        
        const day = new Date(o.timestamp * 1000).toLocaleDateString('en-US', { weekday: 'long' });
        if (weekdayPnL[day] !== undefined) {
          weekdayPnL[day] += pnl;
        }
      }
    });
  }

  return (
    <div className="backtest-layout" style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '20px', padding: '20px', height: 'calc(100vh - 85px)', overflowY: 'auto', boxSizing: 'border-box' }}>
      <style>{`
        .backtest-table-container {
          overflow-x: auto;
          overflow-y: auto;
          max-height: 400px;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.15);
        }
        .backtest-table {
          width: 100%;
          min-width: 1050px;
          border-collapse: collapse;
          font-size: 0.76rem;
          text-align: left;
        }
        .backtest-table th {
          position: sticky;
          top: 0;
          background: var(--bg-tertiary, #162839);
          padding: 10px 12px;
          font-weight: 800;
          color: var(--text-muted);
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 1px solid var(--border-color);
          z-index: 10;
          white-space: nowrap;
        }
        .backtest-table tr {
          border-bottom: 1px solid rgba(255, 255, 255, 0.02);
          transition: background 0.15s ease;
        }
        .backtest-table tr:hover {
          background: rgba(255, 255, 255, 0.04);
        }
        .backtest-table td {
          padding: 8px 12px;
          color: var(--text-main);
          vertical-align: middle;
          white-space: nowrap;
        }
        .backtest-table .num-col {
          text-align: right;
          font-family: 'Consolas', 'Fira Code', monospace;
        }
        th.num-col {
          font-family: var(--font-family) !important;
        }
      `}</style>
      {/* Left panel: Control Forms */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
        
        {/* Dhan Data Downloader */}
        <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div className="widget-header" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            <Database size={18} style={{ color: 'var(--accent-gold)' }} />
            <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-main)' }}>Dhan HQ Data Downloader</h3>
          </div>
          
          <form onSubmit={handleDhanFetch} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Client ID</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <Key size={12} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    value={dhanCreds.clientId}
                    onChange={(e) => setDhanCreds({ ...dhanCreds, clientId: e.target.value })}
                    placeholder="Dhan Client ID"
                    style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px 10px 8px 30px', color: '#fff', fontSize: '0.75rem', outline: 'none' }}
                  />
                </div>
              </div>
            </div>
            
            <div>
              <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>API Access Token</label>
              <input
                type="password"
                value={dhanCreds.accessToken}
                onChange={(e) => setDhanCreds({ ...dhanCreds, accessToken: e.target.value })}
                placeholder="Access Token"
                style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '2px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                Quick Presets (relative to {lastActiveDate === 'from' ? 'From Date' : 'To Date'}):
              </span>
              {['1W', '3W', '1M', '3M (Max)'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyDatePreset(preset)}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    color: 'var(--text-main)',
                    fontSize: '0.62rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    outline: 'none'
                  }}
                  onMouseOver={(e) => e.target.style.background = 'rgba(255,255,255,0.1)'}
                  onMouseOut={(e) => e.target.style.background = 'rgba(255,255,255,0.05)'}
                >
                  {preset}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Index Presets:</span>
              {[
                { name: 'Nifty 50', id: '13', file: 'historical_nifty.csv' },
                { name: 'BSE Sensex', id: '1', file: 'historical_sensex.csv' },
                { name: 'Bank Nifty', id: '25', file: 'historical_banknifty.csv' },
                { name: 'FINNIFTY', id: '27', file: 'historical_finnifty.csv' }
              ].map((ind) => (
                <button
                  key={ind.name}
                  type="button"
                  onClick={() => setDhanCreds(prev => ({
                    ...prev,
                    securityId: ind.id,
                    outputName: ind.file
                  }))}
                  style={{
                    background: dhanCreds.securityId === ind.id ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${dhanCreds.securityId === ind.id ? 'var(--accent-gold)' : 'var(--border-color)'}`,
                    borderRadius: '4px',
                    padding: '2px 8px',
                    color: dhanCreds.securityId === ind.id ? 'var(--accent-gold)' : 'var(--text-main)',
                    fontSize: '0.62rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    outline: 'none'
                  }}
                >
                  {ind.name}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.68rem', color: lastActiveDate === 'from' ? 'var(--accent-gold)' : 'var(--text-muted)', display: 'block', marginBottom: '4px', fontWeight: lastActiveDate === 'from' ? 'bold' : 'normal' }}>From Date</label>
                <input
                  type="date"
                  value={dhanCreds.fromDate}
                  onChange={(e) => {
                    setDhanCreds(prev => ({ ...prev, fromDate: e.target.value }));
                    setLastActiveDate('from');
                  }}
                  onFocus={() => setLastActiveDate('from')}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.2)',
                    border: lastActiveDate === 'from' ? '1px solid var(--accent-gold)' : '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    color: '#fff',
                    fontSize: '0.75rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                    boxShadow: lastActiveDate === 'from' ? '0 0 4px rgba(245, 158, 11, 0.2)' : 'none'
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.68rem', color: lastActiveDate === 'to' ? 'var(--accent-gold)' : 'var(--text-muted)', display: 'block', marginBottom: '4px', fontWeight: lastActiveDate === 'to' ? 'bold' : 'normal' }}>To Date</label>
                <input
                  type="date"
                  value={dhanCreds.toDate}
                  onChange={(e) => {
                    setDhanCreds(prev => ({ ...prev, toDate: e.target.value }));
                    setLastActiveDate('to');
                  }}
                  onFocus={() => setLastActiveDate('to')}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.2)',
                    border: lastActiveDate === 'to' ? '1px solid var(--accent-gold)' : '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    color: '#fff',
                    fontSize: '0.75rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                    boxShadow: lastActiveDate === 'to' ? '0 0 4px rgba(245, 158, 11, 0.2)' : 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1.5 }}>
                <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Output Filename</label>
                <input
                  type="text"
                  value={dhanCreds.outputName}
                  onChange={(e) => setDhanCreds({ ...dhanCreds, outputName: e.target.value })}
                  placeholder="e.g. nifty_data.csv"
                  style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Security ID</label>
                <input
                  type="text"
                  value={dhanCreds.securityId}
                  onChange={(e) => setDhanCreds({ ...dhanCreds, securityId: e.target.value })}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={fetchLoading}
              className="btn-primary"
              style={{
                marginTop: '5px',
                padding: '9px',
                borderRadius: '6px',
                border: 'none',
                background: 'linear-gradient(135deg, var(--accent-gold), #b45309)',
                color: '#000',
                fontWeight: 'bold',
                fontSize: '0.78rem',
                cursor: fetchLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                opacity: fetchLoading ? 0.7 : 1,
              }}
            >
              <Calendar size={14} />
              {fetchLoading ? 'Fetching Data...' : 'Download Intraday Data'}
            </button>
          </form>

          {fetchMessage.text && (
            <div style={{
              fontSize: '0.7rem',
              padding: '8px 10px',
              borderRadius: '6px',
              background: fetchMessage.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: fetchMessage.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
              border: `1px solid ${fetchMessage.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`
            }}>
              {fetchMessage.text}
            </div>
          )}
        </div>

        {/* Backtest Config Form */}
        <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div className="widget-header" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            <Play size={18} style={{ color: 'var(--accent-green)' }} />
            <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-main)' }}>Run Backtest</h3>
          </div>

          <form onSubmit={handleRunBacktest} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Select Historical Dataset</label>
              <select
                value={backtestConfig.csvFile}
                onChange={(e) => {
                  const file = e.target.value;
                  let guessedScrip = backtestConfig.scrip;
                  
                  // Guess scrip from filename
                  const lowerFile = file.toLowerCase();
                  if (lowerFile.includes('sensex')) {
                    guessedScrip = 'BSE|SENSEX';
                  } else if (lowerFile.includes('banknifty') || lowerFile.includes('bank_nifty')) {
                    guessedScrip = 'NSE|NIFTY BANK';
                  } else if (lowerFile.includes('finnifty') || lowerFile.includes('fin_service') || lowerFile.includes('fin_nifty')) {
                    guessedScrip = 'NSE|NIFTY FIN SERVICE';
                  } else if (lowerFile.includes('nifty')) {
                    guessedScrip = 'NSE|NIFTY 50';
                  }
                  
                  const lotSize = LOT_SIZES[guessedScrip] || 65;
                  setBacktestConfig(prev => ({
                    ...prev,
                    csvFile: file,
                    scrip: guessedScrip,
                    qty: (prev.lots || 1) * lotSize
                  }));
                }}
                style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: '#fff', fontSize: '0.75rem', outline: 'none' }}
              >
                {csvFiles.length === 0 ? (
                  <option value="">No CSV files found. Please download one.</option>
                ) : (
                  csvFiles.map(file => (
                    <option key={file} value={file}>{file}</option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Underlying Index / Scrip</label>
              <select
                value={backtestConfig.scrip}
                onChange={(e) => {
                  const selectedScrip = e.target.value;
                  const lotSize = LOT_SIZES[selectedScrip] || 65;
                  setBacktestConfig(prev => ({
                    ...prev,
                    scrip: selectedScrip,
                    qty: (prev.lots || 1) * lotSize
                  }));
                }}
                style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: '#fff', fontSize: '0.75rem', outline: 'none' }}
              >
                {Object.entries(SCRIP_DISPLAY_NAMES).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Candle Time Interval</label>
              <select
                value={backtestConfig.interval}
                onChange={(e) => setBacktestConfig({ ...backtestConfig, interval: parseInt(e.target.value) })}
                style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', color: '#fff', fontSize: '0.75rem', outline: 'none' }}
              >
                <option value={1}>1 Minute</option>
                <option value={3}>3 Minutes</option>
                <option value={5}>5 Minutes</option>
                <option value={10}>10 Minutes</option>
                <option value={15}>15 Minutes</option>
                <option value={30}>30 Minutes</option>
                <option value={60}>60 Minutes (1 Hour)</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>VIX Index Value</label>
                <input
                  type="number"
                  step="0.1"
                  value={backtestConfig.vix}
                  onChange={(e) => setBacktestConfig({ ...backtestConfig, vix: parseFloat(e.target.value) })}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Trade Lots ({LOT_SIZES[backtestConfig.scrip] || 65} Qty/Lot)
                </label>
                <input
                  type="number"
                  min="1"
                  value={backtestConfig.lots || 1}
                  onChange={(e) => {
                    const lotsVal = parseInt(e.target.value) || 1;
                    const lotSize = LOT_SIZES[backtestConfig.scrip] || 65;
                    setBacktestConfig({
                      ...backtestConfig,
                      lots: lotsVal,
                      qty: lotsVal * lotSize
                    });
                  }}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>VWAP Standard Deviation multiplier ({backtestConfig.std})</label>
              <input
                type="range"
                min="1.0"
                max="3.5"
                step="0.1"
                value={backtestConfig.std}
                onChange={(e) => setBacktestConfig({ ...backtestConfig, std: parseFloat(e.target.value) })}
                style={{ width: '100%', outline: 'none', accentColor: 'var(--accent-green)' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Min Checklist Score ({backtestConfig.min_checklist_score || 4}/7)</label>
              <select
                value={backtestConfig.min_checklist_score || 4}
                onChange={(e) => setBacktestConfig({ ...backtestConfig, min_checklist_score: parseInt(e.target.value) })}
                style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box' }}
              >
                <option value={4}>4 (Default - Normal)</option>
                <option value={5}>5 (High Probability)</option>
                <option value={6}>6 (Very High Probability)</option>
                <option value={7}>7 (Strict Crossover)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={backtestLoading || csvFiles.length === 0}
              className="btn-primary"
              style={{
                marginTop: '5px',
                padding: '10px',
                borderRadius: '6px',
                border: 'none',
                background: 'linear-gradient(135deg, var(--accent-green), #047857)',
                color: '#fff',
                fontWeight: 'extrabold',
                fontSize: '0.78rem',
                cursor: (backtestLoading || csvFiles.length === 0) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                opacity: backtestLoading ? 0.7 : 1,
              }}
            >
              <BarChart2 size={16} />
              {backtestLoading ? 'Calculating Trades...' : 'Run Backtest Replay'}
            </button>
          </form>

          {backtestError && (
            <div style={{
              fontSize: '0.7rem',
              padding: '8px 10px',
              borderRadius: '6px',
              background: 'rgba(239, 68, 68, 0.1)',
              color: 'var(--accent-red)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <AlertTriangle size={14} />
              <span>{backtestError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Right panel: Metrics, Chart, trade ledger */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
        {summary ? (
          <>
            {/* Top Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px' }}>
              
              {/* Card 1: PnL */}
              <div className="glass-card" style={{ padding: '15px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: '800', textTransform: 'uppercase' }}>Net Realized P&L</div>
                <div style={{ fontSize: '1.4rem', fontWeight: '900', margin: '5px 0', color: summary.isPnlPositive ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  {summary.isPnlPositive ? '+' : ''}₹{summary.realizedPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '4px', background: summary.isPnlPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: summary.isPnlPositive ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 'bold' }}>
                  {summary.isPnlPositive ? 'PROFITABLE' : 'NET LOSS'}
                </span>
                <TrendingUp size={45} style={{ position: 'absolute', right: '-10px', bottom: '-10px', opacity: 0.03, color: summary.isPnlPositive ? 'var(--accent-green)' : 'var(--accent-red)' }} />
              </div>

              {/* Card 2: Ending Balance */}
              <div className="glass-card" style={{ padding: '15px' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: '800', textTransform: 'uppercase' }}>Ending Balance</div>
                <div style={{ fontSize: '1.4rem', fontWeight: '900', margin: '5px 0', color: '#fff' }}>
                  ₹{summary.endingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Initial: ₹100,000.00</span>
              </div>

              {/* Card 3: Win Rate */}
              <div className="glass-card" style={{ padding: '15px' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: '800', textTransform: 'uppercase' }}>Win Rate</div>
                <div style={{ fontSize: '1.4rem', fontWeight: '900', margin: '5px 0', color: 'var(--accent-gold)' }}>
                  {summary.winRate}%
                </div>
                <div style={{ display: 'flex', gap: '10px', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  <span>Wins: <strong style={{ color: 'var(--accent-green)' }}>{summary.wins}</strong></span>
                  <span>Losses: <strong style={{ color: 'var(--accent-red)' }}>{summary.losses}</strong></span>
                </div>
              </div>

              {/* Card 4: Drawdown & Profit Factor */}
              <div className="glass-card" style={{ padding: '15px' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: '800', textTransform: 'uppercase' }}>Drawdown / Profit Factor</div>
                <div style={{ fontSize: '1.4rem', fontWeight: '900', margin: '5px 0', color: '#fff', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--accent-red)' }}>{summary.drawdown}%</span>
                  <span style={{ color: '#818cf8', fontSize: '1.1rem', alignSelf: 'center' }}>PF: {summary.profitFactor}</span>
                </div>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Closed Trades: {summary.totalTrades}</span>
              </div>

            </div>

            {/* Detailed Performance Metrics Report */}
            <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="widget-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Award size={16} style={{ color: 'var(--accent-gold)' }} />
                  <h4 style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-main)', textTransform: 'uppercase' }}>Performance Metrics Report</h4>
                </div>
                <button
                  onClick={downloadPerformanceReport}
                  className="btn-primary"
                  style={{
                    width: 'auto',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '0.68rem',
                    background: 'linear-gradient(135deg, var(--accent-gold), #b45309)',
                    border: 'none',
                    color: '#000',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  Download Report (.txt)
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '15px', fontSize: '0.75rem' }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontSize: '0.62rem', fontWeight: '800' }}>Gross Profit</div>
                  <div style={{ color: 'var(--accent-green)', fontWeight: '900', fontSize: '1.1rem' }}>
                    ₹{((backtestResults.metrics && backtestResults.metrics.gross_profit) || 0.0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontSize: '0.62rem', fontWeight: '800' }}>Gross Loss</div>
                  <div style={{ color: 'var(--accent-red)', fontWeight: '900', fontSize: '1.1rem' }}>
                    -₹{Math.abs((backtestResults.metrics && backtestResults.metrics.gross_loss) || 0.0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontSize: '0.62rem', fontWeight: '800' }}>Profitable Trades</div>
                  <div style={{ color: 'var(--accent-green)', fontWeight: '900', fontSize: '1.1rem' }}>{summary.wins}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontSize: '0.62rem', fontWeight: '800' }}>Losing Trades</div>
                  <div style={{ color: 'var(--accent-red)', fontWeight: '900', fontSize: '1.1rem' }}>{summary.losses}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontSize: '0.62rem', fontWeight: '800' }}>Profit Factor</div>
                  <div style={{ color: '#818cf8', fontWeight: '900', fontSize: '1.1rem' }}>{summary.profitFactor}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', fontSize: '0.62rem', fontWeight: '800' }}>Max Drawdown</div>
                  <div style={{ color: 'var(--accent-red)', fontWeight: '900', fontSize: '1.1rem' }}>{summary.drawdown}%</div>
                </div>
              </div>
            </div>

            {/* Performance Analytics Charts: Equity & Drawdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
              <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="widget-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <TrendingUp size={16} style={{ color: 'var(--accent-gold)' }} />
                  <h4 style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-main)', textTransform: 'uppercase' }}>Equity Curve</h4>
                </div>
                <div ref={equityChartRef} style={{ width: '100%', position: 'relative', height: '180px' }} />
              </div>

              <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="widget-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertTriangle size={16} style={{ color: 'var(--accent-red)' }} />
                  <h4 style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-main)', textTransform: 'uppercase' }}>Drawdown Chart (%)</h4>
                </div>
                <div ref={drawdownChartRef} style={{ width: '100%', position: 'relative', height: '180px' }} />
              </div>
            </div>

            {/* Regime-based Setup Performance Stats & Day of Week Heatmap */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
              {/* Setup Stats Table */}
              <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="widget-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BarChart2 size={16} style={{ color: 'var(--accent-blue)' }} />
                  <h4 style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-main)', textTransform: 'uppercase' }}>Setup Performance Statistics</h4>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '6px 4px' }}>Setup</th>
                        <th style={{ padding: '6px 4px', textAlign: 'right' }}>Trades</th>
                        <th style={{ padding: '6px 4px', textAlign: 'right' }}>Win Rate</th>
                        <th style={{ padding: '6px 4px', textAlign: 'right' }}>PF</th>
                        <th style={{ padding: '6px 4px', textAlign: 'right' }}>Net P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(setupStats).map(([setup, stat]) => {
                        if (stat.trades === 0) return null;
                        const wr = ((stat.wins / stat.trades) * 100).toFixed(0);
                        const pf = stat.grossLoss > 0 ? (stat.grossProfit / stat.grossLoss).toFixed(2) : stat.grossProfit > 0 ? '∞' : '1.00';
                        return (
                          <tr key={setup} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                            <td style={{ padding: '8px 4px', color: 'var(--text-main)', fontWeight: 'bold' }}>{setup.replace('Setup ', '')}</td>
                            <td style={{ padding: '8px 4px', textAlign: 'right', color: '#fff' }}>{stat.trades}</td>
                            <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--accent-gold)' }}>{wr}%</td>
                            <td style={{ padding: '8px 4px', textAlign: 'right', color: '#818cf8' }}>{pf}</td>
                            <td style={{ padding: '8px 4px', textAlign: 'right', color: stat.pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 'bold' }}>
                              ₹{stat.pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Setup Distribution & Day of Week Heatmap */}
              <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div>
                  <div className="widget-header" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Calendar size={16} style={{ color: 'var(--accent-green)' }} />
                    <h4 style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-main)', textTransform: 'uppercase' }}>Weekly P&L Heatmap</h4>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
                    {Object.entries(weekdayPnL).map(([day, val]) => (
                      <div key={day} style={{ padding: '8px 4px', borderRadius: '6px', textAlign: 'center', background: val > 0 ? 'rgba(5, 255, 176, 0.05)' : val < 0 ? 'rgba(255, 82, 82, 0.05)' : 'rgba(255,255,255,0.01)', border: `1px solid ${val > 0 ? 'rgba(5, 255, 176, 0.15)' : val < 0 ? 'rgba(255, 82, 82, 0.15)' : 'var(--border-color)'}` }}>
                        <div style={{ fontSize: '0.52rem', color: 'var(--text-muted)', fontWeight: '800', textTransform: 'uppercase' }}>{day.substring(0, 3)}</div>
                        <div style={{ fontSize: '0.74rem', fontWeight: '800', marginTop: '4px', color: val > 0 ? 'var(--accent-green)' : val < 0 ? 'var(--accent-red)' : '#fff' }}>
                          {val > 0 ? '+' : ''}{val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Setup Distribution</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {Object.entries(setupStats).map(([setup, stat]) => {
                      const totalExits = Object.values(setupStats).reduce((sum, item) => sum + item.trades, 0);
                      if (totalExits === 0 || stat.trades === 0) return null;
                      const pct = ((stat.trades / totalExits) * 100).toFixed(0);
                      
                      let color = 'var(--accent-gold)';
                      if (setup.includes('Bounce')) color = 'var(--accent-green)';
                      else if (setup.includes('Breakout')) color = 'var(--accent-blue)';
                      
                      return (
                        <div key={setup} style={{ fontSize: '0.68rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                            <span style={{ color: 'var(--text-main)' }}>{setup.replace('Setup ', '')}</span>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>{stat.trades} ({pct}%)</span>
                          </div>
                          <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Trade Ledger for Backtest */}
            <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '200px', flexGrow: 1 }}>
              <div className="widget-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Award size={16} style={{ color: 'var(--accent-blue)' }} />
                  <h4 style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-main)', textTransform: 'uppercase' }}>Backtest Trade Log</h4>
                </div>
                <button
                  onClick={downloadTradeLogCSV}
                  className="btn-primary"
                  style={{
                    width: 'auto',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '0.68rem',
                    background: 'linear-gradient(135deg, var(--accent-green), #047857)',
                    border: 'none',
                    color: '#fff',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  Download Log (.csv)
                </button>
              </div>

              <div className="backtest-table-container">
                <table className="backtest-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Type</th>
                      <th>Side</th>
                      <th className="num-col">Spot Price</th>
                      <th className="num-col">Qty</th>
                      <th>Option Contract</th>
                      <th className="num-col">Option LTP</th>
                      <th className="num-col">Realized P&L</th>
                      <th className="num-col">Account Bal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backtestResults.orders && backtestResults.orders.length > 0 ? (
                      [...backtestResults.orders].reverse().map((o, idx) => {
                        const isExit = o.type === 'EXIT' || o.type === 'PARTIAL_EXIT' || o.type === 'REVERSAL';
                        const isWin = o.realized_pnl > 0;
                        const formattedTime = new Date(o.timestamp * 1000).toLocaleString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          day: '2-digit',
                          month: 'short'
                        });

                        return (
                          <tr key={idx}>
                            <td style={{ color: 'var(--text-muted)' }}>{formattedTime}</td>
                            <td>
                              <span style={{
                                padding: '1px 5px',
                                borderRadius: '4px',
                                background: o.type === 'ENTRY' ? 'rgba(56, 189, 248, 0.1)' : 'rgba(168, 85, 247, 0.1)',
                                color: o.type === 'ENTRY' ? 'var(--accent-blue)' : '#c084fc',
                                fontSize: '0.62rem',
                                fontWeight: 'bold'
                              }}>
                                {o.type}
                              </span>
                            </td>
                            <td style={{ color: o.side === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 'bold' }}>{o.side}</td>
                            <td className="num-col" style={{ color: '#fff' }}>₹{o.price.toFixed(2)}</td>
                            <td className="num-col" style={{ color: '#fff' }}>{o.qty}</td>
                            <td style={{ color: 'var(--accent-gold)', fontWeight: 'bold' }}>{o.contract_name || 'N/A'}</td>
                            <td className="num-col" style={{ color: '#fff' }}>{o.option_price ? `₹${o.option_price.toFixed(2)}` : 'N/A'}</td>
                            <td className="num-col" style={{ color: isExit ? (isWin ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--text-muted)', fontWeight: isExit ? 'bold' : 'normal' }}>
                              {isExit ? `${isWin ? '+' : ''}₹${o.realized_pnl.toFixed(2)}` : '-'}
                            </td>
                            <td className="num-col" style={{ color: 'var(--text-muted)' }}>₹{o.cash_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan="9" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-dark)' }}>
                          No trades executed during this backtest.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGrow: 1, padding: '40px', textAlign: 'center', minHeight: '400px' }}>
            <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.15)', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', marginBottom: '15px' }}>
              <Database size={24} style={{ color: 'var(--accent-gold)' }} />
            </div>
            <h3 style={{ color: '#fff', margin: '0 0 5px 0' }}>Ready to Backtest</h3>
            <p style={{ color: 'var(--text-dark)', fontSize: '0.8rem', maxWidth: '380px', margin: 0 }}>
              Specify your historical dataset parameters or connect your paid Dhan HQ account to download and backtest historical performance on Nifty indices.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
