import type { SensoryObserver, SensoryEmitter, SensoryGlow } from "./types.js";
export type SensoryWallTest = (viewer: SensoryObserver, emitter: SensoryEmitter) => boolean;
export function detectGlows(observers: readonly SensoryObserver[], emitters: readonly SensoryEmitter[], distancePixels: number, wallBlocks: SensoryWallTest): SensoryGlow[] {
    const glows: SensoryGlow[] = [];
    for (const emitter of emitters) {
        const candidates = observers.flatMap(viewer => {
            if (viewer.tokenUuid === emitter.documentUuid) return [];
            const distance = Math.hypot((emitter.position.x - viewer.position.x) / distancePixels,
                (emitter.position.y - viewer.position.y) / distancePixels, emitter.position.elevation - viewer.position.elevation);
            const eligible = viewer.applications.some(({ definition, rank }) => definition.channel === emitter.channel
                && definition.glow.enabled && rank >= definition.glow.minRank && distance <= definition.glow.range
                && (!definition.glow.walls || !wallBlocks(viewer, emitter)));
            return eligible ? [{ viewer, distance }] : [];
        }).sort((a, b) => a.distance - b.distance || a.viewer.tokenUuid.localeCompare(b.viewer.tokenUuid));
        if (!candidates.length) continue;
        const viewer = candidates[0].viewer;
        glows.push({ emitter, viewerUuid: viewer.tokenUuid,
            direction: Math.sign(emitter.position.elevation - viewer.position.elevation) as -1 | 0 | 1 });
    }
    return glows;
}
export function nativeSensoryWallBlocks(viewer: SensoryObserver, emitter: SensoryEmitter): boolean {
    const mode = foundry.canvas.perception.DetectionMode as unknown as {
        _testCollision(source: { origin: object; level: unknown; priority: number },
            test: { point: object; level: unknown }, config: { type: string; angle: number }): boolean;
    };
    const scene = canvas!.scene as unknown as { levels: { get(id: string): unknown } };
    return mode._testCollision({ origin: viewer.position, level: scene.levels.get(viewer.position.levelId), priority: 0 },
        { point: emitter.position, level: scene.levels.get(emitter.position.levelId) }, { type: "sight", angle: 360 });
}
