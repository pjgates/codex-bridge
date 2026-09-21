import { isFlying, setFlying, type FlyingActor } from "./effect.js";
import { landingSurface, type HeightToken } from "./height.js";

/**
 * Falling rules for PF2e and SF2e: half the distance as bludgeoning damage past 5 ft, prone on any
 * damage, adjusted by the abilities that shorten, halve or negate a fall. Pure: no Foundry globals.
 */

/** Conditions whose arrival drops a flying creature. */
export const FALL_CONDITIONS: ReadonlySet<string> = new Set(["prone", "unconscious", "paralyzed", "petrified", "grabbed"]);
/** Movement actions a flyer may use without landing. */
const FLIGHT_ACTIONS: ReadonlySet<string> = new Set(["fly", "blink", "displace"]);

/** Feet a fall is shortened by, indexed by proficiency rank; a legendary rank negates it instead. */
const SHORTEN_BY_RANK: Record<string, { skill: "acrobaticsRank" | "athleticsRank"; feet: number[] }> = {
    "cat-fall": { skill: "acrobaticsRank", feet: [0, 10, 25, 50] },
    "superhero-landing": { skill: "athleticsRank", feet: [0, 20, 50, 100] },
};
const SHORTEN_FLAT: Record<string, number> = { "wind-pillow": 10 };
const HALVE: ReadonlySet<string> = new Set(["plumekith", "rubbery-body", "land-on-your-feet"]);
const IMMUNE: ReadonlySet<string> = new Set(["unbreakable-er-goblin", "current-rider", "basic-insectile-flight", "bouncy-orb-bantrid", "spell-effect-ash-form"]);
const UPRIGHT: ReadonlySet<string> = new Set(["land-on-your-feet"]);
const FREE_FALL_FEET = 5;

export interface FallProfile {
    acrobaticsRank: number;
    athleticsRank: number;
    /** Relevant feats, heritages, effects and actions on the actor: slug to display name. */
    abilities: Map<string, string>;
    hasFlySpeed: boolean;
}

export interface FallOutcome {
    distance: number;
    /** Distance after shortening, the number the damage is read from. */
    effective: number;
    damage: number;
    prone: boolean;
    shortened: { slug: string; feet: number }[];
    halved: string[];
    immune: string[];
    /** Optional reactions the actor could take against this fall. */
    reactions: string[];
}

export function fallOutcome(distance: number, profile: FallProfile): FallOutcome {
    const has = (slug: string): boolean => profile.abilities.has(slug);
    const shortened: FallOutcome["shortened"] = [];
    const immune = [...IMMUNE].filter(has);
    let upright = [...UPRIGHT].some(has);
    for (const [slug, { skill, feet }] of Object.entries(SHORTEN_BY_RANK)) {
        if (!has(slug)) continue;
        const rank = profile[skill];
        if (rank >= 4) { immune.push(slug); upright = true; }
        else if (feet[rank] > 0) shortened.push({ slug, feet: feet[rank] });
    }
    for (const [slug, feet] of Object.entries(SHORTEN_FLAT)) if (has(slug)) shortened.push({ slug, feet });
    const effective = Math.max(0, distance - shortened.reduce((sum, s) => sum + s.feet, 0));
    const halved = [...HALVE].filter(has);
    let damage = effective > FREE_FALL_FEET ? Math.floor(effective / 2) : 0;
    if (halved.length) damage = Math.floor(damage / 2);
    if (immune.length) damage = 0;
    const reactions: string[] = [];
    if (has("impressive-landing") && distance >= 10) reactions.push("impressive-landing");
    if (has("arrest-a-fall") && profile.hasFlySpeed) reactions.push("arrest-a-fall");
    if (has("rolling-landing") && distance > FREE_FALL_FEET && damage === 0) reactions.push("rolling-landing");
    return { distance, effective, damage, prone: damage > 0 && !upright, shortened, halved, immune, reactions };
}

const PROFILE_TYPES: ReadonlySet<string> = new Set(["feat", "heritage", "effect", "action"]);
const TRACKED = new Set([...Object.keys(SHORTEN_BY_RANK), ...Object.keys(SHORTEN_FLAT), ...HALVE, ...IMMUNE, "impressive-landing", "arrest-a-fall", "rolling-landing"]);

// PF2e actor shapes not represented by the type packages.
export interface ProfileActor {
    items: Iterable<{ type: string; name: string; system: { slug?: string | null } }>;
    skills?: Record<string, { rank?: number } | undefined>;
    system: { movement?: { speeds?: { fly?: { value?: number } | null } } };
}

export function fallProfile(actor: ProfileActor): FallProfile {
    const abilities = new Map<string, string>();
    for (const item of actor.items) {
        const slug = item.system.slug;
        if (slug && PROFILE_TYPES.has(item.type) && TRACKED.has(slug)) abilities.set(slug, item.name);
    }
    return {
        acrobaticsRank: actor.skills?.acrobatics?.rank ?? 0,
        athleticsRank: actor.skills?.athletics?.rank ?? 0,
        abilities,
        hasFlySpeed: (actor.system.movement?.speeds?.fly?.value ?? 0) > 0,
    };
}

