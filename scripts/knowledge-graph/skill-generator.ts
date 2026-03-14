/**
 * Generates Claude Code skill Markdown and hook JSON from detected patterns.
 */

import type {
  TopicNode,
  EnrichedToolSequence,
  SkillCandidate,
} from "./types.js";

function formatToolList(tools: { tool: string; weight: number }[]): string {
  return tools.map((t) => t.tool).join(", ");
}

function formatStepDescription(topic: TopicNode): string {
  const lines: string[] = [];

  if (topic.representativePrompts.length > 0) {
    lines.push("## Typical Tasks");
    for (const prompt of topic.representativePrompts) {
      lines.push(`- ${prompt}`);
    }
    lines.push("");
  }

  if (topic.toolSignature.length > 0) {
    lines.push("## Recommended Tools");
    for (const ts of topic.toolSignature) {
      lines.push(`- **${ts.tool}** (relevance: ${ts.weight.toFixed(2)})`);
    }
    lines.push("");
  }

  if (topic.dominantRole === "subagent-delegated") {
    lines.push("## Strategy");
    lines.push("This pattern is best handled by delegating to specialized subagents.");
    lines.push("Consider using the Agent tool with appropriate subagent_type.");
    lines.push("");
  } else if (topic.dominantRole === "tool-heavy") {
    lines.push("## Strategy");
    lines.push("This is a tool-intensive pattern. Focus on efficient tool usage sequences.");
    lines.push("");
  }

  return lines.join("\n");
}

export function generateSkillMarkdown(topic: TopicNode): string {
  const title = topic.keywords.slice(0, 3).join(" / ");
  const projects = topic.projects.join(", ");
  const tools = formatToolList(topic.toolSignature);
  const steps = formatStepDescription(topic);

  return `---
description: "${topic.suggestedPrompt}"
---

# ${title}

**Projects**: ${projects}
**Sessions**: ${topic.sessionCount} sessions, ${topic.totalDurationMinutes} min total
**Role**: ${topic.dominantRole}
**Tools**: ${tools}

${steps}
## Suggested Prompt

\`\`\`
${topic.suggestedPrompt}
\`\`\`
`.trim();
}

export function generateHookJson(
  sequence: EnrichedToolSequence
): string | undefined {
  // Only generate hooks for patterns involving Bash commands with identifiable categories
  const bashSteps = sequence.sequence.filter(
    (s) => s.toolName === "Bash" && s.targetPattern && s.targetPattern !== "other"
  );
  if (bashSteps.length === 0) return undefined;

  const hookDef = {
    description: `Auto-detected pattern from ${sequence.count} occurrences across ${sequence.projects.length} project(s)`,
    pattern: sequence.sequence.map((s) => ({
      tool: s.toolName,
      category: s.category,
      target: s.targetPattern || null,
    })),
    sessionCount: sequence.count,
    projects: sequence.projects,
  };

  return JSON.stringify(hookDef, null, 2);
}

export function generateSkillCandidates(
  topics: TopicNode[],
  enrichedSequences: EnrichedToolSequence[]
): SkillCandidate[] {
  const candidates: SkillCandidate[] = [];

  // Generate skill candidates from topics sorted by reusability score
  const sorted = [...topics].sort(
    (a, b) => b.reusabilityScore.overall - a.reusabilityScore.overall
  );

  for (const topic of sorted) {
    // Find enriched sequences related to this topic's sessions
    const topicSessionSet = new Set(topic.sessionIds);
    const relatedSequences = enrichedSequences.filter((seq) =>
      seq.sessionIds.some((sid) => topicSessionSet.has(sid))
    );

    const skillMarkdown = generateSkillMarkdown(topic);
    const hookJson = relatedSequences.length > 0
      ? generateHookJson(relatedSequences[0])
      : undefined;

    candidates.push({
      topicId: topic.id,
      reusabilityScore: topic.reusabilityScore.overall,
      skillMarkdown,
      hookJson,
    });
  }

  return candidates;
}
