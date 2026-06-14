import { useState } from 'react'
import type { SessionOverviewData } from '../../types'
import { KnowledgeGraphView } from './KnowledgeGraphView'
import { SkillExplorerView } from './SkillExplorerView'
import './KnowledgeView.css'

type Mode = 'explorer' | 'graph'

interface Props {
  overview: SessionOverviewData | null
  loading: boolean
  error: string | null
  onSessionSelect: (sessionId: string) => void
}

/**
 * Container for the knowledge tab. Defaults to the filter-driven skill explorer
 * (issue #73); the force-directed graph is kept behind a toggle.
 */
export function KnowledgeView(props: Props) {
  const [mode, setMode] = useState<Mode>('explorer')

  return (
    <div className="kv-root">
      <div className="kv-toggle" role="tablist" aria-label="Knowledge view mode">
        <button
          role="tab"
          aria-selected={mode === 'explorer'}
          className={`kv-toggle-btn${mode === 'explorer' ? ' kv-toggle-btn--on' : ''}`}
          onClick={() => setMode('explorer')}
        >
          Skillエクスプローラ
        </button>
        <button
          role="tab"
          aria-selected={mode === 'graph'}
          className={`kv-toggle-btn${mode === 'graph' ? ' kv-toggle-btn--on' : ''}`}
          onClick={() => setMode('graph')}
        >
          グラフ
        </button>
      </div>
      <div className="kv-body">
        {mode === 'explorer' ? (
          <SkillExplorerView {...props} />
        ) : (
          <KnowledgeGraphView {...props} />
        )}
      </div>
    </div>
  )
}
