# Capture queue: bt (built-ins and the session clock), 2026-11-16

Branch `feat/pine-coverage-builtins-time`. What this unit serves, and why, is in
`docs/pine/evidence/2026-11-16-bt-builtins-time/EVIDENCE.md`. Same procedure as
`docs/pine/capture-queue-2026-09-28.md`: inputs at defaults; the owner runs the rig.

## Captures to take

| id | probe | chart | what it settles |
|---|---|---|---|
| Q-BT1 | `tools/visual_conformance/probes/vw-bt-session-overnight-value.pine` | BITSTAMP:BTCUSD 60 and BITSTAMP:BTCUSD 1D | The VALUE of `time(tf, session)` inside a session that wraps midnight. CAPTURED 2026-11-16 (`vw-bt-session-overnight-value-btcusd-60-2026-11-16`, `vw-bt-session-overnight-value-btcusd-1d-2026-11-16`): V1 = -1800 on every in-session hourly bar, 00:00-02:00 included (the session grid continues across midnight); on 1D the session's start the evening before. Served from it. |
| Q-BT2 | `tools/visual_conformance/probes/vw-bt-time-1440.pine` | AMEX:SPY 60 and AMEX:SPY 1D | Whether the timeframe `"1440"` is `"D"` for `time(tf, session)`, `time(tf)` and `timeframe.in_seconds`: R1 = R2, R3 = R4, R5 = R6 on every bar of both charts. Today `"1440"` refuses by name (another timeframe than the chart's own). Unblocks `vp-period` (`time("1440", session.regular)`, where `session.regular` is a second question) and `bb-custom-indicator-tradingview-version` (`time("1440", "0000-0930")`). |
| Q-BT3 | `tools/visual_conformance/probes/vw-bt-toradians.pine` | AMEX:SPY 1D | Which arithmetic `math.toradians` / `math.todegrees` are (the reference says "approximately equivalent"): the D row and the E row that read 0 on every bar. Until then both stay refused by name (`math.toradians` is undeclared). Unblocks `builtin:moon-phases` (its next wall is `pine:block` `for`). |
| Q-BT4 | `tools/visual_conformance/probes/vw-w4-session-default-days-v4.pine` | BITSTAMP:BTCUSD 60 | The v4 default days. CAPTURED 2026-11-16 as `vw-w4-session-default-days-v4-btcusd-60-2026-11-16`, its three rows re-spelled `timeframe.period` (TradingView's v4 compiler refuses the bare `period`: "Undeclared identifier 'period'"): N1 is Monday to Friday, as the v4 reference and the migration guide state. Served. |
| Q-BT6 | `corpus/committed/session-highs-and-lows-indicator-smc-sessions-dst-safe__c0ca8cf749.pine` | NYSE:RDDT 1D and AMEX:SPY 1D | The script itself, which this unit makes transfer on the runtime-on lane (capability-admitted, and capability admission is ON in production, so permitted members are served it) with NO capture of it on record. Its sessions are wrapping and "to midnight" windows read through `not na(time("", sess, TZ))` (the shapes Q-BT1/Q-BT5 and `vw-w4-session-overnight` witnessed); its labels, lines and session highs/lows are not graded anywhere. A DIVERGE puts it on `api/data/pine_runtime_killlist.json`. |
| Q-BT5 | `tools/visual_conformance/probes/vw-bt-session-to-midnight-daymask.pine` | BITSTAMP:BTCUSD 60 | Which day's session the hours before midnight of `"2000-0000:23456"` belong to. CAPTURED 2026-11-16 (`vw-bt-session-to-midnight-daymask-btcusd-60-2026-11-16`): M1 is 20:00-23:00 of Monday to Friday themselves. Served. |

## Still refused by name, and not for want of a capture

| refused | where it refuses | why |
|---|---|---|
| visible bar times | `pine.js::BUILTIN_RULED` (`pine:builtin`) | `chart.left_visible_bar_time` / `chart.right_visible_bar_time`: TradingView re-runs the whole script every time the visible window changes ("Each time the visible window changes, the script re-executes", user manual), and this engine computes an indicator once for its bars. No capture can make one value right for every view. |
| theme colours read as a value | `pine.js::BUILTIN_RULED` (`pine:builtin`) | `chart.bg_color` / `chart.fg_color`: painted with, both are already carried as the chart's theme (engine 58). Read as a value (compared, stored, computed with) they need the member's chart theme inside the computation, which the bind context does not carry. |
| bare period from v4 on | `pine.js::legacyPeriodRefusal` (`pine:builtin`), every lane | An unbound `period` in a v4+ script: TradingView's v4 compiler, "Undeclared identifier 'period'" (the capture session's reading of Q-BT4); neither the v4 nor the v5 reference holds it. It was read as the chart's timeframe, an over-acceptance. |
| v1-v3 sessions with no day list | `pine.js::sessionClockOf` (`pine:function`) | No reference text for v1-v3 is held (TradingView's reference bundle serves v4-v6 only) and no v1-v3 probe is captured; `trading-session-indicator` and `cm-forex-sessions-highlight-v1` (no version line) wait on it. |
| symbol fields not held | `symbolScope.json::unserved` or the namespace sentence (`pine:builtin`) | `syminfo.type`, `syminfo.description`, `syminfo.volumetype`, `syminfo.prefix()`, `syminfo.target_price_*`: data this engine does not hold per symbol (instrument class, long name, volume kind, exchange prefix, analyst targets). Serving one needs the field in the symbol store first, not a TradingView reading. |
| sar, dmi, kc with a computed flag | `_functions_excluded` / `PINE_TUPLE_BUILTINS` (`pine:function`) | Not built in this unit. `ta.sar` keeps its ruling; `ta.dmi`'s tuple is not in `PINE_TUPLE_BUILTINS`; `ta.kc`'s flag must be a literal, and `squeeze-momentum-indicator-lazybear-vx-by-dgt` passes `useTrueRangeS == 'On'`, an input comparison the tuple pre-pass does not fold. |
| legacy correlation over runtime state | `runtime:call-undeclared-builtin-state` | The v4->v5 migration guide renames `correlation(a, b, n)` to `ta.correlation`; the host lane expands it (`BUILTIN_CALL_TREE.correlation`), the runtime lane has no windowed respelling for it (`runtimeRespelling` takes `vwma` / `linreg`). `correlation-matrix`'s next walls are its `security` requests. |

## Not a capture

| not a capture | disposition | reason |
|---|---|---|
| Q-BT1 | closed | Captured 2026-11-16 and served; graded in `ast/btSessionClock.test.js` once the capture session's data PR puts it in `tests/fixtures/vendor/harness/`. |
| Q-BT4 | closed | Captured 2026-11-16 (re-spelled `timeframe.period`) and served; graded in `ast/btSessionClock.test.js` once the data PR lands. |
| Q-BT5 | closed | Captured 2026-11-16 and served; graded in `ast/btSessionClock.test.js` once the data PR lands. |
| visible bar times | by-design | One value per bar cannot be right for every scroll position; refused by name (above). |
| theme colours read as a value | engine-gap | The chart theme has to reach the computation; a build, not a TradingView reading. |
| bare period from v4 on | closed | TradingView's own compiler answered it (Q-BT4's reading); refused by name. |
| v1-v3 sessions with no day list | engine-gap | A v1-v3 reference text, or a v1-v3 probe, is owed before anything is served; refused by name meanwhile. |
| symbol fields not held | engine-gap | The symbol store has to hold the field first. |
| sar, dmi, kc with a computed flag | engine-gap | Built-in work for its own unit, each witness-gated. |
| legacy correlation over runtime state | engine-gap | A runtime windowed respelling of `ta.correlation`, then the script's request walls. |