/** The level whose elevation band holds the landing height; the current level wins ties and empty inputs. */
export function landingLevel(levels: readonly { id: string; bottom: number; top: number }[], current: string, elevation: number): string {
    const holds = (level: { bottom: number; top: number }): boolean => elevation >= level.bottom && (elevation < level.top || elevation === level.bottom);
    const own = levels.find(level => level.id === current);
    if (!own || holds(own)) return current;
    return levels.find(holds)?.id ?? current;
}

/**
 * A move ends flight when it finishes on a ground action: anything but the flight actions and
 * teleports. Only the final waypoint counts, because Foundry folds earlier queued segments into
 * `passed`, and those may predate the flight.
 */
export function endsFlight(waypoints: readonly { action: string }[], actions: Record<string, { teleport?: boolean } | undefined>): boolean {
    const last = waypoints.at(-1);
    return !!last && !FLIGHT_ACTIONS.has(last.action) && !actions[last.action]?.teleport;
}

// ─── Foundry glue ────────────────────────────────────────────────────────────

interface FallToken extends HeightToken {
    id: string; name: string; uuid: string;
    actor: (FlyingActor & ProfileActor) | null;
    parent: (HeightToken["parent"] & { levels: { get(id: string): { elevation: { base: number } } | undefined; contents: { id: string; elevation: { bottom: number; top: number } }[] } }) | null;
    update(changes: object): Promise<unknown>;
}
interface FallMovement { origin: { elevation: number }; passed: { waypoints: { action: string }[] }; pending: { waypoints: unknown[] } }
interface ChatMessageClass { create(data: object): Promise<unknown>; getSpeaker(options: object): object }

const round = (value: number): number => Math.round(value * 100) / 100;

export function fallCardContent(name: string, outcome: FallOutcome, profile: FallProfile, units: string): string {
    const t = (key: string, data: Record<string, string> = {}): string => game.i18n!.format(`codex-foundry.flying.fall.${key}`, data);
    const named = (slug: string): string => profile.abilities.get(slug) ?? slug;
    const lines = [`<p><strong>${t("title", { name, distance: String(round(outcome.distance)), units })}</strong></p>`];
    const notes = [
        ...outcome.shortened.map(s => t("shortened", { name: named(s.slug), feet: String(s.feet), units })),
        ...outcome.halved.map(slug => t("halved", { name: named(slug) })),
        ...outcome.immune.map(slug => t("immune", { name: named(slug) })),
    ];
    if (notes.length) lines.push(`<p>${notes.join("<br>")}</p>`);
    lines.push(`<p>${outcome.damage > 0 ? t("damage", { damage: String(outcome.damage) }) : t("noDamage")}</p>`);
    if (outcome.prone) lines.push(`<p>${t("prone")}</p>`);
    if (outcome.reactions.length) lines.push(`<p><em>${t("reactions", { names: outcome.reactions.map(named).join(", ") })}</em></p>`);
    return lines.join("");
}

/** Land the token on the surface below, end its flight and post the fall card. `from` is the height it fell from. */
export async function fall(token: FallToken, from = token.elevation): Promise<void> {
    const { actor } = token;
    if (!actor) return;
    const { surface, base } = landingSurface(token, from);
    const landing = surface ?? base;
    const levels = token.parent?.levels.contents.map(level => ({ id: level.id, bottom: level.elevation.bottom, top: level.elevation.top })) ?? [];
    const level = landingLevel(levels, token.level, landing);
    if (token.elevation !== landing || token.level !== level) await token.update({ elevation: landing, level });
    await setFlying(actor, false);
    const distance = from - landing;
    if (distance <= 0) return;
    const profile = fallProfile(actor);
    const ChatMessage = (globalThis as unknown as { ChatMessage: ChatMessageClass }).ChatMessage;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token, actor }),
        content: fallCardContent(token.name, fallOutcome(distance, profile), profile, canvas!.grid!.units),
    });
}

function onMoveToken(token: FallToken, movement: FallMovement, _operation: unknown, user: { id: string }): void {
    if (user.id !== game.user!.id || movement.pending.waypoints.length || !isFlying(token.actor)) return;
    const actions = CONFIG.Token.movement.actions as Record<string, { teleport?: boolean } | undefined>;
    if (!endsFlight(movement.passed.waypoints, actions)) return;
    void fall(token, movement.origin.elevation);
}

function onCreateItem(item: { type: string; system: { slug?: string | null }; actor?: (FlyingActor & { getActiveTokens(linked?: boolean, document?: boolean): unknown[] }) | null }, _options: object, userId: string): void {
    if (userId !== game.user!.id || item.type !== "condition" || !item.system.slug || !FALL_CONDITIONS.has(item.system.slug)) return;
    if (!item.actor || !isFlying(item.actor)) return;
    for (const token of item.actor.getActiveTokens(false, true) as FallToken[]) void fall(token);
}

export function activateFalling(): void {
    const hooks = Hooks as unknown as { on(name: string, callback: (...args: never[]) => unknown): void };
    hooks.on("moveToken", onMoveToken);
    hooks.on("createItem", onCreateItem);
}
