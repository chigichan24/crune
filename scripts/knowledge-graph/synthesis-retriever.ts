/**
 * Shared retrieval-enriched synthesis helpers (issue #33).
 *
 * Both the data pipeline (`analyze-sessions.ts`) and the npx CLI (`cli.ts`) build
 * a hybrid retriever over the analyzed sessions and, per skill candidate, pull
 * the top-k most relevant turn snippets to ground synthesis. The build strategy
 * and the per-candidate retrieve-with-fallback loop were independently
 * re-implemented in both entry points; this module is the single source of truth.
 *
 * Nothing here throws to the caller: `buildSynthesisRetriever` returns `null`
 * and `retrieveContextForCandidate` returns `undefined` on any failure, so the
 * caller transparently falls back to the loosely-related cluster blob.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  extractChunks,
  embedSessions,
  readEmbeddingIndex,
  createTransformersBackend,
  createRetrieverFromIndex,
  DEFAULT_EMBED_DIM,
  type SessionInput,
  type EmbedResult,
  type Retriever,
  type RetrievedChunk,
} from "./index.js";
import { buildRetrievalQuery } from "../skill-synthesizer.js";
import type { SkillCandidate } from "./types.js";

/** Top-k turn snippets retrieved per candidate for synthesis context (#33). */
export const RETRIEVAL_TOP_K = 8;

/**
 * Build a hybrid retriever for retrieval-enriched synthesis (issue #33).
 *
 * Strategy, in order of preference:
 *   1. Reuse an embedding index already computed this run (`precomputed`, from
 *      the `--embed` step) — zero extra model calls.
 *   2. Read an on-disk index at `embeddingsDir` (from a prior `--embed` run).
 *   3. Embed the analyzed sessions fresh via the production backend.
 *
 * BM25 needs the full chunk text, which the persisted meta.json does NOT store
 * (only the short snippet). We re-derive it with `extractChunks` (same order as
 * the index) and zip by index. Returns `null` (never throws) when no index and
 * no usable backend are available, so the caller falls back to the cluster blob.
 */
export async function buildSynthesisRetriever(
  sessionInputs: SessionInput[],
  embeddingsDir: string,
  model: string,
  precomputed?: EmbedResult
): Promise<{ retriever: Retriever; strategy: string } | null> {
  // extractChunks is the canonical chunk order shared with the embedder; its
  // `text` field is what BM25 indexes.
  const extracted = extractChunks(sessionInputs);
  if (extracted.length === 0) {
    console.error("[crune] Retrieval context: no chunks to index, falling back to cluster blob");
    return null;
  }
  const chunkTexts = extracted.map((c) => c.text);

  try {
    const backend = createTransformersBackend(model, DEFAULT_EMBED_DIM);

    // (1) Reuse embeddings computed earlier this run.
    if (precomputed && precomputed.count === extracted.length) {
      const retriever = createRetrieverFromIndex({
        chunks: precomputed.chunks,
        matrix: precomputed.matrix,
        dim: precomputed.dim,
        chunkTexts,
        backend,
      });
      return { retriever, strategy: "reused --embed index (this run)" };
    }

    // (2) Reuse an index persisted by a prior run.
    if (fs.existsSync(path.join(embeddingsDir, "meta.json"))) {
      const { meta, matrix } = readEmbeddingIndex(embeddingsDir);
      if (meta.count === extracted.length) {
        const retriever = createRetrieverFromIndex({
          chunks: meta.chunks,
          matrix,
          dim: meta.dim,
          chunkTexts,
          backend,
        });
        return { retriever, strategy: `on-disk index (${embeddingsDir})` };
      }
      console.error(
        `[crune] Retrieval context: on-disk index count ${meta.count} != ${extracted.length} chunks, re-embedding`
      );
    }

    // (3) Embed fresh in-memory. createRetrieverFromIndex owns the dequantize
    // step AND the chunks/matrix/chunkTexts length-consistency guard.
    const result = await embedSessions(sessionInputs, backend, { model });
    const retriever = createRetrieverFromIndex({
      chunks: result.chunks,
      matrix: result.matrix,
      dim: result.dim,
      chunkTexts,
      backend,
    });
    return { retriever, strategy: "freshly embedded (in-memory)" };
  } catch (err) {
    console.error(
      `[crune] Retrieval context unavailable (falling back to cluster blob): ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/**
 * Retrieve the top-k relevant turn snippets for a single skill candidate
 * (issue #33). Builds the hybrid query from the candidate + topic, retrieves,
 * and on ANY failure (or empty result) returns `undefined` so the caller falls
 * back to the cluster-blob examples — never crashes synthesis.
 */
export async function retrieveContextForCandidate(
  retriever: Retriever,
  candidate: Pick<SkillCandidate, "skillMarkdown">,
  topic: { label: string; keywords: string[] }
): Promise<RetrievedChunk[] | undefined> {
  try {
    const query = buildRetrievalQuery(candidate, topic);
    const chunks = await retriever.retrieve(query, RETRIEVAL_TOP_K);
    return chunks.length > 0 ? chunks : undefined;
  } catch (err) {
    console.error(
      `[crune] Retrieval failed (using cluster blob): ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}
