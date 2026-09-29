# 対応版ごとのワールド保存形式の違い

2026-09-30 に Comet の LXC 117 で各版の Paper を起動し、生成されたチャンクを調べた結果。

## Decision

- 抽出処理（`core`）は、下記 2 通りのブロック状態の書き方を**両方**読む。版番号で分岐せず、NBT の形で判定する。
- リージョンフォルダの場所は版で変わるため、`core` はフォルダのパスを受け取るだけにし、場所の解決は `paper` 側で行う。

## 版ごとの違い

| 版 | DataVersion | リージョンフォルダ（オーバーワールド） | ブロック状態の書き方 |
|---|---|---|---|
| 1.21.11 | 4671 | `world/region` | 旧形式 |
| 26.1.2 | 4790 | `world/dimensions/minecraft/overworld/region` | 旧形式 |
| 26.2 | 4903 | 同上 | 旧形式 |
| 26.3 | 5023 | 同上 | **新形式** |

- ネザー・エンドは、1.21.x は `world_nether/DIM-1/region`・`world_the_end/DIM1/region`、26.x は `world/dimensions/minecraft/the_nether/region`・`.../the_end/region`。
- 26.x の world フォルダは 1 つで、ネザー・エンドも `dimensions/` の下に入る（Bukkit のワールド名は引き続き `world_nether` など）。

### ブロック状態（`sections[].block_states.palette`）

- 旧形式: 要素が複合タグのリスト。`{Name: "minecraft:oak_log", Properties: {axis: "y"}}`。
- 新形式（26.3）:
  - 全要素に属性が無いとき: **文字列のリスト** `["minecraft:stone", "minecraft:dirt"]`。
  - 属性を持つ要素が 1 つでもあるとき: 複合タグのリスト。属性を持つ要素は `{id: "minecraft:oak_log", properties: {axis: "y"}}`、属性の無い要素は**空の名前のキーで包まれた文字列** `{"": "minecraft:air"}`（型が混ざるリストの新しい書き方）。
  - 属性値は旧形式と同じく文字列。
- バイオームの palette は全版とも文字列のリスト。
- `Status`、`xPos`・`zPos`・`yPos`、`Heightmaps`（`WORLD_SURFACE`・`OCEAN_FLOOR` など）、`sections[].Y`、`block_states.data` は全版で同じ。

## Constraints / Gotchas

- 検証用の抽出器は新形式で `Unexpected palette type` を出して止まる（旧形式しか想定していなかったため）。
- Paper 26.3 は光の情報を `starlight.*` にだけ保存する点は 1.21.11 と同じ。
- Chunky 1.5.3 は 26.1.2〜26.3 に対応。コマンドはサーバー起動直後（`Done` 直後）に送ると `getLevel() is null` で失敗するので、数十秒待ってから送る。
- 試験用のリージョン（gitignore 済み）: `feasibility_research/fixtures/r.0.0.mca`・`r.-1.-1.mca`（1.21.11）、`feasibility_research/fixtures/26.3/{overworld,nether}/`（26.3、各 4 リージョン、半径 512 / 256 ブロックを Chunky で生成）。
