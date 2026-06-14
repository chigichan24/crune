/**
 * Hybrid chunk retriever for RAG-based retrieval (issue #32).
 *
 * Combines a dense signal (cosine over dequantized int8 embeddings) with a
 * sparse signal (BM25 over chunk texts, reusing `buildBm25`). Per query both
 * signals are min-max normalized and blended:
 *
 *   hybrid = alpha * denseNorm + (1 - alpha) * bm25Norm
 *
 * Results are then diversified with a per-session cap so the top-k is not
 * dominated by a single chatty session.
 *
 * The query embedding uses the same `EmbeddingBackend` as indexing, injected so
 * tests can supply deterministic fake vectors with no network.
 */

import { buildBm25 } from "./bm25.js";
import { tokenize } from "./tokenizer.js";
import {
  dequantize,
  type ChunkMeta,
  type EmbeddingBackend,
} from "./embedder.js";

export interface RetrievedChunk {
  sessionId: string;
  turnIndex: number;
  snippet: string;
  score: number;
}

export interface RetrieveOptions {
  /** Dense vs sparse blend in [0, 1]; 1 = dense only. Default 0.6. */
  alpha?: number;
  /** Max results allowed from any single session (diversification). Default 2. */
  perSessionCap?: number;
}

const DEFAULT_ALPHA = 0.6;
const DEFAULT_PER_SESSION_CAP = 2;

export interface Retriever {
  retrieve(query: string, k: number, opts?: RetrieveOptions): Promise<RetrievedChunk[]>;
  readonly size: number;
}

interface RetrieverInputs {
  /** Chunk metadata, parallel to `denseVectors`. */
  chunks: ChunkMeta[];
  /** Full chunk texts used for BM25 (parallel to `chunks`). */
  texts: string[];
  /** Dequantized dense vectors, parallel to `chunks`. Each is L2-normalized. */
  denseVectors: Float32Array[];
  /** Embedding backend used to embed the query. */
  backend: EmbeddingBackend;
}

/** Min-max normalize an array into [0, 1]. A flat array maps to all-zeros.
 *  Always returns a fresh array (never the input reference). */
function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range <= 0) return values.map(() => 0);
  return values.map((v) => (v - min) / range);
}

/** Cosine between two equal-length vectors. Inputs need not be normalized. */
function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Build a retriever from in-memory inputs. Most callers use
 * `createRetrieverFromIndex` instead; this lower-level factory keeps the ranking
 * logic decoupled from file I/O and quantization for testing.
 */
export function createRetriever(inputs: RetrieverInputs): Retriever {
  const { chunks, texts, denseVectors, backend } = inputs;

  // Precompute BM25 over chunk texts once. Document ids are chunk indices.
  // minDf=1: each chunk is one short turn, so a distinctive term in a single
  // turn must stay in the vocabulary or the sparse channel goes inert.
  const docs = new Map<string, string[]>();
  texts.forEach((t, i) => docs.set(String(i), tokenize(t)));
  const bm25 = buildBm25(docs, 1);

  async function retrieve(
    query: string,
    k: number,
    opts: RetrieveOptions = {}
  ): Promise<RetrievedChunk[]> {
    const alpha = opts.alpha ?? DEFAULT_ALPHA;
    const perSessionCap = opts.perSessionCap ?? DEFAULT_PER_SESSION_CAP;
    if (chunks.length === 0 || k <= 0) return [];

    // Dense signal: cosine(query, chunk).
    const [queryVec] = await backend.embed([query]);
    const denseScores = denseVectors.map((v) => cosine(queryVec, v));

    // Sparse signal: BM25 dot product (query projected onto chunk vocabulary).
    const queryTokens = tokenize(query);
    const queryBm25 = new Float64Array(bm25.vocabulary.length);
    for (const tok of queryTokens) {
      const idx = bm25.vocabIndex.get(tok);
      if (idx !== undefined) queryBm25[idx] += 1;
    }
    const bm25Scores = chunks.map((_, i) => {
      const vec = bm25.vectors.get(String(i));
      if (!vec) return 0;
      let dot = 0;
      for (let j = 0; j < vec.length; j++) dot += vec[j] * queryBm25[j];
      return dot;
    });

    // Per-query min-max normalization of each signal, then blend.
    const denseNorm = minMaxNormalize(denseScores);
    const bm25Norm = minMaxNormalize(bm25Scores);
    const scored = chunks.map((chunk, i) => ({
      chunk,
      score: alpha * denseNorm[i] + (1 - alpha) * bm25Norm[i],
    }));

    scored.sort((a, b) => b.score - a.score);

    // Per-session diversification cap.
    const perSession = new Map<string, number>();
    const out: RetrievedChunk[] = [];
    for (const { chunk, score } of scored) {
      const used = perSession.get(chunk.sessionId) ?? 0;
      if (used >= perSessionCap) continue;
      perSession.set(chunk.sessionId, used + 1);
      out.push({
        sessionId: chunk.sessionId,
        turnIndex: chunk.turnIndex,
        snippet: chunk.snippet,
        score,
      });
      if (out.length >= k) break;
    }
    return out;
  }

  return { retrieve, size: chunks.length };
}

/**
 * Build a retriever from a loaded int8 index. `chunkTexts` must be parallel to
 * `meta.chunks` (BM25 needs the full text, which is not persisted in meta to
 * keep the index small — the caller re-derives it from sessions, or passes the
 * snippets as a degraded fallback).
 */
export function createRetrieverFromIndex(params: {
  chunks: ChunkMeta[];
  matrix: Int8Array;
  dim: number;
  chunkTexts: string[];
  backend: EmbeddingBackend;
}): Retriever {
  const { chunks, matrix, dim, chunkTexts, backend } = params;
  const denseVectors: Float32Array[] = chunks.map((_, i) =>
    dequantize(matrix.subarray(i * dim, (i + 1) * dim))
  );
  return createRetriever({ chunks, texts: chunkTexts, denseVectors, backend });
}
