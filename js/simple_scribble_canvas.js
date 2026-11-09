import { app } from "../../scripts/app.js";

// Images remain session-only; weak references allow the browser to reclaim them.
const referenceImages = new WeakMap();

function getReferenceImages(graph) {
    if (!graph) return;
    let scopes = referenceImages.get(graph);
    if (!scopes) referenceImages.set(graph, scopes = new Map());
    let images = scopes.get(graph.id);
    if (!images) scopes.set(graph.id, images = new Map());
    return images;
}

export function roundHalfEven(value) {
    const lower = Math.floor(value);
    const fraction = value - lower;
    return fraction < 0.5 ? lower : fraction > 0.5 ? lower + 1 : lower % 2 === 0 ? lower : lower + 1;
}

export function calculateResolution(aspectRatio, megapixels, multiple) {
    const [w, h] = aspectRatio.split(" ")[0].split(":").map(Number);
    const scale = Math.sqrt(Number(megapixels) * 1024 * 1024 / (w * h));
    return [roundHalfEven(w * scale / Number(multiple)) * Number(multiple),
        roundHalfEven(h * scale / Number(multiple)) * Number(multiple)];
}

function createCanvas(node) {
    const widgets = Object.fromEntries(node.widgets.map(w => [w.name, w]));
    // Combo arrows compare String(value) against the displayed options.
    for (const name of ["multiple", "brush_size"]) {
        const widget = widgets[name];
        widget.options.values = widget.options.values.map(String);
        widget.value = String(widget.value);
        widget.serializeValue = () => Number(widget.value);
    }
    const data = widgets.drawing;
    const root = document.createElement("div");
    root.style.cssText = "width:100%;display:flex;flex-direction:column;gap:6px;box-sizing:border-box;padding:4px;";
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap";
    const label = document.createElement("span");
    label.style.cssText = "color:var(--input-text,#ddd);font-size:12px";
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:auto;display:block;touch-action:none;cursor:none;background:white;";
    const drawingArea = document.createElement("div");
    drawingArea.style.cssText = "position:relative;width:100%;overflow:hidden";
    const cursor = document.createElement("div");
    cursor.style.cssText = "position:absolute;display:none;pointer-events:none;border:1px solid black;box-shadow:0 0 0 1px white;border-radius:50%;box-sizing:border-box;transform:translate(-50%,-50%);";
    const preview = document.createElement("canvas");
    preview.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    const reference = document.createElement("canvas");
    reference.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0.25;mix-blend-mode:multiply;";
    drawingArea.style.isolation = "isolate";
    drawingArea.append(canvas, preview, reference, cursor);
    canvas.tabIndex = 0;
    root.append(toolbar, drawingArea);
    const ctx = canvas.getContext("2d");
    const previewCtx = preview.getContext("2d");
    const referenceCtx = reference.getContext("2d");
    const events = new AbortController();
    let color = "#000000", pointer = null, last = null, ready = false, revision = 0;
    let saved = data.value || "";
    let hover = null;
    let pendingResizes = [];
    let referenceImage = null, pasteRevision = 0;
    let referenceOffset = [0, 0];
    let referenceCache = null;
    const clearReference = () => {
        ++pasteRevision;
        referenceOffset = [0, 0];
        if (referenceImage) {
            referenceCache?.delete(node.properties?.scribble_reference);
            referenceImage.close(); referenceImage = null;
        }
        if (node.properties) delete node.properties.scribble_reference;
        referenceCtx.clearRect(0, 0, reference.width, reference.height);
    };
    const restoreReference = () => {
        referenceCache = getReferenceImages(node.graph);
        const cached = referenceCache?.get(node.properties?.scribble_reference);
        referenceImage = cached?.nodeId === node.id ? cached.image.deref() || null : null;
        referenceOffset = referenceImage ? cached.offset : [0, 0];
        if (referenceCache) {
            for (const [key, entry] of referenceCache) {
                if (!entry.image.deref()) referenceCache.delete(key);
            }
        }
    };
    const renderReference = (image = referenceImage, offset = referenceOffset) => {
        reference.width = canvas.width; reference.height = canvas.height;
        referenceCtx.clearRect(0, 0, reference.width, reference.height);
        if (!image) return;
        const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
        const w = image.width * scale, h = image.height * scale;
        referenceCtx.imageSmoothingEnabled = true;
        referenceCtx.imageSmoothingQuality = "high";
        referenceCtx.drawImage(image, (canvas.width - w) / 2 + offset[0], (canvas.height - h) / 2 + offset[1], w, h);
    };
    let mode = "freehand", shapeStart = null, shapeEnd = null;
    const cancelShape = () => {
        shapeStart = null; shapeEnd = null;
        previewCtx.clearRect(0, 0, preview.width, preview.height);
    };
    const drawShape = (context, start, finish) => {
        context.strokeStyle = color; context.lineWidth = Number(widgets.brush_size.value);
        context.lineCap = "round"; context.lineJoin = "round";
        context.beginPath();
        const dx = finish[0] - start[0], dy = finish[1] - start[1];
        if (mode === "ellipse" && dx !== 0 && dy !== 0) {
            context.ellipse((start[0] + finish[0]) / 2, (start[1] + finish[1]) / 2,
                Math.abs(dx) / 2, Math.abs(dy) / 2, 0, 0, Math.PI * 2);
        } else {
            context.moveTo(...start); context.lineTo(...finish);
        }
        context.stroke();
    };
    const renderPreview = () => {
        previewCtx.clearRect(0, 0, preview.width, preview.height);
        if (shapeStart && shapeEnd) drawShape(previewCtx, shapeStart, shapeEnd);
    };
    const updateCursor = () => {
        canvas.style.cursor = mode === "move-reference" ? (pointer !== null ? "move" : "default") : "none";
        cursor.style.display = ready && hover && mode !== "move-reference" ? "block" : "none";
        if (!hover) return;
        const scaleX = canvas.clientWidth / canvas.width;
        const scaleY = canvas.clientHeight / canvas.height;
        cursor.style.left = `${hover[0] * scaleX}px`;
        cursor.style.top = `${hover[1] * scaleY}px`;
        cursor.style.width = `${Math.max(1, Number(widgets.brush_size.value) * scaleX)}px`;
        cursor.style.height = `${Math.max(1, Number(widgets.brush_size.value) * scaleY)}px`;
    };
    const observer = new ResizeObserver(updateCursor);
    observer.observe(canvas);
    const size = () => calculateResolution(widgets.aspect_ratio.value, widgets.megapixels.value, widgets.multiple.value);
    const fill = () => { ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); };
    const persist = () => {
        if (!ready) return;
        saved = canvas.toDataURL("image/png");
        node.setDirtyCanvas(true, true);
    };
    const end = (event) => {
        if (pointer === null || (event && event.pointerId !== pointer)) return;
        if (event?.type === "pointerup") {
            if (mode === "move-reference") moveReference(point(event));
            else drawTo(point(event));
        }
        const id = pointer;
        pointer = null;
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
        updateCursor();
        if (mode !== "move-reference") persist();
    };
    const layout = () => {
        label.textContent = `${canvas.width} × ${canvas.height} px`;
        canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
        preview.width = canvas.width; preview.height = canvas.height;
        renderPreview();
        renderReference();
        updateCursor();
        const minimum = node.computeSize();
        node.setSize([Math.max(300, node.size[0]), minimum[1]]);
        node.setDirtyCanvas(true, true);
    };
    const resizeCanvas = (width, height) => {
        if (canvas.width === width && canvas.height === height) return false;
        const previous = document.createElement("canvas");
        previous.width = canvas.width; previous.height = canvas.height;
        previous.getContext("2d").drawImage(canvas, 0, 0);
        canvas.width = width; canvas.height = height;
        fill();
        ctx.drawImage(previous, Math.floor((width - previous.width) / 2), Math.floor((height - previous.height) / 2));
        return true;
    };
    const resize = () => {
        cancelShape();
        if (!ready) {
            pendingResizes.push(size());
            return;
        }
        end();
        if (resizeCanvas(...size())) persist();
        layout();
    };
    const restore = (value) => {
        cancelShape(); ++pasteRevision;
        const ticket = ++revision;
        pendingResizes = [];
        saved = value || "";
        ready = false;
        pointer = null;
        const [width, height] = size();
        if (!saved) {
            canvas.width = width; canvas.height = height; fill();
            ready = true; layout(); return;
        }
        const image = new Image();
        image.onload = () => {
            if (ticket !== revision) return;
            const [w, h] = pendingResizes.length ? [width, height] : size();
            canvas.width = w; canvas.height = h; fill();
            ctx.drawImage(image, Math.floor((w - image.width) / 2), Math.floor((h - image.height) / 2));
            for (const dimensions of pendingResizes) resizeCanvas(...dimensions);
            ready = true;
            // Only explicit size changes may replace a restored PNG.
            if (pendingResizes.length) persist();
            pendingResizes = [];
            layout();
        };
        image.onerror = () => {
            if (ticket !== revision) return;
            label.textContent = "Cannot restore drawing. Saved data retained; reload or Clear.";
        };
        image.src = saved;
    };
    root.addEventListener("paste", async event => {
        const item = Array.from(event.clipboardData?.items || []).find(item => item.type.startsWith("image/"));
        if (!item) return;
        event.preventDefault(); event.stopPropagation();
        const file = item.getAsFile();
        if (!file) return;
        end(); cancelShape();
        const ticket = ++pasteRevision;
        const graph = node.graph, graphId = graph?.id;
        const cache = getReferenceImages(graph);
        if (!cache) return;
        let image;
        try {
            const key = Array.from(crypto.getRandomValues(new Uint8Array(16)),
                byte => byte.toString(16).padStart(2, "0")).join("");
            image = await createImageBitmap(file);
            if (ticket !== pasteRevision || node.graph !== graph || graph.id !== graphId) return;
            const entry = { nodeId: node.id, image: new WeakRef(image), offset: [0, 0] };
            renderReference(image, entry.offset);
            node.properties ??= {};
            referenceCache?.delete(node.properties.scribble_reference);
            referenceImage?.close();
            referenceImage = image;
            referenceOffset = entry.offset;
            referenceCache = cache;
            node.properties.scribble_reference = key;
            cache.set(key, entry);
            label.textContent = `${canvas.width} × ${canvas.height} px`;
        } catch {
            if (ticket !== pasteRevision || node.graph !== graph || graph.id !== graphId) return;
            renderReference();
            label.textContent = "Cannot paste reference image. Copy an image and try again.";
        } finally {
            if (image && image !== referenceImage) image.close();
        }
    }, { signal: events.signal });
    // Retain the real parameter's positional value while removing its text editor.
    data.inputEl?.remove();
    data.type = "converted-widget";
    data.computeSize = () => [0, -4];
    data.draw = () => {};
    Object.defineProperty(data, "value", {
        configurable: true,
        get: () => saved,
        set(value) {
            // Execution may write the serialized value back to the widget.
            if ((value || "") !== saved) restore(value);
        },
    });
    data.serializeValue = () => { end(); return saved; };
    const buttons = [];
    let brushSizes = { "#000000": 1, "#ffffff": 32 };
    const saveBrushState = () => {
        node.properties ??= {};
        node.properties.scribble_brush = {
            color, black: brushSizes["#000000"], white: brushSizes["#ffffff"],
        };
        node.setDirtyCanvas(true, true);
    };
    const updateColorButtons = () => {
        for (const [item, ink] of buttons) {
            item.setAttribute("aria-pressed", String(ink === color));
            item.style.outline = ink === color ? "2px solid #49a5ff" : "none";
        }
    };
    const restoreBrushState = () => {
        const state = node.properties?.scribble_brush;
        color = state?.color === "#ffffff" ? "#ffffff" : "#000000";
        brushSizes = {
            "#000000": state?.black ?? Number(widgets.brush_size.value),
            "#ffffff": state?.white ?? 32,
        };
        widgets.brush_size.value = String(brushSizes[color]);
        updateColorButtons();
        updateCursor();
    };
    for (const [text, ink] of [["Black", "#000000"], ["White", "#ffffff"]]) {
        const button = document.createElement("button");
        button.textContent = text;
        const select = () => {
            end();
            brushSizes[color] = Number(widgets.brush_size.value);
            color = ink;
            widgets.brush_size.value = String(brushSizes[color]);
            updateColorButtons();
            updateCursor();
            saveBrushState();
            renderPreview();
        };
        button.addEventListener("click", select, { signal: events.signal });
        buttons.push([button, ink]); toolbar.append(button);
    }
    restoreBrushState();
    const clear = document.createElement("button");
    clear.textContent = "Clear";
    clear.addEventListener("click", () => { ++revision; end(); cancelShape(); clearReference(); ready = true; const [w,h] = size(); canvas.width=w; canvas.height=h; fill(); persist(); layout(); }, { signal: events.signal });
    toolbar.append(clear);
    const toolButtons = [];
    for (const [text, tool] of [["Line", "line"], ["Circle / Ellipse", "ellipse"], ["下絵移動", "move-reference"]]) {
        const button = document.createElement("button");
        button.textContent = text;
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
            end(); cancelShape();
            mode = mode === tool ? "freehand" : tool;
            updateCursor();
            for (const [item, itemTool] of toolButtons) {
                item.setAttribute("aria-pressed", String(mode === itemTool));
                item.style.outline = mode === itemTool ? "2px solid #49a5ff" : "none";
            }
        }, { signal: events.signal });
        toolButtons.push([button, tool]); toolbar.append(button);
    }
    toolbar.append(label);
    root.addEventListener("keydown", event => {
        if (event.key !== "Escape" || !shapeStart) return;
        event.preventDefault(); event.stopPropagation(); cancelShape();
    }, { signal: events.signal });
    for (const event of ["pointerdown", "pointermove", "pointerup", "pointercancel", "dblclick"]) {
        root.addEventListener(event, event => event.stopPropagation(), { signal: events.signal });
    }
    const point = event => {
        const rect = canvas.getBoundingClientRect();
        return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height];
    };
    const moveReference = next => {
        referenceOffset[0] += next[0] - last[0];
        referenceOffset[1] += next[1] - last[1];
        last = next;
        renderReference();
    };
    const drawTo = next => {
        if (next[0] === last[0] && next[1] === last[1]) return;
        ctx.strokeStyle = color; ctx.lineWidth = Number(widgets.brush_size.value);
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...next); ctx.stroke(); last = next;
    };
    const trackCursor = event => {
        const position = point(event);
        hover = position[0] >= 0 && position[0] <= canvas.width && position[1] >= 0 && position[1] <= canvas.height ? position : null;
        updateCursor();
    };
    canvas.addEventListener("pointerenter", trackCursor, { signal: events.signal });
    canvas.addEventListener("pointerleave", () => { hover = null; updateCursor(); }, { signal: events.signal });
    const brushCallback = widgets.brush_size.callback;
    widgets.brush_size.callback = function (...args) {
        const result = brushCallback?.apply(this, args);
        brushSizes[color] = Number(widgets.brush_size.value);
        saveBrushState();
        updateCursor();
        renderPreview();
        return result;
    };
    canvas.addEventListener("pointerdown", event => {
        trackCursor(event);
        if (!ready || pointer !== null || event.button !== 0 || event.isPrimary === false) return;
        event.preventDefault();
        canvas.focus({ preventScroll: true });
        if (mode === "move-reference") {
            if (!referenceImage) return;
            pointer = event.pointerId; last = point(event);
            canvas.setPointerCapture(pointer);
            updateCursor();
            return;
        }
        if (mode !== "freehand") {
            if (!shapeStart) {
                shapeStart = point(event); shapeEnd = shapeStart; renderPreview();
            } else {
                drawShape(ctx, shapeStart, point(event)); cancelShape(); persist();
            }
            return;
        }
        pointer = event.pointerId; canvas.setPointerCapture(pointer); last = point(event);
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(...last, Number(widgets.brush_size.value) / 2, 0, Math.PI * 2); ctx.fill();
    }, { signal: events.signal });
    canvas.addEventListener("pointermove", event => {
        if (event.isPrimary === false) return;
        trackCursor(event);
        if (shapeStart) {
            shapeEnd = point(event); renderPreview();
        }
        if (pointer !== event.pointerId) return;
        event.preventDefault();
        if (mode === "move-reference") { moveReference(point(event)); return; }
        const samples = event.getCoalescedEvents?.();
        for (const sample of samples?.length ? samples : [event]) drawTo(point(sample));
    }, { signal: events.signal });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
        canvas.addEventListener(event, end, { signal: events.signal });
    }
    for (const name of ["aspect_ratio", "megapixels", "multiple"]) {
        const original = widgets[name].callback;
        widgets[name].callback = function (...args) { const result = original?.apply(this, args); resize(); return result; };
    }
    const display = node.addDOMWidget("scribble_canvas", "scribble", root, {
        serialize: false, hideOnZoom: false,
        getMinHeight: () => 12 + Math.max(32, toolbar.offsetHeight || 32) + Math.max(100, (node.size[0] - 24) * canvas.height / canvas.width),
        getMaxHeight: () => 12 + Math.max(32, toolbar.offsetHeight || 32) + Math.max(100, (node.size[0] - 24) * canvas.height / canvas.width),
    });
    display.serialize = false;
    const configure = node.onConfigure;
    node.onConfigure = function (...args) {
        const result = configure?.apply(this, args);
        widgets.multiple.value = String(widgets.multiple.value);
        restoreBrushState();
        restoreReference();
        restore(data.value);
        return result;
    };
    const removed = node.onRemoved;
    node.onRemoved = function (...args) { ++revision; ++pasteRevision; referenceImage = null; referenceCache = null; observer.disconnect(); events.abort(); return removed?.apply(this, args); };
    restore(saved);
}

app.registerExtension({
    name: "ComfyUI.SimpleScribbleCanvas",
    nodeCreated(node) {
        if (node.comfyClass === "SimpleScribbleCanvas") createCanvas(node);
    },
});

