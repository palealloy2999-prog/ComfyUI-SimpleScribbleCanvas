const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

// A DOM/canvas simulation: stored marker pixels exercise crop and restore ordering.
// This does not replace browser pointer-event or PNG decoding verification.
function setup(session, graph = session?.node.graph || { id: "graph-a" }) {
    let extension;
    const images = session?.images || [];
    const decodes = session?.decodes || [];
    class Element {
        constructor() {
            this.style = {}; this.children = []; this.events = {}; this.attributes = {};
            this.width = 300; this.height = 150; this.clientWidth = 456; this.clientHeight = 456;
            this.draws = []; this.pixels = []; this.lines = []; this.ellipses = []; this.strokes = []; this.exports = 0; this.captures = new Set();
        }
        focus() {}
        append(...items) { this.children.push(...items); }
        setAttribute(key, value) { this.attributes[key] = value; }
        addEventListener(name, listener, { signal } = {}) {
            (this.events[name] ??= []).push(listener);
            signal?.addEventListener("abort", () => {
                this.events[name] = this.events[name].filter(item => item !== listener);
            });
        }
        fire(type, values = {}) {
            return Promise.all((this.events[type] || []).map(listener =>
                listener({ type, preventDefault() {}, stopPropagation() {}, ...values })));

        }
        getBoundingClientRect() { return { left: 0, top: 0, width: 456, height: 456 }; }
        getContext() {
            const canvas = this;
            return {
                clearRect() { canvas.pixels = []; canvas.lines = []; canvas.ellipses = []; },
                fillRect() { canvas.pixels = []; },
                drawImage(source, dx, dy, width = source.width, height = source.height) {
                    if (source.closed || source.drawError) throw new Error("Image cannot be drawn");
                    canvas.draws.push([dx, dy, width, height]);
                    canvas.pixels = source.pixels.map(([x, y]) => [x * width / source.width + dx, y * height / source.height + dy])
                        .filter(([x, y]) => x >= 0 && y >= 0 && x < canvas.width && y < canvas.height);
                },
                beginPath() {}, arc() {}, fill() {}, moveTo() {},
                lineTo(x, y) { canvas.lines.push([x, y]); },
                ellipse(...args) { canvas.ellipses.push(args); },
                stroke() { canvas.strokes.push({ color: this.strokeStyle, width: this.lineWidth }); },
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
    const context = session?.context || vm.createContext({
        app: { registerExtension(value) { extension = value; } },
        document: { createElement() { return new Element(); } },
        Image: class {
            constructor() { images.push(this); }
            finish(width = 912, height = 912, pixels = [[100, 100], [456, 456]]) {
                this.width = width; this.height = height; this.pixels = pixels; this.onload();
            }
        },
        createImageBitmap(file) {
            return new Promise((resolve, reject) => decodes.push({ file, resolve, reject }));
        },
        crypto: require("node:crypto"), WeakRef,
        AbortController,
        ResizeObserver: class { observe() {} disconnect() {} },
    });
    const source = fs.readFileSync(path.join(__dirname, "../js/simple_scribble_canvas.js"), "utf8")
        .replace(/import .*?;\s*/, "").replace(/export /g, "");
    if (!session) vm.runInContext(source, context);
    const node = {
        id: 1, graph, comfyClass: "SimpleScribbleCanvas", properties: {}, size: [360, 500],
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
    (session?.extension || extension).nodeCreated(node);
    return { context, extension: session?.extension || extension, node, images, decodes, canvas: node.root.children[1].children[0], drawing: node.widgets[4] };
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


test("line preview follows drag and hover, only the second click commits and serializes", () => {
    const { node, canvas, drawing } = setup();
    const preview = node.root.children[1].children[1];
    node.root.children[0].children[3].fire("click");
    pointer(canvas, "pointerdown", 1, 10, 10);
    pointer(canvas, "pointermove", 1, 20, 20);
    pointer(canvas, "pointerup", 1, 20, 20);
    assert.deepEqual(preview.lines, [[40, 40]]);
    pointer(canvas, "pointermove", 1, 30, 30);
    assert.deepEqual(preview.lines, [[60, 60]]);
    assert.equal(drawing.serializeValue(), "");
    assert.equal(canvas.exports, 0); assert.deepEqual(canvas.lines, []);
    pointer(canvas, "pointerdown", 1, 40, 40);
    assert.deepEqual(canvas.lines, [[80, 80]]);
    assert.deepEqual(preview.lines, []); assert.equal(canvas.exports, 1);
    pointer(canvas, "pointerup", 1, 40, 40);
    assert.equal(canvas.exports, 1);
});

test("ellipse is inscribed in the two-point rectangle in either drag direction", () => {
    for (const coords of [[10,20,50,40], [50,40,10,20]]) {
        const { node, canvas } = setup();
        node.root.children[0].children[4].fire("click");
        pointer(canvas, "pointerdown", 1, ...coords.slice(0,2));
        pointer(canvas, "pointerdown", 1, ...coords.slice(2));
        assert.deepEqual(canvas.ellipses[0].slice(0,4), [60,60,40,20]);
        assert.equal(canvas.exports, 1);
    }
});

test("Escape, tool switching, resize and Clear discard tentative shapes", () => {
    for (const action of ["escape", "toggle", "switch", "resize", "clear"]) {
        const { node, canvas } = setup();
        const toolbar = node.root.children[0], preview = node.root.children[1].children[1];
        toolbar.children[3].fire("click");
        pointer(canvas, "pointerdown", 1);
        pointer(canvas, "pointermove", 1, 20, 20);
        if (action === "escape") node.root.fire("keydown", { key: "Escape", stopPropagation() {} });
        if (action === "toggle") toolbar.children[3].fire("click");
        if (action === "switch") toolbar.children[4].fire("click");
        if (action === "resize") resize(node, "0.2");
        if (action === "clear") toolbar.children[2].fire("click");
        assert.deepEqual(preview.lines, []); assert.deepEqual(canvas.lines, []);
        if (action === "toggle") {
            pointer(canvas, "pointerdown", 1, 10,10);
            pointer(canvas, "pointerup", 1, 30,30);
            assert.deepEqual(canvas.lines, [[60,60]]);
        }
    }
});

test("shape tools use each color's stored width and handle flat ellipses", () => {
    const { node, canvas } = setup(), toolbar = node.root.children[0];
    toolbar.children[1].fire("click"); toolbar.children[4].fire("click");
    pointer(canvas, "pointerdown", 1, 10,10); pointer(canvas, "pointerdown", 1, 20,10);
    assert.deepEqual(canvas.lines, [[40,20]]);
    assert.deepEqual(canvas.strokes.at(-1), {color:'#ffffff',width:32});
    toolbar.children[0].fire("click");
    pointer(canvas, "pointerdown", 1, 10,10); pointer(canvas, "pointerdown", 1, 20,20);
    assert.deepEqual(canvas.strokes.at(-1), {color:'#000000',width:1});
    assert.equal(node.widgets.length,6);
});


function paste(node, type = "image/png") {
    return node.root.fire("paste", {
        clipboardData: { items: [{ type, getAsFile() { return { type }; } }] },
    });
}

function bitmap(width, height) {
    return { width, height, pixels: [[width / 2, height / 2]], closed: false, close() { this.closed = true; } };
}

test("paste contains and centers landscape/portrait images, scaling both up and down", async () => {
    for (const [w, h, expected] of [
        [200,100,[0,228,912,456]], [100,200,[228,0,456,912]],
        [1824,912,[0,228,912,456]], [912,1824,[228,0,456,912]],
        [100,100,[0,0,912,912]],
    ]) {
        const { node, canvas, decodes, drawing } = setup();
        const done = paste(node), image = bitmap(w,h);
        decodes[0].resolve(image); await done;
        const reference = node.root.children[1].children[2];
        reference.draws.at(-1).forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-9));
        assert.deepEqual(reference.pixels,[[456,456]]);
        assert.deepEqual(canvas.pixels,[]);
        assert.equal(canvas.exports,0); assert.equal(image.closed,false);
        assert.equal(drawing.serializeValue(), "");
        node.root.children[0].children[2].fire('click');
        assert.equal(image.closed,true); assert.deepEqual(reference.pixels,[]);
    }
});

test("Clear, restore and removal prevent stale paste callbacks from replacing content", async () => {
    for (const action of ['clear','restore','remove']) {
        const { node, canvas, decodes, drawing } = setup();
        const done=paste(node), image=bitmap(100,100);
        if(action==='clear') node.root.children[0].children[2].fire('click');
        if(action==='restore') drawing.value='new saved PNG';
        if(action==='remove') node.onRemoved();
        const saved=drawing.value, count=canvas.exports;
        decodes[0].resolve(image); await done;
        assert.equal(drawing.value,saved); assert.equal(canvas.exports,count);
        assert.equal(image.closed,true);
    }
});

test("paste uses current resolution and cancels pending shapes", async () => {
    const { node, canvas, decodes }=setup();
    node.root.children[0].children[3].fire('click');
    pointer(canvas,'pointerdown',1); pointer(canvas,'pointermove',1,30,30);
    const done=paste(node); resize(node,'0.2');
    decodes[0].resolve(bitmap(200,100)); await done;
    const expected = [0,116,464,232];
    node.root.children[1].children[2].draws.at(-1).forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-9));
    assert.deepEqual(node.root.children[1].children[1].lines,[]);
    pointer(canvas,'pointerdown',1,20,20);
    assert.deepEqual(canvas.lines,[]);
});

test("decode errors retain the existing drawing, and non-image clipboard content is ignored", async () => {
    const { node, canvas, decodes, drawing }=setup();
    pointer(canvas,'pointerdown',1);pointer(canvas,'pointerup',1,30,30);
    const saved=drawing.value, count=canvas.exports;
    await paste(node,'text/plain'); assert.equal(decodes.length,0);
    const done=paste(node);decodes[0].reject(new Error('invalid image')); await done;
    assert.equal(drawing.value,saved);assert.equal(canvas.exports,count);
    pointer(canvas,'pointerdown',1);pointer(canvas,'pointerup',1,40,40);
    assert.equal(canvas.exports,count+1);
});


test("reference paste preserves existing drawing, stays out of serialization and refits on resize", async () => {
    const {node,canvas,drawing,decodes}=setup();
    pointer(canvas,'pointerdown',1);pointer(canvas,'pointerup',1,30,30);
    const saved=drawing.value, count=canvas.exports;
    const done=paste(node), image=bitmap(200,100);decodes[0].resolve(image);await done;
    assert.equal(drawing.serializeValue(),saved);assert.equal(canvas.exports,count);
    assert.deepEqual(canvas.lines,[[60,60]]);
    resize(node,'0.2');
    const expected=[0,116,464,232], reference=node.root.children[1].children[2];
    reference.draws.at(-1).forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-9));
    node.onRemoved();assert.equal(image.closed,false);
});

