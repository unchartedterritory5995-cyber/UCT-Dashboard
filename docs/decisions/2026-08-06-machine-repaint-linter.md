# Decision: the repaint badge is assigned by a machine linter, and the linter is not allowed to make an exception for us

**Status:** 🔴 **OPEN — MEASURED 2026-08-07 (the linter ran: 42 plots, `decided 1`, and the one it could read DISAGREES with the shipped badge) and RULED 2026-08-07. MEASURED, RULED and STILL OPEN are three different facts (§3.1, §3.2, §4.1).** The owner delegated the question (*"about the ichimoku, i have no idea. you decide."*) and the decision is taken: **the machine linter's `preview-repaints` reading for `ichimoku.chikou` is ACCEPTED** (§3.2, §4.1). **The badge has NOT moved**, because the owner's ruling is **PER-PLOT** (§4) and **nothing in shipped source renders a per-plot badge** — measured, §4.1. ⚠️ **`OPEN` here is a claim about the CODE, not about the decision**: this header is read as a biconditional against `nativeRegistry.js`, and `OPEN` means exactly *"the badge is still the shared default that no definition overrides and no plot carries."* That is true. It stops being true on the commit that ships the per-plot badge surface — and not before.

**Date opened:** 2026-08-06 · **Phase:** D · **Applied:** — · **Record of the measurement:** §10

## 1. The fact

`app/src/components/chart/engine/nativeRegistry.js` sets

```js
meta: { tier: 'free', repaint: 'non-repainting', ...meta },
```

inside `nativeDef` — **one shared helper that every native passes through**. No
native definition overrides it. Comment-stripped, every `repaint:` declaration in
the whole registry source is either that helper's or `rsLine`'s — and `rsLine` is
the one definition that does not go through the helper at all, so its
"declaration" is the helper's sentence retyped rather than an independent
judgement. The exact count is asserted, never restated here:
`enumerationSites.test.js` → *"⭐ the repaint badge is a shared DEFAULT, and this
record says so — the biconditional"*.

Spec §3 annotates the field:

> `"repaint": "non-repainting"` — Phase A/B: **audited metadata (UCT-authored
> only)**. Phase D: machine-assigned by AST linter.

**Measured, "audited metadata" is false.** It is a default. Nothing audited
anything; a helper filled a field in and every definition inherited the
answer. That sentence in the spec is the single most load-bearing untrue
sentence on this branch, because §10's brand position — *receipts, aimed at
burned-vendor customers* — is built on top of it.

And the badge is not merely un-audited, it is **contradicted by shipped code.**
`api/services/indicator_compute.compute_ichimoku_raw` writes

```python
chikou[i - displacement] = bars[i]["c"]      # displacement = kijun_period
```

— bar `i`'s close stored at index `i − 26` — mirrored exactly in
`app/src/components/chart/indicators.js::computeIchimoku`
(`chikou[i - displacement].value = bars[i].c`). So the point drawn at a
**historical** index is the **newest, still-forming** bar's close, and it moves
on every tick until that bar closes.

⛔ **The mechanism was known and pinned. Only the badge never noticed.**
`tests/test_indicator_golden.py` declares a per-column trailing-pad allowance for
exactly one (case, column) pair — `ichimoku`'s `chikou` — and its own comment
explains why the number is *declared rather than waived*: *"change the back-shift
and this goes red with the two numbers in hand."* A test has been holding this
displacement down for the whole life of the rule while the metadata beside it
said the indicator does not repaint.

## 2. What this record decides

Two things, and it is deliberately **not** an implementation:

1. Whether `ichimoku`'s badge changes, and at what granularity.
2. Whether the linter may ever carve an exemption for a UCT-authored indicator.

**Task 7 MEASURES; it does not re-badge.** A disagreement between the linter and
a shipped badge is a **finding for the owner**, never a badge edit, and the
values in `nativeRegistry.js` are Task 7's to change **only on a measurement**.
No task before Task 7 may touch them at all.

## 3. Three voices, and which governs

The tree currently says three different things about the same behaviour, and a
record that names only the one it likes is the shape this branch keeps shipping.

| voice | what it says about `chikou` | where |
|---|---|---|
| the definition's metadata | `non-repainting` | `nativeRegistry.js`, via the shared helper |
| the compute lane's own header comment | the back-shift is *"correct"* | `indicators.js`, "Three behaviours preserved EXACTLY" |
| spec §4 | *"Bar-close outputs must be reproducible from history alone; anything that can't be is labeled `repaints`."* | the compute contract |

