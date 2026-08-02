import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// Side effect: inject happy-dom into the shared sanitizer for Node tests.
import "../converter/dom.js";
import { benchmark, averageDamage } from "../../src/rulesets/sf2e/statblock-importer/benchmarks.js";
import { parsePastedStatblock, buildImportActorData } from "../../src/rulesets/sf2e/statblock-importer/import-dialog.js";
import { renderPreview } from "../../src/rulesets/sf2e/statblock-importer/preview.js";
import { normaliseStatblock } from "../../src/rulesets/sf2e/statblock/parse.js";
import { parseIWRString } from "../../src/rulesets/sf2e/statblock/actor.js";
import { load } from "js-yaml";

const FIXTURE = readFileSync(path.join(import.meta.dirname, "fixtures", "converted-dust-manta.md"), "utf8");

// The importer only touches game.i18n in error paths; provide a minimal stub.
// Cast reason: tests run outside Foundry, so no real Game object exists.
(globalThis as Record<string, unknown>).game = {
    i18n: {
        localize: (key: string): string => key,
        format: (key: string): string => key,
    },
};

interface ActorShape {
    name: string;
    type: string;
    items: {
        name: string;
        type: string;
        img: string;
        system: Record<string, unknown>;
    }[];
    system: {
        abilities: Record<string, { mod: number }>;
        attributes: {
            ac: { value: number };
            hp: { value: number; max: number; details: string };
            speed: { value: number; otherSpeeds: { type: string; value: number }[] };
            immunities?: { type: string }[];
            resistances?: { type: string; value?: number }[];
            weaknesses?: { type: string; value?: number }[];
        };
        details: { level: { value: number }; publicNotes: string };
        perception: { mod: number; details: string; senses: { type: string }[] };
        saves: Record<string, { value: number }>;
        skills: Record<string, { base: number }>;
        traits: { rarity: string; size: { value: string }; value: string[] };
    };
    flags: Record<string, { source: string; slug: string }>;
    _id?: string;
}

describe("benchmark tables", () => {
    it("has a complete row for every classifier at every level", () => {
        for (const [name, classify] of Object.entries(benchmark)) {
            for (let level = -1; level <= 24; level++) {
                const result = classify(10, level);
                expect(result.label, `${name} level ${level}`).toBeTruthy();
                expect(result.bands.length, `${name} level ${level}`).toBeGreaterThanOrEqual(2);
            }
        }
    });

    it("classifies hand-checked level-8 values from the GM Core tables", () => {
        expect(benchmark.ac(26, 8)).toMatchObject({ label: "moderate", exact: true });
        expect(benchmark.save(17, 8)).toMatchObject({ label: "moderate", exact: false }); // between high 19 / mod 16
        expect(benchmark.perception(16, 8)).toMatchObject({ label: "moderate", exact: true });
        expect(benchmark.attribute(6, 8)).toMatchObject({ label: "high", exact: true });
        expect(benchmark.attribute(-4, 8)).toMatchObject({ label: "low", exact: false }); // nearest defined band
        expect(benchmark.skill(18, 8)).toMatchObject({ label: "high", exact: true });
        expect(benchmark.hp(150, 8)).toMatchObject({ label: "moderate", exact: false }); // between mod 139 / high 165
        expect(benchmark.strikeAttack(20, 8)).toMatchObject({ label: "high", exact: true });
        expect(benchmark.strikeDamage(20, 8)).toMatchObject({ label: "high", exact: false }); // tie 18/22 → stronger band
        expect(benchmark.resistWeak(10, 8)).toMatchObject({ label: "max", exact: false });
        expect(benchmark.spellDC(26, 8)).toMatchObject({ label: "high", exact: true });
        expect(benchmark.spellDC(24, 8)).toMatchObject({ label: "moderate", exact: false });
    });

    it("computes average damage", () => {
        expect(averageDamage("2d10+9")).toBe(20);
        expect(averageDamage("2d8+8")).toBe(17);
        expect(averageDamage("3d6")).toBe(10);
    });
});

