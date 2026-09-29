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

（構築後に記入）

## 結果

（測定後に記入）

## 結論

（測定後に記入）
