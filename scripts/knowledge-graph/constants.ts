/**
 * Constants for knowledge graph construction.
 */

// ─── Stop words ─────────────────────────────────────────────────────────────

export const STOP_WORDS = new Set([
  // English — roughly NLTK English stop word parity (~180 entries) plus a
  // small project-specific filler set ("file", "code", "change") that NLTK
  // does not include but which carry no signal in this corpus.
  // Issue #30: expanded from ~100 entries to NLTK parity to keep IDF weights
  // tight on substantive vocabulary.
  "a", "about", "above", "after", "again", "against", "ain", "all", "also",
  "am", "an", "and", "any", "are", "aren", "as", "at", "back", "be",
  "because", "been", "before", "being", "below", "between", "both", "but",
  "by", "can", "could", "couldn", "did", "didn", "do", "does", "doesn",
  "doing", "don", "down", "during", "each", "else", "even", "ever", "every",
  "few", "for", "from", "further", "get", "give", "go", "going", "got",
  "had", "hadn", "has", "hasn", "have", "haven", "having", "he", "her",
  "here", "hers", "herself", "him", "himself", "his", "how", "i", "if",
  "in", "into", "is", "isn", "it", "its", "itself", "just", "know", "let",
  "like", "look", "ma", "make", "many", "may", "me", "might", "mightn",
  "mine", "more", "most", "much", "must", "mustn", "my", "myself", "need",
  "needn", "new", "no", "nor", "not", "now", "of", "off", "ok", "okay",
  "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves",
  "out", "over", "own", "please", "really", "right", "s", "same", "say",
  "see", "seem", "seen", "shall", "shan", "she", "should", "shouldn", "so",
  "some", "still", "such", "sure", "t", "tell", "than", "thank", "thanks",
  "that", "the", "their", "theirs", "them", "themselves", "then", "there",
  "these", "they", "thing", "think", "this", "those", "through", "to",
  "too", "try", "under", "until", "up", "us", "use", "used", "using",
  "very", "want", "was", "wasn", "way", "we", "well", "were", "weren",
  "what", "when", "where", "which", "while", "who", "whom", "whose", "why",
  "will", "with", "won", "would", "wouldn", "y", "yeah", "yes", "you",
  "your", "yours", "yourself", "yourselves",
  // Project-specific filler tokens (not part of NLTK). They appear in nearly
  // every Claude Code session and dilute the TF-IDF signal.
  "file", "code", "change", "changes", "add", "update", "fix", "set",
  // Japanese particles and common words
  "の", "に", "は", "を", "が", "で", "と", "も", "か", "な", "だ",
  "です", "ます", "する", "した", "して", "ない", "ある", "いる",
  "これ", "それ", "あれ", "この", "その", "あの", "ここ", "そこ",
  "こと", "もの", "ため", "よう", "から", "まで", "より", "ほど",
  "など", "ので", "けど", "でも", "しかし", "また", "そして",
  "って", "という", "ください", "お願い", "確認",
  // Verb conjugation fragments and connective auxiliaries that
  // `Intl.Segmenter('ja')` emits as standalone segments. These carry no
  // standalone signal for TF-IDF / clustering. Content-bearing stems such
  // as 行う / 書く / 修正 are intentionally NOT listed here.
  // See https://github.com/chigichan24/crune/issues/29
  "ている", "てい", "しない", "次に", "に従って",
]);

// ─── Noise token patterns ───────────────────────────────────────────────────

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Hex literal must contain at least one digit. Without the lookahead this
// regex would also match plain English words built only from a-f (e.g.
// "decade", "facade", "effect", "defaced") and incorrectly drop them as
// noise. See https://github.com/chigichan24/crune/issues/30.
export const HEX_PATTERN = /^(?=[0-9a-f]*[0-9])[0-9a-f]{6,}$/i;
export const NUM_PATTERN = /^\d+$/;

// ─── Structural features ────────────────────────────────────────────────────

export const STRUCTURAL_DIM = 7;

// ─── Feature weights ────────────────────────────────────────────────────────

export const WEIGHT_TEXT = 0.50;
export const WEIGHT_TOOL = 0.25;
export const WEIGHT_STRUCT = 0.25;

// ─── Action verbs ───────────────────────────────────────────────────────────

export const ACTION_VERBS_EN = new Set([
  "fix", "add", "implement", "create", "update", "refactor", "remove",
  "delete", "move", "rename", "test", "debug", "optimize", "migrate",
  "deploy", "configure", "setup", "integrate", "build", "review",
  "investigate", "analyze", "check", "resolve", "extract", "convert",
]);

export const ACTION_VERBS_JA: [RegExp, string][] = [
  [/修正/, "fix"], [/追加/, "add"], [/実装/, "implement"],
  [/作成|作って/, "create"], [/更新/, "update"], [/リファクタ/, "refactor"],
  [/削除/, "remove"], [/テスト/, "test"], [/デバッグ/, "debug"],
  [/最適化/, "optimize"], [/移行|マイグレ/, "migrate"],
  [/設定|セットアップ/, "configure"], [/統合/, "integrate"],
  [/ビルド/, "build"], [/レビュー/, "review"], [/調査/, "investigate"],
  [/確認|チェック/, "check"], [/解決/, "resolve"],
];
