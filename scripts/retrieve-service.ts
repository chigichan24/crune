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
 * Outcome of resolving the on-disk retriever. We distinguish an ABSENT index
 * (the user simply never ran `--embed` → recoverable 400 hint) from a CORRUPT /
 * unreadable one (a real server-side fault → 503 so the UI does not tell the
 * user to re-run a command that will not help). `kind: "ok"` carries the built
 * retriever; the other kinds carry no retriever.
 */
export type RetrieverResolution =
  | { kind: "ok"; retriever: Retriever }
  | { kind: "absent" }
  | { kind: "error" };

/**
 * Pure handler: validate the parsed body, run the resolved retriever, and shape
 * the HTTP response. No I/O or model loading happens here, which keeps it unit
 * testable with a fake resolution.
 *
 * The retriever is resolved lazily (the caller builds it on first use). The
 * resolution `kind` is threaded through so the handler can pick a message:
 *   - `absent` → 400 "run --embed" hint (recoverable, the UI degrades);
 *   - `error`  → 503 (corrupt/unreadable index; a real fault, not user error);
 *   - `ok`     → 200 with results.
 */
export async function handleRetrieveRequest(
  body: RetrieveRequestBody,
  resolution: RetrieverResolution,
): Promise<RetrieveResult> {
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return { status: 400, body: { error: "Missing required field: query" } };
  }

  if (resolution.kind === "absent") {
    return {
      status: 400,
      body: { error: "no embedding index; run analyze-sessions --embed" },
    };
  }
  if (resolution.kind === "error") {
    return {
      status: 503,
      body: { error: "embedding index is unreadable; check the server log" },
    };
  }

  let k = DEFAULT_RETRIEVE_K;
  if (typeof body.k === "number" && Number.isFinite(body.k)) {
    k = Math.max(1, Math.min(MAX_RETRIEVE_K, Math.floor(body.k)));
  }

  const results = await resolution.retriever.retrieve(query, k);
  return { status: 200, body: { results } };
}

/**
 * Build an `EmbeddingBackend` for a given model id + dimensionality. Production
 * passes `createTransformersBackend`; tests pass a fake. The factory shape (vs a
 * prebuilt backend) lets the provider construct the backend from the LOADED
 * index's `meta.model`/`meta.dim`, so the query vectors always match the chunk
 * vectors' dimensionality even when the index was embedded with `--embed-model`.
 */
export type BackendFactory = (model: string, dim: number) => EmbeddingBackend;

/**
 * Lazily resolve a retriever from the on-disk index. Returns a
 * `RetrieverResolution` so callers can distinguish an ABSENT index (run
 * `--embed`) from a CORRUPT/unreadable one (a real fault, logged here).
 *
 * Memoization is SUCCESS-ONLY: a server started before `--embed` ran (index
 * absent) returns a transient `{kind:"absent"}` and retries on the next request,
 * so it recovers once the index appears — no restart needed. Negative results
 * are never cached.
 *
 * The backend is built from the loaded index's `meta.model`/`meta.dim` via the
 * injected factory, exactly once, then reused (the Transformers.js model is
 * materialized on the first `embed()` call inside `retrieve`).
 */
export function createLazyRetrieverProvider(
  backendFactory: BackendFactory,
  embeddingsDir: string = DEFAULT_EMBEDDINGS_DIR,
): () => RetrieverResolution {
  let cached: Retriever | null = null;

  return () => {
    if (cached) return { kind: "ok", retriever: cached };

    let loaded;
    try {
      loaded = readEmbeddingIndex(embeddingsDir);
    } catch (err) {
      // ENOENT (either index.bin or meta.json missing) → the user never ran
      // `--embed`. Recoverable and expected; do not log, do not cache.
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { kind: "absent" };
      }
      // Anything else (corrupt meta, size mismatch, IO error) is a real fault:
      // surface it in the log and as a distinct status, and do not cache so a
      // later request (after the index is fixed/rebuilt) can succeed.
      console.error(
        `[retrieve] failed to read embedding index in ${embeddingsDir}:`,
        err instanceof Error ? err.message : err,
      );
      return { kind: "error" };
    }

    const { meta, matrix } = loaded;
    try {
      // Build the backend from the index's own model/dim so query vectors match
      // the chunk vectors' dimensionality (a `--embed-model` mismatch would
      // otherwise corrupt cosine ranking silently).
      const backend = backendFactory(meta.model, meta.dim);
      cached = createRetrieverFromIndex({
        chunks: meta.chunks,
        matrix,
        dim: meta.dim,
        // Degraded BM25 fallback: snippets in place of full chunk text.
        chunkTexts: meta.chunks.map((c) => c.snippet),
        backend,
      });
      return { kind: "ok", retriever: cached };
    } catch (err) {
      console.error(
        `[retrieve] failed to build retriever from index in ${embeddingsDir}:`,
        err instanceof Error ? err.message : err,
      );
      return { kind: "error" };
    }
  };
}
