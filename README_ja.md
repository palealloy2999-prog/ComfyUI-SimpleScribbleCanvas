# Simple Scribble Canvas

ComfyUIのノード内で黒・白の手描きラフを作り、RGBのIMAGEを出力します。外部描画ライブラリや描画中の通信は使いません。

# Install
```
cd custom_node
git clone https://github.com/palealloy2999-prog/ComfyUI-SimpleScribbleCanvas
```

ワークフローに **image/Scribble → Simple Scribble Canvas** を追加します。

# how to use

`image` を Preview Image または対応するControlNetの画像入力へ接続してください。用途に合うモデル・前処理を使用します。

描画PNGはワークフローJSON内にbase64で保存され、ノード複製にも引き継がれます。セッションをまたぐ場合はワークフローを保存してください。描画が大きいほどJSONも大きくなります。不正な保存データはエラー表示し、明示的にClearするまで保持します。Undo、画像インポート、レイヤー、透明背景、筆圧は非対応です。

解像度変更は即時反映し、画像の中心を合わせて白い余白を追加・切り抜きします。線は拡大縮小しません。切り落とした部分は再拡張しても戻せません。ノードサイズ変更は表示サイズだけを変えます。

