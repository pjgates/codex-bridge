/**
 * PRAD (Players Roll All Dice) — Inversion 1: NPC Attack → Player Armor Save
 *
 * When an NPC attacks a PC, instead of rolling the NPC's attack, a chat card
 * is posted with an "Armor Save" button. The *player* clicks the button to
 * roll their armor save, just like clicking a save button on a spell card.
 *
 * Two entry points:
 *   1. GM clicks the Attack DC on the NPC sheet  → postAttackCard()
 *   2. NPC attack roll intercepted via preCreateChatMessage → postAttackCard()
 * Both post the same chat card; the player then clicks the button.
 */

import { MODULE_ID } from "../../../constants.js";
import { isCurrentUserDesignatedTargetRollCreator } from "../../../shared/authorized-roller.js";
import { getSystemFlags } from "../../../shared/flags.js";
import { resolveHtmlRoot } from "../../../shared/html.js";
import { getPublicSceneTokenUuids, getSceneTokenId, isSceneTokenUuid } from "../../../shared/token-uuid.js";
import { createTargetRevision, normalizeTargetHelperFlagData, rollArmorSave } from "../target-helper/index.js";
import { getAttackDC, getAttackModifierFromStrike } from "./dc.js";

const RESTORE_ORIGINAL_OPTION = "pradRestoreOriginal";

function resolveUuidSync<T>(uuid: string): T | null {
    try {
        return fromUuidSync(uuid) as T | null;
    } catch {
        return null;
    }
}

/** SF2e/PF2e represents NPC melee, ranged, and area-fire strike items with the `melee` document type. */
function isNpcStrikeItem(item: Item.Implementation | undefined): item is Item.Implementation {
    return (item?.type as string | undefined) === "melee";
}

// ─── Template path ───────────────────────────────────────────────────────────

const TEMPLATE_ATTACK_CARD = `modules/${MODULE_ID}/dist/templates/prad/attack-card.hbs`;

/**
 * Pre-load the attack card template during init.
 */
export function registerAttackCardTemplate(): void {
    foundry.applications.handlebars.loadTemplates([TEMPLATE_ATTACK_CARD]);
}

// ─── Hook Registration ───────────────────────────────────────────────────────

/**
 * Register attack interception and both Foundry V14 and legacy render hooks.
 * DOM binding is idempotent because Foundry can deliver both render hooks.
 */
export function registerAttackInterceptHook(): void {
    Hooks.on("preCreateChatMessage", onPreCreateChatMessage);
    Hooks.on("renderChatMessageHTML", onRenderAttackCard);
    Hooks.on("renderChatMessage", onRenderAttackCard);
    console.log(`${MODULE_ID} | PRAD: Attack interception hook registered`);
}

// ─── preCreateChatMessage: intercept NPC attack rolls ────────────────────────

function onPreCreateChatMessage(
    message: ChatMessage.Implementation,
    _data: object,
    options: Record<string, unknown> | undefined,
    _userId: string
): boolean | void {
    try {
        if (options?.[RESTORE_ORIGINAL_OPTION] === true) return;
        return _onPreCreateChatMessage(message);
    } catch (err) {
        console.error(`${MODULE_ID} | PRAD: Error in preCreateChatMessage hook`, err);
    }
}

interface InterceptedAttack {
    readonly attacker: Actor.Implementation;
    readonly attackDC: number;
    readonly attackerTokenUUID?: string;
    readonly weaponItem: Item.Implementation;
    readonly weaponRollOptions?: readonly string[];
    readonly targetTokenUUIDs: readonly string[];
    readonly contextualTargetAc: ContextualTargetAc;
    readonly interceptedAttack: true;
}

export interface ContextualTargetAc {
    readonly targetUuid: string;
    readonly value: number;
}

/**
 * Classify an NPC-to-PC SF2e attack before its native message is cancelled.
 * SF2e stores the embedded strike UUID at `origin.uuid` and the authoritative
 * target TokenDocument UUID at `context.target.token`.
 */
