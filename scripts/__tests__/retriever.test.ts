import { describe, it, expect } from "vitest";
import {
  createRetriever,
  createRetrieverFromIndex,
} from "../knowledge-graph/retriever.js";
import type { EmbeddingBackend, ChunkMeta } from "../knowledge-graph/embedder.js";

/**
 * Deterministic backend over a small controlled vocabulary. Each known phrase
 * maps to a fixed one-hot-ish unit vector so cosine similarity is predictable.
 */
function conceptBackend(): EmbeddingBackend {
  const dim = 4;
  const concepts: Record<string, Float32Array> = {
    auth: Float32Array.from([1, 0, 0, 0]),
    database: Float32Array.from([0, 1, 0, 0]),
    css: Float32Array.from([0, 0, 1, 0]),
    deploy: Float32Array.from([0, 0, 0, 1]),
  };
  function vecFor(text: string): Float32Array {
    const out = new Float32Array(dim);
    const t = text.toLowerCase();
    for (const [key, v] of Object.entries(concepts)) {
      if (t.includes(key)) for (let i = 0; i < dim; i++) out[i] += v[i];
    }
    let n = 0;
    for (const x of out) n += x * x;
    n = Math.sqrt(n);
    if (n > 0) for (let i = 0; i < dim; i++) out[i] /= n;
    return out;
  }
  return {
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map(vecFor);
    },
  };
}

async function buildRetriever(texts: { sessionId: string; text: string }[]) {
  const backend = conceptBackend();
  const chunks: ChunkMeta[] = texts.map((t, i) => ({
    sessionId: t.sessionId,
    turnIndex: i,
    role: "user-turn" as const,
    snippet: t.text,
  }));
  const denseVectors = await backend.embed(texts.map((t) => t.text));
  return createRetriever({
    chunks,
    texts: texts.map((t) => t.text),
    denseVectors,
    backend,
  });
}

describe("createRetriever ranking", () => {
  it("puts the semantically-matching chunk first", async () => {
    const retriever = await buildRetriever([
      { sessionId: "s1", text: "set up css styling for the page" },
      { sessionId: "s2", text: "fix the auth login flow" },
      { sessionId: "s3", text: "deploy to production" },
    ]);
    const results = await retriever.retrieve("debug the auth token", 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].sessionId).toBe("s2");
  });

  it("returns at most k results", async () => {
    const retriever = await buildRetriever([
      { sessionId: "s1", text: "auth one" },
      { sessionId: "s2", text: "auth two" },
      { sessionId: "s3", text: "auth three" },
    ]);
    const results = await retriever.retrieve("auth", 2);
    expect(results).toHaveLength(2);
  });

  it("returns empty for empty corpus or k<=0", async () => {
    const empty = await buildRetriever([]);
    expect(await empty.retrieve("auth", 5)).toEqual([]);
    const r = await buildRetriever([{ sessionId: "s1", text: "auth" }]);
    expect(await r.retrieve("auth", 0)).toEqual([]);
  });
});

describe("per-session diversification cap", () => {
  it("caps the number of chunks returned from a single session", async () => {
    // 5 near-identical 'auth' chunks all from one session; cap should limit them.
    const retriever = await buildRetriever([
      { sessionId: "s1", text: "auth flow part one" },
      { sessionId: "s1", text: "auth flow part two" },
      { sessionId: "s1", text: "auth flow part three" },
      { sessionId: "s2", text: "auth in another session" },
      { sessionId: "s3", text: "auth elsewhere" },
    ]);
    const results = await retriever.retrieve("auth", 5, { perSessionCap: 2 });
    const fromS1 = results.filter((r) => r.sessionId === "s1").length;
    expect(fromS1).toBeLessThanOrEqual(2);
    // Other sessions should appear thanks to diversification.
    const sessions = new Set(results.map((r) => r.sessionId));
    expect(sessions.size).toBeGreaterThan(1);
  });
});

describe("hybrid normalization", () => {
  it("alpha=1 uses dense only; alpha=0 uses sparse only", async () => {
    // BM25 only admits terms with df>=2, so the lexical signal ("token")
    // appears in exactly two docs (s2, s3) — discriminating against s1/s4.
    // s2 and s3 are the same length and both contain "token" once, so the
    // dense concept ("auth") is what breaks the tie and ranks s2 above s3.
    const texts = [
      { sessionId: "s1", text: "database migration schema plan" },
      { sessionId: "s2", text: "auth session token handler" },
      { sessionId: "s3", text: "css layout token grid" },
      { sessionId: "s4", text: "deploy pipeline release plan" },
    ];
    const retriever = await buildRetriever(texts);

    // Dense-only query for "database": dense concept match wins (only s1 has it).
    const dense = await retriever.retrieve("database tuning", 4, { alpha: 1 });
    expect(dense[0].sessionId).toBe("s1");

    // Sparse-only: only s2 and s3 contain "token"; they should rank above
    // the docs that don't (s1, s4).
    const sparse = await retriever.retrieve("token", 4, { alpha: 0 });
    const topTwo = new Set([sparse[0].sessionId, sparse[1].sessionId]);
    expect(topTwo).toEqual(new Set(["s2", "s3"]));
  });

  it("scores are finite and ordered descending", async () => {
    const retriever = await buildRetriever([
      { sessionId: "s1", text: "auth login" },
      { sessionId: "s2", text: "css layout" },
      { sessionId: "s3", text: "deploy pipeline" },
    ]);
    const results = await retriever.retrieve("auth", 3);
    for (const r of results) expect(Number.isFinite(r.score)).toBe(true);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

describe("createRetrieverFromIndex length guards", () => {
  const backend = conceptBackend();
  const chunks: ChunkMeta[] = [
    { sessionId: "s1", turnIndex: 0, role: "user-turn", snippet: "auth" },
    { sessionId: "s2", turnIndex: 1, role: "user-turn", snippet: "css" },
  ];
  const dim = 4;

  it("throws when chunkTexts is not parallel to chunks", () => {
    expect(() =>
      createRetrieverFromIndex({
        chunks,
        matrix: new Int8Array(chunks.length * dim),
        dim,
        chunkTexts: ["only one text"], // length 1 != chunks length 2
        backend,
      }),
    ).toThrow(/chunkTexts length/);
  });

  it("throws when the matrix length does not equal chunks * dim", () => {
    expect(() =>
      createRetrieverFromIndex({
        chunks,
        matrix: new Int8Array(chunks.length * dim - 1), // one short
        dim,
        chunkTexts: chunks.map((c) => c.snippet),
        backend,
      }),
    ).toThrow(/matrix length/);
  });

  it("builds successfully when lengths line up", () => {
    const r = createRetrieverFromIndex({
      chunks,
      matrix: new Int8Array(chunks.length * dim),
      dim,
      chunkTexts: chunks.map((c) => c.snippet),
      backend,
    });
    expect(r.size).toBe(chunks.length);
  });
});
