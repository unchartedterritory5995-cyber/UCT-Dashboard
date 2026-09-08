# C3A-CLOSE — EVIDENCE CLOSURE, AND THE C3B CENSUS

**Result: the gate PASSES, on evidence that did not exist when this document was
first written.** Item 2 — the TradingView vendor check — was the single blocker,
and it is now closed by a real observation taken from TradingView's own chart.

⚰️ **AND THE OBSERVATION IMMEDIATELY FALSIFIED ONE OF OUR CONSTANTS.** `color.red`
read `#F23645` in `pine.js` under a comment claiming "THESE ARE THE VENDOR'S HEX
VALUES"; TradingView's own answer is `#FF5252`. Six of the seven colours the
observation reaches matched exactly. That is what a vendor oracle is FOR, and it
is the first time this repository has held one that could disagree about a
picture.

**C3B implementation was NOT begun.** The gate is no longer a reason — it passes.
The remaining reason is the one that has not moved: the C3B census below changes
the premise the C3B authorization rests on, from 46/60 to a reachable 27/46, and
that is the owner's call to confirm rather than mine to assume.

---

## 1. THE FIXED 10-MEMBER COMPLEX PINE VISUAL PARITY SET, REMEASURED

Read from `OOS_2_PARITY_SET.json` — the set chosen by a rule committed before
any result existed. **No member replaced.**

Two instruments, deliberately:

- **the offline harness** (`visualParitySet.test.js`) — what the AUTHOR asks for
  (a census of the .pine) against what the DOCUMENT carries;
- **the live journey** (`tools/c0_visual_journey.py`) — the real UI, real save,
  real reopen, real chart.

⚰️ **THE OFFLINE HARNESS UNDER-REPORTS AND SAYS SO.** It calls `buildDefinition`
directly and therefore skips `BuilderSheet`'s import handler, which is where
fills, hidden colour-condition rows and the levels guide are actually applied.
Its `F`/`H`/dyn-colour columns read 0 for scripts that do carry them. That is a
harness limitation, not a product one, and the live run is the authority on
those three. Recorded rather than quietly patched, because a harness that does
not replicate the product is the exact defect this wave has already been bitten
by twice.

### Offline: expected vs carried

```
  VISUAL_MINIMAL   6   ·   VISUAL_PARTIAL   2   ·   VISUAL_BLOCKED   2
  VISUAL_FULL      0
  members whose OBJECT demand is unmet:  9/10
  members drawing at least one MARKER:   2/10
```

⛔ **ZERO members are VISUAL_FULL, and the classifier is built so none could be
while its objects are missing** — the C3B.19 rule applied to C3A's own report.
`CHART_RENDERABLE` is nowhere treated as `VISUAL_FULL`.

The single largest cause is uniform: **9 of 10 members demand graphical objects
and carry none.** `…05-supertrend-fibonacci-ote` asks for 25 object
constructions; `…13-ultimate-opening-range-breakout` 12; `…24-coppock` 13.

### Live: does it draw, and does it survive a reopen?

`tools/c0_visual_journey.py` on a clean isolated sandbox. Report preserved as
`C3A_CLOSE_PARITY_JOURNEY.json`.

```
  FULL_JOURNEY_PASS  7/10
  CHART_PARTIAL      1/10   13-ultimate-opening-range-breakout-luxalgo
  IMPORT_BLOCKED     2/10   16-klinger-volume-oscillator-everget, 05-master-line-plus
```

⛔⛔ **`FULL_JOURNEY_PASS` IS NOT `VISUAL_FULL`, AND THE TWO NUMBERS BELONG IN
ONE SENTENCE.** The journey outcome means *the definition imported, saved,
reopened and drew chips carrying data*. The fidelity grade means *it looks like
the author's indicator*. On this set:

> **Seven of ten now draw and survive a reopen. None of ten looks like the
> author's indicator.**

That gap is the object model, and it is the whole argument for C3B. Reporting
only the first number would be precisely the `CHART_RENDERABLE`-as-`VISUAL_FULL`
substitution the closure forbids.

⚰️ **AND THE FIRST RUN OF THIS MEASUREMENT WAS CONTAMINATED BY MY OWN
INSTRUMENT.** I passed the harness's `--keep` flag — which leaves every imported
indicator attached to the chart — and three members came back
`SAVED_NOT_RENDERED`. On a fresh sandbox the first of them is
`FULL_JOURNEY_PASS`. The failures were persisted workspace state from my own
flag, not the product. A contaminated green and a contaminated red are the same
defect; this one happened to point the safe way, and would still have been
reported as evidence.

---

## 2. TRADINGVIEW VENDOR CHECK — **DONE, AND IT FOUND SOMETHING**

