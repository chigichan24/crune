/**
 * CLI entry point for `npx @chigichan24/crune`
 * Generates skill definitions from Claude Code session logs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  discoverSessions,
  parseJsonlFile,
  buildTurns,
  extractMetadata,
  parseSubagents,
  type ParsedSession,
} from "./session-parser.js";
import {
  buildSemanticKnowledgeGraph,
  type SessionInput,
} from "./knowledge-graph-builder.js";
import {
  buildSynthesisPrompt,
  synthesizeWithClaude,
  type TopicNode as SynthTopicNode,
} from "./skill-synthesizer.js";

// ─── CLI argument parsing ─────────────────────────────────────────

interface CliArgs {
  sessionsDir: string;
  outputDir: string;
  count: number;
  model?: string;
  skipSynthesis: boolean;
  dryRun: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let sessionsDir = path.join(os.homedir(), ".claude", "projects");
  let outputDir = path.resolve("skills");
  let count = 5;
  let model: string | undefined;
  let skipSynthesis = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sessions-dir" && args[i + 1]) {
      sessionsDir = path.resolve(args[++i]);
    } else if (args[i] === "--output-dir" && args[i + 1]) {
      outputDir = path.resolve(args[++i]);
    } else if (args[i] === "--count" && args[i + 1]) {
      const parsed = parseInt(args[++i], 10);
      count = Math.max(1, Number.isNaN(parsed) ? 5 : parsed);
    } else if (args[i] === "--model" && args[i + 1]) {
      model = args[++i];
    } else if (args[i] === "--skip-synthesis") {
      skipSynthesis = true;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return { sessionsDir, outputDir, count, model, skipSynthesis, dryRun };
}

function printUsage(): void {
  console.error(`Usage: crune [options]

Generate reusable skill definitions from Claude Code session logs.

Options:
  --sessions-dir <path>  Session logs directory (default: ~/.claude/projects)
  --output-dir <path>    Output directory for skill files (default: ./skills)
  --count <n>            Number of skills to generate (default: 5)
  --model <model>        Claude model for synthesis (e.g., haiku, sonnet)
  --skip-synthesis       Skip LLM synthesis, output heuristic skills only
  --dry-run              Show candidates without writing files
  -h, --help             Show this help message`);
}

// ─── Main pipeline ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseCliArgs(process.argv);

  console.error("Discovering sessions...");
  const sessionFiles = discoverSessions(config.sessionsDir);
  if (sessionFiles.length === 0) {
    console.error(`No sessions found in ${config.sessionsDir}`);
    process.exit(1);
  }
  console.error(`  Found ${sessionFiles.length} sessions`);

  // Parse all sessions
  console.error("Parsing sessions...");
  const parsedSessions: ParsedSession[] = [];
  for (const sf of sessionFiles) {
    const lines = await parseJsonlFile(sf.filePath);
    if (lines.length === 0) continue;
    const turns = buildTurns(lines);
    const meta = extractMetadata(sf, lines, turns);
    const subagents = await parseSubagents(sf.subagentFiles);
    parsedSessions.push({
      meta,
      turns,
      subagents,
      linkedPlan: null,
      projectDir: sf.projectDir,
      projectDisplayName: sf.projectDisplayName,
    });
  }
  console.error(`  Parsed ${parsedSessions.length} sessions`);

  // Build knowledge graph — reuse same conversion as analyze-sessions.ts
  console.error("Building knowledge graph...");
  const sessionInputs: SessionInput[] = parsedSessions.map((s) => ({
    sessionId: s.meta.sessionId,
    projectDisplayName: s.projectDisplayName,
    turns: s.turns.map((t) => ({
      userPrompt: t.userPrompt,
      assistantTexts: t.assistantTexts,
      toolCalls: t.toolCalls.map((tc) => ({
        toolName: tc.toolName,
        input: tc.input,
      })),
    })),
    subagents: Object.fromEntries(
      Object.entries(s.subagents).map(([id, sub]) => [
        id,
        {
          agentId: sub.agentId,
          agentType: sub.agentType,
          turns: sub.turns.map((t) => ({
            userPrompt: t.userPrompt,
            assistantTexts: t.assistantTexts,
            toolCalls: t.toolCalls.map((tc) => ({
              toolName: tc.toolName,
              input: tc.input,
            })),
          })),
        },
      ])
    ),
    meta: {
      sessionId: s.meta.sessionId,
      createdAt: s.meta.createdAt,
      lastActiveAt: s.meta.lastActiveAt,
      durationMinutes: s.meta.durationMinutes,
      filesEdited: s.meta.filesEdited,
      gitBranch: s.meta.gitBranch,
      toolBreakdown: s.meta.toolBreakdown,
      subagentCount: s.meta.subagentCount,
    },
  }));

  const knowledgeGraph = buildSemanticKnowledgeGraph(sessionInputs);
  console.error(
    `  ${knowledgeGraph.nodes.length} topics, ${knowledgeGraph.skillCandidates.length} skill candidates`
  );

  // Select top candidates
  const topCandidates = [...knowledgeGraph.skillCandidates]
    .sort((a, b) => b.reusabilityScore - a.reusabilityScore)
    .slice(0, config.count);

  if (topCandidates.length === 0) {
    console.error("No skill candidates found.");
    process.exit(0);
  }

  // Dry run — just list candidates
  if (config.dryRun) {
    console.error("\nSkill candidates (dry run):\n");
    for (const c of topCandidates) {
      const topic = knowledgeGraph.nodes.find((n) => n.id === c.topicId);
      console.error(
        `  [${c.reusabilityScore.toFixed(2)}] ${topic?.label ?? c.topicId}`
      );
      console.error(`    Keywords: ${topic?.keywords.join(", ") ?? "—"}`);
      console.error(`    Sessions: ${topic?.sessionCount ?? "?"}`);
      console.error("");
    }
    process.exit(0);
  }

  // Synthesize skills
  console.error(`\nGenerating ${topCandidates.length} skills...`);

  for (const candidate of topCandidates) {
    const topic = knowledgeGraph.nodes.find((n) => n.id === candidate.topicId);
    const label = topic?.label ?? candidate.topicId;
    console.error(`  -> ${label}`);

    let markdown = candidate.skillMarkdown;

    if (!config.skipSynthesis && topic) {
      // Find enriched sequences related to this topic's sessions
      const topicSessionSet = new Set(topic.sessionIds);
      const relatedSequences = knowledgeGraph.enrichedToolSequences.filter(
        (seq) => seq.sessionIds.some((sid) => topicSessionSet.has(sid))
      );

      const prompt = buildSynthesisPrompt({
        skillCandidate: candidate,
        topicNode: topic as unknown as SynthTopicNode,
        enrichedSequences: relatedSequences,
      });

      const result = await synthesizeWithClaude(prompt, {
        model: config.model,
      });

      if (result.success) {
        markdown = result.stdout;
        console.error(`    Synthesized`);
      } else {
        console.error(
          `    Synthesis failed: ${result.error ?? "unknown error"}, using heuristic`
        );
      }
    } else if (config.skipSynthesis) {
      console.error(`    Heuristic only`);
    }

    // Write skill file
    const skillName = extractSkillName(markdown, label);
    const outputPath = path.join(config.outputDir, `${skillName}.md`);

    fs.mkdirSync(config.outputDir, { recursive: true });
    fs.writeFileSync(outputPath, markdown, "utf-8");
    console.error(`    ${outputPath}`);
  }

  console.error(
    `\nDone! ${topCandidates.length} skills written to ${config.outputDir}`
  );
}

function extractSkillName(markdown: string, fallbackLabel: string): string {
  // Try to extract name from YAML frontmatter
  const frontmatterMatch = markdown.match(
    /^---\s*\n[\s\S]*?name:\s*(.+?)\s*\n[\s\S]*?---/
  );
  if (frontmatterMatch?.[1]) {
    return frontmatterMatch[1].replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
  }
  // Fallback: kebab-case from label
  return fallbackLabel
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 40);
}

// ─── Entry point ───────────────────────────────────────────────────

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("/cli.ts") ||
    process.argv[1].endsWith("/cli.js"));

if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
