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

# how to use

`image` を Preview Image または対応するControlNetの画像入力へ接続してください。用途に合うモデル・前処理を使用します。

<img width="2276" height="1503" alt="image" src="https://github.com/user-attachments/assets/2f2598a0-61f6-42dd-9a02-6cbf1bbb57e0" />

描画PNGはワークフローJSON内にbase64で保存され、ノード複製にも引き継がれます。セッションをまたぐ場合はワークフローを保存してください。描画が大きいほどJSONも大きくなります。不正な保存データはエラー表示し、明示的にClearするまで保持します。Undo、画像インポート、レイヤー、透明背景、筆圧は非対応です。

解像度変更は即時反映し、画像の中心を合わせて白い余白を追加・切り抜きします。線は拡大縮小しません。切り落とした部分は再拡張しても戻せません。ノードサイズ変更は表示サイズだけを変えます。

