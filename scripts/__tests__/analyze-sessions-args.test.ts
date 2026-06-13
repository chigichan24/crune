import { describe, it, expect } from "vitest";
import { parseArgs } from "../analyze-sessions.js";

describe("parseArgs (analyze-sessions)", () => {
  it("defaults eval ON (skipEval false) mirroring synthesize defaults", () => {
    const args = parseArgs([]);
    expect(args.skipEval).toBe(false);
    expect(args.evalModel).toBeUndefined();
    expect(args.skipSynthesis).toBe(false);
  });

  it("sets skipEval with --skip-eval", () => {
    expect(parseArgs(["--skip-eval"]).skipEval).toBe(true);
  });

  it("sets evalModel with --eval-model", () => {
    expect(parseArgs(["--eval-model", "haiku"]).evalModel).toBe("haiku");
  });

  it("keeps eval flags independent from synthesize flags", () => {
    const args = parseArgs(["--skip-synthesize", "--eval-model", "sonnet"]);
    expect(args.skipSynthesis).toBe(true);
    expect(args.skipEval).toBe(false);
    expect(args.evalModel).toBe("sonnet");
  });
});
