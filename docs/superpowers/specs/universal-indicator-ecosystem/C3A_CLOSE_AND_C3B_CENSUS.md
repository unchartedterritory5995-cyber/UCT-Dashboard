# C3A-CLOSE — EVIDENCE CLOSURE, AND THE C3B CENSUS

**Result: the gate does NOT pass, on one item, and the reason is not a product
defect.** Everything obtainable was measured; the one item I cannot obtain needs
the owner, and the capture packet for it is written and ready
(`C3A_CLOSE_VENDOR_CAPTURE_PACKET.md`, ~15 minutes).

**C3B implementation was NOT begun.** Two independent reasons, either sufficient:
the gate is explicit, and the C3B census below materially changes the premise
the C3B authorization rests on.

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

## 2. TRADINGVIEW VENDOR CHECK — **BLOCKED, NOT SKIPPED**

**I could not do this within the owner's own standing boundary, and I did not
manufacture a substitute.**

- `VENDOR_CAPTURE_PLAN.md`: *"I do not request, enter, or store TradingView
  credentials … When login is required I stop and the owner performs it
  manually."* Putting an arbitrary community script on a chosen symbol and
  timeframe requires a session.
- I DID check what is reachable without one: a public script page serves a
  rendered preview image (verified: `s3.tradingview.com/c/CwRbjtih_mid.webp`).
  **I did not use it.** `tests/fixtures/vendor/README.md` is unambiguous — *"An
  observation carries the vendor's own bars. THIS IS NOT OPTIONAL … otherwise a
  delta has two possible causes and the harness cannot tell you which."* A
  preview on an unknown symbol over an unknown window cannot discriminate a
  correct event bar from an off-by-one, which is the first thing this closure
  asks for. Eyeballing it would be the screenshot-similarity claim the
  authorization forbids.

⭐ **What I did instead, and what it is worth.** The three discriminations the
closure names are settled against **Pine's published semantics** in
`markerSemantics.test.js`, each with a fixture built so the right and wrong
answers differ observably:

| discrimination | how it is settled | evidence tier |
|---|---|---|
| correct event bar vs **off-by-one** | markers land on bars `[10, 20, 30]`; a deliberately shifted column gives `[11, 21, 31]` — **a control proving the fixture can fail** | spec |
| above/below vs **generic centred** | three calls differing ONLY in `location` produce three DIFFERENT positions and the SAME bars | spec |
| conditional marker colour | each glyph is coloured by ITS OWN bar's condition, through the same fields a line uses | spec |
| marker bar vs **screener bar** | every marked bar is a bar where the column reads 1, and the counts match | spec |

⛔ **This is `spec-falsified` tier, which this repo's own protocol ranks BELOW
`confirmed` — "nobody has read the vendor's SCREEN".** I am not claiming vendor
parity. The packet that would close it is written.

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
| 2 | **real TradingView evidence validates marker semantics** | ⛔ **BLOCKED — needs the owner's session. Packet ready.** |
| 3 | no event-bar off-by-one remains | ✅ *(spec tier, with a failing control)* |
| 4 | placement semantically correct | ✅ *(spec tier)* |
| 5 | persistence intact | ✅ |
| 6 | shape approximations truthfully classified | ✅ |
| 7 | no silent disappearing-marker path | ✅ — the four disappearance modes each have a rail |
| 8 | no new silent wrong result | ✅ |

**GATE: DOES NOT PASS**, on item 2 only, and item 2 is an evidence-availability
boundary rather than either failure branch the authorization anticipated.

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

1. **The gate is explicit** and item 2 is unmet.
2. **The premise moved.** C3B was authorised against 46/60; the reachable figure
   under the standing loop boundary is 27/46. That is a materially different
   trade, and *"Do not fake it"* cuts both ways — starting an architecture wave
   on a headline number I have just measured to be optimistic would be the same
   error in a different direction.

Both are the owner's calls, not mine, and each is one message away.
