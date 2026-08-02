import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
    classifyInterceptedAttack,
    getAttackCardTargetUUIDs,
    getCardArmorSaveTargets,
    postAttackCard,
    registerAttackInterceptHook,
    rollArmorSavesForTargets,
    rollAttackCardArmorSaves,
    resolveAttackCardProvenance,
    rollWeaponDamage,
    resolveNativeDamageTarget,
} from "../../../src/rulesets/sf2e/prad/intercept-attack.js";
import { createPradChatMessage } from "../../../src/rulesets/sf2e/prad/chat-cards.js";
import { getPreparedStrikeVariantDC, onRenderNpcSheet } from "../../../src/rulesets/sf2e/prad/npc-sheet.js";

const REVISION = "11111111-1111-4111-8111-111111111111";
const weapon = { id: "laser", uuid: "Actor.npc.Item.laser", name: "Laser", type: "melee", system: { bonus: { value: 7 } }, getOriginData: () => ({ rollOptions: ["origin:item:trait:laser"] }) };
const character = { id: "pc", type: "character" };
const targetToken = { actor: character, uuid: "Scene.scene.Token.pc", document: { uuid: "Scene.scene.Token.pc" } };
const attacker = {
    id: "npc",
    uuid: "Actor.npc",
    name: "Alien",
    type: "npc",
    items: { get: (id: string) => id === weapon.id ? weapon : undefined },
};
const nativeAttackerToken = { id: "npc-token", uuid: "Scene.scene.Token.npc-token", actor: attacker };

class RawCheckModifier {
    modifiers: unknown[];
    constructor(_label: string, _statistic: unknown, modifiers: unknown[]) { this.modifiers = modifiers; }
}
class RawModifier { constructor(data: object) { Object.assign(this, data); } }
let rawRoll: ReturnType<typeof vi.fn>;

function attackCardMessage(weaponItemId = weapon.id) {
    return {
        author: { isGM: true },
        flags: {
            "sf2e-forge-custom": {
                pradType: "attack-card",
                attackDC: 20,
                attackerId: attacker.id,
                weaponItemId,
                targetHelper: {
                    type: "prad-attack",
                    targets: [targetToken.uuid],
                    generation: 0,
                    revision: REVISION,
                    save: { statistic: "ac", dc: 20, basic: false },
                    author: attacker.uuid,
                    item: weapon.uuid,
                    options: ["origin:item:trait:laser"],
                },
            },
        },
    };
}

function attackMessage() {
    return {
        flags: {
            sf2e: {
                context: { type: "attack-roll", dc: { value: 28 }, target: { token: targetToken.uuid } },
                origin: { uuid: "Actor.npc.Item.laser", rollOptions: ["origin:item:trait:laser", "action:slug:strike"] },
                modifiers: [{ label: "attack", modifier: 9, type: "untyped", enabled: true }],
            },
        },
        speaker: { actor: attacker.id, scene: "scene", token: "npc-token" },
        rolls: [],
        toObject: () => ({ content: "original" }),
    };
}

beforeEach(() => {
    vi.restoreAllMocks();
    rawRoll = vi.fn().mockResolvedValue({ uuid: "ChatMessage.armor" });
    Object.assign(globalThis, {
        game: {
            user: { isGM: true, targets: new Set([targetToken]) },
            actors: { get: (id: string) => id === attacker.id ? attacker : undefined },
            i18n: { localize: (key: string) => key, format: (key: string) => key },
            pf2e: { Check: { roll: rawRoll }, CheckModifier: RawCheckModifier, Modifier: RawModifier },
        },
        fromUuidSync: (uuid: string) => uuid === nativeAttackerToken.uuid ? nativeAttackerToken : uuid === targetToken.uuid ? targetToken : uuid === "Actor.npc.Item.laser" ? weapon : null,
        ui: { notifications: { error: vi.fn(), warn: vi.fn() } },
        canvas: { tokens: { get: () => undefined } },
    });
});

describe("classifyInterceptedAttack", () => {
    it("uses SF2e origin.uuid and preserves the authoritative target token UUID", () => {
        expect(classifyInterceptedAttack(attackMessage() as never)).toMatchObject({
            attacker,
            weaponItem: weapon,
            attackDC: 20,
            targetTokenUUIDs: [targetToken.uuid],
            attackerTokenUUID: nativeAttackerToken.uuid,
            weaponRollOptions: ["origin:item:trait:laser", "action:slug:strike"],
            contextualTargetAc: { targetUuid: targetToken.uuid, value: 28 },
            interceptedAttack: true,
        });
    });

    it("leaves attacks untouched when origin.uuid does not resolve to an attacker-owned item", () => {
        const message = attackMessage();
        message.flags.sf2e.origin.uuid = "Actor.other.Item.laser";
        expect(classifyInterceptedAttack(message as never)).toBeUndefined();
    });

    it("leaves attacks untouched when origin.uuid resolves to an attacker-owned non-strike item", () => {
        const nonStrikeItem = { ...weapon, type: "effect" };
        const attackerWithNonStrike = { ...attacker, items: { get: (id: string) => id === nonStrikeItem.id ? nonStrikeItem : undefined } };
        const message = attackMessage();
        Object.assign(globalThis, {
            game: { ...game, actors: { get: (id: string) => id === attacker.id ? attackerWithNonStrike : undefined } },
            fromUuidSync: (uuid: string) => uuid === nativeAttackerToken.uuid ? { ...nativeAttackerToken, actor: attackerWithNonStrike } : uuid === targetToken.uuid ? targetToken : nonStrikeItem,
        });
        expect(classifyInterceptedAttack(message as never)).toBeUndefined();
    });

    it.each([
        ["whispered", { whisper: ["gm"] }],
        ["blind", { blind: true }],
    ])("leaves %s native attacks untouched", (_label, visibility) => {
        expect(classifyInterceptedAttack(Object.assign(attackMessage(), visibility) as never)).toBeUndefined();
    });

    it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])("leaves attacks without a finite resolved contextual target AC untouched", (value) => {
        const message = attackMessage();
        if (value === undefined) delete (message.flags.sf2e.context as { dc?: unknown }).dc;
        else message.flags.sf2e.context.dc.value = value;
        expect(classifyInterceptedAttack(message as never)).toBeUndefined();
    });

    it("leaves attacks without an exact resolvable attacker token untouched", () => {
        const message = attackMessage();
        delete (message.speaker as { scene?: string }).scene;
        expect(classifyInterceptedAttack(message as never)).toBeUndefined();
    });
});

    it("resolves an unlinked NPC attacker through exact origin token provenance", () => {
        const syntheticAttacker = { ...attacker, uuid: "Scene.scene.Token.npc-token.Actor.npc" };
        const attackerToken = { id: "npc-token", uuid: "Scene.scene.Token.npc-token", actor: syntheticAttacker };
        const message = attackMessage();
        Object.assign(message.flags.sf2e.context, { origin: { token: attackerToken.uuid } });
        Object.assign(globalThis, {
            game: { ...game, actors: { get: () => attacker } },
            fromUuidSync: (uuid: string) => uuid === attackerToken.uuid ? attackerToken : uuid === targetToken.uuid ? targetToken : weapon,
        });

        expect(classifyInterceptedAttack(message as never)).toMatchObject({
            attacker: syntheticAttacker,
            attackerTokenUUID: attackerToken.uuid,
            weaponItem: weapon,
        });
    });

