import { describe, expect, it } from "vitest";
import { hashCreatureImportData, peopleActorCreateData, peopleActorUpdateData, rewriteLinkPlaceholders } from "./import.js";
import type { SyncEntity } from "./payload-types.js";

describe("rewriteLinkPlaceholders", () => {
    it("rewrites known sync ids to journal UUID links", () => {
        const map = new Map([["fs-wren0001", "J123"]]);
        expect(rewriteLinkPlaceholders('See @ForgeSync[fs-wren0001]{Wren} here.', map))
            .toBe("See @UUID[JournalEntry.J123]{Wren} here.");
    });

    it("falls back to display text when the sync id is unknown", () => {
        expect(rewriteLinkPlaceholders("@ForgeSync[fs-missing]{Ghost}", new Map()))
            .toBe("Ghost");
    });
});

describe("hashCreatureImportData", () => {
    it("is stable regardless of object key order", () => {
        const actorA = {
            name: "Manta",
            system: { details: { level: { value: 3 } }, attributes: { hp: { max: 10 } } },
            items: [{ name: "Bite", type: "melee", system: { damage: { die: "d6" } } }],
        };
        const actorB = {
            name: "Manta",
            items: [{ system: { damage: { die: "d6" } }, type: "melee", name: "Bite" }],
            system: { attributes: { hp: { max: 10 } }, details: { level: { value: 3 } } },
        };
        expect(hashCreatureImportData(actorA as never)).toBe(hashCreatureImportData(actorB as never));
    });

    it("changes when actor import state changes", () => {
        const base = {
            name: "Manta",
            system: {},
            items: [] as { name: string; type: string; system: object }[],
        };
        const changed = { ...base, items: [{ name: "Claw", type: "melee", system: {} }] };
        expect(hashCreatureImportData(base as never)).not.toBe(hashCreatureImportData(changed as never));
    });
});


const randall: SyncEntity = {
    syncId: "fs-randall1",
    slug: "randall",
    name: "Randall",
    type: "Character",
    published: false,
    playerHtml: "<p></p>",
    gmHtml: null,
    portrait: "art/fs-randall1.webp",
    contentHash: "h-r1",
};

describe("peopleActorCreateData", () => {
    it("composes full prototypeToken on create but vault-only on update", () => {
        const create = peopleActorCreateData(randall);
        expect(create.prototypeToken).toEqual({
            texture: { src: "forge-sync/art/fs-randall1.webp" },
            ring: { enabled: true },
            actorLink: true,
            disposition: 0,
        });

        const update = peopleActorUpdateData(randall);
        expect(update.prototypeToken).toEqual({
            texture: { src: "forge-sync/art/fs-randall1.webp" },
            ring: { enabled: true },
        });
        expect(Object.keys(update.prototypeToken as object).sort()).toEqual(["ring", "texture"]);
    });
});
