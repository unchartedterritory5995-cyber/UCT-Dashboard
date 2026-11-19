# Capture queue: parity units output-contract, dynamic-history and builtins (2026-11-18)

Filed for coordinator patrick-2b by the parity2 engine work (U-OUT, U-DYN, U-BUILTIN;
`docs/pine/PARITY-ROADMAP-2026-11-18.md` section 5, design approved 2026-11-18). Probes only: no engine change
rides on this file, and no engine change is built on these rows until their captures are read.

Every probe runs with its inputs at their defaults. A line that does not compile is a reading: record the error
text and the line, remove only that row, and capture the rest. Captures are read after the close.

Probe sha256 (first 16 hex, of the file as committed):
`vw-out-constant-coloured.pine` 5d01fffc9b74c26c, `vw-out-plotcandle-series-colour.pine` 6b2e18f9b17840c6,
`vw-dyn-fractional-length.pine` 00fb419511889fbc, `vw-dyn-fractional-length-v4.pine` d4322af3729ec776,
`vw-dyn-fractional-length-v3.pine` 55279da00715d64c, `vw-dyn-fractional-length-v1.pine` 4274924d6e53f173,
`vw-blt-session-default-days.pine` 3038c4517a26ece2, `vw-blt-session-default-days-v1.pine` 429043c84c6a30de.

## OC1 / OC2: a picture whose meaning is its per-bar colour (U-OUT)

builtin:chop-zone draws a constant column coloured per bar; builtin:bollinger-bars draws the chart's own candles
coloured by its bands. Our host lane refuses both (`pine:constant-only`, `pine:presentation-only`). What
TradingView draws: each row's value AND colour on every bar.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-OUT-1a | `tools/visual_conformance/probes/vw-out-constant-coloured.pine` | NYSE:RDDT 1D | no | every plot's value and colour on every bar | U-OUT OC1: builtin:chop-zone |
| Q-OUT-1b | `tools/visual_conformance/probes/vw-out-constant-coloured.pine` | AMEX:SPY 1D | no | the same | the same, on a second symbol |
| Q-OUT-2a | `tools/visual_conformance/probes/vw-out-plotcandle-series-colour.pine` | NYSE:RDDT 1D | no | P01 / P02 open, high, low, close and the body, wick and border colours on every bar; K01 | U-OUT OC2: builtin:bollinger-bars |
| Q-OUT-2b | `tools/visual_conformance/probes/vw-out-plotcandle-series-colour.pine` | AMEX:SPY 1D | no | the same | the same, on a second symbol |

## DY1: which whole number a fractional length or history offset becomes (U-DYN)

`9 / 2` is 4.5 in Pine; builtin:hull-moving-average passes `length / 2` as a `ta.wma` length,
reference:triangular-hull-moving-average-volatility-bigbeluga `40 / 3`, reference:range-filter-v1 (v3)
`25 / 3 - 1`, and builtin:detrended-price-oscillator reads `close[length / 2 + 1]`. Our lanes refuse each by name
(`pine:window`, `pine:offset-literal`). Each fractional row sits beside its whole-number neighbours: the
neighbour it equals on every bar is the rule (floor, round half up, or round half to even). Taken from the
listing so no warm-up hides a difference.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-DYN-1a | `tools/visual_conformance/probes/vw-dyn-fractional-length.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar | U-DYN DY1 (v6): builtin:hull-moving-average, triangular-hull, builtin:detrended-price-oscillator |
| Q-DYN-1b | `tools/visual_conformance/probes/vw-dyn-fractional-length.pine` | AMEX:SPY 1D | no | the same | the same, on a second symbol |
| Q-DYN-2a | `tools/visual_conformance/probes/vw-dyn-fractional-length-v4.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar | the rule in v4: reference:rsi-cyclic-smoothed |
| Q-DYN-2b | `tools/visual_conformance/probes/vw-dyn-fractional-length-v4.pine` | AMEX:SPY 1D | no | the same | the same, on a second symbol |
| Q-DYN-3a | `tools/visual_conformance/probes/vw-dyn-fractional-length-v3.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar | the rule in v3: reference:range-filter-v1 |
| Q-DYN-3b | `tools/visual_conformance/probes/vw-dyn-fractional-length-v3.pine` | AMEX:SPY 1D | no | the same | the same, on a second symbol |
| Q-DYN-4a | `tools/visual_conformance/probes/vw-dyn-fractional-length-v1.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar | the rule with no pragma (v1): reference:hurst-cycle-channel-clone-lazybear |
| Q-DYN-4b | `tools/visual_conformance/probes/vw-dyn-fractional-length-v1.pine` | AMEX:SPY 1D | no | the same | the same, on a second symbol |

## BI4: `time(period, session)` with no day list (U-BUILTIN)

reference:vp-period (v4), reference:cm-forex-sessions-highlight-v1 and reference:trading-session-indicator (no
pragma) pass a session with no `:days` part; the v4 reference states v4's default days (Monday to Friday), v1 to
v3 state none, so our lanes refuse the call by name. On an equity chart (weekday bars only) each row with no day
list should equal its `:23456` and `:1234567` twins on every bar if the default holds every weekday.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-BLT-1a | `tools/visual_conformance/probes/vw-blt-session-default-days.pine` | AMEX:SPY 30 | no | every plot on every bar (each is 0 or 1) | U-BUILTIN BI4 (v4): reference:vp-period |
| Q-BLT-1b | `tools/visual_conformance/probes/vw-blt-session-default-days.pine` | NYSE:RDDT 30 | no | the same | the same, on a second symbol |
| Q-BLT-2a | `tools/visual_conformance/probes/vw-blt-session-default-days-v1.pine` | AMEX:SPY 30 | no | every plot on every bar (each is 0 or 1) | the rule with no pragma: cm-forex-sessions-highlight-v1, trading-session-indicator |
| Q-BLT-2b | `tools/visual_conformance/probes/vw-blt-session-default-days-v1.pine` | NYSE:RDDT 30 | no | the same | the same, on a second symbol |
