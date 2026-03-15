import { describe, it, expect } from "vitest";
import { inferProjectName, truncate } from "../analyze-sessions.js";

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
