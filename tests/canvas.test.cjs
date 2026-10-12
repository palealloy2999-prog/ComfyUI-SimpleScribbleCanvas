const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

// A DOM/canvas simulation: stored marker pixels exercise crop and restore ordering.
// This does not replace browser pointer-event or PNG decoding verification.
function setup() {
    let extension;
    const images = [];
    class Element {
        constructor() {
            this.style = {}; this.children = []; this.events = {}; this.attributes = {};
            this.width = 300; this.height = 150; this.clientWidth = 456; this.clientHeight = 456;
            this.pixels = []; this.lines = []; this.exports = 0; this.captures = new Set();
        }
        append(...items) { this.children.push(...items); }
        setAttribute(key, value) { this.attributes[key] = value; }
        addEventListener(name, listener, { signal } = {}) {
            (this.events[name] ??= []).push(listener);
            signal?.addEventListener("abort", () => {
                this.events[name] = this.events[name].filter(item => item !== listener);
            });
        }
        fire(type, values = {}) {
            for (const listener of this.events[type] || []) {
                listener({ type, preventDefault() {}, ...values });
            }
        }
        getBoundingClientRect() { return { left: 0, top: 0, width: 456, height: 456 }; }
        getContext() {
            const canvas = this;
            return {
                fillRect() { canvas.pixels = []; },
                drawImage(source, dx, dy) {
                    canvas.pixels = source.pixels.map(([x, y]) => [x + dx, y + dy])
                        .filter(([x, y]) => x >= 0 && y >= 0 && x < canvas.width && y < canvas.height);
                },
                beginPath() {}, arc() {}, fill() {}, moveTo() {},
                lineTo(x, y) { canvas.lines.push([x, y]); }, stroke() {},
            };
        }
        toDataURL() {
            this.exports++;
            return JSON.stringify({ width: this.width, height: this.height, pixels: this.pixels });
        }
        hasPointerCapture(id) { return this.captures.has(id); }
        setPointerCapture(id) { this.captures.add(id); }
        releasePointerCapture(id) {
            this.captures.delete(id);
            this.fire("lostpointercapture", { pointerId: id });
        }
    }
    const context = vm.createContext({
        app: { registerExtension(value) { extension = value; } },
        document: { createElement() { return new Element(); } },
        Image: class {
            constructor() { images.push(this); }
            finish(width = 912, height = 912, pixels = [[100, 100], [456, 456]]) {
                this.width = width; this.height = height; this.pixels = pixels; this.onload();
            }
        },
        AbortController,
        ResizeObserver: class { observe() {} disconnect() {} },
    });
    const source = fs.readFileSync(path.join(__dirname, "../js/simple_scribble_canvas.js"), "utf8")
        .replace(/import .*?;\s*/, "").replace(/export /g, "");
    vm.runInContext(source, context);
    const node = {
        comfyClass: "SimpleScribbleCanvas", properties: {}, size: [360, 500],
        widgets: ["aspect_ratio", "megapixels", "multiple", "brush_size", "drawing"].map((name, i) => ({
            name, value: ["1:1 square", "0.8", 16, 1, ""][i],
            options: { values: i === 2 ? [8, 16, 32, 64] : i === 3 ? [1, 2, 3, 5, 16, 32, 64] : [] },
        })),
        setDirtyCanvas() {}, computeSize() { return [360, 500]; }, setSize(size) { this.size = size; },
        addDOMWidget(name, type, root, options) {
            this.root = root;
            const widget = { name, options }; this.widgets.push(widget); return widget;
        },
    };
    extension.nodeCreated(node);
    return { node, images, canvas: node.root.children[1].children[0], drawing: node.widgets[4] };
}

function resize(node, megapixels) {
    node.widgets[1].value = megapixels;
    node.widgets[1].callback();
}

function pointer(canvas, type, id, x = 10, y = 10) {
    canvas.fire(type, { pointerId: id, button: 0, clientX: x, clientY: y });
}

test("resize during restore saves cropped pixels and they stay cropped after reload/expand", () => {
    const { node, images, canvas, drawing } = setup();
    drawing.value = "saved PNG";
    resize(node, "0.2");
    assert.equal(drawing.serializeValue(), "saved PNG");
    images.at(-1).finish();
    assert.deepEqual(canvas.pixels, [[232, 232]]);
    const saved = drawing.serializeValue();
    assert.deepEqual(JSON.parse(saved), { width: 464, height: 464, pixels: [[232, 232]] });
    const reload = setup();
    reload.node.widgets[1].value = "0.2";
    reload.drawing.value = saved;
    reload.node.onConfigure();
    reload.images.at(-1).finish(464, 464, JSON.parse(saved).pixels);
    resize(reload.node, "0.8");
    assert.deepEqual(reload.canvas.pixels, [[456, 456]]);
    assert.equal(reload.node.widgets.length, 6);
});

test("pending shrink then expand retains the crop in edit order", () => {
    const { node, images, canvas, drawing } = setup();
    drawing.value = "saved PNG";
    resize(node, "0.2"); resize(node, "0.8");
    images.at(-1).finish();
    assert.deepEqual(canvas.pixels, [[456, 456]]);
    assert.equal(JSON.parse(drawing.value).width, 912);
});

test("passive restore keeps saved data, stale image callbacks cannot replace a newer restore or Clear", () => {
    const { node, images, canvas, drawing } = setup();
    drawing.value = "first PNG";
    const stale = images.at(-1);
    resize(node, "0.2");
    drawing.value = "second PNG";
    stale.finish();
    assert.equal(drawing.value, "second PNG");
    images.at(-1).finish();
    assert.equal(drawing.value, "second PNG");
    assert.equal(canvas.exports, 0);
    drawing.value = "third PNG";
    const cancelled = images.at(-1);
    node.root.children[0].children[2].fire("click");
    const cleared = drawing.value;
    cancelled.finish();
    assert.equal(drawing.value, cleared);
    assert.deepEqual(canvas.pixels, []);
});

test("pointerup draws its final coordinate then saves once, including capture-loss reentry", () => {
    const { canvas, drawing } = setup();
    pointer(canvas, "pointerdown", 1);
    pointer(canvas, "pointermove", 1, 20, 20);
    pointer(canvas, "pointerup", 1, 30, 30);
    assert.deepEqual(canvas.lines, [[40, 40], [60, 60]]);
    assert.equal(canvas.exports, 1);
    drawing.serializeValue();
    assert.equal(canvas.exports, 1);
});

test("other pointers cannot end the active stroke for any terminal event", () => {
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
        const { canvas } = setup();
        pointer(canvas, "pointerdown", 1);
        pointer(canvas, type, 2);
        assert.equal(canvas.exports, 0);
        pointer(canvas, "pointermove", 1, 20, 20);
        assert.deepEqual(canvas.lines, [[40, 40]]);
        pointer(canvas, "pointerup", 1, 30, 30);
        assert.equal(canvas.exports, 1);
    }
});

test("cancel and capture loss preserve the last segment without drawing bogus terminal coordinates", () => {
    for (const type of ["pointercancel", "lostpointercapture"]) {
        const { canvas } = setup();
        pointer(canvas, "pointerdown", 1);
        pointer(canvas, "pointermove", 1, 20, 20);
        canvas.fire(type, { pointerId: 1 });
        assert.deepEqual(canvas.lines, [[40, 40]]);
        assert.equal(canvas.exports, 1);
        pointer(canvas, "pointermove", 1, 30, 30);
        assert.deepEqual(canvas.lines, [[40, 40]]);
    }
});
