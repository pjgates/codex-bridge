import { describe, expect, it } from "vitest";
import { endsFlight, fallOutcome, fallProfile, landingLevel, type FallProfile } from "../../../src/rulesets/sf2e/flying/fall.js";

const profile = (over: Partial<FallProfile> = {}): FallProfile =>
    ({ acrobaticsRank: 0, athleticsRank: 0, abilities: new Map(), hasFlySpeed: false, ...over });
const abilities = (...slugs: string[]) => new Map(slugs.map(slug => [slug, slug]));

describe("fallOutcome", () => {
    it("deals half the distance as bludgeoning and lands prone; 5 ft or less is free", () => {
        expect(fallOutcome(30, profile())).toMatchObject({ effective: 30, damage: 15, prone: true });
        expect(fallOutcome(5, profile())).toMatchObject({ damage: 0, prone: false });
        expect(fallOutcome(0, profile())).toMatchObject({ damage: 0, prone: false });
    });

    it("shortens the fall for Cat Fall by Acrobatics rank and stacks Wind Pillow", () => {
        const catFall = (rank: number) => fallOutcome(60, profile({ acrobaticsRank: rank, abilities: abilities("cat-fall", "wind-pillow") }));
        expect(catFall(1)).toMatchObject({ effective: 40, damage: 20 });
        expect(catFall(2)).toMatchObject({ effective: 25, damage: 12 });
        expect(catFall(3)).toMatchObject({ effective: 0, damage: 0, prone: false });
        expect(catFall(4)).toMatchObject({ damage: 0, prone: false, immune: ["cat-fall"] });
    });

    it("uses Athletics for Superhero Landing and never lands a legendary one prone", () => {
        expect(fallOutcome(120, profile({ athleticsRank: 3, abilities: abilities("superhero-landing") }))).toMatchObject({ effective: 20, damage: 10, prone: true });
        expect(fallOutcome(120, profile({ athleticsRank: 4, abilities: abilities("superhero-landing") }))).toMatchObject({ damage: 0, prone: false });
    });

    it("halves damage for Plumekith, Rubbery Body and Land on Your Feet, which also stays upright", () => {
        expect(fallOutcome(40, profile({ abilities: abilities("plumekith") }))).toMatchObject({ damage: 10, prone: true });
        expect(fallOutcome(40, profile({ abilities: abilities("rubbery-body") }))).toMatchObject({ damage: 10, prone: true });
        expect(fallOutcome(40, profile({ abilities: abilities("land-on-your-feet") }))).toMatchObject({ damage: 10, prone: false });
    });

    it("negates damage entirely for immunity abilities", () => {
        for (const slug of ["unbreakable-er-goblin", "current-rider", "basic-insectile-flight", "bouncy-orb-bantrid", "spell-effect-ash-form"]) {
            expect(fallOutcome(100, profile({ abilities: abilities(slug) }))).toMatchObject({ damage: 0, prone: false, immune: [slug] });
        }
    });

    it("lists optional reactions that fit the fall", () => {
        expect(fallOutcome(30, profile({ hasFlySpeed: true, abilities: abilities("impressive-landing", "arrest-a-fall", "rolling-landing") })).reactions)
            .toEqual(["impressive-landing", "arrest-a-fall"]);
        expect(fallOutcome(5, profile({ abilities: abilities("impressive-landing") })).reactions).toEqual([]);
        expect(fallOutcome(30, profile({ acrobaticsRank: 4, abilities: abilities("cat-fall", "rolling-landing") })).reactions).toEqual(["rolling-landing"]);
    });
});

describe("fallProfile", () => {
    it("reads ranks, ability slugs by name and a fly speed from a PF2e actor", () => {
        const actor = {
            items: [{ type: "feat", name: "Cat Fall", system: { slug: "cat-fall" } }, { type: "weapon", name: "Sword", system: { slug: "sword" } },
                { type: "effect", name: "Spell Effect: Ash Form", system: { slug: "spell-effect-ash-form" } }, { type: "action", name: "Arrest a Fall", system: { slug: "arrest-a-fall" } }],
            skills: { acrobatics: { rank: 2 }, athletics: { rank: 1 } },
            system: { movement: { speeds: { fly: { value: 20 } } } },
        };
        const result = fallProfile(actor);
        expect(result).toMatchObject({ acrobaticsRank: 2, athleticsRank: 1, hasFlySpeed: true });
        expect([...result.abilities]).toEqual([["cat-fall", "Cat Fall"], ["spell-effect-ash-form", "Spell Effect: Ash Form"], ["arrest-a-fall", "Arrest a Fall"]]);
        expect(fallProfile({ items: [], system: {} })).toMatchObject({ acrobaticsRank: 0, hasFlySpeed: false });
    });
});

describe("landingLevel", () => {
    const levels = [{ id: "lower", bottom: -Infinity, top: -10 }, { id: "upper", bottom: -10, top: Infinity }];
    it("keeps the current level when it holds the landing height, else picks the level whose band does", () => {
        expect(landingLevel(levels, "upper", 0)).toBe("upper");
        expect(landingLevel(levels, "upper", -15)).toBe("lower");
        expect(landingLevel(levels, "upper", -10)).toBe("upper");
        expect(landingLevel([], "upper", -15)).toBe("upper");
    });
});

describe("endsFlight", () => {
    const actions = { walk: {}, fly: {}, blink: { teleport: true }, displace: { teleport: true }, climb: {}, jump: {} };
    it("is true when the move finishes on a ground action", () => {
        expect(endsFlight([{ action: "fly" }, { action: "walk" }], actions)).toBe(true);
        expect(endsFlight([{ action: "walk" }, { action: "fly" }], actions)).toBe(false);
        expect(endsFlight([{ action: "fly" }, { action: "blink" }], actions)).toBe(false);
        expect(endsFlight([{ action: "displace" }], actions)).toBe(false);
        expect(endsFlight([{ action: "climb" }], actions)).toBe(true);
        expect(endsFlight([], actions)).toBe(false);
    });
});
