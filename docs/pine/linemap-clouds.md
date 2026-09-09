# Line map — Uncharted Clouds

What the firm's own **Uncharted Clouds** actually emits, and what our renderer has to produce
for it. Every number below was **read out of a live TradingView chart**, not inferred: see
`tests/fixtures/vendor/reference/{A,B,C,D}/clouds-volume-*.{csv,meta.json}` and the protocol in
`tools/visual_conformance/README.md`.

- **Study id**: `Script$PUB;d8c2be5638dc419a8732c4341d84c290@tv-scripting` (published by AtTheAsk).
- **Vendor inputs**, from the study title: `EMA, Close, 9` (fast) · `EMA, Close, 20` (slow).
- **Captured on** SPY 1D/1W/4H and NVDA 1D — sets A–D.

> ⚠️ The Pine source is not read here and is not needed. Everything below is derived from the
> study's emitted plot values, so it describes what a renderer must REPRODUCE rather than what
> the author wrote.

---

## 1. ⭐⭐ Forty-five plots, and only two of them are lines you can see

| Plot(s) | Count | What it is |
|---|---|---|
| `plot_0` | 1 | **Fast MA** — `EMA(close, 9)` |
| `plot_1` | 1 | colour of the fast MA |
| `plot_2` | 1 | **Slow MA** — `EMA(close, 20)` |
| `plot_3` | 1 | colour of the slow MA |
| `plot_4` … `plot_24` | **21** | **the cloud's layer boundaries** — hidden, and pure fill anchors |
| `plot_25` … `plot_44` | **20** | one colour per band, between consecutive boundaries |

⭐ **Twenty-one layer plots.** That is the number `pine.js` already records from the translator
side — *"all twenty-one plots that make up its cloud came back with a `null` formula"* — arrived
at here completely independently, by counting what the chart emits. The two agree.

**21 boundaries → 20 bands → 20 colours.** That arithmetic is the whole render model.

## 2. The layers are an exact linear ramp between the two MAs

Measured over all 250 bars of set A:

| Claim | Result |
|---|---|
| `plot_4` equals the fast MA (`plot_0`) | max abs delta **0.0000000000** |
| `plot_24` equals the slow MA (`plot_2`) | max abs delta **0.0000000000** |
| the 21 layers are linearly spaced between those endpoints | max abs deviation **0.0000000000** |

So layer *k* is `fast + (slow − fast) × k / 20`. Nothing is smoothed, offset, or clamped — a
renderer can compute all 21 from the two MAs, and does not need 21 columns of data.

⚠️ **But it still needs 21 SLOTS.** These are real plots that consume real budget, and Pine
charges for a plot whether or not it is drawn (see `objectPool.js` for the drawing-object
analogue). They are also the reason Clouds is the natural stress case for hidden-plot handling:
`display.none` is an author's choice, not an absence of data.

## 3. ⭐ The colour encoding is `0xTTBBGGRR` — transparency, then BGR

A colorer plot's value is a 32-bit integer, and the byte order is **not** what a reader expects:

```
226597128  = 0x0D819908  ->  transparency 0x0D = 13,  colour 0x08 0x99 0x81  =  #089981
2253328008 = 0x864F0E88  ->  transparency 0x86 = 134, colour 0x88 0x0E 0x4F  =  #880E4F
```

⛔ The three colour bytes are stored **B, G, R** after the transparency byte. Reading them as RGB
gives `#819908` — a plausible-looking olive that is simply wrong, and wrong in a way that renders
without complaint. The tell is that the correct reading lands exactly on two Pine palette
constants, and the incorrect one lands on nothing.

## 4. Two states, and the two colours are Pine palette constants

Every one of the 20 band-colour plots carries exactly **two** distinct values across the whole
capture, selected by whether the fast MA is above or below the slow:

| State | Colour | Pine constant |
|---|---|---|
| `fast ≥ slow` | `#089981` | **`color.teal`** (the v6 value) |
| `fast < slow` | `#880E4F` | **`color.maroon`** |

⭐ `#089981` is precisely the v6 `color.teal` that `versionRender.js` encodes, and `#880E4F` is
`color.maroon` from the same table — a third independent route to the palette, after the spec's
own table and the chart's candle colours. Note that under **v5** `color.teal` is `#00897B`, so a
renderer that ignored the script's `@version` would tint this entire cloud wrong.

## 5. The gradient is a transparency ramp, not a colour ramp

The hue never changes across the cloud. What changes is the transparency byte, evenly, from the
fast-MA edge to the slow-MA edge:

```
13, 19, 25, 32, 38, 45, 51, 57, 64, 70, 77, 83, 89, 96, 102, 108, 115, 121, 128, 134
```

Twenty steps of 6–7 (a 0–255 byte carrying Pine's 0–100 transparency, so ≈5% → ≈53%). The band
nearest the fast MA is the most opaque; the cloud fades toward the slow MA.

The two MA lines themselves are **white** (`#FFFFFF`), the fast one fully opaque
(transparency 0) and the slow one at 13 — the same value the first band uses.

## 6. What the renderer must do

1. Two `plot` series for the MAs, white, one opaque and one slightly transparent.
2. Twenty `fill` regions between consecutive layer boundaries — Pine **bucket 2**, so
   `'normal'` + `drawBackground()` per `zorder.js`, below the plots.
3. Each fill takes one of two hues by a per-bar boolean, at a per-band fixed transparency.
4. The 21 boundaries are computable from the two MAs; only the two MAs need data columns.

⚠️ **UNVERIFIED — the `EMA(close, 20)` seed.** `plot_0` matches a textbook `EMA(close, 9)` to
**7e-6**, but `plot_2` differs from a recomputed `EMA(close, 20)` by up to **0.02** under either
seeding convention (first value, or SMA of the first window). The capture window starts 50 bars
into the chart's history, so the residual is consistent with warm-up rather than a different
formula — the 9-period converges far faster than the 20-period, which is exactly the pattern
warm-up predicts. Confirm it against a capture that starts at the series' first bar before
treating the slow MA as settled.

⚠️ **UNVERIFIED — whether the transparency ramp is linear in Pine's 0–100 units.** The byte steps
alternate 6 and 7, which is what rounding a linear 0–100 ramp into a 0–255 byte would produce,
but the author's actual expression has not been read.
