/**
 * One-shot aggregation script: emits a frequency histogram of `toolName`
 * values across the local Claude Code session corpus.
 *
 * Used to inform the priority list of tools that need dedicated rendering in
 * `src/components/playback/ToolCallBlock.tsx` (issue #21).
 *
 * Usage:
 *   npx tsx scripts/aggregate-tool-names.ts [--sessions-dir <path>] [--limit <n>]
 *
 * Default sessions dir is `~/.claude/projects/`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface Args {
  sessionsDir: string;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    sessionsDir: join(homedir(), ".claude", "projects"),
    limit: 50,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sessions-dir") {
      args.sessionsDir = argv[++i];
    } else if (a === "--limit") {
      args.limit = parseInt(argv[++i], 10) || args.limit;
    }
  }
  return args;
}

function listJsonlFilesRecursive(root: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(root, name);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      out.push(...listJsonlFilesRecursive(p));
    } else if (s.isFile() && p.endsWith(".jsonl")) {
      out.push(p);
    }
  }
  return out;
}

function aggregate(files: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of files) {
    let raw: string;
    try {
      raw = readFileSync(f, "utf-8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line) continue;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }
      const message = (json as { message?: unknown })?.message;
      const content = (message as { content?: unknown })?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          (block as { type?: unknown }).type === "tool_use"
        ) {
          const name = (block as { name?: unknown }).name;
          if (typeof name === "string") {
            counts.set(name, (counts.get(name) ?? 0) + 1);
          }
        }
      }
    }
  }
  return counts;
}

function main() {
  const { sessionsDir, limit } = parseArgs(process.argv.slice(2));
  const files = listJsonlFilesRecursive(sessionsDir);
  if (files.length === 0) {
    console.error(`No .jsonl files found under ${sessionsDir}`);
    process.exit(1);
  }
  const counts = aggregate(files);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, c]) => sum + c, 0);

  console.log(`# Tool name histogram`);
  console.log(`# scanned ${files.length} jsonl files in ${sessionsDir}`);
  console.log(`# ${total} tool_use blocks total\n`);
  console.log(`rank\tcount\tshare\ttool`);
  sorted.slice(0, limit).forEach(([name, count], i) => {
    const share = ((count / total) * 100).toFixed(2);
    console.log(`${i + 1}\t${count}\t${share}%\t${name}`);
  });
}

main();
