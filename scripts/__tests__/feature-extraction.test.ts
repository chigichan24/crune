import { describe, it, expect } from "vitest";
import { buildToolIdf, buildStructuralVectors } from "../knowledge-graph-builder.js";
import { editHeavySession, readHeavySession, subagentSession, emptySession, allSessions } from "./fixtures.js";

describe("buildToolIdf", () => {
  it("gives tool in 1 of 3 sessions higher IDF than tool in all 3", () => {
    // Use editHeavy, readHeavy, subagent sessions
    const sessions = [editHeavySession, readHeavySession, subagentSession];
    const result = buildToolIdf(sessions);

    // "Edit" appears in editHeavy (10) and readHeavy (1) => df=2
    // "Bash" appears in subagent only => df=1
    // "Glob" appears in readHeavy only => df=1
    // "Read" appears in editHeavy (1) and readHeavy (15) => df=2
    // All tools appear, but tools in fewer sessions get higher IDF
    // IDF = log(n/df): log(3/1) > log(3/2)

    const idfBash = result.toolIdfWeights.get("Bash")!; // df=1
    const idfEdit = result.toolIdfWeights.get("Edit")!; // df=2

    expect(idfBash).toBeGreaterThan(idfEdit);
  });

  it("produces L2-normalized vectors", () => {
    const sessions = [editHeavySession, readHeavySession, subagentSession];
    const result = buildToolIdf(sessions);

    for (const [, vec] of result.vectors) {
      let dotProduct = 0;
      for (let i = 0; i < vec.length; i++) {
        dotProduct += vec[i] * vec[i];
      }
      if (dotProduct > 0) {
        expect(dotProduct).toBeCloseTo(1.0, 10);
      }
    }
  });
});

describe("buildStructuralVectors", () => {
  it("returns zero vector for session with 0 turns", () => {
    const vectors = buildStructuralVectors([emptySession]);
    const vec = vectors.get("empty")!;
    expect(vec.length).toBe(7);
    for (let i = 0; i < vec.length; i++) {
      expect(vec[i]).toBe(0);
    }
  });

  it("edit-heavy session has editHeaviness > readHeaviness", () => {
    const vectors = buildStructuralVectors(allSessions);
    const vec = vectors.get("edit-heavy")!;
    // vec[5] = editHeaviness, vec[6] = readHeaviness (before normalization ratios preserved)
    expect(vec[5]).toBeGreaterThan(vec[6]);
  });

  it("read-heavy session has readHeaviness > editHeaviness", () => {
    const vectors = buildStructuralVectors(allSessions);
    const vec = vectors.get("read-heavy")!;
    // vec[6] = readHeaviness, vec[5] = editHeaviness
    expect(vec[6]).toBeGreaterThan(vec[5]);
  });

  it("produces L2-normalized vectors for non-empty sessions", () => {
    const vectors = buildStructuralVectors(allSessions);

    for (const [sessionId, vec] of vectors) {
      if (sessionId === "empty") continue; // zero vector, skip
      let dotProduct = 0;
      for (let i = 0; i < vec.length; i++) {
        dotProduct += vec[i] * vec[i];
      }
      expect(dotProduct).toBeCloseTo(1.0, 10);
    }
  });
});
