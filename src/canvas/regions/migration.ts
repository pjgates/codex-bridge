export interface MigrationRequest { sceneUuids: readonly string[]; apply?: boolean }
export interface SceneMigration { sceneUuid: string; changed: string[]; error?: string }
export type MigrationResult = { ok: true; scenes: SceneMigration[] } | { ok: false; error: { code: "unauthorized" | "invalid-argument"; message: string } };
export function legacyTypeUpdate(source: { _id: string; type: string }): { _id: string; type: string } | null {
    if (source.type === "map-workshop-importer.setElevation") return { _id: source._id, type: "codex-foundry.setElevation" };
    if (source.type === "map-workshop-importer.water") return { _id: source._id, type: "codex-foundry.water" };
    if (source.type === "map-workshop-importer.surfaceGeometry") return { _id: source._id, type: "codex-foundry.surfaceGeometry" };
    return null;
}
interface MigrationScene {
    documentName: string;
    regions: Iterable<{ behaviors: Iterable<{ id: string; type: string; uuid: string; toObject():{system:object} }>; updateEmbeddedDocuments(type: string, updates: object[]): Promise<unknown> }>;
}
/** Explicit scene scope, preview by default; never disables the legacy provider. */
export async function migrateLegacy(request: MigrationRequest): Promise<MigrationResult> {
    if (!game.user?.isGM) return { ok: false, error: { code: "unauthorized", message: "Only a GM can migrate region behaviours." } };
    if (!request || !Array.isArray(request.sceneUuids) || request.sceneUuids.length > 1000 ||
        request.sceneUuids.some(uuid => typeof uuid !== "string" || !/^Scene\.[A-Za-z0-9_-]{1,64}$/.test(uuid)) ||
        (request.apply !== undefined && typeof request.apply !== "boolean")) {
        return { ok: false, error: { code: "invalid-argument", message: "Supply sceneUuids and an optional boolean apply." } };
    }
    const scenes: SceneMigration[] = [];
    for (const sceneUuid of new Set(request.sceneUuids)) {
        const result: SceneMigration = { sceneUuid, changed: [] }; scenes.push(result);
        try {
            const scene = fromUuidSync(sceneUuid) as unknown as MigrationScene | null;
            if (scene?.documentName !== "Scene") throw new Error("Scene not found.");
            for (const region of scene.regions) {
                for (const behavior of [...region.behaviors]) {
                    const update = legacyTypeUpdate({ _id: behavior.id, type: behavior.type });
                    if (!update) continue;
                    if (request.apply) {
                        // Foundry v14 requires full system replacement when changing a typed document's type.
                        const { ForcedReplacement } = (foundry.data as unknown as {operators:{ForcedReplacement:new(value:object)=>object}}).operators;
                        await region.updateEmbeddedDocuments("RegionBehavior", [{...update,system:new ForcedReplacement(behavior.toObject().system)}]);
                        if([...region.behaviors].find(current=>current.id===behavior.id)?.type!==update.type) {
                            throw new Error(`Behaviour ${behavior.id}: type migration was not applied.`);
                        }
                    }
                    result.changed.push(behavior.uuid);
                }
            }
        } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
    }
    return { ok: true, scenes };
}
