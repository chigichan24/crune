import type { SessionInput } from "../knowledge-graph-builder.js";

export function makeSession(overrides: Partial<SessionInput> & { sessionId: string }): SessionInput {
  return {
    sessionId: overrides.sessionId,
    projectDisplayName: overrides.projectDisplayName ?? "test-project",
    turns: overrides.turns ?? [],
    subagents: overrides.subagents ?? {},
    meta: {
      sessionId: overrides.sessionId,
      createdAt: "2025-01-01T00:00:00Z",
      lastActiveAt: "2025-01-01T01:00:00Z",
      durationMinutes: 60,
      filesEdited: [],
      gitBranch: "main",
      toolBreakdown: {},
      subagentCount: 0,
      ...overrides.meta,
    },
  };
}

/** Session with edit-heavy tool usage */
export const editHeavySession = makeSession({
  sessionId: "edit-heavy",
  projectDisplayName: "crune",
  turns: [
    {
      userPrompt: "Fix the camelCase parser bug in /src/utils/tokenizer.ts",
      assistantTexts: ["I'll fix the tokenizer bug"],
      toolCalls: [
        { toolName: "Read", input: { file: "/src/utils/tokenizer.ts" } },
        { toolName: "Edit", input: { file: "/src/utils/tokenizer.ts" } },
        { toolName: "Edit", input: { file: "/src/utils/tokenizer.ts" } },
      ],
    },
    {
      userPrompt: "Also update the tests",
      assistantTexts: ["Updated the tests"],
      toolCalls: [
        { toolName: "Read", input: { file: "/src/utils/tokenizer.test.ts" } },
        { toolName: "Write", input: { file: "/src/utils/tokenizer.test.ts" } },
      ],
    },
  ],
  subagents: {},
  meta: {
    sessionId: "edit-heavy",
    createdAt: "2025-01-01T10:00:00Z",
    lastActiveAt: "2025-01-01T11:00:00Z",
    durationMinutes: 60,
    filesEdited: ["/src/utils/tokenizer.ts", "/src/utils/tokenizer.test.ts"],
    gitBranch: "fix/tokenizer",
    toolBreakdown: { Read: 2, Edit: 2, Write: 1 },
    subagentCount: 0,
  },
});

/** Session with read-heavy tool usage */
export const readHeavySession = makeSession({
  sessionId: "read-heavy",
  projectDisplayName: "crune",
  turns: [
    {
      userPrompt: "Investigate the logging setup in /src/components/App.tsx",
      assistantTexts: ["Let me look at the logging setup"],
      toolCalls: [
        { toolName: "Grep", input: { pattern: "console.log" } },
        { toolName: "Read", input: { file: "/src/components/App.tsx" } },
        { toolName: "Glob", input: { pattern: "*.log" } },
        { toolName: "Read", input: { file: "/src/config/logging.ts" } },
      ],
    },
  ],
  subagents: {},
  meta: {
    sessionId: "read-heavy",
    createdAt: "2025-01-02T10:00:00Z",
    lastActiveAt: "2025-01-02T10:30:00Z",
    durationMinutes: 30,
    filesEdited: [],
    gitBranch: "main",
    toolBreakdown: { Read: 2, Grep: 1, Glob: 1 },
    subagentCount: 0,
  },
});

/** Session with subagent delegation */
export const subagentSession = makeSession({
  sessionId: "subagent-heavy",
  projectDisplayName: "other-project",
  turns: [
    {
      userPrompt: "Refactor the authentication module in /src/auth/handler.ts",
      assistantTexts: ["I'll delegate this to subagents"],
      toolCalls: [
        { toolName: "Agent", input: { task: "refactor auth" } },
        { toolName: "Agent", input: { task: "update tests" } },
      ],
    },
    {
      userPrompt: "Deploy the changes",
      assistantTexts: ["Deploying now"],
      toolCalls: [
        { toolName: "Bash", input: { command: "npm run deploy" } },
      ],
    },
  ],
  subagents: {
    "agent-1": {
      agentId: "agent-1",
      agentType: "code",
      turns: [
        {
          userPrompt: "refactor auth",
          assistantTexts: ["Done"],
          toolCalls: [
            { toolName: "Edit", input: { file: "/src/auth/handler.ts" } },
          ],
        },
      ],
    },
    "agent-2": {
      agentId: "agent-2",
      agentType: "test",
      turns: [
        {
          userPrompt: "update tests",
          assistantTexts: ["Tests updated"],
          toolCalls: [
            { toolName: "Write", input: { file: "/src/auth/handler.test.ts" } },
          ],
        },
      ],
    },
  },
  meta: {
    sessionId: "subagent-heavy",
    createdAt: "2025-01-03T10:00:00Z",
    lastActiveAt: "2025-01-03T11:30:00Z",
    durationMinutes: 90,
    filesEdited: ["/src/auth/handler.ts", "/src/auth/handler.test.ts"],
    gitBranch: "refactor/auth",
    toolBreakdown: { Agent: 2, Bash: 1, Edit: 1, Write: 1 },
    subagentCount: 2,
  },
});

/** Session with Japanese prompts */
export const japaneseSession = makeSession({
  sessionId: "japanese",
  projectDisplayName: "crune",
  turns: [
    {
      userPrompt: "修正してください: /src/components/Overview.tsx のバグ",
      assistantTexts: ["バグを修正します"],
      toolCalls: [
        { toolName: "Read", input: { file: "/src/components/Overview.tsx" } },
        { toolName: "Edit", input: { file: "/src/components/Overview.tsx" } },
      ],
    },
  ],
  subagents: {},
  meta: {
    sessionId: "japanese",
    createdAt: "2025-01-01T12:00:00Z",
    lastActiveAt: "2025-01-01T12:30:00Z",
    durationMinutes: 30,
    filesEdited: ["/src/components/Overview.tsx"],
    gitBranch: "fix/overview",
    toolBreakdown: { Read: 1, Edit: 1 },
    subagentCount: 0,
  },
});

/** Minimal empty session */
export const emptySession = makeSession({
  sessionId: "empty",
  projectDisplayName: "crune",
  turns: [],
  meta: {
    sessionId: "empty",
    createdAt: "2025-01-05T00:00:00Z",
    lastActiveAt: "2025-01-05T00:00:00Z",
    durationMinutes: 0,
    filesEdited: [],
    gitBranch: "",
    toolBreakdown: {},
    subagentCount: 0,
  },
});

/** All fixture sessions */
export const allSessions = [
  editHeavySession,
  readHeavySession,
  subagentSession,
  japaneseSession,
  emptySession,
];
