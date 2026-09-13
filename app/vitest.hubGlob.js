/**
 * The hub rail subset — the files a hub change must run before it claims anything.
 *
 * ⚰️⚰️ WHY THIS FILE EXISTS. Until 2026-09-13 "the hub rails" was a phrase, not an artifact: it
 * meant whatever `src/hub` a person happened to type. The stage-2 branch ran exactly that, got
 * **84 files / 1118 tests all green**, and was reported as verified — while nine tests under
 * `src/pages/settings/` were red, because they assert the EXPOSURE RULE and live outside `src/hub`.
 * Only the six-shard gate saw them. A subset that omits the files most likely to break is worse
 * than no subset, because it reads as coverage.
 *
 * ⛔ THIS LIST IS NOT THE GUARD. A hand-typed list drifts the day someone adds a file — this repo's
 * most-repeated defect. `src/hub/hubGlobCoverage.test.js` DERIVES the set of files that depend on
 * the rollout/exposure authority and fails if any of them is not matched here. Add a path when
 * that rail tells you to, not when you remember to.
 *
 * ⛔ AND IT IS STILL NOT THE GATE. Passing this subset means "the hub's own rails are green", never
 * "the branch is green" — `scripts/gate_shards.py` is the only thing that can say the second.
 */
export const HUB_RAIL_GLOBS = [
  'src/hub/**/*.test.{js,jsx}',
  // Exposure and rollout live here too: who sees the Settings card, and what its controls do.
  'src/pages/settings/JoystickSettingsCard.test.jsx',
  'src/pages/settings/joystickSettingsControls.test.jsx',
  'src/pages/settings/joystickTraceControls.test.jsx',
  // Token/geometry rails the hub's appearance depends on.
  'src/styles/themeIslands.test.js',
  'src/styles/tapFloor.test.js',
]

export default HUB_RAIL_GLOBS
