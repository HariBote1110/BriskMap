# スマホ相当環境でのブラウザ負荷（BlueMap との比較）

## 目的 / 仮説

手元の端末はハイエンドばかりで基準にならないため、Proxmox 上に低性能スマホ相当の環境を作り、BriskMap と BlueMap のブラウザ側負荷を比べる（ユーザー判断、2026-09-29）。

- **目標とする実機:** Snapdragon 680 級の廉価 Android（例: Galaxy A05s、Redmi Note 11）。
  - Geekbench 6: シングル 415、マルチ 1,424（出典: [HWPure](https://hwpure.com/submission/792-sm6225-snapdragon-680-4g-geekbench-6-single-core)、[CPU Monkey](https://www.cpu-monkey.com/en/benchmark-qualcomm_snapdragon_680_4g-geekbench_6_multi_core)。Notebookcheck によるとシングル 412〜436）
  - GPU: Adreno 610
- **H13（使えるか）:** スマホ相当の環境でも、BriskMap は近距離 3D（半径 256 ブロック）の読み込みを **3 秒以内** に終え、カメラ 1 周中の平均 fps が **30 以上**（内蔵 GPU 使用時）。
  - 棄却条件: 3 秒超、または 30 fps 未満。
- **H14（比較）:** スマホ相当の環境でも、読み込み完了までの時間と読み込み中の CPU 時間は BlueMap 以下。

## 環境の作り方（決定事項）

- ホスト: Proxmox の Rumoi（AMD Ryzen 3 4300U、4 コア、内蔵 Radeon。Geekbench 6: シングル 1,208、マルチ 3,523。出典: [Geekbench Browser](https://browser.geekbench.com/processors/amd-ryzen-3-4300u)）
- **CPU:** コンテナの CPU 使用率上限（cpulimit）で絞る（ユーザー判断: ホストの周波数は変更しない）。
  - 4 コア・合計 1.6 コア分に制限 → マルチ性能 ≒ 1.6 × (3,523 / 4) ≒ 1,409（実機 1,424 に合わせる）
  - **限界:** 使用率上限は全体の合計を抑えるだけで、1 スレッド単独の速さは落ちない。1 スレッドは実機の約 2.9 倍速いまま（1,208 / 415）。**結果は実機より楽観的。**
- **GPU:** 2 通り測り、実機はその間と見なす（ユーザー判断）
  - 内蔵 Radeon（Mesa、/dev/dri を渡す）: 楽観側（Adreno 610 より強いと見られる。比率は未確認）
  - ソフトウェア描画（SwiftShader）: 悲観側
- 画面: 412×915、倍率 2.625（描画は 1,082×2,402）、タッチ・モバイル UA を CDP で指定
- メモリ: 3GB
- 計測ハーネス: `tools/clientbench/`（`--mobile`、`--chrome-flags`、`--label` を追加予定）

## 手順

### 構築（2026-09-29）

- LXC 118 `briskmap-phone`（Rumoi、192.168.0.236）: Debian 13、4 コア・cpulimit 1.6、メモリ 3GB、スワップなし、非特権、nesting=1
- Chromium 154.0.8037.57（Debian パッケージ）、Node 20.19.2、Mesa（radeonsi / RADV）
- 内蔵 GPU: Rumoi ホストで `pct set 118 -dev0 /dev/dri/renderD128,mode=0666`（API トークンでは設定できず、ホストの root で実行）
- **CPU 制限の確認:** Node の忙しいループで 5 秒測定。1 スレッド: CPU 5,045 ms（制限されない）。4 スレッド: CPU 8,201 ms ＝ 1.64 コア分（設計どおり）。
- **ヘッドレス Chromium で GPU を使う方法:** `--use-angle=gl-egl --use-gl=angle` で `ANGLE (AMD, AMD Radeon Graphics (radeonsi renoir ACO DRM 3.64 6.17.2-1-pve), OpenGL ES 3.2)`。`--use-angle=vulkan`（ozone 指定なし）・`--use-angle=gl`・`--use-gl=egl` では WebGL2 が使えなかった。`--ozone-platform=headless --use-angle=vulkan --use-vulkan=native` は RADV で動く（今回は未使用）。
- ソフトウェア描画: `--use-angle=swiftshader --enable-unsafe-swiftshader` → `SwiftShader Device (Subzero)`

### 測定

```
NODE_OPTIONS=--experimental-websocket node run.mjs --chrome /usr/bin/chromium --headless --mobile \
  --label phone-sw|phone-gpu --settle-timeout-ms 300000 --chrome-flags "<上記>" \
  --scenarios scenarios-A.json --runs 3 --out results-phone-<sw|gpu>.jsonl
```
（`/opt/phone/run-all.sh`。ソフトウェア描画 → GPU の順）

### 準備中の失敗と対処

- **Node 20 には標準の `WebSocket` が無い。** ハーネスのテストがコンテナ内で約 7 時間 40 分止まり続けた（親が待ち処理の時間切れを見落とした）。`--experimental-websocket`（`NODE_OPTIONS` 経由）で解決。`WebSocket` が無いときは止まらずにエラーを出すよう修正。
- **Linux の `ps` は CPU 時間が秒単位。** `/proc/<pid>/stat` から 10ms 単位で読むよう修正。
- 既知の問題: コンテナ内（Node 20）で、ハーネスのテスト 18 件中 1 件（10 秒の期限切れを待つテスト）が止まる。測定には影響しない。

### 試行（1 回、BriskMap のみ、斜め視点、ソフトウェア描画、修正前の秒単位 CPU）

読み込み完了 6.5 秒、カメラ 1 周中 0.92 fps（p50 983 ms）。CPU のほとんどが GPU プロセス（ソフトウェア描画）。

## 結果（2026-09-29、案 A・テクスチャ付き、各 3 回の中央値、全 36 回有効）

| 描画 | 表示 | 視点 | 読み込み完了 | 読み込み中の CPU | 転送量 | fps | p99 | 1 周中の CPU |
|---|---|---|---:|---:|---:|---:|---:|---:|
| GPU | bluemap | top | 9.7 s | 16.2 s | 14.93 MB | 37.0 | 50 ms | 16.0 s |
| GPU | brisk | top | 3.2 s | 5.5 s | 1.13 MB | 60.0 | 17 ms | 4.7 s |
| GPU | bluemap | oblique | 8.7 s | 14.2 s | 14.93 MB | 57.7 | 33 ms | 14.9 s |
| GPU | brisk | oblique | 3.1 s | 5.5 s | 1.13 MB | 60.0 | 17 ms | 4.7 s |
| GPU | bluemap | low | 8.0 s | 12.6 s | 14.93 MB | 59.9 | 17 ms | 11.3 s |
| GPU | brisk | low | 3.1 s | 5.4 s | 1.13 MB | 60.0 | 17 ms | 4.4 s |
| ソフトウェア | bluemap | top | 13.6 s | 23.5 s | 14.93 MB | 0.4 | 8,766 ms | 18.8 s |
| ソフトウェア | brisk | top | 6.3 s | 12.9 s | 1.13 MB | 0.8 | 2,500 ms | 17.9 s |
| ソフトウェア | bluemap | oblique | 13.6 s | 23.5 s | 14.93 MB | 0.5 | 3,083 ms | 17.8 s |
| ソフトウェア | brisk | oblique | 6.4 s | 13.3 s | 1.13 MB | 0.9 | 3,083 ms | 17.5 s |
| ソフトウェア | bluemap | low | 12.8 s | 22.4 s | 14.93 MB | 0.8 | 2,233 ms | 18.3 s |
| ソフトウェア | brisk | low | 5.9 s | 12.5 s | 1.13 MB | 1.1 | 1,833 ms | 17.6 s |

- 使われた描画: GPU は `ANGLE (AMD, AMD Radeon Graphics (radeonsi renoir …), OpenGL ES 3.2)`、ソフトウェアは `SwiftShader`（全行で記録を確認）。
- **CPU のプロセス種別の内訳は、この測定では取れていない。** Linux の Chromium は子プロセスのコマンドラインを空白区切りに書き換えるため、`--type=` を読めず全部 `other` になった（コミット `925622b` で修正済み、再測定はしていない）。合計値は正しい。

BriskMap の読み込みの内訳（斜め視点、中央値、ナビゲーション開始からの時刻）:

| 時点 | GPU | ソフトウェア |
|---|---:|---:|
| 最初のデータ受信 | 0.39 s | 1.04 s |
| テクスチャ（atlas.png・blocks.json）準備完了 | 1.55 s | 3.10 s |
| チャンクの取得完了 | 2.17 s | 3.90 s |
| 組み立て・転送完了 | 3.08 s | 6.41 s |

## 結論

- **H13（GPU ありで読み込み 3 秒以内・30 fps 以上）: 読み込みは僅差で棄却、fps は採択。** 読み込みは 3.1〜3.2 秒で目標の 3 秒をわずかに超えた。fps はどの視点でも 60（上限に張り付き）。
- **H14（スマホ相当でも BlueMap より軽い）: 採択。** GPU ありで、読み込み完了は BlueMap の 32〜39%、読み込み中の CPU は 34〜43%、1 周中の CPU は 29〜39%。BlueMap は真上視点で 37 fps（p99 50 ms）まで落ちたが、BriskMap は 60 fps を保った。
- **ソフトウェア描画では、どちらも実用にならない**（1 fps 前後）。GPU を持たない端末は現実のスマホにはないので、これは下限の参考値。読み込みは BriskMap が BlueMap の約半分。
- 注意: CPU の 1 スレッドの速さは実機の約 2.9 倍のまま（使用率上限の限界）。**実機ではさらに遅くなる見込み。** GPU も Adreno 610 より強いと見られる。

### 読み込みを 3 秒以内にするための手がかり

- テクスチャの準備に 1.55 秒かかっている。blocks.json（非圧縮 3.66 MB）の JSON 解析が遅い CPU で重いと考えられる（未検証）。ワールドで使うブロックだけに絞る、またはバイナリ形式にする余地がある。
- チャンク取得の完了（2.17 秒）から組み立て完了（3.08 秒）まで約 0.9 秒。

## 次の一手 / 未検証事項

- blocks.json の軽量化（使うブロックだけ、バイナリ化）で読み込み 3 秒以内を狙う
- プロセス種別の内訳付きで再測定
- 単一スレッドの速さも実機に合わせる方法（ホストの周波数固定など。今回はユーザー判断で見送り）
