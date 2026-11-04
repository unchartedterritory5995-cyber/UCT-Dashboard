# EVIDENCE - W3 S1 round 2 (drawing objects, cell text), desktop re-home

Branch `feat/pine-w3-drawings`. Code tip `58dd37a20ca85f47dfb26085596ff6e537215802` (an empty wip handoff
commit on top of `7eaca7777f`; this file is a docs-only commit on top of it).
Tested on master `52f76f9b4f4ce3241e19590ffb25acd773a909c5` (the tip's merge-base with origin/master).
Engine bump: YES. The merge takes `SCRIPT_ENGINE_VERSION` 8 (coordinator order: T4 6, T3 7, W3 8). It is NOT edited here (still 5).
What changed and the capture rows: `docs/pine/capture-queue-2026-11-02-w3.md`.

Machine: desktop. Lanes (heavy_lock `--path`): measure-pair on `_resume-2026-11-01/dsk/heavy-mp2.lock`
(base worktree `pine-dsk-mpbase2`); final-tip on `_resume-2026-11-01/dsk/heavy-final3.lock`. Up to 4 heavy
jobs ran at once on the machine, so expect wall-clock timing noise.

## measure-pair (both runtime lanes)
Command, one job under heavy-mp2: `runs/w3r2-mp.sh`. It runs
`M=$(git -C pine-dsk-w3 merge-base HEAD origin/master); git -C pine-dsk-mpbase2 switch -q --detach $M` (and checks it), then
`measure-pair.sh runs/w3r2-mp<rt> tip:pine-dsk-w3 base:pine-dsk-mpbase2 <rt> 1` for rt 0 and 1.
Logs: `_resume-2026-11-01/runs/w3r2-mp0.log`, `w3r2-mp1.log` (out dirs `w3r2-mp0/`, `w3r2-mp1/`).
Sides: `== side tip 58dd37a20c` / `== side base 52f76f9b4f` on both lanes. Every step rc=0.

| instrument | runtime 0 (production) | runtime 1 (runtime-on) |
|---|---|---|
| C18 corpus audit (`out-*.json`, `ms` ignored) | 0 diffs | 0 diffs |
| C18 constructed probes (`probe-*.json`) | 0 diffs | 0 diffs |
| vendor harness | `TOTAL 336 - MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140` both sides; verdicts.json + summary.md byte-identical | `MATCH 111 / DIVERGE 107 / INCONCLUSIVE 118` both sides; byte-identical |
| census (967/967 rows each side) | 3 differing rows, all NOISE | 0 differing rows |

Runtime 0 census classification (0 unintended):
- NOISE `reference:halftrend-longshort-signal-engine-bigbeluga__07070e14d6`: the step-2 `pine:timeout` message switches between
  "nested past 400 levels" (base) and "gave up after 10000ms" (tip). Same guard and outcome; attached/clean/peel unchanged.
- NOISE `reference:market-structure-with-inducements-sweeps-luxalgo__7948c21279`: the step-0 `pine:timeout` refusal list
  differs in where the budget tripped. Same guard; top-level fields unchanged.
- NOISE `committed:volatility-coil-edge-bullbyte__604f0fd1c6`: only step 6 (the step ending in `pine:timeout`) differs.
  droppedOps 141 to 142 (`create:label` 1). Steps 0-5 and 7 are identical (146,146,145x4 / 137). This step moves between
  runs at master: 137 in both sides of `w4t11-mp0` (master 5d95103c8a), 141 on this base. The runtime-on lane already
  counts `create:label: 1` on master at the same step. It depends on how far the reader gets before the wall-clock budget
  trips, not on S1. Attached/clean unchanged (false/false).
- No intended census flip was expected. S1's names ride inside `cellTextWhy`, and the census tallies those cells as
  `cell:text` on both sides. The `{N,number,percent}` cell it reads stays refused on its other walls (doc row S1-C).
  The rails below carry S1's behaviour.

## final-tip
Command, under heavy-final3: `final-tip.sh pine-dsk-w3 w3r2-final tests/test_script_engine_version_gate.py`, tip
`58dd37a20ca85f47dfb26085596ff6e537215802`. Log dir `_resume-2026-11-01/runs/w3r2-final/` (job log `runs/w3r2-final-job.log`).
- gate pytest: `46 passed` (rc=0). Hygiene rc=0: `clean: 34661 tracked file(s)...`. Version gate: `6 passed`.
- full chart+hooks vitest: `Test Files  1 failed | 1335 passed | 28 skipped (1364)`. The one failure is
  `src/hooks/pollingSites.rail.test.js`, the known desktop baseline. There is no other failure, so nothing needed a solo re-run.
  The 28th skipped file is `ast/w3ObjectWhy.measure.test.js` (env-gated measurement, header closed in round 2).
- The branch's rails, all green in that run: `ast/textRefusalNames.test.js` (23), `__tests__/w3CapturedCells.vendor.test.js` (8),
  `__tests__/strFormat.vendor.test.js` (11), `__tests__/formatVendorRules.test.js` (10).

## Pin on master (red on master, green on the tip)
One job, lane `_resume-2026-11-01/dsk/heavy-mut.lock` (label `w3-mut`): `runs/w3r2-pinmut.sh` -> `runs/w3r2-pin.py`.
Tip `58dd37a20c` (code); master bytes from `52f76f9b4f`. It swaps `pineTextFormat.js`, `ast/pine.js` and `ast/objectProgram.js` in
place to the master bytes (`git show`), runs, then restores the saved bytes and asserts them byte-exact. No checkout, stash or reset.
Rail files: `ast/textRefusalNames.test.js`, `__tests__/w3CapturedCells.vendor.test.js`, `__tests__/strFormat.vendor.test.js`,
`__tests__/formatVendorRules.test.js`. Logs and JSON reports: `_resume-2026-11-01/runs/w3r2-pin/` (`tip`, `master`, `master-pinejs-only`).

| run | textRefusalNames (23) | strFormat.vendor (11) | formatVendorRules (10) | w3CapturedCells (8) | total |
|---|---|---|---|---|---|
| tip | 23 pass | 11 pass | 10 pass | 8 pass | 52/52 |
| all 3 src at master | 19 FAIL / 4 pass | 2 FAIL ("everything no capture shows is refused", "the four unpinned cases each come back null") | 1 FAIL ("`str.format` IS SERVED for the patterns a capture pins") | 8 pass | 30 pass / 22 fail |
| only `pine.js` at master | 7 FAIL (all of section B: date, bare number, integer, string list, helper, `?:`, createDropWhy) | pass | pass | pass | 45 / 7 fail |

- Red on master: the -0 rail ("WITHHELD where the rule's words do not settle the characters"), the NBSP rail ("the keywords are trimmed
  as Java's String.trim does"), the decimal-tie rails, the round-1 lows (999.9996 under `{N}`, 9.996 under percent) and every section-B name.
- Green on master BY DESIGN (controls; they guard that nothing that drew before changes): textRefusalNames "the naming changes NO
  decision: the drop counts are what they were" and the three section-C controls (`#.##` cells carried; the helper-parameter cells; the bare
  `{N}` liquidation-levels rendering), and all 8 w3CapturedCells cases (each capture's drawn cells are TradingView's and the count is the
  merge base's). No re-pin needed.

## Mutations (`docs/pine/evidence/2026-11-04-w3-s1r2/muts2.json`, `$S/mutate.py` over the 4 rail files, same job)
Log `_resume-2026-11-01/runs/w3r2-pin/mutate.log`. **21 of 22 killed, 1 survivor.** Every restore was byte-exact (mutate.py asserts it).

| mutation | killed by |
|---|---|
| M01 type keyword read with JS `\s` (NBSP) | keywords are trimmed as Java's String.trim does |
| M02 style keyword trimmed with `trim()` (NBSP) | same |
| M03 an input of `-0` no longer withheld | WITHHELD where the rule's words do not settle the characters |
| M04 negative-zero rule removed | same |
| M05 decimal-tie rule removed | a DECIMAL half tie is withheld by name |
| M06 exact-tie rule removed | WITHHELD ... |
| M07 grouping bound on the product, not the rounded whole | WITHHELD ... |
| M08 na rule removed | WITHHELD ... |
| M09 `percentMessageNumber` stops asking `percentWithheldWhy` | WITHHELD ... |
| M10 `{N}` bound not asked of the rounded text (999.9996) | strFormat.vendor: the four unpinned cases each come back null |
| M11 `formatMessageNumber` stops serving `percent` | the reference's three examples |
| M12 preset keyword matched untrimmed | the grammar admits the keyword, spaced as the reference spells it |
| M13 `isMessageNumberFormat` forgets the presets | the document validator asks the SAME authority |
| M14 validator back to a pattern-only check | same |
| M15 cell drop site ignores the text reader's refusal | `{N,date,...}` the text reader's own refusal |
| M16 create drop site ignores it | a create's content slot names the text reader's refusal too |
| M17 `str.format` refusal not named | `{N,date,...}` ... |
| M18 loop per-pass refusal not named | a string list read by the counter |
| M20 bare `{N,number}` named generically | a bare `{N,number}` element names itself |
| M21 per-pass `?:` shape not spelled | a `?:` whose test moves per pass |
| M22 per-pass list-element shape not spelled | a string list read by the counter |
| **M19 SURVIVED** `textRefuse` also writes `lastCanonRefusal` | none. NOT equivalent, see below |

M19 was recorded OPEN in the first mutation run. The fix round below closed it.

## Fix round: M19 rail (C18 door)
Rail: `ast/textRefusalNames.test.js` section D, commit `ab579a4078` (tests only, no src change).
- The rail builds with `objectRuntimeCheck: probeObjectRuntime` (the C18 door). `bias` is a text bound below a stepped-over
  `while`, which writes the admitting `pine:block` refusal. The label's text is an 18-deep `?:` chain ending in `bias`.
- It builds, then nests past `TEXT_NODE_MAX_NEST`, so `fitTextNest` refuses it as `pine:text-value`. `valueRef` then asks
  `rtTextOf` for the whole text, which reads `lastCanonRefusal`.
- Assertion: one label create, a `ternary` text runtime spec, no drop.
- CONTROL: the same depth with no admitting refusal is dropped, named `pine:text-value ... nests deeper than the runtime reads`.
- The bug was NOT LIVE on the tip: the rail is green on `ab579a4078` (25/25 in the file). Under M19 the label is dropped (verified on a
  scratch probe, restored byte-exact). The rail guards W3's own invariant, so it is not a red-on-master rail: on master
  `fitTextNest` writes no text refusal, and the label is carried there too.
- Mutation re-run, all of `muts2.json` on `heavy-mut.lock` (label `w3-mut2`; log `runs/w3r2-pin/mutate2.log`): **22 / 22 killed**.
  M19 is killed by "a too-deep text after an admitting refusal is still read whole from the runtime lane". No equivalents.
- Only a test changed, so measure-pair was not re-run (the src tree is the one measured above).
- final-tip on `heavy-final3.lock` (label `w3-final2`): `final-tip.sh pine-dsk-w3 w3r2-final2 tests/test_script_engine_version_gate.py`,
  tip `ab579a40783394cd21689a0d95c8fecf74a9366a`, log `runs/w3r2-final2/` (job log `runs/w3r2-fix-job.log`).
  - Gate `46 passed`. Hygiene clean (34663 files). Version gate `6 passed`.
  - Vitest `Test Files  1 failed | 1335 passed | 28 skipped (1364)`: only `src/hooks/pollingSites.rail.test.js`, the baseline.

## Why census (base vs tip)
Same job. `tools/pine_coverage/w3_why_input.py --sample _resume-2026-11-01/pine-sample` gave 195 scripts. The env-gated
`ast/w3ObjectWhy.measure.test.js` (`W3_INPUT`/`W3_OUT`) ran on the tip and with the 3 src files at master bytes. Outputs (licence-held
spellings, not committed): `_resume-2026-11-01/runs/w3r2-pin/why-tip.json`, `why-base.json`.
- `cellTextWhy` "no refusal recorded": base 22, tip **0**. `createDropWhy` "no refusal recorded": base 4, tip **0**. All 22 cells the
  W3 census counted now carry a name.
- `dropped` / `attempted` / `dropReasons` / throws: identical on all 195 rows. The names changed no decision.
- 7 rows differ at all, and only in their why-sentences (6 in `cellTextWhy`, 1 in `createDropWhy`). On the tip, `cellTextWhy` now
  names `pine:text-value` 16 times and `loop:per-pass` 16 times.
