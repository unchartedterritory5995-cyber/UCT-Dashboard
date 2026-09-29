// ─── ⛔⛔ THE GATE ON A MEMBER'S SCRIPT BEING DRAWN BY THE RUNTIME LANE ──────
//
// Owner principle (PR #241, 2026-09-28): our chart draws exactly what TradingView
// draws for the same script at its defaults, and what the columnar lane cannot
// represent routes to the per-bar runtime lane. This is the switch on that route.
//
// ⛔ IT ARRIVES OFF. Ruling D2 keeps every member pane on the HOST lane's saved
// definition (`ast/paneGate.js::PANE_LANE`), and the runtime lane has had no live
// importer in production since it was built. Routing a script there is a D2
// revisit, and like `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED` before it, it ships dark
// so the first deploy carrying it changes nothing a member sees.
//
// ⭐ WHAT IT ADMITS WHEN ON — deliberately narrow: a script the host lane refuses
// ONLY for structural reasons the runtime lane exists for (every refusal carries
// `route: 'runtime'` — today, two `var`s whose previous bars are coupled), and
// only when the runtime lane builds it and its repaint behaviour can be stated.
// See `builder/memberPane/runtimePaneDefinition.js`.
//
// ⭐ THE CONVENTION IS READ OFF THE CODE (`docs/frontend_feature_flags.json`):
// default OFF means `=== '1'`, read INSIDE a function so a test can flip it, and
// a build with no `import.meta.env` fails CLOSED.

/** May a member pane draw a script through the per-bar runtime lane?
 *
 *  ⛔ ONE READER, ON PURPOSE: `memberPaneDefinition` (the door that routes) and
 *  `nativeRegistry.validateUserDefinitions` (the install door that must refuse a
 *  runtime document on a build that may not draw one) both ask this function.
 *
 *  @param {object} [env] injectable for tests; defaults to `import.meta.env`,
 *  bound LATE so a module-level stub is seen. */
export function runtimePaneEnabled(env) {
  try {
    const source = env === undefined ? import.meta.env : env
    return !!source && source.VITE_PINE_RUNTIME_PANE_ENABLED === '1'
  } catch {
    return false
  }
}
