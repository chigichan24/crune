import { useState, useCallback } from 'react'
import type {
  TopicNode,
  TopicEdge,
  KnowledgeCommunity,
  SkillCandidate,
  EnrichedToolSequence,
} from '../../types'
import { useSkillSynthesis } from '../../hooks/useSkillSynthesis'
import { buildGraphContext } from '../../utils/buildGraphContext'
import { SkillEvaluationBadge } from './SkillEvaluationBadge'
import { SkillCopyButton } from './SkillCopyButton'
import { ROLE_LABELS } from './skillExplorerFilter'
import './ExplorerSkillCard.css'

interface Props {
  topic: TopicNode
  candidate?: SkillCandidate
  enrichedSequences: EnrichedToolSequence[]
  allTopics: TopicNode[]
  edges: TopicEdge[]
  communities: KnowledgeCommunity[]
  bridgeTopicIds: string[]
  onSessionSelect: (sessionId: string) => void
}

export function ExplorerSkillCard({
  topic,
  candidate,
  enrichedSequences,
  allTopics,
  edges,
  communities,
  bridgeTopicIds,
  onSessionSelect,
}: Props) {
  const { synthesize, loading, result, error, reset } = useSkillSynthesis(topic.id)
  const [expanded, setExpanded] = useState(false)

  const score = Math.round((topic.reusabilityScore?.overall ?? 0) * 100)
  const markdown = result ?? candidate?.synthesizedMarkdown ?? null

  const onSynthesize = useCallback(() => {
    if (!candidate) return
    reset()
    const relatedSequences = enrichedSequences.filter((seq) =>
      seq.sessionIds.some((sid) => topic.sessionIds.includes(sid)),
    )
    const topicEdges = edges.filter((e) => e.source === topic.id || e.target === topic.id)
    synthesize({
      skillCandidate: candidate,
      topicNode: topic,
      enrichedSequences: relatedSequences,
      graphContext: buildGraphContext(topic, topicEdges, allTopics, communities, bridgeTopicIds),
    })
  }, [candidate, enrichedSequences, edges, topic, allTopics, communities, bridgeTopicIds, synthesize, reset])

  return (
    <article className="fse-card">
      <header className="fse-card-head">
        <h3 className="fse-card-title">{topic.label}</h3>
        <span className="fse-card-score" title="Reusability score">
          {score}%
        </span>
      </header>

      <div className="fse-card-meta">
        <span className="fse-card-role">{ROLE_LABELS[topic.dominantRole]}</span>
        <span className="fse-card-sessions">{topic.sessionCount} sessions</span>
        {topic.projects.slice(0, 2).map((p) => (
          <span key={p} className="fse-card-project">{p}</span>
        ))}
      </div>

      {topic.facetsSummary && topic.facetsSummary.categories.length > 0 && (
        <div className="fse-card-tags">
          {topic.facetsSummary.categories.map((c) => (
            <span key={c} className="fse-card-tag">{c}</span>
          ))}
        </div>
      )}

      {candidate?.evaluation && (
        <SkillEvaluationBadge evaluation={candidate.evaluation} prefix="fse" />
      )}

      {markdown ? (
        <div className="fse-card-skill">
          <button
            className="fse-card-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? '▼ 合成Skillを隠す' : '▶ 合成Skillを表示'}
          </button>
          {expanded && (
            <div className="fse-card-md">
              <pre className="fse-card-md-pre">{markdown}</pre>
              <SkillCopyButton text={markdown} className="fse-card-copy" />
            </div>
          )}
        </div>
      ) : (
        <p className="fse-card-nosynth">未合成（再合成で生成）</p>
      )}

      <div className="fse-card-actions">
        {candidate && (
          <button className="fse-card-synth" disabled={loading} onClick={onSynthesize}>
            {loading ? '合成中...' : markdown ? '再合成' : '合成'}
          </button>
        )}
      </div>
      {error && <p className="fse-card-error">{error}</p>}

      {topic.sessionIds.length > 0 && (
        <details className="fse-card-related">
          <summary>関連セッション ({topic.sessionIds.length})</summary>
          <ul className="fse-card-session-list">
            {topic.sessionIds.slice(0, 8).map((sid) => (
              <li key={sid}>
                <button className="fse-card-session" onClick={() => onSessionSelect(sid)}>
                  {sid.slice(0, 8)}…
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}
