import { useEffect, useMemo, useState } from 'react'
import type { TopicNode, TopicEdge, SemanticEdgeType, SkillCandidate, EnrichedToolSequence, KnowledgeCommunity } from '../../types'
import { useSkillSynthesis } from '../../hooks/useSkillSynthesis'
import { buildGraphContext } from '../../utils/buildGraphContext'
import './KnowledgeNodeDetail.css'

interface Props {
  node: TopicNode | null
  edges: TopicEdge[]
  allTopics: TopicNode[]
  skillCandidates?: SkillCandidate[]
  enrichedSequences?: EnrichedToolSequence[]
  communities?: KnowledgeCommunity[]
  bridgeTopicIds?: string[]
  onSessionSelect: (sessionId: string) => void
  onClose: () => void
}

const EDGE_TYPE_LABELS: Record<SemanticEdgeType, string> = {
  'semantic-similarity': '意味的類似',
  'shared-module': 'モジュール共有',
  'workflow-continuation': 'ワークフロー継続',
  'cross-project-bridge': 'プロジェクト横断',
}

const EDGE_TYPE_DESCRIPTIONS: Record<SemanticEdgeType, string> = {
  'semantic-similarity': '内容やキーワードが意味的に類似したトピック',
  'shared-module': '同じファイルやモジュールを編集したトピック',
  'workflow-continuation': '時間的に連続する作業フローのトピック',
  'cross-project-bridge': '異なるプロジェクト間をまたぐ関連トピック',
}

