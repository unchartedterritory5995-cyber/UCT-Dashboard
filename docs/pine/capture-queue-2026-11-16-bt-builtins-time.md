# Capture queue: bt (built-ins and the session clock), 2026-11-16

Branch `feat/pine-coverage-builtins-time`. What this unit serves, and why, is in
`docs/pine/evidence/2026-11-16-bt-builtins-time/EVIDENCE.md`. Each row below is a shape the unit
left refused by name because nothing it holds states or witnesses the answer. Same procedure as
`docs/pine/capture-queue-2026-09-28.md`: inputs at defaults; the owner runs the rig.

## Captures to take

| id | probe | chart | what it settles |
|---|---|---|---|
| Q-BT1 | `tools/visual_conformance/probes/vw-bt-session-overnight-value.pine` | BITSTAMP:BTCUSD 60 and BITSTAMP:BTCUSD 1D | The VALUE of `time(tf, session)` inside a session that wraps midnight. Membership is measured (`vw-w4-session-overnight-btcusd-60-2026-11-16`) and served where a script reads only `na(time(...))`; the value refuses by name ("The VALUE inside a wrapping session is not measured"). V1 = -1800 on every in-session bar means the session-anchored grid continues across midnight (the measured same-day rule, S04/S08), 0 means the bar's own open. Unblocks `sessions` (`is_newbar` reads the value) and every script that stores `t = time(tf, overnight)`. |
| Q-BT2 | `tools/visual_conformance/probes/vw-bt-time-1440.pine` | AMEX:SPY 60 and AMEX:SPY 1D | Whether the timeframe `"1440"` is `"D"` for `time(tf, session)`, `time(tf)` and `timeframe.in_seconds`: R1 = R2, R3 = R4, R5 = R6 on every bar of both charts. Today `"1440"` refuses by name (another timeframe than the chart's own). Unblocks `vp-period` (`time("1440", session.regular)`, where `session.regular` is a second question) and `bb-custom-indicator-tradingview-version` (`time("1440", "0000-0930")`). |
| Q-BT3 | `tools/visual_conformance/probes/vw-bt-toradians.pine` | AMEX:SPY 1D | Which arithmetic `math.toradians` / `math.todegrees` are (the reference says "approximately equivalent"): the D row and the E row that read 0 on every bar. Until then both stay refused by name (`math.toradians` is undeclared). Unblocks `builtin:moon-phases` (its next wall is `pine:block` `for`). |
| Q-BT4 | `tools/visual_conformance/probes/vw-w4-session-default-days-v4.pine` | BITSTAMP:BTCUSD 60 | The v4 default days, read on a symbol with weekend bars: N1 against DOW. SERVED today from the v4 reference and the v4->v5 migration guide ("changed from "23456" (Monday to Friday) to "1234567""); a capture turns that REFERENCE reading into a VENDOR one, and a mismatch means `sessionClockOf`'s v4 branch is wrong. |
| Q-BT5 | `tools/visual_conformance/probes/vw-bt-session-to-midnight-daymask.pine` | BITSTAMP:BTCUSD 60 | Which day's session the hours before midnight of a `"HHMM-0000"` window belong to under a day list that is not every day (`"2000-0000:23456"`): M1 against DOW. Refused by name today ("runs to midnight, and with a day list that is not every day ..."). |

## Still refused by name, and not for want of a capture

| refused | where it refuses | why |
|---|---|---|
| visible bar times | `pine.js::BUILTIN_RULED` (`pine:builtin`) | `chart.left_visible_bar_time` / `chart.right_visible_bar_time`: TradingView re-runs the whole script every time the visible window changes ("Each time the visible window changes, the script re-executes", user manual), and this engine computes an indicator once for its bars. No capture can make one value right for every view. |
| theme colours read as a value | `pine.js::BUILTIN_RULED` (`pine:builtin`) | `chart.bg_color` / `chart.fg_color`: painted with, both are already carried as the chart's theme (engine 58). Read as a value (compared, stored, computed with) they need the member's chart theme inside the computation, which the bind context does not carry. |
| symbol fields not held | `symbolScope.json::unserved` or the namespace sentence (`pine:builtin`) | `syminfo.type`, `syminfo.description`, `syminfo.volumetype`, `syminfo.prefix()`, `syminfo.target_price_*`: data this engine does not hold per symbol (instrument class, long name, volume kind, exchange prefix, analyst targets). Serving one needs the field in the symbol store first, not a TradingView reading. |
| sar, dmi, kc with a computed flag | `_functions_excluded` / `PINE_TUPLE_BUILTINS` (`pine:function`) | Not built in this unit. `ta.sar` keeps its ruling; `ta.dmi`'s tuple is not in `PINE_TUPLE_BUILTINS`; `ta.kc`'s flag must be a literal, and `squeeze-momentum-indicator-lazybear-vx-by-dgt` passes `useTrueRangeS == 'On'`, an input comparison the tuple pre-pass does not fold. |
| legacy correlation over runtime state | `runtime:call-undeclared-builtin-state` | The v4->v5 migration guide renames `correlation(a, b, n)` to `ta.correlation`; the host lane expands it (`BUILTIN_CALL_TREE.correlation`), the runtime lane has no windowed respelling for it (`runtimeRespelling` takes `vwma` / `linreg`). `correlation-matrix`'s next walls are its `security` requests. |

## Not a capture

| not a capture | disposition | reason |
|---|---|---|
| visible bar times | by-design | One value per bar cannot be right for every scroll position; refused by name (above). |
| theme colours read as a value | engine-gap | The chart theme has to reach the computation; a build, not a TradingView reading. |
| symbol fields not held | engine-gap | The symbol store has to hold the field first. |
| sar, dmi, kc with a computed flag | engine-gap | Built-in work for its own unit, each witness-gated. |
| legacy correlation over runtime state | engine-gap | A runtime windowed respelling of `ta.correlation`, then the script's request walls. |
