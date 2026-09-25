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
