# CLAUDE.md

## Project Overview

crune is a static web dashboard that visualizes Claude Code session logs. It consists of two parts:

1. **Data pipeline** (`scripts/analyze-sessions.ts` + `scripts/knowledge-graph-builder.ts`): Reads JSONL session files, extracts structured data, builds a semantic knowledge graph, and outputs JSON files to `public/data/sessions/`.
2. **Frontend** (`src/`): React SPA that loads the generated JSON and renders three views --- Overview, Session Playback, and Knowledge Graph.

## Build & Run

```bash
npm install
npm run analyze-sessions   # Generate data from ~/.claude/projects/
npm run dev                # Vite dev server at localhost:5173
npm run build              # tsc -b && vite build -> dist/
npm run lint               # ESLint
npm run skill-server       # Local synthesis server at localhost:3456
npm run dev:full           # skill-server + Vite dev server together
```

## Architecture

- **No routing library** --- `App.tsx` manages view state via `useState<ViewMode>` (overview | playback | knowledge)
- **No state management library** --- Data flows through props from `App.tsx` down. Each view fetches its own data via custom hooks (`useSessionIndex`, `useSessionDetail`, `useSessionOverview`)
- **Plain CSS** --- Each component has a co-located `.css` file. Global CSS variables are in `src/index.css` (colors, fonts, shadows)
- **Session playback** opens as a right-side drawer overlay, not a separate route

## Key Conventions

- UI text is in Japanese (commit `abc92e1`)
- Color variables have semantic roles: `--accent` (amber, interactive), `--brand` (amber, logo only — unified with accent), `--success/warning/danger` (status), `--chart-1..6` (data visualization)
- Tool call display logic is centralized in `ToolCallBlock.tsx` with per-tool rendering (Bash, Edit, Write, Read, Grep, Glob, Agent)
- Expand/collapse pattern: `useState(false)` + conditional render (no animation), see `SubagentBranch.tsx`

## Data Pipeline Details

`analyze-sessions.ts` reads from `~/.claude/projects/` by default. Override with `--sessions-dir` and `--output-dir` flags.

Before analysis, `/insights` is automatically executed via `claude -p` to refresh facets data in `~/.claude/usage-data/facets/`. Use `--skip-facets` to skip this step.

Output structure:
```
public/data/sessions/
  index.json              # All sessions (sorted by createdAt desc)
  overview.json           # Cross-session stats + knowledge graph + tacit knowledge
  detail/{sessionId}.json # Individual session turns, subagents, linked plan
```

The knowledge graph builder (`knowledge-graph-builder.ts`) uses a multi-signal embedding approach:
- Text TF-IDF (weight 0.50) + Tool-IDF (weight 0.25) + structural features (weight 0.25), concatenated with sqrt-weighting
- Truncated SVD via Gram matrix power iteration (k = min(80, max(20, m/4)))
- Agglomerative clustering (average linkage) with elbow-detected threshold + oversized cluster splitting + **facets-based narrow cluster merging**
- Louvain community detection -> Brandes betweenness centrality
- See [docs/knowledge-graph-algorithm.md](docs/knowledge-graph-algorithm.md) for full details

### /insights Integration

The pipeline reads `/insights` facets data (`~/.claude/usage-data/facets/`) to improve accuracy:
- **Topic labels**: Uses `underlying_goal` from facets instead of TF-IDF keywords when available
- **Narrow cluster merging**: Merges small clusters (≤2 sessions) that share normalized goal categories
- **Reusability scoring**: Adds `successRate` and `helpfulness` signals (weight 0.10 each) derived from `outcome` and `claude_helpfulness`
- **Synthesis prompt enrichment**: Includes goals, friction details, and success rate in the LLM synthesis prompt
- **Session list**: Shows `brief_summary` from facets instead of raw first user prompt

Facets reader (`scripts/knowledge-graph/facets-reader.ts`) normalizes 50+ raw goal categories into ~10 canonical categories (feature, bugfix, refactoring, documentation, review, testing, ci, git_ops, setup, other).

## Skill Synthesis

The pipeline detects recurring workflow patterns and generates reusable Claude Code skill definitions using LLM synthesis via `claude -p`.

### Pre-synthesis (build time)

`analyze-sessions` automatically synthesizes the top skill candidates during data generation:

```bash
npm run analyze-sessions                              # Top 5 candidates, default model
npm run analyze-sessions -- --synthesize-model haiku     # Use Haiku for speed
npm run analyze-sessions -- --synthesize-count 3         # Distill only top 3
npm run analyze-sessions -- --skip-synthesize            # Skip synthesis entirely
```

