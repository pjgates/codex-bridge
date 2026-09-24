# Terrain checks extension

Approved in-chat on 2026-09-21: separate outside-combat Climb/Swim switches; a GM scene-session override; free ordinary movement when exploration checks are disabled, with falls/forced hazards retained; behaviour-owned terrain presets/custom DCs and Swim checks in authored water.

1. Add optional floor Climb/Grab Edge and Water Swim fields with rulebook presets and legacy region-flag fallback. Existing behaviours remain valid. Correct migration uses Foundry14 ForcedReplacement and verifies persisted type.
2. Add outside-combat policy and shared GM override. The override is a hidden world setting identifying scene and GM; ignore disconnected owners, clear on owner reload or scene exit. Keep existing checks enabled by default until the GM disables the new outside-combat switches, preserving prior preferences.
3. Pause authored-water movement for system Swim where needed; respect calm-water automatic critical success, prepared swim Speed, progress limits and failed checks. Outside combat bypass ordinary checks when configured; always retain dangerous floor/fall decisions. Sinking/current/breath adjudication remains explicit GM scope.
4. Verify policies/presets/progress with red-green tests and GM built-in browser, update docs and player checklist, rerun review/checks.

Sources: installed PF2e action packs actions/skill/climb.json and swim.json, dc.ts simple DCs (10,15,20,30,40; PWoL10,15,20,25,30), system Swim action macro (prepared swim-Speed circumstance modifier). Calm water normally grants automatic critical success; unspecified terrain never invents a difficulty.