export function classifyInterceptedAttack(
    message: ChatMessage.Implementation,
): InterceptedAttack | undefined {
    if (!game.user?.isGM) return;
    const visibility = message as ChatMessage.Implementation & { readonly blind?: unknown; readonly whisper?: unknown };
    if (visibility.blind === true || (Array.isArray(visibility.whisper) && visibility.whisper.length > 0)) return;

    const flags = getSystemFlags(message);
    const context = flags?.context;
    if (context?.type !== "attack-roll") return;

    const speakerActorId = message.speaker?.actor;
    if (!speakerActorId) return;

    const originTokenUUID = context.origin?.token;
    const speakerSceneId = message.speaker?.scene;
    const speakerTokenId = message.speaker?.token;
    const speakerTokenUUID = typeof speakerSceneId === "string" && typeof speakerTokenId === "string"
        ? `Scene.${speakerSceneId}.Token.${speakerTokenId}`
        : undefined;
    const attackerTokenUUID = isSceneTokenUuid(originTokenUUID)
        ? originTokenUUID
        : isSceneTokenUuid(speakerTokenUUID) ? speakerTokenUUID : undefined;
    const attackerToken = attackerTokenUUID ? resolveUuidSync<Sf2eTokenDocument>(attackerTokenUUID) : null;
    const attacker = attackerToken && attackerToken.uuid === attackerTokenUUID && attackerToken.actor?.id === speakerActorId
        ? attackerToken.actor
        : undefined;
    if (!attacker || (attacker.type as string) !== "npc") return;
    const targetTokenUUID = context.target?.token;
    const contextualTargetAc = context.dc?.value;
    if (!isSceneTokenUuid(targetTokenUUID) || typeof contextualTargetAc !== "number" || !Number.isFinite(contextualTargetAc)) return;

    const targetToken = resolveUuidSync<{ uuid?: string; actor?: Actor.Implementation }>(targetTokenUUID);
    const targetActor = targetToken?.actor;
    if (targetToken?.uuid !== targetTokenUUID || !targetActor || (targetActor.type as string) !== "character") return;

    const originItemUUID = flags?.origin?.uuid;
    if (!originItemUUID) return;

    const resolvedItem = resolveUuidSync<Item.Implementation>(originItemUUID);
    const itemId = resolvedItem?.id;
    if (!resolvedItem || !itemId || !isNpcStrikeItem(resolvedItem) || attacker.items.get(itemId) !== resolvedItem) return;

    const enabledModifiers = flags?.modifiers?.filter((modifier) => modifier.enabled);
    let attackModifier = enabledModifiers?.length
        ? enabledModifiers.reduce((sum, modifier) => sum + modifier.modifier, 0)
        : getAttackModifierFromStrike(resolvedItem);

    if (!enabledModifiers?.length && attackModifier === 0 && message.rolls?.length > 0) {
        const roll = message.rolls[0];
        if (roll.total != null) {
            const dieTerm = roll.terms?.[0] as Sf2eRollDieTerm | undefined;
            const dieValue: number = dieTerm?.results?.[0]?.result ?? 0;
            attackModifier = roll.total - dieValue;
        }
    }

    return {
        attacker,
        attackDC: getAttackDC(attackModifier),
        ...(attackerToken?.actor === attacker && attackerTokenUUID ? { attackerTokenUUID } : {}),
        weaponItem: resolvedItem,
        ...(flags?.origin?.rollOptions ? { weaponRollOptions: flags.origin.rollOptions } : {}),
        targetTokenUUIDs: [targetTokenUUID],
        contextualTargetAc: { targetUuid: targetTokenUUID, value: contextualTargetAc },
        interceptedAttack: true,
    };
}

