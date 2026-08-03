# Decision: the MACD head-mask — DROPPED

**Decision id:** `MACD_HEAD_MASK`
**Status:** ✅ **ACCEPTED 2026-08-02 — the owner dropped the mask.** `MACD_HEAD_MASK = false` ships. **Measured cost, re-confirmed at the flip: 88 changed pixels (0.011828%), 20/20 runs.**
**Owner of the switch:** `app/src/components/chart/engine/nativeRegistry.js` → `export const MACD_HEAD_MASK`.
**Adjudication row:** `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §11.
**Raised by:** Phase B3, adjudication A5. **Measured:** 2026-08-02. **Applied:** 2026-08-02, in its own commit.

> This document existed to price a **visible** change to a shipped chart before
> anyone made it. It has now been applied. §1-§5 are kept in the present tense of
> the measurement — they are the evidence the decision was taken against, and
> nothing in them was revised after the fact. §6 records what applying it
> actually did, and §7-§8 are the recommendation as it stood.
>
> **Re-measured at the flip** (§6): the same **88**, the same one contiguous
> 44×4 px region, from two builds of the *post-decision* tree differing in
> nothing but this constant. Reading this later: `true` is now the reversal, and
> reversing it costs the same 88 px in the other direction.

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

> ### ⚠️ SUPERSEDED 2026-08-03 (B3 Task 11) — **there is only ONE lane now.**
>
> MACD is **FLIPPED**: `StockChart.jsx`'s `indicatorData.macd` IIFE is deleted
> with the legacy render block, and with it the `engineRegistry.MACD_HEAD_MASK`
> read in the row above. **The constant has exactly one code reader left** —
> `nativeRegistry.js`'s `COLUMN_HOLDS` (`const COLUMN_HOLDS = MACD_HEAD_MASK ? {
> macd: maskMacdHead } : {}`) — plus its tests. Verified by
> `grep -rn "MACD_HEAD_MASK" app/src --include=*.js --include=*.jsx`, which is the
> check §6 says to run.
>
> **What that changes about this record:** the "one switch, BOTH lanes" rule below
> was the load-bearing part of the 88 px measurement — a flip reaching only the
> engine would have measured 0, and it measured 88, which is what proved it
> reached the lane users see. That proof stands and is why the number is trusted;
> it is simply no longer reproducible in that form, because the lane it compared
> against is gone. **A future flip of `MACD_HEAD_MASK` back to `true` now moves
> the picture through the engine alone**, and the case that prices it
> (`macd_headmask`) still exists and still measures the same 88 px in the other
> direction.
>
> Nothing else in this record is invalidated: the maths is unchanged, `macd` is
> still `version: 2` / `compute.rev: 1`, and the Python lane still does not mask.

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

**Where §9.1 stood when this was measured** *(the state the decision was taken
against — see §6 for where it stands now)*. Spec §9.1 mandates JS↔Python
agreement at rel-tol 1e-9. It **holds** for the raw natives — `computeMACD`
matches `compute_macd_raw` on all 200 bars, fixtures included, bars 25–32 among
them. It was **deliberately broken**, and only here, for:

* `nativeRegistry.computeFor('macd').macd` — 8 NaNs where Python has values;
* the array `StockChart` hands `series.setData` — 8 whitespace points.

That was the entire, bounded exception: **one indicator, one column, the first 8
bars of history, at default 12/26/9** (in general `signalPeriod - 1` bars). It
was not an unexplained fixture divergence — the fixtures were right and the
render was the thing that departed from them, on purpose, pending this decision.

✅ **It is now closed.** Dropping the mask removed both bullets: `COLUMN_HOLDS` is
`{}`, the engine's `macd` column is the Python lane's column element for element,
and the array `StockChart` draws from carries all 8 values. §9.1 has **no**
render-boundary exception, and any lane divergence found after this is a bug with
no precedent to point at.

## 4. What each option costs *(as put to the owner — "Drop the mask" is the one taken)*

| | |
|---|---|
| **Keep the mask (the default at the time)** | The chart looks exactly as it always has. The JS **render** disagrees with the Python lane and with the shared golden fixtures on the first 8 bars of every MACD chart, forever. §9.1's "rel-tol 1e-9 across both lanes" holds for the raw compute and not for what is drawn — a caveat every future reader of §9.1 has to be told about. |
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

## 6. Applied — 2026-08-02. What the rules were, and what each one produced

The rules below were written before the decision was taken. Each is followed by
what actually happened when it was carried out.

- **Flip `MACD_HEAD_MASK` in its own commit, never inside a migration.** A
  migration commit's parity number must be attributable to the migration.
  → ✅ Done. This flip is a standalone commit touching only the constant, the two
  pins, this record, spec §9.1/§11, the fixture schema note and the case's `why`.

- **Both lanes already read the constant** — one edit is the whole change. Do not
  hand-edit `StockChart.jsx`'s memo or `COLUMN_HOLDS`; that is how the two lanes
  drift apart and the measurement above stops meaning anything.
  → ✅ Honoured. `StockChart.jsx`'s `sigStart` ternary and `COLUMN_HOLDS` are
  untouched code; only their comments changed. **This is the load-bearing part:**
  `macd` is not migrated, so a flip that reached only the engine would have
  measured **0 px**. It measured 88, which is the proof the flip reached the lane
  users see.

- **It does not bump `compute.rev`** — the maths is unchanged. It is a
  presentation change: bump `version` on the `macd` definition.
  → ✅ `macd` is now `version: 2`, `compute.rev: 1`, the only native off the
  shared `version: 1`. Asserted by `nativeRegistry.test.js` →
  *is a PRESENTATION change — `version` bumped, `compute.rev` did NOT*, which
  also asserts no other definition was bumped along with it. A stale
  `defVersion: 1` on a stored instance is tolerated by `validateInstance` on
  purpose: an old instance still draws, it just draws the 8 bars it always should
  have.

- **These tests are EXPECTED to go red, and must be updated in the same commit:**
  - `nativeRegistry.test.js` → `the MACD head-mask is a flagged decision, not a silent hold (B3/A5)` (3 of its 5 cases)
  - `engine/__tests__/macdHeadMaskRendered.test.jsx` → the whole file
  → ✅ Both updated in this commit, pointed at the post-decision truth rather
  than deleted. **The record undercounted by one file:** a THIRD block went red
  that is named nowhere above — `nativeRegistry.test.js` →
  `MACD head-mask (StockChart.jsx:3952-3965 — the B1 pixel-parity hold)`, the
  B1/B2-era element-for-element pin in the "two bespoke behaviours" section. It
  is now `MACD needs NO column hold — the B1 pixel-parity mask is retired` and
  carries the general claim (the column IS the native's line on every bar). A
  decision record that names the tests it will break must name **all** of them;
  `grep -rn maskMacdHead\\\|MACD_HEAD_MASK\\\|head-mask app/src` is the check
  that would have caught this, and it is the check to run next time.

- **Re-run `--cases macd_only` and `--cases bb_rsi_macd` afterwards and
  re-capture their baselines**; keep `macd_headmask` — after the flip it measures
  the same distance in the other direction, and a **0** from it then means the
  flip did not reach one of the lanes.
  → ✅ Both re-run `--same-build` against the post-flip build, **0 px on 5/5
  each**: the new shipped look is as deterministic as the old one.
  `macd_headmask` is kept, and its `why` in `chart_parity_cases.json` now states
  which side is which.

- **Update §9.1's exception in this file and in spec §11 to "closed".**
  → ✅ §3 above, spec §9.1's inline note, and spec §11's row all now describe a
  closed decision.

### The re-measurement at the flip

Two builds of the **post-decision tree** — identical in every byte except the one
constant, so the `version: 2` bump and every comment change are present on both
sides and cannot contribute:

| | |
|---|---|
| **Changed pixels** | **88** (0.011828%) on **20 of 20 runs**, zero variance — *identical to the pre-decision measurement in §5* |
| **Region** | `x ∈ [136, 179]`, `y ∈ [394, 397]` — 44 × 4 px, one contiguous block. A = `#0e0f0d` background, B = antialiased `#2196F3`. Byte-for-byte the same geometry as §5 |
| **Determinism** | all 20 captures **per side** hashed identical — 1 distinct render on each side across 40 captures; `shots 2/2` on all 40 |
| **A — MASK ON** | build **`f141618f95e6`** (dist) · `index-B4iqCNnw.js` · `StockChart-DPksWRTp.js` |
| **B — MASK OFF (ships)** | build **`54443afee3e3`** (dist) · `index-B9Q6haj9.js` · `StockChart-DGcwC3yM.js` |
| **Exit code** | `1` — expected and correct. Tolerance is 0 and this case is *supposed* to be non-zero; a **0** would now mean a future edit stopped one of the two lanes reading the switch |
| **Bound** | 95% upper bound at n=20 is 13.9%, but it does not apply: the number is the same on every run and each build is independently deterministic. Quote the bound, never "it doesn't flake" |

### Reversing it

`MACD_HEAD_MASK = true` is one edit, and it costs the same 88 px in the other
direction. It would need the same treatment this drop got: its own commit, the
two pins updated in it, and the number re-measured — `--base-a $MASK_OFF
--base-b $MASK_ON --cases macd_headmask --repeat 20`. That is why the constant
and `maskMacdHead` are kept rather than deleted.

## 7. Recommendation as it stood *(kept verbatim; the owner agreed with it)*

**Drop it**, in its own commit, at the next chart-visible release. The cost is 88
pixels of correct ink at the extreme left of one pane on one indicator; the
standing cost of keeping it is a permanent, documented exception to the
cross-lane agreement rule that every future indicator is measured against, on the
one indicator most likely to be ported to the server lane next. But it is a
visible change to a shipped chart, so it is the owner's call and the default
stays `true` until they make it.

> **They made it, on 2026-08-02: dropped.** See §6.
