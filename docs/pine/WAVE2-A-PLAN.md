# WAVE 2 · ITEM (a) — THE SUB-STEP PLAN

> ⚠️⚠️ **PROVENANCE: owner, chat, 2026-09-14 — TRANSCRIBED, NOT MEASURED.**
> Every line of the a1–a7 breakdown and the (a)–(j) item order below came from the
> owner's messages. Nothing here was derived from the corpus, from source, or from a
> run. Where this file states a number or a member name, the SOURCE wins and this file
> is what drifted — check `arrayVectors.js`, `parse.js` and `WAVE2-A-CENSUS.md` first.

⚰️ **WHY THIS FILE EXISTS.** The a1–a7 breakdown governed three sub-steps of real work
and **existed only in chat**. A session asked to read a5's scope out of the repo on
2026-09-14 searched `SESSION-STATE.md`, `WAVE2-A-CENSUS.md` and all of `docs/` and
found **nothing** — the only `A5` hits in the tree belong to unrelated programmes (the
joystick phase-3 plan, a calendar spec, the indicator-platform `D-A5` row). A plan that
directs the work and lives nowhere a resuming session can read it is a plan that will be
reconstructed from memory, and this programme has already paid twice for a
reconstructed-from-memory artifact (the stale `edef87f97` PR base, the `{mode:'host'}`
lane reading).

⛔ **A hand-off is not a record.** The same transmission that lost this plan also
carried four other corruptions, each of which the repo corrected: `pine:chart-only`
called a refusal when it is a note; the alpha-drop fold described as conditional on
Clouds when it is never reached for Clouds; wave 1's PR base given as `edef87f97` when
`SESSION-STATE.md:3` says `acdf93455`; and `'host'` placed in `translatePine`'s options
when it belongs to `chooseOutput`.

---

## The sub-steps