**§4 governs, and the reason is that it is the only one of the three that is
DECIDABLE.** "Correct" is a plotting convention — the lagging line is *supposed*
to be drawn 26 bars back, and the comment is right about that. But the linter
this phase builds decides one question and only one:

> a formula repaints **iff** its output at bar `i` depends on any bar `j > i`.

`chikou[j]` is `close[j + 26]`. That is a forward reference by construction. It
is not a judgement call, it is not a matter of intent, and no amount of "but that
is what the indicator IS" changes the answer. A rule that bends for an indicator
whose displacement is intentional is a rule that bends for every vendor who
intended theirs too.

⚠️ **And the honest nuance, recorded rather than smoothed over.** `chikou` is not
repainting in the sense the word usually accuses: once bar `i` closes, index
`i − 26` is final and never revised. It is **known-late**, not
**revised-after-final**. The badge vocabulary has three values —
`non-repainting | preview-repaints | repaints` (spec §3) — and a reasonable
reader could argue `preview-repaints` is the precise one here. **That argument is
handed to Task 7 as an open question (§8), not settled by silence**, because a
vocabulary value nothing can ever emit is a value that does not exist, and today
`preview-repaints` is emitted by nothing at all.

## 3.1 The measurement — 2026-08-07, by machine, over the shipped catalogue

⛔ **THIS IS THE RECEIPT, AND IT LIVES IN THE REPO ON PURPOSE.** `.superpowers/`
is gitignored, so a number that lives only there does not exist. The block below
is **machine-readable and machine-checked in both directions**: the linter
rebuilds it from the shipped definitions on every run and compares, so a new
disagreement cannot arrive silently **and a recorded one cannot be quietly
resolved either**. Deleting a `disagreement` line here fails exactly as loudly as
adding one.

```
LINTER-MEASUREMENT-V1
definitions 17
plots 42
decided 1
undecidable-hand-written 41
verdict ichimoku.chikou preview-repaints forward=26
disagreement ichimoku.chikou shipped=non-repainting measured=preview-repaints
```

**Read `decided 1` before reading anything else.** Every shipped definition today
is hand-written JS or Python, and spec §11 explicitly forbids static analysis of
hand-written JS — so the linter **cannot assign 41 of the 42 plot badges at all**,
and it says so per plot rather than reporting a clean answer it did not earn.
*"The linter agreed with every shipped badge"* is therefore a sentence this
measurement makes **unwriteable**: the truth is that it could read one plot of
forty-two, and the one it could read disagrees.

The one decided row is not decided by reading `computeIchimoku`. It is decided by
a fact that was **already pinned before this task existed** and was handed in from
outside: `tests/test_indicator_golden.py`'s `TRAILING_PAD`, whose own comment says
*"change the back-shift and this goes red with the two numbers in hand."* The
Python lane reads that declaration; the JS lane **measures the artefact the
declaration describes** (the trailing null run in the committed golden fixture),
and the two agree on a number neither of them typed. A hand-copied `26` would be a
second declaration of one fact and would rot the day the pad moved.

⚠️ **What the linter is BLIND to, stated rather than discovered later.** It reads
what the manifest *declares* a function's window to be. A compute whose real
window is wider than its declaration would be branded on the declaration and the
linter would be wrong — and no analysis of the *tree* can see that, because the
tree does not contain the compute. That is a manifest-integrity question and it
belongs to the conformance lane, which runs both interpreters against the same
tree. It is exactly why the one native verdict above rests on a pinned external
fact instead of on a reading of the native's source.

## 3.2 D-1 answered: the linter emits `preview-repaints` for `chikou`, and here is why

**Chosen: `preview-repaints`.** Not as a softening — as the only one of the three
the machine can *prove*, and the one that keeps the other two meaning something.

The linter decides a trichotomy on one number, the tree's **forward reach**:

| forward reach | verdict | the sentence it licenses |
|---|---|---|
| `0` | `non-repainting` | every bar this output depends on is at or before its own index |
| a known finite `k > 0` | `preview-repaints` | it moves while bars `i+1 … i+k` form, and is **final the moment bar `i+k` closes** |
| unknown, or declared unbounded | `repaints` | **no bar after which the value is guaranteed final** |

`chikou`'s forward reach is exactly `26`, and `26` is a number the badge can put
in a sentence. That is the whole difference: `preview-repaints` can name the bar
after which the value settles, and `repaints` cannot.

**Three reasons this is the right call and not a hedge:**

1. **It is what §3 above already says is true.** `chikou` is known-late, not
   revised-after-final. A linter that called it `repaints` would be recording
   something the record itself says is inaccurate, on the one axis the brand is
   sold on.
