# Knowledge Graph Algorithm

セッションデータからセマンティックなトピックグラフを構築するパイプライン。テキスト内容・ツール使用パターン・セッション構造の3種類の特徴量を潜在意味空間で統合し、クラスタリングでトピックノードを生成、複合シグナルでエッジを張り、コミュニティとブリッジを検出する。

実装: [`scripts/knowledge-graph-builder.ts`](../scripts/knowledge-graph-builder.ts)

---

## Pipeline Overview

```
Feature Extraction ─┐
  1a. TF-IDF         │
  1b. Tool-IDF       ├→ Combined Matrix → SVD → Clustering → Topic Nodes → Edges → Louvain → Brandes
  1c. Structural     │
────────────────────┘
```

8ステップで構成される。

---

## Step 1: Feature Extraction

3種類の特徴量を各セッションから抽出し、それぞれ独立にL2正規化する。

### 1a. TF-IDF (Text Features)

各セッションの user prompt、assistant 応答テキスト、編集ファイルパス、git branch を結合し、トークン化する。

**Tokenization**:
- CamelCase 分割 (`sessionPlayback` → `session`, `playback`)
- snake_case / kebab-case 分割
- ファイルパスからセグメント抽出（拡張子除去、短すぎるセグメント除外）
- 日英ストップワード除去
- UUID、16進数文字列（6文字以上）、純数字、40文字超トークンをノイズとして除外

**Vectorization**:
- `tf(t, d) = log(1 + count(t, d))`
- `idf(t) = log(N / df(t))`
- Vocabulary filtering: 2文書以上に出現し、かつ全文書の80%以下に出現する語のみ採用
- L2正規化

### 1b. Tool-IDF (Tool Usage Features)

ツール使用パターンをIDFで重み付けすることで、頻出ツールのバイアスを軽減する。

- 各セッションのメインターン + サブエージェントターンからツール使用回数を集計
- `weight(tool, session) = log(1 + count) * idf(tool)`
- `idf(tool) = log(N / df(tool))` ここで `df(tool)` はそのツールを使用したセッション数
- L2正規化

### 1c. Structural Features (7-dimensional)

セッションの構造的特性を捉える固定長ベクトル。

| Dim | Feature | Description |
|-----|---------|-------------|
| 0 | `userRatio` | ユーザー入力の割合 |
| 1 | `assistantRatio` | アシスタント応答の割合 |
| 2 | `toolCallRatio` | ツール呼び出しを含むターンの割合 |
| 3 | `subagentRatio` | サブエージェント関与の割合 (Agent呼び出しターン + サブエージェント数) / 総ターン数 |
| 4 | `avgToolsPerTurn` | ターンあたりのツール数の対数: `log(1 + total_tools / total_turns)` |
| 5 | `editHeaviness` | (Edit + Write) / 総ツール呼び出し数 |
| 6 | `readHeaviness` | (Read + Grep + Glob) / 総ツール呼び出し数 |

L2正規化。

---

## Step 2: Combined Matrix + Truncated SVD

3つの特徴ベクトルを重み付き連結し、SVDで次元削減する。

### Matrix Construction

```
row_i = [ sqrt(0.50) * TF-IDF_i,  sqrt(0.25) * Tool-IDF_i,  sqrt(0.25) * Structural_i ]
```

重みに `sqrt` を適用するのは、連結後のcosine距離において各グループの寄与が指定比率（50:25:25）になるようにするため。結果は `m × n` の行列（`n` = TF-IDF語彙数 + ツール語彙数 + 7）。

### Truncated SVD

`m` セッション << `n` 特徴量であることを利用し、Gram行列経由で効率的にSVDを計算する。

1. **Gram行列** `G = A * A^T` (`m × m`) を計算
2. **Power iteration + deflation** で `G` の上位 `k` 個の固有ベクトル・固有値を抽出
   - 50回反復（収束に十分）
   - Seed = 42 による決定的初期化で再現性を確保
3. 特異値 `sigma_i = sqrt(lambda_i)`
4. 右特異ベクトル `V = A^T * U * Sigma^{-1}` を復元（潜在次元の解釈用）
5. セッション埋め込み `U * Sigma` をL2正規化 → **k次元の密な潜在空間**

`k = min(80, max(20, floor(m / 4)))`

この潜在空間では、テキスト内容とツール使用パターンのクロスシグナルが自然に軸として現れる。右特異ベクトル `V` の各列を調べると、どの語・どのツールがその潜在軸に寄与しているかがわかる。

