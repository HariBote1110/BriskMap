# 設計判断の記録（索引）

新しいものが上。

- [cave-hiding-reachability.md](cave-hiding-reachability.md) — 洞窟の省略を「外から 16 ブロック以内でたどり着けるか」に変更。リージョンの境目も隣を読む。見えるのに消えていた面（約 4.5%）が 0 に
- [m5-phone-benchmark.md](m5-phone-benchmark.md) — 本番の表示画面はスマホ相当環境で読み込み 2.2〜2.3 秒・60 fps（BlueMap 8〜12 秒）。展開を WASM に移したのが決め手
- [texture-generator.md](texture-generator.md) — 生成世代による旧テクスチャ成果物の再生成
- [viewer-progress.md](viewer-progress.md) — 3D 表示の進捗母数とリージョン読込判定
- [plugin-data-layout.md](plugin-data-layout.md) — 保存場所（`plugins/BriskMap/web/`）、リージョンフォルダの解決順、更新の流れ（保存待ち＋定期 update）
- [world-format-by-version.md](world-format-by-version.md) — 1.21.11〜26.3 のリージョンの場所とブロック状態の書き方の違い（26.3 で新形式）
- [dev-environment.md](dev-environment.md) — ビルド（Gradle・Java 21 向け）と、実サーバー確認用の Paper 1.21.11 / 26.3 環境
