# Pine Script Parity Programme

**Goal, verbatim from the owner, 2026-09-21:**
> "A fully capable pine script system that I can paste code and have the same
> exact identical indicator on UCT as it looks on TradingView… I want to
> recognize 0 differences in the scripts compared to tradingview. I want all
> codes of pinescript to be able to be recognized and replicated and shown on
> our charts."

**Scope:** full Pine v6 language surface + `strategy()` + user libraries
(`import`). Not a subset. Not the "indicators I use daily" version. The whole
ecosystem, minus one deliberate carve-out named in Phase 3.

**Working mode:** everything ships behind local flags first
(`VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`, `VITE_PINE_MEMBER_PANE_ENABLED`,
plus one flag per new capability). Nothing reaches production until the
paste-into-chart demo of a real script draws identically to TradingView
side-by-side. The local dev loop (`scripts/hub_sandbox_boot.py --port 8000` +
`cd app && npm run dev`, both env flags on) is the daily rhythm.

---

## ⭐⭐⭐ 2026-09-22 — THE SELECTION RULE CHANGED, AND THE METRIC MOVED

> **Pick the guard that COMPLETES a script, not the one that blocks the most.**

Ten waves picked work off the first-blocker census — guards ranked by how many
scripts they block — and moved `draws end to end` by zero every time. Measured
with `guardUpperBound.measure.test.js`, the three LARGEST rows in the object
lane are each worth **exactly nothing**:

| guard | scripts it refuses | gain if solved PERFECTLY |
|---|---:|---:|
| `runtime:declaration` | 35 | **0** |
| `runtime:statement` | 15 | **0** |
| `pine:builtin` | 14 | **0** |
| `runtime:colour` | **3** | **+1** |

`runtime:colour` refuses three scripts and was worth one, because for one script
it was the **last** wall rather than the first. Building it took the corpus from
**1 to 2 scripts drawing end to end** — the first movement on this programme's
product metric, after ten honest zeros (`850c22593`).

⛔⛔ **A FIRST-BLOCKER CENSUS CANNOT SEE THIS, BY CONSTRUCTION.** A build stops at
the first refusal, so a script with nine walls reports only its first, and the
guard standing between it and working is invisible until the other eight go.
That is what "first blocker" *means*; it is not a flaw to fix in those censuses.

### The instrument that replaces the queue

`nearestToWorking.measure.test.js` (`fcf682f46`) prints every script within 12
walls of building, its FULL wall set, and the union as a work queue. Read it
**with** `guardUpperBound`: this one says what is CLOSE, that one says what a row
is WORTH. Both share one peeler (`peelToBuilding.js`), mutation-proved.

### Today's shipped work, and what each one actually bought

| commit | change | product effect |
|---|---|---|
| `2c204a21b` | `splitMethodName` splits at the LAST dot — a drawing in a UDT field is addressable | +6 object-pass ops in 3 scripts, recovered from a SILENT drop (every diagnostic counter read zero). Drawing metric unchanged. |
| `850c22593` | `na` is a colour — `cond ? colour : na` | **draws 1 → 2**, builds 2 → 3. Also closed a silent wrong number the other way: `plot(cond ? color.red : na)` compiled and drew a packed colour as a price. |
| `fcf682f46` | the `nearestToWorking` queue instrument | none directly; it is how the above was chosen |
| `01ef1fd76` | `ta.valuewhen` — occurrences, not a bar window | 377 sites / 39 scripts no longer walled here. Metric unchanged — see below. |

### ⛔ `ta.valuewhen` moved a wall rather than removing one, and the sizer said it might

`liquidity-pools` was two walls out and `pine:function` was sized at **+1 AT
BEST**, with that file's own header warning "a correct implementation will very
likely reach fewer". Measured after shipping: the script's guard **moved** from
`pine:function` to `runtime:call-windowed-state`. `ta.crossover(high, LSH)` over
a runtime-stateful series "needs the series bridge" — a pre-existing
architectural gap this work newly *reaches* rather than one it caused.

⭐ **So the named next wall is the SERIES BRIDGE**: a windowed builtin
(`ta.crossover`, `ta.sma`, …) fed by a value this lane computes at runtime
rather than by a committed column. It is now the blocker for the nearest
script in the corpus, and it is architecture, not vocabulary.

### Still open with the owner

1. **The ATR seed** (below, §"THE ATR SEED"). Recommendation unchanged: give
   Pine its own seeding and leave Wilder's original everywhere else. `ta.valuewhen`
   just shipped as exactly that shape — a vendor twin beside a house function —
   without touching the screener's columns, which is the evidence that the
   pattern works.
2. **W4 capture** — written, self-checked, blocked on the TradingView session.

---

---

## ⛔⛔ READ THIS BEFORE PLANNING FROM ANY TABLE BELOW — measured 2026-09-21

> **The runtime-lane census is NOT the product's question, and this programme
> was sized against it.**

Every first-blocker table in this document counts `buildRuntimeIr`. **A member
does not see a compiled IR; a member sees a drawing.** The product path is
`buildObjectLane`, and measured over the same 266 scripts it draws **2**:

    node node_modules/vitest/vitest.mjs run       src/components/chart/engine/runtime/__tests__/objectLaneCensus.measure.test.js

⭐⭐ **`2 of 266`, and agent C's whole wave did not move it** — the same two
scripts before and after, re-verified in the integrator's session by reverting
its two source files to `acc9d8c57` and re-running the census. Meanwhile the
runtime-lane census moved 8 → 12 compiled. **Two numbers, one of which is the
member's.**

