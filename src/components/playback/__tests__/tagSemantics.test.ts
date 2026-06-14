import { describe, it, expect } from 'vitest'
import {
  REUSABLE_TAG,
  ANTI_PATTERN_TAG,
  SEMANTIC_TAGS,
  SEMANTIC_TAG_HINTS,
  isSemanticTag,
} from '../feedback/tagSemantics'

describe('tagSemantics', () => {
  it('exposes the two meaningful tags', () => {
    expect(REUSABLE_TAG).toBe('reusable')
    expect(ANTI_PATTERN_TAG).toBe('anti-pattern')
    expect(SEMANTIC_TAGS).toEqual([REUSABLE_TAG, ANTI_PATTERN_TAG])
  })

  it('provides a hint for every semantic tag', () => {
    for (const tag of SEMANTIC_TAGS) {
      expect(SEMANTIC_TAG_HINTS[tag]).toBeTruthy()
    }
  })

  describe('isSemanticTag', () => {
    it('classifies the meaningful tags (case-insensitive)', () => {
      expect(isSemanticTag('reusable')).toBe(true)
      expect(isSemanticTag('Reusable')).toBe(true)
      expect(isSemanticTag('ANTI-PATTERN')).toBe(true)
    })

    it('rejects free-text tags', () => {
      expect(isSemanticTag('important')).toBe(false)
      expect(isSemanticTag('')).toBe(false)
      expect(isSemanticTag('reusable ')).toBe(false)
    })
  })
})
