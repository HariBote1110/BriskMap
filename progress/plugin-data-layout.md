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

`World#getWorldFolder()` を起点に、次の順で最初に存在するものを使う（[world-format-by-version.md](world-format-by-version.md)）。

1. `<worldFolder>/dimensions/<namespace>/<path>/region`（26.x。`<namespace>:<path>` は `World#getKey()`）
2. `<worldFolder>/region`（1.21.x のオーバーワールド）
3. `<worldFolder>/DIM-1/region`・`<worldFolder>/DIM1/region`（1.21.x のネザー・エンド）

### 更新の流れ

1. 起動時: 全リージョンを `update`（出力が無い・設定が変わったリージョンは全体抽出、それ以外は .mca のチャンク時刻が変わったチャンクだけ抽出）。
2. 稼働中: ブロック変更系のイベントで「汚れたリージョン」を記録するだけにする。定期的に（既定 30 秒ごと）汚れたリージョンを `update` する。
   - .mca に書かれるのはチャンクが保存されたとき（自動保存・チャンクの読み込み解除）なので、反映は保存待ちになる。
   - イベントを取りこぼしても、次回起動時の `update` で .mca の時刻から追いつく。
3. 抽出は専用のスレッドプール（既定: CPU コア数の半分、最低 1）で行い、メインスレッドでは行わない。

## Alternatives considered

- イベントから直接ブロックを読んで即時反映: メインスレッドでのチャンク読み取りが必要で、TPS への影響と実装量が大きい。MVP では保存待ちで割り切る（BlueMap も保存待ち）。将来の改善候補。
- 地図データを jar と同じ場所・ワールドフォルダ内に置く: バックアップ・持ち出しの単位が分かりにくいので `plugins/BriskMap/web/` にまとめた。

## Constraints / Gotchas

- 同じリージョンを 2 つのスレッドで同時に `update` しない（core の前提）。リージョン単位のロックか、1 つのキューで直列化する。
- 地図データの差し替えは原子的（一時ファイル → 名前変更）。Web サーバーは ETag・If-Range で「ヘッダーと本体の版が違う」ことをブラウザに知らせる（M4）。