describe("getAttackCardTargetUUIDs", () => {
    it("does not resnapshot ambient targets when intercepted targets were supplied", () => {
        expect(getAttackCardTargetUUIDs(["Scene.original.Token.pc"])).toEqual(["Scene.original.Token.pc"]);
    });

    it("rejects missing explicit targets instead of snapshotting ambient state", () => {
        expect(() => getAttackCardTargetUUIDs(undefined as never)).toThrow("explicit bounded target Token UUID array");
    });

    it.each([
        "Scene.scene.Token",
        "Scene.scene.Token.pc.Actor.actor",
        "Actor.actor.Token.pc",
        "Garbage.value.Token.pc",
    ])("rejects malformed token UUID %s", (uuid) => {
        expect(() => getAttackCardTargetUUIDs([uuid])).toThrow("explicit bounded target Token UUID array");
    });
});

describe("registerAttackInterceptHook", () => {
    it("registers the Foundry V14 HTML chat render hook", () => {
        const on = vi.fn();
        Object.assign(globalThis, { Hooks: { on } });

        registerAttackInterceptHook();

        expect(on).toHaveBeenCalledWith("renderChatMessageHTML", expect.any(Function));
    });
});

    it("does not bind armor-save actions on a non-GM forged card", () => {
        const on = vi.fn();
        const addEventListener = vi.fn();
        const button = { dataset: {}, addEventListener };
        class FakeElement {
            querySelector = (selector: string) => selector.includes("prad-armor-save") ? button : null;
        }
        Object.assign(globalThis, { Hooks: { on }, HTMLElement: FakeElement });
        registerAttackInterceptHook();
        const renderHook = on.mock.calls.find(([name]) => name === "renderChatMessageHTML")?.[1] as ((message: ChatMessage.Implementation, html: HTMLElement, data: object) => void) | undefined;
        const forged = attackCardMessage();
        forged.author.isGM = false;

        renderHook?.(forged as unknown as ChatMessage.Implementation, new FakeElement() as unknown as HTMLElement, {});

        expect(addEventListener).not.toHaveBeenCalled();
    });

    it("lets the exact active player owner execute a GM-authored create-message-only armor save", async () => {
        const on = vi.fn();
        const owner = { id: "player-owner", active: true, isGM: false };
        const gm = { id: "gm", active: true, isGM: true };
        const ownedActor = { armorClass: { value: 24 }, testUserPermission: (user: { id?: string }) => user.id === owner.id };
        const authorized = { uuid: targetToken.uuid, isOwner: true, actor: ownedActor };
        let listener: ((event: { preventDefault(): void; stopPropagation(): void }) => void) | undefined;
        const button = { dataset: { dc: "999", weapon: "Forged", attackerId: "forged" }, addEventListener: (_type: string, callback: typeof listener) => { listener = callback; } };
        class FakeElement {
            querySelector = (selector: string) => selector.includes("prad-armor-save") ? button : null;
        }
        const message = Object.assign(attackCardMessage(), { canUserModify: vi.fn().mockReturnValue(false) });
        Object.assign(globalThis, {
            Hooks: { on },
            HTMLElement: FakeElement,
            fromUuidSync: (uuid: string) => uuid === targetToken.uuid ? authorized : uuid === "Actor.npc.Item.laser" ? weapon : null,
            game: { ...game, user: { ...owner, getActiveTokens: () => [{ document: authorized }] }, users: [gm, owner] },
        });
        registerAttackInterceptHook();
        const renderHook = on.mock.calls.find(([name]) => name === "renderChatMessageHTML")?.[1] as ((message: ChatMessage.Implementation, html: HTMLElement, data: object) => void) | undefined;

        renderHook?.(message as unknown as ChatMessage.Implementation, new FakeElement() as unknown as HTMLElement, {});
        listener?.({ preventDefault() {}, stopPropagation() {} });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(rawRoll.mock.calls[0][1]).toMatchObject({ dc: { value: 20, label: "Laser" }, origin: { actor: attacker } });
    });

    it("does not let a non-target player execute a GM-authored armor save", async () => {
        const on = vi.fn();
        const wrongPlayer = { id: "wrong-player", active: true, isGM: false };
        const owner = { id: "player-owner", active: true, isGM: false };
        const gm = { id: "gm", active: true, isGM: true };
        const ownedActor = { armorClass: { value: 24 }, testUserPermission: (user: { id?: string }) => user.id === owner.id };
        const unauthorized = { uuid: targetToken.uuid, isOwner: false, actor: ownedActor };
        let listener: ((event: { preventDefault(): void; stopPropagation(): void }) => void) | undefined;
        const button = { dataset: {}, addEventListener: (_type: string, callback: typeof listener) => { listener = callback; } };
        class FakeElement {
            querySelector = (selector: string) => selector.includes("prad-armor-save") ? button : null;
        }
        Object.assign(globalThis, {
            Hooks: { on },
            HTMLElement: FakeElement,
            fromUuidSync: (uuid: string) => uuid === targetToken.uuid ? unauthorized : uuid === weapon.uuid ? weapon : null,
            game: { ...game, user: { ...wrongPlayer, getActiveTokens: () => [{ document: unauthorized }] }, users: [gm, owner, wrongPlayer] },
        });
        registerAttackInterceptHook();
        const renderHook = on.mock.calls.find(([name]) => name === "renderChatMessageHTML")?.[1] as ((message: ChatMessage.Implementation, html: HTMLElement, data: object) => void) | undefined;

        renderHook?.(attackCardMessage() as unknown as ChatMessage.Implementation, new FakeElement() as unknown as HTMLElement, {});
        listener?.({ preventDefault() {}, stopPropagation() {} });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(rawRoll).not.toHaveBeenCalled();
    });

    it("uses only the stable first active GM on the UI path when no player owner is active", async () => {
        const on = vi.fn();
        const first = { id: "gm-a", active: true, isGM: true };
        const second = { id: "gm-b", active: true, isGM: true };
        const authorized = { uuid: targetToken.uuid, actor: { armorClass: { value: 24 } } };
        let listener: ((event: { preventDefault(): void; stopPropagation(): void }) => void) | undefined;
        const button = { dataset: {}, addEventListener: (_type: string, callback: typeof listener) => { listener = callback; } };
        class FakeElement {
            querySelector = (selector: string) => selector.includes("prad-armor-save") ? button : null;
        }
        const activeToken = () => [{ document: authorized }];
        Object.assign(globalThis, {
            Hooks: { on },
            HTMLElement: FakeElement,
            fromUuidSync: (uuid: string) => uuid === targetToken.uuid ? authorized : uuid === weapon.uuid ? weapon : null,
            game: { ...game, user: { ...second, getActiveTokens: activeToken }, users: [second, first] },
        });
        registerAttackInterceptHook();
        const renderHook = on.mock.calls.find(([name]) => name === "renderChatMessageHTML")?.[1] as ((message: ChatMessage.Implementation, html: HTMLElement, data: object) => void) | undefined;

        renderHook?.(attackCardMessage() as unknown as ChatMessage.Implementation, new FakeElement() as unknown as HTMLElement, {});
        listener?.({ preventDefault() {}, stopPropagation() {} });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(rawRoll).not.toHaveBeenCalled();

        Object.assign(globalThis, { game: { ...game, user: { ...first, getActiveTokens: activeToken }, users: [second, first] } });
        listener?.({ preventDefault() {}, stopPropagation() {} });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(rawRoll).toHaveBeenCalledOnce();
    });

