/**
 * Retrieval service for the skill-server's `POST /api/retrieve` endpoint
 * (issue #34).
 *
 * Wraps the chunk retriever from #32 with:
 *   - lazy, single-shot construction of the production embedding backend +
 *     on-disk index (the Transformers.js model is loaded ONCE and reused across
 *     requests — never per request);
 *   - a pure request handler (`handleRetrieveRequest`) that takes an injected
 *     `Retriever` so tests can exercise the request/response shape with a fake
 *     backend and no network.
 *
 * BM25 full-text note: `meta.json` persists only the short `snippet`, not the
 * full chunk text. Rather than re-parse every session JSONL here, we feed the
 * snippets to BM25 as a *documented degraded fallback*. The dense cosine signal
 * remains the primary ranker (default alpha=0.6), so retrieval quality stays
 * close to the offline path; BM25 merely loses recall on terms that fell
 * outside the 200-char snippet.
 */

import { readEmbeddingIndex } from "./knowledge-graph/embedding-io.js";
import { createRetrieverFromIndex } from "./knowledge-graph/retriever.js";
import type { Retriever, RetrievedChunk } from "./knowledge-graph/retriever.js";
import type { EmbeddingBackend } from "./knowledge-graph/embedder.js";

/** Default on-disk embedding index location (matches `--embed` output). */
export const DEFAULT_EMBEDDINGS_DIR = "public/data/embeddings";

/** Default number of results returned when the request omits `k`. */
export const DEFAULT_RETRIEVE_K = 10;
/** Upper bound on `k` so a request cannot ask for an unbounded result set. */
export const MAX_RETRIEVE_K = 50;

export interface RetrieveRequestBody {
  query?: unknown;
  k?: unknown;
}

export interface RetrieveResult {
  status: number;
  body: { results: RetrievedChunk[] } | { error: string };
}

/**
 * Pure handler: validate the parsed body, run the injected retriever, and shape
 * the HTTP response. No I/O or model loading happens here, which keeps it unit
 * testable with a fake retriever.
 *
 * `retriever` is resolved lazily (the caller may build it on first use). A
 * `null` retriever means the index is absent — we surface a 400 with a clear
 * message the UI can render gracefully rather than a 500.
 */
export async function handleRetrieveRequest(
  body: RetrieveRequestBody,
  retriever: Retriever | null,
): Promise<RetrieveResult> {
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return { status: 400, body: { error: "Missing required field: query" } };
  }

  if (!retriever) {
    return {
      status: 400,
      body: { error: "no embedding index; run analyze-sessions --embed" },
    };
  }

  let k = DEFAULT_RETRIEVE_K;
  if (typeof body.k === "number" && Number.isFinite(body.k)) {
    k = Math.max(1, Math.min(MAX_RETRIEVE_K, Math.floor(body.k)));
  }

  const results = await retriever.retrieve(query, k);
  return { status: 200, body: { results } };
}

/**
 * Lazily build (and memoize) a retriever from the on-disk index using the given
 * embedding backend. Returns `null` if the index is missing/corrupt so callers
 * can report the "run --embed" hint instead of crashing.
 *
 * The backend is injected so production passes the (lazy) Transformers.js
 * backend exactly once; the model is materialized on the first `embed()` call
 * inside `retrieve`, then reused.
 */
export function createLazyRetrieverProvider(
  backend: EmbeddingBackend,
  embeddingsDir: string = DEFAULT_EMBEDDINGS_DIR,
): () => Retriever | null {
  let resolved = false;
  let retriever: Retriever | null = null;

  return () => {
    if (resolved) return retriever;
    resolved = true;
    try {
      const { meta, matrix } = readEmbeddingIndex(embeddingsDir);
      retriever = createRetrieverFromIndex({
        chunks: meta.chunks,
        matrix,
        dim: meta.dim,
        // Degraded BM25 fallback: snippets in place of full chunk text.
        chunkTexts: meta.chunks.map((c) => c.snippet),
        backend,
      });
    } catch {
      retriever = null;
    }
    return retriever;
  };
}
