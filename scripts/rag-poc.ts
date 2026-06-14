/**
 * rag-poc.ts — RAG retrieval Proof-of-Concept harness (issue #35).
 *
 * Measures the three hypotheses behind chunk-level RAG retrieval:
 *   1. Footprint  — on-disk index size for the corpus.
 *   2. Throughput — embedding chunks/sec.
 *   3. Latency    — retrieval p50/p95 over sample queries.
 * Plus an A/B eyeball: today's cluster-blob context vs top-k retrieved snippets.
 *
 * Run:
 *   npx tsx scripts/rag-poc.ts                 # auto: real model if available
 *   npx tsx scripts/rag-poc.ts --fake          # force the deterministic fake backend
 *   npx tsx scripts/rag-poc.ts --sessions-dir <path>
 *   npx tsx scripts/rag-poc.ts --embed-model <id>
 *
 * The HuggingFace model download may be BLOCKED in sandboxes. When it fails the
 * harness transparently falls back to a deterministic fake backend so the
 * methodology and plumbing still run end-to-end (numbers will be labeled FAKE).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import {
  discoverSessions,
  parseJsonlFile,
  buildTurns,
  extractMetadata,
  isNonInteractiveSession,
} from "./session-parser.js";
import {
  embedSessions,
  extractChunks,
  createRetriever,
  dequantize,
  createTransformersBackend,
  DEFAULT_EMBED_MODEL,
  DEFAULT_EMBED_DIM,
  type EmbeddingBackend,
  type SessionInput,
} from "./knowledge-graph-builder.js";

// ─── Args ────────────────────────────────────────────────────────────────────

interface PocArgs {
  sessionsDir: string;
  embedModel: string;
  forceFake: boolean;
  maxSessions: number;
}

function parsePocArgs(argv = process.argv.slice(2)): PocArgs {
  let sessionsDir = path.join(os.homedir(), ".claude", "projects");
  let embedModel = DEFAULT_EMBED_MODEL;
  let forceFake = false;
  let maxSessions = 40;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sessions-dir" && argv[i + 1]) sessionsDir = path.resolve(argv[++i]);
    else if (argv[i] === "--embed-model" && argv[i + 1]) embedModel = argv[++i];
    else if (argv[i] === "--fake") forceFake = true;
    else if (argv[i] === "--max-sessions" && argv[i + 1]) maxSessions = parseInt(argv[++i], 10) || 40;
  }
  return { sessionsDir, embedModel, forceFake, maxSessions };
}

// ─── Deterministic fake backend (no network) ─────────────────────────────────

function fakeBackend(dim = DEFAULT_EMBED_DIM): EmbeddingBackend {
  return {
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((text) => {
        const vec = new Float32Array(dim);
        for (const tok of text.toLowerCase().split(/\s+/).filter(Boolean)) {
          let h = 0;
          for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) | 0;
          vec[Math.abs(h) % dim] += 1;
        }
        let n = 0;
        for (const v of vec) n += v * v;
        n = Math.sqrt(n) || 1;
        for (let i = 0; i < dim; i++) vec[i] /= n;
        return vec;
      });
    },
  };
}

// ─── Synthetic fallback corpus (used when no sessions are discoverable) ───────

function syntheticSessions(): SessionInput[] {
  const mk = (id: string, prompts: string[]): SessionInput => ({
    sessionId: id,
    projectDisplayName: "demo/crune",
    turns: prompts.map((p) => ({ userPrompt: p, assistantTexts: [], toolCalls: [] })),
    subagents: {},
    meta: {
      sessionId: id,
      createdAt: "2026-01-01T00:00:00Z",
      lastActiveAt: "2026-01-01T00:10:00Z",
      durationMinutes: 10,
      filesEdited: [],
      gitBranch: "main",
      toolBreakdown: {},
      subagentCount: 0,
    },
  });
  return [
    mk("auth-1", [
      "implement JWT auth login flow",
      "fix the auth token refresh handler",
      "add session cookie expiry handling",
    ]),
    mk("db-1", [
      "write a database migration for the users table",
      "add an index to speed up the orders query",
      "fix the connection pool leak in postgres",
    ]),
    mk("ui-1", [
      "style the knowledge graph view with css variables",
      "add a drawer overlay for session playback",
      "fix the responsive layout on mobile",
    ]),
    mk("ci-1", [
      "set up the github actions ci pipeline",
      "make the lint and typecheck steps pass",
      "deploy the dist bundle to production",
    ]),
  ];
}

// ─── Session loading ─────────────────────────────────────────────────────────

async function loadSessions(dir: string, max: number): Promise<SessionInput[]> {
  if (!fs.existsSync(dir)) return [];
  const files = discoverSessions(dir).filter((sf) => !isNonInteractiveSession(sf.filePath));
  const out: SessionInput[] = [];
  for (const sf of files.slice(0, max)) {
    try {
      const lines = await parseJsonlFile(sf.filePath);
      const turns = buildTurns(lines);
      const meta = extractMetadata(sf, lines, turns);
      out.push({
        sessionId: meta.sessionId,
        projectDisplayName: sf.projectDisplayName,
        turns: turns.map((t) => ({
          userPrompt: t.userPrompt,
          assistantTexts: t.assistantTexts,
          toolCalls: t.toolCalls.map((tc) => ({ toolName: tc.toolName, input: tc.input })),
        })),
        subagents: {},
        meta: {
          sessionId: meta.sessionId,
          createdAt: meta.createdAt,
          lastActiveAt: meta.lastActiveAt,
          durationMinutes: meta.durationMinutes,
          filesEdited: meta.filesEdited,
          gitBranch: meta.gitBranch,
          toolBreakdown: meta.toolBreakdown,
          subagentCount: meta.subagentCount,
        },
      });
    } catch {
      // skip unparseable sessions
    }
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// ─── Main ────────────────────────────────────────────────────────────────────

const SAMPLE_QUERIES = [
  "fix the authentication token bug",
  "database migration and query performance",
  "css styling and responsive layout",
  "set up CI pipeline and deploy",
];

async function main() {
  const args = parsePocArgs();
  console.log("=== crune RAG PoC (issue #35) ===\n");

  // 1. Load corpus.
  let sessions = await loadSessions(args.sessionsDir, args.maxSessions);
  let corpusLabel = `real sessions from ${args.sessionsDir}`;
  if (sessions.length === 0) {
    sessions = syntheticSessions();
    corpusLabel = "synthetic fallback corpus (no sessions discovered)";
  }
  const chunks = extractChunks(sessions);
  console.log(`Corpus: ${corpusLabel}`);
  console.log(`Sessions: ${sessions.length}, chunks: ${chunks.length}\n`);

  // 2. Backend selection (real, with graceful fallback to fake).
  let backend: EmbeddingBackend;
  let backendLabel: string;
  if (args.forceFake) {
    backend = fakeBackend();
    backendLabel = "FAKE (forced via --fake)";
  } else {
    try {
      const real = createTransformersBackend(args.embedModel, DEFAULT_EMBED_DIM);
      // Probe the model with a tiny embed to trigger (and validate) the download.
      await real.embed(["probe"]);
      backend = real;
      backendLabel = `REAL (${args.embedModel})`;
    } catch (err) {
      backend = fakeBackend();
      backendLabel = `FAKE (real model unavailable: ${err instanceof Error ? err.message : String(err)})`;
    }
  }
  console.log(`Backend: ${backendLabel}\n`);

  // 3. Throughput + footprint.
  const t0 = performance.now();
  const result = await embedSessions(sessions, backend, { model: args.embedModel });
  const embedMs = performance.now() - t0;
  const throughput = result.count / (embedMs / 1000);
  const binBytes = result.matrix.byteLength;
  const metaBytes = Buffer.byteLength(
    JSON.stringify({ model: result.model, dim: result.dim, count: result.count, scale: result.scale, chunks: result.chunks })
  );

  console.log("--- Footprint ---");
  console.log(`index.bin: ${(binBytes / 1024).toFixed(1)} KB (${result.count} × ${result.dim} int8)`);
  console.log(`meta.json: ${(metaBytes / 1024).toFixed(1)} KB`);
  console.log(`bytes/chunk (vector only): ${(binBytes / Math.max(1, result.count)).toFixed(0)}\n`);

  console.log("--- Throughput ---");
  console.log(`embedded ${result.count} chunks in ${embedMs.toFixed(0)} ms → ${throughput.toFixed(1)} chunks/sec\n`);

  // 4. Retrieval latency.
  const denseVectors = chunks.map((_, i) => dequantize(result.matrix.subarray(i * result.dim, (i + 1) * result.dim)));
  const retriever = createRetriever({
    chunks: result.chunks,
    texts: chunks.map((c) => c.text),
    denseVectors,
    backend,
  });

  const latencies: number[] = [];
  for (let rep = 0; rep < 5; rep++) {
    for (const q of SAMPLE_QUERIES) {
      const s = performance.now();
      await retriever.retrieve(q, 5);
      latencies.push(performance.now() - s);
    }
  }
  latencies.sort((a, b) => a - b);
  console.log("--- Retrieval latency (per query, k=5) ---");
  console.log(`p50: ${percentile(latencies, 50).toFixed(1)} ms, p95: ${percentile(latencies, 95).toFixed(1)} ms (n=${latencies.length})\n`);

  // 5. A/B eyeball: cluster-blob (concatenated session text) vs top-k snippets.
  console.log("--- A/B: cluster-blob vs top-k retrieval ---");
  for (const q of SAMPLE_QUERIES.slice(0, 2)) {
    console.log(`\nQuery: "${q}"`);
    const top = await retriever.retrieve(q, 3);
    console.log("  Top-k retrieved snippets:");
    for (const r of top) {
      console.log(`    [${r.score.toFixed(3)}] ${r.sessionId}#${r.turnIndex}: ${r.snippet.slice(0, 90)}`);
    }
    // "Cluster blob" today = the entire first matching session concatenated.
    const blobSession = top[0] ? sessions.find((s) => s.sessionId === top[0].sessionId) : undefined;
    if (blobSession) {
      const blob = blobSession.turns.map((t) => t.userPrompt).join(" ").slice(0, 180);
      console.log(`  Today's cluster-blob context (session ${blobSession.sessionId}, truncated):`);
      console.log(`    ${blob}…`);
    }
  }

  console.log("\n=== PoC complete ===");
  if (backendLabel.startsWith("FAKE")) {
    console.log("NOTE: numbers above use the FAKE backend. Re-run outside the sandbox");
    console.log("      (network access to HuggingFace) for real embedding-quality numbers.");
  }
}

main().catch((err) => {
  console.error(`[rag-poc] fatal: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
