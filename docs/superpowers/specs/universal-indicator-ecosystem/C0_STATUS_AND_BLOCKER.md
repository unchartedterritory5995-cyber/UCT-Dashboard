# C0 — WAVE B COMPLETION / END-TO-END VISUAL PATH CLOSURE

**Result: C0 FAILS its exit gate. The blocker is a PRODUCT defect, located to the
line: for 8 of the 18 accepted OOS scripts the imported formula names an
identifier the engine's closed table does not declare, so the member can Apply
the import, see a populated builder — and then cannot Save it.**

Per the authorization, this is returned as a blocker rather than worked around,
and **C1 is not started.**

The previous version of this file returned a HARNESS blocker (a shared-Chrome
foreground problem). **That is resolved** — the journey now runs end to end on
Playwright, unattended and repeatably. What replaced it is a real product finding.

---

## ⛔ RETRACTION — TWO NUMBERS I PREVIOUSLY REPORTED WERE UNEARNED

**Retracted: "17/1 CHART_RENDERABLE", and the earlier "5/5 fixtures
CHART_RENDERABLE" for `tests/fixtures/pine_multiplot`.** Both were produced by a
metric that could not fail.

`tools/c0_visual_journey.py` decided CHART_RENDERABLE by comparing
`document.querySelectorAll('canvas').length` before and after the import. Measured
on the real page it read `canvases_before: 75` and `canvases_after: 75`: the
workspace's own chart widgets own every one of those canvases, and they exist
whether or not a single Pine script was ever imported. The check would have
returned CHART_RENDERABLE for **any** script — including one whose Save never
fired, which is exactly the state four of those five fixtures were in.

A gate that cannot fail is not a gate (`lesson_gate_that_cannot_fail`). No render
or persistence claim from before this fix should be relied on. The numbers below
were produced after it and carry their own non-vacuity controls.

---

## WHAT THE METRIC IS NOW, AND HOW IT CAN FAIL

The render answer is the **product's own**, not one invented for the harness.
`StockChart` renders one `IndicatorChip` per plot of every instance on the chart,
and `engine/readout.js::legendChips` stamps each chip with `data-instance-id`,
`data-plot-key`, `data-hidden`, and — the load-bearing one —
`data-computed="false"`, which is present exactly when a plot is visible and its
column held no finite value. That attribute exists because the team had already
measured that a visible-but-empty chip and an ordinary off-cursor chip were byte
identical; the harness reuses that distinction rather than re-deriving it.

CHART_RENDERABLE therefore requires **four** independent facts, each of which is
observed to fail on its own in the runs below:

| Fact | Read from | Failure name |
|---|---|---|
| The import was accepted | the door's own refusal chip | `IMPORT_BLOCKED` |
| The definition persisted | `GET /api/user-definitions` | `SAVE_BLOCKED` / `SAVE_FAILED` |
| An instance reached the chart | `charts_workspace_layout` → `indicatorInstances` | `SAVED_NO_INSTANCE` |
| Every declared plot DREW after reload | `data-computed` on each chip | `CHART_PARTIAL` |

### The non-vacuity controls — `tests/fixtures/pine_render_controls/`

Four permanent first-party controls, run as an ordinary batch. **Each one exists
because the corresponding branch would otherwise never be observed to fire**, and
a 5/5 pass over hand-picked fixtures is exactly what the retracted metric produced.

| Control | Must answer | Measured |
|---|---|---|
| `ctrl-01-window-exceeds-history` | not saveable | `SAVE_BLOCKED` — *"exceeds the lookback budget — this formula measures 100000 and the cap is 960"* |
| `ctrl-02-no-contentful-output` | refused at import | `IMPORT_BLOCKED` |
| `ctrl-03-non-finite-column` | accepted, draws nothing | `CHART_PARTIAL` — `drewNothing: true`, chip carries no value |
| `ctrl-04-object-alongside-plot-is-accepted` | accepted AND drawn | `CHART_RENDERABLE` |

⭐ **ctrl-03 is the one that matters most**: it is the only proof that
`data-computed` distinguishes *drew* from *did not draw*. Without it every
CHART_RENDERABLE in this document would be unearned in the same way the retracted
number was.

⭐ **ctrl-04 is the other half of ctrl-02.** A door that refuses everything also
passes a refusal control, and an over-refusal is invisible
(`lesson_an_over_refusal_is_invisible`) — nobody files a bug for an indicator they
were told could not be imported. ctrl-04 carries a `label.new` **and** a real
plot, and the correct answer is to accept it and draw the line. It is also the
presentation-loss case in the flesh: the label is silently dropped.

---

## ⛔ FIVE DEFECTS I FOUND IN MY OWN MEASUREMENT, BEFORE PUBLISHING A NUMBER

