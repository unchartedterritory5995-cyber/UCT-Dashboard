# Live-capture queue — 2026-09-27 (branch `pine/runtime-walls`)

> ⚠️ **Renamed 2026-09-27 at merge time.** This file was `capture-queue-2026-09-27.md` on
> `pine/runtime-walls`, and the vocabulary wave independently created a *different* document
> at that path. That path now holds the vocabulary wave's queue (its `vw-*` probes); this one
> is the runtime-walls queue (Q1–Q5, the `rtwalls-*` probes).


Semantics the runtime-walls work could not settle from the reference or from a
capture already on disk. Each entry is a probe script under
`tools/visual_conformance/probes/`, what TradingView must show for each possible
answer, what this engine answers today, and the one place in the code that changes
for each outcome. Capture per `docs/pine/capture-procedure.md` (NYSE:RDDT 1D from
listing is the house chart; any daily chart with ties/`na` bars works).

A capture is read ROW BY ROW. Every probe carries an `N01_bar_index_CONTROL` plot so
a study that did not evaluate cannot read as an answer, and a sentinel `-2` where a
bar is not evidence for the question — count only the other rows.

## ✅ ANSWERED — captured 2026-09-27, every capture's source sha-identical to its probe

| Q | TradingView's answer | capture (`tests/fixtures/vendor/harness/`) | runtime lane now |
|---|---|---|---|
| Q1 | pivots: LEFT tie **inclusive**, RIGHT tie **strict** (NYSE:F: right-tie highs and lows fire 0 times, left-tie highs and lows fire every time) | `rtwalls-pivot-ties-f-1d-…`, `rtwalls-pivot-ties-rddt-1d-…` | **unchanged** — ruling R1 below; railed as evidence only |
| Q2 | `x[na]` reads **`x[0]`** (158 of 158 `na` bars carry the current close) | `rtwalls-dyn-history-na-rddt-1d-…` | follows it: `vm.js::dynamicOffset` maps `na` to 0 |
| Q3 | a negative run-time offset **stops the study with a runtime error**; no rows drawn. ⚠️ The error's exact text was not recorded, so none is quoted here. | none (nothing to capture) | follows it: `dynamicOffset` throws a named `VmError`, and the door reports `runtime-door:run` |
| Q4 | the control and the no-`max_bars_back` variant **agree on every bar**; no buffer error | `rtwalls-dyn-history-rddt-1d-…`, `rtwalls-dyn-history-nomaxbars-rddt-1d-…` | already matched; now graded bar by bar |
| Q5 | statistics **skip** `na` (`[1, na, 3]` → max 3, min 1, sum 4, avg 2); `max`/`avg` of an **empty** array are **`na`** | `rtwalls-array-stats-na-rddt-1d-…` | follows it: `collections.js::finiteElements` skips `na`; an empty `max`/`min`/`avg` is `na`. ⛔ An empty `sum` still STOPS by name, because no capture measured it. |

Rail: `app/src/components/chart/engine/__tests__/vendorHarness/runtimeWallsCaptures.test.js`.
It grades every probe title on every bar through `runOurSide(capture, { lane: 'runtime' })`.

⭐ Q2 also needed a ROUTE fix. `close[kn]` with `kn = bar_index % 4 == 0 ? na : 1` reads no
mutable slot, so `needsRuntime` sent it to the columnar lane, which refused
`pine:offset-literal`. `pineRuntimeFrontend.js::offsetIsPerBarSeries` asks the question
`offsetPlan` already asked: does the offset resolve to a constant? Both places use it.
`pine:offset-literal` joined `RUNTIME_FALLBACK_GUARDS` on that script's proof.

⛔ The sections below are kept as written, because they are the predictions the captures were read against.

---

## Q1 — pivot ties: does `ta.pivothigh`/`ta.pivotlow` accept a tie on the RIGHT?

**Probe:** `rtwalls-pivot-ties.pine` (v6, leftbars = rightbars = 2).

