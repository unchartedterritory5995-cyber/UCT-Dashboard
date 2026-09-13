---
id: GATE-S7-INDICATOR-CONDITION
title: S7 trigger type — `indicator-condition` pre-implementation gate
role: the approval packet for the type sequenced behind D2. Its gate has THREE clauses (s7-alerts-completion-plan.md §2b); §2 measures that clauses 1 and 2 are now SATISFIED and makes clause 3 a CP1 deliverable. The undeclared-cadence question in §4 is the sharpest design question in the four S7 packets written today.
status: ✅ CP1-CP2 APPROVED 2026-09-13. CP3, CP4 and the flip each need a new line.
date: 2026-09-12
measured_against: origin/master @ 6576f044e
pairs_with: PRD-S7, SPEC-S7 §5.2, s7-alerts-completion-plan.md §2b / §1 row 3, PRD-D2 §7 / §9, GATE-D2-CANONICAL-DATA-MODEL (CP1 + CP2), GATE-S12-ROLLOUT
confidence: high — every claim is quotable at file:line and was read from `api/**` and `api/data/**` on this tree; the address-book numbers were computed by loading the JSON, not read from a document
evidence_ceiling: SOURCE ONLY. `auth.db` was not opened, no Railway variable was read live, and no evaluator cycle was observed. `indicator_alerts` and `indicator_alert_fires` row counts are UNKNOWN except as reported in prose by the code's own comments.
---

# ✅ NOT APPROVED — `indicator-condition`

