# Capture queue: 2026-11-04, W4-T13 plotcandle / plotbar from the run

Branch `feat/pine-w4-t13-candle`. Same procedure as `docs/pine/capture-queue-2026-09-28.md`.
W4-BREAKDOWN names this capture W4-P1 (`vw-w4-plotcandle.pine`, `AMEX:SPY 1D`).

Served today (runtime pane only, behind the runtime lane): a candle or bar whose call WRITES every
colour it takes (`color`, and for a candle `wickcolor` and `bordercolor`), drawn from the run's own
four columns and colour columns; an `na` open (or high, low, close) hides the candle; a colour that
is `na` on a bar hides that part. Withheld by name: a colour the call did not write (TradingView's
default for it is not captured), `show_last`, a `display` other than `all` / `pane`,
`force_overlay = true` over a script that is not an overlay, and v4 candles.

## W4-P1: the candle's colours, defaults and hiding

```pine
//@version=6
indicator("vw-w4-plotcandle", overlay = false)
up = close > open
// C01: all three colours written, an na open on down bars
plotcandle(up ? open : na, high, low, close, "C01_all_written", color = up ? color.green : color.red, wickcolor = color.blue, bordercolor = color.orange)
// C02: only color written (what do the wick and the border draw?)
plotcandle(open + 1, high + 1, low + 1, close + 1, "C02_color_only", color = color.purple)
// C03: no colour written at all
plotcandle(open + 2, high + 2, low + 2, close + 2, "C03_no_colour")
// C04: wick na, border written (the Bollinger-bars idiom)
plotcandle(open + 3, high + 3, low + 3, close + 3, "C04_wick_na", color = color.teal, wickcolor = na, bordercolor = color.teal)
// C05: a colour that is na on some bars only
plotcandle(open + 4, high + 4, low + 4, close + 4, "C05_na_border_some_bars", color = color.gray, wickcolor = color.gray, bordercolor = close > open ? color.red : na)
// B01: plotbar with a colour that changes per bar
plotbar(open - 1, high - 1, low - 1, close - 1, "B01_bar", color = up ? color.lime : color.maroon)
```

| row | what it settles |
|---|---|
| C01 | open / high / low / close, body, wick and border colours per bar; an `na` open hides the whole candle |
| C02 | the wick and border colour when only `color` is written (if they follow the body, the withholding of C02 shapes can be lifted) |
| C03 | the default candle colours when none is written (then the "not written" withholding can be lifted or kept) |
| C04 | an `na` wick colour draws no wick while the body and border draw |
| C05 | a per-bar `na` border colour hides the border on those bars only |
| B01 | a bar's colour per bar; whether it has any wick / border notion |
