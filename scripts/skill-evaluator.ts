/**
 * Skill evaluator: validates SKILL.md output from skill synthesis.
 *
 * Three layers (issue #20):
 *   1. Deterministic structural validation (zod-backed YAML frontmatter checks).
 *   2. LLM rubric scoring via `claude -p` (skill-creator-aligned).
 *   3. Smoke firing test (stubbed for now — needs Claude Code itself to run).
 *
 * The evaluator surfaces hints; gating / regenerate-loop is intentionally left
 * to a follow-up issue. Callers may still write the file when scores are low.
 */
import { spawn } from "node:child_process";
import { z } from "zod";
import type { SkillEvaluation } from "../src/types/session.js";

// ---------- Types ----------

export interface StructuralIssue {
  field: string;
  message: string;
}

export interface StructuralResult {
  valid: boolean;
  issues: StructuralIssue[];
  parsed?: {
    name: string;
    description: string;
    allowedTools?: string[];
    requires?: string[];
    next?: string[];
  };
}

export interface RubricResult {
  ok: boolean;
  score?: number; // 0-100
  breakdown?: {
    nameQuality: number;
    descriptionTriggering: number;
    instructionsConcrete: number;
    noPreambleNoise: number;
  };
  hints?: string[];
  rawResponse?: string;
  error?: string;
  skipped?: boolean;
}

export interface SmokeFiringResult {
  skipped: boolean;
  message?: string;
}

export interface EvaluationResult {
  structural: StructuralResult;
  rubric?: RubricResult;
  smokeFiring: SmokeFiringResult;
  overallScore?: number; // structural pass (0/50) + rubric (0..50) when available
}

export interface EvaluatorOptions {
  model?: string;        // claude model for rubric scoring
  skipRubric?: boolean;  // local-only structural validation
  timeoutMs?: number;    // rubric LLM call timeout
}

// ---------- Frontmatter parsing ----------

/**
 * Minimal YAML frontmatter parser tailored to SKILL.md (no full YAML lib needed).
 * Supports:
 *   - simple `key: value` scalars
 *   - inline arrays `key: [a, b, c]`
 *   - indented list items under a key:
 *       key:
 *         - a
 *         - b
 *   - quoted strings (single or double)
 * Throws on malformed structure.
 */
export function extractFrontmatter(markdown: string): {
  raw: string;
  data: Record<string, unknown>;
} {
  // Strip optional UTF-8 BOM (U+FEFF) before parsing.
  const trimmed = markdown.replace(/^\uFEFF/, "");
  if (!trimmed.startsWith("---")) {
    throw new Error("missing frontmatter: file must start with '---'");
  }
  const rest = trimmed.slice(3);
  const newlineAfterOpen = rest.indexOf("\n");
  if (newlineAfterOpen === -1) {
    throw new Error("malformed frontmatter: no newline after opening '---'");
  }
  const after = rest.slice(newlineAfterOpen + 1);
  const closeIdx = after.search(/^---\s*$/m);
  if (closeIdx === -1) {
    throw new Error("malformed frontmatter: missing closing '---'");
  }
  const raw = after.slice(0, closeIdx);

  const data: Record<string, unknown> = {};
  const lines = raw.split("\n");
  let currentListKey: string | null = null;
  let listAccumulator: string[] = [];

  const flushList = () => {
    if (currentListKey !== null) {
      data[currentListKey] = listAccumulator;
      currentListKey = null;
      listAccumulator = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    // Indented list item under previous key.
    if (currentListKey !== null && /^\s+-\s+/.test(line)) {
      const value = line.replace(/^\s+-\s+/, "").trim();
      listAccumulator.push(unquote(value));
      continue;
    }

    // New key — flush any pending list.
    flushList();

    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) {
      throw new Error(`malformed frontmatter line: ${JSON.stringify(line)}`);
    }
    const [, key, rawValue] = m;
    const value = rawValue.trim();

    if (value === "") {
      // Possibly a list opener.
      currentListKey = key;
      listAccumulator = [];
      continue;
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      data[key] = inner === ""
        ? []
        : inner.split(",").map((s) => unquote(s.trim()));
      continue;
    }

    data[key] = unquote(value);
  }
  flushList();

  return { raw, data };
}

