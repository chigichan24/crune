/**
 * Reusability score computation for topic nodes.
 * Quantifies how valuable a topic pattern is for automation as skill/hook.
 */

import type { TopicNode, ReusabilityScore, FacetsData } from "./types.js";
import { helpfulnessToScore } from "./facets-reader.js";

/** Weight profile used when no facets data is available. */
export const BASE_WEIGHTS = {
  frequency: 0.35,
  timeCost: 0.25,
  crossProjectScore: 0.25,
  recency: 0.15,
} as const;

/** Weight profile used when facets data enriches the signals. */
export const FACETS_WEIGHTS = {
  frequency: 0.3,
  timeCost: 0.2,
  crossProjectScore: 0.2,
  recency: 0.1,
  successRate: 0.1,
  helpfulness: 0.1,
} as const;

type BreakdownEntry = NonNullable<ReusabilityScore["breakdown"]>[number];

/**
 * Build the per-signal breakdown by iterating the active weight set over the
 * real reusability signal values. contribution = round(weight * value, 3).
 */
function buildBreakdown(
  weights: Record<string, number>,
  values: Record<string, number>
): BreakdownEntry[] {
  const breakdown: BreakdownEntry[] = [];
  for (const signal of Object.keys(weights)) {
    const weight = weights[signal];
    const value = values[signal] ?? 0;
    breakdown.push({
      signal,
      value: Math.round(value * 1000) / 1000,
      weight,
      contribution: Math.round(weight * value * 1000) / 1000,
    });
  }
  return breakdown;
}

export function computeReusabilityScores(
  topics: TopicNode[],
  now: Date = new Date(),
  facetsMap?: Map<string, FacetsData>
): void {
  if (topics.length === 0) return;

  const maxSessionCount = Math.max(...topics.map((t) => t.sessionCount));
  const maxProjects = Math.max(...topics.map((t) => t.projects.length));
  const avgDurations = topics.map((t) =>
    t.sessionCount > 0 ? t.totalDurationMinutes / t.sessionCount : 0
  );
  const maxAvgDuration = Math.max(...avgDurations, 1);

  const nowMs = now.getTime();
  const daysSinceLastSeen = topics.map((t) => {
    if (!t.lastSeen) return Infinity;
    const diff = nowMs - new Date(t.lastSeen).getTime();
    return Math.max(0, diff / (1000 * 60 * 60 * 24));
  });
  const maxDays = Math.max(...daysSinceLastSeen.filter((d) => isFinite(d)), 1);

  const useFacets = facetsMap != null && facetsMap.size > 0;

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];

    const frequency = maxSessionCount > 0
      ? topic.sessionCount / maxSessionCount
      : 0;

    const avgDuration = topic.sessionCount > 0
      ? topic.totalDurationMinutes / topic.sessionCount
      : 0;
    const timeCost = maxAvgDuration > 0
      ? avgDuration / maxAvgDuration
      : 0;

    const crossProjectScore = maxProjects > 1
      ? (topic.projects.length - 1) / (maxProjects - 1)
      : 0;

    const days = daysSinceLastSeen[i];
    const recency = isFinite(days) && maxDays > 0
      ? 1 - days / maxDays
      : 0;

    let overall: number;
    const score: ReusabilityScore = {
      overall: 0,
      frequency: Math.round(frequency * 1000) / 1000,
      timeCost: Math.round(timeCost * 1000) / 1000,
      crossProjectScore: Math.round(crossProjectScore * 1000) / 1000,
      recency: Math.round(recency * 1000) / 1000,
    };

    if (useFacets) {
      // Compute successRate and helpfulness from facets
      let successSum = 0;
      let helpfulnessSum = 0;

      for (const sessionId of topic.sessionIds) {
        const facets = facetsMap!.get(sessionId);
        if (facets) {
          const outcome = facets.outcome;
          successSum += (outcome === "fully_achieved" || outcome === "mostly_achieved") ? 1.0 : 0.0;
          helpfulnessSum += helpfulnessToScore(facets.claudeHelpfulness);
        } else {
          successSum += 0.5;
          helpfulnessSum += 0.5;
        }
      }

      const sessionCount = topic.sessionIds.length || 1;
      const successRate = successSum / sessionCount;
      const helpfulness = helpfulnessSum / sessionCount;

      overall =
        FACETS_WEIGHTS.frequency * frequency +
        FACETS_WEIGHTS.timeCost * timeCost +
        FACETS_WEIGHTS.crossProjectScore * crossProjectScore +
        FACETS_WEIGHTS.recency * recency +
        FACETS_WEIGHTS.successRate * successRate +
        FACETS_WEIGHTS.helpfulness * helpfulness;

      score.successRate = Math.round(successRate * 1000) / 1000;
      score.helpfulness = Math.round(helpfulness * 1000) / 1000;

      score.weightProfile = "facets";
      score.breakdown = buildBreakdown(FACETS_WEIGHTS, {
        frequency,
        timeCost,
        crossProjectScore,
        recency,
        successRate,
        helpfulness,
      });
    } else {
      overall =
        BASE_WEIGHTS.frequency * frequency +
        BASE_WEIGHTS.timeCost * timeCost +
        BASE_WEIGHTS.crossProjectScore * crossProjectScore +
        BASE_WEIGHTS.recency * recency;

      score.weightProfile = "base";
      score.breakdown = buildBreakdown(BASE_WEIGHTS, {
        frequency,
        timeCost,
        crossProjectScore,
        recency,
      });
    }

    score.overall = Math.round(overall * 1000) / 1000;
    topic.reusabilityScore = score;
  }
}
