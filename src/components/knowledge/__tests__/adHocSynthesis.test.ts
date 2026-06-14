import { describe, it, expect } from 'vitest'
import type { TopicNode, EnrichedToolSequence } from '../../../types'
import { buildAdHocSynthesisRequest, ADHOC_TOPIC_ID } from '../adHocSynthesis'

function node(over: Partial<TopicNode> & { id: string }): TopicNode {
  return {
    id: over.id,
    label: over.label ?? over.id,
    keywords: over.keywords ?? [],
    project: over.project ?? (over.projects?.[0] ?? 'p1'),
    projects: over.projects ?? ['p1'],
    sessionIds: over.sessionIds ?? ['s1'],
    sessionCount: over.sessionIds?.length ?? 1,
    totalDurationMinutes: over.totalDurationMinutes ?? 10,
    totalToolCalls: over.totalToolCalls ?? 5,
    firstSeen: over.firstSeen ?? '2026-01-01T00:00:00Z',
    lastSeen: over.lastSeen ?? '2026-01-01T00:00:00Z',
    betweennessCentrality: 0,
    degreeCentrality: 0,
    communityId: over.communityId ?? 0,
    representativePrompts: over.representativePrompts ?? [],
    suggestedPrompt: '',
    toolSignature: over.toolSignature ?? [],
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

describe('buildAdHocSynthesisRequest', () => {
  it('returns null for an empty selection', () => {
    expect(buildAdHocSynthesisRequest([], [])).toBeNull()
  })

  it('builds a synthetic union topic + candidate', () => {
    const topics = [
      node({ id: 't1', projects: ['a'], sessionIds: ['s1', 's2'], keywords: ['embed', 'rag'], dominantRole: 'tool-heavy', reusabilityScore: { overall: 0.8 } as TopicNode['reusabilityScore'], toolSignature: [{ tool: 'Bash', weight: 2 }] }),
      node({ id: 't2', projects: ['b'], sessionIds: ['s2', 's3'], keywords: ['rag'], dominantRole: 'tool-heavy', reusabilityScore: { overall: 0.4 } as TopicNode['reusabilityScore'], toolSignature: [{ tool: 'Bash', weight: 1 }, { tool: 'Edit', weight: 1 }] }),
    ]
    const req = buildAdHocSynthesisRequest(topics, [])!
    expect(req.topicNode.id).toBe(ADHOC_TOPIC_ID)
    expect(req.skillCandidate.topicId).toBe(ADHOC_TOPIC_ID)
    // union of sessions, deduped
    expect([...req.topicNode.sessionIds].sort()).toEqual(['s1', 's2', 's3'])
    expect(req.topicNode.sessionCount).toBe(3)
    // union of projects
    expect([...req.topicNode.projects].sort()).toEqual(['a', 'b'])
    // 'rag' is most frequent keyword
    expect(req.topicNode.keywords[0]).toBe('rag')
    // mode role
    expect(req.topicNode.dominantRole).toBe('tool-heavy')
    // averaged reusability
    expect(req.topicNode.reusabilityScore.overall).toBeCloseTo(0.6)
    expect(req.skillCandidate.reusabilityScore).toBeCloseTo(0.6)
    // merged tool signature (Bash summed to 3)
    expect(req.topicNode.toolSignature[0]).toEqual({ tool: 'Bash', weight: 3 })
    // heuristic skill markdown references the slice
    expect(req.skillCandidate.skillMarkdown).toContain('2 topics')
  })

  it('works for a single topic (the builder allows it; the panel gates ≥2)', () => {
    const req = buildAdHocSynthesisRequest([node({ id: 't1', sessionIds: ['s1', 's2'] })], [])!
    expect(req.topicNode.sessionCount).toBe(2)
    expect(req.skillCandidate.skillMarkdown).toContain('1 topics')
  })

  it('falls back to a placeholder label when there are no keywords', () => {
    const req = buildAdHocSynthesisRequest([node({ id: 't1', keywords: [] })], [])!
    expect(req.topicNode.label).toBe('スライス (1 topics)')
  })

  it('filters enriched sequences by partial session overlap, dropping empty ones', () => {
    const topics = [node({ id: 't1', sessionIds: ['s1'] })]
    const seqs: EnrichedToolSequence[] = [
      { sequence: [], count: 1, sessionIds: ['s1', 's9'], projects: [] }, // partial overlap → kept
      { sequence: [], count: 1, sessionIds: ['s9'], projects: [] }, // no overlap → dropped
      { sequence: [], count: 1, sessionIds: [], projects: [] }, // empty → dropped
    ]
    const req = buildAdHocSynthesisRequest(topics, seqs)!
    expect(req.enrichedSequences).toHaveLength(1)
    expect(req.enrichedSequences![0].sessionIds).toEqual(['s1', 's9'])
  })

  it('merges facets when present, omits when none have them', () => {
    const withFacets = [
      node({ id: 't1', facetsSummary: { categories: ['feature'], goals: ['ship'], successRate: 1, helpfulness: 0.8 } }),
      node({ id: 't2', facetsSummary: { categories: ['bugfix'], goals: [], successRate: 0.5, helpfulness: 0.4 } }),
    ]
    const merged = buildAdHocSynthesisRequest(withFacets, [])!.topicNode.facetsSummary!
    expect([...merged.categories].sort()).toEqual(['bugfix', 'feature'])
    expect(merged.successRate).toBeCloseTo(0.75)

    const noFacets = [node({ id: 't3' })]
    expect(buildAdHocSynthesisRequest(noFacets, [])!.topicNode.facetsSummary).toBeUndefined()
  })
})
