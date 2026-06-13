import { describe, it, expect, beforeEach } from 'vitest'
import {
  FEEDBACK_STORAGE_KEY,
  addTag,
  collectAllTags,
  entryKey,
  getEntry,
  loadSessionFeedback,
  removeEntry,
  removeTag,
  setNote,
  toggleBookmark,
  upsertEntry,
} from '../feedback/feedbackStore'
import type { FeedbackEntry } from '../../../types'

/** Minimal in-memory Storage fake (no jsdom). */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    key: (i: number) => [...map.keys()][i] ?? null,
  }
}

describe('entryKey', () => {
  it('uses just the turnId for turn-level feedback', () => {
    expect(entryKey(3)).toBe('3')
  })

  it('combines turnId and blockId for block-level feedback', () => {
    expect(entryKey(3, 'tool-abc')).toBe('3:tool-abc')
  })
})

describe('feedbackStore', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createMemoryStorage()
  })

  it('returns an empty list for an unknown session', () => {
    expect(loadSessionFeedback('s1', storage)).toEqual([])
  })

  it('upserts a new turn-level entry', () => {
    upsertEntry('s1', 2, undefined, { note: 'hi' }, storage)
    const entry = getEntry('s1', 2, undefined, storage)
    expect(entry).toMatchObject({ sessionId: 's1', turnId: 2, note: 'hi', bookmarked: false, tags: [] })
    expect(entry?.blockId).toBeUndefined()
  })

  it('upserts a block-level entry distinct from the turn-level one', () => {
    upsertEntry('s1', 2, undefined, { note: 'turn' }, storage)
    upsertEntry('s1', 2, 'blk', { note: 'block' }, storage)
    expect(getEntry('s1', 2, undefined, storage)?.note).toBe('turn')
    expect(getEntry('s1', 2, 'blk', storage)?.note).toBe('block')
    expect(loadSessionFeedback('s1', storage)).toHaveLength(2)
  })

  it('merges fields on subsequent upserts of the same key', () => {
    upsertEntry('s1', 1, undefined, { note: 'first' }, storage)
    upsertEntry('s1', 1, undefined, { bookmarked: true }, storage)
    const entry = getEntry('s1', 1, undefined, storage)
    expect(entry).toMatchObject({ note: 'first', bookmarked: true })
  })

  it('toggles a bookmark on and off', () => {
    expect(toggleBookmark('s1', 1, undefined, storage)).toBe(true)
    expect(getEntry('s1', 1, undefined, storage)?.bookmarked).toBe(true)
    expect(toggleBookmark('s1', 1, undefined, storage)).toBe(false)
    expect(getEntry('s1', 1, undefined, storage)?.bookmarked).toBe(false)
  })

  it('adds tags and dedupes them', () => {
    addTag('s1', 1, undefined, 'bug', storage)
    addTag('s1', 1, undefined, 'bug', storage)
    addTag('s1', 1, undefined, 'refactor', storage)
    expect(getEntry('s1', 1, undefined, storage)?.tags).toEqual(['bug', 'refactor'])
  })

  it('ignores empty/whitespace tags', () => {
    addTag('s1', 1, undefined, '   ', storage)
    expect(getEntry('s1', 1, undefined, storage)).toBeNull()
  })

  it('removes a tag', () => {
    addTag('s1', 1, undefined, 'bug', storage)
    addTag('s1', 1, undefined, 'refactor', storage)
    removeTag('s1', 1, undefined, 'bug', storage)
    expect(getEntry('s1', 1, undefined, storage)?.tags).toEqual(['refactor'])
  })

  it('sets a note', () => {
    setNote('s1', 1, undefined, 'remember this', storage)
    expect(getEntry('s1', 1, undefined, storage)?.note).toBe('remember this')
  })

  it('removes an entry', () => {
    upsertEntry('s1', 1, undefined, { note: 'x' }, storage)
    removeEntry('s1', 1, undefined, storage)
    expect(getEntry('s1', 1, undefined, storage)).toBeNull()
    expect(loadSessionFeedback('s1', storage)).toEqual([])
  })

  it('collects all distinct tags across all sessions, sorted', () => {
    addTag('s1', 1, undefined, 'zebra', storage)
    addTag('s1', 2, undefined, 'apple', storage)
    addTag('s2', 1, 'blk', 'apple', storage)
    addTag('s2', 1, 'blk', 'mango', storage)
    expect(collectAllTags(storage)).toEqual(['apple', 'mango', 'zebra'])
  })

  it('isolates feedback per session', () => {
    upsertEntry('s1', 1, undefined, { note: 'one' }, storage)
    upsertEntry('s2', 1, undefined, { note: 'two' }, storage)
    expect(loadSessionFeedback('s1', storage)).toHaveLength(1)
    expect(loadSessionFeedback('s2', storage)).toHaveLength(1)
    expect(getEntry('s2', 1, undefined, storage)?.note).toBe('two')
  })

  it('recovers from malformed JSON in storage', () => {
    storage.setItem(FEEDBACK_STORAGE_KEY, '{not valid json')
    expect(loadSessionFeedback('s1', storage)).toEqual([])
    // and can still write afterwards
    upsertEntry('s1', 1, undefined, { note: 'ok' }, storage)
    expect(getEntry('s1', 1, undefined, storage)?.note).toBe('ok')
  })

  it('recovers when stored blob is not an object', () => {
    storage.setItem(FEEDBACK_STORAGE_KEY, '42')
    expect(loadSessionFeedback('s1', storage)).toEqual([])
  })

  it('persists across independent reads (serialized in storage)', () => {
    upsertEntry('s1', 5, 'blk', { note: 'persisted', tags: ['x'] } as Partial<FeedbackEntry>, storage)
    const raw = storage.getItem(FEEDBACK_STORAGE_KEY)
    expect(raw).toBeTruthy()
    const reread = loadSessionFeedback('s1', storage)
    expect(reread).toHaveLength(1)
    expect(reread[0]).toMatchObject({ turnId: 5, blockId: 'blk', note: 'persisted', tags: ['x'] })
  })
})
