import { isFlying, type FlyingActor } from "./effect.js";

/**
 * Falling rules for PF2e and SF2e: half the distance as bludgeoning damage past 5 ft, prone on any
 * damage, adjusted by the abilities that shorten, halve or negate a fall. Pure: no Foundry globals.
 */

/** Conditions whose arrival drops a flying creature. */
export const FALL_CONDITIONS: ReadonlySet<string> = new Set(["prone", "unconscious", "paralyzed", "petrified"]);
/** Movement actions a flyer may use without landing. */
const FLIGHT_ACTIONS: ReadonlySet<string> = new Set(["fly", "blink", "displace", "codex-forced", "codex-fall"]);

/** Feet a fall is shortened by, indexed by proficiency rank; a legendary rank negates it instead. */
const SHORTEN_BY_RANK: Record<string, { skill: "acrobaticsRank" | "athleticsRank"; feet: number[] }> = {
    "cat-fall": { skill: "acrobaticsRank", feet: [0, 10, 25, 50] },
    "superhero-landing": { skill: "athleticsRank", feet: [0, 20, 50, 100] },
};
const SHORTEN_FLAT: Record<string, number> = { "wind-pillow": 10 };
const HALVE: ReadonlySet<string> = new Set(["plumekith", "land-on-your-feet"]);
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
    const effective = Math.max(0, (has("rubbery-body") ? distance / 2 : distance) - shortened.reduce((sum, s) => sum + s.feet, 0));
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
const TRACKED = new Set([...Object.keys(SHORTEN_BY_RANK), ...Object.keys(SHORTEN_FLAT), "rubbery-body", ...HALVE, ...IMMUNE, "impressive-landing", "arrest-a-fall", "rolling-landing"]);

// PF2e actor shapes not represented by the type packages.
export interface ProfileActor {
    items: Iterable<{ type: string; name: string; isExpired?:boolean; system: { slug?: string | null } }>;
    skills?: Record<string, { rank?: number } | undefined>;
    system: { movement?: { speeds?: { fly?: { value?: number } | null } } };
}

export function fallProfile(actor: ProfileActor): FallProfile {
    const abilities = new Map<string, string>();
    for (const item of actor.items) {
        const slug = item.system.slug;
        if (slug && !item.isExpired && PROFILE_TYPES.has(item.type) && TRACKED.has(slug)) abilities.set(slug, item.name);
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
interface FlightActor extends FlyingActor {system?:{movement?:{speeds?:{fly?:{value:number}|null}}}}
interface FlightToken {uuid:string;actor:FlightActor|null}
interface FlightItem {type:string;system:{slug?:string|null};actor?:FlightActor|null}

/** One active GM observes flight loss; movement owns all choices and consequences. */
export function activateFalling(requestFall:(tokenUuid:string)=>Promise<void>):void {
    const hooks=Hooks as unknown as {on(name:string,callback:(...args:never[])=>unknown):void};
    const pending=new Set<string>();
    const request=(token:FlightToken):void=>{
        if(game.users?.activeGM?.id!==game.user?.id || pending.has(token.uuid)) return;
        pending.add(token.uuid);
        void requestFall(token.uuid).finally(()=>pending.delete(token.uuid));
    };
    const all=(actor:FlightActor):void=>{for(const token of actor.getActiveTokens(false,true) as unknown as FlightToken[]) request(token);};
    const checkSpeed=(actor:FlightActor):void=>{if(isFlying(actor) && !actor.system?.movement?.speeds?.fly?.value) all(actor);};
    hooks.on("moveToken",(token:FlightToken,movement:{passed:{waypoints:{action:string}[]};pending:{waypoints:unknown[]}},options:{codexMovementPlanned?:boolean})=>{
        if(options.codexMovementPlanned || movement.pending.waypoints.length || !isFlying(token.actor)) return;
        if(endsFlight(movement.passed.waypoints,CONFIG.Token.movement.actions)) request(token);
    });
    hooks.on("createItem",(item:FlightItem)=>{
        if(item.type==="condition" && FALL_CONDITIONS.has(item.system.slug??"") && item.actor && isFlying(item.actor)) all(item.actor);
    });
    hooks.on("deleteItem",(item:FlightItem)=>{
        if(item.type==="effect" && item.system.slug==="codex-flying" && item.actor) all(item.actor);
        else if(item.actor) checkSpeed(item.actor);
    });
    hooks.on("updateItem",(item:FlightItem)=>{if(item.actor)checkSpeed(item.actor);});
    hooks.on("updateActor",checkSpeed);
}
