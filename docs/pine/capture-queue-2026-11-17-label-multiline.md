# Capture queue: a label's text across `\n` (2026-11-17, fix/pine-label-multiline)

Our painter drew a label's text with one `fillText`, and a canvas ignores `\n`. Labels now break at `\n`
by the box rule this painter already uses for a box's text (`objectCanvas.js::labelLines`):
- line height is the font's px + 2;
- the block sits where the one line sat;
- an empty line keeps its height and paints nothing.

It matters on RS Rating: its rating is `'\n\n       ' + rating`, written to sit two lines below its "RS Rating" label at the same anchor.

**The harness does not grade this.** It grades a label's TEXT and ANCHOR, not where its lines land, so
the line height, the block's placement and the side a glyph's text grows to are this painter's rule,
not a TradingView reading. Capture from the listing (NASDAQ:DELL 1D) with a screenshot of the pane: the
questions are about where the lines are DRAWN, which the label's text and anchor do not show.

| row | probe | what it settles |
|---|---|---|
| Q-LB1 | `vw-lb1-label-multiline.pine` | where TradingView draws each line of a label with `\n`, against its anchor (the probe's grey line): the line height per size, the block's vertical placement for `label_center` / `label_down` / `none` / `text_outline`, a body's height and width, whether left-aligned lines share one x, and for a glyph with text below (`triangleup`) and above (`triangledown`) which line sits nearest the glyph. RS Rating's own pair (the "RS Rating" line and `\n\n       99` in `size.large`) is drawn first; L07 is a one-line control |
