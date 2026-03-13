import type { TacitKnowledge } from '../../types'
import './TacitKnowledgeView.css'

interface Props {
  knowledge: TacitKnowledge | null
}

export function TacitKnowledgeView({ knowledge }: Props) {
  if (!knowledge) {
    return <div className="tacit-knowledge-view">No tacit knowledge data</div>
  }

  return (
    <div className="tacit-knowledge-view">
      <h3 className="tk-title">Tacit Knowledge</h3>
      <div className="tk-placeholder">Tacit knowledge details (coming soon)</div>
    </div>
  )
}
