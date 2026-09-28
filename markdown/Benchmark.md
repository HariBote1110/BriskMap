# 実現性検証の計画

詳細な記録は [../feasibility_research/notes/INDEX.md](../feasibility_research/notes/INDEX.md) に残す。判断基準は [Decisions/0001-go-no-go.md](Decisions/0001-go-no-go.md)。

## 検証環境

Mac mini 上ではほかの VM の影響で測定値がばらつくため、Proxmox の Comet ノードに専用コンテナを置く。詳細は `feasibility_research/notes/environment.md`。

## 基準ワールド

- Minecraft **1.21.11**（BlueMap・Dynmap・Chunky がすべて対応する共通の版）
- 固定シード値で生成し、Chunky で範囲を事前生成する
- 規模: まず 4,096×4,096 ブロック（64 リージョン）。問題なければ 10,240×10,240 ブロック（400 リージョン）に広げる

## 測定項目

| # | 対象 | 項目 |
|---|---|---|
| 1 | BlueMap CLI 5.16 | 初回描画時間、出力容量、ファイル数、ピークメモリ |
| 2 | Dynmap 3.8（Paper 上） | 全体描画時間、出力容量、ファイル数（取得できれば） |
| 3 | BriskMap 試作（取り出し処理） | 処理時間、出力容量、ファイル数、ピークメモリ |
| 4 | BriskMap 試作（ブラウザ 2D） | 初回表示時間、fps |
| 5 | BriskMap 試作（ブラウザ 3D） | 1 区画あたりの組み立て時間（JS / WASM、Worker 数別） |

1〜3 で ADR 0001 の判断を行い、4・5 はブラウザ側描画の可否の判断材料とする。

## 測定の作法

- 各測定の前にページキャッシュを落とすか、「キャッシュあり（2 回目以降）」の条件に揃える。どちらの条件かを必ず記録する
- 同じ条件で 5 回以上測り、中央値とばらつきを記録する
- 測定中は同じノード上のほかの VM の負荷を記録する
