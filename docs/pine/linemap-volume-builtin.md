# Line map — Volume (TradingView's built-in) — A CONTROL, NOT THE TARGET

⛔ **THE PART 2 TARGET IS `Uncharted Volume`; ITS LINE MAP IS `linemap-volume.md`.**
This page is TradingView's built-in `Volume@tv-basicstudies`, kept deliberately as a
control: it is small, independently understood, and it is what exposed the inverted
colorer index in §2 — a finding that then applied to Clouds and to the real target.

It is captured alongside the two member scripts in every set (`clouds-volume-*.csv`),
which costs nothing and gives every capture a component whose correct answer is known
in advance.

What every part of TradingView's built-in **Volume** study is, and what our renderer has to
produce for it. Every number and colour below was **read out of a live chart**, not inferred:
see `tests/fixtures/vendor/reference/A/volume-spy-1d-250.{csv,meta.json}` and the protocol in
`tools/visual_conformance/README.md`.

- **Capture**: `AMEX:SPY`, `1D`, 250 bars, indices 50–299 (2025-09-10 → 2026-09-08 ET).
- **Study id**: `Volume@tv-basicstudies`.
- **Vendor inputs**: `length = 20`, `col_prev_close = false`.

> ⚠️ Volume is a **built-in**, not an open-source Pine script, so there is no vendor source to
> map line-by-line. The left column is therefore *the Pine you would write to reproduce it* —
> the equivalence is asserted against measured vendor output, and every assertion below names
> the measurement that backs it.

---

## 1. The map

| # | Pine equivalent | Plot | Visual element | Vendor state |
|---|---|---|---|---|
| 1 | `indicator("Volume", format = format.volume)` | — | Its own pane, below price | separate pane; `precision: "default"` |
| 2 | `up = close >= open` | — | (not drawn) | `col_prev_close = false` selects close-vs-open — **measured**, §2 |
| 3 | `plot(volume, "Volume", style = plot.style_columns, color = up ? upCol : downCol)` | `vol` | Histogram from a zero base | `plottype: 5`, `linewidth: 1`, `transparency: 50`, `visible: true`, `histogramBase: 0` |
| 4 | *(the colour argument above)* | `vol_color` | Selects the colour for each `vol` column | `type: "colorer"`, `target: "vol"` — a **palette index**, not a boolean, §2 |
| 5 | `plot(ta.sma(volume, 20), "Volume MA")` | `vol_ma` | A line across the histogram | `plottype: 0`, `linewidth: 1`, **`visible: false`** on this chart, §3 |

## 2. ⛔ The colorer is a palette index, and it is inverted from the obvious reading

**`vol_color = 0` is an UP bar. `vol_color = 1` is a DOWN bar.**

This is the single most important thing in this document, because getting it backwards
produces a chart that looks completely plausible and is wrong on every bar.

Measured over all 250 captured bars:

| Hypothesis | Agreement |
|---|---|
| `vol_color == 1` when `close >= open` | **0 / 250** |
| `vol_color == 0` when `close >= open` | **250 / 250** |
| `vol_color == 1` when `close >= close[1]` | 48 / 249 (19.3%) |

⭐ **Zero out of 250 is the tell.** A wrong-but-uncorrelated guess lands near 50%; a perfect
anti-correlation means the mapping is exactly inverted. The 19.3% row is what noise looks like
here, and it is the measured refutation of the close-vs-previous-close reading — which is the
*other* thing Volume can do, when `col_prev_close = true`. That input was `false` for this
capture, so **a renderer must read the input, not hard-code either rule.**

⚠️ Consequence for the renderer: a `colorer` plot's value is an **index into the plot's
palette**, and its integers carry no inherent meaning. Do not treat a colorer as a boolean, and
do not assume `1` is the "positive" case.

## 3. ⭐ A hidden plot still carries values

`styles.vol_ma.visible` is `false` and `display` is `0` on the captured chart — the Volume MA
is switched off, and nothing about it is drawn. **All 250 rows still carry a `vol_ma` number.**

This is the same rule the Pine presentation spec states for `display = display.none`: hidden is
an author's *display* choice, not an absence of data. Our engine already relies on it — Clouds'
twenty-one layer plots are hidden on purpose and exist only as `fill` anchors — so this is a
vendor-side confirmation of a rule we had only asserted.

⚠️ It is also why the capture reads the chart **model** rather than the Table-view export: the
export shows the visible columns, and `vol_ma` would simply not have been there.

`vol_ma` is exactly `SMA(volume, 20)` — **231 bars checked, maximum absolute delta 0.0**, which
also confirms `inputs.length = 20` is the MA length and not something else. (The first 19 bars
of the window are not checked here because their true window reaches behind the capture; they
do carry vendor values, computed from bars before index 50.)

## 4. `vol` is the series volume

250 / 250 bars: the study's `vol` plot equals the main series' volume, bit for bit. Nothing is
rescaled, smoothed or unit-converted on the way into the study. This is a coherence check on
the capture as much as a statement about Volume.

## 5. Colours, and what we still do not have

The captured chart is on a **light** theme, and the vendor state gives us:

| Thing | Value |
|---|---|
| Pane background | `rgba(255, 255, 255, 1)` |
| Grid (vert + horz) | `rgba(46, 46, 46, 0.06)` |
| Series up / down | `#089981` / `#F23645` |
| `vol` base colour | `#2962ff` |
| `vol` transparency | `50` |

⚠️ **UNVERIFIED — the two histogram colours themselves.** `styles.vol.color` is a single value
(`#2962ff`), which is the study's *default* colour, not the up/down pair the histogram actually
draws. The per-index palette lives in the study's palette state, which this capture did not
read. Until it is captured, the renderer must not hard-code a green/red pair here — the
measured facts are the *index* (§2) and the transparency, not the hues.

⭐ Worth recording: the series up/down hexes `#089981` / `#F23645` are exactly the values the
clean-room Ichimoku fixture uses (`tests/fixtures/pine/12-ichimoku-kinko-hyo.pine`), which were
taken from the Pine v6 colour constants. Two independent routes to the same pair.

## 6. What is not captured yet

- **The palette state** for `vol_color` (§5) — the two histogram hues themselves.
- **A line map for Uncharted Volume**, the probable real target (see the banner at the top). Its
  twelve plots are captured in all four sets; nobody has read them yet.
- **Table / label crops.** The full-chart and 40-bar images exist for every set, but neither of
  these two studies draws a table or a label, so there was nothing to crop. The first script that
  does will need them.

⚠️ **Uncharted Volume does not appear in the reference images.** Its pane was allocated **zero
height** on the capture layout, and pane heights cannot be recomputed while the browser tab is
`visibilityState: "hidden"` — which it was throughout. The numbers are unaffected (they come from
the model), and re-shooting with the window foregrounded is all that is needed.
