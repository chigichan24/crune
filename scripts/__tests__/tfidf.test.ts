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
    // "anchor" needs df>=2 but must NOT be ubiquitous (else the maxDf cap
    // excludes it); "extra" gives it a non-member doc and keeps df>=2.
    documents.set("doc3", ["anchor", "extra"]);
    documents.set("doc4", ["extra", "filler"]);

    const result = buildTfidf(documents);
    expect(result.vocabulary).toContain("term");
    expect(result.vocabulary).toContain("anchor");

    const idx = result.vocabIndex.get("term")!;

    // Assert on the ACTUAL produced vectors, not a re-implemented BM25 formula.
    // doc1 and doc2 both contain "term" + "anchor"; doc2 repeats "term" 10x
    // while doc1 has it once. "anchor" occurs once in both, so within each
    // L2-normalized vector the term/anchor ratio reflects only BM25's TF
    // saturation. A linear (non-saturating) scheme would make doc2's
    // term/anchor ratio ~10x doc1's; saturation keeps it far below the 10x
    // count ratio.
    const anchorIdx = result.vocabIndex.get("anchor")!;
    const vec1 = result.vectors.get("doc1")!;
    const vec2 = result.vectors.get("doc2")!;

    const ratio1 = vec1[idx] / vec1[anchorIdx];
    const ratio2 = vec2[idx] / vec2[anchorIdx];

    // Both terms present in both docs.
    expect(vec1[idx]).toBeGreaterThan(0);
    expect(vec2[idx]).toBeGreaterThan(0);

    // More repetitions => larger relative weight, but strongly sub-linear:
    // the produced ratio grows far less than the 10x count ratio.
    expect(ratio2).toBeGreaterThan(ratio1);
    expect(ratio2 / ratio1).toBeLessThan(3); // nowhere near 10x
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

    // Assert directly on the ACTUAL produced vectors. "shared" occurs exactly
    // once in both docs, so a length-insensitive scheme would weight it
    // similarly; BM25's document-length normalization down-weights the term in
    // the longer document. The doc set is constructed so this relationship
    // survives the subsequent L2 normalization step (verified deterministic).
    const shortShared = result.vectors.get("short")![idx];
    const longShared = result.vectors.get("long")![idx];

    expect(shortShared).toBeGreaterThan(0);
    expect(longShared).toBeGreaterThan(0);
    expect(longShared).toBeLessThan(shortShared);
  });
});