⛔ **Where the drawing actually dies — roughly half the corpus is refused by the
OBJECT PASS before the runtime lane is consulted at all:**

| n | guard | lane |
|---|---|---|
| 23 | `pine:character` | objects |
| 13 | `objects:nothing-drawn` | objects |
| 13 | `pine:declaration-strategy` | objects |
| 11 | `pine:block` | objects |
| 11 | `objects:iterated-tree-not-last-bar` | objects |

⛔ **CONSEQUENCE FOR THE PHASES, and it is not a small one.** Phase 2 (the
named-vocabulary sweep) is a RUNTIME-LANE queue, so on this evidence it will
close guards and move **no member-visible drawing**. The four largest
product-path blockers are all object-pass work, and `pine:character` at the top
of both tables is Phase 3. **Phase 3 should be pulled forward; Phase 2 should be
re-justified against the object-lane table or re-scoped.** That re-plan is owed
and is deliberately NOT written in here yet — recording the measurement is not
the same as having decided what to do about it.

### ⭐⭐ AND THE TOP ROW IS ONE CAPABILITY, NOT 23 PROBLEMS — read 2026-09-21

`pine:character` — *"Pine has no character like this one"* — is the largest
row in BOTH tables and the name is actively misleading. Opening all 23 call
sites with the new instrument:

    GUARD=pine:character node node_modules/vitest/vitest.mjs run       src/components/chart/engine/runtime/__tests__/objectLaneCallSites.measure.test.js

**Every one of the 23 is the same construct** — a member access on the result of
an expression:

    htfFVGs.first().area.delete()          k._box.pop().delete()
    imbalanceLab.get(x).set_textcolor(…)   Candle.new().create()
    array.get(levelGlow1Lines, i).set_x2(…)   (l[1]).delete()

Minimal repro, measured:

| source | result |
|---|---|
| `a.size()` (name . member) | fine |
| `array.new_float(1).size()` (CALL . member) | **`pine:character` at the `.`** |
| `(a).size()` (paren . member) | **`pine:character` at the `.`** |

⛔ **The lexer only accepts `.` when the preceding token is a NAME**
(`lexerGaps.test.js` documents the spaced-dot and newline cases around it).
Pine allows postfix member access on any expression. So this is **one lexer +
parser + lowering job worth 23 scripts**, the biggest single item in this
programme — and it read as an encoding problem for as long as nobody opened
the call sites.

⚠️ **This is the third time a row has been sized without reading it**
(`[` was 15 tuple destructures and 1 history read; `pine:input-kind` was a
`group=` label). The instrument above exists so it is the last. **A count is a
prompt to go look, never a sizing.**

⭐ Agent C's own words, which is the sentence that earned this block:
*"The brief's implicit model — 'clear census rows ⇒ scripts draw' — is not
supported by measurement."*

⚠️ **This does not retire the runtime-lane tables.** Value correctness is real
work and a drawing script needs BOTH lanes. It retires using them **alone** to
decide what to build next.

---

## ⭐⭐ WAVE RESULTS 2026-09-21/22 — three lanes, and the CEILING nobody had measured

Three agents ran against the object pass and the lexer. **All three moved their
rows. None moved "draws end to end".** It stayed at 2 of 266, the same two
scripts, through every merge — and the reason is now measured rather than
guessed.

### ⛔⛔ THE DENOMINATOR WAS WRONG. Only **190 of 266** scripts contain a drawing call.

```
node node_modules/vitest/vitest.mjs run   src/components/chart/engine/runtime/__tests__/objectLaneDrawerCensus.measure.test.js
```

76 scripts (29%) carry no `line|label|box|table|linefill` constructor at all —
they are plot-only indicators. `OBJECT_FAMILIES` is five families and a `plot()`
is not one of them, so **nothing that is ever built can make those draw.**
"2 of 266" is really **2 of 190**.

⭐⭐ **TWO AGENTS REACHED THIS INDEPENDENTLY, BY DIFFERENT MATCHERS, AND IT WAS
RE-VERIFIED IN THE INTEGRATOR'S SESSION.** It is the single most useful number
this programme has produced, because it retires a whole way of choosing work.

### ⛔ A ROW'S SCRIPT COUNT IS NOT ITS UPSIDE — ask how many of its scripts DRAW

| row | scripts | drawers | verdict |
|---|---|---|---|
| `objects:no-objects-in-source` (was `nothing-drawn`) | 13 | **0** | the engine is RIGHT, permanently |
| `pine:module` | 6 | **0** | correct refusal — library `import`; closing it needs a vendored library corpus and moves the metric by 0 |
| `pine:state` | 7 | **1** | six are plot-only; ceiling of one script |
| `objects:iterated-tree-not-last-bar` | 10 | **10** | every one a real drawer — where the value is |

A row of 13 that cannot move the number outranks nothing. **Measure drawers
before opening a lane.**

### What the three waves actually bought

| wave | row | result |
|---|---|---|
| postfix member access | `pine:character` 23 → **0** | `host_ok` 32 → **35**; all 23 met a second blocker |
| create inside a collection call | `pine:no-output` 9 → 7 | 4 scripts cleared the object pass; `order-blocks` compiles 22 ops where it compiled none |
| per-row scoping + exact split | `iterated-tree-unbounded` 3 → 0 | 4 scripts reached the runtime lane; `nothing-drawn` split into an exact terminal guard |

