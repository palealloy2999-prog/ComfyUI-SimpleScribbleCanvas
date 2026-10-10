from comfy_api.latest import ComfyExtension
from .nodes import SimpleScribbleCanvas

WEB_DIRECTORY = "./js"


class SimpleScribbleCanvasExtension(ComfyExtension):
    async def get_node_list(self):
        return [SimpleScribbleCanvas]


async def comfy_entrypoint():
    return SimpleScribbleCanvasExtension()