---

## Step 3: Agglomerative Clustering (Average Linkage)

SVD潜在空間でのcosine距離を用いた凝集型クラスタリング。

### Clustering

1. SVDセッションベクトル間の **cosine距離行列** を事前計算
2. **Average linkage** による凝集型クラスタリングを実行し、merge距離の履歴を記録
3. **Elbow検出**: merge距離の二階微分（加速度）が最大となる点を閾値とする
   - fallback: 履歴が短い場合は 0.7
   - 閾値を `[0.3, 0.9]` にクランプ
4. 検出した閾値で再クラスタリング（閾値を超えるmergeで打ち切り）

### Oversized Cluster Splitting

全セッションの25%超を含むクラスタ（最低10セッション）は分割対象:
- クラスタ内部の距離のみを抽出
- 内部距離の中央値 × 0.8 をより厳しい閾値として再クラスタリング（下限 0.15）

5セッション未満の場合は各セッションが独立したトピックになる。

---

## Step 4: Topic Node Construction

各クラスタから以下を生成:

| Field | Method |
|-------|--------|
| **Keywords** | TF-IDFセントロイド（クラスタ内セッションベクトルの平均）の上位5語 |
| **Label** | top-3 keywords + プロジェクト情報 |
| **Representative Prompts** | セントロイドとのcosine類似度が高いセッションのuser promptから上位3件（重複除去） |
| **Suggested Prompt** | 支配的アクション動詞（日英対応） + top-3 keywords + Tool-IDF加重top-3ツールを組み合わせたテンプレート |
| **Tool Signature** | `log(1 + count) * idf(tool)` の上位5ツール |
| **Dominant Role** | subagent比率 > 15% → `subagent-delegated`、tool比率 > 60% → `tool-heavy`、otherwise → `user-driven` |

---

## Step 5: Topic Edge Construction

全トピックペアに対して3つのシグナルを計算し、重み付き合成でエッジを生成する。

### Signals

| Signal | Weight | Method |
|--------|--------|--------|
| **Semantic Similarity** | 0.4 | SVD潜在空間でのトピックセントロイド間cosine類似度 |
| **File Overlap** | 0.3 | メンバーセッションの編集ファイル集合のJaccard係数 |
| **Session Overlap** | 0.3 | 同一プロジェクト・同一branchなら0.6、1時間以内の時間的近接なら0.4（大きい方を採用） |

`strength = semantic * 0.4 + file * 0.3 + session * 0.3`

**Threshold**: strength > 0.2 のペアのみエッジを生成。

### Edge Type Classification

| Type | Condition |
|------|-----------|
| `cross-project-bridge` | ソース・ターゲットが完全に異なるプロジェクト群に属する |
| `shared-module` | 最大の重み付きシグナルがfile overlap |
| `workflow-continuation` | 最大の重み付きシグナルがsession overlap |
| `semantic-similarity` | 上記いずれにも該当しない場合（デフォルト） |

---

## Step 6: Louvain Community Detection

エッジの重みに基づくmodularity最大化。

1. 各ノードを独立したコミュニティとして初期化
2. 各ノードについて、隣接コミュニティへの移動による modularity gain `ΔQ` を計算
3. `ΔQ` が最大となるコミュニティに移動（改善がなければスキップ）
4. 収束するか最大100反復まで繰り返す
5. **Modularity** `Q = (1/2m) * Σ[A_ij - k_i*k_j/(2m)] * δ(c_i, c_j)` を計算

コミュニティラベル: メンバートピックのkeyword頻度の上位3語。

エッジが存在しない場合は各ノードが独立コミュニティとなる。

---

## Step 7: Brandes Betweenness Centrality

グラフ上でのノードの「橋渡し」度合いを測定する。

### Betweenness Centrality

Brandesアルゴリズム:
1. 全ノードsからBFSを実行し、最短経路数 `σ` と先行ノードリストを記録
2. 逆順に dependency `δ` を伝播: `δ(v) += (σ(v)/σ(w)) * (1 + δ(w))`
3. 正規化: 無向グラフのため `CB(v) = (CB(v) / 2) * (2 / ((n-1)(n-2)))`

### Degree Centrality

`DC(v) = degree(v) / (n - 1)`

### Bridge Topic Identification

betweenness centrality > 0 のトピックを降順にソートし、上位10%（最低1件）を **bridge topics** として識別する。これらはコミュニティ間の知識の橋渡し役を果たすトピック。
