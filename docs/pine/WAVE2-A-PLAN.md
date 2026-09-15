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
