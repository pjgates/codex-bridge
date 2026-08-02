import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntimeApi, installRuntimeApi } from "../../src/api.js";
import {
    canUpdateMessage,
    getFlagData,
    rollOvercomeForTargets,
    rollSavesForTargets,
    updateTargets,
} from "../../src/rulesets/sf2e/target-helper/index.js";
import { postAttackCard, resolveAttackCardProvenance, rollAttackCardArmorSaves, rollWeaponDamage } from "../../src/rulesets/sf2e/prad/index.js";
import type { TargetHelperFlagData } from "../../src/rulesets/sf2e/target-helper/index.js";
import { MODULE_ID } from "../../src/constants.js";

vi.mock("../../src/rulesets/sf2e/target-helper/index.js", () => ({
    canUpdateMessage: vi.fn(),
    getFlagData: vi.fn(),
    rollNpcSaves: vi.fn(),
    rollOvercomeForTargets: vi.fn(),
    rollSavesForTargets: vi.fn(),
    updateTargets: vi.fn(),
}));

vi.mock("../../src/rulesets/sf2e/prad/index.js", () => ({
    postAttackCard: vi.fn(),
    resolveAttackCardProvenance: vi.fn(),
    rollAttackCardArmorSaves: vi.fn(),
    rollWeaponDamage: vi.fn(),
}));
const TARGET_REVISION = "00000000-0000-4000-8000-000000000001";
const targetFlagData: TargetHelperFlagData = {
    type: "spell",
    targets: ["Scene.scene.Token.target"],
    generation: 0,
    revision: TARGET_REVISION,
    save: { statistic: "reflex", dc: 20, basic: true },
};
const message = {
    documentName: "ChatMessage",
    flags: { [MODULE_ID]: { targetHelper: targetFlagData, pradType: "attack-card" } },
};
const ownedToken = {
    documentName: "Token",
    id: "target",
    uuid: "Scene.scene.Token.target",
    actor: { uuid: "Actor.target" },
    isOwner: true,
};
const collidingToken = {
    ...ownedToken,
    uuid: "Scene.other.Token.target",
};
const attacker = {
    documentName: "Actor",
    id: "npc",
    uuid: "Actor.npc",
    type: "npc",
    items: { get: vi.fn() },
};
const weapon = {
    documentName: "Item",
    id: "laser",
    name: "Laser",
    system: {},
};
const attackerToken = {
    documentName: "Token",
    id: "npc-token",
    uuid: "Scene.scene.Token.npc-token",
    actor: attacker,
    isOwner: true,
};
const documents = new Map<string, object>([
    ["ChatMessage.message", message],
    [ownedToken.uuid, ownedToken],
    [collidingToken.uuid, collidingToken],
    [attacker.uuid, attacker],
    ["Actor.npc.Item.laser", weapon],
    [attackerToken.uuid, attackerToken],
]);

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(message, { actor: undefined, isAuthor: false });
    attacker.items.get.mockImplementation((id: string) => id === weapon.id ? weapon : undefined);
    vi.mocked(canUpdateMessage).mockReturnValue(true);
    vi.mocked(getFlagData).mockReturnValue(targetFlagData);
    vi.mocked(rollSavesForTargets).mockResolvedValue(true);
    vi.mocked(rollOvercomeForTargets).mockResolvedValue(true);
    vi.mocked(resolveAttackCardProvenance).mockReturnValue({
        attacker,
        weaponItem: weapon,
        weaponName: "Laser",
        attackDC: 21,
        targetTokenUUIDs: [ownedToken.uuid],
    } as never);
    vi.mocked(rollAttackCardArmorSaves).mockResolvedValue(true);
    vi.mocked(rollWeaponDamage).mockResolvedValue(true);
    vi.mocked(postAttackCard).mockResolvedValue("ChatMessage.created");
    Object.assign(globalThis, {
        MouseEvent: class MouseEvent {
            constructor(readonly type: string) {}
        },
        fromUuidSync: (uuid: string) => documents.get(uuid) ?? null,
        game: {
            user: { isGM: true },
            modules: new Map([[MODULE_ID, { active: true }]]),
            settings: {
                get: (_module: string, key: string) => ["enableCustomRules", "enableTargetHelper", "playersRollAllDice"].includes(key),
            },
        },
    });
});