### ⛔⛔ THE NEAR-MISS — the lexer fix ALONE would have shipped a wrong drawing

Two readers recognise a statement by its FIRST token and take the first `(` as
the whole call. Measured before/after:

```
box.new(<series args>)            -> ops ["create:box"]              correct
box.new(<series args>).delete()   -> ops ["create:box"]              WRONG
```

**The delete vanished, with no diagnostic** — a box on a member's chart forever,
drawn by a line their script says to remove. Span guards now require the call to
cover what those readers read, and that rail is the load-bearing section of
`postfixMember.test.js`.

### The next three lanes, each DERIVED from a measurement

1. **UFCS — `coll.get(i)` ⇒ `array.get(coll, i)` for a declared collection.**
   The dominant receiver among the 23 is the name-form method call
   (`imbalanceLab.get(x)`, `htfFVGs.first()`, `k._box.pop()`), and this engine
   has **no method-form support at all**. Postfix member landed on top of a
   missing capability; this is what unlocks those receivers.
2. **`runtime:object-op` — a drawing used as a VALUE.** The single refusal
   standing between the collection idiom and a drawing, reached by a minimal
   synthetic script and nothing else. It is in `pineRuntimeFrontend`, not the
   object pass.
3. **Per-bar iteration storage.** `vm.js` allocates `iters` ONCE for the whole
   run, `ITER_SLOTS` long, indexed by counter alone — there is no bar
   dimension. That is the whole of what stands between the 10 remaining
   iterated-tree drawers and the object pass, and it is a memory-scale
   decision, not a lane fix.

---

## ⭐⭐ THE ATR SEED — settled, half-shipped, and the other half priced

**Measured at the vendor 2026-09-21** (`seed-warmup-spy-12m-2026-09-21.json`):
TradingView emits `ta.atr(n)` at **bar n-1**, seeded as the mean of the first n
true ranges where bar 0 counts as `high - low` (`ta.tr(true)`). Ours emits at
bar n. Same recurrence, two seeds; the delta decays by exactly (n-1)/n.

### ✅ SHIPPED — the request path
`ta.atr` inside a `request` took a separate desugar that built its true range
from a bare `close[1]`, `na` on bar 0. So `ta.atr` would have meant one thing in
a request and another everywhere else. Fixed, and railed structurally (no
harness executes a request, only builds its IR). **The mutation of that desugar
had survived every behavioural test in the file** — the path had no coverage.

### ⛔⛔ OPEN — the host/columnar path, and it is NOT a one-line change
Routing Pine to a separately-seeded column **was built and reverted**. It works:
`ta.atr(5)` matched the vendor at **delta 0** across the captured series. What
stopped it:

| | |
|---|---|
| declaring a name in `closedTable.json` | the **Python lane** mirrors that table in `api/services/ast_interpret.py`, and `screenerColumns.test.js` **freezes those columns for it to read** — so a Pine script's screener column changes name with no Python implementation behind it |
| measured cost of the attempt | **23 new failures**: manifest count pins, the sentence round-trip, the vendor-note roster, the corpus snapshot, the frozen screener columns, the formula reference |
| re-seeding the SHARED column instead | **worse** — it moves ThinkScript's `ATR`, the native ATR and ATR-bands indicators, and the pattern engine's ATR levels, which the firm trades on |

⭐ **So the ruling stands and is recorded rather than quietly deferred:** Pine
gets its own seeding, Wilder's original stays everywhere else — and doing that
in the host lane is a **Python-lane + screener-contract job**, not a Pine job.
Scope it as one piece: a `_fn_atr_pine` twin, regenerated screener-column /
corpus / formula artifacts, and the count pins. Until then the host lane keeps a
one-bar warm-up difference that `closedTable.json`'s `vendorNote` already
discloses honestly and that is 4e-12 by bar 300.

⚠️ **GATE NOTE.** `stockChartWiring > A HOVER REACHES THE RENDERER NOT AT ALL`
is **INTERMITTENT, not merely load-sensitive** — it failed ALONE after passing
alone three times the same day, and fails alone at HEAD with the change
reverted. For that one case "re-run it alone" is not a discriminator; establish
it by reverting and re-running.

---

## ⭐⭐ WAVE 2 — three lanes, TWO REAL DEFECTS, and a fourth honest zero

Merged 2026-09-22: per-bar iteration storage, drawing-as-a-value, method-form
(UFCS) calls. Gated together, 0 NEW failures.

⛔⛔ **`draws end to end` is STILL 2 of 266.** Fourth wave running with no
movement in the product metric, and the reason is now measured rather than
guessed: **a capability is a SECOND wall almost everywhere.** The UFCS lane
measured its own: of 37 corpus scripts using method-form calls on a declared
collection, **36 die earlier on something unrelated** (`pine:module` ×10,
`runtime:udt` ×10, `runtime:declaration` ×10, …). Clearing one wall reveals the
next one.

### ⭐⭐ The two findings worth more than the headline capabilities

**1. A LIVE SILENT WRONG NUMBER, on the branch point.**

```pine
a = array.new_float(0)
for i = 0 to 3
    array.push(a, close)    // plot(array.size(a))  ->  4   correct
    a.push(close)           // plot(array.size(a))  ->  0   WRONG, and no refusal
```

The same program, two spellings, two plotted numbers, **neither refusing**.
`mutatorTargets` matched the TOKEN `array.push`; the method form arrived as
`a.push`, so the write was invisible and the read folded anyway. Verified after
the merge: both spellings now answer 4.

