# Capture queue: U-BUILTIN (built-in names), 2026-11-19

Filed for coordinator patrick-2b by the builtins engine unit (U-BUILTIN, `docs/pine/PARITY-ROADMAP-2026-11-18.md`
section 5; branch `feat/pine-builtins-unit`). Every probe runs with its inputs at their defaults. A line that does
not compile is a reading: record the error text and the line, remove only that row, and capture the rest.
Captures are read after the close.

**Q-BI-TD1 runs first** (coordinator, 2026-11-19): it decides what the `time("D")` fix may draw on members'
extended-hours and 24-hour charts, where the anchor is refused by name until it grades.

Probe sha256 (first 16 hex) is listed with each row's probe in `tools/visual_conformance/probes/`.

## TD: where the day starts for `time("D")` on a chart with extended-hours or 24-hour bars

Graded so far (`vw-bt-time-1440-spy-{1d,60}-2026-11-16`, rows R1-R6, regular-hours bars only): `time("D")` is
the 09:30 open of the bar's session on 1D and on RTH 60m bars, and `time("D", "0930-1600")` on RTH 60m bars is
that open inside the window. Our engine drew midnight New York for the anchor (R5/R6: -34,200 s on every bar of
both charts) and `na` for `time("D", "0930-1600")` on the 60m chart (R2). A midnight anchor and a session-open
anchor put the new day on the SAME bar on a regular-hours chart; on a chart with pre-market, after-hours or
overnight bars they do not, and nothing measured says which bar TradingView's new day falls on. Nine
member-served sample scripts detect a new day through `time("D")` / `time(tf)` (`ta.change(time("D"))`,
`t != t[1]`): fair-value-gap, high-low-open-mid-ranges, pa-zigzag-fibonacci-fan,
zigzag-multi-time-frame-with-fibonacci-retracement, session-hilo, fib-pivot-points-alerts, inside-bar-setup,
multi-timeframe-vwap-v5, orb.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-BI-TD1a | `vw-bi-time-d-extended.pine` (00126794df48342b) | AMEX:SPY 5, EXTENDED HOURS ON, >= 2,000 bars (10+ sessions) | no | every row on every bar | the `time("D")` anchor, `ta.change(time("D"))`, `timeframe.change("D")` and `time("D", sess)` on extended-hours 5m bars |
| Q-BI-TD1b | the same | AMEX:SPY 60, EXTENDED HOURS ON, >= 400 bars | no | the same | the same on 60m |
| Q-BI-TD1c | the same | AMEX:SPY 60, EXTENDED HOURS OFF, >= 400 bars | no | the same (S3: a window that starts after the open) | `time("D", "1000-1100")` on regular-hours bars: the window's start or the day's open |
| Q-BI-TD1d | the same | BITSTAMP:BTCUSD 60, >= 400 bars | no | the same | the anchor on a 24-hour symbol whose exchange zone is UTC |

