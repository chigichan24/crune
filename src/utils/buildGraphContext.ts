import type {
  TopicNode,
  TopicEdge,
  KnowledgeCommunity,
  GraphContext,
} from '../types'

const MAX_CONNECTED_TOPICS = 10

export function buildGraphContext(
  node: TopicNode,
  edges: TopicEdge[],
  allTopics: TopicNode[],
  communities?: KnowledgeCommunity[],
  bridgeTopicIds?: string[],
): GraphContext {
  const topicMap = new Map(allTopics.map((t) => [t.id, t]))

  const connectedTopics = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const isOutgoing = e.source === node.id
      const connectedId = isOutgoing ? e.target : e.source
      const connected = topicMap.get(connectedId)
      return {
        id: connectedId,
        label: connected?.label ?? connectedId,
        keywords: connected?.keywords ?? [],
        edgeType: e.type,
        strength: e.strength,
        direction: isOutgoing ? 'outgoing' as const : 'incoming' as const,
      }
    })
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_CONNECTED_TOPICS)

  const community = communities?.find((c) => c.id === node.communityId)

  return {
    connectedTopics,
    community: community
      ? { label: community.label, memberCount: community.topicIds.length }
      : undefined,
    isBridgeTopic: bridgeTopicIds?.includes(node.id) ?? false,
  }
}
