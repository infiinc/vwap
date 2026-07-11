import { useState } from 'react';
import { Settings, Sliders, Shield, Play, RefreshCw } from 'lucide-react';

export default function ConfigPanel({ config, onUpdateConfig, onResetSimulation, onRunBacktest }) {
  const [showCredsModal, setShowCredsModal] = useState(false);
  const [showFyersModal, setShowFyersModal] = useState(false);
  const [backtestDays, setBacktestDays] = useState(1);
  const [creds, setCreds] = useState({
    userid: '',
    password: '',
    totp_secret: '',
    api_key: '',
    vendor_code: ''
  });
  const [fyersCreds, setFyersCreds] = useState({
    client_id: '',
    secret_key: '',
    redirect_uri: 'http://127.0.0.1:8000/api/fyers/callback',
    auth_code: ''
  });
  
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [fyersError, setFyersError] = useState('');
  const [fyersLoading, setFyersLoading] = useState(false);

  const handleConfigChange = (key, val) => {
    // Switch to Shoonya Broker Live
    if (key === 'mode' && val === 'LIVE' && !config.shoonya_authenticated) {
      setShowCredsModal(true);
      return;
    }
    // Switch to Fyers Broker Live
    if (key === 'mode' && val === 'FYERS' && !config.fyers_authenticated) {
      setShowFyersModal(true);
      return;
    }
    onUpdateConfig({ ...config, [key]: val });
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    try {
      const res = await fetch('http://127.0.0.1:8000/api/shoonya/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
      });
      const data = await res.json();
      if (res.ok) {
        setShowCredsModal(false);
        // Refresh configuration with live mode
        onUpdateConfig({ ...config, mode: 'LIVE', shoonya_authenticated: true });
      } else {
        setLoginError(data.detail || 'Login failed.');
      }
    } catch (err) {
      console.error('Shoonya login submit error:', err);
      setLoginError('Could not connect to server.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleFyersGenerateUrl = async () => {
    if (!fyersCreds.client_id || !fyersCreds.secret_key || !fyersCreds.redirect_uri) {
      setFyersError('App ID, Secret Key, and Redirect URI are required to generate the login URL.');
      return;
    }
    setFyersError('');
    try {
      const url = `http://127.0.0.1:8000/api/fyers/authurl?client_id=${encodeURIComponent(fyersCreds.client_id)}&secret_key=${encodeURIComponent(fyersCreds.secret_key)}&redirect_uri=${encodeURIComponent(fyersCreds.redirect_uri)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok && data.url) {
        window.open(data.url, '_blank');
      } else {
        setFyersError(data.detail || 'Failed to generate Fyers URL.');
      }
    } catch (err) {
      console.error('Fyers generate URL error:', err);
      setFyersError('Could not connect to server.');
    }
  };

  const handleFyersLoginSubmit = async (e) => {
    e.preventDefault();
    setFyersError('');
    setFyersLoading(true);

    try {
      const res = await fetch('http://127.0.0.1:8000/api/fyers/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fyersCreds),
      });
      const data = await res.json();
      if (res.ok) {
        setShowFyersModal(false);
        // Refresh configuration with fyers mode
        onUpdateConfig({ ...config, mode: 'FYERS', fyers_authenticated: true });
      } else {
        setFyersError(data.detail || 'Fyers login failed.');
      }
    } catch (err) {
      console.error('Fyers login submit error:', err);
      setFyersError('Could not connect to server.');
    } finally {
      setFyersLoading(false);
    }
  };

  return (
    <div className="glass-card config-drawer">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Settings size={18} style={{ color: 'var(--accent-gold)' }} />
        <h3>Strategy Controls</h3>
      </div>

      {/* Trading Mode */}
      <div className="form-group">
        <label>Market Data Source</label>
        <select
          value={config.mode}
          onChange={(e) => handleConfigChange('mode', e.target.value)}
          className="input-glow-style select-glow-style"
        >
          <option value="MOCK">MOCK MARKET DATA</option>
          <option value="LIVE">SHOONYA BROKER LIVE</option>
          <option value="FYERS">FYERS BROKER LIVE</option>
        </select>
      </div>

      {/* Shoonya Login Status Indicator */}
      {config.mode === 'LIVE' && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.02)',
          padding: '8px 12px',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          fontSize: '0.75rem'
        }}>
          <span style={{ color: 'var(--text-muted)' }}>Broker Conn:</span>
          {config.shoonya_authenticated ? (
            <span style={{ color: 'var(--accent-green)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Shield size={12} /> AUTHENTICATED
            </span>
          ) : (
            <button
              onClick={() => setShowCredsModal(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-gold)',
                fontWeight: 700,
                cursor: 'pointer',
                textDecoration: 'underline'
              }}
            >
              LOGIN NOW
            </button>
          )}
        </div>
      )}

      {/* Fyers Login Status Indicator */}
      {config.mode === 'FYERS' && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.02)',
          padding: '8px 12px',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          fontSize: '0.75rem'
        }}>
          <span style={{ color: 'var(--text-muted)' }}>Broker Conn:</span>
          {config.fyers_authenticated ? (
            <span style={{ color: 'var(--accent-green)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Shield size={12} /> AUTHENTICATED
            </span>
          ) : (
            <button
              onClick={() => setShowFyersModal(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-gold)',
                fontWeight: 700,
                cursor: 'pointer',
                textDecoration: 'underline'
              }}
            >
              LOGIN NOW
            </button>
          )}
        </div>
      )}

      <hr style={{ border: '0', borderTop: '1px solid var(--border-color)' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Sliders size={18} style={{ color: 'var(--accent-blue)' }} />
        <h3>Parameters</h3>
      </div>

      {/* Candle Interval */}
      <div className="form-group">
        <label>Candle Interval (Minutes)</label>
        <select
          value={config.interval_minutes}
          onChange={(e) => handleConfigChange('interval_minutes', parseInt(e.target.value))}
          className="input-glow-style select-glow-style"
        >
          <option value={1}>1 Minute</option>
          <option value={3}>3 Minutes</option>
          <option value={5}>5 Minutes</option>
          <option value={15}>15 Minutes</option>
        </select>
      </div>

      {/* Std Dev Bands */}
      <div className="form-group">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <label>VWAP Band (Standard Dev)</label>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-blue)' }}>{config.num_std}σ</span>
        </div>
        <input
          type="range"
          min="1.0"
          max="3.0"
          step="0.1"
          value={config.num_std}
          onChange={(e) => handleConfigChange('num_std', parseFloat(e.target.value))}
          style={{ accentColor: 'var(--accent-blue)', background: 'rgba(255,255,255,0.1)', height: '4px', cursor: 'pointer' }}
        />
      </div>

      {/* Mock India VIX Filter */}
      <div className="form-group">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <label>Mock India VIX Filter</label>
          <span style={{ 
            fontSize: '0.8rem', 
            fontWeight: 700, 
            color: config.vix_value > 22.0 ? 'var(--accent-red)' : 'var(--accent-green)' 
          }}>
            {config.vix_value || 15.0} {config.vix_value > 22.0 ? '(BLOCKED 🚫)' : '(ACTIVE 🟢)'}
          </span>
        </div>
        <input
          type="range"
          min="10.0"
          max="30.0"
          step="0.5"
          value={config.vix_value || 15.0}
          onChange={(e) => handleConfigChange('vix_value', parseFloat(e.target.value))}
          style={{ 
            accentColor: config.vix_value > 22.0 ? 'var(--accent-red)' : 'var(--accent-green)', 
            background: 'rgba(255,255,255,0.1)', 
            height: '4px', 
            cursor: 'pointer' 
          }}
        />
        <span style={{ fontSize: '0.65rem', color: 'var(--text-dark)', marginTop: '-2px' }}>
          Signals are blocked if VIX exceeds 22.0
        </span>
      </div>

      {/* Option Days to Expiry */}
      <div className="form-group">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <label>Option Days to Expiry</label>
          <span style={{ 
            fontSize: '0.8rem', 
            fontWeight: 700, 
            color: 'var(--accent-blue)' 
          }}>
            {(config.days_to_expiry !== undefined ? config.days_to_expiry : 3.0).toFixed(2)} Days
          </span>
        </div>
        <input
          type="range"
          min="0.1"
          max="7.0"
          step="0.05"
          value={config.days_to_expiry !== undefined ? config.days_to_expiry : 3.0}
          onChange={(e) => handleConfigChange('days_to_expiry', parseFloat(e.target.value))}
          style={{ 
            accentColor: 'var(--accent-blue)', 
            background: 'rgba(255,255,255,0.1)', 
            height: '4px', 
            cursor: 'pointer' 
          }}
        />
        <span style={{ fontSize: '0.65rem', color: 'var(--text-dark)', marginTop: '-2px' }}>
          Remaining days for option Greeks calculations
        </span>
      </div>

      {/* Qty */}
      <div className="form-group">
        <label>Order Qty (Shares / Lots)</label>
        <input
          type="number"
          value={config.qty}
          onChange={(e) => handleConfigChange('qty', Math.max(1, parseInt(e.target.value) || 1))}
          className="input-glow-style"
        />
      </div>

      {/* Min Checklist Score */}
      <div className="form-group">
        <label>Min Checklist Score ({config.min_checklist_score || 4}/7)</label>
        <select
          value={config.min_checklist_score || 4}
          onChange={(e) => handleConfigChange('min_checklist_score', parseInt(e.target.value))}
          className="input-glow-style select-glow-style"
        >
          <option value={4}>4 (Default - Normal)</option>
          <option value={5}>5 (High Probability)</option>
          <option value={6}>6 (Very High Probability)</option>
          <option value={7}>7 (Strict Crossover)</option>
        </select>
      </div>

      {/* Auto Trade Toggle */}
      <div className="toggle-container">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>Auto-Trade (Paper)</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-dark)' }}>Executes trades on signals</span>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={config.auto_trade}
            onChange={(e) => handleConfigChange('auto_trade', e.target.checked)}
          />
          <span className="slider-round"></span>
        </label>
      </div>

      <hr style={{ border: '0', borderTop: '1px solid var(--border-color)' }} />

      {/* Reset Portfolio */}
      <button onClick={onResetSimulation} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        <RefreshCw size={14} /> Reset Current Stats
      </button>

      <hr style={{ border: '0', borderTop: '1px solid var(--border-color)' }} />
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Play size={18} style={{ color: 'var(--accent-green)' }} />
        <h3>Backtest Engine</h3>
      </div>
      
      <div className="form-group">
        <label>Backtest Duration</label>
        <select
          value={backtestDays}
          onChange={(e) => setBacktestDays(parseInt(e.target.value))}
          className="input-glow-style select-glow-style"
        >
          <option value={1}>1 Trading Day</option>
          <option value={3}>3 Trading Days</option>
          <option value={5}>5 Trading Days</option>
          <option value={180}>6 Months (Instant)</option>
        </select>
      </div>
      
      <button onClick={() => onRunBacktest(backtestDays)} className="btn-primary" style={{ background: 'linear-gradient(135deg, var(--accent-green), #047857)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        <Play size={14} /> ⚡ Run Backtest Replay
      </button>

      {/* Shoonya Credentials Modal */}
      {showCredsModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-content">
            <div className="modal-header">
              <h2>Shoonya Broker Login</h2>
              <button onClick={() => setShowCredsModal(false)} style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>&times;</button>
            </div>
            
            <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label>User ID</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. FA12345"
                  value={creds.userid}
                  onChange={(e) => setCreds({ ...creds, userid: e.target.value })}
                  className="input-glow-style"
                />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  required
                  placeholder="Enter Shoonya Password"
                  value={creds.password}
                  onChange={(e) => setCreds({ ...creds, password: e.target.value })}
                  className="input-glow-style"
                />
              </div>
              <div className="form-group">
                <label>TOTP Secret Key (for Google Authenticator)</label>
                <input
                  type="text"
                  required
                  placeholder="Paste 16-char TOTP Seed"
                  value={creds.totp_secret}
                  onChange={(e) => setCreds({ ...creds, totp_secret: e.target.value })}
                  className="input-glow-style"
                />
              </div>
              <div className="form-group">
                <label>API Key</label>
                <input
                  type="text"
                  required
                  placeholder="Shoonya REST API Key"
                  value={creds.api_key}
                  onChange={(e) => setCreds({ ...creds, api_key: e.target.value })}
                  className="input-glow-style"
                />
              </div>
              <div className="form-group">
                <label>Vendor Code</label>
                <input
                  type="text"
                  required
                  placeholder="Shoonya Vendor Code"
                  value={creds.vendor_code}
                  onChange={(e) => setCreds({ ...creds, vendor_code: e.target.value })}
                  className="input-glow-style"
                />
              </div>

              {loginError && (
                <div style={{ color: 'var(--accent-red)', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '6px' }}>
                  {loginError}
                </div>
              )}

              <button type="submit" className="btn-primary" disabled={loginLoading} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                {loginLoading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />} 
                {loginLoading ? 'Authenticating...' : 'Establish Session'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Fyers Credentials Modal */}
      {showFyersModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2>Fyers API Broker Login</h2>
              <button onClick={() => setShowFyersModal(false)} style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>&times;</button>
            </div>
            
            <form onSubmit={handleFyersLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div className="form-group">
                <label>Fyers App ID (Client ID)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. L0XXXXXX-100"
                  value={fyersCreds.client_id}
                  onChange={(e) => setFyersCreds({ ...fyersCreds, client_id: e.target.value })}
                  className="input-glow-style"
                />
                <span style={{ fontSize: '0.68rem', color: 'var(--accent-gold)', marginTop: '4px', display: 'block', opacity: 0.9 }}>
                  ⚠️ Do <strong>NOT</strong> enter your login ID (UCC like <code>DP12345</code>). You must enter the <strong>App ID</strong> from <a href="https://myapi.fyers.in" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'var(--accent-gold)' }}>myapi.fyers.in</a> (ends in <code>-100</code>).
                </span>
              </div>
              <div className="form-group">
                <label>Fyers App Secret Key</label>
                <input
                  type="password"
                  required
                  placeholder="Enter Fyers Secret Key"
                  value={fyersCreds.secret_key}
                  onChange={(e) => setFyersCreds({ ...fyersCreds, secret_key: e.target.value })}
                  className="input-glow-style"
                />
                <span style={{ fontSize: '0.68rem', color: 'var(--accent-gold)', marginTop: '4px', display: 'block', opacity: 0.9 }}>
                  ⚠️ Do <strong>NOT</strong> enter your portal account login password (e.g. <code>B4WZ591054</code>). You must enter the <strong>App Secret Key</strong> (a longer string) generated for your app at <a href="https://myapi.fyers.in" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'var(--accent-gold)' }}>myapi.fyers.in</a>.
                </span>
              </div>
              <div className="form-group">
                <label>Redirect URI</label>
                <input
                  type="text"
                  required
                  placeholder="http://127.0.0.1:8000/api/fyers/callback"
                  value={fyersCreds.redirect_uri}
                  onChange={(e) => setFyersCreds({ ...fyersCreds, redirect_uri: e.target.value })}
                  className="input-glow-style"
                />
              </div>
              
              <div style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px dashed var(--border-color)',
                borderRadius: '8px',
                padding: '10px',
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                lineHeight: '1.4'
              }}>
                <p style={{ fontWeight: 700, color: 'var(--accent-gold)', marginBottom: '4px' }}>Step 1: Generate Login URL</p>
                <p style={{ marginBottom: '8px' }}>Generate Fyers Auth URL to log in securely at trade.fyers.in and fetch your Authorization Code:</p>
                <button
                  type="button"
                  onClick={handleFyersGenerateUrl}
                  className="btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '6px 12px', width: 'auto', background: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.2)', color: 'var(--accent-gold)' }}
                >
                  🔗 Generate Fyers Login URL
                </button>
              </div>

              <div className="form-group">
                <label style={{ color: 'var(--accent-gold)', fontWeight: 700 }}>Step 2: Paste Authorization Code (Auth Code)</label>
                <input
                  type="text"
                  required
                  placeholder="Paste the auth_code here..."
                  value={fyersCreds.auth_code}
                  onChange={(e) => setFyersCreds({ ...fyersCreds, auth_code: e.target.value })}
                  className="input-glow-style"
                  style={{ borderColor: 'rgba(245, 158, 11, 0.3)' }}
                />
              </div>

              {fyersError && (
                <div style={{ color: 'var(--accent-red)', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '6px' }}>
                  {fyersError}
                </div>
              )}

              <button type="submit" className="btn-primary" disabled={fyersLoading} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'linear-gradient(135deg, var(--accent-gold), #b45309)' }}>
                {fyersLoading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />} 
                {fyersLoading ? 'Authenticating Fyers...' : 'Establish Fyers Session'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
