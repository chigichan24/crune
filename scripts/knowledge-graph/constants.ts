/**
 * Constants for knowledge graph construction.
 */

// ─── Stop words ─────────────────────────────────────────────────────────────

export const STOP_WORDS = new Set([
  // English
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must", "ought",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "its", "our", "their", "mine",
  "yours", "hers", "ours", "theirs", "this", "that", "these", "those",
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
  "all", "each", "every", "both", "few", "more", "most", "other", "some",
  "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too",
  "very", "just", "because", "as", "until", "while", "of", "at", "by",
  "for", "with", "about", "against", "between", "through", "during",
  "before", "after", "above", "below", "to", "from", "up", "down", "in",
  "out", "on", "off", "over", "under", "again", "further", "then", "once",
  "here", "there", "and", "but", "or", "if", "else", "also", "like",
  "please", "thanks", "thank", "yes", "no", "ok", "okay", "sure", "let",
  "make", "use", "using", "used", "want", "see", "look", "try", "get",
  "got", "think", "know", "now", "new", "way", "well", "back", "still",
  "file", "code", "change", "changes", "add", "update", "fix", "set",
  // Japanese particles and common words
  "の", "に", "は", "を", "が", "で", "と", "も", "か", "な", "だ",
  "です", "ます", "する", "した", "して", "ない", "ある", "いる",
  "これ", "それ", "あれ", "この", "その", "あの", "ここ", "そこ",
  "こと", "もの", "ため", "よう", "から", "まで", "より", "ほど",
  "など", "ので", "けど", "でも", "しかし", "また", "そして",
  "って", "という", "ください", "お願い", "確認",
]);

// ─── Noise token patterns ───────────────────────────────────────────────────

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HEX_PATTERN = /^[0-9a-f]{6,}$/i;
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
