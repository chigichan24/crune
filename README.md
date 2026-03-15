# crune

Claude Codeのセッションログを可視化する静的Webダッシュボード。ローカルのJSONLセッションファイルを解析し、セッション再生・分析ダッシュボード・セマンティックナレッジグラフを提供します。

## Features

- **Session Playback** --- ターンごとの会話リプレイ、ミニマップナビゲーション、ツールコール詳細表示、サブエージェントブランチ展開
- **Overview Dashboard** --- アクティビティヒートマップ、プロジェクト分布、ツール使用傾向、セッション時間分布、モデル使用状況、編集頻度の高いファイル
- **Semantic Knowledge Graph** --- TF-IDF + Tool-IDF + 構造的特徴量、Truncated SVD、凝集型クラスタリング、Louvainコミュニティ検出、Brandes中心性（[アルゴリズム詳細](docs/knowledge-graph-algorithm.md)）
- **Tacit Knowledge** --- ワークフローパターン、ツールシーケンス、ペインポイント（長時間セッション、頻繁に編集されるファイル）の抽出
- **Session Summarization** --- セッションの自動要約・分類（LLM不要）
- **Skill Distillation** --- ナレッジグラフからの再利用可能スキルの蒸留・エクスポート

## Quick Start

```bash
npm install

# Claude Codeのセッションログを解析（~/.claude/projects/）
npm run analyze-sessions

# 開発サーバーを起動
npm run dev
```

## Data Pipeline

`npm run analyze-sessions` は `~/.claude/projects/` 配下のJSONLセッションファイルを読み込み、構造化されたJSONを `public/data/sessions/` に出力します。

```
~/.claude/projects/**/*.jsonl
  -> parse & build turns
  -> extract metadata, subagents, linked plans
  -> session summarization (centrality-based representative prompt, workType classification)
  -> TF-IDF + Tool-IDF + structural features -> Truncated SVD -> agglomerative clustering -> Louvain
  -> skill distillation (reusability score top-N -> claude -p)
  -> output:
       public/data/sessions/index.json      (session list)
       public/data/sessions/overview.json   (cross-session analytics + knowledge graph)
       public/data/sessions/detail/*.json   (individual session playback data)
```

カスタムパス指定:

```bash
npm run analyze-sessions -- --sessions-dir /path/to/sessions --output-dir /path/to/output
```

## Session Summarization

セッション一覧には自動生成された要約が表示されます。LLMを使わず、完全にローカルで処理されます。

- **代表プロンプト選出**: planモードのプロンプトからcentralityベースで代表的なプロンプトを選出
- **workType分類**: セッションを以下の4種類に自動分類
  - `investigation` --- 調査
  - `implementation` --- 実装
  - `debugging` --- デバッグ
  - `planning` --- 計画
- **キーワード抽出**: セッション内容から主要キーワードを自動抽出
- **スコープ推定**: 編集されたファイルの共通ディレクトリからセッションのスコープを推定

## Skill Distillation

ナレッジグラフの分析結果から、再利用可能なスキルを自動的に蒸留します。[anthropics/skills](https://github.com/anthropics/skills)形式に準拠しています。

- **事前蒸留**: `analyze-sessions` 実行時にreusabilityスコア上位5件を `claude -p` で事前蒸留
- **即時表示**: UIで蒸留済みスキルを即座に表示・クリップボードへコピー可能
- **オンデマンド再蒸留**: 「再蒸留」ボタンでグラフコンテキスト付きの完全版をオンデマンド生成
- **ローカルサーバー**: `npm run skill-server` でスキル蒸留用APIサーバーを起動（localhost:3456）

蒸留オプション:

```bash
# モデル指定（例: haikuで高速化）
npm run analyze-sessions -- --distill-model haiku

# 蒸留するスキル候補数を変更（デフォルト: 5）
npm run analyze-sessions -- --distill-count 10

# LLM蒸留をスキップ（グラフ構築のみ）
npm run analyze-sessions -- --skip-distill
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite開発サーバーを起動 |
| `npm run build` | 型チェック + プロダクションビルド |
| `npm run preview` | プロダクションビルドのプレビュー |
| `npm run lint` | ESLintの実行 |
| `npm run analyze-sessions` | データパイプラインの実行 |
| `npm run skill-server` | スキル蒸留用ローカルサーバー（localhost:3456） |
| `npm run dev:full` | skill-server + Vite dev serverを同時起動 |

### analyze-sessionsの蒸留オプション

| Flag | Description |
|------|-------------|
| `--distill-model <model>` | 蒸留に使うモデル指定（例: `haiku` で高速化） |
| `--distill-count <n>` | 蒸留するスキル候補数（デフォルト: 5） |
| `--skip-distill` | LLM蒸留をスキップ |

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
    overview/     # ダッシュボードカード、セッション一覧、チャート
    playback/     # セッションリプレイ、ツールコールブロック、サブエージェントブランチ
    knowledge/    # フォースグラフ、ノード詳細、暗黙知、スキル蒸留
  hooks/          # データ取得 (useSessionIndex, useSessionDetail, useSessionOverview)
  types/          # TypeScript型定義
scripts/
  analyze-sessions.ts        # JSONL -> JSON パイプライン
  session-summarizer.ts      # セッション要約（ローカルNLP）
  skill-distiller.ts         # スキル蒸留（claude -p）
  skill-server.ts            # 蒸留用HTTPサーバー
  knowledge-graph-builder.ts # セマンティック埋め込み + グラフ構築
public/
  data/sessions/             # 生成されたJSON（gitignore対象）
```

## Prerequisites

- Node.js >= 18
- Claude Codeのセッションログ（`~/.claude/projects/`）

## License
Apache-2.0 license