Recorded because each one produced a *plausible, wrong* result that would have
been filed against the product.

1. **The canvas count could not fail.** Retracted above.
2. **The reload raced the layout debounce.** The harness reloaded as soon as the
   DEFINITION appeared in `/api/user-definitions` (~550 ms), but the instance
   reaches the wire through the workspace layout's **500 ms debounced** persist.
   Four of five fixtures lost their instance before it was written, and the run
   reported `SAVED_NOT_RENDERED` — a fact about harness timing wearing the shape
   of a product defect. The one fixture that "passed" had merely won the race.
   Fixed by waiting on the artifact.
3. **The instance reader looked for the wrong key** (`instances`, where
   `withInstances` writes `indicatorInstances`). It found nothing and reported
   `SAVED_NO_INSTANCE` for five fixtures whose instances were on the chart and in
   the blob the whole time. **A probe that cannot see the thing it is looking for
   returns the same answer as a broken product.**
4. **The legend is crosshair-gated, and the harness never moved a cursor.**
   `StockChart` renders the whole legend behind `crosshairData && !hideLegend &&
   legendMode !== 'off' && …`, and `crosshairData` is null until the pointer has
   been over the plot. A workspace that was *visibly drawing three imported Pine
   indicators* — confirmed by screenshot, three extra panes — reported **zero**
   chips. "The legend is not showing" and "the indicator did not draw" are
   different facts and the DOM says the same thing for both until the cursor
   moves. The read now hovers the plot first.
5. **The levels guide was counted as a plot that failed to draw.**
   `buildDefinition` writes `hline` levels as a plot with `role: 'context'` and
   deliberately **no `legend` block**, and `legendChips` skips any plot without
   one — so a levels guide never earns a chip and never should. Comparing chips
   against `plots[].key` wholesale booked a correct render as CHART_PARTIAL. The
   expectation is now derived from the same predicate the renderer uses.

Two smaller ones: a product refusal containing a non-cp1252 glyph killed the run
at a `print` **after** two fixtures had been measured and before anything was
written to disk (output is now UTF-8 and the report is written after every row).

---

## RESULTS

All figures below are derived from the JSON reports by script, not typed by hand.

### C0.1 / C0.2 — multi-output handoff and live multi-plot render · **PASS**

`tests/fixtures/pine_multiplot` (5 permanent first-party fixtures):
**5/5 CHART_RENDERABLE.** Report: `tools/c0_out5/report.json`.

Per-plot evidence, not a count: two-, three- and three-plot documents each drew
every declared plot with **distinct values per plot** (e.g. `54.95 / 49.47 /
54.48`), the overlay fixture drew in price units (`742.24 / 760.64 / 723.84`)
against `placement: price`, styles carried per output (`line / stepline /
histogram`), colours carried per output (`#9c27b0 / #ff9800 / #2962ff`), and the
`hline` fixture carried `levels: "70, 30"` alongside its two plots without
replacing one.

### C0.3 — CHART_RENDERABLE over the 18 accepted OOS scripts · **9/18**

Report: `tools/c0_out_oos_v2/report.json`.

| Outcome | Count |
|---|---|
| CHART_RENDERABLE | **9** |
| SAVE_BLOCKED | **8** |
| IMPORT_BLOCKED | **1** |

Plot-level, for the scripts that got through: **29 plots declared, 29 drawn, 0
drew nothing.** So when a script reaches the chart at all, every column it
declares computes. The loss is entirely at the Save door.

### C0.8 — Complex Visual Parity Set (10 members, unchanged) · **6/10 render**

Report: `tools/c0_out_parity_v2/report.json`. **No member was substituted.**

| Outcome | Count |
|---|---|
| CHART_RENDERABLE | **6** |
| IMPORT_BLOCKED | **2** |
| CHART_PARTIAL | **1** |
| SAVE_BLOCKED | **1** |

⛔ **CHART_RENDERABLE HERE IS NOT VISUAL PARITY AND MUST NOT BE READ AS IT.**
These are the V4/V5 tier — the richest visual scripts in the corpus, chosen for
fills, dynamic colour, objects and conditional visibility. Six of them draw their
carried plots. Every one of them still loses presentation the source declares;
that is C0.7's finding, unchanged, and it is why the parity set exists.

The two import refusals are real, specific product answers with line and column:
`ta.alma` is not in the engine grammar (`long_tail__05-master-line-plus`, line 56),
and a `var` accumulator that does not re-seed cannot be held by the bounded
accumulator (`high_engagement__16-klinger-volume-oscillator-everget`, line 26).
`high_engagement__13-ultimate-opening-range-breakout-luxalgo` is the CHART_PARTIAL:
it saves, installs, and its single carried plot **computes nothing on these bars**.

