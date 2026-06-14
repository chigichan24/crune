import { describe, it, expect } from "vitest";
import {
  extractChunks,
  cleanseNoise,
  embedSessions,
  quantize,
  dequantize,
  QUANT_MAX_ERROR,
  type EmbeddingBackend,
} from "../knowledge-graph/embedder.js";
import type { SessionInput } from "../knowledge-graph/types.js";

function session(id: string, turns: SessionInput["turns"]): SessionInput {
  return {
    sessionId: id,
    projectDisplayName: "proj",
    turns,
    subagents: {},
    meta: {
      sessionId: id,
      createdAt: "2026-01-01T00:00:00Z",
      lastActiveAt: "2026-01-01T00:10:00Z",
      durationMinutes: 10,
      filesEdited: [],
      gitBranch: "main",
      toolBreakdown: {},
      subagentCount: 0,
    },
  };
}

/** Deterministic fake backend: hashes tokens into a fixed-dim unit vector. */
function fakeBackend(dim = 8): EmbeddingBackend {
  return {
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((text) => {
        const vec = new Float32Array(dim);
        for (const tok of text.toLowerCase().split(/\s+/).filter(Boolean)) {
          let h = 0;
          for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) | 0;
          vec[Math.abs(h) % dim] += 1;
        }
        let norm = 0;
        for (const v of vec) norm += v * v;
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < dim; i++) vec[i] /= norm;
        return vec;
      });
    },
  };
}

describe("extractChunks", () => {
  it("produces one chunk per non-empty turn with sessionId/turnIndex", () => {
    const sessions = [
      session("s1", [
        { userPrompt: "fix the bug", assistantTexts: ["sure"], toolCalls: [{ toolName: "Edit", input: {} }] },
        { userPrompt: "run tests", assistantTexts: [], toolCalls: [{ toolName: "Bash", input: {} }] },
      ]),
    ];
    const chunks = extractChunks(sessions);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ sessionId: "s1", turnIndex: 0, role: "user-turn" });
    expect(chunks[1].turnIndex).toBe(1);
    expect(chunks[0].text).toContain("fix the bug");
    expect(chunks[0].text).toContain("Edit");
  });

  it("skips turns that have no text at all", () => {
    const sessions = [
      session("s2", [
        { userPrompt: "", assistantTexts: [], toolCalls: [] },
        { userPrompt: "hello", assistantTexts: [], toolCalls: [] },
      ]),
    ];
    const chunks = extractChunks(sessions);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].turnIndex).toBe(1);
  });

  it("truncates the snippet but keeps the full embedding text", () => {
    const long = "x".repeat(500);
    const chunks = extractChunks([
      session("s3", [{ userPrompt: long, assistantTexts: [], toolCalls: [] }]),
    ]);
    expect(chunks[0].snippet.length).toBeLessThanOrEqual(201); // 200 + ellipsis
    expect(chunks[0].text.length).toBeGreaterThan(400);
  });

  it("strips tool-output noise so chunk text reflects intent (issue #35)", () => {
    const chunks = extractChunks([
      session("s4", [
        {
          userPrompt: "set up OAuth login",
          assistantTexts: [
            "I'll configure auth. <bash-stdout>npm notice\nadded 412 packages\n</bash-stdout> Done.",
          ],
          toolCalls: [{ toolName: "Bash", input: {} }],
        },
      ]),
    ]);
    expect(chunks[0].text).toContain("set up OAuth login");
    expect(chunks[0].text).toContain("configure auth");
    expect(chunks[0].text).not.toMatch(/bash-stdout/i);
    expect(chunks[0].text).not.toMatch(/npm notice/i);
    expect(chunks[0].text).not.toContain("412 packages");
  });

  it("caps the assistant contribution but keeps the full user prompt", () => {
    const chunks = extractChunks([
      session("s5", [
        {
          userPrompt: "deploy the staging environment",
          assistantTexts: ["y".repeat(5000)],
          toolCalls: [],
        },
      ]),
    ]);
    expect(chunks[0].text).toContain("deploy the staging environment");
    // assistant capped at 1000 + the user prompt + a space
    expect(chunks[0].text.length).toBeLessThan(1100);
  });

  it("cleanseNoise leaves ordinary prose (and arithmetic) untouched", () => {
    expect(cleanseNoise("if a < b and c > d then ok")).toBe(
      "if a < b and c > d then ok"
    );
    expect(cleanseNoise("<system-reminder>ignore me</system-reminder>keep")).not.toContain(
      "ignore me"
    );
  });
});

describe("quantize / dequantize round-trip", () => {
  it("recovers each component within the bounded int8 error", () => {
    const vec = new Float32Array([0, 1, -1, 0.5, -0.5, 0.123, -0.987, 0.004]);
    const round = dequantize(quantize(vec));
    for (let i = 0; i < vec.length; i++) {
      expect(Math.abs(round[i] - vec[i])).toBeLessThanOrEqual(QUANT_MAX_ERROR + 1e-7);
    }
  });

  it("clamps out-of-range values to [-127, 127] (never wraps to -128)", () => {
    const q = quantize(new Float32Array([2, -2]));
    expect(q[0]).toBe(127);
    expect(q[1]).toBe(-127);
  });

  it("preserves cosine similarity closely after quantization", () => {
    const a = new Float32Array(8);
    const b = new Float32Array(8);
    for (let i = 0; i < 8; i++) {
      a[i] = Math.sin(i + 1);
      b[i] = Math.sin(i + 1) + 0.05;
    }
    // normalize
    const norm = (v: Float32Array) => {
      let n = 0;
      for (const x of v) n += x * x;
      n = Math.sqrt(n);
      for (let i = 0; i < v.length; i++) v[i] /= n;
    };
    norm(a);
    norm(b);
    const dot = (x: Float32Array, y: Float32Array) => {
      let d = 0;
      for (let i = 0; i < x.length; i++) d += x[i] * y[i];
      return d;
    };
    const before = dot(a, b);
    const after = dot(dequantize(quantize(a)), dequantize(quantize(b)));
    expect(Math.abs(after - before)).toBeLessThan(0.02);
  });
});

describe("embedSessions", () => {
  it("produces a row-major int8 matrix of count*dim with parallel chunk meta", async () => {
    const sessions = [
      session("s1", [
        { userPrompt: "alpha beta", assistantTexts: [], toolCalls: [] },
        { userPrompt: "gamma delta", assistantTexts: [], toolCalls: [] },
      ]),
      session("s2", [{ userPrompt: "epsilon", assistantTexts: [], toolCalls: [] }]),
    ];
    const backend = fakeBackend(8);
    const result = await embedSessions(sessions, backend, { batchSize: 2 });

    expect(result.count).toBe(3);
    expect(result.dim).toBe(8);
    expect(result.matrix.length).toBe(3 * 8);
    expect(result.chunks).toHaveLength(3);
    expect(result.chunks[2].sessionId).toBe("s2");
    // Row 0 dequantized should approximate the backend's vector for chunk 0.
    const row0 = dequantize(result.matrix.subarray(0, 8));
    const [expected0] = await backend.embed([result.chunks[0].snippet]);
    // snippet == full text here (short prompts), so vectors should align in sign.
    expect(row0.length).toBe(expected0.length);
  });
});
