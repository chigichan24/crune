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
import * as readline from "node:readline";
import * as os from "node:os";
import {
  buildSemanticKnowledgeGraph,
  type SessionInput,
  type SemanticKnowledgeGraph,
} from "./knowledge-graph-builder.js";
import { buildDistillationPrompt, distillWithClaude, type DistillOptions } from "./skill-distiller.js";
import { generateSessionSummary } from "./session-summarizer.js";

// ─── CLI argument parsing ───────────────────────────────────────────────────

interface CliArgs {
  sessionsDir: string;
  outputDir: string;
  skipDistill: boolean;
  distillModel?: string;
  distillCount: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let sessionsDir = path.join(os.homedir(), ".claude", "projects");
  let outputDir = path.resolve("public", "data", "sessions");
  let skipDistill = false;
  let distillModel: string | undefined;
  let distillCount = 5;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sessions-dir" && args[i + 1]) {
      sessionsDir = path.resolve(args[++i]);
    } else if (args[i] === "--output-dir" && args[i + 1]) {
      outputDir = path.resolve(args[++i]);
    } else if (args[i] === "--skip-distill") {
      skipDistill = true;
    } else if (args[i] === "--distill-model" && args[i + 1]) {
      distillModel = args[++i];
    } else if (args[i] === "--distill-count" && args[i + 1]) {
      distillCount = Math.max(1, parseInt(args[++i], 10) || 5);
    }
  }
  return { sessionsDir, outputDir, skipDistill, distillModel, distillCount };
}

// ─── Types ──────────────────────────────────────────────────────────────────

/** Discovered session file on disk */
interface SessionFile {
  filePath: string;
  sessionId: string;
  projectDir: string;
  projectDisplayName: string;
  subagentFiles: string[];
}