describe("intercepted attack transaction", () => {
    it("restores the original exactly once when replacement creation fails", async () => {
        let preCreate: ((message: ReturnType<typeof attackMessage>, data: object, options: Record<string, unknown>, userId: string) => boolean | void) | undefined;
        Object.assign(globalThis, {
            Hooks: { on: (name: string, callback: typeof preCreate) => { if (name === "preCreateChatMessage") preCreate = callback; } },
            foundry: { applications: { handlebars: { renderTemplate: vi.fn().mockRejectedValue(new Error("template failed")) } } },
            ChatMessage: { create: vi.fn().mockResolvedValue({ id: "restored" }) },
        });
        registerAttackInterceptHook();

        expect(preCreate?.(attackMessage(), {}, {}, "gm")).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(ChatMessage.create).toHaveBeenCalledTimes(1);
        expect(ChatMessage.create).toHaveBeenCalledWith({ content: "original" }, { pradRestoreOriginal: true });
    });


    it("restores the original exactly once when the intercepted target cannot be public", async () => {
        let preCreate: ((message: ReturnType<typeof attackMessage>, data: object, options: Record<string, unknown>, userId: string) => boolean | void) | undefined;
        const message = attackMessage();
        const hiddenTarget = { ...targetToken, hidden: true };
        Object.assign(globalThis, {
            Hooks: { on: (name: string, callback: typeof preCreate) => { if (name === "preCreateChatMessage") preCreate = callback; } },
            fromUuidSync: (uuid: string) => uuid === nativeAttackerToken.uuid ? nativeAttackerToken : uuid === targetToken.uuid ? hiddenTarget : uuid === weapon.uuid ? weapon : null,
            ChatMessage: { create: vi.fn().mockResolvedValue({ id: "restored" }) },
        });
        registerAttackInterceptHook();

        expect(preCreate?.(message, {}, {}, "gm")).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(ChatMessage.create).toHaveBeenCalledTimes(1);
        expect(ChatMessage.create).toHaveBeenCalledWith({ content: "original" }, { pradRestoreOriginal: true });
    });
    it.each([
        ["private", { whisper: ["gm"] }],
        ["blind", { blind: true }],
    ])("does not cancel or replace a %s native attack", (_label, visibility) => {
        let preCreate: ((message: ReturnType<typeof attackMessage>, data: object, options: Record<string, unknown>, userId: string) => boolean | void) | undefined;
        const create = vi.fn();
        Object.assign(globalThis, {
            Hooks: { on: (name: string, callback: typeof preCreate) => { if (name === "preCreateChatMessage") preCreate = callback; } },
            ChatMessage: { create },
        });
        registerAttackInterceptHook();

        expect(preCreate?.(Object.assign(attackMessage(), visibility), {}, {}, "gm")).toBeUndefined();
        expect(create).not.toHaveBeenCalled();
    });

    it("inverts concurrent NPC attacks independently", async () => {
        let preCreate: ((message: ReturnType<typeof attackMessage>, data: object, options: Record<string, unknown>, userId: string) => boolean | void) | undefined;
        Object.assign(globalThis, {
            Hooks: { on: (name: string, callback: typeof preCreate) => { if (name === "preCreateChatMessage") preCreate = callback; } },
            foundry: { applications: { handlebars: { renderTemplate: vi.fn().mockResolvedValue("replacement") } } },
            ChatMessage: { create: vi.fn().mockResolvedValue({ uuid: "ChatMessage.replacement" }) },
        });
        registerAttackInterceptHook();

        expect(preCreate?.(attackMessage(), {}, {}, "gm")).toBe(false);
        expect(preCreate?.(attackMessage(), {}, {}, "gm")).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(ChatMessage.create).toHaveBeenCalledTimes(2);
    });
});


