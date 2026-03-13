# crune

Claude Code session visualizer. Analyzes local JSONL session logs and renders an interactive dashboard for playback, analytics, and semantic knowledge graph exploration.

## Features

- **Session Playback** --- Turn-by-turn conversation replay with minimap navigation, tool call inspection, and subagent branch expansion
- **Overview Dashboard** --- Activity heatmap, project distribution, tool usage trends, duration distribution, model usage, and top edited files
- **Semantic Knowledge Graph** --- TF-IDF + Tool-IDF + structural features, Truncated SVD, agglomerative clustering, Louvain community detection, and Brandes centrality ([algorithm details](docs/knowledge-graph-algorithm.md))
- **Tacit Knowledge** --- Extracted workflow patterns, common tool sequences, and pain points (long sessions, hot files)

## Quick Start

```bash
npm install

# Analyze Claude Code session logs (~/.claude/projects/)
npm run analyze-sessions

# Start dev server
npm run dev
```

Open http://localhost:5173.

## Data Pipeline

`npm run analyze-sessions` reads JSONL session files from `~/.claude/projects/` and outputs structured JSON to `public/data/sessions/`.

```
~/.claude/projects/**/*.jsonl
  -> parse & build turns
  -> extract metadata, subagents, linked plans
  -> TF-IDF + Tool-IDF + structural features -> Truncated SVD -> agglomerative clustering -> Louvain
  -> output:
       public/data/sessions/index.json      (session list)
       public/data/sessions/overview.json   (cross-session analytics + knowledge graph)
       public/data/sessions/detail/*.json   (individual session playback data)
```

Custom paths:

```bash
npm run analyze-sessions -- --sessions-dir /path/to/sessions --output-dir /path/to/output
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check + production build |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |
| `npm run analyze-sessions` | Run data pipeline |

## Tech Stack

- React 19 + TypeScript 5.9
- Vite 8
- Chart.js + react-chartjs-2
- react-force-graph-2d (d3-force)
- Plain CSS (no CSS-in-JS, no Tailwind)

## Project Structure

```
src/
  components/
    overview/     # Dashboard cards, session list, charts
    playback/     # Session replay, tool call blocks, subagent branches
    knowledge/    # Force graph, node detail, tacit knowledge
  hooks/          # Data fetching (useSessionIndex, useSessionDetail, useSessionOverview)
  types/          # TypeScript type definitions
scripts/
  analyze-sessions.ts        # JSONL -> JSON pipeline
  knowledge-graph-builder.ts # Semantic embedding + graph construction
public/
  data/sessions/             # Generated JSON (gitignored)
```

## Prerequisites

- Node.js >= 18
- Claude Code session logs at `~/.claude/projects/`

## License
Apache-2.0 license
