import { describe, it, expect } from "vitest";
import { parseCliArgs } from "../cli.js";

describe("parseCliArgs", () => {
  it("returns defaults when no args given", () => {
    const result = parseCliArgs(["node", "cli.ts"]);
    expect(result.sessionsDir).toMatch(/\.claude\/projects$/);
    expect(result.outputDir).toMatch(/\.claude\/skills$/);
    expect(result.count).toBe(5);
    expect(result.model).toBeUndefined();
    expect(result.skipSynthesis).toBe(false);
    expect(result.dryRun).toBe(false);
  });

  it("sets sessionsDir with --sessions-dir", () => {
    const result = parseCliArgs(["node", "cli.ts", "--sessions-dir", "/tmp/sessions"]);
    expect(result.sessionsDir).toBe("/tmp/sessions");
  });

  it("sets outputDir with --output-dir", () => {
    const result = parseCliArgs(["node", "cli.ts", "--output-dir", "/tmp/out"]);
    expect(result.outputDir).toBe("/tmp/out");
  });

  it("sets count with --count", () => {
    const result = parseCliArgs(["node", "cli.ts", "--count", "3"]);
    expect(result.count).toBe(3);
  });

  it("clamps count to minimum of 1", () => {
    const result = parseCliArgs(["node", "cli.ts", "--count", "0"]);
    expect(result.count).toBe(1);
  });

  it("sets model with --model", () => {
    const result = parseCliArgs(["node", "cli.ts", "--model", "haiku"]);
    expect(result.model).toBe("haiku");
  });

  it("sets skipSynthesis with --skip-synthesis", () => {
    const result = parseCliArgs(["node", "cli.ts", "--skip-synthesis"]);
    expect(result.skipSynthesis).toBe(true);
  });

  it("sets dryRun with --dry-run", () => {
    const result = parseCliArgs(["node", "cli.ts", "--dry-run"]);
    expect(result.dryRun).toBe(true);
  });

  it("handles multiple flags combined", () => {
    const result = parseCliArgs([
      "node",
      "cli.ts",
      "--sessions-dir",
      "/tmp/sessions",
      "--output-dir",
      "/tmp/out",
      "--count",
      "10",
      "--model",
      "sonnet",
      "--skip-synthesis",
      "--dry-run",
    ]);
    expect(result.sessionsDir).toBe("/tmp/sessions");
    expect(result.outputDir).toBe("/tmp/out");
    expect(result.count).toBe(10);
    expect(result.model).toBe("sonnet");
    expect(result.skipSynthesis).toBe(true);
    expect(result.dryRun).toBe(true);
  });
});
