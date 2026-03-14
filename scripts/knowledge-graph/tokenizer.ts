/**
 * Text tokenization for knowledge graph feature extraction.
 */

import { STOP_WORDS, UUID_PATTERN, HEX_PATTERN, NUM_PATTERN } from "./constants.js";

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
        tokens.push(...splitCamelCase(name));
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

  // Extract file path tokens first
  tokens.push(...extractPathTokens(text));

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
      // Split CamelCase
      const subTokens = splitCamelCase(part);
      for (const t of subTokens) {
        const clean = t.toLowerCase().replace(/[^a-z0-9\u3040-\u9fff]/g, "");
        if (
          clean.length > 2 &&
          !STOP_WORDS.has(clean) &&
          !isNoiseToken(clean)
        ) {
          tokens.push(clean);
        }
      }
    }
  }

  return tokens;
}
