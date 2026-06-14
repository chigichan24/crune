import type { TopicNode } from '../../types'

/**
 * Stable keys for synthesis jobs in the SkillSynthesisProvider. Namespaced by
 * kind so a topic job and an ad-hoc slice job can never collide, and so the
 * key scheme lives in one place.
 */
export const topicSynthesisKey = (topicId: string): string => `topic:${topicId}`

/** Key for the union of a filtered topic set — order-independent. */
export const sliceSynthesisKey = (topics: TopicNode[]): string =>
  `adhoc:${topics.map((t) => t.id).sort().join(',')}`

/** Placeholder key when no topic is selected (never a real topic id). */
export const NO_TOPIC_KEY = 'topic:__none__'
