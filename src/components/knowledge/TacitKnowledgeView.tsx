import { useState, useCallback } from 'react'
import type { KnowledgeGraphMetrics, TopicNode, TacitKnowledge } from '../../types'
import './TacitKnowledgeView.css'

interface Props {
  knowledge: TacitKnowledge | null
  graphMetrics?: KnowledgeGraphMetrics
  topics?: TopicNode[]
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const blob = new Blob([text], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'skill.md'
      a.click()
      URL.revokeObjectURL(url)
    }
  }, [text])

  return (
    <button className="tk-export-btn" onClick={handleCopy}>
      {copied ? 'Copied!' : label}
    </button>
  )
}

export function TacitKnowledgeView({ knowledge, graphMetrics, topics }: Props) {
  if (!knowledge) {
    return (
      <div className="tacit-knowledge-view">
        <p className="tk-empty">暗黙知データがありません</p>
      </div>
    )
  }

  const workflowPatterns = knowledge.workflowPatterns ?? []
  const commonToolSequences = knowledge.commonToolSequences ?? []
  const enrichedToolSequences = knowledge.enrichedToolSequences ?? []
  const skillCandidates = knowledge.skillCandidates ?? []
  const longSessions = knowledge.painPoints?.longSessions ?? []
  const hotFiles = knowledge.painPoints?.hotFiles ?? []

  // Knowledge graph insights
  const isolatedTopics = topics?.filter((t) => t.degreeCentrality === 0) ?? []
  const bridgeTopics = topics
    ?.filter(
      (t) =>
        graphMetrics?.bridgeTopicIds?.includes(t.id) && t.betweennessCentrality > 0
    )
    ?.sort((a, b) => b.betweennessCentrality - a.betweennessCentrality) ?? []
  const crossProjectTopics =
    topics?.filter((t) => t.projects.length > 1) ?? []

  const hasContent =
    workflowPatterns.length > 0 ||
    commonToolSequences.length > 0 ||
    enrichedToolSequences.length > 0 ||
    skillCandidates.length > 0 ||
    longSessions.length > 0 ||
    hotFiles.length > 0 ||
    isolatedTopics.length > 0 ||
    bridgeTopics.length > 0 ||
    crossProjectTopics.length > 0

  if (!hasContent) {
    return (
      <div className="tacit-knowledge-view">
        <h3 className="tk-title">Tacit Knowledge</h3>
        <p className="tk-empty">パターンはまだ検出されていません</p>
      </div>
    )
  }

  return (
    <div className="tacit-knowledge-view">
      <h3 className="tk-title">Tacit Knowledge</h3>

      <div className="tk-sections">
        {/* Knowledge Silos */}
        {isolatedTopics.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Knowledge Silos</h4>
            <p className="tk-section-desc">
              他の知識領域との接続がないトピックです
            </p>
            <div className="tk-cards">
              {isolatedTopics.map((topic) => (
                <div key={topic.id} className="tk-card tk-card-silo">
                  <p className="tk-card-description">{topic.label}</p>
                  <div className="tk-card-meta">
                    <span className="tk-card-badge">
                      {topic.sessionCount} session{topic.sessionCount !== 1 ? 's' : ''}
                    </span>
                    <span className="tk-card-keywords">
                      {topic.keywords.slice(0, 3).join(', ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bridge Topics */}
        {bridgeTopics.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Bridge Topics</h4>
            <p className="tk-section-desc">
              複数の知識領域をつなぐトピックです
            </p>
            <div className="tk-cards">
              {bridgeTopics.map((topic) => (
                <div key={topic.id} className="tk-card tk-card-bridge">
                  <p className="tk-card-description">{topic.label}</p>
                  <div className="tk-card-meta">
                    <span className="tk-card-badge tk-badge-bridge">
                      BC: {topic.betweennessCentrality.toFixed(3)}
                    </span>
                    <span className="tk-card-keywords">
                      {topic.keywords.slice(0, 3).join(', ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cross-Project Knowledge */}
        {crossProjectTopics.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Cross-Project Knowledge</h4>
            <p className="tk-section-desc">
              複数プロジェクトにまたがるトピックです
            </p>
            <div className="tk-cards">
              {crossProjectTopics.map((topic) => (
                <div key={topic.id} className="tk-card">
                  <p className="tk-card-description">{topic.label}</p>
                  <div className="tk-card-meta">
                    <span className="tk-card-badge">
                      {topic.projects.length} projects
                    </span>
                    <span className="tk-card-keywords">
                      {topic.projects.join(', ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Workflow Patterns */}
        {workflowPatterns.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Workflow Patterns</h4>
            <div className="tk-cards">
              {workflowPatterns.map((pattern, i) => (
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

        {/* Skill Candidates */}
        {skillCandidates.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Skill Candidates</h4>
            <p className="tk-section-desc">
              再利用価値の高いパターンからSkill定義を生成しました
            </p>
            <div className="tk-cards">
              {skillCandidates
                .sort((a, b) => b.reusabilityScore - a.reusabilityScore)
                .slice(0, 10)
                .map((candidate) => {
                  const topic = topics?.find((t) => t.id === candidate.topicId)
                  return (
                    <div key={candidate.topicId} className="tk-card tk-card-skill">
                      <p className="tk-card-description">
                        {topic?.label ?? candidate.topicId}
                      </p>
                      <div className="tk-card-meta">
                        <span className="tk-card-badge tk-badge-score">
                          Score: {Math.round(candidate.reusabilityScore * 100)}%
                        </span>
                        {candidate.hookJson && (
                          <span className="tk-card-badge">Hook</span>
                        )}
                      </div>
                      <CopyButton text={candidate.skillMarkdown} label="Export Skill" />
                    </div>
                  )
                })}
            </div>
          </div>
        )}

        {/* Enriched Tool Sequences */}
        {enrichedToolSequences.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Enriched Tool Patterns</h4>
            <p className="tk-section-desc">
              パラメータ付きツール使用パターン
            </p>
            <div className="tk-cards">
              {enrichedToolSequences.slice(0, 15).map((seq, i) => (
                <div key={i} className="tk-card">
                  <div className="tk-sequence-flow">
                    {seq.sequence.map((step, j) => (
                      <span key={j} className="tk-sequence-item">
                        {j > 0 && (
                          <span className="tk-sequence-arrow">&rarr;</span>
                        )}
                        <span className="tk-tool-name">{step.toolName}</span>
                        {step.targetPattern && (
                          <span className="tk-tool-target">{step.targetPattern}</span>
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="tk-sequence-meta">
                    <span className="tk-card-badge">{seq.count}x</span>
                    <span className="tk-card-badge">{seq.projects.length} project(s)</span>
                    <span className="tk-card-badge">{seq.sessionIds.length} session(s)</span>
                  </div>
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
              {commonToolSequences.map((seq, i) => (
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
              {longSessions.map((point, i) => (
                <div key={i} className="tk-card tk-card-warning">
                  <div className="tk-pain-header">
                    <span className="tk-pain-badge">長時間セッション</span>
                    <span className="tk-pain-metric">
                      {Math.round(point.durationMinutes ?? 0)}min
                    </span>
                  </div>
                  <p className="tk-card-description">
                    {point.sessionId.slice(0, 8)}
                  </p>
                  <span className="tk-pain-session">
                    {point.sessionId.slice(0, 8)}...
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pain Points - Hot Files */}
        {hotFiles.length > 0 && (
          <div className="tk-section">
            <h4 className="tk-section-title">Hot Files (1セッション内で5回以上編集)</h4>
            <div className="tk-cards">
              {hotFiles.map((point, i) => (
                <div key={i} className="tk-card tk-card-warning">
                  <div className="tk-pain-header">
                    <span className="tk-pain-badge">繰り返し編集</span>
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
