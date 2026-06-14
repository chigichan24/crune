import { describe, it, expect } from "vitest";
import {
  normalizeFeedbackBlob,
  mergeFeedbackBlob,
  selectFlaggedTurns,
  renderTurnSnippet,
  computeSessionFeedbackCounts,
  REUSABLE_TAG,
  ANTI_PATTERN_TAG,
  type FeedbackEntry,
} from "../feedback-reader.js";
import type { SessionInput } from "../knowledge-graph/types.js";

function entry(partial: Partial<FeedbackEntry>): FeedbackEntry {
  return {
    sessionId: "s1",
    turnId: 0,
    bookmarked: false,
    tags: [],
    note: "",
    ...partial,
  };
}

describe("normalizeFeedbackBlob", () => {
  it("returns {} for non-object input", () => {
    expect(normalizeFeedbackBlob(null)).toEqual({});
    expect(normalizeFeedbackBlob([])).toEqual({});
    expect(normalizeFeedbackBlob("nope")).toEqual({});
  });

  it("drops empty entries and empty session buckets", () => {
    const blob = normalizeFeedbackBlob({
      s1: [entry({ turnId: 1, bookmarked: true }), entry({ turnId: 2 })],
      s2: [entry({ turnId: 0 })],
    });
    expect(blob.s1).toHaveLength(1);
    expect(blob.s1[0].turnId).toBe(1);
    expect(blob.s2).toBeUndefined();
  });

  it("coerces malformed entries (missing tags/note) and skips invalid shapes", () => {
    const blob = normalizeFeedbackBlob({
      s1: [
        { sessionId: "s1", turnId: 3, bookmarked: true },
        { sessionId: "s1" }, // missing turnId — dropped
        { turnId: 5 }, // missing sessionId — dropped
      ],
    });
    expect(blob.s1).toHaveLength(1);
    expect(blob.s1[0]).toMatchObject({ turnId: 3, tags: [], note: "" });
  });
});

describe("mergeFeedbackBlob", () => {
  it("adds a session's entries without touching others", () => {
    const current = { s1: [entry({ turnId: 0, bookmarked: true })] };
    const next = mergeFeedbackBlob(current, "s2", [entry({ sessionId: "s2", turnId: 1, note: "x" })]);
    expect(next.s1).toHaveLength(1);
    expect(next.s2).toHaveLength(1);
    // input is not mutated
    expect(current).not.toHaveProperty("s2");
  });

  it("clears a bucket when posted entries are all empty", () => {
    const current = { s1: [entry({ turnId: 0, bookmarked: true })] };
    const next = mergeFeedbackBlob(current, "s1", [entry({ turnId: 0 })]);
    expect(next.s1).toBeUndefined();
  });

  it("forces the sessionId onto merged entries", () => {
    const next = mergeFeedbackBlob({}, "s9", [entry({ sessionId: "wrong", turnId: 2, bookmarked: true })]);
    expect(next.s9[0].sessionId).toBe("s9");
  });
});

describe("selectFlaggedTurns", () => {
  const feedback = new Map<string, FeedbackEntry[]>([
    [
      "s1",
      [
        entry({ turnId: 0, bookmarked: true }),
        entry({ turnId: 1, tags: [REUSABLE_TAG] }),
        entry({ turnId: 2, tags: [ANTI_PATTERN_TAG] }),
        entry({ turnId: 3, note: "just a note" }), // not flagged
      ],
    ],
    ["s2", [entry({ sessionId: "s2", turnId: 0, bookmarked: true })]],
  ]);

  it("selects bookmarked or meaningfully-tagged turns only, for the given sessions", () => {
    const flagged = selectFlaggedTurns(feedback, ["s1"]);
    expect(flagged.map((f) => f.turnId)).toEqual([0, 1, 2]);
  });

  it("classifies reusable / anti-pattern flags", () => {
    const flagged = selectFlaggedTurns(feedback, ["s1"]);
    expect(flagged.find((f) => f.turnId === 1)?.reusable).toBe(true);
    expect(flagged.find((f) => f.turnId === 2)?.antiPattern).toBe(true);
    expect(flagged.find((f) => f.turnId === 0)?.reusable).toBe(false);
  });

  it("is case-insensitive for tag matching", () => {
    const fb = new Map([["s1", [entry({ turnId: 0, tags: ["Reusable"] })]]]);
    expect(selectFlaggedTurns(fb, ["s1"])[0].reusable).toBe(true);
  });

  it("ignores sessions not present in the feedback map", () => {
    expect(selectFlaggedTurns(feedback, ["unknown"])).toEqual([]);
  });
});

