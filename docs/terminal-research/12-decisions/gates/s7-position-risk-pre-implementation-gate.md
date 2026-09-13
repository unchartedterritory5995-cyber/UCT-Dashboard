---
id: GATE-S7-POSITION-RISK
title: S7 trigger type — `position-risk` pre-implementation gate
role: the approval packet for the FOURTH absorption candidate. It is HALF an absorption and HALF a new capability, and §2 is the measurement that says which half is which. Nothing builds past the scope on an approval line.
status: ✅ CP1-CP2 APPROVED 2026-09-13. CP3, CP4 and the flip each need a new line.
date: 2026-09-12
measured_against: origin/master @ 6576f044e
pairs_with: PRD-S7, SPEC-S7 §5.2, s7-alerts-completion-plan.md §1 row 5 / §4, GATE-S12-ROLLOUT
confidence: high on the source readings (every claim below is quotable at file:line and was read from `api/**` on this tree); medium on the production flag state, which is a CLAIM INHERITED FROM `CLAUDE.md`'s 2026-08-09 live read and was NOT re-read this pass
evidence_ceiling: SOURCE ONLY. No production database was read, no Railway variable was read live, and no run was observed. Every population number in §7 is UNKNOWN.
---

# ✅ NOT APPROVED — `position-risk`

## ⛔ APPROVAL — this block is filled in by the OWNER, not the author

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-13
APPROVED AT SHA:  052d21475   (git hash-object of this packet as it stood at
                  approval, with this field blank)
SCOPE APPROVED:   CP1-CP2 ONLY.

                  CP1 = registration + params schema. No evaluator, no
                        delivery, no projection of member rows. Legacy shapes
                        REPORTED before the schema is pinned.

                  CP2 = a dark evaluator + a FORWARD-ONLY comparison harness
                        against HARNESS-ARMED predicates only. Never a replay.
                        Four outcomes - agreed / new_only / legacy_only /
                        not_comparable - never collapsed into a pass rate, and
                        `legacy_only` means an alert a member LOSES at the flip.
                        No delivery import. No legacy change.

                  ⛔ CP3 (projecting real member rows for the rollout:s7-dark
                     cohort) NEEDS A NEW LINE. So does CP4 and the flip.
