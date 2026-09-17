# Wave 2 — the Pine grammar closes: nine items censused, four built, five retired on their numbers

This wave does not add a feature. It **finishes the grammar** the Wave 1 pane stands on,
and the honest headline is that **most of it was already correct** — five of the nine
items retired on measurement, and two of those retired because a census proved the
engine does the right thing today.

⛔ **The flag is still OFF.** No member-facing behaviour changes here except two
sentences, both of which say *more* than they did before.

---

## What this wave actually changed

| | |
|---|---|
| **Built** | (d1′) a chart-only call **inside a block** is noted · (d2) an alert **message rides beside the title** · (g) the reassign refusal **carries the reason it already recorded** · (h) three `syminfo.*` fields **retire by name** |
| **Retired on their numbers** | (b) time inputs · (e) short-circuit · (f) 44 of 50 nested-text-helper forms · (i) volume provenance · (c)'s IR half, blocked |
| **Frozen and still frozen** | `NODE_TYPES` **11** · `REFUSALS` **41** |

---

## The five findings worth the reviewer's time

### 1. The engine was right more often than the plan assumed, and measurement is what showed it

Three items were priced against premises that **measured false**:

- **(e)** — *"both sides always evaluate today."* True at **run** time, **false at plan
  time**: the engine already prunes the conditional operand in **1,836 of 13,906** uses,
  and across **20,954 conditional operands it is measurably wrong in zero.**
- **(g)** — *"`s := close` is a typing gap."* There is nothing to type. A binding holds a
  **node**, and for `s := close` that node *is* the series. **Only 13 of 266** scripts
  refuse `pine:reassign` at all.
- **(d1)** — *"`alert()` is dropped whole."* It was already noted at top level; the gap
  was **depth**.

Each correction was made **in place, at every site that stated it**, because a sentence
quoted in two places is two authorities.

### 2. A census found a defect in work shipped the same day

(f) measured that (d2)'s **two "expression messages" are not expressions** — they are
string literals whose `+` sits *inside the quotes* (`…Grade A+ - Highest confidence…`).
The corpus holds **489 of 555** carryable and **zero** expressions.

⭐ The carriage was never wrong; **only its sizing was.** What the correction changes is a
fact about the guard: **`pine:alert-message` has zero corpus firings**, and only a
synthetic specimen exercises it. That is recorded rather than left for someone to cite
later as though the corpus had proved it.

⚰️ It is the **same instrument defect twice in one item**, and the second survived the
first correction. Both are *"ask the kind before the literal."* **Fixing one violation of
a rule does not find the others.**

### 3. Two member-facing sentences now name the cause, not just the line

A member whose `varip` accumulator stopped the fold was told *"a name that is reassigned
later cannot be folded into one expression."* True about the line it names, silent about
the cause — which was thirty lines earlier. The closing pass had **computed that reason
and never read it.**

Visible in a committed artifact for a real public script:

> `— \`resistancebroken\`` → `— \`resistancebroken\` — and the fold stopped before it, at
> line 181: a Pine block spans several statements and this engine stores a single
> expression — \`for\``

And three `syminfo.*` fields that were refused **anonymously** through a namespace
fallthrough now refuse **by name**, from the roster whose own manifest says *"the roster
is the thinking."* That fix is **three data entries and no code.**

### 4. What is owed is owed by name, and none of it is hidden

Fourteen rows in one table (`WAVE2-A-PLAN.md`), each with its number and its owner —
including four that belong to **other workstreams** and were recorded with reproductions
rather than crossed into: **BF.B** share-class normalisation, four disagreeing renderings
of today's volume, two vendors filling one `v` column, and the screener's second snapshot
endpoint.

### 5. Wave 1's tolerance has a blind half, and (j) must not inherit it

Wave 1 measured against a frozen `/api/bars` payload whose **last bar is `2026-09-11`** —
**every bar sealed**, which is exactly the half where the pane and screener lanes agree
*by construction*. (i) measured **three live divergence points**, plus **four different
renderings of today's volume inside the pane path alone.** An acceptance that reuses that
procedure unchanged would not exercise the developing bar at all.

---

## Verification

| leg | result |
|---|---|
| full vitest | **EXIT 1** — 1,493 files / 21,497 tests, 11 failed in 8 files, **0 NEW** |
| Python lane, 51 files **by name** | **EXIT 0** — 1,589 passed, 13 skipped, 1 xfailed |
| vite build, alone | **EXIT 0** |

All 11 failures are attributed to the branch's **own recorded baseline**
(`SESSION-STATE:458-466`) and the counts match it exactly.

### Re-verified after master merged in (`b854e75d0`, 223 commits, **zero conflicts**)

