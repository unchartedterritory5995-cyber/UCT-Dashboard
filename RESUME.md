# RESUME: landing train 1 (`land/pine-engine-train-1`), IN PROGRESS

> ⛔ Remove this file (and `docs/pine/landing-train-1/`) in the commit that opens the train PR.
> Checkpoint written 2026-11-15 (second session). All inputs are merged; the union rails ran once;
> NO census / harness regression has run yet, the engine number is NOT set, no PR is open.

## Coordinator changes since the first park (they override the older text)
- COND-TA does NOT land first. The train takes master + 1 at push (expected **58**; re-read
  `origin/master:app/src/components/chart/engine/scriptEngineVersion.js` before the number step and before pushing).
- Input heads are frozen (verified with `git rev-parse origin/<branch>` on 2026-11-15):
  eng57 `5b276cacb6`, eng56-v2 `e63532f7b6`, colour-reader `d2115c85e1` PLUS `fix/pine-engine58-colours`
  `968066d775` (the review of #1330, not contained in colour-reader), legacy `f5676682b0`, hl-cbc `5d5003c34e`.

## Done (first-parent chain of the branch)
| commit | what | conflicts (all resolved by keeping both sides) |
|---|---|---|
| `49ebc0b470` | hl-cbc `5d5003c34e` | none |
| `f0d25abf88` | `origin/master` `ecd8c3cccd` (engine 57) | none |
| `91e90b57dd` | eng57 `5b276cacb6` | `ast_interpret.py`, `interpret.js`, `pineRuntimeFrontend.js`, `scriptEngineVersion.js` |
| `53bc09ee87` | eng56-v2 `e63532f7b6` | 12 files; `FINITE_WINDOW.highestbars/lowestbars` = HL's `NA.FINITE` + `arg: true` AND eng56's `reduceNewest` / `holdsTie` (`naCurrent` is gone); roster pins 89 functions / 141 bar names / 290 declared |
| `df33cd2a6f` | colour-reader `d2115c85e1` | `pineRuntimeFrontend.js`, `ourSide.js`, `compare.mjs`, `scriptEngineVersion.js`, `capture-queue.json` (regenerated) |
| `03f49f56de` | engine58-colours `968066d775` | `memberPaneDefinition.js`, `compare.mjs` (2), `IndicatorChip.jsx`, `LegendRow.jsx`, `scriptEngineVersion.js` (the review's rewritten #1330 line replaces the older one) |
| `b5ac5b63df` | legacy `f5676682b0` | `pine.js` (4: `pineScript` AND `pineV1`), `pineRuntimeFrontend.js` (5), `scriptEngineVersion.js`, `capture-queue.json` (regenerated) |
| `5ded7c555c` | `GRAMMAR.md` regenerated (`FORMULA_DOCS_WRITE=1` on `formulaDocs.test.js`); `periodAnchorParity` excludes `stoch:` / `rci:` | - |

`scriptEngineVersion.js`: `SCRIPT_ENGINE_VERSION` is still 57; every input's history line is kept and
starts `NUMBER PENDING =` (seven lines: HL, CBC-FMT, #1294, #1265-v2, #1330 + review, B4, legacy). Step E
replaces those prefixes with the one number. `evidence_engine.py queue --check` PASS after the last merge.
`tools/lookback_agreement.json` was rewritten by its rail and did not change.

## Rails run on the combined tree so far
- Python (one file at a time, all green): `test_engine_hl_holes` 12, `test_engine56_values` 14,
  `test_engine57_builtins` 21, `test_ast_interpret` 105, `test_ast_scalars` 174, `test_ast_bounded_state` 39,
  `test_ast_period_anchor_parity` 137, `test_ast_tc2000_remainder` 17, `test_cbcfmt_calc_bars_server` 18,
  `test_definition_colour_trust` 67, `test_queue_dispositions` 10, `test_alert_user_admission` 37.
- vitest, the union of the inputs' test files (`docs/pine/landing-train-1/rails.union`, 49 files), at `b5ac5b63df`:
  `regen` 2 files passed; `ast` 22 files, 3 failed; `engine/__tests__` 15 files / 266 tests, 1 failed;
  `runtime` + `builder` 12 files, 1 failed. The five failing files and their state:

| file | cause | state |
|---|---|---|
| `periodAnchorParity.test.js` | eng57's `stoch:` / `rci:` codes not excluded (fails on the eng57 head alone too) | fixed in `5ded7c555c`, re-run OWED |
| `pine.guardCensus.test.js` | legacy's new guard `pine:fn-history-in-block` not on the unexercised roster | edited (this commit), NOT RUN |
| `engine58Review.test.jsx` "the legend row: the same" | master's signature legend no longer inks the VERTICAL row's name; the review rail asked the vertical row for text ink | rail re-pointed at the flat strip + the vertical rail (this commit), NOT RUN, mutant not run |
| `savedDocumentRoundTrip.test.js` (2 tests) | two documents moved by eng56-v2 (bisected over the merge chain: equal at `ecd8c3cccd`, `f0d25abf88`, `91e90b57dd`; moved at `53bc09ee87`; unchanged after): OBV-everget (`crossOver(…) != 0` operand cast) and opening-range (`show_mid and timeframe.isintraday` keeps its `&&`, `show_mid` gained as an input) | `MOVED_BY_ENGINE` entries + `undoEngine56` written (this commit); a Python prototype of the same undo reproduces the pre-merge trees, manifest and sources exactly; the JS is NOT RUN |
| `engine57Builtins.test.js` F5 | the rail's runtime half is stale against master: since RS Rating L5 (#1342) the runtime lane SERVES a weekly self-request (`request.security(syminfo.tickerid, "W", close)` is OK at `ecd8c3cccd`), and this rail's script refuses `runtime:unbound` on `bar_index` instead of `interpret:bind-time-text`. Same answer at every commit of the chain incl. master itself | OPEN, see next section |

## OPEN: engine 57 x master (the F5 rail and mutant F5b)
1. `docs/pine/landing-train-1/probe.test.js` (scratch, run with `vitest.scratch.config.mjs`, `TRAIN_TEST=probe.test.js`
   `TRAIN_OUT=<json>`) asks: with a weekly self-request over a `ta.stoch` whose weekly window is an unpinned flat run
   (variants `cum` / `inline`, no `bar_index`), does the RUNTIME lane serve bars the host lane withholds by
   `stoch:flat-window`? It has NOT RUN (the lock gate stopped on disk space). If `rtServedWhereHostWithheld > 0`
   that is an unowned gap between #1342 and #1294: STOP and report it. If the runtime declines or matches, re-point
   the F5 rail's runtime half at what the lane does today.
2. Why F5b survives (read off the code, not yet run): `interpret.js::builtinWitnessMask` lists the nested reads as
   `sym`, `tf`, `tf_live`, `ltf` and NOT `tf_merge` (line `const into = nested || node.type === 'sym' || …`), and
   the F5 rail's `request.security(…, "W", …)` translates to `tf_merge` since engine 56 (#1264). So the root mask
   treats the site as un-nested, evaluates its arguments on the CHART's bars and names `stoch:flat-window` itself;
   the child's own sink is not needed for the rail to pass. `windowHoleMask` (engine HL) has the same list, in JS and
   in Python (`("tf", "tf_live", "sym", "ltf")`). Effect, as read: over-withholding at the root (bars flagged from
   a daily analysis of a weekly site) and the code named from the wrong bars; the child's own mask still withholds the
   right weekly bars, so no wrong value is served. NOT fixed here (product change outside the conflict map): report it.
   The `tf` child's `chartClockSink` IS reachable (a formula `tf(…)` and Pine's `tf_live` share that line), so the
   F5b rail is: the F5 tree with `tf_merge` re-typed `tf` (the probe computes it as `tfClock` / `tfNaN`), clock must
   equal `[stoch:flat-window]`; prove it red with F5b (`chartClockSink: undefined` added to the `tf` child's options),
   green without.
3. eng57 mutants K11, R1-R9, X1-X3: NOT RUN. The branch's mutant runner was never committed and is not in any
   scratchpad; rebuild each from EVIDENCE.md's one-line description, copy-aside discipline.

## NOT DONE (in order)
1. Re-run the five files above; finish the F5 / F5b work; commit.
2. Step D in full, sharded by folder under the lock: `engine/ast`, `engine/runtime`, `builder`, `engine/__tests__`
   (eng56-v2 never ran `builder`, `engine/__tests__` or its pytest list on its final head), the 43
   `tests/test_ast_*.py` + the engine files one at a time, `tests/test_pine_runtime_*.py`,
   `node --test services/pine_runtime/test/*.test.mjs`.
3. Step C: tiny dry run of `census.train.test.js` (both lanes, read a row), then `measure.sh after`,
   `measure.sh before-<BASE>` at `BASE = git merge-base HEAD origin/master` (`ecd8c3cccd` today), `cmp.py`,
   attribution of every move. `measure.sh` and `vitest.train.config.mjs` in the folder still carry the FIRST
   session's scratchpad path: set `O=` / `S=` to the current scratch copy before use.
4. Step E (number 58 = master + 1, host parity `--write` / `--check`, `service_smoke.json` re-record, smoke 4/4).
5. `queue --check`, `pins --check`, the five named pytest files, `check_repo_hygiene.py`; remove this file and
   `docs/pine/landing-train-1/`; push; ONE PR. Do not merge, do not close #1265 / #1294 / #1330 / #1332 / #1333.

## Tooling added this session (`docs/pine/landing-train-1/`)
`inlock.py` + `lock.sh` (one heavy-lock hold, one process per shard, free RAM and C: measured before each shard,
stops under 8 GB disk / 6 GB RAM; `lock.sh LABEL TIMEOUT OUTDIR SHARDFILE`), `vitest.scratch.config.mjs` +
`bisect.test.js` / `probe.test.js` (scratch tests outside the repo tree), `rails.union`. They hard-code this
session's scratchpad path; fix it on resume.

## Machine note
2026-11-15 ~20:50: C: read 26 GB free, then 0.7 GB (the lock gate refused to start a shard), then 17 GB a few
minutes later, with this train writing about 7 MB in total. Something else on the box takes and frees ~25 GB.
