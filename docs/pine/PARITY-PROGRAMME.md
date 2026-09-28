# Pine Script Parity Programme

**Goal, verbatim from the owner, 2026-09-21:**
> "A fully capable pine script system that I can paste code and have the same
> exact identical indicator on UCT as it looks on TradingView… I want to
> recognize 0 differences in the scripts compared to tradingview. I want all
> codes of pinescript to be able to be recognized and replicated and shown on
> our charts."

**Scope:** full Pine v6 language surface + `strategy()` + user libraries
(`import`). Not a subset. Not the "indicators I use daily" version. The whole
ecosystem, minus one deliberate carve-out named in Phase 3.

**Working mode:** everything ships behind local flags first
(`VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`, `VITE_PINE_MEMBER_PANE_ENABLED`,
plus one flag per new capability). Nothing reaches production until the
paste-into-chart demo of a real script draws identically to TradingView
side-by-side. The local dev loop (`scripts/hub_sandbox_boot.py --port 8000` +
`cd app && npm run dev`, both env flags on) is the daily rhythm.

---

## ⭐⭐ 2026-09-27 — THE RUNTIME LANE AS A GATED FALLBACK AT THE MEMBER DOOR (branch `pine/runtime-lane-door`)

> Owner goal, 2026-09-27: *"fully import every and any TradingView Pine script
> indicator so it shows on UCT charts exactly as on TradingView."* It supersedes
> ruling D2 for ONE path, and only that path. Base `pine/object-pass-integrated`
> @ `f33bee110`. Every count is `memberPaneDefinition` over the 266 committed
> scripts (`runtimeLaneDoor.census.measure.test.js`, `RUNTIME_CENSUS=1`).

### The design

**When.** `memberPaneDefinition` asks the host lane first, exactly as before. Only
when `paneGate` REFUSES, and **every** refusal the host translation carries is a
limit of its own single-expression value model, does it try the runtime lane.
That set is `RUNTIME_FALLBACK_GUARDS` in `engine/pineRuntimeLane.js`:

| guard | proof (the host refuses it with that guard alone; the runtime lane builds it) |
|---|---|
| `pine:state` | `var float s = 0.0 / s := s + close / plot(s)` |
| `pine:reassign` | `float s = 0.0 / for i = 0 to 3: s := s + close[i]` |
| `pine:block` | `x = switch …` as a value |
| `pine:collection` | `array.new_float` / `array.push` / `array.get` |
| `pine:type` | `type P` + `P.new(close)` |
| `pine:function-def` | `trendlines__43QQg9nDN0` (corpus; it draws, so built with object ownership) |

⚠️ **Measured out:** `pine:tuple` and `pine:na` read like value-model limits and are
NOT in the set — no fixture exists where the host refuses them and this lane builds
(`[k, d] = ta.stoch(…)` refuses here too, `runtime:tuple`; `fixnan` refuses in both
lanes). ⛔ **No vocabulary or ruling guard is ever in it** (`pine:function`,
`pine:role-order`, `pine:input-kind`, `pine:request`, …): those record that nobody
has ruled what a name MEANS, and a second engine must not route around them.
Measured: `support-and-resistance__UgNPprOr8h` (host `pine:role-order`) BUILDS in the
runtime lane and is still refused. The host lane stays authoritative whenever it
succeeds — the census asserts no host-attached script changes lane.

**What is saved.** A `compute.kind: 'pine'` document
(`builder/memberPane/runtimeLaneDefinition.js`), assembled by the SAME
`buildDefinition` the host door uses, with its `compute` replaced by:

```
{ kind: 'pine', fn: 'pine:<fnv1a>', rev: 1,
  source: <the member's Pine>,                 // the program, recompiled per chart
  lane: { plotColours, ownsDrawing },          // the build options the indices were minted under
  columns: { <plotKey>: { output, call, line, shift? } },
  inputs:  { pine_<name>: <Pine name> } }      // member settings → the runtime's input names
```

⭐ **The source, recompiled — never a stored program.** The runtime program is
compiled against the bars (pure sub-expressions become columns at build time) and
the member's values (a length sizes a ring before bar 0), so nothing stored could be
"the maths" the way `compute.ast` is. `computeFor` (kind `pine`) →
`pineRuntimeLane.runtimeLaneColumns` rebuilds per (bars, inputs, tf, symbol, clock),
cached by the bars array's identity, and **checks the saved map against the rebuilt
program** — a stale map is `runtime-door:shape`, never another plot's series. Every
failure is a named column error; nothing throws into the binder.

**How settings edit.** Every numeric input the program READS (`collectInputs`) is a
real per-instance `int`/`float`/`bool` input (`pine_<name>`); the rebuild hands the
member's values to the runtime with `inputsReachEveryFold`, so a length reaches the
window and a history offset reaches its ring — the half-applied knob the frozen
resolver would otherwise produce. This is ruling R-H's "inputs as runtime
parameters" for runtime documents. Withheld, each with a sentence: an input that sets
where a plot is drawn (`offset =`); an input read only on an output the pane does not
draw (`hline(th)`); and every input when the document carries a host object program
(those trees were translated at the defaults).

**How it draws.** Through the same pane, binder and object renderer:
- **Presentation is the host lane's.** `translatePine(src, {drawPresentation: true})`
  hands each output row — refused rows included — its title, style, width, marker,
  static colour (through `pinePalette.js` by `@version`) and displacement, read by the
  host row's own readers. Rows pair with runtime outputs by `(call, line)`.
- **A colour the host cannot fold is the runtime lane's own.** `plotColours` emits each
  plot's `color =` as a per-bar packed-colour output; the row draws it through the new
  `colorMode: 'rgba:<key>'` (`binder.pointColour`, `markersFor`, fills). `na` paints
  transparent. A colour neither lane can carry is drawn in one colour and SAID.
- **Objects:** the host object pass's program, under the same `paneObjectsGate` +
  `objectLossNote` partial-drawing rule — a lost removal withholds the drawings and
  keeps the plots; anything else is drawn and disclosed "N of M". The runtime lane
  treats drawing calls as the object program's only when that pass saw them.
- **Not drawn, and said:** `hline`, `bgcolor`, `barcolor`, `plotarrow`, alert
  conditions (D1's sentence), rows past the pane's visible ceiling; a
  `request.security` script is refused (`runtime-door:request`) because every value
  would draw as `na`.

**Flag.** `VITE_PINE_RUNTIME_LANE_ENABLED`, default OFF (`=== '1'`, fail-closed), ONE
module (`engine/pineRuntimeLaneGate.js`) read by the door AND the install door
(`validateUserDefinitions`), so a `pine` document minted on an armed build cannot
compute on an unarmed one. Dockerfile.web ARG + ENV; both ledgers `dark`.

⛔ **The lane has ONE door.** `pineRuntimeFrontendGate.test.js` now asserts the live
importers of the runtime lane are EXACTLY `engine/pineRuntimeLane.js` (the fallback)
and `engine/runtime/objectLane.js` (lane-internal, reached by no component), and the
fallback's own importers are exactly the door, the document builder and `nativeRegistry`.
`tools/pine_lane_reachability.mjs` therefore now reports the runtime frontend/VM as
reached (**204** components, through `nativeRegistry`) — which is the door, and is why
the importer rail, not the reachability report, is what guards it.

### The census — four flag combinations

| objects-only | runtime lane | attached | of 266 |
|---|---|---|---|
| off | off | **34** | 12.8% |
| on | off | **54** | 20.3% |
| off | **on** | **40** | +6 |
| on | **on** | **60** | +6 |

**Newly attaching through the runtime lane (the same 6 under both objects settings):**
`adx-and-di-for-v4__932`, `cc-yata__bd898a1af0`, `fvg-trend__21e364f2ed`,
`pivot-point-supertrend__HN4w1eNW3B`, `qqe-signals__EhBrwQPjZ1`,
`trendlines__43QQg9nDN0`. Matches the programme's 2026-09-23 prediction (+6).

### The second walls — ranked by scripts each would COMPLETE

54 scripts are admissible to the fallback; 6 attach; **48 hit a runtime-lane wall.**
Peeled line by line through the runtime DOOR's own build (the `peelToBuilding`
method: a failing binding becomes `= 0.0`, any other failing line is blanked):

| clearing this wall ALONE completes | scripts |
|---|---|
| `runtime:history-dynamic-offset` | **2** — `atr-stepped-pdf-ma-loxx`, `twin-range-filter` |
| `runtime:statement` | **1** — `btc-charlie-trader-xo-macro-trend-scanner` |
| any two walls (4 pairs) | 1 each: `call-text-state+object-op`, `builtin+input-kind`, `pine:statement+call-undeclared-builtin-state`, `pine:function+input-kind` |

First walls, by count (what the member is told today): `runtime:history-dynamic-offset`
12 · `runtime:array` 5 · `pine:input-kind` 4 · `runtime:statement` 3 ·
`runtime:call-undeclared-builtin-state` 3 · `pine:function` 3 · then 1–2 each.

⛔ **Read the counts as an ESTIMATE, and the ranking as the real finding.** The peel
reached a building program for only **19 of 48**; 17 stuck on `pine:statement` (the
peel's own blanking breaks block structure), 9 hit the 20-step cap. Of the 19, the
median distance is 6 peel steps (range 1–16). So **the runtime lane is nowhere near one capability from
most of these scripts**: `history-dynamic-offset` is the widest FIRST wall (12) but
completes only 2 on its own, because the scripts behind it carry 4–15 more. The
cheapest measured completions are the three single-wall scripts above.

### Evidence against the vendor

- **Both doors, same numbers.** For every committed script BOTH doors build (7), the
  runtime door forced draws **bit-identical** columns to the host door, row for row
  (51 rows, 600 SPY bars; `runtimeLaneDoor.test.js`). ⚠️ This proves the door's
  plumbing, not independent maths: those rows are pure expressions both lanes compute
  through `interpret`.
- **The one native capture, through both engines.** `keltner-channels-bands-rddt-1d-
  2026-09-27` graded through the runtime door gets the same per-plot verdicts and counts
  as the host door (Basis MATCH; the six bands DIVERGE on the documented converging
  seed prefix). Keltner is host-served, so a member never reaches the runtime lane with it.
- **A host-refused script against TradingView.** `adx-and-di-for-v4` (host `pine:state`,
  runtime-lane only) through the full member door: DI+ and DI- against the owner's
  capture of the built-in `ta.dmi(14, 14)` on 300 SPY bars
  (`observations/plus-di-14` / `minus-di-14`) — worst relative difference per 50-bar
  window DI+ `1.5e-2 → 3.7e-4 → 2.9e-6 → 2.2e-7`, DI- `2.9e-3 → 9.5e-5 → 1.6e-6 →
  3.5e-8`: the script's zero seed decaying by (13/14)^50, then agreement to <1e-6.
  ⛔ It is the vendor's BUILT-IN, not a capture of this script (the script's DI is the
  same Wilder recurrence); its ADX is `sma(DX)` where the built-in is an RMA, so ADX is
  NOT compared.

⛔ **No vendor capture of any runtime-lane script exists yet.** The six that most need
one, in order: `adx-and-di-for-v4` (ADX line), `pivot-point-supertrend` (the
state-driven trailing line and its per-bar colour), `fvg-trend` (per-bar colour),
`qqe-signals`, `cc-yata`, `trendlines`.

### Verification on this branch

**Rails** (all by name): `engine/__tests__/pineRuntimeLane.test.js` (flag, guard
proofs, columns/shift/stale-map, knobs incl. a history ring, opt-in options, the
hand-off, the install door, the schema), `builder/memberPane/runtimeLaneDoor.test.js`
(the real door + install + computeFor + binder), `engine/__tests__/
pineRuntimeFrontendGate.test.js` (the one door), `engine/__tests__/vendorHarness/
runtimeLaneVendor.test.js`, and the opt-in census. Python:
`tests/test_dockerfile_vite_build_args.py` + `tests/test_vite_flag_ledger.py` 11/11.

**Mutations — 17 code + 3 wiring, every one RED, every file restored from captured
bytes and sha256-verified (and equal to the committed blob):** flag reads anything as
on · door ignores the flag · admissible on the first guard only · a ruling guard joins
the set · install door ignores the flag · saved map trusted · member values stop at
the columns (⚰️ SURVIVED the first run — the length case read through a column; a
history-ring case was added and it went red) · no plot colour channel · binder ignores
the packed colour · objects drawn despite a lost removal · displacement input offered
· undrawn-only input offered · runtime tried when the host succeeds · refused rows lose
the hand-off · bool spelling lost · **the fallback stubbed out (18 red)** · computeFor
loses the `pine` lane (13 red) · Dockerfile ARG removed · ENV line removed · ledger row
removed. Unmutated control green before and after.

**Regression** (engine suite + `src/components/chart/builder/`, this branch vs base
`f33bee110`, by test-name set difference): 9,562 → 9,623 tests, 20 → 23 failed. The
three names red only here: `pineRuntimeFrontendGate` "the fallback itself…" — a real
catch, the rail counted `__tests__/vendorHarness/ourSide.js` as a door, fixed;
`memberPaneGate` "is read in exactly ONE place" (STACK_TRACE_ERROR under load) and
`stockChartWiring` "A HOVER REACHES THE RENDERER NOT AT ALL" — both pass alone. **No
new failures.** ⚠️ `memberPaneGate` "WAS VACUOUS" is red on BOTH trees (it has
asserted "no non-test importer of pineRuntimeFrontend" while `runtime/objectLane.js`
was one); it now names two, and its own message asks for a rewrite once the lane has a
consumer — left for the owner of that file.

### Open, for the owner

