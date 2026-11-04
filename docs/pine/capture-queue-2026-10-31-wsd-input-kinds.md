# Capture queue — 2026-10-31 Phase 3 WS-D, input kinds on the runtime lane

Branch `feat/pine-p3-wsd`. The runtime lane (DARK) now takes `input.time`, `input.session`,
`input.timeframe`, `input.symbol`, v4 text `input(…)` and an input default read from a `var`
nothing reassigns (`app/src/components/chart/engine/runtime/runtimeInputs.js`, the binding sites in
`pineRuntimeFrontend.js`). Plan ruling 2 says every capability is witnessed by a capture or an
existing pin. The rules below are implemented from the Pine reference and are **not yet witnessed
on TradingView**. Same capture procedure as `docs/pine/capture-queue-2026-09-28.md` (visibility
gate, **Create new ▸ Indicator**, "Add to chart" binding gate, `__uctVH.capture({...})`, chunks,
`verify_capture.mjs --assemble`). No probe file exists yet for any row; each row names the probe it
needs.

## Already witnessed by an existing capture

`tools/visual_conformance/probes/vw-time-tf.pine` row **T16** (`input.time(timestamp("18 May 2022
00:00 +0000"))` at its default, as days) **MATCHes on all 9 captures the runtime lane now reaches**
(SPY 1D full ×2, 1W ×2, 1M ×2, RDDT 1D, BITSTAMP:BTCUSD 1D, EURUSD 1D), measured by the runtime-on
vendor harness on 2026-10-31. That settles an explicit `+0000` date string at its default. The rows
below are what that capture does not cover.

⚠️ The same probe's T01–T04 and T07–T09 now read **DIVERGE** on the runtime lane (they were
INCONCLUSIVE, because the door refused the probe on `input.time`). They are not input kinds: the
runtime lane draws `na` for `ta.change(time(tf)) != 0 ? 1 : 0` on the first bar(s) where
TradingView draws 0 (reproduced on master with no `input.time` in the script), and draws `na` for
`time("W"/"M"/"3M"/"12M")` on weekend-bar symbols where the host lane withholds
(`time-anchor:weekend-bars`). Handed to WS-B (per-bar clock calls) and the `na`-logic owner.

## Owed

| id | probe (owed) | chart | what it settles | where the rule lives |
|---|---|---|---|---|
| Q-D1 | `vw-input-time-default.pine`: `t = input.time(timestamp("20 Feb 2020"))`, `plot(time >= t ? 1 : 0)` plus the same with `"20 Feb 2020 15:30"` and `"2020-02-20"` | SPY 1D and SPY 15 | a date string with **no zone** is read as GMT+0 (the reference's sentence), not the exchange's zone: the first bar plotting 1 | `runtimeInputs.js::timestampOfDateString`, `zoneMinutes` |
| Q-D2 | the same probe, `"01 Jan 2000 00:00:00 GMT+10"`, plus `"01 Jan 2000 00:00 +530"` and `timestamp("UTC+5:30", 2000, 1, 1, 0, 0)` | SPY 1D | the `GMT+10` suffix form (not RFC 2822; the kNN script's shape) is read as UTC+10; a three-digit `+530` is read as UTC+05:30 (our parser's reading: an hour digit then two minute digits; TradingView's is unmeasured); the explicit-zone `timestamp(timezone, y, m, d, h, mi)` form (served since the WS-D review) reads its zone the same way | `zoneMinutes`; test row marked `⚠️ needs capture` in `runtimeInputKinds.test.js` |
| Q-D3 | `vw-input-time-member.pine`: as Q-D1, then the time changed in TradingView's settings dialog | SPY 1D | the value a member sets is the UNIX-ms instant the dialog shows in the chart's zone; our dialog shows and writes it in **UTC** (labelled so). If TV's dialog reads the exchange zone, our label is right but the default a member *types* differs from TV's by the zone offset | `IndicatorSettingsDialog.jsx` (`datetime` row), `indicatorRegistry.js::timeInputText/timeInputMs` |
| Q-D4 | `vw-input-session.pine`: `s = input.session("0930-1600")`, `plot(not na(time(timeframe.period, s)) ? 1 : 0)` | SPY 15 | the session string reaches `time(tf, session)` unchanged. ⚠️ The **consumer** (`time(…, session)`, a per-bar clock call) is WS-B's, not WS-D's: WS-D only guarantees the text arrives; this capture witnesses both together | `pineRuntimeFrontend.js::admitTextInput` (WS-D); clock calls (WS-B) |
| Q-D5 | `vw-input-v4-options.pine`: `//@version=4`, `m = input("EMA", options=["EMA","SMA"])`, `plot(m == "SMA" ? sma(close, 20) : ema(close, 20))`, captured once at the default and once with SMA picked | SPY 1D | a member's pick on a v4 text input reaches the run (the columnar lane used to fold it from the default) | `runtimeInputs.js::textInputIsMemberSet` |

## Not captures, recorded so nobody files them as owed

- `input.timeframe` and `input.symbol` are **not member settings** in this pane (the timeframe and
  symbol rulings, `TIMEFRAME_SKIP`/`SYMBOL_SKIP`). They run at the author's default only; a script
  that feeds one to `request.security` is still refused by X5 (`request.*`), which is outside Phase 3.
- `input.enum` stays **unserved**: its default is a field of an `enum` declaration, and the runtime
  lane has no `enum` declaration. That is grammar work, not a capture.
- An input default reading a `var` that **is** reassigned stays refused (`runtime:input-state`):
  Pine requires an input's `defval` to be a constant, so TradingView refuses that script at compile
  time too. Only a `var` with exactly one literal write is folded.
- Known limits, by decision (review L3/L4): a date string with a year of 10000 or more is not
  read (the readers take four-digit years), and the settings dialog's date-and-time control has
  minute resolution (`datetime-local`, `step=60`), so an author default with seconds shows
  without them and a member who re-picks the time stores a whole minute.
- `timestamp(year, month, …)` as a time input's default stays refused by name: it reads the
  exchange's time zone, which this pane is not handed.