## ⛔ APPROVAL — this block is filled in by the OWNER, not the author

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-13
APPROVED AT SHA:  3460a279b   (git hash-object of this packet as it stood at
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

### ✅ CLAUSES 1 AND 2 OF THE §2b GATE ARE SATISFIED — CLAUSE 3 IS CP1's DELIVERABLE

D2 CP1 merged (`b9783d509`); D2 CP2 (`ffa8102c7`) gave the book its first non-screener store —
`bars_sqlite`, five metrics `ohlcv.o/h/l/c/v`, `authority: "authoritative"` per PRD-D2 §7. The book
now holds 142 metrics.

⛔ **Clause 3 — cadence GATES the predicate at registration — and the answer to the undeclared
cadence is REFUSE, naming the axis.** Not intraday (admits a predicate that can never fire, with
reassurance attached). Not nightly (asserts something false about a continuously-written store, in
the field `cadence_ceiling` reasons about). Refusal is the only branch that keeps *"we could not
compute it"* distinct, and it matches `address_book.py`'s own contract: *"THIS MODULE ANSWERS OR
SAYS IT CANNOT. It never defaults."*

⭐ **And the harder half the question did not contain:** for `bars_sqlite`, cadence is a property of
the **(metric, timeframe) PAIR**, not of the metric — `ohlcv.c` on a 5-minute bar and on a daily bar
have different cadences, and the alert row carries `tf` NOT NULL. **The gate must resolve the
ADDRESS, not the metric.**

⚠️ **Honest consequence, accepted on this line: at CP1 every `ohlcv.*` predicate REFUSES**, because
the declaration that would give bars a per-timeframe cadence cannot ship — `bars_sqlite.py` is
reachable-but-unwatched, which is exactly why D2 CP2 refused the same edit (F-D2-2). That is the
correct dark state, not a gap.


⛔⛔ **NOTHING IN THIS PACKET IS AUTHORIZED.** No checkpoint below may be built, merged or
scheduled until the owner writes an approval line naming ONE of them. In particular §4's answer to
the undeclared-cadence question is a RECOMMENDATION, not a ruling.

---

## 1. Does a legacy path exist? — **YES, AND IT IS THE LARGEST OF THE FOUR**

| | |
|---|---|
| CRUD + state machine | `api/services/indicator_alert_service.py` (1,614 lines) |
| evaluator | `api/services/indicator_alert_evaluator.py` (2,630 lines) |
| durable fires | `indicator_alert_fires`, declared at `api/services/alert_fired_log.py:138-158` |
| the alert row | `indicator_alerts`, declared at `indicator_alert_service.py:88-103` + **9 ALTER migrations** (`:115-183`) |
| driver | `indicator_alert_evaluator.start_evaluator(interval_sec=60)` — `api/main.py:3275`, **its own daemon thread, started at boot, UNCONDITIONALLY** (no flag) |
| delivery | `watchlist_alert_service` — bell + email + Discord + browser notification + sound (`indicator_alert_service.py:4-6`) |
| member door | `api/routers/indicator_alerts.py`, mounted at `api/main.py:7904` |

### 1a. The fire ledger, quoted — because S7's `alert_fires` must be diffed against it

`alert_fired_log.py:138-158`:

```sql
CREATE TABLE IF NOT EXISTS indicator_alert_fires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  sym TEXT NOT NULL,
  indicator TEXT NOT NULL,
  condition TEXT NOT NULL,
  tf TEXT NOT NULL,
  fire_key TEXT NOT NULL,
  bar_time INTEGER,
  value REAL NOT NULL,
  threshold REAL,
  fired_at REAL NOT NULL,
  delivered_at REAL,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  delivery_failed_at REAL,
  delivery_error TEXT,
  delivery_channels TEXT,
  channels_failed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(alert_id, fire_key)
);
```

⭐ **`UNIQUE(alert_id, fire_key)` IS THE FIRE-ONCE GUARD AND THE HISTORY AT THE SAME TIME**, and the
module docstring says why in one sentence (`indicator_alert_service.py:21-26`):

> *"an alert delivers if and only if `alert_fired_log.record_fire` lands a NEW row, and the key that
> row is unique on is the alert's ARMED EPISODE (level conditions) or its BAR (cross conditions).
> The history and the fire-once guard are the same object, so a history that says 'one fire' and a
> member who got five is not a state this system can be in."*

⛔ **AN ABSORPTION INHERITS THAT IDENTITY, NOT JUST THAT TABLE.** S7's `alert_fires` is a separate
durable row; if the dark evaluator computes a different `fire_key` the comparison is measuring two
key functions, not two rules. The `fire_key` derivation is the first thing CP2's mirror must be
railed against — the `catalyst-match` CP2 idiom of driving the REAL function with delivery stubbed.

### 1b. The 2026-08-08 closed-bar cutover is live and is a comparison hazard

`indicator_alert_service.py:11-19` records a defect this lane already paid for: level conditions
re-delivered *"on every 60-second poll for as long as the condition stayed true"*, priced at
**373,748 of 388,808 fires (96.1%)**. The fix is the fired-log key above, plus a five-state machine
(`ALERT_STATES`, `:61-62`) — `armed` / `fired` / `snoozed` / `needs_attention` / `error`.

⛔ **`eval_mode()` is read AT CALL TIME and is rollback-able with no deploy** (`api/main.py:5032-5036`
records the correction: *"Read the running answer from `GET /api/indicator-alerts/latency`, never
from this comment"*). **A dark comparison whose two sides straddle a mode change is measuring the
mode.** CP2 must stamp `eval_mode()` on every comparison span and reset the clock when it moves —
the anchor-move reset, in this type's own vocabulary.

---

## 2. ⛔⛔ THE THREE-CLAUSE GATE (completion plan §2b) — CLAUSES 1 AND 2 ARE NOW SATISFIED

The plan's gate, verbatim:

> 1. D2 CP1 merged — ✅ done; and
> 2. the address book's metric axis covers **at least one store that is not `screener_rows`**, with
>    that store classified in PRD-D2 §7; and
> 3. `cadence` GATES THE PREDICATE at registration.

### Clause 1 — ✅ SATISFIED. D2 CP1 merged (`b9783d509`).

Recorded in `GATE-D2-CANONICAL-DATA-MODEL` line 1. ⚠️ The SHA is caller-supplied; no git command was
run in this packet.

### Clause 2 — ✅ SATISFIED **TODAY**, by D2 CP2 (`ffa8102c7`). Measured, not quoted.

Loaded `api/data/canonical_address_book.json` (48,329 bytes, `schema_version: 1`,
`generated_by: tools/build_canonical_address_book.py`) and counted:

```
metrics                       142
  screener_rows               137     cadence nightly, grain date, 137/137
  bars_sqlite                   5     ohlcv.o  ohlcv.h  ohlcv.l  ohlcv.c  ohlcv.v
axis_report.cadences          {"nightly": 137, "(undeclared)": 5}
axis_report.grains            {"date": 137, "(undeclared)": 5}
stores.bars_sqlite.authority  "authoritative"
stores.bars_sqlite.row_projection  ["ts", "o", "h", "l", "c", "v"]
stores.bars_sqlite.undeclared_by_this_store  ["cadence", "grain", "sentence"]
```

**The non-screener store is `bars_sqlite`, it carries five metrics, and it is classified
`authoritative`** — which matches PRD-D2 §7's own row: *"`bars.db` (`bars_sqlite`) | OHLCV per
(ticker, tf, ts) | **AUTHORITATIVE for bars**, with a locked invariant: newest bar wins per
(ticker, tf, ts) on EVERY path."*

⭐ **So the dependency the completion plan recorded as the reason `indicator-condition` waits is now
two-thirds discharged, and it was discharged on the same day this packet was written.** The type is
no longer blocked on D2; it is blocked on clause 3, which is S7's own work.

### Clause 3 — ⛔ NOT SATISFIED, AND THIS PACKET MAKES IT A **CP1 DELIVERABLE**

Nothing gates a predicate on cadence anywhere. Measured: `cadence` appears in
`scan_evaluator.py` (the `cadence_ceiling` machinery, `:678-706`) and in `ast_freshness.py`, and in
neither `indicator_alert_service.py` nor `indicator_alert_evaluator.py`. The plan states the cost
plainly (§2b item 3):

> *"A predicate asking a `cadence: nightly` metric to answer an intraday condition registers
> cleanly, evaluates cleanly, and **never fires** — and nothing distinguishes it from a condition
> that simply has not been met. An alert that cannot fire and an alert that has not fired look
> identical to a member, and the member is the one holding the position."*

---

## 3. ⭐ THE PRECEDENT CLAUSE 3 SHOULD BE BUILT ON ALREADY EXISTS — in the legacy module

⛔ **Do not invent a registration gate. There is one, it is exactly this shape, and it is one
function.** `indicator_alert_service.refusal_for(indicator, condition, tf, threshold)` —
`:1298-1299` — whose docstring's first line is:

> *"Why this alert could NEVER fire, or `None` if it could."*

It ships **three** gates today (`:1325-1358`), and the second is the closest possible analogue of a
cadence gate — an intraday-only series armed on a calendar bar (`:1332-1338`):

```python
if address in instant_only_addresses() and code in ev._CALENDAR_TFS:
    ...
    return (f"{label} {REFUSAL_INTRADAY_ONLY}. A {code} bar is stored under a "
            f"calendar date where this series needs a clock instant, so its "
            f"whole column is withheld and no number is ever produced — on "
            f"the live lane and on the closed one. Arm it on one of {intraday}.")
```

Two properties of that gate are load-bearing and must be copied, not re-invented:

1. ⛔ **It lives on the ROUTER path, not in `create()`.** `refusal_for`'s own docstring
   (`:1312-1316`): *"`create()` IS DELIBERATELY NOT GATED. Thirty-one soak rows are armed on
   production and `tools/alert_soak_matrix.py --arm` must stay idempotent; a guard inside the writer
   would change what an internal tool and every existing row can do, when the gap being closed is
   the *API* surface."*
2. ⛔ **Every refusal fragment is pairwise distinct, and that discipline is already asserted in this
   lane.** `indicator_alert_evaluator.py:1710-1716` records why, about the sibling ledger door:
   two gates once shared the phrase *"forming-bar fires are not ledger-grade"*, so a
   `pytest.raises(match=…)` **still matched with the mode lock deleted** — the test would have
   passed on a tree with the safety removed.
   `test_every_ledger_refusal_fragment_names_exactly_one_gate` is the rail there, and a cadence
   refusal needs its own equivalent. ⚠️ `refusal_for`'s own three fragments are module-level
   constants — `REFUSAL_UNJUDGEABLE_CONDITION`, `REFUSAL_INTRADAY_ONLY`, `REFUSAL_NO_LEVEL` (plus
   `CLOSED_LANE_TRAILING_PAD`) — and a fourth must be distinct from all of them.

⚠️ **AND THE UNGATED WRITER IS ITSELF A FINDING.** `indicator_alert_evaluator.ledger_timeframe`'s
docstring (`:1764-1767`) states it flatly: *"The create path validates nothing, so `tf` can be any
string a client sent."* A cadence gate on the router therefore constrains the API surface and
**nothing else** — the 31 production soak rows and any internal tool bypass it by construction.
That is the right trade and it must be written down, not discovered.

---

## 4. ⛔⛔ THE UNDECLARED-CADENCE QUESTION — the sharpest design question in these four packets

> **What must a predicate registration do when the metric it names has `cadence: null`?**

It is not academic: **the ONLY non-screener metrics in the book — the five the type actually needs —
are exactly the ones with no declared cadence.**

### 4.1 Why they are null, and why that is deliberate

D2 CP2 ruled it (GATE-D2 §CP2.4, *"THE BOOK RECORDS WHAT THE STORE DOES NOT DECLARE AS `null`, NEVER
AS A DEFAULT"*):

> *"Defaulting the bars store to `cadence: "nightly"` — the only value in the book today — is a
> one-word change that would make a continuously-fetched store look like a batch one, in the very
> field `scan_evaluator.cadence_ceiling` reasons about. 'We could not compute it' and 'nightly' are
> different facts, and a book that cannot say the first one is not worth reading."*

CP2's mutation **D** is *"drop the `null`-preserving branch so an undeclared cadence takes a
default → RED"*. And the accessor module is built the same way — `address_book.py:15`:
*"⛔⛔ THIS MODULE ANSWERS OR SAYS IT CANNOT. It never defaults."* — with `row_position` returning
`None` *"never 0, never -1"* on any doubt (`:100-112`).

### 4.2 ⛔ THE ANSWER: **REFUSE, AND NAME THE UNDECLARED AXIS.** Not intraday. Not nightly.

**It is not "assume intraday."** That admits the predicate, and then the member holds an alert whose
*cannot fire* is indistinguishable from *has not fired* — the §2b defect, reached one step later and
with a false reassurance attached.

**It is not "assume nightly."** That refuses every bar-metric predicate — i.e. refuses the ONLY
store this type has — and it does it by asserting something false about a continuously-written
store, in the field `cadence_ceiling` reasons about. It is also the *comfortable* wrong answer,
because it fails safe and looks conservative.

**It is REFUSE, with the reason naming the axis, and the fix being a DECLARATION rather than a
default:**

> ⛔ **A predicate naming a metric whose resolved cadence is undeclared is REFUSED AT REGISTRATION,
> with a message that says *the store declares no cadence for this metric* and names
> `stores.<store>.undeclared_by_this_store`. The repair is to declare it at the source the builder
> derives from — never to supply a fallback at the alert layer.**

Three reasons, in order of weight:

1. **A fallback at the alert layer is a SECOND AUTHORITY over a metric's cadence.** D2 exists to
   have one. The alert layer inventing `"intraday"` for `ohlcv.c` is the `pct_above_50ma` defect
   (PRD-D2 §9.2) committed prospectively.
2. **Refusal is the only branch that preserves the CoverageLine distinction** the book was built
   around — *"we could not compute it"* is a third answer beside *"yes"* and *"no"*, and it is the
   one an undeclared axis is entitled to.
3. **A refusal is REPAIRABLE and a default is not.** A refused registration produces a named reason
   a member and an engineer can both act on. A defaulted one produces a silently wrong alert that
   nobody will ever look for.

### 4.3 ⭐⭐ AND THE HARDER HALF, WHICH THE QUESTION AS POSED DOES NOT CONTAIN

**For `bars_sqlite`, cadence is not a property of the METRIC at all. It is a property of the
(metric, timeframe) PAIR.**

`ohlcv.c` has no single cadence. `ohlcv.c` on a 5-minute bar and `ohlcv.c` on a daily bar update at
rates that differ by two orders of magnitude, and the type's whole point is that a member arms an
alert on **one specific timeframe** (`indicator_alerts.tf`, NOT NULL, `indicator_alert_service.py:95`).
The book already models the timeframe as an axis — the address grammar is
`uct://<metric>@<entity>/<timeframe>?as_of=<instant>` (`address_grammar`), with the timeframe axis
sourced from `signature/ledger.py::_BARS_STORE_TF_KEYS` — but `cadence` is stored **on the metric**,
where it cannot express the dependency.

⛔ **So the gate must resolve the ADDRESS, not the metric.** Concretely:

- `cadence_for(metric, timeframe)` is the question; `book()["metrics"][m]["cadence"]` is only the
  answer when the store's cadence does not vary by timeframe — which is true for all 137
  `screener_rows` scalars and false for all 5 `bars_sqlite` ones.
- The evidence that it varies is already recorded, as D2's own **F-D2-2**: *"The bars store's as-of
  grain varies by timeframe and is declared nowhere"* — re-derived inline as `tf in ("D","W","M")`
  in **seven** places in `api/services/bars_fetch.py`. The alert lane has its own copy of the same
  split: `indicator_alert_evaluator._CALENDAR_TFS = ("D", "W", "M")` and
  `_TF_MINUTES = {"1":1,"5":5,"15":15,"30":30,"60":60}`.
- ⚠️ And a third copy of the same vocabulary is the ad-hoc key PRD-D2 §9.2 already indicts:
  `_LEDGER_TIMEFRAME` at `indicator_alert_evaluator.py:1692-1695`, *"an ad-hoc copy of an
  authoritative map, written with a comment explaining why it is dangerous… not sunset."*

### 4.4 ⛔ WHY CP1 MUST SHIP THE GATE AND MUST **NOT** SHIP THE DECLARATION

The obvious next move — declare the bars cadence per timeframe — is **blocked, and the block is
measured**. GATE-D2 §CP2.4 refused it once already:

> *"Declaring it once is the obvious fix and CP2 does not do it, for one reason: `bars_fetch.py` and
> `bars_sqlite.py` are **inside flow-worker's import closure and outside its watch list**, so
> flow-worker would run a stale copy of any new declaration."*

Confirmed independently this pass: `api/services/bars_sqlite.py` is **reachable=True, watched=False**
(§6) — an INERT STRAND. And declaring the cadence in the BUILDER instead would be typing it rather
than deriving it, which is the second-authority defect the book exists to end.

⭐ **THE CONSEQUENCE, STATED HONESTLY AND WITHOUT SOFTENING: at CP1 the type can register NO
bar-metric predicate at all.** Every `ohlcv.*` address refuses. That is the correct dark state — it
makes the missing declaration a visible, named refusal instead of a guess — and it is cheap, because
CP1 arms nothing and the gate's behaviour is exercised only by its own rails.

**What CP1 therefore builds for clause 3:**

- `cadence_for(address) -> str | None` in the S7 module, resolving **metric + timeframe** through
  `api/services/canonical/address_book.py`, returning `None` for undeclared — never a default.
- The refusal, on the ROUTER path (§3 item 1), with a fragment **pairwise distinct from every
  existing refusal constant in `indicator_alert_service.py`** (§3 item 2), asserted rather than
  reviewed.
- **Mutations, both directions, before merge:** (A) make the gate default an undeclared cadence to
  intraday → RED; (B) make it default to nightly → RED; (C) delete the gate → RED; (D) make the
  refusal fragment a substring of an existing one → RED.
- **A non-vacuity control:** the gate ADMITS a `cadence: nightly` screener metric on a `D`
  timeframe. A gate that refuses everything is indistinguishable from a gate that is broken.

---

## 5. ⛔ TWO RAILS THAT WILL NOT ANNOUNCE THIS TYPE — measure them before relying on them

### 5.1 The address-book reader rail counts the FILE, not the BOOK

`tests/test_canonical_address_book.py:232-268`:

```python
_ALLOWED_BOOK_READERS = ("api/services/canonical/address_book.py",)
```

and the test flags any module under `api/` whose **stripped code** contains the literal
`canonical_address_book` and is not on that list.

⛔ **Measured: after stripping, that literal survives in exactly ONE file in `api/**` —
`api/services/canonical/address_book.py:40`, the `BOOK_PATH` construction.** The other two raw
occurrences are a docstring (`address_book.py:6`) and a comment (`scan_evaluator.py:250`), both of
which the rail's own `_code_only()` removes.

⭐ **So CP2's own migrated reader does not trip it.** `api/services/ticker_returns.py:7` reads the
book (`from api.services.canonical import address_book as _book`, then `_book.row_position(...)` at
`:65`) and contains the literal nowhere. The rail constrains **who opens the JSON file**, not **who
reads the book**.

⚠️ **This is recorded, not filed as a defect.** It may be exactly what D2 intended. What matters for
this packet is the consequence: **an S7 evaluator reading through `address_book.metric()` will not
be announced by that rail, and the packet must not claim it will be.** If the owner wants a second
reader to require a line, the rail's predicate has to change — and that is D2's line to write, not
S7's.

### 5.2 ⛔⛔ THE SERIALIZER — `_EXPECTED`, and it flips BY DESIGN

`tests/test_alert_taxonomy_filing_watch_parity.py:621`:

```python
_EXPECTED = {"document-arrival", "price-level", "event-proximity", "catalyst-match"}
```

`_declared_trigger_types()` (`:549-562`) reads every module-level `TYPE_ID = "..."` in
`api/services/alert_taxonomy/` **from the AST — never a grep, never a hand-typed roster** — with two
non-vacuity controls at `:627-631` (the walk must see `document_arrival.py`; the scan must find at
least one declaration), and the assertion at `:633` requires the declared set to EQUAL `_EXPECTED`.
**Registering `indicator-condition` turns that test RED, and the red is the rail working, not a
regression.**

⛔ **The docstring's steps, reproduced from `:577-583`, before the line may be updated:**

> 1. Add the new type to `_EXPECTED` below.
> 2. Give `alerts._s7_durable_alerts` a reconstruction branch for it — without one its fires are
>    silently dropped from the member's feed (proved by the sibling test below).
> 3. Re-run the three observable classes above against the new type's own fixture event, and re-run
>    the mutation proof.

⚠️ **A drift recorded rather than silently fixed:** the docstring numbers **three** steps; the
failure message at `:636-637` says *"see this test's docstring for the four steps"*. The list is the
authority; the count is what drifted — the same shape as the COT router's "4 routes" beside five.

Step 2 is measured, not assumed. `api/services/alerts.py:142-165` — `_s7_durable_alerts` dispatches
on `trigger_type` with **exactly one branch** (`:160`, `document-arrival`), and `:157-159` says so in
the code's own words. `test_the_feed_bridge_silently_drops_a_trigger_type_it_has_no_branch_for`
(`:641`) demonstrates the hazard: a fire of any other type produces **no feed row and no error**.
⛔ Step 2 becomes a **PRECONDITION at CP3**, when a projection first writes a real member's fire.

---

## 6. ⛔ WATCH-COVERAGE CLASSIFICATION — this type has the WORST strand exposure of the four

Measured by importing `reachable_paths(root)` / `watched_paths(root)` from
`tools/flow_worker_watch_coverage.py` with an EXPLICIT root (no git). **reachable = 154,
watched = 24.** Control: `api/flow_worker_main.py` is reachable; `api/services/awareness/engine.py`
is not.

| module | reachable | watched | classification |
|---|---|---|---|
| `api/services/indicator_alert_service.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/indicator_alert_evaluator.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/bars_sqlite.py` | **yes** | no | ⛔ **INERT STRAND** — §4.4's block |
| `api/services/alert_taxonomy/{registry,receipts,delivery,db}.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/alerts.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/watchlist_alert_service.py` | **yes** | no | ⛔ **INERT STRAND** |
| `api/services/canonical/address_book.py` | **no** | no | outside — no constraint |
| a NEW `alert_taxonomy/indicator_condition.py` | **no** (until `register()` is wired) | no | outside — until CP3 |

Paths traced, not assumed:

- `flow_worker_main → auth_surface_check → flow_proxy → auth_service → auth_db → journal_two.db →
  journal_two.notes → ticker_meta → groups → groups_gates → screener.snapshot_db →
  screener.live_tier → screener.technicals → indicator_compute → ast_interpret → scan_definition →
  user_definitions → alert_rev_migration → **indicator_alert_service**` (and, one sibling hop,
  `→ indicator_alert_evaluator`)
- `flow_worker_main → flow_opt_aggregate → data_sync → **bars_sqlite**`

⛔⛔ **THIS IS THE CONSTRAINT THAT DECIDES WHICH CHECKPOINT CAN SHIP WHEN, AND IT IS SPECIFIC TO
THIS TYPE.** §3's recommendation puts the cadence refusal on the router path — but the router calls
`indicator_alert_service.refusal_for`, and **`indicator_alert_service.py` is a strand**: flow-worker
RUNS it and will NOT redeploy for a change to it. Three consequences, in order:

1. ⛔ **CP1 must NOT add the gate inside `indicator_alert_service.py`.** Put `cadence_for` and the
   refusal in the **new S7 module** (outside the closure) and have the router consult it, or accept
   a stated strand with a marker bump. The first is cheaper and is what this packet recommends.
2. ⛔ **CP1 must NOT declare the bars cadence in `bars_sqlite.py`** — §4.4, and D2 already refused
   the same edit for the same reason.
3. **CP3 strands the substrate regardless**, because wiring `register()` puts the new module into
   the closure through `alerts.py` / `registry.py`. Run
   `python tools/flow_worker_watch_coverage.py` at review; a red is a REVIEW GATE per
   `docs/runbooks/deploy-windows.md`, not a block.

---

## 7. What the checkpoints would be

*(Not authorized. Named so an approval line can name exactly one.)*

**CP1 — registration + params schema + THE CADENCE GATE (clause 3).**

1. `api/services/alert_taxonomy/indicator_condition.py` — `TYPE_ID`, `PARAMS_SCHEMA`, `register()`,
   plus `cadence_for(address)` and the refusal (§4.4). **No evaluator. No delivery. No read of
   `indicator_alerts`. No scheduler entry.**
2. `PARAMS_SCHEMA` pins **every shape the legacy path supports**, derived by AST from
   `indicator_alert_service.py` / `indicator_alert_evaluator.py`, never hand-typed —
   `{indicator, condition, threshold, tf, params_json, instance_id, scope, def_source}`. SPEC-S7
   §5.2's row names only the first four; the other four are real columns
   (`indicator_alert_service.py:128`, `:143`, `:159`, `:182`) and each carries a documented meaning
   a naive schema would erase:
   - `instance_id` — which chart instance; `NULL` means the alert outlived nothing;
   - `instance_missing_at` — ⛔ *deliberately not a `state`* (`:129-144`), because
     `record_evaluation` clears `needs_attention` the moment a value arrives and an orphaned alert
     KEEPS PRODUCING VALUES;
   - `scope` — `NULL` = GLOBAL; ⛔ *"`list_active()` MUST NEVER READ IT"* (`:153-158`);
   - `def_source` — `NULL` = builtin, `"user"` = an account wrote the arithmetic, and it gates
     ledger admission (`indicator_alert_evaluator._is_user_authored`, `:1733`).
3. The five alert states pinned as an enum derived from `ALERT_STATES` (`:61-62`).
4. **The cadence gate, its four mutations and its non-vacuity control** (§4.4).
5. The parity control at `tests/test_alert_taxonomy_filing_watch_parity.py:621` updated **by
   naming** (§5.2).
6. §4.3's finding — cadence is a property of (metric, timeframe) for `bars_sqlite` — recorded in
   **PRD-D2 §9 and SPEC-S7 §5.2**, at the point of use, as the follow-up D2 owes.

⛔ **Explicitly NOT in CP1:** no evaluator, no `delivery.py` call, no read of `indicator_alerts`, no
change to `indicator_alert_service.py`, `indicator_alert_evaluator.py`, `bars_sqlite.py` or the
address book, no scheduler entry, and **no cadence DECLARATION** (§4.4).

**CP2 — dark evaluator + FORWARD-ONLY comparison harness, harness-armed predicates ONLY.**
Four outcomes — `agreed` / `new_only` / `legacy_only` / `not_comparable` — never a pass rate;
`legacy_only` is an alert a member LOSES at the flip. ⛔ **No replay, ever** — this type's own reason
is the seventh distinct one the programme has met: **the legacy lane's fire identity is
`UNIQUE(alert_id, fire_key)` over an ARMED EPISODE**, and an episode is a live state machine, not a
function of history; re-running today's evaluator over cached bars would manufacture episodes that
never existed. ⛔ **And `eval_mode()` moves with no deploy** (§1b) — stamp it on every span and reset
the clock when it changes. A heartbeat on **every** tick including the quiet ones.

**CP3 — projection of real member rows, `rollout:s7-dark` cohort ONLY, still dark.**
⛔ Cohort via `api/services/rollout.py:100` `cohort_user_ids(rollout.S7_DARK)` — **never a role
check**; `rollout.py:29-38` rules that an empty cohort means NO MEMBERS and never a fallback to
admins. ⚠️ **The projection must read `list_active()`** and must not filter on `scope` or
`def_source` — `indicator_alert_service.py:153-158` and `:169-176` both record that a filter there
shrinks what the shadow lane observes and makes a cutover gate pass on a smaller set.

**CP4 — all members, still dark.** A tag assignment (`rollout.py:258`), not a code path.

**FLIP — its own line.** Delivery plus the legacy switch-off, same PR, with a member-impact
paragraph.

---

## 8. Method

- **CODE, NEVER PROSE.** Every literal search ran over source with docstrings and comments removed —
  each file parsed with `ast`, every string-only `Expr` statement blanked, `ast.unparse` re-emitted
  (which drops comments for free). **1,213 files under `api/` parsed, 0 unparsable.**
  **CONTROL:** a sentence that exists only in a module docstring (`"a trader would act on it"`,
  `scan_store.py`) is found in **1** raw file and **0** stripped files, while a real code token
  (`def record_hits`) is still found. The stripper removes prose and still sees code. §5.1's finding
  depends on exactly that property and would be wrong without it.
- **The address-book numbers in §2** were produced by `json.load` + counting, never read out of a
  document.
- **Reachability** — `reachable_paths(root)` / `watched_paths(root)` imported from
  `tools/flow_worker_watch_coverage.py` with an explicit root; no git invocation. Import paths in §6
  were traced with a BFS over the same `_api_imports` the tool uses.
- No git command was run and no SHA was verified. `b9783d509`, `ffa8102c7` and `6576f044e` appear
  only as caller-supplied identifiers.

---

## 9. ⚠️ WHAT COULD NOT BE MEASURED

1. **`indicator_alerts` row count in production.** The module says *"prod's `indicator_alerts` table
   has zero rows"* (`:18`, written before Phase C) and elsewhere *"the 31 production soak rows"*
   (`:163`). ⛔ **Those two sentences cannot both be current**, and no database was read this
   pass. **The population this absorption serves is UNKNOWN**, and it decides whether CP2's
   comparison can observe anything.
2. **`indicator_alert_fires` row count**, and therefore whether any member has ever received one.
3. **`ALERT_EVAL_MODE`'s live value.** `api/main.py:5032-5036` says the running answer is
   `GET /api/indicator-alerts/latency`, *"never from this comment"* — and this packet read the
   comment.
4. **Which addresses members actually name.** §4.4's "CP1 refuses every bar-metric predicate" is a
   statement about the book, not about demand: how many real alerts name a bar metric versus a
   computed series is unknown, and it is the number that sizes the cost of the refusal.
5. **Whether the address book on the deployed pod matches this tree's** — the book is a derived file
   in the repo, so a deploy that missed it would leave a stale manifest, and `book()` returns `{}`
   rather than raising (`address_book.py:59-87`).

⛔ Each is one read-only query or one authenticated GET away, and **none was performed.**
