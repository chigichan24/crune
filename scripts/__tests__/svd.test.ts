import { describe, it, expect } from "vitest";
import {
  buildCombinedMatrix,
  truncatedSvd,
} from "../knowledge-graph-builder.js";

describe("buildCombinedMatrix", () => {
  it("output has correct dimensions (totalDim = textDim + toolDim + structDim, rows = sessionIds.length)", () => {
    const sessionIds = ["s1", "s2", "s3"];
    const textDim = 4;
    const toolDim = 3;
    const structDim = 2;

    const textVectors = new Map<string, Float64Array>([
      ["s1", new Float64Array([1, 0, 0, 1])],
      ["s2", new Float64Array([0, 1, 1, 0])],
      ["s3", new Float64Array([1, 1, 0, 0])],
    ]);
    const toolVectors = new Map<string, Float64Array>([
      ["s1", new Float64Array([1, 0, 0])],
      ["s2", new Float64Array([0, 1, 0])],
      ["s3", new Float64Array([0, 0, 1])],
    ]);
    const structVectors = new Map<string, Float64Array>([
      ["s1", new Float64Array([1, 0])],
      ["s2", new Float64Array([0, 1])],
      ["s3", new Float64Array([1, 1])],
    ]);

    const { matrix, totalDim } = buildCombinedMatrix(
      sessionIds,
      textVectors,
      toolVectors,
      structVectors,
      textDim,
      toolDim,
      structDim
    );

    expect(totalDim).toBe(textDim + toolDim + structDim);
    expect(matrix.length).toBe(sessionIds.length);
    for (const row of matrix) {
      expect(row.length).toBe(totalDim);
    }
  });

  it("weights are applied: text portion scaled by sqrt(0.5), tool/struct by sqrt(0.25)", () => {
    const sessionIds = ["s1"];
    const textDim = 2;
    const toolDim = 2;
    const structDim = 2;

    const textVectors = new Map<string, Float64Array>([
      ["s1", new Float64Array([1, 2])],
    ]);
    const toolVectors = new Map<string, Float64Array>([
      ["s1", new Float64Array([3, 4])],
    ]);
    const structVectors = new Map<string, Float64Array>([
      ["s1", new Float64Array([5, 6])],
    ]);

    const { matrix } = buildCombinedMatrix(
      sessionIds,
      textVectors,
      toolVectors,
      structVectors,
      textDim,
      toolDim,
      structDim
    );

    const row = matrix[0];
    const sqrtText = Math.sqrt(0.5);
    const sqrtTool = Math.sqrt(0.25);
    const sqrtStruct = Math.sqrt(0.25);

    // Text portion (indices 0-1)
    expect(row[0]).toBeCloseTo(1 * sqrtText);
    expect(row[1]).toBeCloseTo(2 * sqrtText);
    // Tool portion (indices 2-3)
    expect(row[2]).toBeCloseTo(3 * sqrtTool);
    expect(row[3]).toBeCloseTo(4 * sqrtTool);
    // Struct portion (indices 4-5)
    expect(row[4]).toBeCloseTo(5 * sqrtStruct);
    expect(row[5]).toBeCloseTo(6 * sqrtStruct);
  });
});

describe("truncatedSvd", () => {
  // Helper: create a test matrix with 5 sessions and 10 features
  function makeTestData() {
    const sessionIds = ["s1", "s2", "s3", "s4", "s5"];
    const totalDim = 10;
    const matrix: Float64Array[] = [];

    // Create distinct patterns so SVD has structure to find
    const patterns = [
      [1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      [0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
      [1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
      [0, 0, 1, 1, 0, 0, 1, 1, 0, 0],
      [1, 0.5, 0.5, 0, 1, 0.5, 0.5, 0, 1, 0.5],
    ];
    for (const p of patterns) {
      matrix.push(new Float64Array(p));
    }

    return { sessionIds, matrix, totalDim };
  }

  it("5 sessions of 10-dim features, k=3: returns sessionVectors with 3 dimensions", () => {
    const { sessionIds, matrix, totalDim } = makeTestData();
    const result = truncatedSvd(sessionIds, matrix, totalDim, 3);

    expect(result.k).toBe(3);
    expect(result.sigma.length).toBe(3);
    expect(result.sessionVectors.size).toBe(5);

    for (const [, vec] of result.sessionVectors) {
      expect(vec.length).toBe(3);
    }
  });

  it("singular values are non-negative and in descending order", () => {
    const { sessionIds, matrix, totalDim } = makeTestData();
    const result = truncatedSvd(sessionIds, matrix, totalDim, 3);

    for (let i = 0; i < result.sigma.length; i++) {
      expect(result.sigma[i]).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < result.sigma.length; i++) {
      expect(result.sigma[i - 1]).toBeGreaterThanOrEqual(result.sigma[i]);
    }
  });

  it("sessionVectors are L2-normalized (magnitude ~= 1.0)", () => {
    const { sessionIds, matrix, totalDim } = makeTestData();
    const result = truncatedSvd(sessionIds, matrix, totalDim, 3);

    for (const [, vec] of result.sessionVectors) {
      let norm = 0;
      for (let i = 0; i < vec.length; i++) {
        norm += vec[i] * vec[i];
      }
      norm = Math.sqrt(norm);
      expect(norm).toBeCloseTo(1.0, 4);
    }
  });
});
