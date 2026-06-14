import { useState } from 'react'
import { useSessionIndex } from './hooks/useSessionIndex'
import { SessionDashboardView } from './components/overview/SessionDashboardView'
import { SessionPlayback } from './components/playback/SessionPlayback'
import { HelpModal } from './components/HelpModal'
import './App.css'
import { KnowledgeView } from './components/knowledge/KnowledgeView'
import { useSessionOverview } from './hooks/useSessionOverview'

type ViewMode = 'overview' | 'knowledge'

function App() {
  const [activeTab, setActiveTab] = useState<ViewMode>('overview')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  // Turn to open the playback drawer at (e.g. from a semantic-search result).
  // Undefined means "open at the top" (existing session-list behaviour).
  const [initialTurnIndex, setInitialTurnIndex] = useState<number | undefined>(undefined)
  // Monotonic navigation nonce. Clicking the SAME result twice sets identical
  // sessionId+turnIndex, so React bails and SessionPlayback's scroll effect
  // (keyed on those) never refires. Bumping the nonce on every navigation makes
  // repeat navigation re-trigger the deep-link scroll.
  const [navNonce, setNavNonce] = useState(0)
  const { data: indexData, loading: indexLoading, error: indexError } = useSessionIndex()
  const { data: overviewData, loading: overviewLoading, error: overviewError } = useSessionOverview()
  const [showHelp, setShowHelp] = useState(false)

  const handleSessionSelect = (sessionId: string, turnIndex?: number) => {
    setSelectedSessionId(sessionId)
    setInitialTurnIndex(turnIndex)
    setNavNonce((n) => n + 1)
  }

  const handleDrawerClose = () => {
    setSelectedSessionId(null)
    setInitialTurnIndex(undefined)
  }

  const drawerOpen = selectedSessionId !== null

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <img src="/favicon.svg" alt="crune logo" className="app-logo" />
          <div>
            <h1 className="app-title">crune</h1>
            <p className="app-subtitle">Claude Code Rune — Traces linger, skills emerge</p>
          </div>
        </div>
        <nav className="tab-nav">
          <button
            className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`tab-button ${activeTab === 'knowledge' ? 'active' : ''}`}
            onClick={() => setActiveTab('knowledge')}
          >
            Rune
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
        {activeTab === 'knowledge' && (
          <KnowledgeView
            overview={overviewData}
            loading={overviewLoading}
            error={overviewError}
            onSessionSelect={handleSessionSelect}
          />
        )}
      </main>

      {/* Help Button */}
      <button className="help-fab" onClick={() => setShowHelp(true)}>?</button>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {/* Playback Drawer */}
      <div
        className={`playback-drawer-overlay ${drawerOpen ? 'open' : ''}`}
        onClick={handleDrawerClose}
      />
      <div className={`playback-drawer ${drawerOpen ? 'open' : ''}`}>
        {drawerOpen && (
          <SessionPlayback
            sessionId={selectedSessionId}
            initialTurnIndex={initialTurnIndex}
            navNonce={navNonce}
            onNavigate={handleSessionSelect}
            onClose={handleDrawerClose}
          />
        )}
      </div>
    </div>
  )
}

export default App
