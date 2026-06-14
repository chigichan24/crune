import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  writeEmbeddingIndex,
  readEmbeddingIndex,
} from "../knowledge-graph/embedding-io.js";
import type { EmbedResult } from "../knowledge-graph/embedder.js";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crune-embed-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("writeEmbeddingIndex / readEmbeddingIndex", () => {
  it("round-trips the int8 matrix and metadata byte-for-byte", () => {
    const matrix = Int8Array.from([1, -2, 3, 4, -5, 6]); // 2 chunks × 3 dim
    const result: EmbedResult = {
      model: "test-model",
      dim: 3,
      count: 2,
      scale: 1 / 127,
      matrix,
      chunks: [
        { sessionId: "s1", turnIndex: 0, role: "user-turn", snippet: "hello" },
        { sessionId: "s2", turnIndex: 1, role: "user-turn", snippet: "world" },
      ],
    };
    const dir = mkTmp();
    writeEmbeddingIndex(dir, result);

    const loaded = readEmbeddingIndex(dir);
    expect(loaded.meta.model).toBe("test-model");
    expect(loaded.meta.dim).toBe(3);
    expect(loaded.meta.count).toBe(2);
    expect(loaded.meta.chunks).toHaveLength(2);
    expect(loaded.matrix.length).toBe(6);
    expect(Array.from(loaded.matrix)).toEqual(Array.from(matrix));
  });

  it("throws when the index size does not match meta count*dim", () => {
    const dir = mkTmp();
    const result: EmbedResult = {
      model: "m",
      dim: 4,
      count: 1,
      scale: 1 / 127,
      matrix: Int8Array.from([1, 2, 3, 4]),
      chunks: [{ sessionId: "s1", turnIndex: 0, role: "user-turn", snippet: "x" }],
    };
    writeEmbeddingIndex(dir, result);
    // Corrupt meta to claim a larger count.
    const metaPath = path.join(dir, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    meta.count = 99;
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    expect(() => readEmbeddingIndex(dir)).toThrow(/size mismatch/);
  });
});
