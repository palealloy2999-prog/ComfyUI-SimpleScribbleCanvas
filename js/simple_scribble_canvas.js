import { app } from "../../scripts/app.js";

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
    drawingArea.append(canvas, cursor);
    root.append(toolbar, drawingArea);
    const ctx = canvas.getContext("2d");
    const events = new AbortController();
    let color = "#000000", pointer = null, last = null, ready = false, revision = 0;
    let saved = data.value || "";
    let hover = null;
    let pendingResizes = [];
    const updateCursor = () => {
        cursor.style.display = ready && hover ? "block" : "none";
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
        if (event?.type === "pointerup") drawTo(point(event));
        const id = pointer;
        pointer = null;
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
        persist();
    };
    const layout = () => {
        label.textContent = `${canvas.width} × ${canvas.height} px`;
        canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
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
        if (!ready) {
            pendingResizes.push(size());
            return;
        }
        end();
        if (resizeCanvas(...size())) persist();
        layout();
    };
    const restore = (value) => {
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
    // Retain the real parameter's positional value while removing its text editor.
    data.inputEl?.remove();
    data.type = "converted-widget";
    data.computeSize = () => [0, -4];
    data.draw = () => {};
    Object.defineProperty(data, "value", { configurable: true, get: () => saved, set: restore });
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
        };
        button.addEventListener("click", select, { signal: events.signal });
        buttons.push([button, ink]); toolbar.append(button);
    }
    restoreBrushState();
    const clear = document.createElement("button");
    clear.textContent = "Clear";
    clear.addEventListener("click", () => { ++revision; end(); ready = true; const [w,h] = size(); canvas.width=w; canvas.height=h; fill(); persist(); layout(); }, { signal: events.signal });
    toolbar.append(clear, label);
    for (const event of ["pointerdown", "pointermove", "pointerup", "pointercancel", "dblclick"]) {
        root.addEventListener(event, event => event.stopPropagation(), { signal: events.signal });
    }
    const point = event => {
        const rect = canvas.getBoundingClientRect();
        return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height];
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
        return result;
    };
    canvas.addEventListener("pointerdown", event => {
        trackCursor(event);
        if (!ready || pointer !== null || event.button !== 0) return;
        event.preventDefault();
        pointer = event.pointerId; canvas.setPointerCapture(pointer); last = point(event);
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(...last, Number(widgets.brush_size.value) / 2, 0, Math.PI * 2); ctx.fill();
    }, { signal: events.signal });
    canvas.addEventListener("pointermove", event => {
        trackCursor(event);
        if (pointer !== event.pointerId) return;
        event.preventDefault();
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
        getMinHeight: () => 44 + Math.max(100, (node.size[0] - 24) * canvas.height / canvas.width),
        getMaxHeight: () => 44 + Math.max(100, (node.size[0] - 24) * canvas.height / canvas.width),
    });
    display.serialize = false;
    const configure = node.onConfigure;
    node.onConfigure = function (...args) {
        const result = configure?.apply(this, args);
        widgets.multiple.value = String(widgets.multiple.value);
        restoreBrushState();
        restore(data.value);
        return result;
    };
    const removed = node.onRemoved;
    node.onRemoved = function (...args) { ++revision; observer.disconnect(); events.abort(); return removed?.apply(this, args); };
    restore(saved);
}

app.registerExtension({
    name: "ComfyUI.SimpleScribbleCanvas",
    nodeCreated(node) {
        if (node.comfyClass === "SimpleScribbleCanvas") createCanvas(node);
    },
});

