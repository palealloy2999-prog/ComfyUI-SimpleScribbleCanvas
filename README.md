# Simple Scribble Canvas

Draw black and white freehand sketches inside a ComfyUI node and output an RGB IMAGE. No external drawing libraries or communication during drawing are used.


<img width="1513" height="1510" alt="image" src="https://github.com/user-attachments/assets/83dae83b-1751-4e4c-bc49-3e70a8ba896d" />


# Install
```
cd custom_node
git clone https://github.com/palealloy2999-prog/ComfyUI-SimpleScribbleCanvas
```

Add **image/Scribble → Simple Scribble Canvas** to your workflow.

# how to use

Connect `image` to Preview Image or a compatible ControlNet image input. Use a model and preprocessing appropriate for your purpose.

<img width="2276" height="1503" alt="image" src="https://github.com/user-attachments/assets/2f2598a0-61f6-42dd-9a02-6cbf1bbb57e0" />

The drawing PNG is saved as base64 in the workflow JSON and is preserved when duplicating the node. Save the workflow to retain the drawing across sessions. Larger drawings increase the JSON size. Invalid saved data produces an error and is retained until explicitly cleared with Clear. Undo, image import, layers, transparent backgrounds and pen pressure are not supported.

Resolution changes take effect immediately, adding white margins or cropping while keeping the image centered. Strokes are not scaled. Cropped areas cannot be recovered by enlarging the canvas again. Resizing the node changes only the display size.