/** A single JSONL line parsed to an object */
interface JsonlLine {
  type: string;
  subtype?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  sessionId?: string;
  version?: string;
  gitBranch?: string;
  slug?: string;
  isMeta?: boolean;
  uuid?: string;
  timestamp?: string;
  permissionMode?: string;
  agentId?: string;
  message?: {
    role?: string;
    model?: string;
    content?: string | ContentBlock[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  durationMs?: number;
  // file-history-snapshot
  snapshot?: {
    trackedFileBackups?: Record<string, unknown>;
    timestamp?: string;
  };
  [key: string]: unknown;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
}

/** A tool call within a conversation turn */
interface ToolCall {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  result?: string;
}

/** A single conversation turn (user prompt + all assistant responses until next user prompt) */
interface ConversationTurn {
  turnIndex: number;
  userPrompt: string;
  timestamp: string;
  assistantThinking: string[];
  assistantTexts: string[];
  toolCalls: ToolCall[];
  model?: string;
}

/** Metadata extracted from a session */
interface SessionMeta {
  sessionId: string;
  cwd: string;
  gitBranch: string;
  version: string;
  slug: string;
  createdAt: string;
  lastActiveAt: string;
  durationMinutes: number;
  permissionMode: string;
  toolBreakdown: Record<string, number>;
  modelsUsed: Record<string, number>;
  filesEdited: string[];
  subagentCount: number;
  turnCount: number;
  firstUserPrompt: string;
}

/** A parsed subagent session */
interface SubagentSession {
  agentId: string;
  agentType: string;
  turns: ConversationTurn[];
  model?: string;
}

/** Full parsed session */
interface ParsedSession {
  meta: SessionMeta;
  turns: ConversationTurn[];
  subagents: Record<string, SubagentSession>;
  linkedPlan: { slug: string; content: string } | null;
  projectDir: string;
  projectDisplayName: string;
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
    painPoints: {
      longSessions: { sessionId: string; durationMinutes: number; medianDuration: number }[];
      hotFiles: { file: string; editCount: number; sessionId: string }[];
    };
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const THINKING_LIMIT = 5000;
const TOOL_RESULT_LIMIT = 2000;
const WRITE_CONTENT_PREVIEW = 500;
const FIRST_PROMPT_LIMIT = 200;

// ─── Task 1.1: Session Discovery ────────────────────────────────────────────

function discoverSessions(sessionsDir: string): SessionFile[] {
  const sessions: SessionFile[] = [];

  if (!fs.existsSync(sessionsDir)) {
    console.error(`Sessions directory not found: ${sessionsDir}`);
    return sessions;
  }

  const projectDirs = fs.readdirSync(sessionsDir, { withFileTypes: true });

  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    const projectPath = path.join(sessionsDir, entry.name);

    // Find .jsonl files directly in the project directory (not in subdirs)
    const files = fs.readdirSync(projectPath, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const sessionId = file.name.replace(".jsonl", "");
      const filePath = path.join(projectPath, file.name);

      // Look for subagent files
      const subagentDir = path.join(projectPath, sessionId, "subagents");
      const subagentFiles: string[] = [];
      if (fs.existsSync(subagentDir)) {
        const subFiles = fs.readdirSync(subagentDir, { withFileTypes: true });
        for (const sf of subFiles) {
          if (sf.isFile() && sf.name.endsWith(".jsonl")) {
            subagentFiles.push(path.join(subagentDir, sf.name));
          }
        }
      }

      sessions.push({
        filePath,
        sessionId,
        projectDir: entry.name,
        projectDisplayName: inferProjectName(entry.name),
        subagentFiles,
      });
    }
  }

  return sessions;
}

function inferProjectName(dirName: string): string {
  // Directory names look like: -Users-kazuki-chigita-src-github-com-chigichan24-crune
  // We want: chigichan24/crune (the last two meaningful segments)
  const parts = dirName.split("-").filter(Boolean);
  if (parts.length >= 2) {
    // Try to find github-com pattern
    const githubIdx = parts.indexOf("github");
    if (githubIdx !== -1 && parts[githubIdx + 1] === "com" && parts.length > githubIdx + 3) {
      return parts.slice(githubIdx + 2).join("/");
    }
    // Fallback: last two segments
    return parts.slice(-2).join("/");
  }
  return dirName;
}

// ─── Task 1.2: JSONL Parser + Turn Builder ──────────────────────────────────

async function parseJsonlFile(filePath: string): Promise<JsonlLine[]> {
  const lines: JsonlLine[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as JsonlLine;
      // Skip progress and queue-operation lines
      if (parsed.type === "progress" || parsed.type === "queue-operation") continue;
      lines.push(parsed);
    } catch {
      // Malformed JSON — skip and warn
      console.error(`  [WARN] Malformed JSON line in ${path.basename(filePath)}`);
    }
  }

  return lines;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "\u2026";
}

function isRealUserMessage(line: JsonlLine): boolean {
  if (line.type !== "user") return false;
  if (line.isMeta) return false;

  const content = line.message?.content;
  if (typeof content === "string") {
    if (content.includes("<command-name>")) return false;
    if (content.includes("<local-command-caveat>")) return false;
    if (content.includes("<local-command-stdout>")) return false;
    if (content.trim().length === 0) return false;
    return true;
  }

  // Array content — check if it's a tool_result (which is NOT a new user turn)
  if (Array.isArray(content)) {
    const hasToolResult = content.some(
      (block: ContentBlock) => block.type === "tool_result"
    );
    if (hasToolResult) return false;
    // It's a real user message with structured content
    return true;
  }

  return false;
}

function isToolResultMessage(line: JsonlLine): boolean {
  if (line.type !== "user") return false;
  const content = line.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some((block: ContentBlock) => block.type === "tool_result");
}

function extractUserPrompt(line: JsonlLine): string {
  const content = line.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textBlocks = content.filter((b: ContentBlock) => b.type === "text");
    if (textBlocks.length > 0) {
      return textBlocks.map((b: ContentBlock) => b.text || "").join("\n");
    }
  }
  return "";
}

