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
});
