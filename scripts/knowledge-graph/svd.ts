/**
 * Truncated SVD (Latent Semantic Analysis) via Gram matrix power iteration.
 */

import type { SvdResult, LatentDimension } from "./types.js";
import { WEIGHT_TEXT, WEIGHT_TOOL, WEIGHT_STRUCT } from "./constants.js";

/**
 * Build a combined feature matrix from text, tool, and structural vectors.
 * Each group is L2-normalized, then scaled by its weight before concatenation.
 * Returns a dense row-major matrix (m × n) and sessionId ordering.
 */
export function buildCombinedMatrix(
  sessionIds: string[],
  textVectors: Map<string, Float64Array>,
  toolVectors: Map<string, Float64Array>,
  structVectors: Map<string, Float64Array>,
  textDim: number,
  toolDim: number,
  structDim: number
): { matrix: Float64Array[]; totalDim: number } {
  const totalDim = textDim + toolDim + structDim;
  const wt = Math.sqrt(WEIGHT_TEXT);
  const wl = Math.sqrt(WEIGHT_TOOL);
  const ws = Math.sqrt(WEIGHT_STRUCT);

  const matrix: Float64Array[] = [];
  for (const sid of sessionIds) {
    const row = new Float64Array(totalDim);
    const tv = textVectors.get(sid);
    const lv = toolVectors.get(sid);
    const sv = structVectors.get(sid);

    if (tv) for (let i = 0; i < textDim; i++) row[i] = tv[i] * wt;
    if (lv) for (let i = 0; i < toolDim; i++) row[textDim + i] = lv[i] * wl;
    if (sv) for (let i = 0; i < structDim; i++) row[textDim + toolDim + i] = sv[i] * ws;

    matrix.push(row);
  }

  return { matrix, totalDim };
}

/**
 * Truncated SVD via power iteration on A·A^T (the Gram matrix).
 *
 * For m sessions × n features where m << n, computing the m×m Gram matrix
 * and extracting its top-k eigenvectors is far cheaper than full SVD.
 */
export function truncatedSvd(
  sessionIds: string[],
  matrix: Float64Array[],
  totalDim: number,
  targetK: number
): SvdResult {
  const m = matrix.length;
  const n = totalDim;
  const k = Math.min(targetK, m - 1, n);

  // Step 1: Compute Gram matrix G = A · A^T (m × m)
  const G = new Float64Array(m * m);
  for (let i = 0; i < m; i++) {
    for (let j = i; j < m; j++) {
      let dot = 0;
      for (let d = 0; d < n; d++) {
        dot += matrix[i][d] * matrix[j][d];
      }
      G[i * m + j] = dot;
      G[j * m + i] = dot;
    }
  }

  // Step 2: Power iteration with deflation to extract top-k eigenvectors of G
  const eigenvectors: Float64Array[] = [];
  const eigenvalues: number[] = [];

  // Seeded PRNG for reproducibility
  let seed = 42;
  const nextRand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let ki = 0; ki < k; ki++) {
    // Random initial vector
    const v = new Float64Array(m);
    for (let i = 0; i < m; i++) v[i] = nextRand() - 0.5;

    // Normalize
    let norm = 0;
    for (let i = 0; i < m; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < m; i++) v[i] /= norm;

    // Power iteration (50 iterations is more than enough for convergence)
    for (let iter = 0; iter < 50; iter++) {
      // w = G · v
      const w = new Float64Array(m);
      for (let i = 0; i < m; i++) {
        let s = 0;
        for (let j = 0; j < m; j++) {
          s += G[i * m + j] * v[j];
        }
        w[i] = s;
      }

      // Deflate: remove projections onto previously found eigenvectors
      for (let prev = 0; prev < ki; prev++) {
        const ev = eigenvectors[prev];
        let proj = 0;
        for (let i = 0; i < m; i++) proj += w[i] * ev[i];
        for (let i = 0; i < m; i++) w[i] -= proj * ev[i];
      }

      // Normalize
      norm = 0;
      for (let i = 0; i < m; i++) norm += w[i] * w[i];
      norm = Math.sqrt(norm);
      if (norm < 1e-12) break;
      for (let i = 0; i < m; i++) v[i] = w[i] / norm;
    }

    // Eigenvalue = v^T G v
    let eigenvalue = 0;
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let j = 0; j < m; j++) s += G[i * m + j] * v[j];
      eigenvalue += v[i] * s;
    }

    eigenvectors.push(new Float64Array(v));
    eigenvalues.push(Math.max(0, eigenvalue));
  }

  // Step 3: Singular values = sqrt(eigenvalues of G)
  const sigma = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    sigma[i] = Math.sqrt(eigenvalues[i]);
  }

  // Step 4: Right singular vectors V = A^T · U · Σ^{-1}
  const V: Float64Array[] = [];
  for (let ki = 0; ki < k; ki++) {
    const vk = new Float64Array(n);
    if (sigma[ki] > 1e-12) {
      const invSigma = 1 / sigma[ki];
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let i = 0; i < m; i++) {
          s += matrix[i][j] * eigenvectors[ki][i];
        }
        vk[j] = s * invSigma;
      }
    }
    V.push(vk);
  }

  // Step 5: Session vectors = U · Σ (scaled embeddings)
  const sessionVectors = new Map<string, Float64Array>();
  for (let i = 0; i < m; i++) {
    const vec = new Float64Array(k);
    for (let ki = 0; ki < k; ki++) {
      vec[ki] = eigenvectors[ki][i] * sigma[ki];
    }
    // L2 normalize for cosine-based clustering
    let norm = 0;
    for (let d = 0; d < k; d++) norm += vec[d] * vec[d];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let d = 0; d < k; d++) vec[d] /= norm;

    sessionVectors.set(sessionIds[i], vec);
  }

  return { U: eigenvectors, sigma, V, k, sessionVectors };
}

/**
 * Interpret latent dimensions from V matrix.
 * Returns top-N terms per latent dimension, useful for cluster labeling.
 */
export function interpretLatentDimensions(
  svd: SvdResult,
  textVocabulary: string[],
  toolVocabulary: string[],
  textDim: number,
  toolDim: number,
  topN: number = 5
): LatentDimension[] {
  const totalVariance = svd.sigma.reduce((s, v) => s + v * v, 0);
  const dimensions: LatentDimension[] = [];

  for (let ki = 0; ki < svd.k; ki++) {
    const v = svd.V[ki];
    const varianceRatio = totalVariance > 0
      ? (svd.sigma[ki] * svd.sigma[ki]) / totalVariance
      : 0;

    // Top text terms (from text portion of V)
    const textScored: { term: string; weight: number }[] = [];
    for (let i = 0; i < textDim && i < textVocabulary.length; i++) {
      if (Math.abs(v[i]) > 0.01) {
        textScored.push({ term: textVocabulary[i], weight: Math.abs(v[i]) });
      }
    }
    textScored.sort((a, b) => b.weight - a.weight);

    // Top tools (from tool portion of V)
    const toolScored: { tool: string; weight: number }[] = [];
    for (let i = 0; i < toolDim && i < toolVocabulary.length; i++) {
      const idx = textDim + i;
      if (Math.abs(v[idx]) > 0.01) {
        toolScored.push({ tool: toolVocabulary[i], weight: Math.abs(v[idx]) });
      }
    }
    toolScored.sort((a, b) => b.weight - a.weight);

    dimensions.push({
      index: ki,
      varianceRatio: Math.round(varianceRatio * 10000) / 10000,
      topTerms: textScored.slice(0, topN),
      topTools: toolScored.slice(0, topN),
    });
  }

  return dimensions;
}
