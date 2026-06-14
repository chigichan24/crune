import { describe, it, expect } from 'vitest'
import type { TopicNode } from '../../../types'
import {
  collectFilterOptions,
  filterTopics,
  sortByReusability,
  isEmptyCriteria,
  EMPTY_CRITERIA,
  type TopicFilterCriteria,
} from '../skillExplorerFilter'

function node(over: Partial<TopicNode> & { id: string }): TopicNode {
  return {
    id: over.id,
    label: over.label ?? over.id,
    keywords: over.keywords ?? [],
    project: over.project ?? (over.projects?.[0] ?? 'p1'),
    projects: over.projects ?? ['p1'],
    sessionIds: over.sessionIds ?? ['s1'],
    sessionCount: 1,
    totalDurationMinutes: 0,
    totalToolCalls: 0,
    firstSeen: over.firstSeen ?? '2026-01-01T00:00:00Z',
    lastSeen: over.lastSeen ?? '2026-01-01T00:00:00Z',
    betweennessCentrality: 0,
    degreeCentrality: 0,
    communityId: over.communityId ?? 0,
    representativePrompts: [],
    suggestedPrompt: '',
    toolSignature: [],
    dominantRole: over.dominantRole ?? 'user-driven',
    reusabilityScore: {
      overall: over.reusabilityScore?.overall ?? 0.5,
      frequency: 0,
      timeCost: 0,
      crossProjectScore: 0,
      recency: 0,
    },
    facetsSummary: over.facetsSummary,
  }
}

const criteria = (over: Partial<TopicFilterCriteria> = {}): TopicFilterCriteria => ({
  ...EMPTY_CRITERIA,
  ...over,
})

describe('collectFilterOptions', () => {
  it('dedupes and sorts options across topics', () => {
    const opts = collectFilterOptions([
      node({ id: 't1', projects: ['b', 'a'], communityId: 2, dominantRole: 'tool-heavy', facetsSummary: { categories: ['feature'], goals: [], successRate: 1, helpfulness: 1 } }),
      node({ id: 't2', projects: ['a'], communityId: 1, dominantRole: 'user-driven', facetsSummary: { categories: ['bugfix', 'feature'], goals: [], successRate: 1, helpfulness: 1 } }),
    ])
    expect(opts.projects).toEqual(['a', 'b'])
    expect(opts.categories).toEqual(['bugfix', 'feature'])
    expect(opts.communities).toEqual([1, 2])
    expect(opts.roles).toEqual(['tool-heavy', 'user-driven'])
  })
})

describe('filterTopics', () => {
  const nodes = [
    node({ id: 't1', projects: ['crune'], communityId: 0, dominantRole: 'user-driven', keywords: ['embedding', 'retriever'], lastSeen: '2026-06-01T00:00:00Z', reusabilityScore: { overall: 0.8 } as TopicNode['reusabilityScore'], facetsSummary: { categories: ['feature'], goals: [], successRate: 1, helpfulness: 1 } }),
    node({ id: 't2', projects: ['hatoko'], communityId: 1, dominantRole: 'tool-heavy', keywords: ['auth'], lastSeen: '2026-01-15T00:00:00Z', reusabilityScore: { overall: 0.3 } as TopicNode['reusabilityScore'], facetsSummary: { categories: ['bugfix'], goals: [], successRate: 1, helpfulness: 1 } }),
  ]

  it('returns all topics for empty criteria', () => {
    expect(filterTopics(nodes, EMPTY_CRITERIA).map((n) => n.id)).toEqual(['t1', 't2'])
  })

  it('filters by project (OR)', () => {
    expect(filterTopics(nodes, criteria({ projects: ['hatoko'] })).map((n) => n.id)).toEqual(['t2'])
  })

  it('filters by facets category', () => {
    expect(filterTopics(nodes, criteria({ categories: ['feature'] })).map((n) => n.id)).toEqual(['t1'])
  })

  it('filters by community and role', () => {
    expect(filterTopics(nodes, criteria({ communities: [1] })).map((n) => n.id)).toEqual(['t2'])
    expect(filterTopics(nodes, criteria({ roles: ['user-driven'] })).map((n) => n.id)).toEqual(['t1'])
  })

  it('filters by keyword over label + keywords (case-insensitive)', () => {
    expect(filterTopics(nodes, criteria({ keyword: 'RETRIEVER' })).map((n) => n.id)).toEqual(['t1'])
  })

  it('filters by min reusability', () => {
    expect(filterTopics(nodes, criteria({ minReusability: 0.5 })).map((n) => n.id)).toEqual(['t1'])
  })

  it('filters by sinceDays window (relative to injected now)', () => {
    const now = new Date('2026-06-10T00:00:00Z')
    // t1 lastSeen 2026-06-01 (9 days ago), t2 2026-01-15 (months ago)
    expect(filterTopics(nodes, criteria({ sinceDays: 30 }), undefined, now).map((n) => n.id)).toEqual(['t1'])
    expect(filterTopics(nodes, criteria({ sinceDays: 365 }), undefined, now).map((n) => n.id)).toEqual(['t1', 't2'])
  })

  it('treats the sinceDays boundary as inclusive', () => {
    const n = [node({ id: 't', lastSeen: '2026-06-01T00:00:00Z' })]
    const now = new Date('2026-06-08T00:00:00Z') // exactly 7 days after lastSeen
    expect(filterTopics(n, criteria({ sinceDays: 7 }), undefined, now).map((x) => x.id)).toEqual(['t'])
    expect(filterTopics(n, criteria({ sinceDays: 6 }), undefined, now)).toEqual([])
  })

  it('filters by min eval score, excluding topics without a score', () => {
    const evalScores = new Map([['t1', 90]]) // t2 has no eval
    expect(filterTopics(nodes, criteria({ minEvalScore: 80 }), evalScores).map((n) => n.id)).toEqual(['t1'])
    expect(filterTopics(nodes, criteria({ minEvalScore: 90 }), evalScores).map((n) => n.id)).toEqual(['t1']) // equality passes
    expect(filterTopics(nodes, criteria({ minEvalScore: 95 }), evalScores)).toEqual([])
  })

  it('drops every topic for minEvalScore > 0 when no score map is supplied', () => {
    expect(filterTopics(nodes, criteria({ minEvalScore: 1 }))).toEqual([])
  })

  it('combines axes with AND', () => {
    expect(
      filterTopics(nodes, criteria({ projects: ['crune'], categories: ['bugfix'] })),
    ).toEqual([])
  })
})

describe('sortByReusability', () => {
  it('orders topics by reusability descending without mutating the input', () => {
    const input = [
      node({ id: 'lo', reusabilityScore: { overall: 0.2 } as TopicNode['reusabilityScore'] }),
      node({ id: 'hi', reusabilityScore: { overall: 0.9 } as TopicNode['reusabilityScore'] }),
    ]
    expect(sortByReusability(input).map((n) => n.id)).toEqual(['hi', 'lo'])
    expect(input.map((n) => n.id)).toEqual(['lo', 'hi']) // input untouched
  })
})

describe('isEmptyCriteria', () => {
  it('is true for the default and false once any axis is set', () => {
    expect(isEmptyCriteria(EMPTY_CRITERIA)).toBe(true)
    expect(isEmptyCriteria(criteria({ minReusability: 0.1 }))).toBe(false)
    expect(isEmptyCriteria(criteria({ projects: ['x'] }))).toBe(false)
  })
})
