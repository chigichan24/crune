import { useState } from 'react'
import { SessionPlayback } from './components/playback/SessionPlayback.tsx'
import './App.css'

type ViewMode = 'overview' | 'playback' | 'knowledge'

function App() {
  const [activeTab, setActiveTab] = useState<ViewMode>('overview')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  const handleSessionSelect = (sessionId: string) => {
    setSelectedSessionId(sessionId)
    setActiveTab('playback')
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">crune</h1>
        <p className="app-subtitle">Claude Code Session Visualizer</p>
        <nav className="tab-nav">
          <button
            className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`tab-button ${activeTab === 'playback' ? 'active' : ''}`}
            onClick={() => setActiveTab('playback')}
          >
            Playback
          </button>
          <button
            className={`tab-button ${activeTab === 'knowledge' ? 'active' : ''}`}
            onClick={() => setActiveTab('knowledge')}
          >
            Knowledge Graph
          </button>
        </nav>
      </header>
      <main className="app-main">
        {activeTab === 'overview' && (
          <div className="placeholder">Overview Dashboard (Phase 4)</div>
        )}
        {activeTab === 'playback' && (
          <SessionPlayback
            sessionId={selectedSessionId}
            onBack={() => {
              setSelectedSessionId(null)
              setActiveTab('overview')
            }}
          />
        )}
        {activeTab === 'knowledge' && (
          <div className="placeholder">Knowledge Graph (Phase 6)</div>
        )}
      </main>
    </div>
  )
}

export default App
