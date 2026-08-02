import { beforeEach, describe, expect, it, vi } from "vitest";
import { canRollOvercomeAsCurrentUser, onTargetHelperReroll, resolveOvercomeCasterActor, rollOvercomeForTargets, rollSavesForTargets } from "../../../src/rulesets/sf2e/target-helper/save-roll.js";
import { encodeTargetUuidSaveKey } from "../../../src/rulesets/sf2e/target-helper/result-validation.js";
import { DC_BASE_DEFAULT, DC_BASE_STRICT, setDCBase } from "../../../src/shared/dc.js";

const REVISION = "11111111-1111-4111-8111-111111111111";

const EVENT = {} as MouseEvent;
const ROLL = { total: 17, terms: [{ total: 10 }] } as unknown as Roll;

function createMessage(targetIds: string[] = [], pradOvercome = false) {
    return {
        id: "parent",
        actor: null,
        isAuthor: true,
        canUserModify: vi.fn().mockReturnValue(true),
        flags: {
            "sf2e-forge-custom": {
                targetHelper: {
                    type: "spell",
                    targets: targetIds.map((id) => `Scene.scene.Token.${id}`),
                    generation: 0,
                    revision: REVISION,
                    save: { statistic: "reflex", dc: 20, basic: true },
                    saves: {},
                    ...(pradOvercome ? { pradOvercome: true } : {}),
                },
            },
        },
        update: vi.fn().mockResolvedValue(undefined),
    };
}

function createTarget(id: string, roll: (options: { callback?: (roll: Roll, success: string, message: null) => void }) => Promise<Roll | null>, uuid = `Scene.scene.Token.${id}`) {
    return { id, uuid, actor: { getStatistic: () => ({ check: { roll } }) } } as unknown as Sf2eTokenDocument;
}

describe("PRAD overcome caster authorization", () => {
    beforeEach(() => {
        Object.assign(globalThis, { game: { user: { isGM: false } } });
    });

    it("falls back to the spell-card actor and message authorship without an explicit caster UUID", () => {
        const actor = {} as Sf2eActor;
        const message = { actor, isAuthor: true } as unknown as ChatMessage.Implementation;

        expect(resolveOvercomeCasterActor(message)).toBe(actor);
        expect(canRollOvercomeAsCurrentUser(message)).toBe(true);
    });

    it("requires actor ownership when an explicit caster UUID exists", () => {
        const actor = { isOwner: false } as Sf2eActor;
        const message = { actor: { isOwner: true }, isAuthor: true } as unknown as ChatMessage.Implementation;
        Object.assign(globalThis, { fromUuidSync: () => actor });

        expect(resolveOvercomeCasterActor(message, "Actor.explicit")).toBe(actor);
        expect(canRollOvercomeAsCurrentUser(message, "Actor.explicit")).toBe(false);
    });
});

