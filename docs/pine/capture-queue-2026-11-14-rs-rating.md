# Capture queue 2026-11-14: RS Rating transfer

Program: `docs/pine/RS-RATING-TRANSFER.md`. Manifest: `docs/pine/rs-rating/capture-manifest.json`
(the `batch_capture.py run --manifest` format). Every row is a VALUE capture
(`capture-procedure.md`), at default inputs, on the scratch layout.

| row | script | symbols / timeframe | settles |
|---|---|---|---|
| Q-RS1 | `docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine` (RS Rating, Fred6724, MPL-2.0, the original source) | NYSE:RDDT 1D, AMEX:SPY 1D, NASDAQ:NVDA 1D | The end-to-end grade. RS line, MAs, labels (the rating text, the new-high dot). The rating number is what TradingView draws today, which may disagree with the script's comments (see L6 in the program). |
| Q-RS2 | `tools/visual_conformance/probes/rs-seed-rsrating.pine` | NYSE:RDDT 1D | The seed witness: TradingView's own `SEED_FRED6725_RS_RATING:RSRATING` values per chart bar, its na pattern and bars-since. Compared against `pine_seed_store`'s replay of the rs-log mirror. |
| Q-RS3 | `tools/visual_conformance/probes/rs-spx-daily.pine` | NYSE:RDDT 1D, AMEX:SPY 1D | `SP:SPX` OHLC as `"D"` and as `timeframe.period`. Compared against FMP `^GSPC` (the index-bars primary). |
| Q-RS4 | `tools/visual_conformance/probes/rs-syminfo-industry.pine` | about 20: RDDT, NVDA, AAPL, MSFT, AMD, TSLA, JPM, XOM, UNH, KO, PLTR, COIN, SPY, QQQ, IWM, XLK, SMH, ARKK, GLD, TLT | `syminfo.industry` / `sector` / `type` text per symbol. This is the witness table for L3 (our classification -> TradingView's string), the ETF case especially. |
| Q-RS5 | `tools/visual_conformance/probes/rs-arm-label-last-bar.pine` (added 2026-11-15, lane L4c) | NYSE:RDDT 1D (from the listing), AMEX:SPY 1D | A01/A02: RS Rating's label shape in one v5 script: `a1 = barstate.islast ? label.new(...) : na` plus `label.delete(a1[1])` leaves ONE label, on the last bar. R01: `label.delete(r1[1])` every bar removes each every-5th-bar label one bar later, and deleting `na` is a no-op. L4c serves these on separate witnesses (Q-RT5a T01/T02, Q-O1a, vw-object-gc-c O1, barstate-full N22); this capture would witness them together. E01 (a label in the ELSE arm) and X01 (a box in the THEN arm) are what L4c still refuses as `runtime:object-op`; their counts would let a later lane serve them. |

Licence: Q-RS1's script is MPL-2.0 (header line 7), so its capture may be committed. Q-RS2..5
are UCT probes.
