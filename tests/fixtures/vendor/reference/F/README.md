# Set F — fill() with no transparency, and plot linewidth 1..10

Captured 2026-10-29 from TradingView's own chart. Setup: layout "UCT CLOUDS SETTINGS CAPTURE (disposable)" (`gMYHQ1jg`), AMEX:SPY 1D, light theme (background `rgba(255,255,255,1)`), `devicePixelRatio` 1.
Each script was put in the editor through the Monaco handle, and its sha256 matched the `.pine` here before **Add to chart**. Each one ran alone, in its own pane (`overlay=false`), with plots at constant levels. That way no candle, slope or neighbouring band reaches the sampled pixels. Pixels were read with `getImageData` on the pane's main canvas (canvas 4, 798x259 device px).

## Answers

**Q1, v6 (`//@version=6`): a fill whose colour carries no transparency is drawn OPAQUE. Alpha = 1.0.**
- Pixel evidence:
  - `fill(p1, p2, color=color.red)`: the band interior is exactly `242,54,69` = `#F23645`.
  - `fill(p3, p4, color=#2962FF)`: exactly `41,98,255`.
- TradingView's `filledAreasStyle` stores `#F23645` / `#2962FF` with no transparency field.
- Control: `color.new(color.red, 50)` paints `248,154,162`. Per channel that is alpha 0.538 / 0.502 / 0.500, which is 0.5 as expected. So the pixel method reads alpha correctly.

**Q1, v4 (`//@version=4`): a fill with no `transp` gets transparency 90. Alpha = 0.10.**
- Pixel evidence:
  - `fill(p1, p2, color=color.red)` paints `255,237,237` over white against `#FF5252` (v4's `color.red`). Alpha is (255-237)/(255-82) = 0.104.
  - `fill(p5, p6, color=#2962FF)` paints `233,239,255`. Alpha is 22/214 = 0.103 and 16/157 = 0.102.
- TradingView's `filledAreasStyle` reports `transparency: 90` for both.
- Control: `fill(..., color=color.red, transp=0)` paints exactly `255,82,82`, with `transparency: 0`.
- ⚠️ The default is **90, not 80**.

**Q2, `plot(..., linewidth=N)`, N = 1..10: NOT clamped. The drawn line is N device pixels thick at dpr 1.**
- Measured coverage per N, summed over the cross-section with each pixel's alpha against white. It is identical at x = 150, 300, 450 and 600:

| N | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| px | 1.00 | 2.03 | 3.00 | 4.00 | 5.00 | 6.00 | 7.00 | 8.00 | 9.00 | 10.00 |

- `properties().styles.plot_k.linewidth` reads back 1..10 unchanged.
- Lines are anti-aliased at fractional y: the 1 px line covers two rows partially. Per-row alpha is in `lineWidths[*].rows`.
- Only dpr 1 was measured. A HiDPI display was not available.

## Files

- `f1-fill-v6.*`, `f2-fill-v4.*`, `f3-linewidth-v6.*`
  - `.pine` is the exact source added.
  - `.json` holds: metaInfo (plots, styles, filledAreas), `filledAreasStyle`, the per-plot property styles (linewidth, colour, transparency), the chart background and grid, each level's y, and per-column pixel runs (`startY:runLength@r,g,b,a`).
  - F3's `.json` also has `lineWidths`.
  - `.png` is a sanity crop.
- The colour-int format is unchanged from earlier sets: 0xAABBGGRR, with the high byte as opacity. These scripts use only constant colours, so they emit no colorer plots and the colours live in `filledAreasStyle` / `styles`.
