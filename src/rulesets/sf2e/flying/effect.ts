import { MODULE_ID } from "../../../constants.js";

/** Slug of the module's "Effect: Flying" item; the effect is the source of truth for whether an actor is airborne. */
export const FLYING_SLUG = "codex-flying";
const MACRO_FLAG = "macro";
const MACRO_KIND = "toggleFlying";

// PF2e and Foundry shapes not represented by the type packages.
export interface FlyingItem { id?: string; type: string; system: { slug?: string | null }; actor?: FlyingActor | null; delete(): Promise<unknown> }
export interface FlyingToken { update(changes: { movementAction: string | null }): Promise<unknown> | unknown }
export interface FlyingActor {
    items: Iterable<Pick<FlyingItem, "type" | "system" | "delete">>;
    getActiveTokens(linked?: boolean, document?: boolean): FlyingToken[];
    createEmbeddedDocuments(name: "Item", data: object[]): Promise<unknown>;
}

const localize = (key: string, fallback: string): string =>
    (globalThis as { game?: { i18n?: { localize(key: string): string } } }).game?.i18n?.localize(key) ?? fallback;

export function flyingEffectData() {
    return {
        name: localize("codex-foundry.flying.effectName", "Effect: Flying"),
        type: "effect",
        img: "icons/svg/wing.svg",
        system: {
            slug: FLYING_SLUG,
            tokenIcon: { show: true },
            duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
            level: { value: 1 },
            badge: null,
            rules: [],
            traits: { value: [] },
            description: { value: localize("codex-foundry.flying.effectDescription", "") },
        },
    };
}

function flyingItem(actor: FlyingActor | null | undefined) {
    if (!actor) return undefined;
    for (const item of actor.items) if (item.type === "effect" && item.system.slug === FLYING_SLUG) return item;
    return undefined;
}

export function isFlying(actor: FlyingActor | null | undefined): boolean {
    return !!flyingItem(actor);
}

export async function setFlying(actor: FlyingActor, flying: boolean): Promise<void> {
    const item = flyingItem(actor);
    if (flying && !item) await actor.createEmbeddedDocuments("Item", [flyingEffectData()]);
    else if (!flying && item) await item.delete();
}

/** Toggle flight for each distinct actor behind the given tokens. */
export async function toggleFlying(tokens: Iterable<{ actor: FlyingActor | null }>): Promise<void> {
    const actors = new Set<FlyingActor>();
    for (const { actor } of tokens) if (actor) actors.add(actor);
    await Promise.all([...actors].map(actor => setFlying(actor, !isFlying(actor))));
}

/** Keep the native movement action in step with the effect, so the ruler, climb rules and checks see a flyer. */
function onItemChange(flying: boolean) {
    return (item: FlyingItem, _options: object, userId: string): void => {
        if (userId !== game.user!.id || item.type !== "effect" || item.system.slug !== FLYING_SLUG || !item.actor) return;
        for (const token of item.actor.getActiveTokens(false, true)) void token.update({ movementAction: flying ? "fly" : null });
    };
}

export function activateFlyingEffect(): void {
    const hooks = Hooks as unknown as { on(name: string, callback: (...args: never[]) => unknown): void };
    hooks.on("createItem", onItemChange(true));
    hooks.on("deleteItem", onItemChange(false));
}

/** A GM's client creates the "Toggle Flying" macro once; it calls the module API for the controlled tokens. */
export async function ensureFlyingMacro(): Promise<void> {
    if (!game.user!.isGM) return;
    const macros = game.macros as unknown as { find(predicate: (macro: { getFlag(scope: string, key: string): unknown }) => boolean): unknown };
    if (macros.find(macro => macro.getFlag(MODULE_ID, MACRO_FLAG) === MACRO_KIND)) return;
    const Macro = (globalThis as unknown as { Macro: { create(data: object): Promise<unknown> } }).Macro;
    await Macro.create({
        name: game.i18n!.localize("codex-foundry.flying.macroName"),
        type: "script",
        img: "icons/svg/wing.svg",
        command: `game.modules.get("${MODULE_ID}").api.flying.toggleFlying({ tokenUuids: canvas.tokens.controlled.map(t => t.document.uuid) });`,
        flags: { [MODULE_ID]: { [MACRO_FLAG]: MACRO_KIND } },
    });
}
