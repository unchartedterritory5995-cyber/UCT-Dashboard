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
| **(j)** | Uncharted Clouds as the wave-2 target — ⛔ **see R11: (j) renders a CONDITIONAL fill** |

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

> ### ⭐⭐ R18 SITS BESIDE THIS AND DOES NOT ERODE IT (2026-09-15)
>
> R18 builds `request.security`'s **array-literal argument** at 15 reachable uses,
> which is under the threshold read on its own. **That is not a reversal of the
> sentence above**, and the distinction is recorded at both ends so neither can be
> cited for the other:
>
> | | R1 (here) | R18 (item (c)) |
> |---|---|---|
> | the FORM | `for … in` — **does not ship at all** | tuple destructure from `request.security` — **ships**, 193 uses, 20 reachable, **at** the threshold |
> | what was asked for | build a form the corpus does not exercise | carry one **argument shape** of a form already carried for its ~103 other uses |
> | needs | new machinery | **nothing** — same `parts`, same `securityAsNode`, **no 12th node type** |
> | the argument rejected | *"a3's machinery makes it cheap"* | — R18 does **not** rest on cheapness either |
>
> ⛔ **"Cheap, so build" remains rejected.** R18's grounds are that **the form
> clears the threshold and an argument shape of a shipping form is not a separate
> form to threshold**. ⚠️ A future argument shape that needs a new node type, a new
> mechanism, or its own breaker analysis **is** a separate form and is thresholded
> on its own.

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

# ✅ R30 — A FILL IS DRAWN AS **RUNS** (owner, 2026-09-16)

> `createFillPrimitive` receives **per-point colours** — the array
> `columnColorsForPlot` yields for the fill *exactly as it does for a plot* — and draws
> **one polygon per RUN**, a run being a maximal sequence of consecutive points whose
> resolved colour is identical. `ctx.fillStyle` is set **once per run**.

| case | what R30 requires |
|---|---|
| a **static**-colour fill | resolves to **one run**; its draw calls are **byte-identical to j.2's** — this is the control |
| a point whose colour resolves to **`null`** (na condition, dynamic transparency) | **ends the current run and starts no polygon** until the next non-null point |
| run boundaries | computed **once per frame** from the colour array |

⛔⛔ **AN `na` BAR IS A GAP, NEVER A GUESS.** Carrying the previous colour across it would
paint a band over bars the script says nothing about — the same class of lie as a
tolerance on a count. The acceptance pins it with a fixture whose middle bar is `na`.

⭐ **Why "runs" and not "per-point":** a fill is an AREA between two series, and an area
needs a polygon; a colour that changes mid-polygon has no meaning. Runs are the smallest
unit on which a fill colour *can* be defined, which is why this is a ruling about the
draw and not about the carriage.

---

# ✅ R31 — `PR-BODY-COMBINED.md` IS **GENERATED**, AND RAILED (owner, 2026-09-17)

> A rail rebuilds the combined body from its recipe — **header + `PR-BODY.md` +
> `PR-BODY-WAVE2.md`** — and **byte-compares** it against the committed file. A
> mismatch is **RED**.

⛔⛔ **THE RECIPE LIVES IN ONE PLACE.** A small tool under `tools/` owns it, and both
the rail and the human call that tool. ⛔ **The test must NOT restate the recipe** — a
second copy of "how the file is built" is the very defect this ruling closes, and a
rail carrying its own recipe would agree with itself while the artifact drifted.

⚰️ **THE INCIDENT IT ENCODES.** `PR-BODY-WAVE2.md` was updated when j.1 landed and the
derived file was not regenerated, so **#145 described (j) as "scoped only, 11 gaps with
file:line" through both j.1 and j.2**. Nothing could detect it: the combined file is
generated, nothing regenerated it, and no check compared the two. It was found only by
rebuilding the file and comparing — which is now the rail.

⭐ **This is `two authorities over one value`, in its GENERATED form.** The repo has
recorded that shape for a sentence, a job and a field spelling; a generated artifact
that nothing regenerates is the fourth, and it is the quietest, because the source of
truth is *correct* the whole time.

**Mutation proof:** edit `PR-BODY-WAVE2.md` without regenerating ⇒ **RED**.
**Non-vacuity:** the rebuild is asserted non-empty and to contain **both** wave headings,
so the comparison cannot pass over an empty rebuild.

---

# ✅ R32 — j.3b AUTHORISED: **CENSUS FIRST, NARROWEST FOLD THAT CARRIES CLOUDS** (owner, 2026-09-17)

> The translator must carry a fill colour that is a **user-function call returning a
> colour**. Two candidates; **the census decides**.

| | candidate | scope |
|---|---|---|
| **(i)** | **NARROW.** `staticColourOf` resolves a user-function call by **substituting the function's body** when that body is a **single colour expression** (`color.new` / `color.rgb` / a colour constant, possibly with arithmetic on a plan-time argument) **and every argument at the call is plan-time**. | **Colour positions only.** Nothing outside `staticColourOf` changes. A body that is not a single colour expression returns **null with the dynamic reason**, exactly as a dynamic alpha does today. |
| **(ii)** | **GENERAL.** A constant folder over user functions, corpus-wide. | Everything. |

⛔ **CHOOSE (i)** if it carries Clouds' 20 fills **and** its blast radius stays inside
colour positions. ⛔ **(ii) ONLY IF (i) PROVABLY CANNOT CARRY CLOUDS** — and then it
**STOPS for a go**: a general folder is a ruling, not an implementation detail.

⛔⛔ **THE CORPUS RE-BASELINE IS DONE AND REPORTED BY ARTIFACT EITHER WAY.** A colour
that starts carrying where it was dropped before is the **INTENDED** change and is
**listed per script**. ⭐ The census predicts which scripts move; the re-baseline
reports predicted-vs-actual, and **predicted-and-unmoved is a finding too**.

---

# R11 — ITEM (j) RENDERS A CONDITIONAL FILL (owner, 2026-09-14)

⛔ **(j) must not begin by hunting a static colour. There is none, and that is correct.**

Every one of Clouds' 20 fills reads

```
fill(p1, p2, color = isBullish ? getBullFillColor(k) : getBearFillColor(k))
```

— a conditional over two **user-defined functions**. `staticColourOf` folds neither, so
the fill carries no static colour. **(j)'s obligation is to render a fill whose colour
is a conditional expression over a series**, not to locate a colour that never existed.

**The note object, verbatim, measured at a6 (2.1):**

```json
{ "code": "pine:chart-only",
  "message": "`fill` paints on a chart; TradingView's own screener reads plot() and
              alertcondition() and nothing else, so this line is ignored here too",
  "line": 118, "column": 1, "index": 6603, "token": "fill",
  "excerpt": "fill(p1, p2, color=isBullish ? getBullFillColor(0) : getBearFillColor(0))\n^" }
```

⭐ **The note is a sentence and carries no colour by design.** What (j) consumes is
`presentation.fills` — 20 entries of `{a, b}` with both plot handles already resolved
to output indices, and `color`/`opacity` present **only** where the source authored a
static colour. Clouds authored none, so (j) gets the edges and must supply the
condition itself.

---

# ✅ a7 — CLOSED by R12. The contract is four files, and the suite found one of ours.

**Closed 2026-09-14.** All five sub-steps ran, each as its own block with its own
estimate and 2× stop, each pushed before the next began.

## The a7 report — eight lines

1. **CONTRACT** — **four** committed files, not the twelve the scoping note named;
   six of those names are generated into temp dirs and never committed, and *a
   transient file is not a contract*. **R12: one field, `version`**, chosen by
   majority and added **at the writer**, additive, proven by key-set (one key added,
   none removed, all 54 rows byte-identical). `docs/pine/CONTRACT.md`.
2. **RAIL** — `contractVersions.test.js` asserts the **value**, not the presence
   (*"has a version"* is the adjacent property), asserts the field at the **writer**
   (the half a regeneration can undo), and asserts no fifth spelling has appeared.
   Mutation-proved both ways: field removed → RED; value `99` → RED, naming what it
   found.
3. **TWIN COVERAGE** — the oracle READS 8 fields, IGNORES 4, **DEMANDS none**:
   **zero** read-but-not-always-written defects. Shared-reader files are reported
   NOT DETERMINABLE rather than invented — the census's own first run reported
   **219 false defects** including `pid`, `url` and `token`, and was fixed before
   its number was trusted.
4. **SUITE** — full vitest, **1473/10 files · 21,378/13 tests · 379s · 0 timeouts**.
   All 13 reds classified by evidence: six recorded pre-existing, three provably
   master's or the Notebook's, one environment (green alone, red in company), and
   **two ours** — `reachable.test.js` (now registered, 0.2) and the Track F
   collision (**R13**).
5. **BUILD** — vite, alone, after every test process exited: **exit 0**, 18.21s.
   Python twin, 25 files **by name** in two serial scopes with `check_scope_paths.py`
   in front of each: **811 passed · 5 skipped · 1 xfailed · 0 failed**, both exit 0.
6. **CAPTURE** — **still owed**, and the blocker is **not** the browser. The rig runs
   (PID 18792, port 8129) and the sandbox is verified by content, but **no Clouds
   definition exists**, and the pane would render **2 of 23** outputs (21
   author-hidden, fills chart-only). A pixel comparison today would measure item
   (j)'s gap, not a6's. It is **(j)'s precondition**.
7. **OWED** — the list below, current as of this close.
8. **PENDING ON THE OWNER** — H.4; the **Wave 1 PR from `acdf93455`** with
   `docs/pine/PR-BODY.md` pasted verbatim, **still unopened**; the per-module veto on
   the eight 0.2 register entries; and any ruling a7.2's findings call for.

## ⛔ OWED at a7 close — carried, not lost