**2. AN UNCOUNTED SILENT DROP in the object pass.** A method-form statement was
dropped with an EMPTY `unsupported` ledger — the `box.new(…).delete()` class.
Written as a binding, the lane answered OK and drew a box whose setter had
disappeared. Now counted by name.

### ⭐ Per-bar iteration cost nothing, because the question was wrong

The costing rejected every storage option **on measurement**: FULL cross-product
**1,621 MB** for one script, SPARSE **801 MB**, against the runtime's own
**64 MB** ceiling — and the bounded ring was *inapplicable* rather than merely
expensive (the object walk needs bar 0's rows while the VM stands at bar 4,999).

What shipped instead **interleaves the two bar walks**: a value need not be
stored per bar if whatever reads it is standing on the bar that produced it.
Zero bytes, exact rather than approximate, and it is what Pine itself does — two
passes were this engine's convenience, never the vendor's model.
`objects:iterated-tree-not-last-bar` is gone from the census entirely.

### ⚰⚰ My briefs were wrong, and the agents measured it

The UFCS brief pointed its measurement command at an **unrelated guard**
(`runtime:declaration` is about the SCRIPT's declaration — `strategy()`,
`import` — not a collection's), and **three of its five flagship call-site
examples are unreachable by the brief's own stated rule** (family from the
declaration): two are UDT fields, one is a user-function parameter. The one
addressable example was blocked by the generic `array.new<T>()` declaration, not
by the method form — proved by reverting that layer alone and watching all three
moved scripts revert with it.

⭐ **That is the third wave running where an agent corrected the brief it was
given.** Briefs are sized from censuses; censuses name guards, not capabilities.
Read the call sites.

### ⛔⛔ AND A REPO-WIDE INSTRUMENT IS VACUOUS — verified with a control

`grep -c $'
' <file>` through the Bash tool **always answers 0**. Measured: a
file containing two CR bytes answers `0`, while `grep -c alpha` on the same file
answers `1`. Every line-ending check run through that command today measured
nothing.

⚠️ It caused no damage — `python tools/check_repo_hygiene.py` reports clean over
12,104 files and all 49 files changed this session have uniform endings — but
that was `autocrlf` doing the work, not the check. **Use the repo's own gate, or
count bytes in Python.** `git diff --stat` is the other honest signal: a
whole-file ending flip shows up as thousands of changed lines.

---

## ⚰⚰ THE BOTTLENECK MOVED, AND IT FALSIFIES WHAT THIS FILE SAID YESTERDAY

**Struck, 2026-09-22.** The block above headed *"READ THIS BEFORE PLANNING FROM ANY
TABLE BELOW"* concluded:

> *"Phase 2 (the named-vocabulary sweep) is a RUNTIME-LANE queue, so on this
> evidence it will close guards and move no member-visible drawing. The four
> largest product-path blockers are all object-pass work."*

**That was true when written and is false now.** Two waves cleared the object
pass. Re-measured on the merged tree, the object-lane census reads:

| n | drawers | lane / guard |
|---|---|---|
| 35 | **35** | runtime/`runtime:declaration` |
| 21 | **21** | runtime/`pine:builtin` |
| 17 | **17** | runtime/`runtime:udt` |
| 13 | **13** | runtime/`pine:undefined` |
| 12 | **12** | runtime/`runtime:statement` |
| 12 | **12** | runtime/`runtime:expression-statement` |
| 12 | 10 | objects/`pine:no-output` |

**Almost every top row is now the RUNTIME lane, and every one of them is all
drawers.** The object-pass rows that dominated — `pine:character` 23,
`objects:nothing-drawn` 13, `objects:iterated-tree-not-last-bar` 11 — are gone
or reclassified. So the named-vocabulary sweep is now exactly where the work is,
which is the opposite of yesterday's conclusion.

⭐ **The correction is the point, not an embarrassment.** Yesterday's block was
right to retire "clear census rows ⇒ scripts draw"; what it got wrong was
treating a snapshot of WHICH LANE refuses as a durable property of the corpus.
It is a moving target, and the drawer cross-tab — not the row size — is what
stays true. **Re-measure before planning; that is what the commands are for.**

### ⭐⭐ `pine:builtin` is THREE jobs, read from its call sites

Not one, and not 23 unrelated ones:

1. **The `timeframe.*` family** — `period`, `multiplier`, `in_seconds`, `change`.
   The largest cluster, and the one with the demand behind it:
   **`timeframe.period` is 339 uses in 71 scripts**, `timeframe.in_seconds` 119
   uses in 28. The refusal is literally *"this Pine built-in names something the
   engine grammar does not hold"*.
2. **`time` IS MILLISECONDS IN PINE AND SECONDS HERE** — a thousand-fold
   difference, refused deliberately and loudly rather than silently compared
   against a literal no member wrote. A units ruling, not a vocabulary gap.
3. **A tail** — `barstate.isnew` (needs per-tick evaluation), `syminfo.basecurrency`,
   `str.length`.

⛔ **And declaring a name is not free**, which shapes how any of this lands:
`closedTable.json` is mirrored by the PYTHON lane in
`api/services/ast_interpret.py`, and `screenerColumns.test.js` freezes those
columns for it to read. One name added on 2026-09-22 cost **23 new test
failures** before it was reverted. Measure the ripple first.

---

## ⚰⚰ "2 OF 266 DRAW" WAS A BUILD COUNT — corrected 2026-09-22

This file, five session reports and a dozen commit messages have quoted
**"draws end to end: 2 of 266"** as the product metric. The census that produces
it does this:

```js
const r = buildObjectLane(src, { tf: 'D', newestBarIsForming: false })
if (r.ok) { drew.push(name); continue }
```

**It never executes anything.** `r.ok` means the object lane did not REFUSE. The
number was a BUILD result wearing a RUNTIME name, and it is now labelled
`the object lane BUILDS`.

⭐ **What running the two named scripts actually showed — with its limits, not
as a defect:**

| script | result |
|---|---|
| `4c-nyse-market-breadth-ratio` | **threw** — *output 3 must carry a number, got string*. It makes FIVE `request.security` calls and the probe supplied no `requestBars`, so its requests answer `na` and a `str.tostring` of that reaches a plot. **Consistent with the fixture, not evidence of a defect.** |
| `makuchaku039s-trade-tools-fair-value-gaps` | ran to `status: ok` and emitted **zero objects** — on smooth synthetic bars, which is what a fair-value-gap detector *should* do when there are no gaps. |

⛔ **So the honest position is three sentences, not one.** The census measures
BUILD, which is certain from the code. Whether either script DRAWS on real data
is a separate question nothing currently answers. A runtime census needs bars,
request data and a clock — which is why it does not exist yet, and saying so is
cheaper than a number that reads as though it does.

⭐⭐ **The corrected reading does not change any decision made today.** Every
wave was judged on "did this number move", and it did not move under either
reading. What changes is what the number is allowed to be CALLED — and that it
is now clear a runtime census is owed, which nobody had noticed was missing
because the build census had taken its name.

⚠️ `runObjectLane(lane, view)` is the entry that actually runs one
(`{bars, series, confirmed, readTime, barTimes, requestBars}`);
`memberPaneTables.test.js` drives the member's own route end to end and is the
model for the runtime census when somebody builds it.

---

## The honest timeline

| Target | Effort |
|---|---|
| The RVOL+ATR dashboard drawing on a real chart, locally | ✅ **DONE 2026-09-21** (Phase 0) |
| 10-30 named target indicators drawing identically | **~2 weeks** with 3 parallel agents |
| 50-100 named indicators + the top vocabulary gaps closed | **~4-6 weeks** |
| ~35-45% of the 266-script corpus compiled end-to-end | **~2-3 months** (needs Phase 3) |
| Full runtime + language surface minus strategies + libraries | **~8-12 months focused** |
| Every published Pine script incl. strategies + libraries + Pine v7 | **~12-18 months** |

**A one-week sprint (Phase 0-2 + a serious start on 3) is realistic and lands
real value.** The full-parity goal is not, but a compressed **7-day sprint plan
is at the bottom of this file** and it's what I'd start with.

**The concurrency cap is real:** `CLAUDE.md` documents "at most 3 concurrent
agents plus the integrator" with measured evidence of failures at 5 (OOM-swept
the box, dead worktree) and at 13 (7 of 12 agents killed by account limit).
That cap holds. "Deploy enough agents" is a **wave count**, not a concurrent
count.

