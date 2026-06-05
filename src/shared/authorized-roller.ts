interface AuthorizedRollUser {
    readonly id?: string;
    readonly active?: boolean;
    readonly isGM?: boolean;
    readonly character?: Actor.Implementation | null;
}

type AuthorizableDocument = {
    readonly canUserModify?: (user: AuthorizedRollUser, action: "update") => boolean;
    readonly testUserPermission?: (user: AuthorizedRollUser, permission: "OWNER") => boolean;
};

function compareUserIds(left: AuthorizedRollUser, right: AuthorizedRollUser): number {
    const leftId = left.id ?? "";
    const rightId = right.id ?? "";
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function isSameUser(left: AuthorizedRollUser | null | undefined, right: AuthorizedRollUser | null | undefined): boolean {
    if (!left || !right) return false;
    return typeof left.id === "string" && typeof right.id === "string" ? left.id === right.id : left === right;
}

function getActiveUsers(): AuthorizedRollUser[] {
    const current = game.user as AuthorizedRollUser | null | undefined;
    const collection = game.users as unknown as Iterable<AuthorizedRollUser | readonly [unknown, AuthorizedRollUser]> | null | undefined;
    const entries = collection && Symbol.iterator in Object(collection) ? [...collection] : [];
    const users = entries.map((entry) => Array.isArray(entry) ? entry[1] : entry) as AuthorizedRollUser[];
    if (current && !users.some((user) => isSameUser(user, current))) users.push(current);
    return users.filter((user) => user.active !== false).sort(compareUserIds);
}

function isMessageAuthor(message: ChatMessage.Implementation, user: AuthorizedRollUser): boolean {
    const authoredMessage = message as unknown as { readonly author?: AuthorizedRollUser; readonly user?: AuthorizedRollUser };
    const author = authoredMessage.author ?? authoredMessage.user;
    if (author) return isSameUser(author, user);

    const current = game.user as AuthorizedRollUser | null | undefined;
    return isSameUser(user, current) && (message as Sf2eChatMessage).isAuthor === true;
}

function canUpdate(document: object, user: AuthorizedRollUser): boolean {
    const canUserModify = (document as unknown as AuthorizableDocument).canUserModify;
    if (typeof canUserModify === "function") return canUserModify.call(document, user, "update");
    if (user.isGM === true) return true;

    return isMessageAuthor(document as ChatMessage.Implementation, user);
}

function ownsActor(actor: Actor.Implementation, user: AuthorizedRollUser): boolean {
    const document = actor as Actor.Implementation & AuthorizableDocument;
    if (typeof document.testUserPermission === "function") return document.testUserPermission(user, "OWNER");
    if (typeof document.canUserModify === "function") return document.canUserModify(user, "update");
    return false;
}

function ownsTarget(token: Sf2eTokenDocument, user: AuthorizedRollUser): boolean {
    const actor = token.actor;
    if (actor && ownsActor(actor, user)) return true;

    const document = token as Sf2eTokenDocument & AuthorizableDocument;
    if (typeof document.testUserPermission === "function") return document.testUserPermission(user, "OWNER");
    if (typeof document.canUserModify === "function") return document.canUserModify(user, "update");

    const current = game.user as AuthorizedRollUser | null | undefined;
    return isSameUser(user, current) && token.isOwner === true;
}

function selectByPriority(
    actor: Actor.Implementation | null,
    isEligibleOwner: (user: AuthorizedRollUser) => boolean,
): AuthorizedRollUser | undefined {
    let selected: AuthorizedRollUser | undefined;
    let selectedPriority = Number.POSITIVE_INFINITY;

    for (const user of getActiveUsers()) {
        const eligibleOwner = isEligibleOwner(user);
        const priority = !user.isGM && actor && user.character === actor && eligibleOwner
            ? 0
            : !user.isGM && eligibleOwner
                ? 1
                : user.isGM
                    ? 2
                    : Number.POSITIVE_INFINITY;
        if (priority < selectedPriority) {
            selected = user;
            selectedPriority = priority;
        }
    }

    return selected;
}

/** Select the one active authorized user permitted to persist a roll for this card target. */
function getDesignatedTargetRoller(
    message: ChatMessage.Implementation,
    token: Sf2eTokenDocument,
): AuthorizedRollUser | undefined {
    return selectByPriority(token.actor, (user) => ownsTarget(token, user) && canUpdate(message, user));
}

/** Select the one active target owner permitted to create a roll message, with a stable GM fallback. */
function getDesignatedTargetRollCreator(token: Sf2eTokenDocument): AuthorizedRollUser | undefined {
    return selectByPriority(token.actor, (user) => ownsTarget(token, user));
}

/** Return whether this client is the deterministic active authorized roller for a card target. */
export function isCurrentUserDesignatedTargetRoller(
    message: ChatMessage.Implementation,
    token: Sf2eTokenDocument,
): boolean {
    return isSameUser(getDesignatedTargetRoller(message, token), game.user as AuthorizedRollUser | null | undefined);
}

/** Return whether this client is the deterministic creator of a roll message for a target. */
export function isCurrentUserDesignatedTargetRollCreator(token: Sf2eTokenDocument): boolean {
    return isSameUser(getDesignatedTargetRollCreator(token), game.user as AuthorizedRollUser | null | undefined);
}

/**
 * Return whether this client is the deterministic active controller for an overcome caster.
 * Explicit PRAD casters require actor ownership; normal spell cards may use their author.
 */
export function isCurrentUserDesignatedActorRoller(
    message: ChatMessage.Implementation,
    actor: Actor.Implementation,
    allowMessageAuthor: boolean,
): boolean {
    const selected = selectByPriority(
        actor,
        (user) => (ownsActor(actor, user) || (allowMessageAuthor && isMessageAuthor(message, user))) && canUpdate(message, user),
    );
    return isSameUser(selected, game.user as AuthorizedRollUser | null | undefined);
}
