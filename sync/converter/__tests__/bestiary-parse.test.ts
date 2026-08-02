import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCreature } from "../bestiary-parse.js";
import {
    parseAttackDesc,
    parseAttackName,
    parseDamageString,
    parseSensesString,
    parseSpeedString,
} from "../bestiary-parse.js";

const FIXTURE_DIR = path.join(import.meta.dirname, "fixtures");

function readFixture(name: string): string {
    return readFileSync(path.join(FIXTURE_DIR, name), "utf-8");
}

const REQUIRED_ATTRIBUTES = `attributes: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
modifier: 0
`;
const REQUIRED_MECHANICS = `${REQUIRED_ATTRIBUTES}saves: { fort: 0, ref: 0, will: 0 }
speed: 0
`;

function creatureWithAttack(attack: string): string {
    return `---
statblock: true
name: Attack Test
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}attacks:
${attack}---
`;
}

// ---------------------------------------------------------------------------
// Full file parsing
// ---------------------------------------------------------------------------

describe("parseCreature", () => {
    it("parses a well-formed creature frontmatter", () => {
        const raw = readFixture("scrap-rat.md");
        const result = parseCreature("scrap-rat.md", raw);

        expect(result).not.toBeNull();
        expect(result!.slug).toBe("scrap-rat");
        expect(result!.statblock.name).toBe("Scrap Rat");
        expect(result!.statblock.level).toBe(-1);
        expect(result!.statblock.rarity).toBe("common");
        expect(result!.statblock.size).toBe("sm");
        expect(result!.statblock.traits).toEqual(["beast"]);
    });

    it("normalises pinned SF2e and reviewed project creature traits to slugs", () => {
        const raw = `---
statblock: true
name: Canonical Traits
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}traits: [Undead, Charau Ka, Aurelian]
---
`;

        expect(parseCreature("canonical-traits.md", raw)!.statblock.traits).toEqual(["undead", "charau-ka", "aurelian"]);
    });

    it("rejects unknown and inherited-property creature traits", () => {
        const raw = `---
statblock: true
name: Bad Trait
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}traits: [undeda]
---
`;

        expect(() => parseCreature("bad-trait.md", raw)).toThrow(
            'bad-trait.md: traits[0]: unknown creature trait "undeda"',
        );
        expect(() => parseCreature("inherited-trait.md", raw.replace("undeda", "constructor"))).toThrow(
            'inherited-trait.md: traits[0]: unknown creature trait "constructor"',
        );
    });

    it("parses ability modifiers from attributes array", () => {
        const raw = readFixture("scrap-rat.md");
        const result = parseCreature("scrap-rat.md", raw)!;

        expect(result.statblock.abilities).toEqual({
            str: 2, dex: 3, con: 1, int: -3, wis: 1, cha: -3,
        });
    });

    it("parses perception from modifier + senses string", () => {
        const raw = readFixture("scrap-rat.md");
        const result = parseCreature("scrap-rat.md", raw)!;

        expect(result.statblock.perception.mod).toBe(7);
        expect(result.statblock.perception.senses).toEqual([
            { type: "low-light-vision" },
            { type: "scent", acuity: "imprecise", range: 30 },
        ]);
    });

    it("parses skills from array of single-key objects", () => {
        const raw = readFixture("scrap-rat.md");
        const result = parseCreature("scrap-rat.md", raw)!;

        expect(result.statblock.skills).toEqual({
            acrobatics: 4, crafting: 4, stealth: 5, thievery: 3,
        });
    });

    it("parses defenses", () => {
        const raw = readFixture("scrap-rat.md");
        const result = parseCreature("scrap-rat.md", raw)!;

        expect(result.statblock.ac).toBe(14);
        expect(result.statblock.hp).toBe(8);
        expect(result.statblock.saves).toEqual({
            fort: 5, ref: 8, will: 2,
        });
    });

    it("parses attacks into strikes", () => {
        const raw = readFixture("scrap-rat.md");
        const result = parseCreature("scrap-rat.md", raw)!;

        expect(result.statblock.strikes).toHaveLength(3);

        const mandibles = result.statblock.strikes[0];
        expect(mandibles.name).toBe("Mandibles");
        expect(mandibles.type).toBe("melee");
        expect(mandibles.bonus).toBe(6);
        expect(mandibles.traits).toEqual(["finesse", "unarmed"]);
        expect(mandibles.damage).toEqual([{ formula: "1d4+2", type: "piercing" }]);

        const grenade = result.statblock.strikes[2];
        expect(grenade.name).toBe("Frag Grenade");
        expect(grenade.type).toBe("ranged");
        expect(grenade.action).toBe("area-fire");
        expect(grenade.dc).toBe(13);
        expect(grenade.area).toEqual({ type: "burst", value: 5 });
        expect(grenade.range).toEqual({ max: 70 });
    });

    it("parses abilities with desc field", () => {
        const raw = readFixture("scrap-rat.md");
        const result = parseCreature("scrap-rat.md", raw)!;

        expect(result.statblock.abilities_mid).toHaveLength(1);
        expect(result.statblock.abilities_mid[0].name).toBe("Scoring");
        expect(result.statblock.abilities_mid[0].desc).toContain("tail Strike");
        expect(result.statblock.abilities_mid[0].category).toBe("offensive");

        expect(result.statblock.abilities_bot).toHaveLength(1);
        expect(result.statblock.abilities_bot[0].name).toBe("Dangerous Recycling");
    });

    it("parses speed from string", () => {
        const raw = readFixture("scrap-rat.md");
        const result = parseCreature("scrap-rat.md", raw)!;

        expect(result.statblock.speed).toEqual({ land: 25 });
    });

    it("returns null for files without statblock: true", () => {
        const raw = `---
title: Not a Creature
type: Character
---
# Some Note
`;
        const result = parseCreature("not-creature.md", raw);
        expect(result).toBeNull();
    });

    it("applies defaults for missing optional fields", () => {
        const raw = `---
statblock: true
name: Minimal Creature
level: 1
ac: 15
hp: 20
${REQUIRED_MECHANICS}---
# Minimal
`;
        const result = parseCreature("minimal.md", raw)!;

        expect(result.statblock.rarity).toBe("common");
        expect(result.statblock.size).toBe("med");
        expect(result.statblock.traits).toEqual([]);
        expect(result.statblock.immunities).toBe("");
        expect(result.statblock.resistances).toBe("");
        expect(result.statblock.weaknesses).toBe("");
        expect(result.statblock.abilities_top).toEqual([]);
        expect(result.statblock.abilities_mid).toEqual([]);
        expect(result.statblock.abilities_bot).toEqual([]);
        expect(result.statblock.strikes).toEqual([]);
        expect(result.statblock.spellcasting).toBeUndefined();
        expect(result.statblock.lore).toBeUndefined();
    });

    it("handles published: false correctly", () => {
        const raw = readFixture("scrap-rat.md");
        const result = parseCreature("scrap-rat.md", raw)!;
        expect(result.statblock.published).toBe(false);
    });

    it("defaults published to true when not specified", () => {
        const raw = `---
statblock: true
name: Published Creature
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}---
`;
        const result = parseCreature("published.md", raw)!;
        expect(result.statblock.published).toBe(true);
    });

    it("extracts lore skills from skills array", () => {
        const raw = `---
statblock: true
name: Lore Creature
level: 5
ac: 20
hp: 50
${REQUIRED_MECHANICS}skills:
  - Athletics: 12
  - "Underworld Lore": 8
  - "Lore: Arcana": 6
---
`;
        const result = parseCreature("lore.md", raw)!;

        expect(result.statblock.skills).toEqual({ athletics: 12 });
        expect(result.statblock.lore).toEqual([
            { name: "Underworld Lore", mod: 8 },
            { name: "Arcana Lore", mod: 6 },
        ]);
    });

    it("rejects malformed fields with filename and field-path diagnostics", () => {
        const raw = `---
statblock: true
name: Broken Creature
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}attacks:
  - name: "__Melee__ Claw"
    bonus: nope
    damage: "1d6 slashing"
---
`;
        expect(() => parseCreature("broken-creature.md", raw)).toThrow(
            "broken-creature.md: attacks[0].bonus: expected a finite number",
        );
    });

    it.each(["area-fire", "auto-fire"] as const)("requires an explicit positive save DC for %s", (action) => {
        const valid = creatureWithAttack(`  - name: __Ranged__ Grenade
    dc: 24
    desc: (${action}, burst 5 ft., range 30 ft.)
    damage: 1d6 piercing
`);
        const missing = creatureWithAttack(`  - name: __Ranged__ Grenade
    desc: (${action}, burst 5 ft., range 30 ft.)
    damage: 1d6 piercing
`);

        expect(parseCreature("valid-area.md", valid)!.statblock.strikes[0]).toMatchObject({ action, dc: 24 });
        expect(() => parseCreature("missing-area-dc.md", missing)).toThrow(
            "missing-area-dc.md: attacks[0].dc: expected a positive integer",
        );
    });

    it.each([
        ["non-finite", "    dc: nope\n", "malformed-area.md: attacks[0].dc: expected a positive integer"],
        ["fractional", "    dc: 20.5\n", "malformed-area.md: attacks[0].dc: expected a positive integer"],
        ["non-positive", "    dc: 0\n", "malformed-area.md: attacks[0].dc: expected a positive integer"],
    ])("rejects %s area attack DCs", (_case, dcField, expected) => {
        const raw = creatureWithAttack(`  - name: __Ranged__ Grenade
${dcField}    desc: (area-fire, burst 5 ft., range 30 ft.)
    damage: 1d6 piercing
`);

        expect(() => parseCreature("malformed-area.md", raw)).toThrow(expected);
    });

    it("rejects ambiguous non-strike attack bonus and DC", () => {
        const raw = creatureWithAttack(`  - name: __Ranged__ Grenade
    bonus: 10
    dc: 20
    desc: (auto-fire, burst 5 ft., range 30 ft.)
    damage: 1d6 piercing
`);

        expect(() => parseCreature("ambiguous-area.md", raw)).toThrow(
            "ambiguous-area.md: attacks[0].bonus: auto-fire attacks must use dc instead of bonus",
        );
    });

    it("rejects DCs on ordinary strikes and requires their bonus", () => {
        const withDc = creatureWithAttack(`  - name: __Ranged__ Ray
    dc: 20
    desc: (range 30 ft.)
    damage: 1d6 fire
`);
        const withoutBonus = creatureWithAttack(`  - name: __Ranged__ Ray
    desc: (range 30 ft.)
    damage: 1d6 fire
`);

        expect(() => parseCreature("ordinary-dc.md", withDc)).toThrow(
            "ordinary-dc.md: attacks[0].dc: ordinary strikes must use bonus instead of dc",
        );
        expect(() => parseCreature("ordinary-no-bonus.md", withoutBonus)).toThrow(
            "ordinary-no-bonus.md: attacks[0].bonus: expected a finite number",
        );
    });

    it("rejects malformed statblock markers and negative HP", () => {
        expect(() => parseCreature("bad-marker.md", "---\nstatblock: yes\n---\n"))
            .toThrow("bad-marker.md: statblock: expected a boolean");

        const negativeHp = `---
statblock: true
name: Broken HP
level: 1
ac: 10
hp: -1
${REQUIRED_MECHANICS}---
`;
        expect(() => parseCreature("broken-hp.md", negativeHp)).toThrow(
            "broken-hp.md: hp: expected a non-negative integer",
        );
    });

    it("rejects unknown top-level statblock fields so mechanical typos cannot disappear", () => {
        const raw = `---
statblock: true
name: Typo Creature
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}attakcs: []
---
`;
        expect(() => parseCreature("typo-creature.md", raw)).toThrow(
            "typo-creature.md: attakcs: unknown statblock field",
        );
    });

    it("rejects unknown nested strike fields", () => {
        const raw = `---
statblock: true
name: Typo Strike
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}attacks:
  - name: __Melee__ Claw
    bonus: 1
    damge: 1d6 slashing
    damage: 1d6 slashing
---
`;
        expect(() => parseCreature("typo-strike.md", raw)).toThrow(
            "typo-strike.md: attacks[0].damge: unknown strike field",
        );
    });

    it("rejects ranged strikes without range metadata", () => {
        const raw = `---
statblock: true
name: Bad Ray
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}attacks:
  - name: __Ranged__ Ray
    bonus: 1
    damage: 1d6 fire
---
`;
        expect(() => parseCreature("bad-ray.md", raw)).toThrow(
            "bad-ray.md: attacks[0].desc: ranged strikes require range metadata",
        );
    });

    it("rejects misspelled standard skills", () => {
        const raw = `---
statblock: true
name: Typo Skill
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}skills:
  - Atheltics: 1
---
`;
        expect(() => parseCreature("typo-skill.md", raw)).toThrow(
            'typo-skill.md: skills[0].Atheltics: unknown standard skill "Atheltics"',
        );
    });

    it("rejects fractional discrete mechanics", () => {
        expect(() => parseSpeedString(12.5, "fractional.md", "speed")).toThrow(
            "fractional.md: speed: expected a finite number",
        );
    });

    it("rejects incomplete saves instead of inventing missing modifiers", () => {
        const raw = `---
statblock: true
name: Broken Saves
level: 1
ac: 10
hp: 10
${REQUIRED_ATTRIBUTES}saves:
  fort: 5
  ref: 4
speed: 0
---
`;
        expect(() => parseCreature("broken-saves.md", raw)).toThrow(
            "broken-saves.md: saves.will: missing required save",
        );
    });

    it("rejects missing required core mechanics", () => {
        const raw = `---
statblock: true
name: Missing Attributes
level: 1
ac: 10
hp: 10
---
`;
        expect(() => parseCreature("missing-attributes.md", raw)).toThrow(
            "missing-attributes.md: attributes: missing required ability modifiers",
        );
    });

    it("rejects invalid enums and strict published values", () => {
        const invalidRarity = `---
statblock: true
name: Bad Rarity
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}rarity: legendary
---
`;
        expect(() => parseCreature("bad-rarity.md", invalidRarity)).toThrow("bad-rarity.md: rarity:");

        const invalidSize = `---
statblock: true
name: Bad Size
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}size: colossal
---
`;
        expect(() => parseCreature("bad-size.md", invalidSize)).toThrow("bad-size.md: size:");

        const invalidPublished = `---
statblock: true
name: Bad Published
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}published: "false"
---
`;
        expect(() => parseCreature("bad-published.md", invalidPublished)).toThrow(
            "bad-published.md: published: expected a boolean",
        );
    });

    it("rejects invalid sense acuities and ability categories", () => {
        const invalidSense = `---
statblock: true
name: Bad Sense
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}senses:
  - type: scent
    acuity: approximate
---
`;
        expect(() => parseCreature("bad-sense.md", invalidSense)).toThrow(
            "bad-sense.md: senses[0].acuity: expected precise, imprecise, or vague",
        );

        const invalidAbility = `---
statblock: true
name: Bad Ability
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}abilities_mid:
  - name: Bad Ability
    desc: Does something.
    category: utility
---
`;
        expect(() => parseCreature("bad-ability.md", invalidAbility)).toThrow(
            "bad-ability.md: abilities_mid[0].category: expected offensive, defensive, or interaction",
        );
    });

    it("rejects invalid collection shapes and optional spellcasting values", () => {
        const invalidAttacks = `---
statblock: true
name: Bad Attacks
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}attacks: not-an-array
---
`;
        expect(() => parseCreature("bad-attacks.md", invalidAttacks)).toThrow(
            "bad-attacks.md: attacks: expected an array of strikes",
        );

        const invalidDc = `---
statblock: true
name: Bad Spells
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}spellcasting:
  - dc: nope
---
`;
        expect(() => parseCreature("bad-spells.md", invalidDc)).toThrow(
            "bad-spells.md: spellcasting[0].dc: expected a finite number",
        );

        const invalidFp = `---
statblock: true
name: Bad Focus
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}spellcasting:
  - fp: -1
---
`;
        expect(() => parseCreature("bad-focus.md", invalidFp)).toThrow(
            "bad-focus.md: spellcasting[0].fp: expected a non-negative integer",
        );

        const invalidActionTrait = `---
statblock: true
name: Bad Action Trait
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}abilities_mid:
  - name: Bad Ability
    traits: [concentrat]
---
`;
        expect(() => parseCreature("bad-action-trait.md", invalidActionTrait)).toThrow(
            'bad-action-trait.md: abilities_mid[0].traits[0]: unknown action trait "concentrat"',
        );
        expect(() => parseCreature("inherited-action-trait.md", invalidActionTrait.replace("concentrat", "constructor"))).toThrow(
            'inherited-action-trait.md: abilities_mid[0].traits[0]: unknown action trait "constructor"',
        );
    });
});