function _onPreCreateChatMessage(
    message: ChatMessage.Implementation,
): boolean | void {
    const intercepted = classifyInterceptedAttack(message);
    if (!intercepted) return;

    const originalSource = message.toObject() as Record<string, unknown>;
    console.log(
        `${MODULE_ID} | PRAD: Intercepting ${intercepted.attacker.name}'s attack (DC ${intercepted.attackDC}) → posting attack card`
    );

    let restored = false;
    void postAttackCard(intercepted).catch(async (err: unknown) => {
        console.error(`${MODULE_ID} | PRAD: Error posting intercepted attack card`, err);
        try {
            ui.notifications!.error(game.i18n!.localize("sf2e-forge-custom.prad.attackRestored"));
        } catch (notificationError) {
            console.error(`${MODULE_ID} | PRAD: Failed to notify GM about intercepted attack restoration`, notificationError);
        }
        if (restored) return;
        restored = true;
        try {
            const restoredMessage = await (ChatMessage as unknown as {
                create: (data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
            }).create(originalSource, { [RESTORE_ORIGINAL_OPTION]: true });
            if (!restoredMessage) throw new Error("Restoring the intercepted attack returned no chat message");
        } catch (restoreError) {
            console.error(`${MODULE_ID} | PRAD: Failed to restore intercepted attack`, restoreError);
            ui.notifications!.error(game.i18n!.localize("sf2e-forge-custom.prad.attackRestoreFailed"));
        }
    });

    return false;
}

// ─── Attack Card (posted to chat) ────────────────────────────────────────────

export interface AttackCardParams {
    attacker: Actor.Implementation;
    attackDC: number;
    /** Exact TokenDocument UUID for a synthetic/token attacker. */
    attackerTokenUUID?: string;
    /** The exact TokenDocument UUIDs represented by this card. */
    targetTokenUUIDs: readonly string[];
    /** The NPC-owned strike item used to derive card and damage data. */
    weaponItem: Item.Implementation;
    /** Validated originating strike roll options, when captured from a native attack. */
    weaponRollOptions?: readonly string[];
    /** Trusted resolved AC for the exact target of an intercepted native attack. */
    contextualTargetAc?: ContextualTargetAc;
    /** True only when this replaces a cancelled native attack. */
    interceptedAttack?: true;
}

// ─── Weapon Data Extraction ──────────────────────────────────────────────────

interface DamageRollEntry {
    formula: string;
    damageType: string;
    displayDamageType: string;
    category?: string;
}

interface WeaponDisplayData {
    weaponImg: string;
    actionGlyph: string;
    typeLabel: string;
    traits: Array<{ slug: string; label: string }>;
    hasTraits: boolean;
    rangeLabel: string;
    hasRange: boolean;
    areaLabel: string;
    hasArea: boolean;
    hasRangeOrArea: boolean;
    damageRolls: DamageRollEntry[];
    hasDamage: boolean;
    hasDetails: boolean;
    weaponItemId: string;
}

/**
 * Extract display-friendly weapon data from an NPC strike item.
 */
function extractWeaponData(weaponItem: Item.Implementation): WeaponDisplayData {
    const sys = weaponItem.system && typeof weaponItem.system === "object"
        ? weaponItem.system as Record<string, unknown>
        : {};

    // Image
    const weaponImg = typeof (weaponItem as unknown as { img?: unknown }).img === "string"
        ? (weaponItem as unknown as { img: string }).img
        : "icons/svg/sword.svg";

    // Action glyph: strikes are 1 action, area-fire is 2 actions
    const action = typeof sys.action === "string" ? sys.action : "strike";
    const actionGlyph = action === "area-fire" ? "2" : "1";

    // Type label (shown where "Spell 3" appears on spell cards)
    const range = sys.range as { increment?: number; max?: number | null } | null;
    let typeLabel: string;
    if (action === "area-fire") {
        typeLabel = game.i18n!.localize("sf2e-forge-custom.prad.areaAttack");
    } else if (range?.increment) {
        typeLabel = game.i18n!.localize("sf2e-forge-custom.prad.rangedStrike");
    } else {
        typeLabel = game.i18n!.localize("sf2e-forge-custom.prad.meleeStrike");
    }

    // ── Damage rolls (extracted first so damage types can feed into traits) ──
    const damageRollsObj = typeof sys.damageRolls === "object" && sys.damageRolls !== null
        ? sys.damageRolls as Record<string, { damage?: unknown; damageType?: unknown; category?: unknown }>
        : {};
    const damageRolls: DamageRollEntry[] = [];
    for (const key of Object.keys(damageRollsObj)) {
        const dr = damageRollsObj[key];
        if (typeof dr?.damage === "string") {
            const damageType = typeof dr.damageType === "string" ? dr.damageType : "untyped";
            const category = typeof dr.category === "string" && dr.category.length > 0 ? dr.category : undefined;
            damageRolls.push({
                formula: dr.damage,
                damageType,
                displayDamageType: category ? `${category} ${damageType}` : damageType,
                ...(category ? { category } : {}),
            });
        }
    }
    const hasDamage = damageRolls.length > 0;

    // ── Traits (enriched: attack + weapon traits + damage types + range) ──
    const rawTraitValues = (sys.traits as Record<string, unknown> | undefined)?.value;
    const traitValues = Array.isArray(rawTraitValues)
        ? rawTraitValues.filter((trait): trait is string => typeof trait === "string")
        : [];

    // Deduplicate by slug
    const seenSlugs = new Set<string>();
    const traits: Array<{ slug: string; label: string }> = [];
    const addTrait = (slug: string, label: string): void => {
        const key = slug.toLowerCase();
        if (!seenSlugs.has(key)) {
            seenSlugs.add(key);
            traits.push({ slug: key, label });
        }
    };

    // 1. "Attack" — every strike has this trait
    addTrait("attack", game.i18n!.localize("sf2e-forge-custom.prad.attack"));

    // 2. Weapon traits from item data (e.g. "sonic", "volley 30 ft.")
    for (const t of traitValues) {
        addTrait(t, t.charAt(0).toUpperCase() + t.slice(1));
    }

    // 3. Damage-type traits (e.g. "piercing", "bludgeoning")
    for (const dr of damageRolls) {
        addTrait(dr.damageType, dr.damageType.charAt(0).toUpperCase() + dr.damageType.slice(1));
    }

    // 4. Range increment tag (matches what PF2e damage rolls show)
    if (range?.increment) {
        addTrait("range-increment", game.i18n!.format("sf2e-forge-custom.prad.rangeIncrement", { value: String(range.increment) }));
    }

    const hasTraits = traits.length > 0;

    // ── Range / Area (for card-content section) ──────────────────────────
    let rangeLabel = "";
    let hasRange = false;
    if (range?.increment) {
        rangeLabel = game.i18n!.format("sf2e-forge-custom.prad.rangeFeet", { value: String(range.increment) });
        if (range.max) rangeLabel += ` (${game.i18n!.format("sf2e-forge-custom.prad.rangeMax", { value: String(range.max) })})`;
        hasRange = true;
    } else if (range?.max) {
        rangeLabel = game.i18n!.format("sf2e-forge-custom.prad.rangeFeet", { value: String(range.max) });
        hasRange = true;
    }

    const area = sys.area as { type?: string; value?: number } | null;
    let areaLabel = "";
    let hasArea = false;
    if (area?.type && area?.value) {
        areaLabel = game.i18n!.format("sf2e-forge-custom.prad.areaFeet", { value: String(area.value), type: area.type });
        hasArea = true;
    }

    const hasRangeOrArea = hasRange || hasArea;


    const hasDetails = hasRangeOrArea || hasDamage;

    return {
        weaponImg,
        actionGlyph,
        typeLabel,
        traits,
        hasTraits,
        rangeLabel,
        hasRange,
        areaLabel,
        hasArea,
        hasRangeOrArea,
        hasDamage,
        hasDetails,
        damageRolls,
        weaponItemId: weaponItem.id ?? "",
    };
}

/**
 * Post a chat card that shows the NPC attack and provides an "Armor Save"
 * button for the player to click — identical in concept to a spell save button.
 *
 * When a `weaponItem` is provided the card is enriched with traits, range,
 * damage formulas, and a "Roll Damage" button, matching the PF2e spell card
 * format.
 */
const MAX_CARD_TARGETS = 100;
const MAX_UUID_LENGTH = 512;

function isBoundedString(value: unknown, maxLength = MAX_UUID_LENGTH): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= maxLength;

}
const MAX_ROLL_OPTIONS = 100;
function isItemUuid(value: unknown): value is string {
    if (!isBoundedString(value)) return false;
    const parts = value.split(".");
    const itemIndex = parts.lastIndexOf("Item");
    return itemIndex >= 0 && itemIndex === parts.length - 2 && parts[itemIndex + 1].length > 0;
}