describe("postAttackCard", () => {
    it("posts the exact explicit targets and returns the created message UUID", async () => {
        const create = vi.fn().mockResolvedValue({ uuid: "ChatMessage.created" });
        Object.assign(globalThis, {
            foundry: { applications: { handlebars: { renderTemplate: vi.fn().mockResolvedValue("replacement") } } },
            ChatMessage: { create },
        });

        await expect(postAttackCard({
            attacker: attacker as never,
            attackDC: 20,
            weaponItem: weapon as never,
            targetTokenUUIDs: [targetToken.uuid],
        })).resolves.toBe("ChatMessage.created");

        expect(create.mock.calls[0][0].flags["sf2e-forge-custom"].targetHelper.targets).toEqual([targetToken.uuid]);
        expect(create.mock.calls[0][0].flags["sf2e-forge-custom"].targetHelper.generation).toBe(0);
        expect(create.mock.calls[0][0].flags["sf2e-forge-custom"].targetHelper.revision).toMatch(/^[0-9a-f-]{36}$/);
        expect(create.mock.calls[0][0].flags["sf2e-forge-custom"].targetHelper.item).toBe(weapon.uuid);
        expect(create.mock.calls[0][0].flags["sf2e-forge-custom"].targetHelper.options).toEqual(["origin:item:trait:laser"]);
    });

    it("persists trusted contextual AC bound to its exact intercepted target", async () => {
        const create = vi.fn().mockResolvedValue({ uuid: "ChatMessage.created" });
        Object.assign(globalThis, {
            foundry: { applications: { handlebars: { renderTemplate: vi.fn().mockResolvedValue("replacement") } } },
            ChatMessage: { create },
        });

        await postAttackCard({
            attacker: attacker as never,
            attackDC: 20,
            weaponItem: weapon as never,
            attackerTokenUUID: nativeAttackerToken.uuid,
            targetTokenUUIDs: [targetToken.uuid],
            contextualTargetAc: { targetUuid: targetToken.uuid, value: 31 },
            interceptedAttack: true,
        });

        expect(create.mock.calls[0][0].flags["sf2e-forge-custom"].targetHelper.contextualTargetAc).toEqual({ targetUuid: targetToken.uuid, value: 31 });
        expect(create.mock.calls[0][0].flags["sf2e-forge-custom"].targetHelper.interceptedAttack).toBe(true);
    });

    it("rejects an attacker-owned non-strike item", async () => {
        const nonStrikeItem = { ...weapon, type: "effect" };
        const attackerWithNonStrike = { ...attacker, items: { get: (id: string) => id === nonStrikeItem.id ? nonStrikeItem : undefined } };
        Object.assign(globalThis, { game: { ...game, actors: { get: (id: string) => id === attacker.id ? attackerWithNonStrike : undefined } } });
        await expect(postAttackCard({
            attacker: attackerWithNonStrike as never,
            attackDC: 20,
            weaponItem: nonStrikeItem as never,
            targetTokenUUIDs: [targetToken.uuid],
        })).rejects.toThrow("attacker-owned NPC strike item");
    });

    it("persists and later resolves exact unlinked NPC token provenance", async () => {
        const create = vi.fn().mockResolvedValue({ uuid: "ChatMessage.created" });
        const damage = vi.fn();
        const syntheticAttacker = { ...attacker, uuid: "Scene.scene.Token.npc-token.Actor.npc", system: { actions: [{ item: weapon, damage }] } };
        const attackerToken = { id: "npc-token", uuid: "Scene.scene.Token.npc-token", actor: syntheticAttacker };
        Object.assign(globalThis, {
            foundry: { applications: { handlebars: { renderTemplate: vi.fn().mockResolvedValue("replacement") } } },
            ChatMessage: { create },
            game: { ...game, actors: { get: () => attacker } },
            fromUuidSync: (uuid: string) => uuid === attackerToken.uuid ? attackerToken : uuid === targetToken.uuid ? targetToken : null,
        });

        await postAttackCard({
            attacker: syntheticAttacker as never,
            attackerTokenUUID: attackerToken.uuid,
            attackDC: 20,
            weaponItem: weapon as never,
            targetTokenUUIDs: [targetToken.uuid],
        });
        const createdData = create.mock.calls[0][0];
        const createdMessage = { author: { isGM: true }, flags: createdData.flags };

        expect(createdData.flags["sf2e-forge-custom"].attackerTokenUUID).toBe(attackerToken.uuid);
        expect(resolveAttackCardProvenance(createdMessage as never)?.attacker).toBe(syntheticAttacker);
        expect(resolveAttackCardProvenance(createdMessage as never)?.attackerToken).toBe(attackerToken);
    });

    it("rejects the whole card when any explicit target is private", async () => {
        const create = vi.fn().mockResolvedValue({ uuid: "ChatMessage.created" });
        const hiddenTarget = { ...targetToken, uuid: "Scene.scene.Token.hidden", hidden: true };
        const unnoticedTarget = { ...targetToken, uuid: "Scene.scene.Token.unnoticed", actor: { ...character, hasCondition: () => true } };
        Object.assign(globalThis, {
            foundry: { applications: { handlebars: { renderTemplate: vi.fn().mockResolvedValue("replacement") } } },
            ChatMessage: { create },
            fromUuidSync: (uuid: string) => uuid === targetToken.uuid ? targetToken : uuid === hiddenTarget.uuid ? hiddenTarget : uuid === unnoticedTarget.uuid ? unnoticedTarget : null,
        });

        await expect(postAttackCard({ attacker: attacker as never, attackDC: 20, weaponItem: weapon as never, targetTokenUUIDs: [targetToken.uuid, hiddenTarget.uuid, unnoticedTarget.uuid] })).rejects.toThrow("cannot include private targets");

        expect(create).not.toHaveBeenCalled();
    });
});

