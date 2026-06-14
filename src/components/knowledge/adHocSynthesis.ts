import type {
  TopicNode,
  SkillCandidate,
  EnrichedToolSequence,
  SynthesisRequest,
  ReusabilityScore,
  TopicFacetsSummary,
} from '../../types'

export const ADHOC_TOPIC_ID = 'adhoc-slice'

function topByFrequency(values: string[], limit: number): string[] {
  const count = new Map<string, number>()
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([v]) => v)
}

function mergeFacets(topics: TopicNode[]): TopicFacetsSummary | undefined {
  const withFacets = topics.filter((t) => t.facetsSummary)
  if (withFacets.length === 0) return undefined
  const categories = [...new Set(withFacets.flatMap((t) => t.facetsSummary!.categories))]
  const goals = [...new Set(withFacets.flatMap((t) => t.facetsSummary!.goals))].slice(0, 3)
  const avg = (sel: (f: TopicFacetsSummary) => number) =>
    withFacets.reduce((s, t) => s + sel(t.facetsSummary!), 0) / withFacets.length
  return { categories, goals, successRate: avg((f) => f.successRate), helpfulness: avg((f) => f.helpfulness) }
}

/**
 * Build a synthesis request for the *union* of a filtered topic set (issue #73):
 * a synthetic TopicNode + SkillCandidate that lets `claude -p` distill one skill
 * spanning the whole slice. Returns null for an empty selection.
 */
export function buildAdHocSynthesisRequest(
  topics: TopicNode[],
  enrichedSequences: EnrichedToolSequence[],
): SynthesisRequest | null {
  if (topics.length === 0) return null

  const sessionIds = [...new Set(topics.flatMap((t) => t.sessionIds))]
  const keywords = topByFrequency(topics.flatMap((t) => t.keywords), 8)
  const projects = [...new Set(topics.flatMap((t) => t.projects))]

  const toolWeight = new Map<string, number>()
  for (const t of topics) for (const ts of t.toolSignature) toolWeight.set(ts.tool, (toolWeight.get(ts.tool) ?? 0) + ts.weight)
  const toolSignature = [...toolWeight.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tool, weight]) => ({ tool, weight }))

  const dominantRole = (topByFrequency(topics.map((t) => t.dominantRole), 1)[0] ??
    'user-driven') as TopicNode['dominantRole']

  const avg = (sel: (s: ReusabilityScore) => number) =>
    topics.reduce((sum, t) => sum + sel(t.reusabilityScore), 0) / topics.length
  const reusabilityScore: ReusabilityScore = {
    overall: avg((s) => s.overall),
    frequency: avg((s) => s.frequency),
    timeCost: avg((s) => s.timeCost),
    crossProjectScore: avg((s) => s.crossProjectScore),
    recency: avg((s) => s.recency),
  }

  const label = `${keywords.slice(0, 3).join(' / ') || 'スライス'} (${topics.length} topics)`
  const firstSeen = [...topics.map((t) => t.firstSeen)].sort()[0]
  const lastSeen = [...topics.map((t) => t.lastSeen)].sort().slice(-1)[0]

  const topicNode: TopicNode = {
    id: ADHOC_TOPIC_ID,
    label,
    keywords,
    project: projects[0] ?? '',
    projects,
    sessionIds,
    sessionCount: sessionIds.length,
    totalDurationMinutes: topics.reduce((s, t) => s + t.totalDurationMinutes, 0),
    totalToolCalls: topics.reduce((s, t) => s + t.totalToolCalls, 0),
    firstSeen,
    lastSeen,
    betweennessCentrality: 0,
    degreeCentrality: 0,
    communityId: -1,
    representativePrompts: topics.flatMap((t) => t.representativePrompts).slice(0, 3),
    suggestedPrompt: '',
    toolSignature,
    dominantRole,
    reusabilityScore,
    facetsSummary: mergeFacets(topics),
  }

  const skillMarkdown = [
    `# ${label}`,
    '',
    `Merged from ${topics.length} topics across ${projects.length} project(s).`,
    `Keywords: ${keywords.join(', ')}`,
    `Tools: ${toolSignature.map((t) => t.tool).join(', ')}`,
  ].join('\n')

  const skillCandidate: SkillCandidate = {
    topicId: ADHOC_TOPIC_ID,
    reusabilityScore: reusabilityScore.overall,
    skillMarkdown,
  }

  const sessionSet = new Set(sessionIds)
  const related = enrichedSequences.filter((seq) => seq.sessionIds.some((sid) => sessionSet.has(sid)))

  return { skillCandidate, topicNode, enrichedSequences: related }
}
