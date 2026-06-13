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
  type TopicNode,
} from "./knowledge-graph-builder.js";
import type { SkillCandidate } from "./knowledge-graph/types.js";
import {
  buildSynthesisPrompt,
  synthesizeWithClaude,
  stripSynthesisPreamble,
  type TopicNode as SynthTopicNode,
} from "./skill-synthesizer.js";
import { evaluateSkill } from "./skill-evaluator.js";

// ─── CLI argument parsing ─────────────────────────────────────────

interface CliArgs {
  sessionsDir: string;
  outputDir: string;
  count: number;
  model?: string;
  skipSynthesis: boolean;
  dryRun: boolean;
  preview: boolean;
  json: boolean;
  skipEval: boolean;
  evalModel?: string;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let sessionsDir = path.join(os.homedir(), ".claude", "projects");
  let outputDir = path.resolve("skills");
  let count = 5;
  let model: string | undefined;
  let skipSynthesis = false;
  let dryRun = false;
  let preview = false;
  let json = false;
  let skipEval = false;
  let evalModel: string | undefined;

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
    } else if (args[i] === "--preview") {
      preview = true;
    } else if (args[i] === "--json") {
      json = true;
    } else if (args[i] === "--skip-eval") {
      skipEval = true;
    } else if (args[i] === "--eval-model" && args[i + 1]) {
      evalModel = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return { sessionsDir, outputDir, count, model, skipSynthesis, dryRun, preview, json, skipEval, evalModel };
}

function printUsage(): void {
  console.log(`Usage: crune [options]

Generate reusable skill definitions from Claude Code session logs.

Options:
  --sessions-dir <path>  Session logs directory (default: ~/.claude/projects)
  --output-dir <path>    Output directory for skill files (default: ./skills)
  --count <n>            Number of skills to generate (default: 5)
  --model <model>        Claude model for synthesis (e.g., haiku, sonnet)
  --skip-synthesis       Skip LLM synthesis, output heuristic skills only
  --dry-run              Show candidates without writing files (skips synthesis)
  --preview              Synthesize and print SKILL.md to stdout without writing
  --json                 With --dry-run/--preview, emit candidates as JSON to
                         stdout (see README "JSON output schema")
  --skip-eval            Skip skill evaluation pipeline (structural + rubric)
  --eval-model <model>   Claude model for rubric scoring (defaults to --model)
  -h, --help             Show this help message`);
}

// ─── Candidate serialization / rendering (pure) ────────────────────

/** JSON output schema version for --json. Bump on breaking shape changes. */
export const SCHEMA_VERSION = 1;

type ReusabilityBreakdown = NonNullable<
  TopicNode["reusabilityScore"]["breakdown"]
>;

interface SerializedCandidate {
  topicId: string;
  label: string;
  keywords: string[];
  sessionCount: number;
  reusabilityScore: number;
  reusabilityScoreBreakdown?: ReusabilityBreakdown;
  synthesizedMarkdown?: string;
}

/**
 * Serialize a skill candidate into a plain object — the single source of truth
 * shared by the text renderer and the --json output. synthesizedMarkdown is
 * included only when present on the candidate.
 */
export function serializeCandidate(
  candidate: SkillCandidate,
  topic: TopicNode | undefined
): SerializedCandidate {
  const obj: SerializedCandidate = {
    topicId: candidate.topicId,
    label: topic?.label ?? candidate.topicId,
    keywords: topic?.keywords ?? [],
    sessionCount: topic?.sessionCount ?? 0,
    reusabilityScore: candidate.reusabilityScore,
  };
  const breakdown = topic?.reusabilityScore?.breakdown;
  if (breakdown) {
    obj.reusabilityScoreBreakdown = breakdown;
  }
  if (candidate.synthesizedMarkdown) {
    obj.synthesizedMarkdown = candidate.synthesizedMarkdown;
  }
  return obj;
}

/**
 * Render a human-readable detail view for a skill candidate as an array of
 * lines (no I/O side effects). Used by the dry-run/preview output. The
 * reusability breakdown is included only when the topic carries one.
 */
export function renderCandidateDetail(
  candidate: SkillCandidate,
  topic: TopicNode | undefined
): string[] {
  const data = serializeCandidate(candidate, topic);
  const lines: string[] = [];
  lines.push(`  [${data.reusabilityScore}] ${data.label}`);
  lines.push(
    `    Keywords: ${data.keywords.length > 0 ? data.keywords.join(", ") : "—"}`
  );
  lines.push(`    Sessions: ${topic ? data.sessionCount : "?"}`);

  const breakdown = topic?.reusabilityScore?.breakdown;
  if (breakdown && breakdown.length > 0) {
    const profile = topic?.reusabilityScore?.weightProfile ?? "base";
    lines.push(`    Breakdown (${profile}):`);
    for (const b of breakdown) {
      lines.push(`      ${b.signal}: ${b.value} x ${b.weight} = ${b.contribution}`);
    }
  }

  return lines;
}