**Already pinned (LEFT):** `tests/fixtures/vendor/harness/pivot-point-supertrend-rddt-1d-2026-09-27.json`
needs RDDT bar 474 (high 152.44, equal to bar 473's) to be a pivot high; an independent
re-implementation reproduces all 631 vendor bars ONLY with a left-inclusive rule
(`app/src/components/chart/engine/__tests__/vendorHarness/runtimeLaneCaptures.test.js`).

**What the vendor must show:**
- `N02`/`N03` must read 1 on some bars (the native call fires) — else the capture is void.
- `N04` must read 1 on some bars (the right-tie population exists) — else Q1 is unanswered.
- On every bar where `N04 = 1`: **`N05 = 1` ⇒ right ties are INCLUSIVE; `N05 = 0` ⇒ STRICT.**
- Control: `N07` must read 1 wherever it is not `-2` (the pinned left-inclusive rule).
- `N08`/`N09`: the same two answers for `pivotlow`.

**Today:** strict on BOTH sides (`interpret.js::FN.pivothigh/pivotlow`, `v > w` / `v < w`;
Python twin `api/services/ast_interpret.py::_pivot_col`). The left half is already
known wrong (above). **Open ruling R1** (below).

---

## Q2 — `x[n]` with `n` = `na` at run time

**Probe:** `rtwalls-dyn-history-na.pine`.

**What the vendor must show:** `N02` (and `N03` for a price series) on every 4th bar:
`na` ⇒ matches this engine; a number ⇒ report which bar it read; a runtime error ⇒ the
study shows an error and no rows (record the error text).

**Today:** `na` — `runtime/vm.js` `READ_HIST_SLOT_DYN` (variables, new on this branch)
and `READ_HIST_DYN` (columns, pre-existing). If TradingView answers otherwise, both
opcodes change together.

---

## Q3 — `x[n]` with `n` negative at run time

**Probe:** `rtwalls-dyn-history-neg.pine`.

**What the vendor must show:** `N02` on even bars (`n = -1`): `na` ⇒ matches; a runtime
error ⇒ record it (Pine may reject a negative history reference at run time).

**Today:** `na` — never a bar that has not happened. Same two opcodes as Q2.

---

## Q4 — the history buffer: a run-time offset reaching bar 0 with no `max_bars_back`

**Probe:** `rtwalls-dyn-history-nomaxbars.pine`; control `rtwalls-dyn-history.pine`
(declares `max_bars_back = 5000`).

**What the vendor must show:**
- control `N03` = 1 on every bar, `N04` = `na`, `N02` = `acc − k` (with `na` before bar k),
  `N05` = `4·acc − 6` from bar 3, `N06` = `3·acc − 3` from bar 2 ⇒ the dynamic-history
  semantics of this branch are TradingView's (`runtime/__tests__/dynamicHistory.test.js`
  asserts exactly these numbers on synthetic bars).
- no-max-bars `N02`: 1 on every bar ⇒ matches; a `max_bars_back` runtime error ⇒ TradingView
  refuses where this engine answers. The engine keeps a variable's WHOLE history once it is
  read at a run-time offset (`history[i].dynamic`, sized to the bar count by the VM), so it
  answers the true value; it can never answer a wrong one. If TradingView errors, the
  divergence is "we draw what a correctly-configured script draws" and is to be recorded,
  not "fixed" by adding a failure.

---

## Q5 — `array.max`/`min`/`sum`/`avg` over an `na` element, and over an empty array

**Probe:** `rtwalls-array-stats-na.pine` (array `[1, na, 3]`, and an array that is empty on
every 4th bar).

**What the vendor must show:**
- Control `N06` = 3142 on every bar (the all-finite array: max 3, min 1, sum 4, avg 2) —
  else the capture is void.
- `N02..N05`: **3 / 1 / 4 / 2 ⇒ `na` elements are SKIPPED**; `na` for all four ⇒ an `na`
  PROPAGATES; a runtime error ⇒ record the text. Any other number ⇒ report it as found.
- `N07`/`N08` on bars where `bar_index % 4 == 0` (the array is empty): `na` ⇒ an empty
  array answers `na`; a runtime error ⇒ record it. On the other bars both read 5.

**Today:** the engine STOPS the script by name for both cases
(`runtime/collections.js::finiteElements`, pinned by
`runtime/__tests__/arrayRoster.test.js`). The all-finite case is exact. Once measured, the
change is confined to `finiteElements`: skip ⇒ filter the non-finite elements out (and
decide the all-`na` case from the same capture); propagate ⇒ return `NaN`.

**Why it matters:** wyckoff-accumulation-distribution builds `array.max` over `high[i]` for
`i` up to its length, which holds `na` on the first bars of every chart — with the stop in
place it will not run on a real chart even after its other walls fall.

---

## Open rulings (not this lane's to take)

- **R1 — pivot left-tie on the shared closed-table pivots.** Vendor-pinned (Q1 above).
  Changing `pivotCol`'s left comparison to non-strict moves the host lane, the Python twin
  and the frozen pivot digests (`tests/test_ast_pivots.py` pins 20/15 plateau bars); a
  Pine-only route would be a `pivothighPine`-style table name, the path `pine/atr-seed-host`
  took for `ta.atr`. With it (and that branch's ATR seed), Pivot Point SuperTrend
  reproduces TradingView on all 631 bars — measured by the re-implementation above.
- **R2 — the HOST lane's `?:` over an `na` condition.** The runtime lane now takes the else
  arm (vendor-pinned by the same capture, bar 9). Applying the same rule to the host lane
  (`Resolver` option `pineNaCondition`, one line at each host factory) moved 55 test rows on
  2026-09-27 — persisted trees, the Python screener's frozen columns, the recurrence
  recognisers — so it is queued, not taken. `pineTernaryNa.test.js` pins the host as unchanged.
