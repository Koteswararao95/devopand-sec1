import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [mode, setMode] = useState('auto');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progressLogs, setProgressLogs] = useState([]);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [activeTab, setActiveTab] = useState('dockerfile');
  const [copied, setCopied] = useState(false);

  // Active steps tracker
  const [steps, setSteps] = useState([
    { id: 'clone', label: 'Clone Repository', status: 'idle', desc: 'Awaiting submission...' },
    { id: 'scan', label: 'Scan & Analyze Structure', status: 'idle', desc: 'Inspect packages, entry points, and lockfiles.' },
    { id: 'agent', label: 'AI Strategy Generation', status: 'idle', desc: 'Generate optimal Dockerfile via Gemini LLM.' },
    { id: 'build', label: 'Build Image (with Self-Correction)', status: 'idle', desc: 'Process docker builds and capture compiler logs.' },
    { id: 'run', label: 'Run & Verify Healthcheck', status: 'idle', desc: 'Test start command and ping local endpoints.' }
  ]);

  const terminalEndRef = useRef(null);

  // Load API Key from localStorage on start
  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
      setApiKey(savedKey);
    } else {
      // Open settings if no API key is set
      setIsSettingsOpen(true);
    }
  }, []);

  // Save API Key to localStorage when updated
  const handleSaveApiKey = (val) => {
    setApiKey(val);
    localStorage.setItem('gemini_api_key', val);
  };

  // Scroll to bottom of terminal when logs are added
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [progressLogs]);

  // Helper to update a single step's status & description
  const updateStep = (id, status, desc) => {
    setSteps(prev => prev.map(step => {
      if (step.id === id) {
        return { ...step, status, desc: desc || step.desc };
      }
      return step;
    }));
  };

  // Resets steps state before a run
  const resetSteps = () => {
    setSteps([
      { id: 'clone', label: 'Clone Repository', status: 'idle', desc: 'Cloning repo...' },
      { id: 'scan', label: 'Scan & Analyze Structure', status: 'idle', desc: 'Searching for package configs...' },
      { id: 'agent', label: 'AI Strategy Generation', status: 'idle', desc: 'Crafting initial Dockerfile...' },
      { id: 'build', label: 'Build Image (with Self-Correction)', status: 'idle', desc: 'Running compile layers...' },
      { id: 'run', label: 'Run & Verify Healthcheck', status: 'idle', desc: 'Verifying container responsiveness...' }
    ]);
  };

  // Parse logs in real-time to update the UI timeline steps
  const processLogForStepper = (type, message) => {
    if (type === 'System') {
      if (message.includes('Cloning GitHub repository')) {
        updateStep('clone', 'active', 'Executing git clone...');
      } else if (message.includes('Repository cloned successfully')) {
        updateStep('clone', 'success', 'Cloned successfully.');
        updateStep('scan', 'active', 'Scanning filesystem tree...');
      } else if (message.includes('Auto-detected Docker')) {
        updateStep('build', 'active', message);
      } else if (message.includes('Spawning SIMULATED container') || message.includes('Starting container')) {
        updateStep('run', 'active', 'Container running, checking port health...');
      } else if (message.includes('Verification successful')) {
        updateStep('run', 'success', 'Responsive! Verified HTTP status 200 OK.');
      }
    } else if (type === 'Agent') {
      if (message.includes('Initiating codebase scan')) {
        updateStep('scan', 'active', 'Processing directory structures...');
      } else if (message.includes('Scan complete')) {
        updateStep('scan', 'success', 'Identified codebase and dependencies.');
        updateStep('agent', 'active', 'Connecting to Gemini AI Studio...');
      } else if (message.includes('Sending codebase context')) {
        updateStep('agent', 'active', 'Generating Dockerfile strategy...');
      } else if (message.includes('Generated Dockerfile')) {
        updateStep('agent', 'success', 'Initial strategy generated.');
        updateStep('build', 'active', 'Triggering Docker build engine...');
      } else if (message.includes('SUCCESS!')) {
        updateStep('build', 'success', 'Build succeeded.');
      } else if (message.includes('[FAIL]')) {
        updateStep('build', 'failed', 'Compile error detected!');
      } else if (message.includes('Initiating Self-Correction Loop')) {
        updateStep('build', 'active', 'Analysing stderr error log, preparing LLM self-correction prompt...');
      }
    }
  };

  const handleForge = async (e) => {
    e.preventDefault();
    if (!repoUrl) return;

    setIsLoading(true);
    setResult(null);
    setErrorMsg(null);
    setProgressLogs([]);
    resetSteps();

    // Optimistically close settings modal if open
    setIsSettingsOpen(false);

    try {
      const response = await fetch('/api/forge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl, apiKey, mode })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Server error starting the forge agent.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Hold onto incomplete lines

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            
            if (data.type === 'RESULT') {
              setResult(data.message);
              // Set all intermediate steps to success
              setSteps(prev => prev.map(s => ({ ...s, status: s.status === 'idle' ? 'success' : s.status })));
            } else if (data.type === 'ERROR') {
              setErrorMsg(data.message);
              // Set active step to failed
              setSteps(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'failed', desc: data.message } : s));
            } else {
              // Standard logs
              setProgressLogs(prev => [...prev, data]);
              processLogForStepper(data.type, data.message);
            }
          } catch (err) {
            console.error('Failed to parse line:', line, err);
          }
        }
      }
    } catch (err) {
      setErrorMsg(err.message);
      setProgressLogs(prev => [...prev, { type: 'System', message: `Fatal: ${err.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCode = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadFile = (filename, content) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Helper to render step status icons
  const renderStepIcon = (status) => {
    switch (status) {
      case 'active':
        return <div className="spinner"></div>;
      case 'success':
        return <span style={{ color: '#10b981' }}>✓</span>;
      case 'failed':
        return <span style={{ color: '#ef4444' }}>✗</span>;
      case 'idle':
      default:
        return <span style={{ color: '#475569' }}>○</span>;
    }
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">🛠️</span>
          <div>
            <h1 className="brand-name">DockerForge</h1>
            <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: '500' }}>AI-Powered Dockerfile Generator & Self-Correction Agent</span>
          </div>
        </div>
        <div className="header-actions">
          <button className="settings-btn" onClick={() => setIsSettingsOpen(true)}>
            <span>⚙</span> Settings
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <main className="main-grid">
        {/* Left Side: Setup & Logs */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* Main Request Form */}
          <div className="panel">
            <h3 className="panel-title">
              <span style={{ color: '#8b5cf6' }}>⚡</span> Forge New Container
            </h3>
            <form onSubmit={handleForge} className="forge-input-container">
              <input
                type="url"
                required
                placeholder="Enter GitHub Repository URL (e.g. https://github.com/expressjs/express)..."
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="repo-input"
                disabled={isLoading}
              />
              <button type="submit" disabled={isLoading || !repoUrl} className="forge-btn">
                {isLoading ? (
                  <>
                    <div className="spinner"></div> Forging...
                  </>
                ) : (
                  'Forge Dockerfile'
                )}
              </button>
            </form>
          </div>

          {/* Stepper Timeline UI */}
          <div className="panel">
            <h3 className="panel-title">
              <span style={{ color: '#6366f1' }}>🤖</span> Agent Thought Stream
            </h3>
            <div className="steps-container">
              {steps.map((step) => (
                <div key={step.id} className={`step-card ${step.status}`}>
                  <div className="step-icon">{renderStepIcon(step.status)}</div>
                  <div className="step-content">
                    <div className="step-header">
                      <span>{step.label}</span>
                    </div>
                    <span className="step-desc">{step.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Console Output Term */}
          <div className="terminal">
            <div className="terminal-header">
              <div className="terminal-dots">
                <div className="dot red"></div>
                <div className="dot yellow"></div>
                <div className="dot green"></div>
              </div>
              <span className="terminal-title">dockerforge-runner@console:~</span>
              <div></div>
            </div>
            <div className="terminal-body">
              {progressLogs.length === 0 ? (
                <div style={{ color: '#64748b', fontStyle: 'italic' }}>Terminal idle. Submit a repo to stream build & agent compiler outputs...</div>
              ) : (
                progressLogs.map((log, index) => (
                  <div key={index} className={`log-line log-${log.type.toLowerCase().replace(' ', '-')}`}>
                    <span style={{ opacity: 0.5 }}>[{log.type}]</span> {log.message}
                  </div>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>
        </section>

        {/* Right Side: Results */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <div className="panel" style={{ flex: 1 }}>
            <h3 className="panel-title">
              <span style={{ color: '#10b981' }}>📦</span> Compiled Deliverables
            </h3>

            {errorMsg && (
              <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', padding: '1rem', borderRadius: '8px', color: '#f43f5e', fontSize: '0.9rem' }}>
                <strong>Forge Error:</strong> {errorMsg}
              </div>
            )}

            {!result && !errorMsg && !isLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '400px', color: '#64748b', gap: '1rem' }}>
                <span style={{ fontSize: '3rem' }}>📁</span>
                <p>No results yet. Enter a repo URL above to forge its Dockerfile.</p>
              </div>
            )}

            {isLoading && !result && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '400px', color: '#94a3b8', gap: '1rem' }}>
                <div className="spinner" style={{ width: '2.5rem', height: '2.5rem', borderWidth: '3px' }}></div>
                <p className="pulse">Agent is generating and verifying container config...</p>
              </div>
            )}

            {result && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%' }}>
                
                {/* Tabs */}
                <div className="tabs">
                  <button
                    className={`tab-btn ${activeTab === 'dockerfile' ? 'active' : ''}`}
                    onClick={() => setActiveTab('dockerfile')}
                  >
                    Dockerfile
                  </button>
                  <button
                    className={`tab-btn ${activeTab === 'compose' ? 'active' : ''}`}
                    onClick={() => setActiveTab('compose')}
                  >
                    docker-compose.yml
                  </button>
                  <button
                    className={`tab-btn ${activeTab === 'reasoning' ? 'active' : ''}`}
                    onClick={() => setActiveTab('reasoning')}
                  >
                    AI Explanation
                  </button>
                </div>

                {/* Code Body Container */}
                {activeTab === 'dockerfile' && (
                  <div className="code-container">
                    <div className="code-header">
                      <button className="code-action-btn" onClick={() => handleCopyCode(result.dockerfile)}>
                        {copied ? 'Copied ✓' : 'Copy'}
                      </button>
                      <button className="code-action-btn" onClick={() => handleDownloadFile('Dockerfile', result.dockerfile)}>
                        Download
                      </button>
                    </div>
                    <pre className="code-body"><code>{result.dockerfile}</code></pre>
                  </div>
                )}

                {activeTab === 'compose' && (
                  <div className="code-container">
                    <div className="code-header">
                      <button className="code-action-btn" onClick={() => handleCopyCode(result.dockerCompose)}>
                        {copied ? 'Copied ✓' : 'Copy'}
                      </button>
                      <button className="code-action-btn" onClick={() => handleDownloadFile('docker-compose.yml', result.dockerCompose)}>
                        Download
                      </button>
                    </div>
                    <pre className="code-body"><code>{result.dockerCompose}</code></pre>
                  </div>
                )}

                {activeTab === 'reasoning' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', maxHeight: '480px' }}>
                    <div className="explanation-card">
                      <h4>Framework Detection</h4>
                      <p>{result.reasoning}</p>
                    </div>
                    <div className="explanation-card">
                      <h4>Network Configuration</h4>
                      <p>Exposed Port: <strong>{result.exposePort}</strong>. In Production mode, maps cleanly. Verified connectivity successfully.</p>
                    </div>
                    <div className="explanation-card">
                      <h4>Self-Correction Summary</h4>
                      <p>Completed in <strong>{result.attempts}</strong> {result.attempts === 1 ? 'attempt' : 'attempts'}. Engine mode: <strong>{result.mode === 'simulated' ? 'High-Fidelity Simulation Fallback' : 'Real Host Docker CLI'}</strong>.</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <button className="modal-close" onClick={() => setIsSettingsOpen(false)}>×</button>
            <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.75rem', color: 'white' }}>⚙ Settings</h3>
            
            <div className="form-group">
              <label htmlFor="apiKeyInput">Gemini API Key</label>
              <input
                id="apiKeyInput"
                type="password"
                placeholder="Enter Gemini API Key (AI Studio)..."
                value={apiKey}
                onChange={(e) => handleSaveApiKey(e.target.value)}
                className="form-input"
              />
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Used to run generator agents. Saved locally in your browser.</span>
            </div>

            <div className="form-group">
              <label htmlFor="modeSelect">Docker Execution Mode</label>
              <select
                id="modeSelect"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="form-select"
              >
                <option value="auto">Auto (Detect Host Docker)</option>
                <option value="real">Force Real Docker (Requires docker CLI)</option>
                <option value="simulated">Force Simulation (Fallback Mock Engine)</option>
              </select>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>If Docker is missing on your machine, Simulation Mode validates Dockerfiles against your codebase structure and triggers realistic self-corrections.</span>
            </div>

            <button
              onClick={() => setIsSettingsOpen(false)}
              className="forge-btn"
              style={{ justifyContent: 'center', padding: '0.75rem' }}
            >
              Save & Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
