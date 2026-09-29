# Capture queue — 2026-09-28 bool-cast wave

Branch `pine/bool-na-cast` (on `pine/vocab-2` = PR #234). Two probes under
`tools/visual_conformance/probes/`, for the parent session to run on the live TradingView rig
with `tools/vendor_harness/tv_capture.js` — same procedure as
`docs/pine/capture-queue-2026-09-27.md` (visibility gate, **Create new ▸ Indicator**, "Add to
chart" binding gate, `__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`).

The census and the change these probes serve are in `PARITY-PROGRAMME.md` → "2026-09-28 — A
NUMBER IN A BOOL CONTEXT".

## Why these are owed

`pine.js::implicitBoolCast` now reads a numeric operand of `and`/`or`/`not`, a `?:`/`if` test,
an object guard, `iff`'s condition and a condition-role call argument as `x != 0` — `na` false,
`0` false, anything else true — for Pine **v1–v5**. The rule is **documented, not captured**:

- **v5 — documented.** TradingView's v6 migration guide, verbatim: *"In Pine v5, values of
  "int" and "float" types can be implicitly cast to "bool" when an expression or function
  requires a boolean value. In such cases, `na`, `0`, or `0.0` are considered `false`, and any
  other value is considered `true`."*
  (https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/)
- **v1–v4 — inferred.** No published sentence. The v4→v5 migration guide lists no change to
  bool casting, so v4 is given the v5 rule. That is an inference and Q-B2 is what settles it.
- **v6 — unchanged.** *"In v6, scripts must explicitly cast a numeric value to "bool""* — a
  numeric in a bool context does not compile there, so the door has nothing to cast to.

No capture under `tests/fixtures/vendor/` exercises it: searched for `and`/`or`/`not` over a
numeric, `time()` membership used as a condition, and `valuewhen` over a pivot — the only
`time()`-session captures (`vw-time-session-*`, `r11-time-session-*`) plot membership as
`na(t) ? 1 : 0`, which is the explicit form and says nothing about the implicit one.

## Priority order

| # | probe | settles | scripts it confirms |
|---|---|---|---|
| Q-B1 | `vw-bool-cast.pine` (v5) | the documented v5 rule, on every context the door casts | 4 attaching in production (below) |
| Q-B2 | `vw-bool-cast-v4.pine` (v4) | whether v4 carries the same rule (inferred, not published), plus `iff` | `engulfingcandle__0df91dc775` (v4, attaches) |

## Q-B1 — `vw-bool-cast.pine`

**Capture:** AMEX:SPY **1D**, ≥ 200 bars, AND AMEX:SPY **60**, extended hours **OFF**, ≥ 300
bars (B07 needs intraday bars that open at 09:30). Inputs at defaults.

`x` cycles `na → 0.0 → close` on `bar_index % 3`, so each row answers differently under each
candidate reading:

| reading | x = na | x = 0 | x = close |
|---|---|---|---|
| cast (documented, shipped) | false | false | true |
| `not na(x)` | false | **true** | true |
| `na` propagates (the door before this change) | **na** | false | true |

**What we must match, bar for bar** (B09 names each bar's class, B00 is the control):

| row | on a `na` bar | on a `0` bar | on a `close` bar |
|---|---|---|---|
| B01 `x and true ? 1 : 2` | 2 | 2 | 1 |
| B02 `not x ? 1 : 2` | 1 | 1 | 2 |
| B03 `x or false ? 1 : 2` | 2 | 2 | 1 |
| B04 `x ? 1 : 2` | 2 | 2 | 1 |
| B05 `if x` / `else` | 2 | 2 | 1 |
| B06 `ta.valuewhen(x, bar_index, 0)` | the last `close`-class bar | same | this bar |
| B07 `t and not(t[1]) ? 1 : 0` (60m) | 1 on the 09:30 bar of each session, 0 elsewhere — never `na` | | |

If B01–B05 read the `not na(x)` column, the fold becomes `not na(x)` and the zero case in
`pine.implicitBoolCast.test.js` is the line to change; if they read `na`, the cast is wrong
and `implicitBoolCastApplies` goes back to `false`. A compile failure is itself the reading.

## Q-B2 — `vw-bool-cast-v4.pine`

**Capture:** as Q-B1 (1D and 60m RTH). Same rows, plus **B10** `iff(x, 1, 2)` (2 / 2 / 1).
If v4 answers differently from v5 on any row, `implicitBoolCastApplies` narrows to `=== 5`
and `engulfingcandle__0df91dc775` returns to its pre-2026-09-28 warm-up bars.

## Q-V1 — `vw-var-seed.pine` (branch `pine/var-seed-na`)

**Capture:** AMEX:SPY **1D**, ≥ 200 bars, inputs at defaults. One timeframe is enough: every row
is built so that bar 0's answer is carried to every later bar, which is what makes bar 0 — never
observed by any capture on disk — readable on the bars a capture returns.

**Why it is owed.** `pine.js::varSeedOf` now seeds a `var` whose update reads itself through
HISTORY (`x[1]`) with `na`, on the rule that `x[1]` on bar 0 is `na` and does not read the
initializer. That is Pine's history operator and this repo's runtime lane already answers it
(`vm.js` `READ_HIST_SLOT`), but
`tests/fixtures/vendor/runtime/mutable-history-spy-1d-2026-09-08.json` records under
`not_observed` that `x[1] === na` on bar 0 was never seen.

| row | shipped rule | alternative (`x[1]` on bar 0 reads the initializer) |
|---|---|---|
| V01 `var a = 7.0` / `a := bar_index > 1e9 ? close : a[1]` | `na` every bar | 7 every bar |
| V02 same, bare `b` (CONTROL) | 7 every bar | 7 every bar |
| V03 `nz(c[1], 3.0)` | 3 every bar | 7 every bar |
| V04 `d := bar_index % 2 == 1 ? d + 1 : d[1]` (bar 0 takes the `x[1]` arm) | `na` every bar | a count from 7 |
| V05 plain `e = 7.0` / `e := … : e[1]` | `na` every bar | 7 every bar |
| V06 `var f = close` / `f := 0.6 * f - 0.08 * f[2] + 0.48 * close` | `na` every bar | a smoothed close |

If V01/V05 read 7, `varSeedOf` is wrong and the opening-range fix (PARITY-PROGRAMME 2026-09-28)
reverts to drawing the initializer; if V02 does not read 7 the probe itself is broken. V04 and V06
pin the MIXED rule (a bare and an unguarded history read in one update → `na`).