---

## Phase 0 — Local demo loop (DONE 2026-09-21)

Established:
- Local dev with both pane flags on (`app/.env.local`, gitignored).
- Signup + login as `hubtest@local.dev` on the sandbox DB (admin, paid_equiv).
- The `RVOL+ATR Dashboard` script pastes into `/charts` → Builder → Import,
  translates through `translatePine`, builds via `memberPaneDefinition`,
  installs into `nativeRegistry`, attaches via `addInstance`, and appears as
  `RVOL + ATR` in the chart's legend on the real workspace chart.

Bug fixed en route: `OBJECTS_ONLY_ANCHOR.mode` was `'clean'` — a string not in
`REPAINT_MODES` — so `worstRepaint([...])` failed closed to `'repaints'` while
the install door measured `'non-repainting'`. Every objects-only script that
reached the pane path refused, silently. Fixed to `'non-repainting'`, rail:
`objectsOnlyAnchorMode.test.js`.

**Daily rhythm for the rest of the programme:**
1. Boot sandbox: `python scripts/hub_sandbox_boot.py --port 8000 --data-dir <scratch>`
2. Boot Vite: `cd app && npm run dev`
3. Sign in as hubtest@local.dev; open `/charts`; open Builder (Alt+Shift+A).
4. Paste next target script into Import tab.
5. Screenshot local pane; screenshot TradingView same script/symbol/TF.
6. Diff. Any difference → open a lane to close it.

---

## Phase 1 — Vendor Parity Programme (parallelisable, continuous)

**Every named function in `closedTable.json` gets a canonical vendor capture.
"Identical to TradingView" is an engineering statement whose unit is one
capture.**

### ✅ The queue is MEASURED as of 2026-09-21 — and it is 29, not 86

`vendorParityCoverage.measure.test.js` crosses what `closedTable.json` declares
(71 functions) against what the committed **probe sources** actually call, and
against corpus demand. Run it; do not quote it.

⛔ **The first attempt at this measurement reported ZERO and was wrong.** It
asked "is there a test that reads a vendor fixture and names this function",
which one large test file satisfies for every name at once. That read as
"Phase 1 is already done". The check now keys on **call sites in
`tools/visual_conformance/probes/*.pine`** — the scripts actually run on
TradingView — with comments stripped, and carries a saturation guard that
reports INCONCLUSIVE rather than publishing another zero.

