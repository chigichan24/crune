import { useState } from 'react'
import { useSessionIndex } from './hooks/useSessionIndex'
import { SessionDashboardView } from './components/overview/SessionDashboardView'
import './App.css'

type ViewMode = 'overview' | 'playback' | 'knowledge'

function App() {
  const [activeTab, setActiveTab] = useState<ViewMode>('overview')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const { data: indexData, loading: indexLoading, error: indexError } = useSessionIndex()

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
          <>
            {indexLoading && (
              <div className="placeholder">Loading session data...</div>
            )}
            {indexError && (
              <div className="placeholder" style={{ color: 'var(--danger)' }}>
                Error loading sessions: {indexError}
              </div>
            )}
            {indexData && (
              <SessionDashboardView
                sessions={indexData.sessions}
                projects={indexData.projects}
                onSessionSelect={handleSessionSelect}
              />
            )}
          </>
        )}
        {activeTab === 'playback' && (
          <div className="placeholder">
            {selectedSessionId
              ? `Session Playback: ${selectedSessionId} (Phase 5)`
              : 'Select a session from Overview to start playback'}
          </div>
        )}
        {activeTab === 'knowledge' && (
          <div className="placeholder">Knowledge Graph (Phase 6)</div>
        )}
      </main>
    </div>
  )
}

export default App
