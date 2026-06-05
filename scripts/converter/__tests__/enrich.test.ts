import { describe, expect, it } from "vitest";
import {
    enrichChecks,
    enrichConditions,
    enrichDamage,
    enrichDescription,
    enrichTemplates,
} from "../enrich.js";

// ---------------------------------------------------------------------------
// enrichChecks
// ---------------------------------------------------------------------------

describe("enrichChecks", () => {
    it("converts DC + Reflex save", () => {
        expect(enrichChecks("must attempt a DC 24 Reflex save")).toBe(
            "must attempt a @Check[reflex|dc:24] save",
        );
    });

    it("converts DC + Fortitude save", () => {
        expect(enrichChecks("a DC 15 Fortitude save")).toBe(
            "a @Check[fortitude|dc:15] save",
        );
    });

    it("converts DC + Will saving throw", () => {
        expect(enrichChecks("a DC 20 Will saving throw")).toBe(
            "a @Check[will|dc:20] saving throw",
        );
    });

    it("converts basic save", () => {
        expect(enrichChecks("a DC 18 basic Reflex save")).toBe(
            "a @Check[reflex|dc:18|basic] save",
        );
    });

    it("is case-insensitive for save type", () => {
        expect(enrichChecks("DC 10 reflex save")).toBe(
            "@Check[reflex|dc:10] save",
        );
    });

    it("leaves text without save patterns unchanged", () => {
        const text = "The creature attacks with its claws.";
        expect(enrichChecks(text)).toBe(text);
    });
});

// ---------------------------------------------------------------------------
// enrichDamage
// ---------------------------------------------------------------------------

describe("enrichDamage", () => {
    it("converts simple damage roll", () => {
        expect(enrichDamage("2d6 piercing damage")).toBe(
            "@Damage[2d6[piercing]] damage",
        );
    });

    it("converts damage roll with positive modifier", () => {
        expect(enrichDamage("4d6+3 fire damage")).toBe(
            "@Damage[(4d6+3)[fire]] damage",
        );
    });

    it("converts damage roll with negative modifier", () => {
        expect(enrichDamage("1d8-2 cold damage")).toBe(
            "@Damage[(1d8-2)[cold]] damage",
        );
    });

    it("converts sonic damage", () => {
        expect(enrichDamage("1d4 sonic damage")).toBe(
            "@Damage[1d4[sonic]] damage",
        );
    });

    it("converts multiple damage rolls in one string", () => {
        expect(
            enrichDamage("2d6 piercing damage. On a failure, 4d6 piercing damage."),
        ).toBe(
            "@Damage[2d6[piercing]] damage. On a failure, @Damage[4d6[piercing]] damage.",
        );
    });

    it("handles all recognised damage types", () => {
        for (const type of [
            "piercing", "slashing", "bludgeoning", "fire", "cold",
            "electricity", "acid", "sonic", "force", "mental",
            "poison", "bleed", "vitality", "spirit", "void",
        ]) {
            expect(enrichDamage(`1d6 ${type} damage`)).toBe(
                `@Damage[1d6[${type}]] damage`,
            );
        }
    });

    it("leaves text without damage patterns unchanged", () => {
        const text = "The creature gains 10 temporary hit points.";
        expect(enrichDamage(text)).toBe(text);
    });
});

// ---------------------------------------------------------------------------
// enrichTemplates
// ---------------------------------------------------------------------------

describe("enrichTemplates", () => {
    it("converts cone", () => {
        expect(enrichTemplates("in a 30-foot cone")).toBe(
            "in a @Template[type:cone|distance:30]",
        );
    });

    it("converts burst", () => {
        expect(enrichTemplates("a 15-foot burst")).toBe(
            "a @Template[type:burst|distance:15]",
        );
    });

    it("converts emanation", () => {
        expect(enrichTemplates("a 10-foot emanation")).toBe(
            "a @Template[type:emanation|distance:10]",
        );
    });

    it("converts line", () => {
        expect(enrichTemplates("a 60-foot line")).toBe(
            "a @Template[type:line|distance:60]",
        );
    });

    it("converts square", () => {
        expect(enrichTemplates("a 5-foot square")).toBe(
            "a @Template[type:square|distance:5]",
        );
    });

    it("leaves text without template patterns unchanged", () => {
        const text = "The creature moves 30 feet.";
        expect(enrichTemplates(text)).toBe(text);
    });
});

// ---------------------------------------------------------------------------
// enrichConditions
// ---------------------------------------------------------------------------

describe("enrichConditions", () => {
    it("converts valued condition: frightened 1", () => {
        expect(enrichConditions("becomes frightened 1")).toBe(
            "becomes @UUID[Compendium.sf2e.conditions.Item.Frightened]{Frightened 1}",
        );
    });

    it("converts valued condition: sickened 2", () => {
        expect(enrichConditions("and sickened 2")).toBe(
            "and @UUID[Compendium.sf2e.conditions.Item.Sickened]{Sickened 2}",
        );
    });

    it("converts valued condition: stunned 3", () => {
        expect(enrichConditions("stunned 3 for one round")).toBe(
            "@UUID[Compendium.sf2e.conditions.Item.Stunned]{Stunned 3} for one round",
        );
    });

    it("converts off-guard", () => {
        expect(enrichConditions("and off-guard until")).toBe(
            "and @UUID[Compendium.sf2e.conditions.Item.Off-Guard]{off-guard} until",
        );
    });

    it("converts blinded", () => {
        expect(enrichConditions("the target is blinded")).toBe(
            "the target is @UUID[Compendium.sf2e.conditions.Item.Blinded]{blinded}",
        );
    });

    it("converts prone", () => {
        expect(enrichConditions("knocked prone")).toBe(
            "knocked @UUID[Compendium.sf2e.conditions.Item.Prone]{prone}",
        );
    });

    it("preserves case of original text in display", () => {
        expect(enrichConditions("is Off-Guard")).toBe(
            "is @UUID[Compendium.sf2e.conditions.Item.Off-Guard]{Off-Guard}",
        );
    });

    it("handles multiple conditions in one string", () => {
        const result = enrichConditions("frightened 2 and off-guard");
        expect(result).toContain("Frightened]{Frightened 2}");
        expect(result).toContain("Off-Guard]{off-guard}");
    });

    it("leaves text without condition patterns unchanged", () => {
        const text = "The creature attacks with its claws.";
        expect(enrichConditions(text)).toBe(text);
    });
});