describe("installRuntimeApi", () => {
    it("attaches the typed mechanics facade while omitting UI-only helpers", () => {
        installRuntimeApi();

        const api = (game as Sf2eGame).modules?.get(MODULE_ID)?.api;
        expect(api).toBeDefined();
        expect(api?.targetHelper.setTargets).toEqual(expect.any(Function));
        expect(api?.prad.rollWeaponDamage).toEqual(expect.any(Function));
        expect(api?.targetHelper).not.toHaveProperty("panToTarget");
        expect(api?.targetHelper).not.toHaveProperty("pingTarget");
    });
});

describe("Target Helper facade", () => {
    it("keeps methods available but returns disabled when the feature is off", async () => {
        (game as Sf2eGame).settings = { get: () => false };

        await expect(createRuntimeApi().targetHelper.setTargets({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [],
        })).resolves.toEqual({ ok: false, error: { code: "disabled", message: "Custom rules are disabled." } });
    });

    it("resolves durable IDs before delegating a target update", async () => {
        await expect(createRuntimeApi().targetHelper.setTargets({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [ownedToken.uuid],
        })).resolves.toEqual({ ok: true });

        expect(updateTargets).toHaveBeenCalledWith(message, [ownedToken.uuid]);
    });

    it("rejects missing and wrong-kind durable IDs with structured failures", async () => {
        await expect(createRuntimeApi().targetHelper.setTargets({
            messageUuid: "ChatMessage.missing",
            targetTokenUuids: [],
        })).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });

        await expect(createRuntimeApi().targetHelper.setTargets({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [attacker.uuid],
        })).resolves.toMatchObject({ ok: false, error: { code: "invalid-argument" } });
    });

    it("rejects syntactically malformed UUIDs before resolution while preserving not-found for valid unresolved UUIDs", async () => {
        await expect(createRuntimeApi().targetHelper.setTargets({
            messageUuid: "ChatMessage",
            targetTokenUuids: [],
        })).resolves.toMatchObject({ ok: false, error: { code: "invalid-argument" } });

        await expect(createRuntimeApi().targetHelper.setTargets({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: ["Scene.scene.Token"],
        })).resolves.toMatchObject({ ok: false, error: { code: "invalid-argument" } });

        await expect(createRuntimeApi().targetHelper.setTargets({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: ["Scene.scene.Token.missing"],
        })).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });
    });

    it("rejects target UUIDs resolving to colliding embedded token IDs", async () => {
        await expect(createRuntimeApi().targetHelper.setTargets({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [ownedToken.uuid, collidingToken.uuid],
        })).resolves.toMatchObject({ ok: false, error: { code: "invalid-argument" } });
        expect(updateTargets).not.toHaveBeenCalled();
    });

    it("delegates player saves only for owned target tokens", async () => {
        await expect(createRuntimeApi().targetHelper.rollPlayerSaves({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [ownedToken.uuid],
        })).resolves.toEqual({ ok: true });

        expect(rollSavesForTargets).toHaveBeenCalledWith(expect.any(MouseEvent), message, [ownedToken]);
    });

    it("rejects saves for tokens outside the exact card membership", async () => {
        vi.mocked(getFlagData).mockReturnValue({ ...targetFlagData, targets: [] });

        await expect(createRuntimeApi().targetHelper.rollPlayerSaves({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [ownedToken.uuid],
        })).resolves.toMatchObject({ ok: false, error: { code: "invalid-argument" } });
        expect(rollSavesForTargets).not.toHaveBeenCalled();
    });

    it("reports a declined save mechanic as an operation failure", async () => {
        vi.mocked(rollSavesForTargets).mockResolvedValue(false);

        await expect(createRuntimeApi().targetHelper.rollPlayerSaves({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [ownedToken.uuid],
        })).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    });

    it("rejects ordinary player saves for PRAD overcome cards", async () => {
        vi.mocked(getFlagData).mockReturnValue({ ...targetFlagData, pradOvercome: true });

        await expect(createRuntimeApi().targetHelper.rollPlayerSaves({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [ownedToken.uuid],
        })).resolves.toMatchObject({ ok: false, error: { code: "invalid-argument" } });
        expect(rollSavesForTargets).not.toHaveBeenCalled();
    });

    it("does not use message authorship when an explicit PRAD caster is unowned", async () => {
        Object.assign(game.user!, { isGM: false });
        Object.assign(message, { isAuthor: true });
        vi.mocked(getFlagData).mockReturnValue({ ...targetFlagData, pradOvercome: true, author: attacker.uuid });

        await expect(createRuntimeApi().targetHelper.rollOvercome({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [ownedToken.uuid],
        })).resolves.toMatchObject({ ok: false, error: { code: "unauthorized" } });
    });

    it("rejects overcome targets resolving to colliding embedded token IDs", async () => {
        vi.mocked(getFlagData).mockReturnValue({ ...targetFlagData, targets: [ownedToken.uuid, collidingToken.uuid], pradOvercome: true, author: attacker.uuid });

        await expect(createRuntimeApi().targetHelper.rollOvercome({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [ownedToken.uuid, collidingToken.uuid],
        })).resolves.toMatchObject({ ok: false, error: { code: "invalid-argument" } });
        expect(rollOvercomeForTargets).not.toHaveBeenCalled();
    });

    it("uses the message actor and message authorship when an explicit PRAD caster UUID is absent", async () => {
        Object.assign(game.user!, { isGM: false });
        Object.assign(message, { actor: attacker, isAuthor: true });
        vi.mocked(getFlagData).mockReturnValue({ ...targetFlagData, pradOvercome: true });

        await expect(createRuntimeApi().targetHelper.rollOvercome({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [ownedToken.uuid],
        })).resolves.toEqual({ ok: true });
        expect(rollOvercomeForTargets).toHaveBeenCalledWith(expect.any(MouseEvent), message, [ownedToken]);
    });
});

