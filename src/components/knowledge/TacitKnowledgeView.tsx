import type { TacitKnowledge } from '../../types'
import './TacitKnowledgeView.css'

interface Props {
  knowledge: TacitKnowledge | null
}

const PAIN_POINT_LABELS: Record<string, string> = {
  'long-session': 'Long Session',
  'repeated-edits': 'Repeated Edits',
  'many-retries': 'Many Retries',
}

export function TacitKnowledgeView({ knowledge }: Props) {
  if (!knowledge) {
    return (
      <div className="tacit-knowledge-view">
        <p className="tk-empty">No tacit knowledge data available</p>
      </div>
    )
  }

  const hasContent =
    knowledge.workflowPatterns.length > 0 ||
    knowledge.commonToolSequences.length > 0 ||
    knowledge.painPoints.length > 0

  if (!hasContent) {
    return (
      <div className="tacit-knowledge-view">
        <h3 className="tk-title">Tacit Knowledge</h3>
        <p className="tk-empty">No patterns detected yet</p>
      </div>
    )
  }

  return (
    <div className="tacit-knowledge-view">
      <h3 className="tk-title">Tacit Knowledge</h3>

      <div className="tk-sections">
        {/* Workflow Patterns */}
        {knowledge.workflowPatterns.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Workflow Patterns</h4>
            <div className="tk-cards">
              {knowledge.workflowPatterns.map((pattern, i) => (
                <div key={i} className="tk-card">
                  <p className="tk-card-description">{pattern.description}</p>
                  <p className="tk-card-evidence">{pattern.evidence}</p>
                  <span className="tk-card-badge">
                    {pattern.sessionIds.length} session
                    {pattern.sessionIds.length !== 1 ? 's' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Common Tool Sequences */}
        {knowledge.commonToolSequences.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Common Tool Sequences</h4>
            <div className="tk-cards">
              {knowledge.commonToolSequences.map((seq, i) => (
                <div key={i} className="tk-card">
                  <div className="tk-sequence-flow">
                    {seq.sequence.map((tool, j) => (
                      <span key={j} className="tk-sequence-item">
                        {j > 0 && (
                          <span className="tk-sequence-arrow">&rarr;</span>
                        )}
                        <span className="tk-tool-name">{tool}</span>
                      </span>
                    ))}
                  </div>
                  <div className="tk-sequence-meta">
                    <span className="tk-card-badge">{seq.count}x</span>
                    {seq.contexts.length > 0 && (
                      <span className="tk-sequence-contexts">
                        {seq.contexts.slice(0, 3).join(', ')}
                        {seq.contexts.length > 3 &&
                          ` +${seq.contexts.length - 3}`}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pain Points */}
        {knowledge.painPoints.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Pain Points</h4>
            <div className="tk-cards">
              {knowledge.painPoints.map((point, i) => (
                <div key={i} className="tk-card tk-card-warning">
                  <div className="tk-pain-header">
                    <span className="tk-pain-badge">
                      {PAIN_POINT_LABELS[point.type] ?? point.type}
                    </span>
                    <span className="tk-pain-metric">{point.metric}</span>
                  </div>
                  <p className="tk-card-description">{point.description}</p>
                  <span className="tk-pain-session">
                    {point.sessionId.slice(0, 8)}...
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