const EDGE_COLORS: Record<SemanticEdgeType, string> = {
  'semantic-similarity': '#6366f1',
  'shared-module': '#06b6d4',
  'workflow-continuation': '#14b8a6',
  'cross-project-bridge': '#f59e0b',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function centralityInterpretation(bc: number, dc: number): string {
  if (bc > 0.2) return '複数の知識領域をつなぐ重要なブリッジ'
  if (bc > 0.05) return 'いくつかの領域をつなぐブリッジ'
  if (dc > 0.5) return '多くのトピックと接続されたハブ'
  if (dc === 0) return '他のトピックとの接続がない孤立ノード'
  return '周辺的なトピック'
}

export function KnowledgeNodeDetail({
  node,
  edges,
  allTopics,
  skillCandidates,
  enrichedSequences,
  communities,
  bridgeTopicIds,
  onSessionSelect,
  onClose,
}: Props) {
  const [synthCopied, setSynthCopied] = useState(false)
  const { synthesize, loading: synthLoading, result: synthResult, error: synthError, reset: resetSynth } = useSkillSynthesis()

  useEffect(() => {
    resetSynth()
  }, [node?.id, resetSynth])

  const skillCandidate = useMemo(() => {
    if (!node || !skillCandidates) return null
    return skillCandidates.find((sc) => sc.topicId === node.id) ?? null
  }, [node, skillCandidates])
  // Group edges by type, resolve connected topic labels
  const edgesByType = useMemo(() => {
    const topicMap = new Map(allTopics.map((t) => [t.id, t]))
    const grouped = new Map<
      SemanticEdgeType,
      { topicId: string; topicLabel: string; strength: number; label: string }[]
    >()
    for (const edge of edges) {
      const connectedId =
        edge.source === node?.id ? edge.target : edge.source
      const connectedTopic = topicMap.get(connectedId)
      const list = grouped.get(edge.type) ?? []
      list.push({
        topicId: connectedId,
        topicLabel: connectedTopic?.label ?? connectedId,
        strength: edge.strength,
        label: edge.label,
      })
      grouped.set(edge.type, list)
    }
    return grouped
  }, [edges, node?.id, allTopics])

  if (!node) return null

  return (
    <div className="knowledge-node-detail">
      <div className="knd-header">
        <h3 className="knd-title">Topic Detail</h3>
        <button className="knd-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="knd-body">
        {/* Topic label */}
        <div className="knd-topic-label">{node.label}</div>

        {/* Keywords */}
        <div className="knd-keywords">
          {node.keywords.map((kw) => (
            <span key={kw} className="knd-keyword-tag">
              {kw}
            </span>
          ))}
        </div>

        {/* Stats */}
        <div className="knd-stats-grid">
          <div className="knd-stat">
            <span className="knd-stat-label">Sessions</span>
            <span className="knd-stat-value">{node.sessionCount}</span>
          </div>
          <div className="knd-stat">
            <span className="knd-stat-label">Duration</span>
            <span className="knd-stat-value">
              {formatDuration(node.totalDurationMinutes)}
            </span>
          </div>
          <div className="knd-stat">
            <span className="knd-stat-label">Tool Calls</span>
            <span className="knd-stat-value">{node.totalToolCalls}</span>
          </div>
          <div className="knd-stat">
            <span className="knd-stat-label">Period</span>
            <span className="knd-stat-value knd-stat-small">
              {node.firstSeen ? formatDate(node.firstSeen) : '—'} –{' '}
              {node.lastSeen ? formatDate(node.lastSeen) : '—'}
            </span>
          </div>
        </div>

        {/* Dominant Role Badge */}
        <div className="knd-role-badge-container">
          <span className={`knd-role-badge knd-role-badge--${node.dominantRole}`}>
            {node.dominantRole === 'user-driven' && 'User-Driven'}
            {node.dominantRole === 'tool-heavy' && 'Tool-Heavy'}
            {node.dominantRole === 'subagent-delegated' && 'Subagent-Delegated'}
          </span>
        </div>

        {/* Reusability Score */}
        {node.reusabilityScore && (
          <div className="knd-field">
            <span className="knd-field-label">Reusability Score</span>
            <div className="knd-reusability">
              <div className="knd-reusability-overall">
                <span className="knd-reusability-bar" style={{ width: `${Math.round(node.reusabilityScore.overall * 100)}%` }} />
                <span className="knd-reusability-value">{Math.round(node.reusabilityScore.overall * 100)}%</span>
              </div>
              <div className="knd-reusability-breakdown">
                <span>Frequency: {Math.round(node.reusabilityScore.frequency * 100)}%</span>
                <span>Time Cost: {Math.round(node.reusabilityScore.timeCost * 100)}%</span>
                <span>Cross-Project: {Math.round(node.reusabilityScore.crossProjectScore * 100)}%</span>
                <span>Recency: {Math.round(node.reusabilityScore.recency * 100)}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Distill Skill */}
        {skillCandidate && (
          <div className="knd-export">
            {/* Pre-synthesized result (from analyze-sessions) */}
            {skillCandidate.synthesizedMarkdown && !synthResult && (
              <div className="knd-synth-result">
                <div className="knd-synth-preview">{skillCandidate.synthesizedMarkdown}</div>
                <button
                  className="knd-synth-copy-btn"
                  onClick={async () => {
                    await navigator.clipboard.writeText(skillCandidate.synthesizedMarkdown!)
                    setSynthCopied(true)
                    setTimeout(() => setSynthCopied(false), 2000)
                  }}
                >
                  {synthCopied ? 'Copied!' : 'Copy Skill'}
                </button>
              </div>
            )}
            {/* On-demand re-synthesis with graph context */}
            <button
              className="knd-synth-btn"
              disabled={synthLoading}
              onClick={() => {
                resetSynth()
                synthesize({
                  skillCandidate,
                  topicNode: node,
                  enrichedSequences: enrichedSequences?.filter((seq) =>
                    seq.sessionIds.some((sid) => node.sessionIds.includes(sid))
                  ),
                  graphContext: buildGraphContext(node, edges, allTopics, communities, bridgeTopicIds),
                })
              }}
            >
              {synthLoading ? '再合成中...' : '再合成'}
            </button>
            {synthError && (
              <p className="knd-synth-error">{synthError}</p>
            )}
            {synthResult && (
              <div className="knd-synth-result">
                <div className="knd-synth-preview">{synthResult}</div>
                <button
                  className="knd-synth-copy-btn"
                  onClick={async () => {
                    await navigator.clipboard.writeText(synthResult)
                    setSynthCopied(true)
                    setTimeout(() => setSynthCopied(false), 2000)
                  }}
                >
                  {synthCopied ? 'Copied!' : 'Copy Skill'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Projects */}
        {node.projects.length > 0 && (
          <div className="knd-field">
            <span className="knd-field-label">Projects</span>
            <span className="knd-field-value">
              {node.projects.join(', ')}
            </span>
          </div>
        )}

        {/* Suggested Prompt */}
        {node.suggestedPrompt && (
          <>
            <div className="knd-divider" />
            <div className="knd-field">
              <span className="knd-field-label">Suggested Prompt</span>
              <div className="knd-suggested-prompt">{node.suggestedPrompt}</div>
            </div>
          </>
        )}

        {/* Tool Signature */}
        {node.toolSignature && node.toolSignature.length > 0 && (
          <div className="knd-field">
            <span className="knd-field-label">Tool Signature</span>
            <div className="knd-tool-signature">
              {node.toolSignature.map((t) => (
                <span key={t.tool} className="knd-tool-tag">
                  {t.tool.replace(/^mcp__plugin_[^_]+_[^_]+__/, '')}
                  <span className="knd-tool-weight">{t.weight.toFixed(1)}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Representative Prompts */}
        {node.representativePrompts && node.representativePrompts.length > 0 && (
          <>
            <div className="knd-divider" />
            <div className="knd-field">
              <span className="knd-field-label">Representative Prompts</span>
              <ul className="knd-prompt-list">
                {node.representativePrompts.map((p, i) => (
                  <li key={i} className="knd-prompt-item">{p}</li>
                ))}
              </ul>
            </div>
          </>
        )}

        {/* Centrality */}
        <div className="knd-divider" />
        <div className="knd-centrality">
          <span className="knd-field-label">Graph Position</span>
          <div className="knd-centrality-values">
            <span>
              Betweenness: <strong>{node.betweennessCentrality.toFixed(3)}</strong>
            </span>
            <span>
              Degree: <strong>{node.degreeCentrality.toFixed(3)}</strong>
            </span>
          </div>
          <p className="knd-centrality-hint">
            {centralityInterpretation(
              node.betweennessCentrality,
              node.degreeCentrality
            )}
          </p>
        </div>

        {/* Connected topics */}
        <div className="knd-divider" />
        <div className="knd-edges-section">
          <span className="knd-field-label">Connected Topics</span>
          {edgesByType.size === 0 ? (
            <p className="knd-no-edges">接続なし</p>
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
                <p className="knd-edge-type-desc">{EDGE_TYPE_DESCRIPTIONS[type]}</p>
                <ul className="knd-edge-list">
                  {connections.map((conn) => (
                    <li key={conn.topicId} className="knd-edge-item">
                      <span className="knd-edge-topic-label">
                        {conn.topicLabel}
                      </span>
                      <span className="knd-edge-label">{conn.label}</span>
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

        {/* Session list */}
        <div className="knd-divider" />
        <div className="knd-sessions-section">
          <span className="knd-field-label">
            Sessions ({node.sessionIds.length})
          </span>
          <ul className="knd-session-list">
            {node.sessionIds.map((sid) => (
              <li key={sid} className="knd-session-item">
                <button
                  className="knd-session-link"
                  onClick={() => onSessionSelect(sid)}
                >
                  {sid.slice(0, 8)}...
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
