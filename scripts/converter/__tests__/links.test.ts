import { describe, expect, it } from "vitest";
import { resolveWikilinks } from "../links.js";

describe("resolveWikilinks", () => {
    it("emits a JournalEntry UUID only for an included slug", () => {
        expect(resolveWikilinks("See [[known|Known Place]].", new Map([["known", "1234567890abcdef"]]), "entities"))
            .toBe("See @UUID[Compendium.sf2e-forge-custom.entities.JournalEntry.1234567890abcdef]{Known Place}.");
    });

    it("normalizes valid Obsidian .md target suffixes", () => {
        expect(resolveWikilinks("See [[known.md]].", new Map([["known", "1234567890abcdef"]]), "entities"))
            .toBe("See @UUID[Compendium.sf2e-forge-custom.entities.JournalEntry.1234567890abcdef]{known}.");
    });

    it("preserves intentional plain-text fallback for ordinary unresolved author text", () => {
        expect(resolveWikilinks("See [[ordinary-missing|Rumour]].", new Map(), "entities"))
            .toBe("See Rumour.");
    });

    it("fails actionably when a known omitted draft is linked", () => {
        expect(() => resolveWikilinks("See [[draft-place]].", new Map(), "entities", {
            knownDraftSlugs: new Set(["draft-place"]),
            source: "published.md",
        })).toThrow("published.md: wikilink targets unpublished entity \"draft-place\"");
    });
});