| # | owed | measured state |
|---|---|---|
| 1 | **13 `for … in` uses** | reopened on member evidence, not a hunch (R1(ii)); R6 measured the case **MOOT on every one** |
| 2 | **function-parameter sources** | a source that is a function parameter — not settleable at plan time |
| 3 | **UDT-field-access sources** | R5: stays where it already speaks, and **notes** |
| 4 | **accumulators — 1 of 379** | ceiling: **63 of 379** have a settleable bound (a4b) |
| 5 | **the vendor capture** | blocker named above: no Clouds definition; 2 of 23 outputs. **(j)'s precondition** |
| 6 | **a7.2 finding 1** | ✅ **OPENED AS R14** (owner, 2026-09-15) — see below. **13 scripts differ on refusal FACTS between lanes**, asserted as a SET so fixing one goes red. ⚰️ The shape is the opposite of expected: on several the **lenient lane refuses MORE than strict** (`uncharted-volume-v2`: strict 0 vs lenient 4 × `pine:function`). **Outputs agree on all 327**, so no column is lost either way |
| 7 | **a7.2 finding 2** | exactly **one** script THROWS out of `translatePine` — `smart-money-breakouts-chartprime__ea79c79a67.pine`, `pine:statement`, **both lanes identically**. Already known and routed as a corpus item; asserted by exact name so the day it is fixed the rail goes red and the finding retires |
| 8 | **a7.3 candidates** | **four written-but-unread** oracle fields — `_`, `distinct_trees_walked`, `hash`, `version`. ⛔ **Recorded, NOT removed**: a threshold governs what is built, never what is removed, and removal needs its own authority and its own commit. `version` is unread **by design** (R12: written before it is read) |
| 9 | **a7.3 defects** | **none** — zero read-but-not-always-written across dedicated readers |
| 10 | **six pre-existing reds** | `BuilderSheet.pine` ·1, `ImportBox.thinkscript` ·1, `pineBoxSuggestVoice` ·3, `pollingSites.rail` ·1 (R-P extended; the sites are master's `d26695853`, `611bcf92e`) |
| 11 | **three provably not ours** | `tapFloor` — offender is the Notebook's own `CaptureDialog.module.css`, and this branch touches **0** files under `journal-2-0` · `ChartDrawingOverlay.surfaces` — rail **and** the source it reads are byte-identical to `da0803baa` · `ThemeTrackerPage.chartmount` — `vi.mock`s **both** `StockChart` and `ChartPane`, so this branch's `StockChart.jsx` edits cannot reach it |
| 12 | **`AuthContext.test.jsx`** | **environment**, not defect — **green alone** (8/8) and red only in the full suite |
| 13 | **`reachable.test.js`** | eight modules registered under 0.2 (dated, expiring at Wave 2 close, owner veto per module). **Still red for exactly one: `focusDivergence.js`, master's R-29** — not ours to register, and silencing another workstream's defect in our register is the one thing it must never do |
| ~~14~~ | ~~**R13 — the Track F collision**~~ | ✅ **CLOSED** — `c7b79c29e` red, fixed below. No longer owed |

## ✅ R13 — CLOSED. The closing pass resolves; it does not mint.

**The defect, as it was found.** `paramSingleTranslation.test.js` — this branch's own
rail — went red on `bullFloor is claimed twice`, a **declared member input that was
also a Track F parameter**. Two authorities over one input, which is the thing that
rail exists to catch.

**Attributed by BISECT, not by argument.** The consumer (`builderInputs.js`) has not
moved since `b7e17572f` (2026-09-07), so one specimen went through seven engines with
only the translator swapped: 5 parameters and an empty overlap at pre-wave-2 and at
a3; **24 and a collision from `bdc1050ad` onward**.

**The mechanism, measured rather than reasoned** — every mint tagged with the site
that made it:

| minted by | n | names |
|---|---|---|
| the output loop | **5** | `rsiLen` `regLook` `useRev` `revPiv` `showSetup` |
| **the closing pass** | **19** | the rest, **including `bullFloor`, `regTol`, `bearCeil`** |

⛔ The closing pass's own loop guard is `if (… || bound.read) continue`, so **all 19
came from bindings nothing reads**. The pass was built with a stated restraint —
*"it resolves each leftover once and reports only what refuses"* — and that was **true
of notes and false of parameters**: the probe carried the live `paramMint`, so
resolving an unread binding also **minted a member-visible control**, through a
channel the doctrine never mentioned. It stayed silent where it promised to and spoke
where nobody had checked.

⭐ **Why the three collided specifically.** They are declared member inputs. In the
output loop that is decided by `declareInputs`, whose early return hands back a
`series` leaf and **never reaches the mint**. The probe is built *without*
`declareInputs`, so for it no name is declared and all three fall through. The
**declared member input is the legitimate authority**; the Track F mint was the second
one.

**The fix — one option at one construction site.** `paramMint: null` on the probe. The
pass is not restructured; its notes product is untouched. ⭐ The object-pass factory a
few hundred lines below has passed `paramMint: null` since it was written, for exactly
this reason — **this was the site that did not**.

⭐ **5 is the correct number, and that was checked rather than assumed.** A Track F
parameter is a literal that survives into a **rendered output's** tree; a binding no
output reads contributes no tree, so it has no literal to adjust and must mint
nothing.

**Rails** — `closingPassDoesNotMint.test.js`, with two controls that make
over-correction visible: a READ binding still mints (`len`), and the closing pass
**keeps** its notes product on Clouds (`pine:colour-value@90/@91` and the eight
`pine:input-kind` lines, pinned **by value**). ⛔ R13 must not spend the closing
pass's gain to fix its overreach, and that control is what says so.

⚰️ **The acceptance's own first draft was vacuous and is recorded in the file rather
than quietly fixed:** it read `declared` off a raw `translatePine`, which does not
populate it, so the overlap was empty *because the set was empty* and the `it.fails`
guarding it **passed** — reporting the defect as already fixed. It now goes through
`memberInputTranslation` and carries a non-vacuity control asserting the door declared
ten names and minted something.

**Mutation-proved** against a fresh byte-exact copy (`sha256 89304cb7…`, restored and
re-verified):

| mutation | result |
|---|---|
| guard removed (`paramMint` restored on the probe) | **4 RED** — the count, the overlap, the three names, **and `paramSingleTranslation` itself** |
| guard too broad (`paramMint: null` on the *output loop* too) | **3 RED** — the read-binding control (`expected [] to deeply equal ['len']`), the non-vacuity control, and the count |

**Green alone and in company:** `paramSingleTranslation` 11/11 alone; the
`engine`+`builder`+`pane` scope **370 files · 7,461 passed · 32 skipped · 5 failed in
3 files · 0 timeouts** — the same recorded pre-existing trio as the baseline, no new
reds. **No committed artifact moved**, so no re-baseline: the fix changes no verdict,
no refusal and no output count.

## ⛔⛔ R13 — the assertion it was owed against, kept verbatim

```
FAIL  src/components/chart/builder/paramSingleTranslation.test.js
      > C2D.1 — a declared member input is NOT also a Track F parameter
      > one Pine input gets exactly one control
AssertionError: bullFloor is claimed twice: expected true to be false
 ❯ src/components/chart/builder/paramSingleTranslation.test.js:199:78
```

**Attributed by BISECT, not by argument.** The consumer (`builderInputs.js`) has not
moved since `b7e17572f` (2026-09-07), so one specimen
(`mid_engagement__22-rsi-levels-regime-map`) was run through seven engines with only
the translator swapped:

| engine at | declared | Track F params | overlap |
|---|---|---|---|
| `8e71fbf12` (pre-wave-2) | 10 | **5** | **`[]`** |
| `a1de7a6f5` (a3, the unroll) | 10 | **5** | **`[]`** |
| **`bdc1050ad`** (the env closing pass) | 10 | **24** | **`bullFloor`, `regTol`, `bearCeil`** |
| HEAD | 10 | 24 | the same three |

⛔ **`bdc1050ad` is the cause.** Resolving bindings nothing reads took the specimen
from 5 Track F parameters to 24, and three of the nineteen newly-surfaced ones are
**also declared member inputs** — *two authorities over one input*, which is exactly
what the rail exists to catch. Ruled **0.3**: fixed before item (b), own block, own
estimate, red acceptance first.

---

# a7 — the evidence it was scoped from (kept; nothing built at this point)

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

## ✅ The sub-steps, as they actually ran

| # | scope | estimate | actual | commit |
|---|---|---|---|---|
| **a7.1** | the shared contract stated AS a contract, versioning made uniform, a rail that fails on an unknown version | 45 | **55** | `8281fbcf4` |
| **a7.2** | the both-lane agreement rail extended 266 → 327, asserting lane agreement on FACTS | 40 | **45** | `029aa4c86` |
| **a7.3** | the Python twin's coverage census — who reads what, and what is written but unguarded | 40 | **50** | `5925f0dec` |
| **a7.4** | snapshots · suites · the Python lane once (filename-scoped) · vite build | 60 | **75** | `d1485c51e` |
| **a7.5** | item (a) and wave-2(a) close-out records | 20 | *this block* | — |
| | **total** | **205** | **~245** | |

⭐ **Every sub-step came in over its estimate and every one stayed inside its 2×
stop.** No estimate was revised mid-block in either direction. The overrun is
concentrated where the measurement contradicted the scoping note — a7.1 found the
contract was four files rather than twelve, and a7.4 found a regression nobody had
budgeted for, which is the outcome a full suite is *for*.

## ✅ THE ARC a1 → a7 IS COMPLETE

| sub-step | what closed it |
|---|---|
| **a1** | the census — 327 scripts, the shapes (c) inherits named as an exact set |
| **a2** | an array is a plan-time vector; a creation is RECORDED |
| **a3** | the slots are filled — Clouds unrolls, the acceptance goes green |
| **a4 / a4b** | four forms retired **on measurement**: `while` 15/116, `for x in` 13/92, `for [i,x] in` 0/34, accumulator 1/379. Rulings R1–R8 |
| **a5** | R9/R9a — `sum`/`max`/`min` **fixed and kept**, `avg` folds, five refuse **by name with their census numbers** |
| **a6 / a6.0** | R10 — the fill contract was already met via `presentation.fills`; a6.0 carried `color.rgb`'s alpha into `presentation.opacity` |
| **a7** | R12 — the contract is four files; the twin is covered; the suite is measured and every red attributed |

⛔ **Item (a) is closed. Wave 2 is NOT** — R13 is closed, and items (b)–(e) are
where the wave continues. **(b) is censused below and awaits a ruling.**

---

# ⭐⭐ ITEM (b) — TIME INPUTS. DEFINED BY MEASUREMENT; **ALL-RETIRE PROPOSED**.

Item (b)'s definition existed only as the words *"time inputs"* in chat and was never
committed. This census defines it the way a1's defined the loop forms: by counting,
with the threshold applied after.

**Instrument:** `tools/pine_time_input_census.py` (`c4018c603`), 328 scripts.
**Control:** the product's own answer — Clouds' **8** `pine:input-kind` refusals,
pinned by value in `closingPassDoesNotMint.test.js`, re-derived exactly, **and zero
time-shaped inputs**, so ⭐ **item (b) does not touch Clouds at all.**

## b.1 — what the engine does today

`Resolver.resolveInput`'s `NUMERIC` set is the whole of it. Everything else throws
`pine:input-kind` — *"this Pine input carries a default the engine grammar cannot
hold"* — in a **value** position.

| handled → `num` | uses | | refuses `pine:input-kind` | uses |
|---|---|---|---|---|
| `input.bool` | 1726 | | `input.color` | 1068 |
| `input` (bare, v3/v4) | 1357 | | `input.string` | 1018 |
| `input.int` | 1249 | | **`input.timeframe`** | **158** |
| `input.float` | 481 | | **`input.session`** | **70** |
| `input.source` | 76 | | `input.symbol` | 55 |
| `input.price` | 1 | | **`input.time`** | **20** |
| | | | `input.text_area` | 15 |
| | | | `input.enum` | 14 |

⚰️⚰️ **THE RIGHT-HAND COLUMN ABOVE IS WRONG, AND IT IS CORRECTED HERE RATHER THAN
REWRITTEN.** It reads its verdict off `NUMERIC` **set membership** instead of
measuring, and the flat shape hid that the refusal is position- *and* read-dependent.
Measured through the shipped door at R16 (2026-09-15), with inert consumers and a
column that varies so `pine:constant-only` cannot relocate over the answer:

| kind | READ by an output | UNREAD (the closing pass) |
|---|---|---|
| `input.time` | ⛔ **REFUSES `pine:input-kind`** | note `pine:input-kind` |
| `input.timeframe` | ✅ translates, no refusal | note `pine:input-kind` |
| `input.session` | ✅ translates, no refusal | note `pine:input-kind` |
| `input.string` | ✅ translates, no refusal | note `pine:input-kind` |
| `input.color` · `input.symbol` | ✅ translates, no refusal | note `pine:input-kind` |
| `input` (bare) | ✅ translates, no refusal | note **`pine:text-value`** |
| `input.int` (timestamp) | ✅ translates | **nothing** — it is `NUMERIC` |

⭐ **So of the 277 time-shaped uses, only `input.time` refuses on the read path.** The
`pine:input-kind` sentence a member actually meets for the other kinds is a **NOTE on
an unread binding** — the closing pass's product (R13 / `bdc1050ad`), *"this lane
cannot read line N"* — which is exactly where **Clouds' eight lines** come from.

⛔ **There is therefore ONE site, not the four the scoping assumed** — the `NUMERIC`
gate in `resolveInput` — and it serves both paths, so one per-kind sentence covers
both. `input.timeframe`, `input.string` and bare `input` still fold in a **timeframe
position** via `timeframeLiteralOf`; that is how 97 of the 158 reach the member, and
R16 does not touch it.

**Clouds' eight lines, by kind: 4 × `input.string` (lines 10, 11, 17, 18) and 4 ×
`input.color` (13, 20, 24, 26).** Not one is time-shaped.

## b.3 — the admissibility test, recorded as the rule for every later input kind

> **A kind is admissible only if its value has a carrier among the frozen 11
> `NODE_TYPES`. No 12th type. If there is no carrier, the kind is inadmissible BY
> CONSTRUCTION and the census says so per use rather than counting it as an
> opportunity.**

| shape | carrier | verdict |
|---|---|---|
| timeframe literal (`'D'`, `'240'`, `'12M'`) | **`tf`** — already a node type, already folded by `timeframeLiteralOf` | admissible |
| timeframe empty (`''` = the chart's own) | **`tf`** — `basePeriod` already carries it; needs no literal | admissible |
| timestamp (`timestamp(…)`, epoch int) | **`num`** | admissible |
| **session** (`'0930-1600'`) | **`str` — and `str` may appear ONLY where a `textop` consumes it**, a parentage `assertCanonical` enforces | ⛔ **INADMISSIBLE** wherever the consumer is a time comparison rather than a `textop` — which is every real use |
| day-mask (`'1234567'`) | same `textop`-only rule as session | ⛔ inadmissible, and **not a timeframe** |
| expression default | **none at plan time** | the (c) boundary |

⛔ **A use consumed by `request.security` is item (c)'s and is routed there by name,
never counted as (b)'s.**

## b.4 — the table. **Not one kind clears the threshold.**

| kind | uses | files | → item (c) | (b)-eligible | ⭐ **REACHABLE** | carrier | vs ~20 |
|---|---|---|---|---|---|---|---|
| `input.timeframe` | 158 | 61 | **97** | 61 | **9** | `tf` ✅ | **under** |
| `input.session` | 70 | 23 | 0 | 70 | **13** | `str` ⛔ | **under + inadmissible** |
| `input.time` | 20 | 11 | 0 | 20 | **6** | `num` (15) / none (5) | **under** |
| `input.string` (tf-shaped) | 14 | 3 | 0 | 14 | **0** | `tf` | **under** |
| `input` bare (time-shaped) | 14 | 13 | 10 | 4 | **2** | `tf`/`str`/`num` | **under** |
| `input.int` (ts-shaped) | 1 | 1 | 0 | 1 | **0** | `num` | **under** |
| **total** | **277** | 97 | **107** | 170 | **30** | | |

**REACHABLE** = the value reaches a `plot`/`alertcondition` **and not via
`request.security`**. That is the only number the threshold may use: this lane draws
**columns for a screener**, so a timeframe that reaches only a drawing draws nothing
here, and one that reaches a column through `request.security` is already item (c)'s.

⛔ **11 bare-numeric defaults under non-timeframe kinds are reported UNDECIDABLE and
NOT COUNTED** in either direction — the engine reads such a literal as a timeframe
only when a timeframe *position* asks, and this census has no position.

### The binding constraint, per kind — stated the way BOUND and CONSUMER were

| kind | binding constraint |
|---|---|
| `input.timeframe` | **`request.security` already consumes 97 of 158.** The residue is 9 uses that reach a column by another path. The carrier exists and the fold exists; what does not exist is a population. |
| `input.session` | ⛔ **the carrier, not the count.** Even at 13 reachable, a session string's only home under the frozen 11 is `str`, which `assertCanonical` admits **only as a `textop` operand**. A session feeding `time()`-in-range is not that. Building it needs a 12th node type, which Mechanism A forbids. |
| `input.time` | 15 of 20 defaults are `num`-carryable; **5 are expressions with no plan-time carrier** (the (c) boundary). Reachable 6. |
| `input.string` / `input` bare | they fold through the **same `tf` path** as `input.timeframe` and add no separate mechanism — 0 and 2 reachable. |
| `input.int` (ts) | a single use, in one file. |

## b.5 — PROPOSED: **RETIRE ALL SIX BY MEASUREMENT.** Owner's go required.

⛔ **This is a proposal, not a decision, and nothing is implemented.** Per the standing
rule, *a threshold governs what is BUILT, never what is removed* — so this proposes
**refusing by name**, which is what these kinds already do; it removes no working
capability. Every one of the 277 uses refuses today, and would continue to.

**What the retirement would build** (the R7/R9 shape): each kind refuses **at its own
line**, by name, carrying **its kind, its census number, and where it routes** —
never *"not supported"*:

- `input.timeframe` → *"…9 of 158 uses reach a column by a path other than
  `request.security`, which already carries the other 97; multi-timeframe reads are
  item (c)'s."*
- `input.session` → *"…a session string has no carrier in this lane's grammar; it can
  only exist as a `textop` operand."* ⭐ This one is a **grammar** sentence, not a
  threshold sentence, and should stay true even if the count later rises.
- `input.time` → *"…15 of 20 defaults could be carried as numbers, 6 reach a column;
  under the threshold."*

**Retirement estimate: 50 minutes** (six refusal sentences with their numbers, one
acceptance with the non-vacuity control named per 0.1, mutation proof, corpus
re-measure).

## ✅ R15 — ITEM (b) IS THE VALUE-POSITION RESIDUE (owner, 2026-09-15)

**The question the census raised and could not settle, recorded here with its answer
so it is not re-asked:**

> *`input.timeframe` is 158 uses across 61 files and reads as "retire" only because 97
> of them already work. Does item (b) mean "make timeframe inputs first-class on the
> definition lane" — population 158, answer inverts — or "the value-position
> residue"?*

⛔ **ANSWERED: the residue. Item (b) never meant "first-class".** A timeframe input in
a **timeframe position already folds** (`timeframeLiteralOf`), and its dominant
consumer — `request.security` — is **item (c)'s by name**. Item (b) is what remains
once those two are subtracted, and the census says that remainder clears no threshold.

⭐ **Why this matters beyond (b):** the census's own instrument had to be fixed three
times before it could state the residue honestly, and the third fix — crossing a
function boundary into `f_calc_mtf_ma`'s body — moved `input.timeframe` from 38
reachable to **9**. A four-fold inflation, in the direction that argues for building
what (c) already owns. **The ruling and the instrument agree only because the
instrument was corrected first.**

## ✅ R16 — ITEM (b) RETIRES BY MEASUREMENT, WITH ONE GRAMMAR REFUSAL

⛔ **No working capability is removed. All 277 uses refuse today under
`pine:input-kind` and continue to.** What the retirement builds is **six sentences**
at the existing sites, each carrying **kind, number and routing** in place of one
generic sentence. **The code stays `pine:input-kind`** — no 42nd refusal.

| kind | retires on | the sentence carries |
|---|---|---|
| `input.timeframe` | **count** — 9 reachable of 158 | `158/61`, *"97 reach `request.security` — item (c)"*, and that **a timeframe position already folds** |
| **`input.session`** | ⛔ **GRAMMAR, not count** | `70/23` and the grammar reason: its only carrier under the frozen 11 is `str`, which `assertCanonical` admits **solely as a `textop` operand**; a session feeding a `time()`-in-range comparison is not that, and building it needs a **12th node type**. **No routing — nothing owns it.** ⭐ This stays true if the count rises |
| `input.time` | **count** — 6 reachable of 20 | `20/11`; 15 carry as `num`, and the **5 expression defaults route to (c)** |
| `input.string` in a tf position | same path as `input.timeframe`, no separate mechanism | `14/3`, one sentence |
| `input` bare, time-shaped | **count** | `14/13`, **10 route to (c)** |
| `input.int` as timestamp | **count** | `1/1` |

⭐ **`input.session` is the one that is not a threshold call.** Every other row could
be reopened by a corpus that shifts; this one could not, because it is a statement
about the grammar rather than about the population.

**Estimate 50 accepted; 2× stop 100.**

### ✅ R16 BUILT — with its premise corrected by measurement first

⛔ **R16 said "six sentences at the existing sites (7754/7758/7780/7793)" and that
"all 277 refuse today under `pine:input-kind`". Measured, neither held** (see the
corrected b.1 table above). What was built instead, and why it satisfies the ruling's
intent exactly:

| ruled | measured | built |
|---|---|---|
| six sentences | **four** kinds have something to say | `timeframe` · `session` · `time` · `string` |
| at four sites | **one** site — `resolveInput`'s `NUMERIC` gate | one per-kind table there |
| all 277 refuse | only `input.time` refuses when READ; the rest note when **unread** | one sentence serving **both** paths |
| `input.int` (ts) sentence | it is `NUMERIC` and **already folds** — emits nothing | **no sentence**, and the acceptance pins that |
| `input` bare sentence | notes `pine:text-value`, a different code | **no sentence** at this site |

⭐ **The intent is met and the count is not:** a member who meets any of the four now
gets **kind, number and routing** instead of one generic line, down whichever path
they meet it. **Code stays `pine:input-kind`** — no 42nd.

**Rails:** `inputKindSpeaksItsNumber.test.js`. Non-vacuity control named per the
2026-09-14 standing rule — each of the four named corpus specimens is asserted to
exist, to contain its kind, and to emit at least one `pine:input-kind` line, so no
sentence assertion can pass over an empty list. Controls: a handled kind still folds
to `num`; **`input.timeframe` in a timeframe position still folds, asserted by the
FOLDED VALUE `'D'`** rather than by the absence of a refusal; and `input.int` as a
timestamp emits nothing.

⚰️ **Two discarded probe designs are recorded in the rail rather than dropped:** the
first used `time >= t` as the consumer and caught `pine:builtin` (milliseconds vs
seconds) — the *consumer's* refusal, not the input's; the second used a constant
column, so **`pine:constant-only` relocated over the input refusal** — a refusal
relocates and never joins, so `refusals.length` stayed 1 and the sentence under test
was invisible.

**Mutation-proved** against `sha256 8294bd94…`, restored byte-equal and re-verified
9/9: revert `input.session` to the generic sentence → **2 RED, both session, nothing
else**; strip `input.timeframe`'s routing → **1 RED on its sentence and the
timeframe-position control stays GREEN**, which is the assertion that stops the fix
being paid for out of `timeframeLiteralOf`.

**Baseline:** `engine`+`builder`+`pane` **371 files · 7,470 passed · 32 skipped · 5
failed in 3 files · 0 timeouts** — the recorded pre-existing trio, unchanged. **No
snapshot moved and no artifact moved**: the sentence is an extension of the message
and nothing pinned the old string.

# ⭐⭐ R14 — a7.2 FINDING 1 OPENS: WHICH LANE IS WRONG?

**Owner, 2026-09-15.** On **13 of 327** scripts the **LENIENT** lane refuses **more**
than **STRICT** — `uncharted-volume-v2.pine` strict **0** against lenient **4 ×
`pine:function`**; `atr-trailing-stoploss` **0** against **5** — while **outputs agree
on all 327**.

⛔ **Both member scripts are among the 13, and `uncharted-volume-v2` is Wave 1's
SHIPPED PANE.** That is what makes this a ruling rather than a curiosity: if the
strict lane is the one that is wrong, a refusal is being hidden on a pane that is
already in front of members.

⛔ **MEASURED FIRST, FIXED SECOND. The direction of the fix is decided by which lane
is RIGHT, never by which is quieter** — "make the noisy lane match the quiet one" is
the shape that turns a hidden defect into a permanent one.

The measurement is Section 2 of this block; no fix is made in the same session.

## ✅ R14 MEASURED — the mechanism is **(C): both lanes are right about different facts**

**Four scripts from three sources first, then all 13.** Measured 2026-09-15, lenient
vs strict, through the shipped door.

### 2.1 — `uncharted-volume-v2.pine`

| | lenient (`mode: screener`) | strict (`mode: host`) |
|---|---|---|
| `ok` | true | true |
| outputs | **5** | **5** |
| titles | `[null, "Avg Vol Columns", null, null, null]` | `["Volume", "Avg Vol Columns", "Avg Vol Line", "Scale Padding", "HVE Trigger"]` |
| refusals | **4 × `pine:function@227`** | **0** |
| tree contains `cum` | **no** | **yes** |

Line 227 is `hasVolumeData = ta.cum(nz(v)) > 0`. ⭐ **The four are not duplicates of
one fact: they are one refusal per DROPPED OFFER** — four of the five columns could
not be built, and each says why. The count matches the untitled outputs exactly
(`atr-trailing-stoploss`: 5 refusals, 5 untitled).

### 2.3 — the mechanism, named from all 13

⛔ **Every lane-only refusal falls inside that lane's own admissibility class.** The
distinct sentences, across the 13:

| screener-only (host accepts) | × | host-only (screener accepts) | × |
|---|---|---|---|
| `pine:function` — *"`ta.cum`…names no anchor"* | **9** | `pine:state` — *"a `var` seeded `na` that nothing updates"* | 5 |
| `pine:window-dependent` — *"depends on how much history was loaded"* | 2 | `pine:drawing` — *"paints on a chart and answers with no number"* | 2 |
| `pine:hidden-only` · `pine:request` | 1 each | `pine:tuple` — *"several values at once and a column carries one"* | 2 |
| | | `pine:statement` · `pine:request` · `pine:hidden-only` · `pine:offset-literal` | 1 each |

⭐⭐ **The split is principled, not incidental.** Everything the SCREENER refuses and
the host does not is **fetch-depth or anchor dependence** — a number that would be
different tomorrow because more bars were loaded. Everything the HOST refuses and the
screener does not is **shape** — a thing that is not one number per bar.

⛔⛔ **AND THE ENGINE ALREADY SAYS SO, AS A RULING, IN ITS OWN TABLE** (`pine.js`
≈1670, verbatim):

> *"safe: the pane accepts it, the screener/sweep/alert/share/listing refuse it BY
> NAME, so the fetch-dependent level cannot leak past the one surface that can hold it
> honestly. ⭐ THE PAIR THE `cum` RAIL DEMANDS: a host-admissible name must still be
> refused for a screen, or the exemption stops being a ruling and becomes a hole."*

**So neither lane is wrong. `mode: strict ? 'host' : 'screener'` — these are two
SURFACES with deliberately different admissibility, and a refusal set is a property of
the SURFACE, not of the script.** Not (A): the lenient lane is refusing correctly, by
a documented ruling. **Not (B): nothing is hidden on the shipped pane** — strict keeps
`cum` in the tree *because a pane may compute it*, which is the ruling working.

### 2.4 — PROPOSED RULING (not a fix). Estimate **45 min**. Owner's go required.

⛔ **`bothLanesAgreeOnFacts.test.js`'s premise is what needs correcting, not the
engine.** It asserts *"the VERDICTS may differ, the FACTS must not"* and counts the
refusal set among the facts. **Output count is lane-independent and agrees on all 327
— that half is right and stays.** The refusal set is not, and never was.

⚠️ **As it stands the rail pins 13 scripts as a defect frontier that is actually
correct behaviour, so "fixing" one would red a rail for doing the right thing** — and
the rail's own comment invites exactly that (*"fixing one turns this RED and moves the
assertion forward"*).

**Proposed replacement, asserting the ANSWER rather than an absence:**
1. **keep** — output count agrees on all 327 (unchanged, it is a real invariant);
2. **keep** — the one script that throws, by name;
3. **replace** the 13-script equality assertion with: *every lane-only refusal falls
   in that lane's admissibility class* — screener-only ∈ {fetch-depth/anchor:
   `cum`-class, `window-dependent`}, host-only ∈ {shape: `drawing`, `tuple`, `state`,
   `offset-literal`}. A lane refusing **outside** its class is the real regression and
   goes red;
4. **non-vacuity control** (standing rule): the class lists are non-empty and a
   deliberate cross-class refusal is detected.

## ✅ R14 RULED (owner, 2026-09-15) — the refusal set is a property of the SURFACE

> **It never was a shared fact between the lanes. Output count IS lane-independent and
> stays a shared fact.**

`bothLanesAgreeOnFacts.test.js` is corrected as proposed: the 13-script equality
assertion is replaced by *"every lane-only refusal falls in that lane's admissibility
class; a cross-class refusal is the regression"*. ⛔ Recorded here **in place** so the
finding's own comment stops inviting a "fix" for correct behaviour.

### ⭐⭐ WHERE THE CLASSES LIVE — and they were already data, so nothing is lifted

The constraint was that the classes are **read from the engine, never hand-listed**,
and that the fix's first commit lifts them out of prose if that is where they live.
**Measured: they are not in prose.**

| | |
|---|---|
| the data | `closedTable.json::_requirement_tags` — today exactly one tag, `window_dependent`, with `calls: ["cum", "isfirst"]`, `refused_by: ["screener","sweep","alert","share","listing"]`, `accepted_by: ["pane"]` |
| the derivation | **`parse.js::hostAdmissible(table)`, already exported** — *"Names `PINE_INEXPRESSIBLE` refuses for a SCREEN but the HOST lane may serve. ⭐⭐ DERIVED FROM `_requirement_tags`, NEVER TYPED HERE."* |
| what the rail does | **imports `hostAdmissible`**. No lift, no new table, no second authority |

⭐ And that function's own comment already states the asymmetry R14 measured:
*"IT IS THE ONE PLACE HOST MODE IS LOOSER THAN SCREENER MODE … Host mode is otherwise
stricter — all-or-nothing … Strictness is about whether we can DRAW the script. This
is about whether the number is COMPARABLE across symbols and across runs."*

⛔ **THERE IS NO HOST-ONLY "CLASS" TO READ, AND INVENTING ONE WOULD BE MANUFACTURING A
RULING THE ENGINE DOES NOT MAKE.** Host-only refusals (`state`, `drawing`, `tuple`,
`offset-literal`) are host mode being *otherwise stricter*, which is the documented
design — not a declared exemption. So the rail asserts the two things that ARE
grounded: every **screener-only** refusal is explained by the `hostAdmissible` class,
and **no host-only refusal names a `hostAdmissible` call** — the pane refusing what it
is declared to accept is the regression in that direction.

**Estimate 45 accepted; 2× stop 90.**

### ✅ R14 LANDED — a7.2 finding 1 is CLOSED

**Red `f0e9d6c62` → fix `7a4de1a92`.** ~90 min against 45 — **at the 2× stop**, not
revised.

The rail is `refusalsAreASurfaceProperty.test.js`; the superseded 13-set equality
assertion is gone from `bothLanesAgreeOnFacts.test.js`, **with the reason left in its
place** rather than the lines simply deleted. Output count stays asserted there, where
it always belonged.

**Coverage, measured:** 11 of 13 classify clean against `hostAdmissible`. Two residues
are **pinned by name so they cannot grow silently**, not excused:

| script | residue | reading |
|---|---|---|
| `rate-of-change` | 12 in class + 1 × `pine:hidden-only@308` | a **whole-script verdict downstream** of the class refusals — once they dropped the visible columns only author-hidden helpers were left. Explained transitively |
| `high_engagement__20` | 4 × `pine:request@10` vs 2 × `pine:offset-literal@10` | **same line, different code per surface** — both lanes refuse line 10 for their own surface's reason, no `cum` anywhere. A second, smaller finding |

⚰️ **The self-retiring check went red on its first run — the SEVENTH instance of this
repo's own recorded class**, a literal-hunting check matching its own documentation:
the retirement note necessarily *names* the constant it retired, so a bare
`src.includes(needle)` stayed red after the deletion was complete. Fixed at the tool,
never the explanation — comments stripped before matching, the needle built by
concatenation, and two controls (the stripper still sees live code; it does not see a
prose-only token).

**Mutation-proved both directions**, byte-exact copies restored and re-verified 12/12:
remove `isfirst` from the **manifest** (edited as text, `sha256 12949d80`, restored
byte-equal) → **RED on the non-vacuity control**, which is the proof the rail reads the
engine rather than a typed list; blind the regression guard → **RED on the synthetic
cross-class control**.

### ✅ a7.2 finding 1 — CLOSED (R14). The four things this leaves on the record

1. **ONE AUTHORITY.** `closedTable.json::_requirement_tags` → `parse.js::hostAdmissible`
   → the rail. The class is never typed in a test, and the manifest mutation is the
   proof that chain is live rather than decorative.
2. **HOST IS LOOSER THAN SCREENER IN EXACTLY ONE PLACE, AND STRICTER EVERYWHERE
   ELSE.** That reads backwards until you have the reason, which `hostAdmissible`'s
   own comment gives: strictness is about whether we can **draw** the script;
   `window_dependent` is about whether the number is **comparable** across symbols and
   runs, and a pane is one symbol, one fetch, with the bar count on screen.
3. **THE TWO RESIDUES, BY NAME** (above): `rate-of-change` `pine:hidden-only@308`,
   downstream of 12 class refusals; `high_engagement__20` `pine:request@10` against
   `pine:offset-literal@10` — **now routed by R17, below**.
4. **THE SEVENTH LITERAL-HUNTING INSTANCE, WITH ITS FIX PATTERN**: strip comments
   before matching · build the needle by **concatenation** so the checking file does
   not contain it · carry stripper controls **both ways** (it still sees live code; it
   does **not** see a prose-only token). ⛔ The explanation is never deleted to make a
   check pass — the check is fixed.

### ✅ R17 (owner, 2026-09-15) — `high_engagement__20` IS ITEM (c)'S SPECIMEN

⛔ **It is NOT opened as its own finding.** `pine:request` is item (c)'s code, and a
same-line disagreement between the two surfaces is a fact about **how each surface
reads a `request.security` call** — which is exactly what (c) exists to settle.

It carries into the (c) census as a **named script in c.4**, with both refusals
reported at their sites: screener `pine:request@10` ×4 against host
`pine:offset-literal@10` ×2. ⭐ The R14 rail keeps it pinned meanwhile, so it cannot
grow silently while (c) is still being scoped.

---

# ⭐⭐ ITEM (c) — `request.security` TUPLES. DEFINED BY MEASUREMENT.

## c.1 — RULING D2, READ BACK

**Two primary sites, and they agree.** `app/src/components/chart/engine/ast/paneGate.js`
(the code) and `docs/pine/SESSION-STATE.md` §*"SESSION 2 · D2 (option B)"* (the record):

> **`paneGate.js`:** *"T3/T5 drive a member pane from the SAVED DEFINITION the HOST
> lane produces, and **the IR lane stays as it is until session 3's text layer**. That
> is a decision about which translation is authoritative … ⛔⛔ THE SCREENER LANE IS
> NOT ADMISSIBLE HERE, AND THAT IS THE POINT."*
> `export const PANE_LANE = 'host'`

> **SESSION-STATE §D2:** *"⛔⛔ THE SCREENER LANE IS INADMISSIBLE BY CONSTRUCTION, AND
> THAT IS THE WHOLE RULING. On Volume v2 the lenient lane answers `ok: true` with FOUR
> refusals — correct for a screen … A pane built on that verdict draws one line and
> silently omits the rest of the member's script."*

**Wording drift across the secondary sites, reported:**

| site | wording | drift |
|---|---|---|
| `PR-BODY.md:242` | *"D2 (the IR lane is off the pane path)"* | a true **consequence**, but it loses that D2 is primarily about **which lane a pane may act on**, and drops D2's other half entirely (the per-lane refusal **wording override**) |
| `SESSION-STATE:330` | *"ruling D2 keeps it off"* | same compression |
| `WAVE2-A-CENSUS.md:342` | *"Put the IR lane on the pane path — that is ruling D2"* | ⚠️ **inverted.** D2 is the ruling that it is **not** on the path; putting it on would be *revisiting* D2 |
| `pine-presentation-spec.md:2547`, `pine-v6-constants.md:152` | a `plot.style_*` documentation contradiction | ⛔ **A NAME COLLISION, NOT THIS RULING.** Unrelated; flagged so no reader conflates them |

### ⛔ THE READING: D2 forbids IR-lane OUTPUT reaching the PANE. It does not forbid IR-lane WORK.

Three things in the text settle it: `paneGate.js` says the IR lane **"stays as it is
until session 3's text layer"** — a deferral of rework, not a prohibition; the
prohibition is located exactly at the pane boundary (`PANE_LANE = 'host'`, and the gate
refuses any non-host `mode`); and SESSION-STATE's own item-(c) entry says
**"Closing the tuple form is what lets D2 be revisited at all"** — the tuple work is
D2's *precondition*, so D2 cannot forbid it.

⇒ **(c)'s IR half is buildable OFF-PANE in Wave 2.** Its output may not drive a pane
while D2 stands. The census covers both halves.

## c.2 — what the engine does today

**Instrument `eada76bc6`. Control: re-derives (b)'s 97 through (b)'s own walk — 97 = 97.**

| form | today | node it folds to |
|---|---|---|
| `request.security("AAPL","D",close)` | ✅ translates | **`sym`** — `{type:'sym', value:'AAPL', args:[series close]}` |
| `request.security(syminfo.tickerid,"D",close)` | ✅ translates | the bare `series` — the chart's own symbol needs no wrapper |
| timeframe from `input.timeframe` | ✅ translates | `sym` — **this is the 97** |
| `lookahead=` / `gaps=` present | ✅ translates | unchanged; call-level args are carried, not refused |
| `request.security("AAPL","",close)` | ⛔ `pine:request` | *"could not be resolved to one symbol and one servable timeframe"* |
| `[a,b] = request.security(s,tf,[x,y])` | ⛔ **`pine:tuple`** | *"answers with several values at once and a column carries one"* |
| `f() => [high,low]` · `[a,b] = request.security(s,tf,f())` | ✅ **translates** | `op('-', [sym(AAPL,[high]), sym(AAPL,[low])])` |

⭐⭐ **THE LAST ROW IS THE FINDING.** The slot model is not a proposal for (c) — **it
ships**. `pine.js` ≈4749: a destructured name carries `bound.index` into
`bound.fn.value.parts`, and each part resolves through `securityAsNode(bound.call)`.
`pine:tuple` fires only when the part does not exist.

**R17's specimen, `high_engagement__20:10`** — measured, and it is not a lane
disagreement about `request.security` at all:

```
src = security(syminfo.tickerid, res, inp[rep ? 0 : barstate.isrealtime ? 1 : 0])[rep ? 0 : ...]
```

The line carries **two** defects — a non-literal bar offset **and** a request that does
not resolve. Each surface reaches a different one first, and because **a refusal
relocates and never joins**, only one survives per lane: screener `pine:request@10`,
host `pine:offset-literal@10`. ⭐ Refusal-relocation ordering, not a semantic split.

## c.3 — the hypothesis HOLDS, 192 of 193

| | |
|---|---|
| tuple uses satisfying the slot model | **192 of 193** |
| real breakers | **1** — `element-reads-another-element` |
| the TARGET form (refused today) | **90** — `request.security(s, tf, [x, y])`, the array-literal argument |

⚰️ **Two of version 1's three breaker categories were wrong**, and the correction moved
the headline from 84/193 to 192/193. `array-literal-arg` was counted as a breaker when
it is the **target** — the exact form the hypothesis describes. `per-call-lookahead/
gaps-on-a-tuple` was counted as a breaker when those are **one call-level argument
applied to the whole call**: slot expansion gives every element the same value, which is
correct, and a scalar carrying either still folds. **A breaker has to be semantics that
DIFFER PER ELEMENT.**

⭐ **And the target form needs NO 12th node type.** `[x, y]` in an argument position is
parsed and expanded at plan time into N slots; the tuple never becomes a node. That is
Mechanism A exactly, and it is what `bound.fn.value.parts` already does for the UDF form.

## c.5 — the table. **Reachable is the number, and it is borderline.**

| form | uses | **reachable** | vs ~20 | binding constraint |
|---|---|---|---|---|
| **scalar** | 524 | **150** | far over — **and it already works** | nothing to build; it folds to `sym` today |
| **tuple, all** | 193 | **20** | **at** the threshold | 192/193 satisfy the slot model |
| **tuple, array-literal arg** (the only refused form) | **90** | **15** | **under** | the machinery exists; the gap is parsing `[x,y]` in an argument position and expanding it to slots |
| tuple, other (UDF-returning) | ~103 | 5 | — | ✅ **already translates** |

⛔ **By the threshold, the one form that is actually refused does not clear: 15 < 20.**

⚠️ **AND THIS IS THE CALL I AM NOT MAKING ALONE, for the same reason as (b)'s
`input.timeframe`.** The threshold governs what is BUILT, and 15 is under it — but the
build here is unusually small, because the slot machinery already ships and the target
needs no new node type. A "retire on count" verdict would refuse 90 corpus uses of a
form this engine is *one parse rule* away from carrying. The census states both and
rules neither.

## The ROUTED population — what (c) actually owes each group

| routed group | is it `request.security`? | disposition under the c.1 reading |
|---|---|---|
| **10 bare-`input` time uses** (from (b)) | ✅ **yes** | ✅ **(c) ALREADY DELIVERS THEM** — they are timeframe inputs in a timeframe position and fold to `sym` today. The R16 routing sentence is **honoured** |
| **56 series-dependent `for` bounds** (from a1) | ❌ **no** — loop bounds | **IR-lane work, buildable off-pane; NOT deliverable to a pane while D2 stands.** The sentence *"runtime arrays are the IR lane's, item (c)"* is honoured in substance, but ⛔ it implies a member-visible result that **D2 blocks**. To be corrected in place with that qualification |
| **5 `input.time` expression defaults** (from (b)) | ❌ **no** — input defaults | same: a non-literal default needs runtime evaluation, so it is the IR lane's, and the same D2 qualification applies |

⛔ **So one routing sentence is honoured outright, and two are honoured with a
qualification they do not currently carry** — they promise item (c) will deliver
something that, while D2 stands, cannot reach the surface a member sees. **Correcting
those two in place is part of whichever verdict the owner rules**, not a separate task.

## ✅ RULED (owner, 2026-09-15)

### R18 — the threshold applies PER FORM; the array-literal argument is a SHAPE of a form that ships. **BUILD IT.**

The form is **tuple destructure from `request.security`**: 193 uses, **20 reachable —
at the threshold** — and already translated for the ~103 UDF-returning uses under the
slot model. The array-literal argument (90 uses, 15 reachable) is an **argument shape**
of that form: same `parts`, same `securityAsNode`, **no 12th node type, no new
mechanism**.

⛔ **Recorded so it cannot erode the threshold**, with the full comparison beside **R1**
above: R1 rejected *"a3's machinery makes it cheap"* as grounds to build `for … in`,
**and that stands**. R18 is **not** "cheap, so build" — it is *"the form already ships
and clears the threshold; an argument shape of a shipping form is not a separate form
to threshold."* ⚠️ A future argument shape needing a new node type, a new mechanism, or
its own breaker analysis **is** a separate form and is thresholded on its own.

**Estimate 70; 2× stop 140.**

### R19 — D2's drift corrected in place; the collision renamed

`PR-BODY:242` and `SESSION-STATE:330` carry **both halves** — a pane acts on the HOST
lane's saved definition, and the screener lane is inadmissible by construction — with
*"the IR lane is off the pane path"* kept as **the consequence it is**.
`WAVE2-A-CENSUS:342` is corrected: D2 is the ruling that the IR lane is **not** on the
pane path; putting it on is what D2 **defers**. The unrelated `plot.style_*` "D2" in
`pine-presentation-spec.md` / `pine-v6-constants.md` is **renamed**, with a one-line
note at each use. ⛔ Ruling D2's own name does not change.

### R20 — the two routing sentences qualified in place

The **56 series-dependent `for` bounds** (R1) and the **5 `input.time` expression
defaults** (R16) are IR-lane work, **buildable off-pane, NOT deliverable to a pane
while D2 stands**. Each gains that qualification so no member is promised a pane result
D2 blocks. ⭐ R16's **10 bare-`input`** sentences are honoured as measured and are
**not** touched.

### R17 — CLOSED

`high_engagement__20:10` carries **two** defects (a non-literal bar offset; an
unresolvable request). Each surface reaches a different one first, and **a refusal
relocates and never joins**, so exactly one survives per lane. Recorded under R14's
residues as **refusal-relocation ordering**, not a semantic split.

⛔ **H.5 — OWNER QUESTION, OPEN:** should a member be shown **both** defects on one
line? Specimen: `high_engagement__20-ehlers-fisher-transform-cheatcountry.pine:10`.

## ⏸️ R18 — MEASURED AND ACCEPTED-RED. The build is NOT landed.

**Red `e97a1d1c3`.** 2.1 and 2.2 are complete; **2.3–2.6 are not started**, stopped at
~100 min against the 140 stop because 2.3 is a **parser change** whose re-baseline
reaches the corpus and the full suite, and a half-landed parser change is the worst
outcome of the three available.

### 2.1 — the parse gap, measured

⭐ **The parser already SEES the array literal.** `parseWholeExpression` on
`request.security("AAPL","D",[high,low])` returns a 3-arg call whose `arg2` is
`{type:'collection', tok}` — and `pine.js` ≈3556 then **skips to the matching `]` by
depth-counting and discards the elements**. Deliberately: the comment there records
that throwing made `input(…, options=["A","B"])` — *"the one collection literal every
published script carries"* — refuse a whole script from a line no column depends on.

⛔ **So the gap is not "no array-literal node".** The node is a **placeholder whose
contents are dropped**, which is why there are no parts to take. ⭐ `collection` is a
**parse-tree** type and is **absent from `NODE_TYPES`**, so retaining its elements adds
no output node and no 12th type.

### The insertion point, identified exactly — so the build starts at implementation

| | |
|---|---|
| **parser** | `pine.js` ≈3556 — collect the bracketed elements instead of discarding them. ⚠️ Fall back to today's behaviour if any element fails to parse, so `options=[…]` cannot regress |
| **binding** | `destructureBindings`, the branch **immediately after** the existing `securityTuplePart` one (`pine.js` ≈9002) |
| **the shape to build** | the SAME `{kind:'securityTuplePart', call, fn, args, index, env, at}` the UDF form already builds — with `fn` synthesised as `{kind:'fn', value:{kind:'tuple', parts: elements}}` so `pine.js` ≈4749 (`bound.fn.value.parts[bound.index]` → `securityAsNode`) resolves it **unchanged**. One path, two entrances — never a parallel one |

### ⚠️ Two measurements that resize the work

1. **90 uses is NOT 90 refusals.** Only **6 scripts** in the whole corpus refuse
   `pine:tuple` with this form; the rest sit in scripts that refuse earlier for their
   own reasons, or whose destructured names nothing reads. **The re-baseline is sized
   by the 6.**
2. **There are ZERO breakers.** The census's last one was a false positive — `\blog\b`
   matching `math.log(...)`, a method name — so the hypothesis holds **193 of 193**.
   The sibling-read case is therefore a **guard** against a shape the corpus does not
   contain, tested with a synthetic fixture, not a fix for a measured use.

⛔ **Section 3 (the IR half's scoping) is NOT started.**

## ✅ R18 LANDED — (c)'s DEFINITION-LANE HALF IS CLOSED

**Red `e97a1d1c3` → fix `a63e90c75`.** `[a,b] = request.security(s, tf, [x,y])` now
translates to **two slots** — `security(s,tf,x)` and `security(s,tf,y)`, each an
ordinary call tree. No new node type, no statement form, no parallel path.

### 1.1 — candidate (i) chosen, on the evidence

| | |
|---|---|
| **(i) retain elements always** | ✅ **CHOSEN.** The parser already *recognised* the literal and returned `{type:'collection'}`; ≈3556 then consumed the contents to find the matching `]` and threw them away. **A parser that discards what it already recognised is the gap that resurfaces** |
| **(ii) retain only under `request.security`** | not needed — (i) moved nothing else. Recorded here as the alternative it would have been |

⛔ **The fallback is what makes (i) safe**, and it is the reason the site never threw:
the element parse runs from a **saved cursor position**, and any failure rewinds to it
and takes the original skip. A collection this parser cannot read behaves exactly as
before.

**The `options=["A","B"]` control, quoted both ways — identical:**

| | before | after |
|---|---|---|
| notes | `pine:declaration@1` · `pine:input-kind@2` | **same** |
| `pine:collection` note | **none** | **none** |
| `ok` / outputs | `true` / 1 | **same** |

⭐ `collection` is a **parse-tree** type; `NODE_TYPES` is the **output** vocabulary and
is untouched — a collection never reaches a saved tree, it is taken apart into per-slot
calls first.

### 1.3 — green, and what the lane rails said

Acceptance **EXIT 0, 7/7**. Lane rails — `bothLanesAgreeOnFacts`,
`refusalsAreASurfaceProperty`, `bothLanesAreTwoLanes` — **EXIT 0, 16/16**: no lane-only
refusal moved outside its class under R14, and the output-count invariant still holds
across all 327.

### 1.4 — the re-baseline

| | before R18 | after R18 |
|---|---|---|
| files | 371 | **374** |
| passed | 7,470 | **7,486** |
| failed | **5 in 3 files** | **7 in 5 files** |
| timeouts | 0 | **2** |

⛔ **No new assertion failures.** The 7 are the **same pre-existing trio (5)** plus **2
load timeouts** — `enumerationSites` and `manifestProse`, both named in `CLAUDE.md` as
known at 15 s under load and **both verified green alone**. A timeout is never banked.

**Verdicts that changed** — five of the six `pine:tuple` scripts clear entirely;
`smt-divergence-ict-01` goes from `ok=false`, 4 refusals to **`ok=true`, 0 refusals**.

⭐ **The sixth is a scope boundary, not a miss:** `volatility-stop-mtf` still refuses —
at `[stopChartTf, trendUpChartTf] = TVta.vStop(...)`, a **library** tuple. R18 answers
for `request.security` and nothing else, and a control now asserts that boundary.

### ⚠️ Three findings outside the six, each measured before commit

1. **Two spent fixtures in `pine.tuples.test.js`**, moved to the frontier, not deleted.
   One asserted `request.security` destructures **refuse** — the exact form R18 builds.
   ⭐ **The safety it guarded moved rather than vanished:** each element becomes its own
   request and `securityAsNode` validates it, returning null → `pine:request`, never a
   silent first-element bind. The successor is asserted. The other was named *"a
   destructure of some OTHER builtin"* while its body used `request.security` — it
   **never tested what it claimed**, and now uses a builtin that genuinely is not ours.
2. **R18 made `bothLanesAgreeOnFacts`'s verdict control exceed its budget** — and it is
   **fixed, not banked**. That control re-read and re-translated all 327 scripts twice
   more, on top of the walk that had already translated each on both lanes: three full
   corpus passes for a fact the first pass knew. ~4 s while refusing scripts stopped
   early; **19.5 s once R18 made the tuples translate**, over 15 s even alone. ⭐ R18 did
   not break it — **R18 removed the early exits that were hiding the waste.**
   **19,526 ms → 6 ms.**
3. **Zero moved snapshots** — the tree carries none.

### 1.5 — mutation proof (`sha256 99976bd7`, restored byte-equal)

| mutation | result |
|---|---|
| restore the ≈3556 discard | **5 RED** — and **both controls stay GREEN**: the UDF path byte-identical, `options=[…]` still inert |
| route parts around `securityAsNode` (`securityTuplePart` → `tuplePart`) | **1 RED**, proved by the message: `expected {type:'series',name:'high'} to match {type:'sym',value:'AAPL'}` |
| remove the sibling guard | **1 RED**, on the synthetic case only |

## ⭐ THE (c) REPORT — four lines

1. **BUILT** — the array-literal argument: `[a,b] = request.security(s,tf,[x,y])` → two
   slots through the existing `securityAsNode` path. Second entrance, one path.
2. **REFUSED BY NAME** — an element that reads a sibling (`pine:tuple`, from the 41),
   a **guard** with a synthetic fixture: the corpus contains **zero**.
3. **ROUTED AND QUALIFIED** — R16's 10 bare-`input` uses already delivered and
   honoured; the 56 series-dependent `for` bounds and 5 `input.time` expression
   defaults carry D2's limit in place (R20).
4. **PENDING** — (c)'s **IR half**: see below; H.4; H.5; H.6; the Wave 1 PR; the
   vendor capture.

## ⛔ (c)'s IR HALF — **BLOCKED BY ITS OWN GAP**, and the gap is bigger than the tuple

**Scoped 2026-09-15, measured, not proposed. Nothing built.**

### 1.1 — what `buildRuntimeIr` does today

⭐ **The IR's own vocabulary** (`runtime/ir.js`) is `STMT.{DECLARE, ASSIGN, IF, EMIT,
EXPR}` and `EXPR.{NUM, SERIES, COLUMN, READ, HIST, BINARY, UNARY, TERNARY, CALL,
BUILTIN, WINDOW, CARRIED}` — **not `NODE_TYPES`**. Beneath them sits a second list the
file labels ***"declared, not yet lowerable"***: `STMT.{FOR, WHILE, BREAK, CONTINUE,
FUNC, RETURN}` and `EXPR.{TUPLE, ARRAY_OP, OBJECT_OP}`.

| case | IR lane |
|---|---|
| array-literal tuple | ⛔ `runtime:tuple@2` — *"a tuple — the runtime has no multiple-value form yet"* |
| sibling-reader (synthetic) | ⛔ `runtime:tuple@2` — same |
| **UDF tuple** (which the definition lane carries) | ⛔ `runtime:tuple@4` — **same** |
| plain scalar `request.security` | ✅ `ok=true` |
| R18 specimen 1 | ⛔ `runtime:tuple@15` |
| R18 specimen 2 | ⛔ `pine:text-value@26` — an earlier gap |
| R18 specimen 3 | ⛔ `pine:colour-value@39` — an earlier gap |
| library tuple (`volatility-stop-mtf`) | ⛔ `runtime:declaration@15` — `import`; a library script |
| `uncharted-volume-v2` | ⛔ `runtime:statement@249` |

⛔⛔ **R18 CHANGED NOTHING HERE, AND THAT IS MEASURED, NOT ASSUMED.** The same probe was
run against `a63e90c75~1` by byte-exact swap and restored (`sha256 99976bd7`): **every
row is identical before and after**. The definition lane's slot model does not reach
the IR lane, because the IR lane refuses the destructure *before* any of it applies —
including the UDF form the definition lane has carried since before R18.

**And `EXPR.TUPLE` is lowered nowhere:** `STMT.FOR`, `STMT.WHILE`, `EXPR.TUPLE` and
`EXPR.ARRAY_OP` have **zero** mentions across `lower.js`, `lowerIr.js` and `vm.js`.
Declared in the vocabulary, absent from every consumer.

### 1.2 — ⚰️ THE DEFERRAL'S STATED PRECONDITION IS MEASURED **FALSE AS STATED**

Two sites name what D2 waits on, and they do not agree:

> **`paneGate.js`:** *"the IR lane stays as it is **until session 3's text layer**"*
> **item (c)'s own plan line:** *"**Closing the tuple form is what lets D2 be
> revisited at all.**"*

⛔ **Neither is sufficient, and the measurement says so.** `uncharted-volume-v2` — the
script both sentences are about — refuses `runtime:statement@249`, which is **neither**
the text layer nor a tuple, and sits **two lines before** the tuple at 251. Closing the
tuple form alone would move v2 not at all.

⚠️ **AND THE RECORD IS STALE.** Item (c)'s line says the IR refuses *"`runtime:tuple` at
`v2:251`"*. Measured today it refuses `runtime:statement@249` — the first refusal moved
earlier at some point on this branch, and **not because of R18** (identical before and
after). A refusal relocates and never joins, so the tuple at 251 is simply hidden behind
it.

**The capability D2 actually waits on is therefore larger than either sentence:** the
IR lane must lower `EXPR.TUPLE`, **and** reach past `runtime:statement`, `pine:text-value`
and `pine:colour-value` on the very scripts the pane is for.

### 1.3 — the routed population has no IR path either

⛔ The IR lane **does not carry a series-sized array today**: `STMT.FOR`, `STMT.WHILE`
and `EXPR.ARRAY_OP` are declared and lowered nowhere. So the **56 series-dependent `for`
bounds** and the **5 `input.time` expression defaults** routed to *"the IR lane's, item
(c)"* have **no IR path at all** — R20's qualification (*"while ruling D2 stands the IR
lane does not reach a pane"*) understates it: today the IR lane could not compute them
even off-pane.

### 1.4 — OUTCOME: **BLOCKED-BY-ITS-OWN-GAP**

**(c)'s definition-lane half stays CLOSED** (R18). The IR half is **owed**, with the gap
named: `EXPR.TUPLE` declared and unlowered, plus at least three earlier refusals on the
member scripts. ⛔ **No estimate is offered**, because the gap is not one capability —
scoping it means scoping the IR lowering programme itself, which is a wave-sized
question and not item (c)'s to answer alone.

⛔ **H.6 — OWNER QUESTION, OPEN:** item (c)'s plan line asserts a precondition for
revisiting **D2** that measurement contradicts. Does D2's revisit wait on the tuple form
(false as stated), on session 3's text layer (`paneGate.js`), or on the IR lowering
programme as a whole (what the evidence shows)? **The line should be corrected in place
once ruled.**

---

# ⭐⭐ ITEM (d) — `alertSets`. DEFINED BY MEASUREMENT.

**Instrument `86b0e3241`**, 328 scripts. **Control:** `uncharted-volume-v2` carries
exactly **1** alertcondition, which **D1** pins at index 4 — re-derived, exits non-zero
otherwise.

## D1, verbatim from its site

> *"⛔⛔ **THE TWO LANES DISAGREED ABOUT WHAT AN `alertcondition` IS, AND THE HOST LANE
> HAD THE WRONG ANSWER.** `chooseOutput` PREFERRED it over every plot — "an
> alertcondition IS a condition by construction, so it wins" — while `buildRuntimeIr`
> classified it as PRESENTATION and emitted no series for it. So the output a pane
> selected was exactly the one the runtime lane has nothing to draw."*

**Measured live:** an alertcondition-only script gives screener `selected = 0` and host
`selected = **-1**` — the pane selects nothing, exactly as D1 rules. On v2, host
`selected = 0` ("Volume"), not the alertcondition at index 4.

## d.1 / d.2 — what the engine does, and the answer to the carriage question

| form | today |
|---|---|
| `alertcondition(cond, title, message)` | ✅ an **output**, `kind: 'alertcondition'` |
| its **`title`** | ✅ **carried as a FIELD on the output**, exactly like a plot's |
| its **`message`** | ⛔ **DROPPED ENTIRELY** — no `message` key; the string appears **nowhere** in the result, for a literal, a `{{placeholder}}` **and** an expression alike. No refusal, no note |
| `alert(message, freq)` — the runtime form | ⛔ **SILENTLY DROPPED**. `ok=true`, no output, no refusal, no note |

⭐⭐ **THE d.2 ADMISSIBILITY QUESTION HAS A GOOD ANSWER AND IT IS ALREADY BUILT.** A
title is **presentation metadata on the output**, not a `str` node in the tree — so
`str`'s textop-only parentage (`assertCanonical`) is never engaged and **no 12th node
type is implied**. Whatever (d) becomes, a message can ride the same way.

⛔⛔ **BOTH GAPS ARE SILENT, AND THAT IS THE FINDING.** This engine's standing rule is
that a construct it cannot carry is **refused by name or noted — never dropped**. These
two are dropped. A member writes an alert message and the engine neither carries it nor
says it didn't.

## d.3 / d.4 — the table

| form | uses | files | vs ~20 | binding constraint |
|---|---|---|---|---|
| `alertcondition` itself | **555** | 120 | far over — **already handled** | it is an output today; nothing to build |
| its **message** | **489** present (183 literal · 157 expression · 149 placeholder) | — | **far over** | ⛔ silently dropped. A literal could ride the title's own carriage; a `{{placeholder}}` and an expression are a **textop** question |
| its title | 555 (277 literal · 274 expression · 4 placeholder) | — | handled | ⚠️ **274 are expressions** — carried today, but whether the *printed* title matches the author's is unmeasured |
| `alert()` runtime form | **191** | 46 | **far over** | silently dropped; a per-bar side effect, so plausibly the **IR lane's** — ⛔ and the IR lane is blocked (see (c) above) |
| **sets** — 2+ sharing a signal family | **184** in **53 files** | — | **far over** | what a *set* means per surface |
| alertcondition as the **only** output | **26 scripts** | — | over | **D1 territory**: host `selected = -1` |

## ⭐ WHAT "alertSets" MEASURED AS

**It is a real pattern, not a phrase.** Only **8 of 120** files carry exactly one
alertcondition; **112 carry two or more**, and **53 have two or more built from a shared
condition family** (one signal, several thresholds or directions). The distribution has
a long tail — single files with 17, 29 and **38** alertconditions.

⛔ **So the question (d) actually poses is per surface, and the two answers differ:**
- **the screener** already offers each alertcondition as its own column, and selects the
  first — correct for a scan, where *"when is this true"* is the question;
- **the pane** selects none of them (D1), so a set of 38 is, to a pane, **38 outputs it
  will never choose** — which is right, and says nothing yet about whether it should
  *draw* them as markers.

## ✅ RULED (owner, 2026-09-15)

### R21 — item (c) is CLOSED; its IR half is OWED to **the IR lowering programme**

The definition-lane half is closed under **R18**. The IR half **is not (c)'s to
scope** — it is the IR lowering programme, wave-sized — and is recorded as owed under
that name with the measured gap: the *"declared, not yet lowerable"* list
(`STMT.{FOR, WHILE, …}`, `EXPR.{TUPLE, ARRAY_OP, OBJECT_OP}`), **zero** mentions across
`lower.js`/`lowerIr.js`/`vm.js`, and the routed **56 + 5** having no IR path at all.

⛔ **R20's qualification is corrected in place to carry TWO facts, both measured** —
*"the IR lane has no path for it yet, nor does any IR result reach a pane while ruling
D2 stands"*. The D2 half alone reads as *"it will be carried, just not drawn here"*,
which the IR measurement contradicts. Corrected at all three sites; the rail now asserts
**both** clauses.

⚠️ **H.6 stays open**: `paneGate.js` and item (c)'s plan line both name a precondition
that is **not the actual first blocker**.

### R22 — SILENCE IS THE DEFECT. (d) builds **d1 + d2** now; **d3 defers to H.7**

Three of the four over-threshold rows are **one defect**: something the member wrote is
dropped without a word — the one thing this engine's discipline forbids. It is fixed
before any feature is considered.

| | |
|---|---|
| **d1 — the two silences speak** | `alert()` and a dropped message each get a **NOTE**, never a refusal. **45 min; 2× stop 90** |
| **d2 — a literal or placeholder message rides the title's carriage** | a presentation field beside `title`, same path, **no second carriage**, no 12th node type. An **expression** message is not carried and gets d1's note. **40 min; 2× stop 80** |
| **d3 — sets as a first-class offer** | ⛔ **DEFERRED → H.7** |

⛔⛔ **A NOTE, NEVER A REFUSAL, AND THE REASON IS A STANDING RULE**: the offer works
today, and **a threshold never removes what works**. `alert()` is a runtime action
neither surface reads, so a script with plots and an `alert()` must keep its plots.

## ✅ R22a / R22b (owner, 2026-09-15) — d2 GOES FIRST; d1 IS RE-SCOPED AS d1′

### R22a — **d2 first, and re-sized**

The census's named-argument correction moved d2's scope: **487 of 555** messages are
carryable (**338 literal + 149 placeholder**) against **2** genuine expressions. d2
carries the 487 as a **presentation field beside `title`, same path, no second
carriage**. The 2 expressions and any uncarried shape get a **message NOTE** at the
alertcondition line — **folded into d2**, because that note is now two specimens wide
rather than a feature of its own. ⛔ The ruled **40** was for a smaller scope; d2 states
its own estimate before starting.

### R22b — **d1′: a chart-only call INSIDE A BLOCK is noted**

Seven call types — the whole `CHART_ONLY_CALLS` set — **at any depth**. Own estimate,
**not d1's inherited 45**.

> ### ⛔⛔ THE HARD CONSTRAINT
>
> The fix is a **READ-ONLY traversal** over the parsed blocks that **emits notes and
> nothing else**. It does **not** touch `destructureBindings`, `forceOpaque`, binding
> creation, binding reads, or refusal placement. It runs **after** the walk that decides
> those, or **beside** it as a separate pass — *measure which is available* — and it is
> **deduplicated** against the existing top-level notes: **one note per call site, never
> two**.
>
> ⛔ **If the only way to reach nested calls is to modify the block walk itself, STOP and
> report.** That is a different change with a different estimate and it is **not made
> under R22b.**

⭐ **Why the constraint is written this hard:** the block walk is where **two members of
the read/overwrite ordering class** live — `foldStatements` never learned destructures,
and every outer `var` a branch assigned went opaque as `pine:reassign`. A note pass that
strayed into that machinery would be re-entering a defect class this programme has
already paid for twice.

**The acceptance already pins the top-level case** (`a992d7bd2`). d1′ adds **nested
specimens across three call types** (`alert`, `bgcolor`, and one drawing call) at **two
depths** (inside `if`; inside a `for` body), plus controls asserting that on every
specimen **`refusals.length`, the refusal codes in order, and the output count are
byte-identical before and after** — a note pass moves nothing else.

### ⏸️ d1 — PREMISE CORRECTED BY MEASUREMENT; **RED committed, NOT built**

**Red `9cae578ee` → corrected `a992d7bd2`.** ⛔ **R22's d1 premise is half wrong, and
it is the half that sets the scope.**

| | measured |
|---|---|
| `alert()` at **top level** | ✅ **already noted** `pine:chart-only@2` |
| `alert()` inside an `if` | ⛔ **no note** — the real gap |
| `bgcolor` inside an `if` | ⛔ **no note** — the same gap |
| `bgcolor` / `fill` at top level | ✅ already noted |

⭐ **`alert` IS ALREADY IN `CHART_ONLY_CALLS`** (`pine.js` ≈1785), beside `plotshape`,
`plotchar`, `bgcolor`, `barcolor`, `fill`, `hline`. Two consequences:

1. **No new note code.** `pine:runtime-only` is **withdrawn** — `pine:chart-only`
   exists and is correct. (The note-code measurement stands: `noteOf` takes a
   free-form string, no table, and `pine:chart-only` has **zero** `REFUSALS` entries.)
2. **The defect is not about `alert()`.** It is that **a chart-only call inside a
   BLOCK is noted nowhere, for the whole set.**

⚠️ **The 191 figure is not wrong — the inference from it was.** The census counted call
sites without asking where they sit.

⛔ **NOT BUILT, and deliberately.** Noting a chart-only call inside a block reaches the
**block walk** — the same machinery whose two readers disagreeing is recorded at
`destructureBindings` (`foldStatements` never learned destructures; every outer `var` in
the branch went opaque). That is bigger than the ruling priced and does not fit the
remaining clock, so per the 2× corollary it was **not started**. The acceptance asserts
the measured truth and pins the working top-level case so a later fix can neither
double-count it nor break it.

**⛔ d2 and item (e) are NOT started.**

⛔ **H.7 — OWNER QUESTION, OPEN: what does a *set* mean?** **D1 says a pane does not
select an alert**, so a set has no pane meaning; what one means is a **screener-surface**
question, and ⛔ **the screener lanes are not this branch's**. The evidence sits with the
question: **112 of 120** files carry 2+ alertconditions · **53** share a signal family
(**184** alertconditions) · tail to **38** in one file · **26** scripts have no plot at
all. **Not built in Wave 2 unless the owner rules otherwise.**

⚠️ **I am not proposing a build, and the reason is a scope judgement the owner should
make rather than me.** Three of the four over-threshold rows are the same defect wearing
different clothes — **something a member wrote is dropped without a word** — and fixing
that is a *refusal-and-carriage* job, not an "alertSets" feature. The fourth (what a set
means to a pane) is a **product** question D1 already half-answered.

**Estimates, so a ruling can be priced:**

| | |
|---|---|
| **(d1) the two silences speak** — `alert()` and a dropped message refuse or note by name, carrying their numbers | **45 min** |
| **(d2) a literal message rides the title's carriage** — presentation field, no node type | **40 min** |
| **(d3) sets as a first-class offer** — needs the owner's answer on what a pane does with one | **not estimable until ruled** |

---

## ✅ d2 BUILT — an alert message rides beside the title (R22a)

**Red `445b5cc4d` → fix `4b188aecc`.** Estimate **55 min**, stop 110, actual **~85**.

### 1.1 — the consumer measurement, reported BEFORE the field was added

⭐ **Nothing consumes an alertcondition output's key set**, so adding one key breaks
nothing. Measured, not assumed:

| consumer | reads | breaks on a new key? |
|---|---|---|
| `presentation.plots` / `.fills` | `kind === 'plot'` rows only | no — alertconditions are never in scope |
| `closingPass` / `paneGate` | `kind`, `title`, `index` **by name** | no |
| `verifyRoundTrip` | re-translates and compares **outputs.length + kind + title** | no — it names the three fields it compares |
| `corpus_metric.json` | counts `outputs`, buckets by `kind` | no |
| contract files | `kind`/`title` by name | no |

**No consumer enumerates the keys of an output row**, and no snapshot serialises a whole
alertcondition row. That is what made a beside-the-title field the cheap answer rather
than a guess that it would be.

### 1.2 — the acceptance, red, with its non-vacuity control named

`alertMessageRides.test.js`. ⛔ **The non-vacuity control is
`every specimen has a message arg and produces output`** — without it `row.message ===
'X'` passes over a script that refused before reaching the `alertcondition`, and an empty
output list satisfies every other assertion in the file.

⭐ **`SAME_TITLE` is the `:121` lesson made a specimen** — two messages under ONE title.
A single-specimen test passes when the carriage keys off the title or writes one row's
message onto the other; these two are indistinguishable unless both are present.

### 1.3 — the fix, both argument forms

`outputMessage(args, kind)` reads **named or positional**, exactly as `outputTitle`
already does, and `hasUncarriedMessage` notes the ones it will not carry.

⚰️ **The named form is the one that bit.** The census read `message = "…"` as an
EXPRESSION because the value did not start with a quote, understating the carryable set
by ~155 and mis-sizing the ruling. The fix reads both and **a mutation proves it**.

⛔ **An expression message is NOT carried and gets a NOTE** (`pine:alert-message`), never
a refusal. 487 of 555 carry; **2** are genuine expressions, and at two corpus specimens
that is not a feature — it is a sentence, folded into d2 per R22a.

### 1.4 / 1.5 — re-baseline and mutation proof

**Artifacts UNCHANGED** — `corpus_metric.json` and `lookback_agreement.json` both
untouched, `tools/` clean. A new presentation field on a row nothing counts moves no
count, which is the same fact §1.1 measured from the other direction.

Scope: **376 files / 7,501 passed / 6 failed in 4** — the pre-existing trio plus
`symbolFoldParity`, which is **green alone**. A timeout is not banked as breakage.

Three mutations against `sha256 4f3519fe…`, restored byte-equal:

| mutation | result |
|---|---|
| drop the `message` field | **3 RED** |
| carry the expression as if it were a string | **RED on its own control** |
| read positional only (delete the named branch) | **RED on `NAMED_FORM`** — the ⚰️ above, railed |

## ✅ d1′ BUILT — a chart-only call inside a block is noted (R22b)

**Red `cda5fe08d` → fix `5d1052ddc`.** Estimate **60 min**, stop 120, actual **~105**.

### 2.1 — the gate measured before anything was designed, and it **HOLDS**

`blockStatements(tokens, indents, 0)` returns statements shaped `{header, body, sub}`,
and **`sub` nests recursively to arbitrary depth**. So a post-walk structure exists: a
read-only pass can reach every nested call **without modifying the block walk**, and
R22b's hard constraint holds. **No STOP was required.**

The pass runs **beside** the walk — after it, over the same `stmts` array, immediately
before `const finalBindings = new Map(env)`. Never inside it, because the block walk is
where the two members of the read/overwrite ordering class live.

⭐ **Recursion starts at each top-level statement's `sub`**, so a top-level call is never
re-visited; a `line:column` dedup sits behind that as belt and braces.

### ⚠️ SCOPE CORRECTION — the third call type

R22b named **a drawing call (`label.new` / `line.new`)** as the third specimen type.
**`label.new` is NOT in `CHART_ONLY_CALLS`** — the set is exactly `plotshape`,
`plotchar`, `bgcolor`, `barcolor`, `fill`, `hline`, `alert`, and drawing calls have their
own `pine:drawing` treatment. **`plotshape` is used instead**, so all three specimens are
genuinely inside the ruled set rather than testing a neighbouring one.

### 2.5 — the mutation proof, reported honestly

Against `sha256 75214cd9…`, restored byte-equal after each.

| mutation | result |
|---|---|
| disable the nested pass | ✅ **5 RED** on the nested specimens, **top-level pin GREEN** |
| clear `seen`, walk twice | ✅ **RED** — *after the control was strengthened* |
| make the pass touch a binding | ⛔ **NOT EXERCISED** |

⛔⛔ **MUTATION 3 IS NOT PROVEN, AND IT IS RECORDED AS UNEXERCISED RATHER THAN CLAIMED.**
Three attempts: `forceOpaque` on a builtin (a builtin has no binding to touch);
`forceOpaque` on a real bound name read by the plot — a fifth specimen was added for this
mutation's sake, since the original four bind nothing and cannot perturb at all — which
moved no measured value; and pushing a refusal, which would not load (`refusals` is not
in scope at that point), so the file reported *"no tests"* rather than a red control.
**The byte-identical controls — refusals, codes IN ORDER, and output count, each pinned
at values measured before the pass existed — are in place and would catch a real
perturbation. I have not exhibited one.** A guard nobody has seen fire is not yet a
guard, and saying so is cheaper than the alternative.

⭐ **Mutation 2 caught a weak control, which is what a mutation proof is for.** v1 pinned
the **top-level** call — the one site the pass never visits — so clearing `seen` and
walking twice left 14/14 green. It now pins **every** site including the nested ones, and
the mutation reds.

### 2.6 — artifacts and rails

**Artifacts UNCHANGED**, as a notes-only pass should leave them. Lane rails green,
33/33 across four files; 22/22 on `silenceSpeaks` + `alertMessageRides` together.

## ⭐ THE (d) REPORT — four lines

1. **(d) is CLOSED.** Both silences now speak: an `alertcondition`'s literal or
   `{{placeholder}}` message **rides beside the title** as a presentation field (487 of
   555 carryable), and a chart-only call **at any depth** is noted — top level was
   already covered, a block was noted nowhere, for all seven call types.
2. **Neither one is a refusal, and neither one is a node type.** A message rides the same
   carriage a title always has, so `str`'s textop-only parentage is never engaged and
   **no 12th `NODE_TYPES` member is implied**; `pine:chart-only` and `pine:alert-message`
   are free-form notes with **zero `REFUSALS` entries**, so the frozen 41 stands.
3. **Both premises were measured false before either was built**, and both corrections
   came from the instrument's own table rather than from review: d1's *"`alert()` is
   dropped whole"* (it was already noted at top level; the gap was depth), and d2's
   *338 literal / 149 placeholder / 2 expression* against the census's original
   183/157 (it read a **named argument** as an expression).
4. **d3 is OWED to H.7** — what a *set* means is a screener-surface question, D1 having
   ruled that a pane does not select an alert, and **the screener lanes are not this
   branch's**. Not estimable until the owner rules.

---

# ⭐⭐⭐ WAVE 2 CLOSE-OUT — THE OPERATING MODE AND THE RULINGS (owner, 2026-09-15)

## THE GOAL, restated because every remaining item serves it

A member pastes a Pine indicator and gets **a hosted pane matching TradingView and a
screener column**. Wave 2 is DONE when `uncharted-volume-v2` **and** `uncharted-clouds`
both render as hosted member panes within Wave 1's tolerance, the screener reads their
columns, and the Wave 1 and Wave 2 PRs are merged. **(e)–(i) serve that; (j) IS that.**
Six weeks are spent and the programme is past deadline.

## ⭐ WHAT DOES NOT CHANGE

**Every rail that has caught a defect stays** — acceptance first committed red,
non-vacuity control named, mutation proof, byte-exact restore, census before build, one
heavy process, no bash edits, corrections in place, artifacts by name, one commit per
concern. **They are why six weeks of work is trustworthy**, and the close-out speeds up
the *deciding*, never the *verifying*.

## PRE-AUTHORISED DECISIONS — decide, record with the number, do not stop

| # | the rule |
|---|---|
| **PA-1** | A form **under** the ~20 threshold **RETIRES**: refuse or note **by name at its own line**, carrying its number and its routing. ⛔ Nothing that works is removed. |
| **PA-2** | A form **over** the threshold that needs no 12th node type, no 42nd refusal code, no block-walk modification and no second colour/text carriage **BUILDS**, acceptance first. |
| **PA-3** | A **silence** — something the member wrote producing no output, note or refusal — is fixed as a **NOTE at its line**. Never a refusal, never a stop. |
| **PA-4** | A **premise measured false** is corrected in place; the block proceeds on the measured premise; the correction is **reported, not escalated**. |
| **PA-5** | An instrument's **classification defect** is fixed before its numbers are used. No stop. |
| **PA-6** | A **spent fixture** moves to the frontier; a **rail over budget** is fixed; a **timeout** is re-run alone. No stop. |
| **PA-7** | Estimates per block; the **2× stop applies PER BLOCK** — but ⭐ **a stopped block no longer ends the session.** Commit its red and its pin, record the exact resume point, **move to the next independent block.** |

## ⛔ STOP FOR A GO — and only for these

A 12th `NODE_TYPES` member · a 42nd `REFUSALS` entry · a modification to the **block
walk** · a revisit of **D1/D2** · a change to the pane renderer outside (j)'s scoped plan
· removal of a working capability · a merge to master. **Those are rulings, not
judgement calls.**

## ✅ RULINGS H.4 – H.7 (owner, 2026-09-15)

### H.4 — ALREADY RULED, and the pending list said the wrong word

A dropped loop body is announced **as a note at the loop line**, scheduled together with
the owed **UDT-field-access** gap (`candelacharts-equal-highslows-eqheql…:135`) because
one loop-classification walk change serves both. ⛔ **The pending list now reads
*scheduled*, not *pending*** — a ruled item sitting in a "pending" column reads as an
open question and invites it to be re-asked.

### H.5 — ONE REFUSAL PER LINE **STANDS**

Two defects on one line surface **one refusal per surface, by relocation**; a member is
never shown both as refusals. ⭐ The second **may** ride as a **note at the same line**
*if* the read-only note pass of R22b can see it **without touching the walk**; if it
cannot, **nothing changes**. Specimen: `high_engagement__20:10`. **No build in this
prompt** — the ruling is recorded so the next session does not re-derive it.

### H.6 — THE DEFERRAL TEXT IS CORRECTED IN PLACE; **D2 STANDS**

Two sentences were asserting a precondition that measurement has overtaken. Both are
corrected **at their own sites**, one commit per file, edited as text:

| site | what it said | what is measured |
|---|---|---|
| `paneGate.js:6` (`c7742fd82`) | the IR lane *"stays as it is until session 3's text layer"* | **session 3 ARRIVED** — `pine:text-value` stops neither script and the IR lane reaches **77** statements on v2 where it reached 40. The text layer was never the thing holding it off the pane. |
| `SESSION-STATE.md` item (c) entry (`db94e99bf`) | *"closing the tuple form is what lets D2 be revisited at all"* | v2's **first** IR refusal is **`runtime:statement@249`** — **two lines before** the tuple at `:251`, and neither text nor tuple. Closing the tuple form does not reach the next refusal, let alone D2. |

**What actually blocks it, in one sentence:** the IR lane declares `STMT.FOR`,
`STMT.WHILE`, `EXPR.TUPLE` and `EXPR.ARRAY_OP` and **lowers none of them** — zero
mentions across `lower.js`, `lowerIr.js`, `vm.js` — so **D2's revisit waits on the IR
LOWERING PROGRAMME**, which is wave-sized and is not this branch's to schedule.
⛔ **D2 STANDS. `PANE_LANE = 'host'` is unchanged.** This corrected a *sentence*, not a
*ruling*.

⭐ **Why both, and why at the source:** the plan doc has carried this correction since
R18's §1.2 while both sources kept asserting the false thing, and `WAVE2-A-CENSUS.md:342`
quotes item (c)'s line to justify a routing decision. **A correction living beside an
uncorrected source is the two-authorities defect wearing a fix** — the next reader finds
whichever they reach first, and they reach the source.

### H.7 — ALERT SETS ARE DEFERRED **BEYOND WAVE 2**

No pane meaning (**D1**: a pane does not select an alert); the screener meaning belongs
to the **screener surface**, not to this branch. The census numbers stay recorded beside
the ruling so nobody re-measures them: **112 of 120** files carry 2+ alertconditions ·
**53** share a signal family (**184** alertconditions) · tail to **38** in one file ·
**26** scripts carry no plot at all.

---

# ✅ (e) — SHORT-CIRCUIT: **RETIRED ON ITS NUMBERS** (PA-1)

Census `86244545e`. **269 scripts · 13,906 uses · 20,954 conditional operands.**

## ⭐⭐ THE HEADLINE IS THAT THERE IS NO DEFECT

**The engine is measurably wrong in 0 of 20,954 conditional operands**, and it already
short-circuits **at plan time**: `pine.js:5873/5897/5914` delete the conditional operand
in **1,836 of 13,906** uses whenever the deciding operand resolves to a literal `num`.

⚰️ **PA-4 — A COMMITTED LINE MEASURED FALSE AND IS CORRECTED AT BOTH ITS SITES.**
*"Both sides always evaluate today"* is true at **run** time (`interpret.js` lifts both;
`vm.js:306` says so outright) and **false at plan time** — which is the only lane any of
(e)'s three cases live in. Corrected in `SESSION-STATE.md` at both the summary table and
item (e)'s own entry, because a sentence quoted in two places is two authorities.

| case | admissible **and** reachable | verdict |
|---|---|---|
| **(A)** lookback / repaint | **11** | **RETIRE** — routed to `FOLD_BINARY` by name |
| **(B)** `na` poisoning | **0** | **RETIRE** — write the semantics table |
| **(C)** an unissued request | **0** (of 111 operands) | **ROUTE TO (c)** by name, 110/1/0 |

**(A) is not an evaluation-order bug at all.** `maxLookback`'s unconditional `Math.max`
(`interpret.js:2582`) is **correct**: it is a **static bound**, so a genuinely-series
left operand really does need the right operand's history, and a *folded* left has
already been deleted before it is reached. The 11 are `FOLD_BINARY`'s, not evaluation's.

**(B) is zero because `TERNARY` selects.** The 2,013 `na` rows are ternary **arms**, and
`interpret.js:2191` selects rather than propagates, so `plot(cond ? x : na)` already
answers exactly what Pine answers.

**(C) is zero at the output.** 111 operands, all refused at `pine:request`; **110 of 111
gates already fold**, and the single one that does not
(`liquidity-heatmap-nephew-sam__7628c72c3d.pine:132`) gates on a **UDF parameter**, so
**item (c)'s inlining decides it** — routed by name with its number, never dropped.

## ⛔ THE REAL GAP IS `FOLD_BINARY`, AND IT IS DELIBERATE

`pine.js:3690` is `+ - * /` and says **"DELIBERATELY NOT THE COMPARISONS"**. So
`len > 5 ? heavy : light` has a test every human reader calls constant while both arms
resolve. Only string `==`/`!=` folds (`:5816`). **That is the binding constraint for all
11 of (A)** — and it is a threshold question for a future wave, not a defect.

## ⚠️ ONE FORWARD HAZARD, RECORDED BECAUSE IT IS NOT A DEFECT **YET**

**The propagating `and` is v5-CORRECT and v6-INCORRECT BY SPECIFICATION.** Pine v6
declares `bool` never `na` and `and`/`or` short-circuiting; `interpret.js:2157`
propagates. **73 of 269 corpus scripts are already v6.** Nothing is wrong today because
(B) measures 0 — but the *reason* it measures 0 is a v5 semantic, and the corpus is
drifting under it. **Recorded here so the next reader finds it before a member does.**

## ⚠️ AND A DEFECT IN A **SHARED** INSTRUMENT, FLAGGED TO ITS OWNERS

(b)'s `strip_pine` — imported by (c), (h) and (e) — **blanks the newline inside an
unterminated quote**, so 4 of 269 files lose up to 26 lines. It desynchronised (e)'s two
parallel line arrays and **manufactured the only case-(B) hit an earlier pass reported**
(B: 1 → 0). Harmless to (b)'s own census, which only counts newlines before an offset.
⛔ But it is a property of a stripper **four censuses now share**, and a shared
instrument's blind spot is reproduced by everything that imports it.

---

# ✅ (i) — VOLUME PROVENANCE: **ONE SOURCE SEALED, TWO LIVE**; every fix routes out

Census `662ddb07c`. **346 `volume` reads in 63 of 266 scripts** — and the population is
bigger than the token suggests.

## ⭐ A SIXTH FORM CARRIES NO `volume` TOKEN AT ALL

`ta.vwap` (19) · `ta.vwma` (17) · `ta.obv` (6) · `ta.mfi` (5) · `ta.nvi` (4) ·
`ta.pvi` (4). A token-based census misses every one. **63 scripts → 77.** Of those, 7
are host-admitted and 16 screener-admitted, **7 by both** — and one of the 7 calls
`ta.cum`, which `_requirement_tags.window_dependent` refuses for the screener, so **the
population a pane/screener split can bite today is 6.**

## THE VERDICT

**One place for every sealed bar; two places from the last sealed close onward.** Both
lanes read one column, `bars.db::ohlcv.v`, written by one function
(`bars_sqlite.put_bars:1182`) and read by one (`get_bars:584`), and even the vocabulary
is single-authority (`volume → 'v'` declared once in `closedTable.json`, and
`ast_table.py:46` opens *that same file*). **R20's class is not present in the store.**

| # | divergence | where |
|---|---|---|
| 1 | the pane gains a bar the store does not hold, `v` from the **single-ticker** snapshot (~8s TTL); the screener never runs that line and builds its own forming bar from the **all-tickers** snapshot (30s shared) | `bars.py:464` vs `scan_evaluator.py:1011` |
| 2 | the pane's deep history comes from the **worker's** `bars.db` via the CDN edge while its tail comes from the web pod's; the screener reads only its own process's store | `bars.py:879` / `:963` |
| 3 | the `v` column is filled by **two vendors** (Massive aggs; yfinance on a lagging tail), Massive-wins-overlap — **both lanes inherit it** | `bars_fetch.py:1282` |

## ⛔⛔ THE SHARPEST FINDING IS INSIDE THE PANE PATH, NOT BETWEEN THE LANES

**On one chart, today's volume has up to FOUR values.** The member Pine pane reads raw
`filteredBars[last].v` (`StockChart.jsx:10744`); the built-in histogram takes
`max(b.v, livePrices[sym].volume)` (`:7861`); the built-in volume MA reads raw `b.v`
(`:7890`); the legend recomputes the max a second time (`:4090`); and with extended
hours on, `applySessionCandle` folds ext volume into `v` **for the built-in pane only**.
⭐ A member comparing their Pine volume plot to the built-in one is comparing two
different numbers, and neither is labelled.

## CONSOLIDATED vs PRIMARY — **the path does not make the choice**, and that is the answer

No tape, venue or trade-condition selection exists anywhere on the daily/pane path.
Where the repo *does* choose, it chooses for **price and explicitly not volume**:
`trade_conditions.py:1-9` filters CTA/UTP for high/low/last only, and
`bar_broadcaster.py:292` states *"odd-lots count toward volume on the consolidated
tape"* — the live stream, not `/api/bars`.

## ⛔⛔ WHAT WAVE 1's TOLERANCE ACTUALLY COVERED — AND THE HALF IT DID NOT

Wave 1 measured **the pane path** against a frozen `/api/bars` payload,
`tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json`. **Verified rather than taken
on trust: 3000 bars, last bar `t = 2026-09-11`** — every one of them **sealed**, which
is precisely the half where the two lanes agree *by construction*. And **the screener
path was never measured against anything**: no vendor capture, no `seriesCompare` row,
no fixture comparing a screener column to TradingView or to the pane.

⭐ **This lands directly on (j).** An acceptance that reuses Wave 1's procedure unchanged
will not exercise the developing bar either, so **(j) cannot inherit a tolerance and
call the live divergence covered.** Recorded in (j)'s plan below.

## OUT OF SCOPE — RECORDED WITH ITS REPRODUCTION, **NOT CROSSED**

Every fix lives outside this branch: four disagreeing renderings of today's volume →
**UCT Terminal / charts** · two vendors in one `v` column → **bars/data platform** ·
two physical stores composing one series → **bars / edge deep-history** · the screener's
second snapshot endpoint → **screener** · the unmade consolidated-vs-primary choice →
**the owner's provenance decision**, already routed out of this wave. ⛔ No engine change
is owed, and none was made.

⚠️ **UNVERIFIED AND MARKED SO:** no engine-vs-capture reproduction is possible from
committed data — there is no screener-side bar array and **no fixture contains a
developing bar**, which is exactly where the divergence lives. A three-step rig
reproduction is written out in the census. No vendor API was called.

---

# ✅ (f) — NESTED TEXT HELPERS: **2,242 ALREADY SHIP**, and it corrected d2

Census `2b708f81d`. 328 scripts. **3,382 nested uses** against 2,772 standing alone.

**Six forms clear the threshold (782 / 541 / 448 / 376 / 50 / 45) and every one of them
already works** — all TEXT-yielding, all into a drawing's `text=`/`tooltip=`, **no `str`
node anywhere**. Verified verbatim from the shipped object program:
`{"t":"cat","args":[…]}`. **Carriage, not node type.** So for all six, "BUILD" means
**keep and do not regress**; the other 44 forms retire, each named with its number.

**NUMBER-yielding: 30 nested uses, 0 admissible** — and the absence is evidence because
the same door folds `str.length("abcd")` and `str.length(syminfo.ticker)`, while
`textOperandOf` (`pine.js:5308`) takes a literal or a `syminfo` field and never a call.

⭐ The only number arguing for **new** work is **123 method-spelling uses**
(`tbl.cell(…)`), and it routes to `pineObjects.js` — not to a node type.

## ⛔⛔ AND IT FOUND A DEFECT IN d2, BUILT EARLIER THE SAME DAY (`3b6e6226d`)

d2's **2 "expression messages" are not expressions**: they are string literals whose `+`
is **inside the quotes** (`…Grade A+ - Highest confidence…`). The corpus holds **489 of
555** carryable (340 literal + 149 placeholder) and **zero** expressions.
⭐ **The carriage was never wrong — only its sizing.** What changes is a fact about the
guard: **`pine:alert-message` has zero corpus firings**, and only a synthetic specimen
exercises it. Corrected at all three sites that quoted the old number.

⚰️ **THE SAME INSTRUMENT DEFECT, TWICE IN ONE ITEM, AND THE SECOND SURVIVED THE FIRST
CORRECTION.** (d)'s census was already fixed once for reading `message = "…"` as an
expression because the value did not start with a quote. Both are **"ask the KIND before
the LITERAL"** — the rule written down after (b) — and both were caught by a *later
instrument*, never by review. **Fixing one violation of a rule does not find the others.**

⚠️ Measured and worth keeping: **zero text helpers of any kind appear inside an
`alertcondition(` or a plot-family call at any depth** in all 328 scripts. So the
question of extending d2's carriage to a nested helper is **closed by measurement**
rather than deferred.

---

# ✅ (g) — `s := close`: THE PREMISE IS FALSE; **THE SENTENCE WAS THE DEFECT**

Census `b1fbc13c7` · build `54c6f9606`.

**1,649 RHS-series-valued uses in 158 files; 592 admissible-and-reachable in 82.** 89
forms, 10 over threshold — **and all 10 are already in a position the engine folds.**

⭐ **(g) IS NOT A TYPING GAP, AND THERE IS NOTHING TO TYPE.** A binding holds a **node**,
and for `s := close` that node *is* the series (`exprBinding pine.js:8615`). Pine's type
word is deliberately dropped at `boundName` (`:8497`). `s[k]` is routed by the
**mutation set**, never a declared type (`selfOffsetLag :6010`). Proven on a real script:
`var float mhigh = na` / `mhigh := high[1]` inside an `if` / plotted comes out
`host: true, hostGuards: []`. **Only 13 of 266 scripts refuse `pine:reassign` at all.**

## WHAT WAS REAL: THE CLOSING PASS KNEW THE REASON AND NEVER SAID IT

`why = unfoldable.get(name)` was computed four lines above the `missed` branch and used
only in the `else if`. So a member whose `varip` accumulator stopped the fold **thirty
lines earlier** was told *"a name that is reassigned later cannot be folded into one
expression"* — true of the line it names, silent about the cause.

**Fixed with a three-step precedence, and the order is the design:** `carried` (R7a's
case) → `fromChain` (the new one, which R7a could not reach because the `if`-chain catch
records into `unfoldable` and not into `env`) → the bare name. **R7a's line choice is
untouched and pinned by a control.**

⛔ **NOT A RULING TRIGGER — CHECKED, NOT ACCEPTED.** The census reported this as needing
an owner ruling for sitting "in the same machinery" as the ordering defect class.
`pine.js:11320-11358` is the **closing pass**: after the walk, touching neither
`foldStatements` nor `destructureBindings` nor `foldIfChain`.

---

# ✅ (h) — THREE `syminfo.*` FIELDS RETIRE **BY NAME** (data only)

Census `6a3451c91` · red `485d8a9f5` · build `3ac4b1473`.

⭐ **The population is far narrower than the item assumed, and it was traced not
assumed:** of 667 `syminfo.*` reads across 119 files, **only the exchange half resolves
through `ticker_meta`** (`bind.js:152-156`). `syminfo.ticker` is the chart symbol
**string** and never touches the store. So staleness reaches `tickerid` (318) and
`prefix` (17) and nothing else.

**`basecurrency` (22/7) · `timezone` (13/6) · `root` (1/1)** were in **neither** roster —
36 uses across 14 files, more than the four refused-by-name fields combined.

⚠️ **I FIRST READ THAT AS A SILENCE AND IT IS NOT ONE.** The namespace fallthrough
(`pine.js:575`) *does* refuse them; they were refused **anonymously**, which is a
different defect — and `symbolScope.json:72` says so in its own words: *"The roster is
the thinking; the fallthrough stays behind it for names nobody has ruled on yet."* So
**PA-1 (retire by name), not PA-3 (note a silence)**. Corrected before any code moved.

**The whole fix is three manifest entries**, edited as text: `BUILTIN_SYMBOL_UNSERVED` is
derived from the roster *"so the roster has ONE owner"*. ⭐ `root` is rostered at **one
use** deliberately — a roster entry is not a build, and a rare name is exactly the one a
later reader assumes merely fell through.

## ⛔ BF.B — REPRODUCED, AND ROUTED OUT

`ticker_meta.py:183` upper-cases and nothing else. The app-canonical charting form is
`BF-B`, and **this repo owns that rule twice** (`groups.py:59-61`,
`ticker_search_index.py:69-71`) — `ticker_meta` mentions neither, making it the only
symbol-keyed store in the chart's chain without share-class normalisation. Downstream it
yields `exchange: null`, so `prefix`/`tickerid` refuse with *"a TradingView string this
engine has not measured"* — **the wrong cause**.
⛔ **Owner: symbol-resolution / ticker-search on the web pod. Recorded with its
reproduction, NOT crossed.** This branch owns one adjacent thing and it is a *sentence*.

⚠️ Two staleness defects recorded in the store itself: the freshness clause tests for the
**key**, not the value (`"exchange" in disk`), so `exchange: null` reads as fresh for 24h
server-side and **7 days in the browser**; and `heal_nameless_names` rewrites a row
*without* its exchange field.

---

# ⛔ (j) — UNCHARTED CLOUDS: THE BUILD PLAN. **THIS IS THE ONE STOP.**

Scoped by reading only (`70e3b5a9d`, 11 gaps with file:line). **Nothing below is built.**
(j) changes the renderer, and the owner rules on its scope.

## ⭐⭐ THE FINDING THAT RESHAPES THE WHOLE ESTIMATE: **IT IS TWO DROPS, NOT ONE**

| | |
|---|---|
| **G1** | `memberPaneDefinition.js:100` — the drawable filter carries `!o.hidden`, so Clouds' **21 `display.none` anchors** never enter the pane document. **23 → 2.** |
| **G4** | `binder.js:824` — a hidden plot is `continue`d in **pass one**, so it never enters `prepared` and never reaches the fill wiring in **pass two** (`:1000-1032`), which attaches a fill to the plot's **own series** — which a hidden plot does not have. |

⛔⛔ **LIFTING G1 ALONE YIELDS 21 ROWS THE BINDER THEN ORPHANS, AND ZERO CLOUDS.**
Different files, different layers, neither removal makes the other moot. **Planning them
as one gap would have priced half the work** — and the symptom is identical, which is
exactly why it would have gone unnoticed until the first render.

⭐ The engine is **innocent**: `pine.js:11928-11933` explicitly keeps hidden outputs in
strict mode, and `paneGate` never inspects the row set. Both drops are downstream.

## THE SUB-STEPS, IN ORDER, WITH ESTIMATES

| # | step | estimate |
|---|---|---|
| **j.1** | **the saved definition carries all 23.** Red on the count, then BOTH drops: G1's filter and G4's pass-one `continue`. Its acceptance must assert the count at **each** layer — translation, pane document, binder `prepared` — or a fix to one reads as a fix to both. | **90** |
| **j.2** | **a fill draws between two hidden anchors.** G4's other half plus `fillPrimitive`. Depends entirely on j.1b's shape. | **60** |
| **j.3** | **a series-conditional fill colour.** The four-layer contract gap below. The largest and the least certain. | **120, and it is the one to distrust** |
| **j.4** | **acceptance = Wave 1's procedure**, both tables, two mobile tiers, against the 3B capture. | **45** |
| **j.5** | **anything crossing beyond fills** — named as a ruling question, never assumed. | **not estimable** |

**Total for j.1–j.4: ~315 min (5¼ h), stop 630.** ⛔ j.3 is the number to distrust: it is
priced against a contract gap I have read but never driven.

## j.3 — THE FILL-COLOUR CONTRACT, FOUR LAYERS, NAMED NOT CHOSEN

1. **G6** — the fill note has **no field for a condition** while a plot note has three
   (`pine.js:11287-11293`; the real field set is `{a, b, color?, opacity?}`, optional keys
   *omitted*, not `undefined`).
2. **G7** — ⭐ and for Clouds **the field would be empty anyway**: both branches are
   user-function calls, and `staticColourOf` folds neither (`pine.js:12426-12428`). **So
   adding the field first would produce a correct, empty contract and look like
   progress.**
3. **G8** — `defSchema`'s `plots[].fill` is `{with}` with a static colour; plots have
   `colorMode: 'column:<key>'` and **fills have no analogue** (`defSchema.js:1580-1584`).
4. **G5** — `fillPrimitive.js:169` sets `ctx.fillStyle` **once per frame**: there is no
   per-run colour channel to write into.

⛔ **R10 stands: no second colour path.** Whatever closes this must be the carriage the
plots already use, not a parallel one.

## ⛔⛔ AND (i) CHANGES j.4's ACCEPTANCE — DO NOT INHERIT WAVE 1's TOLERANCE BLIND

Wave 1's fixture `spy-1d-bars-3000-2026-09-13.json` has **last bar `2026-09-11`** —
**every bar sealed**, which is exactly the half where the pane and screener lanes agree
*by construction*. **Reusing that procedure unchanged would not exercise the developing
bar at all**, and (i) measured three live divergence points plus **four different
renderings of today's volume inside the pane path alone**. j.4 must either capture a
developing bar or **state in the artifact that the live half is uncovered.** ⛔ Silence
there would be the "tolerance on a count is not tolerance" defect one level up.

## ⛔⛔ OWNER-RULING TRIGGERS — (j) CANNOT START WITHOUT THESE

1. **The renderer beyond fills.** `binder.js:824` is the **hidden-plot** path, not the
   fill path. No cloud draws unless it changes behaviour or a fill attaches somewhere
   other than its own series.
2. **`CARRY_MAX` is shared** with the builder's own import (`memberPaneDefinition.js:48`),
   so moving it for (j) moves it for the builder. It does not bite today (2 < 12); **it
   bites at 23**, i.e. the moment j.1 succeeds.
3. **Is relaxing `!o.hidden` a D2 revisit?** The filter is in `memberPaneDefinition`, not
   `paneGate` — **routed, not decided.**
4. **Adjacent to removing a working capability.** The filter is reinforced by ruling 1.2
   (`pine.hiddenOnly.test.js` — the Supertrend/ohlc4 and Butterworth mistranslations).
   Making hidden rows drawable risks re-opening what that ruling closed.
5. **A schema addition** — no existing field can express a per-bar fill colour.

⭐ Not required, measured: **no 12th `NODE_TYPES`** (still 11) and **no 42nd `REFUSALS`**
(still 41); Clouds refuses **0** on both lanes; the block walk is not implicated.

## ⚠️ WHAT THE SCOPING READ COULD **NOT** ESTABLISH

The "2 rows" is read from the filter plus two written measurements, **not observed by
running** — 3A was blocked. The fill index mapping (p1→2 … p21→22) is asserted nowhere.
`fillRuns` behaviour on **20 stacked adjacent bands** is unmeasured. `zorder.js` has one
importer — its own test — and **disagrees with the shipped primitive** (`'normal'` +
`drawBackground` vs `'bottom'`), status unstated. And the `EMA(close,20)` seed residual
of **0.02** stands UNVERIFIED and bears directly on (j)'s numbers.

> ### ⛔ RESUME POINTER FOR (j)
> **j.1 is BUILT (`75be58693`). Resume at j.2.**

---

# ✅ R27 – R29 + H.8 (owner, 2026-09-15), AND ONE COLLISION TO RULE ON

## R28 — **ALREADY DONE**, in j.1

`memberPaneDefinition.js:48`'s *"THE SAME CEILING THE BUILDER'S OWN IMPORT USES"* was
corrected **in the same commit as the number** (`75be58693`), with the measurement beside
it. The two constants stay separate. Nothing further owed.

## R29 — the flip condition, recorded

#145 flips draft → ready **only** when j.4 reports Clouds within Wave 1's tolerance on
both tables at both tiers **and** CI is green. Otherwise it stays draft and the report
says which condition failed. ⛔ Merging is not authorised either way.

## H.8 — a report line, not a gate. Unchanged.

## ⛔⛔ R27 COLLIDES WITH A MEASURED RULING, AND THE COLLISION IS NARROWER THAN IT LOOKS

R27 rules that **pass one binds every plot, hidden or not**, and that a hidden plot
contributes *"zero draw calls and one bound series"*. But
`__tests__/hiddenIsRemovedNotParked.test.js` is an existing, **measured** ruling that
hidden means **REMOVE, not park** — and its reason is a fact about the library, asserted
against the real bundle:

> **`visible: false` does not release the series' PANE.** Park an RSI and its pane
> survives the toggle … Flip A's contract is pixel-identity with legacy, so parking
> would fail `engine_rsi_toggle_off` on the parity gate. And at Flip C an oscillator's
> band **is** a pane, so "park it" leaves an empty pane with a divider above it.

### ⭐ WHY IT PROBABLY DOES NOT BITE — TWO DIFFERENT `hidden`s

| flag | set by | handled at | what it means |
|---|---|---|---|
| **instance** `inst.hidden` | the member toggling the indicator OFF | `binder.js:447` · `:773` · `:795`, and `planBindings` — **all before pass one** | the whole indicator goes; **its pane must be released** |
| **plot** `b.plot.hidden` | the author's `display.none` | `binder.js:1063` | one row inside an instance that is **ON** and still draws |

The pane-release argument is about the **instance** path. Clouds' pane is occupied by its
two visible plots either way, so **nothing wants that pane released** — and `:1063` is
plot-level only. ⇒ **R27 is compatible, but only because it is scoped to plot-level
`hidden`.** The instance path is not touched and must not be.

### ⚠️ AND THE MEASUREMENT SAYS R27's MECHANISM MAY NOT BE NEEDED AT ALL

- `columns.set` (`binder.js:942`) loops **every** plot key and runs **before** pass one —
  so **a hidden plot already has its column**.
- The fill primitive takes **COLUMNS, not series**: `fill.setOptions({upper, lower, …})`
  is fed from `columns.get(…)` (`:1265`). The series is only the **host** whose
  `priceToCoordinate` it borrows.

⇒ A fill between two hidden anchors needs **one bound host series in the same pane** and
**two columns** — not two bound anchor series. R27's *"one bound series"* per hidden plot
is a stronger claim than the drawing requires.

### ✅ R27 IS **AMENDED** (owner, 2026-09-15) — A HIDDEN PLOT BINDS **NO** SERIES

⭐ **The original rested on a premise the measurement overturned:** the fill attaches to
**columns**, not to the plot's own series. So the smaller fix is also the safer one —
**it creates no invisible series at all**, which is precisely the hazard
`hiddenIsRemovedNotParked` was measured against.

> **R27 (amended).** A hidden plot **binds no series**. It keeps its **column**
> (`binder.js:942` already gives it one, before pass one). A fill between two anchors,
> hidden or not, is fed from `columns.get(upper)` / `columns.get(lower)` and **HOSTED on a
> series already bound and visible in the same pane** — for Clouds, one of its two visible
> plots. No invisible series is created; the pane-release behaviour
> `hiddenIsRemovedNotParked` measured is **untouched**.

⛔⛔ **TWO FLAGS, TWO MEANINGS, RECORDED SO THEY ARE NEVER CONFLATED AGAIN:**
plot-level `b.plot.hidden` (`:1063`) and instance-level `inst.hidden`
(`:447` · `:773` · `:795`). **The instance path is not modified.**

### ⚠️ THE EDGE, RULED NOW SO j.2 DOES NOT STOP ON IT

A pane with fills but **no visible bound series to host them**: the fills are **NOTED at
their lines** (*"no visible host in this pane"*) and **not drawn**, and the case is
**recorded as owed under (j)**. ⭐ That is not Clouds' case — it has two visible plots —
but a silence there would be the defect R22 forbids.

### THE RAILS j.2 CARRIES REGARDLESS

1. **pane count and the visible plots' price scale unmoved**, before and after;
2. an **`engine_rsi_toggle_off`-shaped** control that the **instance** path still REMOVES;
3. the **draw-call list for a hidden plot is exactly empty**, and the **fill draw call
   names its host series and both columns**.

⭐ *A ruling and a measured ruling that disagree is not something to settle in prose* —
the amendment came from the measurement, and the rails keep it honest.

---

# ⏸️ j.3 — 1.1 MEASURED. THE CONTRACT IS SETTLED; THE BUILD IS NOT STARTED.

## THE EVALUATOR j.3 REUSES — named, so "no second evaluator" is checkable

| step | where |
|---|---|
| `columnColorsForPlot(plot)` — reads `colorMode` beginning `column:`, takes the key, and the two colours via `twoColoursOf` → `{key, up, down}` | `pool.js` |
| the deciding column, via **the same `bindingKey` every column is stored under** | `binder.js:1024` |
| `toPoints(column, bars, adjustTime, sc, cc, cond)` → per-**point** `color: c !== 0 ? up : down` | `binder.js` |

⭐ And `columnColorsForPlot`'s own comment forces the fill's shape: *"`colorUp`/`colorDown`
ARE THE SAME TWO FIELDS `sign` USES. **A third spelling for 'the two colours a per-point
mode needs' is the second-authority defect this file already avoids once.**"*

## READERS MEASURED

`plots[].fill` — `binder` · `defSchema` · `fillPrimitive` · `nativeRegistry` ·
`objectCanvas` · `paneLayout`. `colorMode` — `binder` · `defSchema` · `markerPrimitive` ·
`nativeRegistry` · `pool` · `presentation`.

⭐ **The Python lane reads no `plots` at all** — no cross-language concern (a7.3 is not
engaged). ⭐ **`defSchema` rejects no unknown keys**, and `validateFills` checks only
`with`; **`fillColor`/`fillOpacity` do not appear in `defSchema` at all**, so the static
fill colour is *already* carried unvalidated. Contract (i) is **ignored, not broken**, by
every reader but the binder.

## ✅ CONTRACT (i) CHOSEN, IN THE STRONGEST FORM AVAILABLE

> `fill: { with, colorMode: 'column:<key>', colorUp, colorDown }`

⛔ **The same three field names a plot uses**, so `columnColorsForPlot(plot.fill)` works
**verbatim** — no new function, no third spelling, and R10's "one colour path" is
satisfied by *handing the fill to the same reader* rather than by a promise.
**Contract (ii) — a fill-specific field — is recorded here as the rejected alternative**,
and would have been written at `defSchema.js`'s `validateFills`.

## ⛔ THE RENDERER HALF IS THE REAL WORK, AND 1.1 NAMES IT EXACTLY

The evaluator yields per-**point** colours for a **series**. `createFillPrimitive` takes
**one** `color` and sets `ctx.fillStyle` **once per frame, outside the polygon loop**
(`fillPrimitive.js:169`). So j.3 must make the draw emit **runs grouped by the condition**,
each filled with its own colour — a genuine change to the draw path, not a carriage
change. ⭐ That is why j.3's estimate is the one to distrust, and it is now distrusted
for a *named* reason rather than a feeling.

> ### ⛔ RESUME AT j.3 §1.2 — the red acceptance. The contract above is settled;
> do not re-derive it. The open work is `fillPolygons`/`draw` emitting per-run colour.

## ✅ j.3a CLOSED UNDER R30 (2026-09-17, `697d67ad5`) — AND j.3 SPLIT IN TWO

⭐⭐ **THE ESTIMATE'S OWN WARNING WAS RIGHT, AND FOR A REASON NOBODY HAD NAMED.**
j.3 was written as *"120, and it is the one to distrust… the largest and the least
certain"*, distrusted because the DRAW PATH was a real change. The draw path turned
out to be the tractable half. What the estimate could not see is that **the colour
never reaches the definition at all**, so the contract's second sentence — *"both
colours through `staticColourOf`"* — was not plumbing.

### ✅ j.3a — BUILT, GREEN, MUTATION-PROVEN

`fillRuns` segments by colour as well as finiteness; `fillGroups` is the one
geometry authority and `fillPolygons` delegates to it; the draw sets `fillStyle`
once per run; `binder.fillColours` hands the fill spec to `columnColorsForPlot`
**verbatim**, at both the own-fill and the hosted-fill site.

⭐ **TWO-LEVEL SEGMENTATION** is the design point: colour decides where `fillStyle`
changes, finiteness decides where polygons split. A static band with an `na` hole
is therefore ONE `fillStyle` over three polygons and j.2's call list cannot move.
Had "run" meant one thing, every shipped band with a gap would have begun assigning
`fillStyle` three times — a change to fills nobody made dynamic.

⛔ R10 is met by CONSTRUCTION, not by promise: `pointColour` is the one place a
per-point colour is decided for a plot and a fill alike, and mutation 1 proves it —
swapping `colorUp`/`colorDown` reds `dynamicColourColumn`, **the PLOT's own rail**,
alongside the fill's.

⚰️ **AND ONE RAIL EXISTS BECAUSE A MUTATION WAS PREDICTED TO ESCAPE AND DID.**
Routing around `columnColorsForPlot` — reading `colorUp`/`colorDown` off the fill
directly — left nine of ten cases green, because none declared an `opacity`.
`twoColoursOf` is what folds a fill's alpha into BOTH colours; without it a cloud
ships at full strength over the candles it is meant to sit behind. The alpha rail
was added before the proof was run, and it is the only thing that catches it.

### ⏸️ j.3b — NOT STARTED, AND NOT STARTED ON PURPOSE

**The census, measured before building:**

| | measured |
|---|---|
| `presentation.fills` for Clouds | `{a, b}` — 20 fills, **no colour field at all** |
| the pane document's `fill` | `{with}` only |
| `staticColourOf` on Clouds' own shape | **`{colorDynamic: true}`** |

A three-plot probe isolates it: `color.new(#00FF00, 40)` carries, `color.green`
carries, and `isBullish ? getBullFillColor(0) : getBearFillColor(0)` — Clouds'
line 118 — does **not**. `staticColourOf` has no user-function branch, and
`color.new(base, t)` returns null when `t` is not a literal (`pine.js:12359`);
Clouds' `t` is `getAdjustedTransparency(layerIndex, …)`.

⇒ j.3b needs a **constant folder over user functions** (inline `getBull(0)`, fold
`50 + (100−50)*(20/100)`, resolve `input.int` defaults, then `color.new`). That is
a **parser change whose re-baseline reaches the corpus**, and the owner's corollary
governs it: *an atomic unit that cannot finish inside the remaining clock is NOT
STARTED; half-landed atomic work is the worse outcome.*

**Insertion points, pinned so the next block starts at implementation:**

| site | what is wrong there |
|---|---|
| `pine.js:11287` | the fill's `outputPresentation` call passes `{ env }` with **no `resolver`**, so `carried` can never become true |
| `pine.js:11288` | the `fills.push` drops `colorUp`/`colorDown`/`colorCondition` |
| `pine.js:12309` | `staticColourOf` — no user-function branch; `color.new`'s non-literal alpha returns null at `:12359` |
| `memberPaneDefinition.js` (the fills block) | copies `f.color` only — j.1's own comment already says this is "exactly what j.3 has to close" |

⛔ **CENSUS THE BLAST RADIUS FIRST.** Every `color.new` with a non-literal-but-
constant alpha in the corpus starts carrying the moment this folds, and each one
changes a translation. That census is j.3b's first step, not its last.

---

# ⛔⛔ STANDING RULE — **INTERMITTENT IS NOT LOAD-SENSITIVE** (owner, 2026-09-15)

> Before a red is attributed to a change, it is run **alone on the CLEAN tree**
> (stash captured, SHA recorded) **at least twice**. Only a red that is **stable on
> the clean tree**, or **stable on the change and absent on the clean tree**, is
> attributable. ⭐ **"Green alone once" classifies nothing.**

## ⚰️ THE INCIDENT IT COMES FROM, AND IT COST THE WORK TWICE OVER

j.2's wide run showed `stockChartWiring`'s *"A HOVER REACHES THE RENDERER NOT AT ALL"*
red. It had passed alone twice **earlier in the session**, so I attributed it to my
change, bisected it to the persistence slot, **wrote a confident comment blaming the
record's shape**, rebuilt the feature on a closure memo, and set the work aside as
unexplained.

The measurement that settled it: **clean tree, same file, run alone, twice in a row —
`214/215`, then `215/215`.**

⛔ **THE BISECT WAS READING NOISE.** And the rewrite it motivated was **wrong on its
merits** besides: keyed on `b.key`, a memo can never detach on a re-tenant, *because a
re-tenant has a different key*. The record slot is right precisely because `from` **is**
the previous binding.

⭐ **The rule that catches this already existed — I applied it to the wrong question.**
"Re-run it alone" was asked as *"is it load-sensitive?"* (a property of the SUITE) when
it needed to be asked as *"is it intermittent?"* (a property of the TEST). Those need
different experiments: the first compares alone-vs-in-company, the second **repeats the
same run**.

## THE BASELINE, RE-CHARACTERISED

| entry | was | now |
|---|---|---|
| `stockChartWiring.test.jsx` | "green alone" | **INTERMITTENT** — clean tree, alone: 214/215 then 215/215 |

⚠️ **AND EVERY OTHER "GREEN ALONE" ENTRY IS NOW SUSPECT UNTIL RE-CHECKED THE SAME WAY**
— they were classified by the experiment that just proved insufficient. At the next full
run, each is repeated on a clean tree: `symbolFoldParity`, `AuthContext.test.jsx`,
`enumerationSites`, and the timeout pair. ⛔ A classification is only as good as the
experiment that produced it, and three of these were produced by the weaker one.

## ⏸️ OWED UNDER (j) — A BINDER-LEVEL `notes` CHANNEL

`sync` returns `{ok, bound, released}` and has **no notes field**. A **builder-made**
definition could reach the renderer with fills and **no visible host**, and today that
band is dropped without a word. Adding the channel is an **interface widening** on
`sync`'s return and is (j)'s to schedule — **not built in this session**.

⭐ It cannot arise on the member-pane path: `memberPaneDefinition.js:141` refuses an
all-hidden script with *"this script declares nothing a chart can draw"*, which is a
sentence and stronger than a note. The binder's duty there is only to **fail closed**,
which j.2's edge case pins.

---

# ✅ (j) j.1 BUILT — and what j.2 – j.4 inherit

## j.1 — DONE. Red `57b5809ee` → fix `75be58693`. Estimate 90, actual ~85.

**All 23 Clouds outputs reach the pane document, carrying their 20 fills.**
21 `hidden: true`, 2 visible, every fill's two anchors resolving to carried plots.

| what changed | where |
|---|---|
| the drawable filter no longer drops hidden rows; **the VISIBLE ceiling is unchanged** (`CARRY_MAX` 12) and a new `DOC_CARRY_MAX` (36 = 23 × 1.5, rounded) bounds the *document* | `memberPaneDefinition.js` |
| `hidden` is carried **as the author wrote it** — it was hard-coded `false`, honest only because the filter had already removed every hidden row | same |
| the fills are carried by the anchors they already name, from `presentation.fills` (shipped since a6) | same |

⛔ **The refusal still keys off what can be SEEN** — a script whose only rows are hidden
anchors draws nothing a member could look at, so the gate reads `visible`, not the
document. ⛔ **A fill whose anchor is not carried is DROPPED, not half-written.**

⭐ **R25's premise was measured false and the comment was corrected with the number.**
The two `CARRY_MAX` constants were never wired: this file's is unexported and
`BuilderSheet.jsx` declares its own inline, under a comment claiming they were "the same
ceiling the builder's own import uses". Mutation 3 proves the surfaces are independent —
which the comment asserted and the code never did.

## ⛔ R26's TWO ESCAPE HATCHES BOTH RESOLVE TO **AUTHORISED**, SO NO H.9 / H.10 IS RAISED

R26 says anything "beyond fills" or "near ruling 1.2" is recorded as H.9/H.10 *unless
0.2 shows it is one of the three authorised things by another name.* Both are:

- **"Renderer beyond fills"** — `binder.js:824` **is the hidden-honouring path**, and
  "honouring `hidden`" is authorised by name in R26. It is not a fourth thing.
- **"Near ruling 1.2"** — that ruling's two tests are **ANDed** (untitled AND filled) and
  it governs what the door **OFFERS and SELECTS as a column**. (j) carries an anchor that
  is **never selectable**; `chooseOutput` already declines a hidden row, and j.1's
  acceptance pins that the selected row is not hidden. **Carriage is not offer.**

⭐ Recorded explicitly rather than silently: an escape hatch nobody reports on reads as
an escape hatch nobody checked.

## ⏸️ j.2 — OWED. **Resume here.** Estimate 60.

**The second drop is still in place:** `binder.js:824` `continue`s a hidden plot in pass
ONE, so it never enters `prepared` and never reaches the fill wiring in pass TWO
(`:1000-1032`), which attaches a fill to the plot's **own series** — and an orphaned plot
has none. **So Clouds' 20 fills are now declared and still do not draw.**

Precondition: none — j.1 landed. First act: measure what the renderer draws for a hidden
plot today, then a red acceptance on a **synthetic two-plot fill** and on Clouds'
layer-0/layer-1 fill with a **static** colour. ⛔ The control asserts the **draw-call
list**, not the absence — the answer, never the absence.

## ⏸️ j.3 — OWED. Estimate 120, **and it is the number to distrust.**

Four contract layers, named in the scoping section above, and ⭐ **for Clouds the colour
field would be EMPTY even once it exists** (`staticColourOf` folds neither branch), so
adding the field first produces a correct, empty contract that **looks like progress**.

## ⏸️ j.4 — OWED, and blocked on a capture. Estimate 45.

Wave 1's procedure, both tables, two mobile tiers. ⛔ **H.8's line is REPORTED, never
asserted within tolerance**: Wave 1's fixture ends at the sealed bar `2026-09-11`, so it
cannot cover the live divergence (j)'s acceptance would otherwise claim to have tested.

---

# ✅ R23 – R26 + H.8 (owner, 2026-09-15) — ONE DRAFT PR, AND (j) IS AUTHORISED

## R23 — ONE PR, DRAFT NOW, READY WHEN (j) LANDS

The pinned Wave 1 branch is **retired**: `acdf93455` is **610 behind** with **3
conflicts**, and resolving them on a stale base ships Wave 1 twice. Instead: merge
`origin/master` **into** `feat/indicator-r0r1` once, then **one draft PR**
`feat/indicator-r0r1 → master`. Draft = CI runs and the owner can read it; flipped to
ready only on the owner's word, after (j). ⛔ **Merging is still not authorised.**

## R24 — A HIDDEN OUTPUT IS CARRIED, AND CARRYING ONE IS **NOT** A D2 REVISIT

**D2 governs WHICH lane's saved definition a pane reads, not what a definition may
contain.** A `display.none` plot is an **anchor a fill references**: the definition
carries it with `hidden: true`, the renderer draws nothing for it, and a fill may
reference it. **Both drops lift together** (`memberPaneDefinition.js:100` and
`binder.js:824`) — the report measured that lifting either alone yields **zero clouds**.

## R25 — `CARRY_MAX` IS PER SURFACE, AND HIDDEN ANCHORS DO NOT COUNT

⚰️⚰️ **AND THE PREMISE OF "WHO SHARES IT" MEASURED FALSE — THERE IS NO SHARING.**
`memberPaneDefinition.js:50` declares `const CARRY_MAX = 12` and **does not export it**;
`BuilderSheet.jsx:2158` declares **its own** `const CARRY_MAX = 12` inline. They are
**two independent constants with one name**. The comment at `:48-49` —
*"⛔ THE SAME CEILING THE BUILDER'S OWN IMPORT USES"* — **asserts a wiring that does not
exist**, which is `lesson_a_comment_claiming_agreement_is_not_agreement` exactly: *a
comment saying "matches X" is a record that nobody wired them.*

⭐ **Consequence, and it cuts both ways.** Raising the pane's cap **cannot** reach the
builder, so R25's control is trivially satisfiable — but the comment would tell the next
engineer the opposite, so **the comment is corrected in the same commit as the constant**
or the trap survives the fix.

⭐ **What the builder's cap protects, measured:** `BuilderSheet.jsx:2155-2167` — it is a
**column-registration** bound (*"A script with forty plots is not a reason to register
forty columns on somebody's chart"*), and its acceptance condition is **"no silent
omission"** (`pickerNote` tells the member when it bites). It protects *registered
columns*, which hidden anchors are not.

## R26 — (j)'s RENDERER AUTHORISATION IS BOUNDED

**Authorised:** honouring `hidden`, drawing a fill between two plots, and a
**series-conditional** fill colour through the **smallest additive contract** (R10: no
second colour path; no second evaluator). The schema addition is **additive** with the
drift rail green and readers measured before the field lands.

### ⛔ 0.2.4 — RULING 1.2 DOES NOT BIND (j), AND HERE IS WHY

Verbatim (owner, 2026-09-12): *"a column offered under the script's title that is
actually the author's hidden `ohlc4` fill edge is a mistranslation wearing a label."*
Its two tests are **ANDed** — untitled **and** filled — and it governs what the door
**OFFERS and SELECTS as a column**. **(j) carries an anchor that is never selectable**
(`hidden: true`, `chooseOutput` already declines it). Carriage ≠ offer. ⭐ So this is
**one of R26's three authorised things by another name**, and (j) proceeds — with a
control asserting no hidden row is ever selected or offered.

## H.8 — LIVE-BAR VOLUME DIVERGENCE (recorded, **not built**)

The two live sources, by path: the pane's forming bar from
`api/routers/bars.py:464 _augment_daily_with_today` (**single-ticker** snapshot, ~8s
TTL) versus the screener's from `api/services/screener/scan_evaluator.py:1011`
(**all-tickers** snapshot, 30s shared cache). Same provider field, two endpoints, two
caches.

⛔⛔ **WHICH ONE TRADINGVIEW MATCHES IS NOT MEASURED, AND I WILL NOT GUESS IT.** No
fixture contains a developing bar and there is no screener-side bar array, so the
comparison cannot be made from committed data. The only measured venue effects are on
the **live** lane (`live_prices.py:207-210`, `min.av` over-states — NBIS 418k vs 330k;
`massive.py:891`, `day.v` is RTH-only), and neither settles the question.

⇒ **j.4's acceptance gains one line:** the live-bar comparison is **REPORTED per source
against TradingView's number, never asserted within tolerance**, until H.8 is ruled.
Wave 1's fixture is all sealed bars (last bar `2026-09-11`) and cannot cover it.

---

# ⭐⭐⭐ WAVE 2 GRAMMAR — CLOSE-OUT (2026-09-15)

## (a) – (j), each with its outcome and its ruling

| item | outcome | ruling |
|---|---|---|
| **(a)** | CLOSED | shapes foreclosed on the definition lane; the exact set routed to (c) |
| **(b)** | CLOSED — **retired** | time inputs; `input.timeframe` reachable **9**, under threshold |
| **(c)** | CLOSED **with its IR half owed** | definition-lane half BUILT (R18); IR half **BLOCKED-BY-ITS-OWN-GAP** → **H.6**, no estimate |
| **(d)** | CLOSED | d1′ + d2 BUILT; **d3 → H.7** |
| **(e)** | CLOSED — **retired on its numbers** | wrong in **0 of 20,954**; (A) 11 → `FOLD_BINARY`, (B) 0, (C) → (c) |
| **(f)** | CLOSED — **6 forms already ship** | "build" = keep and do not regress; 44 retire; 123 method-spelling uses → `pineObjects.js` |
| **(g)** | CLOSED — **premise false, sentence BUILT** | not a typing gap; the closing pass now reads the reason it recorded |
| **(h)** | CLOSED — **3 fields retire by name** | data-only; **BF.B routed OUT** with its reproduction |
| **(i)** | CLOSED — **no engine change owed** | one source sealed, two live; every fix routes out |
| **(j)** | **SCOPED, NOT STARTED** | 11 gaps; **STOP for the owner's go** — five ruling triggers |

## ⛔ THE OWED LIST — one table, nothing dropped

| owed | to whom | number |
|---|---|---|
| 13 `for … in` uses | R1 | 13 |
| function-parameter sources | R1 | recorded |
| UDT-field-access gap | **H.4**, with the loop-body note | 1 site (`…eqheql:135`) |
| accumulators / ceiling | R7 | 379 / 63 |
| `EXPR.TUPLE`, `STMT.FOR`, `STMT.WHILE`, `EXPR.ARRAY_OP` lowering | **the IR lowering programme** | 0 mentions in 3 files |
| d3 — what a *set* means | **H.7** | 112 / 53 / 184 / 38 / 26 |
| (e)(A) comparison folding | `FOLD_BINARY` | 11 |
| (e)(C) the UDF-parameter gate | **item (c)** | 110 fold / 1 not / 0 reach |
| (f) method spelling `tbl.cell(…)` | `pineObjects.js` | 123 |
| **BF.B** share-class normalisation | **symbol-resolution / ticker-search** | reproduction recorded |
| four renderings of today's volume | **UCT Terminal / charts** | 4 |
| two vendors in one `v` column | **bars / data platform** | — |
| the screener's second snapshot endpoint | **screener** | — |
| consolidated-vs-primary | **the owner's provenance decision** | already routed out |
| **(j)** j.1–j.5 | **the owner** | ~315 min, stop 630 |

⚠️ **Two hazards that are not defects yet, recorded so they are not rediscovered:** the
propagating `and` is **v6-incorrect by specification** with **73 of 269** corpus scripts
already on v6; and (b)'s `strip_pine`, now shared by four censuses, **blanks the newline
inside an unterminated quote** (4 of 269 files lose up to 26 lines).

## THE OWNER LIST

**H.4 · H.5 · H.6 · H.7 ruled** (this session). **New: (j)'s five ruling triggers.**
**Wave 1 PR:** branch `wave1/indicator-r0r1` pushed at `acdf93455`; ⛔ **not opened —
the browser has no viewport** (see SESSION-STATE). **3 merge conflicts** measured:
`binder.js`, `placement.js`, `docs/feature_flags.json`. **The capture (3A/3B) is owed**,
blocked by the same cause.

## THE VERIFICATION — three legs, three exit codes

| leg | result |
|---|---|
| **full vitest** | **EXIT 1** — 1,493 files / 21,497 tests · 11 failed in 8 files · **0 NEW** |
| **Python lane** (51 files **by name**) | **EXIT 0** — 1,589 passed, 13 skipped, 1 xfailed |
| **vite build** (alone) | **EXIT 0** — built in 34.48s |

⛔ **Every one of the 11 is attributed to the branch's own recorded baseline**
(`SESSION-STATE:458-466`), and the counts match it **exactly**: pre-existing HEAD trio
1+1+3 · `pollingSites` 1 (master's) · `tapFloor` 1 (Notebook's, rule 12) ·
`ChartDrawingOverlay.surfaces` 1 (master's) · `ThemeTrackerPage.chartmount` 2 (master's)
· `reachable` 1 (master's `focusDivergence`).

⚰️ **AND THE WRAPPER SAID EXIT 0.** The full run was launched with a compound command
ending in a `grep`, so the status reported back was **grep's**, not vitest's — the exact
defect this repo has recorded four times. The verdict above is read **from the log file**,
which says `11 failed`. The rule earned its fifth instance today.

**Moved artifacts, by name:** `27-support-resistance-channels.json` (2 lines, (g)'s
sentence on a real public script). **Unchanged:** `corpus_metric.json`,
`lookback_agreement.json`.

---

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

## ⛔⛔ THE CAPTURE IS STILL OWED — and the blocker is NOT the browser

**Attempt 2, 2026-09-14, with the owner's written authorisation for Browser 1.** The
browser was selected and the authorisation used. The capture stopped on a blocker
nobody had named, found *before* any browser was driven — which is why it cost minutes
rather than an hour.

**Preconditions, measured in order:**

| # | precondition | result |
|---|---|---|
| 1 | rig backend on 8129, `UCT_RIG_DATA` outside every worktree | ✅ **already running** — `boot_rig.py`, PID 18792, uptime 22 h. ⛔ **Started by an EARLIER session, so not this one's to stop**, and nothing was started or killed |
| 2 | the sandbox is the right one — content, never the port | ✅ `panetest@local.dev` (Pane Rig, admin); `/api/user-definitions` returns `u_3ec24af8e7c6`, one of the two documented ids |
| 3 | a **Clouds** definition exists to photograph | ⛔ **NO.** Both rig definitions have 4 plots — that is Uncharted **Volume v2**, Wave 1's target. Clouds has 23 outputs |

⭐ **BUILDING THE MISSING DEFINITION IS WHAT FOUND THE REAL BLOCKER**, and it took two
corrections that are worth keeping:

1. `memberPaneDefinition({source, id, name, translation})` **refused the lenient
   translation by name** — *"this verdict came from the screener lane, which answers a
   different question — a pane needs the host translation."* The two-lanes rule
   enforcing itself at the pane door, which is exactly where it should.
2. With the **host** lane it builds `ok: true` — and yields **2 plots, not 23**:
   `Fast MA` and `Slow MA`. The 21 layers are `hidden: 'author'` (`display=display.none`)
   and the pane filters hidden outputs out.

⛔ **SO A PIXEL COMPARISON TODAY WOULD MEASURE ITEM (j)'s GAP, NOT a6's CORRECTNESS.**
The vendor draws 2 MAs plus 20 translucent cloud fills; the hosted pane would draw 2 MAs
and no clouds, because the fills are chart-only notes and the layers are author-hidden.
That difference is **already known, already ruled (H.2, R11) and already recorded** —
photographing it would add a screenshot, not a fact.

### What the capture needs, and it is now (j)'s precondition rather than a6's

The capture becomes meaningful **once (j) renders the conditional fill**. At that point
it needs, in order: the rig backend (running); a Clouds definition installed from the
**host** translation; then Gate v2.1 on the driving tab — own-text `Add to chart`
**plus 0 studies** by the corrected probe, never "editor closed" — with the owner's
Pine Editor untouched; then vendor and hosted captures at Wave 1's tolerance, both
tables, the two mobile tiers.

⚠️ **Gate v2.1 was never reached and therefore never run**, so no gate counts are
reported. Claiming one would be inventing a measurement.

## ⛔ Attempt 1 — the browser was CONNECTED

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
