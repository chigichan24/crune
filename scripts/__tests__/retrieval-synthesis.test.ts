import { describe, it, expect } from "vitest";
import {
  buildSynthesisPrompt,
  buildRetrievalQuery,
  buildRetrievedMomentsSection,
  type SynthesisRequest,
  type RetrievedChunk,
} from "../skill-synthesizer.js";
import { createRetriever, type Retriever } from "../knowledge-graph/retriever.js";
import { retrieveContextForCandidate } from "../knowledge-graph/synthesis-retriever.js";
import type { EmbeddingBackend, ChunkMeta } from "../knowledge-graph/embedder.js";

function baseRequest(): SynthesisRequest {
  return {
    skillCandidate: {
      topicId: "t1",
      reusabilityScore: 0.5,
      skillMarkdown: "# heuristic skill\nDo the thing with Edit and Bash.",
    },
    topicNode: {
      id: "t1",
      label: "Bugfix Workflow",
      keywords: ["fix", "bug", "regression"],
      dominantRole: "user-driven",
      projects: ["p"],
      project: "p",
      sessionCount: 2,
      totalDurationMinutes: 30,
      totalToolCalls: 10,
      toolSignature: [{ tool: "Edit", weight: 0.5 }],
      representativePrompts: ["fix the login bug", "resolve the regression"],
      suggestedPrompt: "fix",
      reusabilityScore: {
        overall: 0.5,
        frequency: 0.5,
        timeCost: 0.5,
        crossProjectScore: 0,
        recency: 0.5,
      },
      betweennessCentrality: 0,
      degreeCentrality: 0,
    },
    enrichedSequences: [
      {
        sequence: [
          { toolName: "Read", category: "read" },
          { toolName: "Edit", category: "write" },
        ],
        count: 3,
        sessionIds: ["s1"],
        projects: ["p"],
      },
    ],
  };
}

const retrieved: RetrievedChunk[] = [
  { sessionId: "sess-A", turnIndex: 4, snippet: "User: reproduce the auth crash", score: 0.912 },
  { sessionId: "sess-B", turnIndex: 1, snippet: "User: add a failing test first", score: 0.734 },
];

describe("buildRetrievalQuery", () => {
  it("combines label, keywords, and truncated heuristic markdown", () => {
    const r = baseRequest();
    const query = buildRetrievalQuery(r.skillCandidate, r.topicNode);
    expect(query).toContain("Bugfix Workflow");
    expect(query).toContain("fix bug regression");
    expect(query).toContain("heuristic skill");
  });

  it("collapses whitespace and truncates very long markdown", () => {
    const longMd = "word ".repeat(500); // 2500 chars
    const query = buildRetrievalQuery(
      { skillMarkdown: longMd },
      { label: "L", keywords: ["k"] }
    );
    // 600-char markdown cap + "L k " prefix; comfortably under the raw length.
    expect(query.length).toBeLessThan(700);
    expect(query.startsWith("L k word")).toBe(true);
  });

  it("omits empty pieces without leaving stray separators", () => {
    const query = buildRetrievalQuery(
      { skillMarkdown: "" },
      { label: "Only Label", keywords: [] }
    );
    expect(query).toBe("Only Label");
  });
});

describe("buildRetrievedMomentsSection", () => {
  it("returns empty string with no chunks", () => {
    expect(buildRetrievedMomentsSection([])).toBe("");
  });

  it("renders sessionId#turnIndex, score, and snippet per chunk", () => {
    const section = buildRetrievedMomentsSection(retrieved);
    expect(section).toContain("Retrieved Relevant Moments");
    expect(section).toContain("[sess-A#4]");
    expect(section).toContain("(score: 0.912)");
    expect(section).toContain("reproduce the auth crash");
    expect(section).toContain("[sess-B#1]");
  });
});

describe("buildSynthesisPrompt retrieval gating (issue #33)", () => {
  it("omits the Retrieved Relevant Moments section when retrievedContext is absent", () => {
    const prompt = buildSynthesisPrompt(baseRequest());
    expect(prompt).not.toContain("Retrieved Relevant Moments");
    // Cluster blob is present in the fallback (A/B baseline).
    expect(prompt).toContain("Representative User Prompts");
    expect(prompt).toContain("Enriched Tool Patterns");
  });

  it("omits the section when retrievedContext is an empty array (fallback to blob)", () => {
    const prompt = buildSynthesisPrompt({ ...baseRequest(), retrievedContext: [] });
    expect(prompt).not.toContain("Retrieved Relevant Moments");
    expect(prompt).toContain("Representative User Prompts");
  });

  it("includes the section only when retrievedContext is present", () => {
    const prompt = buildSynthesisPrompt({ ...baseRequest(), retrievedContext: retrieved });
    expect(prompt).toContain("Retrieved Relevant Moments");
    expect(prompt).toContain("[sess-A#4]");
  });

  it("REPLACES the cluster-blob examples when retrieval context is present", () => {
    const prompt = buildSynthesisPrompt({ ...baseRequest(), retrievedContext: retrieved });
    // The loosely-related blob slots are suppressed in favour of retrieval.
    expect(prompt).not.toContain("Representative User Prompts");
    expect(prompt).not.toContain("Enriched Tool Patterns");
  });

  it("appends a task rule grounding the skill in retrieved moments", () => {
    const prompt = buildSynthesisPrompt({ ...baseRequest(), retrievedContext: retrieved });
    expect(prompt).toMatch(/Ground "When to Use".*Retrieved Relevant Moments/);
  });

  it("keeps the rest of the prompt structure intact (topic, tool signature, reference)", () => {
    const prompt = buildSynthesisPrompt({ ...baseRequest(), retrievedContext: retrieved });
    expect(prompt).toContain("Topic Information");
    expect(prompt).toContain("Tool Signature");
    expect(prompt).toContain("Current Heuristic-Generated Skill");
  });
});

