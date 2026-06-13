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

  it("defaults evalThreshold to 60", () => {
    expect(parseArgs([]).evalThreshold).toBe(60);
  });

  it("sets evalThreshold with --eval-threshold", () => {
    expect(parseArgs(["--eval-threshold", "75"]).evalThreshold).toBe(75);
  });

  it("clamps evalThreshold into [0, 100]", () => {
    expect(parseArgs(["--eval-threshold", "150"]).evalThreshold).toBe(100);
    expect(parseArgs(["--eval-threshold", "-5"]).evalThreshold).toBe(0);
  });

  it("falls back to 60 for non-numeric --eval-threshold", () => {
    expect(parseArgs(["--eval-threshold", "abc"]).evalThreshold).toBe(60);
  });

  it("keeps eval flags independent from synthesize flags", () => {
    const args = parseArgs(["--skip-synthesize", "--eval-model", "sonnet"]);
    expect(args.skipSynthesis).toBe(true);
    expect(args.skipEval).toBe(false);
    expect(args.evalModel).toBe("sonnet");
  });
});
