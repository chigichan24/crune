import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mock `@huggingface/transformers` so the production `createTransformersBackend`
 * is exercised WITHOUT loading the real (network-fetched) model. `pipeline` is a
 * controllable spy: tests script its resolution/rejection per call.
 */
const pipeline = vi.fn();
vi.mock("@huggingface/transformers", () => ({ pipeline }));

// Imported after the mock is registered.
const { createTransformersBackend } = await import(
  "../knowledge-graph/embedding-io.js"
);

/** A fake feature-extraction pipeline returning a fixed [batch, dim] tensor. */
function fakeExtractor(dim: number) {
  return Object.assign(
    async (texts: string[]) => ({
      // Mirror Transformers.js: an object exposing tolist() → number[][].
      tolist: () => texts.map(() => new Array(dim).fill(0.1)),
    }),
    {},
  );
}

beforeEach(() => {
  pipeline.mockReset();
});

describe("createTransformersBackend", () => {
  it("embed([]) returns [] WITHOUT loading the model", async () => {
    const backend = createTransformersBackend("some-model", 8);
    const out = await backend.embed([]);
    expect(out).toEqual([]);
    // The heavy pipeline must never be constructed for an empty batch.
    expect(pipeline).not.toHaveBeenCalled();
  });

  it("loads the model once and reuses it across embed() calls", async () => {
    pipeline.mockResolvedValue(fakeExtractor(8));
    const backend = createTransformersBackend("some-model", 8);

    const a = await backend.embed(["hello"]);
    const b = await backend.embed(["world"]);

    expect(a).toHaveLength(1);
    expect(a[0]).toBeInstanceOf(Float32Array);
    expect(b).toHaveLength(1);
    // Model materialized exactly once and reused.
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("retries the load after a first failure (a transient error is not poisoned)", async () => {
    pipeline
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(fakeExtractor(8));
    const backend = createTransformersBackend("some-model", 8);

    // First embed() rejects because the load failed.
    await expect(backend.embed(["hello"])).rejects.toThrow(/network down/);

    // A later call must RETRY the load (the rejected promise was not cached) and
    // succeed once the network recovers.
    const ok = await backend.embed(["hello again"]);
    expect(ok).toHaveLength(1);
    expect(pipeline).toHaveBeenCalledTimes(2);
  });
});