// ─── End-to-end: query → fake retriever → prompt (no network) ────────────────

/** Deterministic backend mapping known concepts to fixed unit vectors. */
function conceptBackend(): EmbeddingBackend {
  const dim = 3;
  const concepts: Record<string, Float32Array> = {
    bug: Float32Array.from([1, 0, 0]),
    auth: Float32Array.from([0, 1, 0]),
    css: Float32Array.from([0, 0, 1]),
  };
  return {
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((text) => {
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
      });
    },
  };
}

describe("retrieval → synthesis integration (fake backend, no network)", () => {
  async function buildIndexedRetriever(texts: { sessionId: string; text: string }[]) {
    const backend = conceptBackend();
    const chunks: ChunkMeta[] = texts.map((t, i) => ({
      sessionId: t.sessionId,
      turnIndex: i,
      role: "user-turn" as const,
      snippet: t.text,
    }));
    const denseVectors = await backend.embed(texts.map((t) => t.text));
    return createRetriever({ chunks, texts: texts.map((t) => t.text), denseVectors, backend });
  }

  it("feeds the candidate query into the retriever and injects the top hits", async () => {
    const retriever = await buildIndexedRetriever([
      { sessionId: "s1", text: "set up css styling for the page" },
      { sessionId: "s2", text: "fix the login bug regression" },
      { sessionId: "s3", text: "wire up auth tokens" },
    ]);

    const req = baseRequest();
    const query = buildRetrievalQuery(req.skillCandidate, req.topicNode);
    const hits = await retriever.retrieve(query, 8);
    expect(hits.length).toBeGreaterThan(0);
    // Relative assertion (tests wiring, not the exact dense/BM25 blend): the
    // "bug" concept in label/keywords/markdown should surface s2 and rank it
    // above the irrelevant css session s1.
    const ranked = hits.map((h) => h.sessionId);
    expect(ranked).toContain("s2");
    const s1Pos = ranked.indexOf("s1");
    expect(ranked.indexOf("s2")).toBeLessThan(s1Pos === -1 ? Infinity : s1Pos);

    const prompt = buildSynthesisPrompt({ ...req, retrievedContext: hits });
    expect(prompt).toContain("Retrieved Relevant Moments");
    expect(prompt).toContain("[s2#1]");
    expect(prompt).not.toContain("Representative User Prompts");
  });

  it("falls back to the cluster blob when the retriever is empty (no index)", async () => {
    const empty = await buildIndexedRetriever([]);
    const req = baseRequest();
    const query = buildRetrievalQuery(req.skillCandidate, req.topicNode);
    const hits = await empty.retrieve(query, 8);
    expect(hits).toEqual([]);

    // Caller passes undefined (no usable context) → cluster blob retained.
    const prompt = buildSynthesisPrompt({ ...req, retrievedContext: hits.length > 0 ? hits : undefined });
    expect(prompt).not.toContain("Retrieved Relevant Moments");
    expect(prompt).toContain("Representative User Prompts");
  });
});

// ─── retrieveContextForCandidate fallback (no network) ───────────────────────

describe("retrieveContextForCandidate fallback (issue #33)", () => {
  const req = baseRequest();
  const topic = { label: req.topicNode.label, keywords: req.topicNode.keywords };

  it("returns undefined and the prompt falls back to the blob when retrieve throws", async () => {
    // Fake retriever whose retrieve rejects — mimics a backend/model failure.
    const throwing: Retriever = {
      size: 3,
      async retrieve(): Promise<never> {
        throw new Error("backend unavailable");
      },
    };

    const ctx = await retrieveContextForCandidate(throwing, req.skillCandidate, topic);
    expect(ctx).toBeUndefined();

    // The orchestration passes the undefined context straight through, so the
    // cluster-blob examples are retained (never crashes synthesis).
    const prompt = buildSynthesisPrompt({ ...req, retrievedContext: ctx });
    expect(prompt).not.toContain("Retrieved Relevant Moments");
    expect(prompt).toContain("Representative User Prompts");
    expect(prompt).toContain("Enriched Tool Patterns");
  });

  it("returns undefined when retrieve yields no hits (empty index)", async () => {
    const empty: Retriever = {
      size: 0,
      async retrieve() {
        return [];
      },
    };
    const ctx = await retrieveContextForCandidate(empty, req.skillCandidate, topic);
    expect(ctx).toBeUndefined();
  });

  it("returns the hits when retrieve succeeds", async () => {
    const ok: Retriever = {
      size: 1,
      async retrieve() {
        return retrieved;
      },
    };
    const ctx = await retrieveContextForCandidate(ok, req.skillCandidate, topic);
    expect(ctx).toEqual(retrieved);
  });
});
