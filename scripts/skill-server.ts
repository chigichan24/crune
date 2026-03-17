import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { buildSynthesisPrompt, synthesizeWithClaude, stripSynthesisPreamble } from "./skill-synthesizer.js";
import type { SynthesisRequest, SynthesisResponse } from "./skill-synthesizer.js";

// ---------- Helpers ----------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: SynthesisResponse | { error: string }) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// ---------- Request Handler ----------

async function handleSynthesize(req: IncomingMessage, res: ServerResponse) {
  let body: SynthesisRequest;
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

  const prompt = buildSynthesisPrompt(body);
  const result = await synthesizeWithClaude(prompt);

  if (!result.success) {
    sendJson(res, 500, { success: false, error: result.error });
    return;
  }

  sendJson(res, 200, { success: true, synthesizedMarkdown: stripSynthesisPreamble(result.stdout) });
}

// ---------- Server ----------

const isDirectRun = process.argv[1]?.endsWith("skill-server.ts") || process.argv[1]?.endsWith("skill-server.js");

if (isDirectRun) {
  const PORT = 3456;

  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/api/synthesize") {
      await handleSynthesize(req, res);
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