## The built-in names whose behaviour the reference does not state

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-BI-DMI-a | `vw-bi-dmi.pine` (dda48b492c7ef6e8) | AMEX:SPY 1D from the listing | no | every row on every bar | `ta.dmi(diLength, adxSmoothing)` with unequal periods, and `ta.dmi` on the runtime lane: reference:supertrendrange-by-dgt (sole), 3 more scripts (any) |
| Q-BI-DMI-b | the same | NYSE:RDDT 1D from the listing | no | the same | the same, on a second symbol |
| Q-BI-WOY | `vw-bi-weekofyear.pine` (0b70ae84fec26f26) | AMEX:SPY 1D from the listing | no | every row on every bar (30+ year boundaries) | `weekofyear` and `weekofyear(t[, tz])`: committed:previous-day-high-and-low-separators-dailyweekly (with Q-BI-PPL) |
| Q-BI-PPL-a | `vw-bi-pivot-point-levels-a.pine` (df47733eeb686e18) | AMEX:SPY 1D from the listing | no | every level of Traditional, Fibonacci, Woodie on every bar | `ta.pivot_point_levels`: committed:previous-day-high-and-low-separators-dailyweekly (with Q-BI-WOY) |
| Q-BI-PPL-b | `vw-bi-pivot-point-levels-b.pine` (c87c27edaaca5814) | AMEX:SPY 1D from the listing | no | every level of Classic, DM, Camarilla on every bar | the other three types |
| Q-BI-PPL-c | both PPL probes | NYSE:RDDT 1D from the listing | no | the same | the same, on a second symbol |
| Q-BI-COR4 | `vw-bi-correlation-v4.pine` (93a2dc928e98bd57) | AMEX:SPY 1D from the listing | no | every row on every bar | v4 `correlation` over runtime state (committed:correlation-matrix, whose next walls are its requests); its warm-up, zero-variance and na-window edges |
| Q-BI-COR6 | `vw-bi-correlation-v6.pine` (25f9a09da9b97fb6) | AMEX:SPY 1D from the listing | no | the same | `ta.correlation`, the same edges |
| Q-BI-SFB-a | `vw-bi-session-isfirstbar.pine` (1482b3ed3add675e) | AMEX:SPY 5, EXTENDED HOURS ON, >= 2,000 bars | no | every row on every bar | `session.isfirstbar` / `_regular` / `islastbar` / `_regular` (2 sample scripts, any) |
| Q-BI-SFB-b | the same | AMEX:SPY 5, EXTENDED HOURS OFF | no | the same | the same, regular-hours bars |
| Q-BI-SFB-c | the same | AMEX:SPY 1D, >= 300 bars | no | the same | the same, daily bars |
| Q-BI-SFB-d | the same | BITSTAMP:BTCUSD 60, >= 400 bars | no | the same | the same, a 24-hour symbol |
| Q-BI-TC2-a | `vw-bi-time-close-2arg.pine` (c92a5e08ff8a2afb) | AMEX:SPY 60, extended hours off, >= 400 bars | no | every row on every bar | `time_close(tf, session[, tz])` (2 sample scripts, any) |
| Q-BI-TC2-b | the same | AMEX:SPY 1D, >= 300 bars | no | the same | the same, daily bars |
| Q-BI-STN | `vw-bi-str-tonumber.pine` (5360e5fc15ce646b) | AMEX:SPY 1D, >= 50 bars | no | every row (one value each) | `str.tonumber`'s accepted spellings (1 sample script, any) |
| Q-BI-ASIN | `vw-bi-asin.pine` (c0d0271e39bb0fbd) | AMEX:SPY 1D from the listing | no | every row on every bar | the LAST BIT of `math.asin`, served from the reference sentence as `Math.asin` (as `math.acos` is): A1 against `Math.asin` exactly |
| Q-BI-ASIN4 | `vw-bi-asin-v4.pine` (1166df025c88db59) | AMEX:SPY 1D from the listing | no | the same | the v4 bare `asin` (committed:screener-mean-reversion-channel's `2 * asin(1)`) |

⚠️ **WHAT WAS RECORDED for Q-BI-TC2-a (2026-11-21 audit, #2134):** it asked for extended hours off, and its capture
`vw-bi-time-close-2arg-spy-60-2026-11-19` recorded **EXTENDED hours** (`symbol.session` `0400-2000`). The rig layout
was extended-hours and the batch did not read the session. TC2-a is not answered as asked: the capture shows
`time_close(tf, session)` on extended-hours 60m bars only, and no claim about regular-hours bars may be drawn from it.
(The probe header says "extended hours off". Its bytes are the capture's `source.sha256`, so it is corrected here.)
**The regular-hours re-take (owed), Q-BI-TC2-a-rth:** `vw-bi-time-close-2arg.pine` on AMEX:SPY 60, >= 400 bars, as a
batch row on the regular-hours layout `MyS1vKSg`, with `"session": "regular"` and `"layout": "MyS1vKSg"` (capture id
`vw-bi-time-close-2arg-spy-60-rth-<date>`). TD1c (Q-BI-TD1c) and SFB-b (Q-BI-SFB-b) ask for the regular session
too, and run on the same layout the same way. ⚠️ These are listed here, not as table rows: the queue keys a target by
probe, symbol and timeframe, with no session.

## Not asked here (no capture row)

Nothing below is a row of this queue: each is listed so it is not asked again.

- `chart.left_visible_bar_time` / `chart.right_visible_bar_time` (by-design): TradingView re-runs the whole script whenever the visible window changes; one value per bar cannot be right for every scroll position (`capture-queue-2026-11-16-bt-builtins-time.md`).
- `barstate.isnew` (ruling): `docs/pine/barstate.md`: a per-tick event this engine does not observe.
- `syminfo.type` / `.description` / `.volumetype` / `.prefix` / `.target_price_*` (engine-gap): the symbol store must hold the field first.
- `x * (math.pi / 180)` written by hand (closed): `vw-bt-toradians-spy-1d-2026-11-16` D3 (`math.toradians(x) - x * (math.pi / 180)`) differs from TradingView by one ulp on 8,457 of 8,508 bars: TradingView's `x * (math.pi / 180)` is not IEEE `x * (Math.PI / 180)`. Below display precision; the grader's tolerance governs. `math.toradians` itself grades exact (D1, D2, E1-E3).