```

⛔ **This packet's `_EXPECTED` step applies.** `tests/test_alert_taxonomy_filing_watch_parity.py`'s
control flips BY DESIGN when this type lands; it is updated **by naming, never by deleting the
assertion**, and steps 2 and 3 of its docstring stay deliberately undone for a CP1-CP2 type that
records no fire — with the reason written into the file, as for the three types before it.

### ⭐ H14 SETTLED THIS PACKET'S OPEN RULING BEFORE CP1 STARTED

§2.3 asked for a ruling on the placeholder-stop trap and said *"reuse the Awareness rule"* is not
yet an answer. It was right, and the reason is now measured: `awareness/rules.py`'s absolute `1e-9`
**missed the row that actually happened**.

H14 (`GATE-H14-PLACEHOLDER-STOP`, merged `94209e962`) unified **five** detectors — this packet
found three — onto `api/services/placeholder_stop.py::is_placeholder_stop` at
`max(0.001, |entry| × 1e-5)`. **So absorbing R1/R2 no longer inherits the trap; it inherits one
tested definition.**

⛔ **§3's condition still stands and is not softened by that.** `PARAMS_SCHEMA` must carry **no
field that encodes a placeholder verdict** — the verdict is now a shared function's answer, and a
predicate row that froze a copy of it would be the sixth detector wearing a schema.


⛔⛔ **NOTHING IN THIS PACKET IS AUTHORIZED.** No checkpoint below may be built, merged or
scheduled until the owner writes an approval line naming ONE of them. The block above is
deliberately blank: the author's own transcription of a directive is not a signature, and this
programme's binding constraint has always been *a second party recording approval*.

---

## 1. Does a legacy path exist? — **YES for two of the three severities, NO for the third**

⭐ **THIS IS THE PACKET'S FIRST FINDING AND IT CHANGES WHAT THE PACKET IS.** SPEC-S7 §5.2 pins
`position-risk` as `{severity: "stop_hit"|"stop_proximity"|"aggregate_heat", threshold_pct}` and
sources it from *"`awareness/rules.py:59-105` + `portfolio_heat.py`"*. Measured, those two sources
are not the same kind of thing:

| severity | legacy path | is there an ALERT today? |
|---|---|---|
| `stop_hit` | `api/services/awareness/rules.py:59` `rule_stop_watch` → `engine.py:269` → `_fire_candidate` (`engine.py:210`) | **YES** — in-app insight **and** email + Discord |
| `stop_proximity` | the same function, the `elif` at `rules.py:95` | **YES** — same two channels |
| `aggregate_heat` | `api/services/portfolio_heat.py:98` `portfolio_heat()` | ⛔ **NO. There is no alert, no schedule and no delivery.** |

**Measured** with a docstring-and-comment-stripped AST walk over `api/**` (method in §8): every
call site of `portfolio_heat(` is a **request-time read** —
`api/services/ai_search_personal.py:20`, `api/services/voice_tool_impls.py:1252`,
`api/services/journal_two/coach_chat_tools.py:842` — plus the module's own definition and its
sibling test file. **Nothing schedules it and nothing delivers from it.**

⛔ **SO `position-risk` IS TWO PACKETS WEARING ONE TYPE NAME.** `stop_hit` / `stop_proximity` are an
ABSORPTION and are governed by the §4a absorption default (legacy stays live, the new type runs
dark, the flip and the switch-off are one PR). `aggregate_heat` is a **NEW CAPABILITY**: there is no
incumbent to run dark against, no forward-only comparison to run, and the four outcomes are
undefined for it because `legacy_only` cannot occur.

⭐ **The recommendation this packet makes on that split:** pin all three severities in the schema at
CP1 (the F-S7-2 call — a schema that admits only what exists teaches the next engineer the narrow
shape is the whole shape), and **authorize an evaluator for the two absorbed severities only**.
`aggregate_heat` gets its own line, later, and its own gate — because "does the dark rule agree with
the legacy rule" is not a question that exists for it.

### 1a. What the legacy path is, precisely

| | |
|---|---|
| rules | `rule_stop_watch(scan_ctx, user_ctx)` — `api/services/awareness/rules.py:59-105`, a PURE function; no DB, no network |
| driver | `run_awareness_scan()` — `api/services/awareness/engine.py:257`, called at `engine.py:269` |
| schedule | `api/main.py:6630` — `_add_compass_job(_awareness_engine_scan, …)`, 20-min cadence, `max_instances=1` |
| gate | **DOUBLE.** `_add_compass_job` gates on `COMPASS_AUTOMATION_ENABLED`; the job body re-checks `AWARENESS_ENGINE_ENABLED` at `api/main.py:6614` and `engine.py:30` (`default "0"`) |
| population | `engine.py:44-47` — `SELECT user_id, symbol, side, entry_price, stop_price, source FROM j2_positions WHERE closed_at IS NULL`, ONE query for every user |
| price source | `engine.py:175-188` — the shared `live_prices` cache ONLY (`_px_cache` / `_px_key`). ⛔ **Never a per-position fetch** |
| in-app delivery | `voice_proactive_service.add_insight` (`:35`) — dedup, an 8/day cap (`:28`), a 6h per-(symbol, kind) cooldown (`:29`, `:87`) |
| away delivery | `engine.py:241` — `if importance >= _DELIVER_IMPORTANCE_FLOOR and candidate.symbol:` → `watchlist_alert_service.deliver_alert_payload` = in-app + email + Discord |
| durable row | ⛔ **NONE that S7 would recognise.** The insight lands in `voice_proactive_insights`; there is no `alert_fires` row and no receipt |

⚠️ **THE FLAG STATE IS NOT MEASURED IN THIS PACKET.** `CLAUDE.md` records a live read of
2026-08-09 showing `COMPASS_AUTOMATION_ENABLED=1` and `AWARENESS_ENGINE_ENABLED=1` on `web`. That is
**five weeks old and is a claim, not a measurement**. ⛔ Re-read both live before any line is
written — `catalyst-match` §8b is the standing example of a code default being mistaken for a
configuration, twice in one day.

---

## 2. ⛔⛔ F-S7-PR-1 — THE TRAP, STATED AS LOUDLY AS IT DESERVES

> **A broker import stores a PLACEHOLDER stop where `stop_price == entry_price`. Counting one as a
> real stop fires "at stop" on every broker position that is trading below its entry.**

The placeholder is written deliberately, and the writer says why in its own words —
`api/services/journal_two/broker/balances.py:431-433`:

```python
# stop_price column is NOT NULL; broker imports have no stop, so we
# store entry_price as a placeholder and the UI renders it as "—"
# for broker positions until the user sets a real stop.
```

### 2.1 The existing skip, quoted

`api/services/awareness/rules.py:74-75`, inside `rule_stop_watch`:

```python
if source == "broker" and abs(float(stop) - float(entry)) < 1e-9:
    continue  # placeholder stop -- nothing real to watch
```

and the function's own docstring (`rules.py:61-62`) names the writer:

> *"Skips broker carried-in positions whose stop is a NOT-NULL placeholder (stop_price==entry_price,
> source=='broker') -- see journal_two/broker/balances.py."*

### 2.2 ⛔⛔ THERE ARE **THREE** PLACEHOLDER DETECTORS AND THEY DO NOT AGREE

This is the finding. `portfolio_heat.py` detects the same placeholder and **its comment says why the
form `rules.py` uses is a trapdoor** — `api/services/portfolio_heat.py:20-32`, verbatim:

```
# Broker imports store `stop_price = entry_price` as a placeholder because the
# column is NOT NULL and the broker doesn't report a stop. Detecting that is
# SAFETY-CRITICAL: a placeholder counted as a real stop reads as 0 risk, which
# under-reports portfolio heat and can green-light an over-cap add.
#
# It used to be `stop == entry` — exact float equality. That happens to hold
# today because the placeholder is a straight COPY of the same stored float,
# but it is one refactor away from silently failing: any path that recomputes
# rather than copies (a currency/unit conversion, a round-trip through a
# calculation, a different provider's rounding) leaves the two a few ULPs apart
# and the guard stops firing — with NO error, just quietly under-reported heat.
# A relative tolerance costs nothing and removes that trapdoor.
_PLACEHOLDER_STOP_REL_TOL = 1e-9
```

⭐ **`awareness/rules.py:74` still carries the form that comment describes as one refactor from
silent failure**, and it is stricter still — an ABSOLUTE `1e-9`, where `portfolio_heat` uses a
RELATIVE one. And the WRITER has a third definition, added *after the drift actually happened*
(`balances.py:446-461`):

```
# Broker imports seed stop_price = entry_price as the "no stop
# set" placeholder. When a later sync refreshes entry_price and
# leaves the old placeholder behind, the two drift by rounding
# (ORCL: entry 126.0049 vs stop 126.005) and every placeholder
# detector downstream — UI blanking, risk/heat exclusion,
# portfolio_heat's safety rail — silently stops firing.
```

```python
stop_is_placeholder = (
    prior_entry is not None and prior_stop is not None
    and abs(float(prior_stop) - float(prior_entry))
    <= max(0.001, abs(float(prior_entry)) * 1e-5)
)
```

**The three predicates, run against the same rows (measured, not reasoned):**

| case | `rules.py:74` | `portfolio_heat:35` | `balances.py:457` |
|---|---|---|---|
| ORCL drift, the case `balances.py:449` names — entry `126.0049`, stop `126.005` | **False** | **False** | True |
| exact copy — `126.0049` / `126.0049` | True | True | True |
| a $1000 name 1e-6 apart | **False** | True | True |
| a MANUAL position with `stop == entry` | **False** (source gate) | True | True |
| a broker row with `stop = 0.0` | **False** | True | **False** |
| **CONTROL** — all three on an exact broker copy | True | True | True |

⛔ **AND HERE IS WHAT THAT COSTS ON THE ORCL ROW.** With the drift present and the position 0.5%
below entry (LONG, price 125.40), `_stop_distance_pct` (`rules.py:51-56`) returns **-0.004825**,
which is `<= 0`, so `rules.py:83` emits `stop_hit` — `base_signal=1.0`, `personal_multiplier=1.3`,
`urgency=2.0`, clamped to **importance 10** by `compute_relevance_score` (`rules.py:39-45`) — and
importance 10 with a symbol clears `engine.py:241`, so it **away-delivers by email and Discord**.

⚠️ **The writer has since repaired the drift in lockstep** (`balances.py:472` / `:490`, on the two
branches that refresh `entry_price`), so a drifted row heals at the next sync that touches entry.
The window is bounded, not closed — and the detector S7 is told to reuse is the one that would not
have seen it.

### 2.3 ⭐ THE RULING THIS ASKS FOR — and why "reuse the Awareness rule" is not yet an answer

The completion plan §4 says: *"The Awareness Engine already solves this — reuse its rule, do not
re-derive it."* ⛔ **Measured, there is no "its rule" to reuse — there are three, and the one in
`awareness/rules.py` is the weakest of the three.** "Reuse" and "re-derive" are not the only two
options; the third is **derive ONE and make the other two read it**, which is
`lesson_a_second_authority_over_one_value` applied to a safety guard.

**What this packet recommends the owner rule on, at CP2 (NOT at CP1):**

> ⛔ **ONE placeholder predicate, in one module, read by all three call sites** — the
> `portfolio_heat` form (relative tolerance, non-positive stop, missing stop) is the strongest of
> the three and is already the SAFETY-CRITICAL one; the writer's looser `max(0.001, 1e-5)` is a
> WRITE-side repair threshold and is a different question from a READ-side "is this real". A change
> to `awareness/rules.py` is member-affecting (it changes which alerts a member gets) and is
> therefore a §2b separate PR under its own line, never bundled with S7 work.

---

## 3. ⛔ CAN CP1 BE WRITTEN WITHOUT DECIDING IT? — **YES, WITH ONE CONDITION**

**Yes.** CP1 is registration plus a params schema. The placeholder question is an EVALUATOR
question: it decides which rows produce a candidate, and CP1 has no evaluator.

⛔ **The condition, and it is the whole answer:** CP1's `PARAMS_SCHEMA` must carry **no field that
encodes a placeholder verdict** — no `stop_is_real`, no `has_real_stop`, no `source` filter with a
default. Pinning any of those silently chooses one of the three definitions and makes it the
type's specification, which is exactly how `catalyst-match` §8b's dedup collision was nearly
absorbed as a spec. A field naming the position's `source` is fine (it is a fact about the row);
a field naming whether its stop is REAL is a verdict and belongs to CP2's ruling.

---

## 4. What CP1 would be — REGISTRATION + PARAMS SCHEMA ONLY

*(Not authorized. Written so an approval line can name ONE checkpoint.)*

**CP1 — `position-risk` registration.**

1. `api/services/alert_taxonomy/position_risk.py` — `TYPE_ID`, `PARAMS_SCHEMA`, `register()`,
   mirroring `document_arrival.py`'s shape exactly. **No evaluator. No delivery. No read of
   `j2_positions`. No scheduler entry.**
2. `PARAMS_SCHEMA` pins **all three** severities — `stop_hit`, `stop_proximity`, `aggregate_heat` —
   with `aggregate_heat` recorded in the module docstring as **UNPOPULATED AND UNREACHABLE**, citing
   §1's measurement. Same call F-S7-2 and F-S7-EP-1 made, for the same reason.
3. `threshold_pct` pinned, and `NEAR_STOP_PCT = 0.03` (`rules.py:48`) recorded as the legacy
   constant, **derived by AST from `rules.py`, never hand-typed** — the `price-level` CP1 idiom.
4. A rail asserting the severity vocabulary is derived from `rule_stop_watch`'s own `kind=` literals
   (`"stop_hit"`, `"stop_proximity"`), so a fourth kind added there goes red here.
5. The parity control at `tests/test_alert_taxonomy_filing_watch_parity.py:621` updated **by naming**
   — see §6.
6. F-S7-PR-1 recorded in SPEC-S7 at the point of use (§5.2's `position-risk` row), including the
   three-predicate table.

⛔ **Explicitly NOT in CP1:** no evaluation loop, no `delivery.py` call, no read of `j2_positions`,
no change to `awareness/**`, no scheduler entry, no placeholder ruling.

**CP2 — dark evaluator + FORWARD-ONLY comparison harness, harness-armed predicates ONLY.**
The four outcomes are `agreed` / `new_only` / `legacy_only` / `not_comparable`, never a pass rate;
`legacy_only` is an alert a member LOSES at the flip. ⛔ **No replay, ever** — and this type's own
reason is the fourth distinct one the programme has met: **the legacy rule reads a LIVE PRICE CACHE
that keeps no history** (`engine.py:183-188`), so "would it have fired on Tuesday" has no input.
A price the cache did not hold is not a "no" — see §5 item 7.

**CP3 — projection of real member rows, `rollout:s7-dark` cohort ONLY, still dark.**
⛔ The cohort is S12's tag, read through `api/services/rollout.py:100` `cohort_user_ids(S7_DARK)` —
**never a role check**; the role checks were deleted and `rollout.py:29-38` rules that an empty
cohort means NO MEMBERS and never a fallback to admins.

**CP4 — all members, still dark.** A tag assignment (`rollout.py:258` `seed_cohort_all_members`),
not a code path.

**FLIP — its own line, and it is not CP4.** The flip is **delivery plus the legacy switch-off, in
the same PR**, and for this type the legacy switch-off is a change to `awareness/rules.py`, which is
member-affecting under ruling 2b.

⭐ **Each checkpoint is named so an approval line can name exactly one.**

---

## 5. ⛔ WHAT ABSORBING R1/R2 WOULD INHERIT — the full list, from source

Eight things. Every one of them is behaviour a member sees, and every one is invisible in the type's
name.

1. **The placeholder skip, and WHICH of the three definitions.** §2. Also inherited: the
   `source == "broker"` half — a MANUAL position a member saved with `stop == entry` is **not**
   skipped and fires `stop_hit` immediately. That is arguably correct (the member typed it) and it
   is a decision nobody has recorded.
2. **The shared 8/day insight cap** (`voice_proactive_service.py:28`), which is global across ALL
   insight kinds. A busy morning's stop-watch insights can exhaust it and silently drop that day's
   `daily_focus`. Absorbing the rule without the cap changes what a member receives on a busy day.
3. **The 6h per-(symbol, kind) cooldown** (`voice_proactive_service.py:29`, `:87-95`) and the
   namespacing that makes `stop_hit` and `stop_proximity` independent — `rules.py:92-93` explains
   it in the code's own words: *"an earlier 'nearing stop' warning must never swallow the
   THROUGH-the-stop escalation."* ⭐ **That guard is correct and must survive absorption intact**,
   and it now lives in `add_insight`'s `(symbol, kind)` key, NOT in the `dedup_key` the rule
   computes — `engine.py:220-224` records the move.
4. **The away-delivery gate is `importance >= 8 AND candidate.symbol`** (`engine.py:241`). Because
   `stop_hit` always scores 10 and always carries a symbol, **every stop breach already emails and
   Discords the member.** An S7 flip that routed `position-risk` through per-type channel defaults
   would be changing a live delivery rule, not preserving one.
5. **The score ceiling.** `compute_relevance_score` clamps to 10, so a proximity warning and an
   actual breach can both arrive at importance 10 — `CLAUDE.md` records the consequence: *"consumers
   should key severity off `kind`, not `importance`."* An S7 receipt that carried only a severity
   score would lose the distinction.
6. **`j2_positions` is the population, read straight from `auth.db`** (`engine.py:44-47`), not
   through a service. A projection must read the same rows or it is measuring two populations.
7. ⛔⛔ **THE SILENT BLIND SPOT, AND IT IS THE ONE THAT WILL CORRUPT THE COMPARISON.**
   `rules.py:77-79`: `price = live_prices.get(sym)` … `if not price or price <= 0: continue`. A
   symbol the shared cache did not hold that cycle is **skipped with no record**. To the legacy rule
   that is indistinguishable from "not at stop", and to a naive harness it would read as `agreed`
   when in fact **neither side evaluated anything**. ⭐ **CP2's harness MUST classify a
   missing-price tick as `not_comparable`, never as agreement**, and must print the count — this is
   the `NO DATA` vs `QUIET` distinction one layer down.
8. **The regime component's failure domain.** `_compute_regime_component` (`engine.py:135-167`) is
   isolated so a regime failure cannot abort stop-watch. An absorption that put the two types on one
   evaluator would re-couple them; the comment at `engine.py:140-147` is the record of why that
   coupling was removed.

---

## 6. ⛔⛔ THE SERIALIZER — `_EXPECTED`, and it flips BY DESIGN

`tests/test_alert_taxonomy_filing_watch_parity.py:621`:

```python
_EXPECTED = {"document-arrival", "price-level", "event-proximity", "catalyst-match"}
```

`_declared_trigger_types()` (`:549-562`) reads every module-level `TYPE_ID = "..."` in
`api/services/alert_taxonomy/` **from the AST — never a grep, never a hand-typed roster** — and the
assertion at `:633` requires the declared set to EQUAL `_EXPECTED`. **Registering `position-risk`
turns that test RED, and the red is the rail working.**

⛔ **The docstring's steps, reproduced from `:577-583`, before the line may be updated:**

> 1. Add the new type to `_EXPECTED` below.
> 2. Give `alerts._s7_durable_alerts` a reconstruction branch for it — without one its fires are
>    silently dropped from the member's feed (proved by the sibling test below).
> 3. Re-run the three observable classes above against the new type's own fixture event, and re-run
>    the mutation proof.

⚠️ **A drift worth recording rather than silently fixing:** the docstring numbers **three** steps;
the failure message at `:636-637` says *"see this test's docstring for the four steps"*. The list is
the authority; the count is what drifted — the same shape as the COT router's "4 routes" beside five.

**Step 2 is measured, not assumed.** `api/services/alerts.py:142-165` — `_s7_durable_alerts`
dispatches on `trigger_type` with **exactly one branch** (`:160`, `document-arrival`), and
`:157-159` says so:

> *"Dispatch by trigger_type -- document-arrival is S7's only live trigger today; add a branch here
> when a second type ships rather than generalizing a reconstruction contract nothing else needs
> yet."*

`test_the_feed_bridge_silently_drops_a_trigger_type_it_has_no_branch_for` (`:641`) demonstrates the
hazard rather than asserting it in prose: a fire of any other type produces **no feed row and no
error**.

⛔ **For `position-risk`, step 2 becomes a PRECONDITION at CP3, not a follow-up** — the moment a
projection writes a real fire for a real member, a missing branch means that member is simply never
told. At CP1–CP2 there is no fire to reconstruct, and that is the reason step 2 may stand undone,
recorded here so it is a decision rather than an oversight.

---

## 7. ⛔ WATCH-COVERAGE CLASSIFICATION — INERT STRANDS, and what they constrain

Measured by importing `reachable_paths(root)` and `watched_paths(root)` from
`tools/flow_worker_watch_coverage.py` with an EXPLICIT root (no git). Totals this tree:
**reachable = 154**, **watched = 24**. Control: `api/flow_worker_main.py` is in the reachable set;
a module known to be outside it (`api/services/awareness/engine.py`) is not.

| module | reachable by flow-worker | on its watch list | classification |
|---|---|---|---|
| `api/services/awareness/rules.py` | **no** | no | outside — no constraint |
| `api/services/awareness/engine.py` | **no** | no | outside — no constraint |
| `api/services/portfolio_heat.py` | **no** | no | outside — no constraint |
| `api/services/alert_taxonomy/registry.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/alert_taxonomy/receipts.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/alert_taxonomy/delivery.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/alert_taxonomy/db.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/alerts.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/watchlist_alert_service.py` | **yes** | no | ⛔ **INERT STRAND** |
| a NEW `alert_taxonomy/position_risk.py` | **no** (nothing imports it until `register()` is wired) | no | outside — until CP3 |

The path is traced, not assumed — flow-worker reaches `alerts.py` as
`flow_worker_main → auth_surface_check → flow_proxy → auth_service → auth_db → journal_two.db →
journal_two.notes → ticker_meta → groups → groups_gates → screener.snapshot_db → screener.live_tier
→ screener.technicals → indicator_compute → ast_interpret → scan_definition → user_definitions →
alert_rev_migration → watchlist_alert_service → alerts`, and `alert_taxonomy.registry` one hop
further through `alert_taxonomy.document_arrival`.

**What this constrains, per checkpoint:**

- **CP1 and CP2 are clean.** A new module nothing imports is outside the closure, and the parity
  control lives in `tests/`, which flow-worker does not run. Nothing is stranded.
- ⛔ **CP3 is the checkpoint that strands something**, because wiring `register()` means the new
  module enters the closure through `alerts.py`/`registry.py`, and **flow-worker will run it without
  redeploying for it.** That is the same call `price-level` CP3 made with a marker bump. It must be
  a stated line item, and it must be classified at review time by running
  `python tools/flow_worker_watch_coverage.py` — a red there is a REVIEW GATE per
  `docs/runbooks/deploy-windows.md`, not a block.
- ⛔ **The §2.3 one-placeholder-predicate change is NOT stranded** (`awareness/**` and
  `portfolio_heat.py` are outside the closure) — which is a reason to do it as its own PR and not
  inside a checkpoint that is.

---

## 8. Method — how everything above was measured

- **CODE, NEVER PROSE.** Every literal search ran over source with docstrings and comments removed:
  each file parsed with `ast`, every string-only `Expr` statement blanked, `ast.unparse` re-emitted
  (which drops comments for free). **1,213 files under `api/` parsed, 0 unparsable.**
  **CONTROL:** a sentence that exists only in a module docstring
  (`"a trader would act on it"`, `scan_store.py`) is found in **1** raw file and in **0** stripped
  files, while a real code token (`def record_hits`) is still found. The stripper removes prose and
  still sees code.
- **Reachability** — `reachable_paths(root)` / `watched_paths(root)` imported from
  `tools/flow_worker_watch_coverage.py` with an explicit root; no git invocation.
- **The three-predicate table in §2.2** was produced by executing the three predicates as written,
  on the named inputs, with a control case on which all three must agree.
- No git command was run and no SHA was verified in this packet. `b9783d509` / `ffa8102c7` /
  `6576f044e` appear here only as caller-supplied identifiers.

---

## 9. ⚠️ WHAT COULD NOT BE MEASURED — stated where it bites

1. **Both awareness flags' LIVE values.** §1a. Everything about whether R1/R2 are *running today*
   rests on a five-week-old reading recorded in `CLAUDE.md`.
2. **How many `j2_positions` rows are broker imports, and how many carry a placeholder stop.**
   No production database was read. **The blast radius of F-S7-PR-1 is therefore UNKNOWN** — the
   mechanism is proved, the population is not.
3. **Whether any drifted placeholder exists today.** The ORCL case is quoted from the writer's own
   comment; whether such a row is on the volume right now was not checked.
4. **How often `live_prices` misses a held symbol** — item 7 of §5 is a structural blind spot whose
   frequency decides whether the CP2 comparison has enough comparable ticks to say anything.
5. **`voice_proactive_insights` row counts** — so nothing here can say how close a real member gets
   to the 8/day cap.

⛔ Each of these is one read-only query or one `railway variables --kv` away, and **none of them was
performed**. A CP2 approval that assumes any of them is assuming.
