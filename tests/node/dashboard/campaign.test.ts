import { describe, expect, it } from "vitest";
import { parseCampaigns } from "../../../plugin/src/core/campaign.js";

describe("parseCampaigns", () => {
    it.each([
        ["the-forge/index", "The Forge", "the-forge"],
        ["the-forge.index", "The Forge", "the-forge"],
        ["codex/avalon-chronicles/index", "Avalon Chronicles", "avalon-chronicles"],
        ["avalon-chronicles.index", "Avalon Chronicles", "avalon-chronicles"],
        ["avalon-chronicles/index", "Avalon Chronicles", "avalon-chronicles"],
        ["floridaverse.index", "Floridaverse", "floridaverse"],
    ])("normalizes %s with alias to key %s", (target, label, key) => {
        expect(parseCampaigns(`[[${target}|${label}]]`)).toEqual([{ key, label }]);
    });

    it("falls back to a title-cased slug label when the wikilink has no alias", () => {
        expect(parseCampaigns("[[the-forge/index]]")).toEqual([
            { key: "the-forge", label: "The Forge" },
        ]);
    });

    it("parses valor's cross-campaign frontmatter list", () => {
        expect(
            parseCampaigns([
                "[[aetherverse/index|The Aetherverse]]",
                "[[avalon-chronicles.index|Avalon Chronicles]]",
                "[[floridaverse.index|Floridaverse]]",
                "[[the-forge.index|The Forge]]",
                "[[the-reach.index|The Reach]]",
                "[[tales-from-the-frontier.index|Tales from the Frontier]]",
            ]),
        ).toEqual([
            { key: "aetherverse", label: "The Aetherverse" },
            { key: "avalon-chronicles", label: "Avalon Chronicles" },
            { key: "floridaverse", label: "Floridaverse" },
            { key: "the-forge", label: "The Forge" },
            { key: "the-reach", label: "The Reach" },
            { key: "tales-from-the-frontier", label: "Tales from the Frontier" },
        ]);
    });

    it("accepts a bare path string without wikilink brackets", () => {
        expect(parseCampaigns("codex/avalon-chronicles/index")).toEqual([
            { key: "avalon-chronicles", label: "Avalon Chronicles" },
        ]);
    });

    it("returns an empty array for missing or empty values", () => {
        expect(parseCampaigns(undefined)).toEqual([]);
        expect(parseCampaigns(null)).toEqual([]);
        expect(parseCampaigns("")).toEqual([]);
        expect(parseCampaigns([])).toEqual([]);
    });
});
