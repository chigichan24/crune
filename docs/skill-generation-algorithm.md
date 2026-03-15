# Skill Generation Algorithm

ナレッジグラフのトピックノードから再利用可能なClaude Codeスキル定義を生成するパイプライン。Reusabilityスコアによる優先度付け、ヒューリスティックによるスキル骨格生成、LLM合成による洗練の3段階で構成される。

実装:
- [`scripts/knowledge-graph/reusability.ts`](../scripts/knowledge-graph/reusability.ts) --- Reusabilityスコア
- [`scripts/knowledge-graph/skill-generator.ts`](../scripts/knowledge-graph/skill-generator.ts) --- ヒューリスティック生成
- [`scripts/skill-synthesizeer.ts`](../scripts/skill-synthesizeer.ts) --- LLM合成プロンプト構築 + `claude -p` 呼び出し
- [`scripts/session-summarizer.ts`](../scripts/session-summarizer.ts) --- セッション要約（スキルとは独立だが同パイプラインで実行）

---

## Pipeline Overview

```
Topic Nodes (from knowledge graph)
  → Step 1: Reusability Scoring
  → Step 2: Heuristic Skill Generation (all topics)
  → Step 3: LLM Synthesis (top-N by reusability, optional)
  → SkillCandidate[] in overview.json
```

---

## Step 1: Reusability Score

各トピックノードに対して、スキルとしての再利用価値を4つのシグナルから定量化する。

### Signals

| Signal | Weight | Formula | Rationale |
|--------|--------|---------|-----------|
| **Frequency** | 0.35 | `sessionCount / max(sessionCount)` | 頻繁に繰り返されるパターンほど自動化の価値が高い |
| **Time Cost** | 0.25 | `avgDuration / max(avgDuration)` | 1回あたりの所要時間が長いパターンほど自動化の効果が大きい |
| **Cross-Project** | 0.25 | `(projectCount - 1) / (max(projectCount) - 1)` | 複数プロジェクトにまたがるパターンは汎用性が高い |
| **Recency** | 0.15 | `1 - daysSinceLastSeen / max(daysSinceLastSeen)` | 最近使われたパターンは現在の作業に関連する可能性が高い |

```
overall = 0.35 * frequency + 0.25 * timeCost + 0.25 * crossProject + 0.15 * recency
```

すべてのスコアは `[0, 1]` に正規化され、小数第3位に丸められる。

---

## Step 2: Heuristic Skill Generation

