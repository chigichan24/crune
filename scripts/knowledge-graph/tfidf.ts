/**
 * TF-IDF vectorization for session documents.
 */

import type { TfidfResult } from "./types.js";

export function buildTfidf(
  documents: Map<string, string[]>
): TfidfResult {
  // Build vocabulary
  const df = new Map<string, number>(); // document frequency
  for (const [, tokens] of documents) {
    const uniqueTerms = new Set(tokens);
    for (const term of uniqueTerms) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  // Filter vocabulary: appear in at least 2 docs, but not in > 80% of docs
  const n = documents.size;
  const maxDf = Math.max(2, Math.floor(n * 0.8));
  const vocabulary: string[] = [];
  const vocabIndex = new Map<string, number>();

  for (const [term, count] of df) {
    if (count >= 2 && count <= maxDf) {
      vocabIndex.set(term, vocabulary.length);
      vocabulary.push(term);
    }
  }

  // Build TF-IDF vectors
  const vectors = new Map<string, Float64Array>();

  for (const [docId, tokens] of documents) {
    const tf = new Map<string, number>();
    for (const t of tokens) {
      if (vocabIndex.has(t)) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }
    }

    const vec = new Float64Array(vocabulary.length);
    for (const [term, count] of tf) {
      const idx = vocabIndex.get(term)!;
      const termFreq = Math.log(1 + count);
      const invDocFreq = Math.log(n / (df.get(term) || 1));
      vec[idx] = termFreq * invDocFreq;
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
