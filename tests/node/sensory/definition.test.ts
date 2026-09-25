import { afterEach, expect, it, vi } from "vitest";
import { lookupWorldDefinition, readDefinition, resolveApplications } from "../../../src/canvas/sensory/definition.js";
import { definition, legacyDefinition, effect } from "./fixtures.js";
afterEach(() => vi.unstubAllGlobals());

it("follows canonical edits while retaining individual ranks and disabling deleted definitions", () => {
    const definitions = new Map([["Item.signal", definition()]]);
    const lookup = (uuid: string) => definitions.get(uuid) ?? null;
    const item = effect(3);
    expect(resolveApplications([item], lookup)[0]?.rank).toBe(3);
    definitions.set("Item.signal", definition("beta"));
    expect(resolveApplications([item], lookup)[0]?.definition.rules[0].channel).toBe("beta");
    definitions.clear();
    expect(resolveApplications([item], lookup)).toEqual([]);
});

it("decodes complete definitions and rejects malformed active settings", () => {
    const valid = legacyDefinition();
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
        flags: { "codex-foundry": { sensory: legacyDefinition() } }, isExpired: true };
    vi.stubGlobal("game", { items: new Map([["signal", world]]) });
    expect(lookupWorldDefinition("Item.signal")?.rules[0]?.channel).toBe("alpha");
    for (const uuid of ["Actor.a.Item.signal", "Compendium.x.y.Item.signal", "Item.deleted"]) expect(lookupWorldDefinition(uuid)).toBeNull();
    world.isEmbedded = true;
    expect(lookupWorldDefinition("Item.signal")).toBeNull();
});

it("resolves mixed canonical rule arrays without merging separate channel capabilities", () => {
    const world = { uuid: "Item.signal", type: "effect", isEmbedded: false, pack: null, flags: {}, system: { rules: [
        { key: "CodexEmitSignal", channel: "gold", colour: "#ffd700" },
        { key: "CodexHearSignal", channel: "voice", minRank: 2 },
        { key: "FlatModifier", value: 1 },
    ] } };
    vi.stubGlobal("game", { items: new Map([["signal", world]]) });
    const applied = effect(3);
    expect(resolveApplications([applied], lookupWorldDefinition)[0]).toMatchObject({ rank: 3,
        definition: { rules: [{ key: "CodexEmitSignal", channel: "gold" }, { key: "CodexHearSignal", channel: "voice" }] } });
    world.system.rules[0].channel = "changed";
    expect(resolveApplications([applied], lookupWorldDefinition)[0]?.definition.rules[0].channel).toBe("changed");
    world.system.rules = [];
    expect(resolveApplications([applied], lookupWorldDefinition)[0]?.definition.rules).toEqual([]);
});

it("applies native actor predicates from the current canonical rule rather than stale copied rules", () => {
    const canonical = { rules: [{ key: "CodexHearSignal" as const, channel: "voice", minRank: 1,
        predicate: ["self:ready"] }] };
    let active = true;
    vi.stubGlobal("game", { pf2e: { RuleElements: { custom: { CodexHearSignal: class { isActive() { return active; } } } } } });
    vi.stubGlobal("foundry", { utils: { deepClone: structuredClone } });
    const item = effect(2);
    expect(resolveApplications([item], () => canonical)[0]?.definition.rules).toHaveLength(1);
    active = false;
    expect(resolveApplications([item], () => canonical)[0]?.definition.rules).toEqual([]);
});
