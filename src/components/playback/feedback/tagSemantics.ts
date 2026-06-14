/**
 * Shared semantics for the two meaningful feedback tags. Tags are free-text,
 * but these two carry a defined meaning that the synthesis pipeline acts on:
 *
 *   - `reusable`     → this turn is VALUABLE evidence to replicate in a skill.
 *   - `anti-pattern` → this turn is a counter-example; skills should avoid it.
 *
 * Keep these constants in sync with `scripts/feedback-reader.ts`
 * (REUSABLE_TAG / ANTI_PATTERN_TAG), which the pipeline reads independently of
 * the frontend build.
 */

export const REUSABLE_TAG = 'reusable'
export const ANTI_PATTERN_TAG = 'anti-pattern'

/** The meaningful tags, surfaced as suggestions in the tag editor. */
export const SEMANTIC_TAGS = [REUSABLE_TAG, ANTI_PATTERN_TAG] as const

export type SemanticTag = (typeof SEMANTIC_TAGS)[number]

/** Human-readable hint (Japanese UI) for each semantic tag. */
export const SEMANTIC_TAG_HINTS: Record<SemanticTag, string> = {
  [REUSABLE_TAG]: 'スキル合成で再現したい良い手順',
  [ANTI_PATTERN_TAG]: 'スキル合成で避けるべき反面教師',
}

/** True when `tag` is one of the meaningful tags (case-insensitive). */
export function isSemanticTag(tag: string): tag is SemanticTag {
  const lower = tag.toLowerCase()
  return SEMANTIC_TAGS.some(t => t === lower)
}
