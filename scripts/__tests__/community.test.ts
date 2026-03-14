import { describe, it, expect } from "vitest";
import { louvainDetection, brandesBetweenness } from "../knowledge-graph-builder.js";
import type { TopicNode, TopicEdge } from "../knowledge-graph-builder.js";

function makeTopicNode(id: string, project = "default-project"): TopicNode {
  return {
    id,
    label: `Topic ${id}`,
    keywords: [],
    project,
    projects: [project],
    sessionIds: [],
    sessionCount: 0,
    totalDurationMinutes: 0,
    totalToolCalls: 0,
    firstSeen: "2025-01-01T00:00:00Z",
    lastSeen: "2025-01-01T00:00:00Z",
    betweennessCentrality: 0,
    degreeCentrality: 0,
    communityId: -1,
    representativePrompts: [],
    suggestedPrompt: "",
    toolSignature: [],
    dominantRole: "user-driven",
  };
}

function makeTopicEdge(
  source: string,
  target: string,
  strength = 1.0
): TopicEdge {
  return {
    source,
    target,
    type: "semantic-similarity",
    strength,
    label: `${source}-${target}`,
    signals: {
      semanticSimilarity: strength,
      fileOverlap: 0,
      sessionOverlap: 0,
    },
  };
}

describe("louvainDetection", () => {
  it("returns empty communities and modularity 0 for 0 topics", () => {
    const result = louvainDetection([], []);
    expect(result).toEqual({ communities: [], modularity: 0 });
  });

  it("assigns each isolated topic its own community when there are no edges", () => {
    const topics = [makeTopicNode("A"), makeTopicNode("B"), makeTopicNode("C")];
    const result = louvainDetection(topics, []);

    expect(result.communities).toHaveLength(3);

    // Each community should contain exactly one topic
    const allTopicIds = result.communities.flatMap((c) => c.topicIds);
    expect(allTopicIds.sort()).toEqual(["A", "B", "C"]);
    for (const community of result.communities) {
      expect(community.topicIds).toHaveLength(1);
    }

    // When there are no edges (totalWeight === 0), the function returns
    // individual communities but does not mutate topics[i].communityId.
    // Verify via the returned communities structure instead.
    expect(result.modularity).toBe(0);
    for (const community of result.communities) {
      expect(community).toHaveProperty("id");
      expect(community).toHaveProperty("topicIds");
    }
  });

  it("detects 2 communities for 2 disconnected pairs", () => {
    const topics = [
      makeTopicNode("A"),
      makeTopicNode("B"),
      makeTopicNode("C"),
      makeTopicNode("D"),
    ];
    const edges = [makeTopicEdge("A", "B"), makeTopicEdge("C", "D")];

    const result = louvainDetection(topics, edges);

    expect(result.communities).toHaveLength(2);

    // A and B should be in the same community
    const communityOfA = topics.find((t) => t.id === "A")!.communityId;
    const communityOfB = topics.find((t) => t.id === "B")!.communityId;
    const communityOfC = topics.find((t) => t.id === "C")!.communityId;
    const communityOfD = topics.find((t) => t.id === "D")!.communityId;

    expect(communityOfA).toBe(communityOfB);
    expect(communityOfC).toBe(communityOfD);
    expect(communityOfA).not.toBe(communityOfC);
  });
});

describe("brandesBetweenness", () => {
  it("does not crash and keeps centralities at 0 when n <= 2", () => {
    const topics = [makeTopicNode("A"), makeTopicNode("B")];
    const edges = [makeTopicEdge("A", "B")];

    brandesBetweenness(topics, edges);

    expect(topics[0].betweennessCentrality).toBe(0);
    expect(topics[1].betweennessCentrality).toBe(0);
  });

  it("gives highest betweenness to the middle node in a linear graph A-B-C", () => {
    const topics = [makeTopicNode("A"), makeTopicNode("B"), makeTopicNode("C")];
    const edges = [makeTopicEdge("A", "B"), makeTopicEdge("B", "C")];

    brandesBetweenness(topics, edges);

    const bcA = topics.find((t) => t.id === "A")!.betweennessCentrality;
    const bcB = topics.find((t) => t.id === "B")!.betweennessCentrality;
    const bcC = topics.find((t) => t.id === "C")!.betweennessCentrality;

    expect(bcB).toBeGreaterThan(bcA);
    expect(bcB).toBeGreaterThan(bcC);
  });

  it("sets degree centrality correctly for a linear graph A-B-C", () => {
    const topics = [makeTopicNode("A"), makeTopicNode("B"), makeTopicNode("C")];
    const edges = [makeTopicEdge("A", "B"), makeTopicEdge("B", "C")];

    brandesBetweenness(topics, edges);

    const dcA = topics.find((t) => t.id === "A")!.degreeCentrality;
    const dcB = topics.find((t) => t.id === "B")!.degreeCentrality;
    const dcC = topics.find((t) => t.id === "C")!.degreeCentrality;

    // B has degree 2, normalized: 2 / (3 - 1) = 1.0
    expect(dcB).toBeCloseTo(1.0);
    // A and C have degree 1, normalized: 1 / (3 - 1) = 0.5
    expect(dcA).toBeCloseTo(0.5);
    expect(dcC).toBeCloseTo(0.5);
  });
});
