# Spectrum Plotter PWA Starter

ラマン・PL などのスペクトルデータをブラウザ上で可視化・比較するための **PWA スターター**です。  
GitHub Pages にそのまま置きやすいように、**ビルド不要の構成**（HTML + CSS + JavaScript ES Modules）で用意しています。

## この zip に入っているもの
- PWA の最小実装
- GitHub Pages 公開向けファイル一式
- 設計ロードマップ
- 主要機能の仕様メモ
- サンプルスペクトル
- 将来拡張しやすいモジュール分割

## 現時点で動く主な機能
- txt / csv / tsv の複数ファイル読み込み
- 複数スペクトルの重ね描き
- スペクトルの表示 / 非表示
- 縦方向オフセット
- 簡易ピーク検出
- 検出ピークをクリックして、そのピーク強度が 1 になるよう正規化
- 軸タイトル変更
- テーマ変更
- Plotly によるインタラクティブ表示
- PNG 書き出し
- プロジェクト設定の JSON 保存 / 読み込み
- PWA インストール
- Service Worker による基本キャッシュ

## 想定アーキテクチャ
- `index.html` : UI の骨格
- `src/main.js` : 全体初期化
- `src/state.js` : 状態管理
- `src/parser.js` : ファイルパース
- `src/process.js` : 正規化・オフセット・前処理
- `src/peaks.js` : ピーク検出
- `src/plot.js` : Plotly 描画
- `src/ui.js` : コントロールとイベント配線
- `src/export.js` : 画像 / JSON の書き出し

## GitHub Pages での公開手順
1. この zip を解凍
2. 中身を GitHub リポジトリへ push
3. GitHub の `Settings > Pages`
4. `Deploy from a branch`
5. Branch を `main`、Folder を `/ (root)` に設定
6. 数分待つ
7. 公開 URL が `Pages` の欄に表示される

詳しくは `docs/GITHUB_PAGES_ja.md` を参照してください。

## すぐに次にやるとよいこと
1. ベースライン補正（ALS / 多項式）を追加
2. 複数ピーク同時フィットを追加
3. ROI / inset 図を追加
4. 材料ごとのピークライブラリを追加
5. バッチ処理と一括エクスポートを追加

## 注意
- 現在のピーク検出は軽量な簡易版です。
- 論文用の厳密なフィッティングや背景補正は今後の拡張対象です。
- GitHub Pages 上では HTTPS で配信されるため、PWA の要件を満たしやすいです。
