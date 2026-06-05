/**
 * Foundry VTT type augmentations for sf2e-forge-custom.
 *
 * Extends the fvtt-types definitions with module-specific settings,
 * flags, and SF2e/PF2e system data helpers.  These augmentations
 * eliminate the need for `as any` casts throughout the codebase.
 *
 * All types are declared globally so they can be used across files
 * without explicit imports.
 */


declare global {

    // ─── Module Settings Registration ────────────────────────────────────

    interface SettingConfig {
        "sf2e-forge-custom.enableCustomRules": boolean;
        "sf2e-forge-custom.enableTargetHelper": boolean;
        "sf2e-forge-custom.heroicRerolls": boolean;
        "sf2e-forge-custom.playersRollAllDice": boolean;
        "sf2e-forge-custom.pradStrictDCs": boolean;
    }

    // ─── Callback & Options Types ────────────────────────────────────────

    /** Callback invoked after a statistic check roll completes. */
    type Sf2eRollCallback = (
        roll: Roll,
        success: string,
        msg: ChatMessage.Implementation | null,
    ) => void;

    /** Options for `Sf2eStatistic.check.roll()`. */
    interface Sf2eCheckRollOptions {
        dc?: { value: number; label?: string };
        origin?: Actor.Implementation | null;
        target?: Actor.Implementation | null;
        item?: Sf2eItem | null;
        token?: Sf2eTokenDocument;
        extraRollOptions?: string[];
        event?: Event;
        title?: string;
        skipDialog?: boolean;
        createMessage?: boolean;
        callback?: Sf2eRollCallback;
    }

    /** Options for `Sf2eStatistic.roll()`. */
    interface Sf2eStatisticRollOptions {
        dc?: { value: number; label?: string };
        origin?: Actor.Implementation | null;
        target?: Actor.Implementation | null;
        token?: Sf2eTokenDocument;
        item?: Sf2eItem | null;
        extraRollOptions?: string[];
        title?: string;
        skipDialog?: boolean;
        createMessage?: boolean;
    }

    // ─── SF2e / PF2e Core Types ─────────────────────────────────────────

    /**
     * A PF2e/SF2e Statistic (e.g. save, perception, AC, spell DC).
     * Partial definition covering only the properties this module uses.
     */
    interface Sf2eStatistic {
        dc?: { value: number };
        check?: {
            mod?: number;
            roll: (options: Sf2eCheckRollOptions) => Promise<Roll | null>;
        };
        mod?: number;
        roll?: (options: Sf2eStatisticRollOptions) => Promise<Roll>;
    }

    /** A PF2e/SF2e modifier applied to a check or DC. */
    interface Sf2eModifier {
        label: string;
        modifier: number;
        type: string;
        enabled?: boolean;
    }

    /** Instance returned by `new game.pf2e.CheckModifier(…)`. */
    interface Sf2eCheckModifierInstance {
        modifiers: Sf2eModifier[];
    }

    /** Structured origin accepted by the raw `game.pf2e.Check.roll()` API. */
    interface Sf2eRawRollOrigin {
        actor: Actor.Implementation | null;
        token: Sf2eTokenDocument | null;
        statistic: Sf2eStatistic | null;
        self: boolean;
        item: Sf2eItem | null;
        modifiers: Sf2eModifier[];
    }

    /** Structured target accepted by the raw `game.pf2e.Check.roll()` API. */
    interface Sf2eRawRollTarget {
        actor: Actor.Implementation | null;
        token: Sf2eTokenDocument | null;
        statistic: Sf2eStatistic | null;
        self: boolean;
        item: Sf2eItem | null;
        distance: number | null;
        rangeIncrement: number | null;
    }

    /** Context accepted by the raw `game.pf2e.Check.roll()` API. */
    interface Sf2eRawCheckRollContext {
        actor?: Actor.Implementation;
        token?: Sf2eTokenDocument | null;
        origin?: Sf2eRawRollOrigin | null;
        target?: Sf2eRawRollTarget | null;
        item?: Sf2eItem | null;
        type?: "attack-roll" | "check" | "counteract-check" | "flat-check" | "initiative" | "perception-check" | "saving-throw" | "skill-check";
        identifier?: string;
        title?: string;
        dc?: { value: number; label?: string } | null;
        options?: Set<string>;
        skipDialog?: boolean;
        createMessage?: boolean;
    }

    /** A spellcasting entry on an actor. */
    interface Sf2eSpellcastingEntry {
        readonly statistic?: Sf2eStatistic;
    }

    // ─── SF2e Item ───────────────────────────────────────────────────────

    /** SF2e-specific properties on Item documents. */
    interface Sf2eItemExtensions {
        isOfType?(...types: string[]): boolean;
        readonly embeddedSpell?: Sf2eItem & {
            readonly spellcasting?: { statistic?: Sf2eStatistic };
        };
        getRollOptions?(domain: string): string[];
        getOriginData?(): { readonly rollOptions?: string[] };
    }

    /** An Item with SF2e system extensions. */
    type Sf2eItem = Item.Implementation & Sf2eItemExtensions;

    // ─── SF2e ChatMessage ────────────────────────────────────────────────

    /**
     * SF2e-specific properties on ChatMessage documents.
     * These exist at runtime but are not declared by fvtt-types.
     */
    interface Sf2eChatMessageExtensions {
        readonly item?: Sf2eItem;
        readonly actor?: Sf2eActor;
        readonly isAuthor?: boolean;
        readonly isCheckRoll?: boolean;
        readonly content?: string;
        /** Set data on the document source before creation (preCreate hook). */
        updateSource(data: Record<string, unknown>): void;
        /** Persist arbitrary updates (e.g. flag paths) to the database. */
        update(data: Record<string, unknown>): Promise<ChatMessage.Implementation>;
    }

    /** A ChatMessage with SF2e system extensions. */
    type Sf2eChatMessage = ChatMessage.Implementation & Sf2eChatMessageExtensions;

    // ─── SF2e Actor ──────────────────────────────────────────────────────

    /** SF2e-specific properties on Actor documents. */
    interface Sf2eActorExtensions {
        readonly armorClass?: { value?: number; parent?: Sf2eStatistic };
        getStatistic?(slug: string): Sf2eStatistic | undefined;
        getActiveTokens?(linked?: boolean, linked2?: boolean): Sf2eTokenDocument[];
        readonly spellcasting?: { contents: Sf2eSpellcastingEntry[] };
        readonly classDC?: Sf2eStatistic;
        hasCondition?(...slugs: string[]): boolean;
        readonly hasPlayerOwner?: boolean;
        readonly img?: string;
        readonly uuid?: string;
    }

    /** An Actor with SF2e system extensions. */
    type Sf2eActor = Actor.Implementation & Sf2eActorExtensions;

    // ─── Token & Canvas Types ────────────────────────────────────────────

    /**
     * SF2e TokenDocument — the data-layer token with actor reference.
     * Returned by `fromUuidSync()` for Scene.Token UUIDs.
     */
    interface Sf2eTokenDocument {
        readonly id: string;
        readonly uuid: string;
        readonly name: string;
        readonly actor: Sf2eActor | null;
        readonly isOwner: boolean;
        readonly hidden: boolean;
        readonly documentName: "Token";
        /** The rendered PlaceableObject on the canvas, if any. */
        readonly object: Sf2eCanvasToken | null;
    }

    /** A token's canvas-layer representation. */
    interface Sf2eCanvasToken {
        readonly x: number;
        readonly y: number;
        readonly center?: { readonly x: number; readonly y: number };
        _onHoverIn?(event: Event, options?: { hoverOutOthers?: boolean }): void;
        _onHoverOut?(event: Event): void;
    }

    /** A canvas token from `game.user.getActiveTokens()`. */
    interface Sf2eActiveToken {
        readonly id?: string;
        readonly uuid?: string;
        readonly actor?: Sf2eActor | null;
        readonly document?: Sf2eTokenDocument;
    }

    /** Canvas with SF2e/PF2e-specific methods. */
    interface Sf2eCanvas {
        animatePan?(options: { x: number; y: number; duration?: number }): void;
        ping?(options: { x: number; y: number }): void;
        tokens?: {
            get(id: string): Sf2eCanvasTokenPlaceable | undefined;
        };
    }

    /** A canvas token placeable with ownership info. */
    interface Sf2eCanvasTokenPlaceable {
        readonly isOwner?: boolean;
        readonly actor?: Sf2eActor | null;
    }

    // ─── Sheet Types ─────────────────────────────────────────────────────

    /** An actor sheet with common accessor properties. */
    interface Sf2eActorSheet {
        readonly actor?: Actor.Implementation;
        readonly document?: Actor.Implementation;
        readonly object?: Actor.Implementation;
    }

    // ─── Game & Socket Types ─────────────────────────────────────────────


    /** A token from `game.user.targets` (canvas-layer target set). */
    interface Sf2eUserTargetToken {
        readonly actor?: Actor.Implementation;
        readonly document?: Sf2eTokenDocument;
        readonly uuid: string;
        readonly id?: string;
    }

    /** UUID-resolvable document types accepted by the public runtime API. */
    type Sf2eResolvedUuidDocumentName = "Actor" | "ChatMessage" | "Item" | "Token";

    type Sf2eResolvedUuidDocument =
        | (Actor.Implementation & { readonly documentName: "Actor" })
        | (ChatMessage.Implementation & { readonly documentName: "ChatMessage" })
        | (Item.Implementation & { readonly documentName: "Item" })
        | Sf2eTokenDocument;

    /** API attached to this module's Foundry package entry during init. */
    type Sf2eForgeCustomApi = import("../api.js").Sf2eForgeCustomApi;

    interface Sf2eGameModule {
        readonly active: boolean;
        api?: Sf2eForgeCustomApi;
    }

    /** SF2e game.pf2e / game.sf2e namespace. */
    interface Sf2eGameNamespace {
        Check: {
            roll: (
                check: Sf2eCheckModifierInstance,
                context?: Sf2eRawCheckRollContext,
                event?: Event | null,
                callback?: Sf2eRollCallback,
            ) => Promise<Roll | null>;
        };
        CheckModifier: new (
            name: string,
            statistic: { modifiers: Sf2eModifier[] },
            modifiers: Sf2eModifier[],
        ) => Sf2eCheckModifierInstance;
        Modifier: new (data: { label: string; modifier: number; type: string }) => Sf2eModifier;
    }

    /**
     * Extended game accessor with SF2e system-specific properties.
     * Cast `game` to this type when accessing PF2e/SF2e APIs that
     * are not part of fvtt-types.
     */
    interface Sf2eGame {
        pf2e?: Sf2eGameNamespace;
        user?: {
            readonly isGM: boolean;
            readonly id: string;
            targets?: Iterable<Sf2eUserTargetToken>;
            getActiveTokens?(): Sf2eActiveToken[];
        } | null;
        modules?: ReadonlyMap<string, Sf2eGameModule>;
        users?: {
            get(id: string): { isGM: boolean } | undefined;
        };
        settings?: {
            get(module: string, key: string): unknown;
        };
    }

    // ─── Foundry Globals ─────────────────────────────────────────────────

    /** Extended `foundry` namespace with CONST access. */
    interface Sf2eFoundryGlobal {
        CONST?: {
            CHAT_MESSAGE_TYPES?: Record<string, number>;
        };
    }

    // ─── Roll Term Types ─────────────────────────────────────────────────

    /** A die term from a Roll (e.g. the d20 in a check roll). */
    interface Sf2eRollDieTerm {
        readonly total?: number;
        readonly results?: ReadonlyArray<{ readonly result: number }>;
    }

    /** Resource spent by the PF2e reroll hook. */
    interface Sf2eRerollResource {
        readonly slug: string;
    }

    /** Mutable PF2e reroll options exposed to hook consumers. */
    interface Sf2eRerollHookOptions {
        keep?: "new" | "higher" | "lower";
    }

    // ─── Chat Message Flags ──────────────────────────────────────────────

    /** Typed shape for accessing `message.flags`. */
    type Sf2eMessageFlags = Record<string, Record<string, unknown> | undefined>;

    // ─── Actor System Data (partial, for DC extraction) ──────────────────

    /** Partial NPC/PC system data shape used for modifier and DC derivation. */
    interface Sf2eActorSystemData {
        saves?: Record<string, { value?: number }>;
        attributes?: {
            ac?: { value?: number };
            classDC?: { value?: number };
        };
        actions?: Array<{
            type?: string;
            item?: Item.Implementation;
            totalModifier?: number;
            variants?: Array<{ penalty?: number }>;
            statistic?: Sf2eStatistic;
            altUsages?: Array<{ statistic?: Sf2eStatistic }>;
        }>;
    }

    /** Partial spellcasting-entry system data. */
    interface Sf2eSpellcastingEntrySystemData {
        spelldc?: { dc?: number };
        dc?: { value?: number };
    }

    /** Partial strike/melee item system data. */
    interface Sf2eStrikeSystemData {
        bonus?: { value?: number };
    }

    /** Partial spell system data for save detection. */
    interface Sf2eSpellSystemData {
        defense?: {
            save?: {
                statistic?: string;
                basic?: boolean;
            };
        };
    }

    /** System flags shape (sf2e or pf2e namespace on `message.flags`). */
    interface Sf2eSystemFlags {
        modifiers?: Array<{
            label: string;
            modifier: number;
            type: string;
            enabled: boolean;
        }>;
        context?: {
            type?: string;
            dc?: { value: number };
            domains?: string[];
            options?: string[];
            target?: {
                actor?: string | { id?: string };
                token?: string;
            };
            origin?: {
                actor?: string;
                uuid?: string;
                token?: string;
            };
        };
        type?: string;
        origin?: {
            actor?: string;
            uuid?: string;
            rollOptions?: string[];
        };
        target?: {
            actor?: string | { id?: string };
            token?: string;
        };
    }

} // end declare global

declare module "fvtt-types/configuration" {
    interface ModuleConfig {
        "sf2e-forge-custom": {
            api: Sf2eForgeCustomApi;
        };
    }

    namespace Hooks {
        interface HookConfig {
            "pf2e.preReroll": (
                discardedRoll: Roll,
                unevaluatedNewRoll: Roll,
                resource: Sf2eRerollResource | null,
                options: Sf2eRerollHookOptions,
            ) => void;
            "pf2e.reroll": (
                discardedRoll: Roll,
                evaluatedNewRoll: Roll,
                resource: Sf2eRerollResource | null,
                options: Sf2eRerollHookOptions,
            ) => void;
        }
    }
}

export {};
