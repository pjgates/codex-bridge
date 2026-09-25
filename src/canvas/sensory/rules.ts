import type { SensoryRule } from "./types.js";
export const sensoryRuleKeys = ["CodexEmitSignal", "CodexPerceiveSignal", "CodexHearSignal"] as const;
const positiveRank = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Native rule forms omit default-valued fields from persisted system.rules. */
export function readSensoryRules(source: unknown): SensoryRule[] {
    if (!Array.isArray(source)) return [];
    return source.flatMap((raw): SensoryRule[] => {
        if (!raw || typeof raw !== "object" || !sensoryRuleKeys.includes(raw.key)) return [];
        if (typeof raw.channel !== "string" || !raw.channel.trim() || raw.ignored || raw.spinoff
            || (raw.predicate !== undefined && !Array.isArray(raw.predicate))) return [];
        const base = { ...raw, channel: raw.channel };
        if (raw.key === "CodexEmitSignal") {
            if (raw.appearance !== undefined && raw.appearance !== "glow" && raw.appearance !== "light") return [];
            if (raw.light !== undefined && (!raw.light || typeof raw.light !== "object" || Array.isArray(raw.light))) return [];
            const { strength = "rank", fixed = 1, colour = "#ffffff" } = raw;
            return (strength === "rank" || strength === "fixed") && finite(fixed) && (strength !== "fixed" || fixed > 0)
                && typeof colour === "string" && /^#[\da-f]{6}$/i.test(colour)
                ? [{ ...base, key: raw.key, strength, fixed, colour }] : [];
        }
        const minRank = raw.minRank === undefined ? 1 : raw.minRank;
        if (!positiveRank(minRank)) return [];
        if (raw.key === "CodexHearSignal") return [{ ...base, key: raw.key, minRank }];
        const { range = 0, walls = false } = raw;
        return finite(range) && range > 0 && typeof walls === "boolean"
            ? [{ ...base, key: raw.key, minRank, range, walls }] : [];
    });
}
