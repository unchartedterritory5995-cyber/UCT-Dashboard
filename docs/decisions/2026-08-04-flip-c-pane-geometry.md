# Decision: Flip C — the oscillator bands become real LWC panes

**Decision id:** `FLIP_C_PANE_GEOMETRY`
**Status:** 🟡 **OPEN — NOT YET MEASURED**
**Owner of the read:** `app/src/components/chart/paneMargins.js` → `computePaneMargins`,
and the `PANE_MODE` constant B5 Task 10 introduces.
**Adjudication row:** `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §11.
**Raised by:** Phase B5's plan, as the ONE task of thirteen that may move a pixel.
**Filled by:** B5 Task 11, which measures it and takes it to the owner.
**Pinned by:** *(nothing yet — Task 11 adds the rail that reads this Status line, in
the shape `enumerationSites.test.js` already uses for `ENGINE_ENABLED_MIGRATION`.)*

> ⚠️ **THIS FILE IS A SKELETON, CREATED EMPTY ON PURPOSE, AT TASK 1.** It exists
> now so Task 11 has somewhere to write its measurement instead of inventing a
> home for it under time pressure, and so the spec's §11 adjudication row has a
> target to cite from the beginning rather than a promise. §3 and §5 are
> deliberately blank; a number or an answer appearing in either one before Task 11
> has run is a number nobody measured.
>
> ⛔ **DO NOT resolve this Status from any task other than 11.** The three
> sub-choices in §2 are priced SEPARATELY and signed off SEPARATELY; a single
> "looks good" over the whole change is exactly the shape this record exists to
> refuse.

---

## 1. What changes, and why it cannot be zero

Every oscillator today is drawn into **pane 0** inside a reserved *band* —
`paneMargins.js`'s `PANES` table hands each enabled oscillator a stacked slice of
one pane, and `computePaneMargins` turns that into top/bottom margins on a price
scale. There is no divider, no second price axis, and no way for a user to resize
one oscillator without resizing the chart.

Flip C makes each oscillator a **real Lightweight-Charts pane**: its own pane
index, its own price scale, a draggable separator between it and its neighbour.

**It cannot be a zero-pixel change, and that is the whole reason it is separated
from the twelve tasks around it.** The other twelve — all ten migrations, both
settings deletions, and the entire real-pane implementation — land under
`PANE_MODE = 'bands'` and are therefore measurable at the OLD zero. Flip C is one
constant flipping to `'panes'`, and it moves:

* the **separator** — a row of pixels that did not exist before;
* the **per-pane price axis** — a column of pixels that did not exist before, and
  a set of NUMBERS a user now reads;
* the **pane heights** — LWC's own stretch factors are not `PANES`' `baseH` rows.

*(Fill in from the manifest at Task 11: the exact region split, and which of the
three above owns which pixels.)*

**⛔ The price pane must read ABSOLUTE 0.** Pane 0 — candles, MAs, all five price
overlays, volume, the right axis — is not part of this decision, and the region
gate proves it by arithmetic rather than by allowance: pane 0's margins are
re-expressed as fractions of pane 0's own height, and the separator budget is
taken from the OSCILLATORS, never from pane 0.

## 2. The three sub-choices, priced separately

They are three different kinds of change and an owner can accept any subset. A
single before/after screenshot of "the new panes" hides that, which is why this
section is a table and not a paragraph.

| # | sub-choice | the options | why it is its own decision |
|---|---|---|---|
| **2.1** | **Separator visibility / colour** | invisible (hairline in the pane background) · a themed hairline · LWC's default | pure chrome; costs the fewest pixels and is the easiest to revert. It is also the only one of the three that can be tuned per PRESET. |
| **2.2** | ⭐ **Per-pane price axis** | none (oscillators keep no axis, as today) · axis on every oscillator pane · axis only on panes whose scale is not 0-100 | **THE BIG ONE — it changes what a user READS**, not just what they see. An RSI pane that grows a `0 / 50 / 100` ladder is new information on every chart, and it costs horizontal room that pane 0 currently uses for candles. |
| **2.3** | **Pane heights** | preserve today's `PANES.baseH` proportions exactly · adopt LWC's default stretch factors · a hybrid (seed from `baseH`, then let the user drag) | this is where "the price pane the same rectangle TO THE PIXEL" is won or lost. `paneMargins.PANES` wears three different facts at once — nine `baseH` values, a stack ORDER, and a volume row — and only the heights are in scope here. |

*(Task 11: for each row, the per-case pixel cost with the region split, both build
identities, and the screenshot pair.)*

## 3. The measurement

*(EMPTY — Task 11 fills this. It must carry: per-case before→after changed-pixel
counts with the region split; **both build identities** for every number; the pane
manifest diff (pane count, per-pane pixel height, per-series pane index and
`priceScaleId`); and the three sub-choices costed separately per §2. A number
without both build ids is not a measurement.)*

## 4. What goes red when it is applied

*(Task 11 completes this from the actual run. Named in advance, from the plan, so
whoever applies it does not have to discover them:)*

| test / gate | why it moves |
|---|---|
| the parity gate's per-case **exact** expectations | `expect` replaces `<=`, so every case that moves must have its new number written down — and a regression SMALLER than the old allowance fails too |
| the **pane manifest** JSON diff | pane count and per-series pane index change by definition. ⭐ A change that moves pixels but not the manifest, or the manifest but not the pixels, is a regression BY DEFINITION: one of the two is lying |
| the **region gate**'s `price_plot` row | must still read ABSOLUTE 0. If it does not, the separator budget was taken from pane 0 |
| `paneMargins`-derived suites | `PANE_MODE` selects a different projection |
| *(add the measured list here)* | |

## 5. The owner's answer

*(EMPTY — Task 11 brings §2's three rows to the owner with §3's numbers and the
screenshots, and records the answer here, PER SUB-CHOICE. "Looks great" is not an
answer to three questions.)*

| sub-choice | answer | date |
|---|---|---|
| 2.1 separator visibility / colour | *(pending)* | |
| 2.2 per-pane price axis | *(pending)* | |
| 2.3 pane heights | *(pending)* | |
