/**
 * Vault Sync — feature barrel for hooks and external callers.
 */

export {
    registerSyncSettings,
    SETTING_ENABLE_SYNC,
    SETTING_PASSPHRASE,
    SETTING_LAST_MANIFEST,
} from "./settings.js";
export {
    checkForVaultUpdates,
    openSyncDialog,
    registerSyncSettingsButton,
    registerSyncTemplates,
} from "./dialog.js";
