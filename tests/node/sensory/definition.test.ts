import { afterEach, expect, it, vi } from "vitest";
import { lookupWorldDefinition, readDefinition, resolveApplications } from "../../../src/canvas/sensory/definition.js";
import { definition, effect } from "./fixtures.js";
afterEach(() => vi.unstubAllGlobals());

it("follows canonical edits while retaining individual ranks and disabling deleted definitions", () => {
    const definitions = new Map([["Item.signal", definition()]]);
    const lookup = (uuid: string) => definitions.get(uuid) ?? null;
    const item = effect(3);
    expect(resolveApplications([item], lookup)[0]?.rank).toBe(3);
    definitions.set("Item.signal", { ...definition(), channel: "beta" });
    expect(resolveApplications([item], lookup)[0]?.definition.channel).toBe("beta");
    definitions.clear();
    expect(resolveApplications([item], lookup)).toEqual([]);
});

it("decodes complete definitions and rejects malformed active settings", () => {
    const valid = definition();
    expect(readDefinition(valid)?.channel).toBe("alpha");
    for (const invalid of [null, { ...valid, channel: "" }, { ...valid, emission: false },
        { ...valid, glow: { ...valid.glow, range: 0 } },
        { ...valid, hearing: { ...valid.hearing, minRank: 1.5 } }]) expect(readDefinition(invalid)).toBeNull();
    expect(readDefinition({ ...valid, glow: { ...valid.glow, enabled: false, range: 0 } })?.glow.range).toBe(0);
});

it("ignores expiry and zero rank and never replaces an explicit broken reference with provenance", () => {
    const item = effect(3);
    const lookup = (uuid: string) => uuid === "Item.signal" ? definition() : null;
    expect(resolveApplications([{ ...item, badge: null }], lookup)[0]?.rank).toBe(1);
    expect(resolveApplications([{ ...item, isExpired: true }, effect(0),
        { ...item, flags: { "codex-foundry": { sensoryDefinition: null } } }], lookup)).toEqual([]);
    expect(resolveApplications([{ ...item, flags: {} }], lookup)[0]?.rank).toBe(3);
});

it("resolves only world Effect identities, independently of template expiry", () => {
    const world = { uuid: "Item.signal", type: "effect", isEmbedded: false, pack: null,
        flags: { "codex-foundry": { sensory: definition() } }, isExpired: true };
    vi.stubGlobal("game", { items: new Map([["signal", world]]) });
    expect(lookupWorldDefinition("Item.signal")?.channel).toBe("alpha");
    for (const uuid of ["Actor.a.Item.signal", "Compendium.x.y.Item.signal", "Item.deleted"]) expect(lookupWorldDefinition(uuid)).toBeNull();
    world.isEmbedded = true;
    expect(lookupWorldDefinition("Item.signal")).toBeNull();
});
