/**
 * Enriched tool sequence extraction with parameter abstraction.
 * Extracts variable-length tool call patterns with context (file patterns, command categories).
 */

import type {
  SessionInput,
  ToolCategory,
  EnrichedToolStep,
  EnrichedToolSequence,
} from "./types.js";

// ─── Tool call abstraction ──────────────────────────────────────────────────

const TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  Read: "read",
  Grep: "search",
  Glob: "search",
  Edit: "write",
  Write: "write",
  Bash: "execute",
  Agent: "delegate",
};

const BASH_CATEGORIES: [RegExp, string][] = [
  [/^git\s/, "git"],
  [/^npm\s|^npx\s|^yarn\s|^pnpm\s/, "npm"],
  [/test|jest|vitest|mocha|pytest/, "test"],
  [/build|tsc|webpack|vite\s+build|esbuild/, "build"],
  [/lint|eslint|prettier/, "lint"],
  [/docker|kubectl|helm/, "container"],
  [/curl|wget|fetch/, "http"],
  [/mkdir|rm\s|cp\s|mv\s|chmod|chown/, "filesystem"],
  [/cat\s|head\s|tail\s|less\s|grep\s/, "read"],
];

function classifyBashCommand(command: string): string {
  const trimmed = command.trim();
  for (const [pattern, category] of BASH_CATEGORIES) {
    if (pattern.test(trimmed)) return category;
  }
  return "other";
}

function abstractFilePath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) return filePath;

  const ext = filePath.match(/\.[a-zA-Z0-9]+$/)?.[0] || "";
  // Keep first 2 meaningful directory segments + extension pattern
  const dirs = parts.slice(0, -1).filter((p) => p.length > 0);
  const prefix = dirs.slice(0, 2).join("/");
  return prefix ? `${prefix}/**/*${ext}` : `**/*${ext}`;
}

export function abstractToolCall(
  toolCall: { toolName: string; input: Record<string, unknown> }
): EnrichedToolStep {
  const category = TOOL_CATEGORY_MAP[toolCall.toolName] || "execute";

  let targetPattern: string | undefined;

  switch (toolCall.toolName) {
    case "Edit":
    case "Write":
    case "Read": {
      const fp = toolCall.input.file_path;
      if (typeof fp === "string") {
        targetPattern = abstractFilePath(fp);
      }
      break;
    }
    case "Bash": {
      const cmd = toolCall.input.command;
      if (typeof cmd === "string") {
        targetPattern = classifyBashCommand(cmd);
      }
      break;
    }
    case "Grep": {
      const pattern = toolCall.input.pattern;
      if (typeof pattern === "string") {
        targetPattern = `grep:${pattern.length > 30 ? pattern.slice(0, 30) + "..." : pattern}`;
      }
      break;
    }
    case "Glob": {
      const pattern = toolCall.input.pattern;
      if (typeof pattern === "string") {
        targetPattern = `glob:${pattern}`;
      }
      break;
    }
    case "Agent": {
      const agentType = toolCall.input.subagent_type;
      if (typeof agentType === "string") {
        targetPattern = agentType;
      }
      break;
    }
  }

  return { toolName: toolCall.toolName, category, targetPattern };
}

// ─── Enriched sequence extraction ───────────────────────────────────────────

function stepKey(step: EnrichedToolStep): string {
  return `${step.toolName}:${step.category}:${step.targetPattern || ""}`;
}

function sequenceKey(steps: EnrichedToolStep[]): string {
  return steps.map(stepKey).join("|");
}

interface SequenceAccumulator {
  steps: EnrichedToolStep[];
  count: number;
  sessionIds: Set<string>;
  projects: Set<string>;
}

export function extractEnrichedSequences(
  sessions: SessionInput[],
  minN: number = 3,
  maxN: number = 7,
  minCount: number = 2
): EnrichedToolSequence[] {
  // Collect all abstracted tool steps per session
  const sessionSteps: { sessionId: string; project: string; steps: EnrichedToolStep[] }[] = [];

  for (const session of sessions) {
    const steps: EnrichedToolStep[] = [];
    for (const turn of session.turns) {
      for (const tc of turn.toolCalls) {
        steps.push(abstractToolCall(tc));
      }
    }
    // Include subagent tool calls
    for (const sub of Object.values(session.subagents)) {
      for (const turn of sub.turns) {
        for (const tc of turn.toolCalls) {
          steps.push(abstractToolCall(tc));
        }
      }
    }
    if (steps.length >= minN) {
      sessionSteps.push({
        sessionId: session.sessionId,
        project: session.projectDisplayName,
        steps,
      });
    }
  }

  // Extract n-grams for each length
  const allSequences = new Map<string, SequenceAccumulator>();

  for (let n = minN; n <= maxN; n++) {
    for (const { sessionId, project, steps } of sessionSteps) {
      if (steps.length < n) continue;
      for (let i = 0; i <= steps.length - n; i++) {
        const ngram = steps.slice(i, i + n);
        const key = sequenceKey(ngram);
        const existing = allSequences.get(key);
        if (existing) {
          existing.count++;
          existing.sessionIds.add(sessionId);
          existing.projects.add(project);
        } else {
          allSequences.set(key, {
            steps: ngram,
            count: 1,
            sessionIds: new Set([sessionId]),
            projects: new Set([project]),
          });
        }
      }
    }
  }

  // Filter by minimum count
  const frequent = [...allSequences.entries()]
    .filter(([, v]) => v.count >= minCount)
    .sort((a, b) => b[1].count - a[1].count);

  // Maximal pattern mining: remove shorter patterns subsumed by longer ones
  const frequentKeys = new Set(frequent.map(([k]) => k));
  const result: EnrichedToolSequence[] = [];

  for (const [key, acc] of frequent) {
    // Check if this pattern is a strict substring of any longer frequent pattern
    const isSubsumed = frequent.some(([otherKey, otherAcc]) => {
      return (
        otherKey !== key &&
        otherAcc.steps.length > acc.steps.length &&
        otherAcc.count >= acc.count * 0.8 && // longer pattern captures >=80% of occurrences
        frequentKeys.has(otherKey) &&
        otherKey.includes(key)
      );
    });

    if (!isSubsumed) {
      result.push({
        sequence: acc.steps,
        count: acc.count,
        sessionIds: [...acc.sessionIds],
        projects: [...acc.projects],
      });
    }
  }

  return result.slice(0, 30); // Top 30 patterns
}
