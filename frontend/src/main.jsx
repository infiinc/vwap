import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '25px',
          backgroundColor: '#0a0f1a',
          color: '#ff4455',
          fontFamily: 'monospace',
          height: '100vh',
          boxSizing: 'border-box',
          overflow: 'auto'
        }}>
          <h2 style={{ color: '#ff4455', marginTop: 0 }}>🚨 React Component Crash</h2>
          <p style={{ color: '#9ca3af' }}>An error occurred during rendering:</p>
          <div style={{
            background: 'rgba(0,0,0,0.4)',
            padding: '12px',
            borderRadius: '6px',
            border: '1px solid rgba(255, 68, 85, 0.2)',
            marginBottom: '15px'
          }}>
            <strong>Message:</strong> {this.state.error?.message || String(this.state.error)}
          </div>
          <strong>Stack Trace:</strong>
          <pre style={{
            background: 'rgba(0,0,0,0.5)',
            padding: '12px',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.05)',
            color: '#e2e8f0',
            fontSize: '11px',
            marginTop: '5px',
            overflowX: 'auto'
          }}>
            {this.state.error?.stack || 'N/A'}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