// ---------------------------------------------------------------------------
// String parsing helpers
// ---------------------------------------------------------------------------

describe("parseSensesString", () => {
    it("parses empty/null to empty array", () => {
        expect(parseSensesString(null)).toEqual([]);
        expect(parseSensesString("")).toEqual([]);
    });

    it("parses a single sense", () => {
        expect(parseSensesString("darkvision")).toEqual([
            { type: "darkvision" },
        ]);
    });

    it("parses multiple senses", () => {
        expect(parseSensesString("low-light vision, scent (imprecise) 30 feet")).toEqual([
            { type: "low-light-vision" },
            { type: "scent", acuity: "imprecise", range: 30 },
        ]);
    });

    it("rejects limited senses without an authored acuity", () => {
        expect(() => parseSensesString("scent 60 feet", "bad-sense.md", "senses")).toThrow(
            "bad-sense.md: senses[0].acuity: scent requires an authored acuity",
        );
        expect(() => parseSensesString([{ type: "scent", range: 60 }], "bad-sense.md", "senses")).toThrow(
            "bad-sense.md: senses[0].acuity: scent requires an authored acuity",
        );
    });

    it("rejects limited senses without an authored range", () => {
        expect(() => parseSensesString("scent (imprecise)", "bad-sense.md", "senses")).toThrow(
            "bad-sense.md: senses[0].range: scent requires an authored range",
        );
        expect(() => parseSensesString([{ type: "scent", acuity: "imprecise" }], "bad-sense.md", "senses")).toThrow(
            "bad-sense.md: senses[0].range: scent requires an authored range",
        );
    });

    it("normalises unambiguous documented limited-sense defaults", () => {
        expect(parseSensesString("echolocation 30 feet")).toEqual([
            { type: "echolocation", acuity: "precise", range: 30 },
        ]);
        expect(parseSensesString("truesight")).toEqual([
            { type: "truesight", acuity: "precise", range: 60 },
        ]);
        expect(parseSensesString([{ type: "truesight" }])).toEqual([
            { type: "truesight", acuity: "precise", range: 60 },
        ]);
    });

    it("parses sense with precise acuity", () => {
        expect(parseSensesString("tremorsense (precise) 30 feet")).toEqual([
            { type: "tremorsense", acuity: "precise", range: 30 },
        ]);
    });

    it("rejects acuities that SF2e overwrites for mandatory-acuity senses", () => {
        for (const type of [
            "darkvision", "echolocation", "greater-darkvision", "infrared-vision",
            "low-light-vision", "see-invisibility", "truesight",
        ]) {
            expect(() => parseSensesString(`${type} (vague)`, "bad-sense.md", "senses")).toThrow(
                `bad-sense.md: senses[0].acuity: ${type} must have precise acuity`,
            );
        }
        expect(() => parseSensesString([{ type: "echolocation", acuity: "imprecise" }], "bad-sense.md", "senses")).toThrow(
            "bad-sense.md: senses[0].acuity: echolocation must have precise acuity",
        );
        expect(parseSensesString("echolocation (precise) 30 feet")).toEqual([
            { type: "echolocation", acuity: "precise", range: 30 },
        ]);
    });

    it("requires ranges for mandatory-acuity limited senses", () => {
        expect(() => parseSensesString("echolocation (precise)", "bad-sense.md", "senses")).toThrow(
            "bad-sense.md: senses[0].range: echolocation requires an authored range",
        );
    });

    it("rejects ranges that SF2e treats as unlimited", () => {
        for (const type of ["darkvision", "greater-darkvision", "low-light-vision", "see-invisibility"]) {
            expect(() => parseSensesString(`${type} 30 feet`, "bad-sense.md", "senses")).toThrow(
                `bad-sense.md: senses[0].range: ${type} has unlimited range; omit the authored range`,
            );
        }
        expect(() => parseSensesString([{ type: "darkvision", range: 30 }], "bad-sense.md", "senses")).toThrow(
            "bad-sense.md: senses[0].range: darkvision has unlimited range; omit the authored range",
        );
        expect(parseSensesString([{ type: "darkvision", acuity: "precise" }])).toEqual([
            { type: "darkvision" },
        ]);
    });
});