**Fixture:** `tests/fixtures/vendor/visual/marker-semantics-spy-1d-2026-09-07.json`
**Rail:** `app/src/components/chart/builder/vendorMarkerParity.test.js` (10 cases)

This is the **first vendor observation of VISUAL semantics** this repository
holds. Every other file under `tests/fixtures/vendor/` is a number — `sma`,
`rma`, `adx` — and not one of them can say whether a marker lands on the right
BAR, on the right SIDE of it, carrying the right glyph, in the right colour.

### How it was taken

A probe indicator was written into the Pine Editor of an owner-authenticated
TradingView session, added to an **SPY · 1D · NYSE Arca** chart, and then read
back — **out of TradingView's own chart model, not off the pixels**:

- the bars from the main series' own plot list (OHLCV, 50 daily bars, indices
  250–299, 2026-06-26 → 2026-09-04);
- `MA20` and every marker column from the study's own plot list, **on the same
  chart in the same session** — so the bars and the plotted values cannot come
  from different data;
- location / shape / colour / text / size from the study's own resolved style
  state and `metaInfo`.

⭐ **THE VENDOR ANSWERS "WHICH BAR" IN NUMBERS, NOT IN PIXELS.** A `plotshape`
carries a value per bar in TradingView's data model — `1` where the glyph is
drawn, `0` where it is not. So "did the marker land on the right bar" stopped
being a question about a screenshot and became an array comparison. The chart's
own Data Window was read first and agreed with the model on the last bar
(O 772.01 H 772.87 L 769.00 C 770.19, Vol 34.05 M, MA20 769.05), which is what
ties the model read to the screen a member would see.

⛔ **The public preview image was still not used.** It was verified reachable
(`s3.tradingview.com/c/CwRbjtih_mid.webp`) and deliberately left alone: unknown
symbol, unknown window, no attributable bars. That decision did not change; what
changed is that a real session made it unnecessary.

### The four discriminations, now at `confirmed` tier

| # | discrimination | the vendor's own answer | ours | verdict |
|---|---|---|---|---|
| A | correct event bar vs **off-by-one** | UP on 4 bars, DN on 3, inside the comparable window | **identical arrays** | ✅ |
| B | above / below / at-value | `BelowBar` · `AboveBar` · `Absolute` | `belowBar` · `aboveBar` · `inBar` | ✅ |
| C | **conditional colour, per bar** | compiled into a separate `colorer` plot targeting the shape plot, one palette index per bar | `colorUp` + `colorDown` + `colorCondition`, and the two hexes are the vendor's | ✅ |
| D | text / glyph / size | `text:"U"` · `text:"D"` · `char:"X"` · `size:"small"` | same text, same char, size `0.8` | ✅ |

⭐ **Discrimination A is the one that could not be faked.** Bar 290 closes
763.47 against an MA20 of 763.546 and bar 291 closes 765.91 against 764.7985 —
0.076 apart. An engine one bar early or one bar late puts its glyph on a bar
where the vendor drew nothing, and the arrays differ visibly. The rail carries a
**control** that shifts our own column by one and asserts the comparison goes
red, so it cannot pass by looking at something that cannot disagree.

⭐ **And `location.absolute` was checked by VALUE, not just by position.** The
probe's `plotshape(up ? ma : na, location = location.absolute)` must sit at the
moving average, and our column equals the vendor's own MA20 to 4 decimal places
on every marked bar — plus our `sma(close, 20)` equals the vendor's MA20 on all
30 comparable bars.

### ⚰️ THE FINDING: `color.red` WAS THE WRONG RED

`pine.js`'s colour table carries the comment *"THESE ARE THE VENDOR'S HEX VALUES,
not our palette: an imported indicator that comes back a different red has not
been imported faithfully"*. It read `'color.red': '#F23645'`. TradingView's own
resolved value for a `color = color.red` plotshape is **`#FF5252`**; `#F23645` is
the chart's **down-candle** red, a different constant that happens to look red.

```
  color.aqua    #00BCD4  ✅        color.orange  #FF9800  ✅
  color.blue    #2962FF  ✅        color.purple  #9C27B0  ✅
  color.fuchsia #E040FB  ✅        color.red     #F23645 → #FF5252  ⚰️
  color.green   #4CAF50  ✅
```

⛔⛔ **NOTHING IN THE REPOSITORY COULD HAVE CAUGHT THIS.** Every colour rail —
`pine.presentation.test.js`, `BuilderSheet.dynamicColour.test.jsx` — asserted OUR
constant, so the wrong red was the *expected* red everywhere, and the comment
claiming vendor provenance was checked by nothing. This is the
`lesson_a_green_suite_does_not_mean_a_true_number` shape exactly, and it is the
argument for the whole `tests/fixtures/vendor/` directory in one line.

