# 開発・動作確認の環境

## Decision

- ビルドは Gradle Wrapper（9.6.1）。JDK 25 でビルドし、`--release 21` で Java 21 向けのクラスを出す（1.21.11 は Java 21、26.x は Java 25 で動くため）。
- 依存物のキャッシュはリポジトリ内の `.gradle-home/`（gitignore 済み）に置く。ネットワークに出られない作業環境（Codex）でも `GRADLE_USER_HOME=$PWD/.gradle-home ./gradlew --offline build` で動く。依存を増やしたときは、ネットワークのある側で一度 `./gradlew build` を実行してキャッシュに入れる。
- 実サーバーでの確認は Comet の LXC 117（192.168.0.175）の `/opt/dev/` で行う。
  - `/opt/dev/p1211`: Paper 1.21.11 build 132、Java 21、ポート 25601
  - `/opt/dev/p263`: Paper 26.3 build 139（BETA）、Java 25（`/usr/lib/jvm/java-25-openjdk-amd64`）、ポート 25602
  - どちらも `level-seed=20260928`、`view-distance=4`、`online-mode=false`。検証用の基準ワールド（`/opt/bench/paper`）とは別。

## Alternatives considered

- ビルドに Maven: Paper の周辺道具が Gradle 前提のため見送り。
- paperweight-userdev: 内部実装（NMS）を使わないので不要。

## Constraints / Gotchas

- jar の manifest に `paperweight-mappings-namespace: mojang` を入れている。無いと 1.21.x の Paper が読み込み時に jar を変換（remap）する。
- 1.21.11 の Paper は 2026-06-15 で公式サポート終了（UNSUPPORTED）。対応範囲には含めるが、26.x を主に確認する。
