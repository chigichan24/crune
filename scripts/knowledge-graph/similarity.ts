/**
 * Cosine similarity and distance for L2-normalized vectors.
 */

export function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot; // Already L2-normalized
}

export function cosineDistance(a: Float64Array, b: Float64Array): number {
  return 1 - cosineSimilarity(a, b);
}