describe("parseSpeedString", () => {
    it("parses simple land speed", () => {
        expect(parseSpeedString("25 feet")).toEqual({ land: 25 });
    });

    it("parses multiple speeds", () => {
        expect(parseSpeedString("25 feet, fly 60 feet, swim 30 feet")).toEqual({
            land: 25,
            fly: 60,
            swim: 30,
        });
    });

    it("handles numeric input", () => {
        expect(parseSpeedString(25)).toEqual({ land: 25 });
    });

    it("handles ft. abbreviation", () => {
        expect(parseSpeedString("30 ft., climb 20 ft.")).toEqual({
            land: 30,
            climb: 20,
        });
    });
});

describe("parseAttackName", () => {
    it("parses melee attack", () => {
        expect(parseAttackName("__Melee__ ⬻ Mandibles")).toEqual({
            type: "melee",
            name: "Mandibles",
        });
    });

    it("parses ranged attack", () => {
        expect(parseAttackName("__Ranged__ ⬻ Frag Grenade")).toEqual({
            type: "ranged",
            name: "Frag Grenade",
        });
    });

    it("handles name without prefix", () => {
        expect(parseAttackName("Fist")).toEqual({
            type: "melee",
            name: "Fist",
        });
    });
});

describe("parseAttackDesc", () => {
    it("parses simple trait list", () => {
        expect(parseAttackDesc("(finesse, unarmed)")).toEqual({
            traits: ["finesse", "unarmed"],
        });
    });

    it("accepts SF2e NPC attack traits from the pinned vocabulary", () => {
        expect(parseAttackDesc("(brutal, range increment 30 ft.)")).toEqual({
            traits: ["brutal"],
            range: { increment: 30 },
        });
    });

    it("rejects attack effects authored as NPC traits", () => {
        expect(() => parseAttackDesc("(grab)", "bad-trait.md", "attacks[0].desc")).toThrow(
            'bad-trait.md: attacks[0].desc[0]: unknown NPC attack trait "grab"',
        );
    });

    it("accepts SF2e action traits from the pinned vocabulary", () => {
        const raw = `---
statblock: true
name: Incapacitating Creature
level: 1
ac: 10
hp: 10
${REQUIRED_MECHANICS}abilities_mid:
  - name: Stunning Display
    traits: [incapacitation]
---
`;
        expect(parseCreature("incapacitating-creature.md", raw)!.statblock.abilities_mid[0].traits).toEqual(["incapacitation"]);
    });

    it("extracts area-fire action", () => {
        const result = parseAttackDesc("(area-fire, consumable, burst 5 ft., range 70 ft.)");
        expect(result.action).toBe("area-fire");
        expect(result.area).toEqual({ type: "burst", value: 5 });
        expect(result.range).toEqual({ max: 70 });
        expect(result.traits).toEqual(["consumable"]);
    });
    it("handles empty desc", () => {
        expect(parseAttackDesc("")).toEqual({ traits: [] });
    });

    it("handles range increment", () => {
        const result = parseAttackDesc("(range increment 30 ft.)");
        expect(result.range).toEqual({ increment: 30 });
    });

    it("normalizes SF2e parameterized traits and retains magazine metadata", () => {
        expect(parseAttackDesc("(tracking +1, versatile P, mag 20, volley 30 ft.)")).toEqual({
            traits: ["tracking-1", "versatile-p", "volley-30"],
            otherTags: ["mag-20"],
        });
    });

    it("accumulates range bounds and rejects invalid increments", () => {
        expect(parseAttackDesc("(range increment 60 ft., range 120 ft.)").range).toEqual({ increment: 60, max: 120 });
        expect(() => parseAttackDesc("(range increment 7 ft.)", "bad-range.md", "attacks[0].desc"))
            .toThrow("bad-range.md: attacks[0].desc[0]: range must be a multiple of 5 from 5 to 500 feet");
    });

    it("rejects invalid area distances", () => {
        expect(() => parseAttackDesc("(burst 7 ft.)", "bad-area.md", "attacks[0].desc"))
            .toThrow("bad-area.md: attacks[0].desc[0]: area distance must be a multiple of 5 from 5 to 50 feet");
    });

    it("rejects incoherent area metadata", () => {
        expect(() => parseAttackDesc("(area-fire)", "bad-area.md", "attacks[0].desc"))
            .toThrow("bad-area.md: attacks[0].desc: area-fire requires area metadata");
        expect(() => parseAttackDesc("(burst 10 ft.)", "bad-area.md", "attacks[0].desc"))
            .toThrow("bad-area.md: attacks[0].desc: ordinary strikes must not include area metadata");
    });
});

