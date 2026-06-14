/**
 * analyze-sessions.ts
 *
 * Data pipeline that reads Claude Code JSONL session logs and generates
 * JSON files for the crune web UI.
 *
 * Usage:
 *   npx tsx scripts/analyze-sessions.ts [--sessions-dir <path>] [--output-dir <path>]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  buildSemanticKnowledgeGraph,
  readFacetsDir,
  aggregateFacetsForTopic,
  buildTopicFacetsSummary,
  type SessionInput,
  type SemanticKnowledgeGraph,
  embedSessions,
  writeEmbeddingIndex,
  createTransformersBackend,
  DEFAULT_EMBED_MODEL,
  DEFAULT_EMBED_DIM,
  type Retriever,
  type EmbedResult,
} from "./knowledge-graph-builder.js";
import {
  buildSynthesisRetriever,
  retrieveContextForCandidate,
} from "./knowledge-graph/synthesis-retriever.js";
import { buildSynthesisPrompt, synthesizeWithClaude, stripSynthesisPreamble, type SynthesisOptions, type HumanFeedbackSignal, type RetrievedChunk } from "./skill-synthesizer.js";
import { computeSessionHumanSignal } from "./knowledge-graph/reusability.js";
import {
  readFeedbackFile,
  computeSessionFeedbackCounts,
  selectFlaggedTurns,
  renderTurnSnippet,
} from "./feedback-reader.js";
import { evaluateSkill, toSkillEvaluation, shouldRetrySynthesis, type EvaluatorOptions } from "./skill-evaluator.js";
import { generateSessionSummary } from "./session-summarizer.js";
import {
  discoverSessions,
  parseJsonlFile,
  buildTurns,
  extractMetadata,
  parseSubagents,
  loadLinkedPlan,
  isNonInteractiveSession,
  type ConversationTurn,
  type SubagentSession,
  type ParsedSession,
} from "./session-parser.js";

// ─── CLI argument parsing ───────────────────────────────────────────────────

export interface CliArgs {
  sessionsDir: string;
  outputDir: string;
  skipSynthesis: boolean;
  synthesisModel?: string;
  synthesisCount: number;
  facetsDir: string;
  skipFacets: boolean;
  skipEval: boolean;
  evalModel?: string;
  evalThreshold: number;
  useHumanFeedback: boolean;
  feedbackFile: string;
  embed: boolean;
  embedModel?: string;
  retrievalContext: boolean;
}

/**
 * Parse analyze-sessions CLI flags. `argv` defaults to `process.argv.slice(2)`
 * but is injectable for unit testing.
 */
export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const args = argv;
  let sessionsDir = path.join(os.homedir(), ".claude", "projects");
  let outputDir = path.resolve("public", "data", "sessions");
  let skipSynthesis = false;
  let synthesisModel: string | undefined;
  let synthesisCount = 5;
  let facetsDir = path.join(os.homedir(), ".claude", "usage-data", "facets");
  let skipFacets = false;
  let skipEval = false;
  let evalModel: string | undefined;
  let evalThreshold = 60;
  let useHumanFeedback = false;
  let feedbackFile = path.resolve("public", "data", "feedback.json");
  let embed = false;
  let embedModel: string | undefined;
  let retrievalContext = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sessions-dir" && args[i + 1]) {
      sessionsDir = path.resolve(args[++i]);
    } else if (args[i] === "--output-dir" && args[i + 1]) {
      outputDir = path.resolve(args[++i]);
    } else if (args[i] === "--skip-synthesis") {
      skipSynthesis = true;
    } else if (args[i] === "--skip-synthesize") {
      skipSynthesis = true;
    } else if (args[i] === "--synthesis-model" && args[i + 1]) {
      synthesisModel = args[++i];
    } else if (args[i] === "--synthesize-model" && args[i + 1]) {
      synthesisModel = args[++i];
    } else if (args[i] === "--synthesis-count" && args[i + 1]) {
      synthesisCount = Math.max(1, parseInt(args[++i], 10) || 5);
    } else if (args[i] === "--synthesize-count" && args[i + 1]) {
      synthesisCount = Math.max(1, parseInt(args[++i], 10) || 5);
    } else if (args[i] === "--facets-dir" && args[i + 1]) {
      facetsDir = path.resolve(args[++i]);
    } else if (args[i] === "--skip-facets") {
      skipFacets = true;
    } else if (args[i] === "--skip-eval") {
      skipEval = true;
    } else if (args[i] === "--eval-model" && args[i + 1]) {
      evalModel = args[++i];
    } else if (args[i] === "--eval-threshold" && args[i + 1]) {
      const raw = parseInt(args[++i], 10);
      evalThreshold = Number.isNaN(raw) ? 60 : Math.min(100, Math.max(0, raw));
    } else if (args[i] === "--use-human-feedback") {
      useHumanFeedback = true;
    } else if (args[i] === "--feedback-file" && args[i + 1]) {
      feedbackFile = path.resolve(args[++i]);
    } else if (args[i] === "--embed") {
      embed = true;
    } else if (args[i] === "--embed-model" && args[i + 1]) {
      embedModel = args[++i];
    } else if (args[i] === "--retrieval-context") {
      retrievalContext = true;
    }
  }
  return {
    sessionsDir,
    outputDir,
    skipSynthesis,
    synthesisModel,
    synthesisCount,
    facetsDir,
    skipFacets,
    skipEval,
    evalModel,
    evalThreshold,
    useHumanFeedback,
    feedbackFile,
    embed,
    embedModel,
    retrievalContext,
  };
}

