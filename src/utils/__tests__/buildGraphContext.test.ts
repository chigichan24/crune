import { describe, it, expect } from 'vitest'
import { buildGraphContext } from '../buildGraphContext'
import type { TopicNode, TopicEdge, KnowledgeCommunity } from '../../types'

function makeTopic(overrides: Partial<TopicNode> = {}): TopicNode {
  return {
    id: 'topic-001',
    label: 'Test Topic',
    keywords: ['test', 'topic'],
    project: 'proj/a',
    projects: ['proj/a'],
    sessionIds: ['s1'],
    sessionCount: 1,
    totalDurationMinutes: 10,
    totalToolCalls: 5,
    firstSeen: '2025-01-01',
    lastSeen: '2025-01-02',
    betweennessCentrality: 0,
    degreeCentrality: 0,
    communityId: 0,
    representativePrompts: [],
    suggestedPrompt: '',
    toolSignature: [],
    dominantRole: 'user-driven',
    reusabilityScore: { overall: 0.5, frequency: 0.5, timeCost: 0.5, crossProjectScore: 0, recency: 0.5 },
    ...overrides,
  }
}

function makeEdge(overrides: Partial<TopicEdge> = {}): TopicEdge {
  return {
    source: 'topic-001',
    target: 'topic-002',
    type: 'semantic-similarity',
    strength: 0.7,
    label: 'test edge',
    signals: { semanticSimilarity: 0.7, fileOverlap: 0, sessionOverlap: 0 },
    ...overrides,
  }
}

const topicA = makeTopic({ id: 'topic-001', label: 'Topic A', keywords: ['a', 'first'] })
const topicB = makeTopic({ id: 'topic-002', label: 'Topic B', keywords: ['b', 'second'] })
const topicC = makeTopic({ id: 'topic-003', label: 'Topic C', keywords: ['c', 'third'], communityId: 1 })
const allTopics = [topicA, topicB, topicC]

describe('buildGraphContext', () => {
  it('returns empty connectedTopics when no edges', () => {
    const ctx = buildGraphContext(topicA, [], allTopics)
    expect(ctx.connectedTopics).toEqual([])
    expect(ctx.isBridgeTopic).toBe(false)
    expect(ctx.community).toBeUndefined()
  })

  it('determines outgoing direction when source matches node', () => {
    const edge = makeEdge({ source: 'topic-001', target: 'topic-002', type: 'workflow-continuation' })
    const ctx = buildGraphContext(topicA, [edge], allTopics)
    expect(ctx.connectedTopics).toHaveLength(1)
    expect(ctx.connectedTopics[0].direction).toBe('outgoing')
    expect(ctx.connectedTopics[0].label).toBe('Topic B')
    expect(ctx.connectedTopics[0].edgeType).toBe('workflow-continuation')
  })

  it('determines incoming direction when target matches node', () => {
    const edge = makeEdge({ source: 'topic-002', target: 'topic-001', type: 'workflow-continuation' })
    const ctx = buildGraphContext(topicA, [edge], allTopics)
    expect(ctx.connectedTopics).toHaveLength(1)
    expect(ctx.connectedTopics[0].direction).toBe('incoming')
    expect(ctx.connectedTopics[0].label).toBe('Topic B')
  })

  it('resolves community when communities provided', () => {
    const communities: KnowledgeCommunity[] = [
      { id: 0, topicIds: ['topic-001', 'topic-002'], label: 'Frontend Dev', dominantProject: 'proj/a' },
      { id: 1, topicIds: ['topic-003'], label: 'Backend', dominantProject: 'proj/b' },
    ]
    const ctx = buildGraphContext(topicA, [], allTopics, communities)
    expect(ctx.community).toEqual({ label: 'Frontend Dev', memberCount: 2 })
  })

  it('identifies bridge topic when in bridgeTopicIds', () => {
    const ctx = buildGraphContext(topicA, [], allTopics, undefined, ['topic-001', 'topic-003'])
    expect(ctx.isBridgeTopic).toBe(true)
  })

  it('does not identify non-bridge topic', () => {
    const ctx = buildGraphContext(topicA, [], allTopics, undefined, ['topic-003'])
    expect(ctx.isBridgeTopic).toBe(false)
  })

  it('limits connectedTopics to top 10 by strength', () => {
    const edges = Array.from({ length: 15 }, (_, i) => {
      const targetTopic = makeTopic({ id: `topic-${i + 10}`, label: `Topic ${i + 10}`, keywords: [`kw${i}`] })
      allTopics.push(targetTopic)
      return makeEdge({ source: 'topic-001', target: `topic-${i + 10}`, strength: (15 - i) / 15 })
    })
    const ctx = buildGraphContext(topicA, edges, allTopics)
    expect(ctx.connectedTopics).toHaveLength(10)
    expect(ctx.connectedTopics[0].strength).toBeGreaterThanOrEqual(ctx.connectedTopics[9].strength)
  })

  it('filters edges not connected to the node', () => {
    const unrelatedEdge = makeEdge({ source: 'topic-002', target: 'topic-003' })
    const relatedEdge = makeEdge({ source: 'topic-001', target: 'topic-002' })
    const ctx = buildGraphContext(topicA, [unrelatedEdge, relatedEdge], allTopics)
    expect(ctx.connectedTopics).toHaveLength(1)
    expect(ctx.connectedTopics[0].label).toBe('Topic B')
  })
})
