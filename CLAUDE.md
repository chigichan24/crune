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
npm run skill-server       # Local distillation server at localhost:3456
npm run dev:full           # skill-server + Vite dev server together
```

## Architecture

- **No routing library** --- `App.tsx` manages view state via `useState<ViewMode>` (overview | playback | knowledge)
- **No state management library** --- Data flows through props from `App.tsx` down. Each view fetches its own data via custom hooks (`useSessionIndex`, `useSessionDetail`, `useSessionOverview`)
- **Plain CSS** --- Each component has a co-located `.css` file. Global CSS variables are in `src/index.css` (colors, fonts, shadows)
- **Session playback** opens as a right-side drawer overlay, not a separate route

## Key Conventions

- UI text is in Japanese (commit `abc92e1`)
- Color variables have semantic roles: `--accent` (blue, interactive), `--brand` (purple, logo only), `--success/warning/danger` (status), `--chart-1..6` (data visualization)
- Tool call display logic is centralized in `ToolCallBlock.tsx` with per-tool rendering (Bash, Edit, Write, Read, Grep, Glob, Agent)
- Expand/collapse pattern: `useState(false)` + conditional render (no animation), see `SubagentBranch.tsx`

## Data Pipeline Details

`analyze-sessions.ts` reads from `~/.claude/projects/` by default. Override with `--sessions-dir` and `--output-dir` flags.

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
- Agglomerative clustering (average linkage) with elbow-detected threshold + oversized cluster splitting
- Louvain community detection -> Brandes betweenness centrality
- See [docs/knowledge-graph-algorithm.md](docs/knowledge-graph-algorithm.md) for full details

## Skill Distillation

The pipeline detects recurring workflow patterns and generates reusable Claude Code skill definitions using LLM distillation via `claude -p`.

### Pre-distillation (build time)

`analyze-sessions` automatically distills the top skill candidates during data generation:

```bash
npm run analyze-sessions                              # Top 5 candidates, default model
npm run analyze-sessions -- --distill-model haiku     # Use Haiku for speed
npm run analyze-sessions -- --distill-count 3         # Distill only top 3
npm run analyze-sessions -- --skip-distill            # Skip distillation entirely
```

Flags:
- `--distill-model <model>` --- Use a specific Claude model (e.g. `haiku`, `sonnet`, `opus`)
- `--distill-count <n>` --- Number of top candidates to distill (default: 5)
- `--skip-distill` --- Skip LLM distillation for faster builds

Pre-distilled results are stored in `overview.json` as `distilledMarkdown` on each `SkillCandidate` and displayed immediately in the Knowledge Graph UI.

### On-demand re-distillation

The UI provides a "再蒸留" button for on-demand re-distillation with full graph context (connected topics, community, centrality). This requires the local skill server:

```bash
npm run dev:full    # Runs skill-server + Vite dev server
```

The skill server (`scripts/skill-server.ts`) accepts POST requests at `/api/distill` and calls `claude -p` with the enriched prompt including graph context.

## Type Definitions

All domain types are in `src/types/session.ts`. Key types:
- `SessionIndex`, `SessionSummary` --- session list
- `SessionDetail`, `ConversationTurn`, `AssistantBlock` --- playback data
- `KnowledgeGraph`, `TopicNode`, `TopicEdge` --- graph data
- `TacitKnowledge`, `WorkflowPattern`, `PainPoint` --- extracted insights