| leg | result |
|---|---|
| full vitest | **EXIT 1** — 1,568 files / 22,632 tests, **13 failed in 10 files**, 0 timeouts |
| Python twin, 25 files **by name**, 2 serial scopes | **EXIT 0** — 829 passed, 5 skipped, 1 xfailed |
| vite build, alone | **EXIT 0**, 21.25s — `dropped 36 prose keys, 99.6kB off the bundle` |

⭐ **The count matched the baseline and the SET did not** — two files left it and two
arrived, so a count comparison would have read "back to baseline" and shipped two
unexamined reds. Every one of the 13 is attributed and **none is owned by this
branch**: `surfaces/manifest.test.js` is **master's** (its `App.jsx` declares
`/admin/wisdom` and its surfaces manifest carries no row for it, so master alone is
red) and `stockChartWiring` is the known **intermittent**, re-classified by the rule
that costs a wrong attribution — clean tree, alone, twice, 216/216.

⚠️ One baseline row went green with **no commit touching it**
(`paramSingleTranslation`, previously classed OURS-DEFECT-OWED). Recorded as **cause
not established** rather than closed: "intermittent" and "fixed by something unnamed"
are different facts.

⚰️ The full run's wrapper reported **exit 0** because the command ended in a `grep`. The
verdict above is read **from the log file**. This repo has recorded that defect four
times; this is the fifth — **and the sixth happened in this session**, where a
background wrapper again said *"exit code 0"* for a run whose own log recorded
`VITEST EXIT: 1`, because the command ended in `echo`. A seventh variant was also
caught: `--reporter=basic` does not exist in this vitest, so the runner died at
reporter load **having executed nothing** and produced no totals line at all.

**Moved artifacts, by name:** `27-support-resistance-channels.json`.
**Unchanged:** `corpus_metric.json`, `lookback_agreement.json`.

---

## What is NOT in this PR

- **(j) Uncharted Clouds — j.1, j.2 and j.3a ARE IN; j.3b and j.4 ARE NOT.** The
  `23 → 2` drop was **two independent drops** and **both are closed**: j.1 got all 23
  outputs into the pane document with their **20 fills** (21 carried `hidden: true`),
  and **j.2 made a fill between two hidden anchors draw**, hosted on a visible bound
  series and fed from two columns — **R27 as AMENDED by measurement**: a hidden plot
  binds **no** series, because the fill primitive takes columns and borrows only the
  host's `priceToCoordinate`.
- **j.3a — a fill is drawn as RUNS (R30)** is in: `fillStyle` once per run, a `null`
  colour ends a run and starts no polygon, and the fill goes to `columnColorsForPlot`
  — the **same reader a plot goes to**, so there is no second colour path.
  ⭐ Segmentation is **two-level**: colour decides where `fillStyle` changes,
  finiteness decides where polygons split, so a STATIC band with an `na` hole is
  still one `fillStyle` over three polygons and the shipped call list cannot move.
- ✅ **j.3b(a) — the conditional-fill CARRIER — is in.** A `fill()` now carries
  `colorUp`/`colorDown`/`colorCondition`, read through the same `outputPresentation`
  call a `plot()` makes (R10 by construction). ⭐ A census of **254 fill colour
  positions across 325 files** measured that **no fold — narrow, narrow-plus-numeric
  or corpus-wide — would have carried anything**, because a fold resolves colours
  into a slot that did not exist: the binding constraint was the carrier, and its
  absence is why j.3a was built, tested, green and **unreachable**.
  ⚰️ **A conditional whose two branches fold to the SAME colour is DECLINED** — one
  hex with two transparencies would paint a flat band where the author drew a fading
  one — and the decline is **declared**, not silent.
  ⭐ Re-baseline **predicted 5 scripts / 7 fills, measured 1 / 1**: a source-text
  census bounds what *could* carry, never what *does*. The prediction is kept in the
  test rather than corrected away.
- ✅ **j.3b(b) — the pane door — is in (R34).** A conditional fill's
  `colorMode: 'column:<key>'` now names a synthetic hidden condition row, minted
  through the existing row shape and `evaluateFormula` — **no second evaluator**.
  ⭐ Rows are keyed by **canonical formula**, so Clouds' 20 fills over one
  `isBullish` produce **ONE** row, not twenty; the row is hidden (binds no series,
  R27 as amended) and goes when the last fill referencing it goes.
