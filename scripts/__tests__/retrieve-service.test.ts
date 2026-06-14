import { describe, it, expect } from "vitest";
import {
  handleRetrieveRequest,
  MAX_RETRIEVE_K,
} from "../retrieve-service.js";
import type { Retriever, RetrievedChunk } from "../knowledge-graph/retriever.js";

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

const SAMPLE: RetrievedChunk[] = [
  { sessionId: "s1", turnIndex: 2, snippet: "fix the auth flow", score: 0.9 },
  { sessionId: "s2", turnIndex: 0, snippet: "css layout work", score: 0.4 },
];

describe("handleRetrieveRequest", () => {
  it("returns 400 when query is missing or blank", async () => {
    const r = fakeRetriever(SAMPLE);
    expect((await handleRetrieveRequest({}, r)).status).toBe(400);
    expect((await handleRetrieveRequest({ query: "   " }, r)).status).toBe(400);
    // The retriever is never invoked for invalid input.
    expect(r.calls).toHaveLength(0);
  });

  it("returns a 400 'run --embed' hint (not 500) when the index is absent", async () => {
    const res = await handleRetrieveRequest({ query: "auth" }, null);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "no embedding index; run analyze-sessions --embed" });
  });

  it("returns results and trims the query", async () => {
    const r = fakeRetriever(SAMPLE);
    const res = await handleRetrieveRequest({ query: "  auth  " }, r);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: SAMPLE });
    expect(r.calls[0].query).toBe("auth");
  });

  it("defaults k to 10 when omitted", async () => {
    const r = fakeRetriever(SAMPLE);
    await handleRetrieveRequest({ query: "auth" }, r);
    expect(r.calls[0].k).toBe(10);
  });

  it("clamps k to [1, MAX] and floors fractional values", async () => {
    const r = fakeRetriever(SAMPLE);
    await handleRetrieveRequest({ query: "auth", k: 999 }, r);
    await handleRetrieveRequest({ query: "auth", k: 0 }, r);
    await handleRetrieveRequest({ query: "auth", k: 3.9 }, r);
    expect(r.calls[0].k).toBe(MAX_RETRIEVE_K);
    expect(r.calls[1].k).toBe(1);
    expect(r.calls[2].k).toBe(3);
  });
});
