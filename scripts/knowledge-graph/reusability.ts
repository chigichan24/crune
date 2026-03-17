/**
 * Reusability score computation for topic nodes.
 * Quantifies how valuable a topic pattern is for automation as skill/hook.
 */

import type { TopicNode, ReusabilityScore, FacetsData } from "./types.js";
import { helpfulnessToScore } from "./facets-reader.js";

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
        0.30 * frequency +
        0.20 * timeCost +
        0.20 * crossProjectScore +
        0.10 * recency +
        0.10 * successRate +
        0.10 * helpfulness;

      score.successRate = Math.round(successRate * 1000) / 1000;
      score.helpfulness = Math.round(helpfulness * 1000) / 1000;
    } else {
      overall =
        0.35 * frequency +
        0.25 * timeCost +
        0.25 * crossProjectScore +
        0.15 * recency;
    }

    score.overall = Math.round(overall * 1000) / 1000;
    topic.reusabilityScore = score;
  }
}
