import base64
import binascii
import math
from io import BytesIO

import numpy as np
import torch
from PIL import Image, UnidentifiedImageError
from comfy_api.latest import io

ASPECT_RATIOS = {
    "1:1 square": (1, 1), "3:4 portrait": (3, 4),
    "5:8 portrait": (5, 8), "9:16 portrait": (9, 16),
    "9:21 portrait": (9, 21), "4:3 landscape": (4, 3),
    "3:2 landscape": (3, 2), "16:9 landscape": (16, 9),
    "21:9 landscape": (21, 9),
}
MEGAPIXELS = ["0.2", "0.3", "0.4", "0.5", "0.6", "0.8", "1.0", "1.2", "1.5", "1.8", "2.0", "2.2", "2.5", "2.8", "3.0"]
MULTIPLES = [8, 16, 32, 64]


def calculate_resolution(aspect_ratio, megapixels, multiple):
    w, h = ASPECT_RATIOS[aspect_ratio]
    scale = math.sqrt(float(megapixels) * 1024 * 1024 / (w * h))
    return round(w * scale / multiple) * multiple, round(h * scale / multiple) * multiple


class SimpleScribbleCanvas(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SimpleScribbleCanvas", display_name="Simple Scribble Canvas",
            category="image/Scribble",
            inputs=[
                io.Combo.Input("aspect_ratio", options=list(ASPECT_RATIOS), default="1:1 square", socketless=True),
                io.Combo.Input("megapixels", options=MEGAPIXELS, default="0.5", socketless=True),
                io.Combo.Input("multiple", options=MULTIPLES, default=16, socketless=True),
                io.Combo.Input("brush_size", options=[1, 2, 3, 5, 16, 32, 64], default=1, socketless=True),
                io.String.Input("drawing", default="", socketless=True),
            ],
            outputs=[io.Image.Output("image")],
        )

    @classmethod
    def execute(cls, aspect_ratio, megapixels, multiple, brush_size, drawing=""):
        size = calculate_resolution(aspect_ratio, megapixels, multiple)
        canvas = Image.new("RGB", size, "white")
        if drawing:
            prefix = "data:image/png;base64,"
            if not drawing.startswith(prefix):
                raise ValueError("Drawing must be a base64 PNG data URL.")
            try:
                data = base64.b64decode(drawing[len(prefix):], validate=True)
                with Image.open(BytesIO(data)) as image:
                    if image.format != "PNG":
                        raise ValueError("Drawing must contain a PNG image.")
                    image.load()
                    rgba = image.convert("RGBA")
                    offset = ((size[0] - image.width) // 2, (size[1] - image.height) // 2)
                    canvas.paste(rgba, offset, rgba)
            except (binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
                raise ValueError("Unable to decode saved scribble PNG.") from error
        pixels = np.asarray(canvas, dtype=np.float32) / 255.0
        return io.NodeOutput(torch.from_numpy(pixels).unsqueeze(0))