const MAX_ROLL_OPTION_LENGTH = 200;

function getValidatedWeaponRollOptions(weaponItem: Item.Implementation, captured?: readonly string[]): string[] {
    const itemWithRollOptions = weaponItem as Item.Implementation & {
        getOriginData?: () => { readonly rollOptions?: unknown };
        getRollOptions?: (domain: string) => string[];
    };
    const options = captured ?? itemWithRollOptions.getOriginData?.().rollOptions ?? itemWithRollOptions.getRollOptions?.("origin:item") ?? [];
    if (!Array.isArray(options) || options.length > MAX_ROLL_OPTIONS || !options.every((option) => isBoundedString(option, MAX_ROLL_OPTION_LENGTH))) {
        throw new Error("PRAD attack cards require bounded weapon roll options");
    }
    return [...options];
}

function isTokenUuid(value: unknown): value is string {
    return isSceneTokenUuid(value);
}

export function getAttackCardTargetUUIDs(explicitTargetTokenUUIDs: readonly string[]): string[] {
    if (!Array.isArray(explicitTargetTokenUUIDs) || explicitTargetTokenUUIDs.length > MAX_CARD_TARGETS || !explicitTargetTokenUUIDs.every(isTokenUuid)) {
        throw new Error("PRAD attack cards require an explicit bounded target Token UUID array");
    }
    return [...new Set(explicitTargetTokenUUIDs)];
}