| signal | uncovered, used by corpus |
|---|---|
| weak (name appears anywhere in a fixture) | 3 |
| **authoritative (name CALLED in a probe)** | **29** |

**The real queue, most-used first:** `abs` 95 scripts · `nz` 94 · `atr` 73 ·
`change` 72 · `ema` 65 · `sum` 40 · `pow` 36 · `sqrt` 33 · `rsi` 32 ·
`stdev` 27 · `wma` 23 · `rma` 21 · `sign` 21 · `exp` 19 · `hma` 17 ·
`highestbars` 11 · `lowestbars` 11 · then a tail of ≤7.

**Deliverables:**
- ✅ **Wave-1 probe written and self-checked** —
  `tools/visual_conformance/probes/p1-top-unmeasured.pine` covers `nz`, `abs`,
  `change`, `ema`, `rma`, `atr`, `stdev`, `sum` in one run. Every reading
  discriminates between competing implementations (the EMA/RMA **seed**, `nz`'s
  argument order, `abs(na)`, `change` on bar 0, population-vs-sample `stdev`)
  and it carries an identity control (`ta.atr(5)` must equal
  `ta.rma(ta.tr(true), 5)`). **Both lanes translate it**, so every reading is
  one both sides can produce.
  ⛔ **Needs one human-in-the-loop TradingView session.** The seeding questions
  are answered in the FIRST ~20 BARS and nowhere else.
- Wave-2 probe for the composites (`rsi`, `macd`, `stoch`, `cci`, `hma`, `wma`,
  `percentrank`, `mfi`, `atan`, `avwap`) — deliberately AFTER wave 1, because
  each depends on the seeding answers and measuring them first produces
  readings nobody can attribute.
- A per-fixture manifest naming which function each existing capture measures,
  so the weak signal can be retired.
- A public "parity ledger" in `/formulas/reference`.

⭐ **The self-check pays for itself before the session is spent.** Running the
wave-1 probe through our own translator first found `ta.variance` is not
declared by this engine — a capture of it would have yielded a vendor number
with nothing to compare against.


**Cost:** far lower than the ~40 hours originally estimated here. One capture
session covers 8 names; the tail is ~3-4 more sessions.


**Ordering:** highest corpus demand first. The corpus census
(`runtimeCorpusCensus.measure.test.js`) surfaces this ordering, and
`pineDemandCensus.measure.test.js` orders it by NAME.

⛔⛔ **BUT A CENSUS ROW IS A TOKEN, NOT A CAPABILITY — READ THE CALL SITES BEFORE
SIZING ONE.** Measured 2026-09-21: the demand census's second row is
`16  [  runtime:history-expression,pine:builtin,…`, which reads as "the history
operator blocks 16 scripts". It is not. **Fifteen of those sixteen call sites
are TUPLE DESTRUCTURING** (`[a, b, c] = f(…)`) and exactly one is a history
read. One token, two unrelated jobs, and the larger of the two is invisible in
the table. A lane was opened against the wrong one before anyone opened the
scripts.

**Runs independently of every other phase.** Its output is fixtures — no new
capability — so it can't break anything.

---

## Phase 2 — Close the named-vocabulary gaps (~1-2 weeks with 3-agent waves)

⛔⛔ **Re-read the measured block at the top of this file before working this
phase.** This table is the RUNTIME lane; clearing it is not yet shown to move
what a member sees.

The runtime lane's first-blocker table (fresh at `17192d37d`, 2026-09-21):

| n | guard | disposition |
|---|---|---|
| 47 | `runtime:declaration` | strategies — see Phase 3 carve-out |
| 23 | `pine:character` | UDT/OOP — Phase 3 |
| 20 | `pine:builtin` | **this phase — one at a time, 3-agent waves** |
| 18 | `pine:undefined` | Phase 4 (loop vars in the columnar lane / user fns) |
| 17 | `runtime:statement` | Phase 4 |
| 15 each | `runtime:expression-statement` · `runtime:call-undeclared-builtin-state` · `pine:function` | Phase 4 |
| 12 | `runtime:udt` | Phase 3 |
| 11 | `pine:block` | Phase 4 (deeper block scoping) |
| 8 each | `runtime:array` · `runtime:object-op` | This phase (partial) |
| 6 | `pine:request` | Phase 5 |

**Deliverables per capability (following today's `table.clear` / `text_formatting`
pattern):**
1. Measure demand: how many corpus scripts + call sites.
2. Write RED test with a control that must go green independently.
3. Read vendor capture (from Phase 1).
4. Implement across whichever layers apply (reader → converter → program →
   runtime → renderer).
5. Mutation-proof each layer's fix (revert it, assert red, restore).
6. 0-NEW-failures set-difference against pristine HEAD on the engine suite.
7. Ship behind existing flags; local demo the target script; screenshot diff.
8. Update `runtimeCorpusCensus` — number moves.

**3-agent parallelisation model:**
- Agent A: next `pine:builtin` capability
- Agent B: next `runtime:array` or `runtime:object-op` capability
- Agent C: Vendor Parity capture batch
- Integrator: gate each branch, merge, re-measure census.

**Expected corpus movement:** 8/266 today → **20-30/266** by end of Phase 2.

---

## Phase 3 — Pine's OOP system (`type`, `method`, chained calls) + strategy decision (~4-6 weeks)

Two parallel design tracks that can't be shortcut.

### 3a. OOP: `type` + `method` + chained method-call syntax

Unblocks `pine:character` (23), most of `runtime:udt` (12), and half of `pine:tuple`.