// ─── Main pipeline ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseCliArgs(process.argv);

  // --json only produces output in dry-run/preview mode. In a normal run files
  // are written and JSON would be silently ignored — fail fast at the boundary.
  if (config.json && !config.dryRun && !config.preview) {
    console.error("--json requires --dry-run or --preview");
    process.exit(1);
  }

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

  // Dry run — list candidates (text) or emit JSON. All logs stay on stderr so
  // JSON on stdout is machine-parseable.
  if (config.dryRun) {
    if (config.json) {
      const obj = {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        candidates: topCandidates.map((c) =>
          serializeCandidate(
            c,
            knowledgeGraph.nodes.find((n) => n.id === c.topicId)
          )
        ),
      };
      process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
      process.exit(0);
    }
    console.error("\nSkill candidates (dry run):\n");
    for (const c of topCandidates) {
      const topic = knowledgeGraph.nodes.find((n) => n.id === c.topicId);
      for (const line of renderCandidateDetail(c, topic)) {
        console.error(line);
      }
      console.error("");
    }
    process.exit(0);
  }

  // Synthesize skills. In preview mode we emit markdown to stdout instead of
  // writing files, but evaluation still runs by default.
  const writeToDisk = !config.preview;
  // In preview + --json we collect serialized candidates and emit JSON once at
  // the end (synthesizedMarkdown included since synthesis ran).
  const previewJson = config.preview && config.json;
  const previewedCandidates: SkillCandidate[] = [];
  console.error(`\nGenerating ${topCandidates.length} skills...`);

  for (const candidate of topCandidates) {
    const topic = knowledgeGraph.nodes.find((n) => n.id === candidate.topicId);
    const label = topic?.label ?? candidate.topicId;
    console.error(`  -> ${label}`);

    let markdown = candidate.skillMarkdown;
    let synthesisHappened = false;

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
        markdown = stripSynthesisPreamble(result.stdout);
        candidate.synthesizedMarkdown = markdown;
        synthesisHappened = true;
        console.error(`    Synthesized`);
      } else {
        console.error(
          `    Synthesis failed: ${result.error ?? "unknown error"}, using heuristic`
        );
      }
    } else if (config.skipSynthesis) {
      console.error(`    Heuristic only`);
    }

    // Evaluate skill (structural always; rubric only if synthesis ran).
    if (!config.skipEval) {
      const evalOptions = {
        model: config.evalModel ?? config.model,
        // Skip the LLM rubric when synthesis was skipped/failed — heuristic
        // markdown is not the target of the rubric.
        skipRubric: !synthesisHappened,
      };
      const evalResult = await evaluateSkill(markdown, evalOptions);
      if (!evalResult.structural.valid) {
        console.error(
          `    Eval: structural FAIL (${evalResult.structural.issues.length} issue(s))`
        );
        for (const issue of evalResult.structural.issues.slice(0, 5)) {
          console.error(`      - [${issue.field}] ${issue.message}`);
        }
        console.error(
          "    Hint: review SKILL.md frontmatter (name/description); file written anyway"
        );
      } else if (evalResult.rubric?.ok && typeof evalResult.rubric.score === "number") {
        const score = evalResult.rubric.score;
        const overall = evalResult.overallScore ?? score;
        console.error(
          `    Eval: structural OK | rubric ${score}/100 | overall ${overall}/100`
        );
        if (score < 60) {
          console.error("    Hint: low rubric score — consider re-synthesizing");
          for (const h of (evalResult.rubric.hints ?? []).slice(0, 3)) {
            console.error(`      - ${h}`);
          }
        }
      } else if (evalResult.rubric?.skipped) {
        console.error(`    Eval: structural OK | rubric skipped`);
      } else if (evalResult.rubric && !evalResult.rubric.ok) {
        console.error(
          `    Eval: structural OK | rubric error: ${evalResult.rubric.error ?? "unknown"}`
        );
      } else {
        console.error(`    Eval: structural OK`);
      }
    }

    // Write skill file as <output-dir>/<skill-name>/SKILL.md, or print to
    // stdout in preview mode.
    const skillName = extractSkillName(markdown, label);
    if (writeToDisk) {
      const skillDir = path.join(config.outputDir, skillName);
      const outputPath = path.join(skillDir, "SKILL.md");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(outputPath, markdown, "utf-8");
      console.error(`    ${outputPath}`);
    } else if (previewJson) {
      // Defer output — collected and emitted as JSON once below.
      previewedCandidates.push(candidate);
    } else {
      console.error(`--- ${skillName} ---`);
      console.log(markdown);
    }
  }

  if (previewJson) {
    const obj = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      candidates: previewedCandidates.map((c) =>
        serializeCandidate(
          c,
          knowledgeGraph.nodes.find((n) => n.id === c.topicId)
        )
      ),
    };
    process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
    console.error(`\nDone! ${topCandidates.length} skills previewed (JSON)`);
  } else if (writeToDisk) {
    console.error(
      `\nDone! ${topCandidates.length} skills written to ${config.outputDir}`
    );
  } else {
    console.error(`\nDone! ${topCandidates.length} skills previewed (no files written)`);
  }
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

if (!process.env.VITEST) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
