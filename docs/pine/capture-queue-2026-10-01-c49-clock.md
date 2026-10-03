# Capture queue — 2026-10-01 C49, what the captured clock still leaves unmeasured

Branch `pine/c49-captured-clock`. One new probe
(`tools/visual_conformance/probes/vw-request-htf-alignment.pine`, never compiled) and two existing
ones on charts they have not been run on, for the parent session to run on the live TradingView rig
with `tools/vendor_harness/tv_capture.js` — same procedure as `docs/pine/capture-queue-2026-09-28.md`
(visibility gate, **Create new ▸ Indicator**, "Add to chart" binding gate, `__uctVH.capture({...})`,
chunks, `verify_capture.mjs --assemble`).

What these settle, and the withholdings they would lift, are in
`docs/pine/vendor-harness/objects-triage-2026-09-28.md` § C49 and in
`app/src/components/chart/engine/ast/interpret.js` (`chartClockRegime`, `periodAnchorMask`,
`requestBaseNode`, `CHART_CLOCK_WITHHELD`).

## Priority order

| # | capture | settles | what it would move |
|---|---|---|---|
| Q-R1 | `vw-request-htf-alignment.pine` on AMEX:SPY **1D**, ≥ 400 bars, market CLOSED | a weekly / monthly `request.security` on a daily chart, look-ahead off: does the LAST daily bar of a completed week read that week's close (the rule packet #3 measured one timeframe down) or the week before's (what `tf` answers) | if the rule holds: `tf` is wrong on the last daily bar of every completed week and month for every look-ahead-off request — 1 bar in 5 / 1 in 21 — on the chart timeframe the product serves most |
| Q-R2 | the same probe on AMEX:SPY **1D** during regular hours, newest daily bar FORMING, twice a few minutes apart | the forming daily bar: does look-ahead off read the forming week's current close (packet #3's realtime rule) or the last closed week's | the newest bar of every live daily chart with a weekly / monthly request |
| Q-R3 | the same probe on AMEX:SPY **5** and **60**, regular session, ≥ 2 weeks | a weekly / monthly / 60-minute request from an intraday chart: which close, which bar it switches on | lifts `request:other-timeframe` for W / M once the chart holds daily bars beside its own |
| Q-C1 | `vw-time-tf.pine` on AMEX:SPY **5** with the EXTENDED session on (pre-market and after-hours bars in the series) | on a chart with extended-hours bars: is `time("W")` the regular session's 09:30 or the extended session's 04:00; is `time("60")` bucketed from 09:30 or from 04:00 | lifts `time-clock:outside-session` — the product's intraday charts show extended hours by DEFAULT, so today the periods and `time("60")` are withheld there |
| Q-C2 | `vw-time-close-tf.pine` on AMEX:SPY **15** (or 5 / 60), regular session | `time_close("W" / "M")` below a daily chart | lifts `time-close:not-daily` on 5 / 15 / 60 |
| Q-C3 | `vw-time-tf.pine` on AMEX:SPY **30** and **240** (and **1**) | the same rows on the chart timeframes not yet measured | lifts `time-anchor:not-daily` / `time-own:chart-unwitnessed` there |

Not a capture: **FX and every-day symbols**. `vw-time-tf-fx-eurusd-1d-2026-10-01` measured an FX
daily chart (bars open 17:00 New York Sunday to Thursday; the week opens on the calendar's Sunday
17:00; the month follows the trading day). It stays withheld (`time-anchor:weekend-bars`) because
this chart stamps a date-keyed daily bar at 09:30 New York on its date — 16.5 hours from the
vendor's open — and the store carries no FX bars at all. What settles it is engine work: a daily
bar stamped at its own session's open (the "every-day clock" C36 left for the integrator, widened
to a session per symbol).

Not a capture either: **the two periods from 2000 on whose first / last session has no bar** (the
Hurricane Sandy week for `time("W")`, the week of 2001-09-10 for `time_close("W")`). The calendar
reproduces both and they stay withheld because each is the one witness of its kind; SPY's history
holds no other. A ruling settles them, or a symbol with a missing-session period after 2000.

## Q-R1 / Q-R2 — what we must read off them

| row, on … | shipped | what each answer means |
|---|---|---|
| A02 `close_W_lookahead_OFF` on a Friday of a completed week | the PREVIOUS week's close (`tf`) | equal to that Friday's own close ⇒ packet #3's rule holds one timeframe up: `tf` must read the period a bar COMPLETES; equal to the previous Friday's ⇒ `tf` is right and the rule is intraday-only |
| A02 on Monday..Thursday | the previous week's close | must equal the previous Friday's close either way — the control |
| A01 `close_W_lookahead_ON` on any bar of a completed week | that week's close (`tf_live`) | must equal that week's Friday close — the control for `tf_live` |
| A02 on the FORMING daily bar (Q-R2) | the last closed week's close | equal to A10 (the chart's close) ⇒ the forming bar reads the forming week; `tf` needs a forming-bar arm |
| A06 `close[1]` with look-ahead ON | `tf_live` of `close[1]` | the last CLOSED week's close on every bar of the week, forming bar included — the idiom's whole point |
| A03 | — | must equal A02 on every bar (the default merge is look-ahead off) |

## Q-C1 — what we must read off it

| row | shipped (withheld) | what flips it |
|---|---|---|
| T01 `time("W") - time` on a pre-market bar (Mon 04:00) | withheld whole | 0 ⇒ the week opens at the extended session's first bar; +0.2292 days ⇒ it opens at 09:30 and a pre-market bar reads an open AFTER itself |
| T06 `time("60") - time` on 08:00 / 09:00 / 16:30 bars | withheld whole | the bucket grid outside the regular session |
| T05 | served (the bar's own time) | must be 0 on every bar |
