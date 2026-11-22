# Capture queue: 2026-11-16, last-bit agreement of the smoothers

Landing train 1. Same procedure as `docs/pine/capture-queue-2026-09-28.md`; capture from the listing
(NYSE:RDDT 1D and AMEX:SPY 1D), and keep the plotted values as full float64 text.

`ta.rma` is settled: TradingView computes `(prev * (n - 1) + src) / n`, bit for bit on 4,063 of 4,063
values (`docs/pine/evidence/2026-11-16-rma-summation/EVIDENCE.md`), and the engine now computes it that
way in every lane. What that measurement did NOT cover is below. Until it is captured, `ta.ema` keeps
`prev * (1 - k) + src * k` and may be one unit in the last place from TradingView, which only shows where
a printed value sits on a rounding tie (label 437 of `vw-w3n-draw-block-history-c-spy-1d-2026-11-15` was
the `ta.rma` case of exactly that).

| row | probe | what it settles |
|---|---|---|
| E01-E03 | `vw-ema-last-bit.pine` | ta.ema / ta.rsi last-bit agreement: untested. Which order of operations TradingView's `ta.ema` uses at alpha 2 / (n + 1), counted bit for bit at three lengths |
| E04 | `vw-ema-last-bit.pine` | whether a bare `ta.rsi(close, 14)` equals the builtin RSI's own `ta.rma` spelling bit for bit (the builtin is measured, the bare call is not) |
| E07 | `vw-ema-last-bit.pine` | `ta.wma`'s summation order, bit for bit (E05, E06 are the controls: `ta.rma` and `ta.sma`) |