| # | scope | state |
|---|---|---|
| **a1** | the decidability probe | ✅ **DONE** — `12cbdd289` |
| **a2** | plan-time vectors; reads fold to slot trees | ✅ **DONE** — `223f58ad2` (creation recorded), `66a4a5250` (reads fold) |
| **a3** | the unroll | ✅ **DONE** — `06a2258e2` (acceptance, red), `a1de7a6f5` (green) |
| **a4** | **REVISED BY R1/R2** — no new iteration form is built. Every retired loop form (`for x in`, `for [i, x] in`, `while`) refuses **at its own line**, with the code its SOURCE determines, replacing today's `pine:block` note plus a later unrelated `array.get` refusal | ✅ **COMPLETE** — `af4606288` (red), `901e8165a` (green), `20ae2ddf6` (re-baseline), `bfe7e2b4e` (R4–R6). One item owed: **R1(ii)** |
| **a4b** | **the accumulator fold** — a counted-`for` body of the shape `s := s op e` folds to a left-nested op chain | ⛔ **CENSUS FIRST, THEN A GO** — ruling R3 |
| **a5** | reductions over written slots | ✅ **CLOSED by R9** — `sum`/`max`/`min` KEPT and FIXED, `avg`/`indexof`/`sort`/`includes`/`stdev` refuse by name (`158ca0d0a` red, `ab978572c` green) |
| **a6** | Clouds verbatim on both lanes with colours intact (H.2's definition) | ✅ **CLOSED by R10** — `02830f0c0`. The vendor capture is **OWED**, see below |
| **a7** | shared contract, Python twin, both-lane agreement rail over 327 scripts, snapshots, suites, Python lane once, vite build | pending |

### ✅ a5's scope WAS settled — by census and by R9. This section is kept as the record

> ⚰️ **Everything below was true when written and is now history.** It said the member
> set was owner-pending and must not be widened to match the hand-off. That was right:
> the census then measured the corpus, R9 measured the ENGINE, and the answer was not
> what either the hand-off or this section expected — `sum`/`max`/`min` were **broken**
> (`pine:roundtrip`, no formula at all), `avg` was **declared but never implemented**,
> and `stdev`/`includes` turned out to be **attested after all** at 4 and 5 uses. They
> were absent from the SOURCE LISTS, which is a different claim from absent from the
> corpus, and the distinction is exactly what this section got right. See **a5 — CLOSED
> by R9** below for the settled answer.

An earlier hand-off gave a5's members as *"sum/max/min/avg/stdev/sort/indexof/includes"*.
That transmission is the one described above, and it arrived corrupted, so it is
evidence of nothing. **What the SOURCE actually records, measured 2026-09-14:**

| | |
|---|---|
| `REDUCE_MEMBERS` — `arrayVectors.js:55` | `sum`, `max`, `min`, `avg` — **four**, already inside `HANDLED` (`:59`) |
| census, `WAVE2-A-CENSUS.md:50` | `array.indexof` — 18 uses / 7 files, classed **reduce** |
| census, `WAVE2-A-CENSUS.md:56` | `array.sort` — 10 uses / 7 files, classed **reduce** |
| build order, `WAVE2-A-CENSUS.md:200` | *"→ `set`, then `new_float`/`new_int`/`from`, then the reductions."* |

⛔ **`stdev` and `includes` appear in NO source list** — not in `REDUCE_MEMBERS`, not in
`HANDLED`, not in the census member table. They may be right; they are simply
unattested. **Do not widen a5 to match the hand-off.** The owner confirms the member
set before a5 opens.

### Reporting cadence

- **Reports and pushes after a5 and after a7.**
- An **estimate is stated before each sub-step**, against what is measured at that
  moment — never an estimate typed before the sub-step is opened
  (`lesson_an_acceptance_number_is_a_forecast_until_derived`).
- A **2× stop** applies: when elapsed reaches twice the estimate, stop and report rather
  than push through.

### a6 carries a conditional obligation

The Clouds vendor capture needs Chrome connected and the rig backend started
(`docs/pine/wip/rig/boot_rig.py`, `UCT_RIG_DATA` pointing **outside** any worktree — it
refuses otherwise), under the gate at `SESSION-STATE.md:175-176`: **own-text `Add to
chart` plus 0 studies**, not "editor closed". ⛔ **If the browser is not connected when
a6 lands, the capture is RECORDED AS OWED** — never silently skipped, and never claimed
from an emulator.

---

## The wave 2 item order

> Same provenance: owner, chat, 2026-09-14, transcribed. The order is a ruling; the
> scope notes beside each item are summaries and the census is the authority.

| # | item |
|---|---|
| **(a)** | arrays + `for` loops |
| **(b)** | runtime inputs |
| **(c)** | `request.security` tuple form + IR-lane tuples + the shapes (a) forecloses |
| **(d)** | `alertSets` wiring |
| **(e)** | short-circuit evaluation |
| **(f)** | nested text helpers |
| **(g)** | `s := close` typing |
| **(h)** | stale `ticker_meta` rows + `BF.B` |
| **(i)** | volume provenance |
| **(j)** | Uncharted Clouds as the wave-2 target |

⭐ **(c) inherits an exact set from (a), not a category** — 33 `for` loops with a series
bound, 10 `while` with a series guard, 60 `while` guarded on `array.size`, and every
series-dependent `push`. Mechanism A makes arrays plan-time vectors on the definition
lane, so those shapes **refuse there by name** and point here. The limit is
**per-lane, not per-product**: one capability, two lanes.

---

## Item (a)'s acceptance, and where it actually landed

**As ruled, AMENDED by H.3 (owner, 2026-09-14):** Clouds' 21 `pine:collection` refusals
clear, and **the next thing that SPEAKS names `color.t` at line 90**.

⚰️ It read *"the next REFUSAL names `color.t` at line 90"* and that half could not be
met without cost. `color.t` binds a name no output reads, so the env closing pass
records it as a **note**; forcing it to a refusal would spend the closing pass's
restraint — an unread-but-**readable** binding stays silent — which is the only thing
stopping a note appearing for every `len = 14` in every script. **H.3 rules the note
correct and amends the sentence rather than the engine.**

**First half: green.** Clouds translates on both lanes — `ok=true`, 0 refusals, 23
outputs, none folding to `na`.

**Second half: landed as a NOTE, not a refusal**, and that is reported rather than
forced. `color.t` at 90 binds `bullUserTransparency`, which no output path reads, so the
env closing pass resolves it once and records `pine:colour-value @90`. Making it a
refusal would cost the closing pass's restraint — an unread-but-**readable** binding
stays silent, which is what stops a note appearing for every `len = 14` in every script.
✅ **RULED H.3 (owner, 2026-09-14): the note is CORRECT and the acceptance sentence is
what changed.** Both halves of item (a)'s acceptance are met as amended.

---

# RULINGS R1–R3 — owner, chat, 2026-09-14

These three were decided on the numbers in `tools/pine_iteration_census.py`, which
reproduces the committed census counts exactly (1,004 · 92 · 34 · 116) and adds the
column the census never had: **what the loop body does**.

| form | uses | files | body shapes |
|---|---|---|---|
| `for i = a to b` | 1,004 | 149 | accumulates 379 · other 269 · writes-slot 255 · draws 101 |
| `for x in` | 92 | 22 | other 52 · accumulates 22 · **writes-slot 13** · draws 5 |
| `for [i, x] in` | 34 | 9 | other 23 · accumulates 9 · draws 2 · **writes-slot 0** |
| `while` | 116 | 36 | writes-slot 53 · accumulates 30 · other 25 · draws 8 |

⭐ **The `other` bucket was opened, not assumed** — 75 of 126 for-in bodies land in it.
Leading tokens: `if` 65, `else` 17, then `obj.delete` 6, `imb.mitigated` 12,
`fvg.raidx2` 6, `block.remove` 4, `line.delete` 4, `label.delete` 4, `table.cell` 5.
**The dominant `for … in` body in this corpus iterates arrays of drawing objects and
user-defined types, mutating fields or deleting them.** None of that is a number, so
none of it is plan-time expressible on this lane.

## R1 — `for … in` RETIRES FROM ITEM (a)

**The F4 threshold (~20 admissible uses, pre-committed) applies to `for … in` exactly
as it applied to `while`.** 13 of 92 `for x in` bodies write a slot; **0 of 34**
`for [i, x] in` do. Both are under it. Neither D.1 nor D.2 is built in a4.

⛔ **That a3's machinery makes the unroll cheap does not change the ruling.** The
threshold is about whether the corpus exercises the form, not whether the form is easy.

Instead, a4 makes these forms **refuse by name at the loop line**, replacing today's
`pine:block` note plus a later, unrelated `array.get` refusal. Three cases, decided by
what the SOURCE is:

| case | source | code | routes to (c)? |
|---|---|---|---|
| **(i)** | a plan-time vector | `pine:collection` | ⛔ **no** — not a runtime-array case, and saying so would be a false sentence |
| **(ii)** | series-sized / series-dependent | `pine:collection`, composing `seriesDependentMessage` | ✅ yes |
| **(iii)** | a drawing array or a UDT array | the code its own CREATION already gives it | ⛔ **no** — outside BOTH lanes |

⭐ **Case (iii)'s code was measured, not chosen.** `c = array.new_box(2)` already notes
**`pine:drawing`** at creation; `c = array.new<Foo>(2)` already notes **`pine:type`**.
The loop refusal reuses the same code so a reader sees one story, not two. Both are in
the frozen 41-code table; no 42nd code was needed.

### The 13 owed uses — reopened on member evidence, not on a hunch

`python tools/pine_iteration_census.py --list "for x in" writes-slot`:

| script | line | source |
|---|---|---|
| `ai-supertrend-x-pivot-percentile-strategy-pres…` | 259 | `lengths` |
| `ict-killzones-pivots-tfo__d0b8be94f1.pine` | 768 | `str.split(timestamps_input, …)` |
| `multi-timeframe-supply-demand-zones__a98a2ab367.pine` | 264, 276 | `SnD_Type` |
| `volume-footprint-measuring-classical-indicators…` | 595, 784, 844, 1248, 1251, 1257, 1275, 1279, 1699 | `rws`, `fpBars`, `compsB`, `compsS`, `bps` |

⭐ **They are concentrated, which strengthens the ruling rather than weakening it: 9 of
the 13 are in ONE script and there are only 5 distinct scripts.** This is one author's
idiom, not a corpus-wide form. **If a member script hits it, R1 is reopened on that
evidence.**

## R2 — `while` REFUSES AS `pine:collection` AT THE `while` LINE

**Not a promoted `pine:block`.** Recorded so it is not re-argued:

- `pine:block` is a **note** code emitted at sites unrelated to iteration. Promoting it
  to a refusal would change its meaning everywhere it is emitted — wider than a4 is
  entitled to be.
- `pine:collection` is already the outcome-determining fact: the later read refuses
  with it today. Moving it to the `while` line changes **where the sentence lands and
  what it names**, not the verdict — so the two lanes' facts agreement
  (`bothLanesAreTwoLanes` case 2, equal `refusals.length`) is preserved by
  construction.

The message names `while`, its line, and ruling F4 with its number (**15 of 116**).

⚰️ **AND `while` CANNOT BE ACCEPTANCE-TESTED ON THIS CORPUS.** Every `while` user in
`corpus/committed` is unreachable at its `while` line:
`fibonacci-retracement-statistics-by-volprofex` and `ict-institutional-order-flow-fadi`
both die on `pine:character` at an earlier line (non-ASCII in source), and
`k-clustering`'s `while` at :132 sits inside a function body the walk never enters.
`bigbeluga-smart-money-concepts` — the script the `other` bucket was sampled from —
dies at `pine:character@25`, long before its `for obj in bin.ln` at :282. The
message-text fixtures are therefore **synthetic and labelled synthetic in their test
names**; the one corpus fixture measured to reach its loop line is
`multi-timeframe-supply-demand-zones__a98a2ab367.pine:264`.

## R3 — ACCUMULATORS OPEN AS SUB-STEP a4b

**379 of 1,004 counted-`for` bodies accumulate — more than every other admitted shape
combined**, and a3's unroll serves the 255 `writes-slot` cases and none of them.

`s = 0.0 / for i = 0 to 2 / s := s + close[i]` is plan-time expressible **by
construction** as `((0 + close[0]) + close[1]) + close[2]` — an ordinary expression
tree, no new node type, no statement form, `maxLookback` and repaint decided by
construction. **It is Mechanism A applied to a scalar instead of a vector.**

⛔ **It is not a5.** a5's reductions are member calls over written slots; a4b is a loop
body folding into a left-nested op chain. a5 may reuse a4b's fold — `array.sum` *is* an
accumulator — and that is a5's business.

**a4b is census-first.** Before any build estimate: classify the 379 by initial value,
update operator and shape (`s := s op e` vs `s := f(s, e)`), whether `e` is plan-time
expressible, nesting × iterations against the budget, and whether `s` is read elsewhere
before the loop completes. Report the admissible fraction against the same F4-style
threshold — **and if it is under 20, R1's logic applies to a4b too.**

⚠️ **One measurement that reframes the frontier and was taken while choosing fixtures:**
in a real corpus script an accumulator inside a `for` is **not** refused by name — the
whole block is a `pine:block` note and the accumulator is never seen at all
(`delta-volume-v21-by-kernel-phi__uP24atP4R0.pine:26`, inside the `for` at :25, carries
no refusal). `pine:reassign` fires in the synthetic because the accumulated name is
bound at top level and read by a `plot`. **The 379 are invisible today, not refused**,
and a4b's census must count which of the two they are.

---

# RULINGS R4–R6 — owner, chat, 2026-09-14 · a4 CLOSES

Each was measured before it was asserted, and measuring changed two of the three.

## R4 — a series-sized source refuses at its CREATION line, and that is CORRECT

The refusal names the dependency **where the dependency is** — the size expression at
the creation — with `pine:collection`, the composed `seriesDependentMessage`, the named
dependency, and the routing to item (c). The `for` line is downstream of that fact.
Requiring the loop line would mean folding sizes earlier: a change to **when sizes are
settled**, which is an engine-order change a4 is not entitled to make.

## R5 — a drawing or UDT source stays where it already speaks, and it NOTES

⚰️ **R5's own wording said "stays where it already refuses". It does not refuse
anywhere.** Measured: `ok=true`, **zero refusals**, a `pine:drawing` note at the
creation and a `pine:block` note at the loop. A script that iterates a drawing array
and plots nothing from it is not a failed translation; it is a translation with a line
this lane does not draw, which is what a note is for.

⚠️ **And the UDT note is on the `type` DECLARATION, not the array creation** —
`pine:type@4` on `type Foo`, `pine:vector@6` on `array.new<Foo>`. That split is the
honest one: what this lane cannot store is the **type**; the array is merely the first
place it shows, and the array creation is separately recorded as an ordinary plan-time
vector of `Foo` slots.

## R6 — measured on all 13 owed uses, and the case is MOOT ON EVERY ONE

There is no swap available, because an earlier refusal fires on all of them:

| script | line | first refusal |
|---|---|---|
| `ai-supertrend-…-presenttrading__3b9db05a48` | 259 | `pine:declaration-strategy@5` |
| `ict-killzones-pivots-tfo__d0b8be94f1` | 768 | `pine:character@250` |
| `multi-timeframe-supply-demand-zones__a98a2ab367` | 264, 276 | `pine:no-output` (0 outputs) |
| `volume-footprint-…__e15e52b27d` (9 uses) | 595 … 1699 | `pine:character@1572` |

⭐ **So the moot-ness itself became the assertion** rather than the case being deleted.
If any of these becomes reachable — `pine:character` is a source-encoding refusal a
later wave may well close — the rail goes RED, which is exactly when R1 should be
reopened on corpus evidence. A deleted case would have gone quiet instead.

⚠️ `SnD_Type` at :264 is a **function parameter**, so even reachable it would exercise
a `param` binding rather than a vector. **Recorded as owed under R1; a4 does not build
parameter typing.**

## ⛔ OWED — R1(ii) IS NOT SATISFIED, AND a4 FOUND IT BY BUILDING a4

R1(ii) requires a series-sized source iterated by a loop to compose
`seriesDependentMessage` and route to item (c). It does not. Once the `for … in`
touches the array, the **loop's** opaque replacement fires first, the array never
reaches the size fold, and the refusal lands at the loop line carrying the loop's
generic sentence — **the routing to (c) is lost for that shape**.

⭐ **The relocation a4 shipped is what causes it: a better line, a worse sentence, for
this one shape.** The fix is for the loop's message to defer to the creation's when the
source's size is series-dependent, which needs the size folded before the walk gives up
on the block — the same engine-order change R4 declined. It is committed as its own
open `it.fails` carrying the measurement, not patched with a guess.

## The five snapshot rails are no longer sensitive

a3's comment warned that moving the refusal off the read would turn `pine.community.guards`,
`pine.guardCensus` and `pineStrictMode` (×3) red. **It did not** — a3 has since cleared
the refusals those rails snapshot, so the relocation passed them untouched. The only
metric movement was one guard in one script, `pine:collection` → `pine:drawing`.

---

# ✅ ITEM (a) IS COMPLETE — a1 … a4b, rulings R1 … R8

| sub-step | outcome |
|---|---|
| **a1** | the decidability probe — `12cbdd289` |
| **a2** | plan-time vectors; reads fold to slot trees — `223f58ad2`, `66a4a5250` |
| **a3** | the unroll — `06a2258e2` (red), `a1de7a6f5` (green) |
| **a4** | retired forms refuse at their own line — `af4606288` (red), `901e8165a`, `bfe7e2b4e` (R4–R6) |
| **a4b** | **RETIRED, not built** — `1528c0149` (red), `394df1018` (R7a) |

## What was RETIRED, and at what number

| form | admissible | ruling |
|---|---|---|
| `while` | **15 of 116** | F4 |
| `for x in` | **13 of 92** | R1 |
| `for [i, x] in` | **0 of 34** | R1 |
| counted-`for` accumulator | **1 of 379**, and that one runs a single iteration | R7 |

⛔ **Four forms retired on measurement, none on taste.** Each refusal now carries its
own number so a reopening starts from evidence.

## The a4b ceiling, so a reopening starts from what would have to change

**63 of 379** accumulator loops have an iteration count this engine could settle, and
**that is a hard ceiling** — anything that must be unrolled needs one, so no relaxation
of the other axes can lift the admissible set above it.

| axis | alone | drop it → admissible |
|---|---|---|
| seed known | 321 | 7 |
| shape `s := s op e` | 149 | 50 |
| **bound knowable** | **63** | 106 |
| no escape | 257 | 9 |
| bound + escape dropped together | — | 134 |

⚠️ The 106 and 134 figures come from dropping the bound requirement, and those loops
cannot be unrolled at all — they are not a relaxation available to anyone.

## R7a — the fix chosen, and the one rejected

Candidate **(ii)** shipped: `forceOpaque` keeps its `extra` as `reason`, and the
overwrite at `pine.js:11128` carries that reason forward instead of re-composing from
the bare guard. The refusal lands on the `:=` — where the reassignment fact is — and
its sentence names the `for`.

⛔ Candidate **(i)**, reordering so `forceOpaque` runs before the body walk, was
**rejected on blast radius**: it touches every statement branch that walks a body,
which is the likeliest place for a fifth instance of the read/overwrite ordering class
to ship silently, and it buys a line that agrees with the sentence no better.

## ⛔ OWED — carried into item (c) or a later wave, not lost

| owed | evidence |
|---|---|
| the **13** `for x in` writes-slot uses | all masked by an earlier refusal; the rail goes red if one becomes reachable |
| **function-parameter** sources | `multi-timeframe-supply-demand-zones:264`, `SnD_Type` is a parameter, so a `param` binding rather than a vector |
| **UDT-field-access** sources | `candelacharts-equal-highslows-eqheql__4485a6c447:135` — `for obj in store.ehl_ln` produces **nothing at the loop line, not even a `pine:block` note**, because the source is not a simple name. A gap in the loop-classification walk, not in R5. ⭐ **Scheduled WITH H.4** — the same walk change announces a dropped body and closes this gap |
| the **379** accumulators | with the 63 ceiling and the sensitivity table above |

## ✅ H.1 … H.4 — RULED (owner, chat, 2026-09-14)

### H.1 — ALPHA IS CARRIED · **a6.0 DONE** (`930645f50` red, `2639e03a1` green)

✅ **Landed, and measuring the consumers first cut it from a new field to one branch.**
`presentation.opacity` already existed, was already validated by `defSchema` and already
read by the renderer. Three of the four colour paths already carried alpha correctly:

| source | before | after |
|---|---|---|
| `color.new(color.red, 50)` | `opacity 0.5` | unchanged |
| `transp=40` | `opacity 0.6` | unchanged |
| `color.new(color.red, close)` | `colorDynamic` | unchanged |
| `color.rgb(255,0,0)` | no opacity | unchanged |
| **`color.rgb(255,0,0,80)`** | **alpha dropped** | **`opacity 0.2`** |

`colourNewAlpha` → `colourHelperAlpha`, reading `color.new`'s second argument and
`color.rgb`'s fourth through **one** `1 − t/100`, so the three paths cannot drift.
**No re-baseline**: no snapshot moved, because the 3-argument form is untouched — which
a permanent control asserts rather than leaves to luck.

---

### H.1 — the ruling, as recorded

A literal alpha on `color.rgb` / `color.new` is parsed, validated, and then **discarded**
at `staticColourOf` (`pine.js:11743`, branches `11768–76` and `11786–97`) because the
return is a 3-channel `#RRGGBB`. **`presentation` gains a carrier for a LITERAL alpha.**

⭐ A **dynamic** alpha still returns `null` — the existing comment is right, a dynamic
transparency makes the whole colour dynamic, and reading only the base hands the member
one flat colour and loses the effect.

⛔ **The carrier is chosen by MEASUREMENT of the consumers, not by taste.** Scope: **56
of 328** scripts feed a colour helper into `plot()` (`tools/pine_colour_census.py`).

### H.2 — THE FILL / DRAWING LAYER IS **item (j)'s** SCOPE

Uncharted Clouds is already a named wave-2 item; its visible artifact — the 20 `fill()`
calls at 118–137 — is **that item's rendering problem, not a new grammar item**. It is
**not** added to the (a)–(j) order.

⛔ **What a6 owes (j):** the `fill()` chart-only notes must **preserve their colour
arguments**, alpha included per H.1, rather than dropping them — so (j) can consume the
notes without re-parsing the source.

⭐ **a6's "Clouds verbatim with colours intact" is therefore redefined precisely:** both
lanes, 0 refusals, **and every plot presentation and every fill note carrying the colour
the source authored, alpha included.**

### H.3 — `color.t` STAYS A NOTE

The env closing pass's restraint — an unread-but-**readable** binding stays silent — is
load-bearing, and it is **not spent on one acceptance sentence**. Forcing `color.t` to a
refusal would put a line in the result for every `len = 14` in every script.

---

# a7 — MEASURED, AWAITING A GO. Much of it already exists.

⛔ **Evidence only — nothing built.** Recorded here because a plan that lives in chat
gets reconstructed from memory, which is why this file exists at all.

## 3.1 The shared contract EXISTS, and it is not `defSchema`

`defSchema` is the builder's definition schema and is JS-only. The actual JS↔Python
contract is the set of **committed JSON artifacts** under
`app/src/components/chart/engine/ast/*.json` plus `tools/lookback_agreement.json` —
**written by JS tests, read by Python rails**. `lookback_agreement.json` says so in its
own `_` field: *"WRITTEN BY lookbackAgreement.test.js, read by
tests/test_ast_lookback_agreement.py. Do not hand-edit."*

⚠️ **Versioning is NOT uniform** — measured: `closedTable.json` has `tableVersion`,
`conceptVocabulary.json` and `starterScans.json` have `version`, `symbolScope.json` has
**none**. Three spellings and one absence across one contract.

## 3.2 The Python twin EXISTS — 23 rails — and is a VERIFIER, not a translator

`tests/test_ast_*.py`, 23 files, plus `tools/ast_conformance.py`, which shells out to
node (`run_js`) and **refuses rather than reporting zero** when a lane cannot be
measured. They consume the 3.1 artifacts: `closedTable.json` ×2, `scalars.json`,
`must_repaint.json`, `multi_tree_parity.json`, `conformance_log.json`,
`clock_parity.json`, `bind_fold_parity.json`, `lookback_agreement.json`.

⭐ **So a7 does not contain "build a Python twin".** It contains extending and
documenting one that is already load-bearing — a materially smaller and different job
than the plan line implies.

## 3.3 The both-lane corpus run costs **5 seconds**. No sharding.

`corpusMetric.test.js` already runs **both lanes over 266 scripts**, producing
`host_ok` and `screener_ok` per script. Measured with the runner exit form:
**WALL 5s, tests 3.70s.** Extending to all 327 is ~4.5s of work.

⛔ **The OOM/sharding concern does not apply here** and assuming it would have been the
error: that behaviour belongs to the 12-chunk *pytest* lane, not to one short vitest
file. No shard count is needed.

## Proposed sub-steps — for a go, not started

| # | scope | estimate |
|---|---|---|
| **a7.1** | the shared contract stated AS a contract: who writes each artifact, who reads it, versioning made uniform (three spellings + one absence today), and a rail that fails when an artifact gains a field no reader knows | 45 min |
| **a7.2** | the both-lane agreement rail extended 266 → 327, asserting per-script lane agreement on FACTS (equal `refusals.length`), budgeted by the 5s measurement | 40 min |
| **a7.3** | the Python twin's coverage census — which of the 23 rails reads which artifact, and what is written but unguarded | 40 min |
| **a7.4** | snapshots · suites · the Python lane once (filename-scoped, chunked) · vite build | 60 min |
| **a7.5** | item (a) and wave-2(a) close-out records | 20 min |
| | **total** | **205 min** |

---

# a6 — CLOSED by R10. The fill contract was already met; a6.0 completed it

**H.2's definition, met:** both lanes, **0 refusals**, every plot presentation and every
fill carrying the colour the source authored, alpha included.

⭐⭐ **MEASURING FIRST FOUND THE OBLIGATION ALREADY SATISFIED — a6 required no engine
change.** The carrier is **not** the note: the chart-only note is
`{code, message, line, column, index, token, excerpt}` and carries no colour by design.
**`presentation.fills`** already existed, already resolved both plot handles to output
indices, and `resolveFillHandles` already had `color`/`opacity` fields — populated by
the fill collector from `outputPresentation(fargs, {env})`, *literally the same call a
`plot()` makes*. That is R10's "no second colour path" satisfied by construction.
The only gap was `color.rgb`'s alpha, which **a6.0** closed for every caller at once.

| fill colour | carried |
|---|---|
| `color.rgb(0,255,0,80)` | `{a:0, b:1, color:"#00FF00", opacity:0.2}` |
| `color.new(color.blue,30)` | `{color:"#2962FF", opacity:0.7}` |
| `color.rgb(0,255,0)` | `{color:"#00FF00"}`, no opacity |
| a dynamic conditional | `{a:0, b:1}` — no colour, never a guess |

## ⛔ WHAT ITEM (j) INHERITS, AND IT IS NOT WHAT THE RULING ASSUMED

**Clouds' 20 fills carry ZERO colours, and that is correct.** Their colour is

```
fill(p1, p2, color = isBullish ? getBullFillColor(0) : getBearFillColor(0))
```

— a conditional over two **user-defined functions**. `staticColourOf` folds neither, so
there is no single colour to carry. ⭐ **Item (j) must render a CONDITIONAL fill, not a
static one**, and `fillColourCarriage.test.js` records that so (j) does not begin by
hunting a colour that was never there. All 20 do carry their two resolved edges, which
is the half (j) needs.

## Metric-derived: what Clouds' verdict actually rests on

⚠️ **NOT `corpus_metric.json`** — measured: it holds **266 rows**, the
`corpus/committed` set, and **Clouds is not among them** (it is a member fixture under
`tests/fixtures/member/`). Anyone citing the corpus metric for Clouds is citing the
wrong artifact. The committed evidence, each a file in the repo:

| artifact | what it fixes |
|---|---|
| `app/src/components/chart/engine/ast/vectorUnroll.test.js` | the 21 layers are real, distinct interpolation trees; the block note at 59 is gone |
| `app/src/components/chart/engine/ast/fillColourCarriage.test.js` | 20 fills with resolved edges; **0 refusals on BOTH lanes**, asserted per lane |
| `app/src/components/chart/engine/ast/bothLanesAreTwoLanes.test.js:72` | the two lanes AGREE on Clouds, kept as the opposite of the disagreement case |
| `app/src/components/chart/engine/ast/alphaCarriage.test.js` | the fill note stays a sentence and carries no colour |
| `tools/lookback_agreement.json` | `distinct_trees_walked: 310`, the JS readers' own answer, read back by `tests/test_ast_lookback_agreement.py` |

## ⛔ THE VENDOR CAPTURE IS OWED — and the browser was CONNECTED

A browser **was** connected when a6 closed (`Browser 1`, Windows, local,
`69eb4a48-…`), so this is **not** "unavailable". It is owed for a different and
narrower reason, recorded exactly so the next session does not re-derive it:

> The Chrome tooling **requires an explicit per-browser confirmation from the owner
> before any browser action**, and the session that closed a6 was instructed not to ask
> mid-session. Those two cannot both be honoured, so the capture stops at the boundary
> rather than being taken on an assumed selection.

**What it needs when the owner is ready** — one line, so nothing is re-derived:
start the rig backend first (`docs/pine/wip/rig/boot_rig.py`, `UCT_RIG_DATA` pointing
**outside** every worktree — it refuses otherwise, and the default sandbox is EMPTY);
then Gate v2.1 on the driving tab before every write and screenshot, the binding gate
being own-text **`Add to chart` plus 0 studies** by the corrected probe and never
"editor closed"; the open Pine Editor on that tab is the owner's and is not touched.
Compare the hosted pane against the vendor render at Wave 1's tolerance, both tables,
and record the screenshot paths here.

---

# a5 — CLOSED by R9. Three members KEPT and FIXED, five refuse by name

⚰️⚰️ **THE CENSUS NUMBER WAS NOT GROUNDS TO REMOVE ANYTHING**, and ruling 0.2 is what
stopped it: *a threshold governs what is BUILT, never what is REMOVED.* `sum`, `max`,
`min` and `avg` were already in `REDUCE_MEMBERS` and `HANDLED`. Retiring them on
"0 of 209 corpus uses" would have deleted a tested capability on the strength of a
number that says nothing about whether it works.

**So R9 measured instead — and found a real defect and a false claim.**

| member | before R9 | after |
|---|---|---|
| `sum` | **`pine:roundtrip`, no formula at all** | `0 + 1 + 2` ✅ |
| `max` | `pine:roundtrip` | `max(max(0, 1), 2)` ✅ |
| `min` | `pine:roundtrip` | `min(min(0, 1), 2)` ✅ |
| `avg` | in the set, **never implemented** | refuses by name, 14 uses |
| `indexof` · `sort` · `includes` · `stdev` | generic collection refusal | refuse by name — 18 · 10 · 5 · 4 |

⛔ **THE DEFECT.** `vec.slots` holds **bindings**, not finished nodes — the `get` branch
four lines above says so and calls `resolveBinding`. The reduce branch fed raw bindings
into `cOp('+')`/`cCall`, so the output tree carried binding objects where canonical
nodes belong, the printer wrote text it could not read back, and **every** `array.sum`
/ `max` / `min` returned `pine:roundtrip` with no formula, for any slot content.
⭐ **Same class as BUG 1** — an object of the wrong language spliced into a tree,
failing silently downstream rather than at the splice.

⛔ **THE FALSE CLAIM.** `avg` was in `REDUCE_MEMBERS`, therefore in `HANDLED`, and the
fold implemented three of the four. The set promised more than the code did — the
"documented but unreachable" defect inside a data structure rather than in prose. The
set is corrected in place with the measurement, and a control now pins every
`REDUCE_MEMBERS` entry against the engine so it cannot drift again. ⭐ `avg` is a
two-line fold now that `sum` resolves its slots; recorded, not done, because
implementing it is scope R9 did not grant.

## The census that decided the refusals

# a5's census — 0 of 209 uses are admissible AND reachable

`tools/pine_reduce_census.py` (`683f2d076`), both controls green — the stripper's, and
the committed numbers it extends: **indexof 18/18 · sort 10/10**.

| member | uses | files | receiver settled | reaches an output | in-loop | **admissible** |
|---|---|---|---|---|---|---|
| `sum` | 105 | 16 | 27 | 4 | 59 | **2** |
| `max` | 33 | 17 | 12 | 0 | 8 | 0 |
| `min` | 20 | 9 | 13 | 3 | 8 | 0 |
| `avg` | 14 | 9 | 10 | 0 | 0 | 0 |
| `indexof` | 18 | 7 | 9 | 0 | 9 | 0 |
| `sort` | 10 | 7 | 5 | 0 | 1 | 0 |
| `includes` | 5 | 2 | 5 | 0 | 4 | 0 |
| `stdev` | 4 | 4 | **0** | 0 | 1 | 0 |

**The binding constraint per member is the CONSUMER, not the receiver** — and that is
the opposite of a4b, where BOUND bound everything. 81 of 209 uses have a settled
receiver; only **7** reach a `plot()`/`alertcondition()` at all. The rest feed drawing
objects and UDT fields, where this lane draws nothing anyway.

⛔ **And the engine closes the remaining 2.** Both were run through the shipped door
rather than judged from source:

| use | engine's answer |
|---|---|
| `machine-learning-knn-based-strategy:154` — `prediction := array.sum(predictions)` | first refusal `pine:collection@133`; **nothing at all at :154**, never reached |
| `machine-learning-lorentzian-classification:413` | first refusal `pine:module@7` — an `import`, the whole script hard-refused |

Both masked by an earlier refusal — the same pattern as the 13 owed `for … in` uses and
the corpus accumulators. **Admissible and reachable: 0 of 209.**

⭐ **a5.3 (the `na`-semantics comparison) is SKIPPED, correctly**: it is scoped to the
build set, and the build set is empty. Nothing about Pine's `na` behaviour needs
settling for members that will not be folded.

⚠️ **`stdev` and `includes` are attested after all** — 4 and 5 uses — so the hand-off
was not inventing them; they were simply in no SOURCE list. They are retired with the
rest, on their numbers.

⛔ **Retirement means the same shape as R1 and R7:** the member call refuses by name at
its own line, carrying its number. **Estimated 45 minutes**, not yet implemented.

### H.4 — A DROPPED LOOP BODY IS ANNOUNCED, AS A NOTE, LATER

A member whose `for … in` body is discarded should see a note **at the loop line** saying
so. ⭐ Scheduled together with the owed **UDT-field-access** gap
(`candelacharts-equal-highslows-eqheql__4485a6c447:135`), because the same
loop-classification walk change serves both. **Not this session** — recorded as owed
under R1 with this ruling.
