/**
 * Porter stemmer (Porter 1980 — original algorithm).
 *
 * Inline implementation, ~70 LoC of substantive logic. We deliberately avoid
 * pulling in `natural` / `stemmer` to keep the dependency footprint flat
 * (the data pipeline is shipped as a CLI binary; transitive deps cost startup
 * time and lockfile noise).
 *
 * Reference: M.F. Porter, "An algorithm for suffix stripping",
 * Program 14(3), 130-137 (1980).
 *
 * Usage caveats inside this codebase:
 *  - Apply only to non-CJK tokens. Tokens containing CJK characters come from
 *    `Intl.Segmenter` and stemming would corrupt them.
 *  - The tokenizer already drops tokens of length <= 2, so very short inputs
 *    like `"by"` never reach this function. We still guard with `length > 2`
 *    here so the module is safe to call standalone.
 */

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

function isConsonant(word: string, i: number): boolean {
  const ch = word[i];
  if (VOWELS.has(ch)) return false;
  if (ch === "y") {
    if (i === 0) return true;
    return !isConsonant(word, i - 1);
  }
  return true;
}

/**
 * Measure `m` of a stem: the number of (vowel-sequence)(consonant-sequence)
 * groups, ignoring leading consonants and trailing vowels. This is the
 * standard Porter `[C](VC){m}[V]` count.
 */
function measure(stem: string): number {
  let m = 0;
  let i = 0;
  const n = stem.length;
  // skip leading consonants
  while (i < n && isConsonant(stem, i)) i++;
  while (i < n) {
    // we are at a vowel; consume the vowel run
    while (i < n && !isConsonant(stem, i)) i++;
    if (i >= n) break;
    // we are at a consonant; one VC pair complete
    m++;
    while (i < n && isConsonant(stem, i)) i++;
  }
  return m;
}

function hasVowel(stem: string): boolean {
  for (let i = 0; i < stem.length; i++) {
    if (!isConsonant(stem, i)) return true;
  }
  return false;
}

function endsWithDoubleConsonant(stem: string): boolean {
  const n = stem.length;
  if (n < 2) return false;
  if (stem[n - 1] !== stem[n - 2]) return false;
  return isConsonant(stem, n - 1);
}

/** CVC pattern at end where final C is not w/x/y. Used by step1b/step5. */
function endsCvc(stem: string): boolean {
  const n = stem.length;
  if (n < 3) return false;
  if (!isConsonant(stem, n - 1)) return false;
  if (isConsonant(stem, n - 2)) return false;
  if (!isConsonant(stem, n - 3)) return false;
  const last = stem[n - 1];
  if (last === "w" || last === "x" || last === "y") return false;
  return true;
}

function endsWith(word: string, suffix: string): boolean {
  return word.length >= suffix.length && word.endsWith(suffix);
}

function replaceSuffix(word: string, suffix: string, replacement: string): string {
  return word.slice(0, word.length - suffix.length) + replacement;
}

/** Step 1a: plurals. */
function step1a(word: string): string {
  if (endsWith(word, "sses")) return replaceSuffix(word, "sses", "ss");
  if (endsWith(word, "ies")) return replaceSuffix(word, "ies", "i");
  if (endsWith(word, "ss")) return word;
  if (endsWith(word, "s")) return word.slice(0, -1);
  return word;
}