2. **It makes all three values reachable, which is the record's own test.** §3
   warns that *"a vocabulary value nothing can ever emit is a value that does not
   exist"*. Brand every forward reference `repaints` and `preview-repaints` is
   that value; brand every forward reference `preview-repaints` and `repaints`
   becomes it. Under the trichotomy above, `repaints` is reached by a **declared
   unbounded** window and by the **fail-closed** branch, `preview-repaints` by a
   **bounded** one, and the corpus carries hand-derived cases for all three and
   asserts it.
3. **It costs the claim nothing.** Both values say *not `non-repainting`*, which
   is the load-bearing half. `ichimoku` is still the one indicator in the
   catalogue that a machine says does not qualify for the clean badge, which is
   precisely the owner's stated reasoning: *"one indicator visibly marked
   [repainting] is what makes the other sixteen credible."*

🔴 **AND THE RESIDUAL DISAGREEMENT IS RECORDED RATHER THAN ARGUED AWAY. The owner
ruled `repaints` (§4); the machine measures `preview-repaints`.** They agree on
everything that matters and differ on precision. **That is an owner decision, not
an implementer's**, and it is deliberately left standing:

- take the machine's word and `chikou` reads **`preview-repaints`** — the more
  precise claim, and the first thing in the catalogue ever to emit that value;
- keep the ruling and `chikou` reads **`repaints`** — the blunter claim, which
  costs the badge some accuracy and buys it some plainness with a burned reader.

**No badge moved either way.** Task 7 measures; §2 forbids it from re-badging, and
the enumeration ledger's biconditional would fail this record's own header if it
tried.

⚠️ **AND THIS QUESTION MUST GO TO THE OWNER TOGETHER WITH PHASE C's, BECAUSE THEY
ARE ABOUT THE SAME COLUMN.** Phase C measured that `ichimoku.chikou` *can never
fire closed-bar* — its 26-bar trailing pad makes the confirmed bar's value `None`,
so a user's Chikou alert stops permanently at the Phase C cutover
(`tests/fixtures/alerts/fire_diff_declared.json` carries that row and calls it
*"the one row of this diff a user will report as 'my Chikou alert broke'"*). One
column, two findings, one message: the badge question and the alert question have
the same answer shape and should not be asked a week apart.

## 4. The owner ruling — 2026-08-06 — PER-PLOT badges

**A badge is assigned per PLOT, not per definition.** So `ichimoku` reads:

| plot | badge |
|---|---|
| `tenkan` | `non-repainting` |
| `kijun` | `non-repainting` |
| `spanA` | `non-repainting` |
| `spanB` | `non-repainting` |
| `chikou` | **`repaints`** |

A per-definition badge cannot express this without lying in one direction or the
other: badge the whole of `ichimoku` `repaints` and four honest plots are
slandered; leave it `non-repainting` and the fifth is a false claim on the exact
axis the brand is sold on.

**The reasoning the owner accepted, recorded because the reasoning is the
decision:**

> A badge that every indicator wears carries no information. One indicator
> visibly marked `repaints` is what makes the other sixteen credible.

A uniform column is indistinguishable from an unset column, and today it *is* an
unset column. The first `repaints` in the catalogue is not a defect being
admitted — it is the moment the other badges start meaning something.

## 4.1 The ruling — 2026-08-07, at Phase D's close

