import { afterEach, describe, expect, it, vi } from "vitest";
import { activateFlyingEffect, FLYING_SLUG, flyingEffectData, isFlying, toggleFlying } from "../../../src/rulesets/sf2e/flying/effect.js";

afterEach(() => vi.unstubAllGlobals());

type Hook = (...args: any[]) => unknown;

function actorWith(slugs: string[]) {
    const items = slugs.map((slug, index) => ({ id: `item${index}`, type: "effect", system: { slug }, delete: vi.fn() }));
    const tokens: { update: (changes: { movementAction: string | null }) => unknown }[] = [];
    return {
        items, created: [] as object[], tokens,
        getActiveTokens: () => tokens,
        async createEmbeddedDocuments(_name: string, data: object[]) { this.created.push(...data); },
    };
}

describe("flying effect", () => {
    it("is a PF2e effect item that shows on the token and never expires", () => {
        const data = flyingEffectData();
        expect(data.type).toBe("effect");
        expect(data.system.slug).toBe(FLYING_SLUG);
        expect(data.system.tokenIcon.show).toBe(true);
        expect(data.system.duration.unit).toBe("unlimited");
    });

    it("reads flight from the effect's slug", () => {
        expect(isFlying(actorWith(["codex-flying"]))).toBe(true);
        expect(isFlying(actorWith(["other"]))).toBe(false);
        expect(isFlying(null)).toBe(false);
    });
});

describe("toggleFlying", () => {
    it("adds the effect to grounded actors and removes it from flying ones, once per actor", async () => {
        const grounded = actorWith([]);
        const flying = actorWith([FLYING_SLUG]);
        await toggleFlying([{ actor: grounded }, { actor: grounded }, { actor: flying }, { actor: null }]);
        expect(grounded.created).toHaveLength(1);
        expect(flying.items[0].delete).toHaveBeenCalledTimes(1);
    });
});

describe("movement action sync", () => {
    function setup(userId = "me") {
        const hooks: Record<string, Hook> = {};
        vi.stubGlobal("Hooks", { on: (name: string, callback: Hook) => { hooks[name] = callback; } });
        vi.stubGlobal("game", { user: { id: "me" } });
        activateFlyingEffect();
        const actor = actorWith([FLYING_SLUG]);
        const token = { update: vi.fn() };
        actor.tokens.push(token);
        const item = { type: "effect", system: { slug: FLYING_SLUG }, actor };
        return { hooks, token, item, userId };
    }

    it("sets the fly movement action when the effect appears and clears it when it goes", () => {
        const { hooks, token, item, userId } = setup();
        hooks.createItem(item, {}, userId);
        expect(token.update).toHaveBeenCalledWith({ movementAction: "fly" });
        hooks.deleteItem(item, {}, userId);
        expect(token.update).toHaveBeenCalledWith({ movementAction: null });
    });

    it("only the client that made the change touches tokens, and only for the flying effect", () => {
        const { hooks, token, item } = setup();
        hooks.createItem(item, {}, "someone-else");
        hooks.createItem({ ...item, system: { slug: "other" } }, {}, "me");
        expect(token.update).not.toHaveBeenCalled();
    });
});
