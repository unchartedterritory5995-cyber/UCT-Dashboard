# Decision needed: the MACD head-mask

**Decision id:** `MACD_HEAD_MASK`
**Status:** 🟡 **OPEN — awaiting owner sign-off.** Default is unchanged (`MACD_HEAD_MASK = true`, the shipped look).
**Owner of the switch:** `app/src/components/chart/engine/nativeRegistry.js` → `export const MACD_HEAD_MASK`.
**Adjudication row:** `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §11.
**Raised by:** Phase B3, adjudication A5. **Measured:** 2026-08-02.

> This document exists because the mask is a **visible** property of a shipped
> chart. Nothing here changes a pixel. It names the switch, prices the change,
> and pins today's behaviour so that applying the decision cannot happen by
> accident inside somebody's refactor.

---

## 1. What the mask is

`computeMACD` emits the MACD line from bar `slowPeriod - 1`. Its signal line is an
EMA **of that line**, so it cannot begin until `signalPeriod - 1` bars later —
**8 bars at the default 12/26/9** (line from bar **25**, signal from bar **33**).

This chart has always started the two together, by masking the line's head back to
the signal's first bar. Bars 25–32 are emitted as LWC *whitespace* (`{time}` with
no `value`), so nothing is drawn there.

The hold is applied in **two** places, and as of this commit both read the one
constant:

| Lane | Where | Reached by |
|---|---|---|
| Legacy (**what users see today** — `macd` is not migrated) | `StockChart.jsx`, the `indicatorData` memo | `engineRegistry.MACD_HEAD_MASK` |
| Engine | `nativeRegistry.js` → `COLUMN_HOLDS` → `maskMacdHead` | `MACD_HEAD_MASK` |

## 2. Why it exists

B1 corrected `computeMACD` to emit the line from `slowPeriod - 1`, because the
**shared golden fixtures caught the JS and Python lanes disagreeing on exactly
those 8 bars**. The correction was made in the maths and the mask was added to the
render so the *picture* did not move inside a foundations commit. B1 assigned the
decision about the picture to B3. This is that decision.

The Python lane (`api/services/indicator_compute.compute_macd_raw`) does **not**
mask, and never has.

## 3. The divergence, in numbers

`tests/fixtures/indicators/macd_default.json` is the shared oracle both lanes are
held to at **rel-tol 1e-9** (`tests/test_indicator_golden.py` and
`app/src/components/chart/goldenFixtures.test.js` read the same file). Its `macd`
column is finite on all 8 bars. The chart draws none of them:

| bar | Python `compute_macd_raw` / JS `computeMACD` (agree at 1e-9) | what the chart renders today |
|---:|---:|---|
| 25 | `0.24754493805119182` | *whitespace — nothing drawn* |
| 26 | `0.21286276699882478` | *whitespace* |
| 27 | `0.19379425387234050` | *whitespace* |
| 28 | `0.14895716519636437` | *whitespace* |
| 29 | `0.09340039013459034` | *whitespace* |
| 30 | `0.03519949354620167` | *whitespace* |
| 31 | `-0.00125191538825220` | *whitespace* |
| 32 | `-0.03941695754043906` | *whitespace* |
| 33 | `-0.04911758079313700` | drawn (signal starts here too) |

Bar 33 onward is untouched: this is a head-**hold**, not a shift. The signal line
and the histogram are not affected at all.

**Where §9.1 stands today.** Spec §9.1 mandates JS↔Python agreement at rel-tol
1e-9. It **holds** for the raw natives — `computeMACD` matches
`compute_macd_raw` on all 200 bars, fixtures included, bars 25–32 among them. It
is **deliberately broken**, and only here, for:

* `nativeRegistry.computeFor('macd').macd` — 8 NaNs where Python has values;
* the array `StockChart` hands `series.setData` — 8 whitespace points.

That is the entire, bounded exception: **one indicator, one column, the first 8
bars of history, at default 12/26/9** (in general `signalPeriod - 1` bars). It
is not an unexplained fixture divergence — the fixtures are right and the render
is the thing that departs from them, on purpose, pending this decision.

## 4. What each option costs

| | |
|---|---|
| **Keep the mask (today, the default)** | The chart looks exactly as it always has. The JS **render** disagrees with the Python lane and with the shared golden fixtures on the first 8 bars of every MACD chart, forever. §9.1's "rel-tol 1e-9 across both lanes" holds for the raw compute and not for what is drawn — a caveat every future reader of §9.1 has to be told about. |
| **Drop the mask** | The chart and both compute lanes agree everywhere; §9.1 becomes true without an exception. The MACD line starts 8 bars earlier at the very left of history. **Measured cost: 88 changed pixels (0.011828%)** — see below. |

## 5. The number

Measured 2026-08-02 on branch `feat/phase-b3-migration`, two `npm run build`
outputs differing **only** in `MACD_HEAD_MASK`:

```
python tools/spa_server.py <mask-on-dist>  5186
python tools/spa_server.py <mask-off-dist> 5187
python tools/chart_parity.py --base-a http://127.0.0.1:5186 \
                             --base-b http://127.0.0.1:5187 \
                             --cases macd_headmask --repeat 20