test("latest reference wins without blocking drawing, replacement disposes the previous bitmap", async () => {
    const {node,canvas,decodes}=setup();
    const first=paste(node), second=paste(node), old=bitmap(100,100), latest=bitmap(200,100);
    decodes[1].resolve(latest);await second;decodes[0].resolve(old);await first;
    assert.equal(old.closed,true);assert.equal(latest.closed,false);
    const third=paste(node), next=bitmap(100,200);decodes[2].resolve(next);await third;
    assert.equal(latest.closed,true);
    pointer(canvas,'pointerdown',1);pointer(canvas,'pointerup',1,30,30);
    assert.deepEqual(canvas.lines,[[60,60]]);
    node.onConfigure();assert.equal(next.closed,false);
});


test("queue-style reassignment of serialized drawing retains the reference and drawing", async () => {
    for (const drawn of [false,true]) {
        const {node,canvas,drawing,decodes,images}=setup();
        if(drawn) { pointer(canvas,'pointerdown',1);pointer(canvas,'pointerup',1,30,30); }
        const done=paste(node), image=bitmap(200,100);decodes[0].resolve(image);await done;
        const saved=drawing.value, count=canvas.exports, loads=images.length;
        const reference=node.root.children[1].children[2];
        for(let i=0;i<3;i++) {
            drawing.value=drawing.serializeValue();
            assert.equal(image.closed,false);
            assert.deepEqual(reference.pixels,[[456,456]]);
            assert.equal(drawing.value,saved);
            assert.equal(canvas.exports,count);
            assert.equal(images.length,loads);
        }
        node.onConfigure();assert.equal(image.closed,false);
    }
});

