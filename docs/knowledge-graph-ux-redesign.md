# Knowledge Graph UX 再設計提案

Closes #19. このドキュメントは **設計提案のみ** であり、コード・テストの変更を含まない。プロトタイプは後続に分離する。

## 1. スコープと監査対象サーフェス

### 対象 issue
[#19](https://github.com/chigichan24/crune/issues/19) — "Rethink the Knowledge Graph: which questions is it actually answering?"。force-directed なノード・エッジグラフが primary representation として妥当かを問い直し、代替可視化を比較して 1〜2 案を選定する。issue は design mode のまま閉じ、実装は follow-up に分割する。

### 監査したコンポーネント
| ファイル | 役割 | 行数の目安 |
| --- | --- | --- |
| `src/components/knowledge/KnowledgeGraphView.tsx` | force-directed グラフ本体 + フィルタ + サイドバー(Insights/Detail タブ) | 約 503 行 |
| `src/components/knowledge/KnowledgeNodeDetail.tsx` | ノード選択時の詳細パネル | 約 378 行 |
| `src/components/knowledge/GraphMetricsPanel.tsx` | グラフ全体メトリクスのサマリパネル | 約 51 行 |
| `src/components/knowledge/TacitKnowledgeView.tsx` | サイロ/ブリッジ/横断/ワークフロー/Skill候補の集約ビュー | 約 294 行 |
| `src/types/session.ts` の `TopicNode` | グラフのデータモデル | L146-166 |

### データモデル `TopicNode`(L146-166)
```
id, label, keywords[], project, projects[], sessionIds[], sessionCount,
totalDurationMinutes, totalToolCalls, firstSeen, lastSeen,
betweennessCentrality, degreeCentrality, communityId,
representativePrompts[], suggestedPrompt, toolSignature[],
dominantRole, reusabilityScore
```

#### force graph が無視しているフィールド(重要)
`KnowledgeGraphView.tsx` の `filteredData`(L140-175)で `GraphNode` に投影されるのは
`id / label / keywords / project / sessionCount / communityId / betweennessCentrality / val(=sessionCount*2)` のみ。

以下のフィールドは **`GraphNode` に投影すらされない**(force graph からは完全に不可視):

- `firstSeen` / `lastSeen` — 時間軸情報。グラフは時間を表現しない。
- `reusabilityScore`(overall とその内訳)— "どれを Skill 化すべきか" の最重要シグナルがノードに表れない。
- `projects`(複数プロジェクト所属)— 横断知識のシグナルが落ちる(`project` 単数のみ参照)。
- `dominantRole`(user-driven / tool-heavy / subagent-delegated)— 作業の性質が見えない。
- `totalDurationMinutes` / `totalToolCalls` / `representativePrompts` / `suggestedPrompt` / `toolSignature` — すべて detail パネルに入るまで不可視。
- `degreeCentrality` — GraphNode に投影されない。

以下のフィールドは **`GraphNode` には投影されているが、ノードのサイズ・色・ラベルには一切反映されない**:

- `betweennessCentrality` — GraphNode の `betweennessCentrality` プロパティとして渡されるが、`nodeColor` / `nodeVal` / `nodeLabel` のいずれにも使われておらず、視覚出力には現れない。

これらは Detail パネル(`KnowledgeNodeDetail.tsx`)を開いて初めて表示される。つまり **意思決定に必要な情報がすべて 1 ノード 1 クリックの奥に隠れている**。これが #19 の "bird's-eye view と detail panel の insight がつながらない" の根本原因。

---

## 2. 現状監査 — 各コンポーネントが伝えること vs 伝え損ねていること

### 2.1 `KnowledgeGraphView.tsx`(force-directed graph)
**伝えていること**
- トピック間の意味的近接(レイアウトの距離)と community(ノード色 = `communityColorMap`)。
- エッジ種別(意味的類似 / モジュール共有 / ワークフロー / プロジェクト横断)を色とフィルタで区別。
- floating metrics bar に `totalTopics / totalEdges / communities / Q(modularity) / isolated` を生表示。

**伝え損ねていること**
- **どのノードが重要か** が大きさ(`val = sessionCount*2`)でしか分からない。再利用価値・新しさ・所要時間が視覚に出ない。
- **時間軸がない** — "最近何に集中していたか" "どの問題が繰り返しているか" に答えられない(`firstSeen/lastSeen` 不使用)。
- **専門用語が露出** — `Q=0.42` `isolated` `betweenness`(detail 側)など graph-theory jargon が説明なしで並ぶ。
- **比較・ソートができない** — force layout は位置が物理シミュレーションで決まるため、"再利用価値順" "新しい順" に並べ替えるという基本操作が原理的に不可能。
- **初見の認知コスト** が高い。issue 本文の "information-dense to the point that it is not clear what question it answers" そのもの。

### 2.2 `KnowledgeNodeDetail.tsx`
**伝えていること**
- 1 トピックの全フィールド(keywords / stats / dominantRole バッジ / reusability の内訳バー / suggestedPrompt / toolSignature / representativePrompts / 接続トピック / セッション一覧)。
- `centralityInterpretation()`(L57-63)で betweenness/degree を日本語の平易な解釈に変換している。**これは良い前例** で、本提案の「専門用語を平易な解釈に隠す」方針はこの関数の発想を全面展開したもの。

**伝え損ねていること**
- `Betweenness: 0.123 / Degree: 0.456` の **生数値が解釈文と並んで常時露出**(L300-307)。advanced 扱いではない。
- 情報密度が高く、最重要の reusability と二次的な graph position が同一階層に並ぶ(優先度の差が UI に出ない)。
- 単一ノードに閉じており、**横断比較**(他トピックと並べて見る)導線がない。

### 2.3 `GraphMetricsPanel.tsx` — **dead code**
- `grep -rn "GraphMetricsPanel" src/` の結果、参照は **自分自身(import 文と export 宣言)のみ**。どのコンポーネントからも import されていない。
- 表示内容(Topics/Edges/Communities/Density/Modularity/Isolated/Bridge Topics)は `KnowledgeGraphView` の metrics bar と実質重複。
- **推奨: follow-up issue で `GraphMetricsPanel.tsx` と co-located の `.css` を削除する。** 本提案では削除しない(設計のみ)。

### 2.4 `TacitKnowledgeView.tsx`
**伝えていること**
- グラフから派生した洞察を **リスト/カード形式** で提示: Knowledge Silos(孤立)、Bridge Topics、Cross-Project、Workflow Patterns、Skill Candidates(reusability 降順 top10、再合成ボタン付き)。
- **実はこれが既にグラフより質問に答えている。** "どれを Skill 化?" は Skill Candidates カードが、"孤立した知識は?" は Silos が直接答えている。

**伝え損ねていること**
- グラフの sidebar の中(`sidebarTab === 'insights'`)に押し込まれており、**グラフが主・リストが従** の情報設計になっている。実際の有用性は逆。
- ソート/フィルタ/検索がなく、固定カテゴリの羅列。トピック数が増えるとスクロールが破綻する。
- ここでも `BC: 0.123`(betweenness)が生で露出(L190-191)。

**監査の結論**: 既に「リスト/カード」(`TacitKnowledgeView`)が質問への回答として機能している。force graph は探索的閲覧には向くが意思決定には弱い。よって **主従を反転** させるのが筋。

---

## 3. ペルソナと Jobs-To-Be-Done

> プロジェクト方針(MEMORY: team scope 拡張が本質的価値)に従い、**現時点は solo を最適化しつつ、team へ一般化できる view を選ぶ**。

### ペルソナ A: ソロ振り返り(現在の主対象)
自分のセッションログを後から振り返り、次の行動を決める個人開発者。
- **JTBD-A1**: 最近の作業がどのテーマに集中していたかを把握したい(`firstSeen/lastSeen` × cluster)。
- **JTBD-A2**: どのパターンを Skill 化すべきか、再利用価値順に判断したい(`reusabilityScore` ソート)。
- **JTBD-A3**: 繰り返している問題(同種クラスタの再出現)を見つけたい(時間 × cluster)。
- **JTBD-A4**: 今の作業に似た過去セッションへ素早く飛びたい(`sessionIds` → playback)。

### ペルソナ B: チーム知識共有(将来。現状はブロック中 — §6 参照)
チーム全体の暗黙知を発掘・共有するリード/マネージャ。
- **JTBD-B1**: チーム横断で再利用価値の高い Skill 候補を見つけ共有したい(`reusabilityScore` × per-user)。
- **JTBD-B2**: 特定の人だけが持つサイロ化した知識を特定したい(isolated × 担当者)。
- **JTBD-B3**: プロジェクト/人をまたぐブリッジ知識を共有したい(`projects[]` × cross-project edge)。

**solo→team 一般化の指針**: solo で選ぶ view は、後で「人(attribution)」次元を facet/列/行として **足すだけ** で team に拡張できる構造にする。faceted list は列追加で、heatmap は軸追加で、timeline は lane 追加で拡張できる。force graph は人次元を足すと色の意味が二重化して破綻しやすい。

---

## 4. 候補可視化の比較

各候補に「必要データフィールド」「答える JTBD」「概算工数(S/M/L)」を付す。工数は実装+テスト(pure logic は vitest 必須、UI 層はテスト skip 規約)込みの相対値。

### 4.1 Faceted sortable list(ファセット付きソート可能リスト)
- **内容**: 1 トピック 1 行。列に label / sessionCount / reusability(バー)/ 期間(`firstSeen`–`lastSeen`)/ dominantRole / projects。ヘッダクリックでソート、サイドのファセット(community / role / project / 期間レンジ)で絞り込み。
- **必要データ**: 既存 `TopicNode` の全フィールド。**新規パイプライン不要。**
- **答える JTBD**: A2(reusability ソート), A1/A4(検索→飛ぶ), B1(team 時は per-user 列追加で拡張)。
- **工数**: **S〜M**。データは揃っており、ソート/フィルタは pure logic として切り出してテスト可能。`TacitKnowledgeView` のカード資産を一部流用できる。

### 4.2 Timeline clusters(時間軸クラスタ)
- **内容**: 横軸 = 時間、各 community/cluster を lane として帯表示。トピックを `firstSeen`–`lastSeen` のスパンで配置。繰り返し(同 cluster の再出現)が視覚的に分かる。
- **必要データ**: `firstSeen`, `lastSeen`, `communityId`, `sessionCount`(帯の太さ)。**既存で充足。**
- **答える JTBD**: A1(最近の集中), A3(繰り返す問題)。team では lane を人 × cluster に拡張。
- **工数**: **M**。時間スケールのビニングと lane 割当が pure logic(テスト対象)。描画は SVG/CSS。

### 4.3 Heatmap(ヒートマップ)
- **内容**: 行 = community または project、列 = 週/月、セル濃度 = セッション数 or 所要時間。活動の濃淡を一覧。
- **必要データ**: `firstSeen`(ビニング), `communityId`/`project`, `sessionCount`/`totalDurationMinutes`。**既存で充足**(`SessionOverviewData.activityHeatmap` の前例あり)。
- **答える JTBD**: A1, A3。team では行に人を足すだけ(B2 に有効)。
- **工数**: **S〜M**。集計は pure logic。既存 heatmap の描画パターンを流用可。

### 4.4 Hierarchical tree(階層ツリー)
- **内容**: community → topic → session のドリルダウンツリー。
- **必要データ**: `communityId`, `sessionIds`, 既存階層。
- **答える JTBD**: A4(掘り下げ)。ただし「比較・並べ替え」には弱い。
- **工数**: **M**。展開状態管理は既存 `SubagentBranch` の expand/collapse パターン流用可。

### 4.5 Sankey(サンキー図)
- **内容**: project → community → dominantRole などのフローを帯幅で表現。
- **必要データ**: `project`/`projects`, `communityId`, `dominantRole`, `sessionCount`。
- **答える JTBD**: B3(横断フロー)寄り。solo の意思決定への寄与は薄い。
- **工数**: **L**。レイアウト計算が重く、ライブラリ追加の可能性。費用対効果が低い。

### 4.6 Scatter(散布図)
- **内容**: X = recency(`lastSeen`)、Y = reusability.overall、点サイズ = sessionCount、色 = community。右上が「最近かつ再利用価値が高い = 今 Skill 化すべき」象限。
- **必要データ**: `lastSeen`, `reusabilityScore.overall`, `sessionCount`, `communityId`。**既存で充足。**
- **答える JTBD**: A2(Skill 化判断)を 1 枚で。
- **工数**: **M**。象限判定は pure logic。ただし faceted list と役割が重なる(list の方が precise なソートが可能)。

### 候補まとめ
| 候補 | 主に答える JTBD | 新規データ | 工数 |
| --- | --- | --- | --- |
| Faceted sortable list | A2/A1/A4, B1 | 不要 | S〜M |
| Timeline clusters | A1/A3 | 不要 | M |
| Heatmap | A1/A3, B2 | 不要 | S〜M |
| Hierarchical tree | A4 | 不要 | M |
| Sankey | B3 | 不要 | L |
| Scatter | A2 | 不要 | M |
| (現状) Force graph | 探索のみ | — | (既存) |

---

## 5. 推奨

### 5.1 主従の反転(決定事項)
1. **Faceted sortable list を default view にする。** solo の最重要 JTBD(A2: 何を Skill 化するか)に最短で答え、新規データ不要(工数 S〜M)、team 時は per-user 列を足すだけで一般化できる。`TacitKnowledgeView` のカード/Skill 候補資産を流用できる。
2. **force-directed graph を二次的な "Explore"(探索)タブに降格する。** 探索的閲覧・意味的近接の俯瞰には依然価値があるため削除はしないが、primary ではなくする。
3. **補助 view を 2 つ追加**: Timeline clusters(A1/A3)と Scatter(A2 の俯瞰)。両方とも新規データ不要・solo/team 両対応。Heatmap は team フェーズで行に人を足す前提で次点候補。

提案するタブ構成:
```
[一覧(Faceted list)*default]  [タイムライン]  [探索(Force graph)]
```

### 5.2 専門用語を平意化(決定事項)
- centrality / community / modularity / betweenness / Q / isolated などの graph-theory jargon を **UI 既定から排除** し、平易な日本語の解釈に置換する。`KnowledgeNodeDetail` の `centralityInterpretation()` を全面展開する方針:
  - `betweenness > 0.2` → 「複数の知識領域をつなぐ重要なブリッジ」(既存ロジック)
  - `degreeCentrality === 0` → 「孤立した知識(他とつながっていない)」
  - `community` → 「テーマ」/「作業の塊」
  - `modularity Q` → 既定では非表示
- **生数値は "詳細(advanced)" トグルの奥に格納**。既定では平易な解釈ラベルのみ表示し、トグル展開時に raw number(`0.123` 等)を出す。`KnowledgeNodeDetail` L300-307 の常時露出を advanced 化する。

### 5.3 両ジョブに対する正当化
- **solo(主)**: default の faceted list が A2 を直接満たし、timeline が A1/A3、list→playback リンクが A4 を満たす。force graph 降格で初見の認知コストが下がる(#19 の核心)。専門用語の平意化で「何の質問に答えているか」が明確になる。
- **team(将来)**: 選んだ 3 view(list / timeline / scatter)はいずれも per-user 次元を列/lane/点の次元として **加算的に** 拡張でき、再設計不要。force graph を team で primary にしなかったことで、人次元追加時の破綻を回避。

---

## 6. データギャップ分析

### 6.1 今すぐ使える(新規パイプライン不要)
推奨 3 view(faceted list / timeline / scatter)と平意化はすべて **既存 `TopicNode` フィールドのみ** で実装可能:
`label / keywords / projects / sessionIds / sessionCount / totalDurationMinutes / totalToolCalls / firstSeen / lastSeen / betweennessCentrality / degreeCentrality / communityId / dominantRole / reusabilityScore`。
現状これらの多くが force graph で無視されている(§1)だけで、データ自体は生成済み。**つまり主要な改善はパイプライン変更なしで実装できる。**

### 6.2 新規パイプラインフィールドが望ましい(あると質が上がる)
- **繰り返し検出(A3)を厳密化**するなら、cluster の再出現を示す派生メトリクス(例: `recurrenceCount` / 時系列バースト)を `knowledge-graph-builder.ts` で算出して `TopicNode` に追加すると、timeline の「繰り返す問題」がより明確になる。`firstSeen/lastSeen` だけでも近似可能なので **必須ではない**。
- **平易ラベルの一部**(community の人間可読名)は既に `KnowledgeCommunity.label` がある。追加不要。

### 6.3 team scope は **per-user attribution 欠如でブロック**(重大ギャップ)
- 現行データモデルに **「誰が」** の次元が一切ない。`SessionSummary` / `TopicNode` ともに user / author フィールドを持たない(`session.ts` 全体に user 識別子なし)。`~/.claude/projects/` は単一ユーザ前提のローカルログ。
- したがって JTBD-B1〜B3(per-user の Skill 共有 / サイロ特定 / 横断共有)は **現状では実装不能**。team scope は:
  1. 複数ユーザのログを集約する仕組み、
  2. セッション/トピックへの per-user attribution フィールド、
  の両方が前提。これは大きなパイプライン+収集基盤の変更で、本 issue の範囲外。
- **本提案のスタンス**: solo を最適化しつつ、選定 view を attribution 次元の加算で team 拡張できる構造にしておく(§5.3)。team 実装自体は別 epic とする。

---

## 7. 移行計画と follow-up issue

### 7.1 移行(段階的、各ステップ独立コミット)
1. **平意化レイヤを先に入れる**(リスク最小): `KnowledgeNodeDetail` の生メトリクスを advanced トグル化し、解釈ラベルを既定表示に。pure logic(解釈マッピング)は vitest でテスト。
2. **Faceted sortable list を新規追加**し、Knowledge 画面の default タブにする。ソート/フィルタ純ロジックを TDD(T-Wada)で実装。UI 層はテスト skip。
3. **既存 force graph を "探索" タブへ降格**(タブ構成の組み替えのみ。グラフ実装は据え置き)。
4. **Timeline clusters を追加**(ビニング/lane 割当を pure logic でテスト)。
5. **Scatter を追加**(象限判定を pure logic でテスト)。
6. **`GraphMetricsPanel.tsx` + `.css` を削除**(dead code。§2.3)。

各ステップ前に `npx tsc --noEmit && npm run lint && npm run test` を通し、green のみコミット。worktree 成果物は cherry-pick で main へ取り込む。

### 7.2 提案する follow-up issue
- **#19-a**: Faceted sortable list を default view として実装(pure logic のソート/フィルタに vitest)。
- **#19-b**: graph-theory 用語の平意化 + raw number の advanced トグル化(解釈マッピングに vitest)。
- **#19-c**: force graph を "探索" タブへ降格(タブ構成変更)。
- **#19-d**: Timeline clusters view 追加(ビニング/lane 割当に vitest)。
- **#19-e**: Scatter view 追加(象限判定に vitest)。
- **#19-f**: `GraphMetricsPanel.tsx` および co-located CSS の削除(dead code 除去)。
- **#19-g(epic、ブロック中)**: team scope 向け per-user attribution のパイプライン基盤(§6.3)。`#12` と関連。

### 7.3 本 issue の扱い
#19 は design mode。本ドキュメントの landing をもって close し、実装は上記 follow-up に分割する(issue 本文の "Close once a design proposal lands" に従う)。