export async function postAttackCard(params: AttackCardParams): Promise<string> {
    if (!params || typeof params !== "object") throw new Error("PRAD attack card parameters must be an object");
    if (!game.user?.isGM) throw new Error("Only a GM can post PRAD attack cards");
    const { attacker, attackDC, attackerTokenUUID, targetTokenUUIDs, weaponItem, weaponRollOptions, contextualTargetAc, interceptedAttack } = params;
    const attackerToken = attackerTokenUUID ? resolveUuidSync<Sf2eTokenDocument>(attackerTokenUUID) : null;
    const hasExactAttackerToken = isSceneTokenUuid(attackerTokenUUID)
        && attackerToken?.uuid === attackerTokenUUID
        && attackerToken.actor === attacker;
    const hasRegisteredWorldAttacker = !!attacker?.id && game.actors?.get(attacker.id) === attacker;
    if (!attacker?.id || (attacker.type as string) !== "npc" || (!hasExactAttackerToken && !hasRegisteredWorldAttacker)) throw new Error("PRAD attack cards require a registered world NPC or exact NPC token attacker");
    if (!Number.isInteger(attackDC) || attackDC < 0) throw new Error("PRAD attack cards require a non-negative integer attack DC");
    if (attackerTokenUUID !== undefined && !hasExactAttackerToken) throw new Error("Invalid PRAD attacker token UUID");
    if (!weaponItem?.id || !isNpcStrikeItem(weaponItem) || attacker.items.get(weaponItem.id) !== weaponItem) throw new Error("PRAD attack cards require an attacker-owned NPC strike item");
    const weaponItemUUID = (weaponItem as Item.Implementation & { readonly uuid?: unknown }).uuid;
    if (!isItemUuid(weaponItemUUID)) throw new Error("PRAD attack cards require an exact weapon item UUID");
    const validatedWeaponRollOptions = getValidatedWeaponRollOptions(weaponItem, weaponRollOptions);
    const explicitTargets = getAttackCardTargetUUIDs(targetTokenUUIDs);
    const targets = getPublicSceneTokenUuids(explicitTargets);
    if (targets.length !== explicitTargets.length || targets.some((uuid) => !explicitTargets.includes(uuid))) {
        throw new Error("PRAD attack cards cannot include private targets");
    }
    if ((interceptedAttack === true) !== (contextualTargetAc !== undefined)) {
        throw new Error("Intercepted PRAD attack cards require exact contextual AC provenance");
    }
    if (interceptedAttack === true && !hasExactAttackerToken) {
        throw new Error("Intercepted PRAD attack cards require an exact attacker token");
    }
    if (interceptedAttack === true && targets.length !== 1) {
        throw new Error("Intercepted PRAD attack cards require exactly one target");
    }
    if (contextualTargetAc !== undefined && (!isSceneTokenUuid(contextualTargetAc.targetUuid) || !targets.includes(contextualTargetAc.targetUuid) || typeof contextualTargetAc.value !== "number" || !Number.isFinite(contextualTargetAc.value))) {
        throw new Error("PRAD attack cards require contextual AC bound to an exact card target");
    }
    const sf2eAttacker = attacker as Sf2eActor;
    const wd = extractWeaponData(weaponItem);
    const weaponName = isBoundedString(weaponItem.name, 200) ? weaponItem.name : game.i18n!.localize("sf2e-forge-custom.prad.strike");
    const revision = createTargetRevision();
    const templateData = {
        attackerId: attacker.id,
        attackerTokenId: attackerTokenUUID ? getSceneTokenId(attackerTokenUUID) ?? "" : "",
        weaponName,
        attackDC,
        revision,
        weaponImg: wd?.weaponImg ?? sf2eAttacker.img ?? "icons/svg/mystery-man.svg",
        actionGlyph: wd?.actionGlyph ?? "",
        typeLabel: wd?.typeLabel ?? game.i18n!.localize("sf2e-forge-custom.prad.strike"),
        hasTraits: wd?.hasTraits ?? false,
        traits: wd?.traits ?? [],
        hasDetails: wd?.hasDetails ?? false,
        hasRange: wd?.hasRange ?? false,
        rangeLabel: wd?.rangeLabel ?? "",
        hasArea: wd?.hasArea ?? false,
        areaLabel: wd?.areaLabel ?? "",
        hasRangeOrArea: wd?.hasRangeOrArea ?? false,
        hasDamage: wd?.hasDamage ?? false,
        damageRolls: wd?.damageRolls ?? [],
    };

    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE_ATTACK_CARD, templateData);
    const created = await ChatMessage.create({
        content,
        speaker: {
            actor: attacker.id,
            token: attackerTokenUUID ? getSceneTokenId(attackerTokenUUID) ?? undefined : undefined,
            scene: attackerTokenUUID?.split(".")[1],
            alias: attacker.name ?? game.i18n!.localize("sf2e-forge-custom.prad.unknownNpc"),
        },
        flags: {
            [MODULE_ID]: {
                pradType: "attack-card",
                attackDC,
                weaponName,
                attackerId: attacker.id,
                ...(attackerTokenUUID ? { attackerTokenUUID } : {}),
                weaponItemId: wd?.weaponItemId ?? "",
                damageRolls: wd.damageRolls,
                targetHelper: {
                    type: "prad-attack",
                    targets,
                    generation: 0,
                    revision,
                    save: {
                        statistic: "ac",
                        dc: attackDC,
                        basic: false,
                    },
                    author: sf2eAttacker.uuid,
                    item: weaponItemUUID,
                    options: validatedWeaponRollOptions,
                    ...(contextualTargetAc ? { contextualTargetAc: { targetUuid: contextualTargetAc.targetUuid, value: contextualTargetAc.value } } : {}),
                    ...(interceptedAttack ? { interceptedAttack: true } : {}),
                },
            },
        },
    } as Record<string, unknown>);
    const createdUuid = (created as { uuid?: unknown } | null)?.uuid;
    if (typeof createdUuid !== "string" || createdUuid.length === 0) {
        throw new Error("Creating the PRAD replacement returned no chat message UUID");
    }
    return createdUuid;
}

// ─── renderChatMessage: listen for Armor Save button clicks ──────────────────

export interface AttackCardProvenance {
    readonly attacker: Sf2eActor;
    readonly attackerToken?: Sf2eTokenDocument;
    readonly weaponItem: Item.Implementation;
    readonly weaponName: string;
    readonly attackDC: number;
    readonly targetTokenUUIDs: readonly string[];
    readonly weaponRollOptions: readonly string[];
    readonly contextualTargetAc?: ContextualTargetAc;
    readonly interceptedAttack: boolean;
    readonly strike?: { damage?: (opts: object) => Promise<unknown> };
}