/** Step 1b: past tense / -ing. */
function step1b(word: string): string {
  if (endsWith(word, "eed")) {
    const stem = word.slice(0, -3);
    if (measure(stem) > 0) return stem + "ee";
    return word;
  }
  let stem: string | null = null;
  let stripped = word;
  if (endsWith(word, "ed")) {
    const candidate = word.slice(0, -2);
    if (hasVowel(candidate)) {
      stem = candidate;
      stripped = candidate;
    }
  } else if (endsWith(word, "ing")) {
    const candidate = word.slice(0, -3);
    if (hasVowel(candidate)) {
      stem = candidate;
      stripped = candidate;
    }
  }
  if (stem === null) return word;
  // step 1b post: add `e` for at/bl/iz; collapse double consonants except l/s/z;
  // restore `e` when stem is short and ends CVC.
  if (
    endsWith(stripped, "at") ||
    endsWith(stripped, "bl") ||
    endsWith(stripped, "iz")
  ) {
    return stripped + "e";
  }
  if (endsWithDoubleConsonant(stripped)) {
    const last = stripped[stripped.length - 1];
    if (last !== "l" && last !== "s" && last !== "z") {
      return stripped.slice(0, -1);
    }
    return stripped;
  }
  if (measure(stripped) === 1 && endsCvc(stripped)) {
    return stripped + "e";
  }
  return stripped;
}

/** Step 1c: y -> i when there is a vowel in the stem. */
function step1c(word: string): string {
  if (endsWith(word, "y") && word.length > 1 && hasVowel(word.slice(0, -1))) {
    return word.slice(0, -1) + "i";
  }
  return word;
}

const STEP2_RULES: [string, string][] = [
  ["ational", "ate"],
  ["tional", "tion"],
  ["enci", "ence"],
  ["anci", "ance"],
  ["izer", "ize"],
  ["bli", "ble"],
  ["alli", "al"],
  ["entli", "ent"],
  ["eli", "e"],
  ["ousli", "ous"],
  ["ization", "ize"],
  ["ation", "ate"],
  ["ator", "ate"],
  ["alism", "al"],
  ["iveness", "ive"],
  ["fulness", "ful"],
  ["ousness", "ous"],
  ["aliti", "al"],
  ["iviti", "ive"],
  ["biliti", "ble"],
  ["logi", "log"],
];

const STEP3_RULES: [string, string][] = [
  ["icate", "ic"],
  ["ative", ""],
  ["alize", "al"],
  ["iciti", "ic"],
  ["ical", "ic"],
  ["ful", ""],
  ["ness", ""],
];

const STEP4_SUFFIXES = [
  "al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement", "ment",
  "ent", "sion", "tion", "ou", "ism", "ate", "iti", "ous", "ive", "ize",
];

function applyRules(word: string, rules: [string, string][]): string {
  for (const [suffix, replacement] of rules) {
    if (endsWith(word, suffix)) {
      const stem = word.slice(0, word.length - suffix.length);
      if (measure(stem) > 0) {
        return stem + replacement;
      }
      return word;
    }
  }
  return word;
}

function step4(word: string): string {
  for (const suffix of STEP4_SUFFIXES) {
    if (endsWith(word, suffix)) {
      const stem = word.slice(0, word.length - suffix.length);
      if (measure(stem) > 1) {
        // sion/tion only strip when preceded by `s` or `t`
        if (suffix === "sion" || suffix === "tion") {
          const last = stem[stem.length - 1];
          if (last === "s" || last === "t") return stem;
          return word;
        }
        return stem;
      }
      return word;
    }
  }
  return word;
}

function step5a(word: string): string {
  if (!endsWith(word, "e")) return word;
  const stem = word.slice(0, -1);
  const m = measure(stem);
  if (m > 1) return stem;
  if (m === 1 && !endsCvc(stem)) return stem;
  return word;
}

function step5b(word: string): string {
  if (
    measure(word) > 1 &&
    endsWithDoubleConsonant(word) &&
    word.endsWith("l")
  ) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Stem a single English token. Lowercase ASCII input expected; tokens shorter
 * than 3 chars are returned unchanged (Porter is unstable on very short words
 * and our pipeline already filters them).
 */
export function porterStem(word: string): string {
  if (word.length <= 2) return word;
  let w = word;
  w = step1a(w);
  w = step1b(w);
  w = step1c(w);
  w = applyRules(w, STEP2_RULES);
  w = applyRules(w, STEP3_RULES);
  w = step4(w);
  w = step5a(w);
  w = step5b(w);
  return w;
}