**The owner delegated it and the decision is taken: `ichimoku.chikou` is
`preview-repaints`.** Not `non-repainting` (which is what ships), and not
`repaints` (which is what §4's table above wrote before the linter existed).

**Why `preview-repaints` and not `repaints`.** `compute_ichimoku_raw` writes bar
`i`'s close to index `i − kijun_period`, pinned by
`TRAILING_PAD = {("ichimoku_9_26_52", "chikou"): 26}`. The shift is **known and
finite**: the point at a historical index is *final the moment bar `i+26`
closes*. That is a sentence a badge can carry, and it is a different claim from
`repaints`, which this vocabulary reserves for a window that is **unknown or
declared unbounded**. It is also the only reading in which **all three
vocabulary values are reachable** — and this record's own test is *"a vocabulary
value nothing can emit is a value that does not exist."*

**Why the shipped badge is not merely imprecise but wrong.** The badge is
rendered to users in two places — the library dialog's row badge
(`indicatorCatalog.js` → `IndicatorLibraryDialog.jsx`) and the chip-about
popover on the chart itself (`StockChart.jsx`). A trader reading
`non-repainting` on `ichimoku` is being told the line will not move under them.
One of its five lines will. **Honest beats flattering**, and this is the exact
axis the brand is sold on.

### Why the badge did not move in the commit that took the decision

⛔ **Because the ruling is PER-PLOT and there is nothing to render it into.**
This is a measurement, not a hesitation. Taken at Phase D's close, over all of
`app/src` and `api/`:

| question | measured |
|---|---|
| what reads a **per-plot** `repaint`? | **nothing** — zero consumers in shipped source |
| what reads `meta.repaint`? | exactly two: `indicatorCatalog.js:97` → `IndicatorLibraryDialog.jsx:161`, and `StockChart.jsx:10803` |
| what granularity do both read at? | **per DEFINITION** |
| does `validatePlot` reject an unknown `plots[]` field? | no — a `plots[].repaint` would be **accepted and ignored** |

So the two available moves are both refused, and §4 above already refused them
in the owner's own words — *"a per-definition badge cannot express this without
lying in one direction or the other"*:

* **badge the `chikou` PLOT** → schema-legal, silently ignored by every surface.
  A badge no trader ever sees is not a badge; it would resolve this record's
  header while changing nothing a user is told.
* **badge the `ichimoku` DEFINITION `preview-repaints`** → visible, but it
  slanders `tenkan`, `kijun`, `spanA` and `spanB`, which the linter has not read
  and which are clean by construction. It also contradicts §4's ruling on
  granularity, which is the owner's, not a task's to overturn.

**So the scheduled work is the render surface**, and naming it is the
deliverable: a per-plot badge needs (1) a `plots[].repaint` field in
`defSchema`'s plot validation, (2) a consumer in `indicatorCatalog` that rolls
per-plot badges up to a row, and (3) a decision about what the definition-level
badge says when its plots disagree. None of those is a Phase D deliverable and
none should be smuggled into a closing gate.

⚠️ **The ALERT half of this finding is NOT here, and that is deliberate.**
`ichimoku.chikou` can never fire on a closed bar, so at Phase C's cutover its
armed rows must stay armed and surface as `needs_attention` with a
`state_detail` rather than going quiet. That is **Phase C Task 8's**, at the
cutover, and Phase D neither implemented it nor may. Recorded as
decided-and-scheduled in spec §11, row **D-A6**.

## 4.2 The render surface SHIPPED — and it moved no badge, which is why this header still says `OPEN`

**The scheduled work in §4.1 is built.** `ichimoku.chikou` now visibly carries
`preview-repaints` on the chart, its four siblings carry nothing, and sixteen of
the seventeen definitions carry nothing at all. What §4.1 named as three parts
shipped as three, with one substitution that is the whole design:

| §4.1 named | what shipped | why |
|---|---|---|
| (1) a `plots[].repaint` field in `defSchema` | **`plots[].forward`** — a WINDOW, in bars — and `plots[].repaint` is now **REFUSED BY NAME** | a badge is the linter's answer, never an author's claim |
| (2) a consumer that rolls per-plot badges up | `engine/repaintVerdict.js` — derives, caches, rolls up; nothing is stored | Task 10 already recorded that a stored verdict goes stale |
| (3) a decision about the definition-level badge when its plots disagree | `meta.repaint` is the **CLAIM**; the roll-up is the **MEASUREMENT**; a disagreement stays a finding | §2 forbids resolving one by editing the other |

⭐ **THE SUBSTITUTION IN ROW (1) IS THE POINT, NOT A DETAIL.** A plot declares
*how many bars ahead of its own index it reads* — the same three forms
`ast/closedTable.json` already declares per function — and `ast/lint.js` turns
that number into a badge through `modeFromReach`, the same three lines that
decide the `ast` lane. So the badge stays a **derivation** on every lane. A
`plots[].repaint` would have been the audited metadata §1 measured to have
audited nothing, one level down, and Task 15 measured that the field was already
**accepted and ignored** — writable, invisible, uncheckable. It is now an error.

⛔ **AND `chikou`'s NUMBER IS NOT TYPED TWICE.** `computeIchimoku` opens with
`const displacement = kijunPeriod`, so the lagging line's forward reach IS the
Kijun period — declared once in `nativeRegistry.js` and read twice, as the
input's default and as the plot's window. A test then ties that declaration to
the **artefact**: the trailing null run in the committed golden fixture, which is
the compute's own output and which `TRAILING_PAD` describes from the other lane.
Neither lane holds a literal, and moving the back-shift goes red in both.

### Why the `**Status:**` header did NOT flip

⚠️ **Because the biconditional's own terms are still true, and they are true by
CONSTRUCTION now rather than by coincidence.** The header means *"the badge is
still the shared default that no definition overrides and no plot carries."*
After this commit: `nativeDef`'s shared default is untouched, no definition
overrides it, and **no plot may ever carry a badge** — the schema refuses one.
What a plot carries is a fact about its maths.

That is not a loophole being walked through, and the difference is worth stating
plainly because it is exactly the shape this branch keeps getting wrong. The
clause was written as a probe for a plot-level `repaint` KEY; a change that
shipped a per-plot badge through a differently-named key while that probe stayed
green would be the *"structural guard misses behavioural clobber"* defect, and it
would be worse here than anywhere else. So the clause was made **stronger**
instead of side-stepped: `plotsWithOwnBadge` used to be empty because nobody had
written one, and is now empty because the registration door rejects one.

**What is still open is what §4.1 said was open and is not this task's:** the
badge on `ichimoku`'s DEFINITION still reads `non-repainting` while one of its
columns is measured `preview-repaints`. That is the recorded disagreement, it is
the owner's to resolve, and three rails in three files exist to keep it loud.
The chart no longer repeats the claim to a member — the About page prints the
measurement and nothing else — but `indicatorCatalog.js` still hands the library
dialog `meta.repaint`, so the row badge there is unchanged. **A per-definition
row badge that reads its plots' roll-up is the next piece**, and it belongs with
whoever owns that file.

⛔ **And the badge is still not a thing a task may edit to make a rail green.**
The biconditional in `enumerationSites.test.js` says so in its own failure
message, and it is right: a disagreement between the linter and a shipped badge
is a **finding**, and the finding survived — which was obligation #7 all along.

## 5. What the linter must be able to PROVE

⛔ **This section is the one Task 7's rail reads this record for.** It is written
as obligations on the linter, not as beliefs about the tree, because a record
that only says what we believe gives the rail nothing to check.

1. **Decidability, on the AST, with no execution.** For an `ast`-lane definition
   the linter must answer from the persisted tree alone. It may not run the
   formula, sample bars, or compare outputs — an empirical "we ran it and nothing
   moved" is a statement about one bar window, and the claim is universal.

2. **The forward-reference set, derived from the closed table.** For every entry
   of the closed table the linter must know the maximum forward index that entry
   can read, and that knowledge must come **from the manifest both lanes read**,
   not from a second list inside the linter. A per-function offset table
   maintained beside the manifest is a second grammar and it drifts silently —
   that is the ledger's whole subject matter.

3. **A positive control corpus that MUST be branded `repaints`.** Each case
   hand-derived, each with its reason written down, and the corpus's **own
   non-vacuity asserted**: a corpus in which every case is clean measures
   nothing. Minimum shapes: a negative index (`close[-1]`), a centred window
   (`highest(high, 5)` centred), and a future-offset series read.

4. **A positive control in the other direction.** The linter must brand at least
   one hand-derived formula `non-repainting`, or "it says repaints" is
   satisfiable by a linter that says `repaints` about everything.

5. **The guard-deleted control.** With the forward-reference check removed, the
   repainting corpus must come back **non-zero clean** — i.e. the linter must be
   demonstrated capable of getting it wrong. A gate that cannot fail is not a
   gate.

6. **NO EXEMPTION SURFACE, PROVEN STRUCTURALLY.** The linter must have no
   allow-list, no `author === 'uct'` branch, no id-keyed override, and no
   "known-good" set. This is provable by AST over the linter's own source (the
   set of identifiers it can resolve, the set of literals it compares an id
   against) — **never by grep**, which on this branch has counted comments in
   both directions. If an exemption is ever genuinely needed, it is a change to
   this record first and to code second.

