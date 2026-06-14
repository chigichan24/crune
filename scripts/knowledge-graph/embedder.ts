/**
 * Turn-level chunk embedding for RAG-based retrieval (issue #32).
 *
 * Produces a chunk-level dense vector index from analyzed sessions. Each
 * session turn becomes one chunk (userPrompt + assistant texts + tool names),
 * embedded with a local Transformers.js feature-extraction pipeline. Vectors
 * are L2-normalized and int8-quantized to keep the on-disk index compact.
 *
 * The model is injected via the `EmbeddingBackend` interface so unit tests can
 * supply a deterministic fake (no network) while production lazy-loads the
 * multilingual MiniLM model.
 */

import type { SessionInput } from "./types.js";

// ─── Backend interface ───────────────────────────────────────────────────────

/**
 * Pluggable embedding backend. Production uses Transformers.js; tests inject a
 * deterministic fake. `embed` MUST return one Float32Array per input text, each
 * of length `dim` and L2-normalized.
 */
export interface EmbeddingBackend {
  embed(texts: string[]): Promise<Float32Array[]>;
  readonly dim: number;
}

/** Default local model for the JA/EN mix (384-dim). */
export const DEFAULT_EMBED_MODEL =
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const DEFAULT_EMBED_DIM = 384;

// ─── Chunk extraction ────────────────────────────────────────────────────────

/** A single retrievable unit: one conversation turn. */
export interface ChunkMeta {
  sessionId: string;
  turnIndex: number;
  role: "user-turn";
  snippet: string;
}

/** A chunk plus the full text used to compute its embedding. */
export interface ExtractedChunk extends ChunkMeta {
  text: string;
}

const SNIPPET_MAX = 200;

/** Collapse whitespace and trim a string for snippet/embedding text. */
function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Extract one chunk per session turn. The embedding text concatenates the user
 * prompt, the assistant texts, and the (deduplicated) tool names invoked during
 * the turn. The stored snippet is a short, human-readable prefix.
 *
 * Turns whose combined text is empty are skipped so the index never contains
 * zero-information chunks.
 */
export function extractChunks(sessions: SessionInput[]): ExtractedChunk[] {
  const chunks: ExtractedChunk[] = [];
  for (const session of sessions) {
    session.turns.forEach((turn, turnIndex) => {
      const userPart = normalizeText(turn.userPrompt);
      const assistantPart = normalizeText(turn.assistantTexts.join(" "));
      const toolNames = [...new Set(turn.toolCalls.map((tc) => tc.toolName))];
      const toolPart = toolNames.join(" ");

      const text = normalizeText(
        [userPart, assistantPart, toolPart].filter(Boolean).join(" ")
      );
      if (!text) return;

      // Snippet prefers the user prompt, falling back to assistant text.
      const snippetSource = userPart || assistantPart || toolPart;
      const snippet =
        snippetSource.length > SNIPPET_MAX
          ? snippetSource.slice(0, SNIPPET_MAX) + "…"
          : snippetSource;

      chunks.push({
        sessionId: session.sessionId,
        turnIndex,
        role: "user-turn",
        snippet,
        text,
      });
    });
  }
  return chunks;
}

// ─── int8 quantization ───────────────────────────────────────────────────────

/**
 * Quantization scale. L2-normalized vector components live in [-1, 1], so we
 * map them onto the symmetric int8 range [-127, 127] (reserving -128) and
 * recover with `* QUANT_SCALE`. Round-trip error is bounded by half a step.
 */
export const QUANT_SCALE = 1 / 127;
/** Maximum absolute round-trip error introduced by int8 quantization. */
export const QUANT_MAX_ERROR = QUANT_SCALE / 2;

/**
 * Quantize an L2-normalized Float32Array into int8. Components are clamped to
 * [-127, 127] so a (numerically) out-of-range value never wraps to -128.
 */
export function quantize(vec: Float32Array): Int8Array {
  const out = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    let q = Math.round(vec[i] * 127);
    if (q > 127) q = 127;
    else if (q < -127) q = -127;
    out[i] = q;
  }
  return out;
}

/** Dequantize an int8 vector back into a Float32Array (lossy, bounded error). */
export function dequantize(q: Int8Array): Float32Array {
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) {
    out[i] = q[i] * QUANT_SCALE;
  }
  return out;
}

// ─── Embedding orchestration ─────────────────────────────────────────────────

export interface EmbedResult {
  model: string;
  dim: number;
  count: number;
  scale: number;
  /** Row-major int8 matrix: count * dim. */
  matrix: Int8Array;
  chunks: ChunkMeta[];
}

export interface EmbedOptions {
  /** Model id recorded in metadata (the backend owns the actual model). */
  model?: string;
  /** Texts embedded per backend call (production batching). Default 32. */
  batchSize?: number;
}

/**
 * Embed every session turn into a quantized dense index. The `backend` owns the
 * model; this function only orchestrates chunk extraction, batched embedding,
 * and int8 quantization.
 */
export async function embedSessions(
  sessions: SessionInput[],
  backend: EmbeddingBackend,
  opts: EmbedOptions = {}
): Promise<EmbedResult> {
  const { model = DEFAULT_EMBED_MODEL, batchSize = 32 } = opts;
  const chunks = extractChunks(sessions);
  const dim = backend.dim;
  const matrix = new Int8Array(chunks.length * dim);

  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = chunks.slice(start, start + batchSize);
    const vectors = await backend.embed(batch.map((c) => c.text));
    if (vectors.length !== batch.length) {
      throw new Error(
        `embedding backend returned ${vectors.length} vectors for ${batch.length} inputs`
      );
    }
    for (let j = 0; j < vectors.length; j++) {
      const vec = vectors[j];
      if (vec.length !== dim) {
        throw new Error(
          `embedding backend returned dim ${vec.length}, expected ${dim}`
        );
      }
      const q = quantize(vec);
      matrix.set(q, (start + j) * dim);
    }
  }

  return {
    model,
    dim,
    count: chunks.length,
    scale: QUANT_SCALE,
    matrix,
    chunks: chunks.map(({ sessionId, turnIndex, role, snippet }) => ({
      sessionId,
      turnIndex,
      role,
      snippet,
    })),
  };
}

// ─── Persisted metadata shape ────────────────────────────────────────────────

/** Shape of `embeddings/meta.json` written alongside `index.bin`. */
export interface EmbeddingMeta {
  model: string;
  dim: number;
  count: number;
  scale: number;
  chunks: ChunkMeta[];
}
