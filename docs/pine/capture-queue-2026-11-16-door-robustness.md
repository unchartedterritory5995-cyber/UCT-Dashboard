# Capture queue: 2026-11-16, door robustness (a `var string` in a drawing text)

Same procedure as `docs/pine/capture-queue-2026-09-28.md`; capture from the listing (NYSE:RDDT 1D), and read
each table cell's and label's text from the chart model.

The drawing lane's text reader now reads a `var string` from its writes where that needs no bar-to-bar
memory (`pine.js::stringVarTextOf`): a seed that is text, a write on every bar, a write under a guard that is
the same on every bar of the chart, a write in both branches of an `if / else`. Two shapes are refused by
name (`pine:text-value`) until a capture says what TradingView shows:

| row | probe | what it settles |
|---|---|---|
| Q-ROB1 | `vw-rob1-var-string-text.pine` | C01, C02, L01: the text of a `var string` still holding the `na` it was declared with, in a table cell and in a label (F4's capture pins only a label created with `text = na`). Frees the two cells of `volume-pace-pressure-table` on a daily chart |
| Q-ROB4 | `vw-rob1b-var-string-guards.pine` | G01-G08: the `var string` shapes the drawing lane now SERVES whose only witness today is a licence-held capture (williams-r-rsi-ema-tendance-silver-wong s11, volume-pace-pressure-table s4-prove-drawn, both regraded MATCH locally; CI cannot reproduce them): a write under an input comparison at its default (true and false), sequential blocks over one input, a write under `timeframe.isminutes` on a daily chart (the seed), a write under an input bool, and a cell inside a block that never runs on a daily chart (absent). G05 (`timeframe.isdaily`) is refused as a latch today and settles whether to serve it. This committed capture replaces the licence-held witnesses |
| Q-ROB3 | `vw-rob3-v4-bgcolor-own-alpha.pine` | A1-A3: what a v4 `bgcolor` with no `transp` draws over a colour with its OWN alpha (`color.new(c, 50)`): the alpha, the 90 default, or both. Withheld today by name (`paint:v4-default-transp`); frees relative-strength-index-divergences-libertus's two backgrounds. A4 is the control. ⚠️ The chart MODEL does not settle it alone: the licence-held libertus capture (s11, RDDT 1D 2026-11-15) reads `styleState.transparency` 90 on both background rows AND palette colours at alpha 0.5, so how the two combine on screen needs this probe read with the pixels (or the renderer's composite) beside the model |
| Q-ROB2 | `vw-rob1-var-string-text.pine` | C03, L02: a `var string` written in a block that runs on some bars only (the latch). Not served by a text template at all today; the capture decides whether carrying it (a text column, or the run) is worth building. C04-C06 are the controls for the shapes that are served |