Real language work:
- Lexer: `.` after `)` is currently rejected. Chain member access after any
  expression, not just an identifier.
- Parser: `type Name` declaration with fields; `method` block with `this` and
  overload resolution; `NewType.new()` constructor synthesis.
- Resolver: symbol table gains type + method bindings. Field access on
  arbitrary expressions.
- Runtime: object model (heap of typed instances with per-instance fields).
  Method dispatch. GC or reference-tracking.

**Cannot be shortcut with more agents.** A parser/resolver/runtime redesign
has a critical path that is design-then-implement. Design pass alone: ~1 week
solo work + review. Implementation: 3-agent-parallel-friendly (different
files, one agent per layer once the design is fixed).

Deliverable: any corpus script that declares a `type` and reads a field via
`x.f` or a method via `x.m(y)` runs end-to-end.

### 3b. Strategy decision (`strategy()` — 47 of 266 scripts, 18% of corpus)

Owner ruling to date: **out of scope by design.** Confirm or reverse:

- **Confirm out-of-scope:** the census records 47 refused with `runtime:declaration`
  as a permanent count. `/formulas/reference` names this policy publicly. Full
  parity claim is asterisked: "indicators, not strategies."

- **Reverse:** ~2-3 additional months. Requires a backtester, position sizing
  primitives, portfolio state, `strategy.entry`/`strategy.exit`/`strategy.close`,
  P&L tracking, alert generation from strategy events. Belongs at Phase 4 or 5.

**Recommendation: confirm out-of-scope until every indicator draws identically.**
Strategies are a distinct product surface (a backtester is a whole feature),
and mixing them into "does this draw" delays the drawing-parity goal by
months for a feature nobody has yet asked for by name.

---

## Phase 4 — General user functions (per-call-site body lowering) (~4-6 weeks)

Unblocks `pine:function` (15), most of `pine:undefined` (18), and
`runtime:statement` (17). Combined with Phase 3, gets to ~35-45% corpus
coverage.

Today the runtime lane can lower ONE user-function body inline per call site
under narrow conditions. Real Pine has:
- Multi-return tuple functions (`[a, b] = f(x)`).
- User-defined function overloading.
- Recursive user functions with a bounded depth guard.
- Functions closing over enclosing-scope variables (`simple`, `series`, `input`
  qualifiers).
- Functions returning UDT instances (needs Phase 3).

Design pass: ~1 week. Implementation: 3-agent parallel across
overload/tuple/recursion/closure tracks.

Deliverable: per-call-site inlining that respects Pine's own scoping and
qualifier rules, with a test corpus of at least 20 real user-function idioms.

---

## Phase 5 — General `request.security` + a bars orchestrator (~4-6 weeks)

Today: fixed-point symbol discovery on ONE call site under narrow conditions.
Enough for the RVOL+ATR dashboard (verified today) but not for the general case.

Real Pine:
- Arbitrary expression as the `expression` argument (any tree, not just tuples
  of named columns).
- Arbitrary `symbol` (an expression, not a literal — enables cross-market and
  watchlist-driven scripts).
- Arbitrary `timeframe` (an expression — enables MTF logic).
- `lookahead`, `gaps`, `calc_bars_count` semantics honored properly (today
  `calc_bars_count` is accepted-and-inert; see resume doc item 2).
- Nested `request.security` (a script that reads another script that reads
  another security).

**Backend subsystem that doesn't exist today:** bars for arbitrary symbol at
arbitrary TF on demand, cached, budgeted per-request to avoid fanning out to
Massive/yfinance for every combination. This is where cross-market indicators
live.

**Cost:** ~2 weeks backend orchestrator + ~2 weeks frontend integration + ~1
week vendor parity validation.

---

## Phase 6 — Renderer parity (~2-4 weeks)