describe("parseDamageString", () => {
    it("parses simple damage", () => {
        expect(parseDamageString("1d4+2 piercing")).toEqual({
            damage: [{ formula: "1d4+2", type: "piercing" }],
            effects: [],
        });
    });

    it("parses damage with effects", () => {
        const result = parseDamageString("2d6+4 slashing plus Grab");
        expect(result.damage).toEqual([{ formula: "2d6+4", type: "slashing" }]);
        expect(result.effects).toEqual(["grab"]);
    });

    it("parses multiple damage types", () => {
        const result = parseDamageString("1d8+3 fire plus 1d6 persistent fire");
        expect(result.damage).toEqual([
            { formula: "1d8+3", type: "fire" },
            { formula: "1d6", type: "fire", category: "persistent" },
        ]);
        expect(result.effects).toEqual([]);
    });

    it("parses flat ordinary and persistent damage", () => {
        expect(parseDamageString("5 fire plus 2 persistent fire")).toEqual({
            damage: [
                { formula: "5", type: "fire" },
                { formula: "2", type: "fire", category: "persistent" },
            ],
            effects: [],
        });
    });

    it("rejects unknown persistent damage types", () => {
        expect(() => parseDamageString("1d6 persistent starlight", "bad-damage.md", "attacks[0].damage")).toThrow(
            'bad-damage.md: attacks[0].damage[0].type: unknown strike damage type "starlight"',
        );
    });

    it("handles empty string", () => {
        expect(parseDamageString("")).toEqual({
            damage: [],
            effects: [],
        });
    });

    it("parses damage without modifier", () => {
        expect(parseDamageString("1d8 piercing")).toEqual({
            damage: [{ formula: "1d8", type: "piercing" }],
            effects: [],
        });
    });

    it("rejects dice terms with zero dice or zero sides", () => {
        expect(() => parseDamageString("0d6 fire", "bad-damage.md", "attacks[0].damage")).toThrow(
            "bad-damage.md: attacks[0].damage[0].formula: dice count and sides must be positive integers",
        );
        expect(() => parseDamageString("1d0 fire", "bad-damage.md", "attacks[0].damage")).toThrow(
            "bad-damage.md: attacks[0].damage[0].formula: dice count and sides must be positive integers",
        );
    });

    it("rejects signed numeric and dice-like damage before named-effect fallback", () => {
        for (const signedDamage of ["-1 fire", "-1d6 fire", "+1d6 fire"]) {
            expect(() => parseDamageString(signedDamage, "bad-damage.md", "attacks[0].damage")).toThrow(
                'bad-damage.md: attacks[0].damage[0]: expected damage like "1d6 fire"',
            );
        }
    });

    it("rejects unknown senses and zero-range senses", () => {
        expect(() => parseSensesString("typo vision", "bad-sense.md", "senses")).toThrow(
            'bad-sense.md: senses[0].type: unknown sense type "typo-vision"',
        );
        expect(() => parseSensesString("scent (imprecise) 0 feet", "bad-sense.md", "senses")).toThrow(
            "bad-sense.md: senses[0].range: expected a positive integer",
        );
    });

    it("rejects inherited object prototype names in parser allowlists", () => {
        expect(() => parseDamageString("1d6 constructor", "bad-damage.md", "attacks[0].damage")).toThrow(
            'bad-damage.md: attacks[0].damage[0].type: unknown strike damage type "constructor"',
        );
        expect(() => parseAttackDesc("(constructor)", "bad-trait.md", "attacks[0].desc")).toThrow(
            'bad-trait.md: attacks[0].desc[0]: unknown NPC attack trait "constructor"',
        );
    });
});
