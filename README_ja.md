# Simple Scribble Canvas

[English](README.md) | [日本語](README_ja.md)

ComfyUIのノード内で黒・白の手描きラフを作り、RGBのIMAGEを出力します。外部描画ライブラリや描画中の通信は使いません。


<img width="1513" height="1510" alt="image" src="https://github.com/user-attachments/assets/83dae83b-1751-4e4c-bc49-3e70a8ba896d" />

# Install
```
cd custom_node
git clone https://github.com/palealloy2999-prog/ComfyUI-SimpleScribbleCanvas
```

ワークフローに **image/Scribble → Simple Scribble Canvas** を追加します。

# How to use

1. **Black / White**：色とペンの太さを選び、ドラッグで自由に描きます。Whiteは消しゴムとして使えます。
2. **Clear**：描画と下絵を全消去します。
3. **Line**：始点・終点を順にクリックして直線を確定します。
4. **Circle / Ellipse**：対角の2点をクリックし、その四角形に内接する円・楕円を描きます。
5. **下絵の貼り付け**：キャンバスをクリックしてCtrl+V（macOSはCmd+V）。縦横比を維持してキャンバス内に収め、中央に不透明度25%で表示します。既存の描画は変わりません。
6. **下絵移動**：ボタンを押してドラッグすると下絵だけを移動します。ドラッグ中は矢印付き十字カーソルになります。

図形は確定までマウスに追従し、Escやモード変更でキャンセルできます。Line・Circle / Ellipse・下絵移動は、同じボタンを再度押すとフリーハンドに戻ります。

下絵の画像はIMAGE出力・ワークフロー保存・ノード複製には含まれません。再読み込み時はメモリーに残っていれば復元し、なければ下絵なしで続けます。移動位置は貼り直し・Clearでリセットします。

`image` を Preview Image または対応するControlNetの画像入力へ接続してください。用途に合うモデル・前処理を使用します。

<img width="2276" height="1503" alt="image" src="https://github.com/user-attachments/assets/2f2598a0-61f6-42dd-9a02-6cbf1bbb57e0" />

描画PNGはワークフローJSON内にbase64で保存され、ノード複製にも引き継がれます。セッションをまたぐ場合はワークフローを保存してください。描画が大きいほどJSONも大きくなります。不正な保存データはエラー表示し、明示的にClearするまで保持します。Undo、画像ファイルのインポート、レイヤー、透明背景、筆圧は非対応です。

解像度変更は即時反映し、画像の中心を合わせて白い余白を追加・切り抜きします。線は拡大縮小しません。切り落とした部分は再拡張しても戻せません。ノードサイズ変更は表示サイズだけを変えます。

