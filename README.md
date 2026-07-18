# Hexagonal Game of Life
バイブコーディングで全部終わったんだが？？？？？？？？？？？？？？？？？？？？？？？？？？？？？？？？

## 共有・埋め込み

画面下部の共有ボタンは、盤面・サイズ・ルール・トーラス設定を含むURLをクリップボードへコピーします。URLを開くだけで同じ状態から計算を再開できます。

iframeには共有URLへ `embed=1` を追加します。操作パネルを隠したまま、盤面のクリック／ドラッグ、パン、ズームは利用できます。

```html
<iframe
  src="https://YOUR_SITE/?embed=1&x=32&y=20&rule=B245%2FS25&torus=1&cells=..."
  width="800" height="500" style="border:0"
  title="Hexagonal Life"></iframe>
```
