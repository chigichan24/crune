import { useState, useCallback } from 'react'
import type { KnowledgeGraphMetrics, TopicNode, TopicEdge, KnowledgeCommunity, TacitKnowledge, SkillCandidate, EnrichedToolSequence } from '../../types'
import { useSkillSynthesis } from '../../hooks/useSkillSynthesis'
import { buildGraphContext } from '../../utils/buildGraphContext'
import './TacitKnowledgeView.css'

interface Props {
  knowledge: TacitKnowledge | null
  graphMetrics?: KnowledgeGraphMetrics
  topics?: TopicNode[]
  edges?: TopicEdge[]
  communities?: KnowledgeCommunity[]
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

function DistillButton({
  candidate,
  topic,
  enrichedSequences,
  allEdges,
  allTopics,
  communities,
  bridgeTopicIds,
}: {
  candidate: SkillCandidate
  topic: TopicNode | undefined
  enrichedSequences: EnrichedToolSequence[]
  allEdges?: TopicEdge[]
  allTopics?: TopicNode[]
  communities?: KnowledgeCommunity[]
  bridgeTopicIds?: string[]
}) {
  const { synthesize, loading, result, error, reset } = useSkillSynthesis()

  if (!topic) return null

  const relatedSequences = enrichedSequences.filter((seq) =>
    seq.sessionIds.some((sid) => topic.sessionIds.includes(sid))
  )

  const topicEdges = allEdges?.filter((e) => e.source === topic.id || e.target === topic.id) ?? []
  const graphContext = allTopics
    ? buildGraphContext(topic, topicEdges, allTopics, communities, bridgeTopicIds)
    : undefined

  return (
    <>
      {/* Pre-synthesized result */}
      {candidate.synthesizedMarkdown && !result && (
        <div className="tk-synth-result">
          <div className="tk-synth-preview">{candidate.synthesizedMarkdown}</div>
          <CopyButton text={candidate.synthesizedMarkdown} label="Copy Skill" />
        </div>
      )}
      {/* Re-synthesize button */}
      <button
        className="tk-synth-btn"
        disabled={loading}
        onClick={() => {
          reset()
          synthesize({
            skillCandidate: candidate,
            topicNode: topic,
            enrichedSequences: relatedSequences,
            graphContext,
          })
        }}
      >
        {loading ? '再合成中...' : '再合成'}
      </button>
      {error && <p className="tk-synth-error">{error}</p>}
      {result && (
        <div className="tk-synth-result">
          <div className="tk-synth-preview">{result}</div>
          <CopyButton text={result} label="Copy Skill" />
        </div>
      )}
    </>
  )
}

export function TacitKnowledgeView({ knowledge, graphMetrics, topics, edges, communities }: Props) {
  if (!knowledge) {
    return (
      <div className="tacit-knowledge-view">
        <p className="tk-empty">暗黙知データがありません</p>
      </div>
    )
  }

  const workflowPatterns = knowledge.workflowPatterns ?? []
  const enrichedToolSequences = knowledge.enrichedToolSequences ?? []
  const skillCandidates = knowledge.skillCandidates ?? []

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
    skillCandidates.length > 0 ||
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
                      <DistillButton
                        candidate={candidate}
                        topic={topic}
                        enrichedSequences={enrichedToolSequences}
                        allEdges={edges}
                        allTopics={topics}
                        communities={communities}
                        bridgeTopicIds={graphMetrics?.bridgeTopicIds}
                      />
                    </div>
                  )
                })}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
