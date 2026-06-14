import { useMemo, useState } from 'react'
import type { SessionOverviewData } from '../../types'
import {
  EMPTY_CRITERIA,
  ROLE_LABELS,
  collectFilterOptions,
  filterTopics,
  sortByReusability,
  isEmptyCriteria,
  type TopicFilterCriteria,
} from './skillExplorerFilter'
import { ExplorerSkillCard } from './ExplorerSkillCard'
import { AdHocSynthesisPanel } from './AdHocSynthesisPanel'
import './SkillExplorerView.css'

interface Props {
  overview: SessionOverviewData | null
  loading: boolean
  error: string | null
  onSessionSelect: (sessionId: string) => void
}

/** Keys of TopicFilterCriteria whose value is an array (the multi-select axes). */
type ArrayKeys<T> = { [K in keyof T]: T[K] extends unknown[] ? K : never }[keyof T]

const SINCE_OPTIONS: { label: string; days: number | null }[] = [
  { label: '全期間', days: null },
  { label: '直近30日', days: 30 },
  { label: '直近90日', days: 90 },
]

function ChipGroup<T extends string | number>({
  label,
  options,
  selected,
  render,
  onToggle,
}: {
  label: string
  options: T[]
  selected: T[]
  render?: (v: T) => string
  onToggle: (v: T) => void
}) {
  if (options.length === 0) return null
  return (
    <div className="fse-filter-group">
      <span className="fse-filter-label">{label}</span>
      <div className="fse-filter-chips">
        {options.map((o) => (
          <button
            key={String(o)}
            className={`fse-chip${selected.includes(o) ? ' fse-chip--on' : ''}`}
            onClick={() => onToggle(o)}
          >
            {render ? render(o) : String(o)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function SkillExplorerView({ overview, loading, error, onSessionSelect }: Props) {
  const [criteria, setCriteria] = useState<TopicFilterCriteria>(EMPTY_CRITERIA)

  const graph = overview?.knowledgeGraph
  const nodes = useMemo(() => graph?.nodes ?? [], [graph])
  const candidates = useMemo(() => overview?.tacitKnowledge?.skillCandidates ?? [], [overview])

  const options = useMemo(() => collectFilterOptions(nodes), [nodes])

  const candidateByTopic = useMemo(
    () => new Map(candidates.map((c) => [c.topicId, c])),
    [candidates],
  )
  const evalScores = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of candidates) {
      if (c.evaluation?.overallScore !== undefined) m.set(c.topicId, c.evaluation.overallScore)
    }
    return m
  }, [candidates])

  const filtered = useMemo(
    () => sortByReusability(filterTopics(nodes, criteria, evalScores)),
    [nodes, criteria, evalScores],
  )

  const toggle = <K extends ArrayKeys<TopicFilterCriteria>>(
    key: K,
    value: TopicFilterCriteria[K][number],
  ) => {
    setCriteria((c) => {
      // Cast: TS can't narrow a generic union of array-valued props to one
      // element type, but ArrayKeys already guarantees `key` is an array axis.
      const arr = c[key] as TopicFilterCriteria[K][number][]
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
      return { ...c, [key]: next }
    })
  }

  if (loading) return <div className="fse-state">読み込み中…</div>
  if (error) return <div className="fse-state fse-state--error">{error}</div>
  if (!graph) return <div className="fse-state">データがありません</div>

  return (
    <div className="fse-root">
      <aside className="fse-filters">
        <div className="fse-filters-head">
          <h2 className="fse-filters-title">フィルタ</h2>
          {!isEmptyCriteria(criteria) && (
            <button className="fse-reset" onClick={() => setCriteria(EMPTY_CRITERIA)}>
              リセット
            </button>
          )}
        </div>

        <div className="fse-filter-group">
          <span className="fse-filter-label">キーワード</span>
          <input
            className="fse-search"
            type="search"
            placeholder="ラベル・キーワード"
            value={criteria.keyword}
            onChange={(e) => setCriteria((c) => ({ ...c, keyword: e.target.value }))}
          />
        </div>

        <ChipGroup label="プロジェクト" options={options.projects} selected={criteria.projects} onToggle={(v) => toggle('projects', v)} />
        <ChipGroup label="目標カテゴリ" options={options.categories} selected={criteria.categories} onToggle={(v) => toggle('categories', v)} />
        <ChipGroup label="役割" options={options.roles} selected={criteria.roles} render={(r) => ROLE_LABELS[r]} onToggle={(v) => toggle('roles', v)} />
        <ChipGroup label="コミュニティ" options={options.communities} selected={criteria.communities} render={(c) => `#${c}`} onToggle={(v) => toggle('communities', v)} />

        <div className="fse-filter-group">
          <span className="fse-filter-label">再利用性スコア ≥ {Math.round(criteria.minReusability * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(criteria.minReusability * 100)}
            onChange={(e) => setCriteria((c) => ({ ...c, minReusability: Number(e.target.value) / 100 }))}
          />
        </div>

        <div className="fse-filter-group">
          <span className="fse-filter-label">評価スコア ≥ {criteria.minEvalScore}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={criteria.minEvalScore}
            onChange={(e) => setCriteria((c) => ({ ...c, minEvalScore: Number(e.target.value) }))}
          />
        </div>

        <div className="fse-filter-group">
          <span className="fse-filter-label">期間</span>
          <div className="fse-filter-chips">
            {SINCE_OPTIONS.map((o) => (
              <button
                key={o.label}
                className={`fse-chip${o.days === criteria.sinceDays ? ' fse-chip--on' : ''}`}
                onClick={() => setCriteria((c) => ({ ...c, sinceDays: o.days }))}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="fse-results">
        <div className="fse-results-head">
          <span className="fse-results-count">
            {filtered.length} / {nodes.length} トピック
          </span>
        </div>
        <AdHocSynthesisPanel
          topics={filtered}
          enrichedSequences={overview?.tacitKnowledge?.enrichedToolSequences ?? []}
        />
        {filtered.length === 0 ? (
          <div className="fse-state">条件に一致するトピックがありません</div>
        ) : (
          <div className="fse-grid">
            {filtered.map((topic) => (
              <ExplorerSkillCard
                key={topic.id}
                topic={topic}
                candidate={candidateByTopic.get(topic.id)}
                enrichedSequences={overview?.tacitKnowledge?.enrichedToolSequences ?? []}
                allTopics={nodes}
                edges={graph.edges}
                communities={graph.communities}
                bridgeTopicIds={graph.metrics?.bridgeTopicIds ?? []}
                onSessionSelect={onSessionSelect}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