**Fixed** (`'color.red': '#FF5252'`), three rails updated to the vendor's value,
and the new observation now pins **all seven** colours it reaches so the table
cannot drift undetected again. Mutation-checked: restoring `#F23645` turns
`vendorMarkerParity.test.js` red.

⭐ **The other six matching is itself a result.** It says the table was
*assembled* correctly and one entry was wrong, rather than the whole thing being
our palette wearing a vendor label.

### 🔴 AND A SECOND FINDING, ABOUT THE HARNESS ITSELF

`python tools/vendor_truth.py --check` — the repository's headline vendor gate —
**crashes at HEAD** with a `TypeError`, and has since `32046d04c` landed four
multi-column observations this morning. Its 22-case rail is green because every
case monkeypatches the observation directory to a `tmp_path`: **not one test runs
the tool against the store the repo actually ships.**

Not fixed here — reading a multi-column observation means ruling on which named
column is the vendor's answer, which belongs to the workstream that wrote them.
Recorded in full as **H6** in `ENDZONE_GAP_REGISTER.md`, including the two
decisions the fixer has to make first. Stated here because a closure that says
"the vendor check passes" beside a vendor tool that will not run is exactly the
half-truth this wave is supposed to stop.

### What this observation does NOT settle

- **Pixels.** It reads TradingView's rendering *model* — the location, shape,
  glyph, size and per-bar colour it resolved — not the rasterised chart. The
  visual facts were also confirmed by eye on the live chart (green `U` triangles
  below their bars, red `D` triangles above, purple `X` above those, orange
  circles sitting on the MA line, aqua/fuchsia squares alternating), and those
  eye-checks are recorded in the fixture as `vendor.visualFacts` — prose, not
  measurement, and labelled as such.
- **Glyph shape.** TradingView draws a triangle; lightweight-charts has four
  shapes and no triangle. The observation records `shape_triangle_up` and the
  rail asserts we render `arrowUp` **and flag it `shapeApprox`** — the
  approximation is confirmed as an approximation, not silently promoted.
- **The other nine members of the parity set.** One probe on one symbol closes
  the marker-semantics question, not visual parity in general. Section 1's
  numbers stand unchanged.

---

## 3. THE SHAPE APPROXIMATION MATRIX

Derived by TRANSLATING each shape, never by re-typing the map — a matrix copied
from `pine.js` would agree with `pine.js` by construction.

```
  Pine source shape        → UCT rendered   flagged   class
  shape.circle             → circle         false     EXACT
  shape.square             → square         false     EXACT
  shape.arrowup            → arrowUp        false     EXACT
  shape.arrowdown          → arrowDown      false     EXACT
  shape.triangleup         → arrowUp        true      CLOSE_APPROXIMATION
  shape.triangledown       → arrowDown      true      CLOSE_APPROXIMATION
  shape.labelup            → arrowUp        true      CLOSE_APPROXIMATION
  shape.labeldown          → arrowDown      true      CLOSE_APPROXIMATION
  shape.diamond            → square         true      CLOSE_APPROXIMATION
  shape.flag               → arrowUp        true      MATERIAL_APPROXIMATION
  shape.cross              → square         true      MATERIAL_APPROXIMATION
  shape.xcross             → square         true      MATERIAL_APPROXIMATION

  EXACT 4  ·  CLOSE 5  ·  MATERIAL 3  ·  UNSUPPORTED 0
```

**Why the three MATERIAL ones are material:** a Pine `flag` is NOT directional,
so drawing it as an up-arrow **adds a direction the author did not state**;
`cross`/`xcross` are open marks and a filled square reads as a solid block, the
shape most likely to be misread as a different signal on a busy chart.

⛔ **AND `shape.xcross` IS `plotshape`'s OWN DEFAULT** — so an unstyled
`plotshape`, the commonest call in the corpus, is a MATERIAL approximation.
Stated because it is the easiest one to assume is exact.

⭐ The matrix is held to the CODE: a test asserts the engine's own
`shapeApprox` flag agrees with this table's class for every shape, so
reclassifying here without changing the code — or adding a native glyph without
updating here — goes red. **No new glyphs were implemented**; this is
measurement closure.

---

## 4. C3A-CLOSE GATE RESULT

