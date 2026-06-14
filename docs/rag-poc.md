# RAG Retrieval PoC (issue #35)

チャンクレベルの埋め込み + ハイブリッド検索が、現状の「クラスタ blob を丸ごとコンテキストに詰める」方式を置き換えられるかを検証する Proof-of-Concept。

実装:
- 埋め込みパイプライン / 検索: [`scripts/knowledge-graph/embedder.ts`](../scripts/knowledge-graph/embedder.ts), [`embedding-io.ts`](../scripts/knowledge-graph/embedding-io.ts), [`retriever.ts`](../scripts/knowledge-graph/retriever.ts)
- 計測ハーネス: [`scripts/rag-poc.ts`](../scripts/rag-poc.ts)

```bash
npx tsx scripts/rag-poc.ts                      # 実セッション + 実モデル（DL可能なら）
npx tsx scripts/rag-poc.ts --fake               # 決定論的fakeバックエンド（ネットワーク不要）
npx tsx scripts/rag-poc.ts --max-sessions 30    # コーパスサイズ上限
npx tsx scripts/rag-poc.ts --embed-model <id>   # モデル差し替え
```

> 本ドキュメントの数値は本環境で実際に測定したもの。HuggingFace からのモデル DL がブロックされる環境では `--fake` で配管全体（chunk抽出→量子化→ハイブリッド検索）は最後まで通る（埋め込み品質の数値のみ FAKE ラベルになる）。**本環境ではモデル DL が成功し、実モデル `Xenova/paraphrase-multilingual-MiniLM-L12-v2` で計測できた。**

---

## 検証する仮説

| # | 仮説 | 合格基準（目安） |
|---|------|------------------|
| H1 (retrieval quality) | チャンク単位検索は、クラスタ blob 丸ごとより関連断片を上位に出せる | サンプルクエリで意味的に一致するチャンクが top-1 |
| H2 (footprint) | int8 量子化インデックスは静的配信に耐える小ささ | 数百チャンクで index < 数百 KB |
| H3 (latency) | クエリ埋め込み + ハイブリッドスコアリングが対話的に十分速い | p95 < 50 ms（埋め込みキャッシュ後の検索のみ） |

---

## セットアップ

- モデル: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`（384次元, JA/EN混在向け多言語MiniLM）
- 埋め込み: `@huggingface/transformers` の feature-extraction パイプライン, `{ pooling: 'mean', normalize: true }`
- チャンク = セッション1ターン（`userPrompt` + assistant texts + ツール名）。空ターンはスキップ。
- 量子化: L2正規化済みベクトル成分は [-1, 1] なので `q = clamp(round(v*127), -127, 127)`、スケール `1/127`。往復誤差は ±`1/254` 以内（テストで保証）。
- ハイブリッドスコア = `alpha*denseNorm + (1-alpha)*bm25Norm`（デフォルト `alpha=0.6`、クエリ毎に min-max 正規化）。dense は逆量子化ベクトルの cosine、sparse は既存 `buildBm25` を再利用。
- 多様化: セッション毎の件数上限（デフォルト 2）で top-k が1セッションに偏らないようにする。

---

## 測定結果

### A. 合成コーパス（クリーンなプロンプトのみ, 4セッション / 12チャンク） — 実モデル

```
--- Footprint ---
index.bin: 4.5 KB (12 × 384 int8)
meta.json: 1.4 KB
bytes/chunk (vector only): 384

--- Throughput ---
embedded 12 chunks in 18 ms → 682.0 chunks/sec   ※ウォームアップ込みの小バッチ

--- Retrieval latency (per query, k=5) ---
p50: 3.1 ms, p95: 5.8 ms (n=20)
```

A/B（実モデル, クリーンコーパス）:

```
Query: "fix the authentication token bug"
  [0.600] auth-1#1: fix the auth token refresh handler
  [0.480] auth-1#2: add session cookie expiry handling
  [0.453] db-1#2:   fix the connection pool leak in postgres

Query: "database migration and query performance"
  [0.600] db-1#0: write a database migration for the users table
  [0.432] db-1#1: add an index to speed up the orders query
  [0.194] ui-1#0: style the knowledge graph view with css variables
```

→ クリーンなコーパスでは **H1合格**: 意味的に一致するチャンクが top-1、関連チャンクが上位に固まる。「今日のクラスタ blob」は該当セッションの全ターンを連結した塊で、無関係なターン（JWTログイン実装など）まで巻き込む。チャンク検索はターン粒度で必要箇所だけを返す。

### B. 実セッションコーパス（30セッション / 206チャンク） — 実モデル

```
--- Footprint ---
index.bin: 77.3 KB (206 × 384 int8)
meta.json: 45.5 KB
bytes/chunk (vector only): 384

--- Throughput ---
embedded 206 chunks in 17241 ms → 11.9 chunks/sec   ※CPU/WASM, バッチ32

--- Retrieval latency (per query, k=5) ---
p50: 4.4 ms, p95: 10.9 ms (n=20)
```

A/B（実モデル, 実コーパス）:

```
Query: "fix the authentication token bug"
  [0.845] …#13: npm notice Publishing to https://registry.npmjs.org/ with tag latest …
  [0.802] …#3:  <bash-stdout>! First copy your one-time code: 95DC-5F65 Open this URL …
  [0.759] …#16: <bash-stdout></bash-stdout><bash-stderr>--hostname required when not …

