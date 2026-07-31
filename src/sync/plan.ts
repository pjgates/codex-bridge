import type { SyncPayload } from "./payload-types.js";

export type ManagedDocType = "JournalEntry" | "Actor";
export type SyncKind = "entity-journal" | "people-actor" | "creature-actor";

/** Snapshot of one world document relevant to sync; built by the import layer. */
export interface WorldDocSnapshot {
    docType: ManagedDocType;
    id: string;
    name: string;
    syncId: string | null; // flags[MODULE_ID].syncId
    syncKind: SyncKind | null; // flags[MODULE_ID].syncKind
    importedHash: string | null; // payload-domain contentHash stored at create/import time
    importedBaseline: string | null; // creature-actor only: actor-state hash recomputed at snapshot time, for modified-in-Foundry detection
    currentHash: string | null;
}

export interface SyncItem {
    kind: SyncKind;
    docType: ManagedDocType;
    syncId: string;
    name: string;
    contentHash: string;
}

export interface SyncAction { item: SyncItem; }
export interface AdoptAction extends SyncAction { existingId: string; }
export interface UpdateAction extends SyncAction { existingId: string; }
export interface ReimportAction extends SyncAction { existingId: string; modifiedInFoundry: boolean; }
export interface StaleDoc { docType: ManagedDocType; id: string; name: string; syncId: string; kind: SyncKind; }

export interface SyncPlan {
    adopt: AdoptAction[]; // unflagged, exact name match, no syncId flag yet
    create: SyncAction[]; // journals + people-actors with changed contentHash – automatic
    update: UpdateAction[];
    reimport: ReimportAction[]; // creature-actors with changed contentHash – GM confirms each
    unchanged: number;
    stale: StaleDoc[]; // flagged docs whose syncId left the payload
}

/** Composite identity key used for approvals and world lookups. */
export function actionKey(docType: ManagedDocType, syncId: string): string {
    return `${docType}:${syncId}`;
}

export function payloadItems(payload: SyncPayload): SyncItem[] {
    const items: SyncItem[] = [];

    for (const entity of payload.entities) {
        items.push({ kind: "entity-journal", docType: "JournalEntry", syncId: entity.syncId, name: entity.name, contentHash: entity.contentHash });
        if (entity.type === "Character" && entity.portrait) {
            items.push({ kind: "people-actor", docType: "Actor", syncId: entity.syncId, name: entity.name, contentHash: entity.contentHash });
        }
    }

    for (const creature of payload.creatures) {
        items.push({ kind: "creature-actor", docType: "Actor", syncId: creature.syncId, name: creature.name, contentHash: creature.contentHash });
    }

    return items;
}

export function computeSyncPlan(payload: SyncPayload, world: WorldDocSnapshot[]): SyncPlan {
    const plan: SyncPlan = { adopt: [], create: [], update: [], reimport: [], unchanged: 0, stale: [] };
    const flagged = new Map(world.filter((doc) => doc.syncId).map((doc) => [actionKey(doc.docType, doc.syncId!), doc]));

    // Adoption candidates grouped by (docType, name); a candidate is consumed at most once,
    // and a group with 2+ candidates is ambiguous and never auto-matched.
    const unflaggedByName = new Map<string, WorldDocSnapshot[]>();
    for (const doc of world.filter((doc) => !doc.syncId)) {
        const key = `${doc.docType}:${doc.name}`;
        unflaggedByName.set(key, [...(unflaggedByName.get(key) ?? []), doc]);
    }

    // Two payload items with the same (docType, name) also never adopt.
    const items = payloadItems(payload);
    const itemNameCounts = new Map<string, number>();
    for (const item of items) {
        const key = `${item.docType}:${item.name}`;
        itemNameCounts.set(key, (itemNameCounts.get(key) ?? 0) + 1);
    }

    const seen = new Set<string>();
    for (const item of items) {
        const key = actionKey(item.docType, item.syncId);
        seen.add(key);
        const existing = flagged.get(key);
        if (existing) {
            if (existing.importedHash === item.contentHash) {
                plan.unchanged += 1;
            } else if (item.kind === "creature-actor") {
                // importedHash detects payload-side change; importedBaseline vs currentHash detects Foundry-side edits.
                plan.reimport.push({ item, existingId: existing.id, modifiedInFoundry: existing.currentHash !== null && existing.importedBaseline !== null && existing.currentHash !== existing.importedBaseline });
            } else {
                plan.update.push({ item, existingId: existing.id });
            }
            continue;
        }

        const nameKey = `${item.docType}:${item.name}`;
        const candidates = unflaggedByName.get(nameKey);
        if (candidates?.length === 1 && itemNameCounts.get(nameKey) === 1) {
            plan.adopt.push({ item, existingId: candidates[0].id });
            unflaggedByName.delete(nameKey); // consume (one-to-one)
        } else {
            plan.create.push({ item });
        }
    }

    for (const doc of world) {
        if (doc.syncId && doc.syncKind && !seen.has(actionKey(doc.docType, doc.syncId))) {
            plan.stale.push({ docType: doc.docType, id: doc.id, name: doc.name, syncId: doc.syncId, kind: doc.syncKind });
        }
    }

    return plan;
}
