# ADR 0001: 開発着手の判断基準

- 状態: 採択（2026-09-30 開発着手）
- 日付: 2026-09-28

## 背景

BriskMap を作る動機は個人的な興味であり、BlueMap という強い既存品がある。意味のないものを作らないため、着手前に実現性検証を行い、数値で判断する。

## 決定

同じ基準ワールドで BlueMap（CLI 版）と比べ、次の**両方**を満たした場合にのみ開発に着手する。

| 指標 | 条件 |
|---|---|
| 初回処理時間 | BlueMap の初回描画より **10 倍以上速い** |
| 保存容量 | BlueMap の出力の **1/3 以下** |

補助指標（判断材料だが必須条件ではない）:

- ファイル数
- Dynmap との比較値
- 2D 表示の初回表示時間と fps（ブラウザ側描画の成否）

## 満たさなかった場合

開発しない。検証結果は `feasibility_research/notes/` に棄却記録として残す。

## 留意点

- BriskMap の処理は「取り出しのみ」、BlueMap は「描画まで」なので、処理の範囲が異なる。ブラウザ側に移る負荷は別途測定する（3D の組み立て時間など）。

## 結果（2026-09-30）

両条件とも満たしたため、開発に着手する。

| 指標 | 条件 | 結果 | 記録 |
|---|---|---|---|
| 初回処理時間 | 10 倍以上速い | **24〜25 倍**（BlueMap 7,751 秒 → 約 310〜318 秒） | [extract-vs-bluemap.md](../../feasibility_research/notes/extract-vs-bluemap.md) |
| 保存容量 | 1/3 以下 | **4.7〜12.3%**（2D＋3D、ファイル数 110,932 → 968） | 同上 |

補助指標（ブラウザ側の負荷）も BlueMap を下回った。

- PC: 読み込み完了 約 0.67 秒（BlueMap 約 1.5 秒）、転送量 7.5%、描画中 CPU 38〜53%（[client-load-vs-bluemap.md](../../feasibility_research/notes/client-load-vs-bluemap.md)、[mesher-perf.md](../../feasibility_research/notes/mesher-perf.md)）
- スマホ相当（GPU あり）: 読み込み完了 2.3〜2.4 秒・60 fps（BlueMap 8〜10 秒・37〜60 fps）（[phone-equivalent.md](../../feasibility_research/notes/phone-equivalent.md)）
