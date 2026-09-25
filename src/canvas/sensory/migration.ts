import { MODULE_ID } from "../../constants.js";
import { legacySensoryRules, sensoryFlag } from "./definition.js";
import { sensoryRuleKeys } from "./rules.js";

/** Preserve canonical identities and actor counters while moving settings into native rules. */
export async function migrateSensoryEffects(): Promise<void> {
    if (!game.user?.isGM) return;
    for (const item of game.items?.contents ?? []) {
        if (String(item.type) !== "effect" || item.isEmbedded || item.pack) continue;
        const legacy = sensoryFlag(item.flags, "sensory");
        if (legacy === undefined) continue;
        const { rules } = item.toObject().system as { rules: Record<string, unknown>[] };
        const authored = rules.some(rule => sensoryRuleKeys.some(key => key === rule.key));
        const changes: Record<string, unknown> = {
            ...(!authored ? { "system.rules": [...rules, ...legacySensoryRules(legacy)] } : {}),
            [`flags.${MODULE_ID}.-=sensory`]: null,
        };
        await item.update(changes);
    }
}
