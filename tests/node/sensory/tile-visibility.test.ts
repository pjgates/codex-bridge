import { afterEach, expect, it, vi } from "vitest";
import { installSensoryTileVisibility, refreshSensoryTileVisibility } from "../../../src/canvas/sensory/tile-visibility.js";
import { effect } from "./fixtures.js";

afterEach(() => vi.unstubAllGlobals());

function fixture(condition: unknown = { effectUuid: "Item.signal", minRank: 2 }) {
    const hooks: Record<string, (...args: any[]) => void> = {};
    const mesh = { unoccludedAlpha: 0.7, occludedAlpha: 0.25, visible: false, renderable: true,
        alpha: 0.5, mask: {}, hidden: true, elevation: 10, occlusionMode: 4, restrictsLight: true, restrictsWeather: true };
    const document = { alpha: 0.7, occlusion: { alpha: 0.25 }, flags: { "codex-foundry": { sensoryVisibility: condition } } };
    let pending = false;
    const tile = { document, mesh, renderFlags: { set: (flags: { refreshMesh?: boolean }) => { pending ||= !!flags.refreshMesh; } } };
    const pc = () => ({ actor: { type: "character", items: [effect(2)], testUserPermission: () => true } });
    const selected = [{ document: pc() }];
    const world = { uuid: "Item.signal", type: "effect", isEmbedded: false, pack: null };
    const items = new Map([["signal", world]]);
    vi.stubGlobal("Hooks", { on: (name: string, callback: any) => { hooks[name] = callback; } });
    vi.stubGlobal("game", { user: { id: "player", isGM: true }, items });
    vi.stubGlobal("canvas", { ready: true, tiles: { placeables: [tile] }, tokens: { controlled: selected } });
    // Foundry 14 Tile._refreshMesh restores these values before refreshTile runs.
    const nativeRefresh = () => {
        mesh.unoccludedAlpha = document.alpha; mesh.occludedAlpha = document.occlusion.alpha;
        hooks.refreshTile(tile, { refreshMesh: true });
    };
    const flush = () => { if (pending) { pending = false; nativeRefresh(); } expect(pending).toBe(false); };
    installSensoryTileVisibility();
    return { hooks, mesh, tile, document, selected, pc, world, items, nativeRefresh, flush };
}

it("gates actual art for any selected qualifying PC, restores native opacity, and preserves rendering boundaries", () => {
    const f = fixture(), original = { ...f.mesh };
    f.selected.push({ document: f.pc() });
    f.selected[0].document.actor.items[0].badge.value = 1;
    refreshSensoryTileVisibility(); f.flush();
    expect(f.mesh).toEqual(original);
    f.selected.pop();
    refreshSensoryTileVisibility();
    expect(f.mesh).toEqual({ ...original, unoccludedAlpha: 0, occludedAlpha: 0 });
    f.nativeRefresh();
    expect([f.mesh.unoccludedAlpha, f.mesh.occludedAlpha]).toEqual([0, 0]);
    f.selected[0].document.actor.items[0].badge.value = 2;
    f.document.alpha = 0.6; f.document.occlusion.alpha = 0.1;
    refreshSensoryTileVisibility(); f.flush();
    expect(f.mesh).toEqual({ ...original, unoccludedAlpha: 0.6, occludedAlpha: 0.1 });
    f.selected.length = 0; refreshSensoryTileVisibility();
    expect([f.mesh.unoccludedAlpha, f.mesh.occludedAlpha]).toEqual([0, 0]);
    f.document.flags["codex-foundry"].sensoryVisibility = undefined;
    refreshSensoryTileVisibility(); f.flush();
    expect([f.mesh.unoccludedAlpha, f.mesh.occludedAlpha]).toEqual([0.6, 0.1]);
});

it.each(["ownership", "npc", "expired", "zero", "fractional", "deleted", "non-effect", "embedded", "compendium", "wrong-canonical"])(
    "closes art when qualification is lost: %s", reason => {
        const f = fixture(), actor = f.selected[0].document.actor, application = actor.items[0];
        refreshSensoryTileVisibility(); f.flush();
        expect(f.mesh.unoccludedAlpha).toBe(0.7);
        if (reason === "ownership") actor.testUserPermission = () => false;
        if (reason === "npc") actor.type = "npc";
        if (reason === "expired") application.isExpired = true;
        if (reason === "zero") application.badge.value = 0;
        if (reason === "fractional") application.badge.value = 2.5;
        if (reason === "deleted") f.items.clear();
        if (reason === "non-effect") f.world.type = "spell";
        if (reason === "embedded") f.world.isEmbedded = true;
        if (reason === "compendium") Object.assign(f.world, { pack: "pack.effects" });
        if (reason === "wrong-canonical") application.flags["codex-foundry"].sensoryDefinition = "Item.other";
        refreshSensoryTileVisibility();
        expect([f.mesh.unoccludedAlpha, f.mesh.occludedAlpha]).toEqual([0, 0]);
    });

it("accepts a sourceId fallback and rank one without sensory rules, but never falls back from a malformed canonical reference", () => {
    const f = fixture({ effectUuid: "Item.signal", minRank: 1 }), application = f.selected[0].document.actor.items[0];
    Object.assign(application, { flags: {}, badge: null });
    refreshSensoryTileVisibility(); f.flush();
    expect(f.mesh.unoccludedAlpha).toBe(0.7);
    Object.assign(application, { flags: { "codex-foundry": { sensoryDefinition: null } } });
    refreshSensoryTileVisibility();
    expect(f.mesh.unoccludedAlpha).toBe(0);
});

it.each([null, [], "Item.signal", {}, { effectUuid: "Item.signal", minRank: 0 },
    { effectUuid: "Item.signal", minRank: 1.5 }, { effectUuid: "Item.signal", minRank: "2" },
    { effectUuid: "Compendium.pack.Item.signal", minRank: 1 }].map(condition => ({ condition })))("fails closed for malformed configured conditions: $condition", ({ condition }) => {
    const f = fixture(condition);
    f.hooks.drawTile(f.tile);
    expect([f.mesh.unoccludedAlpha, f.mesh.occludedAlpha]).toEqual([0, 0]);
});

it("leaves empty conditions unconditional and suppresses a newly drawn gated mesh before the first refresh", () => {
    const f = fixture({ effectUuid: "", minRank: 0 });
    f.selected.length = 0;
    f.hooks.drawTile(f.tile);
    expect([f.mesh.unoccludedAlpha, f.mesh.occludedAlpha]).toEqual([0.7, 0.25]);
    f.document.flags["codex-foundry"].sensoryVisibility = { effectUuid: "Item.signal", minRank: 2 };
    f.hooks.drawTile(f.tile);
    expect([f.mesh.unoccludedAlpha, f.mesh.occludedAlpha]).toEqual([0, 0]);
});
