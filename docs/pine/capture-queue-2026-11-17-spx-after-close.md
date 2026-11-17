# Capture queue: when does TradingView's newest-bar read of SP:SPX switch after the close? (2026-11-17)

Found grading RS Rating after the close of 2026-11-16 (coordinator ruling on #1541). TradingView contradicted itself
on the newest bar within three minutes: `rs-rating-fred6724-pm-alab-1d-2026-11-16` (captured 22:53:14Z) read
`SP:SPX` = 7416.59 there (the SAME session's close; our side reproduces its RS value exactly when it reads that),
while the committed witnesses `rs-spx-daily-pm-rddt-1d-2026-11-16` (22:52:03Z) and
`rs-spx-daily-pm-alab-1d-2026-11-16` (22:55:39Z) read 7561.67 (the PREVIOUS session's close, the witnessed
`previous-session` alignment, `requestWitnesses.json`). The grade now names such a bar INCONCLUSIVE
(`otherSymbolUnsettled`, `compare.mjs::unsettledRecord`). What a member's chart should read on its newest bar after
the close is not settled: our side reads the previous session's SPX close there, as the witnesses do.

The probe is `rs-spx-afterclose.pine`: the SP:SPX witness's reads (`X04_spx_D_close` / `X05_spx_period_close`, as in
`rs-spx-daily.pine`) under their own probe id, so no untimed `rs-spx-daily` capture can answer this; on a stock's daily chart, captured repeatedly on ONE session day: once in the last minutes of the session, then at the
close, +5, +15, +30, +60 and +120 minutes, and once the next morning before the open, each capture's own
`capturedAtUTC` recorded. The question: from what moment (if any) does TradingView read the same session's SPX close
on the newest bar, and does it ever switch back.

| id | probe | chart | question | live |
|---|---|---|---|---|
| Q-SPX-AFTERCLOSE | `rs-spx-afterclose.pine` | NASDAQ:ALAB 1D | the newest bar's `SP:SPX` read at the close and +5, +15, +30, +60, +120 minutes after it, and the next morning: previous session's close or the same session's? | yes |
| Q-SPX-AFTERCLOSE-2 | `rs-spx-afterclose.pine` | NYSE:RDDT 1D | the same schedule on a second listing, the same day (does the switch depend on the chart symbol?) | yes |
