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

  it("handles Japanese text without crashing", () => {
    expect(() => tokenize("セッションの分析を実行する")).not.toThrow();
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
