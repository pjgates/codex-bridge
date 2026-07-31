import { MODULE_ID } from "../constants.js";
import { resolveHtmlRoot } from "../shared/html.js";
import { computeSyncPlan, actionKey, type SyncPlan } from "./plan.js";
import {
    applySyncPlan,
    snapshotWorld,
    type ApprovedActions,
    type SyncReport,
} from "./import.js";
import type { SyncPayload } from "./payload-types.js";
import {
    fetchAndDecryptPayload,
    PayloadDecryptError,
    PayloadUnavailableError,
    SETTING_ENABLE_SYNC,
    SETTING_LAST_MANIFEST,
} from "./settings.js";

const TEMPLATE_SYNC_DIALOG = `modules/${MODULE_ID}/dist/templates/sync/sync-dialog.hbs`;

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const SyncDialogBase = HandlebarsApplicationMixin(ApplicationV2);

let decryptWarnShown = false;

let notificationClickBound = false;

function ensureVaultUpdateNotificationHandler(): void {
    if (notificationClickBound) return;
    notificationClickBound = true;
    document.body.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest("button.forge-sync-notification-open");
        if (!button) return;
        event.preventDefault();
        void openSyncDialog();
    });
}


function syncGatesPass(): boolean {
    if (!game.user?.isGM) return false;
    if (!game.settings!.get(MODULE_ID, "enableCustomRules")) return false;
    if (!game.settings!.get(MODULE_ID, SETTING_ENABLE_SYNC)) return false;
    return true;
}

export function registerSyncTemplates(): void {
    foundry.applications.handlebars.loadTemplates([TEMPLATE_SYNC_DIALOG]);
}

function planDialogContext(plan: SyncPlan, report: SyncReport | null): Record<string, unknown> {
    const adopt = plan.adopt.map((action) => ({
        key: actionKey(action.item.docType, action.item.syncId),
        name: action.item.name,
        docType: action.item.docType,
    }));
    const create = plan.create.map((action) => ({
        name: action.item.name,
        docType: action.item.docType,
    }));
    const update = plan.update.map((action) => ({
        name: action.item.name,
        docType: action.item.docType,
    }));
    const reimport = plan.reimport.map((action) => ({
        key: actionKey(action.item.docType, action.item.syncId),
        name: action.item.name,
        modifiedInFoundry: action.modifiedInFoundry,
    }));
    const stale = plan.stale.map((doc) => ({
        key: actionKey(doc.docType, doc.syncId),
        name: doc.name,
        docType: doc.docType,
    }));
    const hasWork =
        adopt.length > 0 ||
        create.length > 0 ||
        update.length > 0 ||
        reimport.length > 0 ||
        stale.length > 0;

    return {
        adopt,
        create,
        update,
        reimport,
        stale,
        unchanged: plan.unchanged > 0 ? plan.unchanged : 0,
        hasWork,
        report,
    };
}

function approvedFromForm(form: HTMLFormElement): ApprovedActions {
    const adoptKeys = new Set<string>();
    const reimportKeys = new Set<string>();
    const deleteStaleKeys = new Set<string>();

    for (const input of form.querySelectorAll<HTMLInputElement>('input[name="adopt"]:checked')) {
        adoptKeys.add(input.value);
    }
    for (const input of form.querySelectorAll<HTMLInputElement>('input[name="reimport"]:checked')) {
        reimportKeys.add(input.value);
    }
    for (const input of form.querySelectorAll<HTMLInputElement>('input[name="deleteStale"]:checked')) {
        deleteStaleKeys.add(input.value);
    }

    return { adoptKeys, reimportKeys, deleteStaleKeys };
}

class SyncDialog extends SyncDialogBase {
    #payload: SyncPayload;
    #plan: SyncPlan;
    #report: SyncReport | null = null;

    constructor(payload: SyncPayload, plan: SyncPlan) {
        super();
        this.#payload = payload;
        this.#plan = plan;
    }

    static override DEFAULT_OPTIONS = {
        id: "forge-sync-dialog",
        tag: "form",
        classes: ["forge-sync-dialog-app"],
        window: {
            title: `${MODULE_ID}.sync.dialogTitle`,
            icon: "fa-solid fa-cloud-arrow-down",
        },
        position: { width: 640 },
        form: {
            handler: SyncDialog.onFormSubmit,
            submitOnChange: false,
            closeOnSubmit: false,
        },
    } as typeof SyncDialogBase.DEFAULT_OPTIONS;

    static override PARTS = {
        form: {
            template: TEMPLATE_SYNC_DIALOG,
        },
    };

    static async onFormSubmit(
        this: SyncDialog,
        event: Event | SubmitEvent,
        form: HTMLFormElement,
        _formData: unknown,
    ): Promise<void> {
        event.preventDefault();
        const approved = approvedFromForm(form);
        this.#report = await applySyncPlan(this.#payload, this.#plan, approved);
        await this.render();
    }

    protected override async _prepareContext(
        _options: unknown,
    ): Promise<Record<string, unknown>> {
        return planDialogContext(this.#plan, this.#report);
    }
}

export async function openSyncDialog(): Promise<void> {
    if (!syncGatesPass()) return;

    try {
        const payload = await fetchAndDecryptPayload();
        const plan = computeSyncPlan(payload, snapshotWorld());
        const dialog = new SyncDialog(payload, plan);
        await dialog.render({ force: true });
    } catch (error) {
        if (error instanceof PayloadUnavailableError) {
            ui.notifications!.warn(game.i18n!.localize(`${MODULE_ID}.sync.unavailable`));
            return;
        }
        if (error instanceof PayloadDecryptError) {
            ui.notifications!.warn(game.i18n!.localize(`${MODULE_ID}.sync.decryptFailed`));
            return;
        }
        throw error;
    }
}

export async function checkForVaultUpdates(): Promise<void> {
    if (!syncGatesPass()) return;

    try {
        const payload = await fetchAndDecryptPayload();
        const lastManifest = game.settings!.get(MODULE_ID, SETTING_LAST_MANIFEST) as string;
        if (payload.manifestHash === lastManifest) return;

        ensureVaultUpdateNotificationHandler();
        const openLabel = game.i18n!.localize(`${MODULE_ID}.sync.openDialog`);
        const summary = game.i18n!.localize(`${MODULE_ID}.sync.updated`);
        const message = `${summary} <button type="button" class="forge-sync-notification-open">${openLabel}</button>`;
        ui.notifications!.info(message, { escape: false, clean: false });
    } catch (error) {
        if (error instanceof PayloadUnavailableError) return;
        if (error instanceof PayloadDecryptError) {
            if (!decryptWarnShown) {
                decryptWarnShown = true;
                ui.notifications!.warn(game.i18n!.localize(`${MODULE_ID}.sync.decryptFailed`));
            }
            return;
        }
        throw error;
    }
}

export function registerSyncSettingsButton(): void {
    Hooks.on("renderSettingsConfig", (_app: object, html: HTMLElement) => {
        if (!game.user?.isGM) return;
        const root = html instanceof HTMLElement ? html : resolveHtmlRoot(html);
        if (!root || root.querySelector(".forge-sync-settings-button")) return;

        const syncRow = root.querySelector(`input[name="${MODULE_ID}.${SETTING_ENABLE_SYNC}"]`)?.closest(".form-group");
        if (!syncRow) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "forge-sync-settings-button";
        button.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> ${game.i18n!.localize(`${MODULE_ID}.sync.settingsButton`)}`;
        button.addEventListener("click", () => {
            void openSyncDialog();
        });
        syncRow.append(button);
    });
}