describe("rollSavesForTargets", () => {
    beforeEach(() => {
        Object.assign(globalThis, {
            fromUuidSync: () => null,
            game: { user: { isGM: true }, users: new Map() },
            ui: { notifications: { error: vi.fn() } },
        });
    });

    it("persists successful siblings when another native save rejects", async () => {
        const message = createMessage(["successful", "rejected"]);
        const successful = createTarget("successful", async ({ callback }) => {
            callback?.(ROLL, "failure", null);
            return ROLL;
        });
        const rejected = createTarget("rejected", async () => { throw new Error("native failure"); });

        await rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [successful, rejected]);

        expect(message.update).toHaveBeenCalledOnce();
        expect(message.update).toHaveBeenCalledWith({
            [`flags.sf2e-forge-custom.targetHelper.saves.${encodeTargetUuidSaveKey("Scene.scene.Token.successful", 0, REVISION)}`]: {
                value: 17,
                die: 10,
                success: "failure",
                modifiers: [],
                private: false,
                statistic: "reflex",
                targetUuid: "Scene.scene.Token.successful",
                generation: 0,
                revision: REVISION,
            },
        });
    });

    it("treats a roll whispered only to a player as private and persists no outcome details", async () => {
        const message = createMessage(["private"]);
        const target = createTarget("private", async ({ callback }) => {
            callback?.(ROLL, "criticalSuccess", { whisper: ["player"] } as never);
            return ROLL;
        });

        await rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target]);

        expect(message.update).toHaveBeenCalledWith({
            [`flags.sf2e-forge-custom.targetHelper.saves.${encodeTargetUuidSaveKey("Scene.scene.Token.private", 0, REVISION)}`]: {
                private: true,
                statistic: "reflex",
                targetUuid: "Scene.scene.Token.private",
                generation: 0,
                revision: REVISION,
            },
        });
    });

    it("does not reroll a target with a redacted private completion marker", async () => {
        const message = createMessage(["private"]);
        message.flags["sf2e-forge-custom"].targetHelper.saves = {
            [encodeTargetUuidSaveKey("Scene.scene.Token.private", 0, REVISION)]: {
                private: true,
                statistic: "reflex",
                targetUuid: "Scene.scene.Token.private",
                generation: 0,
                revision: REVISION,
            },
        } as never;
        const roll = vi.fn();

        await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [createTarget("private", roll)])).resolves.toBe(false);

        expect(roll).not.toHaveBeenCalled();
        expect(message.update).not.toHaveBeenCalled();
    });

    it("settles a cancelled native save without waiting for a callback", async () => {
        const message = createMessage(["cancelled"]);
        const cancelled = createTarget("cancelled", async () => null);

        await rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [cancelled]);

        expect(message.update).not.toHaveBeenCalled();
    });

    it("does not begin a duplicate in-flight roll for the same token", async () => {
        const message = createMessage(["target"]);
        let complete!: () => void;
        const roll = vi.fn(({ callback }: { callback?: (roll: Roll, success: string, message: null) => void }) => new Promise<Roll>((resolve) => {
            complete = () => {
                callback?.(ROLL, "success", null);
                resolve(ROLL);
            };
        }));
        const target = createTarget("target", roll);

        const first = rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target]);
        const duplicate = rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target]);
        await duplicate;
        complete();
        await first;

        expect(roll).toHaveBeenCalledOnce();
    });

    it("lets only the assigned active character owner roll when multiple authorized clients are active", async () => {
        const assignedPlayer = { id: "player", active: true, isGM: false } as const;
        const otherOwner = { id: "other", active: true, isGM: false } as const;
        const gm = { id: "gm", active: true, isGM: true } as const;
        const roll = vi.fn(async ({ callback }) => {
            callback?.(ROLL, "success", null);
            return ROLL;
        });
        const actor = {
            testUserPermission: (user: { id: string }) => user.id === assignedPlayer.id || user.id === otherOwner.id,
            getStatistic: () => ({ check: { roll } }),
        };
        Object.assign(assignedPlayer, { character: actor });
        const target = { id: "target", uuid: "Scene.scene.Token.target", actor } as unknown as Sf2eTokenDocument;
        const message = createMessage(["target"]);
        message.canUserModify.mockReturnValue(true);
        Object.assign(globalThis, { game: { user: gm, users: [otherOwner, gm, assignedPlayer] } });

        await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target])).resolves.toBe(false);
        expect(roll).not.toHaveBeenCalled();

        Object.assign(globalThis, { game: { user: assignedPlayer, users: [otherOwner, gm, assignedPlayer] } });
        await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target])).resolves.toBe(true);
        expect(roll).toHaveBeenCalledOnce();
    });

    it("selects one active GM by stable ID when no active player owns the target", async () => {
        const first = { id: "gm-a", active: true, isGM: true } as const;
        const second = { id: "gm-b", active: true, isGM: true } as const;
        const roll = vi.fn();
        const target = createTarget("target", roll);
        const message = createMessage(["target"]);
        Object.assign(globalThis, { game: { user: second, users: [second, first] } });

        await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target])).resolves.toBe(false);
        expect(roll).not.toHaveBeenCalled();

        Object.assign(globalThis, { game: { user: first, users: [second, first] } });
        await rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target]);
        expect(roll).toHaveBeenCalledOnce();
    });

    it.each([
        ["cross-player target", (owner: { id: string }) => (user: { id: string }) => user.id === owner.id],
        ["player-authored NPC target", (_owner: { id: string }) => () => false],
    ])("falls back to the stable active GM for a %s when the non-owner author can update the card", async (_case, ownership) => {
        const author = { id: "a-author", active: true, isGM: false };
        const owner = { id: "z-owner", active: true, isGM: false };
        const gm = { id: "m-gm", active: true, isGM: true };
        const roll = vi.fn(async ({ callback }) => {
            callback?.(ROLL, "success", null);
            return ROLL;
        });
        const actor = {
            testUserPermission: ownership(owner),
            getStatistic: () => ({ check: { roll } }),
        };
        const target = { id: "target", uuid: "Scene.scene.Token.target", actor } as unknown as Sf2eTokenDocument;
        const message = createMessage(["target"]);
        message.canUserModify.mockImplementation((user: { id: string; isGM: boolean }) => user.id === author.id || user.isGM);

        for (const user of [author, owner]) {
            Object.assign(globalThis, { game: { user, users: [gm, owner, author] } });
            await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target])).resolves.toBe(false);
        }
        Object.assign(globalThis, { game: { user: gm, users: [gm, owner, author] } });
        await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target])).resolves.toBe(true);

        expect(roll).toHaveBeenCalledOnce();
        expect(message.update).toHaveBeenCalledOnce();
    });

    it("rolls a PRAD armor save with exact current AC minus 10 and trusted context", async () => {
        const rawRoll = vi.fn(async (_check: unknown, _context: unknown, _event: unknown, callback?: Sf2eRollCallback) => {
            callback?.(ROLL, "success", null);
            return ROLL;
        });
        class RawCheckModifier {
            modifiers: unknown[];
            constructor(_label: string, _statistic: unknown, modifiers: unknown[]) { this.modifiers = modifiers; }
        }
        class RawModifier { constructor(data: object) { Object.assign(this, data); } }
        const origin = {} as Sf2eActor;
        const item = { uuid: "Actor.npc.Item.laser", name: "Laser" };
        const actor = { armorClass: { value: 27 }, getStatistic: vi.fn() };
        const target = { id: "target", uuid: "Scene.scene.Token.target", actor } as unknown as Sf2eTokenDocument;
        const message = createMessage(["target"]);
        Object.assign(message, { actor: origin, item });
        Object.assign(message.flags["sf2e-forge-custom"].targetHelper, {
            type: "prad-attack",
            item: item.uuid,
            options: ["origin:item:trait:laser"],
            save: { statistic: "ac", dc: 20, basic: false },
        });
        Object.assign(globalThis, {
            game: {
                user: { isGM: true },
                users: new Map(),
                i18n: { localize: (key: string) => key },
                pf2e: { Check: { roll: rawRoll }, CheckModifier: RawCheckModifier, Modifier: RawModifier },
            },
        });

        await rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target]);

        expect(actor.getStatistic).not.toHaveBeenCalled();
        expect(rawRoll.mock.calls[0][0]).toMatchObject({ modifiers: [{ modifier: 17, type: "untyped" }] });
        expect(rawRoll.mock.calls[0][1]).toMatchObject({
            actor,
            token: target,
            item,
            origin: { actor: origin, item },
            target: { actor, token: target, item: null },
            options: new Set(["origin:item:trait:laser"]),
            createMessage: false,
        });
    });

    it("uses only finite contextual AC bound to the exact intercepted target", async () => {
        const rawRoll = vi.fn(async (_check: unknown, _context: unknown, _event: unknown, callback?: Sf2eRollCallback) => {
            callback?.(ROLL, "success", null);
            return ROLL;
        });
        class RawCheckModifier {
            modifiers: unknown[];
            constructor(_label: string, _statistic: unknown, modifiers: unknown[]) { this.modifiers = modifiers; }
        }
        class RawModifier { constructor(data: object) { Object.assign(this, data); } }
        const actor = { armorClass: { value: 27 }, getStatistic: vi.fn() };
        const target = { id: "target", uuid: "Scene.scene.Token.target", actor } as unknown as Sf2eTokenDocument;
        const origin = {};
        const originToken = { uuid: "Scene.scene.Token.npc", actor: origin };
        const item = { uuid: "Actor.npc.Item.laser", actor: origin, name: "Laser" };
        const message = createMessage(["target"]);
        Object.assign(message.flags["sf2e-forge-custom"].targetHelper, {
            type: "prad-attack",
            contextualTargetAc: { targetUuid: target.uuid, value: 33 },
            interceptedAttack: true,
            save: { statistic: "ac", dc: 20, basic: false },
            item: item.uuid,
            options: ["origin:item:trait:laser"],
        });
        Object.assign(message, { actor: origin, item, speaker: { scene: "scene", token: "npc" } });
        Object.assign(globalThis, {
            game: {
                user: { isGM: true },
                users: new Map(),
                i18n: { localize: (key: string) => key },
                pf2e: { Check: { roll: rawRoll }, CheckModifier: RawCheckModifier, Modifier: RawModifier },
            },
            fromUuidSync: (uuid: string) => uuid === originToken.uuid ? originToken : uuid === target.uuid ? target : null,
        });

        await rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target]);

        expect(rawRoll.mock.calls[0][0]).toMatchObject({ modifiers: [{ modifier: 23, type: "untyped" }] });
        expect(rawRoll.mock.calls[0][1]).toMatchObject({ origin: { actor: origin, token: originToken } });
    });

    it("does not persist a late save after the token ID is reassigned to another UUID", async () => {
        const message = createMessage(["shared"]);
        let complete!: () => void;
        const roll = vi.fn(({ callback }: { callback?: (roll: Roll, success: string, message: null) => void }) => new Promise<Roll>((resolve) => {
            complete = () => {
                callback?.(ROLL, "success", null);
                resolve(ROLL);
            };
        }));
        const target = createTarget("shared", roll, "Scene.scene.Token.shared");

        const pending = rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target]);
        message.flags["sf2e-forge-custom"].targetHelper.targets = ["Scene.reassigned.Token.shared"];
        complete();

        await expect(pending).resolves.toBe(false);
        expect(message.update).not.toHaveBeenCalled();
    });

    it("does not persist a late save after the old UUID is selected again at a newer generation", async () => {
        const message = createMessage(["shared"]);
        let complete!: () => void;
        const roll = vi.fn(({ callback }: { callback?: (roll: Roll, success: string, message: null) => void }) => new Promise<Roll>((resolve) => {
            complete = () => {
                callback?.(ROLL, "success", null);
                resolve(ROLL);
            };
        }));
        const target = createTarget("shared", roll);

        const pending = rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target]);
        message.flags["sf2e-forge-custom"].targetHelper.generation = 2;
        complete();

        await expect(pending).resolves.toBe(false);
        expect(message.update).not.toHaveBeenCalled();
    });

    it("does not persist a late save after reselection at a different revision with the same generation", async () => {
        const message = createMessage(["shared"]);
        let complete!: () => void;
        const roll = vi.fn(({ callback }: { callback?: (roll: Roll, success: string, message: null) => void }) => new Promise<Roll>((resolve) => {
            complete = () => {
                callback?.(ROLL, "success", null);
                resolve(ROLL);
            };
        }));
        const target = createTarget("shared", roll);

        const pending = rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target]);
        message.flags["sf2e-forge-custom"].targetHelper.revision = "22222222-2222-4222-8222-222222222222";
        complete();

        await expect(pending).resolves.toBe(false);
        expect(message.update).not.toHaveBeenCalled();
    });

    it("allows a reassigned token UUID to roll while the prior same-ID token is still in flight", async () => {
        const message = createMessage(["shared"]);
        let completeOriginal!: () => void;
        const originalRoll = vi.fn(({ callback }: { callback?: (roll: Roll, success: string, message: null) => void }) => new Promise<Roll>((resolve) => {
            completeOriginal = () => {
                callback?.(ROLL, "success", null);
                resolve(ROLL);
            };
        }));
        const replacementRoll = vi.fn(async ({ callback }: { callback?: (roll: Roll, success: string, message: null) => void }) => {
            callback?.(ROLL, "failure", null);
            return ROLL;
        });
        const original = createTarget("shared", originalRoll, "Scene.scene.Token.shared");
        const replacement = createTarget("shared", replacementRoll, "Scene.reassigned.Token.shared");

        const pendingOriginal = rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [original]);
        message.flags["sf2e-forge-custom"].targetHelper.targets = ["Scene.reassigned.Token.shared"];
        await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [replacement])).resolves.toBe(true);
        completeOriginal();

        await expect(pendingOriginal).resolves.toBe(false);
        expect(originalRoll).toHaveBeenCalledOnce();
        expect(replacementRoll).toHaveBeenCalledOnce();
        expect(message.update).toHaveBeenCalledOnce();
        expect(message.update).toHaveBeenCalledWith(expect.objectContaining({
            [`flags.sf2e-forge-custom.targetHelper.saves.${encodeTargetUuidSaveKey("Scene.reassigned.Token.shared", 0, REVISION)}`]: expect.objectContaining({ targetUuid: "Scene.reassigned.Token.shared" }),
        }));
    });

    it("records only the first native callback for an attempt", async () => {
        const message = createMessage(["duplicated"]);
        const duplicated = createTarget("duplicated", async ({ callback }) => {
            callback?.(ROLL, "success", null);
            callback?.(ROLL, "criticalFailure", null);
            return ROLL;
        });

        await rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [duplicated]);

        expect(message.update).toHaveBeenCalledWith(expect.objectContaining({
            [`flags.sf2e-forge-custom.targetHelper.saves.${encodeTargetUuidSaveKey("Scene.scene.Token.duplicated", 0, REVISION)}`]: expect.objectContaining({ success: "success" }),
        }));
    });

    it("rejects a target that is not an exact member of the card", async () => {
        const message = createMessage(["other"]);
        const roll = vi.fn();

        await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [createTarget("target", roll)])).resolves.toBe(false);
        expect(roll).not.toHaveBeenCalled();
    });

    it("does not roll ordinary saves for a PRAD overcome card", async () => {
        const message = createMessage(["target"], true);
        const roll = vi.fn();

        await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [createTarget("target", roll)])).resolves.toBe(false);
        expect(roll).not.toHaveBeenCalled();
    });

    it("rejects distinct target UUIDs with colliding embedded token IDs", async () => {
        const message = createMessage(["target"]);
        message.flags["sf2e-forge-custom"].targetHelper.targets.push("Scene.other.Token.target");
        const roll = vi.fn();

        await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [
            createTarget("target", roll),
            createTarget("target", roll, "Scene.other.Token.target"),
        ])).resolves.toBe(false);
        expect(roll).not.toHaveBeenCalled();
    });

    it("rejects a card with colliding resolved embedded token IDs before rolling a subset", async () => {
        const message = createMessage(["target"]);
        message.flags["sf2e-forge-custom"].targetHelper.targets.push("Scene.other.Token.target");
        const roll = vi.fn();
        const target = createTarget("target", roll);
        const collision = createTarget("target", roll, "Scene.other.Token.target");
        Object.assign(globalThis, { fromUuidSync: (uuid: string) => uuid === target.uuid ? target : collision });

        await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target])).resolves.toBe(false);
        expect(roll).not.toHaveBeenCalled();
    });

    it("keeps a token reserved until persistence settles", async () => {
        let settleUpdate!: () => void;
        const message = createMessage(["target"]);
        message.update.mockImplementation(() => new Promise<void>((resolve) => { settleUpdate = resolve; }));
        const roll = vi.fn(async ({ callback }: { callback?: (roll: Roll, success: string, message: null) => void }) => {
            callback?.(ROLL, "success", null);
            return ROLL;
        });
        const target = createTarget("target", roll);

        const first = rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target]);
        await Promise.resolve();
        await Promise.resolve();
        await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target])).resolves.toBe(false);
        settleUpdate();
        await first;

        expect(roll).toHaveBeenCalledOnce();
    });

    it("releases reservations after persistence rejects so a later roll can retry", async () => {
        const message = createMessage(["target"]);
        message.update.mockRejectedValueOnce(new Error("persistence failure")).mockResolvedValueOnce(undefined);
        const roll = vi.fn(async ({ callback }: { callback?: (roll: Roll, success: string, message: null) => void }) => {
            callback?.(ROLL, "success", null);
            return ROLL;
        });
        const target = createTarget("target", roll);

        await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target])).resolves.toBe(false);
        await expect(rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target])).resolves.toBe(true);

        expect(roll).toHaveBeenCalledTimes(2);
    });

    it("forwards the reconstructed chat-message item and extra roll options", async () => {
        const message = createMessage(["target"]);
        const item = { uuid: "Actor.caster.Item.spell" };
        Object.assign(message, { item });
        Object.assign(message.flags["sf2e-forge-custom"].targetHelper, { item: item.uuid, options: ["item:trait:incapacitation"] });
        const roll = vi.fn(async ({ callback }) => {
            callback?.(ROLL, "success", null);
            return ROLL;
        });

        await rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [createTarget("target", roll)]);

        expect(roll).toHaveBeenCalledWith(expect.objectContaining({ item, extraRollOptions: ["item:trait:incapacitation"] }));
    });

    it("omits a consumable weapon item while retaining validated extra roll options", async () => {
        const message = createMessage(["target"]);
        const item = {
            uuid: "Actor.caster.Item.grenade",
            isOfType: (type: string) => type === "weapon",
            traits: new Set(["consumable"]),
        };
        Object.assign(message, { item });
        Object.assign(message.flags["sf2e-forge-custom"].targetHelper, { item: item.uuid, options: ["item:trait:area"] });
        const roll = vi.fn(async ({ callback }) => {
            callback?.(ROLL, "success", null);
            return ROLL;
        });

        await rollSavesForTargets(EVENT, message as unknown as ChatMessage.Implementation, [createTarget("target", roll)]);

        expect(roll).toHaveBeenCalledWith(expect.objectContaining({ extraRollOptions: ["item:trait:area"] }));
        expect(roll.mock.calls[0][0]).not.toHaveProperty("item");
    });
});


