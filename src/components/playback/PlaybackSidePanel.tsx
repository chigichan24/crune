import type { SessionDetail } from '../../types/index.ts'
import './PlaybackSidePanel.css'

interface Props {
  detail: SessionDetail
}

export function PlaybackSidePanel({ detail: _detail }: Props) {
  return (
    <aside className="playback-side-panel">
      <div className="side-panel-placeholder">
        Side panel (implementation pending)
      </div>
    </aside>
  )
}