Flags:
- `--synthesize-model <model>` --- Use a specific Claude model (e.g. `haiku`, `sonnet`, `opus`)
- `--synthesize-count <n>` --- Number of top candidates to synthesize (default: 5)
- `--skip-synthesize` --- Skip LLM synthesis for faster builds
- `--facets-dir <path>` --- Custom facets directory (default: `~/.claude/usage-data/facets`)
- `--skip-facets` --- Skip `/insights` refresh and facets integration
- `--use-human-feedback` --- Fold playback feedback (issue #24) into synthesis + reusability scoring (default OFF for A/B)
- `--feedback-file <path>` --- Custom feedback file (default `public/data/feedback.json`)

Pre-synthesized results are stored in `overview.json` as `synthesizedMarkdown` on each `SkillCandidate` and displayed immediately in the Knowledge Graph UI. Synthesis output is post-processed by `stripSynthesisPreamble()` to remove any LLM preamble before the YAML frontmatter.

Synthesis calls use `--no-session-persistence` to prevent creating spurious JSONL session files.

### On-demand re-synthesis

The UI provides a "再合成" button for on-demand re-synthesis with full graph context (connected topics, community, centrality). Synthesis state resets automatically when the selected topic changes. This requires the local skill server:

```bash
npm run dev:full    # Runs skill-server + Vite dev server
```

The skill server (`scripts/skill-server.ts`) accepts POST requests at `/api/synthesize` and calls `claude -p` with the enriched prompt including graph context.

### Skill Evaluation (issue #20)

After a candidate is synthesized, `analyze-sessions` evaluates the generated SKILL.md via `scripts/skill-evaluator.ts` and persists the result onto `SkillCandidate.evaluation` (serialized into `overview.json`). Evaluation is gated behind synthesis **success** so heuristic `skillMarkdown` is never scored.

Three layers (`evaluateSkill`):
1. **Structural validation** --- deterministic zod-backed YAML frontmatter checks (name kebab-case, description length, body present). Always runs locally.
2. **LLM rubric** --- `claude -p` scores the skill 0-100 across nameQuality / descriptionTriggering / instructionsConcrete / noPreambleNoise (25 each). Runs unless `--skip-eval`.
3. **Smoke firing** --- stubbed (deferred to a follow-up issue); always reports `skipped: true`.

`overallScore` = 50 for structural pass + scaled rubric (0-50). `toSkillEvaluation()` strips the raw LLM response and intermediate parse before persistence.

Flags (next to the `--synthesize-*` flags, eval defaults **ON**):
- `--skip-eval` --- Skip the LLM rubric (structural-only).
- `--eval-model <model>` --- Claude model for rubric scoring (e.g. `haiku`).
- `--eval-threshold <n>` --- Soft threshold (default 60). When `overallScore < n`, the pipeline runs **exactly one** bounded re-synthesis retry and keeps the higher-scoring attempt. The candidate is never dropped; low scores are flagged in the UI. `--eval-threshold 0` disables retries. The retry decision is the pure function `shouldRetrySynthesis(score, threshold)`.

**UI badge**: When `candidate.evaluation` exists, `KnowledgeNodeDetail` and `TacitKnowledgeView` render a compact評価バッジ --- 構造 OK/NG, スコア NN/100, optional rubric内訳, and 改善ヒント list. Pass/borderline/fail tone uses `--success`/`--warning`/`--danger` (pass ≥70, borderline ≥50, fail otherwise or structural NG).

## RAG Embedding Pipeline (issue #32, opt-in)

A chunk-level dense vector index for retrieval, alongside (not replacing) the whole-session embedding path in `scripts/knowledge-graph/`. PoC findings + Go/Hold/Pivot recommendation are in [docs/rag-poc.md](docs/rag-poc.md) (issue #35).

Modules (`scripts/knowledge-graph/`):
- `embedder.ts` --- `EmbeddingBackend` interface (injectable; tests use a deterministic fake, no network), turn-level chunk extraction (`extractChunks`: `userPrompt + assistantTexts + tool names` per turn), int8 `quantize`/`dequantize` (L2-normalized components → `[-127,127]`, scale `1/127`, bounded round-trip error), and `embedSessions` orchestration.
- `embedding-io.ts` --- `writeEmbeddingIndex`/`readEmbeddingIndex` (`public/data/embeddings/index.bin` row-major int8 + `meta.json`) and `createTransformersBackend` (lazy-loaded Transformers.js, `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, 384-dim, mean pooling + normalize). Kept separate so tests never import `@huggingface/transformers`.
- `retriever.ts` --- hybrid `createRetriever`/`createRetrieverFromIndex`: dense cosine (dequantized) + sparse BM25 (reuses `buildBm25`), per-query min-max normalized, blended `alpha*dense + (1-alpha)*bm25` (default `alpha=0.6`), with a per-session diversification cap (default 2). `retrieve(query, k, opts)` returns `RetrievedChunk[]`.

Flags on `analyze-sessions` (default **OFF**, promotion gated on the PoC):
- `--embed` --- run the embedder over analyzed sessions and write `public/data/embeddings/`.
- `--embed-model <id>` --- override the default model.

PoC harness: `npx tsx scripts/rag-poc.ts` (measures footprint / throughput / latency + A/B; `--fake` forces the no-network backend).

### Retrieval-enriched synthesis (issue #33, opt-in)

`--retrieval-context` (on both `analyze-sessions` and the `crune` CLI, default **OFF** for clean A/B) swaps the loosely-related cluster-blob "examples" slot (Representative User Prompts + Enriched Tool Patterns) for a **Retrieved Relevant Moments** section built from the hybrid retriever's top-k turn snippets (k=8). The rest of the synthesis prompt (frontmatter ask, topic info, graph position, human-flagged moments, heuristic reference) is unchanged.

- **Query** per candidate: `buildRetrievalQuery(candidate, topic)` = topic label + top keywords + truncated heuristic `skillMarkdown` (600 chars). Pure/testable.
- **Section**: `buildRetrievedMomentsSection(chunks)` renders `[sessionId#turnIndex] (score: N.NNN) snippet`; `SynthesisRequest.retrievedContext?: RetrievedChunk[]` threads it into `buildSynthesisPrompt`. When present and non-empty, the blob slots are suppressed and a numbered task rule grounds the skill in the retrieved moments.
- **Retriever wiring** (`buildSynthesisRetriever`, shared via `scripts/knowledge-graph/synthesis-retriever.ts`): reuse the EmbedResult from `--embed` if it ran this run → else read an on-disk index at `public/data/embeddings/` → else embed fresh in-memory via `createTransformersBackend` + `embedSessions`. Index reuse is gated on per-chunk `sessionId`/`turnIndex` identity (`chunksAlign`), not just count, so a stale index can't ground synthesis on unrelated sessions. BM25 text is re-derived with `extractChunks` (same chunk order as the index). On any failure (no index, no backend) it logs a warning and returns `null` so synthesis FALLS BACK to the cluster blob (never crashes).
- **Preview A/B** (`crune --preview --retrieval-context`): the synthesis loop prints `Context strategy: retrieval (N moments)` vs `cluster blob` per candidate so a human can compare side by side.
- **Measurement**: the #20 evaluator path (`overallScore`) is unchanged — run `--retrieval-context` vs without and compare `SkillCandidate.evaluation.overallScore` to A/B synthesis quality. Tests inject a fake `EmbeddingBackend`/in-memory retriever; the `claude -p` call stays behind the `synthesizeWithClaude` seam (never invoked in tests).

### Semantic Search UI (issue #34)

The chunk index powers a UI semantic search and a "似た瞬間" bookmark affordance, served by the skill-server.

- **Endpoint**: `POST /api/retrieve` (`scripts/skill-server.ts`, proxied by `vite.config.ts`). Body `{ query, k? }` → `{ results: RetrievedChunk[] }`. The on-disk index is resolved lazily by `createLazyRetrieverProvider` (`scripts/retrieve-service.ts`); a **successful** retriever is memoized ONCE and reused (the model is never reloaded per request), while negative resolutions are NOT cached so a server started before `--embed` ran recovers once the index appears — no restart. The provider builds the embedding backend from the loaded index's own `meta.model`/`meta.dim` (via an injected `BackendFactory`) so query vectors always match the chunk vectors even when the index was embedded with `--embed-model`. Resolution distinguishes an ABSENT index (**400** `{error:'no embedding index; run analyze-sessions --embed'}`) from a CORRUPT/unreadable one (**503**, logged via `console.error`), so the UI degrades gracefully without telling the user to re-run a command that won't help. The pure `handleRetrieveRequest` is unit-tested with an injected `RetrieverResolution`.
- **BM25 fallback**: `meta.json` persists only the short snippet, so BM25 runs over snippets as a documented degraded fallback; dense cosine (alpha=0.6) remains the primary signal.
- **Hook**: `src/hooks/useSemanticSearch.ts` — debounced (`SEARCH_DEBOUNCE_MS`) best-effort POST; pure `mapRetrieveResponse(ok, body, status)` maps the HTTP status (503 → "モデル準備中", 404 → "検索未対応", else generic) and pure `runSearchRequest` encapsulates the stale-response guard — both tested without a DOM.
- **UI**: `SemanticSearch` bar on the Overview dashboard (`src/components/search/`); clicking a result opens the playback drawer at the matched turn via an optional `turnIndex` on `onSessionSelect` (App → `SessionPlayback initialTurnIndex`). On a bookmarked turn, `FeedbackCluster` shows a 🔍 "このブックマークに似た瞬間" popover (`SimilarMoments`) that searches with the turn's text and deep-links similar moments.
- **Static-deploy note**: in-browser retrieval (loading the ~93KB quantized index + a WASM embedder) is a viable follow-up; the current PoC routes through the local server.

## Session Summarization

セッション一覧の `firstUserPrompt` フィールドは、facetsデータが利用可能な場合は `/insights` の `brief_summary`（LLM生成の要約）で置き換えられる。facetsがないセッションは従来通り最初のユーザープロンプトを表示する。

`scripts/session-summarizer.ts` generates per-session summaries locally without LLM, using plan mode prompts as the primary source.

Algorithm:
1. Collect all user prompts from plan mode turns (fallback: all user prompts)
2. Select representative prompt via Jaccard centrality with position weighting (`1/(1+index)`)
3. Extract top-5 keywords via tokenizer + stopword filtering
4. Classify `workType` from tool histogram:
   - `investigation` --- Read/Grep/Glob dominant (70%+)
   - `implementation` --- Edit/Write dominant (40%+)
   - `debugging` --- Bash dominant (40%+) with some writes
   - `planning` --- plan mode with few turns and no writes
5. Compute `scope` from longest common directory prefix of edited files

Output fields on `SessionSummary`: `summaryText`, `keywords`, `scope`, `workType`

## Type Definitions

All domain types are in `src/types/session.ts`. Key types:
- `SessionIndex`, `SessionSummary` --- session list (includes `summaryText`, `keywords`, `scope`, `workType`)
- `SessionDetail`, `ConversationTurn`, `AssistantBlock` --- playback data
- `KnowledgeGraph`, `TopicNode`, `TopicEdge` --- graph data
- `ReusabilityScore` --- includes `successRate?` and `helpfulness?` (facets-derived, optional)
- `SkillCandidate` --- includes `skillMarkdown` (heuristic), `synthesizedMarkdown` (LLM-synthesized), and `evaluation` (`SkillEvaluation`, issue #20)
- `SkillEvaluation` --- persisted evaluation: `structural`, optional `rubric`, optional `smokeFiring` (stub), `overallScore`
- `GraphContext`, `ConnectedTopicInfo` --- graph context for synthesis
- `TacitKnowledge`, `WorkflowPattern` --- extracted insights

Pipeline-internal types in `scripts/knowledge-graph/types.ts`:
- `FacetsData` --- parsed `/insights` facets data per session
- `FacetsInsightsSummary` --- aggregated facets for a topic (goals, categories, success rate, frictions)

## Human Feedback (issue #24)

Playback feedback (bookmark / tag / note, issue #23) is fed into skill synthesis as a human signal.

**Persistence bridge**: localStorage (`crune.feedback.v1`) stays the offline source of truth. The UI best-effort POSTs each session's entries to the skill-server (`POST /api/feedback`, fire-and-forget via `src/components/playback/feedback/feedbackSync.ts`), which merges them into `public/data/feedback.json` (`GET /api/feedback` reads it back). The offline pipeline reads that file via `scripts/feedback-reader.ts`.

**Meaningful tags** (free-text otherwise; constants in `src/components/playback/feedback/tagSemantics.ts` and mirrored in `scripts/feedback-reader.ts`):
- `reusable` --- this turn is VALUABLE evidence to replicate in a skill.
- `anti-pattern` --- this turn is a counter-example; skills should avoid it.

Both are surfaced first in the `TagInput` datalist.

**Synthesis** (gated behind `--use-human-feedback`, default OFF for A/B): `buildSynthesisPrompt` adds a "Human-Flagged Moments" section listing bookmarked turns, `reusable` turns marked as evidence to replicate, and `anti-pattern` turns marked as counter-examples to avoid. `--feedback-file <path>` overrides the default `public/data/feedback.json`.

**Reusability score**: an optional `humanSignal` term (`ReusabilityScore.humanSignal`, weight 0.10) boosts clusters with bookmarks/`reusable` tags and dampens for `anti-pattern`, folded in alongside `successRate`/`helpfulness`.
