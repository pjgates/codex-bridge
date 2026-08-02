import { MODULE_ID } from "../constants.js";
import { decryptPayload } from "./crypto.js";
import type { SyncPayload } from "./payload-types.js";

export const SETTING_ENABLE_SYNC = "enableCodexSync";
export const SETTING_PASSPHRASE = "codexSyncPassphrase";
export const SETTING_LAST_MANIFEST = "codexSyncLastManifest";

export function registerSyncSettings(): void {
    game.settings!.register(MODULE_ID, SETTING_ENABLE_SYNC, {
        name: `${MODULE_ID}.settings.enableCodexSync.name`,
        hint: `${MODULE_ID}.settings.enableCodexSync.hint`,
        scope: "world", config: true, type: Boolean, default: true,
    });
    game.settings!.register(MODULE_ID, SETTING_PASSPHRASE, {
        name: `${MODULE_ID}.settings.codexSyncPassphrase.name`,
        hint: `${MODULE_ID}.settings.codexSyncPassphrase.hint`,
        // Client scope: lives in the GM's browser localStorage. Never world scope —
        // world settings replicate to every connected client.
        scope: "client", config: true, type: String, default: "",
    });
    game.settings!.register(MODULE_ID, SETTING_LAST_MANIFEST, {
        scope: "world", config: false, type: String, default: "",
    });
}

export class PayloadUnavailableError extends Error {}
export class PayloadDecryptError extends Error {}

export async function fetchAndDecryptPayload(): Promise<SyncPayload> {
    const route = foundry.utils.getRoute("codex-sync/payload.enc");
    let response: Response;
    try { response = await fetch(`${route}?t=${Date.now()}`, { cache: "no-store" }); }
    catch { throw new PayloadUnavailableError("codex-sync payload could not be fetched"); }
    if (!response.ok) throw new PayloadUnavailableError(`codex-sync payload fetch failed: HTTP ${response.status}`);
    const passphrase = game.settings!.get(MODULE_ID, SETTING_PASSPHRASE);
    if (!passphrase) throw new PayloadDecryptError("No sync passphrase set (module settings, this browser)");
    try { return await decryptPayload(await response.text(), passphrase); }
    catch { throw new PayloadDecryptError("Payload decryption failed — check the passphrase"); }
}
