# メッシュ組み立ての高速化（AO 追加後）

## 目的 / 仮説

頂点 AO と材質（テクスチャ番号）を追加したところ、組み立て時間が約 2.4 倍になり、WASM の JS に対する優位も 3.4 倍 → 約 1.14 倍に縮んだ（`client-load-vs-bluemap.md` の追加実験）。

- **仮説 H12:** 遅くなった主因は AO の計算そのものではなく、両言語に共通する付随処理（チャンクごとの 16×384×16 格子の初期化、材質表の引き直し、greedy のスライスごとの作り直しなど）である。これを取り除けば、出力を 1 バイトも変えずに WASM greedy を **1,500 ms 以下**（AO 追加前の 1,857 ms より速い）にできる。
  - 棄却条件: 出力を変えずに 2,500 ms を切れない。
- 条件: 出力（頂点・インデックス）は HEAD `68672ed` とバイト単位で一致。JS と WASM のアルゴリズムは同一に保つ（言語ごとの細かい調整は可）。

## 環境

- Mac mini（Apple M4、10 コア、32GB）、Node 26.0.0、Rust 1.93（wasm32-unknown-unknown）
- データ: `output/real/hide-surface` の先頭 4 リージョン（4,096 チャンク）、材質表 `output/textures/26.3/blocks.json`

## 手順

```
cd feasibility_research/tools/mesher
node bench/node-bench.mjs --data ../../output/real/hide-surface --regions 4 --blocks ../../output/textures/26.3/blocks.json --impl <wasm|js> --mode <greedy|culled>
```
ウォームアップ 2 回、計測 5 回の中央値。

## 結果

### ベースライン（HEAD `68672ed`、2026-09-29）

| 実装 | 方式 | 中央値 | 範囲 | 1 チャンクあたり p50 / p95 | quad 数 | 頂点バイト |
|---|---|---:|---|---|---:|---:|
| WASM | greedy | 4,384 ms | 4,375〜4,390 | 1.04 / 1.25 ms | 4,752,668 | 228,128,064 |
| WASM | culled | 4,454 ms | 4,446〜4,498 | 1.06 / 1.27 ms | 8,769,766 | 420,948,768 |
| JS | greedy | 5,003 ms | 4,998〜5,052 | 1.17 / 1.54 ms | 4,752,668 | 228,128,064 |
| JS | culled | 4,737 ms | 4,674〜4,756 | 1.09 / 1.52 ms | 8,769,766 | 420,948,768 |

参考（AO 追加前、コミット `be27021`、色のみ・合成材質なし）: WASM greedy 1,857 ms、WASM culled 2,034 ms、JS greedy 6,303 ms、JS culled 6,322 ms。

### 改善後

（測定中）

## 結論

（測定後に記入）

## 次の一手 / 未検証事項
