import { useState, useEffect, useRef } from 'react';
import { Zap, TrendingUp, Activity, ShoppingBag, Sliders, Target, ShieldAlert, List, FileText, BarChart2 } from 'lucide-react';
import RealTimeChart from './components/RealTimeChart';
import ConfigPanel from './components/ConfigPanel';
import WatchList from './components/WatchList';
import OrderBook from './components/OrderBook';
import SignalsLedger from './components/SignalsLedger';
import PerformanceAnalytics from './components/PerformanceAnalytics';
import OptionChain from './components/OptionChain';
import BacktestPanel from './components/BacktestPanel';
import './App.css';

// API configuration: defaults to live Render, with fallback to local desktop if running on local network
const getBackendUrls = () => {
  if (typeof window === 'undefined') {
    return { base: 'https://leo-vwap.onrender.com', ws: 'wss://leo-vwap.onrender.com' };
  }
  const hostname = window.location.hostname;
  // Check if we are running on localhost, 127.0.0.1, or a local network IP (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  const isLocalNet = hostname === 'localhost' || 
                      hostname === '127.0.0.1' || 
                      hostname.startsWith('192.168.') || 
                      hostname.startsWith('10.') || 
                      (hostname.startsWith('172.') && parseInt(hostname.split('.')[1], 10) >= 16 && parseInt(hostname.split('.')[1], 10) <= 31);
                      
  return {
    base: isLocalNet ? `http://${hostname}:8000` : 'https://leo-vwap.onrender.com',
    ws: isLocalNet ? `ws://${hostname}:8000` : 'wss://leo-vwap.onrender.com'
  };
};

const { base: BASE_URL, ws: WS_URL } = getBackendUrls();

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
  if (src === 'BACKTEST') {
    return {
      text: '📊 BACKTEST',
      style: {
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
        color: 'var(--accent-blue)',
        border: '1px solid rgba(56, 189, 248, 0.25)',
      }
    };
  }
  return {
    text: '🧪 TEST SIGNAL',
    style: {
      backgroundColor: 'rgba(99, 102, 241, 0.12)',
      color: '#818cf8',
      border: '1px solid rgba(99, 102, 241, 0.25)',
    }
  };
};

const playNotificationSound = () => {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(293.66, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
    
    gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
    
    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.6);
    osc2.stop(ctx.currentTime + 0.6);
  } catch (e) {
    console.error("Audio Context playback error:", e);
  }
};

const triggerLocalNotification = (signal) => {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      new Notification(`🟢 LEO VWAP ${signal.signal_type}: ${signal.contract_name}`, {
        body: `Entry: ₹${signal.opt_entry.toFixed(1)} | Target: ₹${signal.opt_tp.toFixed(1)} | SL: ₹${signal.opt_sl.toFixed(1)}`,
        icon: '/favicon.svg',
        silent: true
      });
    } catch (err) {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.showNotification(`🟢 LEO VWAP ${signal.signal_type}: ${signal.contract_name}`, {
            body: `Entry: ₹${signal.opt_entry.toFixed(1)} | Target: ₹${signal.opt_tp.toFixed(1)} | SL: ₹${signal.opt_sl.toFixed(1)}`,
            icon: '/favicon.svg',
            silent: true
          });
        });
      }
    }
  }
};