各トピックノードからヒューリスティックにSKILL.mdを生成する。[anthropics/skills](https://github.com/anthropics/skills)形式に準拠。

### Skill Name

- top-3 keywords + プロジェクト名末尾をkebab-caseで結合
- 最大40文字

### Description (Pushiness)

skill-creatorの"pushiness"設計原則に従い、`description`フィールドにスキルの発動トリガーを明示する。under-triggeringを防ぐため、具体的な使用場面を記述する。

```
Use when you need to {action}. {roleHint} {projectScope}. Detected from {N} sessions over {M} minutes of usage.
```

- `action`: `suggestedPrompt` の先頭部分
- `roleHint`: `dominantRole` に応じたヒント（`subagent-delegated` → "Delegates to specialized subagents."、`tool-heavy` → "Tool-intensive workflow using {tools}." 等）
- `projectScope`: 単一プロジェクトか複数プロジェクトか

### Body Structure

| Section | Content |
|---------|---------|
| **Overview** | セッション数、プロジェクトスパンの概要 |
| **When to Use** | representative prompts を引用した発動条件（pushiness） |
| **Workflow** | `dominantRole` に応じたステップ: subagent-delegatedなら委任フロー、それ以外はtool signatureに基づくステップ |
| **Detected Patterns** | enriched tool sequenceの上位3件をフロー表記（`Read → Edit → Bash — 12 occurrences`） |
| **Guidelines** | "why"ベースのルール（bare MUST/NEVER は使わない） |

### Enriched Tool Sequence との紐付け

各トピックに紐づくenriched tool sequenceは、トピックのメンバーセッションIDとsequenceのセッションIDの交差で特定する。

---

## Step 3: LLM Synthesis

ヒューリスティック生成の結果を `claude -p` で洗練する。事前合成（ビルド時）とオンデマンド合成（UI操作時）の2パスがある。

### Pre-synthesizeation (Build Time)

`analyze-sessions` 実行時に、reusabilityスコア上位N件（デフォルト5）を合成する。

- `--synthesize-model <model>` でモデル指定可能（例: `haiku` で高速化）
- `--synthesize-count <n>` で件数変更
- `--skip-synthesize` でスキップ

結果は `SkillCandidate.synthesizeedMarkdown` に格納される。

### On-demand Re-synthesizeation (UI)

UIの「再合成」ボタンから、グラフコンテキスト付きの完全版を生成する。ローカルサーバー（`scripts/skill-server.ts`、port 3456）経由。

### Synthesis Prompt Structure

合成プロンプトは以下のセクションで構成される:

```
1. Topic Information       --- label, keywords, dominantRole, projects, sessionCount, duration
2. Representative Prompts  --- ユーザーの実際のプロンプト（最大3件）
3. Tool Signature          --- Tool-IDF加重の上位ツール
4. Enriched Tool Patterns  --- 検出されたツールフロー（上位5件）
5. Graph Position          --- 中心性の解釈（オンデマンド合成時のみ）
6. Connected Topics        --- エッジタイプ別の接続トピック（オンデマンド合成時のみ）
7. Current Heuristic Skill --- Step 2の結果を参考情報として提供
8. Instructions            --- anthropics/skills形式の出力要件
```

### Graph Context (On-demand Only)

オンデマンド合成では、フロントエンドが以下のグラフコンテキストを構築して送信する:

**Graph Position**: トピックの中心性を解釈
| Condition | Interpretation |
|-----------|---------------|
| `betweenness > 0.2` | 複数の知識領域をつなぐ重要なブリッジ |
| `betweenness > 0.05` | いくつかの領域をつなぐブリッジ |
| `degree > 0.5` | 多くのトピックと接続されたハブ |
| `degree === 0` | 孤立ノード |
| else | 周辺トピック |

**Connected Topics**: エッジタイプ別にグループ化
| Edge Type | Synthesis Hint |
|-----------|-------------------|
| `workflow-continuation` (incoming) | 前提スキル → `requires` frontmatter候補 |
| `workflow-continuation` (outgoing) | 後続スキル → `next` frontmatter候補 |
| `shared-module` | 同じファイルを扱う関連スキル |
| `cross-project-bridge` | プロジェクト横断で適用可能 |
| `semantic-similarity` | 類似トピック（差別化が必要） |

---

## Session Summarization (Companion Algorithm)

スキル生成と同パイプラインで実行されるセッション要約。LLMを使わず、ローカルで完結する。

実装: [`scripts/session-summarizer.ts`](../scripts/session-summarizer.ts)

### Representative Prompt Selection

1. planモードのユーザープロンプトを優先的に収集（フォールバック: 全プロンプト）
2. 各プロンプトをtokenize し、ペアワイズJaccard類似度を計算:

```
similarity(i, j) = |tokens_i ∩ tokens_j| / |tokens_i ∪ tokens_j|
```

3. centrality = Σ similarity(i, j) for all j ≠ i
4. 位置重み付き: `score(i) = centrality(i) × 1/(1+i)`
5. 最高スコアのプロンプトを選出（300文字制限）

位置重みにより、セッション冒頭のプロンプト（通常タスクの意図が最も明確）が優先される。

### Keyword Extraction

全候補プロンプトをtokenize → STOP_WORDS除外 → 頻度上位5語。既存のknowledge graphのtokenizerを再利用（CamelCase分割、パストークン化、日英ストップワード対応済み）。

### WorkType Classification

ツールヒストグラムの比率から作業タイプを分類する。

```
readRatio  = (Read + Grep + Glob) / totalToolCalls
writeRatio = (Edit + Write) / totalToolCalls
bashRatio  = Bash / totalToolCalls
```

| Priority | Condition | WorkType |
|----------|-----------|----------|
| 1 | `totalToolCalls === 0` or (`permissionMode === "plan"` and `turnCount < 5` and `writeRatio === 0`) | `planning` |
| 2 | `readRatio >= 0.7` | `investigation` |
| 3 | `bashRatio >= 0.4` and `writeCount > 0` | `debugging` |
| 4 | `writeRatio >= 0.4` | `implementation` |
| 5 | default | `implementation` |

### Scope Extraction

`filesEdited` のlongest common directory prefix。ファイル拡張子を含むセグメントは除外。単一ファイルの場合はその親ディレクトリ。
