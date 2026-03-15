import { describe, it, expect } from "vitest";
import {
  inferProjectName,
  truncate,
  isRealUserMessage,
  isToolResultMessage,
  extractUserPrompt,
  type JsonlLine,
} from "../analyze-sessions.js";

describe("inferProjectName", () => {
  it("extracts org/repo from github-com pattern", () => {
    expect(
      inferProjectName("-Users-kazuki-chigita-src-github-com-chigichan24-crune")
    ).toBe("chigichan24/crune");
  });

  it("extracts org/repo from another github-com path", () => {
    expect(
      inferProjectName("-Users-foo-github-com-org-repo")
    ).toBe("org/repo");
  });

  it("falls back to last 2 segments when no github-com pattern", () => {
    expect(
      inferProjectName("-Users-foo-bar-projects-myapp")
    ).toBe("projects/myapp");
  });

  it("returns dirName as-is for single segment", () => {
    expect(inferProjectName("short")).toBe("short");
  });

  it("returns empty string for empty input", () => {
    expect(inferProjectName("")).toBe("");
  });
});

describe("truncate", () => {
  it("returns unchanged text shorter than limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("returns unchanged text exactly at limit", () => {
    expect(truncate("12345", 5)).toBe("12345");
  });

  it("truncates text longer than limit with ellipsis", () => {
    const result = truncate("hello world", 5);
    expect(result).toBe("hello\u2026");
    expect(result.length).toBe(6);
  });

  it("returns empty string for empty input", () => {
    expect(truncate("", 10)).toBe("");
  });
});

describe("isRealUserMessage", () => {
  it("returns true for plain user message with string content", () => {
    const line: JsonlLine = { type: "user", message: { content: "hello" } };
    expect(isRealUserMessage(line)).toBe(true);
  });

  it("returns false when isMeta is true", () => {
    const line: JsonlLine = { type: "user", isMeta: true, message: { content: "hello" } };
    expect(isRealUserMessage(line)).toBe(false);
  });

  it("returns false when content contains command-name tag", () => {
    const line: JsonlLine = { type: "user", message: { content: "<command-name>foo</command-name>" } };
    expect(isRealUserMessage(line)).toBe(false);
  });

  it("returns false for empty/whitespace content", () => {
    const line: JsonlLine = { type: "user", message: { content: "" } };
    expect(isRealUserMessage(line)).toBe(false);
  });

  it("returns false for assistant type", () => {
    const line: JsonlLine = { type: "assistant", message: { content: "hello" } };
    expect(isRealUserMessage(line)).toBe(false);
  });

  it("returns false when content is array with tool_result", () => {
    const line: JsonlLine = {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "x", content: "result" }] },
    };
    expect(isRealUserMessage(line)).toBe(false);
  });

  it("returns true when content is array with text blocks", () => {
    const line: JsonlLine = {
      type: "user",
      message: { content: [{ type: "text", text: "hello" }] },
    };
    expect(isRealUserMessage(line)).toBe(true);
  });
});

describe("isToolResultMessage", () => {
  it("returns true for user message with tool_result content", () => {
    const line: JsonlLine = {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "x" }] },
    };
    expect(isToolResultMessage(line)).toBe(true);
  });

  it("returns false for user message with string content", () => {
    const line: JsonlLine = { type: "user", message: { content: "hello" } };
    expect(isToolResultMessage(line)).toBe(false);
  });

  it("returns false for assistant message with tool_result content", () => {
    const line: JsonlLine = {
      type: "assistant",
      message: { content: [{ type: "tool_result" }] },
    };
    expect(isToolResultMessage(line)).toBe(false);
  });
});

describe("extractUserPrompt", () => {
  it("returns string content directly", () => {
    const line: JsonlLine = { type: "user", message: { content: "hello world" } };
    expect(extractUserPrompt(line)).toBe("hello world");
  });

  it("joins text blocks from array content", () => {
    const line: JsonlLine = {
      type: "user",
      message: { content: [{ type: "text", text: "first" }, { type: "text", text: "second" }] },
    };
    expect(extractUserPrompt(line)).toBe("first\nsecond");
  });

  it("returns empty string for array with no text blocks", () => {
    const line: JsonlLine = {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "x" }] },
    };
    expect(extractUserPrompt(line)).toBe("");
  });

  it("returns empty string when no content", () => {
    const line: JsonlLine = { type: "user", message: {} };
    expect(extractUserPrompt(line)).toBe("");
  });
});