Query: "database migration and query performance"
  [0.738] …#27: <task-notification> <task-id>a6ea78b5f40159d79</task-id> …
  [0.663] …#9:  xcode最新でないとこのtrait解釈できないと…
  [0.636] …#28: <task-notification> <task-id>a6803f651ad6d4ce0</task-id> …
```

→ 実コーパスでは **H1は不合格寄り**。原因は埋め込み対象テキストに **ツール出力・システム通知ノイズ**（`<bash-stdout>`, `npm notice`, `<task-notification>` 等）が混入し、auth/database クエリと無関係な断片が高スコアを取ること。retriever のアルゴリズムではなく、**チャンクテキストの前処理（assistant texts に生のツール出力が含まれている）が品質を律速している**。

---

## 仮説ごとの結論

- **H2 (footprint): 合格。** ベクトルは 384 bytes/chunk（int8）。206チャンクで index.bin 77 KB。数千チャンクでも数 MB に収まり、静的配信で問題ない。`meta.json`（snippet込み 45 KB）が index.bin より大きいので、配信時は snippet 長を詰めるか別ファイル化する余地あり。
- **H3 (latency): 合格。** 埋め込みキャッシュ後の検索は p95 ~11 ms（206チャンク）。対話的に十分。クエリ埋め込み1回 + 全チャンク cosine + BM25 dot のブルートフォースで、この規模なら線形スキャンで足りる。
- **H1 (retrieval quality): 条件付き。** クリーンなプロンプトでは明確に blob を上回るが、**生のセッションテキストにはツール出力ノイズが多く、前処理なしでは品質が崩れる。** 埋め込みは生成できても「良い検索結果」には前処理が必須、というのが本 PoC 最大の学び。

### ビルド時スループットについて

実測 ~12 chunks/sec（CPU/WASM, MiniLM-L12）は、数千チャンク規模だと数分〜十数分かかる。これは `analyze-sessions` のビルド時間として無視できないため、

- `--embed` をオプトイン（デフォルト OFF）に留めた現状の設計は妥当。
- 本採用時は ONNX Runtime のスレッド/量子化モデル（`*-quantized`）でのスループット改善、またはチャンクの増分埋め込み（変更セッションのみ再計算）が必要。

---

## 推奨: **Hold**（前処理を入れてから採用判断）

配管（埋め込み→int8インデックス→ハイブリッド検索→多様化）は完成し、footprint と latency は基準を満たした。一方で **retrieval quality は「チャンクテキストのクレンジング」という1点に律速されている**ことが実コーパスで判明した。よって即採用（Go）でも撤回（Pivot）でもなく、以下を満たした上で再評価する **Hold** を推奨する。

採用前に潰すべき項目（小さく独立）:
1. **チャンクテキストのクレンジング（最優先）。** assistant texts から `<bash-stdout>`/`<bash-stderr>`/`<task-notification>`/`npm notice` 等のツール出力・システム通知を除去、あるいは userPrompt 比重を上げる。これだけで実コーパスの H1 が大きく改善する見込み。クレンジング後に B を再測定して再判定する。
2. **スループット対策。** quantized ONNX モデル / 増分埋め込みでビルド時間を許容範囲に。
3. **meta.json の配信最適化。** snippet を短縮 or 別ファイル化し、初期ロードを軽くする。

撤回（Pivot）とせず Hold とする根拠: ノイズ除去は局所的な前処理変更で、retriever 本体や埋め込みモデルの選定は妥当だったため。配管はそのまま #33（検索強化合成）/ #34（検索UI）の土台として再利用できる。

---

## #33 / #34 への引き継ぎ（retriever 公開API）

`scripts/knowledge-graph/retriever.ts`（barrel 経由で `knowledge-graph-builder.js` からも import 可）:

```ts
interface RetrievedChunk { sessionId: string; turnIndex: number; snippet: string; score: number; }
interface RetrieveOptions { alpha?: number /* =0.6 */; perSessionCap?: number /* =2 */; }
interface Retriever {
  retrieve(query: string, k: number, opts?: RetrieveOptions): Promise<RetrievedChunk[]>;
  readonly size: number;
}

// 低レベル（テスト/カスタム埋め込み向け）
function createRetriever(inputs: {
  chunks: ChunkMeta[]; texts: string[]; denseVectors: Float32Array[]; backend: EmbeddingBackend;
}): Retriever;

// インデックスファイルから（#34のサーバ向け）
function createRetrieverFromIndex(params: {
  chunks: ChunkMeta[]; matrix: Int8Array; dim: number; chunkTexts: string[]; backend: EmbeddingBackend;
}): Retriever;
```

- インデックス読み込み: `readEmbeddingIndex(dir)` → `{ meta, matrix }`。書き出し: `writeEmbeddingIndex(dir, result)`（`public/data/embeddings/{index.bin,meta.json}`）。
- 本番埋め込みバックエンド: `createTransformersBackend(model?, dim?)`。テストは `EmbeddingBackend` を注入（決定論的fake、ネットワーク不要）。
- `retrieve` はクエリを同一 backend で埋め込むため、#34 のサーバは backend を1度生成して使い回すこと。
- `chunkTexts` は BM25 用にチャンク全文が必要（snippet はメタにのみ保持）。サーバ側はセッションから再導出するか、snippet を劣化フォールバックとして渡す。
