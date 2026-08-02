/**
 * PRAD (Players Roll All Dice) — Feature Barrel
 *
 * Single entry point for the PRAD feature. Exports init-phase and
 * ready-phase functions so that `src/hooks/` only imports from here.
 */

export { registerPradSettings, isPradEnabled, applyDCBaseSetting } from "./settings.js";
export { registerPradTemplates } from "./chat-cards.js";
export {
    postAttackCard,
    registerAttackCardTemplate,
    registerAttackInterceptHook,
    resolveAttackCardProvenance,
    rollAttackCardArmorSaves,
    rollWeaponDamage,
} from "./intercept-attack.js";
export type { AttackCardParams, AttackCardProvenance } from "./intercept-attack.js";
export { registerPradSheetHooks } from "./sheet-hooks.js";
