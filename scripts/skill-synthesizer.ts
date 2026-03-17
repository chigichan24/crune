import { spawn } from "node:child_process";

// ---------- Types ----------

export interface ToolSignatureEntry {
  tool: string;
  weight: number;
}

export interface ReusabilityScore {
  overall: number;
  frequency: number;
  timeCost: number;
  crossProjectScore: number;
  recency: number;
}

export interface TopicNode {
  id: string;
  label: string;
  keywords: string[];
  dominantRole: string;
  projects: string[];
  project: string;
  sessionCount: number;
  totalDurationMinutes: number;
  totalToolCalls: number;
  toolSignature: ToolSignatureEntry[];
  representativePrompts: string[];
  suggestedPrompt: string;
  reusabilityScore: ReusabilityScore;
  betweennessCentrality: number;
  degreeCentrality: number;
}

export interface SkillCandidate {
  topicId: string;
  reusabilityScore: number;
  skillMarkdown: string;
  hookJson?: string;
}

export interface EnrichedSequence {
  sequence: { toolName: string; category: string; targetPattern?: string }[];
  count: number;
  sessionIds: string[];
  projects: string[];
}

export interface ConnectedTopic {
  id: string;
  label: string;
  keywords: string[];
  edgeType: string; // semantic-similarity | shared-module | workflow-continuation | cross-project-bridge
  strength: number;
  direction: 'incoming' | 'outgoing';
}

export interface GraphContext {
  connectedTopics: ConnectedTopic[];
  community?: { label: string; memberCount: number };
  isBridgeTopic: boolean;
}

export interface FacetsInsightsSummary {
  aggregatedGoals: string[];
  normalizedCategories: string[];
  successRate: number;
  helpfulnessScore: number;
  commonFrictions: string[];
  frictionDetails: string[];
}

export interface SynthesisRequest {
  skillCandidate: SkillCandidate;
  topicNode: TopicNode;
  enrichedSequences?: EnrichedSequence[];
  graphContext?: GraphContext;
  facetsInsights?: FacetsInsightsSummary;
}

export interface SynthesisResponse {
  success: boolean;
  synthesizedMarkdown?: string;
  error?: string;
}

// ---------- Prompt Builder ----------

