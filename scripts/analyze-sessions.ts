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

// ─── CLI argument parsing ───────────────────────────────────────────────────

function parseArgs(): { sessionsDir: string; outputDir: string } {
  const args = process.argv.slice(2);
  let sessionsDir = path.join(os.homedir(), ".claude", "projects");
  let outputDir = path.resolve("public", "data", "sessions");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sessions-dir" && args[i + 1]) {
      sessionsDir = path.resolve(args[++i]);
    } else if (args[i] === "--output-dir" && args[i + 1]) {
      outputDir = path.resolve(args[++i]);
    }
  }
  return { sessionsDir, outputDir };
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: Record<string, any>;
  tool_use_id?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content?: any;
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

// ─── Constants ──────────────────────────────────────────────────────────────

const THINKING_LIMIT = 5000;
const TOOL_RESULT_LIMIT = 2000;
const WRITE_CONTENT_PREVIEW = 500;

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

// ─── Main Pipeline ──────────────────────────────────────────────────────────

async function main() {
  const { sessionsDir, outputDir: _outputDir } = parseArgs();

  console.error(`[crune] Sessions dir: ${sessionsDir}`);

  // Step 1: Discover sessions
  console.error(`\n[crune] Discovering sessions...`);
  const sessionFiles = discoverSessions(sessionsDir);
  console.error(`[crune] Found ${sessionFiles.length} sessions`);

  if (sessionFiles.length === 0) {
    console.error("[crune] No sessions found. Exiting.");
    process.exit(1);
  }

  // Step 2: Parse each session into turns
  let totalTurns = 0;

  for (let i = 0; i < sessionFiles.length; i++) {
    const sf = sessionFiles[i];
    console.error(
      `[crune] Processing session ${i + 1}/${sessionFiles.length}: ${sf.sessionId}`
    );

    try {
      const lines = await parseJsonlFile(sf.filePath);
      const turns = buildTurns(lines);
      totalTurns += turns.length;
    } catch (err) {
      console.error(
        `  [ERROR] Failed to process ${sf.sessionId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  console.error(`\n[crune] Parsed ${totalTurns} turns across ${sessionFiles.length} sessions`);
  console.error(`[crune] Done (output generation not yet implemented).`);
}

main().catch((err) => {
  console.error(`[crune] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