export function buildTurns(lines: JsonlLine[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let currentTurn: ConversationTurn | null = null;
  let turnIndex = 0;

  for (const line of lines) {
    // Skip file-history-snapshot and system lines
    if (line.type === "file-history-snapshot" || line.type === "system") continue;

    // Real user message -> start new turn
    if (isRealUserMessage(line)) {
      if (currentTurn) {
        turns.push(currentTurn);
      }
      currentTurn = {
        turnIndex: turnIndex++,
        userPrompt: extractUserPrompt(line),
        timestamp: line.timestamp || "",
        assistantThinking: [],
        assistantTexts: [],
        toolCalls: [],
        model: undefined,
      };
      continue;
    }

    // Tool result -> attach to current turn's matching tool call
    if (isToolResultMessage(line) && currentTurn) {
      const content = line.message?.content as ContentBlock[];
      for (const block of content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          const matchingTool = currentTurn.toolCalls.find(
            (tc) => tc.toolUseId === block.tool_use_id
          );
          if (matchingTool) {
            const resultText =
              typeof block.content === "string"
                ? block.content
                : Array.isArray(block.content)
                  ? block.content
                      .map((c: ContentBlock) => c.text || "")
                      .join("\n")
                  : JSON.stringify(block.content || "");
            matchingTool.result = truncate(resultText, TOOL_RESULT_LIMIT);
          }
        }
      }
      continue;
    }

    // Assistant message -> add to current turn
    if (line.type === "assistant" && currentTurn) {
      const content = line.message?.content;
      const model = line.message?.model;
      if (model && !currentTurn.model) {
        currentTurn.model = model;
      }

      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "thinking" && block.thinking) {
            currentTurn.assistantThinking.push(
              truncate(block.thinking, THINKING_LIMIT)
            );
          } else if (block.type === "text" && block.text) {
            currentTurn.assistantTexts.push(block.text);
          } else if (block.type === "tool_use") {
            const input = { ...block.input } as Record<string, unknown>;
            // Truncate Write.content
            if (
              block.name === "Write" &&
              typeof input.content === "string"
            ) {
              const fullLen = (input.content as string).length;
              input.content =
                truncate(input.content as string, WRITE_CONTENT_PREVIEW);
              input.contentLength = fullLen;
            }
            currentTurn.toolCalls.push({
              toolUseId: block.id || "",
              toolName: block.name || "unknown",
              input,
              result: undefined,
            });
          }
        }
      }
      continue;
    }
  }

  // Push last turn
  if (currentTurn) {
    turns.push(currentTurn);
  }

  return turns;
}

// ─── Task 1.3: Metadata Extraction ─────────────────────────────────────────

function extractMetadata(
  sessionFile: SessionFile,
  lines: JsonlLine[],
  turns: ConversationTurn[]
): SessionMeta {
  let cwd = "";
  let gitBranch = "";
  let version = "";
  let slug = "";
  let permissionMode = "";
  let createdAt = "";
  let lastActiveAt = "";
  const toolBreakdown: Record<string, number> = {};
  const modelsUsed: Record<string, number> = {};
  const filesEdited = new Set<string>();

  for (const line of lines) {
    // Extract metadata from any line that has these fields
    if (line.cwd && !cwd) cwd = line.cwd;
    if (line.gitBranch && !gitBranch) gitBranch = line.gitBranch;
    if (line.version && !version) version = line.version;
    if (line.slug && !slug) slug = line.slug;
    if (line.permissionMode && !permissionMode) permissionMode = line.permissionMode;

    // Track timestamps
    if (line.timestamp) {
      if (!createdAt || line.timestamp < createdAt) createdAt = line.timestamp;
      if (!lastActiveAt || line.timestamp > lastActiveAt) lastActiveAt = line.timestamp;
    }

    // Extract model usage from assistant messages
    if (line.type === "assistant" && line.message?.model) {
      const model = line.message.model;
      modelsUsed[model] = (modelsUsed[model] || 0) + 1;
    }
  }

  // Extract tool breakdown and files edited from turns
  for (const turn of turns) {
    for (const tc of turn.toolCalls) {
      toolBreakdown[tc.toolName] = (toolBreakdown[tc.toolName] || 0) + 1;

      // Track files edited via Edit/Write
      if (tc.toolName === "Edit" || tc.toolName === "Write") {
        const fp = tc.input.file_path;
        if (typeof fp === "string") {
          filesEdited.add(fp);
        }
      }
    }
  }

  const durationMinutes =
    createdAt && lastActiveAt
      ? Math.round(
          (new Date(lastActiveAt).getTime() - new Date(createdAt).getTime()) /
            60000
        )
      : 0;

  const firstPrompt = turns.length > 0 ? turns[0].userPrompt : "";

  return {
    sessionId: sessionFile.sessionId,
    cwd,
    gitBranch,
    version,
    slug,
    createdAt,
    lastActiveAt,
    durationMinutes,
    permissionMode,
    toolBreakdown,
    modelsUsed,
    filesEdited: [...filesEdited],
    subagentCount: sessionFile.subagentFiles.length,
    turnCount: turns.length,
    firstUserPrompt: truncate(firstPrompt, FIRST_PROMPT_LIMIT),
  };
}

// ─── Task 1.4: Subagent Linking ─────────────────────────────────────────────

