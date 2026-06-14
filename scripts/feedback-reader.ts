/**
 * Pipeline-side reader for human playback feedback (bookmarks / tags / notes).
 *
 * The browser writes feedback to localStorage and best-effort syncs it to the
 * skill-server, which persists it to `public/data/feedback.json` shaped
 * `Record<sessionId, FeedbackEntry[]>`. This module reads that file back into a
 * Map for the synthesis pipeline and renders SHORT turn snippets (signal, not
 * transcript) for the LLM prompt.
 *
 * `FeedbackEntry` is mirrored here (rather than imported from `src/`) so the
 * scripts/ build has no dependency on the frontend tsconfig. Keep in sync with
 * `src/types/session.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import type { SessionInput } from "./knowledge-graph/types.js";

export interface FeedbackEntry {
  sessionId: string;
  /** Numeric ConversationTurn.turnIndex; indexes into SessionInput.turns. */
  turnId: number;
  /** Tool-call block id (toolUseId) for block-level feedback; absent = turn-level. */
  blockId?: string;
  bookmarked: boolean;
  tags: string[];
  note: string;
}

export type FeedbackBlob = Record<string, FeedbackEntry[]>;

/** Meaningful tag constants — kept identical to src/.../tagSemantics. */
export const REUSABLE_TAG = "reusable";
export const ANTI_PATTERN_TAG = "anti-pattern";

/** True when an entry carries no signal (mirrors the browser store's pruning). */
function isEmptyEntry(entry: FeedbackEntry): boolean {
  return !entry.bookmarked && entry.tags.length === 0 && entry.note.trim() === "";
}

/** Coerce a raw stored value into a well-formed FeedbackEntry, or null. */
function normalizeEntry(raw: unknown): FeedbackEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.sessionId !== "string" || typeof e.turnId !== "number") return null;
  const entry: FeedbackEntry = {
    sessionId: e.sessionId,
    turnId: e.turnId,
    bookmarked: !!e.bookmarked,
    tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : [],
    note: typeof e.note === "string" ? e.note : "",
  };
  if (typeof e.blockId === "string") entry.blockId = e.blockId;
  return entry;
}

/**
 * Normalize a raw parsed blob: keep only valid, non-empty entries; drop empty
 * session buckets. Tolerant of malformed input (returns {} on the wrong shape).
 */
export function normalizeFeedbackBlob(parsed: unknown): FeedbackBlob {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const blob: FeedbackBlob = {};
  for (const [sessionId, entries] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    const normalized = entries
      .map(normalizeEntry)
      .filter((e): e is FeedbackEntry => e !== null && !isEmptyEntry(e));
    if (normalized.length > 0) blob[sessionId] = normalized;
  }
  return blob;
}

/**
 * Merge one session's posted entries into an existing blob, normalizing and
 * dropping empties. An empty (or all-empty) `entries` clears the bucket.
 * Returns a new blob (does not mutate the input).
 */
export function mergeFeedbackBlob(
  current: FeedbackBlob,
  sessionId: string,
  entries: unknown[],
): FeedbackBlob {
  const next: FeedbackBlob = { ...current };
  const normalized = entries
    .map(normalizeEntry)
    .filter((e): e is FeedbackEntry => e !== null && !isEmptyEntry(e))
    .map((e) => ({ ...e, sessionId }));
  if (normalized.length > 0) {
    next[sessionId] = normalized;
  } else {
    delete next[sessionId];
  }
  return next;
}

/**
 * Read a feedback file into a normalized blob. Returns {} when the file is
 * absent or unreadable (offline / no feedback yet — never throws). Single source
 * of the tolerant-read contract, shared by the pipeline and the skill-server.
 */
export function readFeedbackBlob(filePath: string): FeedbackBlob {
  if (!existsSync(filePath)) return {};
  try {
    return normalizeFeedbackBlob(JSON.parse(readFileSync(filePath, "utf-8")));
  } catch {
    return {};
  }
}

/**
 * Read `public/data/feedback.json` into a Map (the pipeline's preferred shape).
 * Thin wrapper over {@link readFeedbackBlob}.
 */
export function readFeedbackFile(
  filePath: string,
): Map<string, FeedbackEntry[]> {
  return new Map(Object.entries(readFeedbackBlob(filePath)));
}

// ─── Turn selection helpers ──────────────────────────────────────────────────

export interface FlaggedTurn {
  sessionId: string;
  turnId: number;
  note: string;
  tags: string[];
  /** True when tagged `reusable` — VALUABLE evidence to replicate. */
  reusable: boolean;
  /** True when tagged `anti-pattern` — counter-example to avoid. */
  antiPattern: boolean;
}

