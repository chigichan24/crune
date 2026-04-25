import { describe, it, expect } from "vitest";
import {
  splitCamelCase,
  extractPathTokens,
  isNoiseToken,
  tokenize,
} from "../knowledge-graph-builder.js";

describe("splitCamelCase", () => {
  it("splits camelCase into lowercase parts", () => {
    expect(splitCamelCase("camelCase")).toEqual(["camel", "case"]);
  });

  it("splits PascalCase with uppercase acronym prefix", () => {
    expect(splitCamelCase("XMLParser")).toEqual(["xml", "parser"]);
  });

  it("returns single-element array for lowercase word", () => {
    expect(splitCamelCase("lowercase")).toEqual(["lowercase"]);
  });

  it("splits multiple humps", () => {
    expect(splitCamelCase("myVariableName")).toEqual([
      "my",
      "variable",
      "name",
    ]);
  });

  it("handles all-uppercase word", () => {
    const result = splitCamelCase("HTML");
    expect(result).toEqual(["html"]);
  });
});

describe("extractPathTokens", () => {
  it("extracts tokens from a file path", () => {
    const tokens = extractPathTokens("/src/components/App.tsx");
    expect(tokens).toContain("src");
    expect(tokens).toContain("components");
    expect(tokens).toContain("app");
    // Extension should be stripped
    expect(tokens).not.toContain("tsx");
  });

  it("returns empty array when text has no paths", () => {
    expect(extractPathTokens("just some regular text")).toEqual([]);
  });

  it("extracts tokens from multiple paths in text", () => {
    const tokens = extractPathTokens(
      "Edited /src/utils/helpers.ts and /lib/core/Engine.ts"
    );
    expect(tokens).toContain("src");
    expect(tokens).toContain("utils");
    expect(tokens).toContain("helpers");
    expect(tokens).toContain("lib");
    expect(tokens).toContain("core");
    expect(tokens).toContain("engine");
  });

  it("skips short path segments (<=2 chars)", () => {
    const tokens = extractPathTokens("/a/b/component.ts");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("b");
    expect(tokens).toContain("component");
  });
});

describe("isNoiseToken", () => {
  it("returns true for UUID strings", () => {
    expect(isNoiseToken("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("returns true for hex strings of 6+ chars", () => {
    expect(isNoiseToken("abcdef12")).toBe(true);
  });

  it("returns true for pure numbers", () => {
    expect(isNoiseToken("12345")).toBe(true);
  });

  it("returns true for extremely long tokens (>40 chars)", () => {
    expect(isNoiseToken("a".repeat(41))).toBe(true);
  });

  it("returns false for normal words", () => {
    expect(isNoiseToken("valid")).toBe(false);
  });

  it("returns false for short hex-like strings (<6 chars)", () => {
    expect(isNoiseToken("abc")).toBe(false);
  });
});

describe("tokenize", () => {
  it("tokenizes text with camelCase words", () => {
    const tokens = tokenize("refactor camelCaseFunction");
    expect(tokens).toContain("refactor");
    expect(tokens).toContain("camel");
    expect(tokens).toContain("case");
    expect(tokens).toContain("function");
  });

  it("tokenizes text containing file paths", () => {
    const tokens = tokenize("edited /src/components/App.tsx");
    expect(tokens).toContain("src");
    expect(tokens).toContain("components");
    expect(tokens).toContain("app");
  });

  it("excludes stop words", () => {
    const tokens = tokenize("the quick brown fox in the forest");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("in");
    expect(tokens).toContain("quick");
    expect(tokens).toContain("brown");
    expect(tokens).toContain("fox");
    expect(tokens).toContain("forest");
  });

  it("skips URLs", () => {
    const tokens = tokenize("visit http://example.com/path for details");
    // tokenize skips words starting with "http" but URL parts split by / may remain
    expect(tokens).not.toContain("http");
    expect(tokens).not.toContain("http://example.com/path");
  });

  it("handles kebab-case and snake_case", () => {
    const tokens = tokenize("my-component some_variable");
    expect(tokens).toContain("component");
    // "some" is a stop word, so it's excluded
    expect(tokens).not.toContain("some");
    expect(tokens).toContain("variable");
  });

  it("segments Japanese text into meaningful word-ish units (Issue #29)", () => {
    // Before this fix, the entire Japanese run collapsed into one token
    // because `\s+` cannot split text without whitespace. With
    // Intl.Segmenter, common kanji compounds like 分析 / 実行 surface as
    // individual tokens.
    const tokens = tokenize("セッションの分析を実行する");
    expect(tokens).toContain("セッション");
    expect(tokens).toContain("分析");
    expect(tokens).toContain("実行");
    // The whole sentence should NOT survive as one giant token.
    expect(tokens).not.toContain("セッションの分析を実行する");
  });

  it("segments mixed Japanese / English text on both sides", () => {
    const tokens = tokenize("TypeScriptの型エラーを修正");
    // English side: lowercased CamelCase split
    expect(tokens).toContain("type");
    expect(tokens).toContain("script");
    // Japanese side: 2-char kanji compounds preserved
    expect(tokens).toContain("エラー");
    expect(tokens).toContain("修正");
  });

  it("does not collapse a long Japanese paragraph into a single oversized token (Issue #29 regression)", () => {
    // Reproduces the exact bug from #29: the issue's example string used
    // to land in the vocabulary as one token. After the fix every token
    // should be word-sized, not paragraph-sized.
    const text =
      "セッションの分析を実行する。次にテストを書く。" +
      "実装が完了したらリファクタリングを行い、最後にコードレビューを依頼する。";
    const tokens = tokenize(text);
    expect(tokens.length).toBeGreaterThan(3);
    for (const t of tokens) {
      expect(t.length).toBeLessThanOrEqual(20);
    }
    // The whole paragraph must not survive as a single token.
    expect(tokens).not.toContain(text);
  });

  it("filters out noise tokens", () => {
    const tokens = tokenize(
      "commit 550e8400-e29b-41d4-a716-446655440000 was good"
    );
    expect(tokens).not.toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(tokens).toContain("commit");
    expect(tokens).toContain("good");
  });

  it("filters tokens with 2 or fewer characters", () => {
    const tokens = tokenize("I am ok to go");
    expect(tokens).not.toContain("am");
    expect(tokens).not.toContain("ok");
    expect(tokens).not.toContain("to");
    expect(tokens).not.toContain("go");
  });
});

describe("tokenize - large input regression (Issue #18)", () => {
  // Real Claude Code sessions can contain `ls -R` / `find` / `tree` dumps
  // with hundreds of thousands of path segments. `tokens.push(...arr)` on
  // such an array hits V8's argument count limit and throws
  // `RangeError: Maximum call stack size exceeded` even though it is not
  // recursion. See https://github.com/chigichan24/crune/issues/18.
  it("extractPathTokens does not throw on a huge corpus of file paths", () => {
    const pathSegments = Array.from(
      { length: 100_000 },
      (_, i) => `/dir${i}/file${i}.ts`
    );
    const text = pathSegments.join(" ");
    expect(() => extractPathTokens(text)).not.toThrow();
  });

  it("tokenize does not throw on a huge corpus of file paths", () => {
    const pathSegments = Array.from(
      { length: 100_000 },
      (_, i) => `/dir${i}/file${i}.ts`
    );
    const text = pathSegments.join(" ");
    expect(() => tokenize(text)).not.toThrow();
  });
});
