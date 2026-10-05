# Capture queue - 2026-10-04 RT11, missing builtins

Branch `pine/rt11-builtins`. Three new probes, never compiled here, for the capture lane (the sole
browser user) to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js`, same
procedure as `docs/pine/capture-queue-2026-09-28.md`:

- `tools/visual_conformance/probes/vw-rt11-builtins.pine` (v6, rows A/T/W/M/N)
- `tools/visual_conformance/probes/vw-rt11-alma-v5-bare.pine` (v5, alone: a compile failure is the reading)
- `tools/visual_conformance/probes/vw-rt11-alma-v3-bare.pine` (v3, alone: same)

## Why

RT11 took the builtins whose semantics a capture already settles (section RT11 of
`vendor-harness/objects-triage-2026-09-28.md`). The names below were measured by substitution to
matter for a corpus script (or sit beside one that does), and NO committed capture or measured
finding settles what TradingView computes. Each stays refused by name until its row is captured.

| # | capture | settles | corpus script it gates (next wall once served, measured by substitution) |
|---|---|---|---|
| Q-RT11a | `vw-rt11-builtins`, AMEX:SPY **1D** and AMEX:SPY **1** (one-minute; the script's own question) | A01-A05: `str.tostring(x)` when `x` is already text is `x` itself | scalping-strategy-with-williams-r-macd-and-sma-1-minute-only: **attaches** (host lane) with `str.tostring(timeframe.period)` served as the identity |
| Q-RT11b | `vw-rt11-alma-v5-bare` and `vw-rt11-alma-v3-bare`, AMEX:SPY 1D, >= 300 bars | whether bare `alma` compiles in v5 / v3 and, if it does, that it is `pine_alma` (A01 vs the served `ta.alma` / Q-H3c reference) | none in the corpus today (both corpus sites are v4, served). Until read, bare `alma` refuses `pine:function` outside v4 |
| Q-RT11c | `vw-rt11-builtins`, AMEX:SPY **1D** and **60** | T01-T07: `time(tf)` for the spellings a script COMPUTES (`"1W"`, `"1D"`, `"1M"`, `"12M"`, `"60"`) and over a timeframe string held in a `var` | volume-profile-auto-line-v2: **attaches** (runtime lane) when `time(periodH)` (a `var` string chosen from `timeframe.*`) is served; the host lane folds only written `"D"`/`"W"`/`"M"`/`"3M"` |
| Q-RT11d | `vw-rt11-builtins`, AMEX:SPY 1D from 1993 | W01-W04: `ta.swma` = the manual's 1/6, 2/6, 2/6, 1/6 weights; warm-up; an `na` in its window | atr-god-strategy-by-tradesmart: NOT a completer (next walls `ta.hma` over state, then a `time(tf, session)` wrapping midnight) |
| Q-RT11e | `vw-rt11-builtins`, same capture | M01-M03 `math.asin` (in and out of domain), N01-N02 `str.tonumber` of a period / a digit string | screener-mean-reversion-channel (`2 * asin(1)`): next wall `pine:text-value`; power-of-3-ict (`str.tonumber(timeframe.period)`): next wall `time(tf, session)` wrapping midnight. Neither completes |

| Q-RT11f | `corpus/committed/order-block-finder__fVSb3j0I87.pine` as written, NYSE:RDDT 1D and AMEX:SPY 1D | the one corpus script RT11's W2 attaches (runtime lane: `tostring(x, '#.##')` over state in a value build); grade with the harness, runtime pane permitted | itself (attached, ungraded; stays behind GT's starter allowlist) |

A runtime or compile error is a reading: record message and row.

## What lands when it is captured

- Q-RT11a A01-A03 all 1: serve `str.tostring(<text>)` as the identity on the host lane (the runtime
  run already prints text as itself, `runtime/text.js::RUN_TEXT_FNS`, which this row also grades).
  Any 0: the identity is wrong and the runtime run's text branch must change with it.
- Q-RT11b compiles and A01 equals `ta.alma`: widen `pine.js`'s `almaSpelling` gate to that version.
  A compile error: the refusal is correct forever; pin it as `refusalsThatMeanOppositeThings` pins v6.
- Q-RT11c T01-T03 all 0 and T06 equals T07 on a 1D chart: `"1W"`/`"1D"`/`"1M"` are spellings of the
  served anchors, and a runtime `time(tf)` over a `var` string may be lowered as the served anchor
  of whichever string the bar holds.
- Q-RT11d W02 0 on every bar: `ta.swma` is a fixed four-tap expansion (a `BUILTIN_CALL_TREE` entry,
  as `alma`); W03/W04 say how `na` and warm-up read.
- Q-RT11e: `math.asin` is IEEE `asin` (out of domain `na`?) and `str.tonumber` of `"D"` is `na`.