test("queue-style same-value assignments do not cancel a pending reference paste", async () => {
    const {node,drawing,decodes}=setup();
    const done=paste(node), image=bitmap(100,100);
    drawing.value=drawing.serializeValue();
    decodes[0].resolve(image);await done;
    assert.equal(image.closed,false);
    assert.deepEqual(node.root.children[1].children[2].pixels,[[456,456]]);
    node.root.children[0].children[2].fire('click');
    assert.equal(image.closed,true);
});


test("workflow node recreation restores an available session reference, a new browser session does not", async () => {
    const session=setup();
    const done=paste(session.node), image=bitmap(200,100);
    session.decodes[0].resolve(image);await done;
    const properties=JSON.parse(JSON.stringify(session.node.properties));
    session.node.onRemoved();assert.equal(image.closed,false);
    const reload=setup(session);
    reload.node.properties=properties;reload.node.onConfigure();
    assert.deepEqual(reload.node.root.children[1].children[2].pixels,[[456,456]]);
    assert.equal(reload.drawing.serializeValue(),'');
    const fresh=setup();fresh.node.properties=JSON.parse(JSON.stringify(properties));fresh.node.onConfigure();
    assert.deepEqual(fresh.node.root.children[1].children[2].pixels,[]);
    const clone=setup(session);clone.node.id=2;clone.node.properties=JSON.parse(JSON.stringify(properties));clone.node.onConfigure();
    assert.deepEqual(clone.node.root.children[1].children[2].pixels,[]);
    reload.node.root.children[0].children[2].fire('click');assert.equal(image.closed,true);
    const afterClear=setup(session);afterClear.node.properties=properties;afterClear.node.onConfigure();
    assert.deepEqual(afterClear.node.root.children[1].children[2].pixels,[]);
});