7. **It must be able to disagree with us, and the disagreement must survive.**
   Running the linter over the shipped definitions is a **measurement**. Its
   output must be recorded in the repo (`.superpowers/` is gitignored, so a
   number that lives only there does not exist), and a disagreement with a
   shipped badge must be reportable **without** the reporter being able to
   silence it by editing the badge. The failure direction is "the finding is
   loud"; it is never "the badge was quietly corrected to match".

8. **Native and server lanes are in scope of the MEASUREMENT even though they
   are out of scope of the ASSIGNMENT.** Every shipped definition today is
   hand-written JS or Python, and spec §11 explicitly forbids static analysis of
   hand-written JS. So the linter cannot *assign* their badges. What it must
   still do is state, per definition, **whether it was able to decide at all** —
   `decided` / `undecidable-hand-written` — because "the linter agreed with every
   shipped badge" is a sentence that must be impossible to write when the truth
   is "the linter could not read any of them". The definition count itself is
   asserted by `indicatorCatalog.test.js` and is deliberately not written here.

9. **Per-plot granularity must be expressible before any badge moves.** §4's
   ruling is per plot; today `meta.repaint` is per definition and no plot carries
   its own badge. The linter's output shape must be
   `(defId, plotKey) → badge`, and the schema must be able to hold that, or the
   ruling cannot be applied without lying.

