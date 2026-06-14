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

/**
 * Weight given to the human feedback term when it is folded in (issue #24).
 * Mirrors the per-facets weights. The remaining weights are scaled by
 * (1 - this) so the total stays 1.0.
 */
export const HUMAN_SIGNAL_WEIGHT = 0.1;

/** Per-session feedback counts used to derive a human signal. */
export interface SessionHumanSignal {
  bookmarked: boolean;
  reusableCount: number;
  antiPatternCount: number;
}

/**
 * Map one session's feedback counts to a signal in [0,1]. Neutral baseline is
 * 0.5; a bookmark nudges up, each `reusable` tag boosts further, each
 * `anti-pattern` tag dampens. Monotonic in each lever and clamped to [0,1].
 *
 * Pure and deterministic so the synthesis pipeline (and tests) can reason about
 * the signal independently of the topic-level aggregation.
 */
export function computeSessionHumanSignal(s: SessionHumanSignal): number {
  let signal = 0.5;
  if (s.bookmarked) signal += 0.15;
  signal += 0.2 * Math.min(s.reusableCount, 3);
  signal -= 0.2 * Math.min(s.antiPatternCount, 3);
  return Math.max(0, Math.min(1, signal));
}

/**
 * Aggregate per-session human signals for a topic. Sessions without feedback
 * contribute the neutral baseline (0.5) so a single flagged session does not
 * dominate a large cluster. Returns 0.5 for an empty topic.
 */
export function aggregateHumanSignal(
  sessionIds: string[],
  signalMap: Map<string, number>
): number {
  if (sessionIds.length === 0) return 0.5;
  let sum = 0;
  for (const sessionId of sessionIds) {
    sum += signalMap.get(sessionId) ?? 0.5;
  }
  return sum / sessionIds.length;
}

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
    // Round the value first, then derive contribution from the rounded value so
    // that value x weight and contribution stay internally consistent.
    const rv = Math.round(value * 1000) / 1000;
    breakdown.push({
      signal,
      value: rv,
      weight,
      contribution: Math.round(rv * weight * 1000) / 1000,
    });
  }
  return breakdown;
}

export function computeReusabilityScores(
  topics: TopicNode[],
  now: Date = new Date(),
  facetsMap?: Map<string, FacetsData>,
  humanSignalMap?: Map<string, number>
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
  const useHuman = humanSignalMap != null && humanSignalMap.size > 0;

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

    const score: ReusabilityScore = {
      overall: 0,
      frequency: Math.round(frequency * 1000) / 1000,
      timeCost: Math.round(timeCost * 1000) / 1000,
      crossProjectScore: Math.round(crossProjectScore * 1000) / 1000,
      recency: Math.round(recency * 1000) / 1000,
    };

    // Build the active weight set and matching signal values.
    const weights: Record<string, number> = {};
    const values: Record<string, number> = {
      frequency,
      timeCost,
      crossProjectScore,
      recency,
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

      Object.assign(weights, FACETS_WEIGHTS);
      values.successRate = successRate;
      values.helpfulness = helpfulness;

      score.successRate = Math.round(successRate * 1000) / 1000;
      score.helpfulness = Math.round(helpfulness * 1000) / 1000;
      score.weightProfile = "facets";
    } else {
      Object.assign(weights, BASE_WEIGHTS);
      score.weightProfile = "base";
    }

    // Fold in the human feedback term (issue #24). Scale the existing weights by
    // (1 - HUMAN_SIGNAL_WEIGHT) so the total stays 1.0 and append the new term,
    // mirroring how facets weights make room for successRate/helpfulness.
    if (useHuman) {
      for (const key of Object.keys(weights)) {
        weights[key] = weights[key] * (1 - HUMAN_SIGNAL_WEIGHT);
      }
      const humanSignal = aggregateHumanSignal(topic.sessionIds, humanSignalMap!);
      weights.humanSignal = HUMAN_SIGNAL_WEIGHT;
      values.humanSignal = humanSignal;
      score.humanSignal = Math.round(humanSignal * 1000) / 1000;
    }

    let overall = 0;
    for (const key of Object.keys(weights)) {
      overall += weights[key] * (values[key] ?? 0);
    }

    score.breakdown = buildBreakdown(weights, values);
    score.overall = Math.round(overall * 1000) / 1000;
    topic.reusabilityScore = score;
  }
}