test("reference drag uses canvas coordinates and move cursor without changing output", async () => {
    const {node,canvas,drawing,decodes}=setup();
    const done=paste(node);decodes[0].resolve(bitmap(200,100));await done;
    const reference=node.root.children[1].children[2], move=node.root.children[0].children[5];
    const saved=drawing.value,count=canvas.exports;
    move.fire('click');
    assert.equal(move.attributes['aria-pressed'],'true');
    pointer(canvas,'pointerdown',1,10,20);assert.equal(canvas.style.cursor,'move');
    pointer(canvas,'pointermove',1,30,50);
    pointer(canvas,'pointerup',2,500,500);assert.equal(canvas.style.cursor,'move');
    pointer(canvas,'pointerup',1,40,60);
    const expected=[60,308,912,456];
    reference.draws.at(-1).forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-9));
    assert.equal(canvas.style.cursor,'default');
    assert.equal(drawing.serializeValue(),saved);assert.equal(canvas.exports,count);
    assert.deepEqual(canvas.lines,[]);
    move.fire('click');assert.equal(canvas.style.cursor,'none');
    pointer(canvas,'pointerdown',1);pointer(canvas,'pointerup',1,30,30);
    assert.deepEqual(canvas.lines,[[60,60]]);
});

test("reference offset survives session workflow reload, resets on new paste and Clear", async () => {
    const session=setup(),{node,canvas,decodes}=session;
    const done=paste(node);decodes[0].resolve(bitmap(100,100));await done;
    node.root.children[0].children[5].fire('click');
    pointer(canvas,'pointerdown',1,10,10);pointer(canvas,'pointerup',1,30,40);
    const properties=JSON.parse(JSON.stringify(node.properties));node.onRemoved();
    const reload=setup(session);reload.node.properties=properties;reload.node.onConfigure();
    assert.deepEqual(reload.node.root.children[1].children[2].pixels,[[496,516]]);
    const next=paste(node); // Removed node listeners are disposed.
    await next;
    reload.node.root.children[0].children[2].fire('click');
    assert.deepEqual(reload.node.root.children[1].children[2].pixels,[]);
});

test("move mode without a reference is harmless; cancellation releases the drag", async () => {
    const {node,canvas,decodes}=setup();
    node.root.children[0].children[5].fire('click');
    pointer(canvas,'pointerdown',1);pointer(canvas,'pointermove',1,30,30);
    assert.equal(canvas.exports,0);assert.equal(canvas.captures.size,0);
    const done=paste(node);decodes[0].resolve(bitmap(100,100));await done;
    pointer(canvas,'pointerdown',1);pointer(canvas,'pointermove',1,20,20);
    canvas.fire('pointercancel',{pointerId:1});assert.equal(canvas.style.cursor,'default');
    assert.equal(canvas.captures.size,0);assert.equal(canvas.exports,0);
    const second=paste(node);decodes[1].resolve(bitmap(100,100));await second;
    assert.deepEqual(node.root.children[1].children[2].pixels,[[456,456]]);
});


