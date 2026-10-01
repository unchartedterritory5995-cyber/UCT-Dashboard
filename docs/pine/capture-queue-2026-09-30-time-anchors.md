# Capture queue — 2026-09-30 C36, `time(<timeframe>)` / `time_close(<timeframe>)` where nothing has been measured

Branch `pine/c36-time-followups`. No new probe: every capture below is an EXISTING probe
(`tools/visual_conformance/probes/vw-time-tf.pine`, `vw-time-close-tf.pine`) on a chart it has not
been run on, for the parent session to run on the live TradingView rig with
`tools/vendor_harness/tv_capture.js` — same procedure as `docs/pine/capture-queue-2026-09-28.md`
(visibility gate, **Create new ▸ Indicator**, "Add to chart" binding gate, `__uctVH.capture({...})`,
chunks, `verify_capture.mjs --assemble`).

The rules these would settle, and the withholdings they would lift, are in
`docs/pine/vendor-harness/objects-triage-2026-09-28.md` § C30 and § C36, and in
`app/src/components/chart/engine/ast/interpret.js` (`periodAnchorMask`, `CHART_CLOCK_WITHHELD`).

## Taken since this queue was first written

| capture | settled |
|---|---|
| `vw-time-tf-bitstamp-btcusd-1d-2026-09-30` (was Q-T1) | the week starts Monday with weekend bars present; the month / quarter / year open on the 1st; the anchor is the period's CALENDAR open even when the chart holds no bar for it; the daily bar's own `time` is 00:00 UTC |
| `vw-time-close-tf-spy-1d-2026-09-30` | `time_close("W" / "M" / "3M" / "12M")` = the close of the period's last session, the forming period its scheduled close — and, on its rows Q08–Q11, the Hurricane Sandy week, where the first-bar rule for `time("W")` is wrong |
| `vw-time-close-tf-bitstamp-btcusd-1d-2026-09-30` | on a symbol that trades every day `time_close(<tf>)` is the NEXT period's open, and bare `time_close` is the next 00:00 UTC |

## What is still withheld or refused, and why

| withheld / refused as | what is unknown |
|---|---|
| `time-anchor:weekend-bars` | a daily chart with a Saturday OR a Sunday bar but not both (an FX week that opens on a Sunday evening): neither the SPY nor the BTCUSD capture's shape |
| `time-anchor:session-open-missing`, `time-close:period-end-missing` | a period that opens, or ends, on a day TradingView's session calendar keeps open and the chart holds no bar for. On a 1D chart that is every holiday before 2000 (the calendar applies no closure there) and 2001-09-11..14; the daily captures start in 2007 (time_close) and 2023 (time), where calendar and bars agree, so which one the vendor answers is unmeasured |
| `time-anchor:not-daily`, `time-close:not-daily` | the periods on any chart that is not 1D (the 60m capture shows a DIFFERENT rule for `time("W")`: the Tuesday 09:30 bar reads −1.0417 days) |
| `time-own:chart-unwitnessed` | `time(timeframe.period)` / `time("60")` on any chart but 1D and 60m |
| `pine:function` (translation) | `time("15")`, `time("30")`, `time("240")`, every other literal; `time_close(timeframe.period)` (witnessed equal to `time_close` on both 1D captures, row Q05 — not served, outside C36's ruling); either form inside a `request.security` |

Two withholdings are NOT waiting on a capture — they are engine work, named in § C36:
`time-anchor:utc-day-clock` / `time-close:weekend-bars` (this chart stamps a daily bar at 09:30 New
York; on a 24×7 symbol the vendor stamps it at 00:00 UTC — an every-day clock), and
`time_close("3M" / "12M")` (measured; the engine resamples only weeks and months).

## Priority order

| # | capture | settles | what it would move |
|---|---|---|---|
| Q-T5 | `vw-time-tf.pine` AND `vw-time-close-tf.pine` on AMEX:SPY **1D with FULL history** (8,4xx bars, back to 1993 — the 2026-09-30 run loaded 4,800) | on a period whose calendar-first / calendar-last session has no daily bar — every holiday week before 2000, and the week of 2001-09-10 — does the vendor answer the calendar (Monday 09:30 / Friday 16:00) or the bars | lifts `session-open-missing` and `period-end-missing` before 2000 — on SPY's 8,473 sessions: 121 / 165 / 414 / 1,497 bars of `time("W" / "M" / "3M" / "12M")` (every bar before 2000 for the year), and 53 / 40 bars of `time_close("W" / "M")` |
| Q-T2 | `vw-time-tf.pine` and `vw-time-close-tf.pine` on an FX pair **1D** (`FX:EURUSD`), ≥ 400 bars | which weekend bars exist, which bar opens the week, and the daily bar's own `time` on a 17:00 New York day | lifts `time-anchor:weekend-bars` for FX, or shows it needs its own key |
| Q-T3 | `vw-time-tf.pine` on AMEX:SPY **5** and **15**, ≥ 300 bars each | `time(timeframe.period)` and `time("60")` on a chart BELOW 60m (`"60"` is then a HIGHER timeframe — the row may stop being `time`) | lifts or re-rules `time-own:chart-unwitnessed` on intraday charts |
| Q-T4 | `vw-time-tf.pine` and `vw-time-close-tf.pine` on AMEX:SPY **1W** and **1M** | the same rows on a chart above daily | `time-own:chart-unwitnessed`, `time-anchor:not-daily`, `time-close:not-daily` on W / M charts |

## Q-T5 — what we must read off it

**Capture:** inputs at defaults, history scrolled back until `requestMoreData` stops growing.

| row, on a bar in … | shipped (withheld) | what each answer means |
|---|---|---|
| T01 / Q08 `time("W") - time`, Tue 1999-01-19 (Mon 01-18 was MLK day) | withheld | −1 ⇒ the calendar's Monday (no closure before 2000): the anchor must come from the session calendar (`tf_live("W", time)` already computes it — it equals the vendor's `time("W")` on 4,800 of 4,800 bars from 2007 and 900 of 900 from 2023, the Sandy week and the first partial week included; `tf_live("M", time)` likewise for the month); 0 ⇒ the first bar, and the pre-2000 withholding can be dropped |
| Q01 `time_close("W") - time`, Thu 1999-04-01 (Good Friday 04-02) | withheld | 1.27 ⇒ the calendar's Friday 16:00, which is what `tf_live("W", timeclose)` answers — drop the `period-end-missing` check; 0.27 ⇒ the last bar's close, and the tree needs the bars, not the calendar, before 2000 |
| the same two rows on Mon 2001-09-10 | withheld | the week TradingView's session keeps open and no bar exists for (09-11..14) |
| T04 / Q11 `time("12M") - time` in 1999 | withheld (the year opens Mon 01-04; Fri 01-01 is a holiday the calendar keeps open) | −3 on 01-04 ⇒ calendar; 0 ⇒ first bar |

## Q-T3 — what we must read off it

| row | shipped reading (withheld) | what flips it |
|---|---|---|
| T05 `time(timeframe.period) - time` | not served on a 5m / 15m chart | 0 on every bar ⇒ add the timeframe to `OWN_TIME_WITNESSED_TF` (both lanes) |
| T06 `time("60") - time` | not served | NOT 0 (the 60m bar's open, e.g. −0.0035 days on the 09:35 bar) ⇒ `"60"` on a lower chart is a real higher-timeframe anchor: it must leave `chartOwnTimeOf` for that chart and be derived like C30's periods |
