# 検証記録の索引

新しいものが上。

- [mesher-perf.md](mesher-perf.md) — （測定中）AO 追加で遅くなった組み立て処理の高速化。ベースライン WASM greedy 4,384 ms
- [client-load-vs-bluemap.md](client-load-vs-bluemap.md) — 近距離 3D を揃えると BriskMap のブラウザ負荷は BlueMap より軽い。テクスチャ・AO 付きで転送 7.5%、読み込み CPU 57〜71%、描画中 CPU 38〜53%（H6〜H11 採択）
- [browser-meshing.md](browser-meshing.md) — ブラウザでの 3D 組み立ては WASM・Worker 4 本で半径 16 チャンク約 0.2 秒（H3・H4 採択、H5 一部棄却）。課題は頂点の量
- [extract-vs-bluemap.md](extract-vs-bluemap.md) — 地表データ抽出は BlueMap 初回描画より 24〜25 倍速く、容量は 3.3〜7.3%（H1・H2 とも採択）
- [environment.md](environment.md) — Comet 上の検証用コンテナ（LXC 117）の構成と、Minecraft 1.21.11 を選んだ理由
