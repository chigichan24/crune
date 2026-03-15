import { describe, it, expect } from "vitest";
import { buildDistillationPrompt } from "../skill-server.js";

// Minimal mock TopicNode
function makeTopicNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "topic-1",
    label: "Test Topic",
    keywords: ["testing", "mock"],
    dominantRole: "code",
    projects: ["project-a"],
    project: "project-a",
    sessionCount: 5,
    totalDurationMinutes: 120,
    totalToolCalls: 50,
    toolSignature: [{ tool: "Bash", weight: 0.6 }, { tool: "Read", weight: 0.4 }],
    representativePrompts: ["Run tests", "Check output"],
    suggestedPrompt: "Run tests and check output",
    reusabilityScore: { overall: 0.8, frequency: 0.7, timeCost: 0.9, crossProjectScore: 0.5, recency: 0.8 },
    betweennessCentrality: 0.01,
    degreeCentrality: 0.1,
    ...overrides,
  };
}

// Minimal mock SkillCandidate
function makeSkillCandidate(overrides: Record<string, unknown> = {}) {
  return {
    topicId: "topic-1",
    reusabilityScore: 0.8,
    skillMarkdown: "# Test Skill\nDo the thing.",
    ...overrides,
  };
}

describe("buildDistillationPrompt", () => {
  it("should NOT contain Graph Position or Connected Topics without graphContext", () => {
    const prompt = buildDistillationPrompt({
      skillCandidate: makeSkillCandidate(),
      topicNode: makeTopicNode(),
    });

    expect(prompt).not.toContain("## Graph Position");
    expect(prompt).not.toContain("## Connected Topics");
  });

  it("should contain bridge interpretation for high betweenness centrality", () => {
    const prompt = buildDistillationPrompt({
      skillCandidate: makeSkillCandidate(),
      topicNode: makeTopicNode({ betweennessCentrality: 0.25 }),
      graphContext: {
        connectedTopics: [],
        isBridgeTopic: true,
      },
    });

    expect(prompt).toContain("## Graph Position");
    expect(prompt).toContain("critical bridge topic connecting multiple knowledge domains");
    expect(prompt).toContain("bridge topic in the knowledge graph");
  });

  it("should contain bridge interpretation for moderate betweenness", () => {
    const prompt = buildDistillationPrompt({
      skillCandidate: makeSkillCandidate(),
      topicNode: makeTopicNode({ betweennessCentrality: 0.1 }),
      graphContext: {
        connectedTopics: [],
        isBridgeTopic: false,
      },
    });

    expect(prompt).toContain("bridges several knowledge domains");
  });

  it("should contain hub interpretation for high degree centrality", () => {
    const prompt = buildDistillationPrompt({
      skillCandidate: makeSkillCandidate(),
      topicNode: makeTopicNode({ betweennessCentrality: 0.01, degreeCentrality: 0.6 }),
      graphContext: {
        connectedTopics: [],
        isBridgeTopic: false,
      },
    });

    expect(prompt).toContain("hub topic connected to many other topics");
  });

  it("should contain isolated interpretation for zero degree centrality", () => {
    const prompt = buildDistillationPrompt({
      skillCandidate: makeSkillCandidate(),
      topicNode: makeTopicNode({ betweennessCentrality: 0.01, degreeCentrality: 0 }),
      graphContext: {
        connectedTopics: [],
        isBridgeTopic: false,
      },
    });

    expect(prompt).toContain("isolated topic with no connections");
  });

  it("should contain peripheral interpretation for low centrality values", () => {
    const prompt = buildDistillationPrompt({
      skillCandidate: makeSkillCandidate(),
      topicNode: makeTopicNode({ betweennessCentrality: 0.01, degreeCentrality: 0.1 }),
      graphContext: {
        connectedTopics: [],
        isBridgeTopic: false,
      },
    });

    expect(prompt).toContain("peripheral topic");
  });

  it("should contain Prerequisite and Follow-up for workflow-continuation edges", () => {
    const prompt = buildDistillationPrompt({
      skillCandidate: makeSkillCandidate(),
      topicNode: makeTopicNode(),
      graphContext: {
        connectedTopics: [
          {
            id: "topic-2",
            label: "Setup Environment",
            keywords: ["setup", "env"],
            edgeType: "workflow-continuation",
            strength: 0.85,
            direction: "incoming" as const,
          },
          {
            id: "topic-3",
            label: "Deploy App",
            keywords: ["deploy", "production"],
            edgeType: "workflow-continuation",
            strength: 0.75,
            direction: "outgoing" as const,
          },
        ],
        isBridgeTopic: false,
      },
    });

    expect(prompt).toContain("## Connected Topics");
    expect(prompt).toContain("Prerequisite: Setup Environment [setup, env] (strength: 0.85)");
    expect(prompt).toContain("Follow-up: Deploy App [deploy, production] (strength: 0.75)");
    expect(prompt).toContain("requires");
    expect(prompt).toContain("next");
    expect(prompt).toContain("frontmatter");
  });

  it("should contain all edge type groups with mixed edge types", () => {
    const prompt = buildDistillationPrompt({
      skillCandidate: makeSkillCandidate(),
      topicNode: makeTopicNode(),
      graphContext: {
        connectedTopics: [
          {
            id: "t-wf",
            label: "Workflow Prev",
            keywords: ["wf"],
            edgeType: "workflow-continuation",
            strength: 0.9,
            direction: "incoming" as const,
          },
          {
            id: "t-sm",
            label: "Shared Module Topic",
            keywords: ["shared"],
            edgeType: "shared-module",
            strength: 0.7,
            direction: "outgoing" as const,
          },
          {
            id: "t-cp",
            label: "Cross Project Topic",
            keywords: ["cross"],
            edgeType: "cross-project-bridge",
            strength: 0.6,
            direction: "outgoing" as const,
          },
          {
            id: "t-ss",
            label: "Similar Topic",
            keywords: ["similar"],
            edgeType: "semantic-similarity",
            strength: 0.5,
            direction: "outgoing" as const,
          },
        ],
        isBridgeTopic: false,
      },
    });

    expect(prompt).toContain("Prerequisite: Workflow Prev [wf] (strength: 0.9)");
    expect(prompt).toContain("Related (shared files): Shared Module Topic [shared]");
    expect(prompt).toContain("Cross-project link: Cross Project Topic [cross]");
    expect(prompt).toContain("Similar topic (differentiate from): Similar Topic [similar]");
  });

  it("should contain community label and member count", () => {
    const prompt = buildDistillationPrompt({
      skillCandidate: makeSkillCandidate(),
      topicNode: makeTopicNode(),
      graphContext: {
        connectedTopics: [],
        community: { label: "Frontend Development", memberCount: 12 },
        isBridgeTopic: false,
      },
    });

    expect(prompt).toContain("Belongs to community: Frontend Development (12 topics)");
  });
});
