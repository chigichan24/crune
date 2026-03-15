import { describe, it, expect } from "vitest";
import {
  inferProjectName,
  truncate,
  isRealUserMessage,
  isToolResultMessage,
  extractUserPrompt,
  buildTurns,
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

describe("buildTurns", () => {
  it("returns empty array for empty input", () => {
    expect(buildTurns([])).toEqual([]);
  });

  it("creates 1 turn from single user + assistant", () => {
    const lines: JsonlLine[] = [
      { type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "hello" } },
      { type: "assistant", message: { content: [{ type: "text", text: "hi there" }], model: "claude-sonnet" } },
    ];
    const turns = buildTurns(lines);
    expect(turns).toHaveLength(1);
    expect(turns[0].turnIndex).toBe(0);
    expect(turns[0].userPrompt).toBe("hello");
    expect(turns[0].timestamp).toBe("2026-01-01T00:00:00Z");
    expect(turns[0].assistantTexts).toEqual(["hi there"]);
    expect(turns[0].model).toBe("claude-sonnet");
  });

  it("creates multiple turns with correct turnIndex", () => {
    const lines: JsonlLine[] = [
      { type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "first" } },
      { type: "assistant", message: { content: [{ type: "text", text: "reply1" }] } },
      { type: "user", timestamp: "2026-01-01T00:01:00Z", message: { content: "second" } },
      { type: "assistant", message: { content: [{ type: "text", text: "reply2" }] } },
    ];
    const turns = buildTurns(lines);
    expect(turns).toHaveLength(2);
    expect(turns[0].turnIndex).toBe(0);
    expect(turns[0].userPrompt).toBe("first");
    expect(turns[1].turnIndex).toBe(1);
    expect(turns[1].userPrompt).toBe("second");
  });

  it("populates toolCalls from tool_use blocks", () => {
    const lines: JsonlLine[] = [
      { type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "do something" } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/tmp/test.ts" } },
          ],
        },
      },
    ];
    const turns = buildTurns(lines);
    expect(turns[0].toolCalls).toHaveLength(1);
    expect(turns[0].toolCalls[0].toolUseId).toBe("tu1");
    expect(turns[0].toolCalls[0].toolName).toBe("Read");
    expect(turns[0].toolCalls[0].input).toEqual({ file_path: "/tmp/test.ts" });
  });

  it("matches tool_result to toolCall by tool_use_id", () => {
    const lines: JsonlLine[] = [
      { type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "read file" } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/tmp/a.ts" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu1", content: "file contents here" }],
        },
      },
    ];
    const turns = buildTurns(lines);
    expect(turns[0].toolCalls[0].result).toBe("file contents here");
  });

  it("captures thinking blocks in assistantThinking", () => {
    const lines: JsonlLine[] = [
      { type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "think" } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "let me consider..." },
            { type: "text", text: "here is my answer" },
          ],
        },
      },
    ];
    const turns = buildTurns(lines);
    expect(turns[0].assistantThinking).toHaveLength(1);
    expect(turns[0].assistantThinking[0]).toBe("let me consider...");
  });

  it("skips system and file-history-snapshot lines", () => {
    const lines: JsonlLine[] = [
      { type: "system", message: { content: "system init" } },
      { type: "file-history-snapshot", snapshot: { timestamp: "2026-01-01T00:00:00Z" } },
      { type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "hello" } },
      { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } },
    ];
    const turns = buildTurns(lines);
    expect(turns).toHaveLength(1);
    expect(turns[0].userPrompt).toBe("hello");
  });

  it("truncates Write tool_use content and adds contentLength", () => {
    const longContent = "x".repeat(1000);
    const lines: JsonlLine[] = [
      { type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "write file" } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu1", name: "Write", input: { file_path: "/tmp/out.ts", content: longContent } },
          ],
        },
      },
    ];
    const turns = buildTurns(lines);
    const tc = turns[0].toolCalls[0];
    expect(tc.toolName).toBe("Write");
    expect((tc.input.content as string).length).toBeLessThan(longContent.length);
    expect(tc.input.contentLength).toBe(1000);
  });
});