/** Resolve only persisted, GM-authored PRAD cards backed by a registered NPC strike. */
export function resolveAttackCardProvenance(message: ChatMessage.Implementation): AttackCardProvenance | undefined {
    const authoredBy = (message as unknown as { author?: { isGM?: unknown }; user?: { isGM?: unknown } }).author
        ?? (message as unknown as { user?: { isGM?: unknown } }).user;
    if (authoredBy?.isGM !== true) return;

    const moduleFlags = (message.flags as Record<string, Record<string, unknown>> | undefined)?.[MODULE_ID];
    if (moduleFlags?.pradType !== "attack-card") return;

    const targetHelper = normalizeTargetHelperFlagData(moduleFlags.targetHelper);
    const attackDC = moduleFlags.attackDC;
    if (targetHelper?.type !== "prad-attack" || targetHelper.save?.statistic !== "ac" || targetHelper.save.basic || !Array.isArray(targetHelper.options)) return;
    if (!Number.isInteger(attackDC) || (attackDC as number) < 0 || targetHelper.save.dc !== attackDC) return;

    const attackerId = typeof moduleFlags.attackerId === "string" ? moduleFlags.attackerId : undefined;
    const rawAttackerTokenUUID = moduleFlags.attackerTokenUUID;
    if (rawAttackerTokenUUID !== undefined && !isSceneTokenUuid(rawAttackerTokenUUID)) return;
    const attackerTokenUUID = rawAttackerTokenUUID as string | undefined;
    const weaponItemId = typeof moduleFlags.weaponItemId === "string" ? moduleFlags.weaponItemId : undefined;
    if (!weaponItemId) return;

    const attackerToken = attackerTokenUUID && isSceneTokenUuid(attackerTokenUUID)
        ? resolveUuidSync<Sf2eTokenDocument>(attackerTokenUUID)
        : null;
    const attacker = attackerTokenUUID !== undefined
        ? attackerToken?.uuid === attackerTokenUUID ? attackerToken.actor ?? undefined : undefined
        : attackerId ? game.actors!.get(attackerId) as Sf2eActor | undefined : undefined;
    if (targetHelper.interceptedAttack && !attackerToken) return;
    if (!attacker || (attacker.type as string) !== "npc") return;

    const weaponItem = attacker.items.get(weaponItemId);
    if (!isNpcStrikeItem(weaponItem) || targetHelper.item !== (weaponItem as Item.Implementation & { readonly uuid?: unknown }).uuid) return;

    const sys = attacker.system && typeof attacker.system === "object"
        ? attacker.system as Record<string, unknown>
        : {};
    const actions = sys.actions as Array<{ item?: { id?: string }; damage?: (opts: object) => Promise<unknown> }> | undefined;
    const strike = Array.isArray(actions) ? actions.find((action) => action.item?.id === weaponItemId) : undefined;
    const weaponName = isBoundedString(weaponItem.name, 200)
        ? weaponItem.name
        : game.i18n!.localize("sf2e-forge-custom.prad.strike");
    return { attacker, ...(attackerToken ? { attackerToken } : {}), weaponItem, weaponName, weaponRollOptions: targetHelper.options, attackDC: attackDC as number, targetTokenUUIDs: targetHelper.targets, interceptedAttack: targetHelper.interceptedAttack === true, ...(targetHelper.contextualTargetAc ? { contextualTargetAc: targetHelper.contextualTargetAc } : {}), strike };
}

function isConsumableWeapon(item: Item.Implementation): boolean {
    const traits = (item as Item.Implementation & { readonly traits?: { has?(slug: string): boolean } }).traits;
    return (item as Sf2eItem).isOfType?.("weapon") === true && traits?.has?.("consumable") === true;
}

const inFlightArmorRolls = new WeakMap<object, Set<string>>();

function reserveArmorTargets(message: ChatMessage.Implementation, targetUuids: readonly string[]): (() => void) | null {
    let reserved = inFlightArmorRolls.get(message);
    if (!reserved) {
        reserved = new Set<string>();
        inFlightArmorRolls.set(message, reserved);
    }
    if (targetUuids.some((uuid) => reserved!.has(uuid))) return null;
    for (const uuid of targetUuids) reserved.add(uuid);

    return () => {
        for (const uuid of targetUuids) reserved!.delete(uuid);
        if (reserved!.size === 0) inFlightArmorRolls.delete(message);
    };
}

