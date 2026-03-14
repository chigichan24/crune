import { describe, it, expect } from "vitest";
import { buildSemanticKnowledgeGraph } from "../knowledge-graph-builder.js";
import type { SemanticKnowledgeGraph } from "../knowledge-graph-builder.js";
import {
  editHeavySession,
  readHeavySession,
  subagentSession,
  japaneseSession,
  makeSession,
} from "./fixtures.js";

describe("buildSemanticKnowledgeGraph", () => {
  it("returns empty graph for empty sessions array", () => {
    const result = buildSemanticKnowledgeGraph([]);

    expect(result).toEqual({
      nodes: [],
      edges: [],
      communities: [],
      metrics: {
        totalTopics: 0,
        totalEdges: 0,
        graphDensity: 0,
        modularity: 0,
        isolatedTopicCount: 0,
        bridgeTopicIds: [],
      },
    });
  });

  it("returns 1 topic and 0 edges for a single session", () => {
    const result = buildSemanticKnowledgeGraph([editHeavySession]);

    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
    expect(result.communities).toHaveLength(1);
    expect(result.metrics.totalTopics).toBe(1);
    expect(result.metrics.totalEdges).toBe(0);
  });

  it("produces >= 1 topic with correct structure for 5+ varied sessions", () => {
    const sessions = [
      editHeavySession,
      readHeavySession,
      subagentSession,
      japaneseSession,
      makeSession({
        sessionId: "deploy-session",
        projectDisplayName: "crune",
        turns: [
          {
            userPrompt: "Deploy the application to production server",
            assistantTexts: ["Deploying to production"],
            toolCalls: [
              { toolName: "Bash", input: { command: "npm run build" } },
            ],
          },
        ],
        meta: {
          sessionId: "deploy-session",
          createdAt: "2025-01-04T10:00:00Z",
          lastActiveAt: "2025-01-04T10:30:00Z",
          durationMinutes: 30,
          filesEdited: ["/deploy/config.ts"],
          gitBranch: "deploy",
          toolBreakdown: { Bash: 3 },
          subagentCount: 0,
        },
      }),
      makeSession({
        sessionId: "testing-session",
        projectDisplayName: "crune",
        turns: [
          {
            userPrompt:
              "Write unit tests for the authentication module with jest",
            assistantTexts: [
              "I will create comprehensive test suites for the auth module",
            ],
            toolCalls: [
              {
                toolName: "Write",
                input: { file_path: "/src/__tests__/auth.test.ts", content: "test code" },
              },
              {
                toolName: "Bash",
                input: { command: "npx jest --coverage" },
              },
            ],
          },
          {
            userPrompt: "Add integration tests for the login flow",
            assistantTexts: [
              "Adding integration tests for the login endpoint",
            ],
            toolCalls: [
              {
                toolName: "Write",
                input: {
                  file_path: "/src/__tests__/login.integration.test.ts",
                  content: "integration test code",
                },
              },
            ],
          },
        ],
        meta: {
          sessionId: "testing-session",
          createdAt: "2025-01-05T14:00:00Z",
          lastActiveAt: "2025-01-05T15:00:00Z",
          durationMinutes: 60,
          filesEdited: [
            "/src/__tests__/auth.test.ts",
            "/src/__tests__/login.integration.test.ts",
          ],
          gitBranch: "feature/auth-tests",
          toolBreakdown: { Write: 2, Bash: 1 },
          subagentCount: 0,
        },
      }),
      makeSession({
        sessionId: "refactor-session",
        projectDisplayName: "other-project",
        turns: [
          {
            userPrompt:
              "Refactor the database layer to use connection pooling",
            assistantTexts: [
              "Refactoring database connections to use a pool",
            ],
            toolCalls: [
              {
                toolName: "Edit",
                input: {
                  file_path: "/src/db/connection.ts",
                  old_string: "createConnection",
                  new_string: "createPool",
                },
              },
              {
                toolName: "Read",
                input: { file_path: "/src/db/queries.ts" },
              },
            ],
          },
        ],
        meta: {
          sessionId: "refactor-session",
          createdAt: "2025-01-06T09:00:00Z",
          lastActiveAt: "2025-01-06T10:00:00Z",
          durationMinutes: 60,
          filesEdited: ["/src/db/connection.ts", "/src/db/queries.ts"],
          gitBranch: "refactor/db-pool",
          toolBreakdown: { Edit: 1, Read: 1 },
          subagentCount: 0,
        },
      }),
    ];

    const result: SemanticKnowledgeGraph =
      buildSemanticKnowledgeGraph(sessions);

    // Should produce at least 1 topic
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);

    // Verify top-level structure
    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("edges");
    expect(result).toHaveProperty("communities");
    expect(result).toHaveProperty("metrics");
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.edges)).toBe(true);
    expect(Array.isArray(result.communities)).toBe(true);

    // Verify metrics structure
    expect(result.metrics).toHaveProperty("totalTopics");
    expect(result.metrics).toHaveProperty("totalEdges");
    expect(result.metrics).toHaveProperty("graphDensity");
    expect(result.metrics).toHaveProperty("modularity");
    expect(result.metrics).toHaveProperty("isolatedTopicCount");
    expect(result.metrics).toHaveProperty("bridgeTopicIds");
    expect(typeof result.metrics.totalTopics).toBe("number");
    expect(typeof result.metrics.totalEdges).toBe("number");
    expect(typeof result.metrics.graphDensity).toBe("number");
    expect(typeof result.metrics.modularity).toBe("number");
    expect(typeof result.metrics.isolatedTopicCount).toBe("number");
    expect(Array.isArray(result.metrics.bridgeTopicIds)).toBe(true);

    // Metrics should be consistent with nodes/edges
    expect(result.metrics.totalTopics).toBe(result.nodes.length);
    expect(result.metrics.totalEdges).toBe(result.edges.length);
  });

  it("nodes and edges have all required fields", () => {
    const sessions = [
      editHeavySession,
      readHeavySession,
      subagentSession,
      japaneseSession,
      makeSession({
        sessionId: "deploy-session",
        projectDisplayName: "crune",
        turns: [
          {
            userPrompt: "Deploy the application to production server",
            assistantTexts: ["Deploying to production"],
            toolCalls: [
              { toolName: "Bash", input: { command: "npm run build" } },
            ],
          },
        ],
        meta: {
          sessionId: "deploy-session",
          createdAt: "2025-01-04T10:00:00Z",
          lastActiveAt: "2025-01-04T10:30:00Z",
          durationMinutes: 30,
          filesEdited: ["/deploy/config.ts"],
          gitBranch: "deploy",
          toolBreakdown: { Bash: 3 },
          subagentCount: 0,
        },
      }),
    ];

    const result = buildSemanticKnowledgeGraph(sessions);

    // Validate node fields
    for (const node of result.nodes) {
      expect(node).toHaveProperty("id");
      expect(node).toHaveProperty("label");
      expect(node).toHaveProperty("keywords");
      expect(node).toHaveProperty("project");
      expect(node).toHaveProperty("projects");
      expect(node).toHaveProperty("sessionIds");
      expect(node).toHaveProperty("sessionCount");
      expect(node).toHaveProperty("totalDurationMinutes");
      expect(node).toHaveProperty("totalToolCalls");
      expect(node).toHaveProperty("firstSeen");
      expect(node).toHaveProperty("lastSeen");
      expect(node).toHaveProperty("betweennessCentrality");
      expect(node).toHaveProperty("degreeCentrality");
      expect(node).toHaveProperty("communityId");
      expect(node).toHaveProperty("representativePrompts");
      expect(node).toHaveProperty("suggestedPrompt");
      expect(node).toHaveProperty("toolSignature");
      expect(node).toHaveProperty("dominantRole");

      expect(typeof node.id).toBe("string");
      expect(typeof node.label).toBe("string");
      expect(Array.isArray(node.keywords)).toBe(true);
      expect(Array.isArray(node.sessionIds)).toBe(true);
      expect(typeof node.sessionCount).toBe("number");
      expect(typeof node.betweennessCentrality).toBe("number");
      expect(typeof node.degreeCentrality).toBe("number");
      expect(typeof node.communityId).toBe("number");
    }

    // Validate edge fields (if any edges exist)
    for (const edge of result.edges) {
      expect(edge).toHaveProperty("source");
      expect(edge).toHaveProperty("target");
      expect(edge).toHaveProperty("type");
      expect(edge).toHaveProperty("strength");
      expect(edge).toHaveProperty("label");
      expect(edge).toHaveProperty("signals");

      expect(typeof edge.source).toBe("string");
      expect(typeof edge.target).toBe("string");
      expect(typeof edge.type).toBe("string");
      expect(typeof edge.strength).toBe("number");
      expect(typeof edge.label).toBe("string");
      expect(edge.signals).toHaveProperty("semanticSimilarity");
      expect(edge.signals).toHaveProperty("fileOverlap");
      expect(edge.signals).toHaveProperty("sessionOverlap");
    }
  });
});