describe("PRAD facade", () => {
    it("resolves attacker, owned weapon, and attacker token before posting a card", async () => {
        await expect(createRuntimeApi().prad.postAttackCard({
            attackerUuid: attacker.uuid,
            weaponItemUuid: "Actor.npc.Item.laser",
            attackerTokenUuid: attackerToken.uuid,
            targetTokenUuids: [ownedToken.uuid],
            attackDC: 21,
        })).resolves.toEqual({ ok: true, messageUuid: "ChatMessage.created" });

        expect(postAttackCard).toHaveBeenCalledWith({
            attacker,
            attackDC: 21,
            attackerTokenUUID: attackerToken.uuid,
            targetTokenUUIDs: [ownedToken.uuid],
            weaponItem: weapon,
        });
    });


    it("posts from an exact unlinked NPC token actor without substituting the world actor", async () => {
        const syntheticWeapon = { ...weapon, uuid: "Scene.scene.Token.npc-token.Actor.npc.Item.laser" };
        const syntheticAttacker = {
            ...attacker,
            uuid: "Scene.scene.Token.npc-token.Actor.npc",
            items: { get: (id: string) => id === syntheticWeapon.id ? syntheticWeapon : undefined },
        };
        const syntheticToken = { ...attackerToken, actor: syntheticAttacker };
        Object.assign(globalThis, {
            fromUuidSync: (uuid: string) => ({
                [syntheticAttacker.uuid]: syntheticAttacker,
                [syntheticWeapon.uuid]: syntheticWeapon,
                [syntheticToken.uuid]: syntheticToken,
                [ownedToken.uuid]: ownedToken,
            } as Record<string, object>)[uuid] ?? null,
        });

        await expect(createRuntimeApi().prad.postAttackCard({
            attackerUuid: syntheticAttacker.uuid,
            weaponItemUuid: syntheticWeapon.uuid,
            attackerTokenUuid: syntheticToken.uuid,
            targetTokenUuids: [ownedToken.uuid],
            attackDC: 21,
        })).resolves.toEqual({ ok: true, messageUuid: "ChatMessage.created" });

        expect(postAttackCard).toHaveBeenCalledWith(expect.objectContaining({
            attacker: syntheticAttacker,
            attackerTokenUUID: syntheticToken.uuid,
            weaponItem: syntheticWeapon,
        }));
    });
    it.each([
        { attackerUuid: "Actor" },
        { weaponItemUuid: "Actor.npc.Item" },
        { attackerTokenUuid: "Scene.scene.Token" },
    ])("rejects malformed PRAD card UUID macro inputs before posting", async (overrides) => {
        await expect(createRuntimeApi().prad.postAttackCard({
            attackerUuid: attacker.uuid,
            weaponItemUuid: "Actor.npc.Item.laser",
            attackerTokenUuid: attackerToken.uuid,
            targetTokenUuids: [ownedToken.uuid],
            attackDC: 21,
            ...overrides,
        })).resolves.toMatchObject({ ok: false, error: { code: "invalid-argument" } });
        expect(postAttackCard).not.toHaveBeenCalled();
    });

    it("rejects PRAD card target UUIDs resolving to colliding embedded token IDs", async () => {
        await expect(createRuntimeApi().prad.postAttackCard({
            attackerUuid: attacker.uuid,
            weaponItemUuid: "Actor.npc.Item.laser",
            targetTokenUuids: [ownedToken.uuid, collidingToken.uuid],
            attackDC: 21,
        })).resolves.toMatchObject({ ok: false, error: { code: "invalid-argument" } });
        expect(postAttackCard).not.toHaveBeenCalled();
    });

    it("reports rejected attack-card publication as an explicit typed failure", async () => {
        vi.mocked(postAttackCard).mockRejectedValue(new Error("PRAD attack cards cannot include private targets"));

        await expect(createRuntimeApi().prad.postAttackCard({
            attackerUuid: attacker.uuid,
            weaponItemUuid: "Actor.npc.Item.laser",
            targetTokenUuids: [ownedToken.uuid],
            attackDC: 21,
        })).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    });

    it("lets a non-GM exact target owner invoke armor-save execution for trusted GM-authored provenance", async () => {
        Object.assign(globalThis, { game: { ...game, user: { id: "player-owner", isGM: false } } });
        await expect(createRuntimeApi().prad.rollArmorSaves({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [ownedToken.uuid],
        })).resolves.toEqual({ ok: true });

        expect(rollAttackCardArmorSaves).toHaveBeenCalledWith(message, [ownedToken]);
    });

    it("rejects armor saves for a message without trusted GM-authored provenance", async () => {
        vi.mocked(resolveAttackCardProvenance).mockReturnValue(undefined);

        await expect(createRuntimeApi().prad.rollArmorSaves({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [ownedToken.uuid],
        })).resolves.toMatchObject({ ok: false, error: { code: "invalid-argument" } });
        expect(rollAttackCardArmorSaves).not.toHaveBeenCalled();
    });

    it("rejects armor-save target UUIDs resolving to colliding embedded token IDs", async () => {
        await expect(createRuntimeApi().prad.rollArmorSaves({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [ownedToken.uuid, collidingToken.uuid],
        })).resolves.toMatchObject({ ok: false, error: { code: "invalid-argument" } });
        expect(rollAttackCardArmorSaves).not.toHaveBeenCalled();
    });


    it("rejects exact targets outside trusted card membership", async () => {
        const outside = { ...ownedToken, id: "outside", uuid: "Scene.scene.Token.outside" };
        Object.assign(globalThis, { fromUuidSync: (uuid: string) => uuid === outside.uuid ? outside : documents.get(uuid) ?? null });

        await expect(createRuntimeApi().prad.rollArmorSaves({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [outside.uuid],
        })).resolves.toMatchObject({ ok: false, error: { code: "invalid-argument" } });
        expect(rollAttackCardArmorSaves).not.toHaveBeenCalled();
    });

    it("rejects non-GM armor saves for an unowned exact card target", async () => {
        const unowned = { ...ownedToken, isOwner: false };
        Object.assign(globalThis, {
            fromUuidSync: (uuid: string) => uuid === unowned.uuid ? unowned : documents.get(uuid) ?? null,
            game: { ...game, user: { isGM: false } },
        });

        await expect(createRuntimeApi().prad.rollArmorSaves({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [unowned.uuid],
        })).resolves.toMatchObject({ ok: false, error: { code: "unauthorized" } });
        expect(rollAttackCardArmorSaves).not.toHaveBeenCalled();
    });
    it("reports ordinary no-op mechanics as operation failures", async () => {
        vi.mocked(rollAttackCardArmorSaves).mockResolvedValue(false);

        await expect(createRuntimeApi().prad.rollArmorSaves({
            messageUuid: "ChatMessage.message",
            targetTokenUuids: [ownedToken.uuid],
        })).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    });

    it("rejects null requests before destructuring", async () => {
        await expect(createRuntimeApi().prad.rollWeaponDamage(null as never)).resolves.toMatchObject({
            ok: false,
            error: { code: "invalid-argument" },
        });
    });

    it("reports a no-op damage mechanic as an operation failure", async () => {
        vi.mocked(rollWeaponDamage).mockResolvedValue(false);

        await expect(createRuntimeApi().prad.rollWeaponDamage({
            messageUuid: "ChatMessage.message",
        })).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    });
});