// ─── Output types ───────────────────────────────────────────────────────────

interface SessionSummary {
  sessionId: string;
  project: string;
  cwd: string;
  gitBranch: string;
  slug: string;
  createdAt: string;
  lastActiveAt: string;
  durationMinutes: number;
  turnCount: number;
  toolBreakdown: Record<string, number>;
  firstUserPrompt: string;
  summaryText?: string;
  keywords?: string[];
  scope?: string;
  workType?: string;
  permissionMode: string;
  subagentCount: number;
}

interface ProjectSummary {
  name: string;
  sessionCount: number;
  totalDurationMinutes: number;
}

interface IndexJson {
  generatedAt: string;
  totalSessions: number;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
}

interface DetailJson {
  sessionId: string;
  meta: {
    project: string;
    cwd: string;
    branch: string;
    slug: string;
    version: string;
    createdAt: string;
    lastActiveAt: string;
    durationMinutes: number;
    permissionMode: string;
  };
  turns: ConversationTurn[];
  subagents: Record<string, SubagentSession>;
  linkedPlan: { slug: string; content: string } | null;
}

interface OverviewJson {
  generatedAt: string;
  activityHeatmap: number[][];
  projectDistribution: { name: string; sessionCount: number; totalDurationMinutes: number }[];
  weeklyToolTrends: { week: string; tools: Record<string, number> }[];
  durationDistribution: { bucket: string; count: number }[];
  topFiles: { file: string; editCount: number }[];
  modelUsage: { model: string; count: number }[];
  knowledgeGraph: SemanticKnowledgeGraph;
  tacitKnowledge: {
    workflowPatterns: { project: string; planModeUsage: number; totalSessions: number }[];
    commonToolSequences: { sequence: string[]; count: number }[];
    enrichedToolSequences: unknown[];
    skillCandidates: unknown[];
    painPoints: {
      longSessions: { sessionId: string; durationMinutes: number; medianDuration: number }[];
      hotFiles: { file: string; editCount: number; sessionId: string }[];
    };
  };
}

// ─── Task 1.5: index.json Generation ────────────────────────────────────────