---

## ⛔⛔ THE BLOCKER — UNSUBSTITUTED INPUT IDENTIFIERS REACH THE SAVED FORMULA

**8 of 18 accepted OOS scripts (and 1 of 10 parity members) import cleanly, apply
cleanly, populate the builder — and then cannot be saved**, because the formula
names an identifier the closed table does not declare. The member sees a working
import and a dead Save button.

Every one of the eight is the same error class, from the product's own read-back:

> *the read-back cannot name a value the table does not declare at `<astPath>`:
> `"<identifier>"` — this table declares close, high, low, open, volume, …*

| Script | Identifier | astPath |
|---|---|---|
| `high_engagement__02-waddah-attar-explosion-lazybear` | `mult` | `$.args[0].args[1].args[0]` |
| `high_engagement__03-supertrend-kivancozbilgic` | `Multiplier` | deep, 11 levels |
| `high_engagement__12-cm-ultimate-rsi-mtf-chrismoody` | `upLine` | `$` |
| `long_tail__13-volatility-of-returns` | `showMa` | `$.args[0]` |
| `mid_engagement__07-3way-bollinger-trend` | `bandStdevMult` | `$.args[1].args[1].args[0]` |
| `mid_engagement__13-spma-trend` | `GateInp` | `$.args[1].args[2].args[0].args[1]` |
| `mid_engagement__14-master-line-lite` | `showBand` | `$.args[0]` |
| `mid_engagement__22-rsi-levels-regime-map` | `lv3` | deep, 9 levels |

**Two sub-classes, and they want different fixes:**

- **A — a `bool` input used as a visibility switch.** `showMa`, `showBand`:
  `plot(showMa ? ma : na, …)`. The declared input reaches the formula as a bare
  identifier. This is Pine's ordinary "show/hide this plot" toggle and it is
  everywhere in the corpus.
- **B — a numeric input threaded through a user-defined function.** `mult`:
  `mult = input(2.0, …)` then `calc_BBUpper(source, length, mult)`, where `mult`
  is also the function's **formal parameter**. When the function is inlined the
  parameter name leaks into the AST unsubstituted.

⭐ **The substitution is PARTIAL, not absent — which is the most useful fact
here.** `mid_engagement__22-rsi-levels-regime-map` refuses on `lv3` with the
product's own suggestion *"did you mean `lv1` or `lv2`?"* — so `lv1` and `lv2`
**were** substituted and `lv3` was not, in the same document. This is not "inputs
are unsupported"; it is a substitution pass that misses some of what it should
cover, and the miss is invisible until Save.

**Why this is a C0 blocker and not a C1 item.** C1 adds dynamic colour and
fill/bands — more presentation carried through the same door. Building it while
8/18 of the accepted corpus cannot pass that door would raise the visual ceiling
for scripts a member cannot save, and would make the next set of numbers harder
to attribute, not easier.

---

## C0 EXIT GATE

| Condition | Met? |
|---|---|
| multi-output survives import/save/render | ✅ 5/5 fixtures, per-plot evidence |
| CHART_RENDERABLE measured, not assumed | ✅ measured, with 4 non-vacuity controls |
| save/reopen verified | ✅ for the 9 that save: definition + instance + redraw after reload |
| parameter-driven visual change verified | ❌ **this is the blocker** |
| renderer/harness produces reliable repeated evidence | ✅ resolved — Playwright, unattended |
| no known silent visual omission presented as FULL support | ✅ 16/18 remain VISUALLY PARTIAL (C0.7); parity CHART_RENDERABLE explicitly ≠ parity |
| performance baseline exists | ✅ every phase timed in every report |

**C0 FAILS on the parameter/visibility gate. Stopping here rather than proceeding
to C1**, per the authorization's own instruction.

### Performance baseline (C0.9), from the timings in every row

Median over the 5 multiplot fixtures: translate ≈ **0.27 s**, Apply ≈ **11 ms**,
save round-trip ≈ **0.53 s**, instance persisted ≈ **0.56 s**, workspace reopen ≈
**2.4 s**, first correct legend read after reload ≈ **0.22 s**. No step is a
performance risk at this size; the reopen is dominated by the cinematic intro and
the workspace's ResizeObserver mount, not by the indicator.

## What unblocks C1

Close the substitution gap: every identifier the translator emits must either be
declared by the closed table or carried as a `$`-ref into `inputs[]`. The eight
scripts above are the reproducers, and `lv1`/`lv2`-succeed-while-`lv3`-fails is
the narrowest one to start from. `tools/c0_visual_journey.py` re-measures the whole
population unattended, so the fix has a standing number to move.
