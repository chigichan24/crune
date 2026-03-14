/**
 * Tool-IDF and structural feature extraction.
 */

import type { SessionInput, ToolIdfResult } from "./types.js";
import { STRUCTURAL_DIM } from "./constants.js";

export function buildToolIdf(sessions: SessionInput[]): ToolIdfResult {
  const n = sessions.length;

  // Collect all tool names across sessions
  const allTools = new Set<string>();
  const sessionToolCounts = new Map<string, Map<string, number>>();

  for (const s of sessions) {
    const toolCounts = new Map<string, number>();
    // Main session tools
    for (const [tool, count] of Object.entries(s.meta.toolBreakdown)) {
      toolCounts.set(tool, (toolCounts.get(tool) || 0) + count);
      allTools.add(tool);
    }
    // Subagent tools
    for (const sub of Object.values(s.subagents)) {
      for (const turn of sub.turns) {
        for (const tc of turn.toolCalls) {
          toolCounts.set(tc.toolName, (toolCounts.get(tc.toolName) || 0) + 1);
          allTools.add(tc.toolName);
        }
      }
    }
    sessionToolCounts.set(s.sessionId, toolCounts);
  }

  // Build vocabulary and IDF
  const toolVocabulary = [...allTools].sort();
  const toolVocabIndex = new Map<string, number>();
  toolVocabulary.forEach((t, i) => toolVocabIndex.set(t, i));

  // Document frequency: how many sessions use each tool
  const df = new Map<string, number>();
  for (const [, counts] of sessionToolCounts) {
    for (const tool of counts.keys()) {
      df.set(tool, (df.get(tool) || 0) + 1);
    }
  }

  // IDF weights
  const toolIdfWeights = new Map<string, number>();
  for (const tool of toolVocabulary) {
    toolIdfWeights.set(tool, Math.log(n / (df.get(tool) || 1)));
  }

  // Build per-session tool vectors: log(1 + count) * tool_idf, then L2 normalize
  const vectors = new Map<string, Float64Array>();
  for (const s of sessions) {
    const counts = sessionToolCounts.get(s.sessionId)!;
    const vec = new Float64Array(toolVocabulary.length);

    for (const [tool, count] of counts) {
      const idx = toolVocabIndex.get(tool);
      if (idx !== undefined) {
        vec[idx] = Math.log(1 + count) * (toolIdfWeights.get(tool) || 1);
      }
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    }

    vectors.set(s.sessionId, vec);
  }

  return { toolVocabulary, toolVocabIndex, toolIdfWeights, vectors };
}

export function buildStructuralVectors(sessions: SessionInput[]): Map<string, Float64Array> {
  const vectors = new Map<string, Float64Array>();

  for (const s of sessions) {
    const vec = new Float64Array(STRUCTURAL_DIM);
    const totalTurns = s.turns.length;
    if (totalTurns === 0) {
      vectors.set(s.sessionId, vec);
      continue;
    }

    // Count roles and tool usage
    let userCount = 0;
    let assistantCount = 0;
    let toolCallCount = 0;
    let subagentTurns = 0;
    let totalToolsInTurns = 0;

    for (const turn of s.turns) {
      if (turn.userPrompt) userCount++;
      if (turn.assistantTexts.length > 0) assistantCount++;
      const turnToolCount = turn.toolCalls.length;
      if (turnToolCount > 0) toolCallCount++;
      totalToolsInTurns += turnToolCount;

      // Check if any tool call is an Agent call
      if (turn.toolCalls.some((tc) => tc.toolName === "Agent")) {
        subagentTurns++;
      }
    }

    // Also count subagent involvement from subagents object
    const subagentCount = Object.keys(s.subagents).length;

    const totalEntries = userCount + assistantCount + toolCallCount || 1;
    vec[0] = userCount / totalEntries;         // userRatio
    vec[1] = assistantCount / totalEntries;     // assistantRatio
    vec[2] = toolCallCount / totalEntries;      // toolCallRatio
    vec[3] = subagentCount > 0
      ? Math.min(1, (subagentTurns + subagentCount) / totalTurns)
      : 0;                                      // subagentRatio
    vec[4] = Math.log(1 + totalToolsInTurns / totalTurns); // avgToolsPerTurn (log dampened)

    // Edit heaviness vs Read heaviness
    const tb = s.meta.toolBreakdown;
    const totalTools = Object.values(tb).reduce((a, b) => a + b, 0) || 1;
    vec[5] = ((tb["Edit"] || 0) + (tb["Write"] || 0)) / totalTools;  // editHeaviness
    vec[6] = ((tb["Read"] || 0) + (tb["Grep"] || 0) + (tb["Glob"] || 0)) / totalTools; // readHeaviness

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    }

    vectors.set(s.sessionId, vec);
  }

  return vectors;
}