async function parseSubagents(
  subagentFiles: string[]
): Promise<Record<string, SubagentSession>> {
  const subagents: Record<string, SubagentSession> = {};

  for (const filePath of subagentFiles) {
    const basename = path.basename(filePath, ".jsonl");
    // agent-a8edec15cbcf8cf42.jsonl -> agentId = a8edec15cbcf8cf42
    const agentId = basename.replace("agent-", "");

    // Read meta.json if exists
    const metaPath = filePath.replace(".jsonl", ".meta.json");
    let agentType = "unknown";
    if (fs.existsSync(metaPath)) {
      try {
        const metaContent = fs.readFileSync(metaPath, "utf-8");
        const meta = JSON.parse(metaContent);
        agentType = meta.agentType || "unknown";
      } catch {
        // ignore
      }
    }

    const lines = await parseJsonlFile(filePath);
    const turns = buildTurns(lines);

    // Extract model from first assistant line
    let model: string | undefined;
    for (const line of lines) {
      if (line.type === "assistant" && line.message?.model) {
        model = line.message.model;
        break;
      }
    }

    subagents[agentId] = {
      agentId,
      agentType,
      turns,
      model,
    };
  }

  return subagents;
}

// ─── Linked Plan ────────────────────────────────────────────────────────────

function loadLinkedPlan(
  slug: string
): { slug: string; content: string } | null {
  if (!slug) return null;
  const planPath = path.join(os.homedir(), ".claude", "plans", `${slug}.md`);
  if (fs.existsSync(planPath)) {
    try {
      const content = fs.readFileSync(planPath, "utf-8");
      return { slug, content };
    } catch {
      return null;
    }
  }
  return null;
}

// ─── Task 1.5: index.json Generation ────────────────────────────────────────

function generateIndex(sessions: ParsedSession[]): IndexJson {
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
      firstUserPrompt: s.meta.firstUserPrompt,
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

interface DistillConfig {
  skip: boolean;
  model?: string;
  count: number;
}

async function generateOverview(sessions: ParsedSession[], distillConfig: DistillConfig = { skip: false, count: 5 }): Promise<OverviewJson> {
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
  const sessionInputs: SessionInput[] = sessions.map((s) => ({
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

  // Pre-distill top skill candidates with claude -p
  if (!distillConfig.skip) {
    const topCandidates = [...knowledgeGraph.skillCandidates]
      .sort((a, b) => b.reusabilityScore - a.reusabilityScore)
      .slice(0, distillConfig.count);

    const distillOpts: DistillOptions = {};
    if (distillConfig.model) {
      distillOpts.model = distillConfig.model;
    }

    const total = topCandidates.length;
    if (total > 0) {
      console.error(`[crune] Distilling top ${total} skill candidates${distillConfig.model ? ` (model: ${distillConfig.model})` : ""}...`);
    }
    for (let i = 0; i < topCandidates.length; i++) {
      const candidate = topCandidates[i];
      const topic = knowledgeGraph.nodes.find((n) => n.id === candidate.topicId);
      if (!topic) continue;

      const topicSessionSet = new Set(topic.sessionIds);
      const relatedSequences = knowledgeGraph.enrichedToolSequences.filter((seq) =>
        seq.sessionIds.some((sid) => topicSessionSet.has(sid))
      );

      console.error(`[crune]   [${i + 1}/${total}] ${topic.label}...`);
      const prompt = buildDistillationPrompt({
        skillCandidate: candidate,
        topicNode: topic as unknown as import("./skill-distiller.js").TopicNode,
        enrichedSequences: relatedSequences,
      });
      const result = await distillWithClaude(prompt, distillOpts);
      if (result.success) {
        const original = knowledgeGraph.skillCandidates.find((sc) => sc.topicId === candidate.topicId);
        if (original) {
          original.distilledMarkdown = result.stdout;
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
  const { sessionsDir, outputDir, skipDistill, distillModel, distillCount } = parseArgs();

  console.error(`[crune] Sessions dir: ${sessionsDir}`);
  console.error(`[crune] Output dir:   ${outputDir}`);

  // Step 1: Discover sessions
  console.error(`\n[crune] Discovering sessions...`);
  const sessionFiles = discoverSessions(sessionsDir);
  console.error(`[crune] Found ${sessionFiles.length} sessions`);

  if (sessionFiles.length === 0) {
    console.error("[crune] No sessions found. Exiting.");
    process.exit(1);
  }

  // Step 2: Parse each session with metadata and subagents
  const parsedSessions: ParsedSession[] = [];

  for (let i = 0; i < sessionFiles.length; i++) {
    const sf = sessionFiles[i];
    console.error(
      `[crune] Processing session ${i + 1}/${sessionFiles.length}: ${sf.sessionId}`
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
  const indexData = generateIndex(parsedSessions);
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

  // overview.json
  const overviewData = await generateOverview(parsedSessions, {
    skip: skipDistill,
    model: distillModel,
    count: distillCount,
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

main().catch((err) => {
  console.error(`[crune] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
