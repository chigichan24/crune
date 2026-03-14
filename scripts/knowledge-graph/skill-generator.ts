/**
 * Generates Claude Code skill Markdown and hook JSON from detected patterns.
 *
 * Skill format follows the conventions from anthropics/skills (Apache-2.0):
 * https://github.com/anthropics/skills/tree/main/skills/skill-creator
 *
 * Key conventions applied:
 * - YAML frontmatter with `name` and `description` (description includes "when to use")
 * - Imperative writing style
 * - "Why" explanations over bare MUST/NEVER rules
 * - Concrete examples from representative prompts
 * - Progressive disclosure: keep SKILL.md body concise
 */

import type {
  TopicNode,
  EnrichedToolSequence,
  SkillCandidate,
} from "./types.js";

// ─── Skill name generation ──────────────────────────────────────────────────

function toSkillName(keywords: string[], project: string): string {
  // Use top keywords + project suffix, kebab-case, max 40 chars
  const parts = keywords
    .slice(0, 3)
    .map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((k) => k.length > 0);

  const projectSuffix = project
    .split("/")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (projectSuffix && !parts.includes(projectSuffix)) {
    parts.push(projectSuffix);
  }

  return parts.join("-").slice(0, 40);
}

// ─── Description generation (with "pushiness" per skill-creator guidance) ───

function buildDescription(topic: TopicNode): string {
  // Description should include WHEN to use + WHAT it does.
  // skill-creator calls this "pushiness" — explicit about trigger context
  // to counteract under-triggering.
  const action = topic.suggestedPrompt.split(" — ")[0] || "work on this domain";
  const tools = topic.toolSignature
    .slice(0, 3)
    .map((t) => t.tool)
    .join(", ");
  const roleHint =
    topic.dominantRole === "subagent-delegated"
      ? "Delegates to specialized subagents."
      : topic.dominantRole === "tool-heavy"
        ? `Tool-intensive workflow using ${tools}.`
        : `Interactive workflow using ${tools}.`;

  const projectScope =
    topic.projects.length > 1
      ? `Applies across ${topic.projects.length} projects (${topic.projects.slice(0, 2).join(", ")}${topic.projects.length > 2 ? ", ..." : ""}).`
      : `Scoped to ${topic.project}.`;

  return `Use when you need to ${action}. ${roleHint} ${projectScope} Detected from ${topic.sessionCount} sessions over ${topic.totalDurationMinutes} minutes of usage.`;
}

// ─── Skill body generation ──────────────────────────────────────────────────

function buildSkillBody(
  topic: TopicNode,
  relatedSequences: EnrichedToolSequence[]
): string {
  const sections: string[] = [];

  // Section 1: Overview — what this skill automates and why
  sections.push("## Overview");
  sections.push("");
  sections.push(
    `This skill captures a recurring workflow pattern detected across ${topic.sessionCount} sessions.`
  );
  if (topic.projects.length > 1) {
    sections.push(
      `It spans ${topic.projects.length} projects, indicating cross-project reusable knowledge.`
    );
  }
  sections.push("");

  // Section 2: When to use — explicit trigger guidance (skill-creator: "pushiness")
  sections.push("## When to Use");
  sections.push("");
  if (topic.representativePrompts.length > 0) {
    sections.push("Activate this skill when the user's request resembles:");
    for (const prompt of topic.representativePrompts) {
      sections.push(`- "${prompt}"`);
    }
  } else {
    sections.push(
      `Activate when working on tasks involving: ${topic.keywords.join(", ")}.`
    );
  }
  sections.push("");

  // Section 3: Workflow steps — imperative style per skill-creator guidance
  sections.push("## Workflow");
  sections.push("");

  if (topic.dominantRole === "subagent-delegated") {
    sections.push(
      "Delegate to specialized subagents. This pattern benefits from parallel execution:"
    );
    sections.push("");
    sections.push("1. Analyze the task scope and identify subtasks");
    sections.push(
      "2. Spawn subagents for each independent subtask using the Agent tool"
    );
    sections.push("3. Collect and synthesize results");
    sections.push("");
  } else {
    // Build steps from tool signature — imperative, concrete
    sections.push("Follow this tool sequence:");
    sections.push("");
    const toolSteps = topic.toolSignature.slice(0, 5);
    for (let i = 0; i < toolSteps.length; i++) {
      const ts = toolSteps[i];
      const purpose = describeToolPurpose(ts.tool);
      sections.push(`${i + 1}. Use **${ts.tool}** to ${purpose}`);
    }
    sections.push("");
  }

  // Section 4: Enriched patterns — concrete tool sequences with targets
  if (relatedSequences.length > 0) {
    sections.push("## Detected Patterns");
    sections.push("");
    sections.push(
      "The following tool call patterns were frequently observed in this workflow:"
    );
    sections.push("");
    for (const seq of relatedSequences.slice(0, 3)) {
      const flow = seq.sequence
        .map((s) => {
          const target = s.targetPattern ? ` (${s.targetPattern})` : "";
          return `${s.toolName}${target}`;
        })
        .join(" → ");
      sections.push(`- \`${flow}\` — ${seq.count} occurrences`);
    }
    sections.push("");
  }

  // Section 5: Guidelines — why-based, not bare rules
  sections.push("## Guidelines");
  sections.push("");
  if (topic.dominantRole === "tool-heavy") {
    sections.push(
      "- Prefer tool calls over asking the user, because this pattern historically involves intensive automated operations."
    );
  }
  if (topic.projects.length > 1) {
    sections.push(
      "- Check project-specific conventions before applying, because this pattern spans multiple projects that may have different standards."
    );
  }
  const readTools = topic.toolSignature.filter(
    (t) => t.tool === "Read" || t.tool === "Grep" || t.tool === "Glob"
  );
  if (readTools.length > 0) {
    sections.push(
      "- Read and understand existing code before making changes, because this pattern involves significant code exploration."
    );
  }
  sections.push("");

  return sections.join("\n");
}

function describeToolPurpose(tool: string): string {
  switch (tool) {
    case "Read":
      return "examine existing files and understand current state";
    case "Grep":
      return "search for relevant patterns and references";
    case "Glob":
      return "locate target files by pattern";
    case "Edit":
      return "apply targeted modifications to existing files";
    case "Write":
      return "create new files as needed";
    case "Bash":
      return "execute commands (build, test, git operations)";
    case "Agent":
      return "delegate subtasks to specialized subagents";
    default:
      return `perform ${tool} operations`;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function generateSkillMarkdown(
  topic: TopicNode,
  relatedSequences: EnrichedToolSequence[] = []
): string {
  const name = toSkillName(topic.keywords, topic.project);
  const description = buildDescription(topic);
  const body = buildSkillBody(topic, relatedSequences);

  return `---
name: ${name}
description: >-
  ${description}
---

# ${topic.keywords.slice(0, 3).join(" / ")}

${body}`.trim();
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

    const skillMarkdown = generateSkillMarkdown(topic, relatedSequences);
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
