import { isFlying, type FlyingActor } from "./effect.js";
import { tokenHeight, type HeightToken } from "./height.js";

interface Combatant { actor: FlyingActor | null; token: HeightToken | null }
interface ChatMessageClass { create(data: object): Promise<unknown>; getSpeaker(options: object): object }

export function reminderText(name: string, height: number, units: string): string {
    return game.i18n!.format("codex-foundry.flying.reminder", { name, height: String(height), units });
}

/** At the start of a flying creature's turn, the client that advanced the turn posts a public reminder. */
export function onStartTurn(combatant: Combatant, _encounter: unknown, userId: string): void {
    if (userId !== game.user!.id || !combatant.token || !isFlying(combatant.actor)) return;
    const token = combatant.token;
    const ChatMessage = (globalThis as unknown as { ChatMessage: ChatMessageClass }).ChatMessage;
    const name = (token as unknown as { name: string }).name;
    void ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token, actor: combatant.actor }),
        content: `<p>${reminderText(name, tokenHeight(token), canvas!.grid!.units)}</p>`,
    });
}

export function activateFlyingReminder(): void {
    const hooks = Hooks as unknown as { on(name: string, callback: (...args: never[]) => unknown): void };
    hooks.on("pf2e.startTurn", onStartTurn);
}