test("reference ownership is isolated by graph even for identical node IDs and reference keys", async () => {
    const a=setup();
    const pasted=paste(a.node), imageA=bitmap(100,100);a.decodes[0].resolve(imageA);await pasted;
    const properties=JSON.parse(JSON.stringify(a.node.properties));
    const b=setup(a,{id:a.node.graph.id});b.node.properties=properties;b.node.onConfigure();
    const refB=b.node.root.children[1].children[2];
    assert.deepEqual(refB.pixels,[]);
    const bp=paste(b.node), imageB=bitmap(100,100);b.decodes.at(-1).resolve(imageB);await bp;
    b.node.root.children[0].children[5].fire('click');
    pointer(b.canvas,'pointerdown',1);pointer(b.canvas,'pointerup',1,30,40);
    assert.deepEqual(refB.pixels,[[496,516]]);
    a.node.root.children[0].children[2].fire('click');assert.equal(imageA.closed,true);
    assert.equal(imageB.closed,false);
    resize(b.node,'0.2');assert.deepEqual(refB.pixels,[[272,292]]);
    assert.equal(b.drawing.serializeValue().includes('scribble_reference'),false);
});

test("reused graph object keeps reference caches separate across workflow IDs", async () => {
    const session=setup(), graph=session.node.graph;
    const done=paste(session.node), image=bitmap(100,100);session.decodes[0].resolve(image);await done;
    const properties=JSON.parse(JSON.stringify(session.node.properties));session.node.onRemoved();
    graph.id='graph-b';const other=setup(session,graph);other.node.properties=properties;other.node.onConfigure();
    assert.deepEqual(other.node.root.children[1].children[2].pixels,[]);
    other.node.onRemoved();graph.id='graph-a';
    const restored=setup(session,graph);restored.node.properties=properties;restored.node.onConfigure();
    assert.deepEqual(restored.node.root.children[1].children[2].pixels,[[456,456]]);
    assert.equal(image.closed,false);
});

test("paste works without randomUUID and preparation failures preserve the old reference", async () => {
    const {node,canvas,decodes,context,drawing}=setup();
    context.crypto={getRandomValues:require('node:crypto').getRandomValues.bind(require('node:crypto'))};
    const first=paste(node), old=bitmap(100,100);decodes[0].resolve(old);await first;
    node.root.children[0].children[5].fire('click');
    pointer(canvas,'pointerdown',1);pointer(canvas,'pointerup',1,30,40);
    const key=node.properties.scribble_reference, saved=drawing.value;
    const label=node.root.children[0].children.at(-1), ref=node.root.children[1].children[2];
    const crypto=context.crypto;
    context.crypto={getRandomValues(){throw new Error('key generation failed')}};
    await paste(node);
    assert.equal(decodes.length,1);assert.equal(old.closed,false);
    assert.equal(node.properties.scribble_reference,key);assert(label.textContent.startsWith('Cannot paste'));
    assert.deepEqual(ref.pixels,[[496,516]]);
    context.crypto=crypto;
    const invalid=paste(node);decodes.at(-1).reject(new Error('decode failed'));await invalid;
    assert.equal(old.closed,false);assert.equal(node.properties.scribble_reference,key);
    const failed=paste(node), candidate=bitmap(200,100);candidate.drawError=true;
    decodes.at(-1).resolve(candidate);await failed;
    assert.equal(candidate.closed,true);assert.equal(old.closed,false);
    assert.equal(node.properties.scribble_reference,key);assert.deepEqual(ref.pixels,[[496,516]]);
    assert.equal(drawing.value,saved);assert(label.textContent.startsWith('Cannot paste'));
});

test("a paste completing after its owning graph changes cannot install a reference", async () => {
    const {node,decodes}=setup(),done=paste(node),image=bitmap(100,100);
    node.graph={id:'another-graph'};
    decodes[0].resolve(image);await done;
    assert.equal(image.closed,true);assert.equal(node.properties.scribble_reference,undefined);
});