describe("NPC sheet adapter", () => {
    it("snapshots ambient GM targets before calling the core attack-card API", () => {
        const source = readFileSync(new URL("../../../src/rulesets/sf2e/prad/npc-sheet.ts", import.meta.url), "utf8");

        expect(source).toContain("const attackerTokenUUID =");
        expect(source).toContain("postAttackCard({ attacker, attackDC, attackerTokenUUID, weaponItem, targetTokenUUIDs })");
    });
});

    it("derives non-English MAP labels from prepared variant indexes 1 and 2", () => {
        const listeners = [vi.fn(), vi.fn()];
        const buttons = [1, 2].map((variantIndex, index) => ({
            dataset: { variantIndex: String(variantIndex) },
            textContent: index === 0 ? "+6 (Mehrfachangriff -5)" : "+1 (Mehrfachangriff -10)",
            classList: { add: vi.fn() },
            addEventListener: listeners[index],
        }));
        const entry = {
            classList: { contains: () => false, add: vi.fn() },
            querySelectorAll: (selector: string) => selector.includes("strike-attack") ? buttons : [],
        };
        class FakeElement {
            querySelectorAll = (selector: string) => selector === `[data-item-id="${weapon.id}"]` ? [entry] : [];
        }
        const preparedAttacker = {
            ...attacker,
            system: {
                actions: [{ type: "strike", item: weapon, totalModifier: 11, variants: [{ penalty: 0 }, { penalty: -5 }, { penalty: -10 }] }],
            },
            items: { contents: [weapon] },
        };
        Object.assign(globalThis, { HTMLElement: FakeElement });

        onRenderNpcSheet({ actor: preparedAttacker } as never, new FakeElement() as unknown as HTMLElement, {});

        expect(buttons.map((button) => button.textContent)).toEqual(["DC 17", "DC 12"]);
        expect(listeners[0]).toHaveBeenCalledOnce();
        expect(listeners[1]).toHaveBeenCalledOnce();
    });

    it("does not intercept a button whose structured variant cannot resolve", () => {
        const listener = vi.fn();
        const button = {
            dataset: { variantIndex: "2" },
            textContent: "+1 (Mehrfachangriff -10)",
            classList: { add: vi.fn() },
            addEventListener: listener,
        };
        const entry = {
            classList: { contains: () => false, add: vi.fn() },
            querySelectorAll: (selector: string) => selector.includes("strike-attack") ? [button] : [],
        };
        class FakeElement {
            querySelectorAll = (selector: string) => selector === `[data-item-id="${weapon.id}"]` ? [entry] : [];
        }
        const unpreparedAttacker = { ...attacker, system: { actions: [] }, items: { contents: [weapon] } };
        Object.assign(globalThis, { HTMLElement: FakeElement });

        expect(getPreparedStrikeVariantDC(unpreparedAttacker as never, weapon as never, 2)).toBeUndefined();
        onRenderNpcSheet({ actor: unpreparedAttacker } as never, new FakeElement() as unknown as HTMLElement, {});

        expect(button.textContent).toBe("+1 (Mehrfachangriff -10)");
        expect(listener).not.toHaveBeenCalled();
    });