function tagSetHas(entry: FeedbackEntry, tag: string): boolean {
  const needle = tag.toLowerCase();
  return entry.tags.some((t) => t.toLowerCase() === needle);
}

/**
 * Select human-flagged turns for the given sessions. A turn qualifies when it is
 * bookmarked OR carries a meaningful tag (`reusable` / `anti-pattern`). Multiple
 * (block-level) entries on the same turn are collapsed into a single FlaggedTurn
 * — unioning tags/flags and keeping the first non-empty note — so a turn flagged
 * on several tool-call blocks is not listed (or weighted) more than once. Result
 * is ordered by sessionId then turnId.
 */
export function selectFlaggedTurns(
  feedback: Map<string, FeedbackEntry[]>,
  sessionIds: Iterable<string>,
): FlaggedTurn[] {
  const flagged: FlaggedTurn[] = [];
  for (const sessionId of sessionIds) {
    const entries = feedback.get(sessionId);
    if (!entries) continue;
    const byTurn = new Map<number, FlaggedTurn>();
    for (const entry of entries) {
      const reusable = tagSetHas(entry, REUSABLE_TAG);
      const antiPattern = tagSetHas(entry, ANTI_PATTERN_TAG);
      if (!entry.bookmarked && !reusable && !antiPattern) continue;
      const existing = byTurn.get(entry.turnId);
      if (existing) {
        existing.reusable = existing.reusable || reusable;
        existing.antiPattern = existing.antiPattern || antiPattern;
        for (const t of entry.tags) {
          if (!existing.tags.includes(t)) existing.tags.push(t);
        }
        if (!existing.note.trim() && entry.note.trim()) existing.note = entry.note;
      } else {
        byTurn.set(entry.turnId, {
          sessionId,
          turnId: entry.turnId,
          note: entry.note,
          tags: [...entry.tags],
          reusable,
          antiPattern,
        });
      }
    }
    flagged.push(...byTurn.values());
  }
  flagged.sort((a, b) =>
    a.sessionId === b.sessionId ? a.turnId - b.turnId : a.sessionId < b.sessionId ? -1 : 1,
  );
  return flagged;
}

/**
 * Render a SHORT snippet for a (sessionId, turnId) from the session's turns:
 * `userPrompt` plus the first `assistantText`, each truncated. Signal, not a
 * transcript. Returns null when the session/turn is unknown.
 */
export function renderTurnSnippet(
  sessions: Map<string, SessionInput>,
  sessionId: string,
  turnId: number,
  maxLen = 160,
): string | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  const turn = session.turns[turnId];
  if (!turn) return null;

  const parts: string[] = [];
  const prompt = truncate(turn.userPrompt?.trim() ?? "", maxLen);
  if (prompt) parts.push(`User: ${prompt}`);
  const assistant = truncate((turn.assistantTexts?.[0] ?? "").trim(), maxLen);
  if (assistant) parts.push(`Claude: ${assistant}`);
  return parts.length > 0 ? parts.join(" / ") : null;
}

function truncate(text: string, maxLen: number): string {
  const collapsed = text.replace(/\s+/g, " ");
  return collapsed.length <= maxLen ? collapsed : collapsed.slice(0, maxLen - 1) + "…";
}

// ─── Reusability signal aggregation ──────────────────────────────────────────

/** Per-session feedback counts used to derive a human reusability signal. */
export interface SessionFeedbackCounts {
  bookmarked: boolean;
  reusableCount: number;
  antiPatternCount: number;
}

/**
 * Aggregate each session's feedback into bookmark / reusable / anti-pattern
 * counts. Only sessions with at least one such signal appear in the result.
 */
export function computeSessionFeedbackCounts(
  feedback: Map<string, FeedbackEntry[]>,
): Map<string, SessionFeedbackCounts> {
  const counts = new Map<string, SessionFeedbackCounts>();
  for (const [sessionId, entries] of feedback) {
    let bookmarked = false;
    // Count distinct flagged TURNS, not entries: block-level feedback can carry
    // several entries for one turn, which must not inflate the human signal.
    const reusableTurns = new Set<number>();
    const antiPatternTurns = new Set<number>();
    for (const entry of entries) {
      if (entry.bookmarked) bookmarked = true;
      if (tagSetHas(entry, REUSABLE_TAG)) reusableTurns.add(entry.turnId);
      if (tagSetHas(entry, ANTI_PATTERN_TAG)) antiPatternTurns.add(entry.turnId);
    }
    const reusableCount = reusableTurns.size;
    const antiPatternCount = antiPatternTurns.size;
    if (bookmarked || reusableCount > 0 || antiPatternCount > 0) {
      counts.set(sessionId, { bookmarked, reusableCount, antiPatternCount });
    }
  }
  return counts;
}
