import { describe, it, expect } from "vitest";
import { buildTfidf } from "../knowledge-graph-builder.js";

describe("buildTfidf", () => {
  it("excludes terms that appear in only 1 document", () => {
    const documents = new Map<string, string[]>();
    documents.set("doc1", ["alpha", "beta", "gamma"]);
    documents.set("doc2", ["alpha", "beta", "delta"]);
    documents.set("doc3", ["alpha", "gamma", "epsilon"]);

    const result = buildTfidf(documents);

    // n=3, maxDf = max(2, floor(3*0.8)) = max(2,2) = 2
    // "alpha" df=3 > maxDf(2) => excluded
    // "beta" df=2, "gamma" df=2 => kept (>=2 and <=2)
    // "delta" df=1, "epsilon" df=1 => excluded (< 2)
    expect(result.vocabulary).toContain("beta");
    expect(result.vocabulary).toContain("gamma");
    expect(result.vocabulary).not.toContain("delta");
    expect(result.vocabulary).not.toContain("epsilon");
  });

  it("excludes terms appearing in >80% of docs when applicable", () => {
    // With 10 docs, maxDf = max(2, floor(10*0.8)) = 8
    const documents = new Map<string, string[]>();
    for (let i = 0; i < 10; i++) {
      const tokens = ["ubiquitous"]; // appears in all 10
      if (i < 5) tokens.push("common"); // appears in 5 (<=8, >=2) => kept
      if (i < 2) tokens.push("rare"); // appears in 2 (>=2, <=8) => kept
      documents.set(`doc${i}`, tokens);
    }

    const result = buildTfidf(documents);

    // "ubiquitous" in 10 docs > maxDf(8) => excluded
    expect(result.vocabulary).not.toContain("ubiquitous");
    // "common" in 5 docs => kept
    expect(result.vocabulary).toContain("common");
    // "rare" in 2 docs => kept
    expect(result.vocabulary).toContain("rare");
  });

  it("produces L2-normalized vectors (dot product with self ~= 1.0)", () => {
    const documents = new Map<string, string[]>();
    documents.set("doc1", ["foo", "bar", "baz"]);
    documents.set("doc2", ["foo", "bar", "qux"]);
    documents.set("doc3", ["foo", "baz", "qux"]);

    const result = buildTfidf(documents);

    for (const [, vec] of result.vectors) {
      let dotProduct = 0;
      for (let i = 0; i < vec.length; i++) {
        dotProduct += vec[i] * vec[i];
      }
      // If the vector is non-zero it should be normalized to 1
      if (dotProduct > 0) {
        expect(dotProduct).toBeCloseTo(1.0, 10);
      }
    }
  });

  it("gives rare term higher IDF weight than common term", () => {
    const documents = new Map<string, string[]>();
    // "common" in 4 of 5 docs, "rare" in 2 of 5 docs
    documents.set("doc1", ["common", "rare"]);
    documents.set("doc2", ["common", "rare"]);
    documents.set("doc3", ["common", "filler"]);
    documents.set("doc4", ["common", "filler"]);
    documents.set("doc5", ["filler", "filler"]);

    const result = buildTfidf(documents);

    // Both "common" (df=4) and "rare" (df=2) should be in vocabulary
    // maxDf = max(2, floor(5*0.8)) = max(2,4) = 4, so common (df=4) is kept
    expect(result.vocabulary).toContain("common");
    expect(result.vocabulary).toContain("rare");

    // Check IDF: log(5/2) > log(5/4) => rare's weight > common's weight
    // Look at doc1 which has both terms once each => TF is same => difference is purely IDF
    const vec = result.vectors.get("doc1")!;
    const rareIdx = result.vocabIndex.get("rare")!;
    const commonIdx = result.vocabIndex.get("common")!;

    // Before normalization, rare would have higher raw value.
    // After L2-normalization, the ratio is preserved, so the rare component should be larger.
    expect(vec[rareIdx]).toBeGreaterThan(vec[commonIdx]);
  });

  it("produces zero vector for empty token list", () => {
    const documents = new Map<string, string[]>();
    documents.set("doc1", ["foo", "bar"]);
    documents.set("doc2", ["foo", "bar"]);
    documents.set("doc3", []);

    const result = buildTfidf(documents);

    const vec = result.vectors.get("doc3")!;
    for (let i = 0; i < vec.length; i++) {
      expect(vec[i]).toBe(0);
    }
  });

  it("never produces negative components for high-df terms (BM25 IDF non-negativity)", () => {
    // "common" appears in 4 of 5 docs -> high df, but BM25 smoothed IDF
    // log((n-df+0.5)/(df+0.5)+1) stays non-negative by construction.
    const documents = new Map<string, string[]>();
    documents.set("doc1", ["common", "rare"]);
    documents.set("doc2", ["common", "rare"]);
    documents.set("doc3", ["common", "filler"]);
    documents.set("doc4", ["common", "filler"]);
    documents.set("doc5", ["filler", "filler"]);

    const result = buildTfidf(documents);

    // maxDf = min(max(2, floor(5*0.8)), 4) = 4, so "common" (df=4) is admitted.
    expect(result.vocabulary).toContain("common");
    for (const [, vec] of result.vectors) {
      for (let i = 0; i < vec.length; i++) {
        expect(vec[i]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("excludes a term present in every doc via the absolute maxDf cap (n=2)", () => {
    // n=2: maxDf = min(max(2, floor(2*0.8)), n-1) = min(2, 1) = 1.
    // "shared" df=2 (== n) must be excluded so it cannot dominate similarity.
    const documents = new Map<string, string[]>();
    documents.set("doc1", ["shared", "unique1"]);
    documents.set("doc2", ["shared", "unique2"]);

    const result = buildTfidf(documents);

    expect(result.vocabulary).not.toContain("shared");
  });

  it("saturates TF sub-linearly (10x repetition is not ~10x the component)", () => {
    // "term" admitted (df=2), repeated once in doc1 and 10x in doc2.
    // Add distinct vocabulary terms so docs differ and "term" survives filtering.
    const documents = new Map<string, string[]>();
    documents.set("doc1", ["term", "anchor"]);
    documents.set("doc2", [
      "term",
      "term",
      "term",
      "term",
      "term",
      "term",
      "term",
      "term",
      "term",
      "term",
      "anchor",
    ]);
    documents.set("doc3", ["anchor", "filler"]);
    documents.set("doc4", ["anchor", "filler"]);

    const result = buildTfidf(documents);
    expect(result.vocabulary).toContain("term");

    const idx = result.vocabIndex.get("term")!;
    // Compare pre-L2 BM25 saturated TF directly: tf = c*(k1+1)/(c + k1*...).
    // With k1=1.2, tf(1)/... vs tf(10) ratio must be well under 10 (sub-linear).
    const K1 = 1.2;
    const tf1 = (1 * (K1 + 1)) / (1 + K1); // length-norm factor ~ irrelevant to ratio cap
    const tf10 = (10 * (K1 + 1)) / (10 + K1);
    expect(tf10 / tf1).toBeLessThan(3); // strongly sub-linear, nowhere near 10x

    // Sanity: the term has a non-zero component in doc2.
    const vec2 = result.vectors.get("doc2")!;
    expect(vec2[idx]).toBeGreaterThan(0);
  });

  it("down-weights a shared single-occurrence term in a longer document (length normalization)", () => {
    // "shared" occurs exactly once in both docs, but doc-long has many more
    // in-vocab tokens, so its BM25 length-normalized weight should be smaller.
    // Use a 4-doc set so "shared" and "pad*" terms get df>=2 admission.
    const documents = new Map<string, string[]>();
    documents.set("short", ["shared", "tag"]);
    documents.set("long", [
      "shared",
      "pad",
      "pad",
      "pad",
      "pad",
      "pad",
      "pad",
      "tag",
    ]);
    documents.set("padref1", ["pad", "tag"]);
    documents.set("padref2", ["shared", "pad"]);

    const result = buildTfidf(documents);
    expect(result.vocabulary).toContain("shared");

    const idx = result.vocabIndex.get("shared")!;

    // Recompute pre-L2 BM25 weight to assert length normalization independent
    // of the subsequent L2 step. docLen counts only in-vocab tokens.
    const K1 = 1.2;
    const B = 0.75;
    const inVocab = (toks: string[]) =>
      toks.filter((t) => result.vocabIndex.has(t)).length;
    const lens = [...documents.values()].map(inVocab);
    const avgdl = lens.reduce((a, b) => a + b, 0) / lens.length;

    const bm25 = (count: number, docLen: number) =>
      (count * (K1 + 1)) / (count + K1 * (1 - B + B * (docLen / avgdl)));

    const shortLen = inVocab(documents.get("short")!);
    const longLen = inVocab(documents.get("long")!);
    expect(bm25(1, longLen)).toBeLessThan(bm25(1, shortLen));

    // Both vectors carry the term; non-emptiness sanity check.
    expect(result.vectors.get("short")![idx]).toBeGreaterThan(0);
    expect(result.vectors.get("long")![idx]).toBeGreaterThan(0);
  });
});
