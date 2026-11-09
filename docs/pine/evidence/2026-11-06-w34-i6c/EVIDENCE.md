# W34-I6c v4 per-bar window lengths (`highestbars`/`lowestbars`, then the T8 family): evidence (desktop, 2026-11-06)

Branch `fix/pine-w34-i6c-zigzag-v4`, base `origin/master` @ `4ca464f6e3` (engine 22, W34-I6a landed).
Spec: `docs/pine/W34-I6-SPEC.md` section I6c (`origin/docs/pine-w34-i6-spec` @ `9be8910111`).
Light phase only: implement, targeted vitest (`--maxWorkers=1`), hand mutations. `mutate.py`, measure-pair and
final-tip are the coordinator's. Engine bump (`SCRIPT_ENGINE_VERSION`): **YES, needed** (output-changing for v4
scripts); not edited here.

## The spec premise that did NOT hold, and what was read instead
The spec says "v4's reference types `length` as `integer`". The v4 reference, extracted today with
`tools/pine_survey/pine_reference_extract.js --version 4` (not committed: reference text), says otherwise for the
window family: `highestbars(source, length)`, `length` `allowedTypeIDs: ["series[integer]"]`; the same for
`lowestbars`, `highest`, `lowest`, `sma`, `wma`, `stdev`, `sum`, `dev`, `median` (and `sma` adds "Can be
series[integer]"). Only `ema`, `rma`, `atr`, `hma`, `kc`, `kcw` say a bare `integer`.
https://www.tradingview.com/pine-script-reference/v4/#fun_highestbars
So the v4 serve is cited from the reference, at the same REFERENCE tier as T8's v5/v6 serve, and the new capture
row W4-S1-v4 turns it into VENDOR (and settles bar 0 and the sign, below).

## What changed
- `tools/pine_survey/emit_length_qualifiers.js`: takes `--ref4`; writes a `v4Length` section. v4 spelling:
  `series[integer]` is written `series int`; a bare `integer` names no qualifier and is written `integer`
  (serves nothing). v5/v6 sections are unchanged (`--check` against the v6 extract + a fresh v5 extract: match).
- `app/src/components/chart/engine/ast/windowLengthQualifiers.json`: regenerated (adds `v4Length`, 39 functions).
- `ast/pineRuntimeFrontend.js` `seriesLengthFn`: v4 reads `LENGTH_QUALIFIERS.v4Length` (v3 and below: no section,
  nothing served). Unchanged: never at the object door, never in a request value; ring = declared
  `max_bars_back` (zigzag: 1000) else 5,000; `na` / fractional / <1 / past the ring stops the run by name.
- **The sign (found by the rail, fixed at its one authority).** The runtime lane's `windowTarget` asked
  `PINE_NAMESPACED_TREE` with the bare v4 name `highestbars`, missed, and answered the bare POSITIVE table entry,
  while the translator (`pine.js` Resolver) re-routes a v1-v4 bare `highestbars`/`lowestbars` to
  `ta.highestbars`/`ta.lowestbars` = `-highestbars(...)` (its comment: measured against TradingView). The
  re-route rule is now ONE exported function, `pine.js::pineNamespacedName(name, version)`, called by the Resolver
  (behaviour-neutral refactor of its inline expression) and by `windowTarget`. This also corrects the FIXED-length
  v4 `highestbars(x, 5)` over a runtime variable, which answered the positive distance on master (rail below).
- ⛔ **THE LIVE OBJECT DOOR CHANGES OUTPUT (review N1).** `windowTarget` is not door-gated, so the sign fix
  reaches the member object door too: a v1-v4 bare `highestbars`/`lowestbars` over a runtime series with a FIXED
  length now answers Pine's non-positive offset there, where master answered the positive distance. The object
  door keeps master's answer ONLY for per-bar lengths (`seriesLengthFn` is false at the door). Every C18 diff this
  lane makes must be one of these: a v1-v4 script using bare `highestbars`/`lowestbars`, new value `<= 0`.
- Rails: `runtime/__tests__/w4SeriesLength.test.js` + 21 tests (W34-I6c describe); its v4 control became a v3
  control (v4 now serves); `head(v)` writes `study(...)` for v4 and below. Two older rails pinned the
  per-bar-length refusal in v4 "which has no series length" and are re-pinned at the OBJECT door (which keeps
  master's answer in every version), shape unchanged: `finiteWindow.test.js` ("a length only known while the bar
  runs refuses, and SAYS length"), `pureWindowInFunction.test.js` ("... not a mutable GLOBAL").
- Capture queue: `docs/pine/capture-queue-2026-11-06-w34-i6c.md`, row **W4-S1-v4** (probe text inline).

## Rails (new, W34-I6c describe in `w4SeriesLength.test.js`)
1. the v4 table says `series int` for every served window, `integer` for ema / rma / atr;
2. x10 `v4 <fn>(x, bar_index % 7 + 1)` equals the v4 fixed-length kernel (the pure lane's own v4 `<fn>(close, K)`)
   at each bar: sma, wma, stdev, sum, dev, median, highest, lowest, highestbars, lowestbars;
3. v4 `highestbars(high, len)` / `lowestbars(low, len)` over a PRICE column;
4. the v4 SIGN, fixed length too: bare v4 `highestbars`/`lowestbars` equal the pure lane and are never positive;
5. the varying rail: a per-bar length differs from a once-read length; bar 6 (length 7) answers `-argmax`;
6. the zigzag shape: `len = bar_index - valuewhen(newbar, bar_index, prd - 1) + 1`, `highestbars(high, nz(len, 1))`
   and `lowestbars(low, nz(len, 1))` under `study(..., max_bars_back = 1000)`: both windows dynamic with ring 1000,
   values equal the v4 kernel at each bar's length;
7. a v4 length past the declared `max_bars_back` (10) stops the run by name;
8. a v4 `na` length (no `nz`) stops the run by name;
9. v4 `ema` / `rma` (`integer`) keep their refusal;
10. the live OBJECT door keeps master's answer in v4 FOR A PER-BAR LENGTH (`runtime:history-dynamic-offset`; the
    price-column form refuses too). It does NOT keep master's answer for a fixed-length bare `highestbars` /
    `lowestbars` (v1-v4): there the sign flips to Pine's, see "What changed";
11. the one-argument v4 form `highestbars(length)` keeps `resolve:window`;
12. serving v4 leaves no `runtime:history-dynamic-offset` in the census counters.

## Targeted vitest (node 20.20.2, `--maxWorkers=1`)
- `w4SeriesLength.test.js`: **62 passed** (41 before), with `PINE_V6_REFERENCE` / `PINE_V5_REFERENCE` /
  `PINE_V4_REFERENCE` set, so the generator `--check` rail ran against all three extracts.
- Neighbours (12 files): `legacyBareNamespace`, `pine.hiloDefault`, `pinePhase1Builtins`, `vendorRuledForms`,
  `carriedState`, `dynamicHistoryOffset`, `finiteWindow`, `namespacedTreeInLane`, `pureWindowInFunction`,
  `finiteWindowNa`, `pine.namedargs`, `executionShapeCensus`: 291 passed after the two re-pins (2 red before them,
  both the v4-refusal pins above).
- v4-source rails with this guard family: `w4StateKernels`, `w4TextConstants`, `runtimeRsiHma`,
  `vendorHarness.h4Loops`, `simpleArgWindow`, `w4SimpleFolding`, `constantLengthRefusal`: 154 passed.
- **The coordinator's full run must include `capabilityDemandCensus` and the census/coverage rails**: v4 scripts
  with a per-bar `series[integer]` length now build on the dark runtime lane, so first walls may move.

## Hand mutations (saved bytes rewritten after each; never `git checkout`)
Runner `scratchpad/i6c/handmut.py`, rail `w4SeriesLength.test.js`.

| mutation | result |
|---|---|
| M0 no-op control | 62 passed (control) |
| M1 gate back to v5+ (`pineVersion === 4` serves nothing) | **killed**, 16 red (every v4 serve rail, zigzag, ring, na, census) |
| M2 read the span once at bar 0 (vm: the first length sticks) | **killed**, 44 red (v4 + v5 + v6 reference rails, varying rail) |
| M3 bare v4 name asks the tree unrouted (sign lost) | **killed**, 6 red (sign rail, highestbars/lowestbars rails, zigzag) |
| M5 object door ungated | **killed**, 3 red (v4 + v5 + v6 object-door rails) |
| M4 v4 unqualified `integer` served as `series` | SURVIVED, **equivalent**: no v4 `integer`-length function (ema, rma, atr, hma, kc, kcw) is a finite-window member, so none reaches this path (the same reason T8's M11 survived). The table content is railed directly (rail 1). |

## Refusals kept, by name
- Object door: `runtime:history-dynamic-offset` for every per-bar length, until **W4-S1-v4** MATCHes. (Fixed
  lengths are not refused there and DO change: the v1-v4 bare `highestbars`/`lowestbars` sign fix above.) The zigzag
  script is a drawing (object-door) script, so on the member door it stays refused until that capture; the dark
  runtime lane serves its two walls (`highestbars`/`lowestbars`).
- v4 `ema` / `rma` / `atr` / `hma` / `kc` / `kcw` with a per-bar length: refused (the reference states no `series`).
- v3 and below: refused (no reference section).
- one-argument `highestbars(length)` / `lowestbars(length)` with a per-bar length: `resolve:window`.
- Not stated by the v4 reference, so settled only by W4-S1-v4: what a per-bar length reads on bar 0, and the
  sign of v4 `highestbars` under a per-bar length (served here as the translator's measured v1-v4 re-route).

## mutate.py (heavy-mut.lock, label w34i6c-mut, 73 s) at fb2e39c73e
`_resume-2026-11-01/runs/w34-i6c/muts.json`, log `runs/w34-i6c/mut.log`; rails w4SeriesLength, finiteWindow,
pureWindowInFunction, legacyBareNamespace. M0 no-op control SURVIVED (control). KILLED: M1 gate back to v5+,
M2 span read once at bar 0, M3 bare name unrouted (sign), M5 object door ungated, M6 helper bound <= 99,
M7 helper bound <= 3, M8 v4 reads the v5 table, M9 gate widened to v1-v4 (8/8). M4 (`integer` served as series)
SURVIVED, equivalent (see above; the review agreed independently).

## measure-pair (heavy-mp3.lock, label w34i6c-mp, 1.5 h) tip fb2e39c73e vs base 4ca464f6e3 (pine-dsk-mpbase3, detached)
HEAD checked before/after every side; outputs `_resume-2026-11-01/runs/w34-i6c/mpr/mp0`, `mp1`.

| runtime | C18 corpus audit | C18 probes | vendor harness | census (967) |
|---|---|---|---|---|
| 0 | 0 of 395 differ | 0 of 69 | identical (MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140) | 6 differ |
| 1 | 0 of 395 differ | 0 of 69 | identical (MATCH 112 / DIVERGE 107 / INCONCLUSIVE 117) | 3 differ |

**C18: zero diffs on both runtimes.** No script in the C18 corpus or probes reaches a fixed-length bare v1-v4
`highestbars`/`lowestbars` over a runtime series at the object door, so the N1 sign change has no C18 witness here
(it is railed: "the v4 SIGN ... fixed length too").

Census, intended: `zigzag-multi-time-frame-with-fibonacci-retracement` (v4, the sole target): rt0 `runtime.attached`
false -> true; rt1 `attached` false -> true, peel 2 -> 0. `relative-volume-at-time` (v4; `highest`/`lowest`/`stdev`/
`sma` over a per-bar length): rt1 first runtime wall `runtime:history-dynamic-offset` -> `runtime:request-with-state`.
Census, noise (translator wall-clock budget, listed as noise in W34-D2, W34-I6a, W6-T1/T5/T6; none is v1-v4 nor uses
`highestbars`/`lowestbars`): `ai-supertrend-x-pivot` (v5), `volatility-coil-edge-bullbyte` (v6), `halftrend-bigbeluga`
(v6), `luxy-momentum` (v6), `mirage-liquidity-sweep` (v6) on rt0; `multi-timeframe-trend-indicator` on rt1.

## Merged origin/master 0aeffdc0e9 (clean) and re-ran the rails
w4SeriesLength, finiteWindow, pureWindowInFunction, legacyBareNamespace, dynamicHistoryOffset, namespacedTreeInLane,
pine.hiloDefault: 152/152.
