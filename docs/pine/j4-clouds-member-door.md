# j.4 — Uncharted Clouds through the MEMBER door

**Measured 2026-09-17 at `860a9d22e`** (R33a in, R33b stopped as H.10).
Instrument: `memberPaneDefinition({source})` over
`tests/fixtures/member/uncharted-clouds.pine`, host lane, `strict: true`.

⛔⛔ **THIS IS THE ENGINE-SIDE HALF ONLY. THE VENDOR HALF IS BLOCKED AND THE
COMPARISON COLUMN IS DELIBERATELY EMPTY — NOT ESTIMATED.** See §3.

---

## 1. The per-layer table

Translator, host lane: **23 outputs · 0 refusals · 20 fills**.
Pane document: **23 plots · 21 hidden · 2 visible · 20 fills**.

⭐ **A fill is a PROPERTY OF THE UPPER PLOT (`fill: {with: '<key>'}`), not a
separate `definition.fills` collection.** ⚰️ Recorded because the first probe
written for this table asked for `definition.fills`, got `undefined`, and would
have reported *"the pane document carries zero fills"* — a fabricated finding
about the headline question, produced by guessing a field name instead of
reading the shape. The shape is
`{schemaVersion, id, version, compute, meta, placement, inputs, plots}`.

| # | key | style | hidden | color | fill | colorMode |
|---|---|---|---|---|---|---|
| 0 | `value` | line | no | `$color` | — | — |
| 1 | `out2` | line | no | `$out2Color` | — | — |
| 2 | `out3` | line | **yes** | `$out3Color` | `{with: out4}` | — |
| 3 | `out4` | line | **yes** | `$out4Color` | `{with: out5}` | — |
| … | `out5`…`out21` | line | **yes** | `$outNColor` | `{with: out<N+1>}` | — |
| 21 | `out22` | line | **yes** | `$out22Color` | `{with: out23}` | — |
| 22 | `out23` | line | **yes** | `$out23Color` | — | — |

**21 hidden anchors `out3`…`out23` chained consecutively give exactly 20 fills** —
the shape j.4 was specified against. Every plot is `style: line`; the two visible
rows are the Fast/Slow MAs and the 21 cloud anchors are `hidden: true`, which is
R24/R27 working: a hidden plot is an anchor a fill references and binds no series.

## 2. What carries and what does not

| property | result |
|---|---|
| outputs reaching the document | **23 / 23** ✅ |
| hidden anchors | **21**, as designed ✅ |
| fills reaching the document | **20 / 20** ✅ |
| fills carrying the author's colour PAIR | **0 / 20** ❌ |
| fills declared `colorDynamic` | **20 / 20** — the loss is *declared*, not silent ✅ |
| fills carrying a CONDITION | **0 / 20** |
| R34 condition rows minted | **0** |

⭐ **THE ZERO CONDITION ROWS ARE R34 WORKING, NOT R34 FAILING.** A condition row is
minted from a fill's carried `colorCondition`. Clouds carries none, because its
fill colour is `isBullish ? getBullFillColor(0) : getBearFillColor(0)` and the user
colour function does not fold — **R33b, stopped as H.10**. R34 is proven on
foldable conditions by `conditionColumn.test.js`; Clouds cannot exercise it until
the fold is decided. Nothing is owed by R34 here.

⚠️ **EACH CLOUD LAYER EXPOSES A MEMBER-SETTABLE COLOUR INPUT (`$outNColor`) WHERE
THE AUTHOR WROTE A COMPUTED GRADIENT.** 48 inputs are carried. So the member is
not shown a broken chart — they are shown twenty individually-colourable bands
instead of one graded cloud. That is a **different product**, not a degraded one,
and it is the member-visible consequence of the fold being stopped.

## 3. ⛔ THE VENDOR HALF IS BLOCKED — BY A STANDING OWNER RULING, NOT BY A FAILURE

`capture-procedure.md:463` — *"THE RIG IS A SCRATCH LAYOUT WITH ZERO STUDIES"*,
owner ruling 2026-09-12 — retires the 19-study working chart and requires every
capture to run on a dedicated empty layout. The ruling arrived with a
`<PASTE URL>` placeholder and **the scratch layout's id has never been recorded**
(`capture-procedure.md:481`, verified still unfilled at `860a9d22e`):

> *"the scratch layout's id is still owed. Until it lands, every capture is
> blocked — deliberately, rather than falling back to the 19-study chart, which
> this rule retires."*

⛔ So no vendor capture was taken, and **no comparison column is estimated**. The
owner's live Chrome was the only connected browser; driving their working chart
would be exactly the fallback the ruling forbids, and their Pine Editor is
untouched. **What is owed is one URL.**

⚠️ **AND H.8'S LINE IS STILL REPORTED, NEVER ASSERTED.** Wave 1's fixture ends at
the sealed bar `2026-09-11`, so even with the layout URL the live-bar divergence
would remain uncovered by that procedure.

## 4. R29 — the flip condition, decided

> R29: *#145 flips draft → ready **only** when j.4 reports Clouds within Wave 1's
> tolerance on both tables at both tiers **and** CI is green. Otherwise it stays
> draft and the report says which condition failed.*

**#145 STAYS DRAFT.** Two conditions fail, and they fail for different reasons:

1. **Colour is outside tolerance by construction** — 0 of 20 fills carry the
   author's pair, because the fold was stopped at H.10. This is an **owner
   decision pending**, not an engineering defect.
2. **"Both tables at both tiers" was never measured** — the vendor capture is
   blocked on the owed layout URL (§3). ⛔ Unmeasured is **not** the same as
   failed, and collapsing the two would be the `CoverageLine` defect this repo
   already refuses: *"it failed"* and *"it could not be asked"* are different
   facts.

⭐ **What DID meet its bar:** every structural claim — 23 outputs, 21 hidden
anchors, 20 fills into the document, the loss declared rather than silent. The
carrier (j.3b(a)), the renderer (j.3a/R30) and the pane door (R34) are all in and
individually proven. **One ruling and one URL stand between this and a complete
j.4.**
