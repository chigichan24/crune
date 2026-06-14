import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildSynthesisPrompt, synthesizeWithClaude, stripSynthesisPreamble } from "./skill-synthesizer.js";
import type { SynthesisRequest, SynthesisResponse } from "./skill-synthesizer.js";
import { mergeFeedbackBlob, normalizeFeedbackBlob, type FeedbackBlob } from "./feedback-reader.js";

// ---------- Constants ----------

/** On-disk feedback store synced from the browser. Read by the pipeline. */
const FEEDBACK_FILE = resolve("public", "data", "feedback.json");

/**
 * CORS headers shared by every endpoint. The Vite dev server proxies
 * `/api/synthesize`, but the feedback sync client may also POST cross-origin,
 * so allow it explicitly (mirrors the synthesize contract).
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ---------- Helpers ----------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS_HEADERS });
  res.end(JSON.stringify(body));
}

// ---------- Request Handler ----------

async function handleSynthesize(req: IncomingMessage, res: ServerResponse) {
  let body: SynthesisRequest;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { success: false, error: "Invalid JSON in request body" } satisfies SynthesisResponse);
    return;
  }

  if (!body.skillCandidate || !body.topicNode) {
    sendJson(res, 400, { success: false, error: "Missing required fields: skillCandidate, topicNode" } satisfies SynthesisResponse);
    return;
  }

  const prompt = buildSynthesisPrompt(body);
  const result = await synthesizeWithClaude(prompt);

  if (!result.success) {
    sendJson(res, 500, { success: false, error: result.error } satisfies SynthesisResponse);
    return;
  }

  sendJson(res, 200, { success: true, synthesizedMarkdown: stripSynthesisPreamble(result.stdout) } satisfies SynthesisResponse);
}

/** Read the on-disk feedback map (normalized), or {} if absent/corrupt. */
function readFeedbackFile(): FeedbackBlob {
  if (!existsSync(FEEDBACK_FILE)) return {};
  try {
    const raw = readFileSync(FEEDBACK_FILE, "utf-8");
    return normalizeFeedbackBlob(JSON.parse(raw));
  } catch {
    return {};
  }
}

function writeFeedbackFile(blob: FeedbackBlob): void {
  mkdirSync(dirname(FEEDBACK_FILE), { recursive: true });
  writeFileSync(FEEDBACK_FILE, JSON.stringify(blob, null, 2), "utf-8");
}

function handleGetFeedback(res: ServerResponse) {
  sendJson(res, 200, readFeedbackFile());
}

/**
 * Merge the posted session's entries into the on-disk feedback map. The body is
 * `{ sessionId, entries }`; an empty `entries` array clears that session's
 * bucket. Normalization (dropping empty entries) mirrors the browser store.
 */
async function handlePostFeedback(req: IncomingMessage, res: ServerResponse) {
  let body: { sessionId?: unknown; entries?: unknown };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON in request body" });
    return;
  }

  if (typeof body.sessionId !== "string" || !Array.isArray(body.entries)) {
    sendJson(res, 400, { error: "Missing required fields: sessionId, entries" });
    return;
  }

  try {
    const current = readFeedbackFile();
    const merged = mergeFeedbackBlob(current, body.sessionId, body.entries);
    writeFeedbackFile(merged);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : "Failed to persist feedback" });
  }
}

// ---------- Server ----------

const isDirectRun = process.argv[1]?.endsWith("skill-server.ts") || process.argv[1]?.endsWith("skill-server.js");

if (isDirectRun) {
  const PORT = 3456;

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (req.method === "POST" && req.url === "/api/synthesize") {
      await handleSynthesize(req, res);
    } else if (req.method === "GET" && req.url === "/api/feedback") {
      handleGetFeedback(res);
    } else if (req.method === "POST" && req.url === "/api/feedback") {
      await handlePostFeedback(req, res);
    } else {
      sendJson(res, 404, { error: "Not found" });
    }
  });

  server.listen(PORT, () => {
    console.log(`Skill synthesis server listening on http://localhost:${PORT}`);
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
