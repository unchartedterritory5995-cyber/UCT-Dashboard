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
| **a4** | **REVISED BY R1/R2** — no new iteration form is built. Every retired loop form (`for x in`, `for [i, x] in`, `while`) refuses **at its own line**, with the code its SOURCE determines, replacing today's `pine:block` note plus a later unrelated `array.get` refusal | ⏳ **THIS SUB-STEP** |
| **a4b** | **the accumulator fold** — a counted-`for` body of the shape `s := s op e` folds to a left-nested op chain | ⛔ **CENSUS FIRST, THEN A GO** — ruling R3 |
| **a5** | reductions unrolled over written slots, each checked against Pine's `na` semantics, with the source recorded | ⛔ **SCOPE AWAITING OWNER CONFIRMATION** — see below |
| **a6** | Clouds verbatim on both lanes with colours intact; metric re-derived; movers named; screener comparability checked; then the Clouds vendor capture in Chrome | pending |
| **a7** | shared contract, Python twin, both-lane agreement rail over 327 scripts, snapshots, suites, Python lane once, vite build | pending |

### ⛔ a5's scope is NOT settled, and the gap is named rather than guessed

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

**As ruled:** Clouds' 21 `pine:collection` refusals clear, and the next refusal names
`color.t` at line 90.

**First half: green.** Clouds translates on both lanes — `ok=true`, 0 refusals, 23
outputs, none folding to `na`.

**Second half: landed as a NOTE, not a refusal**, and that is reported rather than
forced. `color.t` at 90 binds `bullUserTransparency`, which no output path reads, so the
env closing pass resolves it once and records `pine:colour-value @90`. Making it a
refusal would cost the closing pass's restraint — an unread-but-**readable** binding
stays silent, which is what stops a note appearing for every `len = 14` in every script.
⛔ **Owner ruling pending.** Recorded in the open-findings list, not resolved here.

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
