import { beforeEach, describe, expect, it, vi } from "vitest";
import { canUpdateMessage, getCurrentTargetUUIDs, getFlagData, setSourceFlag, updateSaves, updateTargets } from "../../../src/rulesets/sf2e/target-helper/flags.js";
import { encodeTargetUuidSaveKey } from "../../../src/rulesets/sf2e/target-helper/result-validation.js";

const REVISION = "11111111-1111-4111-8111-111111111111";
const NEXT_REVISION = "22222222-2222-4222-8222-222222222222";

const VALID_RESULT = {
    value: 24,
    die: 17,
    success: "success" as const,
    modifiers: [{ label: "Reflex", modifier: 7 }],
    private: false,
    statistic: "reflex",
    targetUuid: "Scene.scene.Token.sibling",
    generation: 0,
    revision: REVISION,
};

const SIBLING_UUID = "Scene.scene.Token.sibling";
const SIBLING_SAVE_KEY = encodeTargetUuidSaveKey(SIBLING_UUID, 0, REVISION);

function createMessage() {
    return {
        flags: {
            "sf2e-forge-custom": {
                targetHelper: {
                    type: "spell",
                    targets: [SIBLING_UUID, "Scene.scene.Token.tokenA"],
                    generation: 0,
                    revision: REVISION,
                    save: { statistic: "reflex", dc: 20, basic: true },
                    saves: { [SIBLING_SAVE_KEY]: VALID_RESULT },
                },
            },
        },
        update: vi.fn().mockResolvedValue(undefined),
    };
}

