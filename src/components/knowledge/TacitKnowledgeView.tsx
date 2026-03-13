import './TacitKnowledgeView.css'

interface Props {
  knowledge: any | null
}

export function TacitKnowledgeView({ knowledge }: Props) {
  if (!knowledge) {
    return (
      <div className="tacit-knowledge-view">
        <p className="tk-empty">No tacit knowledge data available</p>
      </div>
    )
  }

  const workflowPatterns: any[] = knowledge.workflowPatterns ?? []
  const commonToolSequences: any[] = knowledge.commonToolSequences ?? []
  const painPoints = knowledge.painPoints ?? {}
  const longSessions: any[] = painPoints.longSessions ?? []
  const hotFiles: any[] = painPoints.hotFiles ?? []

  const hasContent =
    workflowPatterns.length > 0 ||
    commonToolSequences.length > 0 ||
    longSessions.length > 0 ||
    hotFiles.length > 0

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
        {workflowPatterns.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Workflow Patterns</h4>
            <div className="tk-cards">
              {workflowPatterns.map((pattern: any, i: number) => (
                <div key={i} className="tk-card">
                  <p className="tk-card-description">
                    {pattern.project ?? 'Unknown project'}
                  </p>
                  <p className="tk-card-evidence">
                    Plan mode: {pattern.planModeUsage ?? 0} / {pattern.totalSessions ?? 0} sessions
                  </p>
                  <span className="tk-card-badge">
                    {pattern.totalSessions ?? 0} session{(pattern.totalSessions ?? 0) !== 1 ? 's' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Common Tool Sequences */}
        {commonToolSequences.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Common Tool Sequences</h4>
            <div className="tk-cards">
              {commonToolSequences.map((seq: any, i: number) => (
                <div key={i} className="tk-card">
                  <div className="tk-sequence-flow">
                    {(seq.sequence ?? []).map((tool: string, j: number) => (
                      <span key={j} className="tk-sequence-item">
                        {j > 0 && (
                          <span className="tk-sequence-arrow">&rarr;</span>
                        )}
                        <span className="tk-tool-name">{tool}</span>
                      </span>
                    ))}
                  </div>
                  <div className="tk-sequence-meta">
                    <span className="tk-card-badge">{seq.count ?? 0}x</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pain Points - Long Sessions */}
        {longSessions.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Long Sessions</h4>
            <div className="tk-cards">
              {longSessions.map((point: any, i: number) => (
                <div key={i} className="tk-card tk-card-warning">
                  <div className="tk-pain-header">
                    <span className="tk-pain-badge">Long Session</span>
                    <span className="tk-pain-metric">
                      {Math.round(point.durationMinutes ?? 0)}min
                    </span>
                  </div>
                  <p className="tk-card-description">
                    {point.project ?? ''} — {point.firstPrompt ?? ''}
                  </p>
                  <span className="tk-pain-session">
                    {(point.sessionId ?? '').slice(0, 8)}...
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pain Points - Hot Files */}
        {hotFiles.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Hot Files (5+ edits in one session)</h4>
            <div className="tk-cards">
              {hotFiles.map((point: any, i: number) => (
                <div key={i} className="tk-card tk-card-warning">
                  <div className="tk-pain-header">
                    <span className="tk-pain-badge">Repeated Edits</span>
                    <span className="tk-pain-metric">{point.editCount ?? 0}x</span>
                  </div>
                  <p className="tk-card-description">{point.file ?? ''}</p>
                  <span className="tk-pain-session">
                    {(point.sessionId ?? '').slice(0, 8)}...
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
