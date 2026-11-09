# Simple Scribble Canvas

[English](README.md) | [日本語](README_ja.md)

Create black and white freehand sketches inside a ComfyUI node and output an RGB IMAGE. No external drawing libraries or communication during drawing are used.


<img width="1513" height="1510" alt="image" src="https://github.com/user-attachments/assets/83dae83b-1751-4e4c-bc49-3e70a8ba896d" />

# Install
```
cd custom_node
git clone https://github.com/palealloy2999-prog/ComfyUI-SimpleScribbleCanvas
```

Add **image/Scribble → Simple Scribble Canvas** to your workflow.

# How to use

1. **Black / White**: Choose a color and brush size, then drag to draw freehand. White can be used as an eraser.
2. **Clear**: Erase both the drawing and reference image.
3. **Line**: Click the start point, then the end point to confirm a straight line.
4. **Circle / Ellipse**: Click two opposite corners to draw a circle or ellipse inscribed in the rectangle they define.
5. **Paste a reference**: Click the canvas, then press Ctrl+V (Cmd+V on macOS). The image fits inside the canvas with its aspect ratio preserved and is centered at 25% opacity. Existing drawing is unchanged.
6. **下絵移動 (Move Reference)**: Press the button, then drag to move only the reference image. A four-way arrow cursor appears while dragging.

Shapes follow the mouse until confirmed; press Esc or switch modes to cancel. Click the active Line, Circle / Ellipse or Move Reference button again to return to freehand.

Reference images are excluded from IMAGE output, workflow saving and node duplication. On reload, the reference is restored if still in memory; otherwise, the canvas continues without it. Pasting a new reference or pressing Clear resets its position.

Connect `image` to Preview Image or a compatible ControlNet image input. Use a model and preprocessing appropriate for your purpose.

<img width="2276" height="1503" alt="image" src="https://github.com/user-attachments/assets/2f2598a0-61f6-42dd-9a02-6cbf1bbb57e0" />

The drawing PNG is saved as base64 in the workflow JSON and is preserved when duplicating the node. Save the workflow to retain the drawing across sessions. Larger drawings increase the JSON size. Invalid saved data produces an error and is retained until explicitly cleared with Clear. Undo, image file import, layers, transparent backgrounds and pen pressure are not supported.

Resolution changes take effect immediately, adding white margins or cropping around the image center. Strokes are not scaled. Cropped areas cannot be recovered by enlarging the canvas again. Resizing the node changes only the display size.
