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
| **a4** | `for [i, x] in` over plan-time slots · `while` refused with its routing note · `for x in` over a series-sized source refused to item (c) | ⏳ **THIS SUB-STEP** |
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