describe("DOM armor-save adapter", () => {
    const message = attackCardMessage() as unknown as ChatMessage.Implementation;

    it("snapshots active tokens and intersects them with card-authorized targets", () => {
        const authorized = { ...targetToken, isOwner: true };
        const outside = { actor: character, uuid: "Scene.scene.Token.outside", isOwner: true };
        Object.assign(globalThis, {
            game: { ...game, user: { isGM: false, getActiveTokens: () => [{ document: outside }, { document: authorized }] } },
        });

        expect(getCardArmorSaveTargets(message)).toEqual([authorized]);
    });

    it("rejects an otherwise convincing non-GM forged card", () => {
        const forged = attackCardMessage();
        forged.author.isGM = false;
        expect(getCardArmorSaveTargets(forged as unknown as ChatMessage.Implementation)).toEqual([]);
    });

    it("ignores mutable DOM-style data because provenance comes from persisted flags", () => {
        const forgedFlags = attackCardMessage();
        forgedFlags.flags["sf2e-forge-custom"].attackDC = 999;
        expect(getCardArmorSaveTargets(forgedFlags as unknown as ChatMessage.Implementation)).toEqual([]);
    });


    it("rejects armor provenance whose exact weapon UUID or roll options are missing", () => {
        const wrongItem = attackCardMessage();
        wrongItem.flags["sf2e-forge-custom"].targetHelper.item = "Actor.npc.Item.other";
        const missingOptions = attackCardMessage();
        delete (missingOptions.flags["sf2e-forge-custom"].targetHelper as { options?: string[] }).options;

        expect(resolveAttackCardProvenance(wrongItem as never)).toBeUndefined();
        expect(resolveAttackCardProvenance(missingOptions as never)).toBeUndefined();

        const forgedAc = attackCardMessage();
        Object.assign(forgedAc.flags["sf2e-forge-custom"].targetHelper, { contextualTargetAc: { targetUuid: "Scene.scene.Token.other", value: 99 } });
        expect(resolveAttackCardProvenance(forgedAc as never)).toBeUndefined();
        const missingInterceptedAc = attackCardMessage();
        Object.assign(missingInterceptedAc.flags["sf2e-forge-custom"].targetHelper, { interceptedAttack: true });
        expect(resolveAttackCardProvenance(missingInterceptedAc as never)).toBeUndefined();
    });
    it("keeps an empty active-token snapshot as the no-token failure", async () => {
        Object.assign(globalThis, {
            game: { ...game, user: { isGM: false, getActiveTokens: () => [] } },
        });

        await expect(rollArmorSavesForTargets(getCardArmorSaveTargets(message), 20, "Laser")).resolves.toBe(false);
        expect(ui.notifications!.error).toHaveBeenCalledWith("sf2e-forge-custom.prad.noToken");
    });

    it("rejects explicit owned tokens outside trusted card membership", async () => {
        const roll = vi.fn();
        const outside = { uuid: "Scene.scene.Token.outside", isOwner: true, actor: { armorClass: { parent: { roll } } } };
        Object.assign(globalThis, {
            fromUuidSync: (uuid: string) => uuid === outside.uuid ? outside : uuid === targetToken.uuid ? targetToken : null,
        });

        await expect(rollAttackCardArmorSaves(message, [outside] as never)).resolves.toBe(false);
        expect(roll).not.toHaveBeenCalled();
    });

    it("passes exact current AC minus 10 with the trusted weapon and captured roll options", async () => {
        const authorized = { ...targetToken, isOwner: true, actor: { armorClass: { value: 26 }, system: { attributes: { ac: { value: 21 } } } } };
        Object.assign(globalThis, {
            game: { ...game, user: { id: "gm", active: true, isGM: true } },
            fromUuidSync: (uuid: string) => uuid === targetToken.uuid ? authorized : null,
        });

        await expect(rollAttackCardArmorSaves(message, [authorized] as never)).resolves.toBe(true);

        expect(rawRoll.mock.calls[0][0]).toMatchObject({ modifiers: [{ modifier: 16, type: "untyped" }] });
        expect(rawRoll.mock.calls[0][1]).toMatchObject({
            actor: authorized.actor,
            token: authorized,
            item: weapon,
            origin: { actor: attacker, item: weapon },
            target: { actor: authorized.actor, token: authorized, item: null },
            options: new Set(["origin:item:trait:laser"]),
        });
    });

    it("uses the trusted intercepted contextual target AC instead of current actor AC", async () => {
        const intercepted = attackCardMessage();
        Object.assign(intercepted.flags["sf2e-forge-custom"], { attackerTokenUUID: nativeAttackerToken.uuid });
        Object.assign(intercepted.flags["sf2e-forge-custom"].targetHelper, { interceptedAttack: true, contextualTargetAc: { targetUuid: targetToken.uuid, value: 31 } });
        const authorized = { ...targetToken, isOwner: true, actor: { armorClass: { value: 26 } } };
        Object.assign(globalThis, {
            game: { ...game, user: { id: "gm", active: true, isGM: true } },
            fromUuidSync: (uuid: string) => uuid === nativeAttackerToken.uuid ? nativeAttackerToken : uuid === targetToken.uuid ? authorized : null,
        });

        await expect(rollAttackCardArmorSaves(intercepted as never, [authorized] as never)).resolves.toBe(true);

        expect(rawRoll.mock.calls[0][0]).toMatchObject({ modifiers: [{ modifier: 21, type: "untyped" }] });
        expect(rawRoll.mock.calls[0][1]).toMatchObject({ origin: { actor: attacker, token: nativeAttackerToken, item: weapon } });
    });

    it("allows only the stable first active GM when no active player owns the armor target", async () => {
        const first = { id: "gm-a", active: true, isGM: true };
        const second = { id: "gm-b", active: true, isGM: true };
        const authorized = { ...targetToken, isOwner: true, actor: { armorClass: { value: 24 } } };
        Object.assign(globalThis, {
            game: { ...game, user: second, users: [second, first] },
            fromUuidSync: (uuid: string) => uuid === targetToken.uuid ? authorized : null,
        });

        await expect(rollAttackCardArmorSaves(message, [authorized] as never)).resolves.toBe(false);
        expect(rawRoll).not.toHaveBeenCalled();

        Object.assign(globalThis, { game: { ...game, user: first, users: [second, first] } });
        await expect(rollAttackCardArmorSaves(message, [authorized] as never)).resolves.toBe(true);
        expect(rawRoll).toHaveBeenCalledOnce();
    });

    it("keeps a trusted armor target locally reserved until its roll settles", async () => {
        let settle!: () => void;
        rawRoll.mockImplementation(() => new Promise<Roll>((resolve) => { settle = () => resolve({ uuid: "ChatMessage.armor" } as unknown as Roll); }));
        const authorized = { ...targetToken, isOwner: true, actor: { armorClass: { value: 24 } } };
        Object.assign(globalThis, { fromUuidSync: (uuid: string) => uuid === targetToken.uuid ? authorized : null });

        const first = rollAttackCardArmorSaves(message, [authorized] as never);
        await Promise.resolve();
        await expect(rollAttackCardArmorSaves(message, [authorized] as never)).resolves.toBe(false);
        settle();
        await expect(first).resolves.toBe(true);

        expect(rawRoll).toHaveBeenCalledOnce();
    });
});


    it("omits a consumable weapon object while retaining its trusted roll options", async () => {
        const actor = { armorClass: { value: 24 } };
        const token = { actor, isOwner: true };
        const consumable = {
            isOfType: (type: string) => type === "weapon",
            traits: new Set(["consumable"]),
        };

        await expect(rollArmorSavesForTargets([token] as never, 20, "Grenade", attacker as never, consumable as never, ["item:trait:area"])).resolves.toBe(true);

        expect(rawRoll.mock.calls[0][1]).toMatchObject({ options: new Set(["item:trait:area"]) });
        expect(rawRoll.mock.calls[0][1]).not.toHaveProperty("item");
    });
describe("rollArmorSavesForTargets", () => {
    it("rolls only the explicitly supplied owned token without reading ambient targets", async () => {
        const actor = { armorClass: { value: 24 } };
        const token = { actor, isOwner: true };
        Object.assign(globalThis, { game: { ...game, user: { isGM: false, getActiveTokens: vi.fn(() => { throw new Error("ambient read"); }) } } });

        await expect(rollArmorSavesForTargets([token] as never, 20, "Laser")).resolves.toBe(true);
        expect(rawRoll).toHaveBeenCalledOnce();
        expect(rawRoll.mock.calls[0][1]).toMatchObject({ token });
    });

    it("passes the exact persisted attacker token as the raw origin token", async () => {
        const actor = { armorClass: { value: 24 } };
        const token = { actor, isOwner: true };
        const attackerToken = { uuid: "Scene.scene.Token.npc", actor: attacker };

        await rollArmorSavesForTargets([token] as never, 20, "Laser", attacker as never, weapon as never, ["action:slug:strike"], undefined, attackerToken as never);

        expect(rawRoll.mock.calls[0][1]).toMatchObject({ origin: { actor: attacker, token: attackerToken, item: weapon } });
    });

    it("passes exact current AC and trusted raw Check context while preserving cancellation", async () => {
        const cancellingRoll = vi.fn(async (_check: unknown, _context: Record<string, unknown>) => null);
        const actor = { armorClass: { value: 29 }, system: { attributes: { ac: { value: 24 } } } };
        const token = { actor, isOwner: true };
        Object.assign(globalThis, {
            game: {
                ...game,
                pf2e: { Check: { roll: cancellingRoll }, CheckModifier: RawCheckModifier, Modifier: RawModifier },
            },
        });

        await expect(rollArmorSavesForTargets(
            [token] as never,
            20,
            "Laser",
            attacker as never,
            weapon as never,
            ["origin:item:trait:laser", "action:slug:strike"],
        )).resolves.toBe(false);

        expect(cancellingRoll).toHaveBeenCalledOnce();
        expect(cancellingRoll.mock.calls[0][0]).toMatchObject({ modifiers: [{ modifier: 19, type: "untyped" }] });
        expect(cancellingRoll.mock.calls[0][1]).toMatchObject({
            actor,
            token,
            type: "check",
            item: weapon,
            origin: { actor: attacker, token: null, statistic: null, self: false, item: weapon, modifiers: [] },
            target: { actor, token, statistic: null, self: true, item: null, distance: null, rangeIncrement: null },
            options: new Set(["origin:item:trait:laser", "action:slug:strike"]),
            skipDialog: true,
            createMessage: true,
        });
        expect(cancellingRoll.mock.calls[0][1]).not.toHaveProperty("extraRollOptions");
    });
});
describe("attack card template", () => {
    it("keeps weapon-controlled fields on escaped Handlebars paths", () => {
        const source = readFileSync(new URL("../../../src/rulesets/sf2e/prad/templates/attack-card.hbs", import.meta.url), "utf8");

        expect(source).toContain("{{weaponName}}");
        expect(source).toContain("{{typeLabel}}");
        expect(source).toContain("{{this.formula}} {{this.displayDamageType}}");
        expect(source).not.toContain("{{{weaponName}}}");
        expect(source).not.toContain("{{{typeLabel}}}");
        expect(source).not.toContain("{{{damageFormula}}}");
        expect(source).not.toContain("{{{");
    });
});

