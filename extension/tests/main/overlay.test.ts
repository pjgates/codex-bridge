import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOverlay, overlayDependenciesFromWindow, type OverlayView } from "../../src/main/overlay.js";

class FakeNode {
    eventMode = "auto";
    parent: FakeContainer | null = null;
    destroyed = false;
    position = { set: vi.fn() };
    scale = { set: vi.fn() };
    destroy = vi.fn(() => {
        this.destroyed = true;
        this.parent?.removeChild(this);
    });
}

class FakeContainer extends FakeNode {
    children: FakeNode[] = [];

    addChild(child: FakeNode): FakeNode {
        child.parent?.removeChild(child);
        child.parent = this;
        this.children.push(child);
        return child;
    }

    removeChild(child: FakeNode): FakeNode {
        this.children = this.children.filter((entry) => entry !== child);
        child.parent = null;
        return child;
    }
}

class FakeText extends FakeNode {
    anchor = { set: vi.fn() };

    constructor(public text: string) {
        super();
    }
}

interface FakeToken {
    document: { uuid: string };
    center: { x: number; y: number };
    y: number;
}

let interfaceLayer: FakeContainer;
let token: FakeToken;
let texts: FakeText[];
let textNode: FakeText;
let label: FakeText;

const view: OverlayView = { tokenUuid: "Scene.s.Token.t", name: "Graveknight", ac: "27–28", provenance: "inferred" };

beforeEach(() => {
    interfaceLayer = new FakeContainer();
    token = { document: { uuid: "Scene.s.Token.t" }, center: { x: 100, y: 150 }, y: 120 };
    texts = [];
});

function fakeDependencies(options: { zoom?: number; tokens?: FakeToken[] } = {}) {
    let layer: FakeContainer | null = interfaceLayer;
    const dependencies = {
        createContainer: () => new FakeContainer(),
        createText: (text: string) => {
            const node = new FakeText(text);
            texts.push(node);
            textNode = node;
            label = node;
            return node;
        },
        interfaceLayer: () => layer,
        tokens: () => options.tokens ?? [token],
        zoom: vi.fn(() => options.zoom ?? 1),
        setLayer: (next: FakeContainer | null) => {
            layer = next;
        },
    };
    return dependencies;
}

describe("targeted-token overlay", () => {
    it("renders one non-interactive label over the requested token", () => {
        const overlay = createOverlay(fakeDependencies());
        overlay.render({
            tokenUuid: "Scene.s.Token.t",
            name: "Graveknight",
            ac: "27–28",
            provenance: "inferred",
        });
        expect(interfaceLayer.children).toHaveLength(1);
        expect(interfaceLayer.children[0].eventMode).toBe("none");
        expect(textNode.text).toBe("Graveknight · AC 27–28 (inferred)");
        expect(textNode.eventMode).toBe("none");
        expect(textNode.anchor.set).toHaveBeenCalledWith(0.5, 1);
    });

    it("counter-scales, follows token movement, and tears down idempotently", () => {
        const overlay = createOverlay(fakeDependencies({ zoom: 2 }));
        overlay.render(view);
        expect(label.scale.set).toHaveBeenCalledWith(0.5);
        token.center.x = 500;
        overlay.refresh();
        expect(label.position.set).toHaveBeenLastCalledWith(500, token.y - 12);
        overlay.destroy();
        overlay.destroy();
        expect(label.destroy).toHaveBeenCalledOnce();
    });

    it("appends the health suffix when provided", () => {
        const overlay = createOverlay(fakeDependencies());
        overlay.render({ ...view, health: "Wounded" });
        expect(textNode.text).toBe("Graveknight · AC 27–28 (inferred) · Wounded");
    });

    it("updates the existing text instead of recreating it and moves to a new token", () => {
        const other: FakeToken = { document: { uuid: "Scene.s.Token.u" }, center: { x: 300, y: 350 }, y: 320 };
        const overlay = createOverlay(fakeDependencies({ tokens: [token, other] }));
        overlay.render(view);
        overlay.render(view);
        overlay.render({ ...view, ac: "28" });
        overlay.render({ tokenUuid: "Scene.s.Token.u", name: "Lich", ac: "30", provenance: "exact-client" });
        expect(texts).toHaveLength(1);
        expect(textNode.text).toBe("Lich · AC 30 (exact client data)");
        expect(textNode.position.set).toHaveBeenLastCalledWith(300, 308);
        const root = interfaceLayer.children[0] as FakeContainer;
        expect(root.children).toHaveLength(1);
    });

    it("clears when the requested token is missing but keeps a usable root", () => {
        const overlay = createOverlay(fakeDependencies());
        overlay.render(view);
        const first = label;
        overlay.render({ ...view, tokenUuid: "Scene.s.Token.missing" });
        expect(first.destroy).toHaveBeenCalledOnce();
        const root = interfaceLayer.children[0] as FakeContainer;
        expect(root.children).toHaveLength(0);
        overlay.render(view);
        expect(root.children).toHaveLength(1);
        expect(texts).toHaveLength(2);
    });

    it("re-attaches the root when the interface layer is replaced", () => {
        const dependencies = fakeDependencies();
        const overlay = createOverlay(dependencies);
        overlay.render(view);
        const root = interfaceLayer.children[0];
        const replacement = new FakeContainer();
        dependencies.setLayer(replacement);
        overlay.refresh();
        expect(replacement.children).toEqual([root]);
        expect(interfaceLayer.children).toHaveLength(0);
    });

    it("recreates a destroyed root on the next render", () => {
        const overlay = createOverlay(fakeDependencies());
        overlay.render(view);
        const root = interfaceLayer.children[0];
        root.destroy();
        overlay.render(view);
        expect(interfaceLayer.children).toHaveLength(1);
        expect(interfaceLayer.children[0]).not.toBe(root);
        expect(texts).toHaveLength(2);
    });

    it("does nothing without an interface layer", () => {
        const dependencies = fakeDependencies();
        dependencies.setLayer(null);
        const overlay = createOverlay(dependencies);
        expect(() => overlay.render(view)).not.toThrow();
        expect(texts).toHaveLength(0);
    });

    it.each([0, Number.NaN, -1, Number.POSITIVE_INFINITY])("falls back to unit scale for zoom %s", (zoom) => {
        const overlay = createOverlay(fakeDependencies({ zoom }));
        overlay.render(view);
        expect(label.scale.set).toHaveBeenLastCalledWith(1);
    });

    it("reports the currently rendered token uuid", () => {
        const overlay = createOverlay(fakeDependencies());
        expect(overlay.currentTokenUuid()).toBeNull();
        overlay.render(view);
        expect(overlay.currentTokenUuid()).toBe("Scene.s.Token.t");
        overlay.clear();
        expect(overlay.currentTokenUuid()).toBeNull();
    });

    it("ignores render after destroy", () => {
        const overlay = createOverlay(fakeDependencies());
        overlay.destroy();
        overlay.render(view);
        expect(interfaceLayer.children).toHaveLength(0);
    });
});