function unquote(s: string): string {
  if (s.length >= 2) {
    if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
  }
  return s;
}

// ---------- Structural schema ----------

// Skill-creator conventions: kebab-case-ish name, short, descriptive.
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;
const FORBIDDEN_NAME_CHARS_RE = /[^a-z0-9-]/;

const FrontmatterSchema = z.object({
  name: z
    .string({ message: "name is required" })
    .min(2, { message: "name must be at least 2 characters" })
    .max(64, { message: "name must be at most 64 characters" })
    .refine((v) => !FORBIDDEN_NAME_CHARS_RE.test(v), {
      message: "name must use lowercase letters, digits, and hyphens only",
    })
    .refine((v) => NAME_RE.test(v), {
      message: "name must start and end with [a-z0-9] and use kebab-case",
    }),
  description: z
    .string({ message: "description is required" })
    .min(20, { message: "description should be at least 20 characters (encode trigger conditions)" })
    .max(500, { message: "description must be at most 500 characters" }),
  allowedTools: z.array(z.string().min(1)).optional(),
  requires: z.array(z.string().min(1)).optional(),
  next: z.array(z.string().min(1)).optional(),
}).passthrough();

// ---------- Structural validation ----------

export function validateStructure(markdown: string): StructuralResult {
  const issues: StructuralIssue[] = [];

  let parsed: { raw: string; data: Record<string, unknown> };
  try {
    parsed = extractFrontmatter(markdown);
  } catch (err) {
    return {
      valid: false,
      issues: [
        {
          field: "frontmatter",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  // Normalize allowed-tools key variants (e.g. `allowed-tools`, `allowed_tools`).
  const data = { ...parsed.data };
  for (const altKey of ["allowed-tools", "allowed_tools"]) {
    if (altKey in data && !("allowedTools" in data)) {
      data.allowedTools = data[altKey];
    }
  }

  const result = FrontmatterSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push({
        field: issue.path.join(".") || "frontmatter",
        message: issue.message,
      });
    }
    return { valid: false, issues };
  }

  const fm = result.data;

  // Body sanity: must contain something past the closing '---'.
  // Tolerate optional UTF-8 BOM and files that end immediately after the
  // closing fence (no trailing newline) — the previous regex required a
  // newline after the closing fence and falsely reported "empty body" when
  // a real body was present without a trailing blank line.
  const stripped = markdown.replace(/^\uFEFF/, "");
  const closeMatch = stripped.match(
    /^---\s*\n[\s\S]*?\n---\s*(?:\n([\s\S]*))?$/
  );
  const body = closeMatch?.[1] ?? "";
  if (body.trim().length === 0) {
    issues.push({
      field: "body",
      message: "skill body is empty after frontmatter",
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    parsed: {
      name: fm.name,
      description: fm.description,
      allowedTools: fm.allowedTools,
      requires: fm.requires,
      next: fm.next,
    },
  };
}

// ---------- LLM rubric ----------

const RUBRIC_PROMPT_HEADER = `You are an evaluator for Claude Code "Skill" definitions (SKILL.md files).
Your task is to score a single SKILL.md against the skill-creator authoring rubric.

Output requirements:
- Return STRICT JSON only. No markdown fences. No prose before or after.
- The JSON must match this shape exactly:
  {
    "score": <number 0-100>,
    "breakdown": {
      "nameQuality": <number 0-25>,
      "descriptionTriggering": <number 0-25>,
      "instructionsConcrete": <number 0-25>,
      "noPreambleNoise": <number 0-25>
    },
    "hints": [<short improvement suggestions, may be empty>]
  }

Scoring rubric (skill-creator alignment):
- nameQuality (25): kebab-case, descriptive of the workflow, not generic ("helper", "utils").
- descriptionTriggering (25): description encodes WHEN to use the skill, with concrete trigger phrases. Penalize vague descriptions.
- instructionsConcrete (25): body contains step-by-step actionable instructions, references specific tools, and has examples.
- noPreambleNoise (25): no LLM preamble outside the SKILL.md content (e.g. "Here is your skill:"); content begins with frontmatter.

If the SKILL.md is fundamentally broken (not a SKILL.md), return score 0 with a hint explaining why.`;

export function buildRubricPrompt(markdown: string): string {
  // SKILL.md content commonly contains triple-backtick code fences in its
  // body. Wrap the embedded markdown with a longer fence so nested triple
  // backticks do not terminate the outer block (CommonMark allows the inner
  // fences as long as their length is shorter than the outer).
  const fence = pickEnclosingFence(markdown);
  return [
    RUBRIC_PROMPT_HEADER,
    "",
    "## SKILL.md to evaluate",
    fence,
    markdown,
    fence,
  ].join("\n");
}

function pickEnclosingFence(markdown: string): string {
  // Find the longest run of backticks at line start in the input, then use
  // a fence that is one backtick longer (minimum 4).
  let longest = 0;
  for (const line of markdown.split("\n")) {
    const m = line.match(/^(`+)/);
    if (m && m[1].length > longest) longest = m[1].length;
  }
  return "`".repeat(Math.max(4, longest + 1));
}

const RubricResponseSchema = z.object({
  score: z.number().min(0).max(100),
  breakdown: z.object({
    nameQuality: z.number().min(0).max(25),
    descriptionTriggering: z.number().min(0).max(25),
    instructionsConcrete: z.number().min(0).max(25),
    noPreambleNoise: z.number().min(0).max(25),
  }),
  hints: z.array(z.string()).default([]),
});

/**
 * Extract the first balanced JSON object from a possibly-noisy string.
 * Handles cases where the model wraps the JSON in stray text.
 */
export function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Spawn `claude -p` to score a SKILL.md against the rubric.
 * Mirrors `synthesizeWithClaude` style for consistency.
 */
export function scoreWithRubric(
  markdown: string,
  options: EvaluatorOptions = {}
): Promise<RubricResult> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const prompt = buildRubricPrompt(markdown);

  return new Promise((resolve) => {
    const args = [
      "-p",
      "--output-format",
      "text",
      "--permission-mode",
      "acceptEdits",
      "--no-session-persistence",
    ];
    if (options.model) {
      args.push("--model", options.model);
    }

    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });

    let spawnFailed = false;

    child.on("error", (err: NodeJS.ErrnoException) => {
      // Capture any spawn-time failure (ENOENT, EACCES, EPERM, ...). The
      // 'close' event still fires after 'error' with code = null, so we set
      // a flag and let the close handler short-circuit with a meaningful
      // message instead of "claude exited with code null".
      if (spawnFailed) return;
      spawnFailed = true;
      const message =
        err.code === "ENOENT"
          ? "claude CLI not found. Install Claude Code first."
          : `failed to spawn claude: ${err.message}`;
      resolve({ ok: false, error: message });
    });

    // Without an 'error' listener on stdin, a spawn failure causes Node to
    // crash the host process when we call stdin.write below. Swallow it —
    // the 'error' handler on the child already produced a structured result.
    child.stdin.on("error", () => {});

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({
        ok: false,
        error: `Rubric scoring timed out (${timeoutMs / 1000}s)`,
      });
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (spawnFailed) return;
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (code !== 0) {
        resolve({
          ok: false,
          rawResponse: stdout,
          error: `claude exited with code ${code}: ${stderr}`,
        });
        return;
      }
      const json = extractFirstJsonObject(stdout);
      if (!json) {
        resolve({
          ok: false,
          rawResponse: stdout,
          error: "rubric response did not contain a JSON object",
        });
        return;
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(json);
      } catch (err) {
        resolve({
          ok: false,
          rawResponse: stdout,
          error: `failed to parse rubric JSON: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      const validated = RubricResponseSchema.safeParse(parsedJson);
      if (!validated.success) {
        resolve({
          ok: false,
          rawResponse: stdout,
          error: `rubric JSON shape mismatch: ${validated.error.issues.map((i) => i.message).join("; ")}`,
        });
        return;
      }
      resolve({
        ok: true,
        score: validated.data.score,
        breakdown: validated.data.breakdown,
        hints: validated.data.hints,
        rawResponse: stdout,
      });
    });

    // Best-effort write. If spawn failed, stdin may already be destroyed —
    // the registered 'error' listeners catch the resulting EPIPE/ECONNRESET.
    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch {
      // Already surfaced via the child 'error' handler above.
    }
  });
}

// ---------- Smoke firing test (stub) ----------

/**
 * Smoke firing test: feed fixture prompts that should trigger the skill and
 * verify Claude Code activates it. Real implementation requires Claude Code
 * itself as runner, so this is intentionally a stub for issue #20. Follow-up
 * work will wire fixtures + activation tracing.
 */
export function smokeFireTest(markdown: string): Promise<SmokeFiringResult> {
  // markdown is accepted for API stability — real implementation will feed
  // fixture prompts and inspect activation traces against this content.
  void markdown;
  return Promise.resolve({
    skipped: true,
    message: "smoke firing test is not yet implemented (issue #20 follow-up)",
  });
}

// ---------- Orchestrator ----------

export async function evaluateSkill(
  markdown: string,
  options: EvaluatorOptions = {}
): Promise<EvaluationResult> {
  const structural = validateStructure(markdown);

  let rubric: RubricResult | undefined;
  if (options.skipRubric) {
    rubric = { ok: false, skipped: true };
  } else if (!structural.valid) {
    // Structural validation failed -> overallScore is forced to 0 regardless of
    // the rubric, so the (expensive) claude -p rubric call would be wasted.
    rubric = { ok: false, skipped: true };
  } else {
    rubric = await scoreWithRubric(markdown, options);
  }

  const smokeFiring = await smokeFireTest(markdown);

  // Overall score: 50 for structural pass + scaled rubric (0-50).
  let overallScore: number | undefined;
  if (structural.valid) {
    overallScore = 50;
    if (rubric?.ok && typeof rubric.score === "number") {
      overallScore += Math.round(rubric.score / 2);
    }
  } else {
    overallScore = 0;
  }

  return { structural, rubric, smokeFiring, overallScore };
}

// ---------- Soft threshold ----------

/**
 * Decide whether to trigger a (single, bounded) re-synthesis retry for a
 * skill whose evaluation scored below the soft threshold.
 *
 * Pure decision function — the caller owns the actual retry budget (exactly
 * one extra `claude -p` call). A missing score is treated as 0. A threshold
 * of 0 disables retries entirely.
 */
export function shouldRetrySynthesis(
  overallScore: number | undefined,
  threshold: number
): boolean {
  if (threshold <= 0) return false;
  return (overallScore ?? 0) < threshold;
}

// ---------- Persistence mapper ----------

/**
 * Convert an internal {@link EvaluationResult} into the persistable
 * {@link SkillEvaluation} shape from src/types/session.ts.
 *
 * Drops fields that are not safe / useful to serialize into overview.json:
 *   - `rubric.rawResponse` (raw LLM text, potentially large/noisy)
 *   - `structural.parsed` (intermediate parse, not part of the UI shape)
 *
 * Everything else (structural validity + issues, rubric score/breakdown/hints/
 * error/skipped, smoke firing, overall score) is preserved verbatim.
 */
export function toSkillEvaluation(result: EvaluationResult): SkillEvaluation {
  const out: SkillEvaluation = {
    structural: {
      valid: result.structural.valid,
      issues: result.structural.issues.map((i) => ({
        field: i.field,
        message: i.message,
      })),
    },
    smokeFiring: {
      skipped: result.smokeFiring.skipped,
      message: result.smokeFiring.message,
    },
    overallScore: result.overallScore,
  };

  if (result.rubric) {
    out.rubric = {
      ok: result.rubric.ok,
      score: result.rubric.score,
      breakdown: result.rubric.breakdown
        ? { ...result.rubric.breakdown }
        : undefined,
      hints: result.rubric.hints ? [...result.rubric.hints] : undefined,
      error: result.rubric.error,
      skipped: result.rubric.skipped,
    };
  }

  return out;
}
