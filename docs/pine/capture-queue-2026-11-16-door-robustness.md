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
| Q-ROB2 | `vw-rob1-var-string-text.pine` | C03, L02: a `var string` written in a block that runs on some bars only (the latch). Not served by a text template at all today; the capture decides whether carrying it (a text column, or the run) is worth building. C04-C06 are the controls for the shapes that are served |