export default function App() {
  const [config, setConfig] = useState({
    mode: 'FYERS',
    active_scrip: 'NSE|NIFTY 50',
    interval_minutes: 1,
    num_std: 2.0,
    qty: 100,
    auto_trade: false,
    vix_value: 15.0,
    days_to_expiry: 3.0,
    min_checklist_score: 4,
    shoonya_authenticated: false,
    fyers_authenticated: false
  });
  
  const [candles, setCandles] = useState([]);
  const [optionChain, setOptionChain] = useState([]);
  const [optionChainSpot, setOptionChainSpot] = useState(0);
  const [optionChainMode, setOptionChainMode] = useState('MOCK');
  const [optionChainLoading, setOptionChainLoading] = useState(false);
  const [optionChainError, setOptionChainError] = useState('');
  const [optionChainFetchTime, setOptionChainFetchTime] = useState(null);
  const [callCandles, setCallCandles] = useState([]);
  const [putCandles, setPutCandles] = useState([]);
  const [callGreeks, setCallGreeks] = useState({ price: 0.0, delta: 0.0, theta: 0.0, gamma: 0.0, vega: 0.0 });
  const [putGreeks, setPutGreeks] = useState({ price: 0.0, delta: 0.0, theta: 0.0, gamma: 0.0, vega: 0.0 });
  const [activeStrike, setActiveStrike] = useState(null);
  const [orders, setOrders] = useState([]);
  const [metrics, setMetrics] = useState({
    balance: 100000.0,
    nav: 100000.0,
    realized_pnl: 0.0,
    unrealized_pnl: 0.0,
    total_trades: 0,
    win_rate: 0.0,
    max_drawdown: 0.0,
    active_position_desc: 'FLAT',
    active_qty: 0,
    gross_profit: 0.0,
    gross_loss: 0.0
  });
  
  const [prices, setPrices] = useState({});
  const [lastSignals, setLastSignals] = useState({});
  // eslint-disable-next-line no-unused-vars
  const [logs, setLogs] = useState([]);
  const [activeOptionSignal, setActiveOptionSignal] = useState(null);
  const [blockedSignal, setBlockedSignal] = useState(null);
  const [signalsHistory, setSignalsHistory] = useState([]);
  const [bottomTab, setBottomTab] = useState('orders'); // 'orders' or 'signals'
  const [currentPage, setCurrentPage] = useState('desk'); // 'desk' or 'ledger'
  const [wsConnected, setWsConnected] = useState(false);
  const [unreadSignals, setUnreadSignals] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [activeMobileTab, setActiveMobileTab] = useState('desk'); // 'desk' | 'watch' | 'greeks' | 'ledger' | 'backtest'
  const [activeMobileChart, setActiveMobileChart] = useState('spot'); // 'spot' | 'ce' | 'pe'
  const [isMobileView, setIsMobileView] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileView(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleMobileTabChange = (tab) => {
    setActiveMobileTab(tab);
    if (tab === 'ledger') {
      setCurrentPage('ledger');
    } else if (tab === 'backtest') {
      setCurrentPage('backtest');
    } else {
      setCurrentPage('desk');
    }
  };
  
  const wsRef = useRef(null);

  // Theme configuration state
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('vwap-app-theme');
    if (saved === 'nordic-light') {
      return 'tradingview-light';
    }
    return saved || 'oceanic';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('vwap-app-theme', theme);
  }, [theme]);

  // Request browser notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Live ticking timer to update elapsed signal duration
  const [nowTime, setNowTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Reset unread counts when user switches to Options Signals tab or Ledger page
  useEffect(() => {
    if (bottomTab === 'signals' || currentPage === 'ledger') {
      setUnreadSignals(0);
      document.title = 'VWAP Quantum Trading Dashboard';
    }
  }, [bottomTab, currentPage]);

  // Update browser document title with count of unread signals
  useEffect(() => {
    if (unreadSignals > 0) {
      document.title = `(${unreadSignals}) New Signal! | VWAP Quantum`;
    } else {
      document.title = 'VWAP Quantum Trading Dashboard';
    }
  }, [unreadSignals]);

  const getElapsedString = () => {
    if (!activeOptionSignal) return '';
    let sigTimeMs = 0;
    if (activeOptionSignal.timestamp) {
      sigTimeMs = activeOptionSignal.timestamp * 1000;
    } else {
      const dateStr = activeOptionSignal.date || new Date().toISOString().split('T')[0];
      const timeStr = activeOptionSignal.time;
      const d = new Date(`${dateStr}T${timeStr}`);
      if (!isNaN(d.getTime())) {
        sigTimeMs = d.getTime();
      }
    }
    if (sigTimeMs === 0) return '';
    
    let currentMs = nowTime;
    const isBacktestActive = candles.length > 0 && (nowTime - (candles[candles.length - 1].time * 1000) > 10 * 60 * 1000);
    if (isBacktestActive && candles.length > 0) {
      currentMs = candles[candles.length - 1].time * 1000;
    }
    
    const diffSecs = Math.max(0, Math.floor((currentMs - sigTimeMs) / 1000));
    let timeStr;
    if (diffSecs < 60) {
      timeStr = `${diffSecs}s`;
    } else {
      const mins = Math.floor(diffSecs / 60);
      const secs = diffSecs % 60;
      if (mins < 60) {
        timeStr = `${mins}m ${secs}s`;
      } else {
        const hours = Math.floor(mins / 60);
        const remMins = mins % 60;
        timeStr = `${hours}h ${remMins}m`;
      }
    }
    
    if (diffSecs < 120) return `🟢 FRESH (${timeStr} ago)`;
    if (diffSecs < 300) return `🟡 ACTIVE (${timeStr} ago)`;
    return `⚠️ STALE (${timeStr} ago)`;
  };

  const getElapsedColor = () => {
    if (!activeOptionSignal) return 'var(--text-dark)';
    const sigTimeMs = activeOptionSignal.timestamp ? activeOptionSignal.timestamp * 1000 : 0;
    if (sigTimeMs === 0) return 'var(--text-muted)';
    
    let currentMs = nowTime;
    const isBacktestActive = candles.length > 0 && (nowTime - (candles[candles.length - 1].time * 1000) > 10 * 60 * 1000);
    if (isBacktestActive && candles.length > 0) {
      currentMs = candles[candles.length - 1].time * 1000;
    }
    
    const diffSecs = Math.max(0, Math.floor((currentMs - sigTimeMs) / 1000));
    if (diffSecs < 120) return 'var(--accent-green)';
    if (diffSecs < 300) return 'var(--accent-gold)';
    return 'var(--accent-red)';
  };

  const formatSignalDate = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const monthIdx = parseInt(parts[1], 10) - 1;
      const day = parts[2];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${day} ${months[monthIdx]}`;
    }
    return dateStr;
  };

  const exportToCSV = (data, filename, headers) => {
    if (!data || data.length === 0) {
      alert("No data available to export.");
      return;
    }
    
    const csvRows = [];
    csvRows.push(headers.join(','));
    
    for (const row of data) {
      const values = headers.map(header => {
        const val = row[header];
        if (val === null || val === undefined) {
          return '';
        } else if (typeof val === 'object') {
          return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
        } else if (typeof val === 'string' && val.includes(',')) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      });
      csvRows.push(values.join(','));
    }
    
    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Initialize WebSocket connection
  useEffect(() => {
    const connectWS = () => {
      console.log('Connecting to websocket...');
      const ws = new WebSocket(`${WS_URL}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connection established.');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        const type = payload.type;
        const data = payload.data;

        switch (type) {
          case 'INITIAL_STATE':
            setConfig(data.config);
            setCandles(data.candles);
            setCallCandles(data.call_candles || []);
            setPutCandles(data.put_candles || []);
            setCallGreeks(data.call_greeks || { price: 0.0, delta: 0.0, theta: 0.0, gamma: 0.0, vega: 0.0 });
            setPutGreeks(data.put_greeks || { price: 0.0, delta: 0.0, theta: 0.0, gamma: 0.0, vega: 0.0 });
            setActiveStrike(data.active_strike);
            setOrders(data.orders);
            const sortedSigsInit = (data.signals_history || []).slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            setSignalsHistory(sortedSigsInit);
            if (sortedSigsInit.length > 0) {
              const latestSig = sortedSigsInit[0];
              const sigTimeMs = latestSig.timestamp ? latestSig.timestamp * 1000 : 0;
              if (sigTimeMs > 0 && (Date.now() - sigTimeMs) < 14400000) {
                setActiveOptionSignal(latestSig);
              } else {
                setActiveOptionSignal(null);
              }
            }
            setMetrics(data.metrics);
            setLogs(data.logs);
            
            // Seed initial prices
            if (data.prices) {
              setPrices(data.prices);
            } else if (data.candles && data.candles.length > 0) {
              const lastCandle = data.candles[data.candles.length - 1];
              setPrices(prev => ({ ...prev, [data.scrip]: lastCandle.close }));
            }
            break;

          case 'TICK': {
            const tickCandle = data.candle;
            const newCandleStarted = data.new_candle_started;
            const tickScrip = data.scrip || config.active_scrip;

            // Only update active chart states if this tick belongs to the currently active instrument
            if (tickScrip === config.active_scrip) {
              setCandles(prev => {
                if (prev.length === 0) return [tickCandle];
                if (newCandleStarted) {
                  return [...prev, tickCandle];
                } else {
                  const copy = [...prev];
                  copy[copy.length - 1] = tickCandle;
                  return copy;
                }
              });

              if (data.call_candle) {
                setCallCandles(prev => {
                  if (prev.length === 0) return [data.call_candle];
                  if (data.call_new) {
                    return [...prev, data.call_candle];
                  } else {
                    const copy = [...prev];
                    copy[copy.length - 1] = data.call_candle;
                    return copy;
                  }
                });
              }

              if (data.put_candle) {
                setPutCandles(prev => {
                  if (prev.length === 0) return [data.put_candle];
                  if (data.put_new) {
                    return [...prev, data.put_candle];
                  } else {
                    const copy = [...prev];
                    copy[copy.length - 1] = data.put_candle;
                    return copy;
                  }
                });
              }

              if (data.call_greeks) setCallGreeks(data.call_greeks);
              if (data.put_greeks) setPutGreeks(data.put_greeks);
              if (data.active_strike) setActiveStrike(data.active_strike);

              // Update strategy signal if triggered
              if (tickCandle.signal && tickCandle.signal !== 'HOLD') {
                setLastSignals(prev => ({ ...prev, [config.active_scrip]: tickCandle.signal }));
              }
            }

            // Update live prices dict for whichever scrip ticked
            setPrices(prev => ({ ...prev, [tickScrip]: tickCandle.close }));
            break;
          }

          case 'ORDER_EXECUTED':
            setOrders(prev => [...prev, data]);
            break;

          case 'METRICS_UPDATE':
            setMetrics(data);
            break;

          case 'CONSOLE_LOG':
            setLogs(prev => {
              const copy = [...prev, data];
              if (copy.length > 100) copy.shift();
              return copy;
            });
            break;

          case 'OPTION_SIGNAL':
            setActiveOptionSignal(data);
            setBlockedSignal(null);
            setSignalsHistory(prev => {
              const exists = prev.some(s => s.time === data.time && s.contract_name === data.contract_name && s.date === data.date);
              if (exists) {
                return prev;
              }
              
              // Play chime sound and trigger toast notifications
              playNotificationSound();
              triggerLocalNotification(data);
              
              const newToast = {
                id: Date.now() + Math.random(),
                contract_name: data.contract_name,
                type: data.signal_type,
                opt_entry: data.opt_entry,
                opt_tp: data.opt_tp,
                opt_sl: data.opt_sl,
                time: data.time
              };
              setToasts(prevToasts => [newToast, ...prevToasts]);
              
              // Auto-dismiss the toast after 6 seconds
              setTimeout(() => {
                setToasts(prevToasts => prevToasts.filter(t => t.id !== newToast.id));
              }, 6000);
              
              // Increment tab unread signal badge count if not on the tab
              if (bottomTab !== 'signals') {
                setUnreadSignals(c => c + 1);
              }
              
              return [data, ...prev];
            });
            break;

          case 'BLOCKED_SIGNAL':
            setBlockedSignal(data);
            break;

          case 'PRICE_UPDATE':
            if (data.scrip && data.price) {
              setPrices(prev => ({ ...prev, [data.scrip]: data.price }));
            }
            break;

          case 'HISTORY_RESET':
            // Warmed up index/option data is received here to enable instant instrument switching
            setCandles(data.candles || []);
            setCallCandles(data.call_candles || []);
            setPutCandles(data.put_candles || []);
            setCallGreeks(data.call_greeks || { price: 0.0, delta: 0.0, theta: 0.0, gamma: 0.0, vega: 0.0 });
            setPutGreeks(data.put_greeks || { price: 0.0, delta: 0.0, theta: 0.0, gamma: 0.0, vega: 0.0 });
            setActiveStrike(data.active_strike || null);
            setActiveOptionSignal(null);
            setBlockedSignal(null);
            
            // Seed updated prices dict
            if (data.prices) {
              setPrices(data.prices);
            }
            
            // Sort signals history descending (latest signal on top)
            const sortedSigsReset = (data.signals_history || []).slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            setSignalsHistory(sortedSigsReset);
            if (sortedSigsReset.length > 0) {
              const latestSig = sortedSigsReset[0];
              const sigTimeMs = latestSig.timestamp ? latestSig.timestamp * 1000 : 0;
              if (sigTimeMs > 0 && (Date.now() - sigTimeMs) < 14400000) {
                setActiveOptionSignal(latestSig);
              } else {
                setActiveOptionSignal(null);
              }
            }
            break;

          case 'BACKTEST_COMPLETED':
            setCandles(data.candles);
            setCallCandles(data.call_candles || []);
            setPutCandles(data.put_candles || []);
            setCallGreeks(data.call_greeks || { price: 0.0, delta: 0.0, theta: 0.0, gamma: 0.0, vega: 0.0 });
            setPutGreeks(data.put_greeks || { price: 0.0, delta: 0.0, theta: 0.0, gamma: 0.0, vega: 0.0 });
            setActiveStrike(data.active_strike);
            setOrders(data.orders);
            setMetrics(data.metrics);
            const sortedSigsBacktest = (data.signals_history || []).slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            setSignalsHistory(sortedSigsBacktest);
            if (sortedSigsBacktest.length > 0) {
              setActiveOptionSignal(sortedSigsBacktest[0]);
            } else {
              setActiveOptionSignal(null);
            }
            if (data.candles && data.candles.length > 0) {
              const lastCandle = data.candles[data.candles.length - 1];
              setPrices(prev => ({ ...prev, [config.active_scrip]: lastCandle.close }));
            }
            break;

          default:
            console.warn('Unknown message type:', type);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected. Reconnecting in 3 seconds...');
        setWsConnected(false);
        setTimeout(connectWS, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws.close();
      };
    };

    connectWS();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [config.active_scrip]);

  const fetchOptionChain = async () => {
    setOptionChainLoading(true);
    setOptionChainError('');
    try {
      const res = await fetch(`${BASE_URL}/api/fyers/option_chain`);
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        const rawChain = data.data.optionsChain || [];
        setOptionChainMode(data.mode);
        if (data.spot_price) {
          setOptionChainSpot(data.spot_price);
        }
        
        // Group by strike price
        const strikesMap = {};
        rawChain.forEach(item => {
          const strike = item.strike_price;
          const optType = item.option_type; // "CE" or "PE"
          if (!strikesMap[strike]) {
            strikesMap[strike] = { strike_price: strike, CE: null, PE: null };
          }
          strikesMap[strike][optType] = item;
        });

        // Convert map to sorted list
        const sortedStrikes = Object.values(strikesMap).sort((a, b) => a.strike_price - b.strike_price);
        setOptionChain(sortedStrikes);

        setOptionChainFetchTime(new Date());
      } else {
        setOptionChainError(data.message || 'Failed to fetch option chain.');
      }
    } catch (err) {
      console.error('Error fetching option chain in App.jsx:', err);
      setOptionChainError('Could not connect to backend server.');
    } finally {
      setOptionChainLoading(false);
    }
  };

  useEffect(() => {
    fetchOptionChain();
    const interval = setInterval(fetchOptionChain, 4000);
    return () => clearInterval(interval);
  }, [config.active_scrip]);

  // REST API Actions
  const handleUpdateConfig = async (newConfig) => {
    try {
      const res = await fetch(`${BASE_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      if (res.ok) {
        setConfig(newConfig);
      } else {
        console.error('Failed to update config on server.');
      }
    } catch (err) {
      console.error('Error updating config:', err);
    }
  };

  const handleResetSimulation = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/sim/reset`, { method: 'POST' });
      if (res.ok) {
        setOrders([]);
        setActiveOptionSignal(null);
        setBlockedSignal(null);
        setSignalsHistory([]);
        setMetrics(prev => ({
          ...prev,
          balance: 100000.0,
          nav: 100000.0,
          realized_pnl: 0.0,
          unrealized_pnl: 0.0,
          total_trades: 0,
          win_rate: 0.0,
          max_drawdown: 0.0,
          active_position_desc: 'FLAT',
          active_qty: 0
        }));
      }
    } catch (err) {
      console.error('Error resetting simulation:', err);
    }
  };

  // eslint-disable-next-line no-unused-vars
  const handleManualOrder = (side) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log(`Sending manual order: ${side}`);
      wsRef.current.send(JSON.stringify({
        type: 'MANUAL_ORDER',
        side: side,
        qty: config.qty
      }));
    } else {
      alert('WebSocket not connected. Unable to execute order.');
    }
  };

  const handleQuickExit = () => {
    if (metrics.active_qty !== 0) {
      const exitSide = metrics.active_qty > 0 ? 'SELL' : 'BUY';
      const exitQty = Math.abs(metrics.active_qty);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log(`Sending quick exit order: ${exitSide} Qty: ${exitQty}`);
        wsRef.current.send(JSON.stringify({
          type: 'MANUAL_ORDER',
          side: exitSide,
          qty: exitQty
        }));
      } else {
        alert('WebSocket not connected. Unable to execute order.');
      }
    }
  };

  const handleTriggerMockSignal = async (signalType) => {
    try {
      const res = await fetch(`${BASE_URL}/api/sim/trigger_signal?signal_type=${signalType}`, {
        method: 'POST'
      });
      if (!res.ok) {
        console.error('Failed to trigger mock signal.');
      }
    } catch (err) {
      console.error('Error triggering mock signal:', err);
    }
  };

  const handleRunBacktest = async (days) => {
    try {
      setOrders([]);
      setCandles([]);
      setActiveOptionSignal(null);
      const res = await fetch(`${BASE_URL}/api/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          days: days,
          playback_speed_ms: 30,
          instantly: days >= 30
        })
      });
      if (!res.ok) {
        alert('Failed to start backtest on server.');
      }
    } catch (err) {
      console.error('Error starting backtest:', err);
    }
  };

  const activeLivePrice = prices[config.active_scrip] || 0.0;
  const spotForOI = activeLivePrice > 0 ? activeLivePrice : optionChainSpot;
  
  const formatOIValue = (val) => {
    if (!val) return '';
    if (val >= 10000000) {
      return `${(val / 10000000).toFixed(2)} Cr`;
    }
    if (val >= 100000) {
      return `${(val / 100000).toFixed(2)} L`;
    }
    return val.toLocaleString('en-IN');
  };
  
  // Mobile and Desktop reusable widget JSX
  const activeTicketJsx = (
    <div className="glass-card sidebar-widget">
      <div className="widget-header">
        <Target size={14} className="widget-icon green" style={{ color: 'var(--accent-green)' }} />
        <h4>Active Signal Ticket</h4>
      </div>

      {activeOptionSignal ? (
        <div className={`signal-ticket active ${activeOptionSignal.signal_type.toLowerCase()}`}>
          <div className="ticket-badge-row">
            <span className={`ticket-badge ${activeOptionSignal.signal_type.toLowerCase()}`}>
              {activeOptionSignal.signal_type === 'BULLISH' ? '🟢 BUY CALL (CE)' : '🔴 BUY PUT (PE)'}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span className="ticket-time" style={{ fontSize: '0.72rem', fontWeight: 600 }}>
                {activeOptionSignal.timestamp ? 
                  new Date(activeOptionSignal.timestamp * 1000).toLocaleString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                  }) : 
                  `${activeOptionSignal.date ? `${formatSignalDate(activeOptionSignal.date)} ` : ''}${activeOptionSignal.time}`
                }
              </span>
              <span className="ticket-elapsed-time" style={{ color: getElapsedColor() }}>
                {getElapsedString()}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
            <div className="ticket-contract-name" style={{ margin: 0 }}>
              {activeOptionSignal.contract_name}
            </div>
            {(() => {
              const badge = getSourceBadge(activeOptionSignal.source);
              return (
                <span style={{
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '0.6rem',
                  fontWeight: '800',
                  whiteSpace: 'nowrap',
                  ...badge.style
                }}>
                  {badge.text}
                </span>
              );
            })()}
          </div>

          <div className="ticket-expiry-row" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '8px', display: 'flex', gap: '5px' }}>
            <span>Expiry:</span>
            <strong style={{ color: 'var(--text-main)' }}>{activeOptionSignal.expiry || '—'}</strong>
          </div>

          <div className="ticket-metrics-grid">
            <div className="ticket-metric">
              <span className="m-label">EST. ENTRY</span>
              <span className="m-val">₹{activeOptionSignal.opt_entry.toFixed(1)}</span>
            </div>
            <div className="ticket-metric">
              <span className="m-label">TARGET</span>
              <span className="m-val green-val">₹{activeOptionSignal.opt_tp.toFixed(1)}</span>
            </div>
            <div className="ticket-metric">
              <span className="m-label">STOP LOSS</span>
              <span className="m-val red-val">₹{activeOptionSignal.opt_sl.toFixed(1)}</span>
            </div>
          </div>

          {/* Checklist Breakdown */}
          {activeOptionSignal.checklist_details && (
            <div className="ticket-checklist">
              <div className="checklist-title">Checklist ({activeOptionSignal.checklist_score}/7 Met):</div>
              <div className="checklist-items-grid">
                {Object.entries(activeOptionSignal.checklist_details).map(([condName, passed]) => (
                  <div key={condName} className={`checklist-item-dot ${passed ? 'passed' : 'failed'}`} title={condName}>
                    <span className="dot"></span>
                    <span className="label">{condName.split(' ')[0]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : blockedSignal ? (
        <div className="signal-ticket blocked" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="ticket-badge-row">
            <span className="ticket-badge warning">
              ⚠️ Setup Blocked
            </span>
            <button onClick={() => setBlockedSignal(null)} className="dismiss-btn">Dismiss</button>
          </div>
          <div className="ticket-contract-name font-warning" style={{ fontSize: '0.82rem', fontWeight: 'bold' }}>
            {blockedSignal.contract_name} Setup Filtered
          </div>
          <p className="blocked-reasons-text" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: 0 }}>
            Reasons: {blockedSignal.reasons.join(', ')}
          </p>
        </div>
      ) : (
        <div className="signal-ticket empty">
          <div className="radar-animation">
            <div className="radar-circle circle-1"></div>
            <div className="radar-circle circle-2"></div>
            <div className="radar-circle circle-3"></div>
            <Activity size={24} className="radar-icon" />
          </div>
          <h5>Scanning Market Data</h5>
          <p>Monitoring {config.active_scrip.split('|')[1]} spot price against VWAP bands...</p>
        </div>
      )}
    </div>
  );

  const recentSignalsJsx = (
    <div className="glass-card sidebar-widget">
      <div className="widget-header">
        <Activity size={14} className="widget-icon gold" style={{ color: 'var(--accent-gold)' }} />
        <h4>Recent Signals (Top 3)</h4>
        <button 
          onClick={() => {
            if (isMobileView) {
              handleMobileTabChange('ledger');
            } else {
              setCurrentPage('ledger');
            }
          }}
          style={{ 
            marginLeft: 'auto', 
            fontSize: '0.7rem', 
            color: 'var(--accent-gold)', 
            background: 'none', 
            border: 'none', 
            cursor: 'pointer', 
            fontWeight: 'bold',
            outline: 'none'
          }}
        >
          View Ledger ➔
        </button>
      </div>
      
      <div className="recent-signals-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
        {signalsHistory.slice(0, 3).map((sig, idx) => {
          const isBull = sig.signal_type === 'BULLISH';
          return (
            <div 
              key={idx}
              onClick={() => {
                setActiveOptionSignal(sig);
                if (isMobileView) {
                  setActiveMobileTab('desk');
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                background: isBull ? 'rgba(16, 185, 129, 0.04)' : 'rgba(255, 68, 85, 0.04)',
                border: '1px solid ' + (isBull ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 68, 85, 0.12)'),
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              className="recent-signal-row"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 'bold', color: 'var(--text-main)' }}>
                  {sig.contract_name}
                </span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  Trigger: <strong style={{ color: 'var(--text-main)' }}>₹{sig.opt_entry.toFixed(1)}</strong> | Time: {sig.timestamp ? new Date(sig.timestamp * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : sig.time}
                </span>
              </div>
              
              <span style={{
                padding: '2px 6px',
                borderRadius: '4px',
                background: isBull ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: isBull ? 'var(--accent-green)' : 'var(--accent-red)',
                fontSize: '0.65rem',
                fontWeight: '900',
              }}>
                {sig.signal_type === 'BULLISH' ? 'BUY CE' : 'BUY PE'}
              </span>
            </div>
          );
        })}
        {signalsHistory.length === 0 && (
          <div style={{ textAlign: 'center', padding: '15px', color: 'var(--text-dark)', fontSize: '0.75rem' }}>
            No signals generated today yet.
          </div>
        )}
      </div>
    </div>
  );
  
  return (
    <div className={`dashboard-container ${currentPage === 'ledger' ? 'ledger-view' : ''} ${isMobileView ? 'mobile-view' : ''}`}>
      {/* Header */}
      <header className="dashboard-header">
        <div className="brand-section">
          <div className="logo-glow" style={{ padding: '2px', background: 'transparent' }}>
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
              <path d="M50 10 L65 25 L80 15 L75 35 L90 40 L78 52 L85 70 L68 70 L70 90 L50 80 L30 90 L32 70 L15 70 L22 52 L10 40 L25 35 L20 15 L35 25 Z" fill="url(#mane-grad)" opacity="0.85" />
              <path d="M50 25 L62 42 L60 62 L50 72 L40 62 L38 42 Z" fill="#030712" stroke="url(#gold-grad)" strokeWidth="2.5" />
              <path d="M43 45 L47 47 L46 49 Z" fill="var(--accent-green)" />
              <path d="M57 45 L53 47 L54 49 Z" fill="var(--accent-green)" />
              <path d="M50 56 L47 52 L53 52 Z" fill="url(#gold-grad)" />
              <path d="M50 56 V62 M50 62 C48 62 46 61 45 60 M50 62 C52 62 54 61 55 60" stroke="url(#gold-grad)" strokeWidth="1.5" />
              <defs>
                <linearGradient id="mane-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--accent-gold)" />
                  <stop offset="50%" stopColor="#b45309" />
                  <stop offset="100%" stopColor="var(--accent-blue)" />
                </linearGradient>
                <linearGradient id="gold-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#fef08a" />
                  <stop offset="100%" stopColor="var(--accent-gold)" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="title-section">
            <h1>LEO vwap option</h1>
            <p>Algorithmic Intraday Options Strategy Dashboard</p>
          </div>
        </div>

        {/* Page Switcher Navigation */}
        {!isMobileView && (
          <div className="page-switcher-nav" style={{ display: 'flex', gap: '8px', background: 'rgba(0, 0, 0, 0.2)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-color)', height: '38px', alignItems: 'center' }}>
            <button 
              onClick={() => setCurrentPage('desk')} 
              className={`nav-btn ${currentPage === 'desk' ? 'active' : ''}`}
              style={{
                background: currentPage === 'desk' ? 'var(--bg-tertiary)' : 'none',
                border: 'none',
                color: currentPage === 'desk' ? 'var(--accent-gold)' : 'var(--text-muted)',
                padding: '4px 12px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: '800',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                outline: 'none'
              }}
            >
              📊 Trading Desk
            </button>
            <button 
              onClick={() => setCurrentPage('ledger')} 
              className={`nav-btn ${currentPage === 'ledger' ? 'active' : ''}`}
              style={{
                background: currentPage === 'ledger' ? 'var(--bg-tertiary)' : 'none',
                border: 'none',
                color: currentPage === 'ledger' ? 'var(--accent-gold)' : 'var(--text-muted)',
                padding: '4px 12px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: '800',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                outline: 'none'
              }}
            >
              📜 Signals Ledger
              {unreadSignals > 0 && (
                <span style={{
                  background: 'var(--accent-gold)',
                  color: '#000000',
                  padding: '1px 5px',
                  borderRadius: '8px',
                  fontSize: '0.62rem',
                  fontWeight: '900',
                  lineHeight: 1
                }}>
                  {unreadSignals}
                </span>
              )}
            </button>
            <button 
              onClick={() => setCurrentPage('backtest')} 
              className={`nav-btn ${currentPage === 'backtest' ? 'active' : ''}`}
              style={{
                background: currentPage === 'backtest' ? 'var(--bg-tertiary)' : 'none',
                border: 'none',
                color: currentPage === 'backtest' ? 'var(--accent-gold)' : 'var(--text-muted)',
                padding: '4px 12px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: '800',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                outline: 'none'
              }}
            >
              🧪 Backtester Panel
            </button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          {/* Compact Header Metrics */}
          <div className="header-metrics-bar" style={{ display: 'flex', gap: '15px', background: 'var(--bg-tertiary)', padding: '6px 14px', borderRadius: '10px', border: '1px solid var(--border-color)', marginRight: '10px' }}>
            <div style={{ fontSize: '0.72rem' }}>
              <span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>NAV:</span>
              <strong style={{ color: 'var(--text-main)' }}>₹{metrics.nav.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong>
            </div>
            <div style={{ fontSize: '0.72rem' }}>
              <span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>PnL:</span>
              <strong className={metrics.realized_pnl + metrics.unrealized_pnl >= 0 ? 'up-val' : 'down-val'}>
                {metrics.realized_pnl + metrics.unrealized_pnl >= 0 ? '+' : ''}₹{(metrics.realized_pnl + metrics.unrealized_pnl).toFixed(2)}
              </strong>
            </div>
            <div style={{ fontSize: '0.72rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>Pos:</span>
              <strong className={metrics.active_qty !== 0 ? (metrics.active_qty > 0 ? 'up-val' : 'down-val') : ''} style={{ fontSize: '0.7rem' }}>
                {metrics.active_qty !== 0 ? (metrics.active_qty > 0 ? `LONG ${metrics.active_qty}` : `SHORT ${Math.abs(metrics.active_qty)}`) : 'FLAT'}
              </strong>
            </div>
          </div>

          {/* WS Connection Status */}
          <div className={`status-badge ${wsConnected ? 'live' : 'mock'}`} style={{ textTransform: 'uppercase' }}>
            <span className="status-dot"></span>
            WS: {wsConnected ? 'Connected' : 'Reconnecting'}
          </div>

          {/* Connection Mode Status */}
          <div className={`status-badge ${config.mode !== 'MOCK' ? 'live' : 'mock'}`} style={{ textTransform: 'uppercase' }}>
            <span className="status-dot"></span>
            Broker: {config.mode === 'LIVE' ? 'Shoonya Live' : (config.mode === 'FYERS' ? 'Fyers Live' : 'Simulation')}
          </div>

          {/* Quick Theme Toggle Pills */}
          <div className="theme-toggle-pills" style={{ display: 'flex', gap: '8px', alignItems: 'center', background: 'var(--bg-tertiary)', padding: '4px 10px', borderRadius: '10px', border: '1px solid var(--border-color)', height: '32px' }}>
            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: '800', marginRight: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Theme:</span>
            {[
              { id: 'oceanic', name: 'Oceanic Slate', color: '#05ffb0', tooltip: 'Oceanic Slate (Soothing Deep Teal)' },
              { id: 'midnight', name: 'Quantum Midnight', color: '#3b82f6', tooltip: 'Quantum Midnight (Navy/Gold)' },
              { id: 'obsidian', name: 'Cyber Obsidian', color: '#00ff9f', tooltip: 'Cyber Obsidian (Black/Neon)' },
              { id: 'forest', name: 'Emerald Forest', color: '#10b981', tooltip: 'Emerald Forest (Green/Gold)' },
              { id: 'tradingview-light', name: 'TradingView Light', color: '#2962ff', tooltip: 'TradingView Light Theme' }
            ].map(t => {
              const isActive = theme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  title={t.tooltip}
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    backgroundColor: t.color,
                    border: isActive ? '2px solid var(--text-main)' : '1px solid var(--border-color)',
                    cursor: 'pointer',
                    boxShadow: isActive ? `0 0 10px ${t.color}` : 'none',
                    transition: 'all 0.25s',
                    padding: 0,
                    outline: 'none',
                    transform: isActive ? 'scale(1.2)' : 'scale(1)',
                  }}
                  className={`theme-toggle-dot ${isActive ? 'active' : ''}`}
                />
              );
            })}
          </div>
        </div>
      </header>

      {isMobileView ? (
        <main className="mobile-main-layout">
          {activeMobileTab === 'desk' && (
            <div className="mobile-desk-view">
              <div className="mobile-chart-tabs-bar">
                <button onClick={() => setActiveMobileChart('spot')} className={activeMobileChart === 'spot' ? 'active' : ''}>📈 SPOT</button>
                <button onClick={() => setActiveMobileChart('ce')} className={activeMobileChart === 'ce' ? 'active' : ''}>🟢 CALL (CE)</button>
                <button onClick={() => setActiveMobileChart('pe')} className={activeMobileChart === 'pe' ? 'active' : ''}>🟡 PUT (PE)</button>
              </div>
              <div className="mobile-chart-viewport glass-card">
                {activeMobileChart === 'spot' && (
                  <div className="mobile-chart-wrapper" style={{ height: '360px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', alignItems: 'center' }}>
                      <span className="scrip-badge">{config.active_scrip.split('|')[1]}</span>
                      <strong className="mobile-price">₹{activeLivePrice > 0 ? activeLivePrice.toFixed(2) : '...'}</strong>
                    </div>
                    <div style={{ flexGrow: 1, position: 'relative', minHeight: '0' }}>
                      <RealTimeChart candles={candles} scrip={config.active_scrip} theme={theme} />
                    </div>
                  </div>
                )}
                {activeMobileChart === 'ce' && (
                  <div className="mobile-chart-wrapper" style={{ height: '360px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', alignItems: 'center' }}>
                      <span className="scrip-badge CE" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--accent-green)' }}>CALL {activeStrike || ''}</span>
                      <strong className="mobile-price CE" style={{ color: 'var(--accent-green)' }}>₹{callGreeks.price.toFixed(2)}</strong>
                    </div>
                    <div style={{ flexGrow: 1, position: 'relative', minHeight: '0' }}>
                      <RealTimeChart candles={callCandles} scrip={`${config.active_scrip.split('|')[1]} CE`} isOptionChart={true} optionType="CE" theme={theme} />
                    </div>
                  </div>
                )}
                {activeMobileChart === 'pe' && (
                  <div className="mobile-chart-wrapper" style={{ height: '360px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', alignItems: 'center' }}>
                      <span className="scrip-badge PE" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--accent-gold)' }}>PUT {activeStrike || ''}</span>
                      <strong className="mobile-price PE" style={{ color: 'var(--accent-gold)' }}>₹{putGreeks.price.toFixed(2)}</strong>
                    </div>
                    <div style={{ flexGrow: 1, position: 'relative', minHeight: '0' }}>
                      <RealTimeChart candles={putCandles} scrip={`${config.active_scrip.split('|')[1]} PE`} isOptionChart={true} optionType="PE" theme={theme} />
                    </div>
                  </div>
                )}
              </div>
              <div className="mobile-ticket-section">
                {activeTicketJsx}
              </div>
            </div>
          )}

          {activeMobileTab === 'watch' && (
            <div className="mobile-watch-view" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <WatchList
                activeScrip={config.active_scrip}
                onSelectScrip={(scrip) => handleUpdateConfig({ ...config, active_scrip: scrip })}
                prices={prices}
                lastSignals={lastSignals}
              />
              <ConfigPanel
                config={config}
                onUpdateConfig={handleUpdateConfig}
                onResetSimulation={handleResetSimulation}
                onRunBacktest={handleRunBacktest}
                baseUrl={BASE_URL}
              />
            </div>
          )}

          {activeMobileTab === 'greeks' && (
            <div className="mobile-greeks-view" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {metrics.safety_alert && (
                <div className="glass-card sidebar-widget safety-shield-widget" style={{
                  border: `1px solid ${
                    metrics.safety_alert.status === 'CRITICAL' ? 'rgba(239, 68, 68, 0.4)' :
                    metrics.safety_alert.status === 'WARNING' ? 'rgba(245, 158, 11, 0.4)' :
                    'rgba(16, 185, 129, 0.3)'
                  }`,
                  background: `linear-gradient(135deg, ${
                    metrics.safety_alert.status === 'CRITICAL' ? 'rgba(239, 68, 68, 0.05)' :
                    metrics.safety_alert.status === 'WARNING' ? 'rgba(245, 158, 11, 0.04)' :
                    'rgba(16, 185, 129, 0.03)'
                  }, rgba(15, 23, 42, 0.65))`,
                  boxShadow: `0 8px 32px 0 ${
                    metrics.safety_alert.status === 'CRITICAL' ? 'rgba(239, 68, 68, 0.08)' :
                    metrics.safety_alert.status === 'WARNING' ? 'rgba(245, 158, 11, 0.06)' :
                    'rgba(16, 185, 129, 0.04)'
                  }`
                }}>
                  <div className="widget-header">
                    <ShieldAlert size={14} className="widget-icon red" />
                    <h4>Market Safety Shield ({metrics.safety_alert.status})</h4>
                  </div>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 10px 0', lineHeight: '1.4' }}>
                    {metrics.safety_alert.reason}
                  </p>
                  {metrics.safety_alert.action_plan && (
                    <div className="action-plan-box" style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '0.62rem', fontWeight: '800', color: 'var(--accent-gold)', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Action Plan:</span>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-main)', margin: 0, lineHeight: '1.3' }}>{metrics.safety_alert.action_plan}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="glass-card sidebar-widget" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="widget-header">
                  <Sliders size={14} className="widget-icon blue" />
                  <h4>ATM Option Greeks</h4>
                </div>
                <div className="strike-lock-banner" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span className="label" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Strike lock:</span>
                  <strong className="value" style={{ fontSize: '0.75rem', color: 'var(--text-main)' }}>{activeStrike ? `${config.active_scrip.split('|')[1].replace('50', '').trim()} ${activeStrike}` : 'Pending Ticks...'}</strong>
                </div>
                <div className="greeks-table-container">
                  <table className="greeks-comparison-table">
                    <thead>
                      <tr>
                        <th>Greek</th>
                        <th className="ce-col" style={{ color: 'var(--accent-green)' }}>CALL (CE)</th>
                        <th className="pe-col" style={{ color: 'var(--accent-gold)' }}>PUT (PE)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td><strong>Premium</strong></td>
                        <td className="ce-val" style={{ color: 'var(--accent-green)' }}>₹{callGreeks.price.toFixed(2)}</td>
                        <td className="pe-val" style={{ color: 'var(--accent-gold)' }}>₹{putGreeks.price.toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td><strong>Delta (Δ)</strong></td>
                        <td className="ce-val">+{callGreeks.delta.toFixed(3)}</td>
                        <td className="pe-val">{putGreeks.delta.toFixed(3)}</td>
                      </tr>
                      <tr>
                        <td><strong>Theta (Θ)</strong></td>
                        <td className="red-text" style={{ color: 'var(--accent-red)' }}>₹{callGreeks.theta.toFixed(3)}</td>
                        <td className="red-text" style={{ color: 'var(--accent-red)' }}>₹{putGreeks.theta.toFixed(3)}</td>
                      </tr>
                      <tr>
                        <td><strong>Gamma (Γ)</strong></td>
                        <td style={{ textAlign: 'right', fontWeight: '500' }}>{callGreeks.gamma.toFixed(5)}</td>
                        <td style={{ textAlign: 'right', fontWeight: '500' }}>{putGreeks.gamma.toFixed(5)}</td>
                      </tr>
                      <tr>
                        <td><strong>Vega (ν)</strong></td>
                        <td style={{ textAlign: 'right', fontWeight: '500' }}>{callGreeks.vega.toFixed(3)}</td>
                        <td style={{ textAlign: 'right', fontWeight: '500' }}>{putGreeks.vega.toFixed(3)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {recentSignalsJsx}
            </div>
          )}

          {activeMobileTab === 'ledger' && (
            <div className="mobile-ledger-view">
              <SignalsLedger signals={signalsHistory} />
            </div>
          )}

          {activeMobileTab === 'backtest' && (
            <div className="mobile-backtest-view">
              <BacktestPanel theme={theme} baseUrl={BASE_URL} />
            </div>
          )}

          {/* Bottom Space for Navigation Spacer */}
          <div className="mobile-bottom-nav-spacer" style={{ height: '75px' }} />

          {/* Mobile Bottom Navigation Menu */}
          <nav className="mobile-bottom-nav">
            <button 
              onClick={() => handleMobileTabChange('desk')} 
              className={activeMobileTab === 'desk' ? 'active' : ''}
            >
              <TrendingUp size={20} />
              <span>Desk</span>
            </button>
            <button 
              onClick={() => handleMobileTabChange('watch')} 
              className={activeMobileTab === 'watch' ? 'active' : ''}
            >
              <List size={20} />
              <span>Watch</span>
            </button>
            <button 
              onClick={() => handleMobileTabChange('greeks')} 
              className={activeMobileTab === 'greeks' ? 'active' : ''}
            >
              <Sliders size={20} />
              <span>Greeks</span>
            </button>
            <button 
              onClick={() => handleMobileTabChange('ledger')} 
              className={activeMobileTab === 'ledger' ? 'active' : ''}
            >
              <FileText size={20} />
              <span>Ledger</span>
            </button>
            <button 
              onClick={() => handleMobileTabChange('backtest')} 
              className={activeMobileTab === 'backtest' ? 'active' : ''}
            >
              <BarChart2 size={20} />
              <span>Backtest</span>
            </button>
          </nav>
        </main>
      ) : (
        currentPage === 'desk' && (
          /* Main Grid */
          <main className="main-layout">
        {/* Left Side Drawers */}
        <section className="left-panel">
          <WatchList
            activeScrip={config.active_scrip}
            onSelectScrip={(scrip) => handleUpdateConfig({ ...config, active_scrip: scrip })}
            prices={prices}
            lastSignals={lastSignals}
          />

          <ConfigPanel
            config={config}
            onUpdateConfig={handleUpdateConfig}
            onResetSimulation={handleResetSimulation}
            onRunBacktest={handleRunBacktest}
            baseUrl={BASE_URL}
          />
        </section>

        {/* Center Panel: Spot Index and Clean Option Charts */}
        <section className="glass-card chart-section">
          <div className="chart-header">
            <div className="chart-title-info">
              <span className="scrip-badge">{config.active_scrip.split('|')[1]}</span>
              <div className="chart-price-display">
                <span className="chart-live-price">
                  {activeLivePrice > 0 ? `₹${activeLivePrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'Calculating Ticks...'}
                </span>
                <span className="chart-price-change up-val">+0.42%</span>
              </div>
            </div>

            {/* Quick manual actions */}
            <div className="quick-trade-bar" style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => handleTriggerMockSignal('BULLISH')} className="btn-test-ce" style={{
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                color: '#10b981',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s',
                width: '90px'
              }}>TEST CE 🟢</button>
              <button onClick={() => handleTriggerMockSignal('BEARISH')} className="btn-test-pe" style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ef4444',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s',
                width: '90px'
              }}>TEST PE 🔴</button>
            </div>
          </div>

          {/* Split Chart Container */}
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0', gap: '10px', padding: '10px' }}>
            
            {/* Top Chart: Index Spot Chart (60% height) */}
            <div style={{ height: '58%', position: 'relative', minHeight: '0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '5px' }}>
              <RealTimeChart 
                candles={candles} 
                scrip={config.active_scrip} 
                theme={theme} 
              />
            </div>

            {/* Bottom Split: Call/Put Options Premium (42% height) */}
            <div className="options-split-grid" style={{ height: '42%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', minHeight: '0' }}>
              
              {/* Left Column: Call (CE) Option Premium Chart */}
              <div className="glass-card option-chart-wrapper" style={{ display: 'flex', flexDirection: 'column', minHeight: '0', border: '1px solid rgba(16, 185, 129, 0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(16, 185, 129, 0.03)', borderBottom: '1px solid rgba(16, 185, 129, 0.06)' }}>
                  <span style={{ fontSize: '0.95rem', fontWeight: '800', color: '#10b981' }}>
                    🟢 CALL Option (CE) — Strike: {activeStrike || 'Pending'}
                  </span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>
                    Premium: <strong style={{ fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-main)', marginLeft: '4px' }}>₹{callGreeks.price.toFixed(2)}</strong>
                  </span>
                </div>
                <div style={{ flexGrow: 1, position: 'relative', minHeight: '0' }}>
                  <RealTimeChart candles={callCandles} scrip={`${config.active_scrip.split('|')[1]} CE`} isOptionChart={true} optionType="CE" theme={theme} />
                </div>
              </div>

              {/* Right Column: Put (PE) Option Premium Chart */}
              <div className="glass-card option-chart-wrapper" style={{ display: 'flex', flexDirection: 'column', minHeight: '0', border: '1px solid rgba(224, 169, 109, 0.12)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(224, 169, 109, 0.04)', borderBottom: '1px solid rgba(224, 169, 109, 0.08)' }}>
                  <span style={{ fontSize: '0.95rem', fontWeight: '800', color: '#e0a96d' }}>
                    🟡 PUT Option (PE) — Strike: {activeStrike || 'Pending'}
                  </span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>
                    Premium: <strong style={{ fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-main)', marginLeft: '4px' }}>₹{putGreeks.price.toFixed(2)}</strong>
                  </span>
                </div>
                <div style={{ flexGrow: 1, position: 'relative', minHeight: '0' }}>
                  <RealTimeChart candles={putCandles} scrip={`${config.active_scrip.split('|')[1]} PE`} isOptionChart={true} optionType="PE" theme={theme} />
                </div>
              </div>

            </div>

          </div>
        </section>

        {/* Right Sidebar: Active Signal Ticket & Greeks Dashboard */}
        <section className="right-sidebar">
          
          {/* 🛡️ Live Trend & Position Safety Shield */}
          {metrics.safety_alert && (
            <div className="glass-card sidebar-widget safety-shield-widget" style={{
              border: `1px solid ${
                metrics.safety_alert.status === 'CRITICAL' ? 'rgba(239, 68, 68, 0.4)' :
                metrics.safety_alert.status === 'WARNING' ? 'rgba(245, 158, 11, 0.4)' :
                'rgba(16, 185, 129, 0.3)'
              }`,
              background: `linear-gradient(135deg, ${
                metrics.safety_alert.status === 'CRITICAL' ? 'rgba(239, 68, 68, 0.05)' :
                metrics.safety_alert.status === 'WARNING' ? 'rgba(245, 158, 11, 0.04)' :
                'rgba(16, 185, 129, 0.03)'
              }, rgba(15, 23, 42, 0.65))`,
              boxShadow: `0 8px 32px 0 ${
                metrics.safety_alert.status === 'CRITICAL' ? 'rgba(239, 68, 68, 0.08)' :
                metrics.safety_alert.status === 'WARNING' ? 'rgba(245, 158, 11, 0.06)' :
                'rgba(16, 185, 129, 0.04)'
              }`
            }}>
              <div className="widget-header" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px' }}>
                <ShieldAlert size={14} style={{
                  color: metrics.safety_alert.status === 'CRITICAL' ? 'var(--accent-red)' :
                         metrics.safety_alert.status === 'WARNING' ? 'var(--accent-gold)' :
                         'var(--accent-green)',
                  marginRight: '6px'
                }} />
                <h4 style={{ margin: 0, fontSize: '0.8rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {metrics.safety_alert.type === 'POSITION' ? 'Position Safety Shield' : 'Market Safety Shield'}
                </h4>
                <span style={{
                  marginLeft: 'auto',
                  fontSize: '0.65rem',
                  fontWeight: '800',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: metrics.safety_alert.status === 'CRITICAL' ? 'rgba(239, 68, 68, 0.2)' :
                                   metrics.safety_alert.status === 'WARNING' ? 'rgba(245, 158, 11, 0.2)' :
                                   'rgba(16, 185, 129, 0.2)',
                  color: metrics.safety_alert.status === 'CRITICAL' ? 'var(--accent-red)' :
                         metrics.safety_alert.status === 'WARNING' ? 'var(--accent-gold)' :
                         'var(--accent-green)'
                }}>
                  {metrics.safety_alert.status}
                </span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                {metrics.safety_alert.type === 'POSITION' ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Active Position:</span>
                      <strong style={{
                        fontSize: '0.82rem',
                        color: metrics.active_qty > 0 ? 'var(--accent-green)' : 'var(--accent-red)'
                      }}>
                        {metrics.active_position_desc.split('|')[0]}
                      </strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Unrealized P&amp;L:</span>
                      <strong style={{
                        fontSize: '1rem',
                        color: metrics.unrealized_pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'
                      }}>
                        {metrics.unrealized_pnl >= 0 ? '+' : ''}₹{metrics.unrealized_pnl.toFixed(2)}
                      </strong>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Instrument:</span>
                      <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>
                        {config.active_scrip.split('|')[1]}
                      </strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Trend Direction:</span>
                      <strong style={{
                        fontSize: '0.82rem',
                        color: metrics.safety_alert.trend === 'BULLISH' ? 'var(--accent-green)' :
                               metrics.safety_alert.trend === 'BEARISH' ? 'var(--accent-red)' :
                               'var(--text-muted)'
                      }}>
                        {metrics.safety_alert.trend}
                      </strong>
                    </div>
                  </>
                )}

                {/* Warnings List */}
                {metrics.safety_alert.warnings.length > 0 ? (
                  <div style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.25)',
                    padding: '8px',
                    borderRadius: '6px',
                    borderLeft: `3px solid ${
                      metrics.safety_alert.status === 'CRITICAL' ? 'var(--accent-red)' : 'var(--accent-gold)'
                    }`,
                    marginTop: '4px'
                  }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
                      {metrics.safety_alert.type === 'POSITION' ? 'Alert Indicators:' : 'Risk Warnings:'}
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '12px', fontSize: '0.68rem', color: 'var(--text-main)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {metrics.safety_alert.warnings.map((warn, i) => (
                        <li key={i}>{warn}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.05)',
                    padding: '8px',
                    borderRadius: '6px',
                    borderLeft: '3px solid var(--accent-green)',
                    fontSize: '0.7rem',
                    color: 'var(--accent-green)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginTop: '4px'
                  }}>
                    <span>🛡️ No safety warnings. Market trend is clear.</span>
                  </div>
                )}
                
                {/* Recommended Action */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  fontSize: '0.72rem'
                }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.62rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Action Plan:</span>
                  <strong style={{
                    color: metrics.safety_alert.status === 'CRITICAL' ? 'var(--accent-red)' :
                           metrics.safety_alert.status === 'WARNING' ? 'var(--accent-gold)' :
                           'var(--accent-green)'
                  }}>
                    {metrics.safety_alert.action}
                  </strong>
                </div>

                {/* Quick Exit Button (Only show for active positions) */}
                {metrics.safety_alert.type === 'POSITION' && (
                  <button
                    onClick={handleQuickExit}
                    style={{
                      width: '100%',
                      background: metrics.safety_alert.status === 'CRITICAL' ? 'var(--accent-red)' : 'rgba(239, 68, 68, 0.15)',
                      border: `1px solid ${metrics.safety_alert.status === 'CRITICAL' ? 'var(--accent-red)' : 'rgba(239, 68, 68, 0.4)'}`,
                      color: metrics.safety_alert.status === 'CRITICAL' ? '#ffffff' : 'var(--accent-red)',
                      padding: '8px',
                      borderRadius: '8px',
                      fontSize: '0.78rem',
                      fontWeight: '800',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      marginTop: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      boxShadow: metrics.safety_alert.status === 'CRITICAL' ? '0 0 12px rgba(239, 68, 68, 0.4)' : 'none'
                    }}
                    className="quick-exit-btn"
                  >
                    <Zap size={14} />
                    ⚡ QUICK EXIT (MARKET CLOSE)
                  </button>
                )}
              </div>
            </div>
          )}

          {activeTicketJsx}
          {recentSignalsJsx}



          {/* Option Greeks Grid Table */}
          <div className="glass-card sidebar-widget flex-grow" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="widget-header">
              <Sliders size={14} className="widget-icon blue" />
              <h4>ATM Option Greeks</h4>
            </div>

            <div className="strike-lock-banner">
              <span className="label">Strike lock:</span>
              <strong className="value">{activeStrike ? `${config.active_scrip.split('|')[1].replace('50', '').trim()} ${activeStrike}` : 'Pending Ticks...'}</strong>
            </div>

            <div className="greeks-table-container">
              <table className="greeks-comparison-table">
                <thead>
                  <tr>
                    <th>Greek</th>
                    <th className="ce-col">CALL (CE)</th>
                    <th className="pe-col">PUT (PE)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Premium</strong></td>
                    <td className="ce-val">₹{callGreeks.price.toFixed(2)}</td>
                    <td className="pe-val">₹{putGreeks.price.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td><strong>Delta (Δ)</strong></td>
                    <td className="ce-val">+{callGreeks.delta.toFixed(3)}</td>
                    <td className="pe-val">{putGreeks.delta.toFixed(3)}</td>
                  </tr>
                  <tr>
                    <td><strong>Theta (Θ)</strong></td>
                    <td className="red-text">₹{callGreeks.theta.toFixed(3)}</td>
                    <td className="red-text">₹{putGreeks.theta.toFixed(3)}</td>
                  </tr>
                  <tr>
                    <td><strong>Gamma (Γ)</strong></td>
                    <td style={{ textAlign: 'right', fontWeight: '500' }}>{callGreeks.gamma.toFixed(5)}</td>
                    <td style={{ textAlign: 'right', fontWeight: '500' }}>{putGreeks.gamma.toFixed(5)}</td>
                  </tr>
                  <tr>
                    <td><strong>Vega (ν)</strong></td>
                    <td style={{ textAlign: 'right', fontWeight: '500' }}>{callGreeks.vega.toFixed(3)}</td>
                    <td style={{ textAlign: 'right', fontWeight: '500' }}>{putGreeks.vega.toFixed(3)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

          </div>

        </section>
      </main>
      )
      )}
      {!isMobileView && currentPage === 'ledger' && (
        <SignalsLedger signals={signalsHistory} />
      )}
      {!isMobileView && currentPage === 'backtest' && (
        <BacktestPanel theme={theme} baseUrl={BASE_URL} />
      )}

      {/* Floating Glassmorphic Toasts Container */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div 
            key={toast.id} 
            className={`toast-card ${toast.type.toLowerCase() === 'bullish' ? 'bullish' : 'bearish'}`}
          >
            <div className="toast-header">
              <span className="toast-title">
                {toast.type.toLowerCase() === 'bullish' ? '🟢' : '🔴'} {toast.contract_name} Buy Triggered
              </span>
              <button 
                onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} 
                className="toast-close-btn"
                title="Dismiss Alert"
              >
                ×
              </button>
            </div>
            <div className="toast-body">
              VWAP Strategy crossover detected on index. Option recommendations generated.
            </div>
            <div className="toast-metrics">
              <div className="toast-metric-box">
                <span className="toast-metric-label">Entry</span>
                <span className="toast-metric-value" style={{ color: toast.type.toLowerCase() === 'bullish' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  ₹{toast.opt_entry.toFixed(1)}
                </span>
              </div>
              <div className="toast-metric-box">
                <span className="toast-metric-label">Target</span>
                <span className="toast-metric-value" style={{ color: 'var(--accent-green)' }}>
                  ₹{toast.opt_tp.toFixed(1)}
                </span>
              </div>
              <div className="toast-metric-box">
                <span className="toast-metric-label">Stop Loss</span>
                <span className="toast-metric-value" style={{ color: 'var(--accent-red)' }}>
                  ₹{toast.opt_sl.toFixed(1)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