/** Roll armor saves only from trusted persisted PRAD attack-card provenance. */
export async function rollAttackCardArmorSaves(
    message: ChatMessage.Implementation,
    tokens: readonly Sf2eTokenDocument[],
): Promise<boolean> {
    const provenance = resolveAttackCardProvenance(message);
    if (!provenance || !Array.isArray(tokens) || tokens.length === 0) return false;

    const cardTargets = new Set(provenance.targetTokenUUIDs);
    const seen = new Set<string>();
    for (const token of tokens) {
        const uuid = token?.uuid;
        if (!isSceneTokenUuid(uuid) || seen.has(uuid) || !cardTargets.has(uuid)) return false;
        const resolved = resolveUuidSync<Sf2eTokenDocument>(uuid);
        if (resolved?.uuid !== uuid || resolved.actor !== token.actor || !token.actor || (!game.user?.isGM && !token.isOwner)) return false;
        if (!isCurrentUserDesignatedTargetRollCreator(token)) return false;
        seen.add(uuid);
        if (provenance.contextualTargetAc && provenance.contextualTargetAc.targetUuid !== uuid) return false;
    }

    const release = reserveArmorTargets(message, [...seen]);
    if (!release) return false;
    try {
        return await rollArmorSavesForTargets(tokens, provenance.attackDC, provenance.weaponName, provenance.attacker, provenance.weaponItem, provenance.weaponRollOptions, provenance.contextualTargetAc, provenance.attackerToken);
    } finally {
        release();
    }
}

export function getCardArmorSaveTargets(message: ChatMessage.Implementation): Sf2eTokenDocument[] {
    const provenance = resolveAttackCardProvenance(message);
    if (!provenance) return [];

    const cardTargetUUIDs = new Set(provenance.targetTokenUUIDs);
    const activeTokens = [...((game as Sf2eGame).user?.getActiveTokens?.() ?? [])];
    const tokens: Sf2eTokenDocument[] = [];
    const seenUUIDs = new Set<string>();
    for (const activeToken of activeTokens) {
        const token = (activeToken.document ?? activeToken) as Sf2eTokenDocument;
        const uuid = token.uuid;
        if (!cardTargetUUIDs.has(uuid) || seenUUIDs.has(uuid)) continue;
        if (!token.actor || (!game.user?.isGM && !token.isOwner)) continue;
        seenUUIDs.add(uuid);
        tokens.push(token);
    }
    return tokens;
}

/** Attach idempotent card actions when a PRAD attack card renders. */
function handleAsyncCardAction(label: string, operation: Promise<unknown>): void {
    void operation.catch((error: unknown) => {
        console.error(`${MODULE_ID} | PRAD: ${label} failed`, error);
        ui.notifications!.error(game.i18n!.localize("sf2e-forge-custom.prad.attackCardFailed"));
    });
}

function onRenderAttackCard(
    message: ChatMessage.Implementation,
    html: JQuery<HTMLElement> | HTMLElement,
    _data: object,
): void {
    try {
        const root = resolveHtmlRoot(html);
        if (!root || !resolveAttackCardProvenance(message)) return;

        const saveBtn = root.querySelector<HTMLButtonElement>('button[data-action="prad-armor-save"]');
        if (saveBtn && !saveBtn.dataset.pradBound) {
            saveBtn.dataset.pradBound = "true";
            saveBtn.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (!resolveAttackCardProvenance(message)) return;
                handleAsyncCardAction("Armor save roll", rollAttackCardArmorSaves(message, getCardArmorSaveTargets(message)));
            });
        }

        const dmgBtn = root.querySelector<HTMLButtonElement>('button[data-action="prad-roll-damage"]');
        if (dmgBtn && !game.user?.isGM) {
            dmgBtn.disabled = true;
            dmgBtn.hidden = true;
        } else if (dmgBtn && !dmgBtn.dataset.pradBound) {
            dmgBtn.dataset.pradBound = "true";
            dmgBtn.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                handleAsyncCardAction("Weapon damage roll", rollWeaponDamage(message));
            });
        }
    } catch (err) {
        console.error(`${MODULE_ID} | PRAD: Error in renderChatMessage hook`, err);
    }
}

// ─── Weapon Damage Roll (triggered by Roll Damage click) ─────────────────────

const HTML_ESCAPE_BY_CHARACTER: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_BY_CHARACTER[character]);
}

interface NativeDamageTarget {
    readonly document?: { readonly uuid?: string };
}

function getPlaceableUuid(token: NativeDamageTarget): string | undefined {
    return token.document?.uuid;
}

/** Select the one explicit canvas token authorized by a damage-card action. */
export function resolveNativeDamageTarget(targetTokenUUIDs: readonly string[]): NativeDamageTarget | undefined {
    if (targetTokenUUIDs.length === 1) {
        const uuid = targetTokenUUIDs[0];
        const tokenId = getSceneTokenId(uuid);
        if (!tokenId) return;
        const document = resolveUuidSync<{ object?: NativeDamageTarget }>(uuid);
        const token = document?.object ?? (globalThis as unknown as { canvas?: { tokens?: { get?: (id: string) => NativeDamageTarget | undefined } } }).canvas?.tokens?.get?.(tokenId);
        return token && getPlaceableUuid(token) === uuid ? token : undefined;
    }

    const authorized = new Set(targetTokenUUIDs);
    const selected = [...((game as Sf2eGame).user?.targets ?? [])]
        .filter((token) => authorized.has(getPlaceableUuid(token as NativeDamageTarget) ?? ""));
    return selected.length === 1 ? selected[0] : undefined;
}

