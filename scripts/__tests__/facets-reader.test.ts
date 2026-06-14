import { describe, it, expect } from "vitest";
import type { FacetsData } from "../knowledge-graph-builder.js";
import {
  normalizeGoalCategory,
  helpfulnessToScore,
  aggregateFacetsForTopic,
  buildTopicFacetsSummary,
  attachFacetsSummaries,
} from "../knowledge-graph-builder.js";
import type { FacetsInsightsSummary, TopicNode } from "../knowledge-graph/types.js";

describe("normalizeGoalCategory", () => {
  it("maps feature_implementation → feature", () => {
    expect(normalizeGoalCategory("feature_implementation")).toBe("feature");
  });

  it("maps fix_build_errors → bugfix", () => {
    expect(normalizeGoalCategory("fix_build_errors")).toBe("bugfix");
  });

  it("maps debugging → bugfix", () => {
    expect(normalizeGoalCategory("debugging")).toBe("bugfix");
  });

  it("maps refactoring → refactoring", () => {
    expect(normalizeGoalCategory("refactoring")).toBe("refactoring");
  });

  it("maps code_cleanup → refactoring", () => {
    expect(normalizeGoalCategory("code_cleanup")).toBe("refactoring");
  });

  it("maps documentation_update → documentation", () => {
    expect(normalizeGoalCategory("documentation_update")).toBe("documentation");
  });

  it("maps code_review → review", () => {
    expect(normalizeGoalCategory("code_review")).toBe("review");
  });

  it("maps test_writing → testing", () => {
    expect(normalizeGoalCategory("test_writing")).toBe("testing");
  });

  it("maps ci_setup → ci", () => {
    expect(normalizeGoalCategory("ci_setup")).toBe("ci");
  });

  it("maps git_operations → git_ops", () => {
    expect(normalizeGoalCategory("git_operations")).toBe("git_ops");
  });

  it("maps create_pr → git_ops", () => {
    expect(normalizeGoalCategory("create_pr")).toBe("git_ops");
  });

  it("maps pr_creation → git_ops", () => {
    expect(normalizeGoalCategory("pr_creation")).toBe("git_ops");
  });

  it("maps setup_deployment → setup", () => {
    expect(normalizeGoalCategory("setup_deployment")).toBe("setup");
  });

  it("maps npm_publishing_guidance → setup", () => {
    expect(normalizeGoalCategory("npm_publishing_guidance")).toBe("setup");
  });

  it("maps unknown_category → other", () => {
    expect(normalizeGoalCategory("unknown_category")).toBe("other");
  });

  it("maps quick_question → other", () => {
    expect(normalizeGoalCategory("quick_question")).toBe("other");
  });
});

describe("helpfulnessToScore", () => {
  it("returns 1.0 for essential", () => {
    expect(helpfulnessToScore("essential")).toBe(1.0);
  });

  it("returns 0.8 for very_helpful", () => {
    expect(helpfulnessToScore("very_helpful")).toBe(0.8);
  });

  it("returns 0.5 for moderately_helpful", () => {
    expect(helpfulnessToScore("moderately_helpful")).toBe(0.5);
  });

  it("returns 0.25 for slightly_helpful", () => {
    expect(helpfulnessToScore("slightly_helpful")).toBe(0.25);
  });

  it("returns 0.0 for unhelpful", () => {
    expect(helpfulnessToScore("unhelpful")).toBe(0.0);
  });

  it("returns 0.5 for unknown string", () => {
    expect(helpfulnessToScore("something_else")).toBe(0.5);
  });
});

