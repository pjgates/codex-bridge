import { describe, expect, it } from "vitest";
import { buildJournalEntry } from "../journal.js";
import type { ConvertedEntity } from "../types.js";

function entity(gmHtml: string | null): ConvertedEntity {
    return {
        slug: "safe-place",
        id: "1234567890abcdef",
        name: "Safe Place",
        frontmatter: {
            title: "Safe Place",
            type: "Location",
            tags: [],
            depth: 1,
            status: "active",
            aliases: [],
            creation_date: "",
            campaign: [],
            published: true,
        },
        playerHtml: "<p>Player text</p>",
        gmHtml,
        folderId: "fedcba0987654321",
    };
}

describe("buildJournalEntry", () => {
    it("makes the parent and player page observer-readable while hiding GM notes", () => {
        const journal = buildJournalEntry(entity("<p>GM text</p>")) as {
            ownership: { default: number };
            pages: Array<{ ownership: { default: number } }>;
        };

        expect(journal.ownership.default).toBe(2);
        expect(journal.pages[0].ownership.default).toBe(2);
        expect(journal.pages[1].ownership.default).toBe(0);
    });
});
