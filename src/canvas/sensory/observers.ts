import type { DefinitionLookup, SensoryObserver, SensoryTokenDocument, SensoryUser } from "./types.js";
import { resolveApplications } from "./definition.js";
export function selectedObservers(selected: Iterable<SensoryTokenDocument>, user: SensoryUser, lookup: DefinitionLookup): SensoryObserver[] {
    const views: SensoryObserver[] = [];
    for (const document of selected) {
        if (!document.actor?.testUserPermission(user, "OWNER")) continue;
        const applications = resolveApplications(document.actor.items, lookup);
        if (!applications.length) continue;
        views.push({ tokenUuid: document.uuid, applications,
            position: { ...document.getCenterPoint(), levelId: document.level },
            listener: { ...document.getListenerPosition(), levelId: document.level } });
    }
    return views;
}
