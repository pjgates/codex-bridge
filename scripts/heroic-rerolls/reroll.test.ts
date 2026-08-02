import { afterEach, describe, expect, it, vi } from "vitest";
import {
    activateHeroicRerolls,
    addHeroicRerollMinimum,
    onHeroicPreReroll,
} from "../../src/rulesets/sf2e/heroic-rerolls/reroll.js";

interface TestDie {
    number: number;
    faces: number;
    modifiers: string[];
}

function createDie(number = 1, faces = 20, modifiers: string[] = []): TestDie {
    return { number, faces, modifiers };
}

function createRoll(...dice: TestDie[]) {
    return { dice };
}

const HERO_POINTS = { slug: "hero-points" };

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("addHeroicRerollMinimum", () => {
    it("adds exactly one min10 modifier to a Hero Point single-d20 reroll", () => {
        const roll = createRoll(createDie());

        expect(addHeroicRerollMinimum(roll, HERO_POINTS)).toBe(true);
        expect(addHeroicRerollMinimum(roll, HERO_POINTS)).toBe(false);

        expect(roll.dice[0].modifiers).toEqual(["min10"]);
    });

    it.each([
        { resource: { slug: "mythic-points" } },
        { resource: null },
    ])("does not change rerolls that do not spend a Hero Point", ({ resource }) => {
        const roll = createRoll(createDie());

        expect(addHeroicRerollMinimum(roll, resource)).toBe(false);
        expect(roll.dice[0].modifiers).toEqual([]);
    });

    it.each([
        { number: 2, faces: 20, modifiers: ["kh"] },
        { number: 2, faces: 20, modifiers: ["kl"] },
        { number: 1, faces: 12, modifiers: [] },
    ])("does not change a $number d$faces reroll", ({ number, faces, modifiers }) => {
        const roll = createRoll(createDie(number, faces, modifiers));
        const originalModifiers = [...modifiers];

        expect(addHeroicRerollMinimum(roll, HERO_POINTS)).toBe(false);
        expect(roll.dice[0].modifiers).toEqual(originalModifiers);
    });

    it("does not change a formula with multiple single-d20 terms", () => {
        const roll = createRoll(createDie(), createDie());

        expect(addHeroicRerollMinimum(roll, HERO_POINTS)).toBe(false);
        expect(roll.dice.map((die) => die.modifiers)).toEqual([[], []]);
    });

    it("adds min10 after a weaker existing minimum", () => {
        const roll = createRoll(createDie(1, 20, ["min5"]));

        expect(addHeroicRerollMinimum(roll, HERO_POINTS)).toBe(true);
        expect(roll.dice[0].modifiers).toEqual(["min5", "min10"]);
    });

    it.each(["min10", "min15"])("preserves an existing sufficient %s modifier", (modifier) => {
        const roll = createRoll(createDie(1, 20, [modifier]));

        expect(addHeroicRerollMinimum(roll, HERO_POINTS)).toBe(false);
        expect(roll.dice[0].modifiers).toEqual([modifier]);
    });
});

describe("onHeroicPreReroll", () => {
    it("changes only the unevaluated replacement roll", () => {
        const oldRoll = createRoll(createDie());
        const newRoll = createRoll(createDie());

        onHeroicPreReroll(oldRoll as unknown as Roll, newRoll as unknown as Roll, HERO_POINTS);

        expect(oldRoll.dice[0].modifiers).toEqual([]);
        expect(newRoll.dice[0].modifiers).toEqual(["min10"]);
    });
});

describe("activateHeroicRerolls", () => {
    it("registers the pre-evaluation reroll hook rather than the evaluated reroll hook", () => {
        const on = vi.fn();
        vi.stubGlobal("Hooks", { on });
        vi.spyOn(console, "log").mockImplementation(() => undefined);

        activateHeroicRerolls();

        expect(on).toHaveBeenCalledOnce();
        expect(on).toHaveBeenCalledWith("pf2e.preReroll", onHeroicPreReroll);
        expect(on).not.toHaveBeenCalledWith("pf2e.reroll", expect.anything());
    });
});