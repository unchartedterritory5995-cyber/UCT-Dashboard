// ─── ⛔⛔ THE GATE ON A SCRIPT THAT DRAWS BUT OFFERS NO COLUMN ───────────────
//
// Ruling D2 says a member pane draws the HOST lane's verdict, and `paneGate`
// refuses anything whose verdict is `ok: false`. That was the whole story while
// `ok: false` meant "nothing came out of this script".
//
// It no longer does. `pine:objects-only` is a script that DRAWS — a table,
// labels, boxes — and offers no plot or alert condition, so there is nothing to
// filter a scan on. `ok` is false because the SCREENER contract is unchanged and
// honest; the drawing is real and survives the refusal. Measured: 19 of the 266
// committed corpus scripts are in that state, plus the acceptance dashboard.
//
// ⛔ SO THIS IS A D2 REVISIT, AND IT ARRIVES OFF. Owner decision, 2026-09-20:
// admit an objects-only verdict, but behind a flag defaulting OFF, so the first
// deploy carrying it changes nothing a member sees. Rollback is the variable,
// not a revert.
//
// ⚰️ WHY A SECOND MODULE AND NOT A SECOND FLAG IN `memberPaneGate.js`. That
// file's rail derives its flag NAME from the first `import.meta.env` match in
// the source and asserts the flag is read in exactly ONE place. A sibling flag
// in the same file would sit inside both of those measurements and change what
// they mean — and that rail is already carrying a pre-existing ledger failure,
// so perturbing it would blur a red that is not mine. One flag, one module, one
// rail each.
//
// ⭐ THE CONVENTION IS READ OFF `memberPaneGate.js`, NOT INVENTED: default OFF
// means `=== '1'`, so absent, empty, `'0'` and `'true'` are all off; and the read
// happens INSIDE a function, never at module scope, so a test can flip it.

/** May a pane draw a script that has objects and no screenable column?
 *
 *  ⛔ ONE READER, ON PURPOSE — `memberPaneDefinition.js`. A rename is then one
 *  line, and the rail derives the name from THIS file rather than typing it: a
 *  name typed in a test is the artifact that goes stale first.
 */
export function objectsOnlyPaneEnabled(env) {
  try {
    // ⭐⭐ THE SOURCE IS A LATE-BOUND PARAMETER, AND IT EXISTS TO MAKE THE
    // FAIL-CLOSED BRANCH PROVABLE. `import.meta.env` always exists under vitest,
    // so a `catch` that reads it directly can never be entered by a test — and a
    // mutation flipping `return false` to `return true` stayed GREEN, which is
    // this repo's definition of a guard that is not a guard.
    //
    // ⛔ LATE-BOUND, NOT A DEFAULT ARGUMENT. `function f(env = import.meta.env)`
    // binds at call time too, but this repo has paid for the general habit: a
    // default argument naming a module-level value binds at IMPORT and a
    // `monkeypatch` of it reaches nothing. Resolving inside the body is the
    // shape that cannot drift into that.
    const source = env === undefined ? import.meta.env : env
    return source.VITE_PINE_OBJECTS_ONLY_PANE_ENABLED === '1'
  } catch {
    // A build with no `import.meta.env` is not a build that may quietly widen
    // what a pane draws. Fail CLOSED.
    return false
  }
}
