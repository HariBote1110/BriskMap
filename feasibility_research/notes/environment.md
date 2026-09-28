# 検証環境

## 目的

Mac mini 上ではほかの VM の影響で測定値がばらつくため、専用の検証環境を用意する。

## 環境

| 項目 | 値 |
|---|---|
| Proxmox ノード | Comet（Intel Core i5-10400、6 コア 12 スレッド、4.0GHz 前後、メモリ 32GB） |
| Proxmox | pve-manager 9.1.1、カーネル 6.17.2-1-pve |
| コンテナ | LXC 117 `briskmap-bench`（非特権、nesting=1） |
| OS | Debian 13（テンプレート debian-13-standard_13.6-1） |
| 割り当て | 6 コア、メモリ 12GB、スワップなし、ディスク 64GB（local-lvm、LVM thin） |
| IP | 192.168.0.175（DHCP） |
| Java | OpenJDK 21.0.12.1 |
| 計測道具 | hyperfine 1.19.0、GNU time |

### 配置したもの（`/opt/bench`）

| ファイル | 版 | SHA-256 |
|---|---|---|
| `paper/paper.jar` | Paper 1.21.11 build 132 | `5ffef465eeeb5f2a3c23a24419d97c51afd7dbb4923ff42df9a3f58bba1ccfba` |
| `bluemap-cli/bluemap-5.16-cli.jar` | BlueMap 5.16 CLI | `7940d561890373897f8f6be91a52e765461f40e5be4e1c4401004073ee0d2580` |
| `paper/plugins/chunky.jar` | Chunky 1.4.40 | `2a5477fc80f71012e15ade1ce34dbeb836e17623b28db112492c0f1443c09721` |
| `dl/Dynmap-3.8-spigot.jar` | Dynmap 3.8（CurseForge 公式配布） | `4771dbe8cbb3ec6a3ee080141361de6d822eac55b55aad7c9e5de031423a6dd7` |

EULA: ユーザーの同意（2026-09-28）を得て、Paper の `eula=true` と BlueMap の `accept-download: true` を設定した。

## 基準ワールドの生成

- `server.properties`: `level-seed=20260928`、`view-distance=4`、`simulation-distance=4`
- Paper は `-Xms8G -Xmx8G`
- Chunky: `world world` / `shape square` / `center 0 0` / `radius 5120` → 10,240×10,240 ブロック（リージョン -10..9 の 20×20 = 400 個）
- **注意:** Paper の `chunk-system.worker-threads: -1`（自動）が、このコンテナでは 1 スレッドと判定された（生成速度 約 12〜18 チャンク/秒）。`config/paper-global.yml` で `worker-threads: 5`、`io-threads: 2` に固定して約 105 チャンク/秒になった。

## BlueMap CLI の設定（`/opt/bench/bluemap-cli/config`）

- `core.conf`: `render-thread-count: 6`（抽出器の `--threads 6` と揃える）
- `maps/overworld.conf`: `world: "/opt/bench/paper/world"`、`ignore-missing-light-data: true`
  - Paper（Starlight）は標準の SkyLight/BlockLight を保存しないため、光データ欠落でチャンクを飛ばされないようにした
- nether / end の地図は無効化（`maps-disabled/` に退避）。未生成のため
- 保存先はファイル（`web/maps`、gzip 圧縮、既定値のまま）

## 基準ワールドのチャンク形式（実測で確認）

- DataVersion 4671、チャンクはすべて zlib 圧縮（種別 2）
- セクションは Y=-5〜19 の 25 個（-5 は光用で、ブロックは -4〜19）
- Heightmaps は 4 種、各 long[37]（9 ビット × 7 値/long）
- **光データは `starlight.*` という Paper 独自形式でのみ保存されている。** 夜表示などで光が必要な場合は、独自形式を読むか自前で計算する必要がある

## 版の選定理由

- 最新の Minecraft は 26.3 だが、Dynmap（3.8）は 1.21.11 まで、最新の BlueMap（5.28）は 26.x のみの対応。
- 3 者を同じワールドで比べるため、**共通して対応する 1.21.11** を採用した。BlueMap はこの版に対応する 5.16 を使う。

## ばらつきの要因（既知）

- Comet 上には常駐 VM がある（`1060VM` 10vCPU・GPU パススルー、`vvx-yomiage` 4vCPU、`clusterboard` LXC 1 コア）。測定時はそれらの負荷を記録する。
- CPU の固定割り当て（コア固定）は未実施。ばらつきが大きければ検討する。

## 接続

```
ssh root@192.168.0.175
```

※ 同じ IP が以前ほかのホストに割り当てられていたため、手元の `~/.ssh/known_hosts` に古いホスト鍵が残っている。