describe("target-helper flags", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        Object.assign(globalThis, {
            fromUuidSync: (uuid: string) => ({ uuid, actor: { hasCondition: () => false } }),
            game: { user: { isGM: true } },
        });
        vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(NEXT_REVISION);
    });

    it("persists per-token leaves without rewriting the sibling map", async () => {
        const message = createMessage();

        await updateSaves(message as unknown as ChatMessage.Implementation, { tokenA: { ...VALID_RESULT, targetUuid: "Scene.scene.Token.tokenA" } });

        expect(message.update).toHaveBeenCalledWith({
            [`flags.sf2e-forge-custom.targetHelper.saves.${encodeTargetUuidSaveKey("Scene.scene.Token.tokenA", 0, REVISION)}`]: { ...VALID_RESULT, targetUuid: "Scene.scene.Token.tokenA" },
        });
    });

    it("persists private completions as redacted per-token leaves", async () => {
        const message = createMessage();

        await updateSaves(message as unknown as ChatMessage.Implementation, {
            tokenA: { ...VALID_RESULT, private: true, targetUuid: "Scene.scene.Token.tokenA" },
        });

        expect(message.update).toHaveBeenCalledWith({
            [`flags.sf2e-forge-custom.targetHelper.saves.${encodeTargetUuidSaveKey("Scene.scene.Token.tokenA", 0, REVISION)}`]: {
                private: true,
                statistic: "reflex",
                targetUuid: "Scene.scene.Token.tokenA",
                generation: 0,
                revision: REVISION,
            },
        });
    });

    it("discards a save leaf whose rolled UUID is no longer the current target", async () => {
        const message = createMessage();

        await expect(updateSaves(message as unknown as ChatMessage.Implementation, { tokenA: { ...VALID_RESULT, targetUuid: "Scene.previous.Token.tokenA" } })).resolves.toBe(false);

        expect(message.update).not.toHaveBeenCalled();
    });

    it("discards malformed persisted siblings before callers render them", () => {
        const message = createMessage();
        message.flags["sf2e-forge-custom"].targetHelper.saves = {
            [SIBLING_SAVE_KEY]: { ...VALID_RESULT, modifiers: [{ label: "<img src=x onerror=alert(1)>", modifier: Number.NaN }] },
        };

        expect(getFlagData(message as unknown as ChatMessage.Implementation)?.saves).toEqual({});
    });

    it("rejects dotted token IDs before constructing a Foundry update path", async () => {
        const message = createMessage();

        await expect(updateSaves(message as unknown as ChatMessage.Implementation, { "token.escape": VALID_RESULT })).rejects.toThrow("Invalid target token ID");
        expect(message.update).not.toHaveBeenCalled();
    });

    it("rejects malformed target UUIDs before persisting them", async () => {
        const message = createMessage();

        await expect(updateTargets(message as unknown as ChatMessage.Implementation, ["Actor.not-a-token"])).rejects.toThrow("Invalid target-helper targets");
        expect(message.update).not.toHaveBeenCalled();
    });

    it("discards a saved result when the same token ID is reassigned to another scene", async () => {
        const message = createMessage();
        message.flags["sf2e-forge-custom"].targetHelper.targets = ["Scene.first.Token.sibling"];
        message.flags["sf2e-forge-custom"].targetHelper.saves = { [encodeTargetUuidSaveKey("Scene.first.Token.sibling", 0, REVISION)]: { ...VALID_RESULT, targetUuid: "Scene.first.Token.sibling" } };

        await updateTargets(message as unknown as ChatMessage.Implementation, ["Scene.second.Token.sibling"]);

        expect(message.update).toHaveBeenCalledWith({
            "flags.sf2e-forge-custom.targetHelper.targets": ["Scene.second.Token.sibling"],
            "flags.sf2e-forge-custom.targetHelper.generation": 1,
            "flags.sf2e-forge-custom.targetHelper.revision": NEXT_REVISION,
            [`flags.sf2e-forge-custom.targetHelper.saves.-=${encodeTargetUuidSaveKey("Scene.first.Token.sibling", 0, REVISION)}`]: null,
        });
    });

    it("cleans a retained target's stale-generation save leaf without replacing sibling maps", async () => {
        const message = createMessage();
        message.flags["sf2e-forge-custom"].targetHelper.targets = ["Scene.first.Token.sibling"];
        message.flags["sf2e-forge-custom"].targetHelper.saves = { [encodeTargetUuidSaveKey("Scene.first.Token.sibling", 0, REVISION)]: { ...VALID_RESULT, targetUuid: "Scene.first.Token.sibling" } };

        await updateTargets(message as unknown as ChatMessage.Implementation, ["Scene.first.Token.sibling", "Scene.second.Token.added"]);

        expect(message.update).toHaveBeenCalledWith({
            "flags.sf2e-forge-custom.targetHelper.targets": ["Scene.first.Token.sibling", "Scene.second.Token.added"],
            "flags.sf2e-forge-custom.targetHelper.generation": 1,
            "flags.sf2e-forge-custom.targetHelper.revision": NEXT_REVISION,
            [`flags.sf2e-forge-custom.targetHelper.saves.-=${encodeTargetUuidSaveKey("Scene.first.Token.sibling", 0, REVISION)}`]: null,
        });
    });

    it("uses distinct persisted leaves when an old generation write settles after its replacement", async () => {
        const message = createMessage();
        let settleOldWrite!: () => void;
        message.flags["sf2e-forge-custom"].targetHelper.targets = ["Scene.old.Token.shared"];
        message.flags["sf2e-forge-custom"].targetHelper.saves = {};
        message.update.mockImplementationOnce(() => new Promise<void>((resolve) => { settleOldWrite = resolve; }));

        const oldWrite = updateSaves(message as unknown as ChatMessage.Implementation, {
            shared: { ...VALID_RESULT, targetUuid: "Scene.old.Token.shared" },
        });
        message.flags["sf2e-forge-custom"].targetHelper.targets = ["Scene.new.Token.shared"];
        message.flags["sf2e-forge-custom"].targetHelper.generation = 1;
        await updateSaves(message as unknown as ChatMessage.Implementation, {
            shared: { ...VALID_RESULT, generation: 1, targetUuid: "Scene.new.Token.shared" },
        });
        settleOldWrite();
        await oldWrite;

        expect(message.update).toHaveBeenNthCalledWith(1, {
            [`flags.sf2e-forge-custom.targetHelper.saves.${encodeTargetUuidSaveKey("Scene.old.Token.shared", 0, REVISION)}`]: expect.objectContaining({ targetUuid: "Scene.old.Token.shared" }),
        });
        expect(message.update).toHaveBeenNthCalledWith(2, {
            [`flags.sf2e-forge-custom.targetHelper.saves.${encodeTargetUuidSaveKey("Scene.new.Token.shared", 1, REVISION)}`]: expect.objectContaining({ targetUuid: "Scene.new.Token.shared", generation: 1 }),
        });
    });

    it("deletes a hidden old-generation leaf before retargeting can surface it", async () => {
        const message = createMessage();
        const oldUuid = "Scene.old.Token.shared";
        message.flags["sf2e-forge-custom"].targetHelper.targets = ["Scene.new.Token.shared"];
        message.flags["sf2e-forge-custom"].targetHelper.saves = {
            [encodeTargetUuidSaveKey(oldUuid, 0, REVISION)]: { ...VALID_RESULT, targetUuid: oldUuid },
        };

        expect(getFlagData(message as unknown as ChatMessage.Implementation)?.saves).toEqual({});
        await updateTargets(message as unknown as ChatMessage.Implementation, [oldUuid]);

        expect(message.update).toHaveBeenCalledWith({
            "flags.sf2e-forge-custom.targetHelper.targets": [oldUuid],
            "flags.sf2e-forge-custom.targetHelper.generation": 1,
            "flags.sf2e-forge-custom.targetHelper.revision": NEXT_REVISION,
            [`flags.sf2e-forge-custom.targetHelper.saves.-=${encodeTargetUuidSaveKey(oldUuid, 0, REVISION)}`]: null,
        });
    });

    it("mints distinct revisions for independent clients retargeting from the same generation", async () => {
        const first = createMessage();
        const second = createMessage();
        vi.mocked(globalThis.crypto.randomUUID)
            .mockReset()
            .mockReturnValueOnce(NEXT_REVISION)
            .mockReturnValueOnce("33333333-3333-4333-8333-333333333333");

        await updateTargets(first as unknown as ChatMessage.Implementation, ["Scene.scene.Token.first"]);
        await updateTargets(second as unknown as ChatMessage.Implementation, ["Scene.scene.Token.second"]);

        expect(first.update).toHaveBeenCalledWith(expect.objectContaining({ "flags.sf2e-forge-custom.targetHelper.revision": NEXT_REVISION }));
        expect(second.update).toHaveBeenCalledWith(expect.objectContaining({ "flags.sf2e-forge-custom.targetHelper.revision": "33333333-3333-4333-8333-333333333333" }));
    });

    it("initializes newly normalized source flags at generation zero", () => {
        const updateSource = vi.fn();

        setSourceFlag({ updateSource } as unknown as ChatMessage.Implementation, {
            type: "spell",
            targets: ["Scene.scene.Token.target"],
        });

        expect(updateSource).toHaveBeenCalledWith({
            "flags.sf2e-forge-custom.targetHelper": {
                type: "spell",
                targets: ["Scene.scene.Token.target"],
                generation: 0,
                revision: NEXT_REVISION,
            },
        });
    });

    it("rejects malformed source flags before writing them", () => {
        const updateSource = vi.fn();

        expect(() => setSourceFlag({ updateSource } as unknown as ChatMessage.Implementation, {
            type: "spell",
            targets: ["Actor.not-a-token"],
        })).toThrow("Invalid target-helper source flags");
        expect(updateSource).not.toHaveBeenCalled();
    });

    it("excludes hidden and unnoticed exact token UUIDs from public snapshots", () => {
        const publicToken = { uuid: "Scene.scene.Token.public", hidden: false, actor: { type: "npc", hasCondition: () => false } };
        const hiddenToken = { uuid: "Scene.scene.Token.hidden", hidden: true, actor: { type: "npc", hasCondition: () => false } };
        const unnoticedToken = { uuid: "Scene.scene.Token.unnoticed", hidden: false, actor: { type: "npc", hasCondition: (...slugs: string[]) => slugs.includes("unnoticed") } };
        Object.assign(globalThis, {
            fromUuidSync: (uuid: string) => [publicToken, hiddenToken, unnoticedToken].find((token) => token.uuid === uuid) ?? null,
            game: { user: { isGM: true, targets: new Set([publicToken, hiddenToken, unnoticedToken]) } },
        });

        expect(getCurrentTargetUUIDs()).toEqual([publicToken.uuid]);
    });

    it("filters private targets at source and update persistence boundaries", async () => {
        const message = createMessage();
        const publicUuid = "Scene.scene.Token.public";
        const hiddenUuid = "Scene.scene.Token.hidden";
        const unnoticedUuid = "Scene.scene.Token.unnoticed";
        Object.assign(globalThis, {
            fromUuidSync: (uuid: string) => ({
                uuid,
                hidden: uuid === hiddenUuid,
                actor: { hasCondition: () => uuid === unnoticedUuid },
            }),
        });
        const updateSource = vi.fn();

        setSourceFlag({ updateSource } as unknown as ChatMessage.Implementation, {
            type: "spell",
            targets: [publicUuid, hiddenUuid, unnoticedUuid],
        });
        await updateTargets(message as unknown as ChatMessage.Implementation, [publicUuid, hiddenUuid, unnoticedUuid]);

        expect(updateSource).toHaveBeenCalledWith(expect.objectContaining({
            "flags.sf2e-forge-custom.targetHelper": expect.objectContaining({ targets: [publicUuid] }),
        }));
        expect(message.update).toHaveBeenCalledWith(expect.objectContaining({
            "flags.sf2e-forge-custom.targetHelper.targets": [publicUuid],
        }));
    });

    it("uses Foundry document authorization when available", () => {
        const canUserModify = vi.fn().mockReturnValue(false);
        const message = { isAuthor: true, canUserModify };

        expect(canUpdateMessage(message as unknown as ChatMessage.Implementation)).toBe(false);
        expect(canUserModify).toHaveBeenCalledWith((globalThis as unknown as { game: { user: unknown } }).game.user, "update");
    });

    it("allows a Foundry-authorized GM who is not the message author", () => {
        const canUserModify = vi.fn().mockReturnValue(true);

        expect(canUpdateMessage({ isAuthor: false, canUserModify } as unknown as ChatMessage.Implementation)).toBe(true);
        expect(canUserModify).toHaveBeenCalledWith((globalThis as unknown as { game: { user: unknown } }).game.user, "update");
    });

    it("denies a non-author when Foundry authorization denies update", () => {
        Object.assign(globalThis, { game: { user: { isGM: false } } });
        expect(canUpdateMessage({ isAuthor: false, canUserModify: vi.fn().mockReturnValue(false) } as unknown as ChatMessage.Implementation)).toBe(false);
    });

    it("uses authorship only when Foundry document authorization is unavailable", () => {
        expect(canUpdateMessage({ isAuthor: true } as unknown as ChatMessage.Implementation)).toBe(true);
        expect(canUpdateMessage({ isAuthor: false } as unknown as ChatMessage.Implementation)).toBe(false);
    });
});