- ✅ **R33a — `color.new`'s base resolves by recursion**, like every other colour.
  An asymmetry removed, not a capability added: a bare NAME was already followed
  through its binding and `input.color` already recursed into its default, while
  `color.new`'s BASE asked a narrower question and never recursed. One call site.
  ⭐ **Re-baseline over 325 scripts (266 corpus + 59 OOS): SHAPE MOVES 0** — not one
  output count or refusal moved anywhere — **COLOUR MOVES 3 scripts / 15 positions**,
  all three inside the census's named 20, so **zero unpredicted moves**.
  ⚰️ **Predicted 20 scripts / +139 positions; measured 3 / 15, and the gap is the
  census's.** Its §5 is headed *"every script that would change"*, but it counts
  **source** colour positions: across the 12 unmoved scripts there are **308
  drawing-object colour sites against 63 plot/fill carriers**, and **10 of the 12
  have no `plot()` carrying a colour at all** — no colour rule can make a box or a
  label carry one. One more passes colour **positionally** (9 sites, zero `color=`)
  and folds perfectly but is never read, because reading a positional colour
  argument belongs to `outputPresentation`, not `staticColourOf`. **Sizing any
  further colour ruling against that census inherits the overstatement.**
- ⚰️⚰️ **R35 — TWO OF H.10's FIVE LEGS ARE STRUCK BY MEASUREMENT.** `Resolver.
  inlineUserFunction` (`pine.js:7321`) already **substitutes** user-function bodies
  into existing node kinds, so "a multi-statement body needs a 12th `NODE_TYPE`" is
  **false**: Clouds' own two-local-binding helper folds to **84** at layer 0 and
  **38.4** at layer 19 on the series path today. It accepts single expressions, N
  local bindings, `:=` and `if` blocks. ⭐ The error was mine and it is named: I
  measured the COLOUR path, found nothing, and generalised to the engine — *an
  absence is only evidence if the instrument could have seen a presence*, which
  applies to a code path as much as to a grep.
  ⛔ **The gap is narrower and different: a COLOUR-VALUED function result.** The
  Resolver refuses a colour **by name** (`pine:colour-value`) because it is a
  numeric/series resolver by construction, and `staticColourOf` has no user-function
  branch at all. Census (`tools/pine_user_fn_body_census.py`, 328 files, **1,412**
  user functions): **27** return a colour, **43** calls sit in a colour position,
  **4 scripts** — and **every one is a SINGLE EXPRESSION**.
- ✅ **R35c + R35d BUILT — Clouds' 20 fills carry per-layer colour** (`282107be8`).
  `staticColourOf` gained ONE branch: a single-expression user colour helper is
  substituted and re-walked, with substitution delegated to `resolveInFrame` and
  arithmetic to `constantValueOf`; `color.t` of a static colour folds beside it,
  **not** in the Resolver. Layers 0 / 10 / 19 = transparency **95 / 70 / 47.5**,
  derived in the test from the script's own constants. Clouds' pane document is now
  **24 rows — 23 authored + R34's ONE condition row**, which demonstrates R34 on the
  real script for the first time. Re-baseline over 269 scripts: **SHAPE MOVES 0**,
  colour moves 3 (Clouds predicted; both Volume scripts unpredicted, explained and
  pinned — an `input.int` alpha now folds to its default, so the disclosure is wider
  than `input.color`).
- ⛔⛔ **BUT IT MUST NOT SHIP YET: PARAMETER IDS SHIFT ON A LIVE SCRIPT.** On
  `uncharted-volume-v2`, making the opacity input foldable mints a parameter and
  renumbers what follows — `__uct_param_3` moves from *HVE lookback* to *Avg Vol
  Line Opacity*. **Parameter ids address saved member definitions.** R35c/R35d are
  complete, green and mutation-proved on this branch; whether they can land needs a
  ruling on parameter-id stability and, if required, a migration.
- 🛑 **R35c's 1.1 (superseded by the build above, kept for the record).** The bridge
  turned out to be a **shipped pattern one value-kind over** — `textNodeOf`
  (`pine.js:10041`) already inlines a user-fn call in a TEXT position, and
  `colorNodeOf` says in-file it is *"the same shape, one branch shorter"*. The frame
  chain composes on its own (measured: two-level → **7**, three-level → **15**).
  ⛔ **But `color.t` refuses `pine:colour-value`, and 5 of 5 colour helpers / 43 of 43
  call sites route through it** — so R35c alone carries **zero of four scripts**, which
  is machinery with no consumer and the exact failure H.10's leg 4 refused. Three of the
  four are `box`/`set_bgcolor` colours that cannot carry regardless; **Clouds is the sole
  consumer at 40 sites**.
  🛑 **R35d proposed:** `color.t` of a static colour folds to its transparency, as a
  `staticAlphaOf` beside `staticColourOf` — **not** in the Resolver, which must not be
  taught colours. The original `(i-C)` named this clause and my R35c proposal dropped
  it. **R35c + R35d land together or neither is worth landing** (150 + 45 min).
- ✅ **The `pine_oos` re-baseline hole is closed** — `oosMeasuredBaseline.test.js` +
  a committed 59-script artifact pinning outputs, **refusal guards in order** and
  colour-position counts, reported as a **set difference by name**, mutation-proved.
  ⛔ `pine.oosBaseline.test.js`'s own "NO RATCHET" design ruling is untouched; this
  sits beside it and supplies the measurement it lacked.
- ⛔⛔ **R33b STOPPED AS H.10 — `(i-C)` is `(ii)` by another name. Nothing was built.**
  ⚠️ **Legs 1 and 2 below are struck — read R35 above.**
  Five measured legs: `NODE_TYPES` is frozen at 11 with **no statement form**, and
  Clouds' numeric helper is two local-binding **statements** plus a return, so it
  needs a 12th node type or a walker outside the tree — both named STOP conditions;
  the machinery is **absent, not a delta** (even `f(x) => x * 2` as an alpha yields
  `colorDynamic` today, with **0 refusals** — parsing is not the blocker); `(i-C)`
  contains `(i)`'s user-function **colour** substitution, which is verbatim the
  census's definition of `(ii)`; the **in-scope reading carries nothing**, because
  Clouds' fills read `isBullish ? getBullFillColor(0) : …` and go through a user
  COLOUR function before any alpha, while **0** scripts have the direct shape a
  numeric-only fold would serve; and the blast radius, verified across **328
  scripts**, is **ONE** — Clouds, 2 call sites, the sole consumer of the entire fold.
  ⭐ So the fold is an **owner decision, not an engineering one**, and the carrier,
  the renderer and the pane door are all in and proven around it.
- ⛔ **The FOLD is NOT started, and the reason is a measurement.**
  Clouds' fills still carry **no** colour. The sentence below was written before this
  wave and is still exactly right — what is new is that it is now *costed*:
  `isBullish ? getBullFillColor(0) : getBearFillColor(0)` resolves to
  `{colorDynamic: true}` because `staticColourOf` has **no user-function branch** and
  `color.new(base, t)` refuses a non-literal `t` — the guard reading
  `if (t !== undefined && numberValue(t) === null) return null` — and Clouds' `t`
  is `getAdjustedTransparency(layerIndex, …)`. ⚰️ That guard was cited here as
  `pine.js:12359`, which pointed into a comment in the `name` branch; it is quoted
  rather than numbered now, because a line number is the one citation that goes
  stale without anyone touching it. Carrying it needs a **constant folder
  over user functions**, which is a parser change whose re-baseline reaches the
  corpus; the owner's standing corollary says such an atomic unit is not *started*
  mid-block. The four insertion points are pinned in `WAVE2-A-PLAN.md`.
- ✅ **j.4's MEMBER half is measured and tabled** — `docs/pine/j4-clouds-member-door.md`.
  **23 outputs / 0 refusals / 20 fills** into the pane document: 23 plots, **21 hidden
  anchors `out3`…`out23` chained into exactly 20 fills**, two visible MAs. **0 of 20
  fills carry a colour pair**, all 20 declare `colorDynamic` — the loss is *declared*,
  not silent — and **0 R34 condition rows are minted, which is R34 working**: no
  condition is carried because the fold is stopped at H.10.
  ⭐ A fill is a **property of the upper plot** (`fill: {with:'outN'}`), not a
  `definition.fills` collection; the first probe asked for the latter and would have
  published "the document carries zero fills" off a guessed field name.
- ⛔⛔ **The VENDOR capture is BLOCKED by a standing owner ruling, and one URL is owed.**
  `capture-procedure.md:463` retires the 19-study working chart and requires a dedicated
  scratch layout; the ruling arrived with a `<PASTE URL>` placeholder and **the layout id
  has never been recorded** — *"until it lands, every capture is blocked — deliberately,
  rather than falling back to the 19-study chart."* No capture was taken and **no
  comparison column is estimated**. And when it does run, **H.8's live-bar line is
  REPORTED, not asserted**: Wave 1's fixture ends at a sealed bar, so it cannot cover the
  live divergence.
- ⛔ **R29 — #145 STAYS DRAFT**, on two conditions that fail for different reasons:
  colour is outside tolerance **by construction** (the fold is an owner decision, not a
  defect), and "both tables at both tiers" was **never measured** (blocked on the owed
  URL). ⭐ Unmeasured is not failed — collapsing the two is the `CoverageLine` defect
  this repo already refuses.
- **Alert sets (d3)** — deferred beyond Wave 2 under **H.7**.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019qreemr6kQCvfBpHAsprZu