function generateIndex(sessions: ParsedSession[], facetsMap?: Map<string, import("./knowledge-graph-builder.js").FacetsData>): IndexJson {
  const projectMap = new Map<string, { count: number; duration: number }>();

  const sessionSummaries: SessionSummary[] = sessions.map((s) => {
    const existing = projectMap.get(s.projectDisplayName) || {
      count: 0,
      duration: 0,
    };
    projectMap.set(s.projectDisplayName, {
      count: existing.count + 1,
      duration: existing.duration + s.meta.durationMinutes,
    });

    const summaryInfo = generateSessionSummary(
      s.turns.map((t) => ({ userPrompt: t.userPrompt, permissionMode: s.meta.permissionMode })),
      {
        toolBreakdown: s.meta.toolBreakdown,
        filesEdited: s.meta.filesEdited,
        permissionMode: s.meta.permissionMode,
        turnCount: s.meta.turnCount,
      },
    );

    return {
      sessionId: s.meta.sessionId,
      project: s.projectDisplayName,
      cwd: s.meta.cwd,
      gitBranch: s.meta.gitBranch,
      slug: s.meta.slug,
      createdAt: s.meta.createdAt,
      lastActiveAt: s.meta.lastActiveAt,
      durationMinutes: s.meta.durationMinutes,
      turnCount: s.meta.turnCount,
      toolBreakdown: s.meta.toolBreakdown,
      firstUserPrompt: facetsMap?.get(s.meta.sessionId)?.briefSummary || s.meta.firstUserPrompt,
      summaryText: summaryInfo.summary,
      keywords: summaryInfo.keywords,
      scope: summaryInfo.scope,
      workType: summaryInfo.workType,
      permissionMode: s.meta.permissionMode,
      subagentCount: s.meta.subagentCount,
    };
  });

  // Sort sessions by createdAt descending
  sessionSummaries.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const projects: ProjectSummary[] = [...projectMap.entries()].map(
    ([name, data]) => ({
      name,
      sessionCount: data.count,
      totalDurationMinutes: data.duration,
    })
  );
  projects.sort((a, b) => b.sessionCount - a.sessionCount);

  return {
    generatedAt: new Date().toISOString(),
    totalSessions: sessions.length,
    projects,
    sessions: sessionSummaries,
  };
}

// ─── Task 1.6: detail/{sessionId}.json Generation ───────────────────────────

function generateDetail(session: ParsedSession): DetailJson {
  return {
    sessionId: session.meta.sessionId,
    meta: {
      project: session.projectDisplayName,
      cwd: session.meta.cwd,
      branch: session.meta.gitBranch,
      slug: session.meta.slug,
      version: session.meta.version,
      createdAt: session.meta.createdAt,
      lastActiveAt: session.meta.lastActiveAt,
      durationMinutes: session.meta.durationMinutes,
      permissionMode: session.meta.permissionMode,
    },
    turns: session.turns,
    subagents: session.subagents,
    linkedPlan: session.linkedPlan,
  };
}

// ─── Task 1.7: overview.json Generation ─────────────────────────────────────

interface SynthesisConfig {
  skip: boolean;
  model?: string;
  count: number;
  facetsDir?: string;
  skipEval?: boolean;
  evalModel?: string;
  evalThreshold?: number;
  useHumanFeedback?: boolean;
  feedbackFile?: string;
  /**
   * Hybrid retriever for retrieval-enriched synthesis (issue #33). When present,
   * each candidate's cluster-blob examples are replaced by the top-k retrieved
   * relevant moments. Absent => existing cluster-blob behaviour (default A/B).
   */
  retriever?: Retriever;
}

/**
 * Map parsed sessions onto the `SessionInput` shape consumed by the knowledge
 * graph builder and the embedding pipeline. Extracted so both the overview
 * generation and the `--embed` step share one mapping.
 */
