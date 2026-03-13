import { useMemo } from 'react'
import type { KnowledgeNode, KnowledgeEdge, EdgeType } from '../../types'
import './KnowledgeNodeDetail.css'

interface Props {
  node: KnowledgeNode | null
  edges: KnowledgeEdge[]
  onSessionSelect: (sessionId: string) => void
  onClose: () => void
}

const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  'same-branch': 'Same Branch',
  'shared-files': 'Shared Files',
  'resume-chain': 'Resume Chain',
  'memory-chain': 'Memory Chain',
  'plan-reference': 'Plan Reference',
}

const EDGE_COLORS: Record<EdgeType, string> = {
  'same-branch': '#58a6ff',
  'shared-files': '#8b949e',
  'resume-chain': '#3fb950',
  'memory-chain': '#d29922',
  'plan-reference': '#bc8cff',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function KnowledgeNodeDetail({
  node,
  edges,
  onSessionSelect,
  onClose,
}: Props) {
  // Group edges by type
  const edgesByType = useMemo(() => {
    const grouped = new Map<EdgeType, { sessionId: string; strength: number }[]>()
    for (const edge of edges) {
      const connectedId =
        edge.source === node?.id ? edge.target : edge.source
      const list = grouped.get(edge.type) ?? []
      list.push({ sessionId: connectedId, strength: edge.strength })
      grouped.set(edge.type, list)
    }
    return grouped
  }, [edges, node?.id])

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
        {/* Session ID */}
        <div className="knd-field">
          <span className="knd-field-label">Session ID</span>
          <span className="knd-field-value knd-mono">
            {node.id.slice(0, 8)}...
          </span>
        </div>

        {/* Project */}
        <div className="knd-field">
          <span className="knd-field-label">Project</span>
          <span className="knd-field-value">{node.project}</span>
        </div>

        {/* First prompt */}
        <div className="knd-field">
          <span className="knd-field-label">First Prompt</span>
          <span className="knd-field-value knd-prompt">{node.firstPrompt}</span>
        </div>

        {/* Created at */}
        <div className="knd-field">
          <span className="knd-field-label">Created At</span>
          <span className="knd-field-value">{formatDate(node.createdAt)}</span>
        </div>

        {/* Duration */}
        <div className="knd-field">
          <span className="knd-field-label">Duration</span>
          <span className="knd-field-value">
            {formatDuration(node.durationMinutes)}
          </span>
        </div>

        {/* Tool call count */}
        <div className="knd-field">
          <span className="knd-field-label">Tool Calls</span>
          <span className="knd-field-value">{node.toolCallCount}</span>
        </div>

        {/* Divider */}
        <div className="knd-divider" />

        {/* Connected edges */}
        <div className="knd-edges-section">
          <span className="knd-field-label">Connected Sessions</span>
          {edgesByType.size === 0 ? (
            <p className="knd-no-edges">No connections</p>
          ) : (
            Array.from(edgesByType.entries()).map(([type, connections]) => (
              <div key={type} className="knd-edge-group">
                <div className="knd-edge-type-header">
                  <span
                    className="knd-edge-dot"
                    style={{ backgroundColor: EDGE_COLORS[type] }}
                  />
                  <span className="knd-edge-type-label">
                    {EDGE_TYPE_LABELS[type]}
                  </span>
                  <span className="knd-edge-count">
                    ({connections.length})
                  </span>
                </div>
                <ul className="knd-edge-list">
                  {connections.map((conn) => (
                    <li key={conn.sessionId} className="knd-edge-item">
                      <span className="knd-mono">
                        {conn.sessionId.slice(0, 8)}...
                      </span>
                      <span className="knd-edge-strength">
                        {Math.round(conn.strength * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        {/* Open in Playback button */}
        <button
          className="knd-open-button"
          onClick={() => onSessionSelect(node.id)}
        >
          Open in Playback
        </button>
      </div>
    </div>
  )
}
