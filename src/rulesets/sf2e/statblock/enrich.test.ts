import { describe, expect, it } from "vitest";
import { enrichConditions } from "./enrich.js";

describe("enrichConditions", () => {
    // Document IDs from foundryvtt/pf2e's shared and SF2e-specific condition packs.
    it.each([
        ["dazzled", "TkIyaNPgTZFBCCuh", "dazzled"],
        ["Dazzled", "TkIyaNPgTZFBCCuh", "Dazzled"],
        ["blinded", "XgEqL1kFApUbl5Z2", "blinded"],
        ["off-guard", "AJh5ex99aV6VTggg", "off-guard"],
        ["prone", "j91X7x0XSomq8d60", "prone"],
        ["frightened 2", "TBSHQspnbcqxsmjL", "Frightened 2"],
        ["drained 1", "4D2KBtexWXa6oUMR", "Drained 1"],
        ["glitching 2", "6A2QDy8wRGCVQsSd", "Glitching 2"],
        ["suppressed", "enA7BxAjBb7ns1iF", "suppressed"],
        ["untethered", "z1ucw4CLwLqHoAp3", "untethered"],
    ])("links %s using its SF2e compendium document ID", (condition, id, label) => {
        expect(enrichConditions(`${condition} for 1 round.`)).toBe(
            `@UUID[Compendium.sf2e.conditions.Item.${id}]{${label}} for 1 round.`,
        );
    });

    it("leaves ambiguous prose and partial condition names unchanged", () => {
        const text = "A hidden creature is frightened by the dazzling light.";
        expect(enrichConditions(text)).toBe(text);
    });

    it("preserves existing condition links while enriching surrounding prose", () => {
        const linked = "@UUID[Compendium.sf2e.conditions.Item.enA7BxAjBb7ns1iF]{Suppressed}";
        const text = `${linked} for 1 round, then suppressed again.`;
        expect(enrichConditions(text)).toBe(
            `${linked} for 1 round, then @UUID[Compendium.sf2e.conditions.Item.enA7BxAjBb7ns1iF]{suppressed} again.`,
        );
    });
});
