import { useState } from 'react'
import './App.css'
import { KnowledgeGraphView } from './components/knowledge/KnowledgeGraphView'
import { useSessionOverview } from './hooks/useSessionOverview'

type ViewMode = 'overview' | 'playback' | 'knowledge'

function App() {
  const [activeTab, setActiveTab] = useState<ViewMode>('overview')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const { data: overviewData, loading: overviewLoading, error: overviewError } = useSessionOverview()

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
          <div className="placeholder">
            {selectedSessionId
              ? `Session Playback: ${selectedSessionId} (Phase 5)`
              : 'Select a session from Overview to start playback'}
          </div>
        )}
        {activeTab === 'knowledge' && (
          <KnowledgeGraphView
            overview={overviewData}
            loading={overviewLoading}
            error={overviewError}
            onSessionSelect={handleSessionSelect}
          />
        )}
      </main>
    </div>
  )
}

export default App
