/**
 * session-parser.ts
 *
 * Session discovery, JSONL parsing, turn building, and metadata extraction.
 * Extracted from analyze-sessions.ts for testability and reuse.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import * as os from "node:os";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Discovered session file on disk */
export interface SessionFile {
  filePath: string;
  sessionId: string;
  projectDir: string;
  projectDisplayName: string;
  subagentFiles: string[];
}

/** A single JSONL line parsed to an object */
export interface JsonlLine {
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

export interface ContentBlock {
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
export interface ToolCall {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  result?: string;
}

/** A single conversation turn (user prompt + all assistant responses until next user prompt) */
export interface ConversationTurn {
  turnIndex: number;
  userPrompt: string;
  timestamp: string;
  assistantThinking: string[];
  assistantTexts: string[];
  toolCalls: ToolCall[];
  model?: string;
}

/** Metadata extracted from a session */
export interface SessionMeta {
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
export interface SubagentSession {
  agentId: string;
  agentType: string;
  turns: ConversationTurn[];
  model?: string;
}

/** Full parsed session */
export interface ParsedSession {
  meta: SessionMeta;
  turns: ConversationTurn[];
  subagents: Record<string, SubagentSession>;
  linkedPlan: { slug: string; content: string } | null;
  projectDir: string;
  projectDisplayName: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const THINKING_LIMIT = 5000;
export const TOOL_RESULT_LIMIT = 2000;
export const WRITE_CONTENT_PREVIEW = 500;
export const FIRST_PROMPT_LIMIT = 200;

// ─── Session Discovery ─────────────────────────────────────────────────────

export function discoverSessions(sessionsDir: string): SessionFile[] {
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

export function inferProjectName(dirName: string): string {
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

// ─── JSONL Parser + Turn Builder ────────────────────────────────────────────

/**
 * Check if a JSONL file is a non-interactive session created by `claude -p`.
 * These sessions contain `queue-operation` entries and should be excluded
 * from the dashboard to prevent synthesis prompts from appearing as sessions.
 */
export function isNonInteractiveSession(filePath: string): boolean {
  try {
    // Read only the first 4KB to check for queue-operation (always near the top)
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const head = buf.toString("utf-8", 0, bytesRead);
    return head.includes('"type":"queue-operation"');
  } catch {
    return false;
  }
}

export async function parseJsonlFile(filePath: string): Promise<JsonlLine[]> {
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

export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "\u2026";
}

export function isRealUserMessage(line: JsonlLine): boolean {
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

export function isToolResultMessage(line: JsonlLine): boolean {
  if (line.type !== "user") return false;
  const content = line.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some((block: ContentBlock) => block.type === "tool_result");
}

export function extractUserPrompt(line: JsonlLine): string {
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

// ─── Metadata Extraction ────────────────────────────────────────────────────

export function extractMetadata(
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

// ─── Subagent Linking ───────────────────────────────────────────────────────

export async function parseSubagents(
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

export function loadLinkedPlan(
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