describe("rollOvercomeForTargets", () => {
    let rawRoll: ReturnType<typeof vi.fn>;

    class RawCheckModifier {
        modifiers: unknown[];
        constructor(_label: string, statistic: { modifiers: unknown[] }, modifiers: unknown[]) {
            this.modifiers = [...statistic.modifiers, ...modifiers];
        }
    }

    function statistic(dc = 20) {
        const value = {
            dc: { value: dc },
            check: {
                modifiers: [{ label: "base", modifier: 8, type: "untyped" }],
                roll: vi.fn(),
                createRollOptions: vi.fn(({ extraRollOptions = [] }: { extraRollOptions?: string[] }) => new Set(extraRollOptions)),
            },
            withRollOptions: vi.fn(),
        };
        value.withRollOptions.mockReturnValue(value);
        return value;
    }

    beforeEach(() => {
        setDCBase(DC_BASE_DEFAULT);
        rawRoll = vi.fn(async (_check: unknown, _context: unknown, _event: unknown, callback?: Sf2eRollCallback) => {
            callback?.(ROLL, "success", null);
            return ROLL;
        });
        Object.assign(globalThis, {
            fromUuidSync: () => null,
            game: { user: { isGM: true }, users: new Map(), pf2e: { Check: { roll: rawRoll }, CheckModifier: RawCheckModifier } },
            ui: { notifications: { error: vi.fn(), warn: vi.fn() } },
        });
    });

    it.each([
        { base: DC_BASE_DEFAULT, expectedDC: 27 },
        { base: DC_BASE_STRICT, expectedDC: 28 },
    ])("binds a contextual NPC save modifier to the exact linked duplicate token using configured base $base", async ({ base, expectedDC }) => {
        setDCBase(base);
        const casterStatistic = statistic();
        const caster = { classDC: casterStatistic };
        const casterToken = { uuid: "Scene.scene.Token.caster", actor: caster };
        const contextualNpcStatistic = statistic(26);
        const npcStatistic = statistic(17);
        npcStatistic.withRollOptions.mockReturnValue(contextualNpcStatistic);
        const npcActor = { name: "NPC", getStatistic: vi.fn(() => npcStatistic) };
        const tokenA = { id: "a", uuid: "Scene.scene.Token.a", actor: npcActor } as unknown as Sf2eTokenDocument;
        const tokenB = { id: "b", uuid: "Scene.scene.Token.b", actor: npcActor } as unknown as Sf2eTokenDocument;
        const item = { uuid: "Actor.caster.Item.spell", actor: caster };
        const message = createMessage(["b"], true);
        Object.assign(message, { actor: caster, item, speaker: { scene: "scene", token: "caster" } });
        Object.assign(message.flags["sf2e-forge-custom"].targetHelper, { item: item.uuid, options: ["item:trait:mental"] });
        Object.assign(globalThis, { fromUuidSync: (uuid: string) => uuid === casterToken.uuid ? casterToken : uuid === tokenB.uuid ? tokenB : null });

        await rollOvercomeForTargets(EVENT, message as unknown as ChatMessage.Implementation, [tokenB]);

        expect(npcStatistic.withRollOptions).toHaveBeenCalledWith({ origin: caster, item, extraRollOptions: ["item:trait:mental"] });
        expect(rawRoll.mock.calls[0][1]).toMatchObject({
            actor: caster,
            token: casterToken,
            dc: { value: expectedDC },
            item,
            origin: { actor: caster, token: casterToken, item },
            target: { actor: npcActor, token: tokenB, statistic: contextualNpcStatistic },
            options: new Set(["item:trait:mental"]),
            identifier: `sf2e-forge-custom:target-helper-overcome:v1|parent|${tokenB.uuid}|0|${REVISION}`,
            createMessage: true,
        });
        expect(rawRoll.mock.calls[0][1].target.token).not.toBe(tokenA);
        expect(message.update).toHaveBeenCalledWith(expect.objectContaining({
            [`flags.sf2e-forge-custom.targetHelper.saves.${encodeTargetUuidSaveKey(tokenB.uuid, 0, REVISION)}`]: expect.objectContaining({ overcomeDc: expectedDC, targetUuid: tokenB.uuid }),
        }));
    });

    it("never passes or consumes a live consumable weapon across multiple contextual overcome checks", async () => {
        const casterStatistic = statistic();
        const caster = { classDC: casterStatistic };
        const npcStatistic = statistic(22);
        const npcActor = { name: "NPC", getStatistic: () => npcStatistic };
        const targets = ["a", "b"].map((id) => ({ id, uuid: `Scene.scene.Token.${id}`, actor: npcActor } as unknown as Sf2eTokenDocument));
        const consumable = { uuid: "Actor.caster.Item.grenade", actor: caster, quantity: 2, isOfType: (type: string) => type === "weapon", traits: new Set(["consumable"]) };
        const message = createMessage(["a", "b"], true);
        Object.assign(message, { actor: caster, item: consumable });
        Object.assign(message.flags["sf2e-forge-custom"].targetHelper, { item: consumable.uuid, options: ["item:trait:area"] });
        Object.assign(globalThis, {
            fromUuidSync: (uuid: string) => targets.find((target) => target.uuid === uuid) ?? null,
        });
        rawRoll.mockImplementation(async (_check: unknown, context: Record<string, unknown>, _event: unknown, callback?: Sf2eRollCallback) => {
            if (context.item === consumable) consumable.quantity -= 1;
            callback?.(ROLL, "success", null);
            return ROLL;
        });

        await rollOvercomeForTargets(EVENT, message as unknown as ChatMessage.Implementation, targets);

        expect(consumable.quantity).toBe(2);
        expect(rawRoll).toHaveBeenCalledTimes(2);
        const identifiers = rawRoll.mock.calls.map(([, context]) => context.identifier);
        expect(new Set(identifiers).size).toBe(2);
        expect(identifiers).toEqual(targets.map((target) => `sf2e-forge-custom:target-helper-overcome:v1|parent|${target.uuid}|0|${REVISION}`));
        for (const [, context] of rawRoll.mock.calls) {
            expect(context).not.toHaveProperty("item");
            expect(context).toMatchObject({ origin: { item: null }, options: new Set(["item:trait:area"]) });
            expect(context).toMatchObject({ createMessage: true });
        }
        expect(casterStatistic.withRollOptions).toHaveBeenCalledWith(expect.objectContaining({ item: consumable, extraRollOptions: ["item:trait:area"] }));
        expect(npcStatistic.withRollOptions).toHaveBeenCalledWith(expect.objectContaining({ item: consumable, extraRollOptions: ["item:trait:area"] }));
    });

    it("fails safely when the exact target TokenDocument cannot be resolved", async () => {
        const caster = { classDC: statistic() };
        const npcActor = { name: "NPC", getStatistic: () => statistic(22) };
        const requested = { id: "b", uuid: "Scene.scene.Token.b", actor: npcActor } as unknown as Sf2eTokenDocument;
        const wrong = { id: "a", uuid: "Scene.scene.Token.a", actor: npcActor } as unknown as Sf2eTokenDocument;
        const message = createMessage(["b"], true);
        Object.assign(message, { actor: caster });
        Object.assign(globalThis, { fromUuidSync: () => wrong });

        await expect(rollOvercomeForTargets(EVENT, message as unknown as ChatMessage.Implementation, [requested])).resolves.toBe(false);

        expect(rawRoll).not.toHaveBeenCalled();
        expect(message.update).not.toHaveBeenCalled();
    });

    it("selects the assigned active caster controller over other owners and GMs", async () => {
        const firstOwner = { id: "owner-a", active: true, isGM: false } as const;
        const assignedOwner = { id: "owner-z", active: true, isGM: false } as const;
        const gm = { id: "gm", active: true, isGM: true } as const;
        const caster = { classDC: statistic(), testUserPermission: (user: { id: string }) => user.id === firstOwner.id || user.id === assignedOwner.id };
        Object.assign(assignedOwner, { character: caster });
        const message = createMessage(["npc"], true);
        Object.assign(message.flags["sf2e-forge-custom"].targetHelper, { author: "Actor.caster" });
        const npcStatistic = statistic(17);
        const target = { id: "npc", uuid: "Scene.scene.Token.npc", actor: { name: "NPC", getStatistic: () => npcStatistic } } as unknown as Sf2eTokenDocument;
        Object.assign(globalThis, {
            fromUuidSync: (uuid: string) => uuid === "Actor.caster" ? caster : uuid === target.uuid ? target : null,
            game: { ...game, user: firstOwner, users: [gm, assignedOwner, firstOwner] },
        });

        await expect(rollOvercomeForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target])).resolves.toBe(false);
        expect(rawRoll).not.toHaveBeenCalled();

        Object.assign(globalThis, { game: { ...game, user: assignedOwner, users: [gm, assignedOwner, firstOwner] } });
        await rollOvercomeForTargets(EVENT, message as unknown as ChatMessage.Implementation, [target]);
        expect(rawRoll).toHaveBeenCalledOnce();
    });
});

