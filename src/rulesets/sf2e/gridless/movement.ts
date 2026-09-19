import { MODULE_ID } from "../../../constants.js";
import { isGridlessActive, movementDebugEnabled, movementLatticeMode, movementPreviewMode, type MovementPreviewMode } from "./settings.js";
import type { Point } from "./geometry.js";
import { hexCentre, hexCorners } from "./hex.js";
import { getAttackRanges, type AttackActor, type AttackRange, type PreparedAttack } from "./reach.js";
import { dragPaths, getMovementArea, isKnownMovementPoint, measureProposedMovement, mergeMovementArea, type MovementAreaJob } from "./routing.js";
import { TERRAIN_COLORS, type DebugTerrain } from "./debug.js";
import type { FrontierReason } from "./hexfield.js";

/** Font Awesome solid glyph for an icon class, read from the loaded stylesheet so it always matches the ruler's own icons. */
const glyphCache = new Map<string, string>();
function iconGlyph(iconClass: string, fallback: string): string {
    const known = glyphCache.get(iconClass);
    if (known) return known;
    let glyph = fallback;
    if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
        const probe = document.createElement("i");
        probe.className = iconClass;
        document.body.appendChild(probe);
        const content = getComputedStyle(probe, "::before").content.match(/"(.)"/u);
        probe.remove();
        if (content) glyph = content[1];
    }
    glyphCache.set(iconClass, glyph);
    return glyph;
}

/**
 * The climb rim borrows the Climb movement action's own marker: its image when it has one, as the
 * token HUD shows, otherwise its font icon. The squeeze rim uses compress.
 */
function frontierIcon(reason: FrontierReason, size: number): PIXI.Text | PIXI.Sprite {
    const climb = (CONFIG.Token.movement.actions as Record<string, { icon?: string; img?: string }>).climb;
    if (reason === "climb" && climb?.img) {
        const sprite = PIXI.Sprite.from(climb.img);
        sprite.width = sprite.height = size;
        return sprite;
    }
    const glyph = reason === "squeeze" ? iconGlyph("fa-solid fa-compress", "\uf066")
        : iconGlyph(climb?.icon ?? "fa-solid fa-person-through-window", "\ue5a9");
    return new PIXI.Text(glyph, { fontFamily: "Font Awesome 7 Pro", fontWeight: "900", fontSize: size, fill: 0xffffff, stroke: 0x000000, strokeThickness: 4 });
}
const FRONTIER_COLOR = 0xff4d4d;

type Waypoint = TokenDocument.MeasuredMovementWaypoint;
interface RulerData {
    passedWaypoints: Waypoint[];
    pendingWaypoints: Waypoint[];
    plannedMovement: Record<string, { history: Waypoint[]; foundPath: Waypoint[] }>;
}
interface MovementRuler {
    token: Token.Implementation & { readonly isDragged: boolean };
    refresh(data: RulerData): void;
    clear(): void;
}
interface MovementPreview { cost: number; center: Point; waypoint: Partial<Waypoint> }

let movementPreviewHeld = false;

/** Registered during init so Foundry can expose an optional, user-configurable binding. */
export function registerMovementPreviewKeybind(): void {
    const refreshControlled = (): void => {
        if (canvas?.ready) for (const token of canvas.tokens!.controlled) token.renderFlags.set({ refreshRuler: true });
    };
    game.keybindings!.register(MODULE_ID, "previewMovement", {
        name: "codex-foundry.gridless.previewMovementName",
        hint: "codex-foundry.gridless.previewMovementHint",
        editable: [],
        onDown: () => {
            if (!isGridlessActive()) return false;
            movementPreviewHeld = true;
            refreshControlled();
            return true;
        },
        onUp: () => {
            const wasHeld = movementPreviewHeld;
            movementPreviewHeld = false;
            if (wasHeld) refreshControlled();
            return wasHeld;
        },
    });
}

/** Movement only: other actions do not spend this distance budget. */
export function movementBudget(speed: number, cost: number): { actions: number; remaining: number } {
    const actions = Math.max(1, Math.ceil(cost / speed));
    return { actions, remaining: actions * speed - cost };
}

