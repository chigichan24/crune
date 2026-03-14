import { describe, it, expect } from "vitest";
import type {
  SessionInput,
  ToolIdfResult,
} from "../knowledge-graph-builder.js";
import {
  extractDominantAction,
  classifyDominantRole,
  computeToolSignature,
} from "../knowledge-graph-builder.js";

function makeSession(overrides: Partial<SessionInput> = {}): SessionInput {
  return {
    sessionId: "s1",
    projectDisplayName: "test-project",
    turns: [],
    subagents: {},
    meta: {
      sessionId: "s1",
      createdAt: "2025-01-01T00:00:00Z",
      lastActiveAt: "2025-01-01T01:00:00Z",
      durationMinutes: 60,
      filesEdited: [],
      gitBranch: "main",
      toolBreakdown: {},
      subagentCount: 0,
    },
    ...overrides,
  };
}

function makeToolIdf(
  tools: string[],
  idfWeights: Record<string, number>
): ToolIdfResult {
  const toolVocabIndex = new Map<string, number>();
  tools.forEach((t, i) => toolVocabIndex.set(t, i));
  return {
    toolVocabulary: tools,
    toolVocabIndex,
    toolIdfWeights: new Map(Object.entries(idfWeights)),
    vectors: new Map(),
  };
}

describe("extractDominantAction", () => {
  it('returns "fix" when fix is the most common English verb', () => {
    const prompts = ["fix the bug", "fix another bug"];
    expect(extractDominantAction(prompts)).toBe("fix");
  });

  it('maps Japanese 修正 to "fix"', () => {
    const prompts = ["修正してください", "修正お願い"];
    expect(extractDominantAction(prompts)).toBe("fix");
  });

  it('returns "work on" when no recognized action verbs are found', () => {
    const prompts = ["hello world"];
    expect(extractDominantAction(prompts)).toBe("work on");
  });

  it("returns the most frequent verb when multiple are present", () => {
    const prompts = [
      "add a new feature",
      "add another thing",
      "add the component",
      "fix the bug",
    ];
    expect(extractDominantAction(prompts)).toBe("add");
  });
});

describe("classifyDominantRole", () => {
  it('returns "subagent-delegated" when subagent ratio > 0.15', () => {
    const session = makeSession({
      turns: [
        {
          userPrompt: "do something",
          assistantTexts: ["ok"],
          toolCalls: [
            { toolName: "Agent", input: {} },
            { toolName: "Agent", input: {} },
          ],
        },
      ],
      subagents: {
        "agent-1": {
          agentId: "agent-1",
          agentType: "code",
          turns: [],
        },
        "agent-2": {
          agentId: "agent-2",
          agentType: "code",
          turns: [],
        },
      },
    });

    expect(classifyDominantRole([session])).toBe("subagent-delegated");
  });

  it('returns "tool-heavy" when tool ratio > 0.6', () => {
    const session = makeSession({
      turns: [
        {
          userPrompt: "run tools",
          assistantTexts: ["ok"],
          toolCalls: [
            { toolName: "Bash", input: {} },
            { toolName: "Read", input: {} },
            { toolName: "Grep", input: {} },
            { toolName: "Bash", input: {} },
            { toolName: "Edit", input: {} },
          ],
        },
      ],
      subagents: {},
    });

    expect(classifyDominantRole([session])).toBe("tool-heavy");
  });

  it('returns "user-driven" when neither ratio is high', () => {
    const sessions = [
      makeSession({
        turns: [
          { userPrompt: "prompt 1", assistantTexts: ["ok"], toolCalls: [] },
          { userPrompt: "prompt 2", assistantTexts: ["ok"], toolCalls: [] },
          {
            userPrompt: "prompt 3",
            assistantTexts: ["ok"],
            toolCalls: [{ toolName: "Read", input: {} }],
          },
        ],
        subagents: {},
      }),
    ];

    expect(classifyDominantRole(sessions)).toBe("user-driven");
  });
});

describe("computeToolSignature", () => {
  it("returns sorted array with max 5 items, scored by log(1+count)*IDF", () => {
    const session = makeSession({
      meta: {
        sessionId: "s1",
        createdAt: "2025-01-01T00:00:00Z",
        lastActiveAt: "2025-01-01T01:00:00Z",
        durationMinutes: 60,
        filesEdited: [],
        gitBranch: "main",
        toolBreakdown: {
          Bash: 50,
          Read: 30,
          Edit: 20,
          Grep: 10,
          Glob: 5,
          Write: 3,
          Agent: 1,
        },
        subagentCount: 0,
      },
    });

    const toolIdf = makeToolIdf(
      ["Bash", "Read", "Edit", "Grep", "Glob", "Write", "Agent"],
      {
        Bash: 1.0,
        Read: 1.5,
        Edit: 2.0,
        Grep: 1.8,
        Glob: 2.5,
        Write: 3.0,
        Agent: 4.0,
      }
    );

    const result = computeToolSignature([session], toolIdf);

    // Max 5 items
    expect(result.length).toBeLessThanOrEqual(5);

    // Sorted descending by weight
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].weight).toBeGreaterThanOrEqual(result[i].weight);
    }

    // Each entry has tool and weight
    for (const entry of result) {
      expect(entry).toHaveProperty("tool");
      expect(entry).toHaveProperty("weight");
      expect(typeof entry.tool).toBe("string");
      expect(typeof entry.weight).toBe("number");
      expect(entry.weight).toBeGreaterThan(0);
    }
  });

  it("returns empty array when sessions have no tools", () => {
    const session = makeSession({
      meta: {
        sessionId: "s1",
        createdAt: "2025-01-01T00:00:00Z",
        lastActiveAt: "2025-01-01T01:00:00Z",
        durationMinutes: 60,
        filesEdited: [],
        gitBranch: "main",
        toolBreakdown: {},
        subagentCount: 0,
      },
    });

    const toolIdf = makeToolIdf([], {});
    const result = computeToolSignature([session], toolIdf);
    expect(result).toEqual([]);
  });
});