describe("native linked Overcome rerolls", () => {
    const targetUuid = "Scene.scene.Token.target";
    const saveKey = encodeTargetUuidSaveKey(targetUuid, 0, REVISION);

    function linkedIdentifier(uuid = targetUuid, generation = 0): string {
        return `sf2e-forge-custom:target-helper-overcome:v1|parent|${uuid}|${generation}|${REVISION}`;
    }

    function linkedRoll(identifier: string, total = 30, die = 10): Roll {
        return {
            total,
            options: { identifier },
            dice: [{
                number: 1,
                faces: 20,
                results: [{ active: false, result: 3 }, { active: true, result: die }],
            }],
        } as unknown as Roll;
    }

    function createLinkedParent() {
        const caster = {};
        const message = createMessage(["target"], true);
        Object.assign(message, { actor: caster });
        message.flags["sf2e-forge-custom"].targetHelper.saves = {
            [saveKey]: {
                value: 17,
                die: 2,
                success: "failure",
                modifiers: [{ label: "base", modifier: 15 }],
                private: false,
                statistic: "reflex",
                targetUuid,
                generation: 0,
                revision: REVISION,
                overcomeDc: 20,
                overcomeSuccess: "success",
            },
        } as never;
        const user = { id: "gm", active: true, isGM: true };
        Object.assign(globalThis, {
            game: { user, users: [user], messages: new Map([["parent", message]]) },
        });
        return message;
    }

    it("updates the exact inline target from the replacement total and active Heroic-floor-compatible d20", async () => {
        const message = createLinkedParent();
        const identifier = linkedIdentifier();

        onTargetHelperReroll(linkedRoll(identifier, 17, 2), linkedRoll(identifier, 30, 10));

        await vi.waitFor(() => expect(message.update).toHaveBeenCalledOnce());
        expect(message.update).toHaveBeenCalledWith({
            [`flags.sf2e-forge-custom.targetHelper.saves.${saveKey}`]: {
                value: 30,
                die: 10,
                success: "criticalFailure",
                modifiers: [{ label: "base", modifier: 15 }],
                private: false,
                statistic: "reflex",
                targetUuid,
                generation: 0,
                revision: REVISION,
                overcomeDc: 20,
                overcomeSuccess: "criticalSuccess",
            },
        });
    });

    it.each([
        { name: "unrelated", configure: (_message: ReturnType<typeof createMessage>) => "another-module:roll" },
        { name: "malformed", configure: (_message: ReturnType<typeof createMessage>) => `${linkedIdentifier()}|extra` },
        { name: "stale", configure: (_message: ReturnType<typeof createMessage>) => linkedIdentifier(targetUuid, 1) },
        { name: "wrong-target", configure: (_message: ReturnType<typeof createMessage>) => linkedIdentifier("Scene.scene.Token.other") },
        { name: "private", configure: (message: ReturnType<typeof createMessage>) => {
            message.flags["sf2e-forge-custom"].targetHelper.saves = {
                [saveKey]: { private: true, statistic: "reflex", targetUuid, generation: 0, revision: REVISION },
            } as never;
            return linkedIdentifier();
        } },
        { name: "invalid-current-flags", configure: (message: ReturnType<typeof createMessage>) => {
            message.flags["sf2e-forge-custom"].targetHelper.revision = "invalid";
            return linkedIdentifier();
        } },
        { name: "no-authority", configure: (message: ReturnType<typeof createMessage>) => {
            message.isAuthor = false;
            const user = { id: "player", active: true, isGM: false };
            Object.assign(globalThis, { game: { ...game, user, users: [user] } });
            return linkedIdentifier();
        } },
        { name: "no-parent-update-permission", configure: (message: ReturnType<typeof createMessage>) => {
            message.canUserModify.mockReturnValue(false);
            return linkedIdentifier();
        } },
    ])("ignores $name rerolls", async ({ configure }) => {
        const message = createLinkedParent();
        const identifier = configure(message);

        onTargetHelperReroll(linkedRoll(identifier, 17, 2), linkedRoll(identifier, 30, 10));
        await Promise.resolve();
        await Promise.resolve();

        expect(message.update).not.toHaveBeenCalled();
    });

    it("logs a parent persistence failure without throwing into PF2e", async () => {
        const message = createLinkedParent();
        const error = new Error("persistence failed");
        message.update.mockRejectedValue(error);
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const identifier = linkedIdentifier();

        expect(() => onTargetHelperReroll(linkedRoll(identifier, 17, 2), linkedRoll(identifier, 30, 10))).not.toThrow();

        await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(
            "sf2e-forge-custom | PRAD Overcome: Unable to persist native reroll result",
            error,
        ));
        consoleError.mockRestore();
    });
});