describe("overcome card localization", () => {
    it("formats the complete context sentence and leaves its dynamic values on an escaped template path", async () => {
        const rollerName = "<img src=x onerror=alert(1)>";
        const npcName = "<script>alert(2)</script>";
        const saveType = "<svg onload=alert(3)>";
        const formatted = `${rollerName} localized ${npcName} localized ${saveType}`;
        const format = vi.fn((_key: string, _values: Record<string, string>) => formatted);
        let viewModel: Record<string, unknown> | undefined;
        const renderTemplate = vi.fn(async (_path: string, data: Record<string, unknown>) => {
            viewModel = data;
            return "rendered";
        });
        Object.assign(globalThis, {
            game: { ...game, i18n: { localize: (key: string) => key, format } },
            foundry: { applications: { handlebars: { renderTemplate } } },
            ChatMessage: { create: vi.fn() },
        });

        await createPradChatMessage({
            type: "overcome",
            roller: { name: rollerName, actorId: "pc", tokenId: "pc-token" },
            npc: { name: npcName, actorId: "npc", tokenId: "npc-token" },
            source: saveType,
            dc: 20,
            modifier: 8,
            dieResult: 12,
            total: 20,
            playerDegree: 2,
            npcDegree: 2,
        }, { toJSON: () => ({}) } as never);

        expect(format).toHaveBeenCalledWith("sf2e-forge-custom.prad.overcomeLabel", { name: rollerName, npcName, saveType });
        expect(viewModel?.overcomeContext).toBe(formatted);

        const template = readFileSync(new URL("../../../src/rulesets/sf2e/prad/templates/overcome.hbs", import.meta.url), "utf8");
        const localization = JSON.parse(readFileSync(new URL("../../../src/rulesets/sf2e/prad/lang/en.json", import.meta.url), "utf8"));
        expect(template).toContain("{{overcomeContext}}");
        expect(template).not.toContain("{{{");
        expect(template).not.toContain("</span>'s");
        expect(template).not.toContain("{{saveType}}");
        const contextFormat = localization["sf2e-forge-custom"].prad.overcomeLabel as string;
        expect(contextFormat).toContain("{name}");
        expect(contextFormat).toContain("{npcName}");
        expect(contextFormat).toContain("{saveType}");
    });
});

describe("resolveNativeDamageTarget", () => {
    it("resolves the explicit placeable for a single card target without ambient drift", () => {
        const placeable = { document: { uuid: targetToken.uuid } };
        Object.assign(globalThis, { canvas: { tokens: { get: vi.fn(() => placeable) } } });
        expect(resolveNativeDamageTarget([targetToken.uuid])).toBe(placeable);
    });

    it("requires exactly one selected exact member for a multi-target card", () => {
        const first = { document: { uuid: targetToken.uuid } };
        const outside = { document: { uuid: "Scene.scene.Token.outside" } };
        const secondUuid = "Scene.scene.Token.second";
        Object.assign(globalThis, { game: { ...game, user: { ...game.user, targets: new Set([first, outside]) } } });
        expect(resolveNativeDamageTarget([targetToken.uuid, secondUuid])).toBe(first);

        Object.assign(globalThis, { game: { ...game, user: { ...game.user, targets: new Set([first, { document: { uuid: secondUuid } }]) } } });
        expect(resolveNativeDamageTarget([targetToken.uuid, secondUuid])).toBeUndefined();
    });
});

