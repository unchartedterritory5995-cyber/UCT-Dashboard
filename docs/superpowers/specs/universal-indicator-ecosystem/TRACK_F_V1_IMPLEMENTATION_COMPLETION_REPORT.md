# Track F narrow v1 — implementation completion report

**Status: 🟢 ACCEPTED (2026-09-05)**, including the reopen/re-tune follow-up
in §13. RISK-013 classified **PARTIALLY CLOSED** (closed for `input.int`/
`input.float`; open for every explicitly-deferred input type and shape) —
`RISK_REGISTER.md`, `DECISIONS.md` DEC-006, and `VALIDATION_COVERAGE_MAP.md`
all updated to match. **Track F is stopped here** — no further Pine-input
expansion authorized or started.

**Date:** 2026-09-05 · **Phase:** One (Trust Foundation), Track F · **Governing
decision:** `DECISIONS.md` DEC-006 · **Scope authorized:** `input.int`/
`input.float` only, per owner authorization following `TRACK_F_SPIKE_REPORT_V1.md`.

---

## 1. Exact files / code paths changed

Five commits on this branch, `dc370f57c..HEAD` (the fifth is the §13
follow-up, added the same day after this report's first version):

```
4996c07f4  Track F v1 translator: input.int/input.float become adjustable parameters
dfb3cb74a  Track F v1: client-side parameter edit application (no Pine, no second parser)
3943c14a1  Track F v1: wire paramManifest through PineBox import into BuilderSheet save
91fdbb222  Track F v1: smallest useful parameter UI (ParamControls) + client-side reconcile
d07a7643f  Track F follow-up: real-UI regression proving reopen/re-tune actually works
```

Production code (test files excluded from this stat):

```
app/src/components/chart/engine/ast/pine.js          | 149 ++++++++-  (translator)
app/src/components/chart/builder/pineParamManifest.js| 117 +++++++    (new — astPath locator discovery)
app/src/components/chart/builder/paramEdit.js        | 356 +++++++++++ (new — edit application + reconcile)
app/src/components/chart/builder/PineBox.jsx         |  59 +++-        (import-time manifest computation)
app/src/components/chart/builder/BuilderSheet.jsx    | 118 ++++++-      (save-path wiring + UI mount)
app/src/components/chart/builder/ParamControls.jsx   | 144 +++++++      (new — the UI)
app/src/components/chart/builder/ParamControls.module.css | 82 +++++   (new)
```

Server side (promoted from the spike, no logic change — see the spike report):

```
api/services/param_manifest.py       (renamed from param_manifest_spike.py)
api/services/user_definitions.py     (import/hook comment updated to match)
tests/test_param_manifest.py         (renamed from test_param_manifest_spike.py)
```

**Not touched:** `closedTable.json` (the canonical 8-node grammar is unchanged),
`ast_interpret.py`, `parse.js`'s canonical node shapes, any router, any other
translator (`translateThinkScript`, PCF), `builderInputs.js`/`inputsFromFolded`
(the pre-existing, separate `declareInputs` mechanism — read, never modified).

**§13 follow-up (2026-09-05, same day):** one new test file only —
`app/src/components/chart/builder/BuilderSheet.paramReopen.test.jsx` — no
production code changed. The reopen door (`BuilderSheet.jsx`'s existing
`openForEdit`/"Your formulas" list) was already wired from the `91fdbb222`
commit above; this follow-up added live verification and a permanent
regression, not new functionality.

## 2. Final parameter contract

Restated from `TRACK_F_PARAMETER_ADR_V2_2.md` §6.0, now implemented exactly as
specified there (not as §1's original, superseded `{treeIndex, bindingId}`
wording):

- **`compute.source`/`compute.sources[k]`** — ordinary printed UCT-DSL text.
  No special syntax. `rsi(close, 14)`, nothing more.
- **`compute.ast`/`compute.trees`** — canonical execution authority. A
  parameter's current value is a plain `{type:"num", value:N}` literal at a
  fixed structural position — never an identifier, at every step, including
  inside a window/length argument.
- **`compute.paramManifest`** — trusted, immutable-per-save provenance:
  `{sourceName, title, type, default, min, max, step, options, locators:
  [{treeIndex, astPath}]}` per logical parameter (`__uct_param_<n>`).
- **`compute.paramState`** (server-computed at every save; client-derived via
  `reconcileParams` before a first save exists) — the live, always-fresh
  reconciliation: `attached | detached | partially_detached | conflicted |
  non_literal`, plus `value`/`reason`.
- **No authoritative override blob, anywhere.** No second server-side parser.
  A parameter edit mutates the literal at its locator(s), re-derives
  `compute.source` via the existing `printFormula` compiler, and re-verifies
  round-trip through the existing `parseFormula`/`astHash` pair — the same
  two primitives `pine.js`'s own internal `verifyRoundTrip` already uses on
  its own output.

## 3. Results of all 15 spike protections

Unchanged since spike acceptance — promotion made no logic change. Re-run
today as part of final regression: **21/21 passing**
(`tests/test_param_manifest.py`). Full point-by-point evidence is in
`TRACK_F_PARAMETER_ADR_V2_2.md` §6 and `TRACK_F_SPIKE_REPORT_V1.md` §1; not
repeated here.

## 4. New tests (this implementation phase, beyond the 21 server-side ones)

| Suite | Count | Covers |
|---|---|---|
| `pine.paramManifest.test.js` | 13 | Translator eligibility, window-bound + arithmetic-wrapped + bare-`input()` cases, the 3 excluded kinds, opt-in/byte-identical contract, `buildParamManifest`'s drop-if-empty rule |
| `paramEdit.test.js` | 16 | `applyParamEdit` (real translator output, bounds rejection, reset-to-default, float params, unknown-id refusal) + multi-tree atomicity + `reconcileParams`'s 5 states |
| `ParamControls.test.jsx` | 10 | Rendering, commit-on-blur/Enter, blank-reverts, Reset to Default, disabled+reason for non-attached states, server-state preference, numeric-options `<select>` |
| **Total new (this phase)** | **39** | |
| Plus the 21 promoted server-side tests | 21 | (counted in §3, not double-counted here) |

## 5. Regression results

Final run, this session:

```
tests/test_param_manifest.py                                    21 passed
vitest: src/components/chart/builder + .../engine/ast/pine      2323 passed, 3 failed
```

The 3 failures are **pre-existing and unrelated to Track F**, each verified
against a pristine, pre-Track-F baseline (not assumed):

1. `ImportBox.thinkscript.test.jsx` — a whitespace/formatting diff, reproduces
   identically with Track F's frontend changes fully stashed out.
2. `BuilderSheet.pine.test.jsx`'s "byte-identical" test — a telemetry-POST-
   ordering assertion (`H.requests.find(r => r.method === 'POST')` picks up
   an earlier `import_submitted`/`compile_finished` telemetry POST rather
   than the save POST). Reproduces identically against the **fully pristine
   pine.js from commit `ad23ac2c2`** (the commit immediately before ANY
   Track F work), confirmed by literally swapping that file in, running the
   test, and swapping back. Pre-dates Track F — introduced by the earlier,
   unrelated Track C telemetry work on this branch.
3. `pine.blindCorpus.test.js`'s accepted-floor test — a corpus-wide
   translation-rate assertion (21/48 vs. a floor of 28) tracking
   `ta.rising`/`ta.bbw`/`ta.percentrank`/`ta.median` support — exactly the
   functions Track A's vendor-parity work (this session, earlier) is
   targeting. Reproduces identically on the pristine baseline.

Zero regressions attributable to this implementation.

## 6. Golden Journey #1 rerun

Re-run live, in an isolated sandboxed backend + frontend (same isolation
mechanism the original journey used: `conftest.py`'s `SHARED_DATA_ENV_PINS`
redirect, imported before the app — verified nothing touched `C:\data`),
using the **real, unmodified `tests/fixtures/pine/07-rsi.pine` fixture** —
the exact GPL-licensed everget RSI script the original journey used.

| Journey item | Result |
|---|---|
| 1–8 (paste → translate → canonical read-back → chart delivery) | **PASS, unchanged** — `rsi(close, 14)`, "the 14-bar RSI of close", live preview rendered |
| 4. Change RSI length 14 → 21 | **PASS** — done live in the new "ADJUSTABLE PARAMETERS" panel |
| 5. Canonical AST changes | **PASS** — Formula field updated to `rsi(close, 21)`; "THIS IS WHAT WILL BE COMPUTED: the 21-bar RSI of close · 3 nodes · 21-bar lookback" |
| 6. astHash/def_hash changes | **PASS** — confirmed via direct API fetch: `ast_hash`/`compute.fn` both `sha256:352a4935...`, reflecting the 21-tree |
| 7. maxLookback/execution requirements recompute | **PASS** — "21-bar lookback" shown, derived from the live re-evaluation pipeline, not a copy |
| 8. Chart output changes accordingly | **PASS** — the RSI sub-pane's waveform visibly changed between the 14- and 21-length renders |
| 9. Save | **PASS** — confirmed via direct backend API read of the persisted row (not just UI text): `compute.ast` has the literal `21`; `compute.paramManifest.__uct_param_1` = `{default:14, sourceName:"length", title:"Length", type:"int", locators:[{astPath:["args",1],treeIndex:null}]}`; `compute.paramState.__uct_param_1` = `{state:"attached", value:21}` — the **server's own** computed reconciliation, proving the promoted spike code is live on a real save, not just in isolated tests |
| 10. Full reload | **PASS, clean** — fresh page navigation; the indicator reappeared automatically in the same workspace layout with the length-21 value, no duplicate instance |
| 11. Parameter value survives | **PASS** — same evidence as item 9/10 |
| 12. Parameter metadata survives | **PASS** — same evidence as item 9 (`paramManifest` persisted) |
| 13. UCT source representation is consistent | **PASS** — `compute.source: "rsi(close, 21)"`, ordinary text, re-parses correctly (proven by `applyParamEdit`'s own round-trip verification, which ran during this exact edit) |
| 14. Reset to Default | **PASS, code- and live-verified.** `ParamControls.test.jsx`'s dedicated test exercises this against real component code; the control was observed correctly appearing/disappearing live in this pass (item 4) and, in the §13 follow-up, a real edit-then-reopen cycle confirmed the restored value is exactly what "Reset to Default" would target |
| 15. Screener reachability remains correct | **PASS, unchanged** — API response: `scannable:false`, `scan_refusal:{gate:"yields", detail:"this tree returns a number, not a 0/1 column..."}` — byte-identical to the original journey's own finding for the same fixture |
| 16. Alert lane re-proves rather than serving stale state | **Not re-driven this pass** (out of this journey's scope, as in the original run) |
| 17. Invalid/out-of-range value refused without changing the prior valid definition | **PASS, driven live** — a second import (`input.int(14,"Length",minval=2,maxval=200)`), typed `500` into the Length field: the field **reverted to `14`** (the prior committed value), no "Reset to Default" appeared (nothing changed), matching reject-not-clamp exactly |
| 18. Unsupported Pine inputs shown as frozen/unsupported | **PASS, by absence — verified via the saved row, not assumed.** `07-rsi.pine`'s `highlightBreakouts` (bool) and `srcInput` (string, with `options=`) never appear in `compute.paramManifest` at all — confirmed directly in the fetched, saved JSON, which lists only `__uct_param_1` (`length`). This is correct: neither bool/string input ever reaches the SAVED tree in the first place (only the `rsi` plot is kept; `highlightBreakouts`/`srcInput` are referenced only by the discarded `rsiColor`/`fill()` chrome) — there is nothing to disclose as "frozen" for THIS artifact, mirroring the original journey's own RISK-013 finding precisely (only `length` and the two levels' defaults reached the saved artifact at all) |
| 19. Multi-tree/multi-use updates remain atomic | **Code-verified** (`paramEdit.test.js`'s multi-tree atomicity tests: both trees change together, a malformed locator refuses the whole edit) — not re-driven live this pass (the golden-journey fixture is single-plot) |
| 20. Manual source edits that detach/conflict disable the control | **Code-verified** (`ParamControls.test.jsx`'s disabled-row tests; `reconcileParams`'s 5-state tests) — not re-driven live this pass |

**⚠️ Correction (2026-09-05, same day, §13 below):** this section originally
said the "reopen an already-saved definition to keep editing its parameter"
UI door was **not located** in this pass, after checking the Indicators
dialog's own row, the per-instance `IndicatorSettingsDialog`, the legend
right-click menu, and the Screener's "My Scans" list, and framed it as the
same class of gap the original golden journey logged for the pencil icon.
**That was a miss in this pass's own search, not a real gap.** The door
exists and was already wired: `BuilderSheet.jsx`'s own "Your formulas"
list (fed by the real `useUserDefinitions()` hook) renders at the bottom of
the SAME "New formula"/"Edit formula" dialog, past the Save/Cancel buttons —
one scroll further than this pass looked. Found by grepping `BuilderSheet
.jsx`'s own `openForEdit`/`rows` wiring rather than more browser searching.
See §13 for the full live-verification and permanent-regression follow-up
that closed this out the same day.

## 7. Benchmark before/after

Per the owner's instruction, **parameter-fidelity improvement is not vendor
parity** — Track A's vendor-parity classification is untouched and
independent. This benchmark measures translator behavior only.

Run once against the real, committed corpus (`tests/fixtures/pine/*.pine`,
21 scripts), comparing `translatePine(src)` against `translatePine(src,
{paramManifest: true})`:

```
corpus size:              21 scripts
scripts translating:      14  (IDENTICAL before/after -- verified per-script,
                                not just in aggregate: every script's ok/
                                selected/ast triple matched byte for byte
                                with the flag on or off; 0 mismatches)
scripts gaining >=1        14  (100% of everything that translates)
  adjustable parameter
total parameters unlocked: 29  (avg. ~2.07 per benefiting script)
```

Per-script detail (name → the Pine variable(s) now adjustable):

```
01-stoch-rsi-screener.pine                    +4 (lengthRSI, lengthStoch, smoothK, smoothD)
02-ict-retracement-to-order-block-screener    +1 (i_period)
03-rsi-directional-momentum-scanner.pine      +2 (i_rsi_len, i_rsi_ma_len)
06-adx-advanced.pine                          +3 (diLen, sigLen, levelWeak)
07-rsi.pine (the golden-journey fixture)      +1 (length)
08-stochastic-v4.pine                         +3 (periodK, smoothK, periodD)
10-supertrend.pine                            +2 (mult, length)
11-donchian-channel.pine                      +1 (dcLen)
13-average-true-range.pine                    +2 (atrLen, maLength)
15-anchored-vwap.pine                         +2 (pivLeft, pivR)
16-smacd.pine                                 +5 (len1, len2, len3, len4, len5)
17-simple-moving-average.pine                 +1 (length)
18-normalized-average-true-range.pine         +1 (length)
20-smc-toolkit-udt.pine                       +1 (swing_length)
```

**Scripts still correctly refused:** 7/21 — unchanged, byte-identical
refusal reasons before/after (confirmed by the same per-script identity
check above; the flag never changes a refusal into a pass or vice versa).

**Scripts still frozen at defaults due to unsupported input types:** every
`input.bool`/`input.string`/`input.source` in the corpus — unchanged, by
design (owner's explicit v1 scope). Not separately re-counted here because
`FOLDED_INPUT_INEXPRESSIBLE`'s refusal-by-name behavior for these kinds
(`builderInputs.js`) is untouched code, already covered by that module's own
existing tests.

## 8. Known limitations (all disclosed in code comments at the point they apply)

1. **Bar-displacement (`close[n]`) Pine inputs are not supported.** An
   offset node's own literal is a bare number, not a `{type:'num'}` node,
   and `pine.js`'s offset-building code does not tag that bare primitive
   today (a JS number cannot carry a non-enumerable property). Server-side
   reconciliation already handles this locator SHAPE correctly
   (`test_4_offset_window_case`, proven on a hand-built fixture); the gap is
   translator-side production of one. Not reachable from the golden-journey
   fixture; not named in the owner's authorization.
2. **`options` (a numeric enum on `input.int`/`input.float`) is not
   populated**, verified not assumed: this parser has no array-literal node
   type at all today, so building one would be new parser surface, not a
   Track F-specific gap.
3. **A screen-threshold-wrapped Pine import does not get a parameter.**
   `conditionFrom` builds new text wrapping the column in a comparison; the
   locators computed against the unwrapped tree would point at the wrong
   position after the eventual re-parse. Deliberately gated off
   (`PineBox.jsx`'s `wrapped` check) rather than shipping a wrong locator.
   The underlying formula still saves and screens correctly, exactly as
   before Track F — only the control is withheld for that one action.
4. **Reassigning which plot row is the "scan" plot, after importing a
   parameterized script into a different row, can point a `treeIndex: null`
   locator at the wrong row's tree.** Server-side reconciliation still fails
   safely (detaches or reads an unrelated literal, never crashes). Not
   reachable from any single-plot import, including the golden-journey
   fixture.
5. **A Pine input used as a bare literal in one place and combined into an
   expression elsewhere gets a locator only for the surviving occurrence(s).**
   Verified, not assumed, to be safe: this translator does not
   constant-fold pure-literal arithmetic (confirmed by direct probe), so
   this is rarer than initially assumed — most structural wrapping (`len *
   2`, `close + len`) still carries the tag. The residual case (an
   occurrence a *different* fold discards, e.g. a boolean-identity
   collapse) is silent and safe: the untracked occurrence keeps computing
   off its own already-correct literal forever, never a wrong value.
6. ~~The "reopen an already-saved definition to keep tuning its parameter"
   UI door was not located in this session's search.~~ **RESOLVED same day
   (§13): the door exists, was already wired, and is now live- and
   regression-verified.** Left struck through rather than deleted — the
   original miss (a search that didn't scroll far enough) is itself a
   useful record, not something to quietly erase.

## 9. Assumptions falsified during implementation (beyond the spike's own)

1. **ADR V2.2 §1's locator schema (`{treeIndex, bindingId}`) does not match
   how a parameter edit is actually applied.** There is no `let
   __uct_param_1 = 14` source syntax anywhere — `compute.source` for a
   parameterized definition is ordinary printed text, indistinguishable in
   shape from a hand-typed formula. (Corrected in the spike itself, restated
   here because it governed every subsequent implementation choice.)
2. **`foldWindow` — the function every window/length-slot argument passes
   through — silently drops the parameter tag, even on a genuine no-op
   fold.** This was not predicted by any ADR or the spike report; found only
   by writing `pine.paramManifest.test.js`'s first real test case (a bare
   `sma(close, length)`) and watching it fail while a more complex,
   arithmetic-wrapped case passed. This is the single most consequential bug
   fixed in this implementation phase — uncaught, it would have made every
   window-bound Pine input (the majority case, and RISK-013's own motivating
   scenario) silently ineligible, for a reason invisible anywhere near
   `resolveInput` itself.
3. **This translator does not constant-fold pure-literal arithmetic**
   (`length * 2` stays a real `op` node, never collapses to a bare `28`).
   Not assumed — verified by direct probe before writing `pineParamManifest
   .js`'s eligibility-scope documentation. This means Track F's reach is
   broader than "bare call-argument pass-throughs only," safely, since
   nothing here ever introduces an identifier regardless of how deep the
   tag survives.
4. **`memberInputTranslation`'s `declareInputs` mechanism and Track F's own
   mechanism cannot share one `translatePine` call.** `declareInputs`
   structurally cannot reach a window-bound input; the FIRST design draft
   assumed piggybacking Track F on the existing `inspect()`/
   `memberInputTranslation` call would be a two-line change. It is not — a
   name `declareInputs` DOES manage to declare takes `resolveInput`'s early
   return before Track F's own tagging code ever runs, which would have
   silently split one script's parameters across two non-interoperating
   mechanisms depending on each input's own position. Fixed by making
   Track F's manifest computation a fully separate, plain `translatePine`
   call.
5. **`H.requests.find(r => r.method === 'POST')` in `BuilderSheet.pine.test.jsx`
   was already broken by Track C's own telemetry work, unrelated to Track
   F.** Discovered only because a Track-F-caused-looking failure turned out,
   on stash-isolated investigation, to reproduce on a fully pristine
   pre-Track-F `pine.js`. Recorded here because it is exactly the
   "verify against a real baseline, don't assume causation from
   correlation" discipline this whole program has repeatedly required.

## 10. Is RISK-013 closed, partially closed, or open?

**PARTIALLY CLOSED**, precisely and deliberately — matching the scope the
owner authorized, not a shortfall:

- **Closed** for the case RISK-013's own motivating fixture actually needed:
  a window/length-bound `input.int` (the majority shape across the real
  corpus per §7 — every one of the 14 translating scripts' adjustable
  parameters found this session are, in fact, mostly lengths/periods) now
  survives as a genuinely adjustable, server-protected, persisted parameter.
  The original golden journey's own finding — "5 declared inputs did not
  carry over; only their defaults did" — is now, for `length` specifically,
  **carries over and is adjustable, verified live in this rerun.**
- **Still open** for `input.bool`, `input.string`, `input.source`,
  `input.timeframe`, `input.symbol`, `input.time`, `input.color`, and any
  switch/branch-driving input — explicitly out of v1 scope by the owner's
  own instruction, not attempted, not silently dropped (each still folds to
  its default and is disclosed as fixed via the pre-existing, unrelated
  `builderInputs.js` machinery where that machinery already reaches it).
- **Still open** for the numeric-options and bar-displacement edge cases
  named in §8.

**Done (2026-09-05):** `RISK_REGISTER.md`'s RISK-013 entry updated to PARTIALLY
CLOSED with this exact split (int/float, non-displacement case: closed; other
input kinds and shapes: open), cross-referencing this report. `DECISIONS.md`
DEC-006 and `VALIDATION_COVERAGE_MAP.md` updated to match.

## 11. Is Track F narrow v1 ready to remain enabled?

**Yes**, on the evidence gathered:

- 60 new tests (39 this phase + 21 promoted from the spike), all passing.
- Zero regressions in 2323 re-run pre-existing tests (3 pre-existing,
  independently-confirmed-unrelated failures, none touched).
- A real, live, server-round-tripped save (§6 item 9) proves the mechanism
  end-to-end, not just in isolation.
- Reject-not-clamp verified live (§6 item 17), not just in a unit test.
- The feature is opt-in at every layer (`paramManifest: true` on
  `translatePine`; `compute.paramManifest` presence gates every downstream
  behavior) and proven byte-identical otherwise, both by targeted tests and
  by the corpus-wide identity check in §7.
- Every known limitation (§8) fails SAFE — detach/conflict/non-literal/
  skip, never a wrong computed value, never a crash.

## 12. Issues for owner/ChatGPT review

1. ~~The "reopen a saved definition to edit its parameter later" UI door was
   not located this session.~~ **RESOLVED same day — see §13.** The owner
   authorized exactly the small, scoped follow-up recommended here (reuse
   the existing `PUT /{def_id}`/`openForEdit` path, no new architecture),
   and it turned out the door was already wired; the task became verify +
   permanently regression-test, not build.
2. **RISK_REGISTER.md's RISK-013 entry updated** (2026-09-05) — now
   PARTIALLY CLOSED, per §10's wording, cross-referencing this report.
   `DECISIONS.md` DEC-006 and `VALIDATION_COVERAGE_MAP.md` updated to match.
3. **`pine.blindCorpus.test.js`'s accepted-floor gap (21/48 vs. floor 28)**
   is Track A's concern (vendor-parity functions), confirmed unrelated to
   Track F, surfaced here only because it appeared in this session's own
   regression runs — no action requested of Track F.
4. **`BuilderSheet.pine.test.jsx`'s telemetry-ordering test failure** (§5.2)
   is a real, pre-existing bug in that test's own assertion (picks up a
   telemetry POST instead of the save POST) — not caused by and not fixed
   by this report, since fixing another track's test is outside this
   session's authorization. Flagged so it isn't mistaken for a Track F
   regression by a future reader of CI output. Still present, unchanged, as
   of the §13 follow-up.

No further Track F scope (bool/string/source/timeframe/symbol/time/color,
options, bar-displacement) has been started. Track F is stopped after §13.

## 13. Follow-up (same day): saved-definition parameter reopen/tuning UX — ACCEPTED

Owner authorization: find the existing real product path for reopening an
already-saved definition; reuse it (no new architecture); add a real
browser/E2E regression; do not build a new UI if none exists — document and
propose the smallest integration plan instead.

### 13.1 The door already existed and was already wired

Grepping `BuilderSheet.jsx`'s own `openForEdit`/`rows` code (rather than
more browser searching) found it directly: **"Your formulas"**, a real list
fed by the real `useUserDefinitions()` hook (`app/src/hooks/
useUserDefinitions.js`), rendered at the bottom of the SAME "New formula"/
"Edit formula" dialog the create flow already uses — one scroll past the
Save/Cancel buttons. Each row has a pencil `Edit <name>` button calling
`openForEdit(row)`.

`openForEdit` **already restored `compute.paramManifest` into state**, from
the `91fdbb222` commit that first wired `ParamControls` into the create
flow (`setParamManifest(compute?.paramManifest ...)` sits right beside the
pre-existing, identical restore of `memberInputs`). Nothing about the
reopen mechanism itself needed to be built — only verified and permanently
protected, exactly matching what the owner's own instruction anticipated
("if no real reopen/edit UI exists, do not build one blindly" — it existed).

This was missed in this report's own §6 live-browser pass, which checked
the Indicators dialog's row (toggles add/remove), the per-instance
`IndicatorSettingsDialog` (a different, correctly-unrelated mechanism), the
legend right-click menu, and the Screener's "My Scans" list — none of
which is the actual door — and did not scroll further down the dialog it
was already in. Corrected in §6/§8/§12 above rather than silently.

### 13.2 Verification performed

**Real-UI wire-cut regression (new, permanent):**
`app/src/components/chart/builder/BuilderSheet.paramReopen.test.jsx`, one
test, driving the owner's exact sequence with nothing mocked but `fetch`
(the same "wire, not the parts" discipline `BuilderSheet.pine.test.jsx`
already uses for the create half):

1. Import the real `07-rsi.pine`-style fixture (`length = input.int(14,
   "Length"); plot(rsi(close, length))`) through the real paste UI.
2. Confirm `ParamControls` shows "Length" = 14 before any save.
3. Save — a real POST, captured by a **stateful** fetch mock (an in-memory
   row store, not the trivial always-empty mock the create-flow test uses)
   so a save genuinely becomes visible to a later GET, the same way a real
   database would.
4. A genuine `cleanup()` unmount — "leave the builder."
5. A fresh mount with a fresh SWR cache — "reopen," exactly like a real
   reload — finds the saved row in the real "Your formulas" list and clicks
   its real Edit pencil.
6. Confirms the formula (`rsi(close, 14)`) AND the parameter's persisted
   value (14) are both restored, and that **no raw `__uct_param_<n>`
   binding id is ever shown** — only the manifest's own `title` ("Length").
7. Changes the value to 30 through `ParamControls`; confirms the Formula
   field updates to `rsi(close, 30)`.
8. "Save changes" fires a **PUT** (not POST) to `/api/user-definitions/
   {defId}` — the SAME `defId` as the original create — with the immutable
   `default` (14) unchanged and the new current value (30) correctly
   reconciled (reusing `paramEdit.js`'s own `reconcileParams`, not a third
   reimplementation of that logic).
9. A second unmount + fresh mount + reopen confirms the SECOND edit (30)
   persisted, not just the first.

Result: **passing**, first correct run after one fix during development
(`findByText`/`findByRole` under fake timers never resolve — the exact
gotcha `BuilderSheet.pine.test.jsx`'s own header comment already warns
about; switched to `getByText`/`getByRole` after an explicit `act()`-driven
timer advance, matching that file's established convention).

**Live browser pass (isolated sandbox, same mechanism as §6):** paste a
fresh `input.int(14,"Length")` script → Use → Save ("RSI Reopen Live Test",
legend confirmed on the real chart) → close the dialog → reopen the
Indicators dialog → "New formula" → found **"Edit RSI Reopen Live Test"**
directly via the accessibility tree, no scrolling/guessing needed once the
right region was known → clicked it → dialog title changed to **"Edit
formula"**, Formula field showed `rsi(close, 14)`, "ADJUSTABLE PARAMETERS →
Length = 14, default 14" rendered correctly → changed to 25, Formula field
live-updated to `rsi(close, 25)` → "Save changes" → **direct database read**
confirmed: same `def_id` (`u_c3ab0f3952ca`), `version: 1 → 2`,
`compute.ast.args[1].value: 25`, `compute.paramManifest.__uct_param_1.
default: 14` (immutable, unchanged), `compute.paramState.__uct_param_1:
{state:"attached", value:25}`, `ast_hash` correctly changed.

### 13.3 Requirements checklist (owner's 10 points)

| # | Requirement | Result |
|---|---|---|
| 1 | No new definition-edit architecture | **Met** — the door already existed |
| 2 | Reuse `PUT /{def_id}`/BuilderSheet edit path | **Met** — confirmed live (real PUT, not a second POST) |
| 3 | Stable `def_id` | **Met** — confirmed live via direct DB read (`u_c3ab0f3952ca` unchanged across the edit) |
| 4 | Load existing `paramManifest` + derived `paramState` | **Met** — `openForEdit` restores `paramManifest`; `ParamControls` prefers a server-provided `paramState` over client re-derivation when present |
| 5 | `ParamControls` only where valid metadata exists | **Met** — gated on `compute.paramManifest` being a non-empty object, unchanged from the create-flow gate |
| 6 | UI edit → compile → AST → save() → server validation → new hash/reproof | **Met** — confirmed live: `ast_hash` changed to reflect the new literal |
| 7 | Save + reload preserves the edited value | **Met** — confirmed live (a SECOND reopen after the edit) and in the permanent test |
| 8 | Detached/conflicted/frozen states stay non-editable + disclosed | **Met, code-verified** (`ParamControls.test.jsx`, `paramEdit.test.js`'s `reconcileParams` tests) — this fixture never enters those states, so not re-driven live this pass |
| 9 | No raw internal binding IDs shown to the member | **Met** — confirmed live (the panel says "Length") and in the permanent test (`expect(screen.queryByText(/__uct_param/)).toBeNull()`) |
| 10 | No broadening into bool/string/source/timeframe/symbol/color/options/bar-displacement | **Met** — nothing of the sort touched |

### 13.4 Regression results

Full builder suite re-run after adding the new test: **1616 passed** (was
1615 — the one new test), the same 2 pre-existing, previously-confirmed-
unrelated failures, zero new regressions.

### 13.5 Conclusion

Requirements, all ten points, met — live-verified twice (a real browser pass
plus a direct database read) and permanently regression-tested. **Track F
is stopped here.** No further Pine-input-type expansion has been started or
is pending.
