import { describe, expect, it } from "vitest";
import { hashCreatureImportData, creatureArtFields, journalAdoptUpdateData, journalShellCreateData, JOURNAL_SHELL_FOLDER, moduleFlags, peopleActorCreateData, peopleActorUpdateData, rewriteLinkPlaceholders } from "./import.js";
import type { SyncCreature, SyncEntity } from "./payload-types.js";

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

    it("uses codex-sync paths for portrait-bearing Character create data", () => {
        const create = peopleActorCreateData(randall);
        expect(create.img).toBe("codex-sync/art/fs-randall1.webp");
        expect((create.prototypeToken as { texture: { src: string } }).texture.src).toBe("codex-sync/art/fs-randall1.webp");
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
            texture: { src: "codex-sync/art/fs-randall1.webp" },
            ring: {
                enabled: true,
                subject: { texture: "icons/svg/mystery-man.svg", scale: 1 },
            },
            actorLink: true,
            disposition: 0,
        });

        const update = peopleActorUpdateData(randall);
        expect(update.prototypeToken).toEqual({
            texture: { src: "codex-sync/art/fs-randall1.webp" },
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
            texture: "codex-sync/art/fs-subj0001-subject.png",
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
        expect(token.texture.src).toBe("codex-sync/art/fs-randall1.webp");
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
            "codex-foundry": { syncId: "fs-randall1", syncKind: "entity-journal" },
        });

        const adopt = journalAdoptUpdateData("fs-randall1", "entity-journal");
        expect(adopt).toEqual({
            flags: {
                "codex-foundry": { syncId: "fs-randall1", syncKind: "entity-journal" },
            },
        });
        expect(adopt).not.toHaveProperty("folder");
    });
});

describe("creatureArtFields", () => {
    const manta: SyncCreature = {
        syncId: "fs-manta001",
        slug: "manta",
        name: "Manta",
        statblock: {} as SyncCreature["statblock"],
        portrait: "art/fs-manta001.webp",
        contentHash: "h-m1",
    };

    it("drives both actor img and prototype token texture from the portrait", () => {
        // Reimport path relies on this: core's default-artwork fill only runs at creation,
        // so an existing creature actor's token texture only updates if we write it.
        expect(creatureArtFields(manta)).toEqual({
            img: "codex-sync/art/fs-manta001.webp",
            prototypeToken: { texture: { src: "codex-sync/art/fs-manta001.webp" } },
        });
    });

    it("uses separate staged subject art for the dynamic ring without replacing the portrait", () => {
        expect(creatureArtFields({
            ...manta,
            subject: "art/fs-manta001-subject.png",
        })).toEqual({
            img: "codex-sync/art/fs-manta001.webp",
            prototypeToken: {
                texture: { src: "codex-sync/art/fs-manta001.webp" },
                ring: {
                    enabled: true,
                    subject: { texture: "codex-sync/art/fs-manta001-subject.png", scale: 1 },
                },
            },
        });
    });

    it("returns no art fields when the creature has no portrait, never clobbering existing token art", () => {
        expect(creatureArtFields({ ...manta, portrait: null })).toEqual({});
    });

    it("adds subject art without clobbering existing creature art when no portrait is present", () => {
        expect(creatureArtFields({
            ...manta,
            portrait: null,
            subject: "art/fs-manta001-subject.png",
        })).toEqual({
            prototypeToken: {
                ring: {
                    enabled: true,
                    subject: { texture: "codex-sync/art/fs-manta001-subject.png", scale: 1 },
                },
            },
        });
    });
});

describe("legacy module flags", () => {
    it("reads sync identity from the legacy sf2e-forge-custom flag key", () => {
        const doc = {
            flags: {
                "sf2e-forge-custom": { syncId: "fs-abc123", syncKind: "entity-journal", importedHash: "h1" },
            },
        };
        expect(moduleFlags(doc)).toEqual({ syncId: "fs-abc123", syncKind: "entity-journal", importedHash: "h1" });
    });

    it("prefers codex-foundry flags when both keys are present", () => {
        const doc = {
            flags: {
                "codex-foundry": { syncId: "new-id" },
                "sf2e-forge-custom": { syncId: "old-id" },
            },
        };
        expect(moduleFlags(doc).syncId).toBe("new-id");
    });
});
