/**
 * Reads facets JSON files from /insights directory and provides
 * utilities for normalization and aggregation.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { FacetsData, FacetsInsightsSummary } from "./types.js";

// ─── Goal category normalization ────────────────────────────────────────────

export function normalizeGoalCategory(raw: string): string {
  if (
    raw.startsWith("feature") ||
    raw.startsWith("ui_") ||
    raw.startsWith("css_")
  ) {
    return "feature";
  }
  if (
    raw.startsWith("fix_") ||
    raw.startsWith("bug_") ||
    raw.startsWith("debug")
  ) {
    return "bugfix";
  }
  if (
    raw.startsWith("refactoring") ||
    raw === "code_cleanup" ||
    raw.startsWith("cleanup_")
  ) {
    return "refactoring";
  }
  if (raw.startsWith("documentation") || raw.startsWith("readme_")) {
    return "documentation";
  }
  if (raw.startsWith("code_review")) {
    return "review";
  }
  if (raw.startsWith("test_")) {
    return "testing";
  }
  if (raw.startsWith("ci_")) {
    return "ci";
  }
  if (
    raw.startsWith("git_") ||
    raw === "create_pr" ||
    raw.startsWith("pr_") ||
    raw.startsWith("resolve_merge")
  ) {
    return "git_ops";
  }
  if (
    raw.startsWith("setup_") ||
    raw.startsWith("configuration_") ||
    raw.startsWith("dependency_") ||
    raw.startsWith("npm_")
  ) {
    return "setup";
  }
  return "other";
}

// ─── Read facets directory ──────────────────────────────────────────────────

export function readFacetsDir(facetsDir: string): Map<string, FacetsData> {
  const result = new Map<string, FacetsData>();

  if (!existsSync(facetsDir)) {
    console.warn(`[facets-reader] Directory not found: ${facetsDir}`);
    return result;
  }

  let files: string[];
  try {
    files = readdirSync(facetsDir).filter((f) => f.endsWith(".json"));
  } catch (err) {
    console.warn(`[facets-reader] Failed to read directory: ${facetsDir}`, err);
    return result;
  }

  for (const file of files) {
    try {
      const raw = readFileSync(join(facetsDir, file), "utf-8");
      const json = JSON.parse(raw) as Record<string, unknown>;

      const facets: FacetsData = {
        sessionId: json.session_id as string,
        underlyingGoal: json.underlying_goal as string,
        goalCategories: json.goal_categories as Record<string, number>,
        outcome: json.outcome as string,
        claudeHelpfulness: json.claude_helpfulness as string,
        sessionType: json.session_type as string,
        frictionCounts: json.friction_counts as Record<string, number>,
        frictionDetail: json.friction_detail as string,
        primarySuccess: json.primary_success as string,
        briefSummary: json.brief_summary as string,
      };

      if (facets.sessionId) {
        result.set(facets.sessionId, facets);
      }
    } catch (err) {
      console.warn(`[facets-reader] Failed to parse ${file}`, err);
    }
  }

  return result;
}

// ─── Helpfulness mapping ────────────────────────────────────────────────────

export function helpfulnessToScore(helpfulness: string): number {
  switch (helpfulness) {
    case "essential":
      return 1.0;
    case "very_helpful":
      return 0.8;
    case "moderately_helpful":
      return 0.5;
    case "slightly_helpful":
      return 0.25;
    case "unhelpful":
      return 0.0;
    default:
      return 0.5;
  }
}

// ─── Aggregate facets for a topic ───────────────────────────────────────────

export function aggregateFacetsForTopic(
  sessionIds: string[],
  facetsMap: Map<string, FacetsData>
): FacetsInsightsSummary | undefined {
  const matchedFacets: FacetsData[] = [];
  for (const sid of sessionIds) {
    const f = facetsMap.get(sid);
    if (f) matchedFacets.push(f);
  }

  if (matchedFacets.length === 0) return undefined;

  // aggregatedGoals: unique underlying_goal strings, max 3
  const goalsSet = new Set<string>();
  for (const f of matchedFacets) {
    if (f.underlyingGoal) goalsSet.add(f.underlyingGoal);
  }
  const aggregatedGoals = [...goalsSet].slice(0, 3);

  // normalizedCategories: unique normalized goal categories across all sessions
  const categorySet = new Set<string>();
  for (const f of matchedFacets) {
    if (f.goalCategories) {
      for (const key of Object.keys(f.goalCategories)) {
        categorySet.add(normalizeGoalCategory(key));
      }
    }
  }
  const normalizedCategories = [...categorySet];

  // successRate: fraction with fully_achieved or mostly_achieved
  // Sessions without facets get 0.5
  let successSum = 0;
  for (const sid of sessionIds) {
    const f = facetsMap.get(sid);
    if (f) {
      const achieved =
        f.outcome === "fully_achieved" || f.outcome === "mostly_achieved";
      successSum += achieved ? 1 : 0;
    } else {
      successSum += 0.5;
    }
  }
  const successRate = sessionIds.length > 0 ? successSum / sessionIds.length : 0;

  // helpfulnessScore: average helpfulnessToScore
  // Sessions without facets get 0.5
  let helpSum = 0;
  for (const sid of sessionIds) {
    const f = facetsMap.get(sid);
    if (f) {
      helpSum += helpfulnessToScore(f.claudeHelpfulness);
    } else {
      helpSum += 0.5;
    }
  }
  const helpfulnessScore =
    sessionIds.length > 0 ? helpSum / sessionIds.length : 0;

  // commonFrictions: merge friction_counts, sort by count desc, top 5
  const frictionMerged = new Map<string, number>();
  for (const f of matchedFacets) {
    if (f.frictionCounts) {
      for (const [key, count] of Object.entries(f.frictionCounts)) {
        frictionMerged.set(key, (frictionMerged.get(key) || 0) + count);
      }
    }
  }
  const commonFrictions = [...frictionMerged.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key]) => key);

  // frictionDetails: non-empty friction_detail strings, max 3
  const frictionDetails = matchedFacets
    .map((f) => f.frictionDetail)
    .filter((d) => d && d.length > 0)
    .slice(0, 3);

  return {
    aggregatedGoals,
    normalizedCategories,
    successRate,
    helpfulnessScore,
    commonFrictions,
    frictionDetails,
  };
}
