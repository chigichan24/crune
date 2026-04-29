/**
 * Text tokenization for knowledge graph feature extraction.
 */

import { STOP_WORDS, UUID_PATTERN, HEX_PATTERN, NUM_PATTERN } from "./constants.js";

// CJK character ranges:
//   U+3040–U+309F  Hiragana
//   U+30A0–U+30FF  Katakana
//   U+3005, U+3007  Japanese ideographic iteration mark / ideographic number zero
//   U+4E00–U+9FFF  CJK Unified Ideographs
const CJK_CHAR_RE = /[々〇぀-ゟ゠-ヿ一-鿿]/;
const CJK_RUN_RE = /[々〇぀-ゟ゠-ヿ一-鿿]+/g;

// Lazily construct the segmenter once. `Intl.Segmenter` is built into Node 22+
// (the project's CI target) and is CLDR-backed; no extra dependency is needed.
let jaSegmenter: Intl.Segmenter | null = null;
function getJaSegmenter(): Intl.Segmenter | null {
  if (jaSegmenter) return jaSegmenter;
  if (typeof Intl === "undefined" || typeof Intl.Segmenter === "undefined") {
    return null;
  }
  jaSegmenter = new Intl.Segmenter("ja", { granularity: "word" });
  return jaSegmenter;
}

/**
 * Segment a Japanese (or otherwise CJK) run into word-like units.
 * Falls back to returning the original run as a single token when
 * `Intl.Segmenter` is unavailable.
 */
function segmentJapanese(run: string): string[] {
  const seg = getJaSegmenter();
  if (!seg) return [run];
  const out: string[] = [];
  for (const piece of seg.segment(run)) {
    if (piece.isWordLike) out.push(piece.segment);
  }
  return out;
}

export function splitCamelCase(word: string): string[] {
  return word
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .map((w) => w.toLowerCase());
}

export function extractPathTokens(text: string): string[] {
  const pathPattern = /(?:\/[\w.-]+){2,}/g;
  const tokens: string[] = [];
  let match;
  while ((match = pathPattern.exec(text)) !== null) {
    const segments = match[0].split("/").filter(Boolean);
    for (const seg of segments) {
      const name = seg.replace(/\.[^.]+$/, ""); // remove extension
      if (name.length > 2) {
        // Avoid `tokens.push(...arr)` — large arrays exceed V8's argument
        // count limit and throw RangeError.
        // See https://github.com/chigichan24/crune/issues/18
        for (const t of splitCamelCase(name)) tokens.push(t);
      }
    }
  }
  return tokens;
}

export function isNoiseToken(token: string): boolean {
  return (
    UUID_PATTERN.test(token) ||
    HEX_PATTERN.test(token) ||
    NUM_PATTERN.test(token) ||
    token.length > 40 // extremely long tokens are noise
  );
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];

  // Extract file path tokens first.
  // Avoid `tokens.push(...arr)` — large arrays exceed V8's argument
  // count limit and throw RangeError.
  // See https://github.com/chigichan24/crune/issues/18
  for (const t of extractPathTokens(text)) tokens.push(t);

  // Split on whitespace, punctuation, CJK boundaries
  const words = text
    .replace(/[`'"{}()[\]<>;:,!?@#$%^&*=+|\\~]/g, " ")
    .replace(/\//g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const word of words) {
    // Skip URLs and UUIDs
    if (word.startsWith("http")) continue;
    if (UUID_PATTERN.test(word)) continue;

    // Handle kebab-case and snake_case
    const parts = word.split(/[-_]/).filter(Boolean);
    for (const part of parts) {
      // If the part contains CJK characters, segment CJK runs with
      // Intl.Segmenter while keeping the existing English-side splitting
      // (CamelCase / kebab / snake) for the non-CJK portions. This fixes
      // the case where a Japanese paragraph collapses into a single token.
      // See https://github.com/chigichan24/crune/issues/29
      if (CJK_CHAR_RE.test(part)) {
        // Use `String.prototype.matchAll` rather than mutating the
        // module-scoped `CJK_RUN_RE.lastIndex`. `matchAll` returns a
        // fresh iterator each call, so the cursor is local to this
        // invocation and cannot be corrupted by re-entry.
        let cursor = 0;
        for (const m of part.matchAll(CJK_RUN_RE)) {
          const idx = m.index ?? 0;
          if (idx > cursor) {
            const nonCjk = part.slice(cursor, idx);
            for (const sub of splitCamelCase(nonCjk)) pushClean(sub, tokens);
          }
          for (const seg of segmentJapanese(m[0])) pushClean(seg, tokens);
          cursor = idx + m[0].length;
        }
        if (cursor < part.length) {
          const tail = part.slice(cursor);
          for (const sub of splitCamelCase(tail)) pushClean(sub, tokens);
        }
        continue;
      }

      // Pure non-CJK part: keep the existing CamelCase splitting path.
      for (const sub of splitCamelCase(part)) pushClean(sub, tokens);
    }
  }

  return tokens;
}

/**
 * Push a token through the standard post-processing pipeline:
 * lowercase, length filter, STOP_WORDS lookup, isNoiseToken check.
 *
 * The cleaning regex strips any leftover punctuation while preserving
 * ASCII alphanumerics and the CJK ranges we care about.
 *
 * Length rule:
 *  - non-CJK tokens: length > 2 (matches the legacy English-side behavior;
 *    drops "to", "is", "am", etc.)
 *  - pure-CJK tokens: length >= 2 (Japanese compounds such as
 *    bunseki / jissou / shusei are 2-character kanji words and must survive).
 */
function pushClean(token: string, sink: string[]): void {
  const clean = token.toLowerCase().replace(/[^a-z0-9\u3040-\u9fff]/g, "");
  if (clean.length === 0) return;
  const minLen = CJK_CHAR_RE.test(clean) ? 2 : 3;
  if (
    clean.length >= minLen &&
    !STOP_WORDS.has(clean) &&
    !isNoiseToken(clean)
  ) {
    sink.push(clean);
  }
}
