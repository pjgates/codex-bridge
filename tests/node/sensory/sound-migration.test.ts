import { afterEach, expect, it, vi } from "vitest";
import { migrateSensorySounds, hasSensorySoundAssignment, resolveSensorySoundChannel } from "../../../src/canvas/sensory/sound-channel.js";
import { definition } from "./fixtures.js";
afterEach(() => vi.unstubAllGlobals());
it("migrates legacy broadcasts once, preserving broken-reference privacy and explicit channel edits", async () => {
    const make = (flags: Record<string, unknown>) => ({ flags: { "codex-foundry": flags }, path: "same.ogg",
        update: vi.fn(async (change: Record<string, unknown>) => {
            if ("flags.codex-foundry.sensoryChannel" in change) flags.sensoryChannel = change["flags.codex-foundry.sensoryChannel"];
            delete flags.sensoryEffect;
        }) });
    const sounds = [make({ sensoryEffect: "Item.signal" }), make({ sensoryEffect: "Item.deleted" }),
        make({ sensoryEffect: "Item.signal", sensoryChannel: "edited" }), make({ sensoryEffect: "" })];
    const world = { uuid: "Item.signal", type: "effect", system: { rules: definition("gold").rules } };
    const user = { isGM: false };
    vi.stubGlobal("game", { user, scenes: [{ sounds }], items: new Map([["signal", world]]) });
    await migrateSensorySounds();
    expect(sounds[0].update).not.toHaveBeenCalled();
    user.isGM = true;
    await migrateSensorySounds(); await migrateSensorySounds();
    expect(sounds.map(sound => sound.flags["codex-foundry"])).toEqual([
        { sensoryChannel: "gold" }, { sensoryChannel: null }, { sensoryChannel: "edited" }, { sensoryChannel: "" },
    ]);
    expect(hasSensorySoundAssignment(sounds[1])).toBe(true);
    expect(resolveSensorySoundChannel(sounds[1])).toBeNull();
    for (const sound of sounds) { expect(sound.update).toHaveBeenCalledTimes(1); expect(sound.path).toBe("same.ogg"); }
});
it("preserves the legacy broadcast channel even without enabled capabilities or with newly authored rules", async () => {
    const legacy = { channel: "old-channel", emission: { enabled: false, strength: "rank", fixed: 1, colour: "#ffffff" },
        glow: { enabled: false, minRank: 1, range: 0, walls: false }, hearing: { enabled: false, minRank: 1 } };
    const world = { uuid: "Item.signal", type: "effect", flags: { "codex-foundry": { sensory: legacy } }, system: { rules: [] as object[] } };
    const sound = { flags: { "codex-foundry": { sensoryEffect: "Item.signal" } }, update: vi.fn() };
    vi.stubGlobal("game", { user: { isGM: true }, scenes: [{ sounds: [sound] }], items: new Map([["signal", world]]) });
    await migrateSensorySounds();
    expect(sound.update).toHaveBeenLastCalledWith({ "flags.codex-foundry.sensoryChannel": "old-channel", "flags.codex-foundry.-=sensoryEffect": null });
    world.system.rules = definition("new-channel").rules;
    await migrateSensorySounds();
    expect(sound.update).toHaveBeenLastCalledWith({ "flags.codex-foundry.sensoryChannel": "old-channel", "flags.codex-foundry.-=sensoryEffect": null });
});
