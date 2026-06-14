import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { mergeFeedbackPost } from "../skill-server.js";
import type { FeedbackEntry } from "../feedback-reader.js";

const tmpFiles: string[] = [];
function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crune-feedback-"));
  const file = path.join(dir, "feedback.json");
  tmpFiles.push(file);
  return file;
}

function entry(p: Partial<FeedbackEntry>): FeedbackEntry {
  return { sessionId: "s1", turnId: 0, bookmarked: false, tags: [], note: "", ...p };
}

function read(file: string): Record<string, FeedbackEntry[]> {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    fs.rmSync(path.dirname(f), { recursive: true, force: true });
  }
});

describe("mergeFeedbackPost (skill-server persistence)", () => {
  it("persists a session's entries as valid JSON on disk", async () => {
    const file = tmpFile();
    await mergeFeedbackPost("s1", [entry({ turnId: 2, bookmarked: true })], file);
    const blob = read(file);
    expect(blob.s1).toHaveLength(1);
    expect(blob.s1[0]).toMatchObject({ sessionId: "s1", turnId: 2, bookmarked: true });
  });

  it("drops empty (signal-less) entries on the way in", async () => {
    const file = tmpFile();
    await mergeFeedbackPost("s1", [entry({ turnId: 0, note: "   " })], file);
    expect(fs.existsSync(file)).toBe(true);
    expect(read(file).s1).toBeUndefined();
  });

  it("an empty entries array clears that session's bucket", async () => {
    const file = tmpFile();
    await mergeFeedbackPost("s1", [entry({ turnId: 1, bookmarked: true })], file);
    await mergeFeedbackPost("s1", [], file);
    expect(read(file).s1).toBeUndefined();
  });

  it("serializes concurrent posts for different sessions without lost updates", async () => {
    const file = tmpFile();
    await Promise.all([
      mergeFeedbackPost("a", [entry({ sessionId: "a", turnId: 0, bookmarked: true })], file),
      mergeFeedbackPost("b", [entry({ sessionId: "b", turnId: 0, bookmarked: true })], file),
      mergeFeedbackPost("c", [entry({ sessionId: "c", turnId: 0, bookmarked: true })], file),
    ]);
    const blob = read(file);
    expect(Object.keys(blob).sort()).toEqual(["a", "b", "c"]);
  });
});
