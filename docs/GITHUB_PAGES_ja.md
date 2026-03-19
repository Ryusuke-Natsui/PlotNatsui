# GitHub Pages 公開メモ

## 公開手順
1. GitHub で新しい repository を作る
2. この zip を解凍して中身をアップロードする
3. `Settings`
4. 左メニューまたはサイドの `Pages`
5. `Source` または `Build and deployment` で `Deploy from a branch`
6. Branch を `main`
7. Folder を `/ (root)`
8. Save

少し待つと公開 URL が表示されます。

## URL が見つからないとき
- `Settings > Pages` を開き直す
- repository トップ画面右側の `Deployments` を確認する
- Actions にエラーがないか見る

## アイコンや PWA が反映されないとき
- ブラウザで強制再読み込み
- DevTools の Application > Service Workers から更新
- キャッシュ削除
- `manifest.webmanifest` と `sw.js` のパスを確認

## ローカル確認
単純な静的ファイルなので、VS Code の Live Server などでも確認できます。  
ただし PWA の一部機能は HTTPS または localhost のみで安定動作します。
