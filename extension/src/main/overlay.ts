export interface OverlayView {
    tokenUuid: string;
    name: string;
    ac: string;
    health?: string;
}

interface OverlayNode {
    eventMode: string;
    parent: OverlayContainer | null;
    destroyed: boolean;
    position: { set(x: number, y: number): void };
    scale: { set(value: number): void };
    destroy(options?: { children: boolean }): void;
}

export interface OverlayContainer extends OverlayNode {
    addChild(child: OverlayNode): unknown;
}

export interface OverlayText extends OverlayNode {
    text: string;
    anchor: { set(x: number, y: number): void };
}

export interface OverlayToken {
    document: { uuid: string };
    center: { x: number; y: number };
    y: number;
}

export interface OverlayDependencies {
    createContainer(): OverlayContainer;
    createText(text: string): OverlayText;
    interfaceLayer(): OverlayContainer | null;
    tokens(): OverlayToken[];
    zoom(): number;
}

export interface Overlay {
    render(view: OverlayView): void;
    clear(): void;
    refresh(): void;
    destroy(): void;
}

const LABEL_OFFSET = 12;
const TEXT_COLOR = "#f2efe6";
const STROKE_COLOR = "#111111";
const STROKE_WIDTH = 4;
const FONT_SIZE = 14;
const FONT_FAMILY = "sans-serif";

function labelOf(view: OverlayView): string {
    return `${view.name} · AC ${view.ac}${view.health ? ` · ${view.health}` : ""}`;
}

function scaleFor(zoom: number): number {
    return Number.isFinite(zoom) && zoom > 0 ? 1 / zoom : 1;
}

export function createOverlay(dependencies: OverlayDependencies): Overlay {
    let root: OverlayContainer | null = null;
    let label: OverlayText | null = null;
    let current: OverlayView | null = null;
    let destroyed = false;

    const attachedRoot = (): OverlayContainer | null => {
        const layer = dependencies.interfaceLayer();
        if (layer === null) return null;
        if (root === null || root.destroyed) {
            root = dependencies.createContainer();
            root.eventMode = "none";
            label = null;
        }
        if (root.parent !== layer) layer.addChild(root);
        return root;
    };

    const clear = (): void => {
        current = null;
        const existing = label;
        label = null;
        if (existing !== null && !existing.destroyed) existing.destroy();
    };

    const render = (view: OverlayView): void => {
        if (destroyed) return;
        const token = dependencies.tokens().find((entry) => entry.document.uuid === view.tokenUuid);
        const container = token === undefined ? null : attachedRoot();
        if (token === undefined || container === null) {
            clear();
            return;
        }
        current = view;
        const text = labelOf(view);
        if (label !== null && label.destroyed) label = null;
        if (label === null) {
            label = dependencies.createText(text);
            label.eventMode = "none";
            label.anchor.set(0.5, 1);
            container.addChild(label);
        } else if (label.text !== text) {
            label.text = text;
        }
        label.position.set(token.center.x, token.y - LABEL_OFFSET);
        label.scale.set(scaleFor(dependencies.zoom()));
    };

    return {
        render,
        clear,
        refresh: () => {
            if (current !== null) render(current);
        },
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            clear();
            const existing = root;
            root = null;
            if (existing !== null && !existing.destroyed) existing.destroy({ children: true });
        },
    };
}

interface PixiGlobals {
    PIXI?: unknown;
    canvas?: unknown;
}

type Constructor = new (...args: unknown[]) => unknown;

function field(value: unknown, key: string): unknown {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function isOverlayToken(value: unknown): value is OverlayToken {
    const center = field(value, "center");
    return typeof field(field(value, "document"), "uuid") === "string"
        && typeof field(center, "x") === "number"
        && typeof field(center, "y") === "number"
        && typeof field(value, "y") === "number";
}

export function overlayDependenciesFromWindow(source: object): OverlayDependencies | null {
    const globals = source as PixiGlobals;
    const pixi = globals.PIXI;
    const Container = field(pixi, "Container");
    const Text = field(pixi, "Text");
    if (typeof Container !== "function" || typeof Text !== "function") return null;
    if (typeof globals.canvas !== "object" || globals.canvas === null) return null;
    const ContainerClass = Container as Constructor;
    const TextClass = Text as Constructor;
    const v8 = String(field(pixi, "VERSION")).startsWith("8");
    const base = { fontFamily: FONT_FAMILY, fontSize: FONT_SIZE, fill: TEXT_COLOR };
    return {
        createContainer: () => new ContainerClass() as OverlayContainer,
        createText: (text) => (v8
            ? new TextClass({ text, style: { ...base, stroke: { color: STROKE_COLOR, width: STROKE_WIDTH } } })
            : new TextClass(text, { ...base, stroke: STROKE_COLOR, strokeThickness: STROKE_WIDTH })) as OverlayText,
        interfaceLayer: () => {
            const layer = field(globals.canvas, "interface");
            return typeof layer === "object" && layer !== null ? layer as OverlayContainer : null;
        },
        tokens: () => {
            const placeables = field(field(globals.canvas, "tokens"), "placeables");
            return Array.isArray(placeables) ? placeables.filter(isOverlayToken) : [];
        },
        zoom: () => {
            const zoom = field(field(field(globals.canvas, "stage"), "scale"), "x");
            return typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
        },
    };
}
