/**
 * BM25 vectorization for session documents.
 *
 * Replaces the previous log-TF / log-IDF scheme with Okapi BM25:
 * - Smoothed, non-negative IDF.
 * - Saturated term frequency with document-length normalization.
 * The result shape (vocabulary / vocabIndex / L2-normalized vectors) is
 * identical to the prior TF-IDF implementation so downstream cosine-similarity
 * consumers are unaffected.
 */

import type { Bm25Result } from "./types.js";

// BM25 hyperparameters (Okapi defaults). Exported so tests can reference the
// single source of truth instead of re-declaring magic numbers.
export const BM25_K1 = 1.2; // term-frequency saturation
export const BM25_B = 0.75; // document-length normalization strength

/**
 * Build Okapi BM25 document vectors: smoothed non-negative IDF, saturated
 * term frequency (k1), and document-length normalization (b). The result is a
 * per-document L2-normalized Float64Array so downstream cosine similarity is
 * unchanged.
 */
export function buildBm25(
  documents: Map<string, string[]>,
  /**
   * Minimum document frequency for a term to enter the vocabulary. The default
   * (2) suits the cross-session knowledge graph, where df==1 terms are noise.
   * Turn-level retrieval (one short doc per turn) should pass 1, otherwise a
   * distinctive query term that appears in a single turn is dropped and the
   * whole sparse channel collapses to zero.
   */
  minDf = 2
): Bm25Result {
  // Build vocabulary
  const df = new Map<string, number>(); // document frequency
  for (const [, tokens] of documents) {
    const uniqueTerms = new Set(tokens);
    for (const term of uniqueTerms) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  // Filter vocabulary: appear in at least 2 docs, but not too broadly.
  // The absolute cap (n - 1) guarantees a term present in EVERY doc (df == n)
  // is always excluded, even for tiny corpora where floor(n*0.8) would admit it.
  const n = documents.size;
  const maxDf = Math.min(Math.max(minDf, Math.floor(n * 0.8)), n - 1);
  const vocabulary: string[] = [];
  const vocabIndex = new Map<string, number>();

  for (const [term, count] of df) {
    if (count >= minDf && count <= maxDf) {
      vocabIndex.set(term, vocabulary.length);
      vocabulary.push(term);
    }
  }

  // First pass: per-document length = count of in-vocabulary tokens, and the
  // corpus average document length (avgdl) used for BM25 length normalization.
  const docLens = new Map<string, number>();
  let totalLen = 0;
  for (const [docId, tokens] of documents) {
    let len = 0;
    for (const t of tokens) {
      if (vocabIndex.has(t)) len++;
    }
    docLens.set(docId, len);
    totalLen += len;
  }
  const avgdl = n > 0 ? totalLen / n : 0;

  // Precompute BM25 smoothed IDF per vocabulary term (non-negative by design).
  const idf = new Map<string, number>();
  for (const term of vocabulary) {
    const d = df.get(term) || 0;
    idf.set(term, Math.log((n - d + 0.5) / (d + 0.5) + 1));
  }

  // Build BM25 vectors
  const vectors = new Map<string, Float64Array>();

  for (const [docId, tokens] of documents) {
    const tf = new Map<string, number>();
    for (const t of tokens) {
      if (vocabIndex.has(t)) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }
    }

    const docLen = docLens.get(docId) || 0;
    const lenNorm = avgdl > 0 ? 1 - BM25_B + BM25_B * (docLen / avgdl) : 1;

    const vec = new Float64Array(vocabulary.length);
    for (const [term, count] of tf) {
      const idx = vocabIndex.get(term)!;
      const saturatedTf = (count * (BM25_K1 + 1)) / (count + BM25_K1 * lenNorm);
      vec[idx] = saturatedTf * (idf.get(term) || 0);
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= norm;
      }
    }

    vectors.set(docId, vec);
  }

  return { vocabulary, vocabIndex, vectors };
}
