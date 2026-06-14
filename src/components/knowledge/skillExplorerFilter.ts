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
  since: string | null // ISO date; topic.lastSeen >= this (null = no constraint)
}

export const EMPTY_CRITERIA: TopicFilterCriteria = {
  projects: [],
  categories: [],
  communities: [],
  roles: [],
  keyword: '',
  minReusability: 0,
  minEvalScore: 0,
  since: null,
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

function someOverlap<T>(selected: T[], values: T[]): boolean {
  if (selected.length === 0) return true // no constraint
  return values.some((v) => selected.includes(v))
}

/**
 * Filter topics by the criteria. `evalScores` maps topicId → evaluation
 * overallScore (absent when a topic has no synthesized+evaluated candidate);
 * a topic is dropped by `minEvalScore > 0` when it has no score.
 */
export function filterTopics(
  nodes: TopicNode[],
  criteria: TopicFilterCriteria,
  evalScores?: Map<string, number>,
): TopicNode[] {
  const keyword = criteria.keyword.trim().toLowerCase()
  return nodes.filter((n) => {
    if (!someOverlap(criteria.projects, n.projects ?? [])) return false
    if (!someOverlap(criteria.categories, n.facetsSummary?.categories ?? [])) return false
    if (criteria.communities.length > 0 && !criteria.communities.includes(n.communityId)) return false
    if (!someOverlap(criteria.roles, n.dominantRole ? [n.dominantRole] : [])) return false
    if ((n.reusabilityScore?.overall ?? 0) < criteria.minReusability) return false
    if (criteria.since && (n.lastSeen ?? '') < criteria.since) return false
    if (keyword) {
      const hay = `${n.label ?? ''} ${(n.keywords ?? []).join(' ')}`.toLowerCase()
      if (!hay.includes(keyword)) return false
    }
    if (criteria.minEvalScore > 0) {
      const score = evalScores?.get(n.id)
      if (score === undefined || score < criteria.minEvalScore) return false
    }
    return true
  })
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
    c.since === null
  )
}