describe("aggregateFacetsForTopic", () => {
  function makeFacets(overrides: Partial<FacetsData> = {}): FacetsData {
    return {
      sessionId: "s1",
      underlyingGoal: "Implement feature X",
      goalCategories: { feature_implementation: 1 },
      outcome: "fully_achieved",
      claudeHelpfulness: "very_helpful",
      sessionType: "implementation",
      frictionCounts: {},
      frictionDetail: "",
      primarySuccess: "Feature works",
      briefSummary: "Implemented feature X",
      ...overrides,
    };
  }

  it("returns undefined when no sessions have facets", () => {
    const facetsMap = new Map<string, FacetsData>();
    const result = aggregateFacetsForTopic(["s1", "s2"], facetsMap);
    expect(result).toBeUndefined();
  });

  it("aggregates goals from multiple sessions", () => {
    const facetsMap = new Map<string, FacetsData>([
      ["s1", makeFacets({ sessionId: "s1", underlyingGoal: "Goal A" })],
      ["s2", makeFacets({ sessionId: "s2", underlyingGoal: "Goal B" })],
      ["s3", makeFacets({ sessionId: "s3", underlyingGoal: "Goal C" })],
      ["s4", makeFacets({ sessionId: "s4", underlyingGoal: "Goal D" })],
    ]);

    const result = aggregateFacetsForTopic(["s1", "s2", "s3", "s4"], facetsMap);
    expect(result).toBeDefined();
    // max 3 goals
    expect(result!.aggregatedGoals).toHaveLength(3);
    expect(result!.aggregatedGoals).toContain("Goal A");
    expect(result!.aggregatedGoals).toContain("Goal B");
    expect(result!.aggregatedGoals).toContain("Goal C");
  });

  it("computes successRate correctly with mix of achieved and not", () => {
    const facetsMap = new Map<string, FacetsData>([
      ["s1", makeFacets({ sessionId: "s1", outcome: "fully_achieved" })],
      ["s2", makeFacets({ sessionId: "s2", outcome: "mostly_achieved" })],
      ["s3", makeFacets({ sessionId: "s3", outcome: "not_achieved" })],
      ["s4", makeFacets({ sessionId: "s4", outcome: "partially_achieved" })],
    ]);

    const result = aggregateFacetsForTopic(
      ["s1", "s2", "s3", "s4"],
      facetsMap
    );
    expect(result).toBeDefined();
    // 2 out of 4 achieved
    expect(result!.successRate).toBe(0.5);
  });

  it("computes helpfulnessScore correctly", () => {
    const facetsMap = new Map<string, FacetsData>([
      [
        "s1",
        makeFacets({ sessionId: "s1", claudeHelpfulness: "essential" }),
      ],
      [
        "s2",
        makeFacets({ sessionId: "s2", claudeHelpfulness: "unhelpful" }),
      ],
    ]);

    const result = aggregateFacetsForTopic(["s1", "s2"], facetsMap);
    expect(result).toBeDefined();
    // (1.0 + 0.0) / 2 = 0.5
    expect(result!.helpfulnessScore).toBe(0.5);
  });

  it("merges and sorts friction counts", () => {
    const facetsMap = new Map<string, FacetsData>([
      [
        "s1",
        makeFacets({
          sessionId: "s1",
          frictionCounts: { unclear_spec: 3, slow_response: 1 },
        }),
      ],
      [
        "s2",
        makeFacets({
          sessionId: "s2",
          frictionCounts: { unclear_spec: 2, wrong_tool: 5 },
        }),
      ],
    ]);

    const result = aggregateFacetsForTopic(["s1", "s2"], facetsMap);
    expect(result).toBeDefined();
    // unclear_spec: 5, wrong_tool: 5, slow_response: 1
    expect(result!.commonFrictions[0]).toBe("unclear_spec");
    expect(result!.commonFrictions).toContain("wrong_tool");
    expect(result!.commonFrictions).toContain("slow_response");
  });

  it("handles sessions without facets with neutral 0.5 for scores", () => {
    const facetsMap = new Map<string, FacetsData>([
      [
        "s1",
        makeFacets({
          sessionId: "s1",
          outcome: "fully_achieved",
          claudeHelpfulness: "essential",
        }),
      ],
    ]);

    // s2 has no facets — should get 0.5 for both scores
    const result = aggregateFacetsForTopic(["s1", "s2"], facetsMap);
    expect(result).toBeDefined();
    // successRate: (1.0 + 0.5) / 2 = 0.75
    expect(result!.successRate).toBe(0.75);
    // helpfulnessScore: (1.0 + 0.5) / 2 = 0.75
    expect(result!.helpfulnessScore).toBe(0.75);
  });
});

describe("buildTopicFacetsSummary", () => {
  const agg = (over: Partial<FacetsInsightsSummary> = {}): FacetsInsightsSummary => ({
    aggregatedGoals: ["ship the feature"],
    normalizedCategories: ["feature", "testing"],
    successRate: 0.8,
    helpfulnessScore: 0.6,
    commonFrictions: [],
    frictionDetails: [],
    ...over,
  });

  it("maps the compact subset for the UI", () => {
    expect(buildTopicFacetsSummary(agg())).toEqual({
      categories: ["feature", "testing"],
      goals: ["ship the feature"],
      successRate: 0.8,
      helpfulness: 0.6,
    });
  });

  it("returns undefined for no aggregation (no facets matched)", () => {
    expect(buildTopicFacetsSummary(undefined)).toBeUndefined();
  });

  it("returns undefined when there is no category or goal signal", () => {
    expect(
      buildTopicFacetsSummary(agg({ normalizedCategories: [], aggregatedGoals: [] }))
    ).toBeUndefined();
  });

  // The empty-signal guard is AND, not OR: a summary with only one side empty
  // is still kept (pin the semantics so a future `||` regression is caught).
  it("keeps the summary when only categories are empty", () => {
    expect(buildTopicFacetsSummary(agg({ normalizedCategories: [] }))).toEqual({
      categories: [],
      goals: ["ship the feature"],
      successRate: 0.8,
      helpfulness: 0.6,
    });
  });

  it("keeps the summary when only goals are empty", () => {
    expect(buildTopicFacetsSummary(agg({ aggregatedGoals: [] }))).toEqual({
      categories: ["feature", "testing"],
      goals: [],
      successRate: 0.8,
      helpfulness: 0.6,
    });
  });
});

describe("attachFacetsSummaries", () => {
  function node(sessionIds: string[]): TopicNode {
    return { id: "t", sessionIds } as unknown as TopicNode;
  }
  function facets(sessionId: string): FacetsData {
    return {
      sessionId,
      underlyingGoal: "Fix the bug",
      goalCategories: { bug_fix: 1 },
      outcome: "fully_achieved",
      claudeHelpfulness: "very_helpful",
      sessionType: "debugging",
      frictionCounts: {},
      frictionDetail: "",
      primarySuccess: "",
      briefSummary: "",
    };
  }

  it("attaches a summary to topics whose sessions have facets", () => {
    const nodes = [node(["s1", "s2"]), node(["s9"])]; // s9 has no facets
    const map = new Map<string, FacetsData>([["s1", facets("s1")]]);
    attachFacetsSummaries(nodes, map);
    expect(nodes[0].facetsSummary?.categories).toContain("bugfix");
    expect(nodes[1].facetsSummary).toBeUndefined();
  });

  it("is a no-op when the facets map is absent or empty", () => {
    const nodes = [node(["s1"])];
    attachFacetsSummaries(nodes, undefined);
    attachFacetsSummaries(nodes, new Map());
    expect(nodes[0].facetsSummary).toBeUndefined();
  });
});
