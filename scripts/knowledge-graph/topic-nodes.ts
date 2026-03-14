/**
 * Topic node construction from session clusters.
 */

import type { SessionInput, TopicNode, ToolIdfResult, TfidfResult } from "./types.js";
import { ACTION_VERBS_EN, ACTION_VERBS_JA } from "./constants.js";
import { cosineSimilarity } from "./similarity.js";

export function extractDominantAction(prompts: string[]): string {
  const actionCounts = new Map<string, number>();

  for (const prompt of prompts) {
    const lower = prompt.toLowerCase();
    // English verbs
    const words = lower.split(/\s+/);
    for (const w of words) {
      const clean = w.replace(/[^a-z]/g, "");
      if (ACTION_VERBS_EN.has(clean)) {
        actionCounts.set(clean, (actionCounts.get(clean) || 0) + 1);
      }
    }
    // Japanese verbs
    for (const [pattern, verb] of ACTION_VERBS_JA) {
      if (pattern.test(prompt)) {
        actionCounts.set(verb, (actionCounts.get(verb) || 0) + 1);
      }
    }
  }

  if (actionCounts.size === 0) return "work on";
  return [...actionCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function selectRepresentativePrompts(
  memberSessions: SessionInput[],
  clusterCentroid: Float64Array,
  tfidfResult: TfidfResult,
  maxCount: number = 3
): string[] {
  const scored: { prompt: string; score: number }[] = [];

  for (const s of memberSessions) {
    const sessionVec = tfidfResult.vectors.get(s.sessionId);
    if (!sessionVec) continue;

    const sim = cosineSimilarity(sessionVec, clusterCentroid);

    for (const turn of s.turns) {
      if (turn.userPrompt && turn.userPrompt.length > 10) {
        scored.push({ prompt: turn.userPrompt, score: sim });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Deduplicate similar prompts
  const selected: string[] = [];
  for (const { prompt } of scored) {
    const trimmed = prompt.length > 150 ? prompt.slice(0, 150) + "..." : prompt;
    if (!selected.some((s) => s === trimmed)) {
      selected.push(trimmed);
      if (selected.length >= maxCount) break;
    }
  }

  return selected;
}

export function generateSuggestedPrompt(
  memberSessions: SessionInput[],
  keywords: string[],
  toolIdf: ToolIdfResult
): string {
  // Collect all user prompts
  const allPrompts = memberSessions.flatMap((s) =>
    s.turns.map((t) => t.userPrompt).filter(Boolean)
  );

  // Extract dominant action
  const action = extractDominantAction(allPrompts);

  // Domain keywords (top 3)
  const domain = keywords.slice(0, 3).join("/");

  // Top tools by Tool-IDF weighted usage in this cluster
  const clusterToolCounts = new Map<string, number>();
  for (const s of memberSessions) {
    for (const [tool, count] of Object.entries(s.meta.toolBreakdown)) {
      clusterToolCounts.set(tool, (clusterToolCounts.get(tool) || 0) + count);
    }
  }
  const toolScores = [...clusterToolCounts.entries()].map(([tool, count]) => ({
    tool,
    score: Math.log(1 + count) * (toolIdf.toolIdfWeights.get(tool) || 1),
  }));
  toolScores.sort((a, b) => b.score - a.score);
  const topTools = toolScores.slice(0, 3).map((t) => t.tool);

  return `${action} ${domain} — tools: ${topTools.join(", ")}`;
}

export function computeToolSignature(
  memberSessions: SessionInput[],
  toolIdf: ToolIdfResult
): { tool: string; weight: number }[] {
  const clusterToolCounts = new Map<string, number>();
  for (const s of memberSessions) {
    for (const [tool, count] of Object.entries(s.meta.toolBreakdown)) {
      clusterToolCounts.set(tool, (clusterToolCounts.get(tool) || 0) + count);
    }
  }

  const scored = [...clusterToolCounts.entries()].map(([tool, count]) => ({
    tool,
    weight: Math.round(Math.log(1 + count) * (toolIdf.toolIdfWeights.get(tool) || 1) * 100) / 100,
  }));
  scored.sort((a, b) => b.weight - a.weight);
  return scored.slice(0, 5);
}

export function classifyDominantRole(
  memberSessions: SessionInput[]
): "user-driven" | "tool-heavy" | "subagent-delegated" {
  let totalUserTurns = 0;
  let totalToolCalls = 0;
  let totalSubagentCalls = 0;

  for (const s of memberSessions) {
    for (const turn of s.turns) {
      if (turn.userPrompt) totalUserTurns++;
      totalToolCalls += turn.toolCalls.length;
      totalSubagentCalls += turn.toolCalls.filter((tc) => tc.toolName === "Agent").length;
    }
    totalSubagentCalls += Object.keys(s.subagents).length;
  }

  const total = totalUserTurns + totalToolCalls + totalSubagentCalls || 1;
  const subagentRatio = totalSubagentCalls / total;
  const toolRatio = totalToolCalls / total;

  if (subagentRatio > 0.15) return "subagent-delegated";
  if (toolRatio > 0.6) return "tool-heavy";
  return "user-driven";
}

export function buildTopicNodes(
  clusterMembers: number[][],
  sessions: SessionInput[],
  tfidf: TfidfResult,
  toolIdf: ToolIdfResult
): TopicNode[] {
  const topics: TopicNode[] = [];

  for (let ci = 0; ci < clusterMembers.length; ci++) {
    const members = clusterMembers[ci];
    const memberSessions = members.map((idx) => sessions[idx]);

    // Compute cluster centroid (TF-IDF text only, for keyword extraction)
    const centroid = new Float64Array(tfidf.vocabulary.length);
    for (const idx of members) {
      const vec = tfidf.vectors.get(sessions[idx].sessionId);
      if (vec) {
        for (let k = 0; k < centroid.length; k++) centroid[k] += vec[k];
      }
    }
    for (let k = 0; k < centroid.length; k++) centroid[k] /= members.length;

    // Top-5 keywords from centroid
    const scored = tfidf.vocabulary.map((term, idx) => ({
      term,
      score: centroid[idx],
    }));
    scored.sort((a, b) => b.score - a.score);
    const keywords = scored.slice(0, 5).map((s) => s.term);

    // Dominant project
    const projectCounts = new Map<string, number>();
    for (const s of memberSessions) {
      projectCounts.set(
        s.projectDisplayName,
        (projectCounts.get(s.projectDisplayName) || 0) + 1
      );
    }
    const sortedProjects = [...projectCounts.entries()].sort(
      (a, b) => b[1] - a[1]
    );
    const dominantProject = sortedProjects[0]?.[0] ?? "";
    const allProjects = [...new Set(memberSessions.map((s) => s.projectDisplayName))];

    // Label: top 2-3 keywords + project
    const labelKeywords = keywords.slice(0, 3).join(", ");
    const projectSuffix = allProjects.length > 1
      ? `(${allProjects.length} projects)`
      : `(${dominantProject.split("/").pop() || dominantProject})`;
    const label = `${labelKeywords} ${projectSuffix}`;

    // Aggregate metadata
    const sessionIds = memberSessions.map((s) => s.sessionId);
    const totalDuration = memberSessions.reduce(
      (sum, s) => sum + s.meta.durationMinutes,
      0
    );
    const totalToolCalls = memberSessions.reduce((sum, s) => {
      return (
        sum +
        Object.values(s.meta.toolBreakdown).reduce((a, b) => a + b, 0)
      );
    }, 0);

    const dates = memberSessions
      .map((s) => s.meta.createdAt)
      .filter(Boolean)
      .sort();

    // New fields: prompts, tool signature, role classification
    // L2 normalize centroid for prompt selection
    let centroidNorm = 0;
    for (let k = 0; k < centroid.length; k++) centroidNorm += centroid[k] * centroid[k];
    centroidNorm = Math.sqrt(centroidNorm);
    const normalizedCentroid = new Float64Array(centroid.length);
    if (centroidNorm > 0) {
      for (let k = 0; k < centroid.length; k++) normalizedCentroid[k] = centroid[k] / centroidNorm;
    }

    const representativePrompts = selectRepresentativePrompts(
      memberSessions, normalizedCentroid, tfidf
    );
    const suggestedPrompt = generateSuggestedPrompt(
      memberSessions, keywords, toolIdf
    );
    const toolSignature = computeToolSignature(memberSessions, toolIdf);
    const dominantRole = classifyDominantRole(memberSessions);

    topics.push({
      id: `topic-${String(ci + 1).padStart(3, "0")}`,
      label,
      keywords,
      project: dominantProject,
      projects: allProjects,
      sessionIds,
      sessionCount: members.length,
      totalDurationMinutes: Math.round(totalDuration),
      totalToolCalls,
      firstSeen: dates[0] || "",
      lastSeen: dates[dates.length - 1] || "",
      betweennessCentrality: 0, // computed later
      degreeCentrality: 0, // computed later
      communityId: -1, // computed later
      representativePrompts,
      suggestedPrompt,
      toolSignature,
      dominantRole,
    });
  }

  return topics;
}