describe("renderTurnSnippet", () => {
  const sessions = new Map<string, SessionInput>([
    [
      "s1",
      {
        sessionId: "s1",
        projectDisplayName: "p",
        turns: [
          { userPrompt: "  fix the   bug  ", assistantTexts: ["I will fix it.", "second"], toolCalls: [] },
          { userPrompt: "", assistantTexts: [], toolCalls: [] },
        ],
        subagents: {},
        meta: {
          sessionId: "s1",
          createdAt: "",
          lastActiveAt: "",
          durationMinutes: 0,
          filesEdited: [],
          gitBranch: "",
          toolBreakdown: {},
          subagentCount: 0,
        },
      },
    ],
  ]);

  it("renders userPrompt + first assistantText, whitespace-collapsed", () => {
    expect(renderTurnSnippet(sessions, "s1", 0)).toBe("User: fix the bug / Claude: I will fix it.");
  });

  it("truncates long text to maxLen with an ellipsis", () => {
    const snippet = renderTurnSnippet(sessions, "s1", 0, 10);
    expect(snippet).not.toBeNull();
    // "User: " + 9 chars + "…"
    expect(snippet).toContain("…");
  });

  it("returns null for an all-empty turn", () => {
    expect(renderTurnSnippet(sessions, "s1", 1)).toBeNull();
  });

  it("returns null for unknown session/turn", () => {
    expect(renderTurnSnippet(sessions, "s1", 99)).toBeNull();
    expect(renderTurnSnippet(sessions, "ghost", 0)).toBeNull();
  });
});

describe("computeSessionFeedbackCounts", () => {
  it("aggregates bookmark / reusable / anti-pattern counts per session", () => {
    const feedback = new Map<string, FeedbackEntry[]>([
      [
        "s1",
        [
          entry({ turnId: 0, bookmarked: true, tags: [REUSABLE_TAG] }),
          entry({ turnId: 1, tags: [REUSABLE_TAG] }),
          entry({ turnId: 2, tags: [ANTI_PATTERN_TAG] }),
        ],
      ],
      ["s2", [entry({ sessionId: "s2", turnId: 0, note: "only a note" })]], // no signal
    ]);
    const counts = computeSessionFeedbackCounts(feedback);
    expect(counts.get("s1")).toEqual({ bookmarked: true, reusableCount: 2, antiPatternCount: 1 });
    expect(counts.has("s2")).toBe(false);
  });

  it("counts a turn flagged on multiple blocks once (no block-level inflation)", () => {
    const feedback = new Map<string, FeedbackEntry[]>([
      [
        "s1",
        [
          entry({ turnId: 5, blockId: "a", tags: [REUSABLE_TAG] }),
          entry({ turnId: 5, blockId: "b", tags: [REUSABLE_TAG] }),
          entry({ turnId: 5, blockId: "c", tags: [REUSABLE_TAG] }),
        ],
      ],
    ]);
    expect(computeSessionFeedbackCounts(feedback).get("s1")).toEqual({
      bookmarked: false,
      reusableCount: 1,
      antiPatternCount: 0,
    });
  });
});

describe("selectFlaggedTurns block-level collapse", () => {
  it("collapses multiple block entries on one turn into a single FlaggedTurn", () => {
    const feedback = new Map<string, FeedbackEntry[]>([
      [
        "s1",
        [
          entry({ turnId: 3, blockId: "a", bookmarked: true }),
          entry({ turnId: 3, blockId: "b", tags: [REUSABLE_TAG], note: "good" }),
          entry({ turnId: 3, blockId: "c", tags: [ANTI_PATTERN_TAG] }),
        ],
      ],
    ]);
    const flagged = selectFlaggedTurns(feedback, ["s1"]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({
      turnId: 3,
      reusable: true,
      antiPattern: true,
      note: "good",
    });
    expect(flagged[0].tags).toEqual([REUSABLE_TAG, ANTI_PATTERN_TAG]);
  });
});