describe("parseIWRString", () => {
    it("parses types, values, and exceptions", () => {
        expect(parseIWRString("physical 5")).toEqual([{ type: "physical", value: 5 }]);
        expect(parseIWRString("emotion")).toEqual([{ type: "emotion" }]);
        expect(parseIWRString("cold iron 5, fire 10 (except silver)")).toEqual([
            { type: "cold-iron", value: 5 },
            { type: "fire", value: 10, exceptions: ["silver"] },
        ]);
    });
});

describe("parsePastedStatblock", () => {
    it("parses the converted dust manta end to end", () => {
        const { statblock, publicNotes } = parsePastedStatblock(FIXTURE);

        expect(statblock.name).toBe("Converted Dust Manta");
        expect(statblock.level).toBe(8);
        expect(statblock.rarity).toBe("rare");
        expect(statblock.size).toBe("lg");
        expect(statblock.traits).toEqual(["beast", "tech", "converted"]);
        expect(statblock.perception.mod).toBe(16);
        // Known sense stays structured; homebrew sandsense routes to details.
        expect(statblock.perception.senses).toEqual([{ type: "darkvision" }]);
        expect(statblock.perception.details).toBe("sandsense (imprecise) 120 feet");
        expect(statblock.abilities).toEqual({ str: 6, dex: 4, con: 5, int: -4, wis: 2, cha: -3 });
        expect(statblock.skills).toEqual({ acrobatics: 16, athletics: 18, stealth: 18 });
        expect(statblock.ac).toBe(26);
        expect(statblock.saves).toEqual({ fort: 17, ref: 15, will: 11 });
        expect(statblock.hp).toBe(150);
        expect(statblock.speed).toEqual({ land: 15, burrow: 40 });

        expect(statblock.strikes).toHaveLength(2);
        const [stinger, wing] = statblock.strikes;
        expect(stinger).toMatchObject({
            name: "Stinger",
            type: "melee",
            bonus: 20,
            traits: ["reach-10"],
            damage: [{ formula: "2d10+9", type: "piercing" }],
            effects: ["extraction-filaments"],
        });
        expect(wing).toMatchObject({
            name: "Wing",
            bonus: 20,
            traits: ["agile"],
            damage: [{ formula: "2d8+8", type: "bludgeoning" }],
            effects: ["knockdown"],
        });

        const abilities = [...statblock.abilities_top, ...statblock.abilities_mid, ...statblock.abilities_bot];
        expect(abilities.map((a) => a.name)).toEqual([
            "Instrument",
            "Sandsense",
            "Disappear in Dust",
            "Lattice Host",
            "⬺ Burrowing Charge",
            "⬺ Dust Veil",
            "Extraction Filaments",
        ]);

        // Body prose becomes sanitized public-notes HTML with wikilinks resolved.
        expect(publicNotes).toContain("<h1>Converted Dust Manta</h1>");
        expect(publicNotes).toContain("The Waking Engine");
        expect(publicNotes).not.toContain("[[");
    });

    it("rejects input without frontmatter or statblock marker", () => {
        expect(() => parsePastedStatblock("# Just prose")).toThrow();
        expect(() => parsePastedStatblock("---\nname: X\n---\n")).toThrow();
    });

    it("is lenient where the strict converter is not", () => {
        const yaml = FIXTURE.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1];
        const data = load(yaml) as Record<string, unknown>;
        // Reviewed custom senses route to details in strict mode; unreviewed senses still fail strict.
        expect(() => normaliseStatblock({ ...data, senses: "voidsight 60 feet" }, "test.md")).toThrow(/unknown sense type/);
        // Lenient mode (paste importer) accepts unreviewed senses.
        expect(() => normaliseStatblock({ ...data, senses: "voidsight 60 feet" }, "test.md", { lenient: true })).not.toThrow();
        // Reviewed sandsense is accepted in strict mode (routes to details, not structured senses).
        expect(() => normaliseStatblock(data, "converted-dust-manta.md")).not.toThrow();
    });
});

