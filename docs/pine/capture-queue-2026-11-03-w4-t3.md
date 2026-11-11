# Capture queue: 2026-11-03, W4 T3 (session and timeframe text)

Branch `feat/pine-w4-t3-session-text`. Same procedure as `docs/pine/capture-queue-2026-09-28.md`:
visibility gate, **Create new > Indicator**, the "Add to chart" binding gate,
`__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`. Inputs at defaults. The owner
runs the rig; no builder opens TradingView.

W4 T3 lets the runtime lane fold a session or timeframe text that is fixed before bar 0 (a UDF
parameter, `period`, an input at the value in force, two texts joined with `+`, a `var` nothing
reassigns) and hand it to the columnar lane's own vendor-measured session clock
(`pine.js::sessionClockOf`). It adds no new session semantics: every membership rule below is the
one that lane already serves. Each row names a semantic that is served from a documented rule or
refused by name, and what a capture would turn it into.

| row | probe | chart | what it settles | guards | named scripts | gates |
|---|---|---|---|---|---|---|
| W4-T1 | `vw-w4-session-daymask.pine` | `AMEX:SPY 60` and `BITSTAMP:BTCUSD 60` | The day-mask digit map, one digit at a time: digit d selects `dayofweek == d` (1 = Sunday ... 7 = Saturday). Served today from the documented map and the `:23456` / `:1234567` readings in the 2026-09-27 daily-bar capture (S09, S10); digits 1 and 7 and every single-digit mask are UNWITNESSED, because an equity chart has no weekend bar. A MATCH turns REFERENCE into VENDOR; a mismatch means the map in `sessionClockOf` is wrong for both lanes. | `runtime:statement` | `session-hilo`, `trading-session-indicator` | T3 (day masks) |
| W4-T2 | `vw-w4-session-param.pine` | `AMEX:SPY 5` | A session text reached through a UDF parameter, a `+` join, an `input.session` and an unchanged `var` equals the literal, bar for bar (P2..P6 = P1), and `""` as the timeframe is the chart's own. | `runtime:history-dynamic-offset` | `cm-forex-sessions-highlight-v1`, `ict-killzone` | T3 |
| W4-T3a | `vw-w4-session-default-days.pine` | `BITSTAMP:BTCUSD 60` | What a session with NO day list means before Pine v5 (the `-v4` sibling). Refused by name today ("the default days are not the ones measured"); a capture of N1 against DOW settles every v2-v4 script that writes `time(period, "0100-0500")`. | `pine:function` | `ict-killzone`, `kz-boxes`, `cm-forex-sessions-highlight-v1`, `initial-balance-ib-and-previous-day-week-high-low-close` | T3 follow-up (lift the v1-v4 refusal) |
| W4-T3b | `vw-w4-session-overnight.pine` | `BITSTAMP:BTCUSD 60` | An overnight window (`"1800-0200"`, `"2000-0000"`): which hours are members, and which weekday the after-midnight part belongs to under a day mask. Refused by name today; the 2026-09-27 equity capture cannot tell "never" from "20:00 to 24:00". | `pine:function` | `cm-forex-sessions-highlight-v1`, `trading-session-indicator`, `session-hilo` | T3 follow-up (lift the wrap refusal) |