1. **The store refuses the document.** `api/services/user_definitions.py::save`
   requires `compute.kind == 'ast'` and hashes `compute.ast`; so with the flag on a
   runtime-lane pane PREVIEWS and draws in the builder, and "Add this script to my
   chart" is refused with the store's own sentence. Widening it is a backend change
   with its own blast radius — the scan sweep, alerts, definition records and relint
   all read `compute.ast` off stored rows and must skip or serve `pine`.
   ⚰️ **SUPERSEDED on branch `pine/pine-store` (2026-09-27, `7e3b02370`):** the store
   takes a `pine` document behind its OWN backend flag `PINE_RUNTIME_LANE_STORE_ENABLED`
   (dark; off = the old sentence, byte for byte), validates its shape and RE-DERIVES
   `compute.fn` (`user_definitions.runtime_lane_handle` ⇄ `engine/pineRuntimeHandle.js`,
   now FNV-1a over KEY-SORTED JSON so a stored-and-read-back document keeps its handle).
   Every server consumer refuses a stored `pine` row BY NAME
   (`user_definitions.RUNTIME_LANE_REASON`): `scan_definition.assert_scannable` (sweep
   nightly + live — counted in `refused`, the receipt identity still closes — screener,
   scan run, the list stamp), `alert_user_series._gate_lane`, relint (one UNCOMPARABLE
   finding, never healed), the forward-record and backtest routes. Rails:
   `tests/test_user_definitions_pine_store.py` (55) + `runtimeLaneStoreRoundTrip.test.jsx`
   (save → list → load → computeFor against the store's recorded answers). Mutations:
   11 backend + 2 frontend, every one red, each restored and verified against the
   committed blob. ⛔ Nothing on the server COMPUTES one: no nightly scan, alert,
   forward record or backtest of a runtime-lane script exists.
2. **The repaint badge** of a runtime document is a token rule (`repaints` when the
   source reads a realtime `barstate.*`, `timenow` or `varip`; else `non-repainting`),
   not the linter — there is no tree to lint.
3. **An input read only by a branch dead at the defaults** is not offered (the program
   never reads it at those settings).
4. **A document carrying objects offers no settings** (host object trees are the
   defaults'); per-input object trees are the object lane's job.
5. **`transp =` on a plot whose colour is per-bar** is unmeasured: the packed colour's
   own alpha is drawn.
6. **History dependence.** A `var` accumulator depends on where the loaded history
   starts, exactly as the host's `window_dependent` tag describes for `ta.cum`; the
   runtime door raises that tag only for its rosters' Pine spellings (`ta.cum`,
   `barstate.isfirst`), not for every `var`. A broader sentence is a ruling.

⚠️ **Observed, pre-existing, not changed here:** `buildDefinition` drops a row's
`opacity` (the member door sets it; the document never carries it), for host and
runtime documents alike.

## ⭐ 2026-09-27 — THE VOCABULARY WAVE: which names are the LAST wall (branch `pine/vocabulary-wave`)

> Base `0a16dd9ab` (`pine/object-pass-integrated`). Door = `memberPaneDefinition` over the
> 266 committed scripts, objects-only flag off/on. Census tool (opt-in, committed):
> `app/src/components/chart/builder/memberPane/vocabularyWalls.census.measure.test.js`
> (`VOCAB_CENSUS=1`). Capture queue: `docs/pine/capture-queue-2026-09-27.md`.

**How "last wall" was measured.** For every script the door refuses with a vocabulary
guard (`pine:function` 7 · `pine:builtin` 6 · `pine:input-kind` 2 · `pine:arity` 1 = **16
scripts**, identical flag off and on), the refused name was replaced — every occurrence —
by a correct-TYPE value (`time(...)` → `time`, `ta.nvi` → `close`, `syminfo.mintick` →
`0.01`, …) and the door re-run until it attached or met a non-vocabulary wall. Never by
deleting a binding line (that removes a name and manufactures `pine:undefined`). The chain
is identical flag off and on for all 16.

**The result, measured: only FOUR scripts have a vocabulary name as their last wall, and
every one of the four is held by a RULING or an unmeasured semantics, not by a missing
table row.**

| name / form (first site) | first wall of | inside (masked) | LAST wall of | class | built? | evidence |
|---|---:|---:|---:|---|---|---|
| `time(tf, session[, tz])` (`opening-range…4a7416ab01:12`, `session-highs…c0ca8cf749:49`) | 2 | 0 | **1** (`opening-range-initial-balance-opening-price`) | C | no | 5m only (`r11-time-session…`); 1D unread → probe `vw-time-session` |
| `input.time` (`session-hilo…WM2g5GtC4h:44`, `open-interest-profile…875691ab51:85`) | 2 | 0 | **1** (`session-hilo`) | B, **ruled** | no | ruling: `pine:input-kind` "under the threshold"; value confirm in `vw-time-tf` T16 |
| `ta.nvi` + `ta.pvi` (`smart-money-interest-index…:13-14`, `smart-money-volume-index…:17-18`) | 2 | 0 | **2, jointly** (neither alone) | C, **ruled** | no | nvi seed on disk; pvi unread; `_functions_excluded.nvi/.pvi` refuses the fetch-dependent level → probe `vw-nvi-pvi` |
| `time(<tf ≠ D>)` (`smart-money-concepts…:250`, `zigzag-ma…1302:24`, + 4 inside) | 2 | 4 | 0 (→ `pine:reassign`, `pine:request`) | A for W on 1D, C otherwise | no (needs a new clock column, both lanes) | `r11-time-tf…` (W, 610 bars, summary only) → probe `vw-time-tf` |
| `syminfo.mintick` (`chart-champions…:73`, `renko…:40`) | 2 | 2 | 0 (→ `pine:state` ×2) | C (data) | no | `symbolScope.json::unserved` → probe `vw-mintick` |
| `barstate.isnew` (`liquidity-engulfing…:24`, `smart-money-volume-activity…:81`) | 2 | 0 | 0 (→ `pine:request`, `pine:reassign`) | A, **ruled** | no | `barstate-full-spy-1d-closed-2026-09-10.json`: 1 on history, 0 on the newest closed bar; `_barstate.refused.isnew` |
| `ta.vwap(src)` / v4 `vwap(src)` (`cpr…:205`, `camarilla…:313-316`, `rsi-vwap…:21`) | 1 | 2 | 0 (→ `pine:state`) | **A** for `hlc3` | **yes — `hlc3` only** | `groupb-round-max-vwap…`: `vwap(hlc3) − vwap` all 0 over 40 bars; `vwap(close)` is a different column and still refuses |
| `year/month/dayofmonth(time)` (`initial-balance…M0u1uaug4Q:113`) | 1 | 0 | 0 (→ `time(session)`) | **B** | **yes** (+ `dayofweek`, `hour`, `minute`) | Pine reference: `year(time)` with no zone IS bare `year` (exchange zone, measured by `r11-nine-safe`); confirm probe `vw-clock-vwap` |
| `timeframe.in_seconds(<non-literal>)` (`multiple-mtf…aArjfk9ShG:177`) | 1 | 0 | 0 (→ `pine:state`) | B for a literal (already served) | — | the literal form folds today; `vw-time-tf` T10–T15 confirm per code |
| `int(<fractional>)` (`smarter-snr…:75`, `atr-god…:148`) | 1 | 1 | 0 (→ `pine:window`) | C | no | the `int` branch's own refusal; probe `vw-int-cast` |
| `str.length(<non-literal>)` (`renko…:26`) | 0 (2nd) | — | 0 | C (text) | no | — |
| `chart.right_visible_bar_time` (`open-interest-profile…:88`) | 0 (2nd) | — | 0 (→ no-output) | never matchable statically (viewport) | no | — |
| `ta.alma` (`delta-volume-candles-lucf…:296,300`) | 0 | 1 (`pine:module`) | 0 | B | no (new table fn, zero unlock) | probe `vw-alma` |
| bare `alma` (`highlow-channel-swing…:30`, `relative-volume…:71`) | 0 | 2 | 0 | **vendor REFUSES** | **must never be added** | `r11-alma-spy-2026-09-11.json` |
| `ta.barssince(cond)` 1-arg unbounded · bare `barssince` 1-arg | 0 | 3 | 0 | ruled (unbounded; `r11-barssince…`) | no | — |
| library / UDT names (`zen.`, `mymas.`, `pc.`, `PCvc.`, `kernels.`, `LucfTa.`, `breakout` arity, `input.enum`, `chart.bars/leftBarIndex/rightBarIndex`) | 0 | 11 | 0 | not vocabulary (Group C) | no | `r11-vocabulary-gap.md` |

**Door counts, measured with `partialDrawing.census.measure.test.js` before and after:**
flag off **34 → 34**, flag on **54 → 54**. **No script newly attaches** — the expected
answer, since no last wall was an A/B name. One wall MOVED: `initial-balance-ib-and-
previous-day-week-high-low-close` now refuses on the `time(<session>)` session clock
instead of on `year(time)` (both flags). `pineTimenowAccept.test.js` records the move.

**What shipped (the two names are IDENTITIES onto columns the engine already carries — no
table name, no Python lane, no frozen digest moved — plus one guard their first consequence
needed):**
1. `ta.vwap(hlc3)` / `vwap(hlc3)` / the spelled-out `(high + low + close) / 3` → `vwap()`.
   Any other source still refuses (`pine:arity`), now saying it is a different column and
   naming `ta.vwap(hlc3)`. `ta.vwap(src, anchor)` unchanged.
   ⚠️ An `input.source` DEFAULTING to `hlc3` translates too — the same behaviour
   `sourceMustBe` already has for `ta.cci`/`ta.mfi`: an edit to another source is a
   re-translation, which then refuses.
2. `year|month|dayofmonth|dayofweek|hour|minute(time)` → the bare field, for a VERSIONED
   script (whose `time` is `time * 1000`; recognised by identity with
   `PINE_CLOCK_TRANSFORM.time()`). `time[1]`, a computed timestamp, a zone string and a
   versionless script still refuse. `dayofweek(timenow)` refuses (no `lastbardayofweek`).
3. **`pine:budget` — screener lane only.** Once `ta.vwap(hlc3)` translated,
   `26-spy-to-es-qqq-to-nq` (community fixtures, non-strict) offered `sma(vwap(), 3)`, which
   the budget refuses ("nothing can be wrapped around" the session-long `vwap()`): a
   translation `doorScorecard` rightly calls unsaveable. The translate door now refuses a
   column whose tree `checkBudget` rejects for `budget:lookback` AND that contains a
   session-anchored call, in the budget's own sentence, on the SCREENER lane only.
   ⚰️ **A blanket version was built first and measured wrong:** on the member door it
   detached `volume-spikes-growing-volume-signals-with-alerts-scanner` (lookback 1000 > 960)
   and `liquidity-pools__fa7b28e733` — the chart pane does not save under that budget, so
   refusing there was an over-refusal. Narrowed to one cause and one lane; measured reach over
   `pine`, `pine_community`, `pine_oos` and the 266, both lanes: script 26 only.
   ⚰️ **And a second over-reach, caught by the suite:** measuring every screener tree
   turned four trees the budget cannot MEASURE (a folded zero window — the C10 seam) into
   `pine:statement` refusals. The session test now runs first and the measure is guarded;
   an unmeasurable tree keeps meeting the engine's own refusal later, as before.
   `REFUSALS` grows 43 → 44 (`symbolRosterSpeaks` re-pinned, with the reason).
   `pine.guardCensus`: `pine:arity` joins the unexercised list (its only corpus firing was
   that `ta.vwap(input_vwap_source)`), `pine:budget` is exercised.

Rail: `app/src/components/chart/engine/ast/pineVocabularyWave.test.js` (12 tests; the vwap
half READS the capture and asserts both its zero and its non-zero control). Mutation-proved
8 ways, each red, restored from captured bytes and sha256-verified, unmutated control green:
bar-time branch dead (1 red) · any argument accepted as bar time (3) · vwap accepts any
source (1) · vwap branch removed (2) · the refusal gate forgets `dayofweek` (2) · budget check
removed (1) · budget check on the host lane too (1) · budget check not narrowed to a session
anchor (1).

**Open, for the owner — each is a ruling, not a build:**
1. `time(<session>)` on a daily bar — the refusal says "this engine screens daily bars,
   where there is no inside to be in". Whether TradingView agrees is unread (probe #1). It
   is the sole last wall of one script.
2. `input.time` — sole last wall of `session-hilo`; blocked by the input-kind threshold
   ruling, not by semantics.
3. `ta.nvi`/`ta.pvi` — the fetch-dependence ruling; probe #3 turns its premise into a
   measurement (two depths, same dates).
4. `barstate.isnew` — the capture on disk already says TradingView answers 1 on every
   historical bar and 0 on the newest closed bar; the ruling refuses on per-tick grounds.

---

## ⭐⭐ 2026-09-27 — THE CALL-SITE INLINER UNDER THE PARTIAL-DRAWING RULE (branch `pine/object-pass-integrated`)

> `pine/partial-drawing-rule` (PR #207) + `pine/object-pass-no-output` (5 commits on
> master `9310ae0b0`), merged as `bb30a149e`. Every number is `memberPaneDefinition`
> over the 266 committed scripts, objects-only flag off/on, measured with
> `partialDrawing.census.measure.test.js` (`PARTIAL_CENSUS=1`) on all three trees the
> same day. The object-pass tree has no loss classification, so its row is attach
> counts only.

**What had to change.** Nothing about what the object pass DROPS: the drop ledger
(`dropReasons`, `droppedOps`) of every committed script is identical to object-pass
alone, flag off and on (census diff: 0 scripts). The partial rule's counters did not
cover the new pass, in two ways:

1. **`fn:<why>` was a drop without an attempt.** A refused call to a drawing function
   was counted in `droppedOps` and not in `attemptedOps`, so 27 corpus scripts read
   "N of M" with N > M (`mgi-levels-suite` "304 of 0"). A refused call is now one
   attempt and one drop.
2. **A refused call's body was invisible to the removal rule.** It is never walked, so
   a `line.delete` inside a refused helper reached no counter and the door drew around
   it. `refuseCall` now records what the body would have removed
   (`objectFnInline.bodyEffects`: token-level, transitive through the user functions
   and methods it calls; a method-form `x.delete()` names no family and therefore
   always reaches — fail closed), and the pass feeds it into `lostRemovals` (via
   `fn:<why>`) and `unconvertedFnOps`.

**New keys and their classes** (`objectLoss.js`; the rail derives every `why` from
`pineObjects.js` / `objectFnInline.js` source and fails by name on an unclassified or
dead one):

| key | class | why |
|---|---|---|
| `fn:method` `fn:var-init` `fn:in-expression` `fn:unknown` `fn:loop` `fn:depth` `fn:arity` `fn:conditional-history` `fn:receiver` | **BODY** (new) | the body never ran; classified by what it held — REMOVES if it deletes/clears something drawn, LIST if it only changes an object list, else PARTIAL |
| `fn:return-type` | LIST | refused AFTER the body was inlined; only the returned handle is lost |
| `copy:source`, `guard:copy` | LIST | the caller's variable keeps the previous handle, so a later delete removes the old object |
| any other `fn:*` | REMOVES | unclassified fails closed |

The history delete (`line.delete(sup[1])`) and the `int(x)` fold add no key: they
REMOVE drops (`delete:target`, `create:*`), which is why several scripts get better.

Measured in the corpus (flag on, drops / scripts): `fn:in-expression` 367/11,
`fn:method` 335/9, `fn:conditional-history` 123/14, `fn:loop` 27/6, `fn:receiver` 3/3,
`guard:copy` 10/2. `copy:source`, `fn:return-type`, `fn:var-init`, `fn:unknown`,
`fn:depth`, `fn:arity`: 0 in the corpus (classified from source, not observed).

**The door, three trees** (attached = `ok`; categories are the census's):

| flag | tree | attached | clean objects | disclosed | withheld | plot-only | refused for removal |
|---|---|---|---|---|---|---|---|
| off | partial-rule | 33 | 3 | 17 | 1 | 12 | 0 |
| off | object-pass | 33 | — | — | — | — | — |
| off | **integrated** | **34** | 5 | 16 | 1 | 12 | 0 |
| on | partial-rule | 47 | 4 | 30 | 1 | 12 | 11 |
| on | object-pass | 62 | — | — | — | — | — |
| on | **integrated** | **54** | 8 | 33 | 1 | 12 | 9 |

Integrated vs object-pass, flag on: 9 scripts object-pass attaches are refused for a
lost removal (the ruling, working as intended) — `fair-value-gap`, `fib-retracement`,
`fibonacci-retracement-statistics-by-volprofex`, `ict-institutional-order-flow-fadi`,
`market-profile-with-tpo`, `options-max-pain-calculator-backquant`,
`rsi-horizontal-resistance-levels`, `sonarlab-order-blocks`, `strong-start-rvol-dashboard`;
and `trend-lines-supports-and-resistances` attaches (plots, drawings withheld), which
object-pass's older base refused. 62 − 9 + 1 = 54.

**Every verdict that changed vs partial-rule alone**

Flag off (4):
- `fibonacci-pivot-points-cc` withheld → clean — its 7 `delete:target` were
  `line.delete(sup[1])`; the history delete carries them (7/14 → 0/14).
- `heat-map-seasons` refused (`pine:roundtrip`) → disclosed — object-pass's
  `memberInputTranslation` fallback translates it on the author's defaults; it uses
  `table.cell` in a shape the reader does not carry.
- `position-size-calculator` disclosed → clean — its 4 `create:label` drops were a
  helper body read at the top level; inlined at the call site they convert (4/4 → 0/4).
- `trend-lines-supports-and-resistances` disclosed → withheld — its drawing is 7
  calls to its own helpers, all refused (`fn:loop` 4, `fn:method` 2,
  `fn:conditional-history` 1) and their bodies delete. Before the inliner the helper
  bodies were walked as top-level code (15/15 dropped anyway).

Flag on (16) — the four above behave the same, plus:
- `ict-ipda-look-back` refused-for-removal → clean (9 `delete:target` carried by the
  history delete); `linear-regression-channel-tradingfinder…` and
  `swing-highlow-zigzag-chartprime` refused-for-removal → disclosed (same: their
  `delete:target`s were `x[1]` deletes; what remains is lost creates).
- `contraction-box-doji-lines` refused (`pine:no-output`) → clean — the `int()` fold.
- `rsi-swing-indicator` refused (`pine:no-output`) → disclosed (2 of 36).
- `average-day-range-adr-pivots` refused (`pine:request`) → disclosed (71 of 74);
  `high-low-open-mid-ranges` refused (`pine:function`) → disclosed (20 of 22);
  `ict-killzones-pivots-tfo` refused (`pine:function`) → disclosed (72 of 77) — each
  previously refused on a value its helper bodies read at the top level; inlined, the
  refusals move to counted `fn:*` drops that remove nothing drawn.
- `fair-value-gap` refused (`pine:no-output`) → refused for removal — object-pass
  gives it a program; that program loses list pushes the script deletes through.
- `fib-retracement` disclosed → refused for removal — 4 `fn:in-expression` refusals
  whose bodies `label.delete` a label the program draws.
- `ict-killzone-index-version` disclosed → refused (`pine:no-output`) and
  `volumized-order-blocks-flux-charts` refused-for-removal → refused (`pine:no-output`)
  — object-pass's own finding: each drew only through an every-bar create lifted out
  of a helper body, i.e. the mistranslation this wave removes.

**Resolved in the merge**
- `withObjectInputs` (object-pass) added the inputs an object tree reads even when the
  partial rule withheld the drawing — a knob that moves nothing. It now runs only when
  the objects are in the document (railed, with a drawn control).
- Test expectations moved to measurement: Volume v2 "5 of 14" → "8 of 17" (its label
  helper is inlined at two call sites); `htf-liquidity-dashboard` 7 of 21 → 138 of
  152; `fibonacci-pivot-points-cc` leaves the withheld row for a clean one.
- ⚠️ No committed corpus script now has "plots + a removal lost + a non-empty
  program" (the one withheld script's program is empty), so the corpus row can no
  longer tell withheld from drawn. A synthetic case with a real program is added.

**Mutation proofs:** 12, each red, restored from captured bytes and sha256-verified;
unmutated control green (see the merge commit).

**Open, for the owner**
1. **A refused call is ONE step of M however much its body draws.** It keeps N ≤ M
   honest but under-states both when a helper draws many objects.
2. **Mostly-dropped programs still attach, disclosed** — `htf-liquidity-dashboard`
   138 of 152, `average-day-range` 71 of 74, `ict-killzones-pivots` 72 of 77. Option
   (b) as ruled draws them; whether a floor applies is a ruling, not a measurement.
3. **Fail-closed over-reach, not measured to decide any verdict:** a method-form
   `.clear()` on a numeric array reads as a table clear, and a method-form `.delete()`
   always reaches. In the 6 scripts where an `fn:*` key alone decides "removes", each
   has at least one real drawing delete (checked by reading the source for
   `candelacharts-equal-highslows` and `stop-loss-clustering-breakouts`; the others
   name a drawn family or have an empty program).
4. **Empty program, unnamed-family removal:** `trend-lines-supports-and-resistances`
   draws nothing and is labelled "withheld" rather than "N of M"; both sentences are
   true, the withheld one is the louder.

**Regression** (engine suite + `src/components/chart/builder/`, this branch vs
`origin/pine/partial-drawing-rule`, by test-name set difference): full runs 26 vs 29
failed; the two names red only here (`graphSize` C2C.10 `mid_engagement__22`,
`paramSingleTranslation` C2D.1) pass alone on this branch, so **no new failures**.
Also red on BOTH trees and not in the brief's known list: `pineStrictCensus` "strict
census", `objectLaneCensus` x2, `objectLaneCallSites`, `objectLaneDrawerCensus`.

---

## ⭐⭐ 2026-09-27 — PARTIAL DRAWINGS AT THE MEMBER DOOR: a lost removal refuses, every other loss is disclosed

> Branch `pine/partial-drawing-rule` (base `pine/plot-offset-bound` @ `cf009d3ea`).
> Every number below is `memberPaneDefinition` over the 266 committed scripts,
> objects-only flag off/on, measured on this base before and after. The census is
> `app/src/components/chart/builder/memberPane/partialDrawing.census.measure.test.js`
> (opt-in: `PARTIAL_CENSUS=1`). ⚠️ The brief's master-code figures (off 29/15, on
> 53/37) are not this base's; this base measures off 33/17, on 58/40.

**The defect.** The member door admitted object programs that lost operations and
drew the survivors with no disclosure. `paneGate` with the objects-only flag
admitted a DIRTY program (`pine:objects-only`) as `ok`, and a plotting script
carried whatever the object pass kept. Where the lost ops were deletes or table
clears, the chart kept objects TradingView removes: a wrong picture, not a smaller one.

**Owner ruling (option b), as implemented.**

1. A lost REMOVAL (a delete, a `table.clear`, or a lost list change the script
   deletes through) **refuses** a drawing-only script by name
   (`pine:object-removal-lost`). A plotting script with the same loss **keeps its
   plots and has its drawings withheld** (`objects: null`, the shape every
   plot-only script already has, so no new render path), and says so in a note.
2. Every other partial program attaches with **"N of M drawing elements in this
   script aren't supported yet"** on the existing notes channel (`notes` →
   `MemberPane`'s list → `meta.disclosures` on the saved document → the real
   chart's `AttachedPineDisclosures`). N = the pass's `droppedOps`; M = the pass's
   new `attemptedOps`, every op the converter tried, loop ops and loop-body ops
   alike, so `N <= M` holds by construction. (`collectedOps` counts only top-level
   reader ops and read "62 of 29" on `dual-view-htf-candlestick-patterns`.)
3. A clean object program and a plot-only script are unchanged.

⚠️ **A lost removal of something never drawn is not a removal loss.** The pass now
records every lost `*.delete` / `table.clear` with its family (`lostRemovals`). If
the program draws no create of that family at all, nothing that removal would take
off the chart is on it, and the loss is PARTIAL. It is judged by FAMILY, not by
register, because Pine fills a register through `l := array.get(…)` / `l := f(…)`,
which the reader does not model. This is what keeps **Volume v2**'s two tables: it
loses three `label.delete`s and draws no label anywhere (the one `label.new` is lost
too), and now carries "5 of 14 drawing elements…". A removal whose family the pass
cannot name always counts. **This refinement is an interpretation, flagged for a
ruling below.**

**Classification of every key the object pass emits** (`engine/ast/objectLoss.js`,
railed against the `dropped(...)` call sites in `pine.js` and the op kinds in
`pineObjects.js`; an unclassified key is refused, never guessed):

| key | class | why |
|---|---|---|
| `delete:target` | REMOVES | a delete whose target cannot be read; the object Pine deletes stays |
| `guard:delete` | REMOVES | a delete whose condition cannot be read |
| `clear:target`, `clear:range`, `guard:clear` | REMOVES | a `table.clear` lost; the cells Pine wipes keep last bar's text |
| `guard:loop`, `loop:bounds` | LOOP, by body | the body is never converted; REMOVES if it held a reaching delete/clear, else LIST if it changed lists, else PARTIAL |
| `coll:push`, `coll:set`, `coll:remove`, `coll:unknown`, `coll:<method>` (e.g. `pop`), `guard:coll_*` | LIST | lists are how a script finds what it later deletes; REMOVES when the script removes anything, PARTIAL otherwise |
| `create:<family>`, `guard:create` | PARTIAL | a missing object, never an extra one |
| `update:target`, `update:props`, `guard:update` | PARTIAL | a stale position or style, not an extra object |
| `cell:target`, `cell:address`, `cell:text`, `guard:cell` | PARTIAL | a missing cell (dropped whole, never written blank) |
| `cellpatch:target`, `cellpatch:address`, `cellpatch:<prop>`, `guard:cellpatch` | PARTIAL | a missing style |
| `loop:empty` | PARTIAL | its body ops are each counted under their own key |
| reader: `*.delete`, `table.clear` (loop-blocked or unsupported) | REMOVES, unless that family is never drawn | never became an op, so in no drop count; `sonarlab-order-blocks` has zero drops and a lost `box.delete` |
| reader: `array.*` | LIST | as above |
| reader: anything else, `outOfScope` namespaces | PARTIAL | named in the note (`It also uses …`) |

**Before and after (this base).**

| | flag OFF | flag ON |
|---|---|---|
| attached, before | 33 (17 with drops; 18 with any loss) | 58 (40 with drops; 42 with any loss) |
| attached, after | 33 | 47 |
| … with the "N of M" / "uses X" disclosure | 17 | 30 |
| … plots drawn, drawings withheld | 1 (`fibonacci-pivot-points-cc`) | 1 (same) |
| refused for a lost removal | 0 | 11 |
| clean with objects (unchanged) | 3 | 4 |
| plot-only (unchanged) | 12 | 12 |

Refused, flag ON (all drawing-only): `fibonacci-retracement-statistics-by-volprofex`,
`ict-institutional-order-flow-fadi`, `ict-ipda-look-back`,
`linear-regression-channel-tradingfinder-existing-trend-lines`, `market-profile-with-tpo`,
`options-max-pain-calculator-backquant`, `rsi-horizontal-resistance-levels`,
`sonarlab-order-blocks`, **`strong-start-rvol-dashboard`** (the objects-only lane's
acceptance dashboard; it loses a `table.clear`), `swing-highlow-zigzag-chartprime`,
`volumized-order-blocks-flux-charts`.

Of the 25 scripts the flag adds on this base, 24 had a loss: 11 are now refused, 13
attach with a disclosure, and 1 is clean (`makuchaku039s-trade-tools-fair-value-gaps`).

**The member sentences** (worded once, in `objectLoss.js`):
- refused: *"This script's drawing can't be shown yet. It removes drawings as it runs,
  and this chart can't follow part of that (a delete), so drawing the rest would leave
  lines, labels, boxes or table cells on screen that TradingView would have removed."*
- withheld: *"This script's plots are shown, but its drawings are not. It removes
  drawings as it runs, and this chart can't follow part of that (a delete), so showing
  them would leave lines, labels, boxes or table cells on screen that TradingView would
  have removed."*
- partial: *"199 of 246 drawing elements in this script aren't supported yet, so what
  it draws is incomplete. (The 246 are every drawing step this chart tried to carry:
  each line, label, box or table created, changed or written to, each change to a list
  of them, and each loop.) It also uses `line.set_xloc`, which this chart doesn't draw
  yet."*
- reader-only: *"This script uses `table.merge_cells`, which this chart doesn't draw
  yet, so what it draws is incomplete."*

**Rails.** `builder/memberPane/partialDrawing.test.jsx` is a table over 11 named
corpus scripts (clean ×3, partial ×2, refused ×3, plots+partial ×2, withheld ×1) plus
the flag-off control, asserting the door verdict AND the rendered DOM text.
`engine/ast/objectLoss.test.js` derives the classification check from source, holds
`N <= M` over the corpus, and pins the family test. Nine mutations (the pass counter,
the family test, two classifications, both `paneGate` admissions, the withholding, the
note push, the N/M order) each turned the rails red; every file was restored from
captured bytes and verified by sha256.

**Needs a ruling.** (a) the family-level "never drawn" refinement above; (b) LIST as
conditional on the script removing anything; (c) prop-level losses inside a kept op
(`droppedProps`, `unsupportedProps`) are not disclosed; (d) reader-level losses are
named but not counted in N/M, because they never became ops; (e) the acceptance
dashboard is now refused with the flag ON.

## ⭐⭐ 2026-09-27 — THE ATR SEED, HOST LANE: CLOSED (`atrPine`), and the house column untouched

**Scheduled by the owner ("do it all"); decision 2 below and §"THE ATR SEED" are
superseded for the host lane by this section.** Branch `pine/atr-seed-host`.

### The vendor rule, derived from the capture's own bars (measured)

`harness/keltner-channels-bands-rddt-1d-2026-09-27.json` — Pine v4
`ma = ema(close,20)`, bands `ma ± k·atr(10)`, NYSE:RDDT 1D, all 631 bars from
listing (`startsAtBar0: true`). The vendor's ATR on any plotted bar is
`(Upper k − Basis)/k` or `(Basis − Lower k)/k` — six independent readings per bar.

| step | value |
|---|---|
| TR on bar 0 | `high − low` = 57.8 − 45.05 = **12.75** (`ta.tr(true)`: no previous close) |
| TR on bars 1..9 | 5.66, 15.9399, 15.10, 9.49, 8.65, 4.925, 7.35, 4.6899, 3.33 (max of the three gaps) |
| seed | mean of the first 10 TRs, **on bar 9 (= n−1)**: **8.78848** |
| after | Wilder: `atr = (atr·(n−1) + tr)/n` |
| vendor bars 19–23 | 5.207212319146947 · 5.052491087232255 · 4.753241978509031 · 4.501747780658128 · 4.203573002592314 |
| hand rule, same bars | agrees to ≤ 2.7e-15 on all five; max |err| over all 612 × 6 readings 2.3e-14 |
| control: bar 0 = `na` (Wilder's TR from bar 1) | max |err| **1.53e-1** — the prefix the harness saw |

Cross-check: `seed-warmup-spy-12m-2026-09-21.json` (`ta.atr(5)`, bar_index 0..33):
the same rule reproduces all 34 bars with max |err| **0** (bar 4 = 13.96875).
So: **`ta.atr(n)` = `ta.rma(ta.tr(true), n)`, bar 0's TR = high − low, SMA seed of
the first n TRs landing on bar n−1, Wilder's step thereafter.**

### What changed, lane by lane

| lane | before | now |
|---|---|---|
| **host / columnar JS** (`interpret.js`) | Pine `ta.atr`/v4 `atr` → table `atr` → shipped `computeATR` (Wilder, TR from bar 1, seed on bar n) | → **`atrPine`** = `carriedFn('rma')` over `trueRangeTrue` (built from the same `POINTWISE`/`BINARY`/`TERNARY` scalars a written-out `ta.tr(true)` tree uses) |
| **Python twin** (`ast_interpret.py`) | `_fn_atr` → `compute_atr_raw` | **`_fn_atr_pine`** = `_rma_col(_true_range_true(...))` — the key set stays TABLE's, both directions |
| translator (`pine.js`) | `PINE_CALL_SHAPES.atr.table = 'atr'` | `'atrPine'` — the only door onto it |
| manifest (`closedTable.json`) | 75 functions | 76: `atrPine`, same args/roles as `atr`, `lookback: "arg3"`, own sentence |
| runtime request path (`pineRuntimeFrontend.js`) | already `rma` over `nz(close[1], close)` = Pine's seed | **unchanged code**; its stale comment ("raw `close[1]`") corrected. One recorded difference: a malformed bar-0 close outside its own high/low |
| **house `atr`** (ThinkScript `ATR`, PCF `ATR<n>`, native ATR/ATR-bands, pattern levels, a typed formula) | Wilder | **unchanged**, with its `vendorNote` — by the standing ruling |

### Why it was "not a one-line change", and how each reason was answered

| reason on file | answer |
|---|---|
| a new name in `closedTable.json` needs a Python implementation | `_fn_atr_pine`, composed from `_rma_col`; `tests/test_atr_pine_parity.py` pins it to the vendor numbers |
| `screenerColumns.test.js` freezes the columns for Python | regenerated (`10-atr-percent` now reads `atrPine`); the Python lane-parity rail runs both interpreters over it |
| the "window" contract (`lookback`, `finiteTailStart`) | `lookback: "arg3"` = n bars, which is exactly the Pine rule's reach (seed from bars 0..n−1) — the sma convention; the tree-sum readers and `tools/lookback_agreement.json` regenerate with no disagreement. `finiteTailStart` is NOT used: the composition inherits `rma`'s vendor-pinned hold-on-`na`, i.e. the answer `ta.rma(ta.tr(true), n)` gives, and the rail asserts the identity with a hole in `close` |
| 23 failures across count pins, sentence round-trip, vendor-note roster, corpus snapshot, formula reference | the same class again (23 on the first run) — each fixed at its cause: counts 75→76 / 259→260 / 122→123, a hand-written `atrPine` sentence form, `GRAMMAR.md` + `pineCorpus.json` + `screener_columns.json` + `graph_wire` regenerated, the vendor-note rails rewritten (a paste now owes NO note; the house `atr` still does), the two `it.fails` markers removed because the identity now holds |
| re-seeding the shared column moves money | not done — the house column is byte-identical |

### Harness, before → after (tolerance unchanged: REL 1e-9, 1e-6 of a tick)

| capture | plot | before | after |
|---|---|---|---|
| keltner RDDT 1D (from bar 0) | Basis | MATCH 612/612 | MATCH 612/612 |
| | Upper 1 / Lower 1 | DIVERGE 137 / 138 bars, converging prefix from bar 19 | **MATCH 612/612** (maxRel 4.8e-16 / 5.7e-16) |
| | Upper 2 / Lower 2 | DIVERGE 141 / 143 | **MATCH 612/612** |
| | Upper 3 / Lower 3 | DIVERGE 144 / 147 | **MATCH 612/612** |
| | objects | INCONCLUSIVE (object lane did not run) | same — pre-existing, unrelated; it is why the capture-level verdict reads INCONCLUSIVE rather than MATCH |
| SPY 12M seed (from bar 0) | N10_atr5 | DIVERGE 30/34 (ours `na` on bar 4) | **MATCH 34/34** |
| | N11 rma(tr(true),5) | MATCH | MATCH |
| SPY 1D `atr-14-2026-09-06` (window starts 2021, **not bar 0**) | atr14 | DIVERGE: converging prefix bars 180..207 (28) | DIVERGE: converging prefix bars 180..206 (27) — **kept, correctly**: the vendor's decades of prior smoothing vs our fetch-local seed (`recursive-smoother-cold-start-in-a-finite-capture`). Not touched by tolerance |

Corpus totals (`tests/fixtures/vendor`, 17 captures): MATCH 7 → 8, DIVERGE 9 → 7,
INCONCLUSIVE 1 → 2 (the Keltner capture, on its `objects` item only).

⚠️ The legacy observation `atr-14-2026-09-06` names its plot by formula; it now
carries `script.pasteLowersTo` (`atrPine(high, low, close, 14)`, dated, with the
reason), which `adapters.mjs` maps by and `vendorTruth.test.js` asserts the paste
produces. Its `engine` block stays on the house formula — it is the evidence the
house ruling cites, and `test_vendor_parity_rsi_atr.py` still grades it.

### Reach (measured over `corpus/committed`, 266 scripts)

By source text: `atr` 73 · `rma` 21 · `tr` 20 · any of the three 91. Through the
host translator today: 52 scripts translate, **5 carry `atrPine`** in a usable
output (2 in the selected one) — including `keltner-channels-bands__T5FsnX45Dn.pine`,
the captured script. ⚠️ Runtime/object-lane reach was not counted separately.
Door counts: unchanged — the corpus snapshot moved only two formula strings.

### Rails and mutations

Rails pinned to the VENDOR numbers, not to our own: `atrPine.vendor.test.js` (JS)
and `tests/test_atr_pine_parity.py` (Python), both reading the two captures, each
with a house-`atr` control that must MISS the vendor; `runtime/__tests__/atr.test.js`
now measures the Pine route against the vendor rule and asserts the house column
still differs at the seed. 

Mutations (bytes + sha256 capture/restore, every restore verified by sha; never git checkout), each
run against the three JS rail files or the Python rail file:

| mutation | result |
|---|---|
| M1 `pine.js`: route `ta.atr` back to the house `atr` | 10 JS tests red |
| M2 `interpret.js`: bar-0 TR `na` (Wilder's TR-from-bar-1) | 13 JS tests red |
| M3 `interpret.js`: `ema` smoother instead of `rma` | 8 JS tests red |
| M4 `ast_interpret.py`: bar-0 TR `na` | 8 of 9 Python tests red |
| M5 `ast_interpret.py`: `ema` alpha instead of Wilder's | 6 of 9 Python tests red |


### Open

* The runtime request path spells `ta.tr(true)` as `nz(close[1], close)`; equal
  on every well-formed bar, different only for a bar-0 close outside its range.
* `ta.kc`/`ta.kcw` smooth `ta.tr` (the bare, bar-0-`na` form) with `ema` —
  unmeasured at bar 0; not changed here.
* `divergences.json::atr-tr-starts-at-bar-1` stays **accepted** for the house
  column and is narrowed (`narrowed_2026_09_27`); X-VENDOR-1 is now owed only
  where the house `atr` is reached.

---

## ⭐⭐ 2026-09-26 — `pine:plot-offset` (11) SIZED, AND IT WAS NOT A PINE GAP

> Branch `pine/plot-offset-bound`. Every number below is `memberPaneDefinition`
> over the 266 committed scripts, objects-only flag off/on, measured before and
> after on the same tree (probe: the census `__probe_memberDoor.test.js`, never
> committed).

**What the 11 actually were.** Every offending `offset =` is an **input, or
arithmetic on inputs** — no series, no timeframe flag:

| script | line | offset expr | class | next wall (measured) | attaches |
|---|---|---|---|---|---|
| bolingger-bands-inside-bar-boxes | 47 | `offset` (`input.int(0)`) | input | `pine:reassign` (`IBStatus`, l.98) | n |
| extrapolated-pivot-connector | 37 | `-length` (`input(100)`) | −input | `pine:arity` (pivot `rightbars` from an input) → cleared here | **y** |
| multicator-table | 407 / 413 / 414 | `offset`; `-displacement + 1`; `displacement - 1` | input / arithmetic | `pine:state` (`lastPh`) | n |
| multiple-mtf-moving-average-xdecow | 203 | `i_ma1_offset` (`input.int(0)`) | input | `pine:builtin` (`timeframe.in_seconds`) | n |
| pivot-high-low-points | 11 | `-lb` (`input(5)`) | −input | `pine:offset-literal` (`high[mb]`, `mb = lb + rb + 1`) | n |
| price-action-…-trendline | 42 | `-rightbars` (`input.int(5)`) | −input | `pine:arity` → cleared here | **y** |
| support-and-resistance | 15 | `-left` (`input(10)`) | −input | `pine:role-order` (`valuewhen`) | n |
| swing-points-and-liquidity-by-leviathan | 171 | `-swingSizeR` (`input.int(10)`) | −input | `pine:arity` → then `pine:offset-literal` (`high[swingSizeR]`) | n |
| trend-lines-supports-and-resistances | 350 | `-pvtLength` (`input.int(20)`) | −input | `pine:arity` → cleared here | **y** |
| trendlines | 25 | `-rightbars` (`input(15)`) | −input | `pine:arity` → then `pine:function-def` (`get_y`) | n |
| wyckoff-accumulation-distribution | 83 | `offsetVal` = `-pivotLen` (`input.int(5)`) | −input (via a name) | `pine:arity` → then `pine:offset-literal` | n |

⭐⭐ **THE WALL WAS THE MEMBER DOOR'S OWN MODE, NOT PINE.** `translatePine` without
`declareInputs` already folded `offset = -prd` (`pine.displace.test.js`). The member
door translates with `declareInputs`, which hands an input back as an IDENTIFIER, and
the displacement reader accepted only a bare `num`. Same shape, one slot over: a
pivot's `rightbars` (`pivotAtConfirmation`) refused the identifier too — that is the
`pine:arity` wall six of the eleven hit next. **One defect class, two slots.**

**The ruling applied (Pine's own semantics):** `offset` is a simple int, fixed from
inputs/constants before the first bar. So it folds at translation through
`constantValueOf` (declared input → its value; arithmetic; `u-`) — the author's
default, or the member's value when the script is re-translated with `inputValues`.
The input is recorded `displacementBound` and refused as a per-chart knob BY NAME,
with its own sentence (not the window one). A positive displacement that is an
input's bare value carries the parameter tag onto the offset node, so a definition
edit moves it (locator `[..., 'value']`, the shape `param_manifest.py` accepted since
v1). A series-dependent displacement still refuses; a fractional fold now says so.

**Door, before → after:** off **29 → 33**, on **53 → 58**, **lost 0**. Newly attaching
(on): `extrapolated-pivot-connector`, `price-action-as-in-book-fibonacci-…`,
`trend-lines-supports-and-resistances` (the 11), plus `liquidity-pools` (was
`pine:arity`, same pivot class) and `market-structure-by-leviathan` (was
`pine:no-output`). `pine:plot-offset` at the door: **11 → 0**.

**Two live defects found on the way, both fixed with rails:**
1. ⛔ `paramEdit.applyParamEdit` read the ORIGINAL tree for every locator, so a
   parameter used twice in one tree kept only the last write — measured on master:
   `sma(close, len) - ema(close, len)` edited 14 → 21 saved `sma(close, 14) - ema(close, 21)`.
2. ⛔ A pivot's `rightbars` is its argument AND its confirmation shift; only the
   argument was tagged, so an edit moved the pivot's window and left the shift at the
   default. Both now tagged (corpus locators 536 → 734, all from this).

**Still open — owner/next-lane, not ruled here:** `pine:offset-literal` (`x[n]` with
`n` an input, or `lb + rb + 1`) is the same class a third time (3 of the 11 land on
it); its guard's own comments tie it to the forward-reference guarantee, so it wants
its own ruling.

### ⭐⭐ Follow-up, same day — a LEFTWARD displacement is now DRAWN where Pine draws it

⚰️ **The defect (pre-existing, not introduced by the fold above, but widened by it):**
the translator recorded `offset = -N` as `displace: -N` on its output row, and the
member pane never carried it into the saved definition. Every such plot — the four
newly-attaching pivot scripts and every pre-existing literal negative offset — was
drawn **N bars late**: a pivot marker on the bar that *confirmed* the pivot.

**The rule, Pine's own:** the value computed at bar i is drawn at bar i + offset; the
last |offset| bars carry no point; nothing is computed from a future bar. Implemented
as a re-indexing of the finished column at DRAW time only (`binder.displacedColumn`),
applied to line points, marker glyphs, band edges and per-point colours.

| surface | honours `displace`? |
|---|---|
| member pane (`memberPaneDefinition` → `plots[].displace`) | **yes**, param-aware |
| builder sheet Pine import (`PineBox` → `BuilderSheet` rows → `buildDefinition`) | **yes** (carried + restored on edit); a parameter that feeds a displacement is **withheld** there rather than tracked |
| chart binder (line / markers / fills / colour rule) | **yes** |
| crosshair legend | follows the drawn points (reads `seriesData`) |
| scan column, alert seam, `source` references, server compute | **no — by design**: the column keeps the value on the bar that computed it |
| a band whose two edges are displaced differently | **refused by name** at the door (`pine:plot-offset`; 0 corpus scripts do it) |
| a rightward displacement | never on the plot — it is `x[N]` in the tree; the schema refuses a positive `plots[].displace` |

**Concrete, `extrapolated-pivot-connector` (length = 100), synthetic peak at bar 150:**
the column holds the pivot high (1000) at **bar 250**, the bar that confirms it; the
chart now draws it at **bar 150**, the pivot bar — before this it was drawn at 250.

**Param-aware:** when the displacement is `±p + c` for one document parameter `p`
(every corpus case), the plot carries `displaceFrom` and `paramEdit` moves the
drawing in the same atomic edit (pivot argument, confirmation shift and marker
together). Any other dependence withholds `p` from the manifest, with a note.

**Found on the way, fixed:** a ONE-plot member pane's parameter locators named
`treeIndex: 'value'` while the document is single-tree (no `compute.trees`), so every
parameter of a one-plot pane read as detached and `applyParamEdit` refused it. Locators
now use `null` for a single-tree document.

Door census after the follow-up: **unchanged — off 33, on 58, lost 0.**

---

## ⭐⭐⭐ 2026-09-26 — THE `pine:no-output` 33, TRACED TO CAUSES (branch `pine/object-pass-no-output`)

> The road-to-100% table below called this row *"object-pass coverage, not a
> ruling"*. It is — but it is not ONE gap, and closing the largest cause
> completes almost nothing on its own. Measured, not estimated; every number here
> is `memberPaneDefinition` with `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1` over the
> 266 committed scripts, on master `9310ae0b0` and on this branch.

### What the object pass actually did with the 33

**31 of the 33 contain a drawing call; the object pass COLLECTED ops for 30 of
them, and not one create survived.** A census row naming a token is not a cause; each
family below was reproduced by a minimal Pine snippet before it was counted.
Primary cause = the reason for the majority of that script's drops.

| family | n | minimal repro | next wall once served | built |
|---|---|---|---|---|
| **F1 — drawing inside a user function body** | **14** | `f(y) =>` / `    label.new(bar_index, y, "x")` / `f(high)` → `y` undefined, dropped | the body's OWN `var` state (fvg-detector, power-of-3), session clock, object getters (rsi-swing), `request.*` (mtf-watchlist, correlation-matrix), comma-joined statements (correlation-matrix), UDT receivers (methods: ipda, mgi) | **yes** |
| F4 — drawings in arrays / UDT fields / `for … in` | 6 | `for l in lines` / `    l.delete()` → loop-blocked | runtime lane (collections, UDTs) | no |
| F2 — guard reads `var` state or a block value | 3 | `var float x = na` / `if c` / `    x := high` / `if x > 0` / `    label.new(…)` → guard refuses `pine:reassign` | runtime lane (RC-L) | no |
| F3 — session clock `time(session)` | 3 | `if time("", "0930-1600")` / `    label.new(…)` → `pine:function time` | exchange timezone + session parsing (vendor-measured, `r11-time-session`) | no |
| F7 — a built-in the table lacks | 3 | `dayofweek(time)`; `ta.barssince(c)` unbounded; `ta.pivothigh(h, len, len)` with an input `len` | one vendor ruling per name | partly — `int` (F7′); the input-length pivot clears via F9 |
| F8 — no drawing at all | 2 | `barcolor(c ? color.yellow : na)` only; `alert()` only | not an object-pass gap (a `barcolor` output family; an alert-only script draws nothing in Pine either) | no |
| F6 — object getter in a coordinate | 1 | `line.new(label.get_x(l), …)` → `pine:drawing` | getters read object state, which the pure V2 graph cannot hold by design | no |
| F10 — text feature | 1 | `str.format` / text-value | text channel | no |

Secondary families, found while tracing and built because they complete scripts:

| family | n (corpus) | minimal repro | built |
|---|---|---|---|
| **F5 — a drawing variable's history, `line.delete(sup[1])`** | 291 dropped deletes / 24 scripts | `sup = line.new(…)` / `line.delete(sup[1])` → `delete:target` | **yes** |
| **F7′ — `int(x)` where x is whole-or-`na` every bar** | contraction-box | `box.new(left = int(c ? bar_index - 5 : na), …)` | **yes** |
| **F9 — an object tree reads an input the pane document never declared** | 16 door-attached scripts had a tree refused this way (measured on this branch before the fix) | objects-only script reading `input.int` in a coordinate → reader: `unknown name` | **yes** |

### ⚰️ F1 WAS A SILENT MISTRANSLATION, NOT ONLY A GAP

`collectObjectOps` walked a function DEFINITION's body as top-level code. So
`f() => label.new(…)` behind `if close > open` drew a label on EVERY bar, and a
function never called at all drew one too — both `ok: true`. Measured: kept ops
from inside function bodies in **31 scripts, 6 of them attaching at the door**
(`dual-view-htf-candlestick-patterns` carried 19). The fix (`objectFnInline.js`)
inlines the body at each CALL SITE — per-call-site `var` registers, parameters
bound by argument substitution, the call's guards on every op, the returned
handle copied into the caller — and refuses by name (a counted drop, never an
`unsupported` note) for: a drawing METHOD, a call inside an expression, `var x =
f()`, a wrong arity, and a CONDITIONAL call whose body reads history (Pine only
advances a function's history on the bars it runs; the columnar model evaluates
every bar).

### Completion — what reaches the door AND is drawn in full

"Draws complete" = attaches, the object program has zero drops/loop-blocks/
unsupported/getters, `objectReaderFor` fails no tree, the runtime runs `ok`, and
the RENDERER keeps ≥ 1 object (`paintObjects` + `layoutTables` counters).

| | master | this branch |
|---|---|---|
| attach at the door (flag ON, as shipped) | 53 | **62** |
| attach at the door (flag OFF) | 29 | **33** |
| draws complete | 1 | **5** |
| attaches but loses part of its drawing (program drops, reader refuses, or renderer keeps 0) | 36 | 41 |
| attaches on plots while its objects are all lost | 4 | 4 |
| **the 33 `pine:no-output`: completed** | — | **1** (`contraction-box-doji-lines`) |

Completed on this branch: `contraction-box-doji-lines` (F1+F7′),
`fibonacci-pivot-points-cc` (F5), `makuchaku039s-trade-tools-fair-value-gaps`
(F9 — a CLEAN program whose 50 boxes all painted at NaN), `position-size-calculator`
(F1 — its labels were lost inside a function), plus the one master already had
(`inside-bar-range-mother-candle-…`).

Newly attaching at the door, by family: **F1** — `contraction-box-doji-lines`,
`fair-value-gap__1048fa103a`, `rsi-swing-indicator`; **F9** —
`average-day-range-adr-pivots`, `extrapolated-pivot-connector`, `heat-map-seasons`,
`high-low-open-mid-ranges`, `ict-killzones-pivots-tfo`, `liquidity-pools`,
`market-structure-by-leviathan`, `price-action-as-in-book-…`. Four of them —
`extrapolated-pivot-connector`, `heat-map-seasons`, `liquidity-pools`,
`price-action-as-in-book-…` — attach with the flag OFF too (door OFF 29 → 33).
⚠️ F9's door moves come from `memberInputTranslation`'s early return:
when NO output survived the declare-every-input probe it returned that probe itself
(outputs refused, object trees reading undeclared names) instead of the plain,
fold-every-input translation the rest of the function already falls back to. So it
also rescues PLOTS that died only because an input was declared into a window
(`ta.pivothigh(h, len, len)`), not just drawings.

⛔ **Two scripts stop attaching, and both were drawing a mistranslation:**
`ict-killzone-index-version` (its one op was a `line.new` from a helper body,
unconditional every bar, `y1` reading the helper's PARAMETER `price` as a free
series) and `volumized-order-blocks-flux-charts` (one `box.new` from a function
body, every bar, `na` corners). Both are now refused by name.

### ⛔⛔ NEEDS AN OWNER RULING — the objects-only door admits PARTIAL drawings

`paneGate`'s objects-only branch admits a `pine:objects-only` verdict, and in
the host lane `pine:objects-only` means exactly *"draws, and dropped ≥ 1 op"* —
a clean object-only program is `ok: true` via `objectOnlyCleanWin`, whose own
comment says *"NO PARTIAL CREDIT"*. So the door admits precisely the programs
the translator refuses to call clean. **40 of master's 53 attachments lose part or all of
their drawing** (36 + 4 above); this branch moves 10 more scripts from a loud
refusal to a partial attachment (e.g. `rsi-swing-indicator` attaches and the renderer
keeps 0 of its objects).
Under a gate that admitted only complete drawings the door would read **13 on
master, 17 here** (plots-only scripts included). Not changed here: it would take
40 scripts off master's door, and "zero lost" was a hard constraint of this job.

### What was deliberately NOT built, and why

- **F2/F4 (state, collections, UDTs)** — the runtime lane's purpose; the object
  lane (`buildObjectLane`) builds 1 of the 33 today (`market-structure-by-leviathan`).
- **F3 session clock** — needs the symbol's exchange timezone and a session
  grammar; a guess draws sessions at the wrong hours.
- **F6 getters** — the V2 graph is pure by construction.
- **Methods that draw** — a method dispatches on its receiver's TYPE; this reader
  has no type system. Refused by name (304 refused calls in `mgi-levels-suite` alone).
- **The objects-only door's partial admissions** — owner ruling above.

### Verification on this branch

- Engine suite (`npm run test:engine`), failing-test NAMES diffed against a
  baseline run on a separate `origin/master` worktree: **no new failures**. Three
  runtime `*.measure.test.js` files timed out once under full-suite load and pass
  alone on both trees (~5 s each).
- Builder suite: no new failures.
- 17 mutations, each reverting exactly one layer, all red; restored from captured
  bytes and sha256-verified (never `git checkout`).


---

## ⭐⭐⭐ 2026-09-23 — DECISIONS 5 AND 6, RULED (both delegated: *"You decide both of those"*)

### 5. What "100%" is a percentage OF — **212, NOT 266**

⛔ **The denominator is 212 and the two carve-outs stand.** `strategy()` (25
scripts) and Pine libraries (29) stay out of scope, for reasons that are about
what they ARE rather than about difficulty:

- **A strategy is not an indicator.** Drawing one means simulating fills, position
  sizing and an equity curve — a different product, with a financial-advice
  surface this programme has no ruling for. It has now been ruled out three times.
- **A library is not the pasted script.** Serving one means fetching and compiling
  third-party Pine from TradingView across 31 distinct libraries — an unbounded
  dependency graph and a distribution question (`LICENSING.md`), not a grammar gap.

⭐ **AND THE PRACTICAL ARGUMENT IS STRONGER THAN THE PRINCIPLED ONE:** the road
from here to 212 is ~160 scripts. Nothing about choosing 212 forecloses 266 —
**re-examine both carve-outs when 212 is in sight**, when the cost of each will be
known rather than estimated. Choosing 266 today buys a bigger number and no more
scripts.

### 6b. — AND THE MERGE IT DEPENDS ON IS **16 FILES, 35 HUNKS**. MEASURED, NOT ESTIMATED.

⛔ **A DRY-RUN MERGE WAS ACTUALLY PERFORMED** — in a throwaway worktree at
`origin/master`, `git merge --no-commit --no-ff feat/pine-value-model`, then
aborted clean. This is not a guess from the diffstat.

| | |
|---|---|
| branch ahead of the merge-base | **179 commits** |
| master ahead of the merge-base | **311 commits** |
| files touched by BOTH sides | 28 |
| **files that actually CONFLICT** | **16** |
| **total conflict hunks** | **35** |

**And the shape is far kinder than the size suggests.** `pine.js` — the
14,000-line file everyone fears — has **2 hunks**, and the first is an *import
list* where the branch's version is a strict superset. The heaviest files are
`objectProgram.js` (6) and `sentence.test.js` (5). Four of the sixteen are
generated artifacts (`corpus_metric.json`, `lookback_agreement.json`,
`closedTable.json`, `GRAMMAR.md`) whose resolution is "re-derive, never
hand-merge" — and `closedTable.json` carries this repo's manifest rule: **edit as
text, never round-trip through a serialiser.**

⭐ **So the largest measured win available to this programme — member coverage
26 → 52, a DOUBLING, with zero corpus regressions — is a day's careful work
behind 35 conflict hunks, not a quarter's.** That is the single most actionable
number in this file.

⚠️ **What it still needs, and neither is mine to give:** the merge reaches
`master`, which is production, so it needs an explicit deploy instruction and a
member-impact paragraph; and the six-shard gate must run on the MERGED tree, not
on either parent.

### 6. Arm `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED` — **YES, AND IT IS NOT A FLAG FLIP**

⛔⛔ **THE FIRST THING THAT HAD TO BE CHECKED, AND IT MOVED THE ANSWER:
`objectsOnlyPaneGate.js` DOES NOT EXIST ON MASTER.** Nor does any reference to
`allowObjectsOnly` in master's `memberPaneDefinition.js` (0 occurrences). The
objects-only pane is **unmerged work on `feat/pine-value-model`**, along with the
rest of this programme: **198 files and +30,566 / −7,594 lines** separate master
from this branch under `app/src/components/chart/engine/` alone.

**So this is not one variable and one rebuild — and measured, it is worth far
more than the +23 the flag alone buys. Merging the branch takes the member door
from 26 to 52, with zero corpus regressions. The real sequence is:**

1. **Merge the branch** (or a scoped subset carrying the objects-only pane).
2. **Declare the ARG** — RC-N, already written here; master does not have it.
3. **Set the Railway variable** on `web` and rebuild (it is a build constant, so
   this is a DEPLOY).
4. **Verify in the bundle**, not from `--kv`.

⭐ **THE RULING IS STILL YES**, and the reasoning is about blast radius rather than
confidence: attaching a script is **opt-in, per member, per script, on their own
chart**; the failure mode is a drawing that differs from TradingView, not an
outage, not other members, not a number anyone trades off; and it is reversible in
minutes. Against that, 23 members currently meet a refusal written in SCREENER
language — *"offers no plot or alert condition to filter on"* — at a CHART door,
which is the same wrong-sentence class as RC-M.

⚠️ **BUT IT IS RULED AS A SEQUENCE, NOT AS A SWITCH**, and the order matters:
axis 2 (below) has no measurement, so arming this widens what we DRAW before we can
say what we draw is RIGHT. The vendor-comparison harness is therefore ruled to come
**first or alongside** — not after.

### ⚰️ A NUMBER THIS FILE PUBLISHED EARLIER TODAY WAS MISLABELLED — CORRECTED

The road-to-100% table below called **29 of 266** *"TODAY, as production builds
it"*. That census ran against **this branch's code** with the objects-only flag
forced off — not master. **Measured on master's own tree** (a worktree at
`origin/master`, its own `npm install`, the same `memberPaneDefinition` probe):

| tree | scripts a member can attach | |
|---|---|---|
| **`origin/master` — what production serves** | **26 of 266** | 9.8% |
| this branch, objects-only OFF | 29 | 10.9% |
| this branch, objects-only ON | **52** | 19.5% |

⭐⭐ **SO THE BRANCH IS WORTH +26 SCRIPTS — IT DOUBLES MEMBER COVERAGE — AND IT
COSTS NOTHING: the set master can attach is a strict SUBSET of the branch's.
Scripts master serves that the branch does not: ZERO.**

⭐ And master carries a row the branch has already cleared: **`pine:character` at
24 scripts**, absent from the branch entirely (the postfix member-access fix). That
row alone is most of the difference.

⚠️ Fourth fixture error of the session, and the first about which CODE rather than
which FLAGS. The three before it: an untold clock inventing a 49-script row, a
local `app/.env.local` making two "different" runs identical, and three
invocations of the translator giving 48 / 52 / 29.

---

## ⭐⭐⭐ 2026-09-23 — THE ROAD TO 100%, DERIVED FROM ONE CENSUS

> **The owner's bar is two things, not one: every pasted script BUILDS, and it
> LOOKS IDENTICAL to TradingView.** They are different axes with different
> blockers, and only the first has ever been measured. This section sizes both.

### Axis 1 — does it build at the member door?

Every number below is `memberPaneDefinition({source, id})` — the call
`MemberPane` makes — over the 266 committed scripts.

| | scripts | share |
|---|---|---|
| **TODAY — measured on `origin/master`, the tree production serves** | **26** | 9.8% |
| + merge this branch, objects-only pane armed (decision 6) | **52** | 19.5% |
| + wire the RUNTIME lane behind the same door | **58** | 21.8% |
| — the two standing carve-outs (25 `strategy()`, 29 `import`) | ceiling **212** | 79.7% |

⭐ **The first step DOUBLES member coverage and the set only grows: zero scripts
that master attaches are lost by the branch.**

⛔⛔ **SO 100% OF 266 IS NOT REACHABLE UNDER THE CURRENT RULINGS, AND THAT IS A
DECISION, NOT A LIMIT.** 54 scripts — **one in five** — are deliberately out of
scope (decisions 1 and 4). "100%" therefore means one of two things, and the owner
picks which:
- **100% of 212** — keep both carve-outs. The number to drive to is 212.
- **100% of 266** — re-open `strategy()` and/or Pine libraries. Each is a
  programme in its own right; libraries additionally carry a distribution
  question (`LICENSING.md`).

⭐⭐ **AND THE RUNTIME LANE IS NOT THE BIG LEVER — measured, against the
assumption.** It builds 13 scripts, but **7 of those 13 the columnar door already
serves**. Wiring it adds **6**: five `pine:state` scripts plus one `pine:arity` and
one `pine:plot-offset`. It is the right long-term lane and the wrong thing to
prioritise on today's corpus.

### What actually stands between 52 and 212 — ranked, with its kind

| n | wall | kind | what it costs to clear |
|---|---|---|---|
| **33** | `pine:no-output` | **object-pass coverage** | ⭐ **32 of the 33 DO contain `line`/`label`/`box` calls** — 27 `line`, 21 `label`, 16 `box`. They are refused *"offers no plot and no alert condition to filter on"* because the object pass collected nothing, not because they draw nothing. **The biggest single row, and it is a coverage gap, not a ruling.** |
| **17** | `pine:function` | vocabulary | one vendor ruling per name, then a closed-table entry |
| **16** | `pine:state` | lane | carried forward past the bounded accumulator — the runtime lane's purpose |
| **15** | `pine:request` | **vendor-gated** | `OWNER-CAPTURE-PACKET.md`; cannot be cleared by code |
| **12** | `pine:block` | lane | `if`/`switch` as a value — served in the runtime lane (RC-L) |
| **11** | `pine:plot-offset` | ~~unmeasured~~ **SIZED 2026-09-26** | a member-door declare-mode fold gap, not Pine — see the 2026-09-26 section at the top (11 -> 0; +5 attach) |
| **8** | `pine:reassign` | lane | `:=` — served in the runtime lane |
| 7 / 5 / 5 | `collection` / `tuple` / `type` | vocabulary | |

⚠️ **The `state`/`block`/`reassign` rows total 36 and are the columnar lane's
limits, not the engine's** — the runtime lane answers all three by design. But see
the measurement above: only 6 of them clear TODAY, because each of those scripts
hits a *second* wall in the runtime lane. **A lane swap is not a coverage win until
the second walls are cleared too**, which is what RC-G…RC-M have been doing.

### Axis 2 — does it LOOK identical? — UNMEASURED, AND THAT IS THE REAL GAP

⛔⛔ **THERE IS NO CONTINUOUS VENDOR COMPARISON. Not a weak one — none.** The
programme's own S2 says it: *"one capture took a live browser session and a
four-slice hand reassembly. That does not scale to 266 scripts."*

So of the 29 scripts a member can attach today, the number verified to draw what
TradingView draws is **the handful that have a hand capture**, and the standing
rule is unforgiving about what that means:

> a render of our own output is not evidence of parity. It shows we drew
> *something*. Only the vendor's own numbers show we drew the same thing.

⭐ **CONSEQUENCE FOR SEQUENCING, and it is the main recommendation of this
section:** every script added to axis 1 without axis 2 is a script we cannot say
is correct. **Build the comparison harness before, or alongside, the next coverage
push** — otherwise the programme's headline number keeps rising while the claim it
implies keeps getting weaker. The receipt discipline is already proven (FNV-1a in
the page, verified after transport); what does not exist is the loop that runs it
without a human.

### The order this suggests

1. **Arm the objects-only flag** — +23, plumbing already shipped (RC-N). One
   Railway variable, one rebuild, one owner decision.
2. **Build the vendor-comparison harness** — unblocks every claim on axis 2 and
   is the only thing that makes "identical" checkable rather than asserted.
3. **The object pass's 33** — the largest code-side row, and the one whose scripts
   most obviously WANT to be drawn.
4. ~~**Rule `plot-offset` (11)** — unmeasured~~ — SIZED and fixed 2026-09-26 (section at the top).
5. **Then** the lane work: clear the runtime lane's second walls so the 36
   `state`/`block`/`reassign` scripts actually land when the door opens.
6. **Owner decision** on whether 100% means 212 or 266.

---

## ⛔⛔ 2026-09-23 — WHERE THE PROGRAMME ACTUALLY STANDS, AND WHICH LANE A MEMBER REACHES

> **Read this before quoting any build count in this file.** Three lanes publish
> numbers here, and they are not the same kind of number.

### 1. Only ONE of the three lanes is wired to a screen

```sh
node tools/pine_lane_reachability.mjs              # the table below, re-derived
node tools/pine_lane_reachability.mjs --self-check # proves the walk sees a 2-hop edge
```

| lane | modules importing it | rendered components (`.jsx`) |
|---|---|---|
| **COLUMNAR / host** (`ast/pine.js`) | 150 | **134** — `StockChart.jsx`, `PineBox.jsx`, `BuilderSheet.jsx`, … |
| RUNTIME frontend (`ast/pineRuntimeFrontend.js`) | 2 | **0** |
| RUNTIME vm (`runtime/vm.js`) | 2 | **0** |
| OBJECT lane (`runtime/objectLane.js`) | 1 | **0** |

⚰️ **SUPERSEDED FOR ONE PATH on 2026-09-27** (branch `pine/runtime-lane-door`, section
at the top): the RUNTIME lane is now reached through exactly one gated door — the
member-door fallback, `VITE_PINE_RUNTIME_LANE_ENABLED`, default off. The OBJECT lane
still reaches no rendered component. The paragraph below is the 2026-09-23 state.

⛔⛔ **THE RUNTIME AND OBJECT LANES REACH NO RENDERED COMPONENT.** Their only
importers are each other and `ast/peelToBuilding.js`, which is an instrument. So
every build count this programme publishes for those two lanes describes a lane
a member cannot open yet — *`lesson_built_tested_green_and_unreachable`*, stated
before somebody reads a rising number as shipped product.

⭐ **THIS IS NOT A CRITICISM OF THE WORK, IT IS THE SHAPE OF IT.** The columnar
lane is what a pasted script reaches today; the runtime lane is its successor and
is being built to the point where the door is worth opening. RC-G…RC-M are real
engineering in that lane. **What none of them is, yet, is something a member can
see.**

⚰️⚰️ **AND THE SENTENCE THAT USED TO END THIS PARAGRAPH WAS WRONG, IN THE
DIRECTION THAT MATTERS MOST.** It said the day the door opens *"is a separate,
deliberate piece of work that does not appear anywhere in this file's task
lists"*, which reads as **there is no door**. There is, it is the COLUMNAR lane's,
and it has been **live in production since 2026-09-19**:
`VITE_PINE_MEMBER_PANE_ENABLED=1`, owner-decided (*"do it so it is fully live"*),
`baked_value: '1'` confirmed by a real member-door round trip that drew Uncharted
Clouds' 20-layer gradient on a live SMCI chart. `MemberPane.jsx` is mounted from
`BuilderSheet.jsx` and its "Add this script to my chart" control is what a member
uses.

⛔ **So the true statement is narrower and more useful:** the door is OPEN and it
is the COLUMNAR lane's. The RUNTIME and OBJECT lanes are the successors behind it
and reach no component yet — which is why their build counts must not be read as
member-facing coverage. The member-facing number is §2 below, and it is **29 of
266**.

⚠️ **IT REPORTS, IT DOES NOT GATE**, on purpose. A rail asserting *"the runtime
lane is unreachable"* would go red on the day somebody opens the door — failing
on exactly the progress it exists to describe.

### 2. Where the corpus stops — and WHICH QUESTION each number answers

⛔⛔ **THREE FIXTURES, THREE DIFFERENT NUMBERS. Name the one you mean.**

| invocation | what it asks | of 266 |
|---|---|---|
| `translatePine(src)` bare | can this become a SCREENER column? | 48 |
| `memberPaneDefinition(…)`, objects-only pane ON | what the code can do | **52** |
| `memberPaneDefinition(…)` **as production builds it** | **can a member paste this and see it TODAY?** | **29** — 10.9% |
| `buildRuntimeIr` (RUNTIME lane, no member door) | — | 13 |
| object lane BUILD | — | 7 |

⭐ **The 23-script gap between rows 2 and 3 is RC-N**, and it is not a Pine problem:
`VITE_PINE_OBJECTS_ONLY_PANE_ENABLED` had no `ARG` in `Dockerfile.web`, so it could
not be set at all. The ARG now exists; arming it is a Railway variable plus a
rebuild and an owner decision.

⚠️ `tools/corpus_metric.json` reports `host_ok` **39** and `screener_ok` **48** for
the same day. Neither is the member-door number. A coverage figure quoted without
its invocation has told you nothing.

### 3. The runtime lane's first walls — with the fixture STATED

⛔ **A FIRST-WALL TABLE WITHOUT ITS FIXTURE IS A MEASUREMENT OF THE PROBE.** The
first ranking taken for this section put `runtime:realtime-untold` on top at 49
scripts, because the probe passed no `newestBarIsForming`. Told the clock
(`runtimeClockOpts(false)`), that row vanishes entirely. Every number below is
`buildRuntimeIr(src, {...runtimeClockOpts(false), inputs: {}})`, no symbol, no
bars.

| n | guard | what it is | classification |
|---|---|---|---|
| **29** | `runtime:library` | an indicator that imports a Pine library | **OUT OF SCOPE** — decision 4, below |
| **25** | `runtime:declaration` | `strategy()` | **OUT OF SCOPE** — decision 1, below |
| **24** | `runtime:statement` | ten-plus distinct shapes, none over 3 | heterogeneous; each is its own small job |
| **21** | `runtime:object-op` | a drawing call | the OBJECT lane's programme, not this one |
| **17** | `runtime:history-dynamic-offset` | a ring width only known while the bar runs | **architectural** — a ring's depth is fixed before bar 0 (RC-I's own reserved case) |
| **17** | `pine:function` | a name the engine grammar does not declare | vocabulary — needs a vendor ruling per name |
| **13** | `pine:input-kind` | 6 `input.timeframe` · 3 `input.color` · 2 `input.symbol` · 2 `input.time` | mixed — see the ⚠️ below |
| **10** | `runtime:call-undeclared-builtin-state` | a builtin fed by state, undeclared in the closed table | vocabulary |
| **8** | `pine:request` | multi-timeframe reads | **vendor-measurement gated** — `OWNER-CAPTURE-PACKET.md` |

**54 of 266 — one script in five — is out of scope by ruling**, and that is the
honest denominator correction to put beside every coverage number in this file.

⚠️ **`input.color` AND `input.symbol` HAVE NO RECORDED RULING.** `RETIRED_INPUT_KIND`
in `pine.js` carries a measured reason for `timeframe`, `session`, `time` and
`string`; `color` and `symbol` are refused only because they are not in the
`NUMERIC` set, with a generic sentence and no reason. ⭐ And measured, the two
lanes disagree about `input.color`: `c = input.color(…)` is admitted by the
runtime lane (as an `env` macro) while `var c = input.color(…)` refuses — **the
same expression, two answers**, which is RC-K's shape. ⛔ The refusal is the more
honest half: the runtime lane carries no colour channel at all (`plot(close,
color = color.red)` builds and the IR's output descriptor holds no colour), and
its own source says why — *"a colour is not a value this lane can hold … serving
them needs a colour channel, which is a capability, not a table entry"*. Nothing
member-facing reads that IR yet (§1), so no member sees a wrong colour today.
**Fixing the inconsistency means building the colour channel, not widening
`NUMERIC`.**

⚰️ And one stale claim found while measuring it, recorded rather than fixed here:
that same comment says `fill`, `bgcolor` and `barcolor` *"STAY REFUSED"*. Measured,
all three BUILD in the runtime lane and their colour is dropped from the output
descriptor. Harmless while §1 holds, and a live wrong answer the day it does not.

---

## ⭐⭐⭐ 2026-09-23 — THE THREE OPEN DECISIONS, RULED (and a FOURTH, raised and ruled the same day)

All three were delegated ("you decide and determine the best answer and decision
for all of those"). Each is ruled below **on a measurement taken for the ruling**,
not on the argument that was already on file.

### 1. `strategy()` — **CONFIRMED OUT OF SCOPE**

⛔⛔ **AND THE COUNT THIS FILE PUBLISHED WAS WRONG BY 22 SCRIPTS.** It said *"47 of
266 scripts, 18% of corpus"*. Measured three ways on the committed corpus:

| | |
|---|---|
| files declaring `strategy(` anywhere | **25** |
| files declaring it at line start | **25** |
| files calling `strategy.entry/exit/close/order/cancel` | 26 |
| **share of the corpus** | **9.4%**, not 18% |

⭐⭐ **THE RULING RESTS ON A PROBE, NOT ON THE ARGUMENT.** The obvious hope is that
a strategy script's VISUAL half is free — accept `strategy()` as a declaration, let
its plots and drawings translate, refuse only the order calls. That would be parity
for what a member SEES without building a backtester. It was measured by
substituting `strategy(` → `indicator(` (the faithful probe: it preserves the
declaration rather than deleting it, per the binding rule below):

| | |
|---|---|
| strategy scripts that then BUILD | **0 of 25** |
| that call `strategy.*` orders | **25 of 25** |
| distinct next walls across the 25 | **10+**, nothing concentrated |

**Not one of them is a strategy that merely draws.** Every one places orders, none
builds even with the declaration accepted, and the walls scatter across ten guards
so there is no follow-on lane either. Accepting `strategy()` buys **zero scripts and
zero concentration** — the backtester is required for any of them, and a backtester
is a product (position sizing, portfolio state, P&L, alert generation), not a parity
fix.

➡️ **Decision: confirmed out of scope. Revisit only if a member asks for
backtesting by name.** The parity claim is asterisked *"indicators, not
strategies"*, and at 9.4% that asterisk is half as expensive as this file thought.

### 2. The ATR seed — **RULING CONFIRMED, HOST-LANE WORK NOT SCHEDULED NOW**

> ⭐ **SUPERSEDED 2026-09-27 — scheduled ("do it all") and DONE.** See
> §"2026-09-27 — THE ATR SEED, HOST LANE: CLOSED (`atrPine`)" at the top. The
> ruling below held: Pine got its own seeding, Wilder's original stays everywhere else.

The ruling on file is right and stands: **Pine gets its own seeding; Wilder's
original stays everywhere else.** The vendor is measured
(`seed-warmup-spy-12m-2026-09-21.json`), the request path has shipped, and the
columnar attempt reached **delta 0** against the capture.

➡️ **Decision: do NOT do the host-lane twin now.** Three reasons, in order:

1. **The residual is not visible to a member.** One bar of warm-up difference,
   **4e-12 by bar 300**, already disclosed by `closedTable.json`'s `vendorNote`.
2. **It is not a Pine job.** It is a Python-lane + screener-contract job —
   `api/services/ast_interpret.py` mirrors `closedTable.json` and
   `screenerColumns.test.js` freezes those columns; the measured attempt cost
   **23 new failures** across manifest pins, the sentence round-trip, the vendor-note
   roster, the corpus snapshot and the formula reference.
3. **Its blast radius includes money.** Re-seeding the SHARED column moves
   ThinkScript's `ATR`, the native ATR and ATR-bands indicators, and the pattern
   engine's ATR levels — which the firm trades on.

A 4e-12 discrepancy competes here against capabilities that stop scripts compiling
**at all**. Scope it as one piece when the screener contract is next open:
`_fn_atr_pine` twin + regenerated screener-column / corpus / formula artifacts +
the count pins.

### 3. The pending vendor captures — **CONSOLIDATED INTO ONE OWNER SITTING**

These cannot be decided, only taken: they need a live TradingView session, which is
an owner action. What CAN be decided is that they stop being three separate
blockers. **Packet: `docs/pine/OWNER-CAPTURE-PACKET.md`** — every open measurement,
in one sitting, with the probe committed for each.

⛔ **NONE OF THEM IS GUESSED AT IN THE MEANTIME.** `symbolScope.json` already says
so in its own words — *"an unconfirmed spelling is never served"* — and the
`pending_measurement` sentences tell a member it is a MEASUREMENT gap rather than a
grammar gap, so a script that will work unchanged the day a witness lands is not
rewritten by its author today.

### 4. Pine LIBRARIES (`import`) — **OUT OF SCOPE FOR THIS PHASE, and the refusal now says so**

⭐ **RAISED BY A MEASUREMENT, not by a plan.** Ranking the runtime lane's first walls
after RC-L put `runtime:declaration` on top at **54 of 266** — and that row is two
populations wearing one sentence:

| | |
|---|---|
| **25** | real `strategy()` scripts — ruled out of scope in §1 above |
| **29** | scripts declaring `indicator()` that stop on an **`import`** |

All 29 open with `indicator(...)`, so the sentence they were shown — *"a script that is
not an indicator"* — was **false about every one of them**.

⛔ **THE RULING: libraries stay unserved, for the same reason `strategy()` does.**
Serving them means fetching and compiling third-party Pine from TradingView. That is a
distribution and licensing question (`docs/pine/LICENSING.md`) at least as much as an
engineering one, and the programme's goal is *paste code and get the identical
indicator* — a script that imports a library is not self-contained code the member
pasted. **31 distinct libraries across the 29 scripts, 39 of 40 aliases really called**,
so there is no cheap subset to pick off.

⭐ **WHAT DID CHANGE IS THE SENTENCE** — `runtime:library`, quoting the member's own
import line. `runtime:declaration` is now exactly the 25 strategies, which is the
population its wording describes. **RC-M** carries the measurement and the rejected
shortcut (aliasing `TradingView/ta` onto the `ta` namespace — two different sets, and
serving one as the other is RC-A's defect).

⚠️ **A NOTE ON THE INSTRUMENT, because it was wrong first.** The first ranking put
`runtime:realtime-untold` on top at 49 scripts. That row was the PROBE's blind spot —
it passed no `newestBarIsForming`, so the lane correctly refused every script naming a
realtime barstate. Told the clock, the row vanishes. **Any first-wall table in this
programme must state its fixture, or it is a measurement of itself.**

---

## ⛔⛔ 2026-09-22 — TWO NUMBERS THIS PROGRAMME PUBLISHES ARE WRONG

Both are measurement defects, not engine defects, and both make the engine look
worse than it is. Read this before quoting any figure below.

### 1. THE DENOMINATOR IS 187, NOT 266

A script with no drawing call cannot draw, and the object lane refuses it
CORRECTLY. Measured (`ast/drawingDenominator.measure.test.js`): only **187 of
the 266** committed scripts contain a drawing constructor or method at all.

| | |
|---|---|
| reported so far | 4 of 266 — 1.5% |
| **honest** | **4 of 187 — 2.1%** |

⭐ And the more useful half: the same instrument asks the question TWO
independent ways — does the SOURCE mention a drawing call, and does the ENGINE
refuse for having nothing to draw — and **ten scripts say yes to the first and
no to the second.** Those are drawing calls the object pass cannot SEE: a
capability gap wearing the costume of an empty script, sitting inside a row a
reader skips as "correctly refused, not work". Three of the ten are
fair-value-gap scripts and three are volume-profile ones, which is the shape of
ONE shared cause.

### 2. EVERY DISTANCE IS AN OVER-ESTIMATE BY AN UNKNOWN AMOUNT

96 of 266 scripts (36.1%) stop on a refusal that **cannot say where it is**
(`ast/approximateRefusals.measure.test.js`). The runtime lane pins such a refusal
to whichever statement was open, so the reported line is innocent — and any tool
that peels BY LINE cannot make progress. `distanceToWorking` therefore records
those scripts as UNREACHED regardless of how close they are.

⭐ It is ONE seam, not scattered sites: every `runtime:`-namespaced guard keeps
its position and every `pine:` guard reaching the runtime lane loses it. ⛔ Two
plausible fixes at the RAISE sites were tried, measured as no-ops on the corpus
count, and reverted — see that file's header before attempting a third.

⚠️ **So "250 of 266 are more than 20 walls away" is not trustworthy.** It is an
upper bound on distance produced by an instrument that cannot see past a
location-less refusal.

---

## ⭐⭐⭐ 2026-09-22 — THE SELECTION RULE CHANGED, AND THE METRIC WENT 1 → 4

> **Pick the guard that COMPLETES a script, not the one that blocks the most.**

Ten waves picked work off the first-blocker census — guards ranked by how many
scripts they block — and moved `draws end to end` by zero every time. Measured
with `guardUpperBound.measure.test.js`, the three LARGEST rows in the object
lane are each worth **exactly nothing**:

| guard | scripts it refuses | gain if solved PERFECTLY |
|---|---:|---:|
| `runtime:declaration` | 35 | **0** |
| `runtime:statement` | 15 | **0** |
| `pine:builtin` | 14 | **0** |
| `runtime:colour` | **3** | **+1** |

`runtime:colour` refuses three scripts and was worth one, because for one script
it was the **last** wall rather than the first. Building it took the corpus from
**1 to 2 scripts drawing end to end** — the first movement on this programme's
product metric, after ten honest zeros (`850c22593`).

⛔⛔ **A FIRST-BLOCKER CENSUS CANNOT SEE THIS, BY CONSTRUCTION.** A build stops at
the first refusal, so a script with nine walls reports only its first, and the
guard standing between it and working is invisible until the other eight go.
That is what "first blocker" *means*; it is not a flaw to fix in those censuses.

### The instrument that replaces the queue

`nearestToWorking.measure.test.js` (`fcf682f46`) prints every script within 12
walls of building, its FULL wall set, and the union as a work queue. Read it
**with** `guardUpperBound`: this one says what is CLOSE, that one says what a row
is WORTH. Both share one peeler (`peelToBuilding.js`), mutation-proved.

### Today's shipped work, and what each one actually bought

| commit | change | product effect |
|---|---|---|
| `2c204a21b` | `splitMethodName` splits at the LAST dot — a drawing in a UDT field is addressable | +6 object-pass ops in 3 scripts, recovered from a SILENT drop (every diagnostic counter read zero). Drawing metric unchanged. |
| `850c22593` | `na` is a colour — `cond ? colour : na` | **draws 1 → 2**, builds 2 → 3. Also closed a silent wrong number the other way: `plot(cond ? color.red : na)` compiled and drew a packed colour as a price. |
| `fcf682f46` | the `nearestToWorking` queue instrument | none directly; it is how the above was chosen |
| `01ef1fd76` | `ta.valuewhen` — occurrences, not a bar window | 377 sites / 39 scripts no longer walled here. Metric unchanged — it moved a wall; see below. |
| `280a05f29` | the cross family over runtime state (`ta.crossover`/`crossunder`/`cross`) | ⚰️ **CORRECTED — see below. This row read "draws 2 → 4 … `liquidity-pools` (500 objects)" and the 500 paint NOTHING.** The honest effect is **draws 2 → 3** (`trendlines`, of which the renderer keeps 6 of 8), builds 3 → 5. |
| `0f58a80a9` | the peeler replaces a failing binding instead of blanking it | no metric change by design — it is an INSTRUMENT fix. Queue 7 → 10; `position-size-calc` 12 → 2, `wyckoff` UNREACHED → 2. |
| `bd11b4d9a` | a drawing inside an `else` arm (two spellings of one guard) | metric unchanged — `else` was a SECOND wall for all 120 drawing scripts that use it. Queue 10 → 12; `inside-bar-boxes` 11 → 4 walls. |
| `c5f87dbc8` | the approximate-refusal instrument | no metric change — it MEASURES a measurement defect: 96 of 266 stop on a refusal with no location. |
| `9523b028d` | the drawing-denominator instrument | no metric change — it corrects the denominator to 187 and names 10 scripts whose drawing calls are invisible to the object pass. |

### ⚰️⚰️ THE 500-OBJECT WIN PAINTED NOTHING — corrected 2026-09-22

**`liquidity-pools` was reported at 500 objects, the largest number this
programme has published. The renderer keeps none of them.**

    CREATE FAMILIES : ["create:linefill","create:linefill"]
    REGS            : ["line","line","line","line"]
    RAW0            : {"family":"linefill","props":{"line1":null,"line2":null}}

Two creates, both linefills. Four `line` registers declared and **not one
written by any create**, so every linefill is anchored to a line that was never
made — and `toRenderState` drops a fill without both its lines, by design and
with a comment saying so. Checked every drawer rather than only the flagged
one: liquidity-pools **500 emitted / 0 kept**, makuchaku 212/212, trendlines
8/**6**.

⭐⭐ **THE INSTRUMENT WAS AT FAULT, NOT ONLY THE SCRIPT.** The executing census
counted `run.live.length` — objects the runtime EMITTED — so a script could
score 500 while painting zero, and nothing in the suite could tell. It now asks
the product's own renderer (`toRenderState` → `paintObjects` → `layoutTables`,
read through their own counters) and reports `DREW-NOTHING-KEPT` as a bucket of
its own. Fixed in `f31675658`.

⛔ **AND `trendlines` IS THE NUMBER THAT MATTERS MORE THAN THE 500.** It keeps
**6 of 8**. A total loss is loud — somebody eventually opens the chart. A
PARTIAL loss is silent: the drawing appears, looks right, and is missing two
objects nobody counts. An emission-based census cannot see it at all.

⚠️ **The honest drawing metric is 3, not 4** — makuchaku fair-value-gaps (212),
trendlines (6 of 8), inside-bar-range-mother (2). Every "draws N" in this
document before 2026-09-22 counts emission and is an over-estimate by an
unknown amount.

### ⛔⛔ THE GUARDS-HIT TABLE IS MOSTLY CASCADE — measured 2026-09-22

`distanceToWorking`'s cumulative guard-hit table is NOT a work queue, and its
top two rows are the two most inflated in it. Comparing the FIRST-BLOCKER
census (no peeling, so no cascade) against the walk's own hits:

| guard | first blocker | peel hits | inflation |
|---|---:|---:|---:|
| `runtime/pine:undefined` | 14 scripts | 1,075 | **77x** |
| `runtime/pine:statement` | 3 scripts | 768 | **256x** |

⭐ THE MECHANISM: blanking a failing line removed the NAME as well as the
capability, so every later line reading it refused `pine:undefined` and each one
cost another peel. `peel` now REPLACES a failing binding with `name = 0.0`
(`0f58a80a9`). Measured: 4 scripts UNREACHED -> reached, 4 shorter, mean
distance 7.09 -> 5.45, none regressed, and the walk is ~30% faster.

⚠️ A corollary worth carrying: **1,075 undefined-name refusals, and 847 of
them (78.8%) name something the member DID define.** An "undefined name" in this
corpus is almost never a vocabulary gap.

### ⭐ …and the wall it moved to was the NEXT job, which delivered

`liquidity-pools`'s guard moved `pine:function` → `runtime:call-windowed-state`.
That row sized at **+1 at best**; serving it delivered **+2 builds and +2 draws**.
Both drawers were on the queue before the work started.

### ⛔⛔ THE SIZER IS NOT A STRICT UPPER BOUND — corrected 2026-09-22

It claimed deleting a refused line is "more permissive than any correct
implementation could ever be". **False when the line is a BINDING.**
`trendlines:86` is `long_break = crossover(close, res_y)`: deleting it removes a
NAME and breaks every consumer, where implementing keeps them. So the peel is
STRICTER than an implementation and the bound UNDERSTATES.

⭐ The queue had printed the tell and nobody read it — `trendlines`'s walls read
`call-windowed-state, pine:undefined`, and that second wall was **an artifact of
the peeler**, not a property of the script. Read the sizer as an estimate of
ORDER in both directions: a zero has been right every time it was checked; a
positive number is a rough size a binding-heavy guard can beat.

### ⛔ `ta.valuewhen` moved a wall rather than removing one, and the sizer said it might

`liquidity-pools` was two walls out and `pine:function` was sized at **+1 AT
BEST**, with that file's own header warning "a correct implementation will very
likely reach fewer". Measured after shipping: the script's guard **moved** from
`pine:function` to `runtime:call-windowed-state`. `ta.crossover(high, LSH)` over
a runtime-stateful series "needs the series bridge" — a pre-existing
architectural gap this work newly *reaches* rather than one it caused.

⭐ **So the named next wall is the SERIES BRIDGE**: a windowed builtin
(`ta.crossover`, `ta.sma`, …) fed by a value this lane computes at runtime
rather than by a committed column. It is now the blocker for the nearest
script in the corpus, and it is architecture, not vocabulary.

### Still open with the owner

1. **The ATR seed** (below, §"THE ATR SEED"). Recommendation unchanged: give
   Pine its own seeding and leave Wilder's original everywhere else. `ta.valuewhen`
   just shipped as exactly that shape — a vendor twin beside a house function —
   without touching the screener's columns, which is the evidence that the
   pattern works.
2. **W4 capture** — written, self-checked, blocked on the TradingView session.

---

---

## ⛔⛔ READ THIS BEFORE PLANNING FROM ANY TABLE BELOW — measured 2026-09-21

> **The runtime-lane census is NOT the product's question, and this programme
> was sized against it.**

Every first-blocker table in this document counts `buildRuntimeIr`. **A member
does not see a compiled IR; a member sees a drawing.** The product path is
`buildObjectLane`, and measured over the same 266 scripts it draws **2**:

    node node_modules/vitest/vitest.mjs run       src/components/chart/engine/runtime/__tests__/objectLaneCensus.measure.test.js

⭐⭐ **`2 of 266`, and agent C's whole wave did not move it** — the same two
scripts before and after, re-verified in the integrator's session by reverting
its two source files to `acc9d8c57` and re-running the census. Meanwhile the
runtime-lane census moved 8 → 12 compiled. **Two numbers, one of which is the
member's.**

⛔ **Where the drawing actually dies — roughly half the corpus is refused by the
OBJECT PASS before the runtime lane is consulted at all:**

| n | guard | lane |
|---|---|---|
| 23 | `pine:character` | objects |
| 13 | `objects:nothing-drawn` | objects |
| 13 | `pine:declaration-strategy` | objects |
| 11 | `pine:block` | objects |
| 11 | `objects:iterated-tree-not-last-bar` | objects |

⛔ **CONSEQUENCE FOR THE PHASES, and it is not a small one.** Phase 2 (the
named-vocabulary sweep) is a RUNTIME-LANE queue, so on this evidence it will
close guards and move **no member-visible drawing**. The four largest
product-path blockers are all object-pass work, and `pine:character` at the top
of both tables is Phase 3. **Phase 3 should be pulled forward; Phase 2 should be
re-justified against the object-lane table or re-scoped.** That re-plan is owed
and is deliberately NOT written in here yet — recording the measurement is not
the same as having decided what to do about it.

### ⭐⭐ AND THE TOP ROW IS ONE CAPABILITY, NOT 23 PROBLEMS — read 2026-09-21

`pine:character` — *"Pine has no character like this one"* — is the largest
row in BOTH tables and the name is actively misleading. Opening all 23 call
sites with the new instrument:

    GUARD=pine:character node node_modules/vitest/vitest.mjs run       src/components/chart/engine/runtime/__tests__/objectLaneCallSites.measure.test.js

**Every one of the 23 is the same construct** — a member access on the result of
an expression:

    htfFVGs.first().area.delete()          k._box.pop().delete()
    imbalanceLab.get(x).set_textcolor(…)   Candle.new().create()
    array.get(levelGlow1Lines, i).set_x2(…)   (l[1]).delete()

Minimal repro, measured:

| source | result |
|---|---|
| `a.size()` (name . member) | fine |
| `array.new_float(1).size()` (CALL . member) | **`pine:character` at the `.`** |
| `(a).size()` (paren . member) | **`pine:character` at the `.`** |

⛔ **The lexer only accepts `.` when the preceding token is a NAME**
(`lexerGaps.test.js` documents the spaced-dot and newline cases around it).
Pine allows postfix member access on any expression. So this is **one lexer +
parser + lowering job worth 23 scripts**, the biggest single item in this
programme — and it read as an encoding problem for as long as nobody opened
the call sites.

⚠️ **This is the third time a row has been sized without reading it**
(`[` was 15 tuple destructures and 1 history read; `pine:input-kind` was a
`group=` label). The instrument above exists so it is the last. **A count is a
prompt to go look, never a sizing.**

⭐ Agent C's own words, which is the sentence that earned this block:
*"The brief's implicit model — 'clear census rows ⇒ scripts draw' — is not
supported by measurement."*

⚠️ **This does not retire the runtime-lane tables.** Value correctness is real
work and a drawing script needs BOTH lanes. It retires using them **alone** to
decide what to build next.

---

## ⭐⭐ WAVE RESULTS 2026-09-21/22 — three lanes, and the CEILING nobody had measured

Three agents ran against the object pass and the lexer. **All three moved their
rows. None moved "draws end to end".** It stayed at 2 of 266, the same two
scripts, through every merge — and the reason is now measured rather than
guessed.

### ⛔⛔ THE DENOMINATOR WAS WRONG. Only **190 of 266** scripts contain a drawing call.

```
node node_modules/vitest/vitest.mjs run   src/components/chart/engine/runtime/__tests__/objectLaneDrawerCensus.measure.test.js
```

76 scripts (29%) carry no `line|label|box|table|linefill` constructor at all —
they are plot-only indicators. `OBJECT_FAMILIES` is five families and a `plot()`
is not one of them, so **nothing that is ever built can make those draw.**
"2 of 266" is really **2 of 190**.

⭐⭐ **TWO AGENTS REACHED THIS INDEPENDENTLY, BY DIFFERENT MATCHERS, AND IT WAS
RE-VERIFIED IN THE INTEGRATOR'S SESSION.** It is the single most useful number
this programme has produced, because it retires a whole way of choosing work.

### ⛔ A ROW'S SCRIPT COUNT IS NOT ITS UPSIDE — ask how many of its scripts DRAW

| row | scripts | drawers | verdict |
|---|---|---|---|
| `objects:no-objects-in-source` (was `nothing-drawn`) | 13 | **0** | the engine is RIGHT, permanently |
| `pine:module` | 6 | **0** | correct refusal — library `import`; closing it needs a vendored library corpus and moves the metric by 0 |
| `pine:state` | 7 | **1** | six are plot-only; ceiling of one script |
| `objects:iterated-tree-not-last-bar` | 10 | **10** | every one a real drawer — where the value is |

A row of 13 that cannot move the number outranks nothing. **Measure drawers
before opening a lane.**

### What the three waves actually bought

| wave | row | result |
|---|---|---|
| postfix member access | `pine:character` 23 → **0** | `host_ok` 32 → **35**; all 23 met a second blocker |
| create inside a collection call | `pine:no-output` 9 → 7 | 4 scripts cleared the object pass; `order-blocks` compiles 22 ops where it compiled none |
| per-row scoping + exact split | `iterated-tree-unbounded` 3 → 0 | 4 scripts reached the runtime lane; `nothing-drawn` split into an exact terminal guard |

### ⛔⛔ THE NEAR-MISS — the lexer fix ALONE would have shipped a wrong drawing

Two readers recognise a statement by its FIRST token and take the first `(` as
the whole call. Measured before/after:

```
box.new(<series args>)            -> ops ["create:box"]              correct
box.new(<series args>).delete()   -> ops ["create:box"]              WRONG
```

**The delete vanished, with no diagnostic** — a box on a member's chart forever,
drawn by a line their script says to remove. Span guards now require the call to
cover what those readers read, and that rail is the load-bearing section of
`postfixMember.test.js`.

### The next three lanes, each DERIVED from a measurement

1. **UFCS — `coll.get(i)` ⇒ `array.get(coll, i)` for a declared collection.**
   The dominant receiver among the 23 is the name-form method call
   (`imbalanceLab.get(x)`, `htfFVGs.first()`, `k._box.pop()`), and this engine
   has **no method-form support at all**. Postfix member landed on top of a
   missing capability; this is what unlocks those receivers.
2. **`runtime:object-op` — a drawing used as a VALUE.** The single refusal
   standing between the collection idiom and a drawing, reached by a minimal
   synthetic script and nothing else. It is in `pineRuntimeFrontend`, not the
   object pass.
3. **Per-bar iteration storage.** `vm.js` allocates `iters` ONCE for the whole
   run, `ITER_SLOTS` long, indexed by counter alone — there is no bar
   dimension. That is the whole of what stands between the 10 remaining
   iterated-tree drawers and the object pass, and it is a memory-scale
   decision, not a lane fix.

---

## ⭐⭐ THE ATR SEED — settled, half-shipped, and the other half priced

**Measured at the vendor 2026-09-21** (`seed-warmup-spy-12m-2026-09-21.json`):
TradingView emits `ta.atr(n)` at **bar n-1**, seeded as the mean of the first n
true ranges where bar 0 counts as `high - low` (`ta.tr(true)`). Ours emits at
bar n. Same recurrence, two seeds; the delta decays by exactly (n-1)/n.

### ✅ SHIPPED — the request path
`ta.atr` inside a `request` took a separate desugar that built its true range
from a bare `close[1]`, `na` on bar 0. So `ta.atr` would have meant one thing in
a request and another everywhere else. Fixed, and railed structurally (no
harness executes a request, only builds its IR). **The mutation of that desugar
had survived every behavioural test in the file** — the path had no coverage.

### ⛔⛔ OPEN — the host/columnar path, and it is NOT a one-line change

> ✅ **CLOSED 2026-09-27** — `atrPine` (see the dated section at the top of this
> file). Kept below as the record of what it cost and why.
Routing Pine to a separately-seeded column **was built and reverted**. It works:
`ta.atr(5)` matched the vendor at **delta 0** across the captured series. What
stopped it:

| | |
|---|---|
| declaring a name in `closedTable.json` | the **Python lane** mirrors that table in `api/services/ast_interpret.py`, and `screenerColumns.test.js` **freezes those columns for it to read** — so a Pine script's screener column changes name with no Python implementation behind it |
| measured cost of the attempt | **23 new failures**: manifest count pins, the sentence round-trip, the vendor-note roster, the corpus snapshot, the frozen screener columns, the formula reference |
| re-seeding the SHARED column instead | **worse** — it moves ThinkScript's `ATR`, the native ATR and ATR-bands indicators, and the pattern engine's ATR levels, which the firm trades on |

⭐ **So the ruling stands and is recorded rather than quietly deferred:** Pine
gets its own seeding, Wilder's original stays everywhere else — and doing that
in the host lane is a **Python-lane + screener-contract job**, not a Pine job.
Scope it as one piece: a `_fn_atr_pine` twin, regenerated screener-column /
corpus / formula artifacts, and the count pins. Until then the host lane keeps a
one-bar warm-up difference that `closedTable.json`'s `vendorNote` already
discloses honestly and that is 4e-12 by bar 300.

⚠️ **GATE NOTE.** `stockChartWiring > A HOVER REACHES THE RENDERER NOT AT ALL`
is **INTERMITTENT, not merely load-sensitive** — it failed ALONE after passing
alone three times the same day, and fails alone at HEAD with the change
reverted. For that one case "re-run it alone" is not a discriminator; establish
it by reverting and re-running.

---

## ⭐⭐ WAVE 2 — three lanes, TWO REAL DEFECTS, and a fourth honest zero

Merged 2026-09-22: per-bar iteration storage, drawing-as-a-value, method-form
(UFCS) calls. Gated together, 0 NEW failures.

⛔⛔ **`draws end to end` is STILL 2 of 266.** Fourth wave running with no
movement in the product metric, and the reason is now measured rather than
guessed: **a capability is a SECOND wall almost everywhere.** The UFCS lane
measured its own: of 37 corpus scripts using method-form calls on a declared
collection, **36 die earlier on something unrelated** (`pine:module` ×10,
`runtime:udt` ×10, `runtime:declaration` ×10, …). Clearing one wall reveals the
next one.

### ⭐⭐ The two findings worth more than the headline capabilities

**1. A LIVE SILENT WRONG NUMBER, on the branch point.**

```pine
a = array.new_float(0)
for i = 0 to 3
    array.push(a, close)    // plot(array.size(a))  ->  4   correct
    a.push(close)           // plot(array.size(a))  ->  0   WRONG, and no refusal
```

The same program, two spellings, two plotted numbers, **neither refusing**.
`mutatorTargets` matched the TOKEN `array.push`; the method form arrived as
`a.push`, so the write was invisible and the read folded anyway. Verified after
the merge: both spellings now answer 4.

**2. AN UNCOUNTED SILENT DROP in the object pass.** A method-form statement was
dropped with an EMPTY `unsupported` ledger — the `box.new(…).delete()` class.
Written as a binding, the lane answered OK and drew a box whose setter had
disappeared. Now counted by name.

### ⭐ Per-bar iteration cost nothing, because the question was wrong

The costing rejected every storage option **on measurement**: FULL cross-product
**1,621 MB** for one script, SPARSE **801 MB**, against the runtime's own
**64 MB** ceiling — and the bounded ring was *inapplicable* rather than merely
expensive (the object walk needs bar 0's rows while the VM stands at bar 4,999).

What shipped instead **interleaves the two bar walks**: a value need not be
stored per bar if whatever reads it is standing on the bar that produced it.
Zero bytes, exact rather than approximate, and it is what Pine itself does — two
passes were this engine's convenience, never the vendor's model.
`objects:iterated-tree-not-last-bar` is gone from the census entirely.

### ⚰⚰ My briefs were wrong, and the agents measured it

The UFCS brief pointed its measurement command at an **unrelated guard**
(`runtime:declaration` is about the SCRIPT's declaration — `strategy()`,
`import` — not a collection's), and **three of its five flagship call-site
examples are unreachable by the brief's own stated rule** (family from the
declaration): two are UDT fields, one is a user-function parameter. The one
addressable example was blocked by the generic `array.new<T>()` declaration, not
by the method form — proved by reverting that layer alone and watching all three
moved scripts revert with it.

⭐ **That is the third wave running where an agent corrected the brief it was
given.** Briefs are sized from censuses; censuses name guards, not capabilities.
Read the call sites.

### ⛔⛔ AND A REPO-WIDE INSTRUMENT IS VACUOUS — verified with a control

`grep -c $'
' <file>` through the Bash tool **always answers 0**. Measured: a
file containing two CR bytes answers `0`, while `grep -c alpha` on the same file
answers `1`. Every line-ending check run through that command today measured
nothing.

⚠️ It caused no damage — `python tools/check_repo_hygiene.py` reports clean over
12,104 files and all 49 files changed this session have uniform endings — but
that was `autocrlf` doing the work, not the check. **Use the repo's own gate, or
count bytes in Python.** `git diff --stat` is the other honest signal: a
whole-file ending flip shows up as thousands of changed lines.

---

## ⚰⚰ THE BOTTLENECK MOVED, AND IT FALSIFIES WHAT THIS FILE SAID YESTERDAY

**Struck, 2026-09-22.** The block above headed *"READ THIS BEFORE PLANNING FROM ANY
TABLE BELOW"* concluded:

> *"Phase 2 (the named-vocabulary sweep) is a RUNTIME-LANE queue, so on this
> evidence it will close guards and move no member-visible drawing. The four
> largest product-path blockers are all object-pass work."*

**That was true when written and is false now.** Two waves cleared the object
pass. Re-measured on the merged tree, the object-lane census reads:

| n | drawers | lane / guard |
|---|---|---|
| 35 | **35** | runtime/`runtime:declaration` |
| 21 | **21** | runtime/`pine:builtin` |
| 17 | **17** | runtime/`runtime:udt` |
| 13 | **13** | runtime/`pine:undefined` |
| 12 | **12** | runtime/`runtime:statement` |
| 12 | **12** | runtime/`runtime:expression-statement` |
| 12 | 10 | objects/`pine:no-output` |

**Almost every top row is now the RUNTIME lane, and every one of them is all
drawers.** The object-pass rows that dominated — `pine:character` 23,
`objects:nothing-drawn` 13, `objects:iterated-tree-not-last-bar` 11 — are gone
or reclassified. So the named-vocabulary sweep is now exactly where the work is,
which is the opposite of yesterday's conclusion.

⭐ **The correction is the point, not an embarrassment.** Yesterday's block was
right to retire "clear census rows ⇒ scripts draw"; what it got wrong was
treating a snapshot of WHICH LANE refuses as a durable property of the corpus.
It is a moving target, and the drawer cross-tab — not the row size — is what
stays true. **Re-measure before planning; that is what the commands are for.**

### ⭐⭐ `pine:builtin` is THREE jobs, read from its call sites

Not one, and not 23 unrelated ones:

1. **The `timeframe.*` family** — `period`, `multiplier`, `in_seconds`, `change`.
   The largest cluster, and the one with the demand behind it:
   **`timeframe.period` is 339 uses in 71 scripts**, `timeframe.in_seconds` 119
   uses in 28. The refusal is literally *"this Pine built-in names something the
   engine grammar does not hold"*.
2. **`time` IS MILLISECONDS IN PINE AND SECONDS HERE** — a thousand-fold
   difference, refused deliberately and loudly rather than silently compared
   against a literal no member wrote. A units ruling, not a vocabulary gap.
3. **A tail** — `barstate.isnew` (needs per-tick evaluation), `syminfo.basecurrency`,
   `str.length`.

⛔ **And declaring a name is not free**, which shapes how any of this lands:
`closedTable.json` is mirrored by the PYTHON lane in
`api/services/ast_interpret.py`, and `screenerColumns.test.js` freezes those
columns for it to read. One name added on 2026-09-22 cost **23 new test
failures** before it was reverted. Measure the ripple first.

---

## ⚰⚰ "2 OF 266 DRAW" WAS A BUILD COUNT — corrected 2026-09-22

This file, five session reports and a dozen commit messages have quoted
**"draws end to end: 2 of 266"** as the product metric. The census that produces
it does this:

```js
const r = buildObjectLane(src, { tf: 'D', newestBarIsForming: false })
if (r.ok) { drew.push(name); continue }
```

**It never executes anything.** `r.ok` means the object lane did not REFUSE. The
number was a BUILD result wearing a RUNTIME name, and it is now labelled
`the object lane BUILDS`.

⭐ **What running the two named scripts actually showed — with its limits, not
as a defect:**

| script | result |
|---|---|
| `4c-nyse-market-breadth-ratio` | **threw** — *output 3 must carry a number, got string*. It makes FIVE `request.security` calls and the probe supplied no `requestBars`, so its requests answer `na` and a `str.tostring` of that reaches a plot. **Consistent with the fixture, not evidence of a defect.** |
| `makuchaku039s-trade-tools-fair-value-gaps` | ran to `status: ok` and emitted **zero objects** — on smooth synthetic bars, which is what a fair-value-gap detector *should* do when there are no gaps. |

⛔ **So the honest position is three sentences, not one.** The census measures
BUILD, which is certain from the code. Whether either script DRAWS on real data
is a separate question nothing currently answers. A runtime census needs bars,
request data and a clock — which is why it does not exist yet, and saying so is
cheaper than a number that reads as though it does.

⭐⭐ **The corrected reading does not change any decision made today.** Every
wave was judged on "did this number move", and it did not move under either
reading. What changes is what the number is allowed to be CALLED — and that it
is now clear a runtime census is owed, which nobody had noticed was missing
because the build census had taken its name.

⚠️ `runObjectLane(lane, view)` is the entry that actually runs one
(`{bars, series, confirmed, readTime, barTimes, requestBars}`);
`memberPaneTables.test.js` drives the member's own route end to end and is the
model for the runtime census when somebody builds it.

---

## The honest timeline

| Target | Effort |
|---|---|
| The RVOL+ATR dashboard drawing on a real chart, locally | ✅ **DONE 2026-09-21** (Phase 0) |
| 10-30 named target indicators drawing identically | **~2 weeks** with 3 parallel agents |
| 50-100 named indicators + the top vocabulary gaps closed | **~4-6 weeks** |
| ~35-45% of the 266-script corpus compiled end-to-end | **~2-3 months** (needs Phase 3) |
| Full runtime + language surface minus strategies + libraries | **~8-12 months focused** |
| Every published Pine script incl. strategies + libraries + Pine v7 | **~12-18 months** |

**A one-week sprint (Phase 0-2 + a serious start on 3) is realistic and lands
real value.** The full-parity goal is not, but a compressed **7-day sprint plan
is at the bottom of this file** and it's what I'd start with.

**The concurrency cap is real:** `CLAUDE.md` documents "at most 3 concurrent
agents plus the integrator" with measured evidence of failures at 5 (OOM-swept
the box, dead worktree) and at 13 (7 of 12 agents killed by account limit).
That cap holds. "Deploy enough agents" is a **wave count**, not a concurrent
count.

---

## Phase 0 — Local demo loop (DONE 2026-09-21)

Established:
- Local dev with both pane flags on (`app/.env.local`, gitignored).
- Signup + login as `hubtest@local.dev` on the sandbox DB (admin, paid_equiv).
- The `RVOL+ATR Dashboard` script pastes into `/charts` → Builder → Import,
  translates through `translatePine`, builds via `memberPaneDefinition`,
  installs into `nativeRegistry`, attaches via `addInstance`, and appears as
  `RVOL + ATR` in the chart's legend on the real workspace chart.

Bug fixed en route: `OBJECTS_ONLY_ANCHOR.mode` was `'clean'` — a string not in
`REPAINT_MODES` — so `worstRepaint([...])` failed closed to `'repaints'` while
the install door measured `'non-repainting'`. Every objects-only script that
reached the pane path refused, silently. Fixed to `'non-repainting'`, rail:
`objectsOnlyAnchorMode.test.js`.

**Daily rhythm for the rest of the programme:**
1. Boot sandbox: `python scripts/hub_sandbox_boot.py --port 8000 --data-dir <scratch>`
2. Boot Vite: `cd app && npm run dev`
3. Sign in as hubtest@local.dev; open `/charts`; open Builder (Alt+Shift+A).
4. Paste next target script into Import tab.
5. Screenshot local pane; screenshot TradingView same script/symbol/TF.
6. Diff. Any difference → open a lane to close it.

---

## Phase 1 — Vendor Parity Programme (parallelisable, continuous)

**Every named function in `closedTable.json` gets a canonical vendor capture.
"Identical to TradingView" is an engineering statement whose unit is one
capture.**

### ✅ The queue is MEASURED as of 2026-09-21 — and it is 29, not 86

`vendorParityCoverage.measure.test.js` crosses what `closedTable.json` declares
(71 functions) against what the committed **probe sources** actually call, and
against corpus demand. Run it; do not quote it.

⛔ **The first attempt at this measurement reported ZERO and was wrong.** It
asked "is there a test that reads a vendor fixture and names this function",
which one large test file satisfies for every name at once. That read as
"Phase 1 is already done". The check now keys on **call sites in
`tools/visual_conformance/probes/*.pine`** — the scripts actually run on
TradingView — with comments stripped, and carries a saturation guard that
reports INCONCLUSIVE rather than publishing another zero.

| signal | uncovered, used by corpus |
|---|---|
| weak (name appears anywhere in a fixture) | 3 |
| **authoritative (name CALLED in a probe)** | **29** |

**The real queue, most-used first:** `abs` 95 scripts · `nz` 94 · `atr` 73 ·
`change` 72 · `ema` 65 · `sum` 40 · `pow` 36 · `sqrt` 33 · `rsi` 32 ·
`stdev` 27 · `wma` 23 · `rma` 21 · `sign` 21 · `exp` 19 · `hma` 17 ·
`highestbars` 11 · `lowestbars` 11 · then a tail of ≤7.

**Deliverables:**
- ✅ **Wave-1 probe written and self-checked** —
  `tools/visual_conformance/probes/p1-top-unmeasured.pine` covers `nz`, `abs`,
  `change`, `ema`, `rma`, `atr`, `stdev`, `sum` in one run. Every reading
  discriminates between competing implementations (the EMA/RMA **seed**, `nz`'s
  argument order, `abs(na)`, `change` on bar 0, population-vs-sample `stdev`)
  and it carries an identity control (`ta.atr(5)` must equal
  `ta.rma(ta.tr(true), 5)`). **Both lanes translate it**, so every reading is
  one both sides can produce.
  ⛔ **Needs one human-in-the-loop TradingView session.** The seeding questions
  are answered in the FIRST ~20 BARS and nowhere else.
- Wave-2 probe for the composites (`rsi`, `macd`, `stoch`, `cci`, `hma`, `wma`,
  `percentrank`, `mfi`, `atan`, `avwap`) — deliberately AFTER wave 1, because
  each depends on the seeding answers and measuring them first produces
  readings nobody can attribute.
- A per-fixture manifest naming which function each existing capture measures,
  so the weak signal can be retired.
- A public "parity ledger" in `/formulas/reference`.

⭐ **The self-check pays for itself before the session is spent.** Running the
wave-1 probe through our own translator first found `ta.variance` is not
declared by this engine — a capture of it would have yielded a vendor number
with nothing to compare against.


**Cost:** far lower than the ~40 hours originally estimated here. One capture
session covers 8 names; the tail is ~3-4 more sessions.


**Ordering:** highest corpus demand first. The corpus census
(`runtimeCorpusCensus.measure.test.js`) surfaces this ordering, and
`pineDemandCensus.measure.test.js` orders it by NAME.

⛔⛔ **BUT A CENSUS ROW IS A TOKEN, NOT A CAPABILITY — READ THE CALL SITES BEFORE
SIZING ONE.** Measured 2026-09-21: the demand census's second row is
`16  [  runtime:history-expression,pine:builtin,…`, which reads as "the history
operator blocks 16 scripts". It is not. **Fifteen of those sixteen call sites
are TUPLE DESTRUCTURING** (`[a, b, c] = f(…)`) and exactly one is a history
read. One token, two unrelated jobs, and the larger of the two is invisible in
the table. A lane was opened against the wrong one before anyone opened the
scripts.

**Runs independently of every other phase.** Its output is fixtures — no new
capability — so it can't break anything.

---

## Phase 2 — Close the named-vocabulary gaps (~1-2 weeks with 3-agent waves)

⛔⛔ **Re-read the measured block at the top of this file before working this
phase.** This table is the RUNTIME lane; clearing it is not yet shown to move
what a member sees.

The runtime lane's first-blocker table (fresh at `17192d37d`, 2026-09-21):

| n | guard | disposition |
|---|---|---|
| 47 | `runtime:declaration` | strategies — see Phase 3 carve-out |
| 23 | `pine:character` | UDT/OOP — Phase 3 |
| 20 | `pine:builtin` | **this phase — one at a time, 3-agent waves** |
| 18 | `pine:undefined` | Phase 4 (loop vars in the columnar lane / user fns) |
| 17 | `runtime:statement` | Phase 4 |
| 15 each | `runtime:expression-statement` · `runtime:call-undeclared-builtin-state` · `pine:function` | Phase 4 |
| 12 | `runtime:udt` | Phase 3 |
| 11 | `pine:block` | Phase 4 (deeper block scoping) |
| 8 each | `runtime:array` · `runtime:object-op` | This phase (partial) |
| 6 | `pine:request` | Phase 5 |

**Deliverables per capability (following today's `table.clear` / `text_formatting`
pattern):**
1. Measure demand: how many corpus scripts + call sites.
2. Write RED test with a control that must go green independently.
3. Read vendor capture (from Phase 1).
4. Implement across whichever layers apply (reader → converter → program →
   runtime → renderer).
5. Mutation-proof each layer's fix (revert it, assert red, restore).
6. 0-NEW-failures set-difference against pristine HEAD on the engine suite.
7. Ship behind existing flags; local demo the target script; screenshot diff.
8. Update `runtimeCorpusCensus` — number moves.

**3-agent parallelisation model:**
- Agent A: next `pine:builtin` capability
- Agent B: next `runtime:array` or `runtime:object-op` capability
- Agent C: Vendor Parity capture batch
- Integrator: gate each branch, merge, re-measure census.

**Expected corpus movement:** 8/266 today → **20-30/266** by end of Phase 2.

---

## Phase 3 — Pine's OOP system (`type`, `method`, chained calls) + strategy decision (~4-6 weeks)

Two parallel design tracks that can't be shortcut.

### 3a. OOP: `type` + `method` + chained method-call syntax

Unblocks `pine:character` (23), most of `runtime:udt` (12), and half of `pine:tuple`.

Real language work:
- Lexer: `.` after `)` is currently rejected. Chain member access after any
  expression, not just an identifier.
- Parser: `type Name` declaration with fields; `method` block with `this` and
  overload resolution; `NewType.new()` constructor synthesis.
- Resolver: symbol table gains type + method bindings. Field access on
  arbitrary expressions.
- Runtime: object model (heap of typed instances with per-instance fields).
  Method dispatch. GC or reference-tracking.

**Cannot be shortcut with more agents.** A parser/resolver/runtime redesign
has a critical path that is design-then-implement. Design pass alone: ~1 week
solo work + review. Implementation: 3-agent-parallel-friendly (different
files, one agent per layer once the design is fixed).

Deliverable: any corpus script that declares a `type` and reads a field via
`x.f` or a method via `x.m(y)` runs end-to-end.

### 3b. Strategy decision (`strategy()` — **25 of 266 scripts, 9.4%** — RULED 2026-09-23)

Owner ruling to date: **out of scope by design.** Confirm or reverse:

- **Confirm out-of-scope:** the census records 25 refused with `runtime:declaration`
  as a permanent count. `/formulas/reference` names this policy publicly. Full
  parity claim is asterisked: "indicators, not strategies."

- **Reverse:** ~2-3 additional months. Requires a backtester, position sizing
  primitives, portfolio state, `strategy.entry`/`strategy.exit`/`strategy.close`,
  P&L tracking, alert generation from strategy events. Belongs at Phase 4 or 5.

**Recommendation: confirm out-of-scope until every indicator draws identically.**
Strategies are a distinct product surface (a backtester is a whole feature),
and mixing them into "does this draw" delays the drawing-parity goal by
months for a feature nobody has yet asked for by name.

---

## Phase 4 — General user functions (per-call-site body lowering) (~4-6 weeks)

Unblocks `pine:function` (15), most of `pine:undefined` (18), and
`runtime:statement` (17). Combined with Phase 3, gets to ~35-45% corpus
coverage.

Today the runtime lane can lower ONE user-function body inline per call site
under narrow conditions. Real Pine has:
- Multi-return tuple functions (`[a, b] = f(x)`).
- User-defined function overloading.
- Recursive user functions with a bounded depth guard.
- Functions closing over enclosing-scope variables (`simple`, `series`, `input`
  qualifiers).
- Functions returning UDT instances (needs Phase 3).

Design pass: ~1 week. Implementation: 3-agent parallel across
overload/tuple/recursion/closure tracks.

Deliverable: per-call-site inlining that respects Pine's own scoping and
qualifier rules, with a test corpus of at least 20 real user-function idioms.

---

## Phase 5 — General `request.security` + a bars orchestrator (~4-6 weeks)

Today: fixed-point symbol discovery on ONE call site under narrow conditions.
Enough for the RVOL+ATR dashboard (verified today) but not for the general case.

Real Pine:
- Arbitrary expression as the `expression` argument (any tree, not just tuples
  of named columns).
- Arbitrary `symbol` (an expression, not a literal — enables cross-market and
  watchlist-driven scripts).
- Arbitrary `timeframe` (an expression — enables MTF logic).
- `lookahead`, `gaps`, `calc_bars_count` semantics honored properly (today
  `calc_bars_count` is accepted-and-inert; see resume doc item 2).
- Nested `request.security` (a script that reads another script that reads
  another security).

**Backend subsystem that doesn't exist today:** bars for arbitrary symbol at
arbitrary TF on demand, cached, budgeted per-request to avoid fanning out to
Massive/yfinance for every combination. This is where cross-market indicators
live.

**Cost:** ~2 weeks backend orchestrator + ~2 weeks frontend integration + ~1
week vendor parity validation.

---

## Phase 6 — Renderer parity (~2-4 weeks)

`docs/pine/lwc5-capability-map.md` is the reference. Concrete items owed:
- Six-argument gradient `fill()` (last blocker on RVOL script 2).
- `linefill` in general.
- Polylines (`polyline.new`).
- Chained box/label setters (needs Phase 3's chained syntax first).
- `syminfo.mintick` — needs per-symbol tick sizes exposed from the backend.
- `text.format_bold + text.format_italic` combined (today refused; measured).
- `text.format_bold` on `label.new(text_formatting=...)` (today only on `table.cell`).
- Custom canvas layer where LightweightCharts primitives don't cover it.

Parallelises well: one renderer feature per agent.

---

## Phase 7 — Language surface tail + libraries (continuous)

- `switch` statement.
- `for x in collection` (Pine 5+ for-in).
- `while` loops (currently refused).
- `for ... by <step>` loops.
- `enum` declarations.
- Tuples in every position.
- **`import` from Pine libraries** (`pine:module`, 23/266 scripts). This is
  infrastructure work: Pine libraries can be public or private/paid; the
  registry, resolution, and licensing story are all real subsystems.
- Multi-line string literals, indented string continuations.
- Pine v7 when it lands.

Each item independently addable; no cross-phase blocking.

---

## Vendor parity discipline — applies to every phase after 0

Every capability that closes a bug or adds a feature ships with:
1. **A vendor capture** (Phase 1's harness) — a fixture file the fix's test
   reads from, and asserts equal-to.
2. **A local paste-and-draw demo** — a screenshot of the target script drawing
   on `/charts`, compared to a screenshot of the same script on TradingView at
   the same symbol/TF.
3. **A corpus census delta** — `runtimeCorpusCensus` re-run before and after,
   the number and the moved-script list recorded in the commit.
4. **Mutation proof** — each fix revertable, assert red on revert.
5. **0 NEW failures** by set-difference against pristine HEAD.

**This is what makes "identical to TradingView" a measurement rather than a
claim.**

### ⛔⛔ 6. AND A CAPTURE WITH NO READER IS NOT EVIDENCE — it is a file

**Cross-referencing every fixture in `tests/fixtures/vendor/` against every
`app/src/**`, `tools/**`, `scripts/**` and `api/**` file on 2026-09-22:
13 of 35 captures were read by NOTHING.** Measurements that were paid for,
several of which needed a live TradingView session, settling questions nobody
could then get wrong for free — sitting unread on disk.

⚰️ **THE COST IS NOT THE CAPTURE. IT IS THE DECISION THAT WAITS ON IT.** Two
items sat on this programme's own open list as owner rulings still owed, and
both had been answered on disk since 2026-09-11:

| listed as owed | actually answered in |
|---|---|
| `math.round`'s half-rule ("blocked on the TradingView session") | `groupb-readings-spy-1d-2026-09-11.json` |
| `time(<timeframe>)` semantics | `r11-time-tf-spy-1d-2026-09-11.json` + `r11-time-session-spy-5m-2026-09-11.json` |

⭐ **A capture is pinned the day it lands, or it does not count.** Four of the
thirteen now have readers (`313bc122e`, `ff2e1f138`). A pin asserts what the
vendor said AND what we do today — including asserting that a GAP still
REFUSES, because "we do not serve this" and "we serve it wrongly" are different
facts and only the first is shippable.

⛔⛔ **AND ONE CAPTURE SAYS A NAME MUST NEVER BE BUILT.** Bare `alma` does not
exist in Pine v6 — TradingView refuses it, so our `pine:function` refusal is
CORRECT and adding the name would make this engine accept a script the vendor
rejects. **That is a divergence in the one direction nothing here measures:**
every instrument in this programme counts scripts we refuse that the vendor
accepts, and none counts the reverse. It would have looked like progress on the
demand census.

---

## The 1-week aggressive-parallelism sprint

If we start Monday, here's what to actually do. This is compressed and
demanding but realistic; it takes us from 3% corpus coverage to something in
the 20-30% range and lands the tooling that makes Phase 3-7 tractable.

### Day 1 — Foundation, all hands
- **Agent A**: extend `tools/pine_vendor_capture.py` to a semi-automated
  harness. Deliverable: give it a function name, get back a canonical fixture.
- **Agent B**: extend `runtimeCorpusCensus.measure.test.js` to also count
  per-function occurrences across the corpus + output the top-25 undeclared or
  under-supported names. Priorities the rest of the sprint.
- **Agent C**: enumerate 15 target indicators by name. Real scripts the owner
  wants working. Paste each into the local pane, measure current gap
  (compiles? draws? draws identically?). Output: 15 rows × 4 columns.
- **Integrator**: read the outputs, publish the day-1 census + the target list
  + the harness state.

### Day 2 — Vocabulary sweep, wave 1
- **Agent A**: highest-demand `pine:builtin` blocker (probably `str.format` or
  a `ta.*` or `math.*`). Full cycle: RED → vendor capture → implement → GREEN
  → mutation-proof → 0-new-failures → local demo.
- **Agent B**: second-highest.
- **Agent C**: continue vendor captures (target 15/day).
- **Integrator**: gate + merge agent branches, re-measure census.

### Day 3 — Vocabulary sweep, wave 2
- Repeat Day 2 with the next three. Target: 6 new capabilities landed by
  end-of-day-3, census moves ~5-10 scripts.

### Day 4 — Renderer parity, wave 1
- **Agent A**: gradient `fill()` (unblocks RVOL script 2, which is the second
  half of the acceptance dashboard duo).
- **Agent B**: `linefill` in general.
- **Agent C**: continue vendor captures.
- **Integrator**: paste-and-draw demos of scripts touched by A and B.

### Day 5 — Design pass for Phase 3 (OOP), all hands but SERIAL
- Whole day is design. No implementation on OOP yet — get the design right.
- Output: `docs/pine/oop-design.md` covering lexer, parser, resolver, runtime
  object model. Ratified by end of day.
- **Agent C** continues vendor captures in parallel.
- **Integrator** reviews the design, writes the test plan.

### Day 6 — OOP implementation, wave 1
- **Agent A**: lexer + parser for `type Name` declarations.
- **Agent B**: chained method-call syntax (`.` after `)`).
- **Agent C**: `method` block declaration and dispatch.
- **Integrator**: integration testing, one small real corpus script that uses
  each feature.

### Day 7 — OOP finish + measure
- **Agent A**: field access resolution + runtime object model.
- **Agent B**: method resolution end-to-end.
- **Agent C**: reference tests + fixture regression.
- **Integrator**: full corpus census; write a report of what compiles now that
  didn't on Monday.

**Expected end-of-week outcome:** ~15-20 real indicators drawing identically to
TradingView (verified by screenshot diff), corpus coverage from 3% to
~20-30%, vendor parity ledger at ~30-40% of `closedTable.json`, OOP working
for simple `type`/`method` idioms (not yet the full recursive UDT surface).

**Explicitly not done in this week:** Phase 4 (general user functions), Phase 5
(bars orchestrator), full Phase 6 (renderer polish beyond gradient/linefill),
`import` from libraries. Those are the second week + weeks 3-4.

---

## Working rules for the multi-agent programme

Non-negotiable. Every one of these is here because CLAUDE.md records the
specific failure that made it a rule.

1. **Max 3 concurrent agents plus the integrator.** Any deviation is stated in
   the next checkpoint, never hidden.
2. **Every agent commits at every green checkpoint** and pushes its branch.
3. **The integrator gates every agent's branch in its own session** — an
   agent's "done" without an integrator gate is not done.
4. **Scoped pytest only, chunked frontend tests** — full suite OOMs the box.
5. **STT/whisper jobs run alone** — never beside a test run or Batch collector.
6. **Never `git checkout <file>` to undo** — write back captured bytes and
   verify sha256.
7. **Never `git stash`** — the stack is shared with other worktrees; use a
   temp WIP commit or `stash push -u -m <uid>` with sha capture.
8. **Every capability ships with the five-piece verification bundle above**
   (vendor capture, local demo, census delta, mutation proof, 0 NEW failures).
9. **Never a production push during the week** — everything stays behind the
   local flags. The pane goes live to members ONLY after the target list is
   ticking off names identically.

---

## The D2 flip decision — orthogonal to this whole plan

Ruling D2 keeps the member pane on the HOST lane's saved definition today; the
runtime lane serves no members. All of the above improves the runtime lane.

**Nothing in this plan flips D2.** The plan builds the parity; the D2 flip
turns parity into member value. Two different decisions.

The pane can be opened to members in stages:
- Stage 1: admin-only (`role === 'admin'` on the flag reader).
- Stage 2: opt-in per-member preference (Settings → Beta features).
- Stage 3: default-on for paid tier.
- Stage 4: default-on for all.

Recommend: hold every stage past 1 until Phase 3 lands. A member seeing "half
my script works" is a worse product than one that says "not yet."
