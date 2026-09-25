import { afterEach, expect, it, vi } from "vitest";
import { migrateSensoryEffects } from "../../../src/canvas/sensory/migration.js";
import { legacyDefinition } from "./fixtures.js";

afterEach(() => vi.unstubAllGlobals());

function legacyEffect(rules: object[] = [{ key: "RollOption", option: "legacy" }]) {
    const item = { uuid: "Item.signal", type: "effect", isEmbedded: false, pack: null,
        flags: { "codex-foundry": { sensory: legacyDefinition(), other: "keep" } },
        system: { rules, badge: { type: "counter", value: 3 }, unidentified: true },
        toObject() { return { system: structuredClone(this.system) }; },
        update: vi.fn(async (changes: Record<string, unknown>) => {
            if ("system.rules" in changes) item.system.rules = structuredClone(changes["system.rules"] as object[]);
            if ("flags.codex-foundry.-=sensory" in changes) Reflect.deleteProperty(item.flags["codex-foundry"], "sensory");
        }),
    };
    return item;
}

it("appends converted rules once and removes only the obsolete sensory flag", async () => {
    const item = legacyEffect();
    vi.stubGlobal("game", { user: { isGM: true }, items: { contents: [item] } });
    await migrateSensoryEffects();
    expect(item.update).toHaveBeenCalledExactlyOnceWith({
        "system.rules": [
            { key: "RollOption", option: "legacy" },
            { key: "CodexEmitSignal", channel: "alpha", strength: "rank", fixed: 1, colour: "#aabbcc" },
            { key: "CodexPerceiveSignal", channel: "alpha", minRank: 2, range: 25, walls: false },
            { key: "CodexHearSignal", channel: "alpha", minRank: 1 },
        ],
        "flags.codex-foundry.-=sensory": null,
    });
    await migrateSensoryEffects();
    expect(item.update).toHaveBeenCalledTimes(1);
    expect(item.flags["codex-foundry"]).toEqual({ other: "keep" });
});

it("keeps authored sensory rules authoritative even when they are ignored", async () => {
    const authored = { key: "CodexHearSignal", channel: "edited", minRank: 5, ignored: true };
    const item = legacyEffect([authored, { key: "RollOption", option: "ordinary" }]);
    vi.stubGlobal("game", { user: { isGM: true }, items: { contents: [item] } });
    await migrateSensoryEffects();
    expect(item.update).toHaveBeenCalledExactlyOnceWith({ "flags.codex-foundry.-=sensory": null });
});

it("limits migration to the GM and world Effects with a legacy flag", async () => {
    const eligible = legacyEffect();
    const excluded = [
        { ...legacyEffect(), type: "feat" },
        { ...legacyEffect(), isEmbedded: true },
        { ...legacyEffect(), pack: "module.effects" },
        { ...legacyEffect(), flags: {} },
    ];
    const user = { isGM: false };
    vi.stubGlobal("game", { user, items: { contents: [eligible, ...excluded] } });
    await migrateSensoryEffects();
    expect(eligible.update).not.toHaveBeenCalled();
    user.isGM = true;
    await migrateSensoryEffects();
    expect(eligible.update).toHaveBeenCalledOnce();
    for (const item of excluded) expect(item.update).not.toHaveBeenCalled();
});