describe("buildImportActorData", () => {
    const creature = parsePastedStatblock(FIXTURE);
    const actor = buildImportActorData(creature) as unknown as ActorShape; // cast reason: builder returns untyped Foundry JSON

    it("builds a complete NPC actor without embedded pack ids", () => {
        expect(actor.type).toBe("npc");
        expect(actor._id).toBeUndefined();
        expect(actor.flags["sf2e-forge-custom"].source).toBe("importer");
        expect(actor.system.details.level.value).toBe(8);
        expect(actor.system.attributes.ac.value).toBe(26);
        expect(actor.system.attributes.hp.max).toBe(150);
        expect(actor.system.attributes.speed).toMatchObject({ value: 15, otherSpeeds: [{ type: "burrow", value: 40 }] });
        expect(actor.system.perception).toMatchObject({ mod: 16, details: "sandsense (imprecise) 120 feet" });
        expect(actor.system.skills).toEqual({ acrobatics: { base: 16 }, athletics: { base: 18 }, stealth: { base: 18 } });
        expect(actor.system.traits).toMatchObject({ rarity: "rare", size: { value: "lg" } });
        expect(actor.system.details.publicNotes).toContain("Converted Dust Manta");
    });

    it("emits structured IWR instead of hp.details prose", () => {
        expect(actor.system.attributes.immunities).toEqual([{ type: "emotion" }]);
        expect(actor.system.attributes.resistances).toEqual([{ type: "physical", value: 5 }]);
        expect(actor.system.attributes.weaknesses).toEqual([{ type: "electricity", value: 10 }]);
        expect(actor.system.attributes.hp.details).toBe("");
    });

    it("materialises strikes and abilities as typed embedded items", () => {
        const melee = actor.items.filter((item) => item.type === "melee");
        expect(melee).toHaveLength(2);
        const stinger = melee[0].system as { bonus: { value: number }; damageRolls: Record<string, { damage: string }>; attackEffects: { value: string[] } };
        expect(stinger.bonus.value).toBe(20);
        expect(Object.values(stinger.damageRolls)).toEqual([{ damage: "2d10+9", damageType: "piercing" }]);
        expect(Object.keys(stinger.damageRolls)[0]).toMatch(/^[0-9a-zA-Z]{16}$/);
        expect(stinger.attackEffects.value).toEqual(["extraction-filaments"]);

        const actions = actor.items.filter((item) => item.type === "action");
        expect(actions).toHaveLength(7);
        const charge = actions.find((item) => item.name === "Burrowing Charge")!;
        expect(charge.system).toMatchObject({ actionType: { value: "action" }, actions: { value: 2 }, category: "offensive" });
        const chargeDescription = (charge.system as { description: { value: string } }).description.value;
        expect(chargeDescription).toContain("@Check[reflex|dc:24]");
        const filaments = actions.find((item) => item.name === "Extraction Filaments")!;
        const filamentsDescription = (filaments.system as { description: { value: string } }).description.value;
        expect(filamentsDescription).toContain("<strong>Failure</strong>");
        expect(filamentsDescription).toContain("@UUID[Compendium.sf2e.conditions.Item.Drained]");
    });
});

describe("renderPreview", () => {
    it("renders every section with benchmark chips", () => {
        const { statblock } = parsePastedStatblock(FIXTURE);
        const html = renderPreview(statblock);
        expect(html).toContain("Converted Dust Manta");
        expect(html).toContain("Creature 8");
        // AC 26 is exactly moderate at level 8; Stinger +20 exactly high.
        expect(html).toContain(`26 <em>moderate</em>`);
        expect(html).toContain(`+20 <em>high</em>`);
        // Weakness 10 approaches the level-8 max (11).
        expect(html).toMatch(/10 <em>\u2248max<\/em>/);
        // Homebrew sense text still surfaces in the preview.
        expect(html).toContain("sandsense (imprecise) 120 feet");
        expect(html).toContain("Burrowing Charge");
        expect(html).toContain("ssi-footnote");
    });
});
