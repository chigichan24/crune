import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";

// ---------- Types ----------

interface ToolSignatureEntry {
  tool: string;
  weight: number;
}

interface ReusabilityScore {
  overall: number;
  frequency: number;
  timeCost: number;
  crossProjectScore: number;
  recency: number;
}

interface TopicNode {
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

interface SkillCandidate {
  topicId: string;
  reusabilityScore: number;
  skillMarkdown: string;
  hookJson?: string;
}

interface EnrichedSequence {
  sequence: { toolName: string; category: string; targetPattern?: string }[];
  count: number;
  sessionIds: string[];
  projects: string[];
}

interface ConnectedTopic {
  id: string;
  label: string;
  keywords: string[];
  edgeType: string; // semantic-similarity | shared-module | workflow-continuation | cross-project-bridge
  strength: number;
  direction: 'incoming' | 'outgoing';
}

interface GraphContext {
  connectedTopics: ConnectedTopic[];
  community?: { label: string; memberCount: number };
  isBridgeTopic: boolean;
}

interface DistillRequest {
  skillCandidate: SkillCandidate;
  topicNode: TopicNode;
  enrichedSequences?: EnrichedSequence[];
  graphContext?: GraphContext;
}

interface DistillResponse {
  success: boolean;
  distilledMarkdown?: string;
  error?: string;
}

// ---------- Prompt Builder ----------

export function buildDistillationPrompt(body: DistillRequest): string {
  const { skillCandidate, topicNode, enrichedSequences, graphContext } = body;

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
    `Produce a refined SKILL.md for this workflow. Follow these rules strictly:`,
    ``,
    `1. Start with YAML frontmatter containing \`name\` and \`description\`. The description must include a when-to-use trigger so Claude knows when to activate this skill.`,
    `2. Use concise, imperative writing style throughout.`,
    `3. Provide "why" explanations rather than bare rules --- each guideline should explain the reasoning.`,
    `4. Include concrete examples drawn from the representative prompts above.`,
    `5. Focus on the ESSENCE of what makes this workflow distinct and reusable.`,
    `6. Write the body in Japanese. Skill names, tool names, technical terms, and proper nouns should remain in English.`,
    `7. Output ONLY the markdown content. No code fences wrapping the output, no explanations before or after.`,
  ];

  if (graphContext && graphContext.connectedTopics.some(ct => ct.edgeType === "workflow-continuation")) {
    instructionLines.push(`8. If workflow-continuation connections exist, include \`requires\` and/or \`next\` fields in the YAML frontmatter listing the connected topic labels.`);
  }

  const instruction = instructionLines.join("\n");

  const parts = [topicInfo, prompts, toolSig, toolPatterns, graphPosition, connectedTopicsSection, reference, instruction].filter(Boolean);
  return parts.join("\n\n");
}

// ---------- Helpers ----------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: DistillResponse | { error: string }) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function distill(prompt: string): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean; notFound: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let notFound = false;

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        notFound = true;
        resolve({ stdout: "", stderr: "", code: null, timedOut: false, notFound: true });
      }
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        code: null,
        timedOut: true,
        notFound: false,
      });
    }, 120_000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (!notFound) {
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
          code,
          timedOut: false,
          notFound: false,
        });
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ---------- Request Handler ----------

async function handleDistill(req: IncomingMessage, res: ServerResponse) {
  let body: DistillRequest;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { success: false, error: "Invalid JSON in request body" });
    return;
  }

  if (!body.skillCandidate || !body.topicNode) {
    sendJson(res, 400, { success: false, error: "Missing required fields: skillCandidate, topicNode" });
    return;
  }

  const prompt = buildDistillationPrompt(body);
  const result = await distill(prompt);

  if (result.notFound) {
    sendJson(res, 500, { success: false, error: "claude CLI not found. Install Claude Code first." });
    return;
  }

  if (result.timedOut) {
    sendJson(res, 500, { success: false, error: "Distillation timed out (120s)" });
    return;
  }

  if (result.code !== 0) {
    sendJson(res, 500, {
      success: false,
      error: `claude exited with code ${result.code}: ${result.stderr}`,
    });
    return;
  }

  sendJson(res, 200, { success: true, distilledMarkdown: result.stdout });
}

// ---------- Server ----------

const isDirectRun = process.argv[1]?.endsWith("skill-server.ts") || process.argv[1]?.endsWith("skill-server.js");

if (isDirectRun) {
  const PORT = 3456;

  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/api/distill") {
      await handleDistill(req, res);
    } else {
      sendJson(res, 404, { error: "Not found" });
    }
  });

  server.listen(PORT, () => {
    console.log(`Skill distillation server listening on http://localhost:${PORT}`);
  });

  function shutdown() {
    console.log("\nShutting down...");
    server.close(() => {
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
