export interface SensoryLevel {
    id: string; elevation: { bottom: number | null; top: number | null };
}
/** Resolve stored geometry without Foundry's rendered-level visibility filter. */
export function sensoryLevelAtElevation(levels: Iterable<SensoryLevel>, elevation: number, allowed: ReadonlySet<string>, viewedId: string): string {
    const candidates = [...levels].filter(level => (!allowed.size || allowed.has(level.id))
        && elevation >= (level.elevation.bottom ?? -Infinity) && elevation <= (level.elevation.top ?? Infinity));
    const boundaryRank = (level: SensoryLevel) => elevation === level.elevation.bottom ? 1 : elevation === level.elevation.top ? 2 : 0;
    candidates.sort((a, b) => boundaryRank(a) - boundaryRank(b) || Number(b.id === viewedId) - Number(a.id === viewedId));
    return candidates[0]?.id ?? viewedId;
}
