# W5-T18 Editor status ("Runs on") - evidence (2026-11-04)

Branch `feat/pine-w5-t18-editor-status`, stacked on W5-T17 `f777d2c427` (origin/feat/pine-w5-t17-stamps).
Tested-on-master: n/a (frontend only; no engine path). Engine bump: NO (SCRIPT_ENGINE_VERSION untouched).
No flag, no server code, no Python change.

## What changed
- `app/src/components/chart/builder/RunsOnLine.jsx` (new): renders the server's `server_lanes` for the
  open definition. All-true lanes: `Runs on: chart, alerts, screener, scans`. A refused lane shows
  `<lane>: <sentence>` verbatim from the stamp and is never listed as running. No key (ast row, or
  null) renders nothing. Anything else (non-object, a lane that is not `true` and not a refusal with
  a non-empty sentence) fails closed: `Not confirmed for: <lanes>`, never a claim.
- `BuilderSheet.jsx`: mounts it beside the repaint notice, for the open row (`openRow.server_lanes`).
- `BuilderSheet.runsOn.test.jsx` (new, 17 tests): the render rail over the four states through the real
  hook with a stubbed fetch (all true; some/all refused with sentences; ast row without key; five
  malformed shapes, null, one-good-one-bad), plus the component alone on undefined/null/non-stamps.

## Rails
Red on base (f777d2c427 has no RunsOnLine and no mount): mutation M1 (mount removed) is exactly the
base behaviour and fails the tests that expect the line. Tip: `vitest run
src/components/chart/builder/BuilderSheet.runsOn.test.jsx` = 17 passed (file run by path, count checked).

## Mutations (mutate.py, byte-exact restore, lock heavy-mut, label w5t18-mut2; 10/10 killed)
| mutation | killed by |
|---|---|
| M1 mount removed | "1 - all lanes true" and the refused/malformed tests |
| M2 null stamp no longer silent | "no stamp (null) renders nothing" |
| M3 absent stamp treated as all-true | "3 - an ast row shows nothing new" |
| M4 truthy lane counts as running | "2 - refused lanes ..." |
| M6 refusal without a sentence accepted | "4 - ... a truthy non-true lane" |
| M7 sentence paraphrased | "2 - refused lanes show the server sentence verbatim" |
| M8 refused lane listed as running | "2 - refused lanes ..." |
| M9 unconfirmed line dropped | "4 - a malformed stamp (a string)" |
| M10 chart dropped from the line | "1 - all lanes true" |
| M11 refusals not rendered | "2 - refused lanes ..." |
An earlier round's `isMap` array guard (M5) survived as equivalent (`array['alerts']` is undefined
anyway) and was deleted rather than kept; its first-round survivor M2 was killed by the added
component-alone tests.

## final-tip (tip a59597320b, lock heavy-final2, label w5t18-final, logs `_resume-2026-11-01/runs/dsk-w5t18-final/`)
gate pytest 46 passed; hygiene clean; chart+hooks vitest: 22378 passed, 2 failed, 118 skipped (Test Files
1333 passed, 2 failed). The 2 failures are the known baselines only: `pollingSites.rail` and
`settingsScope.rail` rule 1 (StudyChart.jsx:32 static scan). No Python rails (no server change).
