import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  handleRetrieveRequest,
  createLazyRetrieverProvider,
  MAX_RETRIEVE_K,
  type RetrieverResolution,
} from "../retrieve-service.js";
import { writeEmbeddingIndex } from "../knowledge-graph/embedding-io.js";
import type { Retriever, RetrievedChunk } from "../knowledge-graph/retriever.js";
import type {
  EmbedResult,
  EmbeddingBackend,
} from "../knowledge-graph/embedder.js";

/**
 * Fake retriever that records the last (query, k) it saw and returns a fixed
 * result set. No model, no network — exercises the pure request handler shape.
 */
function fakeRetriever(results: RetrievedChunk[]): Retriever & {
  calls: Array<{ query: string; k: number }>;
} {
  const calls: Array<{ query: string; k: number }> = [];
  return {
    size: results.length,
    async retrieve(query, k) {
      calls.push({ query, k });
      return results.slice(0, k);
    },
    calls,
  };
}

function okResolution(retriever: Retriever): RetrieverResolution {
  return { kind: "ok", retriever };
}

const SAMPLE: RetrievedChunk[] = [
  { sessionId: "s1", turnIndex: 2, snippet: "fix the auth flow", score: 0.9 },
  { sessionId: "s2", turnIndex: 0, snippet: "css layout work", score: 0.4 },
];

describe("handleRetrieveRequest", () => {
  it("returns 400 when query is missing or blank", async () => {
    const r = fakeRetriever(SAMPLE);
    expect((await handleRetrieveRequest({}, okResolution(r))).status).toBe(400);
    expect(
      (await handleRetrieveRequest({ query: "   " }, okResolution(r))).status,
    ).toBe(400);
    // The retriever is never invoked for invalid input.
    expect(r.calls).toHaveLength(0);
  });

  it("returns a 400 'run --embed' hint (not 500) when the index is absent", async () => {
    const res = await handleRetrieveRequest({ query: "auth" }, { kind: "absent" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "no embedding index; run analyze-sessions --embed",
    });
  });

  it("returns a distinct 503 (not the 'run --embed' hint) when the index is corrupt", async () => {
    const res = await handleRetrieveRequest({ query: "auth" }, { kind: "error" });
    expect(res.status).toBe(503);
    // Crucially NOT the "run --embed" message: re-running embed will not fix a
    // corrupt/unreadable index.
    expect(res.body).not.toEqual({
      error: "no embedding index; run analyze-sessions --embed",
    });
    expect((res.body as { error: string }).error).toMatch(/unreadable/);
  });

  it("returns results and trims the query", async () => {
    const r = fakeRetriever(SAMPLE);
    const res = await handleRetrieveRequest({ query: "  auth  " }, okResolution(r));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: SAMPLE });
    expect(r.calls[0].query).toBe("auth");
  });

  it("defaults k to 10 when omitted", async () => {
    const r = fakeRetriever(SAMPLE);
    await handleRetrieveRequest({ query: "auth" }, okResolution(r));
    expect(r.calls[0].k).toBe(10);
  });

  it("clamps k to [1, MAX] and floors fractional values", async () => {
    const r = fakeRetriever(SAMPLE);
    await handleRetrieveRequest({ query: "auth", k: 999 }, okResolution(r));
    await handleRetrieveRequest({ query: "auth", k: 0 }, okResolution(r));
    await handleRetrieveRequest({ query: "auth", k: 3.9 }, okResolution(r));
    expect(r.calls[0].k).toBe(MAX_RETRIEVE_K);
    expect(r.calls[1].k).toBe(1);
    expect(r.calls[2].k).toBe(3);
  });

  it("ignores a non-numeric k (e.g. the numeric string '5') and uses the default", async () => {
    // Pins the contract: `k` arrives as JSON; only a real number is honored, a
    // numeric STRING silently falls back to the default rather than NaN/throw.
    const r = fakeRetriever(SAMPLE);
    await handleRetrieveRequest(
      { query: "auth", k: "5" as unknown as number },
      okResolution(r),
    );
    expect(r.calls[0].k).toBe(10);
  });
});

// ─── Lazy provider: recovery + error distinction (issue #34 review) ──────────

const tmpDirs: string[] = [];
function mkTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crune-retrieve-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

