# プラグインの保存場所と更新の流れ（M3・M4 の設計）

## Decision

### 保存場所

```
plugins/BriskMap/
├── config.yml
└── web/                         ← 持ち出す単位（このフォルダをコピーすれば地図ごと移せる）
    ├── maps/
    │   ├── index.json           地図の一覧（ワールド名・次元・DataVersion・抽出設定・更新時刻）
    │   └── <map-id>/            例: world, world_nether, world_the_end
    │       ├── r.X.Z.b2d
    │       └── r.X.Z.b3d
    └── textures/
        └── <minecraft-version>/ atlas.png, blocks.json（M2。Mojang の著作物なので配布物には含めない）
```

- `<map-id>` は Bukkit のワールド名。26.x ではオーバーワールド・ネザー・エンドが同じ world フォルダの下にあるが、Bukkit 上は別ワールド（`world_nether` など）なので、地図もワールドごとに分ける。
- 表示画面（HTML・JS・WASM）はプラグイン jar の中に入れて配信し、`web/` には置かない。`web/` にはデータだけが入る。

### リージョンフォルダの解決（paper 側）

`World#getWorldFolder()` の返す場所が版で違う（2026-09-30 に実サーバーで確認）。

| 版 | world | world_nether | world_the_end |
|---|---|---|---|
| 1.21.11 | `world`（中に `region/`） | `world_nether`（中に `DIM-1/region/`） | `world_the_end`（中に `DIM1/region/`） |
| 26.3 | `world/dimensions/minecraft/overworld` | `world/dimensions/minecraft/the_nether` | `world/dimensions/minecraft/the_end` |

26.3 では**次元のフォルダそのもの**が返り、どの次元もその直下に `region/` がある。そこで次の順に候補を作り、`r.*.*.mca` を含む最初の候補を使う（どれも含まなければ、存在する最初の候補）。

1. `<folder>/region`
2. ネザーなら `<folder>/DIM-1/region`、エンドなら `<folder>/DIM1/region`
3. `<folder>/dimensions/<namespace>/<path>/region`（`World#getKey()`。ワールドの根が返る配置への保険）

### 更新の流れ

1. 起動時: 全リージョンを `update`（出力が無い・設定が変わったリージョンは全体抽出、それ以外は .mca のチャンク時刻が変わったチャンクだけ抽出）。
2. 稼働中: 各リージョンフォルダの .mca の更新時刻を定期的に（既定 30 秒ごと）調べ、変わったリージョンだけ `update` する。`WorldSaveEvent` でも同じ走査をすぐ行う。
   - .mca に書かれるのはチャンクが保存されたとき（自動保存・チャンクの読み込み解除）なので、反映は保存待ちになる。
   - ブロック変更系のイベントは使わない。ディスクに書かれるまで抽出できないので、イベントで知っても早くならない。更新時刻の走査なら WorldEdit やワールド生成などイベントの出ない変更も拾える。
   - 読み取り中に Paper が書き込んで壊れたチャンクを読んだ場合は、そのリージョンを失敗扱いにして次の走査でやり直す。
3. 抽出は専用のスレッドプール（既定: CPU コア数の半分、最低 1）で行い、メインスレッドでは行わない。

## Alternatives considered

- ブロック変更イベントで汚れたリージョンを記録: 保存されるまで抽出できないので速くならず、イベントの出ない変更（WorldEdit など）を取りこぼす。更新時刻の走査に置き換えた。
- イベントから直接ブロックを読んで即時反映: メインスレッドでのチャンク読み取りが必要で、TPS への影響と実装量が大きい。MVP では保存待ちで割り切る（BlueMap も保存待ち）。将来の改善候補。
- 地図データを jar と同じ場所・ワールドフォルダ内に置く: バックアップ・持ち出しの単位が分かりにくいので `plugins/BriskMap/web/` にまとめた。

## Constraints / Gotchas

- 同じリージョンを 2 つのスレッドで同時に `update` しない（core の前提）。リージョン単位のロックか、1 つのキューで直列化する。
- 地図データの差し替えは原子的（一時ファイル → 名前変更）。Web サーバーは ETag・If-Range で「ヘッダーと本体の版が違う」ことをブラウザに知らせる（M4）。

## maps/index.json（表示画面が最初に読む）

```json
{
  "format": 1,
  "generated": 1790000000000,
  "textures": "textures/26.3/",
  "maps": [
    {
      "id": "world",
      "name": "world",
      "dimension": "minecraft:overworld",
      "spawn": [0, 64, 0],
      "extract": { "caves": "hide", "fluids": "surface", "format": 4, "maxY": null },
      "dataVersion": { "min": 5023, "max": 5023 },
      "regions": [[-1, -1], [0, 0]],
      "updated": 1790000000000
    }
  ]
}
```

- `regions` は出力のあるリージョンの一覧。表示画面は無いリージョンを取りに行かない。
- `textures` はテクスチャがまだ無いとき `null`（表示画面は色だけで描く）。
- `extract.maxY` は切断なしなら `null`、切断ありならワールド Y 座標。ネザーの既定値は 100。
