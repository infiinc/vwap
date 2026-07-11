import { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';

export default function ConsoleLog({ logs }) {
  const terminalEndRef = useRef(null);

  // Auto scroll to bottom
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Determine line CSS based on content keywords
  const getLineClass = (line) => {
    if (line.includes('❌') || line.includes('Error') || line.includes('failed')) return 'error';
    if (line.includes('⚡') || line.includes('Warning')) return 'warn';
    if (line.includes('🚀') || line.includes('successful') || line.includes('Login Successful') || line.includes('🛒')) return 'success';
    return '';
  };

  return (
    <div className="glass-card bottom-panel-card">
      <div className="panel-header">
        <h3>
          <Terminal size={14} style={{ color: 'var(--accent-green)' }} />
          System Event Terminal Logs
        </h3>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-dark)' }}>
          Active Session
        </span>
      </div>

      <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
        <div className="terminal-window">
          {logs.length === 0 ? (
            <div className="terminal-line" style={{ color: 'var(--text-dark)' }}>
              &gt; Establishing connection to strategy server...
            </div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className={`terminal-line ${getLineClass(log)}`}>
                &gt; {log}
              </div>
            ))
          )}
          <div ref={terminalEndRef} />
        </div>
      </div>
    </div>
  );
}