export function ownTurn(token: Token.Implementation): boolean {
    const combat = game.combat;
    return !!combat?.started && combat.combatant?.token === token.document;
}

export function activateMovementRings(): void {
    let container: PIXI.Container | null = null;
    let fogMask: PIXI.Sprite | null = null;
    const previews = new WeakMap<Token.Implementation, MovementPreview>();
    const rings = new Map<Token.Implementation, {
        graphics: PIXI.Graphics; frontierGraphics: PIXI.Graphics; frontierIcons: (PIXI.Text | PIXI.Sprite)[]; debugGraphics: PIXI.Graphics; debugLegend: PIXI.Text;
        attackGraphics: PIXI.Graphics; attackLabels: PIXI.Text[];
        attackActor: AttackActor | null; attackSource: readonly PreparedAttack[] | undefined;
        attackRanges: (AttackRange & { color: number })[]; tokenHeight: number;
        scale: number; zoom: number; previewMode?: MovementPreviewMode; area?: MovementAreaJob;
        areaPending?: boolean; queuedArea?: () => void;
    }>();

    function remove(token: Token.Implementation): void {
        const ring = rings.get(token);
        if (!ring) return;
        dragPaths.delete(token);
        ring.area?.cancel();
        container!.removeChild(ring.attackGraphics);
        ring.attackGraphics.destroy({ children: true });
        container!.removeChild(ring.debugGraphics);
        ring.debugGraphics.destroy({ children: true });
        container!.removeChild(ring.graphics);
        ring.graphics.destroy({ children: true });
        container!.removeChild(ring.frontierGraphics);
        ring.frontierGraphics.destroy({ children: true });
        if (fogMask) fogMask.renderable = false;
        rings.delete(token);
    }

    function clearFrontier(ring: { frontierGraphics: PIXI.Graphics; frontierIcons: (PIXI.Text | PIXI.Sprite)[] }): void {
        ring.frontierGraphics.clear();
        for (const icon of ring.frontierIcons) { ring.frontierGraphics.removeChild(icon); icon.destroy(); }
        ring.frontierIcons = [];
    }

    function maskMovement(graphics: PIXI.Graphics): void {
        if (game.user!.isGM || !canvas!.visibility.tokenVision) {
            graphics.mask = null; graphics.filters = null;
            return;
        }
        const source = canvas!.fog.sprite, texture = source.texture;
        if (canvas!.fog.fogExploration && texture) {
            fogMask ??= container!.addChild(new PIXI.Sprite(texture));
            fogMask.texture = texture;
            fogMask.position.copyFrom(source.position);
            fogMask.scale.copyFrom(source.scale);
            graphics.mask = fogMask;
            graphics.filters = null;
        } else {
            graphics.mask = null;
            graphics.filters ??= [foundry.canvas.rendering.filters.VisionMaskFilter.create()];
        }
    }

    function refresh(token: Token.Implementation): void {
        if (!isGridlessActive()) return remove(token);
        const selected = canvas!.tokens!.controlled;
        if (selected.length !== 1 || selected[0] !== token) return remove(token);
        const preview = previews.get(token);
        // This Foundry 14 getter is absent from fvtt-types.
        const nativeToken = token as Token.Implementation & { readonly movementAnimationPromise: Promise<void> | null };
        const activePreview = movementPreviewHeld || !!preview || !!nativeToken.movementAnimationPromise;
        const debug = movementDebugEnabled() && movementLatticeMode() === "hex";
        if (!activePreview && !debug) return remove(token);
        // Prepared land Speed includes effects and conditions. Native history resets at turn start.
        const system = token.actor?.system as { movement?: { speeds?: { land?: { value: number } } } } | undefined;
        const speed = system?.movement?.speeds?.land?.value ?? 0;
        const cost = preview?.cost ?? (ownTurn(token) ? token.measureMovementPath(token.document.movementHistory).cost : 0);
        // An unreachable path has no movement budget, but weapon reach can still be previewed.
        const budget = speed > 0 && Number.isFinite(cost) ? movementBudget(speed, cost) : null;
        const remaining = budget?.remaining ?? 0;
        const previewMode = movementPreviewMode();
        const showMovement = !!budget && previewMode !== "off";
        const showDebug = !!budget && debug;
        let ring = rings.get(token);
        // Prepared system strikes and weapon-specific reach are not modeled by fvtt-types.
        const attackActor = token.actor as unknown as AttackActor | null;
        const attackSource = attackActor?.system.actions;
        const attacksChanged = !ring || ring.attackActor !== attackActor || ring.attackSource !== attackSource;
        const attackRanges = attacksChanged ? getAttackRanges(attackActor).map((range, index) => ({
            ...range, color: new PIXI.Color({ h: (130 + index * 137.508) % 360, s: 65, l: 65 }).toNumber(),
        })) : ring!.attackRanges;
        if (!budget && !attackRanges.length) return remove(token);
        if (!container) {
            container = canvas!.interface!.addChild(new PIXI.Container());
            container.zIndex = 2; // Keep attack labels above the directional flanking fill.
            container.eventMode = "none";
        }
        if (!ring) {
            const attackGraphics = container.addChild(new PIXI.Graphics());
            const debugGraphics = container.addChild(new PIXI.Graphics());
            const debugLegend = debugGraphics.addChild(new PIXI.Text("", { fontSize: 12, fill: 0xffffff,
                stroke: 0x000000, strokeThickness: 4, align: "center", wordWrap: true, wordWrapWidth: 480 }));
            debugLegend.anchor.set(0.5, 0);
            // The action glyph and remaining budget live on the native ruler label; this draws only the outline.
            const graphics = container.addChild(new PIXI.Graphics());
            graphics.name = "codex-movement-budget";
            // Red cells and icons for ledges and gaps the token could pass only by climbing or squeezing.
            const frontierGraphics = container.addChild(new PIXI.Graphics());
            frontierGraphics.name = "codex-movement-frontier";
            ring = { graphics, frontierGraphics, frontierIcons: [], attackGraphics, debugGraphics, debugLegend, attackLabels: [], attackActor, attackSource, attackRanges,
                tokenHeight: 0, scale: 0, zoom: 0 };
            rings.set(token, ring);
        }
        const source = token.document._source;
        const center = preview?.center ?? (nativeToken.movementAnimationPromise
            ? token.document.getCenterPoint({ x: source.x, y: source.y, width: source.width, height: source.height }) : token.center);
        const attackCenter = preview?.center ?? token.center;
        ring.attackGraphics.position.set(attackCenter.x, attackCenter.y);
        maskMovement(ring.graphics);
        ring.graphics.visible = showMovement;
        ring.attackGraphics.visible = activePreview && attackRanges.length > 0;
        ring.debugGraphics.visible = showDebug;
        if (!showDebug) { ring.debugGraphics.clear(); ring.debugLegend.text = ""; }
        const scale = canvas!.dimensions!.distancePixels;
        const zoom = canvas!.stage!.scale.x;
        const projectionChanged = ring.scale !== scale || ring.zoom !== zoom || ring.previewMode !== previewMode;
        const attacksLayoutChanged = attacksChanged || projectionChanged || ring.tokenHeight !== token.h;
        ring.attackActor = attackActor; ring.attackSource = attackSource; ring.attackRanges = attackRanges; ring.tokenHeight = token.h;
        const needsArea = showDebug || (showMovement && previewMode === "ring");
        if (!needsArea) {
            ring.area?.cancel();
            ring.area = undefined;
            ring.areaPending = false;
            ring.queuedArea = undefined;
        }
        ring.frontierGraphics.visible = showMovement && previewMode === "ring";
        if (!showMovement) { ring.graphics.clear(); clearFrontier(ring); }
        else if (previewMode === "circle") {
            const radius = remaining * scale;
            ring.graphics.position.set(center.x, center.y);
            ring.graphics.clear().lineStyle(2 / zoom, 0x77ccff, 0.7).drawCircle(0, 0, radius);
        }
        if (needsArea) {
            const current = ring;
            // Keep only the newest request, but let the active calculation finish.
            // Debug cells and the outline share one immutable snapshot of the same flood.
            current.queuedArea = () => {
                const area = getMovementArea(token, center, remaining, preview?.waypoint, showDebug);
                if (current.area === area && !projectionChanged) return;
                current.area = area;
                current.areaPending = true;
                void area.promise.then(polygons => {
                    if (rings.get(token) !== current || current.area !== area) return;
                    if (polygons) {
                        const drawZoom = canvas!.stage!.scale.x;
                        const drawRing = showMovement && previewMode === "ring";
                        if (drawRing) {
                            current.graphics.position.set(center.x, center.y);
                            current.graphics.clear().lineStyle(2 / drawZoom, 0x77ccff, 0.7);
                        }
                        let top = center.y;
                        for (const polygon of mergeMovementArea(polygons)) {
                            if (drawRing) current.graphics.drawPolygon(polygon.map((value, index) => value - (index % 2 ? center.y : center.x)));
                            for (let i = 1; i < polygon.length; i += 2) {
                                if (polygon[i] < top && isKnownMovementPoint({ x: polygon[i - 1], y: polygon[i] })) top = polygon[i];
                            }
                        }
                        clearFrontier(current);
                        if (drawRing && area.frontier?.rims.length) {
                            maskMovement(current.frontierGraphics);
                            const { size, rims } = area.frontier;
                            const offsets = hexCorners({ q: 0, r: 0 }, size).flatMap(point => [point.x, point.y]);
                            for (const rim of rims) {
                                for (const cell of rim.cells) {
                                    const point = hexCentre(cell, size);
                                    current.frontierGraphics.lineStyle(1 / drawZoom, FRONTIER_COLOR, 0.6).beginFill(FRONTIER_COLOR, 0.3)
                                        .drawPolygon(offsets.map((value, i) => value + (i % 2 ? point.y : point.x))).endFill();
                                }
                                const icon = current.frontierGraphics.addChild(frontierIcon(rim.reason, 18));
                                icon.anchor.set(0.5, 0.5);
                                icon.position.set(rim.centre.x, rim.centre.y);
                                icon.scale.set(1 / drawZoom);
                                current.frontierIcons.push(icon);
                            }
                        }
                        if (showDebug && movementDebugEnabled()) {
                            maskMovement(current.debugGraphics);
                            current.debugGraphics.clear();
                            current.debugLegend.text = "";
                            if (area.debug?.cells.length) {
                                const { size, cells } = area.debug;
                                const offsets = hexCorners({ q: 0, r: 0 }, size).flatMap(point => [point.x, point.y]);
                                const terrains = new Set<DebugTerrain>();
                                for (const cell of cells) {
                                    const point = hexCentre(cell, size);
                                    const stroke = cell.multiplier >= 3 ? 0xff6666 : cell.multiplier > 1 ? 0xffbf47 : 0xffffff;
                                    current.debugGraphics.lineStyle(1 / drawZoom, stroke, 0.4)
                                        .beginFill(TERRAIN_COLORS[cell.terrain], 0.12)
                                        .drawPolygon(offsets.map((value, i) => value + (i % 2 ? point.y : point.x))).endFill();
                                    terrains.add(cell.terrain);
                                }
                                const labels = Array.from(terrains, terrain => game.i18n!.localize(`codex-foundry.gridless.debugTerrain.${terrain}`));
                                current.debugLegend.text = game.i18n!.localize("codex-foundry.gridless.debugCostLegend") + "\n"
                                    + game.i18n!.format("codex-foundry.gridless.debugTerrainLegend", { terrains: labels.join(" · ") });
                                current.debugLegend.position.set(center.x, top + 24 / drawZoom);
                                current.debugLegend.scale.set(1 / drawZoom);
                            }
                        }
                    }
                    current.areaPending = false;
                    const next = current.queuedArea;
                    current.queuedArea = undefined;
                    next?.();
                });
            };
            if (!current.areaPending) {
                const next = current.queuedArea;
                current.queuedArea = undefined;
                next();
            }
        }
        ring.scale = scale; ring.zoom = zoom;
        ring.previewMode = previewMode;
        if (!attacksLayoutChanged) return;
        ring.attackGraphics.clear();
        while (ring.attackLabels.length > attackRanges.length) {
            const label = ring.attackLabels.pop()!;
            ring.attackGraphics.removeChild(label); label.destroy();
        }
        for (const [index, range] of attackRanges.entries()) {
            ring.attackGraphics.lineStyle(2 / zoom, range.color, 0.85);
            if (range.kind === "reach") ring.attackGraphics.beginFill(range.color, 0.12);
            ring.attackGraphics.drawCircle(0, 0, range.distance * scale).endFill();
            let label = ring.attackLabels[index];
            if (!label) {
                label = ring.attackGraphics.addChild(new PIXI.Text("", { fontSize: 14, fill: range.color, stroke: 0x000000, strokeThickness: 4 }));
                label.anchor.set(0.5, 0);
                ring.attackLabels.push(label);
            }
            if (attacksChanged) {
                label.style.fill = range.color;
                label.text = game.i18n!.format("codex-foundry.gridless.attackDistance", {
                    attacks: range.label, kind: game.i18n!.localize(`codex-foundry.gridless.${range.kind}`),
                    distance: String(range.distance), units: canvas!.grid!.units,
                });
            }
            label.position.set(0, token.h / 2 + (12 + index * 18) / zoom);
            label.scale.set(1 / zoom);
        }
    }

    // Consume the same preview paths as Foundry's ruler, including movement already spent this turn.
    const prototype = CONFIG.Token.rulerClass.prototype as unknown as MovementRuler;
    const originalRefresh = prototype.refresh;
    const originalClear = prototype.clear;
    prototype.refresh = function (data): void {
        originalRefresh.call(this, data);
        if (!isGridlessActive()) return;
        const plan = data.plannedMovement[game.user!.id];
        const routed = plan?.foundPath?.length ? plan.foundPath : undefined;
        // Follow the live drag path: the ruler's pending waypoints, or the request captured
        // before routing resolves. The routed plan refines the spent distance once it lands.
        const live = data.pendingWaypoints.length ? data.pendingWaypoints : this.token.isDragged ? dragPaths.get(this.token) : undefined;
        const end = live?.at(-1) ?? routed?.at(-1);
        if (end) {
            const history = ownTurn(this.token) ? this.token.measureMovementPath(plan?.history ?? data.passedWaypoints).cost : 0;
            previews.set(this.token, { cost: history + measureProposedMovement(this.token, routed ?? live!),
                center: this.token.document.getCenterPoint(end), waypoint: end });
        } else {
            // Foundry ends movement with an idle refresh; clear() is only ruler teardown.
            previews.delete(this.token);
            dragPaths.delete(this.token);
        }
        refresh(this.token);
    };
    prototype.clear = function (): void {
        originalClear.call(this);
        previews.delete(this.token);
        dragPaths.delete(this.token);
        if (canvas?.ready) refresh(this.token);
    };

    const refreshSelection = (): void => {
        if (!canvas?.ready) return;
        const selected = canvas.tokens!.controlled;
        for (const token of rings.keys()) if (selected.length !== 1 || selected[0] !== token) remove(token);
        if (selected.length === 1) refresh(selected[0]);
    };
    Hooks.on("controlToken", refreshSelection);
    Hooks.on("refreshToken", refresh);
    Hooks.on("destroyToken", (token) => { previews.delete(token); remove(token); });
    for (const hook of ["createWall", "updateWall", "deleteWall", "createRegion", "updateRegion", "deleteRegion",
        "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior", "updateScene", "updateActor",
        "createItem", "updateItem", "deleteItem", "visibilityRefresh"] as const) {
        Hooks.on(hook, refreshSelection);
    }
    Hooks.on("canvasReady", refreshSelection);
    for (const hook of ["updateCombat", "deleteCombat"] as const) Hooks.on(hook, () => {
        if (!canvas?.ready) return;
        for (const token of canvas.tokens!.controlled) { previews.delete(token); refresh(token); }
    });
    Hooks.on("canvasPan", () => { for (const token of rings.keys()) refresh(token); });
    Hooks.on("canvasTearDown", () => {
        movementPreviewHeld = false;
        container?.destroy({ children: true });
        container = null;
        fogMask = null;
        for (const [token, ring] of rings) { ring.area?.cancel(); previews.delete(token); }
        rings.clear();
    });
    refreshSelection();
}
