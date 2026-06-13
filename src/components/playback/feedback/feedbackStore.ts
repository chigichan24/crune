/**
 * Pure, framework-free store for playback feedback (bookmarks / tags / notes).
 *
 * Backed by a single localStorage blob under `crune.feedback.v1`, shaped
 * `Record<sessionId, FeedbackEntry[]>`. The backing `Storage` is injectable so
 * the logic can be unit-tested with an in-memory fake (no jsdom). Malformed
 * JSON is recovered from gracefully (treated as empty).
 *
 * Entry identity within a session:
 *   - turn-level:  `${turnId}`
 *   - block-level: `${turnId}:b:${blockId}`
 *
 * The `:b:` marker keeps block-level keys distinct from the turn-level key even
 * when `blockId` is an empty string, so a tool_use block with a missing id can
 * never collide with (and overwrite) its turn-level feedback.
 */
import type { FeedbackEntry } from '../../../types'

export const FEEDBACK_STORAGE_KEY = 'crune.feedback.v1'

type FeedbackBlob = Record<string, FeedbackEntry[]>

function defaultStorage(): Storage | null {
  return typeof window !== 'undefined' ? window.localStorage : null
}

/** Compute the within-session identity key for an entry. */
export function entryKey(turnId: number, blockId?: string): string {
  return blockId != null ? `${turnId}:b:${blockId}` : `${turnId}`
}

function entryKeyOf(entry: FeedbackEntry): string {
  return entryKey(entry.turnId, entry.blockId)
}

function readBlob(storage: Storage | null): FeedbackBlob {
  if (!storage) return {}
  const raw = storage.getItem(FEEDBACK_STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as FeedbackBlob
    }
    return {}
  } catch {
    return {}
  }
}

function writeBlob(storage: Storage | null, blob: FeedbackBlob): void {
  if (!storage) return
  storage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(blob))
}

/** All feedback entries for a session (empty if none / unknown session). */
export function loadSessionFeedback(
  sessionId: string,
  storage: Storage | null = defaultStorage(),
): FeedbackEntry[] {
  const blob = readBlob(storage)
  return blob[sessionId] ?? []
}

/** A single entry by identity, or null if not present. */
export function getEntry(
  sessionId: string,
  turnId: number,
  blockId: string | undefined,
  storage: Storage | null = defaultStorage(),
): FeedbackEntry | null {
  const key = entryKey(turnId, blockId)
  const entries = loadSessionFeedback(sessionId, storage)
  return entries.find(e => entryKeyOf(e) === key) ?? null
}

/**
 * Create or merge-update an entry. Missing fields default to a blank entry,
 * and `patch` fields override. Returns the resulting entry.
 */
export function upsertEntry(
  sessionId: string,
  turnId: number,
  blockId: string | undefined,
  patch: Partial<FeedbackEntry>,
  storage: Storage | null = defaultStorage(),
): FeedbackEntry {
  const blob = readBlob(storage)
  const entries = blob[sessionId] ? [...blob[sessionId]] : []
  const key = entryKey(turnId, blockId)
  const idx = entries.findIndex(e => entryKeyOf(e) === key)

  const base: FeedbackEntry =
    idx >= 0
      ? entries[idx]
      : {
          sessionId,
          turnId,
          ...(blockId != null ? { blockId } : {}),
          bookmarked: false,
          tags: [],
          note: '',
        }

  const next: FeedbackEntry = {
    ...base,
    ...patch,
    // identity fields are authoritative
    sessionId,
    turnId,
  }
  if (blockId != null) {
    next.blockId = blockId
  } else {
    delete next.blockId
  }

  if (idx >= 0) {
    entries[idx] = next
  } else {
    entries.push(next)
  }
  blob[sessionId] = entries
  writeBlob(storage, blob)
  return next
}

/** Delete an entry entirely. */
export function removeEntry(
  sessionId: string,
  turnId: number,
  blockId: string | undefined,
  storage: Storage | null = defaultStorage(),
): void {
  const blob = readBlob(storage)
  const entries = blob[sessionId]
  if (!entries) return
  const key = entryKey(turnId, blockId)
  const next = entries.filter(e => entryKeyOf(e) !== key)
  if (next.length === 0) {
    delete blob[sessionId]
  } else {
    blob[sessionId] = next
  }
  writeBlob(storage, blob)
}

/** Flip the bookmark flag. Returns the new bookmarked state. */
export function toggleBookmark(
  sessionId: string,
  turnId: number,
  blockId: string | undefined,
  storage: Storage | null = defaultStorage(),
): boolean {
  const current = getEntry(sessionId, turnId, blockId, storage)
  const next = !(current?.bookmarked ?? false)
  upsertEntry(sessionId, turnId, blockId, { bookmarked: next }, storage)
  return next
}

/** Add a tag (trimmed, deduped). No-op for empty/whitespace tags. */
export function addTag(
  sessionId: string,
  turnId: number,
  blockId: string | undefined,
  tag: string,
  storage: Storage | null = defaultStorage(),
): void {
  const clean = tag.trim()
  if (!clean) return
  const current = getEntry(sessionId, turnId, blockId, storage)
  const tags = current?.tags ?? []
  if (tags.includes(clean)) return
  upsertEntry(sessionId, turnId, blockId, { tags: [...tags, clean] }, storage)
}

/** Remove a tag if present. */
export function removeTag(
  sessionId: string,
  turnId: number,
  blockId: string | undefined,
  tag: string,
  storage: Storage | null = defaultStorage(),
): void {
  const current = getEntry(sessionId, turnId, blockId, storage)
  if (!current) return
  const tags = current.tags.filter(t => t !== tag)
  upsertEntry(sessionId, turnId, blockId, { tags }, storage)
}

/** Set the freeform note. */
export function setNote(
  sessionId: string,
  turnId: number,
  blockId: string | undefined,
  note: string,
  storage: Storage | null = defaultStorage(),
): void {
  upsertEntry(sessionId, turnId, blockId, { note }, storage)
}

/** Distinct tags across all sessions, sorted ascending. */
export function collectAllTags(
  storage: Storage | null = defaultStorage(),
): string[] {
  const blob = readBlob(storage)
  const tags = new Set<string>()
  for (const entries of Object.values(blob)) {
    for (const entry of entries) {
      for (const tag of entry.tags ?? []) tags.add(tag)
    }
  }
  return [...tags].sort()
}