describe("rollWeaponDamage", () => {
    it("rejects non-GM execution before either damage path can run", async () => {
        const evaluate = vi.fn();
        Object.assign(globalThis, {
            game: { ...game, user: { isGM: false } },
            Roll: vi.fn(() => ({ evaluate })),
        });

        await rollWeaponDamage({ flags: { "sf2e-forge-custom": { damageRolls: [{ formula: "1d6", damageType: "fire" }] } } } as never);

        expect(evaluate).not.toHaveBeenCalled();
        expect(ui.notifications!.warn).toHaveBeenCalledWith("sf2e-forge-custom.prad.damageGmOnly");
    });

    it("derives fallback formulas and escaped flavor from the validated attacker-owned item", async () => {
        const toMessage = vi.fn().mockResolvedValue({ uuid: "ChatMessage.damage" });
        const maliciousWeapon = {
            id: "laser",
            uuid: weapon.uuid,
            name: "<img src=x onerror=alert(1)>",
            type: "melee",
            system: { damageRolls: { primary: { damage: "1", damageType: "</strong><script>alert(1)</script>" } } },
        };
        const maliciousAttacker = {
            ...attacker,
            system: {},
            items: { get: (id: string) => id === maliciousWeapon.id ? maliciousWeapon : undefined },
        };
        const formulas: string[] = [];
        class Roll {
            constructor(formula: string) { formulas.push(formula); }
            evaluate = vi.fn();
            toMessage = toMessage;
        }
        Object.assign(globalThis, {
            game: { ...game, actors: { get: (id: string) => id === attacker.id ? maliciousAttacker : undefined } },
            Roll,
        });

        const message = attackCardMessage(maliciousWeapon.id);
        (message.flags["sf2e-forge-custom"] as Record<string, unknown>).damageRolls = [{ formula: "999", damageType: "forged" }];
        await expect(rollWeaponDamage(message as never)).resolves.toBe(true);

        expect(formulas).toEqual(["1"]);
        expect(toMessage).toHaveBeenCalledWith(expect.objectContaining({
            flavor: expect.not.stringContaining("<script>"),
        }));
        expect(toMessage.mock.calls[0][0].flavor).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });

    it("rejects attacker-owned non-strike items before evaluating fallback formulas", async () => {
        const evaluate = vi.fn();
        const nonStrikeItem = { id: "effect", name: "Forged", type: "effect", system: { damageRolls: { primary: { damage: "999", damageType: "fire" } } } };
        const attackerWithNonStrike = { ...attacker, system: {}, items: { get: (id: string) => id === nonStrikeItem.id ? nonStrikeItem : undefined } };
        Object.assign(globalThis, {
            game: { ...game, actors: { get: (id: string) => id === attacker.id ? attackerWithNonStrike : undefined } },
            Roll: vi.fn(() => ({ evaluate })),
        });

        await expect(rollWeaponDamage(attackCardMessage(nonStrikeItem.id) as never)).resolves.toBe(false);

        expect(evaluate).not.toHaveBeenCalled();
    });


    it("refuses manual fallback for persistent damage instead of misrepresenting it as ordinary damage", async () => {
        const evaluate = vi.fn();
        const persistentWeapon = { id: "laser", uuid: weapon.uuid, name: "Burner", type: "melee", system: { damageRolls: { primary: { damage: "1d6", damageType: "fire", category: "persistent" } } } };
        const persistentAttacker = { ...attacker, system: {}, items: { get: (id: string) => id === persistentWeapon.id ? persistentWeapon : undefined } };
        Object.assign(globalThis, {
            game: { ...game, actors: { get: (id: string) => id === attacker.id ? persistentAttacker : undefined } },
            Roll: vi.fn(() => ({ evaluate })),
        });

        await expect(rollWeaponDamage(attackCardMessage(persistentWeapon.id) as never)).resolves.toBe(false);

        expect(evaluate).not.toHaveBeenCalled();
        expect(ui.notifications!.warn).toHaveBeenCalledWith("sf2e-forge-custom.prad.categorizedDamageRequiresNative");
    });

    it.each(["precision", "splash"])("refuses manual fallback for %s damage", async (category) => {
        const evaluate = vi.fn();
        const categorizedWeapon = { id: "laser", uuid: weapon.uuid, name: "Categorized", type: "melee", system: { damageRolls: { primary: { damage: "1d6", damageType: "fire", category } } } };
        const categorizedAttacker = { ...attacker, system: {}, items: { get: (id: string) => id === categorizedWeapon.id ? categorizedWeapon : undefined } };
        Object.assign(globalThis, {
            game: { ...game, actors: { get: (id: string) => id === attacker.id ? categorizedAttacker : undefined } },
            Roll: vi.fn(() => ({ evaluate })),
        });

        await expect(rollWeaponDamage(attackCardMessage(categorizedWeapon.id) as never)).resolves.toBe(false);

        expect(evaluate).not.toHaveBeenCalled();
        expect(ui.notifications!.warn).toHaveBeenCalledWith("sf2e-forge-custom.prad.categorizedDamageRequiresNative");
    });

    it("passes the explicit card-authorized target to native strike damage", async () => {
        const damage = vi.fn().mockResolvedValue({ uuid: "ChatMessage.damage" });
        const placeable = { document: { uuid: targetToken.uuid } };
        const nativeAttacker = { ...attacker, system: { actions: [{ item: weapon, damage }] } };
        Object.assign(globalThis, {
            MouseEvent: class {},
            canvas: { tokens: { get: vi.fn(() => placeable) } },
            game: { ...game, actors: { get: (id: string) => id === attacker.id ? nativeAttacker : undefined } },
        });

        await expect(rollWeaponDamage(attackCardMessage() as never)).resolves.toBe(true);

        expect(damage).toHaveBeenCalledWith(expect.objectContaining({ target: placeable }));
    });

    it("fails with localized feedback when native damage has no explicit authorized placeable", async () => {
        const damage = vi.fn();
        const nativeAttacker = { ...attacker, system: { actions: [{ item: weapon, damage }] } };
        Object.assign(globalThis, {
            game: { ...game, actors: { get: (id: string) => id === attacker.id ? nativeAttacker : undefined } },
        });

        await expect(rollWeaponDamage(attackCardMessage() as never)).resolves.toBe(false);

        expect(damage).not.toHaveBeenCalled();
        expect(ui.notifications!.warn).toHaveBeenCalledWith("sf2e-forge-custom.prad.damageTargetRequired");
    });

    it.each([
        ["cancellation", null],
        ["exception", new Error("native failure")],
    ])("treats native damage %s as terminal without generic fallback", async (_case, outcome) => {
        const evaluate = vi.fn();
        const damage = outcome instanceof Error ? vi.fn().mockRejectedValue(outcome) : vi.fn().mockResolvedValue(outcome);
        const placeable = { document: { uuid: targetToken.uuid } };
        const nativeAttacker = { ...attacker, system: { actions: [{ item: weapon, damage }] } };
        Object.assign(globalThis, {
            MouseEvent: class {},
            Roll: vi.fn(() => ({ evaluate })),
            canvas: { tokens: { get: vi.fn(() => placeable) } },
            game: { ...game, actors: { get: (id: string) => id === attacker.id ? nativeAttacker : undefined } },
        });

        await expect(rollWeaponDamage(attackCardMessage() as never)).resolves.toBe(false);

        expect(damage).toHaveBeenCalledOnce();
        expect(evaluate).not.toHaveBeenCalled();
    });
    it("rejects damage cards that were not authored by a GM", async () => {
        const evaluate = vi.fn();
        Object.assign(globalThis, { Roll: vi.fn(() => ({ evaluate })) });

        const message = attackCardMessage();
        message.author.isGM = false;
        await expect(rollWeaponDamage(message as never)).resolves.toBe(false);

        expect(evaluate).not.toHaveBeenCalled();
    });
});