export function buildSynthesisPrompt(body: SynthesisRequest): string {
  const { skillCandidate, topicNode, enrichedSequences, graphContext, facetsInsights } = body;

  const topicInfo = [
    `## Topic Information`,
    `- **Label:** ${topicNode.label}`,
    `- **Keywords:** ${topicNode.keywords.join(", ")}`,
    `- **Dominant Role:** ${topicNode.dominantRole}`,
    `- **Projects:** ${topicNode.projects.join(", ")}`,
    `- **Session Count:** ${topicNode.sessionCount}`,
    `- **Total Duration:** ${topicNode.totalDurationMinutes} minutes`,
  ].join("\n");

  const prompts = topicNode.representativePrompts.length > 0
    ? [
        `## Representative User Prompts`,
        ...topicNode.representativePrompts.map((p, i) => `${i + 1}. ${p}`),
      ].join("\n")
    : "";

  const toolSig = [
    `## Tool Signature`,
    ...topicNode.toolSignature.map(
      (t) => `- ${t.tool}: ${(t.weight * 100).toFixed(1)}%`
    ),
  ].join("\n");

  let toolPatterns = "";
  if (enrichedSequences && enrichedSequences.length > 0) {
    const top5 = enrichedSequences.slice(0, 5);
    const flows = top5.map((seq) => {
      const flow = seq.sequence.map((s) => s.toolName).join(" → ");
      return `- ${flow} (${seq.count}x across ${seq.projects.length} project(s))`;
    });
    toolPatterns = [`## Enriched Tool Patterns`, ...flows].join("\n");
  }

  // --- Graph context sections ---
  let graphPosition = "";
  let connectedTopicsSection = "";
  if (graphContext) {
    // Graph Position section
    const positionLines = [`## Graph Position`];

    const betweenness = topicNode.betweennessCentrality;
    const degree = topicNode.degreeCentrality;

    if (betweenness > 0.2) {
      positionLines.push("- This is a critical bridge topic connecting multiple knowledge domains");
    } else if (betweenness > 0.05) {
      positionLines.push("- This topic bridges several knowledge domains");
    } else if (degree > 0.5) {
      positionLines.push("- This is a hub topic connected to many other topics");
    } else if (degree === 0) {
      positionLines.push("- This is an isolated topic with no connections to other topics");
    } else {
      positionLines.push("- This is a peripheral topic");
    }

    if (graphContext.community) {
      positionLines.push(`- Belongs to community: ${graphContext.community.label} (${graphContext.community.memberCount} topics)`);
    }

    if (graphContext.isBridgeTopic) {
      positionLines.push("- Identified as a bridge topic in the knowledge graph");
    }

    graphPosition = positionLines.join("\n");

    // Connected Topics section
    if (graphContext.connectedTopics.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const ct of graphContext.connectedTopics) {
        if (!grouped[ct.edgeType]) {
          grouped[ct.edgeType] = [];
        }

        const kw = ct.keywords.join(", ");
        if (ct.edgeType === "workflow-continuation") {
          if (ct.direction === "incoming") {
            grouped[ct.edgeType].push(`- Prerequisite: ${ct.label} [${kw}] (strength: ${ct.strength})`);
          } else {
            grouped[ct.edgeType].push(`- Follow-up: ${ct.label} [${kw}] (strength: ${ct.strength})`);
          }
        } else if (ct.edgeType === "shared-module") {
          grouped[ct.edgeType].push(`- Related (shared files): ${ct.label} [${kw}]`);
        } else if (ct.edgeType === "cross-project-bridge") {
          grouped[ct.edgeType].push(`- Cross-project link: ${ct.label} [${kw}]`);
        } else if (ct.edgeType === "semantic-similarity") {
          grouped[ct.edgeType].push(`- Similar topic (differentiate from): ${ct.label} [${kw}]`);
        }
      }

      const lines = [`## Connected Topics`];
      if (grouped["workflow-continuation"]) {
        lines.push("### Workflow Continuation");
        lines.push(...grouped["workflow-continuation"]);
      }
      if (grouped["shared-module"]) {
        lines.push("### Shared Module");
        lines.push(...grouped["shared-module"]);
      }
      if (grouped["cross-project-bridge"]) {
        lines.push("### Cross-Project Bridge");
        lines.push(...grouped["cross-project-bridge"]);
      }
      if (grouped["semantic-similarity"]) {
        lines.push("### Semantic Similarity");
        lines.push(...grouped["semantic-similarity"]);
      }

      connectedTopicsSection = lines.join("\n");
    }
  }

  const reference = [
    `## Current Heuristic-Generated Skill (for reference)`,
    "```",
    skillCandidate.skillMarkdown,
    "```",
  ].join("\n");

  const instructionLines = [
    `## Your Task`,
    `Produce a refined SKILL.md for this workflow following anthropics/skills conventions. Rules:`,
    ``,
    `1. Start with YAML frontmatter containing \`name\` and \`description\`. The description MUST include an explicit "when to use" trigger (pushiness) so Claude knows when to activate this skill. Counter under-triggering by being specific about activation context.`,
    `2. Use concise, imperative writing style throughout.`,
    `3. Structure the body with these sections:`,
    `   - **Overview**: What this skill automates and why (1-2 sentences)`,
    `   - **When to Use**: Explicit trigger patterns with concrete examples from the representative prompts above`,
    `   - **Workflow**: Step-by-step imperative instructions using the detected tool patterns`,
    `   - **Guidelines**: "Why"-based rules (not bare MUST/NEVER). Each guideline explains reasoning.`,
    `4. Include concrete examples drawn from the representative prompts above.`,
    `5. Focus on the ESSENCE of what makes this workflow distinct and reusable. Progressive disclosure: keep body scannable.`,
    `6. Write the body in Japanese. Skill names, tool names, technical terms, and proper nouns should remain in English.`,
    `7. Output ONLY the markdown content. No code fences wrapping the output, no explanations before or after.`,
  ];

  if (graphContext && graphContext.connectedTopics.some(ct => ct.edgeType === "workflow-continuation")) {
    instructionLines.push(`8. If workflow-continuation connections exist, include \`requires\` and/or \`next\` fields in the YAML frontmatter listing the connected topic labels.`);
  }

  const instruction = instructionLines.join("\n");

  // --- Facets insights section ---
  let facetsSection = "";
  if (facetsInsights) {
    const lines = [`## Session Insights (from /insights analysis)`];
    if (facetsInsights.aggregatedGoals.length > 0) {
      lines.push(`- **Underlying Goals:** ${facetsInsights.aggregatedGoals.join("; ")}`);
    }
    if (facetsInsights.normalizedCategories.length > 0) {
      lines.push(`- **Goal Categories:** ${facetsInsights.normalizedCategories.join(", ")}`);
    }
    lines.push(`- **Success Rate:** ${(facetsInsights.successRate * 100).toFixed(0)}% of sessions achieved their goal`);
    lines.push(`- **Helpfulness Score:** ${(facetsInsights.helpfulnessScore * 100).toFixed(0)}%`);
    if (facetsInsights.commonFrictions.length > 0) {
      lines.push(`- **Common Frictions:** ${facetsInsights.commonFrictions.join(", ")}`);
      for (const detail of facetsInsights.frictionDetails.slice(0, 2)) {
        lines.push(`  - ${detail}`);
      }
    }
    facetsSection = lines.join("\n");
  }

  const parts = [topicInfo, prompts, toolSig, toolPatterns, graphPosition, connectedTopicsSection, facetsSection, reference, instruction].filter(Boolean);
  return parts.join("\n\n");
}

// ---------- Distill with Claude CLI ----------

export interface SynthesisOptions {
  model?: string;       // e.g. "haiku", "sonnet", "opus"
  timeoutMs?: number;   // default: 120_000
}

export function synthesizeWithClaude(prompt: string, options: SynthesisOptions = {}): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  const timeoutMs = options.timeoutMs ?? 300_000;

  return new Promise((resolve) => {
    const args = ["-p", "--output-format", "text", "--permission-mode", "acceptEdits", "--no-session-persistence"];
    if (options.model) {
      args.push("--model", options.model);
    }

    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let notFound = false;

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        notFound = true;
        resolve({ success: false, stdout: "", stderr: "", error: "claude CLI not found. Install Claude Code first." });
      }
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({
        success: false,
        stdout: "",
        stderr: "",
        error: `Synthesis timed out (${timeoutMs / 1000}s)`,
      });
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (!notFound) {
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");
        if (code !== 0) {
          resolve({
            success: false,
            stdout: "",
            stderr,
            error: `claude exited with code ${code}: ${stderr}`,
          });
        } else {
          resolve({ success: true, stdout, stderr: "" });
        }
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
