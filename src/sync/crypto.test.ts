import { describe, expect, it } from "vitest";
import { decryptPayload, encryptPayload } from "./crypto.js";
import { PAYLOAD_FORMAT_VERSION, type SyncPayload } from "./payload-types.js";

const payload: SyncPayload = {
    formatVersion: PAYLOAD_FORMAT_VERSION,
    generatedAt: "2026-07-31T00:00:00.000Z",
    manifestHash: "abc123",
    entities: [{
        syncId: "fs-7k2m9p", slug: "randall", name: "Randall", type: "Character",
        published: false, playerHtml: "<p>Hi</p>", gmHtml: null,
        portrait: "art/fs-7k2m9p.webp", contentHash: "h1",
    }],
    creatures: [],
};

describe("payload crypto", () => {
    it("round-trips a payload", async () => {
        const blob = await encryptPayload(payload, "correct horse");
        expect(JSON.parse(blob)).toMatchObject({ v: 1 });
        const out = await decryptPayload(blob, "correct horse");
        expect(out).toEqual(payload);
    });

    it("rejects a wrong passphrase with a clear error", async () => {
        const blob = await encryptPayload(payload, "correct horse");
        await expect(decryptPayload(blob, "wrong")).rejects.toThrow(/passphrase/i);
    });

    it("rejects an unknown blob version", async () => {
        await expect(decryptPayload(JSON.stringify({ v: 2, salt: "", iv: "", data: "" }), "x"))
            .rejects.toThrow(/version/i);
    });
});
