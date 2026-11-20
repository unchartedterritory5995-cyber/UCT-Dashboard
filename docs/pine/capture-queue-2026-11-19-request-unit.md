# Capture queue: 2026-11-19, the `request` engine unit (TF-FOLD, EXT-OWN and what they leave refused)

Branch `feat/eng-request-unit`. For the live TradingView rig with `tools/vendor_harness/tv_capture.js` (procedure as
`docs/pine/capture-queue-2026-09-28.md`). What this unit serves and on which witness is
`docs/pine/evidence/2026-11-19-request-unit/EVIDENCE.md`. The rows below are what it still refuses by name, and the
capture that would settle each. Q-REQ1 to Q-REQ4 stay where they are (`capture-queue-2026-11-16-request-security.md`);
Q-REQ2 stays under the coordinator's 2026-11-16 ruling.

| id | probe / script | chart | question | what the engine does today | what the capture changes |
|---|---|---|---|---|---|
| Q-REQ5 | `vw-req-extended-own.pine` (E03..E06) | NYSE:RDDT 1D and AMEX:SPY 1D from the listing | does the chart's own symbol on the EXTENDED session (`ticker.new(syminfo.prefix, syminfo.ticker, session.extended)`) read the same weekly and monthly series as the regular one, on a daily chart (look-ahead on, `close[1]`)? | the runtime lane serves the extended ticker at the chart's own `"D"` on a daily chart only (Saty ATR Levels' captures); at `"W"` / `"M"` it is refused by name | Saty ATR Levels' Multiday and Swing modes on a daily chart |
| Q-REQ6 | `vw-req-extended-own.pine` (E01, E02, E07..E11) | AMEX:SPY 5 and NYSE:RDDT 5, extended hours ON, at least 10 sessions | on an intraday chart, what does the extended ticker's `"D"` read answer on pre-market, regular and post-market bars (look-ahead off and on), against the regular ticker's? | refused by name on every intraday chart (the extended series has bars the regular one does not) | Saty ATR Levels on an intraday chart, its main use; read with the overnight-bar rule another session is building |
| Q-REQ7 | `vw-req-12m.pine` | AMEX:SPY 1D and NYSE:RDDT 1D from the listing | is a `"12M"` period the calendar year, on which daily bar does a look-ahead read switch, and what are the first (partial) year and the newest bar? | `"12M"` is refused by name on every lane | MTF Key Levels' yearly open (`committed:mtf-key-levels-support-and-resistance`, then its `budget:series` wall), Saty / Ripster Long-term mode |
| Q-REQ8 | `reference:best-rsi-divergences-screener__TmlpugZKr6` | NYSE:RDDT 1D and AMEX:SPY 1D | the script itself, at its defaults (five held US listings read through a helper's parameter) | refused by name (`runtime:request`: a symbol reached only through a helper's parameter) | the evidence a symbol-through-a-parameter read needs before it is served (SYM-PARAM) |
| Q-REQ9 | `reference:best-rsi-divergences-screener-regular-and-hidden__F9uUIwmi9f` | NYSE:RDDT 1D and AMEX:SPY 1D | as Q-REQ8 | as Q-REQ8 | as Q-REQ8 |

## Not capture questions (queue dispositions)

Read by `tools/vendor_harness/evidence_engine.py queue`.

| not a capture | disposition | reason |
|---|---|---|
| Q-REQ-OWNER | ruling | The rest of this unit's sole scripts wait on OWNER data decisions, refused by name, not engine work (coordinator, 2026-11-19): lower-timeframe reads on a daily chart (Q-REQ-LTF: initial-balance-ib, delta-volume-v21, multi-timeframe-trend-indicator, multi-timeframe-rolling-bitmex-liquidation-levels, ripster-rvol-saty-atr-levels) and data we do not hold (Q-REQ-DATA: 4c-nyse-market-breadth-ratio and sub (breadth), chases-buysell (breadth at 5m), global-liquidity-index (economics, FX), my-cme-open-interest (Quandl), earnings-sr-levels (earnings series), bitcoin-futures-funding-rates and swing-points-and-liquidity (crypto, out of scope by owner ruling), banknifty-mcclellan-oscillator (NSE listings)). |
