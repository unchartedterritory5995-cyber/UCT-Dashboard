/**
 * The Data Charts V2 build-time gate.
 *
 * ⛔⛔ THE READ MUST BE THE FULL STATIC LITERAL — `import.meta.env.VITE_BREADTH_CHARTS_V2_ENABLED`
 * — and never a computed access like `env[NAME]`. Vite replaces these TEXTUALLY at build
 * time; a dynamic key is not replaced, so it is `undefined` in the shipped bundle while
 * reading perfectly in vitest, where `import.meta.env` is an ordinary object. This file
 * was written the dynamic way first and `tests/test_vite_flag_ledger.py` caught it —
 * reporting a "stale ledger row" whose real cause was a flag that could never be on in
 * production. ⭐ That rail is therefore doing double duty: the name it cannot find is
 * also the name Vite cannot bake.
 *
 * ⛔ READ AT CALL TIME, not captured at module scope. A module-level `const ON = …` is
 * evaluated once per module load, which makes every test in a file share one answer and
 * makes the flag-off golden impossible to drive from both sides.
 *
 * ⛔ EXACTLY `'1'`, never truthiness. These arrive as STRINGS, so the literal `'0'` and
 * the literal `'false'` are both truthy and a truthy test turns "deliberately off" into
 * "on". Unset is `undefined`, which is off.
 *
 * ⚠️ BUILD-time, so flipping it is a rebuild, not a Railway variable read per request.
 * Ledger row: `VITE_BREADTH_CHARTS_V2_ENABLED` in `docs/feature_flags.json`; build ARG in
 * `Dockerfile.web`.
 */

/** The flag's NAME, for docs and tests. ⛔ Never use it to perform the read (see above). */
export const V2_FLAG = 'VITE_BREADTH_CHARTS_V2_ENABLED'

export function v2Enabled() {
  return import.meta.env.VITE_BREADTH_CHARTS_V2_ENABLED === '1'
}

export default v2Enabled