| # | condition | result |
|---|---|---|
| 1 | fixed 10-member set remeasured | ✅ |
| 2 | **real TradingView evidence validates marker semantics** | ✅ **CONFIRMED tier** — observation + 10-case rail, and it found a wrong hex |
| 3 | no event-bar off-by-one remains | ✅ *(now CONFIRMED against the vendor's own marked bars, control included)* |
| 4 | placement semantically correct | ✅ *(now CONFIRMED against the vendor's own `location` values)* |
| 5 | persistence intact | ✅ |
| 6 | shape approximations truthfully classified | ✅ |
| 7 | no silent disappearing-marker path | ✅ — the four disappearance modes each have a rail |
| 8 | no new silent wrong result | ✅ |

**GATE: PASSES, 8 of 8.**

⛔ **AND PASSING IT COST A CORRECTION, WHICH IS THE POINT.** Item 8 is "no new
silent wrong result"; the vendor check turned up an OLD one — `color.red` — that
had been silently wrong since the colour table was written and was invisible to
every rail in the repository. A gate that only ever confirms what you already
believed is `lesson_gate_that_cannot_fail`. This one disagreed on its first run.

---

## 5. C3B.1 — THE OBJECT-DEMAND CENSUS (measurement only, no architecture begun)

```
  family      scripts   new    set_*   get_*  delete
    line          23/60     85     111      12      79
    label         30/60    103      76       0      89
    box           20/60     40      37       4      32
    table         29/60     35      10       0       0
    polyline       3/60      9       0       0       5
    linefill       3/60      4       2       0       3
    table.cell        —    402 sites

  CAPABILITY SHAPES (each script counted at the STRONGEST thing it needs)
     11/60  TABLE+ARRAY+CREATE_UPDATE_DELETE
     11/60  TABLE+CREATE_UPDATE
     10/60  ARRAY+CREATE_UPDATE_DELETE
      5/60  CREATE_UPDATE_DELETE
      4/60  TABLE+CREATE_UPDATE_DELETE
      2/60  TABLE+CREATE_ONLY
      1/60  ARRAY+CREATE_ONLY
      1/60  TABLE+ARRAY+CREATE_UPDATE
      1/60  CREATE_ONLY

  scripts using ANY object:                46/60
  …needing UPDATE (identity across bars):  35/60
  …needing DELETE (lifetime + envelope):   30/60
  …storing an object in a var variable:    36/60
  …reassigning an object reference:        15/60
  …using an object ARRAY/collection:       23/60
  …declaring max_*_count themselves:       32/60
  …historically indexing an object ref:     0/60
```

### ⛔⛔ THE FINDING THAT CHANGES THE C3B PREMISE

```
  object scripts building objects INSIDE a loop:  19/46
  object scripts with NO object op in a loop:     27/46
    …of those, needing UPDATE:  19
    …of those, needing DELETE:  13
    …of those, needing an ARRAY:  7
```

The C3B authorization rests on *"OBJECT-HEAVY DEMAND: 46/60."* **Under
RISK-043 — generalized Pine loops stay unsupported, and C3B.12 forbids
reopening that — a complete object model reaches 27 of those 46**, because the
other 19 build their objects inside `for`/`while` bodies and stay BLOCKED
however good the object model is.

27/60 is still the largest single item in the register, comfortably ahead of the
27/60 of remaining declarative demand *in scripts*, and it is the class that
converts partial indicators into whole ones. But the expected return is **45% of
the corpus, not 77%**, and the owner should weigh the architecture against the
real number rather than the headline one.

Three further facts that shape any design:

1. **CREATE-only is 1 script.** A system without identity across bars serves
   almost nobody — 35/60 need UPDATE. Identity is not an enhancement, it is the
   entry ticket.
2. **Arrays are 23/60 — half of all object scripts.** C3B.11's "if only a small
   tail requires it, it may remain partial" does **not** apply; a typed bounded
   object collection is mainstream demand, not an edge.
3. **32/60 authors declare `max_*_count` themselves.** The resource envelope
   C3B.13 asks for is something Pine authors already reason about explicitly,
   so the bound has a natural source rather than needing to be invented.

⭐ And one axis is mercifully absent: **0/60 historically index an object
reference** (`line[1]`), so object references never need bar-history semantics.

---

## 6. WHY C3B WAS NOT BEGUN

1. ~~**The gate is explicit** and item 2 is unmet.~~ **CLEARED** — the vendor
   check is done and the gate passes 8 of 8.
2. **The premise moved, and that reason still stands.** C3B was authorised
   against 46/60; the reachable figure under the standing loop boundary is
   27/46. That is a materially different trade, and *"Do not fake it"* cuts both
   ways — starting an architecture wave on a headline number I have just measured
   to be optimistic would be the same error in a different direction. The owner
   has since confirmed 27/46 as the corrected denominator, so this is now a
   recorded premise rather than an open question.

The remaining stop is the owner's checkpoint, not a missing measurement.
