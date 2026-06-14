import { describe, it, expect } from "vitest";
import {
  buildSynthesisPrompt,
  buildHumanFeedbackSection,
  type SynthesisRequest,
  type HumanFeedbackSignal,
} from "../skill-synthesizer.js";
import { parseArgs } from "../analyze-sessions.js";

function baseRequest(): SynthesisRequest {
  return {
    skillCandidate: { topicId: "t1", reusabilityScore: 0.5, skillMarkdown: "# heuristic" },
    topicNode: {
      id: "t1",
      label: "Bugfix",
      keywords: ["fix", "bug"],
      dominantRole: "user-driven",
      projects: ["p"],
      project: "p",
      sessionCount: 2,
      totalDurationMinutes: 30,
      totalToolCalls: 10,
      toolSignature: [{ tool: "Edit", weight: 0.5 }],
      representativePrompts: ["fix the bug"],
      suggestedPrompt: "fix",
      reusabilityScore: {
        overall: 0.5,
        frequency: 0.5,
        timeCost: 0.5,
        crossProjectScore: 0,
        recency: 0.5,
      },
      betweennessCentrality: 0,
      degreeCentrality: 0,
    },
  };
}

const reusable: HumanFeedbackSignal = {
  sessionId: "s1",
  turnId: 1,
  snippet: "User: write a test first / Claude: ok",
  note: "great TDD example",
  reusable: true,
  antiPattern: false,
};

const antiPattern: HumanFeedbackSignal = {
  sessionId: "s1",
  turnId: 5,
  snippet: "User: just force push / Claude: done",
  note: "",
  reusable: false,
  antiPattern: true,
};

const bookmarkOnly: HumanFeedbackSignal = {
  sessionId: "s2",
  turnId: 0,
  snippet: "User: interesting / Claude: yes",
  note: "",
  reusable: false,
  antiPattern: false,
};

describe("buildHumanFeedbackSection", () => {
  it("returns empty string when there is no feedback", () => {
    expect(buildHumanFeedbackSection([])).toBe("");
  });

  it("marks reusable turns as VALUABLE evidence to replicate", () => {
    const section = buildHumanFeedbackSection([reusable]);
    expect(section).toContain("Human-Flagged Moments");
    expect(section).toContain("Reusable");
    expect(section).toContain("replicate");
    expect(section).toContain("write a test first");
    expect(section).toContain("great TDD example");
  });

  it("marks anti-pattern turns as a counter-example to avoid", () => {
    const section = buildHumanFeedbackSection([antiPattern]);
    expect(section).toContain("Anti-Pattern");
    expect(section).toMatch(/avoid/i);
    expect(section).toContain("force push");
  });

  it("groups bookmark-only turns separately as noteworthy", () => {
    const section = buildHumanFeedbackSection([bookmarkOnly]);
    expect(section).toContain("Bookmarked");
    expect(section).not.toContain("Reusable");
    expect(section).not.toContain("Anti-Pattern");
  });

  it("renders a placeholder when the snippet is unavailable", () => {
    const section = buildHumanFeedbackSection([{ ...reusable, snippet: null }]);
    expect(section).toContain("(snippet unavailable)");
  });
});

describe("buildSynthesisPrompt human feedback gating", () => {
  it("omits the section entirely when humanFeedback is absent", () => {
    const prompt = buildSynthesisPrompt(baseRequest());
    expect(prompt).not.toContain("Human-Flagged Moments");
  });

  it("omits the section when humanFeedback is an empty array", () => {
    const prompt = buildSynthesisPrompt({ ...baseRequest(), humanFeedback: [] });
    expect(prompt).not.toContain("Human-Flagged Moments");
  });

  it("includes the reusable/anti-pattern guidance only when humanFeedback is present", () => {
    const prompt = buildSynthesisPrompt({ ...baseRequest(), humanFeedback: [reusable, antiPattern] });
    expect(prompt).toContain("Human-Flagged Moments");
    expect(prompt).toContain("Reusable");
    expect(prompt).toContain("Anti-Pattern");
    // A task rule reinforcing the human signal priority is appended.
    expect(prompt).toMatch(/Prioritize the \*\*Human-Flagged Moments\*\*/);
  });
});

describe("parseArgs human feedback flags", () => {
  it("defaults useHumanFeedback OFF and feedback file to public/data/feedback.json", () => {
    const args = parseArgs([]);
    expect(args.useHumanFeedback).toBe(false);
    expect(args.feedbackFile).toMatch(/public\/data\/feedback\.json$/);
  });

  it("enables with --use-human-feedback", () => {
    expect(parseArgs(["--use-human-feedback"]).useHumanFeedback).toBe(true);
  });

  it("overrides the path with --feedback-file", () => {
    expect(parseArgs(["--feedback-file", "/tmp/fb.json"]).feedbackFile).toBe("/tmp/fb.json");
  });
});
