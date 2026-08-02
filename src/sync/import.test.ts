import { describe, expect, it } from "vitest";
import { hashCreatureImportData, journalAdoptUpdateData, journalShellCreateData, JOURNAL_SHELL_FOLDER, peopleActorCreateData, peopleActorUpdateData, rewriteLinkPlaceholders } from "./import.js";
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
    subject: null,
    contentHash: "h-r1",
};

const wren: SyncEntity = {
    syncId: "fs-wren0001",
    slug: "wren",
    name: "Wren",
    type: "Character",
    published: false,
    playerHtml: "<p></p>",
    gmHtml: null,
    portrait: null,
    subject: null,
    contentHash: "h-w1",
};

const withSubject: SyncEntity = {
    syncId: "fs-subj0001",
    slug: "hero",
    name: "Hero",
    type: "Character",
    published: false,
    playerHtml: "<p></p>",
    gmHtml: null,
    portrait: null,
    subject: "art/fs-subj0001-subject.png",
    contentHash: "h-s1",
};

describe("peopleActor placeholder portraits", () => {
    it("uses mystery-man for portrait-less Character create data", () => {
        const create = peopleActorCreateData(wren);
        expect(create.img).toBe("icons/svg/mystery-man.svg");
        expect((create.prototypeToken as { texture: { src: string } }).texture.src).toBe("icons/svg/mystery-man.svg");
    });

    it("uses forge-sync paths for portrait-bearing Character create data", () => {
        const create = peopleActorCreateData(randall);
        expect(create.img).toBe("forge-sync/art/fs-randall1.webp");
        expect((create.prototypeToken as { texture: { src: string } }).texture.src).toBe("forge-sync/art/fs-randall1.webp");
    });

    it("uses mystery-man for portrait-less Character update data", () => {
        const update = peopleActorUpdateData(wren);
        expect(update.img).toBe("icons/svg/mystery-man.svg");
        expect((update.prototypeToken as { texture: { src: string } }).texture.src).toBe("icons/svg/mystery-man.svg");
    });
});

describe("peopleActorCreateData", () => {
    it("composes full prototypeToken on create but vault-only on update", () => {
        const create = peopleActorCreateData(randall);
        expect(create.prototypeToken).toEqual({
            texture: { src: "forge-sync/art/fs-randall1.webp" },
            ring: {
                enabled: true,
                subject: { texture: "icons/svg/mystery-man.svg", scale: 1 },
            },
            actorLink: true,
            disposition: 0,
        });

        const update = peopleActorUpdateData(randall);
        expect(update.prototypeToken).toEqual({
            texture: { src: "forge-sync/art/fs-randall1.webp" },
            ring: {
                enabled: true,
                subject: { texture: "icons/svg/mystery-man.svg", scale: 1 },
            },
        });
        expect(Object.keys(update.prototypeToken as object).sort()).toEqual(["ring", "texture"]);
    });
});

describe("peopleActor ring subject art", () => {
    const MYSTERY_MAN = "icons/svg/mystery-man.svg";

    it("uses staged subject art on the ring when subject is present", () => {
        const create = peopleActorCreateData(withSubject);
        const token = create.prototypeToken as {
            texture: { src: string };
            ring: { enabled: boolean; subject: { texture: string; scale: number } };
        };
        expect(token.ring.enabled).toBe(true);
        expect(token.ring.subject).toEqual({
            texture: "forge-sync/art/fs-subj0001-subject.png",
            scale: 1,
        });
        expect(token.texture.src).toBe(MYSTERY_MAN);
    });

    it("keeps mystery-man on the ring when portrait is present but subject is absent", () => {
        const create = peopleActorCreateData(randall);
        const token = create.prototypeToken as {
            texture: { src: string };
            ring: { subject: { texture: string } };
        };
        expect(token.texture.src).toBe("forge-sync/art/fs-randall1.webp");
        expect(token.ring.subject.texture).toBe(MYSTERY_MAN);
        expect(token.ring.subject.texture).not.toBe(token.texture.src);
    });

    it("uses mystery-man for ring subject and texture when both portrait and subject are absent", () => {
        const create = peopleActorCreateData(wren);
        const token = create.prototypeToken as {
            texture: { src: string };
            ring: { subject: { texture: string } };
        };
        expect(token.texture.src).toBe(MYSTERY_MAN);
        expect(token.ring.subject.texture).toBe(MYSTERY_MAN);
    });
});

describe("journal shell folder placement", () => {
    it("create payload uses Entities/JournalEntry folder; adopt update omits folder", () => {
        expect(JOURNAL_SHELL_FOLDER).toEqual({ name: "Entities", type: "JournalEntry" });

        const create = journalShellCreateData(randall, "fld-entities");
        expect(create.folder).toBe("fld-entities");
        expect(create.flags).toEqual({
            "sf2e-forge-custom": { syncId: "fs-randall1", syncKind: "entity-journal" },
        });

        const adopt = journalAdoptUpdateData("fs-randall1", "entity-journal");
        expect(adopt).toEqual({
            flags: {
                "sf2e-forge-custom": { syncId: "fs-randall1", syncKind: "entity-journal" },
            },
        });
        expect(adopt).not.toHaveProperty("folder");
    });
});
