import { describe, expect, it } from "vitest";
import { applyHeroicRerollFloor, onHeroicReroll } from "../../src/heroic-rerolls/reroll.js";

function createRoll(result: number, { active = true, faces = 20, number = 1 } = {}) {
    return {
        dice: [{ number, faces, results: [{ active, result }] }],
        _total: result + 7,
    };
}

const HERO_POINTS = { slug: "hero-points" };

describe("applyHeroicRerollFloor", () => {
    it.each([
        [9, 10],
        [2, 10],
        [17, 17],
    ])("changes a Hero Point reroll of %i to %i", (result, expected) => {
        const roll = createRoll(result);

        applyHeroicRerollFloor(roll, HERO_POINTS);

        expect(roll.dice[0].results[0].result).toBe(expected);
        expect(roll._total).toBe(expected + 7);
    });

    it("leaves a result of 10 unchanged", () => {
        const roll = createRoll(10);

        expect(applyHeroicRerollFloor(roll, HERO_POINTS)).toBe(false);
        expect(roll).toEqual(createRoll(10));
    });

    it("does not change rerolls that do not spend a Hero Point", () => {
        const roll = createRoll(2);

        expect(applyHeroicRerollFloor(roll, { slug: "mythic-points" })).toBe(false);
        expect(roll).toEqual(createRoll(2));
    });

    it("does not change ordinary rerolls without a resource", () => {
        const roll = createRoll(2);

        expect(applyHeroicRerollFloor(roll, null)).toBe(false);
        expect(roll).toEqual(createRoll(2));
    });

    it("does not change an inactive d20 result", () => {
        const roll = createRoll(2, { active: false });

        expect(applyHeroicRerollFloor(roll, HERO_POINTS)).toBe(false);
        expect(roll).toEqual(createRoll(2, { active: false }));
    });

    it("does not change a non-d20 result", () => {
        const roll = createRoll(2, { faces: 12 });

        expect(applyHeroicRerollFloor(roll, HERO_POINTS)).toBe(false);
        expect(roll).toEqual(createRoll(2, { faces: 12 }));
    });
});

describe("onHeroicReroll", () => {
    it("floors only the evaluated replacement roll", () => {
        const oldRoll = createRoll(2);
        const newRoll = createRoll(9);

        onHeroicReroll(oldRoll as unknown as Roll, newRoll as unknown as Roll, HERO_POINTS);

        expect(oldRoll).toEqual(createRoll(2));
        expect(newRoll).toEqual(createRoll(10));
    });

    it("does not throw for ordinary rerolls without a resource", () => {
        const oldRoll = createRoll(2);
        const newRoll = createRoll(9);

        onHeroicReroll(oldRoll as unknown as Roll, newRoll as unknown as Roll, null);

        expect(oldRoll).toEqual(createRoll(2));
        expect(newRoll).toEqual(createRoll(9));
    });
});
