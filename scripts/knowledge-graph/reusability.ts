/**
 * Reusability score computation for topic nodes.
 * Quantifies how valuable a topic pattern is for automation as skill/hook.
 */

import type { TopicNode, ReusabilityScore } from "./types.js";

export function computeReusabilityScores(
  topics: TopicNode[],
  now: Date = new Date()
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

    const overall =
      0.35 * frequency +
      0.25 * timeCost +
      0.25 * crossProjectScore +
      0.15 * recency;

    const score: ReusabilityScore = {
      overall: Math.round(overall * 1000) / 1000,
      frequency: Math.round(frequency * 1000) / 1000,
      timeCost: Math.round(timeCost * 1000) / 1000,
      crossProjectScore: Math.round(crossProjectScore * 1000) / 1000,
      recency: Math.round(recency * 1000) / 1000,
    };

    topic.reusabilityScore = score;
  }
}
