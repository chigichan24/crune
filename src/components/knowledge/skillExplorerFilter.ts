import type { TopicNode } from '../../types'

export type DominantRole = TopicNode['dominantRole']

/**
 * Filter criteria for the skill explorer (issue #73). Empty array / empty string
 * / zero threshold means "no constraint on that axis", so the default criteria
 * match every topic.
 */
export interface TopicFilterCriteria {
  projects: string[] // OR within; matches a topic when any of its projects is selected
  categories: string[] // facets goal categories; OR
  communities: number[] // Louvain community ids; OR
  roles: DominantRole[] // dominantRole; OR
  keyword: string // case-insensitive substring over label + keywords
  minReusability: number // 0–1, topic.reusabilityScore.overall >= this
  minEvalScore: number // 0–100, evaluation.overallScore >= this (0 = no constraint)
  sinceDays: number | null // keep topics active within the last N days (null = no constraint)
}

export const EMPTY_CRITERIA: TopicFilterCriteria = {
  projects: [],
  categories: [],
  communities: [],
  roles: [],
  keyword: '',
  minReusability: 0,
  minEvalScore: 0,
  sinceDays: null,
}

/** Role labels (shared by the filter sidebar and the cards). */
export const ROLE_LABELS: Record<DominantRole, string> = {
  'user-driven': 'ユーザー主導',
  'tool-heavy': 'ツール多用',
  'subagent-delegated': 'サブエージェント委譲',
}

/** Available filter options derived from the current topic set (for the UI). */
export interface FilterOptions {
  projects: string[]
  categories: string[]
  communities: number[]
  roles: DominantRole[]
}

export function collectFilterOptions(nodes: TopicNode[]): FilterOptions {
  const projects = new Set<string>()
  const categories = new Set<string>()
  const communities = new Set<number>()
  const roles = new Set<DominantRole>()
  for (const n of nodes) {
    for (const p of n.projects ?? []) projects.add(p)
    for (const c of n.facetsSummary?.categories ?? []) categories.add(c)
    if (typeof n.communityId === 'number') communities.add(n.communityId)
    if (n.dominantRole) roles.add(n.dominantRole)
  }
  return {
    projects: [...projects].sort(),
    categories: [...categories].sort(),
    communities: [...communities].sort((a, b) => a - b),
    roles: [...roles].sort(),
  }
}

/** True when nothing is selected (no constraint) or some value is selected. */
function matchesAnySelected<T>(selected: T[], values: T[]): boolean {
  if (selected.length === 0) return true // no constraint
  return values.some((v) => selected.includes(v))
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Filter topics by the criteria. `evalScores` maps topicId → evaluation
 * overallScore (absent when a topic has no synthesized+evaluated candidate);
 * a topic is dropped by `minEvalScore > 0` when it has no score. `now` is
 * injectable so the `sinceDays` window is deterministic in tests.
 */
export function filterTopics(
  nodes: TopicNode[],
  criteria: TopicFilterCriteria,
  evalScores?: Map<string, number>,
  now: Date = new Date(),
): TopicNode[] {
  const keyword = criteria.keyword.trim().toLowerCase()
  const cutoffMs =
    criteria.sinceDays !== null ? now.getTime() - criteria.sinceDays * DAY_MS : null
  return nodes.filter((n) => {
    if (!matchesAnySelected(criteria.projects, n.projects)) return false
    if (!matchesAnySelected(criteria.categories, n.facetsSummary?.categories ?? [])) return false
    if (!matchesAnySelected(criteria.communities, [n.communityId])) return false
    if (!matchesAnySelected(criteria.roles, [n.dominantRole])) return false
    if (n.reusabilityScore.overall < criteria.minReusability) return false
    if (cutoffMs !== null && Date.parse(n.lastSeen) < cutoffMs) return false
    if (keyword) {
      const hay = `${n.label} ${n.keywords.join(' ')}`.toLowerCase()
      if (!hay.includes(keyword)) return false
    }
    if (criteria.minEvalScore > 0) {
      const score = evalScores?.get(n.id)
      if (score === undefined || score < criteria.minEvalScore) return false
    }
    return true
  })
}

/** Sort topics by reusability (descending) — the explorer's default ranking. */
export function sortByReusability(nodes: TopicNode[]): TopicNode[] {
  return [...nodes].sort((a, b) => b.reusabilityScore.overall - a.reusabilityScore.overall)
}

/** True when the criteria impose no constraint (all topics pass). */
export function isEmptyCriteria(c: TopicFilterCriteria): boolean {
  return (
    c.projects.length === 0 &&
    c.categories.length === 0 &&
    c.communities.length === 0 &&
    c.roles.length === 0 &&
    c.keyword.trim() === '' &&
    c.minReusability === 0 &&
    c.minEvalScore === 0 &&
    c.sinceDays === null
  )
}
