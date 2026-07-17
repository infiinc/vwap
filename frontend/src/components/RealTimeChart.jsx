import { useEffect, useRef } from 'react';
import { createChart, LineStyle, CandlestickSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';

const themeColors = {
  'oceanic': {
    text: '#94a3b8',
    border: 'rgba(255, 255, 255, 0.06)',
    grid: 'rgba(255, 255, 255, 0.02)',
    up: '#26a69a', // Calm TradingView Teal Green
    down: '#ef5350', // Calm TradingView Red
    gold: '#fbbf24',
    blue: '#38bdf8',
    pe: '#e0a96d', // Calm Amber for PUT candles
    upperBand: 'rgba(239, 83, 80, 0.4)',
    lowerBand: 'rgba(38, 166, 154, 0.4)'
  },
  'midnight': {
    text: '#9ca3af',
    border: 'rgba(255, 255, 255, 0.08)',
    grid: 'rgba(255, 255, 255, 0.03)',
    up: '#26a69a', // Calm Teal Green
    down: '#ef5350', // Calm Red
    gold: '#fbbf24',
    blue: '#38bdf8',
    pe: '#e0a96d',
    upperBand: 'rgba(239, 83, 80, 0.4)',
    lowerBand: 'rgba(38, 166, 154, 0.4)'
  },
  'obsidian': {
    text: '#a3a3a3',
    border: 'rgba(255, 255, 255, 0.06)',
    grid: 'rgba(255, 255, 255, 0.02)',
    up: '#00ff9f',
    down: '#ff3355',
    gold: '#ffd700',
    blue: '#00e5ff',
    pe: '#ffd700',
    upperBand: 'rgba(255, 51, 85, 0.4)',
    lowerBand: 'rgba(0, 255, 159, 0.4)'
  },
  'forest': {
    text: '#a7f3d0',
    border: 'rgba(255, 255, 255, 0.07)',
    grid: 'rgba(255, 255, 255, 0.02)',
    up: '#26a69a',
    down: '#ef5350',
    gold: '#fbbf24',
    blue: '#34d399',
    pe: '#fbbf24',
    upperBand: 'rgba(239, 83, 80, 0.4)',
    lowerBand: 'rgba(38, 166, 154, 0.4)'
  },
  'tradingview-light': {
    text: '#6a6d78',                  // TradingView secondary text
    border: '#e0e3eb',                // TradingView border
    grid: '#f0f3fa',                  // TradingView gridline
    up: '#089981',                    // TradingView green
    down: '#f23645',                  // TradingView red
    gold: '#ff9800',                  // TradingView Orange/Gold
    blue: '#2962ff',                  // TradingView Blue
    pe: '#ff9800',                    // TradingView Orange for PE option charts
    upperBand: 'rgba(242, 54, 69, 0.25)', // TradingView soft red band
    lowerBand: 'rgba(8, 153, 129, 0.25)'  // TradingView soft green band
  }
};

export default function RealTimeChart({ 
  candles, 
  scrip, 
  isOptionChart = false, 
  optionType = 'CE', 
  theme = 'oceanic'
}) {
  // eslint-disable-next-line no-unused-vars
  const _scrip = scrip;
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const vwapSeriesRef = useRef(null);
  const upperSeriesRef = useRef(null);
  const lowerSeriesRef = useRef(null);
  const prevCandlesLength = useRef(0);

  const activeColors = themeColors[theme] || themeColors['midnight'];
  const { border, grid, text, up, down, gold, pe, upperBand, lowerBand } = activeColors;

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create the lightweight chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: text,
        fontSize: 11,
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
        barSpacing: 12, // Default spacing to avoid giant stretched candles
        rightOffset: 8,  // Scroll offset from the right boundary
        tickMarkFormatter: (time) => {
          const timestamp = typeof time === 'number' ? time : (time.timestamp || time.time);
          if (!timestamp) return '';
          const date = new Date(timestamp * 1000);
          try {
            return date.toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              timeZone: 'Asia/Kolkata'
            });
          } catch (e) {
            return date.toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            });
          }
        }
      },
      localization: {
        timeFormatter: (time) => {
          const timestamp = typeof time === 'number' ? time : (time.timestamp || time.time);
          if (!timestamp) return '';
          const date = new Date(timestamp * 1000);
          try {
            return date.toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
              timeZone: 'Asia/Kolkata'
            });
          } catch (e) {
            return date.toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false
            });
          }
        }
      },
      crosshair: {
        vertLine: {
          color: border,
          width: 1,
          style: 1,
        },
        horzLine: {
          color: border,
          width: 1,
          style: 1,
        },
      },
      handleScroll: true,
      handleScale: true,
    });

    chartRef.current = chart;

    // Add Series using Unified v5 API
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: isOptionChart ? (optionType === 'CE' ? up : pe) : up,
      downColor: down,
      borderVisible: false,
      wickUpColor: isOptionChart ? (optionType === 'CE' ? up : pe) : up,
      wickDownColor: down,
    });
    candleSeriesRef.current = candleSeries;

    if (!isOptionChart) {
      const vwapSeries = chart.addSeries(LineSeries, {
        color: gold,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        title: 'VWAP',
      });
      vwapSeriesRef.current = vwapSeries;

      const upperSeries = chart.addSeries(LineSeries, {
        color: upperBand,
        lineWidth: 1.5,
        lineStyle: LineStyle.Dashed,
        crosshairMarkerVisible: false,
        title: 'Upper Band',
      });
      upperSeriesRef.current = upperSeries;

      const lowerSeries = chart.addSeries(LineSeries, {
        color: lowerBand,
        lineWidth: 1.5,
        lineStyle: LineStyle.Dashed,
        crosshairMarkerVisible: false,
        title: 'Lower Band',
      });
      lowerSeriesRef.current = lowerSeries;
    }

    // Handle auto-resize using ResizeObserver
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

    // Initial resize call
    handleResize();

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [isOptionChart, optionType, border, grid, text, up, down, gold, pe, upperBand, lowerBand]);

  // Update chart data when candles prop changes
  useEffect(() => {
    const prevLength = prevCandlesLength.current;
    prevCandlesLength.current = candles ? candles.length : 0;

    if (
      !candleSeriesRef.current ||
      (!isOptionChart && (!vwapSeriesRef.current || !upperSeriesRef.current || !lowerSeriesRef.current)) ||
      !candles ||
      candles.length === 0
    ) {
      return;
    }

    // Format data sets
    const candleData = [];
    const vwapData = [];
    const upperData = [];
    const lowerData = [];
    const markers = [];

    // Lightweight charts requires strictly increasing times.
    // Filter duplicates or time sorting errors defensively
    const timeTracker = new Set();
    const sortedCandles = [...candles].sort((a, b) => a.time - b.time);

    sortedCandles.forEach((c) => {
      if (timeTracker.has(c.time)) return; // skip duplicates
      timeTracker.add(c.time);

      candleData.push({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      });

      if (!isOptionChart) {
        vwapData.push({ time: c.time, value: c.vwap });
        upperData.push({ time: c.time, value: c.upper_band });
        lowerData.push({ time: c.time, value: c.lower_band });

        // If this candle contains a strategy signal, add a neat chart marker
        if (c.signal === 'BUY') {
          markers.push({
            time: c.time,
            position: 'belowBar',
            color: up,
            shape: 'arrowUp',
            text: 'BUY',
          });
        } else if (c.signal === 'SELL') {
          markers.push({
            time: c.time,
            position: 'aboveBar',
            color: down,
            shape: 'arrowDown',
            text: 'SELL',
          });
        }
      }
    });

    try {
      candleSeriesRef.current.setData(candleData);
      if (!isOptionChart && vwapSeriesRef.current) {
        vwapSeriesRef.current.setData(vwapData);
      }
      if (!isOptionChart && upperSeriesRef.current) {
        upperSeriesRef.current.setData(upperData);
      }
      if (!isOptionChart && lowerSeriesRef.current) {
        lowerSeriesRef.current.setData(lowerData);
      }
      if (candleSeriesRef.current) {
        createSeriesMarkers(candleSeriesRef.current, markers);
      }
      
      // Auto-fit content on first load or when chart goes from empty to populated (e.g. backtest completes)
      if (prevLength === 0 && candles.length > 0) {
        if (candles.length > 25) {
          chartRef.current.timeScale().fitContent();
        } else {
          chartRef.current.timeScale().applyOptions({ barSpacing: 12 });
        }
      }
    } catch (e) {
      console.warn("Chart data insertion error: ", e);
    }
  }, [candles, isOptionChart, up, down]);



  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Legend overlay */}
      {!isOptionChart ? (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          zIndex: 5,
          display: 'flex',
          gap: '12px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          padding: '6px 12px',
          fontSize: '0.7rem',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-gold)' }}></span>
            <span style={{ color: 'var(--text-muted)' }}>VWAP</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '2px', borderTop: '2px dashed var(--accent-red)' }}></span>
            <span style={{ color: 'var(--text-muted)' }}>Upper Band</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '2px', borderTop: '2px dashed var(--accent-green)' }}></span>
            <span style={{ color: 'var(--text-muted)' }}>Lower Band</span>
          </div>
        </div>
      ) : (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          zIndex: 5,
          display: 'flex',
          gap: '12px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          padding: '6px 12px',
          fontSize: '0.7rem',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: optionType === 'CE' ? activeColors.up : activeColors.pe }}></span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>{optionType} Option Premium</span>
          </div>
        </div>
      )}
      <div ref={chartContainerRef} className="chart-container-div" />
    </div>
  );
}