function toSessionInputs(sessions: ParsedSession[]): SessionInput[] {
  return sessions.map((s) => ({
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
}

async function generateOverview(sessions: ParsedSession[], synthesisConfig: SynthesisConfig = { skip: false, count: 5 }): Promise<OverviewJson> {
  // Activity heatmap: 7 days x 24 hours
  const heatmap: number[][] = Array.from({ length: 7 }, () =>
    Array(24).fill(0)
  );

  // Project distribution
  const projectMap = new Map<
    string,
    { sessionCount: number; totalDurationMinutes: number }
  >();

  // Weekly tool trends
  const weeklyTools = new Map<string, Record<string, number>>();

  // Duration distribution buckets
  const durationBuckets: Record<string, number> = {
    "0-5min": 0,
    "5-15min": 0,
    "15-30min": 0,
    "30-60min": 0,
    "60-120min": 0,
    "120min+": 0,
  };

  // File edit counts
  const fileEditCounts = new Map<string, number>();

  // Model usage
  const modelCounts = new Map<string, number>();

  // Knowledge graph (built separately via semantic pipeline)

  // Tacit knowledge
  const projectPlanMode = new Map<
    string,
    { planCount: number; totalCount: number }
  >();
  const toolSequences: string[][] = [];
  const sessionFileEdits = new Map<string, Map<string, number>>();

  for (const session of sessions) {
    const { meta } = session;

    // Heatmap
    if (meta.createdAt) {
      const date = new Date(meta.createdAt);
      const day = date.getDay(); // 0=Sun
      const hour = date.getHours();
      heatmap[day][hour]++;
    }

    // Project distribution
    const projData = projectMap.get(session.projectDisplayName) || {
      sessionCount: 0,
      totalDurationMinutes: 0,
    };
    projData.sessionCount++;
    projData.totalDurationMinutes += meta.durationMinutes;
    projectMap.set(session.projectDisplayName, projData);

    // Weekly tool trends
    if (meta.createdAt) {
      const weekLabel = getWeekLabel(new Date(meta.createdAt));
      const weekTools = weeklyTools.get(weekLabel) || {};
      for (const [tool, count] of Object.entries(meta.toolBreakdown)) {
        weekTools[tool] = (weekTools[tool] || 0) + count;
      }
      weeklyTools.set(weekLabel, weekTools);
    }

    // Duration distribution
    const dur = meta.durationMinutes;
    if (dur < 5) durationBuckets["0-5min"]++;
    else if (dur < 15) durationBuckets["5-15min"]++;
    else if (dur < 30) durationBuckets["15-30min"]++;
    else if (dur < 60) durationBuckets["30-60min"]++;
    else if (dur < 120) durationBuckets["60-120min"]++;
    else durationBuckets["120min+"]++;

    // File edit counts
    for (const file of meta.filesEdited) {
      fileEditCounts.set(file, (fileEditCounts.get(file) || 0) + 1);
    }

    // Track per-session file edit counts for pain points
    const sessionFileEditMap = new Map<string, number>();
    for (const turn of session.turns) {
      for (const tc of turn.toolCalls) {
        if (tc.toolName === "Edit" && typeof tc.input.file_path === "string") {
          const fp = tc.input.file_path as string;
          sessionFileEditMap.set(fp, (sessionFileEditMap.get(fp) || 0) + 1);
        }
      }
    }
    sessionFileEdits.set(meta.sessionId, sessionFileEditMap);

    // Model usage
    for (const [model, count] of Object.entries(meta.modelsUsed)) {
      modelCounts.set(model, (modelCounts.get(model) || 0) + count);
    }

    // Tacit knowledge: plan mode usage
    const projPlan = projectPlanMode.get(session.projectDisplayName) || {
      planCount: 0,
      totalCount: 0,
    };
    projPlan.totalCount++;
    if (meta.permissionMode === "plan") projPlan.planCount++;
    projectPlanMode.set(session.projectDisplayName, projPlan);

    // Tool sequences (3-grams)
    const toolNames = session.turns.flatMap((t) =>
      t.toolCalls.map((tc) => tc.toolName)
    );
    for (let i = 0; i <= toolNames.length - 3; i++) {
      toolSequences.push(toolNames.slice(i, i + 3));
    }
  }

  // Build semantic knowledge graph
  const sessionInputs: SessionInput[] = toSessionInputs(sessions);
  // Human feedback (issue #24): gated behind --use-human-feedback (default OFF).
  // localStorage is synced to public/data/feedback.json by the skill-server.
  const humanFeedbackMap = synthesisConfig.useHumanFeedback
    ? readFeedbackFile(synthesisConfig.feedbackFile ?? path.resolve("public", "data", "feedback.json"))
    : new Map();
  const humanSignalMap = new Map<string, number>();
  if (synthesisConfig.useHumanFeedback) {
    for (const [sessionId, counts] of computeSessionFeedbackCounts(humanFeedbackMap)) {
      humanSignalMap.set(sessionId, computeSessionHumanSignal(counts));
    }
    console.error(`[crune] Human feedback: ${humanFeedbackMap.size} sessions with bookmarks/tags/notes`);
  }
  const sessionInputMap = new Map(sessionInputs.map((s) => [s.sessionId, s]));

  const knowledgeGraph = buildSemanticKnowledgeGraph(sessionInputs, {
    facetsDir: synthesisConfig.facetsDir,
    humanSignalMap: synthesisConfig.useHumanFeedback ? humanSignalMap : undefined,
  });

  // Read facets once and reuse for both topic-level filtering metadata (#73)
  // and the synthesis loop below.
  const facetsMap = synthesisConfig.facetsDir
    ? readFacetsDir(synthesisConfig.facetsDir)
    : undefined;

  // Attach a compact facets summary to each topic so the UI can filter by goal
  // category without recomputing the aggregation (issue #73).
  if (facetsMap && facetsMap.size > 0) {
    for (const node of knowledgeGraph.nodes) {
      const summary = buildTopicFacetsSummary(
        aggregateFacetsForTopic(node.sessionIds, facetsMap)
      );
      if (summary) node.facetsSummary = summary;
    }
  }

  // Top files
  const topFiles = [...fileEditCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([file, editCount]) => ({ file, editCount }));

  // Model usage
  const modelUsage = [...modelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([model, count]) => ({ model, count }));

  // Weekly tool trends sorted by week
  const weeklyToolTrends = [...weeklyTools.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, tools]) => ({ week, tools }));

  // Duration distribution
  const durationDistribution = Object.entries(durationBuckets).map(
    ([bucket, count]) => ({ bucket, count })
  );

  // Project distribution
  const projectDistribution = [...projectMap.entries()]
    .sort((a, b) => b[1].sessionCount - a[1].sessionCount)
    .map(([name, data]) => ({
      name,
      sessionCount: data.sessionCount,
      totalDurationMinutes: data.totalDurationMinutes,
    }));

  // Tacit knowledge
  const workflowPatterns = [...projectPlanMode.entries()].map(
    ([project, data]) => ({
      project,
      planModeUsage: data.planCount,
      totalSessions: data.totalCount,
    })
  );

  // Common tool 3-gram sequences
  const seqCounts = new Map<string, number>();
  for (const seq of toolSequences) {
    const key = seq.join(" -> ");
    seqCounts.set(key, (seqCounts.get(key) || 0) + 1);
  }
  const commonToolSequences = [...seqCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([key, count]) => ({
      sequence: key.split(" -> "),
      count,
    }));

  // Pain points
  const durations = sessions.map((s) => s.meta.durationMinutes);
  const sortedDurations = [...durations].sort((a, b) => a - b);
  const medianDuration =
    sortedDurations.length > 0
      ? sortedDurations[Math.floor(sortedDurations.length / 2)]
      : 0;

  const longSessions = sessions
    .filter((s) => s.meta.durationMinutes > medianDuration * 2 && medianDuration > 0)
    .map((s) => ({
      sessionId: s.meta.sessionId,
      durationMinutes: s.meta.durationMinutes,
      medianDuration,
    }));

  const hotFiles: { file: string; editCount: number; sessionId: string }[] = [];
  for (const [sessionId, fileMap] of sessionFileEdits) {
    for (const [file, count] of fileMap) {
      if (count >= 5) {
        hotFiles.push({ file, editCount: count, sessionId });
      }
    }
  }
  hotFiles.sort((a, b) => b.editCount - a.editCount);

  // Pre-synthesize top skill candidates with claude -p
  if (!synthesisConfig.skip) {
    const topCandidates = [...knowledgeGraph.skillCandidates]
      .sort((a, b) => b.reusabilityScore - a.reusabilityScore)
      .slice(0, synthesisConfig.count);

    const synthOpts: SynthesisOptions = {};
    if (synthesisConfig.model) {
      synthOpts.model = synthesisConfig.model;
    }

    const total = topCandidates.length;
    if (total > 0) {
      console.error(`[crune] Synthesizing top ${total} skill candidates${synthesisConfig.model ? ` (model: ${synthesisConfig.model})` : ""}...`);
    }
    // Reuse the facets read above (loop-invariant) for synthesis enrichment.
    const facetsForSynthesis = facetsMap;
    for (let i = 0; i < topCandidates.length; i++) {
      const candidate = topCandidates[i];
      const topic = knowledgeGraph.nodes.find((n) => n.id === candidate.topicId);
      if (!topic) continue;

      const topicSessionSet = new Set(topic.sessionIds);
      const relatedSequences = knowledgeGraph.enrichedToolSequences.filter((seq) =>
        seq.sessionIds.some((sid) => topicSessionSet.has(sid))
      );

      console.error(`[crune]   [${i + 1}/${total}] ${topic.label}...`);

      // Build facets insights for this topic if facets data is available
      const facetsInsights = facetsForSynthesis
        ? aggregateFacetsForTopic(topic.sessionIds, facetsForSynthesis)
        : undefined;

      // Human-flagged moments for this topic (issue #24), only when enabled.
      let humanFeedback: HumanFeedbackSignal[] | undefined;
      if (synthesisConfig.useHumanFeedback && humanFeedbackMap.size > 0) {
        const flagged = selectFlaggedTurns(humanFeedbackMap, topic.sessionIds);
        if (flagged.length > 0) {
          humanFeedback = flagged.map((f) => ({
            sessionId: f.sessionId,
            turnId: f.turnId,
            snippet: renderTurnSnippet(sessionInputMap, f.sessionId, f.turnId),
            note: f.note,
            reusable: f.reusable,
            antiPattern: f.antiPattern,
          }));
        }
      }

      // Retrieval-enriched context (issue #33). When a retriever is available,
      // pull the top-k most relevant turn snippets for this candidate; on any
      // failure `retrieveContextForCandidate` returns undefined so
      // buildSynthesisPrompt falls back to the cluster-blob examples (never crash).
      let retrievedContext: RetrievedChunk[] | undefined;
      if (synthesisConfig.retriever) {
        retrievedContext = await retrieveContextForCandidate(synthesisConfig.retriever, candidate, {
          label: topic.label,
          keywords: topic.keywords,
        });
        console.error(
          retrievedContext
            ? `[crune]   [${i + 1}/${total}] Retrieved ${retrievedContext.length} relevant moments`
            : `[crune]   [${i + 1}/${total}] No relevant moments retrieved, using cluster blob`
        );
      }

      const prompt = buildSynthesisPrompt({
        skillCandidate: candidate,
        topicNode: topic as unknown as import("./skill-synthesizer.js").TopicNode,
        enrichedSequences: relatedSequences,
        facetsInsights: facetsInsights as unknown as import("./skill-synthesizer.js").FacetsInsightsSummary | undefined,
        humanFeedback,
        retrievedContext,
      });
      const result = await synthesizeWithClaude(prompt, synthOpts);
      if (result.success) {
        const original = knowledgeGraph.skillCandidates.find((sc) => sc.topicId === candidate.topicId);
        if (original) {
          original.synthesizedMarkdown = stripSynthesisPreamble(result.stdout);

          // Evaluate the synthesized SKILL.md. Gated behind synthesis success
          // so heuristic markdown (skillMarkdown) is never scored. Structural
          // validation ALWAYS runs locally; --skip-eval only turns off the LLM
          // rubric (structural-only mode).
          //
          // Evaluation is best-effort and MUST NOT destroy the primary synthesis
          // output: any throw here is caught, logged, and leaves
          // `synthesizedMarkdown` intact (restored if a retry replaced it) with
          // `evaluation` unset, so overview.json still captures the synthesis.
          const primaryMarkdown = original.synthesizedMarkdown;
          try {
            const evalOpts: EvaluatorOptions = {
              skipRubric: synthesisConfig.skipEval,
            };
            if (synthesisConfig.evalModel) {
              evalOpts.model = synthesisConfig.evalModel;
            }
            let evalResult = await evaluateSkill(original.synthesizedMarkdown, evalOpts);

            // Soft threshold: a SINGLE bounded re-synthesis retry when the
            // overall score is below threshold. The candidate is never dropped
            // — we keep the retry only when it strictly beats the original
            // (a tie keeps the original, for determinism) and let the UI flag
            // low scores. The retry only makes sense when the rubric is available;
            // with --skip-eval the structural-only score can't improve, so skip it.
            const threshold = synthesisConfig.evalThreshold ?? 60;
            if (!synthesisConfig.skipEval && shouldRetrySynthesis(evalResult.overallScore, threshold)) {
              console.error(
                `[crune]   [${i + 1}/${total}] Score ${evalResult.overallScore ?? 0} < ${threshold}, re-synthesizing once...`
              );
              const retry = await synthesizeWithClaude(prompt, synthOpts);
              if (retry.success) {
                const retryMarkdown = stripSynthesisPreamble(retry.stdout);
                const retryEval = await evaluateSkill(retryMarkdown, evalOpts);
                if ((retryEval.overallScore ?? 0) > (evalResult.overallScore ?? 0)) {
                  original.synthesizedMarkdown = retryMarkdown;
                  evalResult = retryEval;
                }
              }
            }

            original.evaluation = toSkillEvaluation(evalResult);
          } catch (err) {
            // Restore the primary synthesis output (a retry may have replaced it
            // before the throw) and leave evaluation unset. Synthesis output is
            // primary; evaluation must never destroy it.
            original.synthesizedMarkdown = primaryMarkdown;
            original.evaluation = undefined;
            console.error(
              `[crune]   [${i + 1}/${total}] Evaluation failed (keeping synthesized markdown): ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
        console.error(`[crune]   [${i + 1}/${total}] Done.`);
      } else {
        console.error(`[crune]   [${i + 1}/${total}] Failed: ${result.error}`);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    activityHeatmap: heatmap,
    projectDistribution,
    weeklyToolTrends,
    durationDistribution,
    topFiles,
    modelUsage,
    knowledgeGraph,
    tacitKnowledge: {
      workflowPatterns,
      commonToolSequences,
      enrichedToolSequences: knowledgeGraph.enrichedToolSequences ?? [],
      skillCandidates: knowledgeGraph.skillCandidates ?? [],
      painPoints: {
        longSessions,
        hotFiles: hotFiles.slice(0, 20),
      },
    },
  };
}

function getWeekLabel(date: Date): string {
  // ISO week label: "2026-W10"
  const jan4 = new Date(date.getFullYear(), 0, 4);
  const dayDiff = (date.getTime() - jan4.getTime()) / 86400000;
  const weekNum = Math.ceil((dayDiff + jan4.getDay() + 1) / 7);
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

// buildKnowledgeGraphEdges removed — replaced by buildSemanticKnowledgeGraph

// ─── Main Pipeline ──────────────────────────────────────────────────────────

async function main() {
  const { sessionsDir, outputDir, skipSynthesis, synthesisModel, synthesisCount, facetsDir, skipFacets, skipEval, evalModel, evalThreshold, useHumanFeedback, feedbackFile, embed, embedModel, retrievalContext } = parseArgs();

  console.error(`[crune] Sessions dir: ${sessionsDir}`);
  console.error(`[crune] Output dir:   ${outputDir}`);
  console.error(`[crune] Facets dir:   ${skipFacets ? "(skipped)" : facetsDir}`);

  // Step 0: Refresh /insights data if facets are enabled
  if (!skipFacets) {
    console.error(`\n[crune] Refreshing /insights data...`);
    const refreshResult = await synthesizeWithClaude("/insights", { timeoutMs: 300_000 });
    if (refreshResult.success) {
      console.error(`[crune] /insights data refreshed.`);
    } else {
      console.error(`[crune] /insights refresh failed (continuing without): ${refreshResult.error ?? "unknown"}`);
    }
  }

  // Step 1: Discover sessions
  console.error(`\n[crune] Discovering sessions...`);
  const sessionFiles = discoverSessions(sessionsDir);
  console.error(`[crune] Found ${sessionFiles.length} sessions`);

  if (sessionFiles.length === 0) {
    console.error("[crune] No sessions found. Exiting.");
    process.exit(1);
  }

  // Step 1.5: Filter out non-interactive sessions (claude -p synthesis, /insights)
  const interactiveSessions = sessionFiles.filter((sf) => !isNonInteractiveSession(sf.filePath));
  const skippedCount = sessionFiles.length - interactiveSessions.length;
  if (skippedCount > 0) {
    console.error(`[crune] Skipped ${skippedCount} non-interactive sessions (claude -p)`);
  }

  // Step 2: Parse each session with metadata and subagents
  const parsedSessions: ParsedSession[] = [];

  for (let i = 0; i < interactiveSessions.length; i++) {
    const sf = interactiveSessions[i];
    console.error(
      `[crune] Processing session ${i + 1}/${interactiveSessions.length}: ${sf.sessionId}`
    );

    try {
      // Parse main JSONL
      const lines = await parseJsonlFile(sf.filePath);
      const turns = buildTurns(lines);
      const meta = extractMetadata(sf, lines, turns);

      // Update projectDisplayName from cwd if available
      let displayName = sf.projectDisplayName;
      if (meta.cwd) {
        const cwdParts = meta.cwd.split(path.sep).filter(Boolean);
        if (cwdParts.length >= 2) {
          displayName = cwdParts.slice(-2).join("/");
        }
      }

      // Parse subagents
      const subagents = await parseSubagents(sf.subagentFiles);

      // Load linked plan
      const linkedPlan = loadLinkedPlan(meta.slug);

      parsedSessions.push({
        meta,
        turns,
        subagents,
        linkedPlan,
        projectDir: sf.projectDir,
        projectDisplayName: displayName,
      });
    } catch (err) {
      console.error(
        `  [ERROR] Failed to process ${sf.sessionId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  console.error(
    `\n[crune] Successfully parsed ${parsedSessions.length}/${sessionFiles.length} sessions`
  );

  // Step 3: Generate output files
  console.error(`\n[crune] Generating output files...`);

  // Ensure output directories exist
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, "detail"), { recursive: true });

  // index.json
  const indexFacetsMap = skipFacets ? undefined : readFacetsDir(facetsDir);
  const indexData = generateIndex(parsedSessions, indexFacetsMap);
  const indexPath = path.join(outputDir, "index.json");
  fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
  const indexSize = fs.statSync(indexPath).size;
  console.error(
    `[crune] Wrote ${indexPath} (${(indexSize / 1024).toFixed(1)} KB)`
  );

  // detail/{sessionId}.json
  let totalDetailSize = 0;
  for (const session of parsedSessions) {
    const detail = generateDetail(session);
    const detailPath = path.join(
      outputDir,
      "detail",
      `${session.meta.sessionId}.json`
    );
    fs.writeFileSync(detailPath, JSON.stringify(detail, null, 2));
    totalDetailSize += fs.statSync(detailPath).size;
  }
  console.error(
    `[crune] Wrote ${parsedSessions.length} detail files (${(totalDetailSize / 1024).toFixed(1)} KB total)`
  );

  // Optional: chunk-level embedding index for RAG retrieval (issue #32).
  // Opt-in (default OFF). Promotion to default is gated on the PoC (#35).
  // Runs BEFORE overview generation so retrieval-enriched synthesis (#33) can
  // reuse the freshly-computed EmbedResult instead of embedding twice.
  const embeddingsDir = path.join(outputDir, "..", "embeddings");
  const embedModelId = embedModel ?? DEFAULT_EMBED_MODEL;
  let embedResult: EmbedResult | undefined;
  if (embed) {
    console.error(`\n[crune] Embedding chunks with ${embedModelId}...`);
    try {
      const backend = createTransformersBackend(embedModelId, DEFAULT_EMBED_DIM);
      const embedInputs = toSessionInputs(parsedSessions);
      embedResult = await embedSessions(embedInputs, backend, { model: embedModelId });
      writeEmbeddingIndex(embeddingsDir, embedResult);
      const binSize = embedResult.matrix.byteLength;
      console.error(
        `[crune] Wrote embeddings index: ${embedResult.count} chunks × ${embedResult.dim} dim (${(binSize / 1024).toFixed(1)} KB) → ${embeddingsDir}`
      );
    } catch (err) {
      console.error(
        `[crune] Embedding step failed (continuing without index): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Retrieval-enriched synthesis context (issue #33, opt-in, default OFF).
  // Build a hybrid retriever over the analyzed sessions. Falls back to the
  // cluster-blob examples (retriever stays undefined) on any failure.
  let synthesisRetriever: Retriever | undefined;
  if (retrievalContext && !skipSynthesis) {
    console.error(`\n[crune] Building retrieval context (issue #33)...`);
    const built = await buildSynthesisRetriever(
      toSessionInputs(parsedSessions),
      embeddingsDir,
      embedModelId,
      embedResult
    );
    if (built) {
      synthesisRetriever = built.retriever;
      console.error(`[crune] Retrieval strategy: ${built.strategy} (${built.retriever.size} chunks)`);
    }
  }

  // overview.json
  const overviewData = await generateOverview(parsedSessions, {
    skip: skipSynthesis,
    model: synthesisModel,
    count: synthesisCount,
    facetsDir: skipFacets ? undefined : facetsDir,
    skipEval,
    evalModel,
    evalThreshold,
    useHumanFeedback,
    feedbackFile,
    retriever: synthesisRetriever,
  });
  const overviewPath = path.join(outputDir, "overview.json");
  fs.writeFileSync(overviewPath, JSON.stringify(overviewData, null, 2));
  const overviewSize = fs.statSync(overviewPath).size;
  console.error(
    `[crune] Wrote ${overviewPath} (${(overviewSize / 1024).toFixed(1)} KB)`
  );

  // Summary
  console.error(`\n[crune] --- Summary ---`);
  console.error(`[crune] Total sessions:  ${parsedSessions.length}`);
  console.error(`[crune] Total projects:  ${indexData.projects.length}`);
  console.error(
    `[crune] Output size:     ${((indexSize + totalDetailSize + overviewSize) / 1024).toFixed(1)} KB`
  );
  console.error(`[crune] Done.`);
}

// Entry point — skip under Vitest so the module can be imported for unit tests
// (e.g. parseArgs) without triggering the full pipeline.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error(`[crune] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