/** Backend factory recording the (model, dim) it was asked to build. */
function spyFactory(calls: Array<{ model: string; dim: number }>) {
  return (model: string, dim: number): EmbeddingBackend => {
    calls.push({ model, dim });
    return {
      dim,
      async embed(texts: string[]): Promise<Float32Array[]> {
        return texts.map(() => new Float32Array(dim));
      },
    };
  };
}

function writeSampleIndex(dir: string, model: string, dim: number): void {
  const result: EmbedResult = {
    model,
    dim,
    count: 2,
    scale: 1 / 127,
    matrix: Int8Array.from(new Array(2 * dim).fill(1)),
    chunks: [
      { sessionId: "s1", turnIndex: 0, role: "user-turn", snippet: "auth flow" },
      { sessionId: "s2", turnIndex: 1, role: "user-turn", snippet: "css layout" },
    ],
  };
  writeEmbeddingIndex(dir, result);
}

describe("createLazyRetrieverProvider", () => {
  it("reports 'absent' (not 'error') and does NOT cache when the index is missing", () => {
    const dir = path.join(mkTmp(), "missing");
    const factoryCalls: Array<{ model: string; dim: number }> = [];
    const provider = createLazyRetrieverProvider(spyFactory(factoryCalls), dir);

    const first = provider();
    expect(first.kind).toBe("absent");
    // No backend is constructed when there is no index to read.
    expect(factoryCalls).toHaveLength(0);
  });

  it("recovers once the index appears (negative result is never memoized)", () => {
    const dir = mkTmp();
    const factoryCalls: Array<{ model: string; dim: number }> = [];
    const provider = createLazyRetrieverProvider(spyFactory(factoryCalls), dir);

    // Server started before --embed ran.
    expect(provider().kind).toBe("absent");

    // --embed runs and writes the index.
    writeSampleIndex(dir, "test-model", 8);

    // The very next request succeeds — no restart needed.
    const second = provider();
    expect(second.kind).toBe("ok");
  });

  it("builds the backend from the index's own model/dim (not a hardcoded default)", () => {
    const dir = mkTmp();
    writeSampleIndex(dir, "custom-embed-model", 8);
    const factoryCalls: Array<{ model: string; dim: number }> = [];
    const provider = createLazyRetrieverProvider(spyFactory(factoryCalls), dir);

    expect(provider().kind).toBe("ok");
    expect(factoryCalls).toEqual([{ model: "custom-embed-model", dim: 8 }]);
  });

  it("memoizes a successful retriever (the backend is built exactly once)", () => {
    const dir = mkTmp();
    writeSampleIndex(dir, "test-model", 8);
    const factoryCalls: Array<{ model: string; dim: number }> = [];
    const provider = createLazyRetrieverProvider(spyFactory(factoryCalls), dir);

    const a = provider();
    const b = provider();
    expect(a.kind).toBe("ok");
    expect(b.kind).toBe("ok");
    if (a.kind === "ok" && b.kind === "ok") expect(a.retriever).toBe(b.retriever);
    expect(factoryCalls).toHaveLength(1);
  });

  it("reports 'error' AND logs (not 'absent') for a corrupt index", () => {
    const dir = mkTmp();
    writeSampleIndex(dir, "test-model", 8);
    // Corrupt meta.json so the size check fails (present but unreadable).
    const metaPath = path.join(dir, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    meta.count = 999;
    fs.writeFileSync(metaPath, JSON.stringify(meta));

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = createLazyRetrieverProvider(spyFactory([]), dir);

    const res = provider();
    expect(res.kind).toBe("error");
    expect(errSpy).toHaveBeenCalled();
  });

  it("retries after a corrupt index is fixed (error is not cached)", () => {
    const dir = mkTmp();
    writeSampleIndex(dir, "test-model", 8);
    const metaPath = path.join(dir, "meta.json");
    const goodMeta = fs.readFileSync(metaPath, "utf8");
    const corruptMeta = JSON.stringify({ ...JSON.parse(goodMeta), count: 999 });
    fs.writeFileSync(metaPath, corruptMeta);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = createLazyRetrieverProvider(spyFactory([]), dir);
    expect(provider().kind).toBe("error");

    // Repair the index; a later request must succeed.
    fs.writeFileSync(metaPath, goodMeta);
    expect(provider().kind).toBe("ok");
  });
});
