/**
 * Embedding index I/O and the production Transformers.js backend (issue #32).
 *
 * Kept separate from `embedder.ts` so unit tests can import the pure
 * orchestration/quantization logic without pulling in `@huggingface/transformers`
 * or touching the filesystem.
 *
 * On-disk layout:
 *   public/data/embeddings/index.bin   Int8Array, count * dim, row-major
 *   public/data/embeddings/meta.json   EmbeddingMeta
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_EMBED_MODEL,
  type EmbedResult,
  type EmbeddingBackend,
  type EmbeddingMeta,
} from "./embedder.js";

export const INDEX_FILENAME = "index.bin";
export const META_FILENAME = "meta.json";

/** Write `index.bin` + `meta.json` into `outputDir` (created if needed). */
export function writeEmbeddingIndex(outputDir: string, result: EmbedResult): void {
  fs.mkdirSync(outputDir, { recursive: true });
  // Int8Array view → Buffer over the exact byte range (respect byteOffset/length).
  const buf = Buffer.from(
    result.matrix.buffer,
    result.matrix.byteOffset,
    result.matrix.byteLength
  );
  fs.writeFileSync(path.join(outputDir, INDEX_FILENAME), buf);

  const meta: EmbeddingMeta = {
    model: result.model,
    dim: result.dim,
    count: result.count,
    scale: result.scale,
    chunks: result.chunks,
  };
  fs.writeFileSync(
    path.join(outputDir, META_FILENAME),
    JSON.stringify(meta, null, 2)
  );
}

export interface LoadedEmbeddingIndex {
  meta: EmbeddingMeta;
  /** Row-major int8 matrix: count * dim. */
  matrix: Int8Array;
}

/** Load `index.bin` + `meta.json` from `dir`. Throws if either is missing. */
export function readEmbeddingIndex(dir: string): LoadedEmbeddingIndex {
  const metaRaw = fs.readFileSync(path.join(dir, META_FILENAME), "utf8");
  const meta = JSON.parse(metaRaw) as EmbeddingMeta;
  const buf = fs.readFileSync(path.join(dir, INDEX_FILENAME));
  const matrix = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  if (matrix.length !== meta.count * meta.dim) {
    throw new Error(
      `embedding index size mismatch: ${matrix.length} != ${meta.count} * ${meta.dim}`
    );
  }
  return { meta, matrix };
}

// ─── Production Transformers.js backend ──────────────────────────────────────

/**
 * Lazy-loaded Transformers.js feature-extraction backend. The model is fetched
 * from HuggingFace on first use; in a network-restricted sandbox this throws,
 * which callers should surface (the PoC falls back to a fake backend).
 */
export function createTransformersBackend(
  model: string = DEFAULT_EMBED_MODEL,
  dim = 384
): EmbeddingBackend {
  // The pipeline is created once on first embed() call.
  let extractorPromise: Promise<(texts: string[]) => Promise<Float32Array[]>> | null =
    null;

  async function getExtractor() {
    if (extractorPromise) return extractorPromise;
    extractorPromise = (async () => {
      // Dynamic import so test code that never calls embed() does not load the
      // heavy native dependency.
      const { pipeline } = await import("@huggingface/transformers");
      const extractor = await pipeline("feature-extraction", model);
      return async (texts: string[]): Promise<Float32Array[]> => {
        const output = await extractor(texts, {
          pooling: "mean",
          normalize: true,
        });
        // `output` is a Tensor of shape [batch, dim]; tolist() → number[][].
        const rows = output.tolist() as number[][];
        return rows.map((r) => Float32Array.from(r));
      };
    })();
    return extractorPromise;
  }

  return {
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const extract = await getExtractor();
      return extract(texts);
    },
  };
}
