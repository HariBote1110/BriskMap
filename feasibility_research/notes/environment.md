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