// ---------------------------------------------------------------------------
// enrichDescription — full pipeline
// ---------------------------------------------------------------------------

describe("enrichDescription", () => {
    it("returns empty string for empty input", () => {
        expect(enrichDescription("")).toBe("");
        expect(enrichDescription("   ")).toBe("");
    });

    it("wraps plain text in <p> tags", () => {
        expect(enrichDescription("A simple ability.")).toBe(
            "<p>A simple ability.</p>",
        );
    });

    it("scrubs labels behind entity-encoded Foundry syntax delimiters", () => {
        const input = "&#64;Check&#91;reflex|dc:10&#93;&#123;&lt;img src=x onerror=alert(1)&gt;&#125;";

        expect(enrichDescription(input)).toBe("<p>@Check[reflex|dc:10]{}</p>");
    });

    it("splits paragraphs on double newlines", () => {
        expect(enrichDescription("First paragraph.\n\nSecond paragraph.")).toBe(
            "<p>First paragraph.</p>\n<p>Second paragraph.</p>",
        );
    });

    it("enriches Suppressing Fire (full integration)", () => {
        const input = [
            "The legionary fires a barrage in a 30-foot cone.",
            "Each creature in the area must attempt a DC 24 Reflex save.",
            "Regardless of the result, creatures are suppressed until the",
            "start of the legionary's next turn.",
            "**Critical Success** Unaffected and not suppressed.",
            "**Success** 2d6 piercing damage.",
            "**Failure** 4d6 piercing damage.",
            "**Critical Failure** 8d6 piercing damage and off-guard until",
            "start of legionary's next turn.",
        ].join(" ");

        const result = enrichDescription(input);

        // Check enrichers
        expect(result).toContain("@Template[type:cone|distance:30]");
        expect(result).toContain("@Check[reflex|dc:24]");
        expect(result).toContain("@Damage[2d6[piercing]]");
        expect(result).toContain("@Damage[4d6[piercing]]");
        expect(result).toContain("@Damage[8d6[piercing]]");
        expect(result).toContain("Compendium.sf2e.conditions.Item.Off-Guard]{off-guard}");

        // Check structure: preamble + hr + degrees
        expect(result).toContain("<hr>");
        expect(result).toContain("<strong>Critical Success</strong>");
        expect(result).toContain("<strong>Success</strong>");
        expect(result).toContain("<strong>Failure</strong>");
        expect(result).toContain("<strong>Critical Failure</strong>");

        // Degrees are separate paragraphs
        expect(result).toMatch(/<\/p>\n<hr>\n<p><strong>Critical Success<\/strong>/);
    });

    it("enriches a basic save ability", () => {
        const input =
            "The creature breathes fire in a 15-foot cone. Each creature " +
            "in the area must attempt a DC 18 basic Reflex save, taking " +
            "4d6 fire damage.";

        const result = enrichDescription(input);

        expect(result).toContain("@Template[type:cone|distance:15]");
        expect(result).toContain("@Check[reflex|dc:18|basic]");
        expect(result).toContain("@Damage[4d6[fire]]");
    });

    it("enriches a Trigger/Effect ability", () => {
        const input =
            "**Trigger** A creature enters the area. " +
            "**Effect** The creature must attempt a DC 20 Reflex save " +
            "or take 2d6 piercing damage.";

        const result = enrichDescription(input);

        expect(result).toContain("<strong>Trigger</strong>");
        expect(result).toContain("<hr>");
        expect(result).toContain("<strong>Effect</strong>");
        expect(result).toContain("@Check[reflex|dc:20]");
        expect(result).toContain("@Damage[2d6[piercing]]");
    });

    it("renders ordinary reviewed bold markdown", () => {
        expect(enrichDescription("**3rd** discharge")).toBe("<p><strong>3rd</strong> discharge</p>");
    });

    it("handles a passive ability with no enrichable patterns", () => {
        const input =
            "The legionary gains a +2 circumstance bonus to saves against " +
            "fear and emotion effects. When they roll a success on a save " +
            "against a fear effect, they get a critical success instead.";

        const result = enrichDescription(input);

        // Should just be wrapped in <p> with no enrichers
        expect(result).toBe(`<p>${input}</p>`);
        expect(result).not.toContain("@Check");
        expect(result).not.toContain("@Damage");
    });

    it("enriches damage with modifiers", () => {
        const input = "The strike deals 2d8+5 slashing damage.";
        const result = enrichDescription(input);
        expect(result).toContain("@Damage[(2d8+5)[slashing]]");
    });
});
