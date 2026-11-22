# Capture queue: a label's geometry (2026-11-17: Q-LB1, Q-LB2, Q-LB3)

A label's text and anchor are graded by the harness, but **where its lines land is not**: the font, the line pitch, the
body's size, the pointer, `style_none`'s and a glyph's text placement are pixels the harness does not compare. These
rows ask TradingView for them. Captures are licence-held and stay local (`%LOCALAPPDATA%/uct-vendor-batch/runs/`); only the
measured NUMBERS enter the repo (`app/src/components/chart/engine/__tests__/__fixtures__/labelGeometry.tradingview.json`).

How they were read: each probe on **NYSE:RDDT 1D** (⚠️ the first version of this doc named NASDAQ:DELL, which is listed on
NYSE; TradingView answered "error in series"), through the rig profile and its scratch layout (add to chart only), with
TradingView's own canvas calls (`fillText`, the body and glyph paths) traced read-only while the study was on the chart.

## The readings

- **Q-LB1** (`vw-lb1-label-multiline.pine`, run lb1rddt2; RS Rating itself captured beside it): at `size.normal` the line
  pitch is 14 px (px + 2) and a label_center / text_outline block is centred on its anchor, each extra line adding one
  pitch to the body. **The pitch question is closed**: the painter's rule matched. It also showed that the single-line
  geometry differed (large font 18 px, a body px + 12 tall, `style_none` above its anchor, glyph text above the glyph),
  which Q-LB2 measured at every size. RS Rating's own pair: the rating's top 19 px below the title's.
- **Q-LB3** (`vw-lb3-box-table-sizes.pine`, run lb3): a box's text and a table cell are 8 / 10 / 14 / 20 / 36 px per size word
  (the engine had 8 / 10 / 12 / 16 / 22), the Pine reference's own points; applied to `TEXT_SIZE_PX`.
- **Q-LB2** (`vw-lb2-label-geometry.pine`, one capture per `Size` input, runs lb2b (pane) and lb2c (price pane)): per size
  word (tiny / small / normal / large / huge): the font is 7.2 / 9.6 / 12 / 18 / 24 px; the pitch 8.2 / 11.6 / 14 / 21 / 28;
  a one-line body 14 / 18 / 24 / 37 / 50 tall, never narrower than 18 / 22 / 29 / 42 / 56; an up / down pointer 5 / 7 / 8 /
  12 / 16 long, a left / right one 4 / 5 / 6 / 9 / 12; `style_none`'s block ENDS at its anchor; `text_outline`'s and a
  body's text is centred (its top 3 / 4 / 5 / 7 / 10 px above the centre); EVERY glyph style's text sits ABOVE the glyph
  (its last line's top 22 / 29 / 37 / 55 / 74 px above the anchor); a circle is 18 / 24 / 30 / 45 / 60 px across, and the
  square, diamond, triangles and flag have measured boxes. The painter (`objectCanvas.js::LABEL_GEOMETRY`, `GLYPH_BOX`) is
  set to these and railed against them (`labelGeometry.test.js`).

| row | probe | what it settles |
|---|---|---|
| Q-LB1 | `vw-lb1-label-multiline.pine` | where TradingView draws each line of a label with `\n`, against its anchor: the line pitch, the block's placement, a body's height and width, left-aligned lines sharing one x, the glyph styles' text side. RS Rating's own pair is drawn first; L07 is a one-line control |
| Q-LB2 | `vw-lb2-label-geometry.pine` | every size word × every label style, one line and two: the font, the pitch, a body's height / width / minimum, the pointer lengths, `style_none`'s and `text_outline`'s placement, each glyph's box and the side and height of its text |
| Q-LB3 | `vw-lb3-box-table-sizes.pine` | the font size of a BOX's text and of a TABLE cell per size word (`TEXT_SIZE_PX`, which was 8 / 10 / 12 / 16 / 22, the engine's own). Labels left that table with Q-LB2 |

## Not capture questions (queue dispositions)

| not a capture | disposition | reason |
|---|---|---|
| Q-LB1 | closed | read (run lb1rddt2, 2026-11-17): the pitch at size.normal is px + 2, as the painter drew it; the rest of the label geometry it showed differing is Q-LB2's, measured and applied |
| Q-LB2 | closed | read (runs lb2b / lb2c, 2026-11-17) at every size, applied to `objectCanvas.js` and railed against the numbers; arrowup / arrowdown / xcross / cross are stroked, not filled, so their glyph boxes were not read and they keep their size (their text's place was read and applied). RS Rating's own dots witnessed separately (run agldots, NYSE:AGL, 'Historical RS New Highs'): label.style_circle at size.tiny, 18.0 px across |
| Q-LB3 | closed | read (run lb3, 2026-11-17, NYSE:RDDT 1D): a box's text and a table cell are 8 / 10 / 14 / 20 / 36 px at tiny / small / normal / large / huge, the same for both, and the Pine reference's own points for those words (`POINT_SIZE_ANCHORS.boxTable`); applied to `TEXT_SIZE_PX` and railed (`boxTableSizes.test.js`). `auto` is not measured and keeps 12 |
