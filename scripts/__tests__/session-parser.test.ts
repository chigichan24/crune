import { describe, it, expect } from "vitest";
import { inferProjectName } from "../analyze-sessions.js";

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
