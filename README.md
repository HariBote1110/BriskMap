# BriskMap

Paper 向けの Web 地図プラグイン。サーバーでは地図を描かず、ワールドの地表部分だけを取り出して小さなファイルに保存し、3D・2D の描画はブラウザで行う。

- 初回の処理が速い（検証では BlueMap の初回描画の 24〜25 倍）
- 保存容量が小さく、ファイル数が少ない（BlueMap の 5〜12%、1 リージョン 2 ファイル）
- `plugins/BriskMap/web/` をコピーすれば、地図をそのまま別の場所へ持ち出せる

> 開発中（0.1.0 Alpha）。プレイヤーの位置表示・マーカー・遠景などはまだ無い。予定は [markdown/Roadmap.md](markdown/Roadmap.md)。

## 対応環境

| 項目 | 対応 |
|---|---|
| サーバー | Paper 1.21.11・26.1.x・26.2・26.3（1 つの jar で共通） |
| Java | サーバーの版が求めるもの（1.21.11 は 21 以上、26.x は 25 以上） |
| ブラウザ | WebGL2 に対応した現行のブラウザ（Chrome・Edge・Firefox・Safari、スマホを含む） |

## 導入

1. `BriskMap-<版>.jar` を `plugins/` に置いてサーバーを起動する。
2. 起動すると全ワールドの抽出が裏で始まる。進み具合は `/briskmap status` で見られる。
3. ブラウザで `http://<サーバーのアドレス>:8123/` を開く。

### テクスチャ（初回だけ設定が必要）

テクスチャは Mojang の著作物なので、プラグインには入っていない。そのままだと地図は色だけで描かれる。テクスチャを使うには次のどちらかを行う。

- **自動で取得する**: `plugins/BriskMap/config.yml` の `textures.accept-mojang-download` を `true` にして `/briskmap reload`。サーバーと同じ版の Minecraft クライアント jar を Mojang の公式サーバーから取得し、テクスチャを作る。**これを有効にすることは [Minecraft EULA](https://www.minecraft.net/en-us/eula) に同意することを意味する。**
- **手で置く**（ネットに出られないサーバー向け）: クライアント jar を `plugins/BriskMap/cache/minecraft-client-<版>.jar`（例: `minecraft-client-26.3.jar`）として置き、`/briskmap textures`。

作られたテクスチャは `plugins/BriskMap/web/textures/<版>/` に入る。サーバーの版を上げると、古い版のテクスチャは自動で消える。

## 設定（`plugins/BriskMap/config.yml`）

| 項目 | 既定 | 内容 |
|---|---|---|
| `web.enabled` | `true` | 組み込み Web サーバーを使うか |
| `web.bind` | `"0.0.0.0"` | 待ち受けるアドレス。リバースプロキシの裏に置くなら `"127.0.0.1"` |
| `web.port` | `8123` | 待ち受けるポート |
| `web.threads` | `4` | 要求を処理するスレッド数 |
| `extract.threads` | `0` | 抽出に使うスレッド数。`0` は CPU コア数の半分（最低 1） |
| `extract.caves` | `"hide"` | `hide`: 地表から見えない洞窟を省く（容量が大きく減る）。`keep`: 残す |
| `extract.fluids` | `"surface"` | `surface`: 水・溶岩は表面だけ。`volume`: 中身も残す |
| `extract.compression-level` | `6` | 圧縮の強さ（0〜9） |
| `extract.scan-interval-seconds` | `30` | ワールドの変更を調べる間隔 |
| `worlds.exclude` | `[]` | 地図にしないワールド名 |
| `textures.accept-mojang-download` | `false` | 上の「テクスチャ」を参照 |

抽出の設定を変えると、次回の走査で対象の地図が全部作り直される。

## コマンド

権限 `briskmap.admin`（既定は OP）。

| コマンド | 内容 |
|---|---|
| `/briskmap status` | 地図ごとの進み具合、テクスチャの状態、地図の URL |
| `/briskmap scan [ワールド]` | 変更をすぐ調べて反映する |
| `/briskmap rebuild <ワールド>` | その地図を消して作り直す |
| `/briskmap textures` | テクスチャを作り直す |
| `/briskmap reload` | 設定を読み直す |

## 地図が更新される時機

Minecraft はブロックの変更をすぐにはファイルへ書かない。BriskMap は `.mca` ファイルの更新を定期的に調べ、変わったチャンクだけを取り出し直す。そのため反映は**ワールドの保存（自動保存・`/save-all`・チャンクの読み込み解除）の後**になる。WorldEdit などイベントを出さない変更も同じように拾う。

## 保存場所と持ち出し

```
plugins/BriskMap/
├── config.yml
├── cache/                 クライアント jar（持ち出し不要）
└── web/                   ← これをコピーすれば地図ごと移せる
    ├── maps/index.json    地図の一覧
    ├── maps/<ワールド名>/r.X.Z.b2d, r.X.Z.b3d
    └── textures/<版>/     atlas.png, blocks.json
```

- 書き込みは「一時ファイル → 名前の差し替え」で行うので、動作中にコピーしても壊れたファイルはできない。
- 変更のあったリージョンのファイルだけが書き換わるので、`rsync` などの差分コピーが効く。
- 表示画面（HTML・JavaScript）は jar の中にあり、`web/` には入っていない。別の Web サーバーで配信する場合は、jar の `web/` の中身も一緒に置く。
- テクスチャは Mojang の著作物なので、`web/textures/` を一般に公開・配布するかは各自の判断で。

## 公開するときの注意

- 組み込み Web サーバーは JDK の簡易 HTTP サーバーで、遅い接続がスレッドを占有しうる。インターネットに公開するなら、nginx などのリバースプロキシの裏に置き（`web.bind: "127.0.0.1"`）、接続数の制限や HTTPS はプロキシ側で行うことを勧める。
- 認証の仕組みはまだ無い。地図を見せたくない場合は公開しないか、プロキシ側で認証をかける。
- 配信するのは `maps/`・`textures/` と表示画面だけで、それ以外のファイルには届かない（`..` やシンボリックリンクでの抜け出しは拒否する）。

## 開発者向け

- 設計と判断の記録: [markdown/](markdown/)（ビジョン・要件・ADR・保存形式）、[progress/](progress/)
- 実現性検証の記録: [feasibility_research/notes/](feasibility_research/notes/INDEX.md)
- ビルド: `./gradlew build`（`paper/build/libs/BriskMap-*.jar`）。表示画面の試験は `cd web && npm test`
- 3D 組み立て処理（WASM）を作り直すには Rust と `wasm32-unknown-unknown` が必要: `bash web/build.sh`

## ライセンス

[MIT](LICENSE)