```

| | |
|---|---|
| **Changed pixels** | **88** of 744,000 — **0.011828%** of the 1200×620 export |
| **Distribution** | `88` on **20 of 20 runs**. Zero variance; every capture settled on its first re-check (`shots 2/2`), and all 20 renders per side hashed **identical** (1 distinct render on each side across 40 captures) |
| **Flake bound** | The harness's 95% bound at n=20 is 13.9% — but that bound describes *clean* runs. Here the 88 is the same number on every run and each build is independently deterministic (`--same-build`, 5 runs each: **0 px**), so 88 is a fact about the two builds, not a sample |
| **A (mask ON)** | build **`9f566cd22874`** (dist) — `index-CjKzbw9F.js` |
| **B (mask OFF)** | build **`9045bb69fc56`** (dist) — `index-CzkuQyL-.js` |
| **Case** | `macd_headmask` — 200 daily `ramp200` bars, 1200×620, `classic_flat` preset |

**What the 88 pixels are.** A single contiguous region, `x ∈ [136, 179]`,
`y ∈ [394, 397]` — **44 px wide, 4 px tall**, inside the MACD pane at its far
left. Side A is bare background (`#0e0f0d`); side B is antialiased `#2196F3`. It
is the 8-bar segment of the MACD line, and nothing else on the canvas moves: no
pane geometry, no autoscale shift, no change to the signal line or the histogram.

**Reality check on the size.** 88 px is small because the fixture is 200 bars in
~1,100 px of plot width — about 5.5 px per bar. On a chart zoomed in to ~40
visible bars the same 8 bars occupy roughly five times the width, and on a chart
that is scrolled away from the start of history the change is **invisible**. The
88 is the honest number for one specific, documented framing, not a claim that
the change is imperceptible.

## 6. Rules for whoever applies the decision

- Flip `MACD_HEAD_MASK` in **its own commit**, never inside a migration. A
  migration commit's parity number must be attributable to the migration.
- **Both lanes already read the constant** — one edit is the whole change. Do not
  hand-edit `StockChart.jsx`'s memo or `COLUMN_HOLDS`; that is how the two lanes
  drift apart and the measurement above stops meaning anything.
- Dropping the mask is an output change to a **rendered series** but not to a
  computed column, so it does **not** bump `compute.rev` — the maths is unchanged.
  It is a presentation change: bump `version` on the `macd` definition.
- **These tests are EXPECTED to go red, and must be updated in the same commit:**
  - `nativeRegistry.test.js` → `the MACD head-mask is a flagged decision, not a silent hold (B3/A5)` (3 of its 5 cases)
  - `engine/__tests__/macdHeadMaskRendered.test.jsx` → the whole file
  They are the pin. Going red is them doing their job; a separate commit that
  "fixes the tests" is the failure mode they exist to prevent.
- Re-run `--cases macd_only` and `--cases bb_rsi_macd` afterwards and re-capture
  their baselines: the shipped look has moved. Keep `macd_headmask` — after the
  flip it measures the same distance in the other direction, and a **0** from it
  then means the flip did not reach one of the lanes.
- Update §9.1's exception in this file and in spec §11 to "closed".

## 7. Recommendation (engineering, not the decision)

**Drop it**, in its own commit, at the next chart-visible release. The cost is 88
pixels of correct ink at the extreme left of one pane on one indicator; the
standing cost of keeping it is a permanent, documented exception to the
cross-lane agreement rule that every future indicator is measured against, on the
one indicator most likely to be ported to the server lane next. But it is a
visible change to a shipped chart, so it is the owner's call and the default
stays `true` until they make it.