export async function rollWeaponDamage(message: ChatMessage.Implementation): Promise<boolean> {
    if (!game.user?.isGM) {
        ui.notifications!.warn(game.i18n!.localize("sf2e-forge-custom.prad.damageGmOnly"));
        return false;
    }

    const provenance = resolveAttackCardProvenance(message);
    if (!provenance) {
        ui.notifications!.warn(game.i18n!.localize("sf2e-forge-custom.prad.noDamageData"));
        return false;
    }

    const { attacker, weaponItem, strike } = provenance;
    if (typeof strike?.damage === "function") {
        const target = resolveNativeDamageTarget(provenance.targetTokenUUIDs);
        if (!target) {
            ui.notifications!.warn(game.i18n!.localize("sf2e-forge-custom.prad.damageTargetRequired"));
            return false;
        }
        try {
            const created = await strike.damage({ event: new MouseEvent("click"), target });
            return created != null;
        } catch (err) {
            console.warn(`${MODULE_ID} | PRAD: System damage roll failed`, err);
            return false;
        }
    }

    // Never execute formulas copied from chat flags: a forged card must not be
    // able to make a GM evaluate arbitrary Roll syntax.
    const damageRolls = extractWeaponData(weaponItem).damageRolls;
    if (damageRolls.length === 0) {
        ui.notifications!.warn(game.i18n!.localize("sf2e-forge-custom.prad.noDamageData"));
        return false;
    }
    if (damageRolls.some((damage) => damage.category !== undefined)) {
        ui.notifications!.warn(game.i18n!.localize("sf2e-forge-custom.prad.categorizedDamageRequiresNative"));
        return false;
    }

    const formula = damageRolls.map((damage) => damage.formula).join(" + ");
    const roll = new Roll(formula);
    await roll.evaluate();

    const damageTypes = [...new Set(damageRolls.map((damage) => damage.damageType))].join(", ");
    const damageLabel = game.i18n!.localize("sf2e-forge-custom.prad.damage");
    const created = await roll.toMessage({
        speaker: {
            actor: attacker.id,
            alias: attacker.name ?? game.i18n!.localize("sf2e-forge-custom.prad.unknownNpc"),
        },
        flavor: `<strong>${escapeHtml(weaponItem.name ?? game.i18n!.localize("sf2e-forge-custom.prad.strike"))}</strong> ${escapeHtml(damageLabel)} (${escapeHtml(damageTypes)})`,
    } as Record<string, unknown>);
    return created != null;
}

// ─── Armor Save Roll (triggered by player click) ────────────────────────────

/** Roll armor saves for the explicit owned tokens represented by a caller. */
export async function rollArmorSavesForTargets(
    tokens: readonly Sf2eTokenDocument[],
    attackDC: number,
    weaponName: string,
    attacker?: Actor.Implementation,
    weaponItem?: Item.Implementation,
    weaponRollOptions: readonly string[] = [],
    contextualTargetAc?: ContextualTargetAc,
    attackerToken?: Sf2eTokenDocument,
): Promise<boolean> {
    if (!Array.isArray(tokens) || !Number.isInteger(attackDC) || attackDC < 0 || !isBoundedString(weaponName, 200)) return false;
    if (!Array.isArray(weaponRollOptions) || weaponRollOptions.length > MAX_ROLL_OPTIONS || !weaponRollOptions.every((option) => isBoundedString(option, MAX_ROLL_OPTION_LENGTH))) return false;
    if (contextualTargetAc !== undefined && (!isSceneTokenUuid(contextualTargetAc.targetUuid) || typeof contextualTargetAc.value !== "number" || !Number.isFinite(contextualTargetAc.value) || tokens.some((token) => token.uuid !== contextualTargetAc.targetUuid))) return false;
    if (attackerToken !== undefined && (!attacker || !isSceneTokenUuid(attackerToken.uuid) || attackerToken.actor !== attacker)) return false;
    if (tokens.length === 0) {
        ui.notifications!.error(game.i18n!.localize("sf2e-forge-custom.prad.noToken"));
        return false;
    }

    let rolled = false;
    for (const token of tokens) {
        if (!game.user?.isGM && !token.isOwner) continue;
        const actor = token.actor as Sf2eActor | null | undefined;
        if (!actor) continue;

        const item = !weaponItem || isConsumableWeapon(weaponItem) ? null : weaponItem as Sf2eItem;
        const created = await rollArmorSave({
            actor,
            token,
            attackDC,
            weaponName,
            ...(contextualTargetAc ? { armorClass: contextualTargetAc.value } : {}),
            origin: attacker ?? null,
            originToken: attackerToken ?? null,
            item,
            rollOptions: weaponRollOptions,
            skipDialog: true,
            createMessage: true,
        });
        rolled = created != null || rolled;
    }
    return rolled;
}

