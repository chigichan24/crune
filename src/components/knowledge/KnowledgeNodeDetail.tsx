import type { KnowledgeNode, KnowledgeEdge } from '../../types'
import './KnowledgeNodeDetail.css'

interface Props {
  node: KnowledgeNode | null
  edges: KnowledgeEdge[]
  onSessionSelect: (sessionId: string) => void
  onClose: () => void
}

export function KnowledgeNodeDetail({ node, onClose }: Props) {
  if (!node) return null

  return (
    <div className="knowledge-node-detail">
      <div className="knd-header">
        <h3 className="knd-title">Node Detail</h3>
        <button className="knd-close" onClick={onClose}>
          &times;
        </button>
      </div>
      <div className="knd-body">
        <p className="knd-session-id">{node.id.slice(0, 8)}...</p>
        <p>{node.project}</p>
        <p>{node.firstPrompt}</p>
      </div>
    </div>
  )
}
