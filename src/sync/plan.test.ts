import { describe, expect, it } from "vitest";
import { computeSyncPlan, payloadItems, type WorldDocSnapshot } from "./plan.js";
import { PAYLOAD_FORMAT_VERSION, type SyncPayload } from "./payload-types.js";

function payload(overrides: Partial<SyncPayload> = {}): SyncPayload {
    return {
        formatVersion: PAYLOAD_FORMAT_VERSION, generatedAt: "", manifestHash: "",
        entities: [{ syncId: "fs-randall1", slug: "randall", name: "Randall", type: "Character", published: false, playerHtml: "<p></p>", gmHtml: null, portrait: "art/fs-randall1.webp", subject: null, contentHash: "h-r1" }],
        creatures: [{ syncId: "fs-manta001", slug: "manta", name: "Dust Manta", statblock: {} as never, portrait: null, contentHash: "h-m1" }],
        ...overrides,
    };
}

function snap(partial: Partial<WorldDocSnapshot>): WorldDocSnapshot {
    return { docType: "Actor", id: "", name: "", syncId: null, syncKind: null, importedHash: null, importedBaseline: null, currentHash: null, ...partial };
}

describe("payloadItems", () => {
    it("emits journal+actor for every Character (placeholder when portrait-less)", () => {
        const p = payload();
        p.entities.push({ ...p.entities[0], syncId: "fs-wren0001", slug: "wren", name: "Wren", portrait: null, subject: null, contentHash: "h-w1" });
        const items = payloadItems(p);
        expect(items.filter((i) => i.syncId === "fs-randall1").map((i) => i.kind).sort()).toEqual(["entity-journal", "people-actor"]);
        expect(items.filter((i) => i.syncId === "fs-wren0001").map((i) => i.kind).sort()).toEqual(["entity-journal", "people-actor"]);
        expect(items.find((i) => i.syncId === "fs-manta001")?.kind).toBe("creature-actor");
    });
});

describe("computeSyncPlan", () => {
    it("creates everything against an empty world", () => {
        const plan = computeSyncPlan(payload(), []);
        expect(plan.create).toHaveLength(3);
        expect(plan.adopt).toHaveLength(0);
    });

    it("keys identity by (docType, syncId): same syncId journal and actor are distinct", () => {
        const world = [
            snap({ docType: "JournalEntry", id: "J1", name: "Randall", syncId: "fs-randall1", syncKind: "entity-journal", importedHash: "h-r1" }),
        ];
        const plan = computeSyncPlan(payload(), world);
        expect(plan.unchanged).toBe(1);
        expect(plan.create.map((a) => a.item.kind).sort()).toEqual(["creature-actor", "people-actor"]);
    });

    it("adopts by (docType, exact name) when unflagged", () => {
        const world = [
            snap({ docType: "Actor", id: "A1", name: "Randall" }),
            snap({ docType: "JournalEntry", id: "J1", name: "Randall" }),
        ];
        const plan = computeSyncPlan(payload(), world);
        expect(plan.adopt).toHaveLength(2);
        expect(plan.adopt.find((a) => a.item.docType === "Actor")?.existingId).toBe("A1");
        expect(plan.adopt.find((a) => a.item.docType === "JournalEntry")?.existingId).toBe("J1");
    });

    it("never adopts when two unflagged world docs share the (docType, name)", () => {
        const world = [
            snap({ docType: "Actor", id: "A1", name: "Randall" }),
            snap({ docType: "Actor", id: "A2", name: "Randall" }),
        ];
        const plan = computeSyncPlan(payload(), world);
        expect(plan.adopt).toHaveLength(0);
        expect(plan.create.some((a) => a.item.kind === "people-actor")).toBe(true);
    });

    it("never adopts when two payload items share the (docType, name)", () => {
        const p = payload();
        p.entities.push({ ...p.entities[0], syncId: "fs-randall2", slug: "randall-2", contentHash: "h-r2" });
        const world = [snap({ docType: "JournalEntry", id: "J1", name: "Randall" })];
        const plan = computeSyncPlan(p, world);
        expect(plan.adopt).toHaveLength(0);
        expect(plan.create.filter((a) => a.item.docType === "JournalEntry")).toHaveLength(2);
    });

    it("consumes an adopted candidate exactly once", () => {
        const world = [snap({ docType: "JournalEntry", id: "J1", name: "Randall" })];
        const plan = computeSyncPlan(payload(), world);
        expect(plan.adopt.filter((a) => a.existingId === "J1")).toHaveLength(1);
    });

    it("updates journals/people automatically, offers creature reimport with modified flag", () => {
        const world = [
            snap({ docType: "JournalEntry", id: "J1", name: "Randall", syncId: "fs-randall1", syncKind: "entity-journal", importedHash: "old" }),
            snap({ docType: "Actor", id: "A2", name: "Dust Manta", syncId: "fs-manta001", syncKind: "creature-actor", importedHash: "old", importedBaseline: "b1", currentHash: "diverged" }),
        ];
        const plan = computeSyncPlan(payload(), world);
        expect(plan.update.map((a) => a.existingId)).toEqual(["J1"]);
        expect(plan.reimport).toEqual([expect.objectContaining({ existingId: "A2", modifiedInFoundry: true })]);
    });

    it("does not flag a reimport as modified when the actor matches its import baseline", () => {
        const world = [
            snap({ docType: "Actor", id: "A3", name: "Dust Manta", syncId: "fs-manta001", syncKind: "creature-actor", importedHash: "old", importedBaseline: "b1", currentHash: "b1" }),
        ];
        const plan = computeSyncPlan(payload(), world);
        expect(plan.reimport).toEqual([expect.objectContaining({ existingId: "A3", modifiedInFoundry: false })]);
    });

    it("lists flagged docs missing from the payload as stale, never deletes", () => {
        const world = [snap({ docType: "Actor", id: "A9", name: "Old Guy", syncId: "fs-gone000", syncKind: "people-actor", importedHash: "h" })];
        const plan = computeSyncPlan(payload(), world);
        expect(plan.stale).toEqual([{ docType: "Actor", id: "A9", name: "Old Guy", syncId: "fs-gone000", kind: "people-actor" }]);
    });
});
