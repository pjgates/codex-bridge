import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildActorDocument } from "../bestiary-actor.js";
import { parseCreature } from "../bestiary-parse.js";

const FIXTURE_DIR = path.join(import.meta.dirname, "fixtures");

/**
 * Integration test: parse the Scrap Rat fixture (Pathfinder 2e Creature
 * Layout format) → build actor JSON → validate against the expected
 * PF2e system data structure.
 */
describe("Scrap Rat end-to-end conversion", () => {
    const raw = readFileSync(path.join(FIXTURE_DIR, "scrap-rat.md"), "utf-8");
    const parsed = parseCreature("scrap-rat.md", raw)!;
    const actor = buildActorDocument(parsed) as Record<string, unknown>;
    const system = actor.system as Record<string, unknown>;

    it("produces a valid NPC actor", () => {
        expect(actor.type).toBe("npc");
        expect(actor.name).toBe("Scrap Rat");
        expect(typeof actor._id).toBe("string");
        expect((actor._id as string).length).toBe(16);
    });

    it("matches system ability modifiers", () => {
        const abilities = system.abilities as Record<string, { mod: number }>;
        expect(abilities.str.mod).toBe(2);
        expect(abilities.dex.mod).toBe(3);
        expect(abilities.con.mod).toBe(1);
        expect(abilities.int.mod).toBe(-3);
        expect(abilities.wis.mod).toBe(1);
        expect(abilities.cha.mod).toBe(-3);
    });

    it("matches system AC, HP, and speed", () => {
        const attrs = system.attributes as Record<string, unknown>;
        expect((attrs.ac as { value: number }).value).toBe(14);
        expect((attrs.hp as { max: number }).max).toBe(8);
        expect((attrs.hp as { value: number }).value).toBe(8);
        expect((attrs.speed as { value: number }).value).toBe(25);
        expect((attrs.speed as { otherSpeeds: unknown[] }).otherSpeeds).toEqual([]);
    });

    it("matches system saves", () => {
        const saves = system.saves as Record<string, { value: number }>;
        expect(saves.fortitude.value).toBe(5);
        expect(saves.reflex.value).toBe(8);
        expect(saves.will.value).toBe(2);
    });

    it("matches system perception", () => {
        const perception = system.perception as { mod: number; senses: unknown[] };
        expect(perception.mod).toBe(7);
        expect(perception.senses).toHaveLength(2);
        expect(perception.senses[0]).toEqual({ type: "low-light-vision" });
        expect(perception.senses[1]).toEqual({ type: "scent", acuity: "imprecise", range: 30 });
    });

    it("matches system skills", () => {
        const skills = system.skills as Record<string, { base: number }>;
        expect(skills.acrobatics.base).toBe(4);
        expect(skills.crafting.base).toBe(4);
        expect(skills.stealth.base).toBe(5);
        expect(skills.thievery.base).toBe(3);
    });

    it("matches system traits", () => {
        const traits = system.traits as { rarity: string; size: { value: string }; value: string[] };
        expect(traits.rarity).toBe("common");
        expect(traits.size.value).toBe("sm");
        expect(traits.value).toEqual(["beast"]);
    });

    it("matches system level", () => {
        const details = system.details as { level: { value: number } };
        expect(details.level.value).toBe(-1);
    });

    it("produces correct item count and types", () => {
        const items = actor.items as Record<string, unknown>[];
        // 3 strikes (Mandibles, Tail, Frag Grenade) + 2 abilities (Scoring, Dangerous Recycling)
        expect(items).toHaveLength(5);

        const meleeItems = items.filter((i) => i.type === "melee");
        const actionItems = items.filter((i) => i.type === "action");
        expect(meleeItems).toHaveLength(3);
        expect(actionItems).toHaveLength(2);
    });

    it("produces correct Tail strike", () => {
        const items = actor.items as Record<string, unknown>[];
        const tail = items.find((i) => i.name === "Tail")!;
        expect(tail).toBeDefined();
        expect(tail.type).toBe("melee");

        const tailSys = tail.system as Record<string, unknown>;
        expect((tailSys.bonus as { value: number }).value).toBe(6);
        expect((tailSys.traits as { value: string[] }).value).toEqual([
            "agile", "finesse", "razing", "unarmed",
        ]);

        const rolls = Object.values(tailSys.damageRolls as Record<string, unknown>);
        expect(rolls).toHaveLength(1);
        expect((rolls[0] as { damage: string }).damage).toBe("1d4+2");
        expect((rolls[0] as { damageType: string }).damageType).toBe("slashing");
    });

    it("produces correct Frag Grenade area attack", () => {
        const items = actor.items as Record<string, unknown>[];
        const grenade = items.find((i) => i.name === "Frag Grenade")!;
        expect(grenade).toBeDefined();

        const sys = grenade.system as Record<string, unknown>;
        expect(sys.action).toBe("area-fire");
        expect(sys.area).toEqual({ type: "burst", value: 5 });
        expect(sys.range).toEqual({ increment: null, max: 70 });
        const storedValue = (sys.bonus as { value: number }).value;
        expect(storedValue).toBe(3);
        expect(storedValue + 10).toBe(13);
    });

    it("produces correct ability actions", () => {
        const items = actor.items as Record<string, unknown>[];

        const scoring = items.find((i) => i.name === "Scoring")!;
        expect(scoring.type).toBe("action");
        const scoringSys = scoring.system as Record<string, unknown>;
        expect((scoringSys.actionType as { value: string }).value).toBe("passive");
        expect(scoringSys.category).toBe("offensive");

        const recycling = items.find((i) => i.name === "Dangerous Recycling")!;
        expect(recycling.type).toBe("action");
        const recyclingSys = recycling.system as Record<string, unknown>;
        expect((recyclingSys.actionType as { value: string }).value).toBe("passive");
    });

    it("uses the Pathfinder 2e Creature Layout", () => {
        expect(parsed.statblock.layout).toBe("Pathfinder 2e Creature Layout");
    });
});