describe("overlay dependencies from window", () => {
    function fakeWindow(version: string) {
        const Text = vi.fn(function (this: Record<string, unknown>, ...args: unknown[]) {
            this.args = args;
        });
        const Container = vi.fn(function () {
            return undefined;
        });
        const layer = {};
        return {
            Text,
            source: {
                PIXI: { VERSION: version, Text, Container },
                canvas: {
                    interface: layer,
                    tokens: { placeables: [token, null, { document: {} }] },
                    stage: { scale: { x: 3 } },
                },
            },
            layer,
        };
    }

    it("constructs PIXI v8 text from an options object", () => {
        const { Text, source } = fakeWindow("8.6.6");
        const dependencies = overlayDependenciesFromWindow(source);
        dependencies?.createText("Hello");
        expect(Text).toHaveBeenCalledWith({
            text: "Hello",
            style: {
                fontFamily: "sans-serif",
                fontSize: 14,
                fill: "#f2efe6",
                stroke: { color: "#111111", width: 4 },
            },
        });
    });

    it("constructs PIXI v7 text from positional arguments", () => {
        const { Text, source } = fakeWindow("7.4.2");
        const dependencies = overlayDependenciesFromWindow(source);
        dependencies?.createText("Hello");
        expect(Text).toHaveBeenCalledWith("Hello", {
            fontFamily: "sans-serif",
            fontSize: 14,
            fill: "#f2efe6",
            stroke: "#111111",
            strokeThickness: 4,
        });
    });

    it("reads the live layer, valid tokens, and zoom", () => {
        const { source, layer } = fakeWindow("8.0.0");
        const dependencies = overlayDependenciesFromWindow(source);
        expect(dependencies?.interfaceLayer()).toBe(layer);
        expect(dependencies?.tokens()).toEqual([token]);
        expect(dependencies?.zoom()).toBe(3);
        source.canvas.stage.scale.x = Number.NaN;
        expect(dependencies?.zoom()).toBe(1);
        source.canvas = {} as typeof source.canvas;
        expect(dependencies?.interfaceLayer()).toBeNull();
        expect(dependencies?.tokens()).toEqual([]);
        expect(dependencies?.zoom()).toBe(1);
    });

    it("returns null without PIXI or canvas", () => {
        expect(overlayDependenciesFromWindow({ canvas: {} })).toBeNull();
        expect(overlayDependenciesFromWindow({ PIXI: fakeWindow("8").source.PIXI })).toBeNull();
    });
});