`docs/pine/lwc5-capability-map.md` is the reference. Concrete items owed:
- Six-argument gradient `fill()` (last blocker on RVOL script 2).
- `linefill` in general.
- Polylines (`polyline.new`).
- Chained box/label setters (needs Phase 3's chained syntax first).
- `syminfo.mintick` — needs per-symbol tick sizes exposed from the backend.
- `text.format_bold + text.format_italic` combined (today refused; measured).
- `text.format_bold` on `label.new(text_formatting=...)` (today only on `table.cell`).
- Custom canvas layer where LightweightCharts primitives don't cover it.

Parallelises well: one renderer feature per agent.

---

## Phase 7 — Language surface tail + libraries (continuous)

- `switch` statement.
- `for x in collection` (Pine 5+ for-in).
- `while` loops (currently refused).
- `for ... by <step>` loops.
- `enum` declarations.
- Tuples in every position.
- **`import` from Pine libraries** (`pine:module`, 23/266 scripts). This is
  infrastructure work: Pine libraries can be public or private/paid; the
  registry, resolution, and licensing story are all real subsystems.
- Multi-line string literals, indented string continuations.
- Pine v7 when it lands.

Each item independently addable; no cross-phase blocking.

---

## Vendor parity discipline — applies to every phase after 0

Every capability that closes a bug or adds a feature ships with:
1. **A vendor capture** (Phase 1's harness) — a fixture file the fix's test
   reads from, and asserts equal-to.
2. **A local paste-and-draw demo** — a screenshot of the target script drawing
   on `/charts`, compared to a screenshot of the same script on TradingView at
   the same symbol/TF.
3. **A corpus census delta** — `runtimeCorpusCensus` re-run before and after,
   the number and the moved-script list recorded in the commit.
4. **Mutation proof** — each fix revertable, assert red on revert.
5. **0 NEW failures** by set-difference against pristine HEAD.

**This is what makes "identical to TradingView" a measurement rather than a
claim.**

---

## The 1-week aggressive-parallelism sprint

If we start Monday, here's what to actually do. This is compressed and
demanding but realistic; it takes us from 3% corpus coverage to something in
the 20-30% range and lands the tooling that makes Phase 3-7 tractable.

### Day 1 — Foundation, all hands
- **Agent A**: extend `tools/pine_vendor_capture.py` to a semi-automated
  harness. Deliverable: give it a function name, get back a canonical fixture.
- **Agent B**: extend `runtimeCorpusCensus.measure.test.js` to also count
  per-function occurrences across the corpus + output the top-25 undeclared or
  under-supported names. Priorities the rest of the sprint.
- **Agent C**: enumerate 15 target indicators by name. Real scripts the owner
  wants working. Paste each into the local pane, measure current gap
  (compiles? draws? draws identically?). Output: 15 rows × 4 columns.
- **Integrator**: read the outputs, publish the day-1 census + the target list
  + the harness state.

### Day 2 — Vocabulary sweep, wave 1
- **Agent A**: highest-demand `pine:builtin` blocker (probably `str.format` or
  a `ta.*` or `math.*`). Full cycle: RED → vendor capture → implement → GREEN
  → mutation-proof → 0-new-failures → local demo.
- **Agent B**: second-highest.
- **Agent C**: continue vendor captures (target 15/day).
- **Integrator**: gate + merge agent branches, re-measure census.

### Day 3 — Vocabulary sweep, wave 2
- Repeat Day 2 with the next three. Target: 6 new capabilities landed by
  end-of-day-3, census moves ~5-10 scripts.

### Day 4 — Renderer parity, wave 1
- **Agent A**: gradient `fill()` (unblocks RVOL script 2, which is the second
  half of the acceptance dashboard duo).
- **Agent B**: `linefill` in general.
- **Agent C**: continue vendor captures.
- **Integrator**: paste-and-draw demos of scripts touched by A and B.

### Day 5 — Design pass for Phase 3 (OOP), all hands but SERIAL
- Whole day is design. No implementation on OOP yet — get the design right.
- Output: `docs/pine/oop-design.md` covering lexer, parser, resolver, runtime
  object model. Ratified by end of day.
- **Agent C** continues vendor captures in parallel.
- **Integrator** reviews the design, writes the test plan.

### Day 6 — OOP implementation, wave 1
- **Agent A**: lexer + parser for `type Name` declarations.
- **Agent B**: chained method-call syntax (`.` after `)`).
- **Agent C**: `method` block declaration and dispatch.
- **Integrator**: integration testing, one small real corpus script that uses
  each feature.

### Day 7 — OOP finish + measure
- **Agent A**: field access resolution + runtime object model.
- **Agent B**: method resolution end-to-end.
- **Agent C**: reference tests + fixture regression.
- **Integrator**: full corpus census; write a report of what compiles now that
  didn't on Monday.

**Expected end-of-week outcome:** ~15-20 real indicators drawing identically to
TradingView (verified by screenshot diff), corpus coverage from 3% to
~20-30%, vendor parity ledger at ~30-40% of `closedTable.json`, OOP working
for simple `type`/`method` idioms (not yet the full recursive UDT surface).

**Explicitly not done in this week:** Phase 4 (general user functions), Phase 5
(bars orchestrator), full Phase 6 (renderer polish beyond gradient/linefill),
`import` from libraries. Those are the second week + weeks 3-4.

---

## Working rules for the multi-agent programme

Non-negotiable. Every one of these is here because CLAUDE.md records the
specific failure that made it a rule.

1. **Max 3 concurrent agents plus the integrator.** Any deviation is stated in
   the next checkpoint, never hidden.
2. **Every agent commits at every green checkpoint** and pushes its branch.
3. **The integrator gates every agent's branch in its own session** — an
   agent's "done" without an integrator gate is not done.
4. **Scoped pytest only, chunked frontend tests** — full suite OOMs the box.
5. **STT/whisper jobs run alone** — never beside a test run or Batch collector.
6. **Never `git checkout <file>` to undo** — write back captured bytes and
   verify sha256.
7. **Never `git stash`** — the stack is shared with other worktrees; use a
   temp WIP commit or `stash push -u -m <uid>` with sha capture.
8. **Every capability ships with the five-piece verification bundle above**
   (vendor capture, local demo, census delta, mutation proof, 0 NEW failures).
9. **Never a production push during the week** — everything stays behind the
   local flags. The pane goes live to members ONLY after the target list is
   ticking off names identically.

---

## The D2 flip decision — orthogonal to this whole plan

Ruling D2 keeps the member pane on the HOST lane's saved definition today; the
runtime lane serves no members. All of the above improves the runtime lane.

**Nothing in this plan flips D2.** The plan builds the parity; the D2 flip
turns parity into member value. Two different decisions.

The pane can be opened to members in stages:
- Stage 1: admin-only (`role === 'admin'` on the flag reader).
- Stage 2: opt-in per-member preference (Settings → Beta features).
- Stage 3: default-on for paid tier.
- Stage 4: default-on for all.

Recommend: hold every stage past 1 until Phase 3 lands. A member seeing "half
my script works" is a worse product than one that says "not yet."
