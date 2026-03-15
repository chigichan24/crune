import { tokenize } from "./knowledge-graph/tokenizer.js";
import { STOP_WORDS } from "./knowledge-graph/constants.js";

export type WorkType = "investigation" | "implementation" | "debugging" | "planning";

export interface SessionSummaryInfo {
  summary: string;
  keywords: string[];
  scope: string;
  workType: WorkType;
}

interface TurnInput {
  userPrompt: string;
  permissionMode?: string | null;
}

interface MetaInput {
  toolBreakdown: Record<string, number>;
  filesEdited: string[];
  permissionMode: string | null;
  turnCount: number;
}

export function classifyWorkType(
  toolBreakdown: Record<string, number>,
  permissionMode: string | null,
  turnCount: number
): WorkType {
  const total = Object.values(toolBreakdown).reduce((a, b) => a + b, 0);

  const readCount =
    (toolBreakdown["Read"] ?? 0) +
    (toolBreakdown["Grep"] ?? 0) +
    (toolBreakdown["Glob"] ?? 0);
  const writeCount =
    (toolBreakdown["Edit"] ?? 0) + (toolBreakdown["Write"] ?? 0);
  const bashCount = toolBreakdown["Bash"] ?? 0;

  const writeRatio = total > 0 ? writeCount / total : 0;
  const readRatio = total > 0 ? readCount / total : 0;
  const bashRatio = total > 0 ? bashCount / total : 0;

  if (
    total === 0 ||
    (permissionMode === "plan" && turnCount < 5 && writeRatio === 0)
  ) {
    return "planning";
  }
  if (readRatio >= 0.7) {
    return "investigation";
  }
  if (bashRatio >= 0.4 && writeCount > 0) {
    return "debugging";
  }
  if (writeRatio >= 0.4) {
    return "implementation";
  }
  return "implementation";
}

export function findCommonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return "";

  const splitPaths = paths.map((p) => p.split("/"));

  if (splitPaths.length === 1) {
    // Single file: return its directory
    const parts = splitPaths[0];
    if (parts.length <= 1) return "";
    return parts.slice(0, -1).join("/");
  }

  const minLen = Math.min(...splitPaths.map((p) => p.length));
  const commonParts: string[] = [];

  for (let i = 0; i < minLen; i++) {
    const segment = splitPaths[0][i];
    if (splitPaths.every((p) => p[i] === segment)) {
      commonParts.push(segment);
    } else {
      break;
    }
  }

  // Remove the last segment if it looks like a filename (has extension)
  // The common prefix should be a directory
  if (commonParts.length > 0) {
    const last = commonParts[commonParts.length - 1];
    if (last.includes(".")) {
      commonParts.pop();
    }
  }

  const result = commonParts.join("/");
  if (result === "" || result === "/") return "";
  return result;
}

function selectRepresentativePrompt(prompts: string[]): string {
  if (prompts.length === 0) return "";
  if (prompts.length === 1) return prompts[0].slice(0, 300);

  const tokenSets = prompts.map((p) => new Set(tokenize(p)));

  let bestIndex = 0;
  let bestScore = -Infinity;

  for (let i = 0; i < prompts.length; i++) {
    let centralitySum = 0;
    for (let j = 0; j < prompts.length; j++) {
      if (i === j) continue;
      const intersection = new Set(
        [...tokenSets[i]].filter((t) => tokenSets[j].has(t))
      );
      const union = new Set([...tokenSets[i], ...tokenSets[j]]);
      if (union.size > 0) {
        centralitySum += intersection.size / union.size;
      }
    }
    const positionWeight = 1 / (1 + i);
    const score = centralitySum * positionWeight;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return prompts[bestIndex].slice(0, 300);
}

function extractKeywords(prompts: string[]): string[] {
  const allTokens: string[] = [];
  for (const prompt of prompts) {
    const tokens = tokenize(prompt);
    for (const t of tokens) {
      if (!STOP_WORDS.has(t)) {
        allTokens.push(t);
      }
    }
  }

  const freq = new Map<string, number>();
  for (const t of allTokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

export function generateSessionSummary(
  turns: TurnInput[],
  meta: MetaInput
): SessionSummaryInfo {
  // 1. Collect candidate prompts
  let candidatePrompts = turns
    .filter((t) => {
      const mode = t.permissionMode ?? meta.permissionMode;
      return mode === "plan";
    })
    .map((t) => t.userPrompt)
    .filter((p) => p.trim().length > 0);

  if (candidatePrompts.length === 0) {
    candidatePrompts = turns
      .map((t) => t.userPrompt)
      .filter((p) => p.trim().length > 0);
  }

  // 2. Select representative prompt
  const summary = selectRepresentativePrompt(candidatePrompts);

  // 3. Extract keywords
  const keywords = extractKeywords(candidatePrompts);

  // 4. Determine workType
  const workType = classifyWorkType(
    meta.toolBreakdown,
    meta.permissionMode,
    meta.turnCount
  );

  // 5. Compute scope
  const scope = findCommonPathPrefix(meta.filesEdited);

  return { summary, keywords, scope, workType };
}