## 6. What this record does NOT decide

- **It does not change any badge.** No task before Task 7 may edit
  `nativeRegistry.js`'s `meta.repaint`, and Task 7 may only do so on a
  measurement.
- **It does not decide `preview-repaints` vs `repaints` for `chikou`.** The owner
  ruled `repaints`; §3's nuance is recorded so that Task 7 answers it explicitly
  rather than inheriting it.
- **It does not decide the schema migration.** Moving from a per-definition
  `meta.repaint` to a per-plot badge is a schema change with a read-back and a
  stored-blob story, and it is not this record's to design.

## 7. The gate that currently forbids the truth

⛔ **`indicatorCatalog.test.js` asserts the badge is uniform.** Inside *"and
adding them did not break registration — every definition still validates"* it
loops the whole registry and demands `d.meta.repaint` equal `'non-repainting'`
for every definition.

So today:

- a genuinely repainting indicator badged `non-repainting` passes **every test in
  the suite**, and
- an honest `repaints` declaration is **BLOCKED BY A TEST**.

That is a gate that forbids the truth, and it is worth being precise about the
failure it represents. The assertion is not wrong about *today's tree* — every
definition really does say `non-repainting`. What it does is convert a
**measurement** ("they all happen to agree") into a **requirement** ("they must
all agree"), and the two are indistinguishable in a green suite. It is the same
shape as `mergeChartSettings`' allow-list and as the four `phase`-fated ledger
rows: a control that goes on passing after the thing it described stopped being
true.

**Task 7 owns that line**, and it must be replaced rather than deleted — the
honest successor is *"every definition's badge is one of the three declared
tokens, and the set of definitions badged `repaints` equals the linter's finding"*,
which is a claim that can go red in both directions. Deleting it outright would
retire a control and put nothing in its place, which is the retirement shape B5
Task 13 spent a task avoiding.

## 8. Handed forward, explicitly

| # | question | owner |
|---|---|---|
| D-1 | `chikou`: `repaints` (ruled) vs `preview-repaints` (precise) — and is `preview-repaints` reachable by anything at all? | Task 7 |
| D-2 | Per-plot badge in the schema: new field, migration, read-back | Task 7 + the schema task |
| D-3 | `indicatorCatalog.test.js`'s uniformity assertion — replaced, not deleted | Task 7 |
| D-4 | The other sixteen: are any of them also forward-referencing, and can the linter even say? | Task 7 (measurement) |

## 9. How this record is held down

⚠️ **A record whose only content is a sentence is a control that inverts
silently.** B4 shipped `stillOpen: true` for the `engineEnabled` record; the day
somebody was allowed to resolve it, the one available response was to edit `true`
to `false`, after which the clause asserted nothing at all. That is documented in
`enumerationSites.test.js` and it is not repeated here.

So this record's `**Status:**` header is read as a **biconditional against the
code**:

> the record says `OPEN` **⟺** the badge is still a shared default that no
> definition overrides and no plot carries

- resolve this record while the badge is still a uniform default → **red** (the
  decision claims to be answered while nothing it decides has moved);
- re-badge anything, or add a per-plot badge, while this header still says
  `OPEN` → **red** (the code answered a question the written decision still calls
  open — which is exactly how `engineEnabled` became something six sites read and
  nobody had chosen).

The assertion is `enumerationSites.test.js` → *"⭐ the repaint badge is a shared
DEFAULT, and this record says so — the biconditional"*. The numbers it holds live
there and are deliberately **not** restated in this section: a doc that copies a
test's expectation is a control that rots green, and this programme has suffered
that exact rot twice.

## 10. Baseline, by command

⚠️ **`.superpowers/` is gitignored**, so the numbers the phase is measured
against have to survive in the repo or they survive nowhere. These are the plan
header's five commands, re-run on this tree at the start of Phase D. **They are a
dated measurement, not a target and not a test expectation** — every later task
compares against these, never against the plan's.

Measured 2026-08-06 on `feat/phase-c-alerts`, working tree at `c083a037` plus the
in-flight edits listed in §12. Exit codes are read **bare**, never through a pipe.

| # | command | bare exit | measured |
|---|---|---|---|
| 1 | `cd app && npx vitest run` | `1` | **Tests 3 failed \| 5813 passed (5816)**; Test Files 2 failed \| 509 passed (511) |
| 2 | `PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_indicator_compute.py tests/test_indicator_golden.py -q` | `0` | 123 passed |
| 3 | `PYTHONDONTWRITEBYTECODE=1 python -m pytest -k signature -q` | `0` | 314 passed, 10180 deselected (733 s) |
| 4 | `python tools/alert_replay.py --check` | `0` | **FIRE LOG MATCHES** |
| 5 | `python tools/alert_replay.py --diff --mode-a forming --mode-b closed` | `0` | **EVERY DIFFERENCE IS DECLARED** — declared rows 61, undeclared groups 0, over-budget groups 0 |

⚠️ **Read the `Tests` line, never `Test Files`.** vitest prints
`Test Files N passed` **before** `Tests M passed`, and a control that reads the
first number under-reads its own baseline by an order of magnitude and can bless
anything.

⛔ **The three reds in command 1 are NOT this tree's committed state.** All three
are attributable to another agent's uncommitted working-tree edits and none of
them is a Phase D regression:

| failing test | attributed to |
|---|---|
| `enumerationSites.test.js` → *"⭐ and the legend's three-part indicator enumeration is GONE — all of it"* | the uncommitted `StockChart.jsx` edit — the call shape the case asserts is present at `HEAD` and absent in the working tree |
| `stockChartWiring.test.jsx`, the hidden-instance legend case | the same in-flight legend/readout rework |
| `stockChartWiring.test.jsx`, the MACD instance-colour chip case | the same — chips render twice while the new legend module lands |

The attribution for the first is a **measurement**, not an inference:
`git show HEAD:app/src/components/StockChart.jsx` contains the asserted call
shape exactly once and the working-tree file contained it zero times at the
moment of the run.

⚠️ **The two foreign rows are named by description, not by the
`` `file` → *"title"* `` citation form, and that is deliberate.** That form
promises a **verbatim** title and is checked as one (`enumerationSites.test.js` →
*"⭐ every test title the decision record cites verbatim is a title that exists"*).
Citing an in-flight test owned by another agent would make this record red the
next time they rename it — which is exactly what happened while this record was
being written, and is how the rule was learned rather than assumed.

⛔ **AND THE TREE MOVED DURING THIS TASK, WHICH IS ITSELF PART OF THE BASELINE.**
Between the run above and the commit, the legend/readout agent landed its work:
the `enumerationSites.test.js` failure cleared on its own, a
`stockChartWiring.test.jsx` title changed under the citation rail (which is how
the rail proved it was not vacuous), and both `stockChartWiring` failures went
away. **A baseline taken on a tree three agents are writing to is a snapshot, not
a constant** — the §12 ownership list is what makes it readable, and any later
comparison must re-derive that list from `git status --porcelain` rather than
from this table.

### 10.1 — the number a later task should actually compare against

Command 1 re-run at the **end** of this task, on the tree the next task inherits:

| command | bare exit | measured |
|---|---|---|
| `cd app && npx vitest run` | `0` | **Tests 5834 passed (5834)**; Test Files 512 passed (512) |

⛔ **Use this row, not the one above.** The three reds in §10 belonged to another
agent's mid-flight edit and are gone; carrying "3 known reds" forward would have
handed every later task a licence to ignore three failures that no longer exist.
The delta (5813 → 5834) is three foreign failures clearing, four cases this task
added to `enumerationSites.test.js`, and other agents' new cases landing in the
same window — it is **not** attributed here beyond that, because attributing it
precisely would require a tree that stopped moving, and it did not.

The other four commands were re-run after this task's edits and are unchanged:
`--check` **FIRE LOG MATCHES** (exit 0) and the two indicator suites **123
passed** (exit 0). This task changed no Python and no production code, so an
unchanged result is the expected one and its absence would have been the finding.

⛔ **Command 4's total is the WORKING TREE's, not the frozen one.** The alert
corpus is mid-extension by another agent, so `tests/fixtures/alerts/fire_log_forming.json`
in the working tree holds **11** fixtures. The frozen total the Global Constraints
name is read from `git show HEAD:tests/fixtures/alerts/fire_log_forming.json`,
which holds **4** fixtures and the fire total the plan pins. Both were read; they
are different artefacts and conflating them would have made this baseline a
fiction.

## 11. Known-red on the inherited tree

⚠️ **`Calendar.realModal.test.jsx` was recorded the WRONG WAY ROUND on two
consecutive days**, so the rule is: run it **both** standalone **and** in the full
suite before calling anything a regression. Measured today, both ways:

| how | bare exit | result |
|---|---|---|
| standalone, `npx vitest run src/pages/calendar/Calendar.realModal.test.jsx` | `1` | **1 failed \| 5 passed (6)** — *"a slow real enrichment-batch fetch still lands in the modal once it resolves"*, `TypeError: Cannot read properties of null (reading 'clearRect')`, plus 2 unhandled errors |
| inside the full suite | — | **✓ 6 tests passed** |

*(That table is the measurement **as taken at the start of this task**. It is kept
because §11.1 is about how it was misread; the defect behind it is fixed below and
the file is green both ways now.)*

### 11.1 — the "deterministic" reading was WRONG, and then the bug was fixed

⚠️ **This section originally ended here, calling the failure "deterministic
standalone" on five-for-five runs. That was true of those five runs and FALSE as
a description of the defect** — re-measured a few hours later on a quieter box it
was **2 of 6**. A load-dependent race read as deterministic because every sample
was taken under load. Recorded rather than quietly rewritten: this record's whole
subject is a claim that outlived its measurement, and it very nearly shipped one
of its own.

**Root cause, found by reading the stack instead of the symptom:** it was never a
Calendar bug at all. jsdom ships **no canvas implementation**, so
`HTMLCanvasElement.getContext('2d')` returns `null`. ECharts/zrender never check
— `Layer.initContext` does `this.ctx.dpr = …` and `doClear` does
`ctx.clearRect(…)`, both on `null`:

```
TypeError: Cannot set properties of null (setting 'dpr')
  ❯ Layer.initContext  zrender/lib/canvas/Layer.js:80
  ❯ ECharts._onframe   echarts/lib/core/echarts.js:311   ← a requestAnimationFrame tick
TypeError: Cannot read properties of null (reading 'clearRect')
  ❯ doClear            zrender/lib/canvas/Layer.js:245
  ❯ ECharts.dispose    echarts/lib/core/echarts.js:876   ← teardown
```

Both throws come off an **rAF loop and off `dispose()`**, so whether they land
inside a test is pure timing — and vitest attributes an unhandled error to
whichever test is in flight. That is why it wore a Calendar costume, why it moved
between "deterministic" and "intermittent" with machine load, and why it was
recorded the wrong way round on two consecutive days.

**Fixed** in `app/src/test-setup.js` — a 2D-context shim in the same
*"Browser API shims missing from jsdom"* section that already supplies
`matchMedia`, `EventSource`, `IntersectionObserver` and `ResizeObserver`. It is
the same class of gap, and it was simply missing.

| measurement | result |
|---|---|
| `Calendar.realModal.test.jsx` standalone, **with** the shim | **8 / 8 green**, zero unhandled errors |
| the same file, **shim neutered** (positive control) | **7 / 10 red**, every red carrying the canvas-null TypeError |
| full suite, after the shim | exit `0` — **514 files / 5870 tests, all passing** |

⛔ **The positive control is the part that makes this a fix rather than a
coincidence.** "It stopped failing" is what every flake says on a quiet
afternoon. Removing the shim and watching the same two TypeErrors come straight
back — 7 times in 10 — is what says the shim is the cause and not the weather.

⚠️ **And the first draft of the shim carried its own defect, caught by
measuring.** It detected jsdom's missing canvas by *probing*
(`createElement('canvas').getContext('2d')`), copying the `if (!window.matchMedia)`
idiom above it. But the probe **is** the call jsdom complains about, so it emitted
one `Not implemented: HTMLCanvasElement's getContext()` line **per test file** —
exactly **514** for 514 files. The probe was removed and the precondition written
down instead; noise went 514 → **0**, because after the shim jsdom's stub is never
reached at all.

⛔ **So "Calendar.realModal is the known flake" was never a usable sentence, and
it is now not a true one either.** The file is green both ways. What replaces it:
*a test that fails only sometimes, only under load, and only via an unhandled
error is reporting somebody else's missing browser API — read the stack before
naming the suite.*

## 12. Ownership at the time of measurement

Derived from `git status --porcelain` immediately before the run — never from a
plan, because that list went stale three times in Phase C. These paths were held
by other agents and were **read, never written**, by this task:

- `app/src/components/StockChart.jsx`
- `app/src/components/chart/engine/readout.js`, `readout.test.js`,
  `__tests__/legendFromDefinitions.test.jsx`, and the new
  `app/src/components/chart/legend/`
- `tools/alert_replay.py`, `tools/alert_corpus_*.py`,
  `tests/test_alert_replay.py`, `tests/test_alert_shadow.py`,
  `tests/fixtures/alerts/*`, `docs/runbooks/alert-replay-gate.md`

This task wrote exactly two files:
`app/src/components/chart/engine/__tests__/enumerationSites.test.js` and this
record. It changed **no** production code, and in particular it did not touch
`nativeRegistry.js` — the badge values are Task 7's, on a measurement.
