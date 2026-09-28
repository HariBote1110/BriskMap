# 検証記録の索引

新しいものが上。

- [client-load-vs-bluemap.md](client-load-vs-bluemap.md) — （測定中）同じカメラ・同じ表示範囲でのブラウザ側の負荷（転送量・CPU・GPU メモリ・fps）を BlueMap と比較
- [browser-meshing.md](browser-meshing.md) — ブラウザでの 3D 組み立ては WASM・Worker 4 本で半径 16 チャンク約 0.2 秒（H3・H4 採択、H5 一部棄却）。課題は頂点の量
- [extract-vs-bluemap.md](extract-vs-bluemap.md) — 地表データ抽出は BlueMap 初回描画より 24〜25 倍速く、容量は 3.3〜7.3%（H1・H2 とも採択）
- [environment.md](environment.md) — Comet 上の検証用コンテナ（LXC 117）の構成と、Minecraft 1.21.11 を選んだ理由
