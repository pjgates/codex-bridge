import { describe, expect, it } from "vitest";
import {
    filterRoster,
    sortRoster,
    type EntityRecord,
} from "../../../plugin/src/core/roster.js";

const records: EntityRecord[] = [
    {
        path: "codex/the-forge/entities/randall.md",
        name: "Randall",
        aliases: ["Officer Randall"],
        depth: 2,
        onstage: true,
        status: "active",
        campaigns: [{ key: "the-forge", label: "The Forge" }],
        tags: ["NPC", "Supporting"],
    },
    {
        path: "codex/the-forge/entities/wren-kadau.md",
        name: "Wren Kadau",
        aliases: [],
        depth: 3,
        onstage: false,
        status: "active",
        campaigns: [{ key: "the-forge", label: "The Forge" }],
        tags: ["NPC"],
    },
    {
        path: "codex/hidden-london/entities/constable-wren.md",
        name: "Constable Wren",
        aliases: ["Wren"],
        depth: 1,
        onstage: true,
        status: "active",
        campaigns: [{ key: "hidden-london", label: "Hidden London" }],
        tags: ["NPC"],
    },
    {
        path: "codex/aetherverse/entities/valor.md",
        name: "Valor",
        aliases: ["Vee", "Valentine"],
        depth: 3,
        onstage: false,
        status: "active",
        campaigns: [
            { key: "aetherverse", label: "The Aetherverse" },
            { key: "the-forge", label: "The Forge" },
        ],
        tags: ["NPC", "Cross-Campaign"],
    },
];

const nullDepthRecord: EntityRecord = {
    path: "codex/the-forge/entities/mystery.md",
    name: "Mystery",
    aliases: [],
    depth: null,
    onstage: false,
    status: null,
    campaigns: [{ key: "the-forge", label: "The Forge" }],
    tags: ["NPC"],
};

describe("filterRoster", () => {
    it("filters by campaign key", () => {
        expect(filterRoster(records, { campaignKey: "the-forge" }).map((r) => r.name)).toEqual([
            "Randall",
            "Wren Kadau",
            "Valor",
        ]);
    });

    it("filters to onstage characters when requested", () => {
        expect(
            filterRoster(records, { campaignKey: "the-forge", onstage: true }).map((r) => r.name),
        ).toEqual(["Randall"]);
    });

    it("filters by selected depth values", () => {
        expect(
            filterRoster(records, { campaignKey: "the-forge", depths: [3] }).map((r) => r.name),
        ).toEqual(["Wren Kadau", "Valor"]);
    });

    it("keeps null-depth records when no depth filter is applied", () => {
        expect(filterRoster([...records, nullDepthRecord], { campaignKey: "the-forge" }).map((r) => r.name)).toEqual([
            "Randall",
            "Wren Kadau",
            "Valor",
            "Mystery",
        ]);
    });

    it("excludes null-depth records when a depth filter is active", () => {
        expect(
            filterRoster([...records, nullDepthRecord], { campaignKey: "the-forge", depths: [3] }).map(
                (r) => r.name,
            ),
        ).toEqual(["Wren Kadau", "Valor"]);
    });

    it("matches case-insensitive substrings against name and aliases", () => {
        expect(filterRoster(records, { query: "wren" }).map((r) => r.name)).toEqual([
            "Wren Kadau",
            "Constable Wren",
        ]);
        expect(filterRoster(records, { query: "officer" }).map((r) => r.name)).toEqual([
            "Randall",
        ]);
    });
});

describe("sortRoster", () => {
    it("sorts by depth descending, then name ascending", () => {
        expect(sortRoster(records).map((r) => [r.depth, r.name])).toEqual([
            [3, "Valor"],
            [3, "Wren Kadau"],
            [2, "Randall"],
            [1, "Constable Wren"],
        ]);
    });

    it("sorts null-depth records after every numeric depth", () => {
        expect(sortRoster([...records, nullDepthRecord]).map((r) => [r.depth, r.name])).toEqual([
            [3, "Valor"],
            [3, "Wren Kadau"],
            [2, "Randall"],
            [1, "Constable Wren"],
            [null, "Mystery"],
        ]);
    });
});
